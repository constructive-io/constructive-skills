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

export const JOURNAL_SCHEMA_VERSION = 3;
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
  const trackedStatus = runGit(sourcePath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (trackedStatus) {
    throw new Error('The pinned Blocks source has tracked or untracked-unignored changes; restore the validated clean commit.');
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

function verifyGlobalTransitionHistory(state) {
  const records = [];
  for (const stageName of STAGES) {
    for (const attempt of state.stages[stageName].attempts) {
      for (const event of attempt.events) {
        records.push({
          sequence: event.sequence,
          type: 'stage-event',
          stageName,
          attemptNumber: attempt.number,
          event
        });
      }
    }
  }
  for (const invalidation of state.invalidations) {
    records.push({
      sequence: invalidation.sequence,
      type: 'invalidation',
      invalidation
    });
  }
  records.sort((left, right) => left.sequence - right.sequence);
  if (records.length !== state.revision) {
    throw new Error('Run state revision must equal the complete global transition count.');
  }
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].sequence !== index + 1) {
      throw new Error('Run state transition sequences must be unique and contiguous from 1.');
    }
  }

  const statuses = new Map(STAGES.map((stageName) => [stageName, 'pending']));
  const attemptCounts = new Map(STAGES.map((stageName) => [stageName, 0]));
  const activeAttempts = new Map(STAGES.map((stageName) => [stageName, null]));
  let workspaceBaselineSha256 = state.inputs.workspace.sha256;
  for (const record of records) {
    if (record.type === 'stage-event') {
      const stageIndex = STAGES.indexOf(record.stageName);
      if (record.event.kind === 'started') {
        const expectedAttempt = attemptCounts.get(record.stageName) + 1;
        if (record.attemptNumber !== expectedAttempt) {
          throw new Error('Run state global history has a non-contiguous ' + record.stageName + ' attempt.');
        }
        const currentStatus = statuses.get(record.stageName);
        if (currentStatus === 'passed' || currentStatus === 'running') {
          throw new Error('Run state global history starts ' + record.stageName + ' from status ' + currentStatus + '.');
        }
        for (let priorIndex = 0; priorIndex < stageIndex; priorIndex += 1) {
          const priorStage = STAGES[priorIndex];
          if (statuses.get(priorStage) !== 'passed') {
            throw new Error('Run state global history starts ' + record.stageName + ' before ' + priorStage + ' passes.');
          }
        }
        if (record.event.workspaceBeforeSha256 !== workspaceBaselineSha256) {
          throw new Error('Run state started event does not match the replayed workspace baseline.');
        }
        attemptCounts.set(record.stageName, expectedAttempt);
        activeAttempts.set(record.stageName, record.attemptNumber);
        statuses.set(record.stageName, 'running');
        continue;
      }
      if (
        statuses.get(record.stageName) !== 'running' ||
        activeAttempts.get(record.stageName) !== record.attemptNumber
      ) {
        throw new Error('Run state global history terminates a non-running ' + record.stageName + ' attempt.');
      }
      activeAttempts.set(record.stageName, null);
      statuses.set(record.stageName, record.event.kind);
      workspaceBaselineSha256 = record.event.workspace.sha256;
      continue;
    }

    const invalidation = record.invalidation;
    const firstIndex = STAGES.indexOf(invalidation.fromStage);
    if (Array.from(statuses.values()).includes('running')) {
      throw new Error('Run state global history invalidates while a stage is running.');
    }
    if (invalidation.fromStage === 'brief' || statuses.get(invalidation.fromStage) === 'pending') {
      throw new Error('Run state global history contains an invalid invalidation origin.');
    }
    const expectedAffected = [];
    for (let index = firstIndex; index < STAGES.length; index += 1) {
      const stageName = STAGES[index];
      const priorStatus = statuses.get(stageName);
      if (priorStatus === 'pending') {
        continue;
      }
      expectedAffected.push({
        stage: stageName,
        priorStatus,
        attemptCount: attemptCounts.get(stageName)
      });
    }
    if (!isDeepStrictEqual(invalidation.affected, expectedAffected)) {
      throw new Error('Run state invalidation affected set does not match global history.');
    }
    for (const affected of expectedAffected) {
      statuses.set(affected.stage, 'pending');
      activeAttempts.set(affected.stage, null);
    }
    workspaceBaselineSha256 = invalidation.workspace.sha256;
  }

  for (const stageName of STAGES) {
    if (deriveStage(state, stageName).status !== statuses.get(stageName)) {
      throw new Error('Run state derived status disagrees with global transition history for ' + stageName + '.');
    }
  }
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
        ['kind', 'sequence', 'at', 'workspaceBeforeSha256', 'previousHash', 'eventHash'],
        'Run state started event'
      );
      if (!Number.isInteger(attempt.events[0].sequence) || attempt.events[0].sequence < 1) {
        throw new Error('Run state started event sequence must be a positive integer.');
      }
      assertSha256(attempt.events[0].previousHash, 'Run state started event previousHash');
      assertSha256(attempt.events[0].eventHash, 'Run state started event eventHash');
      assertTimestamp(attempt.events[0].at, 'Run state started event at');
      assertSha256(attempt.events[0].workspaceBeforeSha256, 'Run state started event workspaceBeforeSha256');
      if (attempt.events.length === 2) {
        const terminal = attempt.events[1];
        const terminalKeys = terminal.kind === 'passed'
          ? ['kind', 'sequence', 'at', 'evidence', 'workspace', 'previousHash', 'eventHash']
          : ['kind', 'sequence', 'at', 'evidence', 'reason', 'workspace', 'previousHash', 'eventHash'];
        exactKeys(terminal, terminalKeys, 'Run state terminal event');
        if (!Number.isInteger(terminal.sequence) || terminal.sequence < 1) {
          throw new Error('Run state terminal event sequence must be a positive integer.');
        }
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
      ['sequence', 'at', 'fromStage', 'reason', 'affected', 'workspace', 'previousHash', 'eventHash'],
      'Run state invalidation'
    );
    if (!Number.isInteger(invalidation.sequence) || invalidation.sequence < 1) {
      throw new Error('Run state invalidation sequence must be a positive integer.');
    }
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
  verifyGlobalTransitionHistory(state);
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
        const retainedTypes = new Set();
        const replayPairs = [];
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
          if (retainedTypes.has(evidence.type)) {
            throw new Error('Retained ' + stageName + ' evidence contains duplicate type ' + evidence.type + '.');
          }
          retainedTypes.add(evidence.type);
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
              'package-artifact',
              'package-lock',
              'source',
              'installed-file',
              'install-config',
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
          replayPairs.push({ retained: evidence, replay: replayEvidence });
        }
        validateMachineEvidenceSet(
          replayPairs.map((pair) => pair.replay),
          stageName,
          state,
          event.kind === 'passed'
        );
        for (const pair of replayPairs) {
          if (!isDeepStrictEqual(pair.replay.references, pair.retained.references)) {
            throw new Error('Retained ' + stageName + ' evidence references do not match semantic replay.');
          }
        }
        if (event.kind === 'passed') {
          if (retainedTypes.size !== allowedTypes.size) {
            throw new Error('Retained passing ' + stageName + ' evidence does not contain every required type.');
          }
          for (const requiredType of allowedTypes) {
            if (!retainedTypes.has(requiredType)) {
              throw new Error('Retained passing ' + stageName + ' evidence is missing required type ' + requiredType + '.');
            }
          }
        } else if (retainedTypes.size === 0) {
          throw new Error('Retained failed ' + stageName + ' evidence must contain at least one typed artifact.');
        }
      }
    }
  }
}

