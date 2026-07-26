import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import {
  VALIDATION_KIND,
  VALIDATION_SCHEMA_VERSION,
  computeWorkspaceAttestation,
  ensureSafeWorkspaceDirectory,
  isSafeRelativePath,
  sha256File,
  sha256Text,
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
  ['validation', 'constructive.builder-validation'],
  ['tenant-contract', 'constructive.builder-tenant-contract-evidence'],
  ['endpoint-check', 'constructive.builder-endpoint-check-evidence'],
  ['install-plan', 'constructive.builder-install-plan-evidence'],
  ['install-log', 'constructive.builder-install-log-evidence'],
  ['manifest', 'constructive.builder-manifest-evidence'],
  ['package-provenance', 'constructive.builder-package-provenance-evidence'],
  ['blocks-check', 'constructive.builder-blocks-check-evidence'],
  ['source-check', 'constructive.builder-source-check-evidence'],
  ['meta-contract', 'constructive.builder-meta-contract-evidence'],
  ['typecheck', 'constructive.builder-typecheck-evidence'],
  ['build', 'constructive.builder-build-evidence'],
  ['live-session', 'constructive.builder-live-session-evidence'],
  ['graphql', 'constructive.builder-graphql-evidence'],
  ['rls', 'constructive.builder-rls-evidence'],
  ['screenshot', 'constructive.builder-visual-evidence'],
  ['interaction', 'constructive.builder-interaction-evidence'],
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

function journalInputRoot(state) {
  const immutableFiles = Array.isArray(state.inputs?.immutableFiles)
    ? state.inputs.immutableFiles.map((inputFile) => {
      return {
        role: inputFile.role,
        sha256: inputFile.sha256
      };
    })
    : [];
  return sha256Text(JSON.stringify({
    validationSha256: state.validation?.sha256 || null,
    blocksHeadCommit: state.inputs?.blocksSource?.headCommit || null,
    blocksCheckerSha256: state.inputs?.blocksSource?.checkerSha256 || null,
    immutableFiles
  }));
}

function journalPayloadHash(state) {
  const payload = structuredClone(state);
  delete payload.integrity;
  return sha256Text(JSON.stringify(payload));
}

function sealJournal(state) {
  state.integrity = {
    algorithm: 'sha256',
    inputRoot: journalInputRoot(state),
    journalHash: journalPayloadHash(state)
  };
}

function attemptChainSeed(state, stageName, attemptNumber) {
  return sha256Text(journalInputRoot(state) + ':attempt:' + stageName + ':' + attemptNumber);
}

function invalidationChainSeed(state) {
  return sha256Text(journalInputRoot(state) + ':invalidations');
}

function chainedEventHash(event, context) {
  const payload = structuredClone(event);
  delete payload.eventHash;
  return sha256Text(JSON.stringify({
    context,
    event: payload
  }));
}

function chainAttemptEvent(state, stageName, attempt, event) {
  const previousEvent = attempt.events.length > 0
    ? attempt.events[attempt.events.length - 1]
    : null;
  event.previousHash = previousEvent
    ? previousEvent.eventHash
    : attemptChainSeed(state, stageName, attempt.number);
  event.eventHash = chainedEventHash(event, {
    kind: 'attempt',
    stageName,
    attemptNumber: attempt.number,
    eventIndex: attempt.events.length
  });
}

function chainInvalidation(state, invalidation) {
  const previous = state.invalidations.length > 0
    ? state.invalidations[state.invalidations.length - 1]
    : null;
  invalidation.previousHash = previous
    ? previous.eventHash
    : invalidationChainSeed(state);
  invalidation.eventHash = chainedEventHash(invalidation, {
    kind: 'invalidation',
    index: state.invalidations.length
  });
}

function verifyEventChains(state) {
  for (const stageName of STAGES) {
    const stage = state.stages[stageName];
    for (const attempt of stage.attempts) {
      let expectedPrevious = attemptChainSeed(state, stageName, attempt.number);
      for (let eventIndex = 0; eventIndex < attempt.events.length; eventIndex += 1) {
        const event = attempt.events[eventIndex];
        if (event.previousHash !== expectedPrevious) {
          throw new Error('Run state event chain is broken for ' + stageName + ' attempt ' + attempt.number + '.');
        }
        const expectedHash = chainedEventHash(event, {
          kind: 'attempt',
          stageName,
          attemptNumber: attempt.number,
          eventIndex
        });
        if (event.eventHash !== expectedHash) {
          throw new Error('Run state event hash is invalid for ' + stageName + ' attempt ' + attempt.number + '.');
        }
        expectedPrevious = event.eventHash;
      }
    }
  }
  let expectedInvalidationPrevious = invalidationChainSeed(state);
  for (let index = 0; index < state.invalidations.length; index += 1) {
    const invalidation = state.invalidations[index];
    if (invalidation.previousHash !== expectedInvalidationPrevious) {
      throw new Error('Run state invalidation chain is broken.');
    }
    const expectedHash = chainedEventHash(invalidation, {
      kind: 'invalidation',
      index
    });
    if (invalidation.eventHash !== expectedHash) {
      throw new Error('Run state invalidation event hash is invalid.');
    }
    expectedInvalidationPrevious = invalidation.eventHash;
  }
}

function verifyJournalIntegrity(state) {
  exactKeys(state.integrity, ['algorithm', 'inputRoot', 'journalHash'], 'Run state integrity');
  if (state.integrity.algorithm !== 'sha256') {
    throw new Error('Run state integrity algorithm must equal sha256.');
  }
  assertSha256(state.integrity.inputRoot, 'Run state integrity.inputRoot');
  assertSha256(state.integrity.journalHash, 'Run state integrity.journalHash');
  if (state.integrity.inputRoot !== journalInputRoot(state)) {
    throw new Error('Run state integrity is not bound to the immutable validation inputs.');
  }
  if (state.integrity.journalHash !== journalPayloadHash(state)) {
    throw new Error('Run state integrity check failed; the journal was edited outside the harness.');
  }
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
  exactKeys(
    blocksSource,
    ['path', 'headCommit', 'branch', 'checkerPath', 'checkerSha256', 'checkerOutputSha256'],
    'Blocks source attestation'
  );
  const sourcePath = path.resolve(blocksSource.path);
  const head = runGit(sourcePath, ['rev-parse', 'HEAD']);
  if (head !== blocksSource.headCommit) {
    throw new Error('The pinned Blocks source moved after validation; validate again and initialize a new journal.');
  }
  const trackedStatus = runGit(sourcePath, ['status', '--porcelain=v1', '--untracked-files=no']);
  if (trackedStatus) {
    throw new Error('The pinned Blocks source has tracked worktree changes; restore the validated clean commit.');
  }
  const checkerPath = path.resolve(blocksSource.checkerPath);
  if (!fs.existsSync(checkerPath)) {
    throw new Error('The pinned Blocks checker no longer exists.');
  }
  const checkerStats = fs.lstatSync(checkerPath);
  if (!checkerStats.isFile() || checkerStats.isSymbolicLink()) {
    throw new Error('The pinned Blocks checker must remain a regular, non-symlink file.');
  }
  if (sha256File(checkerPath) !== blocksSource.checkerSha256) {
    throw new Error('The pinned Blocks checker bytes changed after validation.');
  }
  const checkerOutput = execFileSync(
    process.execPath,
    [checkerPath, '--blocks-repo', sourcePath, '--source-preflight'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
  if (!blocksSource.checkerOutputSha256 || sha256Text(checkerOutput) !== blocksSource.checkerOutputSha256) {
    throw new Error('The pinned Blocks canonical source preflight output changed after validation.');
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
    ['schemaVersion', 'kind', 'revision', 'validation', 'inputs', 'resolved', 'startedAt', 'invalidations', 'stages', 'integrity'],
    'Run state'
  );
  verifyJournalIntegrity(state);
  verifyEventChains(state);
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
      exactKeys(
        attempt.events[0],
        ['kind', 'at', 'workspaceBeforeSha256', 'previousHash', 'eventHash'],
        'Run state started event'
      );
      assertSha256(attempt.events[0].previousHash, 'Run state started event previousHash');
      assertSha256(attempt.events[0].eventHash, 'Run state started event eventHash');
      assertTimestamp(attempt.events[0].at, 'Run state started event at');
      assertSha256(attempt.events[0].workspaceBeforeSha256, 'Run state started event workspaceBeforeSha256');
      if (attempt.events.length === 2) {
        const terminal = attempt.events[1];
        const terminalKeys = terminal.kind === 'passed'
          ? ['kind', 'at', 'evidence', 'workspace', 'previousHash', 'eventHash']
          : ['kind', 'at', 'evidence', 'reason', 'workspace', 'previousHash', 'eventHash'];
        exactKeys(terminal, terminalKeys, 'Run state terminal event');
        assertSha256(terminal.previousHash, 'Run state terminal event previousHash');
        assertSha256(terminal.eventHash, 'Run state terminal event eventHash');
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
    exactKeys(
      invalidation,
      ['at', 'fromStage', 'reason', 'affected', 'workspace', 'previousHash', 'eventHash'],
      'Run state invalidation'
    );
    assertSha256(invalidation.previousHash, 'Run state invalidation previousHash');
    assertSha256(invalidation.eventHash, 'Run state invalidation eventHash');
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
            if (![
              'request',
              'ui',
              'screenshot',
              'interaction',
              'manifest',
              'package',
              'source',
              'install-output',
              'command-output'
            ].includes(reference.kind)) {
              throw new Error(
                'Retained evidence reference kind is not supported by the exact machine schemas.'
              );
            }
          }
          const replayEvidence = {
            type: evidence.type,
            path: evidence.path,
            sha256: evidence.sha256,
            size: evidence.size,
            references: []
          };
          validateMachineEvidence(replayEvidence, stageName, state, event.kind === 'passed');
          if (!isDeepStrictEqual(replayEvidence.references, evidence.references)) {
            throw new Error('Retained ' + stageName + ' evidence references do not match semantic replay.');
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

function assertMachineHeader(document, evidenceType, label) {
  if (document.schemaVersion !== 1 || document.kind !== MACHINE_EVIDENCE_KINDS.get(evidenceType)) {
    throw new Error(label + ' has the wrong schemaVersion or kind.');
  }
}

function validateCheckResults(checks, label) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error(label + ' checks must be a non-empty array.');
  }
  const ids = new Set();
  let allPassed = true;
  for (const check of checks) {
    exactKeys(check, ['id', 'passed'], label + ' check');
    requireValue(check.id, label + ' check id');
    if (ids.has(check.id)) {
      throw new Error(label + ' checks duplicate ' + check.id + '.');
    }
    ids.add(check.id);
    if (typeof check.passed !== 'boolean') {
      throw new Error(label + ' check passed must be boolean.');
    }
    if (!check.passed) {
      allPassed = false;
    }
  }
  return allPassed;
}

function validateRequestOutcome(document, context) {
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'endpointKind', 'operation', 'statusCode', 'checks', 'passed'],
    'Request outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-request-outcome') {
    throw new Error('Request outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.endpointKind, 'Request outcome endpointKind');
  requireValue(document.operation, 'Request outcome operation');
  if (
    !Number.isInteger(document.statusCode) ||
    (document.statusCode !== 0 && (document.statusCode < 100 || document.statusCode > 599))
  ) {
    throw new Error('Request outcome statusCode must be 0 or a valid HTTP status code.');
  }
  const allPassed = validateCheckResults(document.checks, 'Request outcome');
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('Request outcome passed must equal all request checks.');
  }
  if (document.passed && (document.statusCode < 200 || document.statusCode > 299)) {
    throw new Error('A passing request outcome requires a 2xx statusCode.');
  }
  if (context?.endpointKind && document.endpointKind !== context.endpointKind) {
    throw new Error('Request outcome endpointKind does not match the evidence result.');
  }
  if (typeof context?.passed === 'boolean' && document.passed !== context.passed) {
    throw new Error('Request outcome passed does not match the evidence result.');
  }
}

function validateUiOutcome(document, context) {
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'state', 'visible', 'interactive', 'checks', 'passed'],
    'UI outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-ui-outcome') {
    throw new Error('UI outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.state, 'UI outcome state');
  if (typeof document.visible !== 'boolean' || typeof document.interactive !== 'boolean') {
    throw new Error('UI outcome visible and interactive must be boolean.');
  }
  const allPassed = validateCheckResults(document.checks, 'UI outcome');
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('UI outcome passed must equal all UI checks.');
  }
  if (document.passed && !document.visible) {
    throw new Error('A passing UI outcome must be visible.');
  }
  if (typeof context?.passed === 'boolean' && document.passed !== context.passed) {
    throw new Error('UI outcome passed does not match the evidence result.');
  }
}

function validateInteractionOutcome(document, context) {
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'targetKey', 'viewportId', 'state', 'checks', 'passed'],
    'Interaction outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-interaction-outcome') {
    throw new Error('Interaction outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.targetKey, 'Interaction outcome targetKey');
  requireValue(document.viewportId, 'Interaction outcome viewportId');
  requireValue(document.state, 'Interaction outcome state');
  const allPassed = validateCheckResults(document.checks, 'Interaction outcome');
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('Interaction outcome passed must equal all interaction checks.');
  }
  if (context) {
    if (
      document.targetKey !== context.targetKey ||
      document.viewportId !== context.viewportId ||
      document.state !== context.state
    ) {
      throw new Error('Interaction outcome does not match its visual target, viewport, and state.');
    }
    if (typeof context.passed === 'boolean' && document.passed !== context.passed) {
      throw new Error('Interaction outcome passed does not match the visual result.');
    }
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseCompletePng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error('Screenshot must be a complete PNG image.');
  }
  let offset = 8;
  let ihdr = null;
  const idatChunks = [];
  let ended = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error('Screenshot PNG ends inside a chunk.');
    }
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      throw new Error('Screenshot PNG has a truncated chunk.');
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const crcInput = Buffer.concat([typeBytes, data]);
    if (crc32(crcInput) !== expectedCrc) {
      throw new Error('Screenshot PNG has an invalid ' + type + ' chunk checksum.');
    }
    if (chunkIndex === 0 && type !== 'IHDR') {
      throw new Error('Screenshot PNG must begin with IHDR.');
    }
    if (type === 'IHDR') {
      if (ihdr || length !== 13 || chunkIndex !== 0) {
        throw new Error('Screenshot PNG must contain one 13-byte leading IHDR chunk.');
      }
      ihdr = Buffer.from(data);
    } else if (type === 'IDAT') {
      if (!ihdr || ended || length === 0) {
        throw new Error('Screenshot PNG must contain non-empty IDAT data after IHDR.');
      }
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      if (length !== 0 || idatChunks.length === 0 || chunkEnd !== bytes.length) {
        throw new Error('Screenshot PNG must end with one terminal IEND after image data.');
      }
      ended = true;
    } else if (ended) {
      throw new Error('Screenshot PNG contains data after IEND.');
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (!ihdr || !ended || idatChunks.length === 0) {
    throw new Error('Screenshot PNG must contain IHDR, non-empty IDAT, and terminal IEND chunks.');
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (width < 1 || height < 1 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) {
    throw new Error('Screenshot PNG must use valid dimensions and non-interlaced standard compression and filtering.');
  }
  const channelCounts = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
  const allowedBitDepths = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);
  const channels = channelCounts.get(colorType);
  if (!channels || !allowedBitDepths.get(colorType).includes(bitDepth)) {
    throw new Error('Screenshot PNG uses an unsupported color type or bit depth.');
  }
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedInflatedSize = (rowBytes + 1) * height;
  let scanlines;
  try {
    scanlines = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedInflatedSize });
  } catch (error) {
    throw new Error('Screenshot PNG IDAT data cannot be inflated to its declared pixel dimensions: ' + error.message);
  }
  if (scanlines.length !== expectedInflatedSize) {
    throw new Error('Screenshot PNG scanline bytes do not match its declared pixel dimensions.');
  }
  for (let row = 0; row < height; row += 1) {
    if (scanlines[row * (rowBytes + 1)] > 4) {
      throw new Error('Screenshot PNG contains an invalid scanline filter.');
    }
  }
  return { width, height };
}

