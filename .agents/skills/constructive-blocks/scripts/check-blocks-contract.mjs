#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const snapshotPath = path.join(
  skillDirectory,
  'references',
  'install-roots.v1.json'
);

const PINNED = Object.freeze({
  repository: 'https://github.com/constructive-io/blocks',
  branch: 'feat/feature-packs-console-kit',
  commit: '4f2a789fde9a90c0c6ed5977896493bb4818fa77',
  publicationStatus: 'branch-only',
  registryNamespace: '@constructive',
  registryUrl: 'https://constructive-io.github.io/blocks/r/{name}.json',
  registryHomepage: 'https://constructive-io.github.io/blocks',
  registrySchema: 'https://ui.shadcn.com/schema/registry.json',
  shadcnVersion: '4.13.1',
  packageManager: 'pnpm@10.28.0',
  nodeEngine: '>=24.0.0',
  metaContractVersion: '2026-07',
  metaCoordinate: 'Query._meta',
  registryItemCount: 102
});

const ENDPOINT_KINDS = [
  'data',
  'auth',
  'admin',
  'billing',
  'storage',
  'notifications'
];

const CONSTRUCTIVE_API_NAMES = {
  data: 'api',
  auth: 'auth',
  admin: 'admin',
  billing: 'usage',
  storage: 'objects',
  notifications: 'notifications'
};

const PACK_IDS = [
  'data',
  'auth',
  'users',
  'organizations',
  'storage',
  'billing',
  'notifications'
];

const PROFILE_IDS = [
  'auth-hardened',
  'b2b-storage',
  'full'
];

const INSTALL_ROOT_NAMES = [
  'console-kit-nextjs',
  'preset-auth-hardened',
  'preset-b2b-storage',
  'preset-full',
  'console-kit-core',
  'console-module-data',
  'console-module-auth',
  'console-module-users',
  'console-module-organizations',
  'console-module-storage',
  'console-module-billing',
  'console-module-notifications',
  'feature-pack-data',
  'feature-pack-auth',
  'feature-pack-users',
  'feature-pack-organizations',
  'feature-pack-storage',
  'feature-pack-billing',
  'feature-pack-notifications'
];

const CANONICAL_SOURCE_PATHS = [
  'package.json',
  'apps/registry/package.json',
  'apps/registry/scripts/build.ts',
  'packages/ui/registry.json',
  'apps/blocks/registry.json',
  'scripts/inspect-console-kit.ts',
  'apps/blocks/src/feature-packs/catalog.ts',
  'apps/blocks/src/feature-packs/capabilities.ts',
  'apps/blocks/src/blocks/console-runtime/endpoints.ts',
  'apps/blocks/src/blocks/console-kit/feature-module.ts',
  'apps/blocks/src/blocks/console-kit/store/console-kit-store.tsx',
  'apps/blocks/src/blocks/console-kit/constructive/constructive-capabilities.ts',
  'apps/blocks/src/blocks/console-kit/constructive/constructive-console-kit.tsx',
  'packages/data/package.json',
  'packages/data/src/meta-query.ts',
  'packages/data/src/schema-introspection-compatibility.ts',
  'packages/sheets/package.json',
  'packages/sheets/src/context/sheets-context.ts',
  'packages/sheets/src/context/sheets-execute.ts',
  'packages/sheets/src/adapter/postgraphile-adapter.ts',
  'packages/ui/package.json',
  'packages/schema-builder/package.json',
  'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/auth/auth-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/users/users-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-meta-contract.ts',
  'apps/blocks/src/blocks/feature-packs/storage/storage-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/storage/storage-meta-contract.ts',
  'apps/blocks/src/blocks/feature-packs/billing/billing-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/notifications/notifications-console-module.tsx',
  'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts',
  'packages/sheets/src/context/sheets-provider.tsx',
  'packages/sheets/src/store/sheets-store.ts',
  'packages/sheets/src/hooks/use-sheets-meta.ts'
];

const ADAPTER_SOURCE_PATHS = {
  data: [
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    'packages/sheets/src/context/sheets-context.ts',
    'packages/sheets/src/context/sheets-provider.tsx',
    'packages/sheets/src/context/sheets-execute.ts',
    'packages/sheets/src/hooks/use-sheets-meta.ts',
    'packages/sheets/src/adapter/postgraphile-adapter.ts'
  ],
  auth: [
    'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts'
  ],
  users: [
    'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts'
  ],
  organizations: [
    'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts'
  ],
  storage: [
    'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts'
  ],
  billing: [
    'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts'
  ],
  notifications: [
    'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts'
  ]
};

const PACKAGE_RELEASES = [
  {
    name: '@constructive-io/ui',
    version: '0.5.0',
    manifestPath: 'packages/ui/package.json'
  },
  {
    name: '@constructive-io/data',
    version: '0.2.0',
    manifestPath: 'packages/data/package.json'
  },
  {
    name: '@constructive-io/sheets',
    version: '0.5.0',
    manifestPath: 'packages/sheets/package.json'
  },
  {
    name: '@constructive-io/schema-builder',
    version: '0.1.0',
    manifestPath: 'packages/schema-builder/package.json'
  }
];

const REQUIRED_BINDING_ENDPOINTS = {
  data: {
    'data.meta': [['data']],
    'data.introspection': [['data']]
  },
  auth: {
    'auth.credentials': [['auth']],
    'auth.sessions': [['auth']],
    'auth.password': [['auth']]
  },
  users: {
    'users.directory': [['auth']],
    'users.memberships': [['admin']]
  },
  organizations: {
    'organizations.memberships': [['admin'], ENDPOINT_KINDS]
  },
  storage: {
    'storage.buckets': [['storage', 'admin', 'data'], ENDPOINT_KINDS],
    'storage.files': [['storage', 'admin', 'data'], ENDPOINT_KINDS]
  },
  billing: {
    'billing.plans': [['billing']],
    'billing.subscriptions': [['billing']]
  },
  notifications: {
    'notifications.inbox': [['notifications']]
  }
};

const OPTIONAL_BINDING_ENDPOINTS = {
  data: {},
  auth: {
    'auth.email': [['auth']],
    'auth.connected-accounts': [['auth']]
  },
  users: {
    'users.permissions': [['admin']],
    'users.profiles': [['admin']],
    'users.invites': [['admin']]
  },
  organizations: {
    'organizations.permissions': [['admin']],
    'organizations.limits': [['billing']],
    'organizations.profiles': [['admin']],
    'organizations.hierarchy': [['admin']],
    'organizations.invites': [['admin']]
  },
  storage: {},
  billing: {
    'billing.meters': [['billing']]
  },
  notifications: {
    'notifications.settings': [['notifications']]
  }
};

