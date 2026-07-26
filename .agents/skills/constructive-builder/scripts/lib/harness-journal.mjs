import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import {
  VALIDATION_KIND,
  VALIDATION_SCHEMA_VERSION,
  computeWorkspaceAttestation,
  ensureSafeWorkspaceDirectory,
  isSafeRelativePath,
  sha256File,
  writeJsonAtomic
} from './brief-contract.mjs';

export const JOURNAL_SCHEMA_VERSION = 2;
export const JOURNAL_KIND = 'constructive.builder-run';
export const STAGES = [
  'brief',
  'tenant',
  'install',
  'domain',
  'static',
  'live',
  'visual',
  'acceptance'
];

const EVIDENCE_REQUIREMENTS = new Map([
  ['brief', ['validation']],
  ['tenant', ['tenant-contract', 'endpoint-check']],
  ['install', ['install-plan', 'install-log', 'manifest', 'package-provenance', 'blocks-check']],
  ['domain', ['source-check', 'meta-contract']],
  ['static', ['typecheck', 'build']],
  ['live', ['live-session', 'graphql', 'rls']],
  ['visual', ['screenshot', 'interaction']],
  ['acceptance', ['evaluator']]
]);

const MACHINE_EVIDENCE_KINDS = new Map([
  ['live-session', 'constructive.builder-live-session-evidence'],
  ['graphql', 'constructive.builder-graphql-evidence'],
  ['rls', 'constructive.builder-rls-evidence'],
  ['screenshot', 'constructive.builder-visual-evidence'],
  ['evaluator', 'constructive.builder-acceptance-evidence']
]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object.');
  }
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(label + ' must contain exactly: ' + expected.join(', ') + '.');
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(label + ' must be a lowercase SHA-256 digest.');
  }
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(label + ' must be an ISO timestamp.');
  }
}

function now() {
  return new Date().toISOString();
}

function duration(startedAt, finishedAt) {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

function requireValue(value, option) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(option + ' is required.');
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(label + ' could not be read as JSON at ' + filePath + ': ' + error.message);
  }
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertRegularContainedFile(filePathInput, workspacePathInput, label) {
  const filePath = path.resolve(filePathInput);
  if (!fs.existsSync(filePath)) {
    throw new Error(label + ' does not exist: ' + filePath);
  }
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(label + ' must be a regular, non-symlink file.');
  }
  if (workspacePathInput) {
    const realWorkspace = fs.realpathSync(workspacePathInput);
    const realFile = fs.realpathSync(filePath);
    if (!isWithin(realWorkspace, realFile)) {
      throw new Error(label + ' escapes the validated workspace.');
    }
  }
  return filePath;
}

