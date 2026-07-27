import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateBriefDocument,
  validateBriefFiles,
  resolveBriefOwnedFile
} from './lib/brief-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const fixtureDirectory = path.join(skillDirectory, 'fixtures');
const catalogPath = path.resolve(skillDirectory, '..', 'constructive-blocks', 'references', 'install-roots.v1.json');
const briefPath = path.join(fixtureDirectory, 'app-brief.template.json');
const validateBriefCliPath = path.join(scriptDirectory, 'validate-brief.mjs');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const tenant = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'tenant-database.template.json'), 'utf8'));
const isolation = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'tenant-database.isolation.template.json'), 'utf8'));

function fixtureInput() {
  const isolationDocuments = new Map();
  isolationDocuments.set('other-tenant', structuredClone(isolation));
  return {
    brief: JSON.parse(fs.readFileSync(briefPath, 'utf8')),
    tenant: structuredClone(tenant),
    catalog,
    briefPath,
    tenantPath: path.join(fixtureDirectory, 'tenant-database.template.json'),
    isolationTenantDocuments: isolationDocuments
  };
}

function validate(input) {
  return validateBriefDocument(input);
}

test('canonical preset brief covers every pack, actor scope, route, and RLS scope', () => {
  const result = validate(fixtureInput());
  assert.deepEqual(result.errors, []);
  assert.equal(result.resolved.compositionKind, 'console-preset');
  assert.equal(result.resolved.acceptance.scenarios.length, 9);
  assert.deepEqual(
    result.resolved.runtimeLimitations.slice(0, 2).map((limitation) => {
      return [limitation.id, limitation.acceptance, limitation.runtimeModes];
    }),
    [
      ['data-console-nested-sheets-store', 'blocking', ['console']],
      [
        'data-provider-global-locale-logger',
        'require-mitigation',
        ['data-provider']
      ]
    ]
  );
  assert.equal(Object.hasOwn(result.resolved, 'domainDiscovery'), false);
});

test('partial capability expectations classify every required capability and retain exact routes', () => {
  const input = fixtureInput();
  const capability = input.brief.acceptance.capabilities.find(
    (candidate) => candidate.featurePack === 'users'
  );
  capability.expected = 'partial';
  capability.reason = 'The directory is available while application memberships are unavailable.';
  capability.requiredCapabilities = {
    available: ['users.directory'],
    unavailable: ['users.memberships']
  };
  capability.binding.routes = capability.binding.routes.filter(
    (route) => route.capability === 'users.directory'
  );
  const scenario = input.brief.acceptance.scenarios.find(
    (candidate) => candidate.id === 'user-management'
  );
  scenario.capabilityChecks = [
    { capability: 'users.directory', expected: 'ready' },
    { capability: 'users.memberships', expected: 'unavailable' }
  ];
  const visual = input.brief.acceptance.visual.targets.find(
    (target) => target.target.kind === 'surface' && target.target.featurePack === 'users'
  );
  visual.states.push('partial');
  const result = validate(input);
  assert.deepEqual(result.errors, []);
  const resolved = result.resolved.acceptance.capabilities.find(
    (candidate) => candidate.featurePack === 'users'
  );
  assert.equal(resolved.proofs.length, 1);
  assert.equal(resolved.proofs[0].capability, 'users.directory');
  assert.equal(resolved.proofs[0].alternativeId, 'users.directory.path-1');
  assert.equal(resolved.verificationProfile.id, 'tenant-runtime');
  assert.equal(Object.hasOwn(resolved.proofs[0], 'adapterRequirements'), false);
  assert.ok(resolved.adapterVerification.requirements.length > 0);
});

