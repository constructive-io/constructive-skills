import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertBriefRoutes,
  assertEventStudioBlueprint,
  assertSnapshot,
  filterRegistryItems,
  loadPortableContract,
  parseNpmPackageRequirement,
  parseArguments,
  pinInspectorInstallCommand,
  projectRegistryCatalog,
  validateRegistryFilters
} from './check-blocks-contract.mjs';
import {
  changedReplacementPaths,
  parseArguments as parseSyncArguments
} from './sync-blocks-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(scriptDirectory, 'check-blocks-contract.mjs');
const runtimeReference = path.join(
  scriptDirectory,
  '../references/runtime-contract.md'
);
const briefRoutesReference = path.join(
  scriptDirectory,
  '../references/brief-to-roots.v1.json'
);

test('transactional Blocks contract synchronizer requires an explicit checkout', () => {
  assert.deepEqual(
    parseSyncArguments(['--blocks-repo', '/tmp/blocks', '--check']),
    {
      blocksRepo: '/tmp/blocks',
      check: true,
      refreshPackageResolutions: false,
      help: false
    }
  );
  assert.equal(
    parseSyncArguments([
      '--blocks-repo',
      '/tmp/blocks',
      '--refresh-package-resolutions'
    ]).refreshPackageResolutions,
    true
  );
  assert.throws(
    () => parseSyncArguments([]),
    /--blocks-repo is required/
  );
  assert.throws(
    () => parseSyncArguments(['--blocks-repo', '/tmp/blocks', '--check', '--check']),
    /--check may be provided only once/
  );
  assert.throws(
    () => parseSyncArguments(['--blocks-repo', '/tmp/blocks', '--unknown']),
    /Unknown argument --unknown/
  );
});

test('synchronizer check mode detects generated artifact drift', () => {
  const stageRoot = mkdtempSync(path.join(tmpdir(), 'blocks-contract-stage-'));
  const currentRoot = mkdtempSync(path.join(tmpdir(), 'blocks-contract-current-'));
  const contract = { source: { attestations: { installPlans: [] } } };
  const generatedPaths = [
    'references/registry-catalog.v1.json',
    'references/registry-content.v1.json',
    'references/package-resolutions.v1.json',
    'references/install-roots.v1.json'
  ];
  try {
    for (const relativePath of generatedPaths) {
      for (const root of [stageRoot, currentRoot]) {
        const filePath = path.join(root, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, 'same\n');
      }
    }
    assert.deepEqual(changedReplacementPaths(stageRoot, contract, currentRoot), []);
    writeFileSync(
      path.join(stageRoot, 'references/registry-catalog.v1.json'),
      'changed\n'
    );
    assert.deepEqual(changedReplacementPaths(stageRoot, contract, currentRoot), [
      'references/registry-catalog.v1.json'
    ]);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(currentRoot, { recursive: true, force: true });
  }
});

test('npm dependency requirements preserve exact versions while canonicalizing names', () => {
  assert.deepEqual(parseNpmPackageRequirement('@constructive-io/data@^0.5.0'), {
    name: '@constructive-io/data',
    requested: '^0.5.0',
    exactVersion: null
  });
  assert.deepEqual(parseNpmPackageRequirement('@tanstack/react-table@9.0.0-beta.58'), {
    name: '@tanstack/react-table',
    requested: '9.0.0-beta.58',
    exactVersion: '9.0.0-beta.58'
  });
  assert.deepEqual(parseNpmPackageRequirement('lucide-react'), {
    name: 'lucide-react',
    requested: null,
    exactVersion: null
  });
  assert.equal(
    pinInspectorInstallCommand(
      'pnpm dlx shadcn@latest add @constructive/app-kit-data',
      'app-kit-data'
    ),
    'pnpm dlx shadcn@4.13.1 add @constructive/app-kit-data'
  );
  assert.throws(
    () => pinInspectorInstallCommand(
      'pnpm dlx shadcn@next add @constructive/app-kit-data',
      'app-kit-data'
    ),
    /inspector install command changed/
  );
});

function appKitCatalogFixture() {
  return [
    'app-kit-core',
    'app-kit-data',
    'app-kit-board',
    'app-kit-dashboard',
    'app-kit-calendar',
    'app-kit-workflow',
    'app-kit-event-studio'
  ].map((name) => ({
    name,
    meta: {
      constructive: {
        family: 'app-kit',
        kind: name === 'app-kit-event-studio' ? 'starter' : 'view'
      }
    }
  }));
}