export function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object.`
  );
}

function assertString(value, label) {
  assert(
    typeof value === 'string' && value.length > 0,
    `${label} must be a non-empty string.`
  );
}

function assertNullableString(value, label) {
  assert(
    value === null || typeof value === 'string',
    `${label} must be a string or null.`
  );
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array.`);
  const seen = new Set();
  for (const entry of value) {
    assertString(entry, `${label} entry`);
    assert(!seen.has(entry), `${label} contains duplicate value ${entry}.`);
    seen.add(entry);
  }
}

function assertExact(actual, expected, label) {
  assert(
    isDeepStrictEqual(actual, expected),
    `${label} drifted from the pinned Blocks contract.`
  );
}

function assertSha256(value, label) {
  assert(
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    `${label} must be a lowercase SHA-256 digest.`
  );
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    fail(`Unable to read ${label}: ${details}`);
  }
}

function resolveInside(root, relativePath, label) {
  assertString(relativePath, label);
  assert(!path.isAbsolute(relativePath), `${label} must be relative.`);
  const resolved = path.resolve(root, relativePath);
  assert(
    resolved.startsWith(`${root}${path.sep}`),
    `${label} escapes its contract root.`
  );
  return resolved;
}

function assertAttestation(record, label) {
  assertObject(record, label);
  assertString(record.path, `${label}.path`);
  assertSha256(record.sha256, `${label}.sha256`);
}

function assertAttestedFile(root, record, label) {
  assertAttestation(record, label);
  const filePath = resolveInside(root, record.path, `${label}.path`);
  assert(existsSync(filePath), `${label} does not exist: ${filePath}`);
  const actual = sha256(readFileSync(filePath));
  assert(
    actual === record.sha256,
    `${label} SHA-256 drifted: expected ${record.sha256}, received ${actual}.`
  );
  return filePath;
}

function byId(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    assertString(entry.id, `${label} id`);
    assert(!result.has(entry.id), `Duplicate ${label} id ${entry.id}.`);
    result.set(entry.id, entry);
  }
  return result;
}

function byName(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    assertString(entry.name, `${label} name`);
    assert(!result.has(entry.name), `Duplicate ${label} name ${entry.name}.`);
    result.set(entry.name, entry);
  }
  return result;
}

function sourceMap(snapshot) {
  return new Map(
    snapshot.source.attestations.canonicalFiles.map((record) => [
      record.path,
      record
    ])
  );
}

function assertSourceLink(actual, expectedPath, sources, label) {
  assertAttestation(actual, label);
  assert(actual.path === expectedPath, `${label}.path drifted.`);
  assertExact(actual, sources.get(expectedPath), label);
}

function bindingEndpointProjection(bindings) {
  const result = {};
  for (const binding of bindings) {
    result[binding.capability] = binding.alternatives.map(
      (candidate) => candidate.endpointKinds
    );
  }
  return result;
}

function assertBindingSet(
  bindings,
  expected,
  endpointKinds,
  sources,
  label
) {
  assert(Array.isArray(bindings), `${label} must be an array.`);
  const seen = new Set();
  for (const binding of bindings) {
    assertObject(binding, `${label} entry`);
    assertString(binding.capability, `${label} capability`);
    assert(!seen.has(binding.capability), `${label} repeats ${binding.capability}.`);
    seen.add(binding.capability);
    assert(
      Array.isArray(binding.alternatives) && binding.alternatives.length > 0,
      `${label} ${binding.capability} needs evidence alternatives.`
    );
    for (const alternative of binding.alternatives) {
      assertObject(alternative, `${binding.capability} alternative`);
      assertStringArray(
        alternative.endpointKinds,
        `${binding.capability} endpointKinds`
      );
      for (const endpointKind of alternative.endpointKinds) {
        assert(
          endpointKinds.includes(endpointKind),
          `${binding.capability} references unknown endpoint ${endpointKind}.`
        );
      }
      assertObject(alternative.evidence, `${binding.capability} evidence`);
      assertString(
        alternative.evidence.type,
        `${binding.capability} evidence.type`
      );
      if (alternative.evidence.contractSource) {
        const contractPath = alternative.evidence.contractSource.path;
        assertSourceLink(
          alternative.evidence.contractSource,
          contractPath,
          sources,
          `${binding.capability} contractSource`
        );
      }
    }
  }
  assertExact(bindingEndpointProjection(bindings), expected, label);
}

function assertConsoleModuleBindings(snapshot, manifestById, sources) {
  assert(
    Array.isArray(snapshot.consoleModuleBindings),
    'consoleModuleBindings must be an array.'
  );
  assert(
    snapshot.consoleModuleBindings.length === PACK_IDS.length,
    'consoleModuleBindings must cover every feature pack.'
  );
  const bindingByPack = new Map();
  for (const binding of snapshot.consoleModuleBindings) {
    assertObject(binding, 'Console module binding');
    assertString(binding.featurePack, 'Console module featurePack');
    assert(
      !bindingByPack.has(binding.featurePack),
      `Duplicate Console module binding ${binding.featurePack}.`
    );
    assert(
      binding.readyState === 'all-required-capabilities',
      `${binding.featurePack} readyState drifted.`
    );
    const sourcePath =
      `apps/blocks/src/blocks/feature-packs/${binding.featurePack}/${binding.featurePack}-console-module.tsx`;
    assertSourceLink(
      binding.source,
      sourcePath,
      sources,
      `${binding.featurePack} module source`
    );
    assert(Array.isArray(binding.adapterSources), `${binding.featurePack}.adapterSources must be an array.`);
    assert(
      binding.adapterSources.length === ADAPTER_SOURCE_PATHS[binding.featurePack].length,
      `${binding.featurePack}.adapterSources count drifted.`
    );
    for (let index = 0; index < binding.adapterSources.length; index += 1) {
      assertSourceLink(
        binding.adapterSources[index],
        ADAPTER_SOURCE_PATHS[binding.featurePack][index],
        sources,
        `${binding.featurePack} adapter source ${index}`
      );
    }
    assertBindingSet(
      binding.required,
      REQUIRED_BINDING_ENDPOINTS[binding.featurePack],
      snapshot.endpointKinds,
      sources,
      `${binding.featurePack} required bindings`
    );
    assertBindingSet(
      binding.optional,
      OPTIONAL_BINDING_ENDPOINTS[binding.featurePack],
      snapshot.endpointKinds,
      sources,
      `${binding.featurePack} optional bindings`
    );
    assertStringArray(
      binding.unboundOptionalCapabilities,
      `${binding.featurePack}.unboundOptionalCapabilities`
    );
    const manifest = manifestById.get(binding.featurePack);
    assert(manifest, `Missing manifest for ${binding.featurePack}.`);
    assertExact(
      binding.required.map((entry) => entry.capability).sort(),
      manifest.capabilities.required.slice().sort(),
      `${binding.featurePack} required capability coverage`
    );
    const coveredOptional = binding.optional
      .map((entry) => entry.capability)
      .concat(binding.unboundOptionalCapabilities);
    assertExact(
      coveredOptional.sort(),
      manifest.capabilities.optional.slice().sort(),
      `${binding.featurePack} optional capability coverage`
    );
    bindingByPack.set(binding.featurePack, binding);
  }
  assertExact(
    Array.from(bindingByPack.keys()),
    PACK_IDS,
    'Console module binding order'
  );
}

