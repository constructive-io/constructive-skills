#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * skill-root.mjs — resolve every input the constructive-builder skill ships WITHIN
 * itself, so the skill is fully self-contained (no "../constructive" /
 * "../constructive-skills" / "../dashboard" sibling assumption at runtime).
 *
 * The skill layout is:
 *   constructive-builder/                 ← skillRoot()
 *     constructive.config.json            ← configPath()
 *     references/                         ← referencesDir()  (docs; flows.json lives here)
 *     fixtures/                           ← fixturesDir()    (FROZEN brief + run-state templates)
 *     scripts/
 *       lib/skill-root.mjs                ← (this file)
 *
 * scripts/lib/skill-root.mjs → the skill root is TWO levels up (lib → scripts → root),
 * mirroring config.mjs's own REPO_ROOT convention exactly. CONSTRUCTIVE_SKILL_ROOT
 * overrides it (e.g. when the scripts are run from an unusual relocation), same spirit
 * as config.mjs's CONSTRUCTIVE_CONFIG_PATH.
 *
 * IMPORTANT — frozen inputs vs the runtime workspace:
 *   • fixturesDir()/referencesDir()/configPath() are FROZEN, ship-with-the-skill INPUTS.
 *   • The per-app RUNTIME workspace (build/<app-id>/run-state.json etc.) is a WRITABLE
 *     runtime dir under the skill root and is NOT a concern of this module — callers keep
 *     using their existing build/ runtime paths. This module only locates frozen inputs
 *     and the external constructive CLI.
 *
 * The constructive CLI is the one EXTERNAL coordinate (the engine that serves the GraphQL
 * hub / runs codegen). It cannot live inside the skill, so it is resolved from the
 * CONSTRUCTIVE_CLI env var FIRST (the self-contained, documented seam), then a best-effort
 * discovery list — never a single hard-coded ".." sibling.
 *
 * Zero dependencies. Pure Node (>=18).
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_LIB_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The constructive-builder skill root — the dir that holds constructive.config.json,
 * references/, fixtures/, scripts/. Two levels up from scripts/lib/. Overridable with
 * CONSTRUCTIVE_SKILL_ROOT.
 */
export function skillRoot() {
  if (process.env.CONSTRUCTIVE_SKILL_ROOT && process.env.CONSTRUCTIVE_SKILL_ROOT !== '') {
    return resolve(process.env.CONSTRUCTIVE_SKILL_ROOT);
  }
  return resolve(SCRIPT_LIB_DIR, '..', '..');
}

/** scripts/ dir within the skill (where the .mjs/.sh engine lives). */
export function scriptsDir() {
  return join(skillRoot(), 'scripts');
}

/** references/ dir — the skill's docs (flows.json, the phase/onramp/catalog markdown). */
export function referencesDir() {
  return join(skillRoot(), 'references');
}

/** fixtures/ dir — the FROZEN brief + run-state template inputs (moved here from build/). */
export function fixturesDir() {
  return join(skillRoot(), 'fixtures');
}

/**
 * constructive.config.json path. Honors CONSTRUCTIVE_CONFIG_PATH (the same override
 * config.mjs reads) so both modules agree on the file's location.
 */
export function configPath() {
  if (process.env.CONSTRUCTIVE_CONFIG_PATH && process.env.CONSTRUCTIVE_CONFIG_PATH !== '') {
    return resolve(process.env.CONSTRUCTIVE_CONFIG_PATH);
  }
  return join(skillRoot(), 'constructive.config.json');
}

/** Resolve a path relative to the skill root (frozen inputs only — not runtime state). */
export function skillPath(...segments) {
  return join(skillRoot(), ...segments);
}

/** Resolve a frozen fixture file by name within fixtures/. */
export function fixturePath(name) {
  return join(fixturesDir(), name);
}

/** Resolve a reference file by name within references/. */
export function referencePath(name) {
  return join(referencesDir(), name);
}