function validateScreenshotArtifact(artifactPath, context) {
  const bytes = fs.readFileSync(artifactPath);
  const dimensions = parseCompletePng(bytes);
  if (!context?.viewport) {
    throw new Error('Screenshot validation requires a resolved viewport.');
  }
  const expectedWidth = Math.round(context.viewport.width * context.viewport.deviceScaleFactor);
  const expectedHeight = Math.round(context.viewport.height * context.viewport.deviceScaleFactor);
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    throw new Error(
      'Screenshot dimensions ' + dimensions.width + 'x' + dimensions.height +
      ' do not match viewport pixels ' + expectedWidth + 'x' + expectedHeight + '.'
    );
  }
}

function attestOutcomeReference(relativePath, kind, workspacePath, context = null) {
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
  if (kind === 'request') {
    validateRequestOutcome(readJson(artifactPath, 'Request outcome artifact'), context);
  } else if (kind === 'ui') {
    validateUiOutcome(readJson(artifactPath, 'UI outcome artifact'), context);
  } else if (kind === 'interaction') {
    validateInteractionOutcome(readJson(artifactPath, 'Interaction outcome artifact'), context);
  } else if (kind === 'screenshot') {
    validateScreenshotArtifact(artifactPath, context);
  } else {
    throw new Error('Unsupported machine evidence outcome reference kind ' + kind + '.');
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
    evidence.references.push(
      attestOutcomeReference(pair[1], pair[0], workspacePath, { passed: assertion.passed })
    );
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
        const referenceContext = pair[0] === 'screenshot'
          ? { viewport: expectedResult.viewport }
          : {
            targetKey: visualCombinationKey(result.target, result.viewport, result.state),
            viewportId: result.viewport.id,
            state: result.state,
            passed: result.passed
          };
        evidence.references.push(
          attestOutcomeReference(pair[1], pair[0], state.inputs.workspace.path, referenceContext)
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

function validateResultPassState(passed, requirePass, label) {
  if (typeof passed !== 'boolean') {
    throw new Error(label + ' passed must be boolean.');
  }
  if (requirePass && !passed) {
    throw new Error(label + ' failed during a passing stage transition.');
  }
  return !passed;
}

function requireObservedFailure(observedFailure, requirePass, label) {
  if (!requirePass && !observedFailure) {
    throw new Error('Failed ' + label + ' evidence must contain a failed result.');
  }
}

function validateValidationEvidence(document, evidence, state, requirePass) {
  if (!requirePass) {
    throw new Error('A journal can only attach its passing validation report to the brief stage.');
  }
  if (evidence.sha256 !== state.validation.sha256 || !isDeepStrictEqual(document, readJson(state.validation.path, 'Validation report'))) {
    throw new Error('Brief validation evidence must exactly equal the immutable validation report.');
  }
}

function expectedTenantContracts(state) {
  const contracts = [];
  const primary = state.resolved.tenantContract;
  if (!primary || primary.id !== state.resolved.tenantId || !Array.isArray(primary.endpointKinds)) {
    throw new Error('The validated brief has no resolved primary tenant contract.');
  }
  contracts.push({
    tenantId: primary.id,
    role: 'primary',
    endpointKinds: primary.endpointKinds,
    requireCsrfForAuth: primary.requireCsrfForAuth
  });
  const isolationTenants = state.resolved.acceptance?.isolationTenants;
  if (Array.isArray(isolationTenants)) {
    for (const isolation of isolationTenants) {
      contracts.push({
        tenantId: isolation.databaseId,
        role: 'isolation',
        endpointKinds: isolation.endpointKinds,
        requireCsrfForAuth: isolation.requireCsrfForAuth
      });
    }
  }
  return contracts;
}

function validateTenantContractEvidence(document, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'tenants'], 'Tenant contract evidence');
  assertMachineHeader(document, 'tenant-contract', 'Tenant contract evidence');
  if (!Array.isArray(document.tenants)) {
    throw new Error('Tenant contract evidence tenants must be an array.');
  }
  const expected = expectedTenantContracts(state);
  if (document.tenants.length !== expected.length) {
    throw new Error('Tenant contract evidence must cover every primary and isolation descriptor.');
  }
  let observedFailure = false;
  for (let index = 0; index < expected.length; index += 1) {
    const result = document.tenants[index];
    const expectedResult = expected[index];
    exactKeys(
      result,
      ['tenantId', 'role', 'endpointKinds', 'requireCsrfForAuth', 'passed'],
      'Tenant contract result'
    );
    if (
      result.tenantId !== expectedResult.tenantId ||
      result.role !== expectedResult.role ||
      !Array.isArray(result.endpointKinds) ||
      !setEquals(result.endpointKinds, expectedResult.endpointKinds) ||
      result.requireCsrfForAuth !== expectedResult.requireCsrfForAuth
    ) {
      throw new Error('Tenant contract result does not match the resolved descriptor contract.');
    }
    if (validateResultPassState(result.passed, requirePass, 'Tenant contract result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'tenant-contract');
}

function expectedEndpointChecks(state) {
  const expected = [];
  for (const tenant of expectedTenantContracts(state)) {
    for (const endpointKind of tenant.endpointKinds) {
      expected.push({
        tenantId: tenant.tenantId,
        endpointKind
      });
    }
  }
  return expected;
}

function validateEndpointCheckEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Endpoint check evidence');
  assertMachineHeader(document, 'endpoint-check', 'Endpoint check evidence');
  if (!Array.isArray(document.results)) {
    throw new Error('Endpoint check evidence results must be an array.');
  }
  const expected = expectedEndpointChecks(state);
  if (document.results.length !== expected.length) {
    throw new Error('Endpoint check evidence must cover every declared semantic endpoint.');
  }
  const expectedKeys = new Set(expected.map((result) => result.tenantId + ':' + result.endpointKind));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      ['tenantId', 'endpointKind', 'statusCode', 'passed', 'requestRef'],
      'Endpoint check result'
    );
    const key = result.tenantId + ':' + result.endpointKind;
    if (!expectedKeys.has(key) || seen.has(key)) {
      throw new Error('Endpoint check evidence has an unexpected or duplicate endpoint ' + key + '.');
    }
    seen.add(key);
    if (!Number.isInteger(result.statusCode)) {
      throw new Error('Endpoint check statusCode must be an integer.');
    }
    if (validateResultPassState(result.passed, requirePass, 'Endpoint check result')) {
      observedFailure = true;
    }
    const reference = attestOutcomeReference(
      result.requestRef,
      'request',
      state.inputs.workspace.path,
      { endpointKind: result.endpointKind, passed: result.passed }
    );
    const requestDocument = readJson(reference.path, 'Endpoint request outcome');
    if (requestDocument.statusCode !== result.statusCode) {
      throw new Error('Endpoint check statusCode does not match its request outcome artifact.');
    }
    evidence.references.push(reference);
  }
  requireObservedFailure(observedFailure, requirePass, 'endpoint-check');
}

function installPlanContracts(state) {
  if (!Array.isArray(state.inputs.installPlans)) {
    throw new Error('The validated inputs have no install plan attestations.');
  }
  if (state.inputs.installPlans.length !== state.resolved.installRoots.length) {
    throw new Error('The validated install plans must exactly cover every selected install root.');
  }
  const expectedRoots = new Set(state.resolved.installRoots);
  const seen = new Set();
  const contracts = [];
  for (const attestation of state.inputs.installPlans) {
    if (!expectedRoots.has(attestation.root) || seen.has(attestation.root)) {
      throw new Error('The validated install plans contain an unexpected or duplicate root.');
    }
    seen.add(attestation.root);
    const plan = readJson(attestation.path, 'Attested compact install plan');
    if (
      plan.schemaVersion !== 1 ||
      plan.kind !== 'constructive.console-kit-install-plan' ||
      plan.item !== attestation.root ||
      !plan.install ||
      typeof plan.install.command !== 'string' ||
      plan.install.command.trim().length === 0 ||
      !plan.composition ||
      !Array.isArray(plan.composition.npmDependencies)
    ) {
      throw new Error('Attested compact install plan has an invalid executable contract for ' + attestation.root + '.');
    }
    const packageNames = [];
    for (const dependency of plan.composition.npmDependencies) {
      if (!dependency || typeof dependency.name !== 'string' || dependency.name.trim().length === 0) {
        throw new Error('Attested compact install plan has an invalid npm dependency for ' + attestation.root + '.');
      }
      packageNames.push(dependency.name);
    }
    contracts.push({
      root: attestation.root,
      sha256: attestation.sha256,
      command: plan.install.command,
      packageNames
    });
  }
  return contracts;
}

function validateInstallPlanEvidence(document, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'plans'], 'Install plan evidence');
  assertMachineHeader(document, 'install-plan', 'Install plan evidence');
  if (!Array.isArray(document.plans)) {
    throw new Error('Install plan evidence plans must be an array.');
  }
  const expected = installPlanContracts(state);
  if (document.plans.length !== expected.length) {
    throw new Error('Install plan evidence must cover every selected root.');
  }
  let observedFailure = false;
  for (let index = 0; index < expected.length; index += 1) {
    const result = document.plans[index];
    exactKeys(result, ['root', 'sha256', 'passed'], 'Install plan result');
    if (result.root !== expected[index].root || result.sha256 !== expected[index].sha256) {
      throw new Error('Install plan result does not match the attested compact plan.');
    }
    assertSha256(result.sha256, 'Install plan result sha256');
    if (validateResultPassState(result.passed, requirePass, 'Install plan result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'install-plan');
}

function validateInstallLogEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Install log evidence');
  assertMachineHeader(document, 'install-log', 'Install log evidence');
  const planContracts = installPlanContracts(state);
  if (!Array.isArray(document.results) || document.results.length !== planContracts.length) {
    throw new Error('Install log evidence must cover every selected root.');
  }
  const expectedByRoot = new Map(planContracts.map((contract) => [contract.root, contract]));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      ['root', 'command', 'exitCode', 'outputRef', 'outputSha256', 'passed'],
      'Install log result'
    );
    const expected = expectedByRoot.get(result.root);
    if (!expected || seen.has(result.root)) {
      throw new Error('Install log evidence has an unexpected or duplicate root ' + String(result.root) + '.');
    }
    seen.add(result.root);
    if (result.command !== expected.command) {
      throw new Error('Install log command does not match the attested compact plan for ' + result.root + '.');
    }
    if (!Number.isInteger(result.exitCode)) {
      throw new Error('Install log exitCode must be an integer.');
    }
    if (result.passed !== (result.exitCode === 0)) {
      throw new Error('Install log passed must equal exitCode === 0.');
    }
    if (validateResultPassState(result.passed, requirePass, 'Install log result')) {
      observedFailure = true;
    }
    evidence.references.push(
      attestDeclaredWorkspaceFile(
        result.outputRef,
        result.outputSha256,
        state.inputs.workspace.path,
        'install-output',
        'Install command output'
      )
    );
  }
  requireObservedFailure(observedFailure, requirePass, 'install-log');
}

