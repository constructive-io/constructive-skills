#!/usr/bin/env node
/**
 * Focused tests for check-sdk.mjs — the plural↔singular model normalisation
 * and the declared-backend-pending op handling (F12).
 *
 * Zero deps, Node ≥18 built-in test runner:
 *
 *   node --test .agents/skills/constructive-blocks/scripts/check-sdk.test.mjs
 *
 * Each case builds a throwaway host app (tsconfig + a tiny generated SDK whose
 * model files are SINGULAR, mirroring the real ORM on-disk shape) plus a
 * manifest, then runs check-sdk.mjs as a child process and asserts the exit
 * code + a couple of report lines. The invariant under test is the SDK Binding
 * Contract's "make BOTH-correct" rule: a manifest may declare a list model in
 * the plural (`orgMemberships`) or singular (`orgMembership`) and either must
 * satisfy the singular on-disk `models/orgMembership.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-sdk.mjs');

// Build a host-app fixture. `models` are SINGULAR file basenames (as codegen
// emits); `hooks` are the generated hook identifiers that exist.
function makeApp({ models = [], hooks = [], manifest }) {
  const root = mkdtempSync(join(tmpdir(), 'check-sdk-'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/generated/*': ['./src/generated/*'] } } })
  );
  const modelsDir = join(root, 'src/generated/admin/orm/models');
  const hooksDir = join(root, 'src/generated/admin/hooks/mutations');
  mkdirSync(modelsDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
  for (const m of models) writeFileSync(join(modelsDir, `${m}.ts`), `export class ${m[0].toUpperCase()}${m.slice(1)}Model {}\n`);
  for (const h of hooks) writeFileSync(join(hooksDir, `${h}.ts`), `export function ${h}() {}\n`);
  const manifestDir = join(root, 'src/.constructive/blocks');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'block.requires.json'), JSON.stringify(manifest));
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [SCRIPT, '--project', root], { encoding: 'utf-8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

const GA_HOOKS = ['useUpdateOrgMembershipMutation', 'useDeleteOrgMembershipMutation'];

test('plural manifest model matches singular on-disk accessor (exit 0)', () => {
  const root = makeApp({
    models: ['orgMembership'],
    hooks: GA_HOOKS,
    manifest: { namespace: 'admin', mutations: ['updateOrgMembership', 'deleteOrgMembership'], queries: [], models: ['orgMemberships'] }
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /model orgMemberships → models\/orgMembership/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('singular manifest model also matches (BOTH-correct, exit 0)', () => {
  const root = makeApp({
    models: ['orgMembership'],
    hooks: GA_HOOKS,
    manifest: { namespace: 'admin', mutations: ['updateOrgMembership', 'deleteOrgMembership'], queries: [], models: ['orgMembership'] }
  });
  try {
    assert.equal(run(root).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('-ies plural normalises to -y (identities → identity)', () => {
  const root = makeApp({
    models: ['identity'],
    hooks: [],
    manifest: { namespace: 'admin', mutations: [], queries: [], models: ['identities'] }
  });
  try {
    assert.equal(run(root).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('declared-pending op is informational, not a failure (exit 0)', () => {
  const root = makeApp({
    models: ['orgMembership'],
    hooks: GA_HOOKS, // removeOrgMember / transferOrgOwnership intentionally absent
    manifest: {
      namespace: 'admin',
      mutations: ['updateOrgMembership', 'deleteOrgMembership', 'removeOrgMember', 'transferOrgOwnership'],
      queries: [],
      models: ['orgMemberships'],
      pending: ['removeOrgMember', 'transferOrgOwnership']
    }
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    // Each declared-pending op is reported informationally (◦) as backend-pending,
    // and the run summarises them as backend-pending seam(s) — but never fails.
    assert.match(out, /removeOrgMember.*backend-pending/);
    assert.match(out, /backend-pending seam/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a NON-pending missing op that IS IMPORTED still fails (exit 1) — binding still protects', () => {
  // The import-presence gate (§9) hard-fails only on a missing op the block
  // genuinely IMPORTS from @/generated/* (a real compile-against-a-missing-export);
  // a declared-but-unimported op degrades (◦, exit 0). So to exercise the protection
  // this fixture IMPORTS the missing hook in a source file.
  const root = makeApp({
    models: ['orgMembership'],
    hooks: GA_HOOKS,
    manifest: { namespace: 'admin', mutations: ['updateOrgMembership', 'totallyMissingOp'], queries: [], models: ['orgMembership'] }
  });
  // add a source file that imports the missing op's hook (triggers the hard-fail)
  const blocksDir = join(root, 'src/blocks');
  mkdirSync(blocksDir, { recursive: true });
  writeFileSync(
    join(blocksDir, 'uses-missing.tsx'),
    "import { useTotallyMissingOpMutation } from '@/generated/admin';\nexport function X() { useTotallyMissingOpMutation({}); return null; }\n"
  );
  try {
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /✗ mutation totallyMissingOp/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pending op that IS present reports ✓, not suppressed (exit 0)', () => {
  const root = makeApp({
    models: [],
    hooks: ['useRemoveOrgMemberMutation'],
    manifest: { namespace: 'admin', mutations: ['removeOrgMember'], queries: [], models: [], pending: ['removeOrgMember'] }
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /✓ mutation removeOrgMember/);
    assert.doesNotMatch(out, /backend-pending/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CONTRACT PREFLIGHT — known arg-domain + defective/RLS-blocked op advisories.
//
// These assert the WARN-only contract layer: an op that EXISTS (passes the
// binding gate) but has a known runtime arg-domain (createApiKey.accessLevel) or
// upstream defect (sendVerificationEmail GAP-9, revokeApiKey GAP-3, createUser
// GAP-6, sessions GAP-2, …) must produce a `warnings[]` entry naming the GAP-N +
// safe value, WITHOUT changing the exit code. The advisory table mirrors
// SKILL.md "Known SDK gaps" and the harness PLATFORM-GAPS.md confirmed-live facts.
//
// `manifest` is written verbatim (so a test controls the namespace + declared
// ops). `hooks` are generated hook identifiers that EXIST (so the binding gate
// passes). `src` is an optional map of {relativePath: contents} written under
// src/ — used to exercise import-presence + arg-domain corroboration.
// ---------------------------------------------------------------------------
function makeContractApp({ ns = 'auth', hooks = [], manifest, src = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'check-sdk-contract-'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/generated/*': ['./src/generated/*'] } } })
  );
  const hooksDir = join(root, `src/generated/${ns}/hooks/mutations`);
  mkdirSync(hooksDir, { recursive: true });
  for (const h of hooks) writeFileSync(join(hooksDir, `${h}.ts`), `export function ${h}() {}\n`);
  for (const [rel, contents] of Object.entries(src)) {
    const p = join(root, 'src', rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, contents);
  }
  const manifestDir = join(root, 'src/.constructive/blocks');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'block.requires.json'), JSON.stringify(manifest));
  return root;
}

// Run with --json and parse the report (so we can assert on warnings[] structurally).
function runJson(root) {
  const r = spawnSync(process.execPath, [SCRIPT, '--project', root, '--json'], { encoding: 'utf-8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* leave null — the assertion will surface stderr */
  }
  return { code: r.status, json, out: r.stdout + r.stderr };
}