function runGit(worktree, argumentsList) {
  return execFileSync('git', ['-C', worktree].concat(argumentsList), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function verifyImmutableFiles(files) {
  if (!Array.isArray(files) || files.length < 3) {
    throw new Error('The validation report has incomplete immutable input attestations.');
  }
  for (const inputFile of files) {
    if (!inputFile || typeof inputFile.path !== 'string' || typeof inputFile.sha256 !== 'string') {
      throw new Error('The validation report has a malformed immutable input attestation.');
    }
    const filePath = path.resolve(inputFile.path);
    if (!fs.existsSync(filePath)) {
      throw new Error('A validated input no longer exists: ' + filePath);
    }
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('A validated input is no longer a regular, non-symlink file: ' + filePath);
    }
    if (sha256File(filePath) !== inputFile.sha256) {
      throw new Error('A validated input changed; run validation and initialize a new journal: ' + filePath);
    }
  }
}

function verifyBlocksSource(blocksSource) {
  if (blocksSource === null) {
    return;
  }
  if (!blocksSource || typeof blocksSource.path !== 'string') {
    throw new Error('The validation report has a malformed Blocks source attestation.');
  }
  const sourcePath = path.resolve(blocksSource.path);
  const head = runGit(sourcePath, ['rev-parse', 'HEAD']);
  if (head !== blocksSource.headCommit) {
    throw new Error('The pinned Blocks source moved after validation; validate again and initialize a new journal.');
  }
}

function verifyValidationReport(validation, validationPath) {
  if (
    !validation ||
    validation.schemaVersion !== VALIDATION_SCHEMA_VERSION ||
    validation.kind !== VALIDATION_KIND ||
    validation.ok !== true
  ) {
    throw new Error('Journal initialization requires a passing schemaVersion 2 constructive.builder-validation report.');
  }
  if (!validation.inputs || !validation.inputs.workspace) {
    throw new Error('The validation report has no workspace attestation.');
  }
  verifyImmutableFiles(validation.inputs.immutableFiles);
  verifyBlocksSource(validation.inputs.blocksSource);
  const currentWorkspace = computeWorkspaceAttestation(validation.inputs.workspace.path);
  if (currentWorkspace.sha256 !== validation.inputs.workspace.sha256) {
    throw new Error('The workspace changed after validation; validate it again before journal initialization.');
  }
  const workspacePath = currentWorkspace.path;
  const absoluteValidationPath = path.resolve(validationPath);
  const absoluteStateParent = workspacePath;
  if (!isWithin(absoluteStateParent, absoluteValidationPath)) {
    throw new Error('The validation report must be stored inside the validated workspace.');
  }
  ensureSafeWorkspaceDirectory(workspacePath, path.dirname(absoluteValidationPath), '.constructive/harness');
  const validationStats = fs.lstatSync(absoluteValidationPath);
  if (!validationStats.isFile() || validationStats.isSymbolicLink()) {
    throw new Error('The validation report must be a regular, non-symlink file.');
  }
  if (!isWithin(fs.realpathSync(workspacePath), fs.realpathSync(absoluteValidationPath))) {
    throw new Error('The validation report escapes the workspace through a symlinked parent.');
  }
  return currentWorkspace;
}

function initialStage() {
  return {
    attempts: []
  };
}

function validateStateShape(state) {
  if (!state || state.schemaVersion !== JOURNAL_SCHEMA_VERSION || state.kind !== JOURNAL_KIND) {
    throw new Error('Run state has an unsupported schema or kind.');
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    throw new Error('Run state has an invalid revision.');
  }
  exactKeys(
    state,
    ['schemaVersion', 'kind', 'revision', 'validation', 'inputs', 'resolved', 'startedAt', 'invalidations', 'stages'],
    'Run state'
  );
  exactKeys(state.validation, ['path', 'sha256'], 'Run state validation');
  assertSha256(state.validation.sha256, 'Run state validation.sha256');
  assertTimestamp(state.startedAt, 'Run state startedAt');
  if (!state.stages || typeof state.stages !== 'object' || !Array.isArray(state.invalidations)) {
    throw new Error('Run state is missing stages or invalidations.');
  }
  for (const stageName of STAGES) {
    const stage = state.stages[stageName];
    if (!stage || !Array.isArray(stage.attempts)) {
      throw new Error('Run state is missing stage ' + stageName + '.');
    }
    if (Object.hasOwn(stage, 'status')) {
      throw new Error('Run state stage ' + stageName + ' caches status instead of deriving it from attempt events.');
    }
    for (let attemptIndex = 0; attemptIndex < stage.attempts.length; attemptIndex += 1) {
      const attempt = stage.attempts[attemptIndex];
      if (!attempt || !Number.isInteger(attempt.number) || !Array.isArray(attempt.events) || attempt.events.length === 0) {
        throw new Error('Run state stage ' + stageName + ' has a malformed attempt event stream.');
      }
      exactKeys(attempt, ['number', 'events'], 'Run state ' + stageName + ' attempt');
      if (attempt.number !== attemptIndex + 1) {
        throw new Error('Run state stage ' + stageName + ' attempt numbers must be contiguous.');
      }
      if (attempt.events[0].kind !== 'started') {
        throw new Error('Run state stage ' + stageName + ' has an attempt that does not begin with started.');
      }
      if (attempt.events.length > 2) {
        throw new Error('Run state stage ' + stageName + ' has more than one terminal event.');
      }
      if (attempt.events.length === 2 && attempt.events[1].kind !== 'passed' && attempt.events[1].kind !== 'failed') {
        throw new Error('Run state stage ' + stageName + ' has an unsupported terminal event.');
      }
      exactKeys(attempt.events[0], ['kind', 'at', 'workspaceBeforeSha256'], 'Run state started event');
      assertTimestamp(attempt.events[0].at, 'Run state started event at');
      assertSha256(attempt.events[0].workspaceBeforeSha256, 'Run state started event workspaceBeforeSha256');
      if (attempt.events.length === 2) {
        const terminal = attempt.events[1];
        const terminalKeys = terminal.kind === 'passed'
          ? ['kind', 'at', 'evidence', 'workspace']
          : ['kind', 'at', 'evidence', 'reason', 'workspace'];
        exactKeys(terminal, terminalKeys, 'Run state terminal event');
        assertTimestamp(terminal.at, 'Run state terminal event at');
        if (Date.parse(terminal.at) < Date.parse(attempt.events[0].at)) {
          throw new Error('Run state terminal event predates its start event.');
        }
        if (!Array.isArray(terminal.evidence) || terminal.evidence.length === 0) {
          throw new Error('Run state terminal events require evidence.');
        }
        if (terminal.kind === 'failed' && (typeof terminal.reason !== 'string' || terminal.reason.trim().length === 0)) {
          throw new Error('Run state failed events require a reason.');
        }
        exactKeys(terminal.workspace, ['sha256', 'fileCount', 'gitHead'], 'Run state terminal workspace');
        assertSha256(terminal.workspace.sha256, 'Run state terminal workspace.sha256');
        if (!Number.isInteger(terminal.workspace.fileCount) || terminal.workspace.fileCount < 0) {
          throw new Error('Run state terminal workspace.fileCount must be a non-negative integer.');
        }
      }
    }
  }
  for (const invalidation of state.invalidations) {
    exactKeys(invalidation, ['at', 'fromStage', 'reason', 'affected', 'workspace'], 'Run state invalidation');
    assertTimestamp(invalidation.at, 'Run state invalidation at');
    assertStage(invalidation.fromStage);
    if (typeof invalidation.reason !== 'string' || invalidation.reason.trim().length === 0) {
      throw new Error('Run state invalidation reason must be non-empty.');
    }
    if (!Array.isArray(invalidation.affected) || invalidation.affected.length === 0) {
      throw new Error('Run state invalidation must name affected stages.');
    }
    for (const affected of invalidation.affected) {
      exactKeys(affected, ['stage', 'priorStatus', 'attemptCount'], 'Run state invalidation affected entry');
      assertStage(affected.stage);
    }
    exactKeys(invalidation.workspace, ['sha256', 'fileCount', 'gitHead'], 'Run state invalidation workspace');
    assertSha256(invalidation.workspace.sha256, 'Run state invalidation workspace.sha256');
  }
}

function verifyStateInputs(state) {
  assertRegularContainedFile(state.validation.path, state.inputs.workspace.path, 'The validation report');
  if (sha256File(state.validation.path) !== state.validation.sha256) {
    throw new Error('The validation report changed after journal initialization.');
  }
  const validation = readJson(state.validation.path, 'Validation report');
  if (!isDeepStrictEqual(state.resolved, validation.resolved)) {
    throw new Error('The journal resolved contract differs from its immutable validation report.');
  }
  const copiedInputs = {
    brief: state.inputs.brief,
    tenant: state.inputs.tenant,
    catalog: state.inputs.catalog,
    blocksSource: state.inputs.blocksSource,
    installPlans: state.inputs.installPlans,
    immutableFiles: state.inputs.immutableFiles,
    workspace: state.inputs.workspace
  };
  if (!isDeepStrictEqual(copiedInputs, validation.inputs)) {
    throw new Error('The journal input attestations differ from the immutable validation report.');
  }
  verifyImmutableFiles(state.inputs.immutableFiles);
  verifyBlocksSource(state.inputs.blocksSource);
}

function verifyArtifactRecord(artifact, workspacePath, label, expectedKeys) {
  exactKeys(artifact, expectedKeys, label);
  if (typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path) || !isWithin(workspacePath, artifact.path)) {
    throw new Error(label + ' path must be absolute and inside the validated workspace.');
  }
  assertSha256(artifact.sha256, label + '.sha256');
  if (!Number.isInteger(artifact.size) || artifact.size < 0) {
    throw new Error(label + '.size must be a non-negative integer.');
  }
  if (!fs.existsSync(artifact.path)) {
    throw new Error(label + ' no longer exists: ' + artifact.path);
  }
  const stats = fs.lstatSync(artifact.path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(label + ' must remain a regular, non-symlink file.');
  }
  if (stats.size !== artifact.size || sha256File(artifact.path) !== artifact.sha256) {
    throw new Error(label + ' changed after it was journaled: ' + artifact.path);
  }
  const realWorkspace = fs.realpathSync(workspacePath);
  const realArtifact = fs.realpathSync(artifact.path);
  if (!isWithin(realWorkspace, realArtifact)) {
    throw new Error(label + ' escapes the workspace through a symlinked parent directory.');
  }
}