function runQuery(arguments_) {
  const output = execFileSync(process.execPath, [checker].concat(arguments_), {
    cwd: '/',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output);
}

function runQueryFailure(arguments_) {
  const result = spawnSync(process.execPath, [checker].concat(arguments_), {
    cwd: '/',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.notEqual(result.status, 0, `Expected query to fail: ${arguments_.join(' ')}`);
  return result.stderr;
}

test('portable artifacts validate as one complete contract', () => {
  const loaded = loadPortableContract();
  assert.equal(loaded.snapshot.registry.catalog.itemCount, 123);
  assert.equal(loaded.snapshot.items.length, 19);
  assert.equal(loaded.artifacts.planByItem.size, 19);
  assert.equal(
    loaded.artifacts.catalog.items.length,
    loaded.snapshot.registry.catalog.itemCount
  );
  assert.equal(
    loaded.artifacts.registryContent.records.length,
    loaded.artifacts.registryContent.recordCount
  );
  assert.equal(
    loaded.artifacts.contentBySource.size,
    loaded.artifacts.registryContent.recordCount
  );
  assert.equal(
    loaded.artifacts.packageResolutions.records.length,
    loaded.artifacts.packageResolutions.recordCount
  );
  assert.equal(
    loaded.artifacts.packageByName.size,
    loaded.artifacts.packageResolutions.recordCount
  );
  assert.equal(loaded.snapshot.sourceLimitations.length, 15);
  assert.equal(loaded.briefRouteById.size, 7);
  assert.equal(loaded.eventStudioBlueprint.tables.length, 5);
  for (const rootName of [
    'app-kit-core',
    'app-kit-data',
    'app-kit-board',
    'app-kit-dashboard',
    'app-kit-calendar',
    'app-kit-workflow',
    'app-kit-event-studio'
  ]) {
    const item = loaded.artifacts.catalog.items.find(
      (candidate) => candidate.name === rootName
    );
    assert.ok(item, `Missing ${rootName} from the registry catalog.`);
    for (const file of item.files) {
      assert.ok(
        loaded.artifacts.contentBySource.has(`${rootName}\0${file.path}`),
        `Missing content attestation for ${rootName}/${file.path}.`
      );
    }
  }
  for (const packageName of [
    '@tanstack/charts',
    '@tanstack/charts-scales',
    '@tanstack/react-charts',
    'd3-scale'
  ]) {
    assert.ok(
      loaded.artifacts.packageByName.has(packageName),
      `Missing package attestation for ${packageName}.`
    );
  }
});

test('App Kit catalog filters use meta.constructive without a parallel root list', () => {
  const metadata = (overrides) => ({
    version: 1,
    family: 'app-kit',
    kind: 'view',
    boundary: 'client',
    provider: 'app-kit',
    dataShapes: ['collection'],
    intents: ['inspect'],
    capabilities: ['records'],
    ...overrides
  });
  const items = [
    {
      name: 'app-kit-data',
      type: 'registry:block',
      meta: { constructive: metadata({ capabilities: ['records', 'relations'] }) }
    },
    {
      name: 'app-kit-calendar',
      type: 'registry:block',
      meta: { constructive: metadata({ dataShapes: ['temporal'], capabilities: ['temporal'] }) }
    },
    {
      name: 'feature-pack-data',
      type: 'registry:block'
    }
  ];
  assert.deepEqual(
    filterRegistryItems(items, { family: 'app-kit' }).map((item) => item.name),
    ['app-kit-data', 'app-kit-calendar']
  );
  assert.deepEqual(
    filterRegistryItems(items, { capability: 'temporal' }).map((item) => item.name),
    ['app-kit-calendar']
  );
  assert.deepEqual(
    filterRegistryItems(items, {
      type: 'registry:block',
      family: 'app-kit',
      capability: 'relations'
    }).map((item) => item.name),
    ['app-kit-data']
  );
  assert.deepEqual(validateRegistryFilters(items), {
    families: ['app-kit'],
    capabilities: ['records', 'relations', 'temporal']
  });
  assert.deepEqual(validateRegistryFilters(items, { family: 'app-kit' }), {
    families: ['app-kit'],
    capabilities: ['records', 'relations', 'temporal']
  });
  assert.throws(
    () => validateRegistryFilters(items, { family: 'application-kit' }),
    /Unknown registry family application-kit.*Available families: app-kit/
  );
  assert.throws(
    () => validateRegistryFilters(items, {
      family: 'app-kit',
      capability: 'time-range'
    }),
    /Unknown registry capability time-range for family app-kit/
  );

  const options = parseArguments([
    '--list-registry',
    '--family',
    'app-kit',
    '--capability',
    'temporal'
  ]);
  assert.equal(options.registryFamily, 'app-kit');
  assert.equal(options.registryCapability, 'temporal');
  assert.throws(
    () => parseArguments(['--registry-item', 'app-kit-data', '--family', 'app-kit']),
    /valid only with --list-registry/
  );

  const registryItem = {
    name: 'app-kit-data',
    type: 'registry:block',
    title: 'App Kit Data',
    description: 'Typed application data views.',
    meta: {
      constructive: metadata({
        kind: 'resource',
        boundary: 'mixed',
        capabilities: ['records', 'relations']
      })
    }
  };
  const projection = projectRegistryCatalog({ items: [registryItem] });
  assert.deepEqual(
    projection.items[0].meta.constructive,
    registryItem.meta.constructive
  );
  const invalid = structuredClone(registryItem);
  delete invalid.meta.constructive.provider;
  assert.throws(
    () => projectRegistryCatalog({ items: [invalid] }),
    /provider must be app-kit/
  );
  const invalidFamily = structuredClone(registryItem);
  invalidFamily.meta.constructive.family = 'platform';
  assert.throws(
    () => projectRegistryCatalog({ items: [invalidFamily] }),
    /family must be app-kit/
  );
  const invalidRoot = structuredClone(registryItem);
  invalidRoot.name = 'app-kit-map';
  assert.throws(
    () => projectRegistryCatalog({ items: [invalidRoot] }),
    /without being an App Kit install root/
  );
});

test('loaded catalog backs validated App Kit family and capability queries', () => {
  const family = runQuery(['--list-registry', '--family', 'app-kit']);
  assert.deepEqual(
    family.items.map((item) => item.name),
    [
      'app-kit-core',
      'app-kit-data',
      'app-kit-board',
      'app-kit-dashboard',
      'app-kit-calendar',
      'app-kit-workflow',
      'app-kit-event-studio'
    ]
  );
  const temporal = runQuery([
    '--list-registry',
    '--family',
    'app-kit',
    '--capability',
    'temporal'
  ]);
  assert.deepEqual(
    temporal.items.map((item) => item.name),
    ['app-kit-calendar']
  );
  assert.match(
    runQueryFailure(['--list-registry', '--family', 'application-kit']),
    /Unknown registry family application-kit.*Available families: app-kit/
  );
  assert.match(
    runQueryFailure([
      '--list-registry',
      '--family',
      'app-kit',
      '--capability',
      'time-range'
    ]),
    /Unknown registry capability time-range for family app-kit/
  );
});

test('brief routes select App Kit by shape instead of Sheets, Console, or review queues', () => {
  const briefRoutes = JSON.parse(readFileSync(briefRoutesReference, 'utf8'));
  const catalogItems = appKitCatalogFixture();
  const briefRouteById = assertBriefRoutes(briefRoutes, catalogItems);
  for (const route of briefRoutes.cases) {
    assert.equal(
      route.expectedRoots[0],
      route.starterRequested ? 'app-kit-event-studio' : 'app-kit-core'
    );
    assert.ok(route.expectedRoots.every((root) => root.startsWith('app-kit-')));
    assert.ok(route.forbiddenRoots.includes('feature-pack-data'));
    assert.ok(route.forbiddenRoots.includes('console-kit-nextjs'));
    if (!route.starterRequested) {
      assert.ok(route.forbiddenRoots.includes('app-kit-event-studio'));
    }
  }
  assert.ok(
    briefRouteById.get('intake-approval').forbiddenAssumptions.includes(
      'review-queue-default'
    )
  );
  assert.deepEqual(
    briefRouteById.get('event-planning').expectedRoots,
    [
      'app-kit-core',
      'app-kit-data',
      'app-kit-board',
      'app-kit-dashboard',
      'app-kit-calendar',
      'app-kit-workflow'
    ]
  );
  assert.equal(
    briefRouteById.get('event-planning').starterRequested,
    false
  );
  assert.deepEqual(
    briefRouteById.get('event-studio-opt-in').expectedRoots,
    ['app-kit-event-studio']
  );
  assert.equal(
    briefRouteById.get('event-studio-opt-in').starterRequested,
    true
  );
  assert.equal(
    briefRouteById.get('event-studio-opt-in').backendPreset,
    'b2b'
  );

  const missingOptIn = structuredClone(briefRoutes);
  missingOptIn.cases.find((route) => route.id === 'event-studio-opt-in')
    .starterRequested = false;
  assert.throws(
    () => assertBriefRoutes(missingOptIn, catalogItems),
    /only with explicit starterRequested opt-in/
  );
});

test('Event Studio remains a public org-scoped blueprint without realtime or raw SQL', () => {
  const loaded = loadPortableContract();
  assertEventStudioBlueprint(loaded.eventStudioBlueprint);

  const realtimeMutation = structuredClone(loaded.eventStudioBlueprint);
  realtimeMutation.tables[0].nodes.push('DataRealtime');
  assert.throws(
    () => assertEventStudioBlueprint(realtimeMutation),
    /must not enable realtime/
  );

  const deleteMutation = structuredClone(loaded.eventStudioBlueprint);
  deleteMutation.tables[0].policies = deleteMutation.tables[0].policies.filter(
    (policy) => policy.data?.is_owner !== true
  );
  assert.throws(
    () => assertEventStudioBlueprint(deleteMutation),
    /is_owner delete policy/
  );

  const fieldMutation = structuredClone(loaded.eventStudioBlueprint);
  fieldMutation.tables.find((table) => table.table_name === 'sessions')
    .fields.find((field) => field.name === 'description').name = 'summary';
  assert.throws(
    () => assertEventStudioBlueprint(fieldMutation),
    /sessions fields drifted/
  );

  const uniquenessMutation = structuredClone(loaded.eventStudioBlueprint);
  uniquenessMutation.unique_constraints = [];
  assert.throws(
    () => assertEventStudioBlueprint(uniquenessMutation),
    /Event Studio relation uniqueness drifted/
  );

  const statusMutation = structuredClone(loaded.eventStudioBlueprint);
  statusMutation.tables.find((table) => table.table_name === 'sessions')
    .fields.find((field) => field.name === 'status').type.name = 'session_status';
  assert.throws(
    () => assertEventStudioBlueprint(statusMutation),
    /sessions status type drifted/
  );
});

test('module endpoint and adapter drift fail closed', () => {
  const loaded = loadPortableContract();
  const endpointMutation = structuredClone(loaded.snapshot);
  const billing = endpointMutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'billing'
  );
  billing.required[0].alternatives[0].endpointKinds[0] = 'admin';
  assert.throws(
    () => assertSnapshot(endpointMutation),
    /billing required bindings drifted/
  );

  const adapterMutation = structuredClone(loaded.snapshot);
  const notifications = adapterMutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'notifications'
  );
  notifications.adapterSources.length = 0;
  assert.throws(
    () => assertSnapshot(adapterMutation),
    /notifications\.adapterSources count drifted/
  );
});

test('standalone Data cannot regress to the generic no-discovery contract', () => {
  const loaded = loadPortableContract();
  const mutation = structuredClone(loaded.snapshot);
  mutation.standaloneContracts.data.discovery = 'none';
  assert.throws(
    () => assertSnapshot(mutation),
    /Standalone Data discovery drifted/
  );
});

test('standalone Data conditional configuration remains complete and exact', () => {
  const loaded = loadPortableContract();
  assert.deepEqual(loaded.snapshot.standaloneContracts.data.conditionalConfig, {
    standaloneAuth: ['authEndpoint', 'databaseId'],
    embeddedAuth: ['auth.getToken']
  });

  const standaloneMutation = structuredClone(loaded.snapshot);
  standaloneMutation.standaloneContracts.data.conditionalConfig.standaloneAuth = [
    'authEndpoint'
  ];
  assert.throws(
    () => assertSnapshot(standaloneMutation),
    /Standalone Data conditional config drifted/
  );

  const embeddedMutation = structuredClone(loaded.snapshot);
  embeddedMutation.standaloneContracts.data.conditionalConfig.embeddedAuth = [];
  assert.throws(
    () => assertSnapshot(embeddedMutation),
    /Standalone Data conditional config drifted/
  );
});

test('the shadcn CLI policy remains an exact pin', () => {
  const loaded = loadPortableContract();
  const mutation = structuredClone(loaded.snapshot);
  mutation.registry.shadcnVersionPolicy = 'minimum';
  assert.throws(
    () => assertSnapshot(mutation),
    /shadcnVersionPolicy must be exact/
  );

  const legacyMutation = structuredClone(loaded.snapshot);
  legacyMutation.registry.minimumShadcnVersion = '4.13.1';
  assert.throws(
    () => assertSnapshot(legacyMutation),
    /minimumShadcnVersion is forbidden/
  );
});

test('fresh-checkout bootstrap preflights tracked source before generation', () => {
  const loaded = loadPortableContract();
  const sequence = loaded.snapshot.release.localConsumption.bootstrapSequence;
  assert.match(sequence[0], /--source-preflight$/);
  assert.match(sequence[1], /install --frozen-lockfile$/);
  assert.match(sequence[2], /build:registry$/);
  assert.match(sequence[3], /pack:local$/);
  assert.doesNotMatch(sequence[4], /--source-preflight/);

  const options = parseArguments([
    '--blocks-repo',
    '/tmp/pinned-blocks',
    '--source-preflight'
  ]);
  assert.equal(options.sourcePreflight, true);
  assert.equal(options.blocksRepo, '/tmp/pinned-blocks');
  assert.throws(
    () => parseArguments(['--source-preflight']),
    /requires --blocks-repo/
  );
});

test('the Data nested-store source limitation cannot be hidden', () => {
  const loaded = loadPortableContract();
  assert.equal(
    loaded.snapshot.hostOwnedStore.currentSourceConformance.status,
    'nonconforming-when-data-installed'
  );
  assert.equal(
    loaded.snapshot.hostOwnedStore.currentSourceConformance.dataModuleStoreSlice,
    false
  );

  const mutation = structuredClone(loaded.snapshot);
  mutation.hostOwnedStore.currentSourceConformance.status = 'conforming';
  assert.throws(
    () => assertSnapshot(mutation),
    /Current Data store conformance must remain explicit/
  );
});

test('Data provider-global locale and logger state requires single-provider isolation', () => {
  const loaded = loadPortableContract();
  const limitation = loaded.snapshot.sourceLimitations.find(
    (candidate) => candidate.id === 'data-provider-global-locale-logger'
  );
  assert.deepEqual(limitation.appliesTo.installRoots, [
    'feature-pack-data',
    'console-module-data',
    'preset-auth-hardened',
    'preset-b2b-storage',
    'preset-full',
    'console-kit-nextjs'
  ]);
  assert.equal(limitation.acceptance, 'require-mitigation');

  const mutation = structuredClone(loaded.snapshot);
  mutation.sourceLimitations.find(
    (candidate) => candidate.id === 'data-provider-global-locale-logger'
  ).appliesTo.installRoots.length = 1;
  assert.throws(
    () => assertSnapshot(mutation),
    /data-provider-global-locale-logger\.appliesTo drifted/
  );
});

test('standalone Data auth fallback and Organizations false-ready gaps fail closed', () => {
  const loaded = loadPortableContract();
  const authLimitation = loaded.snapshot.sourceLimitations.find(
    (limitation) =>
      limitation.id === 'data-standalone-auth-endpoint-fallback'
  );
  assert.deepEqual(authLimitation.appliesTo.installRoots, ['feature-pack-data']);
  assert.equal(authLimitation.failureState, 'configuration-error-before-render');

  const authMutation = structuredClone(loaded.snapshot);
  authMutation.standaloneContracts.data.authEndpointPolicy.portableBehavior =
    'allow-data-endpoint-fallback';
  assert.throws(
    () => assertSnapshot(authMutation),
    /Standalone Data authEndpoint policy drifted/
  );

  const organizationsLimitation = loaded.snapshot.sourceLimitations.find(
    (limitation) =>
      limitation.id === 'organizations-meta-membership-false-ready'
  );
  assert.ok(
    organizationsLimitation.appliesTo.installRoots.includes(
      'console-module-organizations'
    )
  );
  assert.equal(organizationsLimitation.failureState, 'unavailable');

  const organizationsMutation = structuredClone(loaded.snapshot);
  organizationsMutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'organizations'
  ).sourceLimitationIds.length = 0;
  assert.throws(
    () => assertSnapshot(organizationsMutation),
    /Organizations source limitation links drifted/
  );
});