function latestTerminalWorkspace(state) {
  let latestSequence = 0;
  let latestWorkspace = state.inputs.workspace;
  for (const stageName of STAGES) {
    for (const attempt of state.stages[stageName].attempts) {
      for (const event of attempt.events) {
        if ((event.kind === 'passed' || event.kind === 'failed') && event.workspace) {
          if (event.sequence > latestSequence) {
            latestSequence = event.sequence;
            latestWorkspace = event.workspace;
          }
        }
      }
    }
  }
  for (const invalidation of state.invalidations) {
    if (invalidation.workspace && invalidation.sequence > latestSequence) {
      latestSequence = invalidation.sequence;
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
    latestEventAt: event.at,
    latestSequence: event.sequence
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
  if (invalidation && invalidation.sequence > derivedAttempt.latestSequence) {
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

function nextTransitionSequence(state) {
  return state.revision + 1;
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

function validateCheckResults(checks, label, expectedCheckId = null) {
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
  if (
    expectedCheckId !== null &&
    (checks.length !== 1 || checks[0].id !== expectedCheckId)
  ) {
    throw new Error(label + ' checks must contain the exact contextual check ' + expectedCheckId + '.');
  }
  return allPassed;
}

function validateRequestOutcome(document, context) {
  exactKeys(
    document,
    [
      'schemaVersion',
      'kind',
      'contextKey',
      'endpointKind',
      'operation',
      'statusCode',
      'checks',
      'passed'
    ],
    'Request outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-request-outcome') {
    throw new Error('Request outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.contextKey, 'Request outcome contextKey');
  requireValue(document.endpointKind, 'Request outcome endpointKind');
  requireValue(document.operation, 'Request outcome operation');
  if (
    !Number.isInteger(document.statusCode) ||
    (document.statusCode !== 0 && (document.statusCode < 100 || document.statusCode > 599))
  ) {
    throw new Error('Request outcome statusCode must be 0 or a valid HTTP status code.');
  }
  const allPassed = validateCheckResults(
    document.checks,
    'Request outcome',
    context?.checkId || null
  );
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('Request outcome passed must equal all request checks.');
  }
  if (document.passed && (document.statusCode < 200 || document.statusCode > 299)) {
    throw new Error('A passing request outcome requires a 2xx statusCode.');
  }
  if (context?.endpointKind && document.endpointKind !== context.endpointKind) {
    throw new Error('Request outcome endpointKind does not match the evidence result.');
  }
  if (context?.contextKey && document.contextKey !== context.contextKey) {
    throw new Error('Request outcome contextKey does not match the evidence result.');
  }
  if (context?.operation && document.operation !== context.operation) {
    throw new Error('Request outcome operation does not match the evidence result.');
  }
  if (typeof context?.passed === 'boolean' && document.passed !== context.passed) {
    throw new Error('Request outcome passed does not match the evidence result.');
  }
}

function validateUiOutcome(document, context) {
  exactKeys(
    document,
    [
      'schemaVersion',
      'kind',
      'contextKey',
      'state',
      'visible',
      'interactive',
      'checks',
      'passed'
    ],
    'UI outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-ui-outcome') {
    throw new Error('UI outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.contextKey, 'UI outcome contextKey');
  requireValue(document.state, 'UI outcome state');
  if (typeof document.visible !== 'boolean' || typeof document.interactive !== 'boolean') {
    throw new Error('UI outcome visible and interactive must be boolean.');
  }
  const allPassed = validateCheckResults(
    document.checks,
    'UI outcome',
    context?.checkId || null
  );
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('UI outcome passed must equal all UI checks.');
  }
  if (document.passed && !document.visible) {
    throw new Error('A passing UI outcome must be visible.');
  }
  if (context?.contextKey && document.contextKey !== context.contextKey) {
    throw new Error('UI outcome contextKey does not match the evidence result.');
  }
  if (context?.state && document.state !== context.state) {
    throw new Error('UI outcome state does not match the evidence result.');
  }
  if (typeof context?.passed === 'boolean' && document.passed !== context.passed) {
    throw new Error('UI outcome passed does not match the evidence result.');
  }
}

function expectedInteractionCheckIds(context) {
  if (!context?.viewport) {
    throw new Error('Interaction outcome validation requires the resolved viewport.');
  }
  const ids = [
    'keyboard-traversal',
    'focus-visibility',
    'overflow-containment',
    'diagnostics-containment'
  ];
  if (context.viewport.width <= 767) {
    ids.push('responsive-navigation', 'touch-targets');
  }
  if (context.state === 'error') {
    ids.push('retry-recovery');
  }
  if (context.state === 'ready' || context.state === 'populated') {
    ids.push('action-feedback');
  }
  return ids;
}

function validateInteractionOutcome(document, context) {
  exactKeys(
    document,
    [
      'schemaVersion',
      'kind',
      'targetKey',
      'viewportId',
      'state',
      'contextCheck',
      'checks',
      'passed'
    ],
    'Interaction outcome artifact'
  );
  if (document.schemaVersion !== 1 || document.kind !== 'constructive.builder-interaction-outcome') {
    throw new Error('Interaction outcome artifact has the wrong schemaVersion or kind.');
  }
  requireValue(document.targetKey, 'Interaction outcome targetKey');
  requireValue(document.viewportId, 'Interaction outcome viewportId');
  requireValue(document.state, 'Interaction outcome state');
  exactKeys(document.contextCheck, ['id', 'passed'], 'Interaction outcome context check');
  if (
    document.contextCheck.id !== context?.checkId ||
    document.contextCheck.passed !== true
  ) {
    throw new Error('Interaction outcome must contain its passing exact contextual check.');
  }
  const expectedCheckIds = expectedInteractionCheckIds(context);
  if (!Array.isArray(document.checks) || document.checks.length !== expectedCheckIds.length) {
    throw new Error('Interaction outcome must contain every required behavior check exactly once.');
  }
  let allPassed = true;
  for (let index = 0; index < expectedCheckIds.length; index += 1) {
    const check = document.checks[index];
    exactKeys(check, ['id', 'passed'], 'Interaction outcome behavior check');
    if (check.id !== expectedCheckIds[index]) {
      throw new Error(
        'Interaction outcome behavior checks must exactly equal: ' +
        expectedCheckIds.join(', ') + '.'
      );
    }
    if (typeof check.passed !== 'boolean') {
      throw new Error('Interaction outcome behavior check passed must be boolean.');
    }
    if (!check.passed) {
      allPassed = false;
    }
  }
  if (typeof document.passed !== 'boolean' || document.passed !== allPassed) {
    throw new Error('Interaction outcome passed must equal all behavior checks.');
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

function parseCompletePng(bytes, expectedWidth, expectedHeight) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error('Screenshot must be a complete PNG image.');
  }
  let offset = 8;
  let ihdr = null;
  const idatChunks = [];
  let palette = null;
  let idatEnded = false;
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
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) {
      throw new Error('Screenshot PNG contains an invalid chunk type.');
    }
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
    } else if (type === 'PLTE') {
      if (
        !ihdr ||
        palette ||
        idatChunks.length > 0 ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        throw new Error('Screenshot PNG contains an invalid PLTE chunk.');
      }
      palette = Buffer.from(data);
    } else if (type === 'IDAT') {
      if (!ihdr || ended || idatEnded || length === 0) {
        throw new Error('Screenshot PNG must contain non-empty IDAT data after IHDR.');
      }
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      if (length !== 0 || idatChunks.length === 0 || chunkEnd !== bytes.length) {
        throw new Error('Screenshot PNG must end with one terminal IEND after image data.');
      }
      ended = true;
    } else {
      if (ended) {
        throw new Error('Screenshot PNG contains data after IEND.');
      }
      if (type[0] === type[0].toUpperCase()) {
        throw new Error('Screenshot PNG contains an unsupported critical chunk ' + type + '.');
      }
    }
    if (idatChunks.length > 0 && type !== 'IDAT') {
      idatEnded = true;
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
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      'Screenshot dimensions ' + width + 'x' + height +
      ' do not match viewport pixels ' + expectedWidth + 'x' + expectedHeight + '.'
    );
  }
  const channelCounts = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
  const allowedBitDepths = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);
  const channels = channelCounts.get(colorType);
  if (!channels || !allowedBitDepths.get(colorType).includes(bitDepth)) {
    throw new Error('Screenshot PNG uses an unsupported color type or bit depth.');
  }
  if (colorType === 3 && !palette) {
    throw new Error('Indexed-color screenshot PNG requires a PLTE chunk.');
  }
  if ((colorType === 0 || colorType === 4) && palette) {
    throw new Error('Grayscale screenshot PNG cannot contain a PLTE chunk.');
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
  if (!context?.viewport) {
    throw new Error('Screenshot validation requires a resolved viewport.');
  }
  const expectedWidth = Math.round(context.viewport.width * context.viewport.deviceScaleFactor);
  const expectedHeight = Math.round(context.viewport.height * context.viewport.deviceScaleFactor);
  const bytes = fs.readFileSync(artifactPath);
  parseCompletePng(bytes, expectedWidth, expectedHeight);
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

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function scenarioOutcomeContext(scenario, assertion, state) {
  const actorIds = scenario.actorIds.slice();
  const actorById = new Map(
    state.resolved.acceptance.actors.map((actor) => [actor.id, actor])
  );
  const tenantIds = uniqueValues(actorIds.map((actorId) => {
    return actorById.get(actorId)?.tenantScope?.databaseId || state.resolved.tenantId;
  }));
  let endpointKind = assertion.contract?.endpointKind || null;
  if (!endpointKind && (scenario.kind === 'crud' || scenario.kind === 'rls')) {
    endpointKind = 'data';
  }
  if (!endpointKind && scenario.kind === 'auth') {
    endpointKind = 'auth';
  }
  if (!endpointKind && Array.isArray(scenario.assertionContracts)) {
    const routed = scenario.assertionContracts.find((entry) => {
      return typeof entry?.contract?.endpointKind === 'string';
    });
    endpointKind = routed?.contract?.endpointKind || null;
  }
  if (!endpointKind) {
    endpointKind = 'host';
  }
  let uiState = 'ready';
  if (assertion.id.includes(':unavailable')) {
    uiState = 'unavailable';
  } else if (assertion.id.includes(':deny') || assertion.id.includes('revoked')) {
    uiState = 'unauthorized';
  }
  return {
    contextKey: [
      'scenario',
      scenario.id,
      assertion.id,
      actorIds.join(','),
      tenantIds.join(',')
    ].join('|'),
    endpointKind,
    operation: assertion.id,
    state: uiState,
    checkId: assertion.id,
    passed: assertion.passed
  };
}

function addOutcomeReferences(assertion, evidence, workspacePath, seenReferences, context) {
  for (const pair of [
    ['request', assertion.requestRef],
    ['ui', assertion.uiRef]
  ]) {
    const key = pair[0] + ':' + pair[1];
    const reference = attestOutcomeReference(pair[1], pair[0], workspacePath, context);
    if (!seenReferences.has(key)) {
      seenReferences.add(key);
      evidence.references.push(reference);
    }
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
      addOutcomeReferences(
        assertion,
        evidence,
        state.inputs.workspace.path,
        seenReferences,
        scenarioOutcomeContext(scenario, assertion, state)
      );
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
    const capabilityEndpointKinds = Array.isArray(expected.binding?.routes)
      ? uniqueValues(expected.binding.routes.map((route) => route.endpointKind))
      : [];
    addOutcomeReferences(
      capability,
      evidence,
      state.inputs.workspace.path,
      seenReferences,
      {
        contextKey: [
          'capability',
          capability.surfaceId,
          capability.featurePack,
          capability.expected,
          capability.actual
        ].join('|'),
        endpointKind: capabilityEndpointKinds.length === 1
          ? capabilityEndpointKinds[0]
          : 'host',
        operation: 'capability-state',
        state: capability.actual,
        checkId: 'capability:' + capability.surfaceId + ':' + capability.featurePack,
        passed: capability.passed
      }
    );
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
      addOutcomeReferences(
        requirement,
        evidence,
        state.inputs.workspace.path,
        seenReferences,
        {
          contextKey: ['limitation', limitation.id, requirement.id].join('|'),
          endpointKind: 'host',
          operation: 'mitigation',
          state: requirement.passed ? 'ready' : 'error',
          checkId: 'limitation:' + limitation.id + ':' + requirement.id,
          passed: requirement.passed
        }
      );
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
  const screenshotPaths = new Set();
  const interactionPaths = new Set();
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
    if (screenshotPaths.has(result.screenshotRef)) {
      throw new Error('Visual machine evidence reuses a screenshot across contextual results.');
    }
    if (interactionPaths.has(result.interactionRef)) {
      throw new Error('Visual machine evidence reuses an interaction outcome across contextual results.');
    }
    screenshotPaths.add(result.screenshotRef);
    interactionPaths.add(result.interactionRef);
    for (const pair of [
      ['screenshot', result.screenshotRef],
      ['interaction', result.interactionRef]
    ]) {
      const referenceContext = pair[0] === 'screenshot'
        ? { viewport: expectedResult.viewport }
        : {
          targetKey: visualCombinationKey(result.target, result.viewport, result.state),
          viewportId: result.viewport.id,
          viewport: expectedResult.viewport,
          state: result.state,
          passed: result.passed,
          checkId: 'interaction:' + key
        };
      evidence.references.push(
        attestOutcomeReference(pair[1], pair[0], state.inputs.workspace.path, referenceContext)
      );
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

function catalogContract(state) {
  return readJson(state.inputs.catalog, 'Pinned Blocks catalog');
}

function renderContractCommand(template, replacements) {
  let command = template;
  for (const replacement of replacements) {
    command = command.split(replacement.token).join(replacement.value);
  }
  return command;
}

function localConsumptionContract(state) {
  if (!state.inputs.blocksSource) {
    return null;
  }
  const catalog = catalogContract(state);
  const local = catalog.release?.localConsumption;
  if (
    !local ||
    !Array.isArray(local.prepareCommands) ||
    typeof local.localInstallCommandTemplate !== 'string'
  ) {
    throw new Error('The pinned Blocks catalog has no executable local-consumption contract.');
  }
  const replacements = [
    { token: '<blocks-repo>', value: state.inputs.blocksSource.path },
    { token: '<consumer-repo>', value: state.inputs.workspace.path }
  ];
  return {
    prepareCommands: local.prepareCommands.map((command) => {
      return renderContractCommand(command, replacements);
    }),
    installCommandTemplate: renderContractCommand(
      local.localInstallCommandTemplate,
      replacements
    )
  };
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
      {
        contextKey: ['endpoint', result.tenantId, result.endpointKind].join('|'),
        endpointKind: result.endpointKind,
        operation: 'endpoint-check',
        checkId: 'endpoint:' + result.tenantId + ':' + result.endpointKind,
        passed: result.passed
      }
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
      !Array.isArray(plan.composition.npmDependencies) ||
      !Array.isArray(plan.composition.files) ||
      !Array.isArray(plan.featurePacks) ||
      !plan.verify ||
      !Array.isArray(plan.verify.commands) ||
      plan.verify.commands.length !== 2
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
    const files = [];
    for (const file of plan.composition.files) {
      if (
        !file ||
        typeof file.target !== 'string' ||
        file.target.trim().length === 0 ||
        !['literal', 'project-root', 'shadcn-alias'].includes(file.targetKind) ||
        typeof file.type !== 'string' ||
        file.type.trim().length === 0 ||
        !Array.isArray(file.sources) ||
        file.sources.length !== 1
      ) {
        throw new Error('Attested compact install plan has an invalid file target for ' + attestation.root + '.');
      }
      const source = file.sources[0];
      if (
        !source ||
        typeof source.registryItem !== 'string' ||
        !/^[a-z0-9][a-z0-9-]*$/.test(source.registryItem) ||
        typeof source.path !== 'string' ||
        !isSafeRelativePath(source.path) ||
        source.path === '.'
      ) {
        throw new Error(
          'Attested compact install plan has invalid registry source provenance for ' +
          attestation.root + '/' + file.target + '.'
        );
      }
      files.push({
        target: file.target,
        targetKind: file.targetKind,
        type: file.type,
        sources: [{ registryItem: source.registryItem, path: source.path }]
      });
    }
    contracts.push({
      root: attestation.root,
      sha256: attestation.sha256,
      command: plan.install.command,
      packageNames,
      files,
      featurePacks: structuredClone(plan.featurePacks),
      verifyCommands: plan.verify.commands.slice()
    });
  }
  const local = localConsumptionContract(state);
  for (const contract of contracts) {
    if (local) {
      contract.command = local.installCommandTemplate.split('{name}').join(contract.root);
    }
  }
  return contracts;
}

function stripJsonComments(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      result += '\n';
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        if (source[index] === '\n') {
          result += '\n';
        }
        index += 1;
      }
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function stripJsonTrailingCommas(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] || '')) {
        lookahead += 1;
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue;
      }
    }
    result += character;
  }
  return result;
}

function readJsonc(filePath, label) {
  assertRegularContainedFile(filePath, '', label);
  try {
    return JSON.parse(stripJsonTrailingCommas(stripJsonComments(fs.readFileSync(filePath, 'utf8'))));
  } catch (error) {
    throw new Error(label + ' is not valid JSONC: ' + error.message);
  }
}

function safeNormalizedRelativePath(value, label) {
  if (!isSafeRelativePath(value) || value === '.') {
    throw new Error(label + ' must be a safe workspace-relative file.');
  }
  const normalized = path.posix.normalize(value).replace(/^\.\//, '');
  if (!isSafeRelativePath(normalized) || normalized === '.') {
    throw new Error(label + ' must resolve to a safe workspace-relative file.');
  }
  return normalized;
}

function assertNoSymlinkPath(workspacePath, relativePath, label) {
  let current = workspacePath;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(label + ' must not use a symlinked path component.');
    }
  }
}

function resolveTypeScriptAlias(importTarget, workspacePath, referencePaths, evidence) {
  const configNames = ['tsconfig.json', 'jsconfig.json'];
  let configRef = null;
  for (const candidate of configNames) {
    if (fs.existsSync(path.join(workspacePath, candidate))) {
      configRef = candidate;
      break;
    }
  }
  if (!configRef) {
    throw new Error('A shadcn alias target requires tsconfig.json or jsconfig.json.');
  }
  const configPath = path.join(workspacePath, configRef);
  const config = readJsonc(configPath, 'Consumer TypeScript path config');
  const paths = config?.compilerOptions?.paths;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new Error('Consumer TypeScript path config must declare compilerOptions.paths.');
  }
  const matches = [];
  for (const pattern of Object.keys(paths)) {
    const starIndex = pattern.indexOf('*');
    const prefix = starIndex === -1 ? pattern : pattern.slice(0, starIndex);
    const suffix = starIndex === -1 ? '' : pattern.slice(starIndex + 1);
    if (
      !importTarget.startsWith(prefix) ||
      !importTarget.endsWith(suffix) ||
      (starIndex === -1 && importTarget !== pattern)
    ) {
      continue;
    }
    const capture = starIndex === -1
      ? ''
      : importTarget.slice(prefix.length, importTarget.length - suffix.length);
    matches.push({ pattern, capture, specificity: prefix.length + suffix.length });
  }
  matches.sort((left, right) => right.specificity - left.specificity);
  const match = matches[0];
  const targets = match ? paths[match.pattern] : null;
  if (!match || !Array.isArray(targets) || targets.length === 0) {
    throw new Error('No TypeScript path mapping resolves shadcn alias target ' + importTarget + '.');
  }
  const targetPattern = targets[0];
  if (typeof targetPattern !== 'string' || targetPattern.trim().length === 0) {
    throw new Error('TypeScript path mapping for ' + match.pattern + ' has no usable target.');
  }
  const mappedTarget = targetPattern.includes('*')
    ? targetPattern.split('*').join(match.capture)
    : targetPattern;
  const baseUrl = config.compilerOptions.baseUrl || '.';
  const resolved = safeNormalizedRelativePath(
    path.posix.join(baseUrl, mappedTarget),
    'TypeScript path mapping'
  );
  if (!referencePaths.has(configRef)) {
    referencePaths.add(configRef);
    evidence.references.push(
      attestDeclaredWorkspaceFile(
        configRef,
        sha256File(configPath),
        workspacePath,
        'install-config',
        'Consumer TypeScript path config'
      )
    );
  }
  return resolved;
}

