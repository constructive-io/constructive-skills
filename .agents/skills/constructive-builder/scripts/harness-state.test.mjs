import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  computeWorkspaceAttestation,
  ensureSafeWorkspaceDirectory,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from './lib/brief-contract.mjs';
import {
  failJournalStage,
  initializeJournal,
  invalidateJournalStages,
  loadJournal,
  mutateJournal,
  passJournalStage,
  startJournalStage,
  summarizeJournal,
  withJournalLock
} from './lib/harness-journal.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const harnessStateCliPath = path.join(scriptDirectory, 'harness-state.mjs');

const FEATURE_CONTRACT = {
  role: 'required',
  capability: 'auth.credentials',
  alternativeId: 'auth.credentials.path-1',
  verificationProfileId: 'tenant-runtime',
  endpointKind: 'auth',
  evidence: {
    type: 'graphql-operations',
    operation: 'mutation',
    coordinates: ['Mutation.signIn', 'Mutation.signUp']
  }
};
const VIEWPORT_DEFINITIONS = {
  desktop: {
    id: 'desktop',
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    colorScheme: 'light'
  },
  mobile: {
    id: 'mobile',
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    colorScheme: 'light'
  }
};

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function createHarness(runtimeLimitations = []) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-builder-journal-'));
  const workspace = path.join(temporaryRoot, 'workspace');
  const harnessDirectory = path.join(workspace, '.constructive', 'harness');
  fs.mkdirSync(harnessDirectory, { recursive: true });
  const briefPath = path.join(workspace, 'brief.json');
  const tenantPath = path.join(workspace, 'tenant.json');
  const catalogPath = path.join(workspace, 'catalog.json');
  const planPath = path.join(workspace, 'console-module-auth.plan.json');
  writeText(briefPath, '{"brief":true}\n');
  writeText(tenantPath, '{"tenant":true}\n');
  writeText(catalogPath, '{"catalog":true}\n');
  writeJsonAtomic(planPath, {
    schemaVersion: 1,
    kind: 'constructive.console-kit-install-plan',
    item: 'console-module-auth',
    install: {
      command: 'pnpm dlx shadcn@4.13.1 add @constructive/console-module-auth'
    },
    composition: {
      npmDependencies: [
        { name: '@constructive-io/data' },
        { name: 'zustand' }
      ]
    }
  });
  const immutableFiles = [
    { role: 'brief', path: briefPath, sha256: sha256File(briefPath) },
    { role: 'tenant', path: tenantPath, sha256: sha256File(tenantPath) },
    { role: 'blocks-contract', path: catalogPath, sha256: sha256File(catalogPath) },
    { role: 'install-plan:console-module-auth', path: planPath, sha256: sha256File(planPath) }
  ];
  const resolved = {
    tenantId: 'tenant-primary',
    tenantContract: {
      id: 'tenant-primary',
      endpointKinds: ['auth'],
      requireCsrfForAuth: true
    },
    tenantProvenance: { kind: 'custom', preset: null },
    compositionKind: 'console-modules',
    installRoots: ['console-module-auth'],
    surfaces: [
      {
        id: 'console',
        mountPath: '/console',
        roots: ['console-module-auth'],
        featurePacks: ['auth']
      }
    ],
    domainRoutes: [],
    workspacePath: workspace,
    metaContractVersion: '2026-07',
    runtimeLimitations,
    acceptance: {
      capabilities: [
        {
          surfaceId: 'console',
          featurePack: 'auth',
          expected: 'ready'
        }
      ],
      isolationTenants: [
        {
          id: 'other-tenant',
          databaseId: 'tenant-isolation',
          sessionRef: 'qa.otherSession',
          descriptorPath: './other.json',
          endpointKinds: ['auth'],
          requireCsrfForAuth: true
        }
      ],
      actors: [
        {
          id: 'owner',
          kind: 'account',
          accountRef: 'qa.owner',
          tenantScope: { kind: 'primary', databaseId: 'tenant-primary', tenantRef: null },
          sessionState: 'active'
        },
        {
          id: 'revoked',
          kind: 'account',
          accountRef: 'qa.revoked',
          tenantScope: { kind: 'primary', databaseId: 'tenant-primary', tenantRef: null },
          sessionState: 'revoked'
        },
        {
          id: 'cross',
          kind: 'account',
          accountRef: 'qa.cross',
          tenantScope: { kind: 'isolation', databaseId: 'tenant-isolation', tenantRef: 'other-tenant' },
          sessionState: 'active'
        }
      ],
      scenarios: [
        {
          id: 'auth-lifecycle',
          kind: 'auth',
          target: { kind: 'surface', surfaceId: 'console', featurePack: 'auth' },
          actorIds: ['owner', 'revoked'],
          assertionIds: ['sign-in']
        },
        {
          id: 'auth-feature',
          kind: 'feature',
          target: { kind: 'surface', surfaceId: 'console', featurePack: 'auth' },
          actorIds: ['owner'],
          assertionIds: ['check:1'],
          assertionContracts: [
            {
              id: 'check:1',
              contract: FEATURE_CONTRACT
            }
          ]
        },
        {
          id: 'cross-policy',
          kind: 'rls',
          target: { kind: 'domain-route', routeId: 'probe', resource: 'Probe' },
          actorIds: ['owner', 'cross'],
          assertionIds: ['operation:read:deny']
        }
      ],
      visualViewports: [
        VIEWPORT_DEFINITIONS.desktop,
        VIEWPORT_DEFINITIONS.mobile
      ],
      visualTargets: [
        {
          target: { kind: 'shell', surfaceId: 'console' },
          viewports: ['desktop', 'mobile'],
          states: ['ready']
        },
        {
          target: { kind: 'surface', surfaceId: 'console', featurePack: 'auth' },
          viewports: ['desktop', 'mobile'],
          states: ['ready']
        }
      ]
    }
  };
  const workspaceAttestation = computeWorkspaceAttestation(workspace);
  const validation = {
    schemaVersion: 2,
    kind: 'constructive.builder-validation',
    ok: true,
    inputs: {
      brief: briefPath,
      tenant: tenantPath,
      catalog: catalogPath,
      blocksSource: null,
      installPlans: [
        {
          root: 'console-module-auth',
          path: planPath,
          sha256: sha256File(planPath)
        }
      ],
      immutableFiles,
      workspace: workspaceAttestation
    },
    resolved,
    warnings: [],
    errors: []
  };
  const validationPath = path.join(harnessDirectory, 'validation.json');
  const statePath = path.join(harnessDirectory, 'state.json');
  writeJsonAtomic(validationPath, validation);
  return {
    temporaryRoot,
    workspace,
    harnessDirectory,
    validationPath,
    statePath
  };
}

