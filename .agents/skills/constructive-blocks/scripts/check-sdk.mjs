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
 *      satisfy the on-disk `models/orgMembership.ts`.
 *
 *      IMPORT-PRESENCE GATE: a missing op only HARD-FAILS when the block actually
 *      IMPORTS the hook that op maps to (from `@/generated/*` in the host source)
 *      — i.e. a genuine compile-against-a-missing-export. A manifest routinely
 *      declares the full capability surface (so the catalog is honest), but a
 *      block degrades when an op isn't deployed and simply never imports its hook
 *      (e.g. `org-members-list` declares removeOrgMember/transferOrgOwnership yet
 *      imports neither, referencing them only in comments/override seams). Such a
 *      declared-but-unimported op is reported as backend-pending, NEVER a failure.
 *      Op/model names listed in a manifest's optional `pending` array are likewise
 *      reported but never fail. (A wholly-missing generated dir/alias still fails
 *      independently — see §1–2.)
 *   5. (advisory) `@constructive/blocks-runtime` appears mounted somewhere
 *   6. (advisory, WARN-only) CONTRACT PREFLIGHT: when an installed block declares
 *      or imports a known arg-domain or defective op, emit a WARN naming the axis,
 *      the GAP-N, and the safe value — e.g. `createApiKey.accessLevel` only accepts
 *      {read_only, full_access} (a block shipping {read,write,admin} → live
 *      INVALID_ACCESS_LEVEL), or `sendVerificationEmail` aborts upstream (GAP-9).
 *      These NEVER change the exit code (the op exists + type-checks; only its
 *      runtime arg-domain/behavior is wrong) and are surfaced in --json as a
 *      `warnings[]` array. The table mirrors SKILL.md "Known SDK gaps".
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
// CONTRACT PREFLIGHT — known arg-domain + defective/RLS-blocked op advisories.
//
// A data-driven, WARN-only layer (NEVER a hard-fail) over the confirmed-live
// platform facts in the harness's PLATFORM-GAPS.md + planning/upstream-gaps-
// stress-test-2026-06-05.md. The import-presence binding gate above answers "does
// the op EXIST in the SDK?"; this layer answers a different question the SDK can't
// see: "this op exists and type-checks, but calling it the way a block ships it
// fails at RUNTIME (wrong arg-domain) or no-ops (a known upstream defect)."
//
// Why WARN and not a new hard-fail class: every op below belongs to a **GA block**
// whose SDK export is genuinely present — failing the check would false-fail blocks
// that ship today and pass the binding gate. The harness reads `warnings[]` from
// --json to surface the safe value / known defect at build time; a human run prints
// them under a "contract advisories" heading. Exit code is unchanged by warnings.
//
// The table mirrors SKILL.md "Known SDK gaps" (the prose table is the human-facing
// source; this is its executable twin). Keep them in sync: a new GAP-N row in
// SKILL.md that has an op signature should gain an entry here.
//
// Each axis:
//   kind        'arg-domain' (a field/enum has a constrained safe set the block
//                violates) | 'defective' (the op exists but no-ops / RLS-denies /
//                aborts at runtime).
//   ops         GraphQL op name(s) (camelCase, pre-hook) this axis attaches to.
//               A manifest matches when it DECLARES the op (mutations/queries) OR
//               the host source IMPORTS the op's generated hook.
//   gap         the PLATFORM-GAPS GAP-N id (the escalation channel).
//   safe        for arg-domain: the values that actually work at runtime.
//   bad         for arg-domain: the values a block is known to ship that fail.
//   field       for arg-domain: the argument/enum the domain constrains.
//   note        one-line operator-facing summary (symptom + safe action).
//   sources     literal substrings searched in the host source to corroborate an
//               arg-domain WARN (e.g. the bad enum values a block hard-codes). A
//               source hit RAISES confidence ('confirmed') vs a name-only match
//               ('declared'); never required to emit the WARN.
// ---------------------------------------------------------------------------
const KNOWN_AXES = [
  {
    id: 'createApiKey-accessLevel',
    kind: 'arg-domain',
    ops: ['createApiKey'],
    gap: 'GAP (auth-api-key-create-dialog)',
    field: 'accessLevel',
    safe: ['read_only', 'full_access'],
    bad: ['read', 'write', 'admin'],
    sources: ['read_only', 'full_access', "'read'", "'write'", "'admin'", '"read"', '"write"', '"admin"', 'accessLevelOptions'],
    note: "createApiKey.accessLevel only accepts {read_only, full_access}; the auth-api-key-create-dialog ships {read,write,admin} → live INVALID_ACCESS_LEVEL. Pass read_only or full_access. (createApiKey also enforces STEP_UP_REQUIRED server-side.)"
  },
  {
    id: 'createUser-org-rls',
    kind: 'defective',
    ops: ['createUser', 'createOrganization'],
    gap: 'GAP-6',
    note: "createUser(type=2 Organization)/createOrganization is RLS-denied for an authenticated session (`new row violates row-level security policy for table \"users\"`) — no self-service org can be minted on the b2b tier. Confirmed live via both the block and the direct API. No app-side workaround; upstream (constructive-db)."
  },
  {
    id: 'sessions-list',
    kind: 'defective',
    ops: ['userSessions', 'sessions'],
    gap: 'GAP-2',
    note: "No userSessions list query is exposed (user_sessions is private, no Connection) — the Sessions flow cannot enumerate sessions to revoke. auth-account-sessions-list is out of frontend scope until an API exposes a sessions Connection."
  },
  {
    id: 'revokeSession-id',
    kind: 'defective',
    ops: ['revokeSession'],
    gap: 'GAP-2',
    note: "revokeSession(id) returns SESSION_NOT_FOUND for the id on a signIn/signUp result (auth-result id is a UUIDv5 identity id, not the sessions-row UUIDv7; revokeSession also reads user_sessions while signIn writes sessions). Treat sessions-revoke as backend-pending; do NOT hand-craft a session id."
  },
  {
    id: 'revokeApiKey-noop',
    kind: 'defective',
    ops: ['revokeApiKey'],
    gap: 'GAP-3',
    note: "revokeApiKey returns true and writes an audit-log entry but never sets revoked_at — the key keeps working. Do NOT treat its `true` as a successful revoke (security footgun). Upstream defect."
  },
  {
    id: 'sendVerificationEmail-abort',
    kind: 'defective',
    ops: ['sendVerificationEmail'],
    gap: 'GAP-9',
    note: "sendVerificationEmail aborts before any email enqueues (`user_secrets_del(uuid, text[]) does not exist` — signature/overload mismatch). Email-verification is unreachable on auth:email; the send raises server-side. No workaround (upstream constructive-db)."
  },
  {
    id: 'sendAccountDeletionEmail-noop',
    kind: 'defective',
    ops: ['sendAccountDeletionEmail'],
    gap: 'GAP-10',
    note: "sendAccountDeletionEmail returns HTTP 200 but enqueues nothing (silent no-op) — the UI claims 'a confirmation email has been sent' while Mailpit stays empty, so deletion can never be confirmed. Do NOT hand-roll the deletion email. Upstream (constructive-db)."
  },
  {
    id: 'forgotPassword-empty-selection',
    kind: 'defective',
    ops: ['forgotPassword', 'signOut'],
    gap: 'GAP-11',
    note: "forgot-password-card + sign-out-button (dashboard-blocks) ship an empty GraphQL selection (selection:{fields:{}}) that codegen rejects (`forgotPassword must have a selection of subfields`) — the block cannot issue its mutation. App-local fix: set the selection to { clientMutationId: true }. (signOut codegen is also broken per GAP-4.) Upstream owner is dashboard-blocks."
  }
  // NOTE — GAP-5 org-admin seams (`removeOrgMember` / `transferOrgOwnership` /
  // `deleteOrg`) are deliberately NOT in this table. Those ops are *absent*
  // (not-yet-deployed), which the BINDING gate's existing `pending`/import-presence
  // mechanism already surfaces (declared-but-unimported → informational ◦, or a
  // manifest `pending` entry). This contract layer covers the orthogonal class the
  // binding gate cannot see: ops that EXIST + type-check but fail/no-op/abort at
  // runtime (arg-domain, RLS-deny, silent no-op). Adding GAP-5 here would duplicate
  // the binding gate and is intentionally left to it.
];