function resolvePlannedConsumerTarget(file, state, referencePaths, evidence) {
  if (file.targetKind === 'literal') {
    return safeNormalizedRelativePath(file.target, 'Literal install target');
  }
  if (file.targetKind === 'project-root') {
    if (!file.target.startsWith('~/')) {
      throw new Error('Project-root install target must start with ~/.');
    }
    return safeNormalizedRelativePath(file.target.slice(2), 'Project-root install target');
  }
  const match = /^@([^/]+)\/(.+)$/.exec(file.target);
  if (!match) {
    throw new Error('Shadcn alias install target must use @alias/path syntax.');
  }
  const componentsRef = 'components.json';
  const componentsPath = path.join(state.inputs.workspace.path, componentsRef);
  const components = readJson(componentsPath, 'Consumer components.json');
  if (
    components?.style !== 'base-nova' ||
    (components?.iconLibrary !== undefined && components.iconLibrary !== 'lucide') ||
    components?.tsx !== true
  ) {
    throw new Error(
      'Consumer components.json must use style base-nova, Lucide semantics, and tsx true.'
    );
  }
  const aliasValue = components?.aliases?.[match[1]];
  if (typeof aliasValue !== 'string' || aliasValue.trim().length === 0) {
    throw new Error('Consumer components.json has no alias for @' + match[1] + '.');
  }
  if (!referencePaths.has(componentsRef)) {
    referencePaths.add(componentsRef);
    evidence.references.push(
      attestDeclaredWorkspaceFile(
        componentsRef,
        sha256File(componentsPath),
        state.inputs.workspace.path,
        'install-config',
        'Consumer components.json'
      )
    );
  }
  const importTarget = path.posix.join(aliasValue, match[2]);
  if (!aliasValue.startsWith('@') && !path.posix.isAbsolute(aliasValue)) {
    return safeNormalizedRelativePath(importTarget, 'Shadcn alias install target');
  }
  return resolveTypeScriptAlias(
    importTarget,
    state.inputs.workspace.path,
    referencePaths,
    evidence
  );
}