function assertRelease(snapshot, sources) {
  assertObject(snapshot.release, 'release');
  assert(snapshot.release.status === PINNED.publicationStatus, 'release.status drifted.');
  assert(snapshot.release.publicRegistryReady === false, 'Public registry must remain branch-only.');
  assert(snapshot.release.packageManager === PINNED.packageManager, 'release.packageManager drifted.');
  assert(snapshot.release.nodeEngine === PINNED.nodeEngine, 'release.nodeEngine drifted.');
  assert(snapshot.release.shadcnVersion === PINNED.shadcnVersion, 'release.shadcnVersion drifted.');
  assert(Array.isArray(snapshot.release.packages), 'release.packages must be an array.');
  assert(snapshot.release.packages.length === PACKAGE_RELEASES.length, 'release.packages count drifted.');
  for (let index = 0; index < PACKAGE_RELEASES.length; index += 1) {
    const expected = PACKAGE_RELEASES[index];
    const actual = snapshot.release.packages[index];
    assertObject(actual, `release.packages[${index}]`);
    assert(actual.name === expected.name, `${expected.name} release name drifted.`);
    assert(actual.version === expected.version, `${expected.name} release version drifted.`);
    assert(
      actual.snapshotStatus === PINNED.publicationStatus,
      `${expected.name} snapshot status drifted.`
    );
    assertSourceLink(
      actual.manifestSource,
      expected.manifestPath,
      sources,
      `${expected.name} manifest source`
    );
  }

  assertObject(snapshot.release.localConsumption, 'release.localConsumption');
  assert(
    snapshot.release.localConsumption.mode === 'pinned-local-build',
    'Local consumption mode drifted.'
  );
  assert(
    snapshot.release.localConsumption.mutatesTrackedSource === false,
    'Local consumption must not mutate tracked Blocks source.'
  );
  assertExact(
    snapshot.release.localConsumption.generatedPaths,
    [
      '.artifacts/npm',
      'apps/registry/registry.json',
      'apps/registry/public/r',
      'apps/registry/registry',
      'packages/ui/dist',
      'packages/data/dist',
      'packages/sheets/dist',
      'packages/schema-builder/dist'
    ],
    'Local generated artifact paths'
  );
  assertExact(
    snapshot.release.localConsumption.bootstrapSequence,
    [
      'node <skills-repo>/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs --blocks-repo <blocks-repo> --source-preflight',
      'pnpm --dir <blocks-repo> install --frozen-lockfile',
      'pnpm --dir <blocks-repo> build:registry',
      'pnpm --dir <blocks-repo> pack:local',
      'node <skills-repo>/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs --blocks-repo <blocks-repo>'
    ],
    'Fresh-checkout bootstrap sequence'
  );
  const commands = JSON.stringify(snapshot.release.localConsumption);
  for (const required of [
    'pnpm --dir <blocks-repo> build:registry',
    'pnpm --dir <blocks-repo> pack:local',
    'pnpm --dir <blocks-repo> local:registry',
    'python3 -m http.server',
    'shadcn@4.13.1'
  ]) {
    assert(commands.includes(required), `Local consumption is missing ${required}.`);
  }
  assert(
    snapshot.release.localConsumption.consumerWorkspace ===
      'disposable-or-isolated-worktree',
    'Local consumption must require an isolated consumer.'
  );
  assert(
    snapshot.release.localConsumption.localLockfilePolicy.includes('never commit') &&
      snapshot.release.localConsumption.localLockfilePolicy.includes('localhost'),
    'Local lockfile policy must reject committing localhost resolutions.'
  );
  assert(
    snapshot.release.localConsumption.promotionRule.includes('public release') &&
      snapshot.release.localConsumption.promotionRule.includes('regenerate'),
    'Consumer promotion must wait for public release and regenerate its lockfile.'
  );
  assert(
    snapshot.release.localConsumption.localInstallCommandTemplate ===
      'pnpm --dir <blocks-repo>/apps/registry exec shadcn add @constructive/{name} --cwd <consumer-repo> --yes',
    'Local install command template drifted.'
  );
}

function assertMetaAndStandaloneContracts(snapshot, sources) {
  assertObject(snapshot.metaContract, 'metaContract');
  assert(snapshot.metaContract.version === PINNED.metaContractVersion, 'metaContract.version drifted.');
  assert(snapshot.metaContract.coordinate === PINNED.metaCoordinate, 'metaContract.coordinate drifted.');
  assertSourceLink(
    snapshot.metaContract.source,
    'packages/data/src/meta-query.ts',
    sources,
    'metaContract.source'
  );
  assertSourceLink(
    snapshot.metaContract.compatibilitySource,
    'packages/data/src/schema-introspection-compatibility.ts',
    sources,
    'metaContract.compatibilitySource'
  );
  assertSourceLink(
    snapshot.metaContract.sheetsAdapterSource,
    'packages/sheets/src/adapter/postgraphile-adapter.ts',
    sources,
    'metaContract.sheetsAdapterSource'
  );
  assertExact(
    snapshot.metaContract.evidenceOrder,
    [
      'current _meta signature introspection',
      'Query._meta payload validation',
      'standard GraphQL introspection cross-check'
    ],
    'metaContract.evidenceOrder'
  );

  assertObject(snapshot.standaloneContracts, 'standaloneContracts');
  assertObject(snapshot.standaloneContracts.nonData, 'standaloneContracts.nonData');
  assertExact(
    snapshot.standaloneContracts.nonData.featurePacks,
    PACK_IDS.slice(1),
    'non-Data standalone pack coverage'
  );
  assert(
    snapshot.standaloneContracts.nonData.discovery === 'none',
    'Non-Data standalone packs must not perform discovery.'
  );
  assert(
    snapshot.standaloneContracts.nonData.endpointResolution === 'none',
    'Non-Data standalone packs must not resolve endpoints.'
  );

  const data = snapshot.standaloneContracts.data;
  assertObject(data, 'standaloneContracts.data');
  assert(data.featurePack === 'data', 'Standalone Data featurePack drifted.');
  assert(data.component === 'DataFeaturePack', 'Standalone Data component drifted.');
  assert(data.discovery === 'internal-data-schema', 'Standalone Data discovery drifted.');
  assertObject(data.planFieldOverride, 'Standalone Data planFieldOverride');
  assert(
    data.planFieldOverride.plan ===
      'references/install-plans.v1/feature-pack-data.json' &&
      data.planFieldOverride.field === 'standaloneContract.discovery' &&
      data.planFieldOverride.status === 'superseded-for-data',
    'Standalone Data must explicitly supersede the inspector v1 generic discovery sentence.'
  );
  assert(data.configType === 'SheetsConfig', 'Standalone Data configType drifted.');
  assert(data.executeType === 'SheetsExecuteFn', 'Standalone Data executeType drifted.');
  assertExact(data.requiredConfigFields, ['endpoint', 'auth'], 'Standalone Data required config');
  assertExact(
    data.internalEvidence,
    ['Query._meta', 'standard GraphQL introspection'],
    'Standalone Data internal evidence'
  );
  assert(
    data.hostOwns.includes('semantic endpoint selection') &&
      data.hostOwns.includes('authentication mode and session boundary'),
    'Standalone Data must leave endpoint and session resolution with the host.'
  );
  assertSourceLink(
    data.componentSource,
    'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
    sources,
    'Standalone Data component source'
  );
  assertSourceLink(
    data.configSource,
    'packages/sheets/src/context/sheets-context.ts',
    sources,
    'Standalone Data config source'
  );
  assertSourceLink(
    data.executeSource,
    'packages/sheets/src/context/sheets-execute.ts',
    sources,
    'Standalone Data execute source'
  );
  assertSourceLink(
    data.providerSource,
    'packages/sheets/src/context/sheets-provider.tsx',
    sources,
    'Standalone Data provider source'
  );
  assertSourceLink(
    data.metaHookSource,
    'packages/sheets/src/hooks/use-sheets-meta.ts',
    sources,
    'Standalone Data metadata hook source'
  );
}