function verifyRetainedEvidence(state) {
  const workspacePath = state.inputs.workspace.path;
  for (const stageName of STAGES) {
    const allowedTypes = new Set(EVIDENCE_REQUIREMENTS.get(stageName));
    for (const attempt of state.stages[stageName].attempts) {
      for (const event of attempt.events) {
        if (event.kind !== 'passed' && event.kind !== 'failed') {
          continue;
        }
        for (const evidence of event.evidence) {
          verifyArtifactRecord(
            evidence,
            workspacePath,
            'Retained ' + stageName + ' evidence',
            ['type', 'path', 'sha256', 'size', 'references']
          );
          if (!allowedTypes.has(evidence.type)) {
            throw new Error('Retained evidence type ' + evidence.type + ' is invalid for stage ' + stageName + '.');
          }
          if (!Array.isArray(evidence.references)) {
            throw new Error('Retained evidence references must be an array.');
          }
          for (const reference of evidence.references) {
            verifyArtifactRecord(
              reference,
              workspacePath,
              'Retained evidence outcome reference',
              ['kind', 'path', 'sha256', 'size']
            );
            if (!['request', 'ui', 'screenshot', 'interaction'].includes(reference.kind)) {
              throw new Error('Retained evidence outcome reference kind must be request, ui, screenshot, or interaction.');
            }
          }
        }
      }
    }
  }
}

function latestTerminalWorkspace(state) {
  let latestAt = null;
  let latestWorkspace = state.inputs.workspace;
  for (const stageName of STAGES) {
    for (const attempt of state.stages[stageName].attempts) {
      for (const event of attempt.events) {
        if ((event.kind === 'passed' || event.kind === 'failed') && event.workspace) {
          if (latestAt === null || Date.parse(event.at) >= Date.parse(latestAt)) {
            latestAt = event.at;
            latestWorkspace = event.workspace;
          }
        }
      }
    }
  }
  for (const invalidation of state.invalidations) {
    if (invalidation.workspace && (latestAt === null || Date.parse(invalidation.at) >= Date.parse(latestAt))) {
      latestAt = invalidation.at;
      latestWorkspace = invalidation.workspace;
    }
  }
  return latestWorkspace;
}

function verifyWorkspaceContinuity(state) {
  const running = STAGES.some((stageName) => deriveStage(state, stageName).status === 'running');
  if (running) {
    return;
  }
  const expected = latestTerminalWorkspace(state);
  const current = computeWorkspaceAttestation(state.inputs.workspace.path);
  if (!current || current.sha256 !== expected.sha256) {
    throw new Error('The workspace changed outside a running journal stage; invalidate the affected stage or restore the attested baseline.');
  }
}

export function loadJournal(statePathInput, options = null) {
  const statePath = path.resolve(statePathInput);
  assertRegularContainedFile(statePath, '', 'Run state');
  const state = readJson(statePath, 'Run state');
  assertRegularContainedFile(statePath, state?.inputs?.workspace?.path, 'Run state');
  validateStateShape(state);
  verifyStateInputs(state);
  verifyRetainedEvidence(state);
  if (!options || options.allowWorkspaceDrift !== true) {
    verifyWorkspaceContinuity(state);
  }
  return state;
}

function assertStage(stageName) {
  if (!STAGES.includes(stageName)) {
    throw new Error('Unknown stage ' + stageName + '. Valid stages: ' + STAGES.join(', ') + '.');
  }
}

function assertPriorStagesPassed(state, stageName) {
  const stageIndex = STAGES.indexOf(stageName);
  for (let index = 0; index < stageIndex; index += 1) {
    const priorName = STAGES[index];
    if (deriveStage(state, priorName).status !== 'passed') {
      throw new Error('Cannot start ' + stageName + ' before ' + priorName + ' passes.');
    }
  }
}

function currentAttempt(stage) {
  if (stage.attempts.length === 0) {
    return null;
  }
  return stage.attempts[stage.attempts.length - 1];
}

function latestInvalidation(state, stageName) {
  for (let index = state.invalidations.length - 1; index >= 0; index -= 1) {
    const invalidation = state.invalidations[index];
    if (Array.isArray(invalidation.affected) && invalidation.affected.some((entry) => entry.stage === stageName)) {
      return invalidation;
    }
  }
  return null;
}

function deriveAttempt(attempt) {
  const event = attempt.events[attempt.events.length - 1];
  const started = attempt.events[0];
  return {
    status: event.kind === 'started' ? 'running' : event.kind,
    startedAt: started.at,
    finishedAt: event.kind === 'started' ? null : event.at,
    durationMs: event.kind === 'started' ? null : duration(started.at, event.at),
    evidence: Array.isArray(event.evidence) ? event.evidence : [],
    failureReason: event.kind === 'failed' ? event.reason : null,
    latestEventAt: event.at
  };
}

