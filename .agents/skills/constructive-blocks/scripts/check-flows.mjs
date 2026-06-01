#!/usr/bin/env node
/**
 * check-flows.mjs — drift guard for the Constructive Blocks flow catalog.
 *
 * Part of the `constructive-blocks` agent skill. Where `check-sdk.mjs` guards the
 * *frontend* contract (a block's generated-hook prerequisites), this guards the
 * *flow catalog* contract: that the committed `references/flows.json` in this
 * skill is still a faithful, in-sync projection of the single source of truth in
 * apps/blocks (`scripts/flows-content.mjs` -> resolved `src/flows/flows.json`),
 * and that the harness copy hasn't drifted from the skill copy.
 *
 * The catalog is GENERATED, never hand-edited. The generator
 * (apps/blocks/scripts/generate-flows.mjs) computes a `sotHash` over the
 * resolved flows and stamps it into every emitted `flows.json`. This script
 * recomputes that hash with the SAME canonicalization and asserts it matches —
 * turning silent drift (someone edits a committed flows.json, or regenerates one
 * copy but not the other) into a loud, actionable failure.
 *
 * Zero dependencies. Pure Node (>=18), node:crypto for sha256. Run from the
 * skill repo root (or anywhere with --project / env overrides):
 *
 *   node check-flows.mjs                       # verify this skill's catalog is in-sync
 *   node check-flows.mjs --project /path/repo  # resolve the skill copy from a different root
 *   node check-flows.mjs --sot src/flows/flows.json  # explicit SoT (relative to cwd)
 *   node check-flows.mjs --json                # machine-readable report on stdout
 *   node check-flows.mjs --help
 *
 * SoT / harness / presets are located via (highest precedence first):
 *   --sot <path>    explicit SoT flows.json (resolved against cwd) — used by the
 *                   in-repo `pnpm check:flows` in apps/blocks (`--sot src/flows/flows.json`).
 *   FLOWS_SOT       env -> apps/blocks/src/flows/flows.json   (resolved SoT artifact)
 *   findUp          apps/blocks/src/flows/flows.json walked up from this script.
 *   FLOWS_HARNESS   env -> agentic-flow .../references/flows.json (byte-twin of skill copy)
 *   FLOWS_PRESETS   env -> constructive/packages/node-type-registry (preset resolution)
 * If a path can't be resolved it is treated as "not reachable" and SKIPPED
 * (not a failure) — except the skill copy and the SoT, which are required.
 *
 * Exit codes (mirroring check-sdk.mjs):
 *   0  everything in sync (or the only-reachable checks all passed)
 *   1  DRIFT — a hash mismatch, a byte mismatch, or a referential-integrity break
 *   2  the check could not run (skill copy or SoT unreadable / unparseable / bad args)
 *
 * What it verifies:
 *   1. SoT self-consistency: sha256(canonical({flows})) === embedded sotHash.
 *   2. skill copy sotHash === SoT sotHash.
 *   3. harness copy (if reachable) sotHash === SoT sotHash.
 *   4. skill copy bytes === harness copy bytes (if reachable).
 *   5. referential integrity per flow: status==='ga', blocks non-empty, preset
 *      resolves from node-type-registry (if reachable), modules ⊆ preset
 *      (compared on the display key — flows.json modules are NATIVE strings +
 *      ["name",{scope}] tuples; the preset side is normalized to match).
 *
 * On any drift it prints the remediation: "re-run: (cd apps/blocks && pnpm gen:flows)".
 */

import crypto from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireCjs = createRequire(import.meta.url);

const scriptDir = dirname(fileURLToPath(import.meta.url));

// The skill copy this script is bundled alongside: ../references/flows.json.
const SKILL_FLOWS = resolve(scriptDir, '..', 'references', 'flows.json');

// Remediation printed on every drift — regenerating from the SoT is the only fix.
const REMEDIATION = 're-run: (cd apps/blocks && pnpm gen:flows)';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { project: null, sot: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') opts.project = resolve(argv[++i] ?? '.');
    else if (a === '--sot') opts.sot = resolve(argv[++i] ?? '.'); // explicit SoT flows.json, relative to cwd
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// reporting (mirrors check-sdk.mjs)
// ---------------------------------------------------------------------------
const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s, yellow: (s) => s };

function fail(code, msg) {
  console.error(`${C.red('✗')} ${msg}`);
  process.exit(code);
}