const CANONICAL_SHADCN_ALIASES = {
  components: '@/components',
  utils: '@/lib/utils',
  ui: '@/components/ui',
  lib: '@/lib',
  hooks: '@/hooks'
};

function aliasEntries(aliases, label) {
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new Error(label + ' must define the complete shadcn aliases object.');
  }
  const entries = [];
  const values = new Set();
  for (const key of Object.keys(CANONICAL_SHADCN_ALIASES)) {
    const value = aliases[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(label + ' must define alias ' + key + '.');
    }
    if (values.has(value)) {
      throw new Error(label + ' must not map different aliases to the same path.');
    }
    values.add(value);
    entries.push({ key, value });
  }
  entries.sort((left, right) => right.value.length - left.value.length);
  return entries;
}

function normalizeAliasLiteral(value, entries) {
  for (const entry of entries) {
    if (value === entry.value || value.startsWith(entry.value + '/')) {
      return '<constructive-shadcn-alias:' + entry.key + '>' + value.slice(entry.value.length);
    }
  }
  return value;
}

function normalizeCodeAliases(source, aliases, label) {
  const entries = aliasEntries(aliases, label);
  let normalized = '';
  let index = 0;
  while (index < source.length) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"') {
      normalized += quote;
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let escaped = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        break;
      }
      cursor += 1;
    }
    if (cursor >= source.length) {
      normalized += source.slice(index);
      break;
    }
    const value = source.slice(index + 1, cursor);
    normalized += quote + normalizeAliasLiteral(value, entries) + quote;
    index = cursor + 1;
  }
  return normalized;
}

export function assertInstalledRegistryContent(
  installedPath,
  sourceContent,
  sourcePath,
  consumerComponents
) {
  if (typeof sourceContent !== 'string') {
    throw new Error('Generated registry source content must be a string.');
  }
  const extension = path.posix.extname(sourcePath);
  const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const installedContent = fs.readFileSync(installedPath, 'utf8');
  let expected = sourceContent;
  let actual = installedContent;
  if (codeExtensions.has(extension)) {
    expected = normalizeCodeAliases(
      sourceContent,
      CANONICAL_SHADCN_ALIASES,
      'Canonical Blocks shadcn aliases'
    );
    actual = normalizeCodeAliases(
      installedContent,
      consumerComponents?.aliases,
      'Consumer components.json aliases'
    );
  }
  if (actual !== expected) {
    throw new Error(
      'Installed consumer file does not match its generated registry source after deterministic alias rewriting: ' +
      sourcePath + '.'
    );
  }
}