test('strict composition variants accept selected Console modules, full Console, and standalone Data', () => {
  const moduleInput = fixtureInput();
  moduleInput.brief.tenant.provenance = {
    kind: 'custom',
    compositionReceiptRef: 'tenant.customReceipt',
    capabilityHandoffRef: 'tenant.capabilities',
    justification: 'This tenant uses a tested custom Constructive DB module composition.'
  };
  moduleInput.brief.frontend.composition.kind = 'console-modules';
  delete moduleInput.brief.frontend.composition.root;
  moduleInput.brief.frontend.composition.roots = [
    'console-module-data',
    'console-module-auth',
    'console-module-users'
  ];
  assert.deepEqual(validate(moduleInput).errors, []);

  const fullInput = fixtureInput();
  fullInput.brief.tenant.provenance = structuredClone(moduleInput.brief.tenant.provenance);
  fullInput.brief.frontend.composition.kind = 'console-full';
  fullInput.brief.frontend.composition.root = 'console-kit-nextjs';
  const unavailablePacks = ['organizations', 'storage', 'billing', 'notifications'];
  for (const packId of unavailablePacks) {
    fullInput.brief.acceptance.capabilities.push({
      surfaceId: 'console',
      featurePack: packId,
      expected: 'unavailable',
      binding: { kind: 'none' },
      reason: 'This custom tenant does not hand off a first-party executable binding for this pack.'
    });
    fullInput.brief.acceptance.visual.targets.push({
      target: {
        kind: 'surface',
        surfaceId: 'console',
        featurePack: packId
      },
      viewports: ['desktop', 'mobile'],
      states: ['unavailable']
    });
  }
  assert.deepEqual(validate(fullInput).errors, []);

  const standaloneInput = fixtureInput();
  standaloneInput.brief.tenant.provenance = structuredClone(moduleInput.brief.tenant.provenance);
  standaloneInput.brief.frontend.composition = {
    kind: 'standalone',
    mounts: [
      {
        id: 'data-table',
        root: 'feature-pack-data',
        mountPath: '/data',
        binding: {
          kind: 'sheets',
          configRef: 'runtime.dataSheetsConfig',
          endpointKind: 'data',
          session: {
            kind: 'embedded',
            databaseId: 'tenant_database_id',
            sessionRef: 'runtime.tenantSession'
          },
          transport: {
            kind: 'default'
          }
        }
      }
    ]
  };
  standaloneInput.brief.domain.routes = [];
  standaloneInput.brief.acceptance.capabilities = [
    {
      surfaceId: 'data-table',
      featurePack: 'data',
      expected: 'ready',
      binding: {
        kind: 'host-sheets',
        configRef: 'runtime.dataSheetsConfig',
        endpointKind: 'data'
      }
    }
  ];
  standaloneInput.brief.acceptance.isolationTenants = [];
  standaloneInput.isolationTenantDocuments = new Map();
  standaloneInput.brief.acceptance.actors = [standaloneInput.brief.acceptance.actors[0]];
  standaloneInput.brief.acceptance.scenarios = [
    {
      id: 'standalone-data',
      kind: 'feature',
      target: {
        kind: 'surface',
        surfaceId: 'data-table',
        featurePack: 'data'
      },
      actors: ['owner'],
      capabilityChecks: [
        { capability: 'data.meta', expected: 'ready' },
        { capability: 'data.introspection', expected: 'ready' }
      ],
      observations: ['The host-configured Sheets surface executes metadata-driven reads.']
    }
  ];
  standaloneInput.brief.acceptance.visual.targets = [
    {
      target: {
        kind: 'surface',
        surfaceId: 'data-table',
        featurePack: 'data'
      },
      viewports: ['desktop', 'mobile'],
      states: ['loading', 'ready', 'empty', 'populated', 'error']
    }
  ];
  assert.deepEqual(validate(standaloneInput).errors, []);
  assert.deepEqual(
    validate(standaloneInput).resolved.runtimeLimitations.map((limitation) => {
      return {
        id: limitation.id,
        acceptance: limitation.acceptance,
        runtimeModes: limitation.runtimeModes
      };
    }),
    [
      {
        id: 'data-provider-global-locale-logger',
        acceptance: 'require-mitigation',
        runtimeModes: ['data-provider']
      }
    ]
  );

  const blankStandalone = structuredClone(standaloneInput);
  blankStandalone.isolationTenantDocuments = new Map();
  blankStandalone.brief.tenant.provenance = { kind: 'preset', preset: 'blank' };
  assert.deepEqual(validate(blankStandalone).errors, []);

  const missingData = structuredClone(standaloneInput);
  missingData.isolationTenantDocuments = new Map();
  delete missingData.tenant.endpoints.data;
  assert.match(validate(missingData).errors.join('\n'), /requires tenant.endpoints.data/);

  const missingAuth = structuredClone(standaloneInput);
  missingAuth.isolationTenantDocuments = new Map();
  missingAuth.brief.frontend.composition.mounts[0].binding.session = {
    kind: 'standalone-auth',
    authEndpointKind: 'auth',
    databaseId: 'tenant_database_id'
  };
  delete missingAuth.tenant.endpoints.auth;
  assert.match(validate(missingAuth).errors.join('\n'), /requires tenant.endpoints.auth/);

  const mismatchedEndpoint = structuredClone(standaloneInput);
  mismatchedEndpoint.isolationTenantDocuments = new Map();
  mismatchedEndpoint.brief.frontend.composition.mounts[0].binding.endpointKind = 'auth';
  mismatchedEndpoint.brief.acceptance.capabilities[0].binding.endpointKind = 'auth';
  assert.match(validate(mismatchedEndpoint).errors.join('\n'), /endpointKind must equal data/);

  const csrfRequired = structuredClone(standaloneInput);
  csrfRequired.isolationTenantDocuments = new Map();
  csrfRequired.brief.frontend.composition.mounts[0].binding.session = {
    kind: 'standalone-auth',
    authEndpointKind: 'auth',
    databaseId: 'tenant_database_id'
  };
  assert.match(validate(csrfRequired).errors.join('\n'), /standalone-auth.*forbidden unless.*explicitly false/);

  const mismatchedAuthDatabase = structuredClone(csrfRequired);
  mismatchedAuthDatabase.isolationTenantDocuments = new Map();
  mismatchedAuthDatabase.tenant.authPolicy.requireCsrfForAuth = false;
  mismatchedAuthDatabase.brief.frontend.composition.mounts[0].binding.session.databaseId = 'wrong_database';
  assert.match(validate(mismatchedAuthDatabase).errors.join('\n'), /databaseId must exactly match tenant.id/);
});