const HELP = `check-flows.mjs — verify this skill's flow catalog is in sync with apps/blocks.

Usage:
  node check-flows.mjs [--project DIR] [--sot FILE] [--json] [--help]

  --project DIR   root to resolve the skill copy of references/flows.json from
                  (default: relative to this script)
  --sot FILE      explicit SoT flows.json (relative to cwd). Highest precedence;
                  used by apps/blocks: \`check:flows --sot src/flows/flows.json\`.
  --json          emit a machine-readable report
  --help          show this help

Env overrides (else auto-located via findUp):
  FLOWS_SOT       apps/blocks/src/flows/flows.json (the resolved source of truth)
  FLOWS_HARNESS   agentic-flow references/flows.json (byte-twin of the skill copy)
  FLOWS_PRESETS   constructive/packages/node-type-registry (for preset resolution)

Exit codes: 0 in sync · 1 drift · 2 can't run.
Drift fix: ${REMEDIATION}`;

// ---------------------------------------------------------------------------
// findUp — walk up from a start dir looking for a relative target. At each
// ancestor level it ALSO probes one level of siblings (`<ancestor>/*/<rel>`),
// which is what lets a sibling-worktree layout resolve: walking up from the
// skill worktree hits the shared parent (e.g. `.worktrees-v2/`), whose children
// include the dashboard worktree carrying `apps/blocks/src/flows/flows.json`.
// Direct ancestor matches always win over sibling matches; siblings are tried
// in sorted order for determinism.
// ---------------------------------------------------------------------------
function findUp(startDir, relTarget) {
  let dir = startDir;
  for (;;) {
    const direct = join(dir, relTarget);
    if (existsSync(direct)) return direct;
    // One level of siblings under this ancestor.
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      children = [];
    }
    for (const child of children) {
      const sib = join(dir, child, relTarget);
      if (existsSync(sib)) return sib;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// CANONICALIZATION — replicated EXACTLY from
// apps/blocks/scripts/generate-flows.mjs. Do NOT "improve" it; the hash only
// matches if this is byte-for-byte the same algorithm:
//   canonical(value):
//     - arrays  -> "[" + canonical(item) joined by "," + "]"  (ORDER PRESERVED;
//                  module lists keep preset declaration order, flows keep
//                  authored order — do NOT sort arrays).
//     - objects -> "{" + for each key in Object.keys(obj).sort():
//                    JSON.stringify(key) + ":" + canonical(obj[key])
//                  joined by "," + "}"   (KEYS SORTED).
//     - else    -> JSON.stringify(value).
//   No whitespace. sotHash = sha256_hex(canonical({ flows: resolvedFlows })).
// The envelope ({ generatedAt, source, sotHash, groups }) is NOT part of the hash.
// ---------------------------------------------------------------------------
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sotHashOf(flows) {
  return crypto.createHash('sha256').update(canonicalize({ flows })).digest('hex');
}

// ---------------------------------------------------------------------------
// preset resolution — same dist-preferred / regex-source-fallback strategy as
// generate-flows.mjs, used ONLY for the referential-integrity check
// (modules ⊆ preset). If the registry isn't reachable, this check is skipped.
// ---------------------------------------------------------------------------
const NTR_REL = join('constructive', 'packages', 'node-type-registry');

function normalizeModule(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    const [name, opts] = entry;
    if (opts && typeof opts === 'object') {
      if (typeof opts.scope === 'string') return `${name}:${opts.scope}`;
      const keys = Object.keys(opts).sort();
      if (keys.length) return `${name}:${keys.map((k) => `${k}=${String(opts[k])}`).join(',')}`;
    }
    return name;
  }
  return String(entry);
}

function resolvePresetFromDist(ntrRoot, presetName) {
  const distIndex = join(ntrRoot, 'dist', 'module-presets', 'index.js');
  if (!existsSync(distIndex)) return null;
  let mod;
  try {
    // Dist is CommonJS; load it through createRequire (zero-dep, no top-level await).
    mod = requireCjs(distIndex);
  } catch {
    return null;
  }
  const getPreset = mod.getModulePreset ?? mod.default?.getModulePreset;
  const preset = getPreset?.(presetName);
  if (!preset || !Array.isArray(preset.modules)) return null;
  return preset.modules.map(normalizeModule);
}

function presetSourceFiles(ntrRoot) {
  const dir = join(ntrRoot, 'src', 'module-presets');
  const byName = new Map();
  if (!existsSync(dir)) return byName;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return byName;
  }
  for (const file of entries) {
    if (!file.endsWith('.ts') || file === 'index.ts' || file === 'types.ts') continue;
    let text;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const nameMatch = text.match(/name:\s*'([^']+)'/);
    if (nameMatch) byName.set(nameMatch[1], text);
  }
  return byName;
}