test('validated query surfaces replace both known-wrong Data registry descriptions', () => {
  const registryList = runQuery(['--list-registry', '--type', 'registry:block']);
  const featureQueries = [
    runQuery(['--registry-item', 'feature-pack-data']),
    runQuery(['--root', 'feature-pack-data']),
    registryList.items.find((item) => item.name === 'feature-pack-data')
  ];
  for (const query of featureQueries) {
    const docs = query.plan ? query.plan.registryDocumentation : query.docs;
    assert.doesNotMatch(docs, /provider-neutral(?: data)? view/i);
    assert.doesNotMatch(docs, /host owns Sheets state/i);
    assert.match(docs, /adapter-driven Sheets view/);
    assert.match(docs, /authEndpoint/);
  }

  const moduleQueries = [
    runQuery(['--registry-item', 'console-module-data']),
    runQuery(['--root', 'console-module-data']),
    registryList.items.find((item) => item.name === 'console-module-data')
  ];
  for (const query of moduleQueries) {
    const docs = query.plan ? query.plan.registryDocumentation : query.docs;
    assert.doesNotMatch(docs, /provider-neutral(?: data)? view/i);
    assert.doesNotMatch(docs, /host owns Sheets state/i);
    assert.match(docs, /adapter-driven Data view/);
    assert.match(docs, /nested Sheets Zustand store/);
  }

  const item = featureQueries[0];
  assert.deepEqual(
    item.sourceLimitations.map((limitation) => limitation.id),
    [
      'data-provider-global-locale-logger',
      'data-standalone-auth-endpoint-fallback',
      'data-standalone-database-scope-fallback',
      'data-standalone-persistent-token-storage',
      'data-standalone-csrf-auth-unavailable'
    ]
  );
  assert.equal(item.metaContract.coordinate, 'Query._meta');
});