function attestDeclaredWorkspaceFile(relativePath, declaredSha256, workspacePath, kind, label) {
  if (!isSafeRelativePath(relativePath) || relativePath === '.') {
    throw new Error(label + ' path must be a safe workspace-relative file.');
  }
  const absolutePath = path.resolve(workspacePath, relativePath);
  const record = {
    kind,
    path: absolutePath,
    sha256: declaredSha256,
    size: 0
  };
  if (!fs.existsSync(absolutePath)) {
    throw new Error(label + ' does not exist: ' + relativePath + '.');
  }
  const stats = fs.lstatSync(absolutePath);
  record.size = stats.size;
  verifyArtifactRecord(record, workspacePath, label, ['kind', 'path', 'sha256', 'size']);
  return record;
}

function expectedSurfacePacks(state) {
  const expected = [];
  for (const surface of state.resolved.surfaces) {
    for (const featurePack of surface.featurePacks) {
      expected.push({
        surfaceId: surface.id,
        featurePack
      });
    }
  }
  return expected;
}

function validateInstalledManifest(document, featurePack, label) {
  if (!document || document.schemaVersion !== 1 || document.id !== featurePack) {
    throw new Error(label + ' must be a schemaVersion 1 manifest for ' + featurePack + '.');
  }
  if (!document.capabilities || !Array.isArray(document.capabilities.required)) {
    throw new Error(label + ' has no required capability list.');
  }
}

function validateManifestEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Manifest evidence');
  assertMachineHeader(document, 'manifest', 'Manifest evidence');
  if (!Array.isArray(document.results)) {
    throw new Error('Manifest evidence results must be an array.');
  }
  const expected = expectedSurfacePacks(state);
  if (document.results.length !== expected.length) {
    throw new Error('Manifest evidence must cover every installed surface feature pack.');
  }
  const expectedKeys = new Set(expected.map((result) => result.surfaceId + ':' + result.featurePack));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      ['surfaceId', 'featurePack', 'manifestRef', 'sha256', 'passed'],
      'Manifest result'
    );
    const key = result.surfaceId + ':' + result.featurePack;
    if (!expectedKeys.has(key) || seen.has(key)) {
      throw new Error('Manifest evidence has an unexpected or duplicate surface feature pack ' + key + '.');
    }
    seen.add(key);
    const reference = attestDeclaredWorkspaceFile(
      result.manifestRef,
      result.sha256,
      state.inputs.workspace.path,
      'manifest',
      'Installed feature-pack manifest'
    );
    validateInstalledManifest(readJson(reference.path, 'Installed feature-pack manifest'), result.featurePack, 'Installed feature-pack manifest');
    evidence.references.push(reference);
    if (validateResultPassState(result.passed, requirePass, 'Manifest result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'manifest');
}

function validatePackageProvenanceEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'packages'], 'Package provenance evidence');
  assertMachineHeader(document, 'package-provenance', 'Package provenance evidence');
  const expectedNames = new Set();
  for (const plan of installPlanContracts(state)) {
    for (const packageName of plan.packageNames) {
      expectedNames.add(packageName);
    }
  }
  if (!Array.isArray(document.packages) || document.packages.length !== expectedNames.size) {
    throw new Error('Package provenance evidence must exactly cover every attested npm dependency.');
  }
  const names = new Set();
  let observedFailure = false;
  for (const result of document.packages) {
    exactKeys(
      result,
      ['name', 'resolvedRef', 'sha256', 'sourceCommit', 'passed'],
      'Package provenance result'
    );
    requireValue(result.name, 'Package provenance name');
    if (!expectedNames.has(result.name) || names.has(result.name)) {
      throw new Error('Package provenance evidence has an unexpected or duplicate package ' + result.name + '.');
    }
    names.add(result.name);
    const expectedSourceCommit = state.inputs.blocksSource ? state.inputs.blocksSource.headCommit : null;
    if (result.sourceCommit !== expectedSourceCommit) {
      throw new Error('Package provenance sourceCommit does not match the pinned Blocks source.');
    }
    const reference = attestDeclaredWorkspaceFile(
      result.resolvedRef,
      result.sha256,
      state.inputs.workspace.path,
      'package',
      'Resolved package provenance file'
    );
    evidence.references.push(reference);
    if (validateResultPassState(result.passed, requirePass, 'Package provenance result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'package-provenance');
}

function runFullBlocksCheck(blocksSource) {
  if (!blocksSource) {
    return null;
  }
  return execFileSync(
    process.execPath,
    [blocksSource.checkerPath, '--blocks-repo', blocksSource.path],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

function validateBlocksCheckEvidence(document, state, requirePass) {
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'headCommit', 'checkerSha256', 'outputSha256', 'passed'],
    'Blocks check evidence'
  );
  assertMachineHeader(document, 'blocks-check', 'Blocks check evidence');
  if (!state.inputs.blocksSource) {
    if (document.headCommit !== null || document.checkerSha256 !== null || document.outputSha256 !== null) {
      throw new Error('Blocks check evidence must use null source fields when no branch-only source is resolved.');
    }
  } else {
    if (
      document.headCommit !== state.inputs.blocksSource.headCommit ||
      document.checkerSha256 !== state.inputs.blocksSource.checkerSha256
    ) {
      throw new Error('Blocks check evidence does not match the pinned source and checker bytes.');
    }
    const output = runFullBlocksCheck(state.inputs.blocksSource);
    if (document.outputSha256 !== sha256Text(output)) {
      throw new Error('Blocks check evidence does not match a full checker run without --source-preflight.');
    }
  }
  if (document.passed !== true) {
    throw new Error('Blocks check passed must be true because the canonical full checker completed successfully.');
  }
  const observedFailure = validateResultPassState(document.passed, requirePass, 'Blocks check result');
  requireObservedFailure(observedFailure, requirePass, 'blocks-check');
}

function validateSourceCheckEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Source check evidence');
  assertMachineHeader(document, 'source-check', 'Source check evidence');
  if (!Array.isArray(document.results) || document.results.length !== state.resolved.domainRoutes.length) {
    throw new Error('Source check evidence must cover every application-owned domain route.');
  }
  const expectedRoutes = new Set(state.resolved.domainRoutes.map((route) => route.id));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(result, ['routeId', 'sourceRef', 'sha256', 'passed'], 'Source check result');
    if (!expectedRoutes.has(result.routeId) || seen.has(result.routeId)) {
      throw new Error('Source check evidence has an unexpected or duplicate route ' + String(result.routeId) + '.');
    }
    seen.add(result.routeId);
    const reference = attestDeclaredWorkspaceFile(
      result.sourceRef,
      result.sha256,
      state.inputs.workspace.path,
      'source',
      'Domain route source'
    );
    evidence.references.push(reference);
    if (validateResultPassState(result.passed, requirePass, 'Source check result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'source-check');
}

function validateMetaContractEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Meta contract evidence');
  assertMachineHeader(document, 'meta-contract', 'Meta contract evidence');
  if (!Array.isArray(document.results) || document.results.length !== state.resolved.domainRoutes.length) {
    throw new Error('Meta contract evidence must cover every application-owned domain route.');
  }
  const expectedRoutes = new Map(state.resolved.domainRoutes.map((route) => [route.id, route]));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      [
        'routeId',
        'resource',
        'endpointKind',
        'contractVersion',
        'metaPassed',
        'introspectionPassed',
        'reconciled',
        'requestRef',
        'passed'
      ],
      'Meta contract result'
    );
    const route = expectedRoutes.get(result.routeId);
    if (!route || seen.has(result.routeId) || result.resource !== route.resource) {
      throw new Error('Meta contract evidence has an unexpected or duplicate route.');
    }
    seen.add(result.routeId);
    if (result.endpointKind !== 'data' || result.contractVersion !== state.resolved.metaContractVersion) {
      throw new Error('Meta contract evidence does not use the resolved data contract version.');
    }
    if (
      typeof result.metaPassed !== 'boolean' ||
      typeof result.introspectionPassed !== 'boolean' ||
      typeof result.reconciled !== 'boolean' ||
      result.passed !== (result.metaPassed && result.introspectionPassed && result.reconciled)
    ) {
      throw new Error('Meta contract passed must equal metadata, introspection, and reconciliation results.');
    }
    if (validateResultPassState(result.passed, requirePass, 'Meta contract result')) {
      observedFailure = true;
    }
    evidence.references.push(
      attestOutcomeReference(
        result.requestRef,
        'request',
        state.inputs.workspace.path,
        { endpointKind: 'data', passed: result.passed }
      )
    );
  }
  requireObservedFailure(observedFailure, requirePass, 'meta-contract');
}