function parseModulesBlock(text) {
  const start = text.indexOf('modules:');
  if (start === -1) return null;
  const open = text.indexOf('[', start);
  if (open === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const body = text.slice(open + 1, end);
  const modules = [];
  const tupleRe = /\[\s*'([^']+)'\s*,\s*\{([^}]*)\}\s*\]/g;
  const consumed = [];
  let m;
  while ((m = tupleRe.exec(body)) !== null) {
    const name = m[1];
    const optsBody = m[2];
    const scope = optsBody.match(/scope:\s*'([^']+)'/);
    if (scope) modules.push(`${name}:${scope[1]}`);
    else {
      const kv = optsBody.match(/(\w+):\s*'?([^,'}]+)'?/);
      modules.push(kv ? `${name}:${kv[1]}=${kv[2].trim()}` : name);
    }
    consumed.push([m.index, m.index + m[0].length]);
  }
  let plainSrc = body;
  for (const [s, e] of consumed.reverse()) plainSrc = plainSrc.slice(0, s) + ' '.repeat(e - s) + plainSrc.slice(e);
  const stringRe = /'([^']+)'/g;
  while ((m = stringRe.exec(plainSrc)) !== null) modules.push(m[1]);
  return modules;
}

function resolvePresetFromSource(presetName, sourceMap, seen = new Set()) {
  if (seen.has(presetName)) return [];
  seen.add(presetName);
  const text = sourceMap.get(presetName);
  if (!text) return null;
  const own = parseModulesBlock(text);
  if (!own) return null;
  const extendsMatch = text.match(/extends:\s*\[([^\]]*)\]/);
  const parents = extendsMatch ? [...extendsMatch[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  const merged = new Set(own);
  for (const parent of parents) {
    const parentMods = resolvePresetFromSource(parent, sourceMap, seen);
    if (parentMods) for (const mod of parentMods) merged.add(mod);
  }
  return [...merged];
}

/** Returns { resolve(name)->string[]|null, via:'dist'|'regex-source'|null } or null if NTR unreachable. */
function makePresetResolver(ntrRoot) {
  if (!ntrRoot) return null;
  const sourceMap = presetSourceFiles(ntrRoot);
  let via = null;
  const cache = new Map();
  function resolvePreset(name) {
    if (cache.has(name)) return cache.get(name);
    let mods = resolvePresetFromDist(ntrRoot, name);
    if (mods && mods.length) {
      via = via ?? 'dist';
    } else {
      mods = resolvePresetFromSource(name, sourceMap);
      if (mods && mods.length) via = 'regex-source';
    }
    cache.set(name, mods && mods.length ? mods : null);
    return cache.get(name);
  }
  return { resolvePreset, get via() { return via; } };
}

// ---------------------------------------------------------------------------
// payload loading
// ---------------------------------------------------------------------------
function loadPayload(file, label, { required }) {
  if (!existsSync(file)) {
    if (required) fail(2, `${label} not found at ${file}. Run from the skill repo root or pass --project / set the env override.`);
    return null;
  }
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    if (required) fail(2, `${label} unreadable (${file}): ${e.message}`);
    return null;
  }
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    if (required) fail(2, `${label} is not valid JSON (${file}): ${e.message}`);
    return null;
  }
  if (!Array.isArray(json.flows)) {
    if (required) fail(2, `${label} has no \`flows\` array (${file}).`);
    return null;
  }
  if (typeof json.sotHash !== 'string') {
    if (required) fail(2, `${label} has no \`sotHash\` string (${file}).`);
    return null;
  }
  return { file, bytes, json };
}