function deriveStage(state, stageName) {
  const stage = state.stages[stageName];
  const attempt = currentAttempt(stage);
  if (!attempt) {
    return {
      status: 'pending',
      attempt: null,
      invalidation: latestInvalidation(state, stageName)
    };
  }
  const derivedAttempt = deriveAttempt(attempt);
  const invalidation = latestInvalidation(state, stageName);
  if (invalidation && Date.parse(invalidation.at) >= Date.parse(derivedAttempt.latestEventAt)) {
    return {
      status: 'pending',
      attempt: derivedAttempt,
      invalidation
    };
  }
  return {
    status: derivedAttempt.status,
    attempt: derivedAttempt,
    invalidation
  };
}

function deriveRunStatus(state) {
  const statuses = STAGES.map((stageName) => deriveStage(state, stageName).status);
  if (statuses.every((status) => status === 'passed')) {
    return 'passed';
  }
  if (statuses.includes('failed')) {
    return 'failed';
  }
  if (statuses.includes('running')) {
    return 'running';
  }
  return 'pending';
}

function incrementRevision(state) {
  state.revision += 1;
}

export function summarizeJournal(state) {
  const runStatus = deriveRunStatus(state);
  let finishedAt = null;
  if (runStatus === 'passed') {
    const acceptance = deriveStage(state, 'acceptance');
    finishedAt = acceptance.attempt.finishedAt;
  }
  const referenceTime = finishedAt || now();
  let nextStage = null;
  const stages = {};
  for (const stageName of STAGES) {
    const stage = state.stages[stageName];
    const derived = deriveStage(state, stageName);
    if (nextStage === null && derived.status !== 'passed') {
      nextStage = stageName;
    }
    stages[stageName] = {
      status: derived.status,
      attemptCount: stage.attempts.length,
      latestDurationMs: derived.attempt ? derived.attempt.durationMs : null,
      latestEvidenceCount: derived.attempt ? derived.attempt.evidence.length : 0,
      latestFailureReason: derived.attempt ? derived.attempt.failureReason : null
    };
  }
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    kind: 'constructive.builder-run-summary',
    status: runStatus,
    revision: state.revision,
    nextStage,
    elapsedMs: duration(state.startedAt, referenceTime),
    invalidationCount: state.invalidations.length,
    validationSha256: state.validation.sha256,
    stages
  };
}

function parseEvidenceReference(reference) {
  const separator = reference.indexOf('=');
  if (separator <= 0 || separator === reference.length - 1) {
    throw new Error('--evidence must use type=relative/path syntax.');
  }
  return {
    type: reference.slice(0, separator),
    relativePath: reference.slice(separator + 1)
  };
}

function attestEvidence(references, stageName, workspacePath, requireComplete) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('At least one typed --evidence value is required.');
  }
  const allowedTypes = EVIDENCE_REQUIREMENTS.get(stageName);
  const allowed = new Set(allowedTypes);
  const types = new Set();
  const evidence = [];
  for (const reference of references) {
    const parsed = parseEvidenceReference(reference);
    if (!allowed.has(parsed.type)) {
      throw new Error('Evidence type ' + parsed.type + ' is not valid for stage ' + stageName + '. Expected: ' + allowedTypes.join(', ') + '.');
    }
    if (!isSafeRelativePath(parsed.relativePath) || parsed.relativePath === '.') {
      throw new Error('Evidence paths must be safe paths relative to the validated workspace.');
    }
    const evidencePath = path.resolve(workspacePath, parsed.relativePath);
    if (!isWithin(workspacePath, evidencePath)) {
      throw new Error('Evidence must stay inside the validated workspace.');
    }
    if (!fs.existsSync(evidencePath)) {
      throw new Error('Evidence does not exist: ' + evidencePath);
    }
    const stats = fs.lstatSync(evidencePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Evidence must be a regular, non-symlink file: ' + evidencePath);
    }
    const realWorkspace = fs.realpathSync(workspacePath);
    const realEvidence = fs.realpathSync(evidencePath);
    if (!isWithin(realWorkspace, realEvidence)) {
      throw new Error('Evidence must not escape the workspace through a symlink.');
    }
    if (types.has(parsed.type)) {
      throw new Error('Provide exactly one evidence artifact for type ' + parsed.type + ' in a stage transition.');
    }
    types.add(parsed.type);
    evidence.push({
      type: parsed.type,
      path: evidencePath,
      sha256: sha256File(evidencePath),
      size: stats.size,
      references: []
    });
  }
  if (requireComplete) {
    for (const requiredType of allowedTypes) {
      if (!types.has(requiredType)) {
        throw new Error('Passing stage ' + stageName + ' requires evidence type ' + requiredType + '.');
      }
    }
  }
  return evidence;
}

function setEquals(actualValues, expectedValues) {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  if (actual.size !== actualValues.length || expected.size !== expectedValues.length || actual.size !== expected.size) {
    return false;
  }
  for (const value of expected) {
    if (!actual.has(value)) {
      return false;
    }
  }
  return true;
}

function attestOutcomeReference(relativePath, kind, workspacePath) {
  if (!isSafeRelativePath(relativePath) || relativePath === '.') {
    throw new Error('Machine evidence ' + kind + ' references must be safe workspace-relative paths.');
  }
  const artifactPath = path.resolve(workspacePath, relativePath);
  if (!isWithin(workspacePath, artifactPath) || !fs.existsSync(artifactPath)) {
    throw new Error('Machine evidence ' + kind + ' reference does not exist inside the workspace: ' + relativePath);
  }
  const stats = fs.lstatSync(artifactPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Machine evidence ' + kind + ' reference must be a regular, non-symlink file.');
  }
  const realWorkspace = fs.realpathSync(workspacePath);
  const realArtifact = fs.realpathSync(artifactPath);
  if (!isWithin(realWorkspace, realArtifact)) {
    throw new Error('Machine evidence ' + kind + ' reference escapes through a symlinked parent directory.');
  }
  return {
    kind,
    path: artifactPath,
    sha256: sha256File(artifactPath),
    size: stats.size
  };
}