test('harness-state CLI rejects duplicate and command-irrelevant scalar flags', () => {
  const duplicate = spawnSync(
    process.execPath,
    [harnessStateCliPath, 'status', '--state', '/tmp/state-one.json', '--state', '/tmp/state-two.json'],
    { encoding: 'utf8' }
  );
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /--state may be provided only once/);

  const irrelevant = spawnSync(
    process.execPath,
    [harnessStateCliPath, 'status', '--state', '/tmp/state.json', '--stage', 'live'],
    { encoding: 'utf8' }
  );
  assert.equal(irrelevant.status, 2);
  assert.match(irrelevant.stderr, /--stage is not valid for the status command/);

  const passReason = spawnSync(
    process.execPath,
    [harnessStateCliPath, 'pass', '--state', '/tmp/state.json', '--stage', 'live', '--reason', 'no'],
    { encoding: 'utf8' }
  );
  assert.equal(passReason.status, 2);
  assert.match(passReason.stderr, /--reason is not valid for the pass command/);
});

function writeEvidence(harness, name, contents = 'evidence\n') {
  const relativePath = '.constructive/harness/evidence/' + name;
  writeText(path.join(harness.workspace, relativePath), contents);
  return relativePath;
}

function writeJsonEvidence(harness, name, document) {
  return writeEvidence(harness, name, JSON.stringify(document) + '\n');
}

function requestOutcome(endpointKind, passed = true, statusCode = 200) {
  return {
    schemaVersion: 1,
    kind: 'constructive.builder-request-outcome',
    endpointKind,
    operation: 'contract-check',
    statusCode,
    checks: [{ id: 'response-contract', passed }],
    passed
  };
}

function uiOutcome(passed = true) {
  return {
    schemaVersion: 1,
    kind: 'constructive.builder-ui-outcome',
    state: passed ? 'ready' : 'error',
    visible: true,
    interactive: passed,
    checks: [{ id: 'render-state', passed }],
    passed
  };
}

function writeRequestEvidence(harness, name, endpointKind = 'auth', passed = true, statusCode = null) {
  const resolvedStatus = statusCode === null ? (passed ? 200 : 503) : statusCode;
  return writeJsonEvidence(harness, name, requestOutcome(endpointKind, passed, resolvedStatus));
}

function writeUiEvidence(harness, name, passed = true) {
  return writeJsonEvidence(harness, name, uiOutcome(passed));
}