test('query mode validates first and is independent of the current directory', () => {
  const item = runQuery(['--registry-item', 'app-shell']);
  assert.equal(item.name, 'app-shell');
  assert.equal(
    item.publicInstall.command,
    'pnpm dlx shadcn@4.13.1 add @constructive/app-shell'
  );
  assert.equal(item.publicInstall.status, 'blocked');
  assert.equal(item.publicInstall.availability, 'future-only');
  assert.equal(Object.hasOwn(item, 'installCommand'), false);
  assert.ok(
    item.registryDependencies.includes('@constructive/app-bar')
  );

  const root = runQuery(['--root', 'feature-pack-data']);
  assert.equal(root.kind, 'constructive.blocks-install-root');
  assert.equal(root.plan.item, 'feature-pack-data');
  assert.equal(
    root.portableContract.standalone.contract.discovery,
    'internal-data-schema'
  );
  assert.equal(root.portableContract.consoleStore, null);
  assert.equal(root.portableContract.metaContract.coordinate, 'Query._meta');
  assert.equal(root.runtimeStatus.status, 'conditionally-blocked');
  assert.equal(root.runtimeStatus.unconditionallyBlocked, false);
  assert.equal(Object.hasOwn(root.runtimeStatus, 'blocked'), false);
  assert.equal(root.publicInstall.status, 'blocked');
  assert.equal(root.plan.install.publicInstall.status, 'blocked');
  assert.equal(Object.hasOwn(root.plan.install, 'command'), false);

  const consoleRoot = runQuery(['--root', 'console-module-data']);
  assert.equal(
    consoleRoot.portableContract.consoleStore.currentSourceConformance.status,
    'nonconforming-when-data-installed'
  );
  assert.deepEqual(
    consoleRoot.portableContract.sourceLimitations.map(
      (limitation) => limitation.id
    ),
    [
      'data-console-nested-sheets-store',
      'data-provider-global-locale-logger'
    ]
  );
  assert.equal(consoleRoot.portableContract.metaContract.coordinate, 'Query._meta');
  assert.equal(consoleRoot.runtimeStatus.status, 'blocked');
  assert.equal(consoleRoot.runtimeStatus.unconditionallyBlocked, true);

  const organizationsRoot = runQuery(['--root', 'console-module-organizations']);
  assert.deepEqual(
    organizationsRoot.portableContract.sourceLimitations.map(
      (limitation) => limitation.id
    ),
    [
      'organizations-meta-membership-false-ready',
      'organizations-adapter-shape-false-ready'
    ]
  );
});