/**
 * Locate the external constructive CLI entry (`packages/cli/dist/index.js`) — the engine
 * the harness invokes with `node <cli> server …` / codegen. Resolution order:
 *   1. CONSTRUCTIVE_CLI env var (an absolute path to dist/index.js) — the self-contained,
 *      documented seam. Used as-is when it exists.
 *   2. A best-effort discovery list of common checkout locations, probed in order. This is
 *      a FALLBACK convenience only; it never hard-codes a single ".." sibling path. The
 *      probe mirrors the .sh discover_constructive_cli (one parent-dir level of siblings,
 *      preferring a plain `constructive` checkout).
 * Returns the absolute path to index.js, or null if none resolves (caller emits the
 * actionable "set CONSTRUCTIVE_CLI=…" hint).
 */
export function constructiveCliPath() {
  const env = process.env.CONSTRUCTIVE_CLI;
  if (env && env !== '' && existsSync(env)) return resolve(env);

  const rel = join('packages', 'cli', 'dist', 'index.js');
  // One parent-dir level above the skill root, preferring a `constructive*` checkout,
  // then any sibling that ships the CLI. Never a literal hard-coded absolute path.
  const parent = resolve(skillRoot(), '..');
  const ordered = [];
  // Explicit `constructive` first (matches the .sh probe's preference order).
  ordered.push(join(parent, 'constructive', rel));
  let children = [];
  try {
    children = readdirSync(parent, { withFileTypes: true });
  } catch {
    children = [];
  }
  for (const ent of children) {
    if (!ent.isDirectory()) continue;
    if (/^constructive/.test(ent.name)) ordered.push(join(parent, ent.name, rel));
  }
  for (const ent of children) {
    if (!ent.isDirectory()) continue;
    ordered.push(join(parent, ent.name, rel));
  }
  for (const cand of ordered) {
    if (existsSync(cand)) return resolve(cand);
  }
  return null;
}

/** A ready-to-spawn ['node', <cli>] argv prefix, or null when the CLI can't be located. */
export function constructiveCliArgv() {
  const cli = constructiveCliPath();
  return cli ? ['node', cli] : null;
}

// ── CLI (so .sh scripts can resolve these via `node scripts/lib/skill-root.mjs …`) ─────
function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);
  const HELP = `skill-root.mjs — resolve the constructive-builder skill's own paths.

Usage:
  node scripts/lib/skill-root.mjs root                 print the skill root dir
  node scripts/lib/skill-root.mjs references           print the references/ dir
  node scripts/lib/skill-root.mjs fixtures             print the fixtures/ dir
  node scripts/lib/skill-root.mjs config               print constructive.config.json path
  node scripts/lib/skill-root.mjs fixture <name>       print fixtures/<name>
  node scripts/lib/skill-root.mjs reference <name>     print references/<name>
  node scripts/lib/skill-root.mjs cli                  print the constructive CLI dist/index.js (or empty + exit 1)
  node scripts/lib/skill-root.mjs --help

CONSTRUCTIVE_SKILL_ROOT overrides the root; CONSTRUCTIVE_CLI overrides the CLI location.`;
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      console.log(HELP);
      process.exitCode = 0;
    } else if (cmd === 'root') {
      console.log(skillRoot());
    } else if (cmd === 'references') {
      console.log(referencesDir());
    } else if (cmd === 'fixtures') {
      console.log(fixturesDir());
    } else if (cmd === 'config') {
      console.log(configPath());
    } else if (cmd === 'fixture') {
      if (!rest[0]) { console.error('fixture: missing <name>'); process.exitCode = 2; }
      else console.log(fixturePath(rest[0]));
    } else if (cmd === 'reference') {
      if (!rest[0]) { console.error('reference: missing <name>'); process.exitCode = 2; }
      else console.log(referencePath(rest[0]));
    } else if (cmd === 'cli') {
      const cli = constructiveCliPath();
      if (cli) { console.log(cli); process.exitCode = 0; }
      else { console.error('constructive CLI not found — set CONSTRUCTIVE_CLI=/abs/.../constructive/packages/cli/dist/index.js'); process.exitCode = 1; }
    } else {
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`skill-root.mjs: ${e.message}`);
    process.exitCode = 2;
  }
}