// ---------------------------------------------------------------------------
// locate SoT, harness, presets (env override -> findUp over candidate targets).
// relTargets may be a single string or an ordered list (first match wins) — the
// list covers worktree-name variants (e.g. `agentic-flow/` vs the actual
// `agentic-flow-blocks/` worktree dir) so the byte-twin harness copy resolves.
// ---------------------------------------------------------------------------
function locate(envVar, relTargets) {
  const override = process.env[envVar];
  if (override) return isAbsolute(override) ? override : resolve(process.cwd(), override);
  for (const rel of [].concat(relTargets)) {
    const hit = findUp(scriptDir, rel);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Skill copy (required). --project overrides where we look for it.
  const skillFlowsPath = opts.project ? join(opts.project, '.agents', 'skills', 'constructive-blocks', 'references', 'flows.json') : SKILL_FLOWS;
  const skill = loadPayload(skillFlowsPath, 'skill flows.json', { required: true });

  // SoT (required) — the resolved artifact the generator wrote.
  // Precedence: --sot (cwd-relative, used by apps/blocks `pnpm check:flows`) > FLOWS_SOT env > findUp.
  const sotPath = opts.sot ?? locate('FLOWS_SOT', join('apps', 'blocks', 'src', 'flows', 'flows.json'));
  if (!sotPath) {
    fail(
      2,
      `Could not locate the SoT flows.json (apps/blocks/src/flows/flows.json) via findUp from ${scriptDir}.\n` +
        `  Set FLOWS_SOT=/abs/path/to/apps/blocks/src/flows/flows.json (e.g. the dashboard worktree) and re-run.`
    );
  }
  const sot = loadPayload(sotPath, 'SoT flows.json', { required: true });

  // Harness copy (optional — skipped if not reachable). Probe both the canonical
  // `agentic-flow/` name and the active `agentic-flow-blocks/` worktree dir.
  const harnessPath = locate('FLOWS_HARNESS', [
    join('agentic-flow', 'references', 'flows.json'),
    join('agentic-flow-blocks', 'references', 'flows.json')
  ]);
  const harness = harnessPath ? loadPayload(harnessPath, 'harness flows.json', { required: false }) : null;

  // Preset resolver (optional — referential-integrity modules⊆preset skipped if unreachable).
  const ntrRoot = locate('FLOWS_PRESETS', NTR_REL);
  const presetResolver = makePresetResolver(ntrRoot);

  const checks = [];
  let failed = false;
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) failed = true;
  };

  // 1. SoT self-consistency.
  const sotRecomputed = sotHashOf(sot.json.flows);
  add(
    'sot-self-consistent',
    sotRecomputed === sot.json.sotHash,
    sotRecomputed === sot.json.sotHash
      ? `sotHash ${sot.json.sotHash.slice(0, 12)}… matches recomputed`
      : `embedded ${sot.json.sotHash} != recomputed ${sotRecomputed} (SoT flows.json was hand-edited)`
  );

  // 2. skill copy sotHash === SoT sotHash (recompute skill too, belt-and-suspenders).
  const skillRecomputed = sotHashOf(skill.json.flows);
  add(
    'skill-self-consistent',
    skillRecomputed === skill.json.sotHash,
    skillRecomputed === skill.json.sotHash ? 'skill embedded sotHash matches its own flows' : `skill embedded ${skill.json.sotHash} != recomputed ${skillRecomputed}`
  );
  add(
    'skill-matches-sot',
    skill.json.sotHash === sot.json.sotHash,
    skill.json.sotHash === sot.json.sotHash ? 'skill sotHash === SoT sotHash' : `skill ${skill.json.sotHash} != SoT ${sot.json.sotHash}`
  );

  // 3 + 4. harness checks (only if reachable).
  if (harness) {
    add(
      'harness-matches-sot',
      harness.json.sotHash === sot.json.sotHash,
      harness.json.sotHash === sot.json.sotHash ? 'harness sotHash === SoT sotHash' : `harness ${harness.json.sotHash} != SoT ${sot.json.sotHash}`
    );
    add(
      'skill-equals-harness-bytes',
      skill.bytes.equals(harness.bytes),
      skill.bytes.equals(harness.bytes) ? 'skill flows.json bytes === harness flows.json bytes' : 'skill and harness flows.json are NOT byte-identical (one copy was regenerated without the other)'
    );
  }

  // 5. referential integrity (per flow). Hash is over the SoT, but integrity is
  //    asserted on the skill copy (the artifact this repo ships). They share a
  //    hash, so this is equivalent; we report against what's shipped here.
  const flowIds = new Set(skill.json.flows.map((f) => f.id));
  const integrity = [];
  for (const flow of skill.json.flows) {
    const problems = [];
    if (flow.status !== 'ga') problems.push(`status='${flow.status}' (only 'ga' allowed)`);
    if (!Array.isArray(flow.blocks) || flow.blocks.length === 0) problems.push('blocks[] empty');
    const preset = flow.backend?.preset;
    const modules = flow.backend?.modules;
    if (!preset) problems.push('backend.preset missing');
    if (!Array.isArray(modules) || modules.length === 0) problems.push('backend.modules[] empty');
    for (const rel of flow.relatedFlows ?? []) {
      if (!flowIds.has(rel)) problems.push(`relatedFlows -> unknown flow '${rel}'`);
    }
    // modules ⊆ preset (only when the registry is reachable AND the preset resolves).
    // flows.json carries NATIVE module entries (plain strings + ["name",{scope}]
    // tuples — provisioning-ready); the preset resolver normalizes its entries to
    // display strings. Compare on the shared display key (normalizeModule) so a
    // tuple `["memberships_module",{scope:"app"}]` matches the preset's
    // `memberships_module:app`.
    if (presetResolver && preset && Array.isArray(modules)) {
      const presetMods = presetResolver.resolvePreset(preset);
      if (presetMods === null) {
        problems.push(`preset '${preset}' did not resolve from node-type-registry`);
      } else {
        const presetSet = new Set(presetMods.map(normalizeModule));
        const escapees = modules.map(normalizeModule).filter((m) => !presetSet.has(m));
        if (escapees.length) problems.push(`modules not ⊆ preset '${preset}': [${escapees.join(', ')}]`);
      }
    }
    integrity.push({ id: flow.id, ok: problems.length === 0, problems });
  }
  const integrityOk = integrity.every((i) => i.ok);
  const presetNote = presetResolver ? `via ${presetResolver.via ?? 'unresolved'}` : 'preset resolution SKIPPED (node-type-registry not reachable)';
  add('referential-integrity', integrityOk, integrityOk ? `${integrity.length} flows OK (${presetNote})` : `${integrity.filter((i) => !i.ok).length}/${integrity.length} flows have problems (${presetNote})`);

  // -------------------------------------------------------------------------
  // report
  // -------------------------------------------------------------------------
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: !failed,
          skill: skillFlowsPath,
          sot: sotPath,
          harness: harnessPath ?? null,
          harnessReachable: !!harness,
          presetsRoot: ntrRoot ?? null,
          presetResolutionVia: presetResolver?.via ?? null,
          sotHash: sot.json.sotHash,
          checks,
          integrity
        },
        null,
        2
      )
    );
    process.exit(failed ? 1 : 0);
  }

  console.log(C.bold('\nConstructive Blocks — flow catalog drift guard\n'));
  console.log(`${C.dim('skill  ')} ${skillFlowsPath}`);
  console.log(`${C.dim('sot    ')} ${sotPath}`);
  console.log(`${C.dim('harness')} ${harnessPath ? harnessPath : C.yellow('(not reachable — skipped)')}`);
  console.log(`${C.dim('presets')} ${ntrRoot ? `${ntrRoot} ${C.dim(`(${presetResolver?.via ?? 'unresolved'})`)}` : C.yellow('(not reachable — modules⊆preset skipped)')}`);
  console.log(`${C.dim('sotHash')} ${sot.json.sotHash}\n`);

  for (const c of checks) {
    console.log(`${c.ok ? C.green('✓') : C.red('✗')} ${c.name} ${C.dim(`— ${c.detail}`)}`);
  }

  if (!integrityOk) {
    console.log('');
    for (const i of integrity.filter((x) => !x.ok)) {
      console.log(`  ${C.red('✗')} ${C.bold(i.id)}: ${i.problems.join('; ')}`);
    }
  }

  if (failed) {
    console.log(C.red('\n✗ Flow catalog drift detected.'));
    console.log(`\n  ${C.bold(REMEDIATION)}`);
    console.log(
      C.dim(
        '\n  The catalog is generated from apps/blocks/scripts/flows-content.mjs.\n' +
          '  Never hand-edit references/flows.json or references/flow-catalog.md — regenerate.'
      )
    );
    process.exit(1);
  }

  console.log(C.green('\n✓ Flow catalog in sync.'));
  process.exit(0);
}

main();