test('full Console binds every current feature pack through exact alternative and profile IDs', () => {
  const input = fixtureInput();
  input.brief.tenant.provenance = {
    kind: 'custom',
    compositionReceiptRef: 'tenant.fullReceipt',
    capabilityHandoffRef: 'tenant.fullCapabilities',
    justification: 'The custom tenant exposes every source-attested Console capability.'
  };
  input.brief.frontend.composition.kind = 'console-full';
  input.brief.frontend.composition.root = 'console-kit-nextjs';
  input.tenant.endpoints.storage = 'https://storage.example.com/graphql';
  input.tenant.endpoints.billing = 'https://billing.example.com/graphql';
  input.tenant.endpoints.notifications = 'https://notifications.example.com/graphql';

  const addedPacks = ['organizations', 'storage', 'billing', 'notifications'];
  for (const packId of addedPacks) {
    const bindingRecord = catalog.consoleModuleBindings.find(
      (candidate) => candidate.featurePack === packId
    );
    const requirements = [];
    for (const required of bindingRecord.required) {
      requirements.push(required);
    }
    if (Array.isArray(bindingRecord.prerequisites)) {
      for (const prerequisite of bindingRecord.prerequisites) {
        requirements.push(prerequisite);
      }
    }
    const routes = [];
    const capabilityChecks = [];
    for (const requirement of requirements) {
      const alternative = requirement.alternatives[0];
      routes.push({
        capability: requirement.capability,
        alternativeId: alternative.id,
        endpointKind: alternative.endpointKinds[0]
      });
      capabilityChecks.push({
        capability: requirement.capability,
        expected: 'ready'
      });
    }
    input.brief.acceptance.capabilities.push({
      surfaceId: 'console',
      featurePack: packId,
      expected: 'ready',
      binding: {
        kind: 'first-party',
        verificationProfileId: 'tenant-runtime',
        routes
      }
    });
    input.brief.acceptance.scenarios.push({
      id: packId + '-capabilities',
      kind: 'feature',
      target: {
        kind: 'surface',
        surfaceId: 'console',
        featurePack: packId
      },
      actors: ['owner'],
      capabilityChecks
    });
    input.brief.acceptance.visual.targets.push({
      target: {
        kind: 'surface',
        surfaceId: 'console',
        featurePack: packId
      },
      viewports: ['desktop', 'mobile'],
      states: ['ready']
    });
  }

  const result = validate(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.resolved.acceptance.capabilities.length, 7);
  for (const expectation of result.resolved.acceptance.capabilities) {
    assert.equal(expectation.verificationProfile.id, 'tenant-runtime');
    assert.ok(expectation.adapterVerification.sources.length > 0);
    for (const proof of expectation.proofs) {
      assert.match(proof.alternativeId, new RegExp('^' + proof.capability.replace('.', '\\.') + '\\.path-[0-9]+$'));
      assert.equal(Object.hasOwn(proof, 'adapterRequirements'), false);
    }
  }
});