function assertHostOwnedStore(snapshot, sources) {
  const store = snapshot.hostOwnedStore;
  assertObject(store, 'hostOwnedStore');
  assert(store.factory === 'createConsoleKitStore', 'Host store factory drifted.');
  assertExact(
    store.positionalSignature,
    [
      'initialRouteInput: ConsoleKitRoute | FeaturePackId',
      'initialContext: ConsoleKitContext | null = null',
      'sliceContributions: readonly ConsoleKitStoreSliceContribution[] = []'
    ],
    'Host store positional signature'
  );
  assert(store.moduleSliceProperty === 'storeSlice', 'Host store slice property drifted.');
  assert(store.coreComponent === 'ConstructiveConsoleKitCore', 'Host store Core component drifted.');
  assertSourceLink(
    store.source,
    'apps/blocks/src/blocks/console-kit/store/console-kit-store.tsx',
    sources,
    'Host store source'
  );
  assertSourceLink(
    store.moduleContractSource,
    'apps/blocks/src/blocks/console-kit/feature-module.ts',
    sources,
    'Host store module contract source'
  );
  assertSourceLink(
    store.coreSource,
    'apps/blocks/src/blocks/console-kit/constructive/constructive-console-kit.tsx',
    sources,
    'Host store Core source'
  );
  assert(
    store.targetInvariant ===
      'one host-owned vanilla Zustand store per Console Kit instance with every installed module slice',
    'Host store target invariant drifted.'
  );
  assertObject(store.planFieldOverride, 'hostOwnedStore.planFieldOverride');
  assert(
    store.planFieldOverride.appliesTo ===
      'all non-standalone install plans containing Data' &&
      store.planFieldOverride.field === 'runtimeContract.state' &&
      store.planFieldOverride.status ===
        'superseded-by-current-source-conformance',
    'Host store plan-field override drifted.'
  );
  assertObject(store.currentSourceConformance, 'hostOwnedStore.currentSourceConformance');
  assert(
    store.currentSourceConformance.status === 'nonconforming-when-data-installed',
    'Current Data store conformance must remain explicit.'
  );
  assert(
    store.currentSourceConformance.consoleCoreStoreCount === 1 &&
      store.currentSourceConformance.dataNestedStoreCount === 1,
    'Current Console/Data Zustand store counts drifted.'
  );
  assert(
    store.currentSourceConformance.dataModuleStoreSlice === false,
    'Data must remain recorded as lacking a Console module storeSlice.'
  );
  assertSourceLink(
    store.currentSourceConformance.dataModuleSource,
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    sources,
    'Current Data module source'
  );
  assertSourceLink(
    store.currentSourceConformance.dataProviderSource,
    'packages/sheets/src/context/sheets-provider.tsx',
    sources,
    'Current Data provider source'
  );
  assertSourceLink(
    store.currentSourceConformance.dataStoreSource,
    'packages/sheets/src/store/sheets-store.ts',
    sources,
    'Current Data store source'
  );
}

