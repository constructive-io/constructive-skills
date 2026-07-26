import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSnapshot,
  loadPortableContract,
  parseArguments
} from './check-blocks-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(scriptDirectory, 'check-blocks-contract.mjs');
const runtimeReference = path.join(
  scriptDirectory,
  '../references/runtime-contract.md'
);

function runQuery(arguments_) {
  const output = execFileSync(process.execPath, [checker].concat(arguments_), {
    cwd: '/',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output);
}

test('portable artifacts validate as one complete contract', () => {
  const loaded = loadPortableContract();
  assert.equal(loaded.snapshot.registry.catalog.itemCount, 102);
  assert.equal(loaded.snapshot.items.length, 19);
  assert.equal(loaded.artifacts.planByItem.size, 19);
  assert.equal(loaded.artifacts.catalog.items.length, 102);
  assert.equal(loaded.snapshot.sourceLimitations.length, 14);
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
    item.installCommand,
    'pnpm dlx shadcn@4.13.1 add @constructive/app-shell'
  );
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
  assert.equal(root.runtimeStatus.blocked, false);

  const consoleRoot = runQuery(['--root', 'console-module-data']);
  assert.equal(
    consoleRoot.portableContract.consoleStore.currentSourceConformance.status,
    'nonconforming-when-data-installed'
  );
  assert.deepEqual(
    consoleRoot.portableContract.sourceLimitations.map(
      (limitation) => limitation.id
    ),
    ['data-console-nested-sheets-store']
  );
  assert.equal(consoleRoot.portableContract.metaContract.coordinate, 'Query._meta');
  assert.equal(consoleRoot.runtimeStatus.status, 'blocked');
  assert.equal(consoleRoot.runtimeStatus.blocked, true);

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
    assert.equal(gate.publicInstallCommands.status, 'blocked');
    assert.equal(gate.publicInstallCommands.availability, 'future-only');
    assert.equal(
      gate.pinnedLocalConsumption.sourceCommit,
      '4f2a789fde9a90c0c6ed5977896493bb4818fa77'
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

test('list queries expose Data metadata and runtime-mode-aware blockers', () => {
  const roots = runQuery(['--list-roots']);
  const registry = runQuery(['--list-registry']);
  assert.equal(roots.metaContract.version, '2026-07');
  assert.equal(roots.metaContract.coordinate, 'Query._meta');
  assert.equal(registry.metaContract.version, '2026-07');
  assert.equal(registry.metaContract.coordinate, 'Query._meta');

  const data = roots.items.find((item) => item.name === 'feature-pack-data');
  assert.equal(data.blocked, false);
  assert.equal(data.runtimeStatus.status, 'conditionally-blocked');
  assert.deepEqual(data.runtimeStatus.unconditionalBlockerIds, []);
  assert.deepEqual(data.runtimeStatus.conditionalBlockerIds, [
    'data-standalone-persistent-token-storage',
    'data-standalone-csrf-auth-unavailable'
  ]);
  assert.deepEqual(data.runtimeStatus.modes, [
    {
      id: 'embedded-auth',
      status: 'eligible',
      blockingLimitationIds: [],
      mitigationRequiredLimitationIds: []
    },
    {
      id: 'standalone-auth',
      status: 'blocked',
      blockingLimitationIds: [
        'data-standalone-persistent-token-storage'
      ],
      mitigationRequiredLimitationIds: [
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
        'data-standalone-auth-endpoint-fallback',
        'data-standalone-database-scope-fallback'
      ]
    }
  ]);
  assert.deepEqual(
    data.sourceLimitationAcceptances.map((entry) => entry.acceptance),
    ['require-mitigation', 'require-mitigation', 'blocking', 'blocking']
  );
  const consoleData = roots.items.find(
    (item) => item.name === 'console-module-data'
  );
  assert.equal(consoleData.blocked, true);
  assert.equal(consoleData.runtimeStatus.status, 'blocked');
  assert.deepEqual(consoleData.runtimeStatus.unconditionalBlockerIds, [
    'data-console-nested-sheets-store'
  ]);
  const auth = roots.items.find((item) => item.name === 'feature-pack-auth');
  assert.equal(auth.blocked, false);
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
  assert.deepEqual(contract.viewState.controlled, [
    'activeTable:onActiveTableChange'
  ]);
  assert.deepEqual(contract.viewState.defaults, ['defaultActiveTable']);
  assert.deepEqual(contract.viewState.required, ['config']);
  assert.ok(contract.propVocabulary.includes('sheetsProps'));

  const mutation = structuredClone(loadPortableContract().snapshot);
  mutation.standaloneContracts.data.viewState.controlled.length = 0;
  assert.throws(
    () => assertSnapshot(mutation),
    /Standalone Data view contract drifted/
  );
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