function expectedTenantIds(state) {
  const ids = [state.resolved.tenantId];
  const isolationTenants = state.resolved.acceptance?.isolationTenants;
  if (Array.isArray(isolationTenants)) {
    for (const isolation of isolationTenants) {
      ids.push(isolation.databaseId);
    }
  }
  return ids;
}

function expectedScenarios(state, evidenceType) {
  const scenarios = state.resolved.acceptance?.scenarios;
  if (!Array.isArray(scenarios)) {
    throw new Error('The validated brief has no resolved acceptance scenarios.');
  }
  if (evidenceType === 'live-session') {
    return scenarios.filter((scenario) => scenario.kind === 'auth');
  }
  if (evidenceType === 'graphql') {
    return scenarios.filter((scenario) => scenario.kind === 'crud' || scenario.kind === 'feature');
  }
  if (evidenceType === 'rls') {
    return scenarios.filter((scenario) => scenario.kind === 'rls');
  }
  return scenarios.slice();
}

function addOutcomeReferences(assertion, evidence, workspacePath, seenReferences) {
  for (const pair of [
    ['request', assertion.requestRef],
    ['ui', assertion.uiRef]
  ]) {
    const key = pair[0] + ':' + pair[1];
    if (seenReferences.has(key)) {
      continue;
    }
    seenReferences.add(key);
    evidence.references.push(attestOutcomeReference(pair[1], pair[0], workspacePath));
  }
}

function validateScenarioResults(results, expected, evidence, state, requirePass) {
  if (!Array.isArray(results)) {
    throw new Error('Machine evidence results must be an array.');
  }
  if (results.length === 0) {
    if (requirePass && expected.length === 0) {
      return false;
    }
    throw new Error('Machine evidence must contain scenario results.');
  }
  const expectedById = new Map(expected.map((scenario) => [scenario.id, scenario]));
  const seen = new Set();
  const seenReferences = new Set();
  let observedFailure = false;
  for (const result of results) {
    exactKeys(result, ['scenarioId', 'actorIds', 'assertions'], 'Machine evidence scenario result');
    const scenario = expectedById.get(result.scenarioId);
    if (!scenario) {
      throw new Error('Machine evidence references an unexpected scenario ' + String(result.scenarioId) + '.');
    }
    if (seen.has(result.scenarioId)) {
      throw new Error('Machine evidence duplicates scenario ' + result.scenarioId + '.');
    }
    seen.add(result.scenarioId);
    if (!Array.isArray(result.actorIds) || !setEquals(result.actorIds, scenario.actorIds)) {
      throw new Error('Machine evidence actors do not exactly match scenario ' + result.scenarioId + '.');
    }
    if (!Array.isArray(result.assertions) || result.assertions.length === 0) {
      throw new Error('Machine evidence scenario ' + result.scenarioId + ' has no assertion results.');
    }
    const assertionIds = [];
    const expectedContracts = new Map();
    if (Array.isArray(scenario.assertionContracts)) {
      for (const assertionContract of scenario.assertionContracts) {
        expectedContracts.set(assertionContract.id, assertionContract.contract);
      }
    } else {
      for (const assertionId of scenario.assertionIds) {
        expectedContracts.set(assertionId, null);
      }
    }
    for (const assertion of result.assertions) {
      exactKeys(assertion, ['id', 'passed', 'contract', 'requestRef', 'uiRef'], 'Machine evidence assertion');
      if (typeof assertion.id !== 'string' || !scenario.assertionIds.includes(assertion.id)) {
        throw new Error('Machine evidence has an unexpected assertion for scenario ' + result.scenarioId + '.');
      }
      if (!isDeepStrictEqual(assertion.contract, expectedContracts.get(assertion.id))) {
        throw new Error('Machine evidence assertion contract does not match the source-attested route for scenario ' + result.scenarioId + '.');
      }
      if (typeof assertion.passed !== 'boolean') {
        throw new Error('Machine evidence assertion passed must be boolean.');
      }
      if (requirePass && assertion.passed !== true) {
        throw new Error('Machine evidence contains a failed assertion for scenario ' + result.scenarioId + '.');
      }
      if (!assertion.passed) {
        observedFailure = true;
      }
      assertionIds.push(assertion.id);
      addOutcomeReferences(assertion, evidence, state.inputs.workspace.path, seenReferences);
    }
    if (requirePass && !setEquals(assertionIds, scenario.assertionIds)) {
      throw new Error('Machine evidence does not cover every assertion for scenario ' + result.scenarioId + '.');
    }
  }
  if (requirePass && !setEquals(Array.from(seen), expected.map((scenario) => scenario.id))) {
    throw new Error('Machine evidence does not cover every required scenario.');
  }
  return observedFailure;
}

function validateLiveEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'tenantIds', 'results'], 'Live machine evidence');
  if (document.schemaVersion !== 1 || document.kind !== MACHINE_EVIDENCE_KINDS.get(evidence.type)) {
    throw new Error('Live machine evidence has the wrong schemaVersion or kind for ' + evidence.type + '.');
  }
  if (!Array.isArray(document.tenantIds) || !setEquals(document.tenantIds, expectedTenantIds(state))) {
    throw new Error('Live machine evidence tenantIds must exactly cover the primary and isolation tenant descriptors.');
  }
  const expected = expectedScenarios(state, evidence.type);
  const observedFailure = validateScenarioResults(document.results, expected, evidence, state, requirePass);
  if (!requirePass && !observedFailure) {
    throw new Error('Failed live evidence must contain at least one failed assertion.');
  }
}