export function assertSnapshot(snapshot) {
  assertObject(snapshot, 'Snapshot');
  assert(snapshot.schemaVersion === 1, 'Snapshot schemaVersion must be 1.');
  assert(
    snapshot.kind === 'constructive.blocks-install-roots',
    'Snapshot kind must be constructive.blocks-install-roots.'
  );

  assertObject(snapshot.source, 'source');
  assert(snapshot.source.repository === PINNED.repository, 'source.repository drifted.');
  assert(snapshot.source.branch === PINNED.branch, 'source.branch drifted.');
  assert(snapshot.source.commit === PINNED.commit, 'source.commit drifted.');
  assert(
    snapshot.source.publicationStatus === PINNED.publicationStatus,
    'source.publicationStatus drifted.'
  );
  assert(
    snapshot.source.trackedWorktreeRequired === true,
    'source.trackedWorktreeRequired must be true.'
  );
  assertObject(snapshot.source.inspector, 'source.inspector');
  assert(snapshot.source.inspector.schemaVersion === 1, 'Inspector schemaVersion must be 1.');
  assert(
    snapshot.source.inspector.kind === 'constructive.console-kit-install-roots',
    'Inspector kind drifted.'
  );
  assert(snapshot.source.inspector.script === 'scripts/inspect-console-kit.ts', 'Inspector script drifted.');
  assert(snapshot.source.inspector.mode === 'pinned-prebuilt', 'Inspector mode must be pinned-prebuilt.');
  assert(
    snapshot.source.inspector.command ===
      'pnpm --dir <blocks-repo> --silent console-kit:inspect --no-build',
    'Inspector command must be CWD-safe and explicitly prebuilt.'
  );

  const attestations = snapshot.source.attestations;
  assertObject(attestations, 'source.attestations');
  assert(attestations.algorithm === 'sha256', 'Attestation algorithm must be sha256.');
  assertAttestation(attestations.aggregateRegistry, 'aggregateRegistry attestation');
  assert(
    attestations.aggregateRegistry.path === 'apps/registry/registry.json',
    'Aggregate registry path drifted.'
  );
  assertAttestation(attestations.registryCatalog, 'registryCatalog attestation');
  assert(
    attestations.registryCatalog.path === 'references/registry-catalog.v1.json',
    'Registry catalog path drifted.'
  );
  assert(Array.isArray(attestations.canonicalFiles), 'canonicalFiles must be an array.');
  const sources = sourceMap(snapshot);
  assert(
    sources.size === attestations.canonicalFiles.length,
    'canonicalFiles contains duplicate paths.'
  );
  assertExact(Array.from(sources.keys()), CANONICAL_SOURCE_PATHS, 'Canonical source path set');
  for (const record of attestations.canonicalFiles) {
    assertAttestation(record, `Canonical source ${record.path ?? 'unknown'}`);
  }
  assert(Array.isArray(attestations.installPlans), 'installPlans must be an array.');
  assert(
    attestations.installPlans.length === INSTALL_ROOT_NAMES.length,
    'Every Console install root needs one complete plan attestation.'
  );
  const planItems = new Set();
  for (const record of attestations.installPlans) {
    assertAttestation(record, `Install plan ${record.item ?? 'unknown'}`);
    assertString(record.item, 'Install plan item');
    assert(!planItems.has(record.item), `Duplicate install plan ${record.item}.`);
    assert(
      record.path === `references/install-plans.v1/${record.item}.json`,
      `${record.item} plan path drifted.`
    );
    planItems.add(record.item);
  }
  assertExact(Array.from(planItems).sort(), INSTALL_ROOT_NAMES.slice().sort(), 'Install plan item set');

  assertObject(snapshot.registry, 'registry');
  assert(snapshot.registry.namespace === PINNED.registryNamespace, 'registry.namespace drifted.');
  assert(snapshot.registry.urlTemplate === PINNED.registryUrl, 'registry.urlTemplate drifted.');
  assert(snapshot.registry.shadcnVersion === PINNED.shadcnVersion, 'registry.shadcnVersion drifted.');
  assert(
    snapshot.registry.shadcnVersionPolicy === 'exact',
    'registry.shadcnVersionPolicy must be exact.'
  );
  assert(
    !Object.hasOwn(snapshot.registry, 'minimumShadcnVersion'),
    'registry.minimumShadcnVersion is forbidden because newer CLI versions are not implied compatible.'
  );
  assertObject(snapshot.registry.catalog, 'registry.catalog');
  assert(snapshot.registry.catalog.path === attestations.registryCatalog.path, 'Registry catalog link drifted.');
  assert(snapshot.registry.catalog.itemCount === PINNED.registryItemCount, 'Registry item count drifted.');
  assertObject(snapshot.registry.componentsJson, 'registry.componentsJson');
  assertObject(snapshot.registry.componentsJson.registries, 'registry componentsJson.registries');
  assert(
    snapshot.registry.componentsJson.registries[PINNED.registryNamespace] === PINNED.registryUrl,
    'Canonical registry namespace mapping drifted.'
  );

  assertExact(snapshot.endpointKinds, ENDPOINT_KINDS, 'Endpoint kind mapping');
  assertExact(snapshot.constructiveApiNames, CONSTRUCTIVE_API_NAMES, 'Constructive API mapping');

  assert(Array.isArray(snapshot.featurePackManifests), 'featurePackManifests must be an array.');
  const manifestById = byId(snapshot.featurePackManifests, 'Feature-pack manifest');
  assertExact(Array.from(manifestById.keys()), PACK_IDS, 'Feature-pack manifest order');
  for (const manifest of snapshot.featurePackManifests) {
    assert(manifest.schemaVersion === 1, `${manifest.id} schemaVersion must be 1.`);
    assertString(manifest.title, `${manifest.id}.title`);
    assertString(manifest.description, `${manifest.id}.description`);
    assertStringArray(manifest.dependencies, `${manifest.id}.dependencies`);
    assertObject(manifest.endpoints, `${manifest.id}.endpoints`);
    assertStringArray(manifest.endpoints.required, `${manifest.id}.endpoints.required`);
    assertStringArray(manifest.endpoints.optional, `${manifest.id}.endpoints.optional`);
    assertObject(manifest.capabilities, `${manifest.id}.capabilities`);
    assertStringArray(manifest.capabilities.required, `${manifest.id}.capabilities.required`);
    assertStringArray(manifest.capabilities.optional, `${manifest.id}.capabilities.optional`);
    assertObject(manifest.metadata, `${manifest.id}.metadata`);
    const declaredEndpoints = manifest.endpoints.required.concat(manifest.endpoints.optional);
    for (const endpoint of declaredEndpoints) {
      assert(ENDPOINT_KINDS.includes(endpoint), `${manifest.id} references unknown endpoint ${endpoint}.`);
    }
  }

  assert(Array.isArray(snapshot.presetProfiles), 'presetProfiles must be an array.');
  const profileById = byId(snapshot.presetProfiles, 'Preset profile');
  assertExact(Array.from(profileById.keys()), PROFILE_IDS, 'Preset profile order');
  for (const profile of snapshot.presetProfiles) {
    assert(profile.schemaVersion === 1, `${profile.id} schemaVersion must be 1.`);
    assertString(profile.presetSlug, `${profile.id}.presetSlug`);
    assert(profile.stability === 'stable', `${profile.id} must be stable.`);
    assertStringArray(profile.featurePacks, `${profile.id}.featurePacks`);
    for (const packId of profile.featurePacks) {
      assert(manifestById.has(packId), `${profile.id} references unknown pack ${packId}.`);
    }
  }

  assert(Array.isArray(snapshot.items), 'items must be an array.');
  const itemByName = byName(snapshot.items, 'Install root');
  assertExact(Array.from(itemByName.keys()), INSTALL_ROOT_NAMES, 'Install-root order');
  for (const item of snapshot.items) {
    assertString(item.surface, `${item.name}.surface`);
    assertString(item.title, `${item.name}.title`);
    assertString(item.description, `${item.name}.description`);
    assertStringArray(item.featurePacks, `${item.name}.featurePacks`);
    assertStringArray(item.presetProfiles, `${item.name}.presetProfiles`);
    const command =
      `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`;
    assert(item.installCommand === command, `${item.name} install command drifted.`);
  }
  for (const packId of PACK_IDS) {
    assert(itemByName.has(`feature-pack-${packId}`), `Missing feature-pack-${packId}.`);
    assert(itemByName.has(`console-module-${packId}`), `Missing console-module-${packId}.`);
  }
  for (const profileId of PROFILE_IDS) {
    assert(itemByName.has(`preset-${profileId}`), `Missing preset-${profileId}.`);
  }

  assertRelease(snapshot, sources);
  assertMetaAndStandaloneContracts(snapshot, sources);
  assertConsoleModuleBindings(snapshot, manifestById, sources);
  assertHostOwnedStore(snapshot, sources);

  assertObject(snapshot.runtimeContract, 'runtimeContract');
  assert(snapshot.runtimeContract.appliesTo === 'console-kit', 'runtimeContract must apply to Console Kit.');
  assertExact(
    snapshot.runtimeContract.tenantDescriptor.endpointKinds,
    ENDPOINT_KINDS,
    'Runtime endpoint kinds'
  );
  assert(
    snapshot.runtimeContract.state.factory === 'createConsoleKitStore',
    'Runtime store factory drifted.'
  );

  return {
    itemByName,
    manifestById,
    profileById,
    sources
  };
}

