#!/usr/bin/env node
/**
 * check-flows.mjs — drift guard for the Constructive flow catalog.
 *
 * Bundled in the `constructive-builder` agent skill (no cross-repo dependency).
 * Where `check-sdk.mjs` guards the *frontend* contract (a block's generated-hook
 * prerequisites), this guards the *flow catalog* contract for the catalog this
 * skill SHIPS at `references/flows.json`.
 *
 * SELF-CONTAINED. The catalog is GENERATED upstream (apps/blocks
 * `scripts/flows-content.mjs` -> resolved `src/flows/flows.json`), which stamps a
 * `sotHash` (sha256 over the canonicalized flows) into every emitted copy. This
 * skill does NOT reach into a sibling apps/blocks (or agentic-flow) checkout at
 * runtime. By default it runs only the checks that need no external source:
 *   - self-consistency: sha256(canonical({flows})) === the copy's embedded sotHash
 *     (catches a hand-edit of references/flows.json that forgot to re-stamp), and
 *   - referential integrity per flow (status/blocks/preset/modules sanity).
 * The upstream-SoT comparison is OPT-IN: pass `--sot <file>` or set FLOWS_SOT to
 * an apps/blocks `src/flows/flows.json` and it will additionally assert this
 * skill's copy matches that SoT. With no SoT supplied, those comparisons are
 * reported as "not reachable (skipped)" — not a failure.
 *
 * Zero dependencies. Pure Node (>=18), node:crypto for sha256.
 *
 *   node check-flows.mjs                              # self-check the shipped catalog
 *   node check-flows.mjs --harness-flows references/flows.json  # name the shipped copy explicitly (the skill's invocation contract)
 *   node check-flows.mjs --project /path/skill        # resolve the skill copy from a different skill root
 *   node check-flows.mjs --sot /abs/apps/blocks/src/flows/flows.json  # opt-in upstream-SoT comparison
 *   node check-flows.mjs --json                       # machine-readable report on stdout
 *   node check-flows.mjs --help
 *
 * Catalog copy to check (highest precedence first):
 *   --harness-flows <path>  the shipped catalog file (resolved against cwd).
 *   --project <dir>         <dir>/references/flows.json (a relocated skill root).
 *   default                 ../references/flows.json next to this script.
 *
 * Optional upstream SoT (opt-in only — never auto-discovered):
 *   --sot <path>    explicit SoT flows.json (resolved against cwd).
 *   FLOWS_SOT       env -> an apps/blocks/src/flows/flows.json (resolved SoT artifact).
 *
 * Optional preset registry (referential modules⊆preset check; skipped if unset):
 *   FLOWS_PRESETS   env -> constructive/packages/node-type-registry.
 *
 * Exit codes (mirroring check-sdk.mjs):
 *   0  every RUNNABLE check passed (self-checks, plus the SoT comparison if supplied)
 *   1  DRIFT — a hash mismatch, an SoT mismatch (when supplied), or a referential-integrity break
 *   2  the check could not run (the shipped catalog copy is missing / unreadable / unparseable / bad args)
 *
 * What it verifies:
 *   1. self-consistency: sha256(canonical({flows})) === the shipped copy's embedded sotHash.
 *   2. (opt-in) shipped copy sotHash === supplied SoT sotHash.
 *   3. referential integrity per flow: status==='ga', blocks non-empty, preset
 *      present, modules non-empty, relatedFlows resolve, and (if FLOWS_PRESETS is
 *      set) modules ⊆ preset (compared on the display key — flows.json modules are
 *      NATIVE strings + ["name",{scope}] tuples; the preset side is normalized to match).
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
  const opts = { project: null, sot: null, skillFlows: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') opts.project = resolve(argv[++i] ?? '.');
    else if (a === '--sot') opts.sot = resolve(argv[++i] ?? '.'); // explicit SoT flows.json, relative to cwd
    // --harness-flows <path>: the catalog copy this skill SHIPS (references/flows.json),
    // resolved against cwd. This is the self-contained invocation contract used by this
    // skill's `pnpm check:flows` and scripts/verify-phase.sh — it names the file to self-check.
    else if (a === '--harness-flows') opts.skillFlows = resolve(argv[++i] ?? '.');
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

const HELP = `check-flows.mjs — self-check the flow catalog this skill ships (references/flows.json).

Usage:
  node check-flows.mjs [--harness-flows FILE] [--project DIR] [--sot FILE] [--json] [--help]

  --harness-flows FILE  the shipped catalog file to check (relative to cwd). The
                        self-contained invocation contract used by this skill's
                        \`pnpm check:flows\` and scripts/verify-phase.sh.
  --project DIR   skill root to resolve references/flows.json from
                  (default: relative to this script)
  --sot FILE      OPT-IN upstream SoT flows.json to compare against (relative to
                  cwd). Never auto-discovered — self-contained by default.
  --json          emit a machine-readable report
  --help          show this help

Env overrides:
  FLOWS_SOT       opt-in upstream SoT (an apps/blocks src/flows/flows.json)
  FLOWS_PRESETS   constructive/packages/node-type-registry (for the optional
                  modules⊆preset check; skipped when unset)

Exit codes: 0 in sync · 1 drift · 2 can't run.
Drift fix: ${REMEDIATION}`;

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
// (modules ⊆ preset). The registry root is supplied opt-in via FLOWS_PRESETS;
// if it isn't set this check is skipped (self-contained — no sibling-repo probe).
// ---------------------------------------------------------------------------
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
// locateEnv — resolve an OPTIONAL external coordinate from an env override ONLY.
// SELF-CONTAINED: this skill never walks up into a sibling apps/blocks or
// agentic-flow checkout to auto-discover the upstream SoT or the preset registry
// (that was the cross-repo glob removed during re-homing). If the env var is
// unset the coordinate is "not reachable" and the dependent check is skipped.
// ---------------------------------------------------------------------------
function locateEnv(envVar) {
  const override = process.env[envVar];
  if (!override) return null;
  return isAbsolute(override) ? override : resolve(process.cwd(), override);
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

  // The catalog copy this skill ships (required). Precedence:
  //   --harness-flows <file>  (the self-contained invocation contract)
  //   --project <dir>/references/flows.json  (a relocated skill root)
  //   default                 ../references/flows.json next to this script.
  const skillFlowsPath = opts.skillFlows ?? (opts.project ? join(opts.project, 'references', 'flows.json') : SKILL_FLOWS);
  const skill = loadPayload(skillFlowsPath, 'skill flows.json', { required: true });

  // Upstream SoT (OPTIONAL, opt-in only — never auto-discovered). Self-contained
  // by default: with no --sot / FLOWS_SOT the SoT-comparison check is skipped.
  const sotPath = opts.sot ?? locateEnv('FLOWS_SOT');
  const sot = sotPath ? loadPayload(sotPath, 'SoT flows.json', { required: true }) : null;

  // Preset resolver (optional — referential-integrity modules⊆preset skipped if unreachable).
  const ntrRoot = locateEnv('FLOWS_PRESETS');
  const presetResolver = makePresetResolver(ntrRoot);

  const checks = [];
  let failed = false;
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) failed = true;
  };

  // 1. self-consistency: the shipped copy's embedded sotHash matches its own flows.
  //    This needs NO external source and catches a hand-edit that forgot to re-stamp.
  const skillRecomputed = sotHashOf(skill.json.flows);
  add(
    'skill-self-consistent',
    skillRecomputed === skill.json.sotHash,
    skillRecomputed === skill.json.sotHash ? 'skill embedded sotHash matches its own flows' : `skill embedded ${skill.json.sotHash} != recomputed ${skillRecomputed}`
  );
  // 2. (opt-in) shipped copy sotHash === upstream SoT sotHash. Also re-verify the
  //    SoT's own self-consistency so a hand-edited SoT can't mask a real match/mismatch.
  //    Skipped entirely when no SoT was supplied (the self-contained default).
  if (sot) {
    const sotRecomputed = sotHashOf(sot.json.flows);
    add(
      'sot-self-consistent',
      sotRecomputed === sot.json.sotHash,
      sotRecomputed === sot.json.sotHash ? `SoT sotHash ${sot.json.sotHash.slice(0, 12)}… matches recomputed` : `SoT embedded ${sot.json.sotHash} != recomputed ${sotRecomputed} (SoT flows.json was hand-edited)`
    );
    add(
      'skill-matches-sot',
      skill.json.sotHash === sot.json.sotHash,
      skill.json.sotHash === sot.json.sotHash ? 'skill sotHash === SoT sotHash' : `skill ${skill.json.sotHash} != SoT ${sot.json.sotHash}`
    );
  }

  // 3. referential integrity (per flow) — asserted on the shipped skill copy.
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
          sot: sotPath ?? null,
          sotReachable: !!sot,
          presetsRoot: ntrRoot ?? null,
          presetResolutionVia: presetResolver?.via ?? null,
          sotHash: skill.json.sotHash,
          checks,
          integrity
        },
        null,
        2
      )
    );
    process.exit(failed ? 1 : 0);
  }

  console.log(C.bold('\nConstructive — flow catalog drift guard\n'));
  console.log(`${C.dim('skill  ')} ${skillFlowsPath}`);
  console.log(`${C.dim('sot    ')} ${sotPath ? sotPath : C.yellow('(opt-in; not supplied — SoT comparison skipped, set --sot / FLOWS_SOT)')}`);
  console.log(`${C.dim('presets')} ${ntrRoot ? `${ntrRoot} ${C.dim(`(${presetResolver?.via ?? 'unresolved'})`)}` : C.yellow('(opt-in; not supplied — modules⊆preset skipped, set FLOWS_PRESETS)')}`);
  console.log(`${C.dim('sotHash')} ${skill.json.sotHash}\n`);

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

  console.log(C.green(sot ? '\n✓ Flow catalog in sync (matches the supplied SoT).' : '\n✓ Flow catalog self-consistent (self-contained checks passed; upstream-SoT comparison skipped — pass --sot / FLOWS_SOT to also diff against apps/blocks).'));
  process.exit(0);
}

main();