function validateAcceptanceEvidence(document, evidence, state, requirePass) {
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'tenantIds', 'capabilities', 'scenarios', 'limitations', 'verdict'],
    'Acceptance machine evidence'
  );
  if (document.schemaVersion !== 1 || document.kind !== MACHINE_EVIDENCE_KINDS.get('evaluator')) {
    throw new Error('Acceptance machine evidence has the wrong schemaVersion or kind.');
  }
  if (!Array.isArray(document.tenantIds) || !setEquals(document.tenantIds, expectedTenantIds(state))) {
    throw new Error('Acceptance machine evidence tenantIds must exactly cover the primary and isolation tenants.');
  }
  if (document.verdict !== (requirePass ? 'pass' : 'fail')) {
    throw new Error('Acceptance machine evidence verdict does not match the journal transition.');
  }
  const expectedCapabilities = state.resolved.acceptance.capabilities;
  if (!Array.isArray(document.capabilities)) {
    throw new Error('Acceptance machine evidence capabilities must be an array.');
  }
  if (document.capabilities.length === 0 && expectedCapabilities.length > 0) {
    throw new Error('Acceptance machine evidence must contain capability results.');
  }
  const expectedByKey = new Map(
    expectedCapabilities.map((capability) => [capability.surfaceId + ':' + capability.featurePack, capability])
  );
  const seen = new Set();
  const seenReferences = new Set();
  let observedFailure = false;
  for (const capability of document.capabilities) {
    exactKeys(
      capability,
      ['surfaceId', 'featurePack', 'expected', 'actual', 'passed', 'requestRef', 'uiRef'],
      'Acceptance capability result'
    );
    const key = capability.surfaceId + ':' + capability.featurePack;
    const expected = expectedByKey.get(key);
    if (!expected || seen.has(key)) {
      throw new Error('Acceptance machine evidence has an unexpected or duplicate capability ' + key + '.');
    }
    seen.add(key);
    if (capability.expected !== expected.expected || typeof capability.passed !== 'boolean') {
      throw new Error('Acceptance capability ' + key + ' does not preserve the validated expected state.');
    }
    if (!['ready', 'partial', 'unavailable'].includes(capability.actual)) {
      throw new Error('Acceptance capability ' + key + ' has an invalid actual state.');
    }
    if (capability.actual !== expected.expected && capability.passed !== false) {
      throw new Error('Acceptance capability ' + key + ' must fail when actual differs from expected.');
    }
    if (requirePass && (capability.actual !== expected.expected || capability.passed !== true)) {
      throw new Error('Acceptance capability ' + key + ' did not match and pass its expected state.');
    }
    if (!capability.passed) {
      observedFailure = true;
    }
    addOutcomeReferences(capability, evidence, state.inputs.workspace.path, seenReferences);
  }
  if (requirePass && !setEquals(Array.from(seen), Array.from(expectedByKey.keys()))) {
    throw new Error('Acceptance machine evidence does not cover every capability expectation.');
  }
  const scenarioFailure = validateScenarioResults(
    document.scenarios,
    expectedScenarios(state, 'evaluator'),
    evidence,
    state,
    requirePass
  );
  const expectedLimitations = Array.isArray(state.resolved.runtimeLimitations)
    ? state.resolved.runtimeLimitations
    : [];
  if (!Array.isArray(document.limitations)) {
    throw new Error('Acceptance machine evidence limitations must be an array.');
  }
  const expectedLimitationById = new Map(expectedLimitations.map((limitation) => [limitation.id, limitation]));
  const seenLimitations = new Set();
  let limitationFailure = false;
  for (const limitation of document.limitations) {
    exactKeys(limitation, ['id', 'status', 'passed', 'requirements'], 'Acceptance limitation result');
    const expected = expectedLimitationById.get(limitation.id);
    if (!expected || seenLimitations.has(limitation.id)) {
      throw new Error('Acceptance machine evidence has an unexpected or duplicate limitation ' + String(limitation.id) + '.');
    }
    seenLimitations.add(limitation.id);
    if (limitation.status !== expected.status || typeof limitation.passed !== 'boolean') {
      throw new Error('Acceptance limitation ' + limitation.id + ' does not match the validated source limitation.');
    }
    if (!Array.isArray(limitation.requirements)) {
      throw new Error('Acceptance limitation ' + limitation.id + ' requirements must be an array.');
    }
    const expectedRequirements = Array.isArray(expected.mitigationRequirements)
      ? expected.mitigationRequirements
      : [];
    const expectedRequirementById = new Map(
      expectedRequirements.map((requirement) => [requirement.id, requirement])
    );
    const seenRequirements = new Set();
    let allRequirementsPassed = true;
    for (let requirementIndex = 0; requirementIndex < limitation.requirements.length; requirementIndex += 1) {
      const requirement = limitation.requirements[requirementIndex];
      exactKeys(
        requirement,
        ['id', 'passed', 'requestRef', 'uiRef'],
        'Acceptance limitation requirement result'
      );
      if (!expectedRequirementById.has(requirement.id) || seenRequirements.has(requirement.id)) {
        throw new Error(
          'Acceptance limitation ' + limitation.id + ' has an unexpected or duplicate mitigation requirement ' +
          String(requirement.id) + '.'
        );
      }
      if (requirement.id !== expectedRequirements[requirementIndex]?.id) {
        throw new Error(
          'Acceptance limitation ' + limitation.id + ' mitigation requirements must preserve the source-attested order.'
        );
      }
      seenRequirements.add(requirement.id);
      if (typeof requirement.passed !== 'boolean') {
        throw new Error(
          'Acceptance limitation ' + limitation.id + ' mitigation requirement ' + requirement.id +
          ' must record passed as a boolean.'
        );
      }
      if (!requirement.passed) {
        allRequirementsPassed = false;
      }
      addOutcomeReferences(requirement, evidence, state.inputs.workspace.path, seenReferences);
    }
    if (!setEquals(Array.from(seenRequirements), Array.from(expectedRequirementById.keys()))) {
      throw new Error(
        'Acceptance limitation ' + limitation.id + ' does not cover every source-attested mitigation requirement.'
      );
    }
    if (expected.acceptance === 'blocking' && limitation.passed !== false) {
      throw new Error('Blocking source limitation ' + limitation.id + ' can never be recorded as passed.');
    }
    if (expected.acceptance === 'require-mitigation' && limitation.passed !== allRequirementsPassed) {
      throw new Error(
        'Source limitation ' + limitation.id + ' passed state must equal its complete mitigation requirement results.'
      );
    }
    if (
      requirePass &&
      expected.acceptance === 'require-mitigation' &&
      (limitation.passed !== true || !allRequirementsPassed)
    ) {
      throw new Error('Source limitation ' + limitation.id + ' requires every mitigation requirement to pass.');
    }
    if (!limitation.passed) {
      limitationFailure = true;
    }
  }
  if (!setEquals(Array.from(seenLimitations), Array.from(expectedLimitationById.keys()))) {
    throw new Error('Acceptance machine evidence does not cover every source-attested runtime limitation.');
  }
  if (requirePass && expectedLimitations.some((limitation) => limitation.acceptance === 'blocking')) {
    throw new Error('Acceptance cannot pass while the pinned Blocks source has a blocking runtime limitation.');
  }
  if (!requirePass && !observedFailure && !scenarioFailure && !limitationFailure) {
    throw new Error('Failed acceptance evidence must contain a failed capability or assertion.');
  }
}