export function projectRegistryCatalog(registry) {
  assertObject(registry, 'Aggregate registry');
  assert(Array.isArray(registry.items), 'Aggregate registry items must be an array.');
  const items = registry.items.map((item) => {
    const files = (item.files ?? []).map((file) => ({
      path: file.path,
      type: file.type,
      target: file.target ?? null
    }));
    return {
      name: item.name,
      type: item.type,
      title: item.title,
      description: item.description,
      categories: item.categories ?? [],
      docs: item.docs ?? null,
      dependencies: item.dependencies ?? [],
      devDependencies: item.devDependencies ?? [],
      registryDependencies: item.registryDependencies ?? [],
      files,
      installCommand:
        `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`
    };
  });
  return {
    schemaVersion: 1,
    kind: 'constructive.blocks-registry-catalog',
    sourceCommit: PINNED.commit,
    aggregatePath: 'apps/registry/registry.json',
    registryNamespace: PINNED.registryNamespace,
    itemCount: items.length,
    items
  };
}

export function assertRegistryCatalog(catalog, snapshot) {
  assertObject(catalog, 'Registry catalog');
  assert(catalog.schemaVersion === 1, 'Registry catalog schemaVersion must be 1.');
  assert(
    catalog.kind === 'constructive.blocks-registry-catalog',
    'Registry catalog kind drifted.'
  );
  assert(catalog.sourceCommit === PINNED.commit, 'Registry catalog sourceCommit drifted.');
  assert(catalog.aggregatePath === 'apps/registry/registry.json', 'Registry catalog aggregatePath drifted.');
  assert(catalog.registryNamespace === PINNED.registryNamespace, 'Registry catalog namespace drifted.');
  assert(catalog.itemCount === PINNED.registryItemCount, 'Registry catalog itemCount drifted.');
  assert(Array.isArray(catalog.items), 'Registry catalog items must be an array.');
  assert(catalog.items.length === catalog.itemCount, 'Registry catalog item count is inconsistent.');
  const itemByName = byName(catalog.items, 'Registry catalog item');
  for (const item of catalog.items) {
    assertString(item.type, `${item.name}.type`);
    assertString(item.title, `${item.name}.title`);
    assertString(item.description, `${item.name}.description`);
    assertStringArray(item.categories, `${item.name}.categories`);
    assertNullableString(item.docs, `${item.name}.docs`);
    assertStringArray(item.dependencies, `${item.name}.dependencies`);
    assertStringArray(item.devDependencies, `${item.name}.devDependencies`);
    assertStringArray(item.registryDependencies, `${item.name}.registryDependencies`);
    assert(Array.isArray(item.files), `${item.name}.files must be an array.`);
    for (const file of item.files) {
      assertObject(file, `${item.name} file`);
      assertString(file.path, `${item.name} file.path`);
      assertString(file.type, `${item.name} file.type`);
      assertNullableString(file.target, `${item.name} file.target`);
    }
    const command =
      `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`;
    assert(item.installCommand === command, `${item.name} catalog install command drifted.`);
    for (const dependency of item.registryDependencies) {
      if (!dependency.startsWith(`${PINNED.registryNamespace}/`)) continue;
      const dependencyName = dependency.slice(PINNED.registryNamespace.length + 1);
      assert(itemByName.has(dependencyName), `${item.name} references unknown registry item ${dependency}.`);
    }
  }
  for (const name of [
    'constructive-theme',
    'button',
    'sidebar',
    'app-bar',
    'app-shell',
    'billing-settings-page'
  ].concat(INSTALL_ROOT_NAMES)) {
    assert(itemByName.has(name), `Registry catalog is missing ${name}.`);
  }
  for (const item of snapshot.items) {
    const catalogItem = itemByName.get(item.name);
    assert(catalogItem, `Registry catalog is missing Console root ${item.name}.`);
    assert(catalogItem.installCommand === item.installCommand, `${item.name} command differs between contracts.`);
  }
  return itemByName;
}

function assertPlan(plan, item, snapshot) {
  assertObject(plan, `${item.name} plan`);
  assert(plan.schemaVersion === 1, `${item.name} plan schemaVersion drifted.`);
  assert(
    plan.kind === 'constructive.console-kit-install-plan',
    `${item.name} plan kind drifted.`
  );
  assert(plan.item === item.name, `${item.name} plan item drifted.`);
  assert(plan.surface === item.surface, `${item.name} plan surface drifted.`);
  assertObject(plan.install, `${item.name}.install`);
  assert(plan.install.command === item.installCommand, `${item.name} plan command drifted.`);
  assertExact(
    plan.install.componentsJson,
    snapshot.registry.componentsJson,
    `${item.name} components.json mapping`
  );
  assertObject(plan.composition, `${item.name}.composition`);
  assert(Array.isArray(plan.composition.registryItems), `${item.name} registryItems must be an array.`);
  for (const [dependencyKind, dependencies] of [
    ['npmDependencies', plan.composition.npmDependencies],
    ['devDependencies', plan.composition.devDependencies]
  ]) {
    assert(Array.isArray(dependencies), `${item.name} ${dependencyKind} must be an array.`);
    const dependencyNames = new Set();
    for (const dependency of dependencies) {
      assertObject(dependency, `${item.name} ${dependencyKind} entry`);
      assertString(dependency.name, `${item.name} ${dependencyKind} name`);
      assert(
        !dependencyNames.has(dependency.name),
        `${item.name} ${dependencyKind} repeats ${dependency.name}.`
      );
      dependencyNames.add(dependency.name);
      assertStringArray(
        dependency.requiredBy,
        `${item.name} ${dependencyKind} ${dependency.name}.requiredBy`
      );
    }
  }
  assert(Array.isArray(plan.composition.files), `${item.name} files must be an array.`);
  assert(Array.isArray(plan.featurePacks), `${item.name} featurePacks must be an array.`);
  assert(Array.isArray(plan.presetProfiles), `${item.name} presetProfiles must be an array.`);
  assertString(plan.registryDocumentation, `${item.name} registryDocumentation`);
  assertObject(plan.verify, `${item.name}.verify`);
  assertString(plan.verify.runFrom, `${item.name}.verify.runFrom`);
  assertStringArray(plan.verify.commands, `${item.name}.verify.commands`);
  assertStringArray(plan.verify.manualChecks, `${item.name}.verify.manualChecks`);
  assertExact(plan.featurePacks, item.featurePacks.map(
    (id) => snapshot.featurePackManifests.find((manifest) => manifest.id === id)
  ), `${item.name} feature-pack plan`);
  assertExact(plan.presetProfiles, item.presetProfiles.map(
    (id) => snapshot.presetProfiles.find((profile) => profile.id === id)
  ), `${item.name} preset plan`);
  const fileTargets = new Set(plan.composition.files.map((file) => file.target));
  for (const packId of item.featurePacks) {
    assert(
      fileTargets.has(`~/.constructive/feature-packs/${packId}.json`),
      `${item.name} is missing the ${packId} feature-pack sidecar.`
    );
  }
  for (const profileId of item.presetProfiles) {
    assert(
      fileTargets.has(`~/.constructive/feature-packs/${profileId}.json`),
      `${item.name} is missing the ${profileId} preset sidecar.`
    );
  }
  const standalone = item.surface === 'standalone-feature-pack';
  assert(
    standalone ? plan.standaloneContract !== null : plan.standaloneContract === null,
    `${item.name} standalone contract shape drifted.`
  );
  assert(
    standalone
      ? plan.runtimeContract === null
      : isDeepStrictEqual(plan.runtimeContract, snapshot.runtimeContract),
    `${item.name} runtime contract drifted.`
  );
}