test('every query mode exposes the same branch-only installability gate', () => {
  const outputs = [
    runQuery(['--list-roots']),
    runQuery(['--root', 'feature-pack-auth']),
    runQuery(['--list-registry']),
    runQuery(['--registry-item', 'app-shell'])
  ];
  for (const output of outputs) {
    const gate = output.installability;
    assert.equal(gate.releaseStatus, 'branch-only');
    assert.equal(gate.publicRegistryReady, false);
    assert.equal(gate.publicInstall.status, 'blocked');
    assert.equal(gate.publicInstall.availability, 'future-only');
    assert.match(
      gate.publicInstall.commandTemplate,
      /shadcn@4\.13\.1 add @constructive\/\{name\}/
    );
    assert.equal(
      gate.pinnedLocalConsumption.sourceCommit,
      '706ae32b8b03cd6effaa9d0d5f385d93529635df'
    );
    assert.equal(
      gate.pinnedLocalConsumption.consumerIsolation.required,
      true
    );
    assert.equal(
      gate.pinnedLocalConsumption.lockfile.frozenInstallRequired,
      true
    );
    assert.match(
      gate.pinnedLocalConsumption.lockfile.installCommand,
      /install --frozen-lockfile$/
    );
    assert.match(
      gate.pinnedLocalConsumption.installCommandTemplate,
      /shadcn add @constructive\/\{name\}/
    );
  }
});