function visualCombinationKey(target, viewport, stateName) {
  const viewportId = typeof viewport === 'string' ? viewport : viewport?.id;
  if (target?.kind === 'surface') {
    return 'surface|' + target.surfaceId + '|' + target.featurePack + '|' + viewportId + '|' + stateName;
  }
  if (target?.kind === 'domain-route') {
    return 'domain-route|' + target.routeId + '|' + target.resource + '|' + viewportId + '|' + stateName;
  }
  if (target?.kind === 'shell') {
    return 'shell|' + target.surfaceId + '|' + viewportId + '|' + stateName;
  }
  return 'invalid|' + viewportId + '|' + stateName;
}

function expectedVisualCombinations(state) {
  const visualTargets = state.resolved.acceptance?.visualTargets;
  if (!Array.isArray(visualTargets)) {
    throw new Error('The validated brief has no resolved visual targets.');
  }
  const viewportDefinitions = state.resolved.acceptance?.visualViewports;
  if (!Array.isArray(viewportDefinitions)) {
    throw new Error('The validated brief has no resolved viewport definitions.');
  }
  const viewportById = new Map(viewportDefinitions.map((viewport) => [viewport.id, viewport]));
  const combinations = new Map();
  for (const visual of visualTargets) {
    for (const viewportId of visual.viewports) {
      const viewport = viewportById.get(viewportId);
      if (!viewport) {
        throw new Error('The validated visual target references an unknown viewport ' + viewportId + '.');
      }
      for (const stateName of visual.states) {
        const key = visualCombinationKey(visual.target, viewport, stateName);
        combinations.set(key, {
          target: visual.target,
          viewport,
          state: stateName
        });
      }
    }
  }
  return combinations;
}

function validateVisualEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Visual machine evidence');
  if (document.schemaVersion !== 1 || document.kind !== MACHINE_EVIDENCE_KINDS.get('screenshot')) {
    throw new Error('Visual machine evidence has the wrong schemaVersion or kind.');
  }
  if (!Array.isArray(document.results) || document.results.length === 0) {
    throw new Error('Visual machine evidence must contain target results.');
  }
  const expected = expectedVisualCombinations(state);
  const seen = new Set();
  const seenReferences = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      ['target', 'viewport', 'state', 'passed', 'screenshotRef', 'interactionRef'],
      'Visual machine result'
    );
    const key = visualCombinationKey(result.target, result.viewport, result.state);
    const expectedResult = expected.get(key);
    if (!expectedResult || seen.has(key)) {
      throw new Error('Visual machine evidence has an unexpected or duplicate target/view/state result.');
    }
    seen.add(key);
    if (
      !isDeepStrictEqual(result.target, expectedResult.target) ||
      !isDeepStrictEqual(result.viewport, expectedResult.viewport) ||
      typeof result.passed !== 'boolean'
    ) {
      throw new Error('Visual machine evidence result does not match the validated target.');
    }
    if (requirePass && result.passed !== true) {
      throw new Error('Visual machine evidence contains a failed result.');
    }
    if (!result.passed) {
      observedFailure = true;
    }
    for (const pair of [
      ['screenshot', result.screenshotRef],
      ['interaction', result.interactionRef]
    ]) {
      const referenceKey = pair[0] + ':' + pair[1];
      if (!seenReferences.has(referenceKey)) {
        seenReferences.add(referenceKey);
        evidence.references.push(
          attestOutcomeReference(pair[1], pair[0], state.inputs.workspace.path)
        );
      }
    }
  }
  if (requirePass && !setEquals(Array.from(seen), Array.from(expected.keys()))) {
    throw new Error('Visual machine evidence does not cover every target, viewport, and state.');
  }
  if (!requirePass && !observedFailure) {
    throw new Error('Failed visual evidence must contain a failed target result.');
  }
}

function validateMachineEvidence(evidence, stageName, state, requirePass) {
  if (!MACHINE_EVIDENCE_KINDS.has(evidence.type)) {
    return;
  }
  if (stageName !== 'live' && stageName !== 'visual' && stageName !== 'acceptance') {
    throw new Error('Machine evidence type ' + evidence.type + ' is attached to the wrong stage.');
  }
  const document = readJson(evidence.path, 'Machine evidence');
  if (evidence.type === 'evaluator') {
    validateAcceptanceEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'screenshot') {
    validateVisualEvidence(document, evidence, state, requirePass);
  } else {
    validateLiveEvidence(document, evidence, state, requirePass);
  }
}

function validateMachineEvidenceSet(evidenceEntries, stageName, state, requirePass) {
  for (const evidence of evidenceEntries) {
    validateMachineEvidence(evidence, stageName, state, requirePass);
  }
}

