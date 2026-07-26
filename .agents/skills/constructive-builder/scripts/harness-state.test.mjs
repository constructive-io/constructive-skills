import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  computeWorkspaceAttestation,
  ensureSafeWorkspaceDirectory,
  sha256File,
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

function createHarness(runtimeLimitations = []) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-builder-journal-'));
  const workspace = path.join(temporaryRoot, 'workspace');
  const harnessDirectory = path.join(workspace, '.constructive', 'harness');
  fs.mkdirSync(harnessDirectory, { recursive: true });
  const briefPath = path.join(workspace, 'brief.json');
  const tenantPath = path.join(workspace, 'tenant.json');
  const catalogPath = path.join(workspace, 'catalog.json');
  writeText(briefPath, '{"brief":true}\n');
  writeText(tenantPath, '{"tenant":true}\n');
  writeText(catalogPath, '{"catalog":true}\n');
  const immutableFiles = [
    { role: 'brief', path: briefPath, sha256: sha256File(briefPath) },
    { role: 'tenant', path: tenantPath, sha256: sha256File(tenantPath) },
    { role: 'blocks-contract', path: catalogPath, sha256: sha256File(catalogPath) }
  ];
  const resolved = {
    tenantId: 'tenant-primary',
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
          endpointKinds: ['auth']
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
      installPlans: [],
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
  const references = [];
  for (const type of types) {
    const relativePath = writeEvidence(harness, stage + '-' + type + '.txt');
    references.push(type + '=' + relativePath);
  }
  pass(harness.statePath, stage, references);
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
  const failedEvidence = writeEvidence(harness, 'tenant-failed.json', '{"reachable":false}\n');
  mutateJournal(harness.statePath, (state) => {
    failJournalStage(state, 'tenant', 'The endpoint was unreachable.', ['tenant-contract=' + failedEvidence]);
  });
  start(harness.statePath, 'tenant');
  const tenantContract = writeEvidence(harness, 'tenant-contract.json', '{"valid":true}\n');
  const endpointCheck = writeEvidence(harness, 'endpoint-check.json', '{"reachable":true}\n');
  pass(harness.statePath, 'tenant', [
    'tenant-contract=' + tenantContract,
    'endpoint-check=' + endpointCheck
  ]);

  let state = loadJournal(harness.statePath);
  assert.equal(state.stages.tenant.attempts.length, 2);
  assert.equal(state.stages.tenant.attempts[0].events[1].kind, 'failed');
  assert.equal(state.stages.tenant.attempts[1].events[1].kind, 'passed');

  const endpointPath = path.join(harness.workspace, endpointCheck);
  writeText(endpointPath, '{"reachable":"tampered"}\n');
  assert.throws(() => loadJournal(harness.statePath), /changed after it was journaled/);
  writeText(endpointPath, '{"reachable":true}\n');

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
  const requestRef = writeEvidence(harness, 'request.json', '{"status":200}\n');
  const uiRef = writeEvidence(harness, 'ui.json', '{"visible":true}\n');
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
  const incompleteScreenshot = writeEvidence(harness, 'visual-incomplete.png', 'incomplete image bytes\n');
  const incompleteInteraction = writeEvidence(harness, 'visual-incomplete-interaction.json', '{"passed":true}\n');
  const incompleteManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        { featurePack: 'auth', surfaceId: 'console', kind: 'surface' },
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
      'interaction=' + incompleteInteraction
    ]),
    /does not cover every target, viewport, and state/
  );
  const desktopScreenshot = writeEvidence(harness, 'visual-desktop-ready.png', 'desktop image bytes\n');
  const mobileScreenshot = writeEvidence(harness, 'visual-mobile-ready.png', 'mobile image bytes\n');
  const desktopInteraction = writeEvidence(harness, 'visual-desktop-interaction.json', '{"keyboard":true}\n');
  const mobileInteraction = writeEvidence(harness, 'visual-mobile-interaction.json', '{"touch":true}\n');
  const shellDesktopScreenshot = writeEvidence(harness, 'shell-desktop-ready.png', 'shell desktop bytes\n');
  const shellMobileScreenshot = writeEvidence(harness, 'shell-mobile-ready.png', 'shell mobile bytes\n');
  const shellDesktopInteraction = writeEvidence(harness, 'shell-desktop-interaction.json', '{"sidebar":true}\n');
  const shellMobileInteraction = writeEvidence(harness, 'shell-mobile-interaction.json', '{"navigation":true}\n');
  const completeManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        { featurePack: 'auth', surfaceId: 'console', kind: 'surface' },
        'desktop',
        desktopScreenshot,
        desktopInteraction
      ),
      visualResult(
        { featurePack: 'auth', surfaceId: 'console', kind: 'surface' },
        'mobile',
        mobileScreenshot,
        mobileInteraction
      ),
      visualResult(
        { surfaceId: 'console', kind: 'shell' },
        'desktop',
        shellDesktopScreenshot,
        shellDesktopInteraction
      ),
      visualResult(
        { surfaceId: 'console', kind: 'shell' },
        'mobile',
        shellMobileScreenshot,
        shellMobileInteraction
      )
    ]
  };
  const completeManifestRef = writeEvidence(harness, 'visual-manifest.json', JSON.stringify(completeManifest) + '\n');
  pass(harness.statePath, 'visual', [
    'screenshot=' + completeManifestRef,
    'interaction=' + writeEvidence(harness, 'visual-interaction-summary.json', '{"passed":true}\n')
  ]);

  start(harness.statePath, 'acceptance');
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
        requestRef,
        uiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', false, requestRef, uiRef)]
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
  const requestRef = writeEvidence(harness, 'standalone-data-request.json', '{"status":200}\n');
  const uiRef = writeEvidence(harness, 'standalone-data-ui.json', '{"tables":true}\n');
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
  const desktopScreenshot = writeEvidence(harness, 'empty-shell-desktop.png', 'desktop shell bytes\n');
  const mobileScreenshot = writeEvidence(harness, 'empty-shell-mobile.png', 'mobile shell bytes\n');
  const desktopInteraction = writeEvidence(harness, 'empty-shell-desktop-interaction.json', '{"sidebar":true}\n');
  const mobileInteraction = writeEvidence(harness, 'empty-shell-mobile-interaction.json', '{"navigation":true}\n');
  const visualManifest = {
    schemaVersion: 1,
    kind: 'constructive.builder-visual-evidence',
    results: [
      visualResult(
        { kind: 'shell', surfaceId: 'app-shell' },
        'desktop',
        desktopScreenshot,
        desktopInteraction
      ),
      visualResult(
        { kind: 'shell', surfaceId: 'app-shell' },
        'mobile',
        mobileScreenshot,
        mobileInteraction
      )
    ]
  };
  const visualRef = writeEvidence(harness, 'empty-shell-visual.json', JSON.stringify(visualManifest) + '\n');
  const interactionRef = writeEvidence(harness, 'empty-shell-interactions.json', '{"passed":true}\n');
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
  const requestRef = writeEvidence(harness, 'limitation-request.json', '{"status":200}\n');
  const uiRef = writeEvidence(harness, 'limitation-ui.json', '{"visible":true}\n');
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
  const requestRef = writeEvidence(harness, 'mitigation-request.json', '{"status":200}\n');
  const uiRef = writeEvidence(harness, 'mitigation-ui.json', '{"visible":true}\n');
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