test('arg-domain: createApiKey accessLevel WARNs {read_only,full_access}, never fails (exit 0)', () => {
  const root = makeContractApp({
    ns: 'auth',
    hooks: ['useCreateApiKeyMutation'], // op EXISTS → binding gate passes
    manifest: { namespace: 'auth', mutations: ['createApiKey'], queries: [], models: [] },
    src: {
      // block hard-codes the BAD enum values → corroboration upgrades to 'confirmed'
      'blocks/auth/api-key-create-dialog.tsx':
        "import { useCreateApiKeyMutation } from '@/generated/auth';\nconst accessLevelOptions = ['read', 'write', 'admin'];\nexport function D() { useCreateApiKeyMutation({ selection: { fields: { clientMutationId: true } } }); return null; }\n"
    }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out); // WARN, NOT a failure
    assert.ok(json, out);
    assert.equal(json.ok, true);
    const w = json.warnings.find((x) => x.id === 'createApiKey-accessLevel');
    assert.ok(w, `expected a createApiKey arg-domain warning, got ${JSON.stringify(json.warnings)}`);
    assert.equal(w.kind, 'arg-domain');
    assert.equal(w.field, 'accessLevel');
    assert.deepEqual(w.safe, ['read_only', 'full_access']);
    assert.deepEqual(w.bad, ['read', 'write', 'admin']);
    assert.equal(w.confidence, 'confirmed'); // the bad literals were found in source
    assert.match(w.message, /INVALID_ACCESS_LEVEL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('defective: sendVerificationEmail WARNs GAP-9, exit 0 (op present, runtime aborts)', () => {
  const root = makeContractApp({
    ns: 'auth',
    hooks: ['useSendVerificationEmailMutation'],
    manifest: { namespace: 'auth', mutations: ['sendVerificationEmail'], queries: [], models: [] }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out);
    const w = json.warnings.find((x) => x.id === 'sendVerificationEmail-abort');
    assert.ok(w, out);
    assert.equal(w.kind, 'defective');
    assert.equal(w.gap, 'GAP-9');
    assert.equal(w.via, 'declared'); // named in the manifest, hook not imported here
    assert.match(w.message, /user_secrets_del/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('defective: createUser(type=2) / createOrganization WARN GAP-6 (RLS-denied)', () => {
  const root = makeContractApp({
    ns: 'admin',
    hooks: ['useCreateUserMutation'],
    manifest: { namespace: 'admin', mutations: ['createUser'], queries: [], models: [] }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out);
    const w = json.warnings.find((x) => x.id === 'createUser-org-rls');
    assert.ok(w, out);
    assert.equal(w.gap, 'GAP-6');
    assert.match(w.message, /row-level security/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('defective: revokeApiKey imported WITHOUT a manifest entry still WARNs GAP-3 (import-presence)', () => {
  const root = makeContractApp({
    ns: 'auth',
    hooks: ['useRevokeApiKeyMutation', 'useSignInMutation'],
    // manifest is for a DIFFERENT, clean op — revokeApiKey is only ever imported
    manifest: { namespace: 'auth', mutations: ['signIn'], queries: [], models: [] },
    src: {
      'blocks/auth/keys.tsx':
        "import { useRevokeApiKeyMutation } from '@/generated/auth';\nexport function K() { useRevokeApiKeyMutation({ selection: { fields: { clientMutationId: true } } }); return null; }\n"
    }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out);
    const w = json.warnings.find((x) => x.id === 'revokeApiKey-noop');
    assert.ok(w, `expected revokeApiKey warning from an imported-only op, got ${JSON.stringify(json.warnings)}`);
    assert.equal(w.via, 'imported');
    assert.equal(w.block, '(imported)');
    assert.equal(w.gap, 'GAP-3');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no false positives: a clean GA block (signIn) emits ZERO contract advisories', () => {
  const root = makeContractApp({
    ns: 'auth',
    hooks: ['useSignInMutation'],
    manifest: { namespace: 'auth', mutations: ['signIn'], queries: [], models: [] },
    src: {
      'blocks/auth/sign-in.tsx':
        "import { useSignInMutation } from '@/generated/auth';\nexport function S() { useSignInMutation({ selection: { fields: { result: { select: { userId: true } } } } }); return null; }\n"
    }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out);
    assert.equal(json.warnings.length, 0, `expected no advisories for a clean GA app, got ${JSON.stringify(json.warnings)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GAP-5 org-admin seams are NOT a contract advisory (left to the binding gate, no "backend-pending" WARN)', () => {
  // removeOrgMember is an *absent* (not-deployed) op — the binding gate's
  // pending/import-presence mechanism already surfaces it. The contract layer must
  // NOT add a redundant WARN (which would also collide with the present-pending
  // "doesNotMatch(/backend-pending/)" expectation when such an op IS deployed).
  const root = makeContractApp({
    ns: 'admin',
    hooks: ['useRemoveOrgMemberMutation'], // present → binding gate clean
    manifest: { namespace: 'admin', mutations: ['removeOrgMember'], queries: [], models: [], pending: ['removeOrgMember'] }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 0, out);
    assert.equal(json.warnings.length, 0, `GAP-5 ops must not appear in contract warnings, got ${JSON.stringify(json.warnings)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a contract advisory does NOT mask a real binding failure (exit 1 still wins)', () => {
  // createApiKey present (so its WARN fires) + a genuinely-missing imported op.
  const root = makeContractApp({
    ns: 'auth',
    hooks: ['useCreateApiKeyMutation'], // present
    manifest: { namespace: 'auth', mutations: ['createApiKey', 'reallyMissingOp'], queries: [], models: [] },
    src: {
      // import BOTH: createApiKey (warns) AND reallyMissingOp (hard-fail — imported but absent)
      'blocks/auth/x.tsx':
        "import { useCreateApiKeyMutation, useReallyMissingOpMutation } from '@/generated/auth';\nexport function X() { useCreateApiKeyMutation({}); useReallyMissingOpMutation({}); return null; }\n"
    }
  });
  try {
    const { code, json, out } = runJson(root);
    assert.equal(code, 1, out); // binding failure dominates
    assert.equal(json.ok, false);
    // the WARN is still recorded (advisory layer runs regardless of failure)
    assert.ok(json.warnings.some((x) => x.id === 'createApiKey-accessLevel'), out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WORKSPACE-ROOT RESOLUTION — --project accepts the workspace root (the dir
// holding packages/, the same <appDir> the scaffolders take) and derives the
// app package (packages/app | app) internally. The 5-app run hit
// `check-sdk --project <workspace-root>` → "No data-block manifests" because
// the manifests + tsconfig actually live under packages/app, not the root.
//
// Build a WORKSPACE ROOT whose app package sits one level down (`packages/app`
// by default, or a root-level `app/`). The root itself carries package.json +
// tsconfig.json but NO src/ — exactly the real pgpm/lerna workspace shape that
// must NOT be mistaken for the app package.
// ---------------------------------------------------------------------------
function makeWorkspace({ appSub = 'packages/app', hooks = ['useSignInMutation'], manifest = { namespace: 'auth', mutations: ['signIn'], queries: [], models: [] } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-sdk-ws-'));
  // Workspace-root markers: a package.json + tsconfig.json but deliberately NO
  // src/ (so isAppPackage() rejects the root and derives the nested package).
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ws-root', private: true }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ files: [] }));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  const appDir = join(root, appSub);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'app' }));
  writeFileSync(join(appDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/generated/*': ['./src/generated/*'] } } }));
  const hooksDir = join(appDir, 'src/generated/auth/hooks/mutations');
  mkdirSync(hooksDir, { recursive: true });
  for (const h of hooks) writeFileSync(join(hooksDir, `${h}.ts`), `export function ${h}() {}\n`);
  const manifestDir = join(appDir, 'src/.constructive/blocks');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'block.requires.json'), JSON.stringify(manifest));
  return { root, appDir };
}

test('workspace root --project resolves packages/app and finds manifests (exit 0)', () => {
  const { root, appDir } = makeWorkspace();
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    // the derivation notice (stderr) names the resolved app package + the root
    assert.match(out, /resolved app package/);
    assert.ok(out.includes(appDir), out);
    // the manifest under packages/app/src was actually checked
    assert.match(out, /✓ mutation signIn → useSignInMutation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace root --project with a root-level app/ layout also resolves (exit 0)', () => {
  const { root, appDir } = makeWorkspace({ appSub: 'app' });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.ok(out.includes(appDir), out);
    assert.match(out, /✓ mutation signIn/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--json on a workspace root keeps stdout PURE JSON (resolution notice → stderr)', () => {
  const { root, appDir } = makeWorkspace();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--project', root, '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // stdout must parse cleanly — the "resolved app package" notice must NOT leak into it
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.project, appDir); // report reflects the DERIVED package
    assert.match(r.stderr, /resolved app package/); // notice went to stderr
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit app package dir is still used as-is (no derivation, no notice)', () => {
  // Back-compat: pointing --project AT the app package (not the workspace root)
  // must behave exactly as before — used verbatim, with no resolution notice.
  const { root, appDir } = makeWorkspace();
  try {
    const { code, out } = run(appDir);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /resolved app package/);
    assert.match(out, /✓ mutation signIn/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unresolvable --project (no app package, no tsconfig) fails loudly (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-sdk-bare-'));
  try {
    const { code, out } = run(dir);
    assert.equal(code, 2, out);
    assert.match(out, /No app package found at or under/);
    assert.match(out, /packages\/app/); // names the dirs it probed
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