function validateCommandEvidence(document, evidence, state, evidenceType, requirePass) {
  const label = evidenceType === 'typecheck' ? 'Typecheck evidence' : 'Build evidence';
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'command', 'exitCode', 'outputRef', 'outputSha256', 'passed'],
    label
  );
  assertMachineHeader(document, evidenceType, label);
  requireValue(document.command, label + ' command');
  if (!Number.isInteger(document.exitCode)) {
    throw new Error(label + ' exitCode must be an integer.');
  }
  assertSha256(document.outputSha256, label + ' outputSha256');
  evidence.references.push(
    attestDeclaredWorkspaceFile(
      document.outputRef,
      document.outputSha256,
      state.inputs.workspace.path,
      'command-output',
      label + ' output'
    )
  );
  if (document.passed !== (document.exitCode === 0)) {
    throw new Error(label + ' passed must equal exitCode === 0.');
  }
  const observedFailure = validateResultPassState(document.passed, requirePass, label);
  requireObservedFailure(observedFailure, requirePass, evidenceType);
}

function validateInteractionEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Interaction evidence');
  assertMachineHeader(document, 'interaction', 'Interaction evidence');
  if (!Array.isArray(document.results)) {
    throw new Error('Interaction evidence results must be an array.');
  }
  const expected = expectedVisualCombinations(state);
  if (document.results.length !== expected.size) {
    throw new Error('Interaction evidence must cover every visual target, viewport, and state.');
  }
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(
      result,
      ['target', 'viewport', 'state', 'passed', 'artifactRef'],
      'Interaction evidence result'
    );
    const key = visualCombinationKey(result.target, result.viewport, result.state);
    const expectedResult = expected.get(key);
    if (
      !expectedResult ||
      seen.has(key) ||
      !isDeepStrictEqual(result.target, expectedResult.target) ||
      !isDeepStrictEqual(result.viewport, expectedResult.viewport)
    ) {
      throw new Error('Interaction evidence has an unexpected or duplicate visual result.');
    }
    seen.add(key);
    if (validateResultPassState(result.passed, requirePass, 'Interaction evidence result')) {
      observedFailure = true;
    }
    evidence.references.push(
      attestOutcomeReference(
        result.artifactRef,
        'interaction',
        state.inputs.workspace.path,
        {
          targetKey: key,
          viewportId: result.viewport.id,
          state: result.state,
          passed: result.passed
        }
      )
    );
  }
  requireObservedFailure(observedFailure, requirePass, 'interaction');
}

