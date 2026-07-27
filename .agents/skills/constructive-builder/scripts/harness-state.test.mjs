import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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
  assertInstalledRegistryContent,
  assertPackageTarballComplete,
  assertPinnedExternalPackageResolution,
  assertPnpmLockResolution,
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
const AUTH_FEATURE_PACK_MANIFEST = {
  schemaVersion: 1,
  id: 'auth',
  label: 'Authentication',
  capabilities: {
    required: ['auth.credentials'],
    optional: []
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

function createPackageTarball(harness, name, version, fileName) {
  const staging = fs.mkdtempSync(path.join(harness.temporaryRoot, 'package-stage-'));
  const packageDirectory = path.join(staging, 'package');
  fs.mkdirSync(packageDirectory, { recursive: true });
  writeJsonAtomic(path.join(packageDirectory, 'package.json'), { name, version });
  const tarballRef = '.constructive/harness/evidence/' + fileName;
  const tarballPath = path.join(harness.workspace, tarballRef);
  fs.mkdirSync(path.dirname(tarballPath), { recursive: true });
  const archived = spawnSync('tar', ['-czf', tarballPath, '-C', staging, 'package'], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { COPYFILE_DISABLE: '1' })
  });
  assert.equal(archived.status, 0, archived.stderr);
  fs.rmSync(staging, { recursive: true, force: true });
  const bytes = fs.readFileSync(tarballPath);
  return {
    tarballRef,
    tarballSha256: sha256File(tarballPath),
    integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64')
  };
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
  writeJsonAtomic(path.join(workspace, 'components.json'), {
    style: 'base-nova',
    iconLibrary: 'lucide',
    tsx: true,
    aliases: {
      components: '@/components',
      utils: '@/lib/utils',
      ui: '@/components/ui',
      lib: '@/lib',
      hooks: '@/hooks'
    }
  });
  writeJsonAtomic(path.join(workspace, 'tsconfig.json'), {
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*']
      }
    }
  });
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
      ],
      files: [
        {
          target: 'src/installed/auth.ts',
          targetKind: 'literal',
          type: 'registry:lib',
          sources: [{ registryItem: 'auth-runtime', path: 'registry/constructive/lib/auth.ts' }]
        },
        {
          target: '@ui/auth-panel.tsx',
          targetKind: 'shadcn-alias',
          type: 'registry:ui',
          sources: [{ registryItem: 'auth-panel', path: 'registry/constructive/ui/auth-panel.tsx' }]
        },
        {
          target: '~/.constructive/feature-packs/auth.json',
          targetKind: 'project-root',
          type: 'registry:file',
          sources: [{ registryItem: 'feature-pack-auth', path: 'registry/constructive/feature-packs/auth.json' }]
        }
      ]
    },
    featurePacks: [AUTH_FEATURE_PACK_MANIFEST],
    verify: {
      commands: ['pnpm exec tsc --noEmit', 'pnpm build']
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

test('installed registry content permits only deterministic consumer alias rewriting', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-registry-content-'));
  const installedPath = path.join(temporaryRoot, 'consumer.ts');
  const sourceContent = "import { cn } from '@/lib/utils';\nexport const value = cn('ready');\n";
  const components = {
    aliases: {
      components: '#/components',
      utils: '#/shared/utils',
      ui: '#/components/ui',
      lib: '#/shared',
      hooks: '#/hooks'
    }
  };
  writeText(
    installedPath,
    "import { cn } from '#/shared/utils';\nexport const value = cn('ready');\n"
  );
  assert.doesNotThrow(() => {
    assertInstalledRegistryContent(
      installedPath,
      sourceContent,
      'registry/constructive/lib/consumer.ts',
      components
    );
  });
  writeText(installedPath, "export const value = 'fabricated';\n");
  assert.throws(
    () => assertInstalledRegistryContent(
      installedPath,
      sourceContent,
      'registry/constructive/lib/consumer.ts',
      components
    ),
    /does not match its generated registry source/
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('package provenance parsers reject YAML injection and noncanonical tar termination', () => {
  const integrity = 'sha512-dGVzdA==';
  const validLockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    "  'zustand@5.0.14':",
    '    resolution: {integrity: ' + integrity + '}',
    ''
  ].join('\n');
  assert.doesNotThrow(() => {
    assertPnpmLockResolution(validLockfile, 'zustand', '5.0.14', integrity);
  });
  const injectedLockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    "  'zustand@5.0.14':",
    '    note: "integrity: ' + integrity + '"',
    ''
  ].join('\n');
  assert.throws(
    () => assertPnpmLockResolution(injectedLockfile, 'zustand', '5.0.14', integrity),
    /one exact resolution declaration/
  );
  const duplicateResolutionLockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    "  'zustand@5.0.14':",
    '    resolution: {integrity: ' + integrity + '}',
    '    resolution: {}',
    ''
  ].join('\n');
  assert.throws(
    () => assertPnpmLockResolution(duplicateResolutionLockfile, 'zustand', '5.0.14', integrity),
    /one exact resolution declaration/
  );
  const aliasedResolutionLockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    "  'zustand@5.0.14':",
    '    resolution: *other',
    ''
  ].join('\n');
  assert.throws(
    () => assertPnpmLockResolution(aliasedResolutionLockfile, 'zustand', '5.0.14', integrity),
    /resolution must be a mapping/
  );
  const pinnedResolution = {
    name: 'zustand',
    version: '5.0.14',
    resolved: 'https://registry.npmjs.org/zustand/-/zustand-5.0.14.tgz',
    integrity
  };
  assert.doesNotThrow(() => {
    assertPinnedExternalPackageResolution(pinnedResolution, pinnedResolution);
  });
  const fabricatedResolution = structuredClone(pinnedResolution);
  fabricatedResolution.resolved = 'https://registry.example.test/zustand/fabricated.tgz';
  assert.throws(
    () => assertPinnedExternalPackageResolution(fabricatedResolution, pinnedResolution),
    /immutable npm registry attestation/
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-package-parser-'));
  const harness = { temporaryRoot, workspace: temporaryRoot };
  const tarball = createPackageTarball(
    harness,
    'fixture-package',
    '1.0.0',
    'fixture-package.tgz'
  );
  const tarballPath = path.join(temporaryRoot, tarball.tarballRef);
  assert.doesNotThrow(() => assertPackageTarballComplete(tarballPath));
  const archive = zlib.gunzipSync(fs.readFileSync(tarballPath));
  let terminator = -1;
  for (let offset = 0; offset + 512 <= archive.length; offset += 512) {
    if (archive.subarray(offset, offset + 512).every((byte) => byte === 0)) {
      terminator = offset;
      break;
    }
  }
  assert.notEqual(terminator, -1);
  archive[terminator + 512] = 1;
  const invalidTarballPath = path.join(temporaryRoot, 'invalid-termination.tgz');
  writeBytes(invalidTarballPath, zlib.gzipSync(archive));
  assert.throws(
    () => assertPackageTarballComplete(invalidTarballPath),
    /two zero records and only zero block padding/
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

function writeEvidence(harness, name, contents = 'evidence\n') {
  const relativePath = '.constructive/harness/evidence/' + name;
  writeText(path.join(harness.workspace, relativePath), contents);
  return relativePath;
}

function writeJsonEvidence(harness, name, document) {
  return writeEvidence(harness, name, JSON.stringify(document) + '\n');
}

function requestOutcome(context, statusCode = 200) {
  return {
    schemaVersion: 1,
    kind: 'constructive.builder-request-outcome',
    contextKey: context.contextKey,
    endpointKind: context.endpointKind,
    operation: context.operation,
    statusCode,
    checks: [{ id: context.checkId, passed: context.passed }],
    passed: context.passed
  };
}

function uiOutcome(context) {
  return {
    schemaVersion: 1,
    kind: 'constructive.builder-ui-outcome',
    contextKey: context.contextKey,
    state: context.state,
    visible: true,
    interactive: context.passed,
    checks: [{ id: context.checkId, passed: context.passed }],
    passed: context.passed
  };
}

function writeRequestEvidence(harness, name, context, statusCode = null) {
  const resolvedStatus = statusCode === null ? (context.passed ? 200 : 503) : statusCode;
  return writeJsonEvidence(harness, name, requestOutcome(context, resolvedStatus));
}

function writeUiEvidence(harness, name, context) {
  return writeJsonEvidence(harness, name, uiOutcome(context));
}

function endpointOutcomeContext(tenantId, endpointKind, passed = true) {
  return {
    contextKey: ['endpoint', tenantId, endpointKind].join('|'),
    endpointKind,
    operation: 'endpoint-check',
    state: passed ? 'ready' : 'error',
    checkId: 'endpoint:' + tenantId + ':' + endpointKind,
    passed
  };
}

function metaOutcomeContext(route, contractVersion, passed = true) {
  return {
    contextKey: ['meta', route.id, route.resource, contractVersion].join('|'),
    endpointKind: 'data',
    operation: 'meta-contract',
    state: passed ? 'ready' : 'error',
    checkId: 'meta-contract:' + route.id,
    passed
  };
}

function scenarioOutcomeContextForTest(state, scenarioId, assertionId, passed = true) {
  const scenario = state.resolved.acceptance.scenarios.find((candidate) => candidate.id === scenarioId);
  assert.ok(scenario, 'Expected scenario fixture ' + scenarioId + '.');
  const tenantIds = [];
  for (const actorId of scenario.actorIds) {
    const actor = state.resolved.acceptance.actors.find((candidate) => candidate.id === actorId);
    const tenantId = actor?.tenantScope?.databaseId || state.resolved.tenantId;
    if (!tenantIds.includes(tenantId)) {
      tenantIds.push(tenantId);
    }
  }
  const assertionContract = Array.isArray(scenario.assertionContracts)
    ? scenario.assertionContracts.find((entry) => entry.id === assertionId)?.contract
    : null;
  let endpointKind = assertionContract?.endpointKind || null;
  if (!endpointKind && (scenario.kind === 'crud' || scenario.kind === 'rls')) {
    endpointKind = 'data';
  }
  if (!endpointKind && scenario.kind === 'auth') {
    endpointKind = 'auth';
  }
  if (!endpointKind) {
    endpointKind = 'host';
  }
  let stateName = 'ready';
  if (assertionId.includes(':unavailable')) {
    stateName = 'unavailable';
  } else if (assertionId.includes(':deny') || assertionId.includes('revoked')) {
    stateName = 'unauthorized';
  }
  return {
    contextKey: [
      'scenario',
      scenario.id,
      assertionId,
      scenario.actorIds.join(','),
      tenantIds.join(',')
    ].join('|'),
    endpointKind,
    operation: assertionId,
    state: stateName,
    checkId: assertionId,
    passed
  };
}

function capabilityOutcomeContext(surfaceId, featurePack, expected, actual, passed = true) {
  return {
    contextKey: ['capability', surfaceId, featurePack, expected, actual].join('|'),
    endpointKind: 'host',
    operation: 'capability-state',
    state: actual,
    checkId: 'capability:' + surfaceId + ':' + featurePack,
    passed
  };
}

function limitationOutcomeContext(limitationId, requirementId, passed = true) {
  return {
    contextKey: ['limitation', limitationId, requirementId].join('|'),
    endpointKind: 'host',
    operation: 'mitigation',
    state: passed ? 'ready' : 'error',
    checkId: 'limitation:' + limitationId + ':' + requirementId,
    passed
  };
}

function writeOutcomePair(harness, name, context) {
  return {
    requestRef: writeRequestEvidence(harness, name + '-request.json', context),
    uiRef: writeUiEvidence(harness, name + '-ui.json', context)
  };
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

function interactionCheckIds(viewport, stateName) {
  const ids = [
    'keyboard-traversal',
    'focus-visibility',
    'overflow-containment',
    'diagnostics-containment'
  ];
  if (viewport.width <= 767) {
    ids.push('responsive-navigation', 'touch-targets');
  }
  if (stateName === 'error') {
    ids.push('retry-recovery');
  }
  if (stateName === 'ready' || stateName === 'populated') {
    ids.push('action-feedback');
  }
  return ids;
}

function writeInteractionOutcome(harness, name, target, viewport, passed = true, stateName = 'ready') {
  const targetKey = visualTargetKey(target, viewport, stateName);
  const checkIds = interactionCheckIds(viewport, stateName);
  return writeJsonEvidence(harness, name, {
    schemaVersion: 1,
    kind: 'constructive.builder-interaction-outcome',
    targetKey,
    viewportId: viewport.id,
    state: stateName,
    contextCheck: { id: 'interaction:' + targetKey, passed: true },
    checks: checkIds.map((id) => {
      return { id, passed };
    }),
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

function plannedTargetForTest(harness, file) {
  if (file.targetKind === 'literal') {
    return file.target;
  }
  if (file.targetKind === 'project-root') {
    return file.target.slice(2);
  }
  const match = /^@([^/]+)\/(.+)$/.exec(file.target);
  assert.ok(match, 'Expected a valid shadcn alias target fixture.');
  const components = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, 'components.json'), 'utf8')
  );
  const alias = components.aliases[match[1]];
  assert.equal(typeof alias, 'string');
  if (alias.startsWith('@/')) {
    return path.posix.join('src', alias.slice(2), match[2]);
  }
  return path.posix.join(alias, match[2]);
}

function writePlannedConsumerFiles(harness, state) {
  for (const plan of state.inputs.installPlans) {
    const document = JSON.parse(fs.readFileSync(plan.path, 'utf8'));
    for (const file of document.composition.files) {
      const target = plannedTargetForTest(harness, file);
      const manifest = document.featurePacks.find((candidate) => {
        return target === '.constructive/feature-packs/' + candidate.id + '.json';
      });
      if (manifest) {
        writeJsonAtomic(path.join(harness.workspace, target), manifest);
      } else {
        writeText(path.join(harness.workspace, target), 'installed ' + file.target + '\n');
      }
    }
  }
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
        const context = endpointOutcomeContext(tenant.id, endpointKind, resultPassed);
        const requestRef = writeRequestEvidence(
          harness,
          stage + '-' + tenant.id + '-' + endpointKind + '-request.json',
          context,
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
    writePlannedConsumerFiles(harness, state);
    const planByRoot = new Map();
    for (const plan of state.inputs.installPlans) {
      planByRoot.set(plan.root, JSON.parse(fs.readFileSync(plan.path, 'utf8')));
    }
    document = {
      schemaVersion: 1,
      kind: machineKind(type),
      preparation: [],
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
    const manifestsById = new Map();
    for (const plan of state.inputs.installPlans) {
      const planDocument = JSON.parse(fs.readFileSync(plan.path, 'utf8'));
      for (const manifest of planDocument.featurePacks) {
        manifestsById.set(manifest.id, manifest);
      }
    }
    for (const surface of state.resolved.surfaces) {
      for (const featurePack of surface.featurePacks) {
        const manifestRef = '.constructive/feature-packs/' + featurePack + '.json';
        writeJsonAtomic(
          path.join(harness.workspace, manifestRef),
          manifestsById.get(featurePack)
        );
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
    const packageFixtures = [];
    let packageIndex = 0;
    for (const name of names) {
      const packageJsonRef = path.posix.join('node_modules', name, 'package.json');
      const packageVersion = '0.0.0-test';
      const resolved = 'https://registry.example.test/' + encodeURIComponent(name) + '/-/' + packageIndex + '.tgz';
      writeJsonAtomic(path.join(harness.workspace, packageJsonRef), {
        name,
        version: packageVersion
      });
      const tarball = createPackageTarball(
        harness,
        name,
        packageVersion,
        stage + '-package-' + packageIndex + '.tgz'
      );
      packageFixtures.push({ name, version: packageVersion, resolved, tarball });
      packageIndex += 1;
    }
    const lockfileRef = 'pnpm-lock.yaml';
    const lockfileLines = ["lockfileVersion: '9.0'", '', 'packages:'];
    for (const fixture of packageFixtures) {
      lockfileLines.push(
        "  '" + fixture.name + '@' + fixture.version + "':",
        '    resolution: {integrity: ' + fixture.tarball.integrity + ', tarball: ' + fixture.resolved + '}',
        ''
      );
    }
    writeText(path.join(harness.workspace, lockfileRef), lockfileLines.join('\n'));
    const lockfileSha256 = sha256File(path.join(harness.workspace, lockfileRef));
    packageIndex = 0;
    for (const fixture of packageFixtures) {
      const name = fixture.name;
      const resolvedRef = '.constructive/harness/evidence/' + stage + '-package-' + packageIndex + '.json';
      const packageJsonRef = path.posix.join('node_modules', name, 'package.json');
      writeJsonEvidence(harness, path.basename(resolvedRef), {
        schemaVersion: 1,
        kind: 'constructive.builder-package-resolution',
        name,
        version: fixture.version,
        resolved: fixture.resolved,
        integrity: fixture.tarball.integrity,
        lockfileRef,
        lockfileSha256,
        tarballRef: fixture.tarball.tarballRef,
        tarballSha256: fixture.tarball.tarballSha256,
        packageJsonRef,
        packageJsonSha256: sha256File(path.join(harness.workspace, packageJsonRef))
      });
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
      outputRef: null,
      outputSha256: null,
      passed
    };
  } else if (type === 'source-check') {
    const results = [];
    for (const route of state.resolved.domainRoutes) {
      const routePath = route.path === '/' ? '' : route.path.replace(/^\/+|\/+$/g, '');
      const sourceRef = routePath
        ? path.posix.join('src', 'app', routePath, 'page.tsx')
        : path.posix.join('src', 'app', 'page.tsx');
      writeText(
        path.join(harness.workspace, sourceRef),
        'export default function Route() { return null; }\n'
      );
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
      const context = metaOutcomeContext(route, state.resolved.metaContractVersion, passed);
      const requestRef = writeRequestEvidence(
        harness,
        stage + '-' + route.id + '-meta.json',
        context
      );
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
      command: type === 'typecheck' ? 'pnpm exec tsc --noEmit' : 'pnpm build',
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
        sequence: state.revision + 1,
        at: timestamp,
        workspaceBeforeSha256: workspace.sha256,
        previousHash: sha256Text('placeholder'),
        eventHash: sha256Text('placeholder')
      },
      {
        kind: 'passed',
        sequence: state.revision + 2,
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

test('semantic replay rejects a passing event that omits a required evidence type', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  const state = JSON.parse(fs.readFileSync(harness.statePath, 'utf8'));
  const tenantContractRelative = staticMachineEvidence(
    harness,
    state,
    'fabricated-tenant-incomplete',
    'tenant-contract'
  );
  const tenantContractPath = path.join(harness.workspace, tenantContractRelative);
  const workspace = computeWorkspaceAttestation(harness.workspace);
  const timestamp = new Date().toISOString();
  state.stages.tenant.attempts.push({
    number: 1,
    events: [
      {
        kind: 'started',
        sequence: state.revision + 1,
        at: timestamp,
        workspaceBeforeSha256: workspace.sha256,
        previousHash: sha256Text('placeholder'),
        eventHash: sha256Text('placeholder')
      },
      {
        kind: 'passed',
        sequence: state.revision + 2,
        at: timestamp,
        evidence: [
          {
            type: 'tenant-contract',
            path: tenantContractPath,
            sha256: sha256File(tenantContractPath),
            size: fs.statSync(tenantContractPath).size,
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
    /does not contain every required type/
  );
});

test('global replay rejects a resealed invalidation that omits a downstream passed stage', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);
  passTextStage(
    harness,
    'install',
    ['install-plan', 'install-log', 'manifest', 'package-provenance', 'blocks-check']
  );
  writeText(path.join(harness.workspace, 'src', 'drift.ts'), 'export const drift = true;\n');
  mutateJournal(
    harness.statePath,
    (state) => {
      invalidateJournalStages(state, 'tenant', 'Invalidate tenant and every completed downstream stage.');
    },
    { allowWorkspaceDrift: true }
  );
  const state = JSON.parse(fs.readFileSync(harness.statePath, 'utf8'));
  assert.equal(state.invalidations[0].affected.at(-1).stage, 'install');
  state.invalidations[0].affected.pop();
  recomputeJournalSealsForTest(state);
  writeJsonAtomic(harness.statePath, state);
  assert.throws(
    () => loadJournal(harness.statePath),
    /invalidation affected set does not match global history/
  );
});

test('global replay rejects resealed stage events reordered ahead of prerequisites', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);
  const state = JSON.parse(fs.readFileSync(harness.statePath, 'utf8'));
  const briefTerminal = state.stages.brief.attempts[0].events[1];
  const tenantStart = state.stages.tenant.attempts[0].events[0];
  const briefSequence = briefTerminal.sequence;
  briefTerminal.sequence = tenantStart.sequence;
  tenantStart.sequence = briefSequence;
  recomputeJournalSealsForTest(state);
  writeJsonAtomic(harness.statePath, state);
  assert.throws(
    () => loadJournal(harness.statePath),
    /starts tenant before brief passes/
  );
});

test('install replay binds planned files, exact manifests, installed packages, and verification commands', () => {
  const harness = createHarness();
  initializeJournal(harness.validationPath, harness.statePath);
  passTextStage(harness, 'brief', ['validation']);
  passTextStage(harness, 'tenant', ['tenant-contract', 'endpoint-check']);

  start(harness.statePath, 'install');
  const installState = loadJournal(harness.statePath);
  const installTypes = [
    'install-plan',
    'install-log',
    'manifest',
    'package-provenance',
    'blocks-check'
  ];
  const installReferences = [];
  const installRefByType = new Map();
  for (const type of installTypes) {
    const reference = staticMachineEvidence(harness, installState, 'strict-install', type);
    installReferences.push(type + '=' + reference);
    installRefByType.set(type, reference);
  }

  const wrongManifestRef = writeJsonEvidence(
    harness,
    'wrong-location-auth-manifest.json',
    AUTH_FEATURE_PACK_MANIFEST
  );
  const manifestDocument = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, installRefByType.get('manifest')), 'utf8')
  );
  manifestDocument.results[0].manifestRef = wrongManifestRef;
  manifestDocument.results[0].sha256 = sha256File(path.join(harness.workspace, wrongManifestRef));
  const wrongManifestEvidenceRef = writeJsonEvidence(
    harness,
    'wrong-location-manifest-evidence.json',
    manifestDocument
  );
  assert.throws(
    () => pass(harness.statePath, 'install', installReferences.map((reference) => {
      return reference.startsWith('manifest=')
        ? 'manifest=' + wrongManifestEvidenceRef
        : reference;
    })),
    /exact project sidecar path/
  );

  const provenanceDocument = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, installRefByType.get('package-provenance')), 'utf8')
  );
  const originalPackageResult = provenanceDocument.packages[0];
  const originalReceipt = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, originalPackageResult.resolvedRef), 'utf8')
  );
  const tamperedTarballRef = '.constructive/harness/evidence/tampered-package.tgz';
  const originalTarball = fs.readFileSync(
    path.join(harness.workspace, originalReceipt.tarballRef)
  );
  writeBytes(
    path.join(harness.workspace, tamperedTarballRef),
    Buffer.concat([originalTarball, Buffer.from('fabricated')])
  );
  const tamperedReceipt = structuredClone(originalReceipt);
  tamperedReceipt.tarballRef = tamperedTarballRef;
  tamperedReceipt.tarballSha256 = sha256File(
    path.join(harness.workspace, tamperedTarballRef)
  );
  const tamperedReceiptRef = writeJsonEvidence(
    harness,
    'tampered-package-resolution.json',
    tamperedReceipt
  );
  const tamperedProvenance = structuredClone(provenanceDocument);
  tamperedProvenance.packages[0].resolvedRef = tamperedReceiptRef;
  tamperedProvenance.packages[0].sha256 = sha256File(
    path.join(harness.workspace, tamperedReceiptRef)
  );
  const tamperedProvenanceRef = writeJsonEvidence(
    harness,
    'tampered-package-provenance.json',
    tamperedProvenance
  );
  assert.throws(
    () => pass(harness.statePath, 'install', installReferences.map((reference) => {
      return reference.startsWith('package-provenance=')
        ? 'package-provenance=' + tamperedProvenanceRef
        : reference;
    })),
    /does not match its declared integrity/
  );
  const fakePackageJsonRef = '.constructive/harness/fake-package/package.json';
  writeJsonAtomic(path.join(harness.workspace, fakePackageJsonRef), {
    name: originalReceipt.name,
    version: originalReceipt.version
  });
  originalReceipt.packageJsonRef = fakePackageJsonRef;
  originalReceipt.packageJsonSha256 = sha256File(path.join(harness.workspace, fakePackageJsonRef));
  const fakeReceiptRef = writeJsonEvidence(
    harness,
    'fake-package-resolution.json',
    originalReceipt
  );
  originalPackageResult.resolvedRef = fakeReceiptRef;
  originalPackageResult.sha256 = sha256File(path.join(harness.workspace, fakeReceiptRef));
  const fakeProvenanceRef = writeJsonEvidence(
    harness,
    'fake-package-provenance.json',
    provenanceDocument
  );
  assert.throws(
    () => pass(harness.statePath, 'install', installReferences.map((reference) => {
      return reference.startsWith('package-provenance=')
        ? 'package-provenance=' + fakeProvenanceRef
        : reference;
    })),
    /exact installed path node_modules\//
  );

  fs.unlinkSync(path.join(harness.workspace, 'src', 'installed', 'auth.ts'));
  assert.throws(
    () => pass(harness.statePath, 'install', installReferences),
    /Planned consumer file src\/installed\/auth\.ts is missing/
  );
  writePlannedConsumerFiles(harness, installState);
  pass(harness.statePath, 'install', installReferences);

  passTextStage(harness, 'domain', ['source-check', 'meta-contract']);
  start(harness.statePath, 'static');
  const staticState = loadJournal(harness.statePath);
  const typecheckRef = staticMachineEvidence(harness, staticState, 'strict-static', 'typecheck');
  const buildRef = staticMachineEvidence(harness, staticState, 'strict-static', 'build');
  const typecheckDocument = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, typecheckRef), 'utf8')
  );
  typecheckDocument.command = 'true';
  const fakeTypecheckRef = writeJsonEvidence(
    harness,
    'fake-typecheck.json',
    typecheckDocument
  );
  assert.throws(
    () => pass(harness.statePath, 'static', [
      'typecheck=' + fakeTypecheckRef,
      'build=' + buildRef
    ]),
    /does not match the attested Blocks verification command/
  );
  pass(harness.statePath, 'static', [
    'typecheck=' + typecheckRef,
    'build=' + buildRef
  ]);
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
  const liveState = loadJournal(harness.statePath);
  const sessionContext = scenarioOutcomeContextForTest(
    liveState,
    'auth-lifecycle',
    'sign-in'
  );
  const graphqlContext = scenarioOutcomeContextForTest(
    liveState,
    'auth-feature',
    'check:1'
  );
  const rlsContext = scenarioOutcomeContextForTest(
    liveState,
    'cross-policy',
    'operation:read:deny'
  );
  const sessionRequestRef = writeRequestEvidence(harness, 'session-request.json', sessionContext);
  const sessionUiRef = writeUiEvidence(harness, 'session-ui.json', sessionContext);
  const graphqlRequestRef = writeRequestEvidence(harness, 'graphql-request.json', graphqlContext);
  const graphqlUiRef = writeUiEvidence(harness, 'graphql-ui.json', graphqlContext);
  const rlsRequestRef = writeRequestEvidence(harness, 'rls-request.json', rlsContext);
  const rlsUiRef = writeUiEvidence(harness, 'rls-ui.json', rlsContext);
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
        [assertion('sign-in', true, 'linked-outside/escaped.json', sessionUiRef)]
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
        [assertion('sign-in', true, sessionRequestRef, sessionUiRef)]
      )
    ]
  );
  const graphqlDocument = liveDocument(
    'constructive.builder-graphql-evidence',
    [
      scenarioResult(
        'auth-feature',
        ['owner'],
        [assertion('check:1', true, graphqlRequestRef, graphqlUiRef, FEATURE_CONTRACT)]
      )
    ]
  );
  const rlsDocument = liveDocument(
    'constructive.builder-rls-evidence',
    [
      scenarioResult(
        'cross-policy',
        ['owner', 'cross'],
        [assertion('operation:read:deny', true, rlsRequestRef, rlsUiRef)]
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
  const reusedContextDocument = structuredClone(graphqlDocument);
  reusedContextDocument.results[0].assertions[0].requestRef = sessionRequestRef;
  reusedContextDocument.results[0].assertions[0].uiRef = sessionUiRef;
  const reusedContextRef = writeEvidence(
    harness,
    'graphql-reused-context.json',
    JSON.stringify(reusedContextDocument) + '\n'
  );
  assert.throws(
    () => pass(harness.statePath, 'live', [
      'live-session=' + sessionRef,
      'graphql=' + reusedContextRef,
      'rls=' + rlsRef
    ]),
    /exact contextual check|contextKey does not match the evidence result/
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
  const opaqueInteractionDocument = JSON.parse(
    fs.readFileSync(path.join(harness.workspace, desktopInteraction), 'utf8')
  );
  opaqueInteractionDocument.checks = [{ id: 'interaction-worked', passed: true }];
  const opaqueInteractionRef = writeJsonEvidence(
    harness,
    'visual-opaque-interaction.json',
    opaqueInteractionDocument
  );
  const opaqueInteractionManifest = structuredClone(completeManifest);
  opaqueInteractionManifest.results[0].interactionRef = opaqueInteractionRef;
  const opaqueInteractionManifestRef = writeJsonEvidence(
    harness,
    'visual-opaque-interaction-manifest.json',
    opaqueInteractionManifest
  );
  const opaqueInteractionSummaryRef = writeJsonEvidence(
    harness,
    'visual-opaque-interaction-summary.json',
    interactionEvidenceFromVisualResults(opaqueInteractionManifest.results)
  );
  assert.throws(
    () => pass(harness.statePath, 'visual', [
      'screenshot=' + opaqueInteractionManifestRef,
      'interaction=' + opaqueInteractionSummaryRef
    ]),
    /every required behavior check|behavior checks must exactly equal/
  );
  const reusedScreenshotManifest = structuredClone(completeManifest);
  reusedScreenshotManifest.results[1].screenshotRef = desktopScreenshot;
  const reusedScreenshotManifestRef = writeJsonEvidence(
    harness,
    'visual-reused-screenshot.json',
    reusedScreenshotManifest
  );
  assert.throws(
    () => pass(harness.statePath, 'visual', [
      'screenshot=' + reusedScreenshotManifestRef,
      'interaction=' + completeInteractionRef
    ]),
    /reuses a screenshot across contextual results/
  );
  const duplicateDesktopInteraction = writeInteractionOutcome(
    harness,
    'visual-desktop-interaction-duplicate.json',
    authTarget,
    VIEWPORT_DEFINITIONS.desktop
  );
  const crossBoundInteractions = interactionEvidenceFromVisualResults(completeManifest.results);
  crossBoundInteractions.results[0].artifactRef = duplicateDesktopInteraction;
  const crossBoundInteractionRef = writeJsonEvidence(
    harness,
    'visual-cross-bound-interactions.json',
    crossBoundInteractions
  );
  assert.throws(
    () => pass(harness.statePath, 'visual', [
      'screenshot=' + completeManifestRef,
      'interaction=' + crossBoundInteractionRef
    ]),
    /must reference the same exact outcome/
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

  const validVisualStateText = fs.readFileSync(harness.statePath, 'utf8');
  const validInteractionSummaryText = fs.readFileSync(
    path.join(harness.workspace, completeInteractionRef),
    'utf8'
  );
  writeJsonAtomic(
    path.join(harness.workspace, completeInteractionRef),
    crossBoundInteractions
  );
  const crossBoundReplayState = JSON.parse(validVisualStateText);
  const visualEvent = crossBoundReplayState.stages.visual.attempts[0].events[1];
  const retainedInteraction = visualEvent.evidence.find(
    (entry) => entry.type === 'interaction'
  );
  retainedInteraction.sha256 = sha256File(retainedInteraction.path);
  retainedInteraction.size = fs.statSync(retainedInteraction.path).size;
  retainedInteraction.references[0] = {
    kind: 'interaction',
    path: path.join(harness.workspace, duplicateDesktopInteraction),
    sha256: sha256File(path.join(harness.workspace, duplicateDesktopInteraction)),
    size: fs.statSync(path.join(harness.workspace, duplicateDesktopInteraction)).size
  };
  const crossBoundWorkspace = computeWorkspaceAttestation(harness.workspace);
  visualEvent.workspace = {
    sha256: crossBoundWorkspace.sha256,
    fileCount: crossBoundWorkspace.fileCount,
    gitHead: crossBoundWorkspace.gitHead
  };
  recomputeJournalSealsForTest(crossBoundReplayState);
  writeJsonAtomic(harness.statePath, crossBoundReplayState);
  assert.throws(
    () => loadJournal(harness.statePath),
    /must reference the same exact outcome/
  );
  writeText(
    path.join(harness.workspace, completeInteractionRef),
    validInteractionSummaryText
  );
  writeText(harness.statePath, validVisualStateText);

  start(harness.statePath, 'acceptance');
  const failedCapabilityContext = capabilityOutcomeContext(
    'console',
    'auth',
    'ready',
    'partial',
    false
  );
  const failedScenarioContext = scenarioOutcomeContextForTest(
    liveState,
    'auth-lifecycle',
    'sign-in',
    false
  );
  const failedCapabilityRequestRef = writeRequestEvidence(
    harness,
    'acceptance-failed-capability-request.json',
    failedCapabilityContext
  );
  const failedCapabilityUiRef = writeUiEvidence(
    harness,
    'acceptance-failed-capability-ui.json',
    failedCapabilityContext
  );
  const failedScenarioRequestRef = writeRequestEvidence(
    harness,
    'acceptance-failed-scenario-request.json',
    failedScenarioContext
  );
  const failedScenarioUiRef = writeUiEvidence(
    harness,
    'acceptance-failed-scenario-ui.json',
    failedScenarioContext
  );
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
        requestRef: failedCapabilityRequestRef,
        uiRef: failedCapabilityUiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', false, failedScenarioRequestRef, failedScenarioUiRef)]
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
  const capabilityContext = capabilityOutcomeContext('console', 'auth', 'ready', 'ready');
  const capabilityRequestRef = writeRequestEvidence(
    harness,
    'acceptance-capability-request.json',
    capabilityContext
  );
  const capabilityUiRef = writeUiEvidence(
    harness,
    'acceptance-capability-ui.json',
    capabilityContext
  );
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
        requestRef: capabilityRequestRef,
        uiRef: capabilityUiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', true, sessionRequestRef, sessionUiRef)]
      ),
      scenarioResult(
        'auth-feature',
        ['owner'],
        [assertion('check:1', true, graphqlRequestRef, graphqlUiRef, FEATURE_CONTRACT)]
      ),
      scenarioResult(
        'cross-policy',
        ['owner', 'cross'],
        [assertion('operation:read:deny', true, rlsRequestRef, rlsUiRef)]
      )
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
  const metaContext = scenarioOutcomeContextForTest(
    state,
    'standalone-data',
    'capability:data.meta:ready'
  );
  const introspectionContext = scenarioOutcomeContextForTest(
    state,
    'standalone-data',
    'capability:data.introspection:ready'
  );
  const metaRequestRef = writeRequestEvidence(
    harness,
    'standalone-data-meta-request.json',
    metaContext
  );
  const metaUiRef = writeUiEvidence(
    harness,
    'standalone-data-meta-ui.json',
    metaContext
  );
  const introspectionRequestRef = writeRequestEvidence(
    harness,
    'standalone-data-introspection-request.json',
    introspectionContext
  );
  const introspectionUiRef = writeUiEvidence(
    harness,
    'standalone-data-introspection-ui.json',
    introspectionContext
  );
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
            assertion('capability:data.meta:ready', true, metaRequestRef, metaUiRef),
            assertion(
              'capability:data.introspection:ready',
              true,
              introspectionRequestRef,
              introspectionUiRef
            )
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
      ],
      files: [
        {
          target: 'src/installed/console-core.ts',
          targetKind: 'literal',
          type: 'registry:lib',
          sources: [{ registryItem: 'console-core', path: 'registry/constructive/lib/console-core.ts' }]
        }
      ]
    },
    featurePacks: [],
    verify: {
      commands: ['pnpm exec tsc --noEmit', 'pnpm build']
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
  const state = loadJournal(harness.statePath);
  const capabilityOutcome = writeOutcomePair(
    harness,
    'blocking-capability',
    capabilityOutcomeContext('console', 'auth', 'ready', 'ready')
  );
  const sessionOutcome = writeOutcomePair(
    harness,
    'blocking-session',
    scenarioOutcomeContextForTest(state, 'auth-lifecycle', 'sign-in')
  );
  const graphqlOutcome = writeOutcomePair(
    harness,
    'blocking-graphql',
    scenarioOutcomeContextForTest(state, 'auth-feature', 'check:1')
  );
  const rlsOutcome = writeOutcomePair(
    harness,
    'blocking-rls',
    scenarioOutcomeContextForTest(state, 'cross-policy', 'operation:read:deny')
  );
  const limitationOutcome = writeOutcomePair(
    harness,
    'blocking-limitation',
    limitationOutcomeContext('data-console-nested-sheets-store', 'unify-console-store', false)
  );
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
        requestRef: capabilityOutcome.requestRef,
        uiRef: capabilityOutcome.uiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', true, sessionOutcome.requestRef, sessionOutcome.uiRef)]
      ),
      scenarioResult(
        'auth-feature',
        ['owner'],
        [assertion('check:1', true, graphqlOutcome.requestRef, graphqlOutcome.uiRef, FEATURE_CONTRACT)]
      ),
      scenarioResult(
        'cross-policy',
        ['owner', 'cross'],
        [assertion('operation:read:deny', true, rlsOutcome.requestRef, rlsOutcome.uiRef)]
      )
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
            requestRef: limitationOutcome.requestRef,
            uiRef: limitationOutcome.uiRef
          }
        ]
      }
    ],
    verdict: 'pass'
  };
  const evaluatorRef = writeEvidence(harness, 'limitation-evaluator.json', JSON.stringify(document) + '\n');
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
  const state = loadJournal(harness.statePath);
  const capabilityOutcome = writeOutcomePair(
    harness,
    'mitigation-capability',
    capabilityOutcomeContext('console', 'auth', 'ready', 'ready')
  );
  const sessionOutcome = writeOutcomePair(
    harness,
    'mitigation-session',
    scenarioOutcomeContextForTest(state, 'auth-lifecycle', 'sign-in')
  );
  const graphqlOutcome = writeOutcomePair(
    harness,
    'mitigation-graphql',
    scenarioOutcomeContextForTest(state, 'auth-feature', 'check:1')
  );
  const rlsOutcome = writeOutcomePair(
    harness,
    'mitigation-rls',
    scenarioOutcomeContextForTest(state, 'cross-policy', 'operation:read:deny')
  );
  const proveOutcome = writeOutcomePair(
    harness,
    'mitigation-prove',
    limitationOutcomeContext(
      'organizations-meta-membership-false-ready',
      'prove-membership-root'
    )
  );
  const executeOutcome = writeOutcomePair(
    harness,
    'mitigation-execute',
    limitationOutcomeContext(
      'organizations-meta-membership-false-ready',
      'execute-membership-root'
    )
  );
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
        requestRef: capabilityOutcome.requestRef,
        uiRef: capabilityOutcome.uiRef
      }
    ],
    scenarios: [
      scenarioResult(
        'auth-lifecycle',
        ['owner', 'revoked'],
        [assertion('sign-in', true, sessionOutcome.requestRef, sessionOutcome.uiRef)]
      ),
      scenarioResult(
        'auth-feature',
        ['owner'],
        [assertion('check:1', true, graphqlOutcome.requestRef, graphqlOutcome.uiRef, FEATURE_CONTRACT)]
      ),
      scenarioResult(
        'cross-policy',
        ['owner', 'cross'],
        [assertion('operation:read:deny', true, rlsOutcome.requestRef, rlsOutcome.uiRef)]
      )
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
            requestRef: proveOutcome.requestRef,
            uiRef: proveOutcome.uiRef
          },
          {
            id: 'execute-membership-root',
            passed: true,
            requestRef: executeOutcome.requestRef,
            uiRef: executeOutcome.uiRef
          }
        ]
      }
    ],
    verdict: 'pass'
  };
  const evaluatorRef = writeEvidence(harness, 'mitigation-evaluator.json', JSON.stringify(document) + '\n');
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
  const failedExecuteOutcome = writeOutcomePair(
    harness,
    'mitigation-execute-failed',
    limitationOutcomeContext(
      'organizations-meta-membership-false-ready',
      'execute-membership-root',
      false
    )
  );
  failedRequirementDocument.limitations[0].requirements[1].requestRef = failedExecuteOutcome.requestRef;
  failedRequirementDocument.limitations[0].requirements[1].uiRef = failedExecuteOutcome.uiRef;
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
    requestRef: proveOutcome.requestRef,
    uiRef: proveOutcome.uiRef
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