function registrySourceContract(state) {
  if (!state.inputs.blocksSource) {
    return null;
  }
  const registryPath = path.join(
    state.inputs.blocksSource.path,
    'apps',
    'registry',
    'registry.json'
  );
  assertRegularContainedFile(
    registryPath,
    state.inputs.blocksSource.path,
    'Pinned aggregate registry'
  );
  const registry = readJson(registryPath, 'Pinned aggregate registry');
  if (!Array.isArray(registry?.items)) {
    throw new Error('Pinned aggregate registry has no item collection.');
  }
  const catalog = catalogContract(state);
  const contentAttestation = catalog.source?.attestations?.registryContent;
  if (
    !contentAttestation ||
    contentAttestation.path !== 'references/registry-content.v1.json' ||
    typeof contentAttestation.sha256 !== 'string'
  ) {
    throw new Error('Pinned Blocks catalog has no exact registry content attestation.');
  }
  const skillRoot = path.dirname(path.dirname(path.resolve(state.inputs.catalog)));
  const contentSnapshotPath = path.resolve(skillRoot, contentAttestation.path);
  if (!isWithin(skillRoot, contentSnapshotPath)) {
    throw new Error('Pinned registry content attestation escapes the Blocks skill.');
  }
  assertRegularContainedFile(
    contentSnapshotPath,
    skillRoot,
    'Pinned registry content attestation'
  );
  if (sha256File(contentSnapshotPath) !== contentAttestation.sha256) {
    throw new Error('Pinned registry content attestation hash drifted.');
  }
  const contentSnapshot = readJson(
    contentSnapshotPath,
    'Pinned registry content attestation'
  );
  if (
    contentSnapshot?.schemaVersion !== 1 ||
    contentSnapshot?.kind !== 'constructive.blocks-registry-content' ||
    contentSnapshot.sourceCommit !== state.inputs.blocksSource.headCommit ||
    !Array.isArray(contentSnapshot.records) ||
    contentSnapshot.recordCount !== contentSnapshot.records.length
  ) {
    throw new Error('Pinned registry content attestation has an invalid source contract.');
  }
  const contentBySource = new Map();
  for (const record of contentSnapshot.records) {
    if (
      !record ||
      typeof record.registryItem !== 'string' ||
      typeof record.path !== 'string' ||
      typeof record.type !== 'string' ||
      typeof record.contentSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(record.contentSha256)
    ) {
      throw new Error('Pinned registry content attestation contains an invalid record.');
    }
    const key = record.registryItem + '\0' + record.path;
    if (contentBySource.has(key)) {
      throw new Error('Pinned registry content attestation contains a duplicate source.');
    }
    contentBySource.set(key, record);
  }
  return {
    registry,
    contentBySource,
    publicItems: new Map()
  };
}

function generatedRegistrySource(file, state, contract) {
  if (!contract) {
    return null;
  }
  const source = file.sources[0];
  const item = contract.registry.items.find((candidate) => candidate?.name === source.registryItem);
  const aggregateMatches = Array.isArray(item?.files)
    ? item.files.filter((candidate) => candidate?.path === source.path)
    : [];
  if (aggregateMatches.length !== 1 || aggregateMatches[0].type !== file.type) {
    throw new Error(
      'Pinned aggregate registry does not contain the exact planned source ' +
      source.registryItem + '/' + source.path + '.'
    );
  }
  const contentRecord = contract.contentBySource.get(source.registryItem + '\0' + source.path);
  if (!contentRecord || contentRecord.type !== file.type) {
    throw new Error(
      'Pinned registry content attestation does not cover ' +
      source.registryItem + '/' + source.path + '.'
    );
  }
  let publicItem = contract.publicItems.get(source.registryItem);
  if (!publicItem) {
    const publicItemPath = path.join(
      state.inputs.blocksSource.path,
      'apps',
      'registry',
      'public',
      'r',
      source.registryItem + '.json'
    );
    assertRegularContainedFile(
      publicItemPath,
      state.inputs.blocksSource.path,
      'Built registry item ' + source.registryItem
    );
    publicItem = readJson(publicItemPath, 'Built registry item ' + source.registryItem);
    contract.publicItems.set(source.registryItem, publicItem);
  }
  const publicMatches = Array.isArray(publicItem?.files)
    ? publicItem.files.filter((candidate) => candidate?.path === source.path)
    : [];
  if (
    publicItem?.name !== source.registryItem ||
    publicMatches.length !== 1 ||
    publicMatches[0].type !== file.type ||
    typeof publicMatches[0].content !== 'string' ||
    sha256Text(publicMatches[0].content) !== contentRecord.contentSha256
  ) {
    throw new Error(
      'Built registry content does not match its pinned attestation for ' +
      source.registryItem + '/' + source.path + '.'
    );
  }
  return { content: publicMatches[0].content, path: source.path };
}

function attestPlannedConsumerFiles(planContracts, evidence, state) {
  const plannedTargets = new Map();
  for (const plan of planContracts) {
    for (const file of plan.files) {
      const existing = plannedTargets.get(file.target);
      if (
        existing &&
        (
          existing.targetKind !== file.targetKind ||
          existing.type !== file.type ||
          !isDeepStrictEqual(existing.sources, file.sources)
        )
      ) {
        throw new Error('Attested install plans disagree on source provenance for ' + file.target + '.');
      }
      if (!existing) {
        plannedTargets.set(file.target, file);
      }
    }
  }
  const referencePaths = new Set();
  const resolvedTargets = new Map();
  const sourceContract = registrySourceContract(state);
  const consumerComponentsPath = path.join(state.inputs.workspace.path, 'components.json');
  const consumerComponents = fs.existsSync(consumerComponentsPath)
    ? readJson(consumerComponentsPath, 'Consumer components.json')
    : null;
  for (const file of plannedTargets.values()) {
    const resolvedRef = resolvePlannedConsumerTarget(file, state, referencePaths, evidence);
    const existingTarget = resolvedTargets.get(resolvedRef);
    if (existingTarget && existingTarget !== file.target) {
      throw new Error(
        'Planned install targets ' + existingTarget + ' and ' + file.target +
        ' resolve to the same consumer file ' + resolvedRef + '.'
      );
    }
    resolvedTargets.set(resolvedRef, file.target);
    const resolvedPath = path.join(state.inputs.workspace.path, resolvedRef);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('Planned consumer file ' + file.target + ' is missing after installation.');
    }
    assertNoSymlinkPath(
      state.inputs.workspace.path,
      resolvedRef,
      'Planned consumer file ' + file.target
    );
    const reference = attestDeclaredWorkspaceFile(
      resolvedRef,
      sha256File(resolvedPath),
      state.inputs.workspace.path,
      'installed-file',
      'Planned consumer file ' + file.target
    );
    const source = generatedRegistrySource(file, state, sourceContract);
    if (source) {
      assertInstalledRegistryContent(
        resolvedPath,
        source.content,
        source.path,
        consumerComponents
      );
    }
    if (!referencePaths.has(resolvedRef)) {
      referencePaths.add(resolvedRef);
      evidence.references.push(reference);
    }
  }
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
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'preparation', 'results'],
    'Install log evidence'
  );
  assertMachineHeader(document, 'install-log', 'Install log evidence');
  const planContracts = installPlanContracts(state);
  const local = localConsumptionContract(state);
  const expectedPreparation = local ? local.prepareCommands : [];
  if (
    !Array.isArray(document.preparation) ||
    document.preparation.length !== expectedPreparation.length
  ) {
    throw new Error('Install log preparation must exactly cover the local Blocks prepare commands.');
  }
  let observedFailure = false;
  for (let index = 0; index < expectedPreparation.length; index += 1) {
    const result = document.preparation[index];
    exactKeys(
      result,
      ['command', 'exitCode', 'outputRef', 'outputSha256', 'passed'],
      'Install preparation result'
    );
    if (result.command !== expectedPreparation[index]) {
      throw new Error('Install preparation command does not match the pinned local-consumption contract.');
    }
    if (!Number.isInteger(result.exitCode) || result.passed !== (result.exitCode === 0)) {
      throw new Error('Install preparation passed must equal its integer exitCode === 0.');
    }
    evidence.references.push(
      attestDeclaredWorkspaceFile(
        result.outputRef,
        result.outputSha256,
        state.inputs.workspace.path,
        'install-output',
        'Install preparation output'
      )
    );
    if (validateResultPassState(result.passed, requirePass, 'Install preparation result')) {
      observedFailure = true;
    }
  }
  if (!Array.isArray(document.results) || document.results.length !== planContracts.length) {
    throw new Error('Install log evidence must cover every selected root.');
  }
  const expectedByRoot = new Map(planContracts.map((contract) => [contract.root, contract]));
  const seen = new Set();
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
  if (requirePass) {
    attestPlannedConsumerFiles(planContracts, evidence, state);
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

function expectedFeaturePackManifest(state, featurePack) {
  let expected = null;
  for (const plan of installPlanContracts(state)) {
    for (const manifest of plan.featurePacks) {
      if (manifest?.id !== featurePack) {
        continue;
      }
      if (expected && !isDeepStrictEqual(expected, manifest)) {
        throw new Error('Attested install plans disagree on the ' + featurePack + ' manifest.');
      }
      expected = manifest;
    }
  }
  if (!expected) {
    throw new Error('No attested install plan contains the ' + featurePack + ' manifest.');
  }
  return expected;
}

function validateInstalledManifest(document, expected, label) {
  if (!isDeepStrictEqual(document, expected)) {
    throw new Error(label + ' does not exactly match the source-attested feature-pack manifest.');
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
    const expectedManifestRef = path.posix.join(
      '.constructive',
      'feature-packs',
      result.featurePack + '.json'
    );
    if (result.manifestRef !== expectedManifestRef) {
      throw new Error(
        'Installed feature-pack manifest must use the exact project sidecar path ' +
        expectedManifestRef + '.'
      );
    }
    const reference = attestDeclaredWorkspaceFile(
      result.manifestRef,
      result.sha256,
      state.inputs.workspace.path,
      'manifest',
      'Installed feature-pack manifest'
    );
    validateInstalledManifest(
      readJson(reference.path, 'Installed feature-pack manifest'),
      expectedFeaturePackManifest(state, result.featurePack),
      'Installed feature-pack manifest'
    );
    evidence.references.push(reference);
    if (validateResultPassState(result.passed, requirePass, 'Manifest result')) {
      observedFailure = true;
    }
  }
  requireObservedFailure(observedFailure, requirePass, 'manifest');
}

function tarHeaderString(header, offset, length) {
  const value = header.subarray(offset, offset + length);
  const end = value.indexOf(0);
  return value.subarray(0, end === -1 ? value.length : end).toString('utf8').trim();
}

function tarHeaderNumber(header, offset, length, label) {
  const value = tarHeaderString(header, offset, length).replace(/\0/g, '').trim();
  if (!/^[0-7]+$/.test(value)) {
    throw new Error('Package tarball has an invalid ' + label + ' field.');
  }
  return Number.parseInt(value, 8);
}

function validateTarHeaderChecksum(header) {
  const expected = tarHeaderNumber(header, 148, 8, 'checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) {
    throw new Error('Package tarball contains an invalid header checksum.');
  }
}

function safeTarPackagePath(value, label) {
  const withoutDot = value.startsWith('./') ? value.slice(2) : value;
  if (
    !withoutDot ||
    withoutDot.includes('\\') ||
    path.posix.isAbsolute(withoutDot) ||
    path.posix.normalize(withoutDot) !== withoutDot ||
    (withoutDot !== 'package' && !withoutDot.startsWith('package/'))
  ) {
    throw new Error('Package tarball ' + label + ' must stay inside package/.');
  }
  return withoutDot;
}

function parsePaxAttributes(bytes) {
  const attributes = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    if (space === -1) {
      throw new Error('Package tarball contains a malformed PAX record.');
    }
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) {
      throw new Error('Package tarball contains a malformed PAX record length.');
    }
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (end > bytes.length || bytes[end - 1] !== 10) {
      throw new Error('Package tarball contains a truncated PAX record.');
    }
    const record = bytes.subarray(space + 1, end - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals < 1) {
      throw new Error('Package tarball contains a malformed PAX attribute.');
    }
    attributes[record.slice(0, equals)] = record.slice(equals + 1);
    offset = end;
  }
  return attributes;
}