function pngCrc32(bytes) {
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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function completePng(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (rowBytes + 1)] = 0;
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function writePngEvidence(harness, name, viewport) {
  const relativePath = '.constructive/harness/evidence/' + name;
  const width = Math.round(viewport.width * viewport.deviceScaleFactor);
  const height = Math.round(viewport.height * viewport.deviceScaleFactor);
  writeBytes(path.join(harness.workspace, relativePath), completePng(width, height));
  return relativePath;
}

function visualTargetKey(target, viewport, stateName = 'ready') {
  if (target.kind === 'surface') {
    return 'surface|' + target.surfaceId + '|' + target.featurePack + '|' + viewport.id + '|' + stateName;
  }
  if (target.kind === 'domain-route') {
    return 'domain-route|' + target.routeId + '|' + target.resource + '|' + viewport.id + '|' + stateName;
  }
  return 'shell|' + target.surfaceId + '|' + viewport.id + '|' + stateName;
}

function writeInteractionOutcome(harness, name, target, viewport, passed = true, stateName = 'ready') {
  return writeJsonEvidence(harness, name, {
    schemaVersion: 1,
    kind: 'constructive.builder-interaction-outcome',
    targetKey: visualTargetKey(target, viewport, stateName),
    viewportId: viewport.id,
    state: stateName,
    checks: [{ id: 'primary-interaction', passed }],
    passed
  });
}

function interactionEvidenceFromVisualResults(results) {
  return {
    schemaVersion: 1,
    kind: 'constructive.builder-interaction-evidence',
    results: results.map((result) => {
      return {
        target: result.target,
        viewport: result.viewport,
        state: result.state,
        passed: result.passed,
        artifactRef: result.interactionRef
      };
    })
  };
}

function machineKind(type) {
  const kinds = new Map([
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
    ['build', 'constructive.builder-build-evidence']
  ]);
  return kinds.get(type);
}

function staticMachineEvidence(harness, state, stage, type, passed = true) {
  if (type === 'validation') {
    return path.relative(harness.workspace, harness.validationPath);
  }
  let document;
  if (type === 'tenant-contract') {
    const contracts = [
      {
        tenantId: state.resolved.tenantContract.id,
        role: 'primary',
        endpointKinds: state.resolved.tenantContract.endpointKinds,
        requireCsrfForAuth: state.resolved.tenantContract.requireCsrfForAuth,
        passed
      }
    ];
    for (const isolation of state.resolved.acceptance.isolationTenants) {
      contracts.push({
        tenantId: isolation.databaseId,
        role: 'isolation',
        endpointKinds: isolation.endpointKinds,
        requireCsrfForAuth: isolation.requireCsrfForAuth,
        passed: true
      });
    }
    document = { schemaVersion: 1, kind: machineKind(type), tenants: contracts };
  } else if (type === 'endpoint-check') {
    const results = [];
    const tenants = [state.resolved.tenantContract];
    for (const isolation of state.resolved.acceptance.isolationTenants) {
      tenants.push({ id: isolation.databaseId, endpointKinds: isolation.endpointKinds });
    }
    for (const tenant of tenants) {
      for (const endpointKind of tenant.endpointKinds) {
        const resultPassed = passed || results.length > 0;
        const statusCode = resultPassed ? 200 : 503;
        const requestRef = writeRequestEvidence(
          harness,
          stage + '-' + tenant.id + '-' + endpointKind + '-request.json',
          endpointKind,
          resultPassed,
          statusCode
        );
        results.push({ tenantId: tenant.id, endpointKind, statusCode, passed: resultPassed, requestRef });
      }
    }
    document = { schemaVersion: 1, kind: machineKind(type), results };
  } else if (type === 'install-plan') {
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      plans: state.inputs.installPlans.map((plan, index) => {
        return { root: plan.root, sha256: plan.sha256, passed: passed || index > 0 };
      })
    };
  } else if (type === 'install-log') {
    const planByRoot = new Map();
    for (const plan of state.inputs.installPlans) {
      planByRoot.set(plan.root, JSON.parse(fs.readFileSync(plan.path, 'utf8')));
    }
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      results: state.resolved.installRoots.map((root, index) => {
        const resultPassed = passed || index > 0;
        const outputRef = '.constructive/harness/evidence/' + stage + '-' + root + '-install-output.txt';
        writeEvidence(harness, path.basename(outputRef), resultPassed ? 'installed\n' : 'install failed\n');
        return {
          root,
          command: planByRoot.get(root).install.command,
          exitCode: resultPassed ? 0 : 1,
          outputRef,
          outputSha256: sha256File(path.join(harness.workspace, outputRef)),
          passed: resultPassed
        };
      })
    };
  } else if (type === 'manifest') {
    const results = [];
    for (const surface of state.resolved.surfaces) {
      for (const featurePack of surface.featurePacks) {
        const manifestRef = '.constructive/harness/evidence/' + stage + '-' + surface.id + '-' + featurePack + '-manifest.json';
        writeJsonEvidence(harness, path.basename(manifestRef), {
          schemaVersion: 1,
          id: featurePack,
          capabilities: { required: [] }
        });
        results.push({
          surfaceId: surface.id,
          featurePack,
          manifestRef,
          sha256: sha256File(path.join(harness.workspace, manifestRef)),
          passed
        });
      }
    }
    document = { schemaVersion: 1, kind: machineKind(type), results };
  } else if (type === 'package-provenance') {
    const names = new Set();
    for (const plan of state.inputs.installPlans) {
      const planDocument = JSON.parse(fs.readFileSync(plan.path, 'utf8'));
      for (const dependency of planDocument.composition.npmDependencies) {
        names.add(dependency.name);
      }
    }
    const packages = [];
    let packageIndex = 0;
    for (const name of names) {
      const resolvedRef = '.constructive/harness/evidence/' + stage + '-package-' + packageIndex + '.json';
      writeJsonEvidence(harness, path.basename(resolvedRef), { name, version: '0.0.0-test' });
      packages.push({
        name,
        resolvedRef,
        sha256: sha256File(path.join(harness.workspace, resolvedRef)),
        sourceCommit: state.inputs.blocksSource ? state.inputs.blocksSource.headCommit : null,
        passed
      });
      packageIndex += 1;
    }
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      packages
    };
  } else if (type === 'blocks-check') {
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      headCommit: state.inputs.blocksSource ? state.inputs.blocksSource.headCommit : null,
      checkerSha256: state.inputs.blocksSource ? state.inputs.blocksSource.checkerSha256 : null,
      outputSha256: null,
      passed
    };
  } else if (type === 'source-check') {
    const results = [];
    for (const route of state.resolved.domainRoutes) {
      const sourceRef = '.constructive/harness/evidence/' + stage + '-' + route.id + '.tsx';
      writeEvidence(harness, path.basename(sourceRef), 'export default function Route() { return null; }\n');
      results.push({
        routeId: route.id,
        sourceRef,
        sha256: sha256File(path.join(harness.workspace, sourceRef)),
        passed
      });
    }
    document = { schemaVersion: 1, kind: machineKind(type), results };
  } else if (type === 'meta-contract') {
    const results = [];
    for (const route of state.resolved.domainRoutes) {
      const requestRef = writeRequestEvidence(harness, stage + '-' + route.id + '-meta.json', 'data', passed);
      results.push({
        routeId: route.id,
        resource: route.resource,
        endpointKind: 'data',
        contractVersion: state.resolved.metaContractVersion,
        metaPassed: passed,
        introspectionPassed: passed,
        reconciled: passed,
        requestRef,
        passed
      });
    }
    document = { schemaVersion: 1, kind: machineKind(type), results };
  } else {
    const outputRef = '.constructive/harness/evidence/' + stage + '-' + type + '-output.txt';
    writeEvidence(harness, path.basename(outputRef), type + '-output');
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      command: type === 'typecheck' ? 'pnpm typecheck' : 'pnpm build',
      exitCode: passed ? 0 : 1,
      outputRef,
      outputSha256: sha256File(path.join(harness.workspace, outputRef)),
      passed
    };
  }
  return writeJsonEvidence(harness, stage + '-' + type + '.json', document);
}

function start(statePath, stage) {
  mutateJournal(statePath, (state) => {
    startJournalStage(state, stage);
  });
}

function pass(statePath, stage, references) {
  mutateJournal(statePath, (state) => {
    passJournalStage(state, stage, references);
  });
}

function passTextStage(harness, stage, types) {
  start(harness.statePath, stage);
  const state = loadJournal(harness.statePath, { allowWorkspaceDrift: true });
  const references = [];
  for (const type of types) {
    const relativePath = staticMachineEvidence(harness, state, stage, type);
    references.push(type + '=' + relativePath);
  }
  pass(harness.statePath, stage, references);
}

function journalInputRootForTest(state) {
  const immutableFiles = state.inputs.immutableFiles.map((inputFile) => {
    return { role: inputFile.role, sha256: inputFile.sha256 };
  });
  return sha256Text(JSON.stringify({
    validationSha256: state.validation.sha256,
    blocksHeadCommit: state.inputs.blocksSource ? state.inputs.blocksSource.headCommit : null,
    blocksCheckerSha256: state.inputs.blocksSource ? state.inputs.blocksSource.checkerSha256 : null,
    immutableFiles
  }));
}

function hashJournalEventForTest(event, context) {
  const payload = structuredClone(event);
  delete payload.eventHash;
  return sha256Text(JSON.stringify({ context, event: payload }));
}

function recomputeJournalSealsForTest(state) {
  const inputRoot = journalInputRootForTest(state);
  const stageNames = ['brief', 'tenant', 'install', 'domain', 'static', 'live', 'visual', 'acceptance'];
  for (const stageName of stageNames) {
    for (const attempt of state.stages[stageName].attempts) {
      let previousHash = sha256Text(inputRoot + ':attempt:' + stageName + ':' + attempt.number);
      for (let eventIndex = 0; eventIndex < attempt.events.length; eventIndex += 1) {
        const event = attempt.events[eventIndex];
        event.previousHash = previousHash;
        event.eventHash = hashJournalEventForTest(event, {
          kind: 'attempt',
          stageName,
          attemptNumber: attempt.number,
          eventIndex
        });
        previousHash = event.eventHash;
      }
    }
  }
  let invalidationPreviousHash = sha256Text(inputRoot + ':invalidations');
  for (let index = 0; index < state.invalidations.length; index += 1) {
    const invalidation = state.invalidations[index];
    invalidation.previousHash = invalidationPreviousHash;
    invalidation.eventHash = hashJournalEventForTest(invalidation, { kind: 'invalidation', index });
    invalidationPreviousHash = invalidation.eventHash;
  }
  const payload = structuredClone(state);
  delete payload.integrity;
  state.integrity = {
    algorithm: 'sha256',
    inputRoot,
    journalHash: sha256Text(JSON.stringify(payload))
  };
}

