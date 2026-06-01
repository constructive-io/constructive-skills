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
    assert.match(out, /removeOrgMember.*backend-pending/);
    assert.match(out, /declared backend-pending seam/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a NON-pending missing op still fails (exit 1) — binding still protects', () => {
  const root = makeApp({
    models: ['orgMembership'],
    hooks: GA_HOOKS,
    manifest: { namespace: 'admin', mutations: ['updateOrgMembership', 'totallyMissingOp'], queries: [], models: ['orgMembership'] }
  });
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