export function validateSkillArtifacts(snapshot, root = skillDirectory) {
  const catalogPath = assertAttestedFile(
    root,
    snapshot.source.attestations.registryCatalog,
    'Pinned registry catalog'
  );
  const catalog = readJson(catalogPath, 'pinned registry catalog');
  assertRegistryCatalog(catalog, snapshot);

  const planByItem = new Map();
  for (const record of snapshot.source.attestations.installPlans) {
    const filePath = assertAttestedFile(root, record, `Pinned plan ${record.item}`);
    const plan = readJson(filePath, `pinned plan ${record.item}`);
    const item = snapshot.items.find((candidate) => candidate.name === record.item);
    assert(item, `Pinned plan references unknown install root ${record.item}.`);
    assertPlan(plan, item, snapshot);
    planByItem.set(record.item, plan);
  }
  return {
    catalog,
    planByItem
  };
}

export function parseArguments(arguments_) {
  let blocksRepo = null;
  let help = false;
  let query = null;
  let registryType = null;
  let sourcePreflight = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--blocks-repo') {
      assert(blocksRepo === null, '--blocks-repo may be provided only once.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), '--blocks-repo requires a path.');
      blocksRepo = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--source-preflight') {
      assert(!sourcePreflight, '--source-preflight may be provided only once.');
      sourcePreflight = true;
      continue;
    }
    if (argument === '--list-roots' || argument === '--list-registry') {
      assert(query === null, 'Select only one query mode.');
      query = {
        kind: argument === '--list-roots' ? 'list-roots' : 'list-registry',
        value: null
      };
      continue;
    }
    if (argument === '--root' || argument === '--registry-item') {
      assert(query === null, 'Select only one query mode.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), `${argument} requires a name.`);
      query = {
        kind: argument === '--root' ? 'root' : 'registry-item',
        value
      };
      index += 1;
      continue;
    }
    if (argument === '--type') {
      assert(registryType === null, '--type may be provided only once.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), '--type requires a registry type.');
      registryType = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument ${argument}.`);
  }
  assert(
    registryType === null || query?.kind === 'list-registry',
    '--type is valid only with --list-registry.'
  );
  assert(
    !sourcePreflight || blocksRepo !== null,
    '--source-preflight requires --blocks-repo.'
  );
  assert(
    !sourcePreflight || query === null,
    '--source-preflight cannot be combined with a query mode.'
  );
  return { blocksRepo, help, query, registryType, sourcePreflight };
}

function usage() {
  return [
    'Validate the pinned Constructive Blocks skill contract.',
    '',
    'Usage:',
    '  node /absolute/path/to/check-blocks-contract.mjs',
    '  node /absolute/path/to/check-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks --source-preflight',
    '  node /absolute/path/to/check-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks',
    '  node /absolute/path/to/check-blocks-contract.mjs --list-roots',
    '  node /absolute/path/to/check-blocks-contract.mjs --root preset-b2b-storage',
    '  node /absolute/path/to/check-blocks-contract.mjs --list-registry [--type registry:block]',
    '  node /absolute/path/to/check-blocks-contract.mjs --registry-item app-shell',
    '',
    'Without --blocks-repo, validates the portable catalog, all 19 complete plans,',
    'hard-coded mappings, and their SHA-256 attestations.',
    'With --source-preflight, requires the exact clean tracked commit and verifies',
    'canonical tracked source without requiring ignored generated artifacts.',
    'With --blocks-repo alone, additionally verifies aggregate registry bytes and',
    'compares every prebuilt --no-build inspector plan. The checker never rebuilds',
    'or edits Blocks.'
  ].join('\n');
}

function queryOutput(options, loaded) {
  if (!options.query) return null;
  switch (options.query.kind) {
    case 'list-roots':
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-install-root-list',
        sourceCommit: PINNED.commit,
        items: loaded.snapshot.items
      };
    case 'root': {
      const plan = loaded.artifacts.planByItem.get(options.query.value);
      assert(plan, `Unknown Console install root ${options.query.value}.`);
      const item = loaded.snapshot.items.find(
        (candidate) => candidate.name === options.query.value
      );
      const standalonePackId = item.surface === 'standalone-feature-pack'
        ? item.featurePacks[0]
        : null;
      const standalone = standalonePackId
        ? {
            featurePack: standalonePackId,
            contract: standalonePackId === 'data'
              ? loaded.snapshot.standaloneContracts.data
              : loaded.snapshot.standaloneContracts.nonData
          }
        : null;
      const moduleBindings = item.surface === 'standalone-feature-pack'
        ? []
        : loaded.snapshot.consoleModuleBindings.filter(
            (binding) => item.featurePacks.includes(binding.featurePack)
          );
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-install-root',
        sourceCommit: PINNED.commit,
        plan,
        portableContract: {
          standalone,
          consoleModuleBindings: moduleBindings,
          consoleStore: item.surface === 'standalone-feature-pack'
            ? null
            : loaded.snapshot.hostOwnedStore
        }
      };
    }
    case 'list-registry': {
      const allowedTypes = new Set([
        'registry:theme',
        'registry:lib',
        'registry:hook',
        'registry:ui',
        'registry:block'
      ]);
      if (options.registryType) {
        assert(
          allowedTypes.has(options.registryType),
          `Unknown registry type ${options.registryType}.`
        );
      }
      const selected = loaded.artifacts.catalog.items.filter(
        (item) => !options.registryType || item.type === options.registryType
      );
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-registry-item-list',
        sourceCommit: PINNED.commit,
        filter: {
          type: options.registryType
        },
        itemCount: selected.length,
        items: selected.map((item) => ({
          name: item.name,
          type: item.type,
          title: item.title,
          description: item.description,
          categories: item.categories,
          docs: item.docs,
          installCommand: item.installCommand
        }))
      };
    }
    case 'registry-item': {
      const item = loaded.artifacts.catalog.items.find(
        (candidate) => candidate.name === options.query.value
      );
      assert(item, `Unknown registry item ${options.query.value}.`);
      return item;
    }
    default:
      fail(`Unknown query mode ${options.query.kind}.`);
  }
}

function runGit(blocksRepo, arguments_, label) {
  try {
    return execFileSync('git', arguments_, {
      cwd: blocksRepo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (cause) {
    const stderr =
      cause && typeof cause === 'object' && typeof cause.stderr === 'string'
        ? cause.stderr.trim()
        : '';
    fail(`${label} failed: ${stderr || (cause instanceof Error ? cause.message : String(cause))}`);
  }
}

function runBlocksInspector(blocksRepo, arguments_) {
  const commandArguments = [
    '--dir',
    blocksRepo,
    '--silent',
    'console-kit:inspect',
    '--no-build'
  ].concat(arguments_);
  try {
    const stdout = execFileSync('pnpm', commandArguments, {
      cwd: skillDirectory,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(stdout);
  } catch (cause) {
    const stderr =
      cause && typeof cause === 'object' && typeof cause.stderr === 'string'
        ? cause.stderr.trim()
        : '';
    fail(
      `Pinned prebuilt Blocks inspector failed: ${stderr ||
        (cause instanceof Error ? cause.message : String(cause))}`
    );
  }
}

function assertLiveRelease(blocksRepo) {
  const rootPackage = readJson(path.join(blocksRepo, 'package.json'), 'Blocks package.json');
  assert(rootPackage.packageManager === PINNED.packageManager, 'Live Blocks packageManager drifted.');
  assert(rootPackage.engines?.node === PINNED.nodeEngine, 'Live Blocks Node engine drifted.');
  const registryPackage = readJson(
    path.join(blocksRepo, 'apps/registry/package.json'),
    'Blocks registry package.json'
  );
  assert(
    registryPackage.devDependencies?.shadcn === PINNED.shadcnVersion,
    'Live shadcn registry dependency drifted.'
  );
  for (const expected of PACKAGE_RELEASES) {
    const manifest = readJson(
      path.join(blocksRepo, expected.manifestPath),
      expected.manifestPath
    );
    assert(manifest.name === expected.name, `${expected.manifestPath} package name drifted.`);
    assert(manifest.version === expected.version, `${expected.name} version drifted.`);
  }
}

export function assertBlocksSourcePreflight(snapshot, blocksRepo) {
  assert(existsSync(blocksRepo), `Blocks repository does not exist: ${blocksRepo}`);
  const commit = runGit(blocksRepo, ['rev-parse', 'HEAD'], 'Resolving Blocks HEAD');
  assert(
    commit === PINNED.commit && commit === snapshot.source.commit,
    `Blocks HEAD ${commit} does not match pinned commit ${PINNED.commit}.`
  );
  const trackedStatus = runGit(
    blocksRepo,
    ['status', '--porcelain=v1', '--untracked-files=no'],
    'Checking Blocks worktree'
  );
  assert(
    trackedStatus.length === 0,
    `Blocks tracked worktree must be clean before attestation:\n${trackedStatus}`
  );

  for (const record of snapshot.source.attestations.canonicalFiles) {
    assertAttestedFile(blocksRepo, record, `Live canonical source ${record.path}`);
  }
  assertLiveRelease(blocksRepo);

  const dataModulePath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    'Data Console module path'
  );
  const dataModuleSource = readFileSync(dataModulePath, 'utf8');
  assert(
    !/\bstoreSlice\s*:/.test(dataModuleSource),
    'The pinned Data Console module unexpectedly contributes storeSlice; update the conformance record.'
  );
  const dataProviderPath = resolveInside(
    blocksRepo,
    'packages/sheets/src/context/sheets-provider.tsx',
    'Data Sheets provider path'
  );
  const dataProviderSource = readFileSync(dataProviderPath, 'utf8');
  assert(
    /\bcreateSheetsStore\s*\(\s*\)/.test(dataProviderSource),
    'The pinned SheetsProvider no longer creates its nested Zustand store; update the conformance record.'
  );

  const inspectorPath = resolveInside(
    blocksRepo,
    snapshot.source.inspector.script,
    'inspector path'
  );
  assert(existsSync(inspectorPath), `Blocks inspector does not exist: ${inspectorPath}`);
}

export function assertBlocksSource(snapshot, artifacts, blocksRepo) {
  assertBlocksSourcePreflight(snapshot, blocksRepo);
  assertAttestedFile(
    blocksRepo,
    snapshot.source.attestations.aggregateRegistry,
    'Live aggregate registry'
  );

  const aggregatePath = resolveInside(
    blocksRepo,
    snapshot.source.attestations.aggregateRegistry.path,
    'aggregate registry path'
  );
  const registry = readJson(aggregatePath, 'live aggregate registry');
  assert(registry.$schema === PINNED.registrySchema, 'Live aggregate registry schema drifted.');
  assert(registry.name === 'constructive', 'Live aggregate registry name drifted.');
  assert(registry.homepage === PINNED.registryHomepage, 'Live aggregate registry homepage drifted.');
  assertExact(
    projectRegistryCatalog(registry),
    artifacts.catalog,
    'Live aggregate registry catalog projection'
  );

  const liveList = runBlocksInspector(blocksRepo, ['--list']);
  assert(liveList.schemaVersion === snapshot.source.inspector.schemaVersion, 'Live inspector schemaVersion drifted.');
  assert(liveList.kind === snapshot.source.inspector.kind, 'Live inspector kind drifted.');
  assertExact(liveList.items, snapshot.items, 'Live inspector install roots');

  for (const item of snapshot.items) {
    const livePlan = runBlocksInspector(
      blocksRepo,
      ['--item', item.name, '--compact']
    );
    assertExact(
      livePlan,
      artifacts.planByItem.get(item.name),
      `Live complete plan ${item.name}`
    );
  }
}

export function loadPortableContract() {
  const snapshot = readJson(snapshotPath, snapshotPath);
  assertSnapshot(snapshot);
  const artifacts = validateSkillArtifacts(snapshot);
  return {
    snapshot,
    artifacts
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const loaded = loadPortableContract();
  if (options.blocksRepo) {
    if (options.sourcePreflight) {
      assertBlocksSourcePreflight(loaded.snapshot, options.blocksRepo);
    } else {
      assertBlocksSource(loaded.snapshot, loaded.artifacts, options.blocksRepo);
    }
  }
  const output = queryOutput(options, loaded);
  if (output) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  let sourceStatus = '';
  if (options.sourcePreflight) {
    sourceStatus = ` Pinned clean tracked source ${PINNED.commit} matches; generated artifacts were not required.`;
  } else if (options.blocksRepo) {
    sourceStatus = ` Pinned clean source ${PINNED.commit} matches.`;
  }
  process.stdout.write(
    `Blocks contract OK: ${PINNED.registryItemCount} registry items, ${INSTALL_ROOT_NAMES.length} complete Console plans, ${PACK_IDS.length} packs, ${PROFILE_IDS.length} presets.${sourceStatus}\n`
  );
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    main();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