test('blank backend provenance permits explicit composition but never invents first-party capabilities or a preset frontend', () => {
  const modulesInput = fixtureInput();
  modulesInput.brief.tenant.provenance = {
    kind: 'preset',
    preset: 'blank'
  };
  modulesInput.brief.frontend.composition.kind = 'console-modules';
  delete modulesInput.brief.frontend.composition.root;
  modulesInput.brief.frontend.composition.roots = [
    'console-module-data',
    'console-module-auth',
    'console-module-users'
  ];
  assert.match(
    validate(modulesInput).errors.join('\n'),
    /backend preset blank does not provision data/
  );
  for (const capability of modulesInput.brief.acceptance.capabilities) {
    capability.expected = 'unavailable';
    capability.binding = { kind: 'none' };
    capability.reason = 'The blank backend preset does not provision this first-party capability.';
  }
  modulesInput.brief.acceptance.scenarios = modulesInput.brief.acceptance.scenarios.filter(
    (scenario) => scenario.target.kind === 'domain-route'
  );
  for (const visual of modulesInput.brief.acceptance.visual.targets) {
    if (visual.target.kind === 'surface') {
      visual.states = ['unavailable'];
    }
  }
  assert.deepEqual(validate(modulesInput).errors, []);

  const presetInput = fixtureInput();
  presetInput.brief.tenant.provenance = {
    kind: 'preset',
    preset: 'blank'
  };
  assert.match(validate(presetInput).errors.join('\n'), /blank has no matching frontend preset root/);
});

test('console core supports a zero-pack host shell with application-owned routes', () => {
  const input = fixtureInput();
  input.brief.tenant.provenance = {
    kind: 'preset',
    preset: 'blank'
  };
  input.brief.frontend.composition = {
    kind: 'console-core',
    surfaceId: 'app-shell',
    root: 'console-kit-core',
    mountPath: '/app',
    session: {
      kind: 'host-session',
      databaseId: 'tenant_database_id',
      sessionRef: 'runtime.tenantSession',
      csrf: { owner: 'host', providerRef: 'runtime.csrf' },
      callback: { owner: 'host', handlerRef: 'runtime.callback' }
    }
  };
  input.brief.acceptance.capabilities = [];
  input.brief.acceptance.scenarios = input.brief.acceptance.scenarios.filter(
    (scenario) => scenario.target.kind === 'domain-route'
  );
  input.brief.acceptance.visual.targets = input.brief.acceptance.visual.targets.filter(
    (target) => target.target.kind === 'domain-route' || target.target.kind === 'shell'
  );
  input.brief.acceptance.visual.targets.find(
    (target) => target.target.kind === 'shell'
  ).target.surfaceId = 'app-shell';
  const result = validate(input);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.resolved.installRoots, ['console-kit-core']);
  assert.deepEqual(result.resolved.acceptance.capabilities, []);

  const emptyShell = structuredClone(input);
  emptyShell.isolationTenantDocuments = new Map();
  emptyShell.brief.domain.routes = [];
  emptyShell.brief.acceptance.isolationTenants = [];
  emptyShell.brief.acceptance.actors = [];
  emptyShell.brief.acceptance.scenarios = [];
  emptyShell.brief.acceptance.visual.targets = emptyShell.brief.acceptance.visual.targets.filter(
    (target) => target.target.kind === 'shell'
  );
  const emptyResult = validate(emptyShell);
  assert.deepEqual(emptyResult.errors, []);
  assert.deepEqual(emptyResult.resolved.acceptance.actors, []);
  assert.deepEqual(emptyResult.resolved.acceptance.scenarios, []);
});