test('query surfaces expose only status-bearing publicInstall commands', () => {
  const rootList = runQuery(['--list-roots']);
  const root = runQuery(['--root', 'feature-pack-auth']);
  const registryList = runQuery(['--list-registry']);
  const registryItem = runQuery(['--registry-item', 'app-shell']);
  const publicInstalls = rootList.items.map((item) => item.publicInstall)
    .concat(root.publicInstall)
    .concat(root.plan.install.publicInstall)
    .concat(registryList.items.map((item) => item.publicInstall))
    .concat(registryItem.publicInstall);
  for (const publicInstall of publicInstalls) {
    assert.equal(publicInstall.status, 'blocked');
    assert.equal(publicInstall.availability, 'future-only');
    assert.match(publicInstall.command, /^pnpm dlx shadcn@4\.13\.1 add @constructive\//);
    assert.match(publicInstall.reason, /branch-only/);
  }
  for (const item of rootList.items) {
    assert.equal(Object.hasOwn(item, 'installCommand'), false);
  }
  for (const item of registryList.items) {
    assert.equal(Object.hasOwn(item, 'installCommand'), false);
  }
  assert.equal(Object.hasOwn(root.plan.install, 'command'), false);
  assert.equal(Object.hasOwn(registryItem, 'installCommand'), false);
});

test('list queries expose Data metadata and runtime-mode-aware blockers', () => {
  const roots = runQuery(['--list-roots']);
  const registry = runQuery(['--list-registry']);
  assert.equal(roots.metaContract.version, '2026-07');
  assert.equal(roots.metaContract.coordinate, 'Query._meta');
  assert.equal(registry.metaContract.version, '2026-07');
  assert.equal(registry.metaContract.coordinate, 'Query._meta');

  const data = roots.items.find((item) => item.name === 'feature-pack-data');
  assert.equal(Object.hasOwn(data, 'blocked'), false);
  assert.equal(data.runtimeStatus.status, 'conditionally-blocked');
  assert.equal(data.runtimeStatus.unconditionallyBlocked, false);
  assert.equal(Object.hasOwn(data.runtimeStatus, 'blocked'), false);
  assert.deepEqual(data.runtimeStatus.unconditionalBlockerIds, []);
  assert.deepEqual(data.runtimeStatus.conditionalBlockerIds, [
    'data-standalone-persistent-token-storage',
    'data-standalone-csrf-auth-unavailable'
  ]);
  assert.deepEqual(data.runtimeStatus.modes, [
    {
      id: 'embedded',
      status: 'mitigation-required',
      blockingLimitationIds: [],
      mitigationRequiredLimitationIds: [
        'data-provider-global-locale-logger'
      ]
    },
    {
      id: 'standalone-auth',
      status: 'blocked',
      blockingLimitationIds: [
        'data-standalone-persistent-token-storage'
      ],
      mitigationRequiredLimitationIds: [
        'data-provider-global-locale-logger',
        'data-standalone-auth-endpoint-fallback',
        'data-standalone-database-scope-fallback'
      ]
    },
    {
      id: 'standalone-auth-csrf-required',
      status: 'blocked',
      blockingLimitationIds: [
        'data-standalone-persistent-token-storage',
        'data-standalone-csrf-auth-unavailable'
      ],
      mitigationRequiredLimitationIds: [
        'data-provider-global-locale-logger',
        'data-standalone-auth-endpoint-fallback',
        'data-standalone-database-scope-fallback'
      ]
    }
  ]);
  assert.deepEqual(
    data.sourceLimitationAcceptances.map((entry) => entry.acceptance),
    [
      'require-mitigation',
      'require-mitigation',
      'require-mitigation',
      'blocking',
      'blocking'
    ]
  );
  const consoleData = roots.items.find(
    (item) => item.name === 'console-module-data'
  );
  assert.equal(Object.hasOwn(consoleData, 'blocked'), false);
  assert.equal(consoleData.runtimeStatus.status, 'blocked');
  assert.equal(consoleData.runtimeStatus.unconditionallyBlocked, true);
  assert.deepEqual(consoleData.runtimeStatus.unconditionalBlockerIds, [
    'data-console-nested-sheets-store'
  ]);
  const auth = roots.items.find((item) => item.name === 'feature-pack-auth');
  assert.equal(auth.runtimeStatus.unconditionallyBlocked, false);
  assert.deepEqual(auth.sourceLimitationIds, []);
});

test('root queries expose standalone pack vocabulary, adapter profiles, and backend provenance', () => {
  const standalone = runQuery(['--root', 'feature-pack-auth']);
  const pack = standalone.portableContract.standalone.contract.pack;
  assert.equal(pack.component, 'AuthFeaturePack');
  assert.equal(pack.propsType, 'AuthFeaturePackProps');
  assert.ok(pack.policyKeys.includes('signIn'));
  assert.deepEqual(pack.actionInputs[0], [
    'signIn',
    '{ email; password; rememberMe? }'
  ]);
  assert.ok(pack.viewState.controlled.includes('mode:onModeChange'));
  assert.deepEqual(pack.requiredProps, ['view']);
  assert.equal(pack.resourceProps.includes('view'), false);
  assert.deepEqual(pack.resourceProps, ['account']);

  const organizations = runQuery(['--root', 'console-module-organizations']);
  const profiles = organizations.portableContract.adapterProfiles;
  assert.ok(
    profiles.contracts.some(
      (profile) => profile.id === 'relay-forward-connection'
    )
  );
  assert.deepEqual(
    profiles.actions.map((profile) => profile.id),
    ['organizations-enabled-actions']
  );
  assert.equal(
    organizations.backendPresetSource.commit,
    '0b30917f77284d61b5c997c3aa15195c6018ea87'
  );
  assert.equal(
    organizations.backendPresetSource.verification,
    'portable-attestation-no-live-repository-required'
  );
});

test('every Data-bearing query surface returns the exact pinned _meta shape and documents', () => {
  const expected = loadPortableContract().snapshot.metaContract;
  const outputs = [
    runQuery(['--list-roots']).metaContract,
    runQuery(['--list-registry']).metaContract,
    runQuery(['--registry-item', 'feature-pack-data']).metaContract,
    runQuery(['--registry-item', 'console-module-data']).metaContract,
    runQuery(['--root', 'feature-pack-data']).portableContract.metaContract,
    runQuery(['--root', 'console-module-data']).portableContract.metaContract
  ];
  for (const contract of outputs) assert.deepEqual(contract, expected);
  assert.equal(Object.keys(expected.requirements).length, 27);
  assert.deepEqual(expected.requirements.metaScope, {
    typeName: 'MetaScope',
    fields: ['scope', 'tier', 'keyColumn', 'entityTable', 'source']
  });
  assert.deepEqual(expected.documents.metaQuery, {
    sourceConstant: 'META_QUERY_SOURCE',
    operationName: 'ConstructiveMeta',
    byteLength: 2885,
    sha256: '8b5b46f141f8303ffafac5fbb4f34103a363d8a0755d1fba16199bbf3b78f7ee'
  });
});

test('_meta alias, type, field, and document drift all fail closed', () => {
  const loaded = loadPortableContract();
  const mutations = [
    (contract) => {
      contract.requirements.legacyScope = contract.requirements.metaScope;
      delete contract.requirements.metaScope;
    },
    (contract) => { contract.requirements.metaScope.typeName = 'LegacyScope'; },
    (contract) => contract.requirements.metaScope.fields.pop(),
    (contract) => { contract.documents.metaQuery.sha256 = '0'.repeat(64); },
    (contract) => { contract.documents.contractIntrospection.byteLength = 1; }
  ];
  for (const mutate of mutations) {
    const mutation = structuredClone(loaded.snapshot);
    mutate(mutation.metaContract);
    assert.throws(
      () => assertSnapshot(mutation),
      /metaContract\.(requirements|documents) drifted/
    );
  }
});

test('standalone Data query exposes its complete props and view-state contract', () => {
  const root = runQuery(['--root', 'feature-pack-data']);
  const contract = root.portableContract.standalone.contract;
  assert.equal(
    contract.importTarget,
    'src/blocks/feature-packs/data/data-feature-pack.tsx'
  );
  assert.equal(contract.propsType, 'DataFeaturePackProps');
  assert.deepEqual(contract.resourceProps, []);
  assert.deepEqual(contract.configProps, ['config']);
  assert.deepEqual(contract.requiredProps, ['config']);
  assert.deepEqual(contract.optionalProps, [
    'activeTable',
    'defaultActiveTable',
    'applicationScopes',
    'includeTables',
    'excludeTables',
    'pageSize',
    'onActiveTableChange',
    'onCreateTable',
    'onEvent',
    'sheetsProps'
  ]);
  assert.deepEqual(contract.deprecatedProps, []);
  assert.deepEqual(contract.propConstraints, []);
  assert.deepEqual(contract.viewState.controlled, [
    'activeTable:onActiveTableChange'
  ]);
  assert.deepEqual(contract.viewState.defaults, [
    'activeTable:defaultActiveTable',
    'pageSize=50'
  ]);
  assert.deepEqual(contract.viewState.required, ['config']);
  assert.deepEqual(contract.viewState.hostResourceState, []);
  assert.deepEqual(contract.viewState.hostViewInputs, [
    'applicationScopes',
    'includeTables',
    'excludeTables',
    'pageSize'
  ]);
  assert.ok(contract.propVocabulary.includes('sheetsProps'));

  const mutation = structuredClone(loadPortableContract().snapshot);
  mutation.standaloneContracts.data.viewState.controlled.length = 0;
  assert.throws(
    () => assertSnapshot(mutation),
    /Standalone Data view contract drifted/
  );
});

test('all seven standalone roots expose exact prop partitions and state ownership', () => {
  const expected = {
    data: {
      required: ['config'],
      controlled: ['activeTable:onActiveTableChange'],
      defaults: ['activeTable:defaultActiveTable', 'pageSize=50']
    },
    auth: {
      required: ['view'],
      controlled: ['mode:onModeChange', 'accountSection:onAccountSectionChange'],
      defaults: ['mode=sign-in', 'accountSection:defaultAccountSection=profile']
    },
    users: {
      required: ['resource'],
      controlled: ['section:onSectionChange'],
      defaults: ['section:defaultSection=members', 'title=App access']
    },
    organizations: {
      required: ['resource'],
      controlled: [
        'section:onSectionChange',
        'createOrganizationOpen:onCreateOrganizationOpenChange'
      ],
      defaults: [
        'section:defaultSection=members',
        'createOrganizationOpen=false',
        'developerView=all'
      ]
    },
    storage: {
      required: ['resource'],
      controlled: [],
      defaults: ['createBucket.access=private']
    },
    billing: {
      required: ['account', 'resources', 'formatOptions'],
      controlled: [
        'section:onSectionChange',
        'controls.pricing.interval:actions.onPricingIntervalChange',
        'controls.history.meterSlug:actions.onHistoryMeterChange',
        'controls.history.period:actions.onHistoryPeriodChange',
        'controls.activity.meterSlug:actions.onActivityMeterChange',
        'controls.activity.entryType:actions.onActivityEntryTypeChange'
      ],
      defaults: [
        'section:defaultSection=overview',
        'controls.pricing.interval:controls.pricing.defaultInterval|first-available',
        'showHeader=true'
      ]
    },
    notifications: {
      required: ['resource'],
      controlled: [],
      defaults: ['filter=all']
    }
  };
  for (const [packId, state] of Object.entries(expected)) {
    const root = runQuery(['--root', `feature-pack-${packId}`]);
    const wrapped = root.portableContract.standalone.contract;
    const contract = packId === 'data' ? wrapped : wrapped.pack;
    assert.deepEqual(
      contract.propVocabulary,
      contract.requiredProps.concat(contract.optionalProps)
    );
    assert.deepEqual(contract.requiredProps, state.required);
    assert.deepEqual(contract.viewState.required, state.required);
    assert.deepEqual(contract.viewState.controlled, state.controlled);
    assert.deepEqual(contract.viewState.defaults, state.defaults);
    assert.ok(Array.isArray(contract.deprecatedProps));
    assert.ok(Array.isArray(contract.propConstraints));
    assert.ok(Array.isArray(contract.viewState.hostResourceState));
    assert.ok(Array.isArray(contract.viewState.hostViewInputs));
    assert.ok(contract.viewState.local.length > 0);
  }

  const billing = runQuery(['--root', 'feature-pack-billing'])
    .portableContract.standalone.contract.pack;
  assert.deepEqual(billing.resourceProps, ['account', 'resources']);
  assert.deepEqual(billing.configProps, ['formatOptions', 'messages']);
  assert.deepEqual(billing.propConstraints, [
    {
      kind: 'mutually-exclusive',
      props: ['section', 'defaultSection']
    }
  ]);
});

test('standalone prop partitions and state ownership fail closed on drift', () => {
  const loaded = loadPortableContract();
  const mutations = [
    (snapshot) => snapshot.standaloneContracts.data.requiredProps.pop(),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.auth.resourceProps.push('view'),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.users.optionalProps.pop(),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.organizations.viewState.defaults.pop(),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.storage.viewState.hostResourceState.pop(),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.billing.propConstraints.pop(),
    (snapshot) => snapshot.standaloneContracts.nonData.packs.notifications.viewState.defaults.pop()
  ];
  for (const mutate of mutations) {
    const mutation = structuredClone(loaded.snapshot);
    mutate(mutation);
    assert.throws(
      () => assertSnapshot(mutation),
      /(Standalone Data view contract|Non-Data standalone pack summaries) drifted/
    );
  }
});

test('Auth adapter readiness fails closed on every fixed operation dimension', () => {
  const loaded = loadPortableContract();
  const mutations = [
    (requirements) => requirements[0].requiredArguments.pop(),
    (requirements) => { requirements[0].inputType = 'LegacySignInInput'; },
    (requirements) => requirements[0].requiredInputFields.pop(),
    (requirements) => requirements[0].conditionalInputFields.pop(),
    (requirements) => { requirements[0].requiredPayloadPath = null; },
    (requirements) => requirements[0].requiredPayloadFields.pop(),
    (requirements) => requirements[0].selectedPayloadFields.pop(),
    (requirements) => requirements[5].requiredFields.pop()
  ];
  for (const mutate of mutations) {
    const mutation = structuredClone(loaded.snapshot);
    const binding = mutation.consoleModuleBindings.find(
      (candidate) => candidate.featurePack === 'auth'
    );
    mutate(binding.adapterRequirements);
    assert.throws(
      () => assertSnapshot(mutation),
      /auth\.adapterRequirements drifted/
    );
  }
});

test('connection, alternative-path, and action-document shape drift fails closed', () => {
  const loaded = loadPortableContract();

  const connectionMutation = structuredClone(loaded.snapshot);
  connectionMutation.adapterContractProfiles[
    'relay-forward-connection'
  ].requiredPageInfoFields.pop();
  assert.throws(
    () => assertSnapshot(connectionMutation),
    /Adapter contract profiles drifted/
  );

  const pathMutation = structuredClone(loaded.snapshot);
  const organizations = pathMutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'organizations'
  );
  organizations.required[0].alternatives[0].adapterPathGroup = 'wrong-path';
  assert.throws(
    () => assertSnapshot(pathMutation),
    /alternative path group drifted/
  );

  const actionMutation = structuredClone(loaded.snapshot);
  actionMutation.adapterActionProfiles[
    'users-enabled-actions'
  ].documents[0][3] = 'legacyPayload';
  assert.throws(
    () => assertSnapshot(actionMutation),
    /Adapter action profiles drifted/
  );
});

