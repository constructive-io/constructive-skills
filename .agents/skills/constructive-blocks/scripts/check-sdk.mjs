#!/usr/bin/env node
/**
 * check-sdk.mjs — preflight check for installing Constructive data blocks.
 *
 * Part of the `constructive-blocks` agent skill. Implements the enforcement
 * described in the SDK Binding Contract §9: before a data block is considered
 * installable, its declared prerequisites (a co-located `<block>.requires.json`,
 * installed to `.constructive/blocks/`) MUST be satisfied by the host app's
 * generated SDK. A block whose required op is absent fails here — with a precise
 * message — instead of compiling against a guess.
 *
 * Zero dependencies. Pure Node (>=18). Run from the host app's project root:
 *
 *   node check-sdk.mjs                      # check every installed manifest
 *   node check-sdk.mjs auth-sign-in-card    # check one block (name or path)
 *   node check-sdk.mjs --project /path/app  # check a different project root
 *   node check-sdk.mjs --json               # machine-readable report on stdout
 *
 * Exit codes:
 *   0  every prerequisite satisfied (or nothing to check)
 *   1  a prerequisite is missing (alias / generated dir / op export)
 *   2  the check could not run (no tsconfig, bad args, unreadable manifest)
 *
 * What it verifies (per contract §9):
 *   1. the `@/generated/*` alias exists in the host tsconfig
 *   2. the generated dir for each block's namespace exists (resolved via alias)
 *   3. every mutation/query/model in requires.json is an export of that SDK.
 *      Models are matched SINGULAR-insensitively: the ORM accessor (and its
 *      `models/<name>.ts` file) is always singular, so a manifest may declare a
 *      list model plural (`orgMemberships`) or singular (`orgMembership`) — both
 *      satisfy the on-disk `models/orgMembership.ts`. Op/model names listed in a
 *      manifest's optional `pending` array are reported but NEVER fail the check
 *      (a block may ship a seam for a not-yet-deployed proc; a missing op that is
 *      NOT declared pending still fails clearly).
 *   5. (advisory) `@constructive/blocks-runtime` appears mounted somewhere
 *
 * Drift detection (§9.4) and generating a missing SDK (§9.6) require `cnc
 * codegen` + an endpoint + operator confirmation, so they are NOT run here —
 * on failure this script prints the exact `cnc codegen` command to run. The
 * skill's SKILL.md drives that remediation.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);
const SRC_EXT = /\.(?:[cm]?tsx?|d\.ts)$/;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { project: process.cwd(), only: null, json: false, manifestsDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') opts.project = resolve(argv[++i] ?? '.');
    else if (a === '--manifests-dir' || a === '-m') opts.manifestsDir = argv[++i] ?? null;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-')) opts.only = a; // block name or manifest path
  }
  return opts;
}

// ---------------------------------------------------------------------------
// tsconfig: read compilerOptions.paths (+ baseUrl), following one `extends`.
// JSONC-tolerant (tsconfig allows comments + trailing commas).
//
// Comment stripping is STRING-AWARE: a single-pass scanner that ignores `//`
// and `/* */` sequences occurring inside quoted strings. A naive regex would
// corrupt valid JSON like the path glob `"@/*": ["./src/*/index"]`, whose
// `/*` … `*/` substrings (spread across string literals) look like a block
// comment and get devoured. Escapes (`\"`, `\\`) inside strings are honoured.
// ---------------------------------------------------------------------------
function stripJsonComments(txt) {
  let out = '';
  let i = 0;
  const n = txt.length;
  let inStr = false; // inside a double-quoted string literal
  while (i < n) {
    const c = txt[i];
    const next = i + 1 < n ? txt[i + 1] : '';
    if (inStr) {
      out += c;
      if (c === '\\') {
        // copy the escaped char verbatim (handles \" and \\)
        if (i + 1 < n) out += txt[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      // line comment: skip to (but keep) the newline
      i += 2;
      while (i < n && txt[i] !== '\n' && txt[i] !== '\r') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      // block comment: skip through the closing */
      i += 2;
      while (i < n && !(txt[i] === '*' && i + 1 < n && txt[i + 1] === '/')) i += 1;
      i += 2; // consume the closing */
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// Strip trailing commas (`,]` / `,}`) that sit OUTSIDE string literals, so a
// comma inside a string value is never touched. Runs after comment stripping.
function stripTrailingCommas(txt) {
  let out = '';
  let i = 0;
  const n = txt.length;
  let inStr = false;
  while (i < n) {
    const c = txt[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        if (i + 1 < n) out += txt[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === ',') {
      // look ahead past whitespace for a closing } or ]
      let j = i + 1;
      while (j < n && /\s/.test(txt[j])) j += 1;
      if (j < n && (txt[j] === '}' || txt[j] === ']')) {
        i += 1; // drop the comma
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function readJsonc(file) {
  let txt = readFileSync(file, 'utf-8');
  txt = stripJsonComments(txt); // string-aware: comments only outside strings
  txt = stripTrailingCommas(txt); // string-aware trailing-comma removal
  return JSON.parse(txt);
}

function loadTsconfig(projectRoot) {
  const path = join(projectRoot, 'tsconfig.json');
  if (!existsSync(path)) return null;
  let cfg;
  try {
    cfg = readJsonc(path);
  } catch (e) {
    fail(2, `Could not parse ${path}: ${e.message}`);
  }
  let co = cfg.compilerOptions ?? {};
  let baseDir = projectRoot;
  // One level of `extends`: pull paths/baseUrl from the base if absent here.
  if (cfg.extends && (!co.paths || co.baseUrl === undefined)) {
    try {
      const extPath = isAbsolute(cfg.extends) ? cfg.extends : resolve(projectRoot, cfg.extends);
      const resolved = existsSync(extPath) ? extPath : `${extPath}.json`;
      if (existsSync(resolved)) {
        const base = readJsonc(resolved);
        const baseCo = base.compilerOptions ?? {};
        co = { ...baseCo, ...co, paths: co.paths ?? baseCo.paths };
        if (co.baseUrl === undefined && baseCo.baseUrl !== undefined) {
          baseDir = dirname(resolved);
          co.baseUrl = baseCo.baseUrl;
        }
      }
    } catch {
      /* best-effort */
    }
  }
  const baseUrl = co.baseUrl ? resolve(baseDir, co.baseUrl) : projectRoot;
  return { paths: co.paths ?? {}, baseUrl };
}

// Resolve the on-disk dir an alias key maps to (first target), substituting `*`.
function resolveAlias(target, substitution, baseUrl) {
  const filled = target.replace(/\*/g, substitution).replace(/\/$/, '');
  return resolve(baseUrl, filled);
}

// Find the generated dir for a namespace via `@/generated/*`, `@/generated/<ns>`,
// or `@/generated/<ns>/*`. Returns { dir, aliasKey } or null.
function resolveGeneratedDir(ns, paths, baseUrl) {
  const candidates = [`@/generated/${ns}`, `@/generated/${ns}/*`, `@/generated/*`, `@/generated/*/`];
  for (const key of candidates) {
    const targets = paths[key];
    if (!targets || !targets.length) continue;
    const sub = key === `@/generated/*` || key === `@/generated/*/` ? ns : '';
    const dir = resolveAlias(targets[0], sub, baseUrl);
    return { dir, aliasKey: key };
  }
  return null;
}

function hasGeneratedAlias(paths) {
  return Object.keys(paths).some((k) => k.startsWith('@/generated/'));
}

// ---------------------------------------------------------------------------
// SDK introspection: collect exported identifiers + model file names.
// We scan every source file (so leaf `export function useXMutation` is found
// regardless of how the barrels re-export) and parse two export forms:
//   export (async)? (function|const|let|var|class|type|interface|enum) NAME
//   export (type)? { A, B as C, type D }   ← captures the EXPORTED name
// ---------------------------------------------------------------------------
function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), files);
    } else if (SRC_EXT.test(e.name)) {
      files.push(join(dir, e.name));
    }
  }
  return files;
}

const DECL_RE = /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
const LIST_RE = /export\s+(?:type\s+)?\{([^}]*)\}/g;

function collectSdk(sdkDir) {
  const exports = new Set();
  const models = new Set();
  for (const file of walk(sdkDir)) {
    let txt;
    try {
      txt = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    let m;
    while ((m = DECL_RE.exec(txt))) exports.add(m[1]);
    while ((m = LIST_RE.exec(txt))) {
      for (let item of m[1].split(',')) {
        item = item.trim().replace(/^type\s+/, '');
        if (!item) continue;
        const as = item.split(/\s+as\s+/);
        const name = (as[1] ?? as[0]).trim();
        if (/^[A-Za-z0-9_$]+$/.test(name)) exports.add(name);
      }
    }
    // model accessor signal: a file living under a `models/` directory.
    if (/(?:^|\/)models\//.test(file.replace(/\\/g, '/'))) {
      models.add(basename(file).replace(SRC_EXT, ''));
    }
  }
  // Singular comparison keys for every model file basename. The ORM exposes a
  // SINGULAR accessor (`db.orgMembership`, file `models/orgMembership.ts`) even
  // for list queries, so a manifest that declares the model in the plural
  // (`orgMemberships`) must still match. Normalising BOTH the on-disk name and
  // the declared name through the same singulariser collapses plural-manifest,
  // singular-manifest, and singular-file onto one key — see §model check.
  const modelKeys = new Set([...models].map(singularizeModel));
  return { exports, models, modelKeys };
}

// op name (camelCase GraphQL op) → expected generated hook identifier.
const pascal = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const mutationHook = (op) => `use${pascal(op)}Mutation`;
const queryHook = (op) => `use${pascal(op)}Query`;

// Singularise a camelCase model accessor for comparison. The ORM accessor (and
// its `models/<name>.ts` file) is ALWAYS singular, so a manifest may legally
// declare the model singular (`orgMembership`, `email`) or — as some catalog
// manifests do — plural (`orgMemberships`, `users`). Normalising every name
// through this one function makes both forms compare equal to the on-disk
// singular file (the "make both-correct" rule of the SDK Binding Contract).
//
// Only the trailing word is inflected (operates on the final char-run, so
// `orgMemberships` → `orgMembership`, not the leading `org`). Conservative:
// nouns that are already singular but end in a sibilant cluster are uncommon
// among generated accessors, and an over- or under-singularised key simply
// falls back to the exact-name check the caller also performs.
function singularizeModel(name) {
  if (typeof name !== 'string' || name.length < 2) return name;
  if (/[^aeiou]ies$/i.test(name)) return name.slice(0, -3) + 'y'; // identities → identity
  if (/(?:ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2); // boxes → box
  if (/[^s]s$/i.test(name)) return name.slice(0, -1); // users → user, orgMemberships → orgMembership
  return name; // address, status, email, phoneNumber — leave untouched
}

// ---------------------------------------------------------------------------
// manifests: read .constructive/blocks/*.requires.json (or a named one).
// A manifest is either a single { namespace, mutations, queries, models }
// object, or { requires: [ {…}, … ] } for cross-namespace blocks.
// ---------------------------------------------------------------------------
// Candidate manifest dirs, in priority order. shadcn writes block manifests to
// `<project>/src/.constructive/blocks` whenever the blocks registry target sits
// under src/ (the common Next.js layout) — the project-root `.constructive` is
// only used when the target is at the root. We scan BOTH so manifests are never
// silently missed (which would false-pass the check). An explicit
// --manifests-dir override short-circuits discovery.
function manifestDirs(projectRoot, override) {
  if (override) {
    const dir = isAbsolute(override) ? override : resolve(projectRoot, override);
    return [dir];
  }
  return [join(projectRoot, '.constructive', 'blocks'), join(projectRoot, 'src', '.constructive', 'blocks')];
}

// Primary dir — used in messages (the location the operator should expect).
function manifestDir(projectRoot, override) {
  return manifestDirs(projectRoot, override)[0];
}

function findManifests(projectRoot, only, override) {
  const dirs = manifestDirs(projectRoot, override);
  if (only) {
    // explicit path, or a block name resolved under any candidate dir
    const direct = isAbsolute(only) ? only : resolve(projectRoot, only);
    if (existsSync(direct) && statSync(direct).isFile()) return [direct];
    const fileName = only.endsWith('.requires.json') ? only : `${only}.requires.json`;
    const tried = [];
    for (const dir of dirs) {
      const named = join(dir, fileName);
      tried.push(named);
      if (existsSync(named)) return [named];
    }
    fail(2, `No manifest found for "${only}" (looked for ${tried.join(', ')}).`);
  }
  // De-dupe by manifest file name. Dirs are scanned in priority order (root
  // before src/), so the first occurrence of a given `<block>.requires.json`
  // wins — covering both two candidate dirs that resolve to the same place AND
  // the same block accidentally present in both locations (otherwise it would
  // be reported twice). Distinct blocks keep distinct file names, so this never
  // merges different manifests.
  const seen = new Set();
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.requires.json')) continue;
      if (seen.has(f)) continue;
      seen.add(f);
      found.push(join(dir, f));
    }
  }
  return found.sort();
}

function normalizeRequirements(raw) {
  const list = Array.isArray(raw?.requires) ? raw.requires : [raw];
  return list.map((r) => ({
    namespace: r.namespace,
    mutations: r.mutations ?? [],
    queries: r.queries ?? [],
    models: r.models ?? [],
    // Optional: op/model names the block declares as backend-PENDING — a seam
    // it ships for a procedure not yet deployed in any public schema (e.g.
    // `transferOrgOwnership`, `removeOrgMember`). These are reported but DO NOT
    // fail the check: a correctly-wired block that merely carries a pending
    // seam must not exit 1. A missing op that is NOT declared pending still
    // fails clearly. Accepts a flat array or a per-kind { mutations, queries }.
    pending: new Set([...(Array.isArray(r.pending) ? r.pending : []), ...(r.pending?.mutations ?? []), ...(r.pending?.queries ?? []), ...(r.pending?.models ?? [])])
  }));
}

// ---------------------------------------------------------------------------
// advisory: is <BlocksRuntime …> mounted anywhere in the host source?
// ---------------------------------------------------------------------------
function runtimeMounted(projectRoot) {
  const src = join(projectRoot, 'src');
  const root = existsSync(src) ? src : projectRoot;
  for (const file of walk(root)) {
    try {
      if (/<BlocksRuntime[\s/>]/.test(readFileSync(file, 'utf-8'))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------
const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

function fail(code, msg) {
  console.error(`${C.red('✗')} ${msg}`);
  process.exit(code);
}

const HELP = `check-sdk.mjs — verify the host SDK satisfies installed Constructive data blocks.

Usage:
  node check-sdk.mjs [block] [--project DIR] [--manifests-dir DIR] [--json]

  [block]            a block name (auth-sign-in-card) or manifest path; omit to check all
  --project DIR      project root to check (default: cwd)
  --manifests-dir DIR  explicit .constructive/blocks dir (overrides auto-discovery)
  --json             emit a machine-readable report
  --help             show this help

Manifests are auto-discovered under both <project>/.constructive/blocks and
<project>/src/.constructive/blocks (shadcn writes to the latter when the blocks
target lives under src/). Use --manifests-dir to point at a non-standard location.`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  const ts = loadTsconfig(opts.project);
  if (!ts) fail(2, `No tsconfig.json in ${opts.project}. Run from the host app root or pass --project.`);

  const manifests = findManifests(opts.project, opts.only, opts.manifestsDir);
  if (!manifests.length) {
    const where = opts.manifestsDir ? manifestDir(opts.project, opts.manifestsDir) : manifestDirs(opts.project).join(' or ');
    console.log(`${C.dim('•')} No data-block manifests in ${where} — nothing to check.`);
    process.exit(0);
  }

  const aliasOk = hasGeneratedAlias(ts.paths);
  const sdkCache = new Map(); // ns -> { dir, sdk } | { dir:null }
  const report = [];
  let failed = false;

  for (const file of manifests) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (e) {
      fail(2, `Could not parse manifest ${file}: ${e.message}`);
    }
    const block = basename(file).replace(/\.requires\.json$/, '');
    const reqs = normalizeRequirements(raw);
    const blockEntry = { block, namespaces: [] };

    for (const req of reqs) {
      const ns = req.namespace;
      const nsEntry = { namespace: ns, aliasOk, generatedDir: null, ops: [] };

      if (!sdkCache.has(ns)) {
        const loc = aliasOk ? resolveGeneratedDir(ns, ts.paths, ts.baseUrl) : null;
        if (loc && existsSync(loc.dir)) sdkCache.set(ns, { dir: loc.dir, sdk: collectSdk(loc.dir) });
        else sdkCache.set(ns, { dir: loc?.dir ?? null, sdk: null });
      }
      const cached = sdkCache.get(ns);
      nsEntry.generatedDir = cached.dir;

      const checkOp = (op, kind, expected, present) => {
        const satisfied = !!cached.sdk && present;
        const pending = req.pending.has(op);
        // A declared-pending op is informational: reported, never a failure —
        // even when the SDK is present and the op is genuinely absent. Only a
        // NON-pending unsatisfied op flips `failed`.
        if (!satisfied && !pending) failed = true;
        nsEntry.ops.push({ op, kind, expects: expected, ok: satisfied, pending });
      };

      for (const op of req.mutations) checkOp(op, 'mutation', mutationHook(op), cached.sdk?.exports.has(mutationHook(op)));
      for (const op of req.queries) checkOp(op, 'query', queryHook(op), cached.sdk?.exports.has(queryHook(op)));
      // Model accessors are SINGULAR on disk; normalise the declared name (which
      // may be plural) through the same singulariser used to key the SDK, then
      // fall back to an exact export match for non-standard shapes.
      for (const mdl of req.models)
        checkOp(mdl, 'model', `models/${singularizeModel(mdl)}`, cached.sdk?.modelKeys.has(singularizeModel(mdl)) || cached.sdk?.exports.has(mdl));

      blockEntry.namespaces.push(nsEntry);
    }
    report.push(blockEntry);
  }

  const runtimeOk = runtimeMounted(opts.project);

  if (opts.json) {
    console.log(JSON.stringify({ project: opts.project, aliasOk, runtimeMounted: runtimeOk, blocks: report, ok: !failed }, null, 2));
    process.exit(failed ? 1 : 0);
  }

  // human report
  console.log(C.bold(`\nConstructive blocks — SDK preflight (${opts.project})\n`));
  console.log(`${aliasOk ? C.green('✓') : C.red('✗')} @/generated/* alias in tsconfig`);
  const missingNs = new Set();
  for (const b of report) {
    console.log(`\n${C.bold(b.block)}`);
    for (const ns of b.namespaces) {
      const dirOk = !!ns.generatedDir && existsSync(ns.generatedDir);
      console.log(
        `  namespace ${C.bold(ns.namespace)} ${dirOk ? C.green('✓') : C.red('✗')} ${C.dim(ns.generatedDir ?? '(unresolved — alias missing)')}`
      );
      if (!dirOk) missingNs.add(ns.namespace);
      for (const o of ns.ops) {
        // pending + absent → ◦ (informational); pending + present → ✓; else ✓/✗.
        const mark = o.ok ? C.green('✓') : o.pending ? C.dim('◦') : C.red('✗');
        const note = o.pending && !o.ok ? C.dim(' (backend-pending — not yet deployed)') : '';
        console.log(`    ${mark} ${o.kind} ${C.bold(o.op)} ${C.dim(`→ ${o.expects}`)}${note}`);
      }
    }
  }
  console.log(`\n${runtimeOk ? C.green('✓') : C.dim('•')} <BlocksRuntime> ${runtimeOk ? 'mounted' : 'not found (mount it once at the app root — advisory)'}`);

  if (failed) {
    console.log(C.red('\n✗ Unsatisfied prerequisites.'));
    if (missingNs.size) {
      const names = [...missingNs].join(',');
      console.log(
        `\nGenerate the missing SDK(s), then re-run this check:\n  ${C.bold(`cnc codegen --api-names ${names} --react-query --orm -o src/generated`)}\n` +
          C.dim('  (or per-endpoint: cnc codegen --endpoint https://<ns>.<host>/graphql --react-query --orm -o src/generated/<ns>)')
      );
    } else {
      console.log(
        `\nThe SDK exists but is missing operations above — the host backend likely hasn't deployed them, or the SDK is stale. Re-generate and check drift:\n  ${C.bold('cnc codegen --api-names <ns> --react-query --orm -o src/generated')}\n  ${C.bold('cnc codegen … --dry-run')}  ${C.dim('# drift check')}`
      );
    }
    process.exit(1);
  }

  const pendingSeams = report.flatMap((b) => b.namespaces.flatMap((n) => n.ops.filter((o) => o.pending && !o.ok).map((o) => o.op)));
  console.log(C.green('\n✓ All data-block prerequisites satisfied.'));
  if (pendingSeams.length) {
    console.log(C.dim(`  (${pendingSeams.length} declared backend-pending seam(s): ${[...new Set(pendingSeams)].join(', ')} — the block's GA path stands alone until those procs ship.)`));
  }
  process.exit(0);
}

main();