function visualResult(target, viewportId, screenshotRef, interactionRef) {
  return {
    target,
    viewport: structuredClone(VIEWPORT_DEFINITIONS[viewportId]),
    state: 'ready',
    passed: true,
    screenshotRef,
    interactionRef
  };
}

test('journal preserves attempt events, re-hashes evidence, acknowledges drift through invalidation, and locks writers', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);

  start(harness.statePath, 'tenant');
  let journal = loadJournal(harness.statePath, { allowWorkspaceDrift: true });
  const failedEvidence = staticMachineEvidence(harness, journal, 'tenant-failed', 'tenant-contract', false);
  mutateJournal(harness.statePath, (state) => {
    failJournalStage(state, 'tenant', 'The endpoint was unreachable.', ['tenant-contract=' + failedEvidence]);
  });
  start(harness.statePath, 'tenant');
  journal = loadJournal(harness.statePath, { allowWorkspaceDrift: true });
  const tenantContract = staticMachineEvidence(harness, journal, 'tenant', 'tenant-contract');
  const endpointCheck = staticMachineEvidence(harness, journal, 'tenant', 'endpoint-check');
  pass(harness.statePath, 'tenant', [
    'tenant-contract=' + tenantContract,
    'endpoint-check=' + endpointCheck
  ]);

  let state = loadJournal(harness.statePath);
  assert.equal(state.stages.tenant.attempts.length, 2);
  assert.equal(state.stages.tenant.attempts[0].events[1].kind, 'failed');
  assert.equal(state.stages.tenant.attempts[1].events[1].kind, 'passed');

  const endpointPath = path.join(harness.workspace, endpointCheck);
  const endpointOriginal = fs.readFileSync(endpointPath, 'utf8');
  writeText(endpointPath, '{"reachable":"tampered"}\n');
  assert.throws(() => loadJournal(harness.statePath), /changed after it was journaled/);
  writeText(endpointPath, endpointOriginal);

  writeText(path.join(harness.workspace, 'src', 'new-work.ts'), 'export const changed = true;\n');
  assert.throws(() => loadJournal(harness.statePath), /workspace changed outside a running journal stage/);
  mutateJournal(
    harness.statePath,
    (journal) => {
      invalidateJournalStages(journal, 'tenant', 'A deliberate frontend edit invalidated tenant and downstream evidence.');
    },
    { allowWorkspaceDrift: true }
  );
  state = loadJournal(harness.statePath);
  assert.equal(state.stages.tenant.attempts.length, 2);
  assert.equal(state.invalidations.length, 1);
  assert.equal(summarizeJournal(state).stages.tenant.status, 'pending');

  const lockPath = harness.statePath + '.lock';
  writeText(lockPath, '{"pid":123}\n');
  assert.throws(
    () => withJournalLock(harness.statePath, () => {}),
    /locked by another writer/
  );
  fs.unlinkSync(lockPath);

  const validationBackup = harness.validationPath + '.backup';
  fs.renameSync(harness.validationPath, validationBackup);
  fs.symlinkSync(validationBackup, harness.validationPath);
  assert.throws(() => loadJournal(harness.statePath), /validation report must be a regular, non-symlink file/i);
  fs.unlinkSync(harness.validationPath);
  fs.renameSync(validationBackup, harness.validationPath);

  const stateBackup = harness.statePath + '.backup';
  fs.renameSync(harness.statePath, stateBackup);
  fs.symlinkSync(stateBackup, harness.statePath);
  assert.throws(() => loadJournal(harness.statePath), /Run state must be a regular, non-symlink file/);
});

test('semantic replay rejects changed evidence even when every unkeyed journal hash is recomputed', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);
  const state = JSON.parse(fs.readFileSync(harness.statePath, 'utf8'));
  const tenantEvent = state.stages.tenant.attempts[0].events[1];
  const tenantEvidence = tenantEvent.evidence.find((evidence) => evidence.type === 'tenant-contract');
  writeText(tenantEvidence.path, '{"schemaVersion":1}\n');
  tenantEvidence.sha256 = sha256File(tenantEvidence.path);
  tenantEvidence.size = fs.statSync(tenantEvidence.path).size;
  tenantEvidence.references = [];
  recomputeJournalSealsForTest(state);
  writeJsonAtomic(harness.statePath, state);
  assert.throws(
    () => loadJournal(harness.statePath),
    /Tenant contract evidence must contain exactly/
  );
});

test('semantic replay rejects a fabricated terminal event with recomputed event and journal hashes', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  const state = JSON.parse(fs.readFileSync(harness.statePath, 'utf8'));
  const fabricatedPath = path.join(harness.harnessDirectory, 'evidence', 'fabricated-tenant.json');
  writeText(fabricatedPath, '{"schemaVersion":1}\n');
  const workspace = computeWorkspaceAttestation(harness.workspace);
  const timestamp = new Date().toISOString();
  state.stages.tenant.attempts.push({
    number: 1,
    events: [
      {
        kind: 'started',
        at: timestamp,
        workspaceBeforeSha256: workspace.sha256,
        previousHash: sha256Text('placeholder'),
        eventHash: sha256Text('placeholder')
      },
      {
        kind: 'passed',
        at: timestamp,
        evidence: [
          {
            type: 'tenant-contract',
            path: fabricatedPath,
            sha256: sha256File(fabricatedPath),
            size: fs.statSync(fabricatedPath).size,
            references: []
          }
        ],
        workspace: {
          sha256: workspace.sha256,
          fileCount: workspace.fileCount,
          gitHead: workspace.gitHead
        },
        previousHash: sha256Text('placeholder'),
        eventHash: sha256Text('placeholder')
      }
    ]
  });
  state.revision += 2;
  recomputeJournalSealsForTest(state);
  writeJsonAtomic(harness.statePath, state);
  assert.throws(
    () => loadJournal(harness.statePath),
    /Tenant contract evidence must contain exactly/
  );
});