test('action profiles pin each endpoint and the exact createUser output minimum', () => {
  const loaded = loadPortableContract();
  const users = loaded.snapshot.adapterActionProfiles['users-enabled-actions'];
  assert.equal(users.endpointPolicy, 'per-document');
  assert.ok(users.documents.every((document) => document[0] === 'admin'));

  const organizations = loaded.snapshot.adapterActionProfiles[
    'organizations-enabled-actions'
  ];
  assert.equal(organizations.endpointPolicy, 'per-document');
  const authCoordinates = organizations.documents.filter(
    (document) => document[0] === 'auth'
  ).map((document) => document[1]);
  assert.deepEqual(authCoordinates, [
    'Mutation.deleteUser',
    'Mutation.updateUser',
    'Mutation.revokeOrgApiKey',
    'Mutation.deleteOrgPrincipal',
    'Mutation.createOrgPrincipal',
    'Mutation.createUser'
  ]);
  assert.deepEqual(
    organizations.documents.find(
      (document) => document[1] === 'Mutation.createUser'
    ),
    [
      'auth',
      'Mutation.createUser',
      'CreateUserInput',
      'user',
      ['id', 'type', 'username']
    ]
  );

  const endpointMutation = structuredClone(loaded.snapshot);
  endpointMutation.adapterActionProfiles[
    'organizations-enabled-actions'
  ].documents[17][0] = 'admin';
  assert.throws(
    () => assertSnapshot(endpointMutation),
    /Adapter action profiles drifted/
  );

  const outputMutation = structuredClone(loaded.snapshot);
  outputMutation.adapterActionProfiles[
    'organizations-enabled-actions'
  ].documents[22][4].push('displayName');
  assert.throws(
    () => assertSnapshot(outputMutation),
    /Adapter action profiles drifted/
  );
});