export function initializeJournal(validationPathInput, statePathInput) {
  requireValue(validationPathInput, '--validation');
  requireValue(statePathInput, '--state');
  const validationPath = path.resolve(validationPathInput);
  const statePath = path.resolve(statePathInput);
  assertRegularContainedFile(validationPath, '', 'Validation report');
  const validation = readJson(validationPath, 'Validation report');
  const workspace = verifyValidationReport(validation, validationPath);
  if (!isWithin(workspace.path, statePath)) {
    throw new Error('The run-state path must stay inside the validated workspace.');
  }
  ensureSafeWorkspaceDirectory(workspace.path, path.dirname(statePath), '.constructive/harness');
  return withJournalLock(statePath, () => {
    if (fs.existsSync(statePath)) {
      throw new Error('Refusing to overwrite existing run state: ' + statePath);
    }
    const timestamp = now();
    const stages = {};
    for (const stageName of STAGES) {
      stages[stageName] = initialStage();
    }
    const state = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      kind: JOURNAL_KIND,
      revision: 0,
      validation: {
        path: validationPath,
        sha256: sha256File(validationPath)
      },
      inputs: {
        brief: validation.inputs.brief,
        tenant: validation.inputs.tenant,
        catalog: validation.inputs.catalog,
        blocksSource: validation.inputs.blocksSource,
        installPlans: validation.inputs.installPlans,
        immutableFiles: validation.inputs.immutableFiles,
        workspace
      },
      resolved: validation.resolved,
      startedAt: timestamp,
      invalidations: [],
      stages
    };
    writeJsonAtomic(statePath, state);
    return state;
  }, workspace.path);
}

export function startJournalStage(state, stageName) {
  assertStage(stageName);
  assertPriorStagesPassed(state, stageName);
  const stage = state.stages[stageName];
  const derived = deriveStage(state, stageName);
  if (derived.status === 'passed') {
    throw new Error('Stage ' + stageName + ' already passed; invalidate it explicitly or start a new journal.');
  }
  if (derived.status === 'running') {
    throw new Error('Stage ' + stageName + ' already has a running attempt.');
  }
  const timestamp = now();
  stage.attempts.push({
    number: stage.attempts.length + 1,
    events: [
      {
        kind: 'started',
        at: timestamp,
        workspaceBeforeSha256: computeWorkspaceAttestation(state.inputs.workspace.path).sha256
      }
    ]
  });
  incrementRevision(state);
}

export function passJournalStage(state, stageName, evidenceReferences) {
  assertStage(stageName);
  const stage = state.stages[stageName];
  const attempt = currentAttempt(stage);
  const derived = deriveStage(state, stageName);
  if (derived.status !== 'running' || !attempt) {
    throw new Error('Stage ' + stageName + ' must have a running attempt before it can pass.');
  }
  const evidence = attestEvidence(evidenceReferences, stageName, state.inputs.workspace.path, true);
  validateMachineEvidenceSet(evidence, stageName, state, true);
  const workspace = computeWorkspaceAttestation(state.inputs.workspace.path);
  const timestamp = now();
  attempt.events.push({
    kind: 'passed',
    at: timestamp,
    evidence,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  });
  incrementRevision(state);
}

export function failJournalStage(state, stageName, reason, evidenceReferences) {
  assertStage(stageName);
  requireValue(reason, '--reason');
  const stage = state.stages[stageName];
  const attempt = currentAttempt(stage);
  const derived = deriveStage(state, stageName);
  if (derived.status !== 'running' || !attempt) {
    throw new Error('Stage ' + stageName + ' must have a running attempt before it can fail.');
  }
  const evidence = attestEvidence(evidenceReferences, stageName, state.inputs.workspace.path, false);
  validateMachineEvidenceSet(evidence, stageName, state, false);
  const workspace = computeWorkspaceAttestation(state.inputs.workspace.path);
  const timestamp = now();
  attempt.events.push({
    kind: 'failed',
    at: timestamp,
    evidence,
    reason,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  });
  incrementRevision(state);
}

export function invalidateJournalStages(state, stageName, reason) {
  assertStage(stageName);
  requireValue(reason, '--reason');
  if (stageName === 'brief') {
    throw new Error('A changed brief or validation report requires a new journal.');
  }
  const firstIndex = STAGES.indexOf(stageName);
  if (deriveStage(state, stageName).status === 'pending') {
    throw new Error('Stage ' + stageName + ' is already pending.');
  }
  const timestamp = now();
  const workspace = computeWorkspaceAttestation(state.inputs.workspace.path);
  const affected = [];
  for (let index = firstIndex; index < STAGES.length; index += 1) {
    const currentName = STAGES[index];
    const stage = state.stages[currentName];
    const derived = deriveStage(state, currentName);
    if (derived.status === 'pending') {
      continue;
    }
    affected.push({
      stage: currentName,
      priorStatus: derived.status,
      attemptCount: stage.attempts.length
    });
  }
  state.invalidations.push({
    at: timestamp,
    fromStage: stageName,
    reason,
    affected,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  });
  incrementRevision(state);
}

export function withJournalLock(statePathInput, action, workspacePathInput = '') {
  const statePath = path.resolve(statePathInput);
  const lockPath = statePath + '.lock';
  let workspacePath = workspacePathInput;
  if (!workspacePath && fs.existsSync(statePath)) {
    assertRegularContainedFile(statePath, '', 'Run state');
    const existing = readJson(statePath, 'Run state');
    workspacePath = existing?.inputs?.workspace?.path || '';
    assertRegularContainedFile(statePath, workspacePath, 'Run state');
  }
  if (!workspacePath) {
    throw new Error('A validated workspace is required before acquiring a journal lock.');
  }
  ensureSafeWorkspaceDirectory(workspacePath, path.dirname(statePath), '.constructive/harness');
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Run state is locked by another writer: ' + lockPath + '. Inspect the recorded PID before removing a stale lock.');
    }
    throw error;
  }
  try {
    const lockRecord = JSON.stringify({
      pid: process.pid,
      createdAt: now(),
      statePath
    }) + '\n';
    fs.writeFileSync(descriptor, lockRecord, 'utf8');
    return action(statePath);
  } finally {
    fs.closeSync(descriptor);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}

export function mutateJournal(statePathInput, operation, options = null) {
  withJournalLock(statePathInput, (statePath) => {
    const state = loadJournal(statePath, options);
    operation(state);
    writeJsonAtomic(statePath, state);
  });
}

export function evidenceTypesForStage(stageName) {
  assertStage(stageName);
  return EVIDENCE_REQUIREMENTS.get(stageName).slice();
}