function validateMachineEvidence(evidence, stageName, state, requirePass) {
  const document = readJson(evidence.path, 'Machine evidence');
  if (!MACHINE_EVIDENCE_KINDS.has(evidence.type)) {
    throw new Error('Evidence type ' + evidence.type + ' has no exact machine schema.');
  }
  if (evidence.type === 'validation') {
    validateValidationEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'tenant-contract') {
    validateTenantContractEvidence(document, state, requirePass);
  } else if (evidence.type === 'endpoint-check') {
    validateEndpointCheckEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'install-plan') {
    validateInstallPlanEvidence(document, state, requirePass);
  } else if (evidence.type === 'install-log') {
    validateInstallLogEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'manifest') {
    validateManifestEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'package-provenance') {
    validatePackageProvenanceEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'blocks-check') {
    validateBlocksCheckEvidence(document, state, requirePass);
  } else if (evidence.type === 'source-check') {
    validateSourceCheckEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'meta-contract') {
    validateMetaContractEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'typecheck' || evidence.type === 'build') {
    validateCommandEvidence(document, evidence, state, evidence.type, requirePass);
  } else if (evidence.type === 'evaluator') {
    validateAcceptanceEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'screenshot') {
    validateVisualEvidence(document, evidence, state, requirePass);
  } else if (evidence.type === 'interaction') {
    validateInteractionEvidence(document, evidence, state, requirePass);
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
    sealJournal(state);
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
  const attempt = {
    number: stage.attempts.length + 1,
    events: []
  };
  const event = {
    kind: 'started',
    at: timestamp,
    workspaceBeforeSha256: computeWorkspaceAttestation(state.inputs.workspace.path).sha256
  };
  chainAttemptEvent(state, stageName, attempt, event);
  attempt.events.push(event);
  stage.attempts.push(attempt);
  incrementRevision(state);
  sealJournal(state);
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
  const event = {
    kind: 'passed',
    at: timestamp,
    evidence,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  };
  chainAttemptEvent(state, stageName, attempt, event);
  attempt.events.push(event);
  incrementRevision(state);
  sealJournal(state);
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
  const event = {
    kind: 'failed',
    at: timestamp,
    evidence,
    reason,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  };
  chainAttemptEvent(state, stageName, attempt, event);
  attempt.events.push(event);
  incrementRevision(state);
  sealJournal(state);
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
  const invalidation = {
    at: timestamp,
    fromStage: stageName,
    reason,
    affected,
    workspace: {
      sha256: workspace.sha256,
      fileCount: workspace.fileCount,
      gitHead: workspace.gitHead
    }
  };
  chainInvalidation(state, invalidation);
  state.invalidations.push(invalidation);
  incrementRevision(state);
  sealJournal(state);
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
    sealJournal(state);
    writeJsonAtomic(statePath, state);
  });
}

export function evidenceTypesForStage(stageName) {
  assertStage(stageName);
  return EVIDENCE_REQUIREMENTS.get(stageName).slice();
}