test('Storage metadata alternatives stay on adapter-supported endpoint kinds', () => {
  const loaded = loadPortableContract();
  const storage = loaded.snapshot.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'storage'
  );
  for (const capability of storage.required) {
    assert.deepEqual(capability.alternatives[0].endpointKinds, [
      'storage',
      'admin',
      'data'
    ]);
    assert.deepEqual(capability.alternatives[1].endpointKinds, [
      'storage',
      'admin',
      'data'
    ]);
  }

  const mutation = structuredClone(loaded.snapshot);
  const mutatedStorage = mutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'storage'
  );
  mutatedStorage.required[0].alternatives[1].endpointKinds.push('auth');
  assert.throws(
    () => assertSnapshot(mutation),
    /storage required bindings drifted/
  );
});

test('stable alternative, mitigation, and checkout identifiers fail closed on drift', () => {
  const loaded = loadPortableContract();

  const alternativeMutation = structuredClone(loaded.snapshot);
  const users = alternativeMutation.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'users'
  );
  users.required[0].alternatives[0].id = 'legacy-users-directory';
  assert.throws(
    () => assertSnapshot(alternativeMutation),
    /alternative id drifted/
  );

  const mitigationMutation = structuredClone(loaded.snapshot);
  mitigationMutation.sourceLimitations[0].mitigationRequirements[0].id =
    'legacy-mitigation';
  assert.throws(
    () => assertSnapshot(mitigationMutation),
    /mitigationRequirements drifted/
  );

  assert.deepEqual(loaded.snapshot.source.acceptedCheckoutStates, [
    'named-branch-at-pinned-commit',
    'detached-at-pinned-commit'
  ]);
  const checkoutMutation = structuredClone(loaded.snapshot);
  checkoutMutation.source.acceptedCheckoutStates.pop();
  assert.throws(
    () => assertSnapshot(checkoutMutation),
    /Accepted Blocks checkout states drifted/
  );
});

test('the modular store TSX example pins module typing and balanced closures', () => {
  const reference = readFileSync(runtimeReference, 'utf8');
  const fences = reference.match(/^```/gmu) ?? [];
  assert.equal(fences.length % 2, 0);
  assert.match(
    reference,
    /type ConsoleKitFeatureModule[\s\S]*?const featureModules: readonly ConsoleKitFeatureModule\[\] = \[/
  );
  assert.doesNotMatch(
    reference,
    /const featureModules = \[[\s\S]*?\] as const;/
  );
  assert.match(
    reference,
    /return createConsoleKitStore\([\s\S]*?\n\s{4}\);\n\s{2}\}\);\n\n\s{2}return \(/
  );
  assert.doesNotMatch(
    reference,
    /return createConsoleKitStore\([\s\S]*?\n\s{4}\);\n\s{4}\);\n/
  );
});