function assertion(id, passed, requestRef, uiRef, contract = null) {
  return {
    id,
    passed,
    contract,
    requestRef,
    uiRef
  };
}

function scenarioResult(id, actors, assertions) {
  return {
    scenarioId: id,
    actorIds: actors,
    assertions
  };
}

function liveDocument(kind, results) {
  return {
    schemaVersion: 1,
    kind,
    tenantIds: ['tenant-primary', 'tenant-isolation'],
    results
  };
}

test('live and acceptance passes require complete machine evidence and concrete outcome artifacts', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);
  passTextStage(
    harness,
    'install',
    ['install-plan', 'install-log', 'manifest', 'package-provenance', 'blocks-check']
  );
  passTextStage(harness, 'domain', ['source-check', 'meta-contract']);
  passTextStage(harness, 'static', ['typecheck', 'build']);

  start(harness.statePath, 'live');
  const requestRef = writeRequestEvidence(harness, 'request.json');
  const uiRef = writeUiEvidence(harness, 'ui.json');
  const outside = path.join(harness.temporaryRoot, 'outside');
  fs.mkdirSync(outside);
  writeText(path.join(outside, 'escaped.json'), '{"escaped":true}\n');
  fs.symlinkSync(outside, path.join(harness.workspace, 'linked-outside'));
  const escapedSession = liveDocument(
    'constructive.builder-live-session-evidence',
    [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', true, 'linked-outside/escaped.json', uiRef)]
      )
    ]
  );
  const escapedSessionRef = writeEvidence(harness, 'live-session-escaped.json', JSON.stringify(escapedSession) + '\n');
  assert.throws(
    () => pass(harness.statePath, 'live', [
      'live-session=' + escapedSessionRef,
      'graphql=' + writeEvidence(harness, 'placeholder-graphql.json', '{}\n'),
      'rls=' + writeEvidence(harness, 'placeholder-rls.json', '{}\n')
    ]),
    /escapes through a symlinked parent directory/
  );
  fs.unlinkSync(path.join(harness.workspace, 'linked-outside'));

  const sessionDocument = liveDocument(
    'constructive.builder-live-session-evidence',
    [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', true, requestRef, uiRef)]
      )
    ]
  );
  const graphqlDocument = liveDocument(
    'constructive.builder-graphql-evidence',
    [
      scenarioResult(
        'auth-feature',
        ['owner'],
        [assertion('check:1', true, requestRef, uiRef, FEATURE_CONTRACT)]
      )
    ]
  );
  const rlsDocument = liveDocument(
    'constructive.builder-rls-evidence',
    [
      scenarioResult(
        'cross-policy',
        ['owner', 'cross'],
        [assertion('operation:read:deny', true, requestRef, uiRef)]
      )
    ]
  );
  const sessionRef = writeEvidence(harness, 'live-session.json', JSON.stringify(sessionDocument) + '\n');
  const graphqlRef = writeEvidence(harness, 'graphql.json', JSON.stringify(graphqlDocument) + '\n');
  const rlsRef = writeEvidence(harness, 'rls.json', JSON.stringify(rlsDocument) + '\n');
  const wrongContractDocument = structuredClone(graphqlDocument);
  wrongContractDocument.results[0].assertions[0].contract = null;
  const wrongContractRef = writeEvidence(
    harness,
    'graphql-wrong-contract.json',
    JSON.stringify(wrongContractDocument) + '\n'
  );
  assert.throws(
    () => pass(harness.statePath, 'live', [
      'live-session=' + sessionRef,
      'graphql=' + wrongContractRef,
      'rls=' + rlsRef
    ]),
    /assertion contract does not match the source-attested route/
  );
  pass(harness.statePath, 'live', [
    'live-session=' + sessionRef,
    'graphql=' + graphqlRef,
    'rls=' + rlsRef
  ]);
  start(harness.statePath, 'visual');
  const authTarget = { featurePack: 'auth', surfaceId: 'console', kind: 'surface' };
  const shellTarget = { surfaceId: 'console', kind: 'shell' };
  const incompleteScreenshot = writePngEvidence(
    harness,
    'visual-incomplete.png',
    VIEWPORT_DEFINITIONS.desktop
  );
  const incompleteInteraction = writeInteractionOutcome(
    harness,
    'visual-incomplete-interaction.json',
    authTarget,
    VIEWPORT_DEFINITIONS.desktop
  );
  const incompleteManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        authTarget,
        'desktop',
        incompleteScreenshot,
        incompleteInteraction
      )
    ]
  };
  const incompleteManifestRef = writeEvidence(
    harness,
    'visual-incomplete-manifest.json',
    JSON.stringify(incompleteManifest) + '\n'
  );
  assert.throws(
    () => pass(harness.statePath, 'visual', [
      'screenshot=' + incompleteManifestRef,
      'interaction=' + writeJsonEvidence(
        harness,
        'visual-incomplete-summary.json',
        interactionEvidenceFromVisualResults(incompleteManifest.results)
      )
    ]),
    /does not cover every target, viewport, and state/
  );
  const desktopScreenshot = writePngEvidence(harness, 'visual-desktop-ready.png', VIEWPORT_DEFINITIONS.desktop);
  const mobileScreenshot = writePngEvidence(harness, 'visual-mobile-ready.png', VIEWPORT_DEFINITIONS.mobile);
  const desktopInteraction = writeInteractionOutcome(
    harness,
    'visual-desktop-interaction.json',
    authTarget,
    VIEWPORT_DEFINITIONS.desktop
  );
  const mobileInteraction = writeInteractionOutcome(
    harness,
    'visual-mobile-interaction.json',
    authTarget,
    VIEWPORT_DEFINITIONS.mobile
  );
  const shellDesktopScreenshot = writePngEvidence(
    harness,
    'shell-desktop-ready.png',
    VIEWPORT_DEFINITIONS.desktop
  );
  const shellMobileScreenshot = writePngEvidence(
    harness,
    'shell-mobile-ready.png',
    VIEWPORT_DEFINITIONS.mobile
  );
  const shellDesktopInteraction = writeInteractionOutcome(
    harness,
    'shell-desktop-interaction.json',
    shellTarget,
    VIEWPORT_DEFINITIONS.desktop
  );
  const shellMobileInteraction = writeInteractionOutcome(
    harness,
    'shell-mobile-interaction.json',
    shellTarget,
    VIEWPORT_DEFINITIONS.mobile
  );
  const completeManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        authTarget,
        'desktop',
        desktopScreenshot,
        desktopInteraction
      ),
      visualResult(
        authTarget,
        'mobile',
        mobileScreenshot,
        mobileInteraction
      ),
      visualResult(
        shellTarget,
        'desktop',
        shellDesktopScreenshot,
        shellDesktopInteraction
      ),
      visualResult(
        shellTarget,
        'mobile',
        shellMobileScreenshot,
        shellMobileInteraction
      )
    ]
  };
  const completeManifestRef = writeEvidence(harness, 'visual-manifest.json', JSON.stringify(completeManifest) + '\n');
  const completeInteractionRef = writeJsonEvidence(
    harness,
    'visual-interaction-summary.json',
    interactionEvidenceFromVisualResults(completeManifest.results)
  );
  const pngHeaderStub = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngHeaderStub);
  pngHeaderStub.writeUInt32BE(13, 8);
  pngHeaderStub.write('IHDR', 12, 'ascii');
  pngHeaderStub.writeUInt32BE(VIEWPORT_DEFINITIONS.desktop.width, 16);
  pngHeaderStub.writeUInt32BE(VIEWPORT_DEFINITIONS.desktop.height, 20);
  const stubPath = '.constructive/harness/evidence/visual-header-stub.png';
  writeBytes(path.join(harness.workspace, stubPath), pngHeaderStub);
  const stubManifest = structuredClone(completeManifest);
  stubManifest.results[0].screenshotRef = stubPath;
  const stubManifestRef = writeJsonEvidence(harness, 'visual-header-stub-manifest.json', stubManifest);
  assert.throws(
    () => pass(harness.statePath, 'visual', [
      'screenshot=' + stubManifestRef,
      'interaction=' + completeInteractionRef
    ]),
    /complete PNG image/
  );
  pass(harness.statePath, 'visual', [
    'screenshot=' + completeManifestRef,
    'interaction=' + completeInteractionRef
  ]);

  start(harness.statePath, 'acceptance');
  const failedRequestRef = writeRequestEvidence(harness, 'acceptance-failed-request.json', 'auth', false);
  const failedUiRef = writeUiEvidence(harness, 'acceptance-failed-ui.json', false);
  const failedAcceptance = {
    schemaVersion: 1,
    kind: 'constructive.builder-acceptance-evidence',
    tenantIds: ['tenant-primary', 'tenant-isolation'],
    capabilities: [
      {
        surfaceId: 'console',
        featurePack: 'auth',
        expected: 'ready',
        actual: 'partial',
        passed: false,
        requestRef: failedRequestRef,
        uiRef: failedUiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', false, failedRequestRef, failedUiRef)]
      )
    ],
    limitations: [],
    verdict: 'fail'
  };
  const failedAcceptanceRef = writeEvidence(
    harness,
    'acceptance-failed.json',
    JSON.stringify(failedAcceptance) + '\n'
  );
  mutateJournal(harness.statePath, (state) => {
    failJournalStage(
      state,
      'acceptance',
      'Auth degraded unexpectedly.',
      ['evaluator=' + failedAcceptanceRef]
    );
  });

  start(harness.statePath, 'acceptance');
  const passedAcceptance = {
    schemaVersion: 1,
    kind: 'constructive.builder-acceptance-evidence',
    tenantIds: ['tenant-primary', 'tenant-isolation'],
    capabilities: [
      {
        surfaceId: 'console',
        featurePack: 'auth',
        expected: 'ready',
        actual: 'ready',
        passed: true,
        requestRef,
        uiRef
      }
    ],
    scenarios: [
      scenarioResult('auth-lifecycle', ['owner', 'revoked'], [assertion('sign-in', true, requestRef, uiRef)]),
      scenarioResult('auth-feature', ['owner'], [assertion('check:1', true, requestRef, uiRef, FEATURE_CONTRACT)]),
      scenarioResult('cross-policy', ['owner', 'cross'], [assertion('operation:read:deny', true, requestRef, uiRef)])
    ],
    limitations: [],
    verdict: 'pass'
  };
  const passedAcceptanceRef = writeEvidence(
    harness,
    'acceptance-passed.json',
    JSON.stringify(passedAcceptance) + '\n'
  );
  pass(harness.statePath, 'acceptance', ['evaluator=' + passedAcceptanceRef]);
  assert.equal(summarizeJournal(loadJournal(harness.statePath)).status, 'passed');
});