function packageFilesFromTarball(tarballPath) {
  const compressed = fs.readFileSync(tarballPath);
  let archive;
  try {
    archive = zlib.gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 });
  } catch (error) {
    throw new Error('Package tarball cannot be safely decompressed: ' + error.message);
  }
  const files = new Map();
  let offset = 0;
  let pendingPax = null;
  let pendingLongPath = null;
  let ended = false;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const secondTerminator = archive.subarray(offset + 512, offset + 1024);
      if (
        secondTerminator.length !== 512 ||
        !secondTerminator.every((byte) => byte === 0) ||
        archive.length % 512 !== 0 ||
        !archive.subarray(offset + 1024).every((byte) => byte === 0)
      ) {
        throw new Error(
          'Package tarball must end with two zero records and only zero block padding.'
        );
      }
      ended = true;
      break;
    }
    validateTarHeaderChecksum(header);
    const name = tarHeaderString(header, 0, 100);
    const prefix = tarHeaderString(header, 345, 155);
    const headerPath = prefix ? prefix + '/' + name : name;
    const size = tarHeaderNumber(header, 124, 12, 'size');
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Package tarball contains an unsafe entry size.');
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) {
      throw new Error('Package tarball contains a truncated entry.');
    }
    const data = archive.subarray(dataStart, dataEnd);
    const type = String.fromCharCode(header[156] || 48);
    if (type === 'x') {
      pendingPax = parsePaxAttributes(data);
    } else if (type === 'L') {
      pendingLongPath = data.subarray(0, data.indexOf(0) === -1 ? data.length : data.indexOf(0)).toString('utf8');
    } else if (type === '0' || type === '5') {
      const entryPath = safeTarPackagePath(
        pendingPax?.path || pendingLongPath || headerPath,
        type === '5' ? 'directory' : 'file'
      );
      if (type === '0') {
        if (entryPath === 'package' || files.has(entryPath)) {
          throw new Error('Package tarball contains a duplicate or unnamed package file.');
        }
        files.set(entryPath.slice('package/'.length), Buffer.from(data));
      }
      pendingPax = null;
      pendingLongPath = null;
    } else {
      throw new Error('Package tarball contains unsupported entry type ' + type + '.');
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!ended || pendingPax || pendingLongPath || files.size === 0) {
    throw new Error('Package tarball does not contain one complete package/ file tree.');
  }
  return files;
}

export function assertPackageTarballComplete(tarballPath) {
  packageFilesFromTarball(tarballPath);
}

function installedPackageFiles(packageRoot, workspacePath) {
  const realWorkspace = fs.realpathSync(workspacePath);
  const realRoot = fs.realpathSync(packageRoot);
  if (!isWithin(realWorkspace, realRoot)) {
    throw new Error('Installed package root escapes the validated workspace.');
  }
  const files = new Map();
  function visit(directory, relativeDirectory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error('Installed package tree contains a symlink: ' + relativePath + '.');
      }
      if (stats.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (stats.isFile()) {
        files.set(relativePath, fs.readFileSync(absolutePath));
      } else {
        throw new Error('Installed package tree contains a special file: ' + relativePath + '.');
      }
    }
  }
  visit(realRoot, '');
  return files;
}

function assertPackageTreeMatchesTarball(packageRoot, tarballFiles, workspacePath) {
  const installedFiles = installedPackageFiles(packageRoot, workspacePath);
  if (installedFiles.size !== tarballFiles.size) {
    throw new Error('Installed package tree does not exactly match its retained tarball.');
  }
  for (const [relativePath, expectedBytes] of tarballFiles) {
    const actualBytes = installedFiles.get(relativePath);
    if (!actualBytes || !actualBytes.equals(expectedBytes)) {
      throw new Error(
        'Installed package file does not match its retained tarball: ' + relativePath + '.'
      );
    }
  }
}

