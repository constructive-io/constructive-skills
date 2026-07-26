import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('portable artifacts validate as one complete contract', () => {
  const loaded = loadPortableContract();
  assert.equal(loaded.snapshot.registry.catalog.itemCount, 102);
  assert.equal(loaded.snapshot.items.length, 19);
  assert.equal(loaded.artifacts.planByItem.size, 19);
  assert.equal(loaded.artifacts.catalog.items.length, 102);
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

test('query mode validates first and is independent of the current directory', () => {
  const output = execFileSync(
    process.execPath,
    [checker, '--registry-item', 'app-shell'],
    {
      cwd: '/',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const item = JSON.parse(output);
  assert.equal(item.name, 'app-shell');
  assert.equal(
    item.installCommand,
    'pnpm dlx shadcn@4.13.1 add @constructive/app-shell'
  );
  assert.ok(
    item.registryDependencies.includes('@constructive/app-bar')
  );

  const rootOutput = execFileSync(
    process.execPath,
    [checker, '--root', 'feature-pack-data'],
    {
      cwd: '/',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const root = JSON.parse(rootOutput);
  assert.equal(root.kind, 'constructive.blocks-install-root');
  assert.equal(root.plan.item, 'feature-pack-data');
  assert.equal(
    root.portableContract.standalone.contract.discovery,
    'internal-data-schema'
  );
  assert.equal(root.portableContract.consoleStore, null);

  const consoleRootOutput = execFileSync(
    process.execPath,
    [checker, '--root', 'console-module-data'],
    {
      cwd: '/',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const consoleRoot = JSON.parse(consoleRootOutput);
  assert.equal(
    consoleRoot.portableContract.consoleStore.currentSourceConformance.status,
    'nonconforming-when-data-installed'
  );
});