test('safe harness directories reject a symlinked parent escape', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-builder-path-'));
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(workspace, '.constructive'));
  assert.throws(
    () => ensureSafeWorkspaceDirectory(
      workspace,
      path.join(workspace, '.constructive', 'harness'),
      '.constructive/harness'
    ),
    /not a symlink/
  );
  assert.throws(
    () => ensureSafeWorkspaceDirectory(workspace, path.join(workspace, 'reports'), '.constructive/harness'),
    /must stay under/
  );
});

test('standalone Data can pass live proof with exact empty Auth and RLS result sets', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  const state = loadJournal(harness.statePath);
  state.resolved.compositionKind = 'standalone';
  state.resolved.installRoots = ['feature-pack-data'];
  state.resolved.surfaces = [
    {
      id: 'data-table',
      mountPath: '/data',
      roots: ['feature-pack-data'],
      featurePacks: ['data']
    }
  ];
  state.resolved.acceptance.isolationTenants = [];
  state.resolved.acceptance.actors = [state.resolved.acceptance.actors[0]];
  state.resolved.acceptance.scenarios = [
    {
      id: 'standalone-data',
      kind: 'feature',
      target: { kind: 'surface', surfaceId: 'data-table', featurePack: 'data' },
      actorIds: ['owner'],
      assertionIds: [
        'capability:data.meta:ready',
        'capability:data.introspection:ready'
      ]
    }
  ];
  state.stages.live.attempts.push({
    number: 1,
    events: [
      {
        kind: 'started',
        at: new Date().toISOString(),
        workspaceBeforeSha256: computeWorkspaceAttestation(harness.workspace).sha256
      }
    ]
  });
  const requestRef = writeRequestEvidence(harness, 'standalone-data-request.json', 'data');
  const uiRef = writeUiEvidence(harness, 'standalone-data-ui.json');
  const sessionRef = writeEvidence(
    harness,
    'standalone-live-session.json',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'constructive.builder-live-session-evidence',
      tenantIds: ['tenant-primary'],
      results: []
    }) + '\n'
  );
  const graphqlRef = writeEvidence(
    harness,
    'standalone-graphql.json',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'constructive.builder-graphql-evidence',
      tenantIds: ['tenant-primary'],
      results: [
        scenarioResult(
          'standalone-data',
          ['owner'],
          [
            assertion('capability:data.meta:ready', true, requestRef, uiRef),
            assertion('capability:data.introspection:ready', true, requestRef, uiRef)
          ]
        )
      ]
    }) + '\n'
  );
  const rlsRef = writeEvidence(
    harness,
    'standalone-rls.json',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'constructive.builder-rls-evidence',
      tenantIds: ['tenant-primary'],
      results: []
    }) + '\n'
  );
  passJournalStage(state, 'live', [
    'live-session=' + sessionRef,
    'graphql=' + graphqlRef,
    'rls=' + rlsRef
  ]);
  assert.equal(summarizeJournal(state).stages.live.status, 'passed');
});