test('Auth session actors are required only when session capability checks are ready', () => {
  const partialInput = fixtureInput();
  const partialCapability = partialInput.brief.acceptance.capabilities.find(
    (candidate) => candidate.featurePack === 'auth'
  );
  partialCapability.expected = 'partial';
  partialCapability.reason = 'Credentials and password recovery are available while sessions are unavailable.';
  partialCapability.requiredCapabilities = {
    available: ['auth.credentials', 'auth.password'],
    unavailable: ['auth.sessions']
  };
  partialCapability.binding.routes = partialCapability.binding.routes.filter(
    (route) => route.capability !== 'auth.sessions'
  );
  const partialScenario = partialInput.brief.acceptance.scenarios.find(
    (candidate) => candidate.kind === 'auth'
  );
  partialScenario.actors = ['anonymous'];
  for (const check of partialScenario.checks) {
    if (check.id === 'session-restore' || check.id === 'sign-out' || check.id === 'revoked-session-denied') {
      check.expected = 'unavailable';
    }
  }
  const partialVisual = partialInput.brief.acceptance.visual.targets.find(
    (target) => target.target.kind === 'surface' && target.target.featurePack === 'auth'
  );
  partialVisual.states.push('partial');
  assert.deepEqual(validate(partialInput).errors, []);

  const unavailableInput = fixtureInput();
  const unavailableCapability = unavailableInput.brief.acceptance.capabilities.find(
    (candidate) => candidate.featurePack === 'auth'
  );
  unavailableCapability.expected = 'unavailable';
  unavailableCapability.binding = { kind: 'none' };
  unavailableCapability.reason = 'The tenant does not expose first-party Auth capabilities.';
  const unavailableScenario = unavailableInput.brief.acceptance.scenarios.find(
    (candidate) => candidate.kind === 'auth'
  );
  unavailableScenario.actors = ['anonymous'];
  for (const check of unavailableScenario.checks) {
    check.expected = 'unavailable';
  }
  const unavailableVisual = unavailableInput.brief.acceptance.visual.targets.find(
    (target) => target.target.kind === 'surface' && target.target.featurePack === 'auth'
  );
  unavailableVisual.states = ['unavailable'];
  assert.deepEqual(validate(unavailableInput).errors, []);
});

test('unsupported endpoint kinds produce one diagnostic', () => {
  const input = fixtureInput();
  input.tenant.endpoints.operator = 'https://operator.example.com/graphql';
  const result = validate(input);
  const diagnostics = result.errors.filter(
    (error) => error.includes('tenant.endpoints.operator is not an endpoint kind')
  );
  assert.equal(diagnostics.length, 1);
});