// Build an op → axis index once (an op may map to at most one axis here).
const AXIS_BY_OP = new Map();
for (const axis of KNOWN_AXES) for (const op of axis.ops) if (!AXIS_BY_OP.has(op)) AXIS_BY_OP.set(op, axis);

// Does the host source literally contain any of the corroborating substrings?
// Used only to upgrade an arg-domain WARN from 'declared' to 'confirmed' (the
// block hard-codes a bad enum value). Scans the same src/ tree as the import
// collector; best-effort and never required to emit a WARN.
function sourceContainsAny(projectRoot, needles) {
  if (!needles || !needles.length) return false;
  const src = join(projectRoot, 'src');
  const root = existsSync(src) ? src : projectRoot;
  for (const file of walk(root)) {
    let txt;
    try {
      txt = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const n of needles) if (txt.includes(n)) return true;
  }
  return false;
}

// Walk the manifests' declared ops + the host's imported generated symbols and
// collect a WARN for every known axis they touch. Returns a flat warnings[]:
//   { id, kind, gap, op, block, namespace, field?, safe?, bad?, via, confidence, message }
// `via` is 'declared' (named in a requires.json) or 'imported' (its hook is
// imported from @/generated/*); `confidence` is 'confirmed' when corroborating
// source text was found, else 'declared'/'imported'. WARNs NEVER affect exit code.
function collectContractWarnings(report, importedSymbols, projectRoot) {
  const warnings = [];
  const seen = new Set(); // de-dupe (axis,block,namespace,op,via)

  // helper: which import names corroborate this op? the op's mutation OR query hook.
  const opImported = (op) => importedSymbols.has(mutationHook(op)) || importedSymbols.has(queryHook(op));

  const push = (axis, op, block, namespace, via) => {
    const key = `${axis.id}|${block}|${namespace}|${op}|${via}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Corroborate an arg-domain WARN by looking for the bad enum literals the
    // block hard-codes (quoted both ways). A hit upgrades 'declared'/'imported'
    // to 'confirmed'; otherwise confidence is just the discovery channel.
    let confidence = via;
    if (axis.kind === 'arg-domain' && Array.isArray(axis.bad)) {
      const needles = axis.bad.flatMap((v) => [`'${v}'`, `"${v}"`]);
      if (sourceContainsAny(projectRoot, needles)) confidence = 'confirmed';
    }
    const head =
      axis.kind === 'arg-domain'
        ? `arg-domain ${op}.${axis.field} — safe ${JSON.stringify(axis.safe)}, NOT ${JSON.stringify(axis.bad)}`
        : `defective op ${op}`;
    warnings.push({
      id: axis.id,
      kind: axis.kind,
      gap: axis.gap,
      op,
      block,
      namespace,
      field: axis.field ?? null,
      safe: axis.safe ?? null,
      bad: axis.bad ?? null,
      via,
      confidence,
      message: `[${axis.gap}] ${head}. ${axis.note}`
    });
  };

  for (const b of report) {
    for (const ns of b.namespaces) {
      for (const o of ns.ops) {
        const axis = AXIS_BY_OP.get(o.op);
        if (!axis) continue;
        // 'declared' — the op is named in this block's manifest (always true here,
        // since ns.ops comes from the manifest). 'imported' takes precedence as the
        // stronger signal (the block actually wires the hook).
        const via = o.kind !== 'model' && opImported(o.op) ? 'imported' : 'declared';
        push(axis, o.op, b.block, ns.namespace, via);
      }
    }
  }
  // Also flag axes whose hook the host IMPORTS but which no manifest declared
  // (e.g. a block author calls createApiKey directly without a requires.json entry,
  // or a presentational wrapper imports the hook). Attributed to '(imported)'.
  for (const [op, axis] of AXIS_BY_OP) {
    if (opImported(op)) {
      const already = warnings.some((w) => w.id === axis.id && w.op === op);
      if (!already) push(axis, op, '(imported)', '(host source)', 'imported');
    }
  }
  return warnings;
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
// imported generated symbols: which `@/generated/*` identifiers does the host
// source ACTUALLY import? (§9 import-presence gate.)
//
// The gate hard-fails only on ops a block genuinely IMPORTS — not ops merely
// DECLARED in its requires.json. A correctly-wired block routinely declares the
// full capability surface in its manifest yet degrades when an op isn't
// deployed: `org-members-list` declares removeOrgMember + transferOrgOwnership
// but imports only useUpdateOrgMembershipMutation / useDeleteOrgMembershipMutation,
// referencing the absent procs solely in comments/override seams. Such a block
// compiles and runs; failing it would be a false negative.
//
// So we scan for the bindings actually pulled from a `@/generated/...` module
// and key the hard-fail on import-presence. Detection is STATEMENT-AWARE: only
// the named/default/namespace bindings of a real `import … from '@/generated/…'`
// are collected. A symbol that appears only in a comment or doc block (e.g.
// "useTransferOrgOwnershipMutation does NOT exist yet") is NOT an import and is
// never counted — otherwise the comment alone would re-introduce the false fail.
//
// We collect into one project-wide set (the SOURCE name, post-`as`-rename, so an
// `import { useFooMutation as foo }` still registers `useFooMutation`). Keying by
// the generated name rather than per-file keeps it robust to barrel re-exports
// and is sufficient: the check asks "is the hook this op maps to imported from
// the SDK anywhere?", which is exactly the compile-against-a-missing-export risk.
const GEN_IMPORT_RE = /import\s+([^;'"]*?)\s+from\s+['"]@\/generated\/[^'"]*['"]/g;

function collectGeneratedImports(projectRoot) {
  const src = join(projectRoot, 'src');
  const root = existsSync(src) ? src : projectRoot;
  const imported = new Set();
  for (const file of walk(root)) {
    let txt;
    try {
      txt = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    let m;
    GEN_IMPORT_RE.lastIndex = 0;
    while ((m = GEN_IMPORT_RE.exec(txt))) {
      // clause = whatever sits between `import` and `from '@/generated/…'`:
      //   { a, b as c, type D }  |  Foo  |  * as NS  |  Foo, { a }
      let clause = m[1].trim();
      const brace = clause.match(/\{([^}]*)\}/);
      if (brace) {
        for (let item of brace[1].split(',')) {
          item = item.trim().replace(/^type\s+/, '');
          if (!item) continue;
          const as = item.split(/\s+as\s+/); // SOURCE name = before `as`
          const name = (as[0] ?? '').trim();
          if (/^[A-Za-z0-9_$]+$/.test(name)) imported.add(name);
        }
        clause = clause.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
      }
      // default / namespace binding remnant (e.g. `Foo` or `* as NS`)
      const def = clause.replace(/^\*\s+as\s+/, '').trim();
      if (/^[A-Za-z0-9_$]+$/.test(def)) imported.add(def);
    }
  }
  return imported;
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
  --json             emit a machine-readable report (includes a warnings[] array)
  --help             show this help

In addition to the hard binding gate, the check emits WARN-only CONTRACT
ADVISORIES for known arg-domain / defective ops an installed block touches
(e.g. createApiKey.accessLevel ∈ {read_only, full_access}; sendVerificationEmail
aborts upstream). Advisories never change the exit code; read them from
warnings[] in --json. The advisory table mirrors SKILL.md "Known SDK gaps".

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
  // Which `@/generated/*` identifiers does the host source actually import? The
  // hard-fail is gated on this set (import-presence, §9): an op a block declares
  // but does not import is backend-pending, not a failure (it degrades).
  const importedSymbols = collectGeneratedImports(opts.project);
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

      // A missing generated dir (alias unresolved or the resolved dir absent) is
      // a fundamental, op-independent failure — the namespace's SDK doesn't exist
      // at all, so nothing the block imports can resolve. Surface it as exit 1
      // here so the import-presence op gate below (which would otherwise mark
      // every op backend-pending for a block that imports none of them) cannot
      // mask a wholly-missing SDK. The human report already names the missing
      // namespace and prints the `cnc codegen` remediation.
      if (!cached.sdk) failed = true;

      const checkOp = (op, kind, expected, present) => {
        const satisfied = !!cached.sdk && present;
        const declaredPending = req.pending.has(op);
        // Import-presence gate (§9): is the symbol this op maps to actually
        // imported from `@/generated/*` somewhere in the host source? Models map
        // to an accessor object, not a hook — a list block imports the hook, not
        // the model name — so only mutation/query hooks are import-gated; a
        // declared-but-unimported model is treated the same (informational).
        const imported = kind === 'model' ? false : importedSymbols.has(expected);
        // A missing op that the block does NOT import is backend-pending: the
        // block declared the full capability surface but degrades to the ops it
        // wires (e.g. org-members-list declares removeOrgMember/transferOrgOwnership
        // yet imports neither). Reported, never a failure. Only a missing op the
        // block GENUINELY IMPORTS (a real compile-against-a-missing-export) — or
        // a missing op when the SDK dir itself is absent — flips `failed`. An
        // explicit `pending` declaration also suppresses the failure.
        const pending = declaredPending || (!satisfied && !imported);
        if (!satisfied && imported && !declaredPending) failed = true;
        nsEntry.ops.push({ op, kind, expects: expected, ok: satisfied, pending, imported, declaredPending });
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
  // Contract-preflight advisories: known arg-domain + defective/RLS-blocked ops
  // touched by the installed blocks. WARN-only — they NEVER change `failed`.
  const warnings = collectContractWarnings(report, importedSymbols, opts.project);

  if (opts.json) {
    console.log(JSON.stringify({ project: opts.project, aliasOk, runtimeMounted: runtimeOk, blocks: report, warnings, ok: !failed }, null, 2));
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
        // Distinguish WHY an absent op is informational: an explicit `pending`
        // declaration vs detected as declared-but-not-imported (the block
        // degrades — it never imports this op's hook, so it cannot fail to
        // compile against it).
        const why = o.declaredPending ? 'backend-pending — not yet deployed' : 'declared, not imported — block degrades (backend-pending)';
        const note = o.pending && !o.ok ? C.dim(` (${why})`) : '';
        console.log(`    ${mark} ${o.kind} ${C.bold(o.op)} ${C.dim(`→ ${o.expects}`)}${note}`);
      }
    }
  }
  console.log(`\n${runtimeOk ? C.green('✓') : C.dim('•')} <BlocksRuntime> ${runtimeOk ? 'mounted' : 'not found (mount it once at the app root — advisory)'}`);

  // Contract advisories (WARN, never a failure). These name an op that exists +
  // type-checks but has a known runtime arg-domain or upstream defect, with the
  // safe value / known behavior — so the build doesn't burn a round-trip on
  // INVALID_ACCESS_LEVEL or a silent no-op. Mirrors SKILL.md "Known SDK gaps".
  if (warnings.length) {
    console.log(C.bold(`\n⚠ ${warnings.length} contract advisor${warnings.length === 1 ? 'y' : 'ies'} (WARN — not a failure):`));
    for (const w of warnings) {
      const where = w.block === '(imported)' ? C.dim('(imported in host source)') : `${C.bold(w.block)} ${C.dim(`/ ${w.namespace}`)}`;
      console.log(`  ${C.bold('⚠')} ${where}\n    ${w.message}`);
    }
  }

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
    console.log(C.dim(`  (${pendingSeams.length} backend-pending seam(s): ${[...new Set(pendingSeams)].join(', ')} — declared or imported-degraded; the block's GA path stands alone until those procs ship.)`));
  }
  process.exit(0);
}

main();