test('blank Console core with no packs or domain routes journals exact empty live and acceptance sets', () => {
  const harness = createHarness();
  const validation = JSON.parse(fs.readFileSync(harness.validationPath, 'utf8'));
  validation.resolved.tenantProvenance = {
    kind: 'preset',
    preset: 'blank',
    frontendPresetRoot: null,
    featurePacks: []
  };
  validation.resolved.compositionKind = 'console-core';
  validation.resolved.installRoots = ['console-kit-core'];
  validation.resolved.surfaces = [
    {
      id: 'app-shell',
      mountPath: '/app',
      roots: ['console-kit-core'],
      featurePacks: [],
      surfaceTypes: ['core'],
      isConsole: true
    }
  ];
  validation.resolved.domainRoutes = [];
  validation.resolved.runtimeLimitations = [];
  validation.resolved.acceptance = {
    capabilities: [],
    isolationTenants: [],
    actors: [],
    scenarios: [],
    visualViewports: [
      VIEWPORT_DEFINITIONS.desktop,
      VIEWPORT_DEFINITIONS.mobile
    ],
    visualTargets: [
      {
        target: { kind: 'shell', surfaceId: 'app-shell' },
        viewports: ['desktop', 'mobile'],
        states: ['ready']
      }
    ]
  };
  const corePlanPath = validation.inputs.installPlans[0].path;
  writeJsonAtomic(corePlanPath, {
    schemaVersion: 1,
    kind: 'constructive.console-kit-install-plan',
    item: 'console-kit-core',
    install: {
      command: 'pnpm dlx shadcn@4.13.1 add @constructive/console-kit-core'
    },
    composition: {
      npmDependencies: [
        { name: '@constructive-io/data' },
        { name: 'zustand' }
      ]
    }
  });
  const corePlanSha256 = sha256File(corePlanPath);
  validation.inputs.installPlans[0].root = 'console-kit-core';
  validation.inputs.installPlans[0].sha256 = corePlanSha256;
  const planImmutable = validation.inputs.immutableFiles.find(
    (inputFile) => inputFile.path === corePlanPath
  );
  planImmutable.role = 'install-plan:console-kit-core';
  planImmutable.sha256 = corePlanSha256;
  validation.inputs.workspace = computeWorkspaceAttestation(harness.workspace);
  writeJsonAtomic(harness.validationPath, validation);
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);
  passTextStage(
    harness,
    'install',
    ['install-plan', 'install-log', 'manifest', 'package-provenance', 'blocks-check']
  );
  passTextStage(harness, 'domain', ['source-check', 'meta-contract']);
  passTextStage(harness, 'static', ['typecheck', 'build']);

  start(harness.statePath, 'live');
  const emptyLiveReferences = [];
  for (const evidenceType of ['live-session', 'graphql', 'rls']) {
    const kind = evidenceType === 'live-session'
      ? 'constructive.builder-live-session-evidence'
      : evidenceType === 'graphql'
        ? 'constructive.builder-graphql-evidence'
        : 'constructive.builder-rls-evidence';
    const reference = writeEvidence(
      harness,
      'empty-core-' + evidenceType + '.json',
      JSON.stringify({
        schemaVersion: 1,
        kind,
        tenantIds: ['tenant-primary'],
        results: []
      }) + '\n'
    );
    emptyLiveReferences.push(evidenceType + '=' + reference);
  }
  pass(harness.statePath, 'live', emptyLiveReferences);

  start(harness.statePath, 'visual');
  const emptyShellTarget = { kind: 'shell', surfaceId: 'app-shell' };
  const desktopScreenshot = writePngEvidence(harness, 'empty-shell-desktop.png', VIEWPORT_DEFINITIONS.desktop);
  const mobileScreenshot = writePngEvidence(harness, 'empty-shell-mobile.png', VIEWPORT_DEFINITIONS.mobile);
  const desktopInteraction = writeInteractionOutcome(
    harness,
    'empty-shell-desktop-interaction.json',
    emptyShellTarget,
    VIEWPORT_DEFINITIONS.desktop
  );
  const mobileInteraction = writeInteractionOutcome(
    harness,
    'empty-shell-mobile-interaction.json',
    emptyShellTarget,
    VIEWPORT_DEFINITIONS.mobile
  );
  const visualManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        emptyShellTarget,
        'desktop',
        desktopScreenshot,
        desktopInteraction
      ),
      visualResult(
        emptyShellTarget,
        'mobile',
        mobileScreenshot,
        mobileInteraction
      )
    ]
  };
  const visualRef = writeEvidence(harness, 'empty-shell-visual.json', JSON.stringify(visualManifest) + '\n');
  const interactionRef = writeJsonEvidence(
    harness,
    'empty-shell-interactions.json',
    interactionEvidenceFromVisualResults(visualManifest.results)
  );
  pass(harness.statePath, 'visual', [
    'screenshot=' + visualRef,
    'interaction=' + interactionRef
  ]);

  start(harness.statePath, 'acceptance');
  const evaluatorRef = writeEvidence(
    harness,
    'empty-shell-acceptance.json',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'constructive.builder-acceptance-evidence',
      tenantIds: ['tenant-primary'],
      capabilities: [],
      scenarios: [],
      limitations: [],
      verdict: 'pass'
    }) + '\n'
  );
  pass(harness.statePath, 'acceptance', ['evaluator=' + evaluatorRef]);
  assert.equal(summarizeJournal(loadJournal(harness.statePath)).status, 'passed');
});