const invalidCases = [
  {
    name: 'custom domain route mode',
    mutate(input) {
      input.brief.domain.routes[0].mode = 'custom';
    },
    pattern: /mode must equal crud/
  },
  {
    name: 'preset mismatch',
    mutate(input) {
      input.brief.frontend.composition.root = 'preset-b2b-storage';
    },
    pattern: /requires frontend root preset-auth-hardened/
  },
  {
    name: 'legacy arbitrary root array',
    mutate(input) {
      input.brief.frontend.registryRoots = ['preset-auth-hardened'];
    },
    pattern: /removed flow\/root-array field/
  },
  {
    name: 'custom backend with preset root',
    mutate(input) {
      input.brief.tenant.provenance = {
        kind: 'custom',
        compositionReceiptRef: 'tenant.receipt',
        capabilityHandoffRef: 'tenant.capabilities',
        justification: 'Custom backend.'
      };
    },
    pattern: /custom tenant backend cannot use a preset frontend root/
  },
  {
    name: 'duplicate Console module',
    mutate(input) {
      input.brief.frontend.composition.kind = 'console-modules';
      delete input.brief.frontend.composition.root;
      input.brief.frontend.composition.roots = ['console-module-data', 'console-module-data'];
    },
    pattern: /duplicates console-module-data/
  },
  {
    name: 'host session database mismatch',
    mutate(input) {
      input.brief.frontend.composition.session = {
        kind: 'host-session',
        databaseId: 'wrong_database',
        sessionRef: 'runtime.session',
        csrf: { owner: 'host', providerRef: 'runtime.csrf' },
        callback: { owner: 'host', handlerRef: 'runtime.callback' }
      };
    },
    pattern: /databaseId must exactly match tenant.id/
  },
  {
    name: 'endpoint query string',
    mutate(input) {
      input.tenant.endpoints.data = 'https://data.example.com/graphql?x=opaque-token-value';
    },
    pattern: /must not contain a query string/
  },
  {
    name: 'tenant descriptor extra key',
    mutate(input) {
      input.tenant.region = 'us-east';
    },
    pattern: /tenant.region is not part of this contract/
  },
  {
    name: 'unsafe workspace',
    mutate(input) {
      input.brief.app.workspace = '../outside';
    },
    pattern: /must be a safe relative path/
  },
  {
    name: 'unexecutable cross-tenant actor',
    mutate(input) {
      const actor = input.brief.acceptance.actors.find((candidate) => candidate.id === 'cross-tenant-account');
      actor.tenantScope.databaseId = 'arbitrary_database';
    },
    pattern: /must exactly match the referenced isolation tenant descriptor/
  },
  {
    name: 'duplicate isolation tenant database ID',
    mutate(input) {
      input.brief.acceptance.isolationTenants.push({
        id: 'duplicate-database',
        descriptorPath: './duplicate.json',
        sessionRef: 'qa.duplicateSession'
      });
      input.isolationTenantDocuments.set('duplicate-database', structuredClone(isolation));
    },
    pattern: /duplicates isolation tenant database ID/
  },
  {
    name: 'unused actor',
    mutate(input) {
      input.brief.acceptance.actors.push({
        id: 'unused-account',
        kind: 'account',
        accountRef: 'qa.unused',
        tenantScope: {
          kind: 'primary',
          databaseId: 'tenant_database_id'
        },
        sessionState: 'active'
      });
    },
    pattern: /declares unused actor unused-account/
  },
  {
    name: 'unused isolation tenant',
    mutate(input) {
      input.brief.acceptance.isolationTenants.push({
        id: 'unused-tenant',
        descriptorPath: './tenant-database.unused.json',
        sessionRef: 'qa.unusedTenantSession'
      });
      const unusedTenant = structuredClone(isolation);
      unusedTenant.id = 'unused_tenant_database_id';
      input.isolationTenantDocuments.set('unused-tenant', unusedTenant);
    },
    pattern: /declares unused isolation tenant unused-tenant/
  },
  {
    name: 'missing required viewport definition',
    mutate(input) {
      delete input.brief.acceptance.visual.viewports.mobile;
    },
    pattern: /visual\.viewports must define mobile/
  },
  {
    name: 'missing revoked-session coverage',
    mutate(input) {
      input.brief.acceptance.scenarios = input.brief.acceptance.scenarios.filter(
        (scenario) => scenario.id !== 'project-revoked-session-policy'
      );
    },
    pattern: /missing RLS coverage for revoked-session/
  },
  {
    name: 'missing per-pack visual coverage',
    mutate(input) {
      input.brief.acceptance.visual.targets = input.brief.acceptance.visual.targets.filter(
        (target) => target.target.kind !== 'surface' || target.target.featurePack !== 'users'
      );
    },
    pattern: /console:users has no visual target/
  },
  {
    name: 'missing required feature capability proof',
    mutate(input) {
      const scenario = input.brief.acceptance.scenarios.find(
        (candidate) => candidate.id === 'user-management'
      );
      scenario.capabilityChecks = scenario.capabilityChecks.filter(
        (check) => check.capability !== 'users.memberships'
      );
    },
    pattern: /missing required ready capability users.memberships/
  },
  {
    name: 'unknown verification profile',
    mutate(input) {
      const capability = input.brief.acceptance.capabilities.find(
        (candidate) => candidate.featurePack === 'users'
      );
      capability.binding.verificationProfileId = 'invented-profile';
    },
    pattern: /does not name a pinned Blocks verification profile/
  },
  {
    name: 'unattested Console evidence route',
    mutate(input) {
      const capability = input.brief.acceptance.capabilities.find(
        (candidate) => candidate.featurePack === 'users'
      );
      capability.binding.routes[1].alternativeId = 'users.memberships.invented-path';
    },
    pattern: /does not select a source-attested alternative ID for users.memberships/
  },
  {
    name: 'missing Auth password check proof',
    mutate(input) {
      const scenario = input.brief.acceptance.scenarios.find(
        (candidate) => candidate.id === 'auth-lifecycle'
      );
      scenario.checks = scenario.checks.filter((check) => check.id !== 'reset-password');
    },
    pattern: /checks must include reset-password/
  },
  {
    name: 'tenant override differs from frozen brief',
    mutate(input) {
      input.tenantPath = path.join(fixtureDirectory, 'tenant-database.isolation.template.json');
    },
    pattern: /tenant input must exactly match brief.tenant.descriptorPath/
  }
];