function yamlEntryKey(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function pnpmPackageEntry(lockfileText, packageName, version) {
  const lines = lockfileText.split(/\r?\n/);
  const packagesIndex = lines.findIndex((line) => line === 'packages:');
  if (packagesIndex === -1) {
    throw new Error('pnpm-lock.yaml has no packages section.');
  }
  const exactKey = packageName + '@' + version;
  for (let index = packagesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(' ')) {
      break;
    }
    const match = /^  (.+):\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const key = yamlEntryKey(match[1]).replace(/^\//, '');
    if (key !== exactKey && !key.startsWith(exactKey + '(')) {
      continue;
    }
    let end = index + 1;
    while (end < lines.length && (lines[end].startsWith('    ') || lines[end] === '')) {
      end += 1;
    }
    return lines.slice(index, end).join('\n');
  }
  throw new Error('pnpm-lock.yaml does not resolve ' + exactKey + '.');
}

function pnpmResolutionIntegrity(lockfileEntry) {
  const values = [];
  const lines = lockfileEntry.split(/\r?\n/);
  let inResolution = false;
  let resolutionDeclarations = 0;
  for (const line of lines) {
    const declaration = /^    resolution:(.*)$/.exec(line);
    if (declaration) {
      resolutionDeclarations += 1;
      inResolution = false;
      const value = declaration[1].trim();
      if (!value) {
        inResolution = true;
        continue;
      }
      const inline = /^\{([^{}]*)\}$/.exec(value);
      if (!inline) {
        throw new Error('pnpm-lock.yaml package resolution must be a mapping.');
      }
      for (const field of inline[1].split(',')) {
        const match = /^\s*integrity:\s*(\S+)\s*$/.exec(field);
        if (match) {
          values.push(match[1]);
        }
      }
      continue;
    }
    if (inResolution) {
      const match = /^      integrity:\s*(\S+)\s*$/.exec(line);
      if (match) {
        values.push(match[1]);
        continue;
      }
      if (line && !line.startsWith('      ')) {
        inResolution = false;
      }
    }
  }
  if (resolutionDeclarations !== 1) {
    throw new Error('pnpm-lock.yaml package entry must contain one exact resolution declaration.');
  }
  if (values.length !== 1) {
    throw new Error('pnpm-lock.yaml package entry must contain one exact resolution integrity field.');
  }
  return values[0];
}

export function assertPnpmLockResolution(
  lockfileText,
  packageName,
  version,
  integrity
) {
  const lockfileEntry = pnpmPackageEntry(lockfileText, packageName, version);
  if (pnpmResolutionIntegrity(lockfileEntry) !== integrity) {
    throw new Error('pnpm-lock.yaml package resolution does not match the retained tarball integrity.');
  }
}

function pinnedPackageResolutions(state) {
  const catalog = catalogContract(state);
  const attestation = catalog.source?.attestations?.packageResolutions;
  if (!attestation) {
    if (state.inputs.blocksSource) {
      throw new Error('Pinned Blocks catalog has no external package resolution attestation.');
    }
    return null;
  }
  if (
    attestation.path !== 'references/package-resolutions.v1.json' ||
    typeof attestation.sha256 !== 'string'
  ) {
    throw new Error('Pinned Blocks catalog has an invalid package resolution attestation.');
  }
  const skillRoot = path.dirname(path.dirname(path.resolve(state.inputs.catalog)));
  const snapshotPath = path.resolve(skillRoot, attestation.path);
  if (!isWithin(skillRoot, snapshotPath)) {
    throw new Error('Pinned package resolution attestation escapes the Blocks skill.');
  }
  assertRegularContainedFile(snapshotPath, skillRoot, 'Pinned package resolution attestation');
  if (sha256File(snapshotPath) !== attestation.sha256) {
    throw new Error('Pinned package resolution attestation hash drifted.');
  }
  const snapshot = readJson(snapshotPath, 'Pinned package resolution attestation');
  const expectedCommit = state.inputs.blocksSource?.headCommit || catalog.source?.commit;
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot?.kind !== 'constructive.blocks-package-resolutions' ||
    snapshot.sourceCommit !== expectedCommit ||
    snapshot.registry !== 'https://registry.npmjs.org' ||
    !Array.isArray(snapshot.records) ||
    snapshot.recordCount !== snapshot.records.length
  ) {
    throw new Error('Pinned package resolution attestation has an invalid source contract.');
  }
  const byName = new Map();
  for (const record of snapshot.records) {
    if (
      !record ||
      typeof record.name !== 'string' ||
      typeof record.version !== 'string' ||
      typeof record.resolved !== 'string' ||
      typeof record.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity) ||
      byName.has(record.name)
    ) {
      throw new Error('Pinned package resolution attestation contains an invalid record.');
    }
    byName.set(record.name, record);
  }
  return byName;
}

export function assertPinnedExternalPackageResolution(document, pinnedResolution) {
  if (
    !pinnedResolution ||
    pinnedResolution.name !== document.name ||
    pinnedResolution.version !== document.version ||
    pinnedResolution.resolved !== document.resolved ||
    pinnedResolution.integrity !== document.integrity
  ) {
    throw new Error(
      'External package resolution does not match the immutable npm registry attestation.'
    );
  }
}