test('a blocking source limitation prevents a false acceptance pass', () => {
  const harness = createHarness([
    {
      id: 'data-console-nested-sheets-store',
      status: 'open-pinned-source-gap',
      acceptance: 'blocking',
      failureState: 'known-nonconforming',
      observedBehavior: 'Console core plus nested Sheets store',
      portableRequirement: 'one host-owned store',
      mitigationRequirements: [
        {
          id: 'unify-console-store',
          requirement: 'Fix the Blocks source to use one Console store.'
        }
      ],
      sourceEvidence: [],
      surfaceIds: ['console']
    }
  ]);
  initializeJournal(harness.validationPath, harness.statePath);
  const requestRef = writeRequestEvidence(harness, 'limitation-request.json');
  const uiRef = writeUiEvidence(harness, 'limitation-ui.json');
  const document = {
    schemaVersion: 1,
    kind: 'constructive.builder-acceptance-evidence',
    tenantIds: ['tenant-primary', 'tenant-isolation'],
    capabilities: [
      {
        surfaceId: 'console',
        featurePack: 'auth',
        expected: 'ready',
        actual: 'ready',
        passed: true,
        requestRef,
        uiRef
      }
    ],
    scenarios: [
      scenarioResult('auth-lifecycle', ['owner', 'revoked'], [assertion('sign-in', true, requestRef, uiRef)]),
      scenarioResult('auth-feature', ['owner'], [assertion('check:1', true, requestRef, uiRef, FEATURE_CONTRACT)]),
      scenarioResult('cross-policy', ['owner', 'cross'], [assertion('operation:read:deny', true, requestRef, uiRef)])
    ],
    limitations: [
      {
        id: 'data-console-nested-sheets-store',
        status: 'open-pinned-source-gap',
        passed: false,
        requirements: [
          {
            id: 'unify-console-store',
            passed: false,
            requestRef,
            uiRef
          }
        ]
      }
    ],
    verdict: 'pass'
  };
  const evaluatorRef = writeEvidence(harness, 'limitation-evaluator.json', JSON.stringify(document) + '\n');
  const state = loadJournal(harness.statePath);
  state.stages.acceptance.attempts.push({
    number: 1,
    events: [
      {
        kind: 'started',
        at: new Date().toISOString(),
        workspaceBeforeSha256: computeWorkspaceAttestation(harness.workspace).sha256
      }
    ]
  });
  assert.throws(
    () => passJournalStage(state, 'acceptance', ['evaluator=' + evaluatorRef]),
    /cannot pass while the pinned Blocks source has a blocking runtime limitation/
  );
});

test('a require-mitigation source limitation can pass only with retained passing evidence', () => {
  const harness = createHarness([
    {
      id: 'organizations-meta-membership-false-ready',
      status: 'open-pinned-source-gap',
      acceptance: 'require-mitigation',
      failureState: 'unavailable',
      observedBehavior: 'Metadata can false-ready.',
      portableRequirement: 'Prove a readable membership root.',
      mitigationRequirements: [
        {
          id: 'prove-membership-root',
          requirement: 'Prove same-endpoint membership introspection.'
        },
        {
          id: 'execute-membership-root',
          requirement: 'Prove the selected membership operation executes.'
        }
      ],
      sourceEvidence: [],
      surfaceIds: ['console']
    }
  ]);
  initializeJournal(harness.validationPath, harness.statePath);
  const requestRef = writeRequestEvidence(harness, 'mitigation-request.json');
  const uiRef = writeUiEvidence(harness, 'mitigation-ui.json');
  const document = {
    schemaVersion: 1,
    kind: 'constructive.builder-acceptance-evidence',
    tenantIds: ['tenant-primary', 'tenant-isolation'],
    capabilities: [
      {
        surfaceId: 'console',
        featurePack: 'auth',
        expected: 'ready',
        actual: 'ready',
        passed: true,
        requestRef,
        uiRef
      }
    ],
    scenarios: [
      scenarioResult('auth-lifecycle', ['owner', 'revoked'], [assertion('sign-in', true, requestRef, uiRef)]),
      scenarioResult('auth-feature', ['owner'], [assertion('check:1', true, requestRef, uiRef, FEATURE_CONTRACT)]),
      scenarioResult('cross-policy', ['owner', 'cross'], [assertion('operation:read:deny', true, requestRef, uiRef)])
    ],
    limitations: [
      {
        id: 'organizations-meta-membership-false-ready',
        status: 'open-pinned-source-gap',
        passed: true,
        requirements: [
          {
            id: 'prove-membership-root',
            passed: true,
            requestRef,
            uiRef
          },
          {
            id: 'execute-membership-root',
            passed: true,
            requestRef,
            uiRef
          }
        ]
      }
    ],
    verdict: 'pass'
  };
  const evaluatorRef = writeEvidence(harness, 'mitigation-evaluator.json', JSON.stringify(document) + '\n');
  const state = loadJournal(harness.statePath);
  state.stages.acceptance.attempts.push({
    number: 1,
    events: [
      {
        kind: 'started',
        at: new Date().toISOString(),
        workspaceBeforeSha256: computeWorkspaceAttestation(harness.workspace).sha256
      }
    ]
  });
  const missingRequirementDocument = structuredClone(document);
  missingRequirementDocument.limitations[0].requirements.pop();
  const missingRequirementRef = writeEvidence(
    harness,
    'mitigation-missing-requirement.json',
    JSON.stringify(missingRequirementDocument) + '\n'
  );
  assert.throws(
    () => passJournalStage(state, 'acceptance', ['evaluator=' + missingRequirementRef]),
    /does not cover every source-attested mitigation requirement/
  );

  const failedRequirementDocument = structuredClone(document);
  failedRequirementDocument.limitations[0].requirements[1].passed = false;
  const failedRequirementRef = writeEvidence(
    harness,
    'mitigation-failed-requirement.json',
    JSON.stringify(failedRequirementDocument) + '\n'
  );
  assert.throws(
    () => passJournalStage(state, 'acceptance', ['evaluator=' + failedRequirementRef]),
    /passed state must equal its complete mitigation requirement results/
  );

  const extraRequirementDocument = structuredClone(document);
  extraRequirementDocument.limitations[0].requirements.push({
    id: 'invented-requirement',
    passed: true,
    requestRef,
    uiRef
  });
  const extraRequirementRef = writeEvidence(
    harness,
    'mitigation-extra-requirement.json',
    JSON.stringify(extraRequirementDocument) + '\n'
  );
  assert.throws(
    () => passJournalStage(state, 'acceptance', ['evaluator=' + extraRequirementRef]),
    /unexpected or duplicate mitigation requirement invented-requirement/
  );

  passJournalStage(state, 'acceptance', ['evaluator=' + evaluatorRef]);
  assert.equal(summarizeJournal(state).stages.acceptance.status, 'passed');
});