for (const invalidCase of invalidCases) {
  test('rejects ' + invalidCase.name, () => {
    const input = fixtureInput();
    invalidCase.mutate(input);
    const result = validate(input);
    assert.match(result.errors.join('\n'), invalidCase.pattern);
  });
}

test('branch-only file validation refuses to initialize trust without a pinned Blocks source', () => {
  const report = validateBriefFiles({
    briefPath,
    catalogPath,
    tenantPath: '',
    blocksSource: ''
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /--blocks-source is required/);
});

test('validate-brief CLI rejects duplicate scalar flags before reading inputs', () => {
  const result = spawnSync(
    process.execPath,
    [
      validateBriefCliPath,
      briefPath,
      '--blocks-source',
      '/tmp/blocks-one',
      '--blocks-source',
      '/tmp/blocks-two'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--blocks-source may be provided only once/);
});

test('validate-brief CLI rejects catalog overrides', () => {
  const result = spawnSync(
    process.execPath,
    [validateBriefCliPath, briefPath, '--catalog', '/tmp/injected-catalog.json'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option: --catalog/);
});

test('brief-owned descriptors reject a real file reached through a symlinked parent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'constructive-builder-descriptor-'));
  const briefDirectory = path.join(root, 'brief');
  const outsideDirectory = path.join(root, 'outside');
  fs.mkdirSync(briefDirectory);
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(path.join(outsideDirectory, 'tenant.json'), '{}\n', 'utf8');
  fs.symlinkSync(outsideDirectory, path.join(briefDirectory, 'linked'));
  const errors = [];
  const resolved = resolveBriefOwnedFile(
    briefDirectory,
    'linked/tenant.json',
    'tenant descriptor',
    errors
  );
  assert.equal(resolved, null);
  assert.match(errors.join('\n'), /escapes the brief directory through a symlinked parent/);
});