function validatePackageResolution(document, result, evidence, state, packageResolutions) {
  exactKeys(
    document,
    [
      'schemaVersion',
      'kind',
      'name',
      'version',
      'resolved',
      'integrity',
      'lockfileRef',
      'lockfileSha256',
      'tarballRef',
      'tarballSha256',
      'packageJsonRef',
      'packageJsonSha256'
    ],
    'Package resolution receipt'
  );
  if (
    document.schemaVersion !== 1 ||
    document.kind !== 'constructive.builder-package-resolution' ||
    document.name !== result.name
  ) {
    throw new Error('Package resolution receipt has the wrong schema, kind, or package name.');
  }
  requireValue(document.version, 'Package resolution version');
  requireValue(document.resolved, 'Package resolution URL');
  if (
    typeof document.integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(document.integrity)
  ) {
    throw new Error('Package resolution integrity must be a sha512 Subresource Integrity value.');
  }
  let resolutionUrl;
  try {
    resolutionUrl = new URL(document.resolved);
  } catch {
    throw new Error('Package resolution resolved must be an absolute URL.');
  }
  if (!['http:', 'https:'].includes(resolutionUrl.protocol)) {
    throw new Error('Package resolution URL must use HTTP or HTTPS.');
  }
  const expectedPackageJsonRef = path.posix.join(
    'node_modules',
    document.name,
    'package.json'
  );
  if (document.packageJsonRef !== expectedPackageJsonRef) {
    throw new Error(
      'Package resolution packageJsonRef must be the exact installed path ' +
      expectedPackageJsonRef + '.'
    );
  }
  if (document.lockfileRef !== 'pnpm-lock.yaml') {
    throw new Error('Package resolution lockfileRef must be the exact pnpm-lock.yaml path.');
  }
  const lockfileReference = attestDeclaredWorkspaceFile(
    document.lockfileRef,
    document.lockfileSha256,
    state.inputs.workspace.path,
    'package-lock',
    'Consumer pnpm lockfile'
  );
  assertPnpmLockResolution(
    fs.readFileSync(lockfileReference.path, 'utf8'),
    result.name,
    document.version,
    document.integrity
  );
  const tarballReference = attestDeclaredWorkspaceFile(
    document.tarballRef,
    document.tarballSha256,
    state.inputs.workspace.path,
    'package-artifact',
    'Retained package tarball'
  );
  const tarballBytes = fs.readFileSync(tarballReference.path);
  const tarballIntegrity = 'sha512-' + crypto.createHash('sha512').update(tarballBytes).digest('base64');
  if (tarballIntegrity !== document.integrity) {
    throw new Error('Retained package tarball does not match its declared integrity.');
  }
  const tarballFiles = packageFilesFromTarball(tarballReference.path);
  const packedManifestBytes = tarballFiles.get('package.json');
  let packedManifest;
  try {
    packedManifest = JSON.parse(packedManifestBytes?.toString('utf8') || '');
  } catch (error) {
    throw new Error('Retained package tarball has an invalid package.json: ' + error.message);
  }
  if (packedManifest?.name !== result.name || packedManifest?.version !== document.version) {
    throw new Error('Retained package tarball manifest does not match the resolution receipt.');
  }
  const releasePackage = Array.isArray(catalogContract(state).release?.packages)
    ? catalogContract(state).release.packages.find((candidate) => candidate?.name === result.name)
    : null;
  if (!releasePackage && packageResolutions) {
    const pinnedResolution = packageResolutions.get(result.name);
    assertPinnedExternalPackageResolution(document, pinnedResolution);
  }
  if (releasePackage && state.inputs.blocksSource) {
    if (document.version !== releasePackage.version) {
      throw new Error('Pinned local package version does not match the Blocks release contract.');
    }
    if (!['127.0.0.1', 'localhost'].includes(resolutionUrl.hostname)) {
      throw new Error('Pinned local Constructive packages must resolve from the local package registry.');
    }
    const unscopedName = document.name.slice(document.name.lastIndexOf('/') + 1);
    const expectedRegistryPath = '/' + document.name + '/-/' + unscopedName + '-' + document.version + '.tgz';
    let decodedRegistryPath;
    try {
      decodedRegistryPath = decodeURIComponent(resolutionUrl.pathname);
    } catch {
      throw new Error('Pinned local package URL contains invalid path encoding.');
    }
    if (decodedRegistryPath !== expectedRegistryPath) {
      throw new Error('Pinned local package URL does not match the Blocks local registry contract.');
    }
    const artifactName = document.name.slice(1).split('/').join('-') + '-' + document.version + '.tgz';
    const sourceArtifactPath = path.join(
      state.inputs.blocksSource.path,
      '.artifacts',
      'npm',
      artifactName
    );
    assertRegularContainedFile(
      sourceArtifactPath,
      state.inputs.blocksSource.path,
      'Pinned Blocks package artifact'
    );
    if (sha256File(sourceArtifactPath) !== document.tarballSha256) {
      throw new Error('Retained local package tarball does not match the pinned Blocks artifact.');
    }
  }
  const packageJsonReference = attestDeclaredWorkspaceFile(
    document.packageJsonRef,
    document.packageJsonSha256,
    state.inputs.workspace.path,
    'package',
    'Installed package.json'
  );
  const packageJson = readJson(packageJsonReference.path, 'Installed package.json');
  if (packageJson?.name !== result.name || packageJson?.version !== document.version) {
    throw new Error('Installed package.json does not match the package resolution receipt.');
  }
  assertPackageTreeMatchesTarball(
    path.dirname(packageJsonReference.path),
    tarballFiles,
    state.inputs.workspace.path
  );
  if (!evidence.references.some((reference) => reference.path === lockfileReference.path)) {
    evidence.references.push(lockfileReference);
  }
  evidence.references.push(tarballReference);
  evidence.references.push(packageJsonReference);
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
  const packageResolutions = pinnedPackageResolutions(state);
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
    validatePackageResolution(
      readJson(reference.path, 'Package resolution receipt'),
      result,
      evidence,
      state,
      packageResolutions
    );
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

function validateBlocksCheckEvidence(document, evidence, state, requirePass) {
  exactKeys(
    document,
    [
      'schemaVersion',
      'kind',
      'headCommit',
      'checkerSha256',
      'outputRef',
      'outputSha256',
      'passed'
    ],
    'Blocks check evidence'
  );
  assertMachineHeader(document, 'blocks-check', 'Blocks check evidence');
  if (!state.inputs.blocksSource) {
    if (
      document.headCommit !== null ||
      document.checkerSha256 !== null ||
      document.outputRef !== null ||
      document.outputSha256 !== null
    ) {
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
    if (!isSafeRelativePath(document.outputRef) || document.outputRef === '.') {
      throw new Error('Blocks check outputRef must be a safe workspace-relative file.');
    }
    const outputPath = path.join(state.inputs.workspace.path, document.outputRef);
    if (!fs.existsSync(outputPath)) {
      throw new Error('Blocks check outputRef does not exist.');
    }
    const outputReference = attestDeclaredWorkspaceFile(
      document.outputRef,
      sha256File(outputPath),
      state.inputs.workspace.path,
      'command-output',
      'Blocks checker output'
    );
    if (fs.readFileSync(outputReference.path, 'utf8').trim() !== output) {
      throw new Error('Retained Blocks checker output does not equal the canonical full checker stdout.');
    }
    evidence.references.push(outputReference);
  }
  if (document.passed !== true) {
    throw new Error('Blocks check passed must be true because the canonical full checker completed successfully.');
  }
  const observedFailure = validateResultPassState(document.passed, requirePass, 'Blocks check result');
  requireObservedFailure(observedFailure, requirePass, 'blocks-check');
}

function expectedDomainSourceRef(route) {
  const relativeRoute = route.path === '/' ? '' : route.path.replace(/^\/+|\/+$/g, '');
  return relativeRoute
    ? path.posix.join('src', 'app', relativeRoute, 'page.tsx')
    : path.posix.join('src', 'app', 'page.tsx');
}

function validateSourceCheckEvidence(document, evidence, state, requirePass) {
  exactKeys(document, ['schemaVersion', 'kind', 'results'], 'Source check evidence');
  assertMachineHeader(document, 'source-check', 'Source check evidence');
  if (!Array.isArray(document.results) || document.results.length !== state.resolved.domainRoutes.length) {
    throw new Error('Source check evidence must cover every application-owned domain route.');
  }
  const expectedRoutes = new Map(state.resolved.domainRoutes.map((route) => [route.id, route]));
  const seen = new Set();
  let observedFailure = false;
  for (const result of document.results) {
    exactKeys(result, ['routeId', 'sourceRef', 'sha256', 'passed'], 'Source check result');
    const expectedRoute = expectedRoutes.get(result.routeId);
    if (!expectedRoute || seen.has(result.routeId)) {
      throw new Error('Source check evidence has an unexpected or duplicate route ' + String(result.routeId) + '.');
    }
    seen.add(result.routeId);
    const expectedSourceRef = expectedDomainSourceRef(expectedRoute);
    if (result.sourceRef !== expectedSourceRef) {
      throw new Error(
        'Domain route source must use the exact Next.js App Router path ' + expectedSourceRef + '.'
      );
    }
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
        {
          contextKey: [
            'meta',
            result.routeId,
            result.resource,
            result.contractVersion
          ].join('|'),
          endpointKind: 'data',
          operation: 'meta-contract',
          checkId: 'meta-contract:' + result.routeId,
          passed: result.passed
        }
      )
    );
  }
  requireObservedFailure(observedFailure, requirePass, 'meta-contract');
}

function expectedVerifyCommand(state, evidenceType) {
  const commandIndex = evidenceType === 'typecheck' ? 0 : 1;
  let expected = null;
  for (const plan of installPlanContracts(state)) {
    const command = plan.verifyCommands[commandIndex];
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('Attested install plan has no ' + evidenceType + ' verification command.');
    }
    if (expected !== null && expected !== command) {
      throw new Error('Attested install plans disagree on the ' + evidenceType + ' command.');
    }
    expected = command;
  }
  if (expected === null) {
    throw new Error('No attested install plan provides a ' + evidenceType + ' command.');
  }
  return expected;
}

function validateCommandEvidence(document, evidence, state, evidenceType, requirePass) {
  const label = evidenceType === 'typecheck' ? 'Typecheck evidence' : 'Build evidence';
  exactKeys(
    document,
    ['schemaVersion', 'kind', 'command', 'exitCode', 'outputRef', 'outputSha256', 'passed'],
    label
  );
  assertMachineHeader(document, evidenceType, label);
  if (document.command !== expectedVerifyCommand(state, evidenceType)) {
    throw new Error(label + ' command does not match the attested Blocks verification command.');
  }
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
  const artifactPaths = new Set();
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
    if (artifactPaths.has(result.artifactRef)) {
      throw new Error('Interaction evidence reuses an outcome across contextual results.');
    }
    artifactPaths.add(result.artifactRef);
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
          viewport: expectedResult.viewport,
          state: result.state,
          passed: result.passed,
          checkId: 'interaction:' + key
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
    validateBlocksCheckEvidence(document, evidence, state, requirePass);
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
  if (stageName === 'visual') {
    const screenshotEvidence = evidenceEntries.find((entry) => entry.type === 'screenshot');
    const interactionEvidence = evidenceEntries.find((entry) => entry.type === 'interaction');
    if (screenshotEvidence && interactionEvidence) {
      const screenshotDocument = readJson(screenshotEvidence.path, 'Visual evidence');
      const interactionDocument = readJson(interactionEvidence.path, 'Interaction evidence');
      const interactionByKey = new Map();
      for (const result of interactionDocument.results) {
        interactionByKey.set(
          visualCombinationKey(result.target, result.viewport, result.state),
          result.artifactRef
        );
      }
      if (screenshotDocument.results.length !== interactionDocument.results.length) {
        throw new Error('Screenshot and interaction evidence must cover the same contextual results.');
      }
      for (const result of screenshotDocument.results) {
        const key = visualCombinationKey(result.target, result.viewport, result.state);
        if (interactionByKey.get(key) !== result.interactionRef) {
          throw new Error('Screenshot and interaction evidence must reference the same exact outcome.');
        }
      }
    }
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
    sequence: nextTransitionSequence(state),
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
    sequence: nextTransitionSequence(state),
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
    sequence: nextTransitionSequence(state),
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
  if (STAGES.some((currentName) => deriveStage(state, currentName).status === 'running')) {
    throw new Error('Finish the running stage before invalidating journal history.');
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
    sequence: nextTransitionSequence(state),
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
