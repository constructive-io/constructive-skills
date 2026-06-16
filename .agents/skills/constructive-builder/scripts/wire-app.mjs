#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * wire-app.mjs — ONE idempotent codemod that performs the mechanical Phase 3 (SKILL S3/S4)
 * + Blocks provider wiring (S5) the agent used to do by hand. Collapses ~5 trial-and-error
 * edits into a single `node scripts/wire-app.mjs` call so a build NEVER debugs them.
 *
 * It does EIGHT things, each independently idempotent (re-running is a safe no-op):
 *   (0) SINGLE-WORKSPACE NORMALIZE — strips any NESTED `pnpm-workspace.yaml` + `pnpm-lock.yaml`
 *       that the `nextjs/constructive-app` boilerplate ships at its package root (pgpm init unpacks
 *       it to `packages/app`, so they land as a SECOND workspace inside the app package). Two
 *       workspace markers ⇒ pnpm resolves the tree twice and the two lockfiles pin DIFFERENT Next
 *       versions → the dev server intermittently dies with a `global-error.js` module-instantiation
 *       error (two Next copies instantiated). Detect-and-remove is STRUCTURAL: find the OUTERMOST
 *       ancestor with a `pnpm-workspace.yaml` (the canonical root) and delete the marker+lockfile in
 *       every `<root>/packages/*` sub-package. No version/app/entity literal — leaves ONE root
 *       workspace + ONE lockfile so a single Next resolves. Always runs (independent of --no-blocks).
 *   (a) ENV — writes the per-DB endpoint block to BOTH `.env` and `.env.local` (codegen reads
 *       `.env`; `pnpm dev` reads `.env.local`; they must stay identical), with `<sub>` filled in.
 *       Every value comes from constructive.config.json (scheme/host/port/host-pattern) — no
 *       baked ":3000" host literal, so the app RELOCATES by changing the config (hub port/host).
 *       The app's own data endpoint is PARAMETERIZED: it writes `NEXT_PUBLIC_DB_NAME` +
 *       `NEXT_PUBLIC_API_PORT` and lets the template resolver build the api-<sub> URL, rather
 *       than baking `NEXT_PUBLIC_APP_ENDPOINT` (baked only for a random/custom data host —
 *       the override path). The _GRAPHQL_-infix names ARE still full URLs because blocks-runtime
 *       reads them as literal process.env.* and can't derive them from a port (BLOCKS-001).
 *   (b) CODEGEN HOST — ensures `CODEGEN_APP_HOST=api-<sub>.localhost` + `CODEGEN_APP_ENDPOINT`
 *       are in the env (the codegen app target must hit api-<sub>, NOT the dead app-public-<sub>).
 *       Verifies graphql-codegen.config.ts actually honors `CODEGEN_APP_HOST`; if it does not,
 *       it FAILS with the manual-fallback pointer rather than silently leaving codegen on the
 *       dead host. ALSO (b2) rewrites a hardcoded dev/start `--port <N>` to honor $PORT, and (b3)
 *       DECLARES the extra app deps up-front in package.json — @constructive-io/graphql-codegen
 *       (devDep, always; codegen needs it) plus, for a blocks app, @constructive-io/ui +
 *       @simplewebauthn/browser (deps) — so the ONE `pnpm install` after wiring materializes them
 *       in a single resolve instead of separate post-install `pnpm add` rounds each re-resolving
 *       the heavy @constructive-io/* + graphile tree (the dominant warm-time sink). It only WRITES
 *       the manifest (never installs); `latest` preserves the on-ramp's @latest pin, and the
 *       graphql single-version override (workspace-root package.json) is untouched. Idempotent:
 *       a dep already declared (any version, either bucket) is left as-is.
 *   (c) PROVIDER COLLISION — in `src/components/app-provider.tsx`, removes `configureAuth` +
 *       `configureAdmin` (calls + imports), KEEPS `configureApp` (BlocksRuntime owns auth+admin;
 *       one configurer per namespace — gotchas BLOCKS-002).
 *   (c2) PER-REQUEST APP-TOKEN SEAM (GAP-A / gotchas SDK-008) — also in `app-provider.tsx`, injects a
 *       `createAuthedFetch(ctx)` helper (+ the `createFetch` import) and adds a `fetch:` property to the
 *       `app` SDK config so the bearer is attached PER REQUEST. The generated SDK's FetchAdapter snapshots
 *       `config.headers` ONCE at construction and `configureApp` runs at MODULE LOAD (pre-login), so the
 *       template's `get headers()` getter snapshots an EMPTY header set → every `app` request goes out
 *       anonymous (HTTP 200 + permission-denied + 0 rows) and the FIRST create in a fresh session silently
 *       fails until a full reload. The custom fetch re-reads getAuthHeaders(ctx)→TokenManager on every call
 *       (never stale across signup/signin/refresh/logout), wrapping createFetch() to keep *.localhost DNS +
 *       Host handling. ADDITIVE + independent of --no-blocks (the `app` namespace is always present); on a
 *       template-shape mismatch it WARNS with the manual pointer and continues (never half-patches/dies).
 *   (d) BLOCKS PROVIDERS — writes a `'use client'` `src/components/blocks-providers.tsx` that
 *       mounts `<BlocksRuntime namespaces={['auth','admin']} getToken=…><StepUpProvider>` and
 *       wires it into `src/app/layout.tsx` INSIDE `<AppProvider>` (BLOCKS-009: a function prop
 *       can't cross the server→client boundary in the server layout — the wrapper owns it).
 *   (e) GENERATED SDK ALIASES — adds the two `compilerOptions.paths` keys the installed auth
 *       blocks + blocks-runtime import from: `@/generated/auth`→`./src/graphql/sdk/auth` and
 *       `@/generated/admin`→`./src/graphql/sdk/admin` (blocks-onramp Step 1 / SKILL.md:307).
 *       NOT a bare `@/generated/*` wildcard (it would shadow the template's `@/*`→`./src/*`).
 *       Without these the build can't resolve `@/generated/auth` → `useSignInMutation`.
 *       (d)+(e) are the BLOCKS steps — both skipped under `--no-blocks`.
 *
 * SAFETY CONTRACT (do NOT half-patch):
 *   • Detect-already-wired → no-op for that step.
 *   • On a SHAPE MISMATCH (the template moved and an anchor we patch is gone), it PRINTS the
 *     manual fallback ("see SKILL.md S3/S4 / references/blocks-onramp.md Step 5") and exits
 *     NON-ZERO, leaving the file untouched — never a partial edit.
 *
 * Usage:
 *   node scripts/wire-app.mjs --app <app> --sub <subdomain> [--workspace <dir>] [--no-blocks] [--dry-run]
 *     --app <app>   UNIFIED <app> = the WORKSPACE ROOT (the dir holding packages/) — the SAME
 *                   argument scaffold-provision.mjs / scaffold-frontend.mjs take. wire-app DERIVES
 *                   the app package itself (probes <app>/packages/app then <app>/app under the given
 *                   root). For back-compat it also accepts an explicit APP dir (one that already
 *                   holds package.json + src/) and uses it directly. May be ABSOLUTE or relative; a
 *                   relative path is absolutized against --workspace (if given) → cwd — NOT the
 *                   scripts dir. When --app is given, the resolved app MUST sit under it (or BE it):
 *                   if no package.json+src is found under the given root, wire-app FAILS LOUDLY
 *                   rather than silently falling through to a brief-derived stale leftover app.
 *                   If --app is omitted, auto-detected: $WIRE_APP_DIR → brief workspace_root
 *                   (+ app_root / packages/app / app) → cwd.
 *     --workspace <dir>  workspace root a relative --app/$WIRE_APP_DIR resolves against (and whose
 *                   packages/app + app are probed). Itself absolutized against cwd. Optional —
 *                   redundant now that --app already accepts the workspace root, but still honored.
 *     --sub <sub>   the per-DB subdomain (== NEXT_PUBLIC_DB_NAME). If omitted, resolved from
 *                   $WIRE_APP_SUB → run-state database.subdomain/name → brief naming.db_name.
 *     --no-blocks   do only (a)+(b)+(c); skip the BlocksRuntime/StepUpProvider wiring AND the
 *                   @/generated/{auth,admin} tsconfig aliases (use for a non-blocks app that
 *                   still needs env + the collision fix).
 *     --dry-run     report what WOULD change; write nothing.
 *
 * Exit: 0 = wired (or already wired / nothing to do) · non-zero = shape mismatch or bad input
 *       (with a manual-fallback pointer). Never leaves a half-applied file.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, getEndpoint, getEndpointHost, getPlatformEndpoint, getHubPort } from './lib/config.mjs';
import { allocateAppPort, resolveBase } from './lib/ports.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const pass = (m) => console.log(`  ${C.green('PASS')}: ${m}`);
const info = (m) => console.log(`  INFO: ${m}`);
const warn = (m) => console.log(`  ${C.yellow('WARN')}: ${m}`);
const FALLBACK = 'manual fallback: SKILL.md S3/S4 (env + collision) and references/blocks-onramp.md Step 5 (BlocksRuntime/StepUpProvider).';
function die(msg) {
  console.error(`  ${C.red('FAIL')}: ${msg}`);
  console.error(`        FIX: ${FALLBACK}`);
  process.exit(1);
}
// Print a repo-relative path when possible (falls back to the absolute path) — for tidy logs.
function rel(p) {
  if (!p) return String(p);
  return p.startsWith(REPO_ROOT + '/') ? p.slice(REPO_ROOT.length + 1) : p;
}

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let appDirArg = '';
let subArg = '';
let workspaceArg = '';
let doBlocks = true;
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--app') appDirArg = argv[++i] || '';
  else if (a === '--sub' || a === '--db') subArg = argv[++i] || '';
  else if (a === '--workspace') workspaceArg = argv[++i] || '';
  else if (a === '--no-blocks') doBlocks = false;
  else if (a === '--dry-run') dryRun = true;
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 61).join('\n'));
    process.exit(0);
  } else die(`unknown argument: ${a}`);
}

// ── tiny brief/run-state readers (no YAML/JSON-schema deps; mirror verify-phase.sh) ──
function readBriefValue(file, key) {
  if (!file || !existsSync(file)) return '';
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = re.exec(readFileSync(file, 'utf8'));
  if (!m) return '';
  return m[1].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim();
}
function firstExistingBrief() {
  for (const p of [join(REPO_ROOT, 'build', 'app-brief.yaml'), join(REPO_ROOT, 'fixtures', 'golden-app-brief.yaml'), join(REPO_ROOT, 'test', 'app-spec.yaml')]) {
    if (existsSync(p)) return p;
  }
  return '';
}
function readRunState() {
  for (const p of [join(REPO_ROOT, 'build', 'run-state.json'), join(REPO_ROOT, 'test', 'run-state.json')]) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

const BRIEF = firstExistingBrief();
const STATE = readRunState();

// ── resolve the app dir ───────────────────────────────────────────────────────
// UNIFIED <app> CONTRACT (cli-contract fix): --app is the WORKSPACE ROOT (dir holding
// packages/) — the SAME argument scaffold-provision.mjs / scaffold-frontend.mjs take — and
// wire-app DERIVES the app package itself (packages/app, else a root-level app/). For
// back-compat it also accepts an explicit APP dir (one that already holds package.json +
// src/) and uses it as-is.
//
// A relative --app / $WIRE_APP_DIR is absolutized against the workspace the CALLER means,
// NOT the scripts dir: the harness runs each step in a FRESH shell. Base for the user-supplied
// path: --workspace (itself absolutized against cwd) if given, ELSE cwd.
//
// CRITICAL — fail loudly, never mis-target: when --app / $WIRE_APP_DIR is given EXPLICITLY,
// the resolved app MUST sit under (or BE) that given root. If no package.json+src is found
// under it, we return a SENTINEL (the unresolved root) so the caller dies with a message
// naming that root — we do NOT fall through to the brief's workspace_root, whose packages/app
// may be a stale leftover from a different build (the very PASS-on-the-wrong-app bug this fixes).
// Brief-derived + cwd auto-detection ONLY runs when no explicit --app/$WIRE_APP_DIR was passed.

/** Given a base dir, return the app package dir it denotes: the base itself when it already
 *  holds package.json + src/ (explicit-app-dir back-compat), else <base>/packages/app, else
 *  <base>/app. Returns '' when none of those carry package.json + src/. */
function appUnder(base) {
  if (!base) return '';
  const abs = isAbsolute(base) ? base : resolve(process.cwd(), base);
  const isApp = (d) => existsSync(join(d, 'package.json')) && existsSync(join(d, 'src'));
  if (isApp(abs)) return abs; // base IS already the app package (back-compat)
  // pgpm init unpacks the app to packages/app; an older layout puts it at root-level app/.
  for (const sub of [join(abs, 'packages', 'app'), join(abs, 'app')]) {
    if (isApp(sub)) return sub;
  }
  return '';
}

function resolveAppDir() {
  // The base a relative user-supplied path resolves against: --workspace if given (itself
  // absolutized against cwd, since it too may be relative), ELSE cwd. We deliberately do NOT
  // fall back to the brief's workspace_root here — a caller who types `--app packages/app`
  // from their workspace shell means cwd-relative.
  const userWsBase = workspaceArg ? resolve(process.cwd(), workspaceArg) : process.cwd();
  const absUser = (p) => (isAbsolute(p) ? p : resolve(userWsBase, p));

  // 1) EXPLICIT --app / $WIRE_APP_DIR — bind to THIS root only (workspace-root OR app-dir).
  //    A given root that resolves wins; a given root that does NOT resolve FAILS LOUDLY
  //    (sentinel) instead of silently retargeting a brief-derived app.
  const explicit = appDirArg || process.env.WIRE_APP_DIR || '';
  if (explicit) {
    const root = absUser(explicit);
    const app = appUnder(root);
    if (app) return { dir: app, root };
    // Could not derive an app under the given root → make the caller die naming it.
    return { dir: '', root, explicit: true };
  }

  // 2) No explicit --app: auto-detect. brief workspace_root (+ app_root / packages/app / app),
  //    then --workspace's conventional locations, then cwd. Each candidate is itself a workspace
  //    root (or app dir) fed through appUnder().
  const briefWsRoot = (() => {
    const w = readBriefValue(BRIEF, 'workspace_root');
    if (!w) return REPO_ROOT;
    return isAbsolute(w) ? w : resolve(REPO_ROOT, w);
  })();
  const roots = [];
  const appRoot = readBriefValue(BRIEF, 'app_root') || readBriefValue(BRIEF, 'app_path');
  if (appRoot) roots.push(isAbsolute(appRoot) ? appRoot : join(briefWsRoot, appRoot));
  roots.push(briefWsRoot);
  if (workspaceArg) roots.push(userWsBase);
  roots.push(process.cwd());
  for (const r of roots) {
    const app = appUnder(r);
    if (app) return { dir: app, root: r };
  }
  return { dir: '', root: '' };
}

const RESOLVED = resolveAppDir();
const APP_DIR = RESOLVED.dir;
if (!APP_DIR) {
  if (RESOLVED.explicit) {
    // An explicit --app/$WIRE_APP_DIR was given but no app package sits under it — fail loudly,
    // naming the root, rather than mis-targeting a stale leftover app from another workspace.
    die(`--app resolved to ${RESOLVED.root} but found NO app package under it (needs package.json + src/ at the root itself, or under packages/app or app/). Pass the WORKSPACE ROOT (the dir holding packages/) — the same <app> scaffold-provision/scaffold-frontend take — or the app package dir directly. NOT retargeting a brief-derived app.`);
  }
  die('could not locate the scaffolded app dir (needs package.json + src/). Pass --app <workspaceRoot> (pgpm init unpacks the app to packages/app; an older layout uses root-level app/) — the same <app> scaffold-provision/scaffold-frontend take.');
}
info(`app dir: ${APP_DIR}${RESOLVED.root && RESOLVED.root !== APP_DIR ? ` (derived from workspace root ${RESOLVED.root})` : ''}`);

// ── resolve the subdomain ─────────────────────────────────────────────────────
function resolveSub() {
  if (subArg) return subArg;
  if (process.env.WIRE_APP_SUB) return process.env.WIRE_APP_SUB;
  if (STATE && STATE.database && (STATE.database.subdomain || STATE.database.name)) {
    return String(STATE.database.subdomain || STATE.database.name);
  }
  const db = readBriefValue(BRIEF, 'db_name');
  if (db) return db;
  return '';
}
const SUB = resolveSub();
if (!SUB) {
  die('could not resolve the per-DB subdomain. Pass --sub <subdomain> (== NEXT_PUBLIC_DB_NAME), or set it in run-state database.subdomain / brief naming.db_name.');
}
info(`subdomain: ${SUB}`);

let changed = 0;

// ── (0) SINGLE-WORKSPACE NORMALIZE — strip any NESTED pnpm workspace marker + lockfile ──
// The `nextjs/constructive-app` boilerplate ships its OWN `pnpm-workspace.yaml` + `pnpm-lock.yaml`
// at its package root. `pgpm init` unpacks that boilerplate into the generated repo UNDER
// `<workspaceRoot>/packages/app/`, so those two files land as a NESTED workspace inside the app
// package — while the repo root already carries the canonical `pnpm-workspace.yaml` (+ lockfile).
// Two workspace markers ⇒ pnpm resolves the dependency tree TWICE, and the two lockfiles pin
// DIFFERENT Next versions (the nested boilerplate lock vs. whatever the root resolves). The dev
// server then intermittently dies with a `global-error.js` module-instantiation error because two
// copies of Next get instantiated. The fix is structural: leave exactly ONE workspace (the root)
// and ONE lockfile, so a single Next resolves.
//
// GENERIC + STRUCTURAL (no literals): we find the canonical ROOT workspace = the OUTERMOST ancestor
// of the app dir that carries a `pnpm-workspace.yaml`, then DELETE every `pnpm-workspace.yaml` /
// `pnpm-lock.yaml` that sits in a sub-package directly under `<root>/packages/*` (one level — the
// boilerplate unpacks there). No app name, no entity name, no Next version is referenced — we detect
// the duplication by shape and remove it. The root's own marker + lockfile are NEVER touched, and a
// repo that already has a single workspace (re-run, or a future boilerplate that drops the nested
// files) is a clean no-op. We deliberately do NOT scan `node_modules` (pnpm's own nested locks live
// there and must stay) — only the source sub-packages.
{
  const WS_MARKER = 'pnpm-workspace.yaml';
  const LOCKFILE = 'pnpm-lock.yaml';

  // Canonical root = outermost ancestor of APP_DIR (inclusive) that holds a pnpm-workspace.yaml.
  // Walking to the OUTERMOST (not nearest) marker means a NESTED app-level marker can never be
  // mistaken for the root: the root is the top of the marker chain. Fall back to the caller's
  // resolved workspace root, else APP_DIR, when no marker exists upward yet.
  function findRootWorkspace(startDir) {
    let outermost = '';
    let d = startDir;
    // Bounded climb to the filesystem root.
    for (let guard = 0; guard < 64; guard++) {
      if (existsSync(join(d, WS_MARKER))) outermost = d;
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
    return outermost;
  }

  const wsRoot = findRootWorkspace(APP_DIR) || RESOLVED.root || APP_DIR;
  const pkgsDir = join(wsRoot, 'packages');

  // Collect every nested marker/lockfile under <root>/packages/*/ (immediate sub-package dirs).
  // The app unpacks to packages/app, so this covers it generically; any sibling sub-package that
  // also shipped a stray marker is normalized the same way.
  const nestedHits = [];
  if (existsSync(pkgsDir) && statSync(pkgsDir).isDirectory()) {
    for (const ent of readdirSync(pkgsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const subPkg = join(pkgsDir, ent.name);
      // Guard: never treat the root itself as a nested package (it isn't under packages/, so this
      // is belt-and-suspenders) — a nested marker is one that lives BELOW the root, never AT it.
      if (subPkg === wsRoot) continue;
      for (const fname of [WS_MARKER, LOCKFILE]) {
        const fpath = join(subPkg, fname);
        if (existsSync(fpath)) nestedHits.push(fpath);
      }
    }
  }

  if (nestedHits.length === 0) {
    info(`single-workspace: no nested ${WS_MARKER}/${LOCKFILE} under ${rel(pkgsDir)} (one root workspace + one Next — no change)`);
  } else {
    for (const fpath of nestedHits) {
      if (dryRun) {
        info(`[dry-run] would remove nested ${rel(fpath)} (collapses to the single root workspace → one Next)`);
      } else {
        rmSync(fpath);
        pass(`removed nested ${rel(fpath)} — single root workspace + lockfile (one Next resolves)`);
      }
    }
    changed++;
    if (!dryRun) info(`single-workspace: stripped ${nestedHits.length} nested marker/lockfile file(s); root workspace = ${rel(wsRoot)}`);
  }
}

// ── dynamic free dev-server PORT (so two concurrent apps never collide) ─────────
// The brief's frontend_port is only a BASE: allocateAppPort() walks UP from it (or the config
// app.devPortBase=3011 floor) and returns the first port that is actually FREE to bind. We do
// this ONCE here and PERSIST the chosen port into the per-app run-state (frontend.frontend_port
// + frontend.base_url), so every downstream consumer (verify-phase / live-qa / golden-path /
// genericity-check / open-in-browser) targets the SAME port instead of re-deriving a stale 3011.
//
// Run-state PATH for WRITING: when an app-id is resolvable (the sanitized subdomain — it always is
// here, since SUB is set above) we ALWAYS write the ISOLATED per-app file build/<app-id>/run-state.json
// and NEVER the legacy singleton — the same state-isolation guarantee fix-grants.sh keeps, so one app's
// allocated port can't bleed onto a sibling. The legacy singleton build/run-state.json is used only
// when there is no app-id at all (the single-app golden path). Consumers prefer the per-app file when
// it exists, so creating it here is what makes them read THIS app's port.
function resolveWritableStatePath() {
  const appId = String(SUB).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (appId) return join(REPO_ROOT, 'build', appId, 'run-state.json');
  return join(REPO_ROOT, 'build', 'run-state.json');
}
const STATE_WRITE_PATH = resolveWritableStatePath();

// BASE precedence: WIRE_APP_PORT (highest) → PORT → the brief's frontend_port → the configured
// dev-port base CONSTRUCTIVE_APP_DEV_PORT_BASE (config app.devPortBase) → ''. Honoring the config
// dev-port-base env as an EXPLICIT hint means setting CONSTRUCTIVE_APP_DEV_PORT_BASE alone makes
// the configured base the fallback without needing the WIRE_APP_PORT knob. resolveBase() still
// coerces + range-checks, and falls back to the config app.devPortBase (3011) when the hint is
// empty — so an unset env is behavior-preserving (the chain collapses to '' exactly as before).
const briefFrontendPort = readBriefValue(BRIEF, 'frontend_port');
const portBaseHint =
  process.env.WIRE_APP_PORT ||
  process.env.PORT ||
  briefFrontendPort ||
  process.env.CONSTRUCTIVE_APP_DEV_PORT_BASE ||
  '';
const APP_PORT_BASE = resolveBase(portBaseHint);

// Allocate the concrete free port. In --dry-run we do NOT bind/persist; we just report the base.
let APP_PORT = APP_PORT_BASE;
if (dryRun) {
  info(`[dry-run] would allocate the first free dev port at/above ${APP_PORT_BASE} and persist it to ${rel(STATE_WRITE_PATH)} (frontend.frontend_port)`);
} else {
  APP_PORT = await allocateAppPort(APP_PORT_BASE);
  if (APP_PORT !== APP_PORT_BASE) {
    info(`dev port ${APP_PORT_BASE} busy — allocated free port ${APP_PORT} (base ${APP_PORT_BASE})`);
  } else {
    info(`allocated dev port ${APP_PORT} (free at base)`);
  }
  // PERSIST into the per-app run-state frontend block. Merge (never clobber other fields); create
  // the dir + a minimal self-describing state when the file doesn't exist yet.
  try {
    mkdirSync(dirname(STATE_WRITE_PATH), { recursive: true });
    let s = {};
    try {
      s = JSON.parse(readFileSync(STATE_WRITE_PATH, 'utf8')) || {};
    } catch {
      s = {};
    }
    s.app = s.app || SUB;
    s.db_name = s.db_name || SUB;
    s.frontend = s.frontend || {};
    s.frontend.frontend_port = APP_PORT;
    s.frontend.base_url = `http://localhost:${APP_PORT}`;
    writeFileSync(STATE_WRITE_PATH, JSON.stringify(s, null, 2) + '\n');
    pass(`run-state: set frontend.frontend_port=${APP_PORT} + base_url (${rel(STATE_WRITE_PATH)})`);
    changed++;
  } catch (e) {
    warn(`could not persist the allocated port to ${rel(STATE_WRITE_PATH)} (${e.message}) — start the app with PORT=${APP_PORT}; consumers default to the brief frontend_port/base otherwise`);
  }
}

// ── (a)+(b) ENV — write the per-DB endpoint block to BOTH .env and .env.local ──
// Every value comes from constructive.config.json (scheme/host/port/host-pattern) —
// there is NO baked ":3000" host literal here, so the generated app is RELOCATABLE
// by changing the hub port/host in the config (or its env overrides) + re-running.
//
// The app's OWN data/auth/admin URLs are PARAMETERIZED, not baked:
//   • NEXT_PUBLIC_DB_NAME + NEXT_PUBLIC_API_PORT are all the template's runtime
//     resolver (src/lib/runtime/config-core.ts) needs to BUILD the api-/auth-/admin-
//     <sub> URLs itself (getAppEndpoint/getAuthEndpoint/getAdminEndpoint honor
//     NEXT_PUBLIC_API_PORT, default 3000). So we do NOT bake NEXT_PUBLIC_APP_ENDPOINT
//     in the common case — the resolver derives it from the db-name + port.
//   • NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT / NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT are the
//     names blocks-runtime reads as LITERAL process.env.* (Next inlines them; it can
//     NOT derive them from a port — gotchas BLOCKS-001). They MUST be full URLs, so
//     we build them from the config (still relocatable: change the config port → they
//     move on the next wire-app run).
//   • CODEGEN_APP_HOST/ENDPOINT point the app codegen target at api-<sub> (the runtime
//     data endpoint), NOT the dead app-public-<sub>.
const HUB_PORT = getHubPort();
const ENV_LINES = [
  ['NEXT_PUBLIC_DB_NAME', SUB],
  // Parameterized hub port — the template resolver builds api-/auth-/admin-<sub> from
  // this + NEXT_PUBLIC_DB_NAME, so the app data endpoint is relocatable by port alone.
  ['NEXT_PUBLIC_API_PORT', String(HUB_PORT)],
  // blocks-runtime literal-env contract (full URLs required) — sourced from the config.
  ['NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT', getEndpoint('auth', SUB)],
  ['NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT', getEndpoint('admin', SUB)],
  // Platform (control-plane) schema-builder endpoint — no per-app subdomain.
  ['NEXT_PUBLIC_SCHEMA_BUILDER_GRAPHQL_ENDPOINT', getPlatformEndpoint('api')],
  // Codegen app target — endpoint + Host must agree (Host header routes; URL alone 404s).
  ['CODEGEN_APP_ENDPOINT', getEndpoint('api', SUB)],
  ['CODEGEN_APP_HOST', getEndpointHost('api', SUB)],
];

// FULL-URL OVERRIDE PATH — ONLY for the random/custom-subdomain case, i.e. when the
// per-DB DATA host is NOT the default api-<sub>.<host> the template resolver derives
// (e.g. services_public.domains assigned a random domain to this DB). Then, and only
// then, bake an explicit NEXT_PUBLIC_APP_ENDPOINT so the app talks to the right host.
// Signalled by an explicit env (WIRE_APP_APP_ENDPOINT, or a pre-set NEXT_PUBLIC_APP_ENDPOINT
// that differs from the derived default). In the common case this stays UNSET and the
// resolver builds the URL from db-name + port — keeping the .env free of a baked data host.
const DERIVED_APP_ENDPOINT = getEndpoint('api', SUB);
const APP_ENDPOINT_OVERRIDE =
  process.env.WIRE_APP_APP_ENDPOINT ||
  (process.env.NEXT_PUBLIC_APP_ENDPOINT &&
  process.env.NEXT_PUBLIC_APP_ENDPOINT !== DERIVED_APP_ENDPOINT
    ? process.env.NEXT_PUBLIC_APP_ENDPOINT
    : '');
if (APP_ENDPOINT_OVERRIDE) {
  ENV_LINES.push(['NEXT_PUBLIC_APP_ENDPOINT', APP_ENDPOINT_OVERRIDE]);
  info(`custom data host → baking NEXT_PUBLIC_APP_ENDPOINT=${APP_ENDPOINT_OVERRIDE} (override path)`);
}

// Upsert each KEY=VALUE into an env file body, preserving unrelated lines. Idempotent: a key
// already set to the desired value is left as-is.
function upsertEnv(body, pairs) {
  let text = body;
  let touched = false;
  for (const [k, v] of pairs) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    const m = re.exec(text);
    if (m) {
      if (m[0] !== line) {
        text = text.replace(re, line);
        touched = true;
      }
    } else {
      if (text.length && !text.endsWith('\n')) text += '\n';
      text += `${line}\n`;
      touched = true;
    }
  }
  return { text, touched };
}

for (const fname of ['.env', '.env.local']) {
  const fpath = join(APP_DIR, fname);
  const body = existsSync(fpath) ? readFileSync(fpath, 'utf8') : '';
  const { text, touched } = upsertEnv(body, ENV_LINES);
  if (touched) {
    if (dryRun) info(`[dry-run] would write per-DB env block to ${fname}`);
    else {
      writeFileSync(fpath, text);
      pass(`wrote per-DB env block to ${fname} (sub=${SUB})`);
    }
    changed++;
  } else {
    info(`${fname} already has the per-DB env block (no change)`);
  }
}

// (b) verify the codegen config honors CODEGEN_APP_HOST — else the env we just wrote is ignored
// and codegen keeps hitting the dead app-public host.
const CODEGEN_CFG = join(APP_DIR, 'graphql-codegen.config.ts');
if (existsSync(CODEGEN_CFG)) {
  const cfg = readFileSync(CODEGEN_CFG, 'utf8');
  if (cfg.includes('CODEGEN_APP_HOST')) {
    pass('graphql-codegen.config.ts honors CODEGEN_APP_HOST (codegen app target = api-<sub>)');
  } else {
    die(`graphql-codegen.config.ts does NOT reference CODEGEN_APP_HOST — codegen will hit the dead app-public-<sub> host. Edit the app target so its endpoint + Host use api-${SUB}.localhost.`);
  }
} else {
  warn(`graphql-codegen.config.ts not found at ${CODEGEN_CFG} — skipping the codegen-host check (regenerate the template if codegen is needed)`);
}

// ── (b2)+(b3) package.json: honor $PORT in dev/start AND DECLARE the extra app deps up-front ──
// Both edits share ONE parse+serialize of the app package.json (we open it once here).
//   (b2) DEV/START SCRIPTS HONOR $PORT — so the allocated free port actually takes effect.
//        The dynamic port (above) is handed to the app as the PORT env var; Next only reads it when
//        the dev/start script honors it. The template ships `next dev --port ${PORT:-3011}`; a
//        generated/edited app might HARDCODE `--port 3011` (or 3081), pinning every app to one port
//        and re-introducing the collision. Rewrite any hardcoded `--port <N>` to `--port ${PORT:-<N>}`
//        (idempotent: a script already honoring PORT is left as-is).
//   (b3) DEPENDENCY CONSOLIDATION (the install-churn fix) — DECLARE the extra app deps the Blocks
//        on-ramp + codegen need DIRECTLY in package.json so they are present BEFORE the single
//        `pnpm install` the build runs after wiring, instead of being pulled in by separate
//        post-install `pnpm add` rounds (each re-resolving the heavy @constructive-io/* + graphile
//        tree → the dominant warm-time sink). This does NOT install — it only writes the manifest;
//        the ONE `pnpm install` after wire-app materializes them. Versions preserve the on-ramp's
//        exact semantics: the `latest` dist-tag == what `pnpm add <pkg>` / `pnpm add <pkg>@latest`
//        resolve to, so graphql-codegen still tracks @latest (the on-ramp's pin) and the graphql
//        single-version pnpm override is UNTOUCHED (it lives in the WORKSPACE-ROOT package.json,
//        which wire-app never edits). Idempotent: a dep already present (any version) is left as-is,
//        so a re-run — or a template that already declares one — never clobbers a pinned version.
// Keeps both changes toolkit-side rather than editing the template repo.
{
  const APP_PKG = join(APP_DIR, 'package.json');
  if (!existsSync(APP_PKG)) {
    warn(`package.json not found at ${APP_PKG} — cannot confirm the dev/start script honors PORT or declare the extra app deps. Ensure it runs \`next dev --port \${PORT:-${APP_PORT_BASE}}\` and that @constructive-io/graphql-codegen${doBlocks ? ' + @constructive-io/ui + @simplewebauthn/browser' : ''} are installed before codegen.`);
  } else {
    let pkgRaw = readFileSync(APP_PKG, 'utf8');
    let pkg;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch (e) {
      die(`package.json at ${APP_PKG} is not valid JSON (${e.message}) — fix it, then re-run. The dev/start script must run \`next dev --port \${PORT:-${APP_PORT_BASE}}\`.`);
    }
    let touched = false;

    // (b2) dev/start scripts honor $PORT.
    const scripts = pkg.scripts || {};
    // Rewrite a HARDCODED `--port <N>` (or `-p <N>`) to honor $PORT, defaulting to the same N.
    // Already-honoring forms (`--port ${PORT:-3011}`, `--port $PORT`) are untouched.
    const honorPort = (cmd) => {
      if (typeof cmd !== 'string') return cmd;
      if (/--port\s*[=]?\s*\$\{?PORT/.test(cmd) || /-p\s+\$\{?PORT/.test(cmd)) return cmd; // already honors PORT
      let out = cmd.replace(/(--port\s*[=]?\s*)(\d+)/g, (_, pre, n) => `${pre}\${PORT:-${n}}`);
      out = out.replace(/(-p\s+)(\d+)\b/g, (_, pre, n) => `${pre}\${PORT:-${n}}`);
      return out;
    };
    let scriptsTouched = false;
    for (const key of ['dev', 'start']) {
      if (typeof scripts[key] !== 'string') continue;
      const next = honorPort(scripts[key]);
      if (next !== scripts[key]) {
        scripts[key] = next;
        scriptsTouched = true;
      }
    }
    if (scriptsTouched) {
      pkg.scripts = scripts;
      touched = true;
      if (dryRun) info(`[dry-run] would rewrite package.json dev/start to honor $PORT (\`--port \${PORT:-N}\`)`);
      else pass('package.json: dev/start now honor $PORT (`--port ${PORT:-N}`) — the allocated free port takes effect');
    } else {
      const devCmd = String(scripts.dev || '');
      if (/--port|(-p)\s/.test(devCmd)) {
        info('package.json: dev/start already honor $PORT (no change)');
      } else {
        warn(`package.json dev script (\`${devCmd || '(none)'}\`) sets no --port — Next will default to 3000 and ignore the allocated PORT=${APP_PORT}. Add \`--port \${PORT:-${APP_PORT_BASE}}\` to the dev/start scripts.`);
      }
    }

    // (b3) DECLARE the extra app deps up-front so ONE `pnpm install` materializes them (no separate
    // `pnpm add` rounds). graphql-codegen is needed for ALL apps (codegen runs regardless of blocks);
    // @constructive-io/ui + @simplewebauthn/browser are the Blocks on-ramp deps — declared only for a
    // blocks app (--no-blocks skips them so a non-blocks app does not pull the heavy UI tree it never
    // uses, exactly as today where the on-ramp's `pnpm add @constructive-io/ui` only runs for blocks).
    // `latest` == the dist-tag `pnpm add <pkg>`/`pnpm add <pkg>@latest` resolve to (preserves the
    // on-ramp's @latest pin for graphql-codegen). The graphql single-version override is in the
    // WORKSPACE-ROOT package.json — NOT this file — so it is untouched.
    const DEP_DECLS = {
      dependencies: doBlocks
        ? { '@constructive-io/ui': 'latest', '@simplewebauthn/browser': 'latest' }
        : {},
      devDependencies: { '@constructive-io/graphql-codegen': 'latest' },
    };
    const added = [];
    for (const bucket of ['dependencies', 'devDependencies']) {
      const wants = DEP_DECLS[bucket];
      if (!wants || Object.keys(wants).length === 0) continue;
      for (const [name, range] of Object.entries(wants)) {
        // Already declared in EITHER bucket (any version) → leave as-is: never clobber a pin the
        // template/a prior run set, and never duplicate across dependencies + devDependencies.
        const inDeps = pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, name);
        const inDev = pkg.devDependencies && Object.prototype.hasOwnProperty.call(pkg.devDependencies, name);
        if (inDeps || inDev) continue;
        if (!pkg[bucket] || typeof pkg[bucket] !== 'object' || Array.isArray(pkg[bucket])) pkg[bucket] = {};
        pkg[bucket][name] = range;
        added.push(`${name} (${bucket === 'devDependencies' ? 'dev' : 'dep'})`);
      }
    }
    if (added.length) {
      touched = true;
      if (dryRun) info(`[dry-run] would declare ${added.join(' + ')} in package.json (so ONE \`pnpm install\` materializes them — no separate \`pnpm add\` rounds)`);
      else pass(`package.json: declared ${added.join(' + ')} up-front — ONE \`pnpm install\` materializes them (no separate \`pnpm add\` rounds)`);
    } else {
      info(`package.json: extra app deps already declared (@constructive-io/graphql-codegen${doBlocks ? ' + @constructive-io/ui + @simplewebauthn/browser' : ''}) — no change`);
    }

    // Single serialize+write for BOTH (b2) + (b3). Preserve trailing newline + 2-space indent.
    if (touched) {
      const serialized = JSON.stringify(pkg, null, 2) + (pkgRaw.endsWith('\n') ? '\n' : '');
      if (!dryRun) writeFileSync(APP_PKG, serialized);
      changed++;
    }
  }
}

// ── (c) PROVIDER COLLISION — drop configureAuth + configureAdmin, keep configureApp ──
const APP_PROVIDER = join(APP_DIR, 'src', 'components', 'app-provider.tsx');
if (!existsSync(APP_PROVIDER)) {
  die(`expected ${APP_PROVIDER} (the template's AppProvider) — not found. The template shape moved; do the collision fix by hand.`);
}
{
  let src = readFileSync(APP_PROVIDER, 'utf8');
  const before = src;
  const hasAuthCfg = /configureAuth/.test(src);
  const hasAdminCfg = /configureAdmin/.test(src);
  const hasAppCfg = /configureApp/.test(src);

  if (!hasAuthCfg && !hasAdminCfg) {
    info('app-provider.tsx: configureAuth/configureAdmin already removed (collision resolved) — no change');
  } else {
    if (!hasAppCfg) {
      die(`app-provider.tsx has configureAuth/configureAdmin but NOT configureApp — unexpected shape; resolve the collision by hand (keep configureApp, drop the other two).`);
    }
    // Remove the `configure as configureAuth`/`configureAdmin` import bindings and their calls.
    // We target the precise template forms (import lines + module-load configure*() calls); if a
    // form we expect is absent we leave the file untouched and fail (no half-patch).
    // 1) drop the two single-line imports `import { configure as configureAuth } from '@sdk/auth';`
    src = src.replace(/^\s*import\s*\{\s*configure as configureAuth\s*\}\s*from\s*['"]@sdk\/auth['"];?\s*\n/m, '');
    src = src.replace(/^\s*import\s*\{\s*configure as configureAdmin\s*\}\s*from\s*['"]@sdk\/admin['"];?\s*\n/m, '');
    // 1b) tolerate a multi-binding admin import `import { configure as configureAdmin, type QueryResult } from '@sdk/admin';`
    src = src.replace(/(import\s*\{)\s*configure as configureAdmin\s*,\s*/m, '$1 ');
    src = src.replace(/(import\s*\{)\s*configure as configureAuth\s*,\s*/m, '$1 ');
    src = src.replace(/,\s*configure as configureAdmin(\s*\})/m, '$1');
    src = src.replace(/,\s*configure as configureAuth(\s*\})/m, '$1');
    // 2) drop the two configure*() calls (any single-arg call form).
    src = src.replace(/^\s*configureAuth\([^;]*\);\s*\n/m, '');
    src = src.replace(/^\s*configureAdmin\([^;]*\);\s*\n/m, '');

    if (/configureAuth|configureAdmin/.test(src)) {
      die('app-provider.tsx: could not cleanly remove configureAuth/configureAdmin (an unexpected import/call form remains). Resolve the collision by hand: keep configureApp, drop configureAuth + configureAdmin (imports + calls).');
    }
    if (!/configureApp/.test(src)) {
      die('app-provider.tsx: configureApp was lost during the collision edit — aborting without writing. Do the collision fix by hand.');
    }
    if (src !== before) {
      if (dryRun) info('[dry-run] would remove configureAuth + configureAdmin from app-provider.tsx (keep configureApp)');
      else {
        writeFileSync(APP_PROVIDER, src);
        pass('app-provider.tsx: removed configureAuth + configureAdmin (kept configureApp) — one configurer per namespace');
      }
      changed++;
    }
  }
}

// ── (c2) PER-REQUEST APP-TOKEN SEAM — make every `app` request read the LIVE token (GAP-A) ──
// THE FIRST-CREATE BUG (gotchas SDK-008, owner-tier blocker): the generated `app` SDK's
// FetchAdapter SNAPSHOTS `config.headers` ONCE at construction (`new FetchAdapter(endpoint,
// config.headers, …)`), and `configureApp(createSdkConfig('app'))` runs at MODULE LOAD — before
// the user has signed in. So the template's `get headers()` getter is evaluated exactly once and
// snapshots an EMPTY header set; every subsequent `app` request goes out ANONYMOUS (HTTP 200 +
// "permission denied" + 0 rows), and the very FIRST create/list in a fresh authenticated session
// (right after sign-up/sign-in, before any full page reload) silently fails. A reload "fixes" it
// only because the module re-runs with the token already in storage. The durable fix is to attach
// the bearer PER REQUEST, not via the snapshotted `headers`: inject a custom `fetch` into the SDK
// config that re-reads the CURRENT token (getAuthHeaders → TokenManager) on every call, so it is
// never stale across sign-up / sign-in / refresh / logout. We wrap the SDK runtime's createFetch()
// (NOT global fetch) to preserve its *.localhost DNS + Host-header handling the api-<sub> endpoint
// needs. This is ADDITIVE + idempotent + independent of --no-blocks (the `app` namespace is always
// present), so it runs whether or not the collision step changed anything.
//
// ON SHAPE DRIFT we WARN with the manual pointer and continue (never die): this seam layers onto
// the template's existing config factory; if that factory moved, the app still builds/runs (the
// reload workaround remains) and the operator can apply Step 5a by hand — far better than blocking
// the whole build on an additive robustness patch.
{
  let src = readFileSync(APP_PROVIDER, 'utf8');
  const before = src;
  const SEAM_MARK = 'createAuthedFetch';

  if (src.includes(SEAM_MARK)) {
    info('app-provider.tsx: per-request app-token fetch seam already present (createAuthedFetch) — no change');
  } else {
    // The template's SDK config factory binds a namespace to its endpoint + headers via getters
    // (createSdkConfig(ctx) → { get endpoint(){…}, get headers(){ return getAuthHeaders(ctx) } }).
    // We anchor on that factory + its getAuthHeaders(ctx) header getter — the precise template
    // shape — and (1) add the createFetch import, (2) define createAuthedFetch(ctx) above the
    // factory, (3) add a `fetch: createAuthedFetch(ctx),` property to the returned config object.
    const hasFactory = /function\s+createSdkConfig\s*\(\s*ctx\s*:\s*SchemaContext\s*\)/.test(src);
    const headerGetterRe = /(\n([ \t]*)get headers\(\)\s*\{\s*\n[ \t]*return getAuthHeaders\(ctx\);\s*\n[ \t]*\},?\n)/;
    const hasHeaderGetter = headerGetterRe.test(src);
    const hasGetAuthHeaders = /getAuthHeaders/.test(src);

    if (!hasFactory || !hasHeaderGetter || !hasGetAuthHeaders) {
      warn(
        'app-provider.tsx: could not find the expected `createSdkConfig(ctx)` factory with a ' +
          '`get headers() { return getAuthHeaders(ctx); }` getter — the template shape moved, so the ' +
          'per-request app-token seam was NOT injected. The first create in a fresh session may need a ' +
          'reload until you apply references/blocks-onramp.md Step 5a by hand (give the `app` adapter a ' +
          'PER-REQUEST token via a custom fetch / re-configure after login). FIX: ' + FALLBACK
      );
    } else {
      // (1) Import createFetch from the SDK runtime. Insert right before the first `@/`/`@sdk/`
      //     app import so it sits with the other runtime imports (and after any third-party ones).
      if (!/from '@constructive-io\/graphql-query\/runtime'/.test(src)) {
        const importLine = "import { createFetch } from '@constructive-io/graphql-query/runtime';\n";
        const firstLocalImport = /^import .*from '(?:@\/|@sdk\/)/m;
        if (firstLocalImport.test(src)) {
          src = src.replace(firstLocalImport, (m) => importLine + m);
        } else {
          // Fallback: after the first import line of any kind.
          src = src.replace(/(^import .*\n)/m, (m) => m + importLine);
        }
      }

      // (2) Define createAuthedFetch(ctx) immediately before the factory.
      const helper =
        '// PER-REQUEST AUTH SEAM (gotchas SDK-008 / GAP-A) — injected by scripts/wire-app.mjs.\n' +
        '// The generated SDK FetchAdapter snapshots config.headers ONCE at construction, and\n' +
        '// configureApp runs at MODULE LOAD (before sign-in), so a `get headers()` getter snapshots\n' +
        '// an EMPTY header set and every `app` request goes out anonymous (HTTP 200 + permission\n' +
        '// denied + 0 rows) until a full reload. Attaching the bearer PER REQUEST via a custom fetch\n' +
        '// fixes the silent first-create: getAuthHeaders re-reads the live token on every call, so it\n' +
        '// is never stale across sign-up / sign-in / refresh / logout. Wrap createFetch() (NOT global\n' +
        '// fetch) to keep the runtime’s *.localhost DNS + Host-header handling api-<sub> needs.\n' +
        'function createAuthedFetch(ctx: SchemaContext): typeof globalThis.fetch {\n' +
        '\tconst baseFetch = createFetch();\n' +
        '\treturn ((input: RequestInfo | URL, init?: RequestInit) => {\n' +
        '\t\tconst merged = new Headers((init && init.headers) || {});\n' +
        '\t\tmerged.delete(\'authorization\');\n' +
        '\t\tfor (const [k, v] of Object.entries(getAuthHeaders(ctx))) merged.set(k, v);\n' +
        '\t\treturn baseFetch(input as any, { ...(init || {}), headers: merged });\n' +
        '\t}) as typeof globalThis.fetch;\n' +
        '}\n\n';
      const factoryRe = /(\nfunction\s+createSdkConfig\s*\(\s*ctx\s*:\s*SchemaContext\s*\))/;
      src = src.replace(factoryRe, (m, g1) => '\n' + helper + g1.replace(/^\n/, ''));

      // (3) Add `fetch: createAuthedFetch(ctx),` to the returned config object, right after the
      //     header getter (preserving the getter's own indentation).
      src = src.replace(headerGetterRe, (full, block, indent) => {
        const fetchLine = `${indent}fetch: createAuthedFetch(ctx),\n`;
        // `block` ends with the getter's closing `},\n` (or `}\n`); append the fetch property after it.
        return block + fetchLine;
      });

      if (!src.includes(SEAM_MARK) || src === before) {
        warn(
          'app-provider.tsx: failed to inject the per-request app-token seam cleanly (anchors matched ' +
            'but the edit did not apply) — left as-is. Apply references/blocks-onramp.md Step 5a by hand. FIX: ' +
            FALLBACK
        );
      } else {
        if (dryRun) info('[dry-run] would inject the per-request app-token fetch seam (createAuthedFetch) into app-provider.tsx so the FIRST create in a fresh session is authed (GAP-A)');
        else {
          writeFileSync(APP_PROVIDER, src);
          pass('app-provider.tsx: injected per-request app-token fetch seam (createAuthedFetch) — first create in a fresh session is authed, no reload (GAP-A / SDK-008)');
        }
        changed++;
      }
    }
  }
}

// ── (d) BLOCKS PROVIDERS — write blocks-providers.tsx + wire it into layout.tsx ──
if (doBlocks) {
  // Resolve the installed BlocksRuntime / StepUpProvider import specifiers. After `shadcn add`,
  // the dashboard registry installs them under src/blocks/...; if they aren't installed yet we
  // still write the wrapper with the documented default specifiers (blocks-onramp Step 5b) for
  // BlocksRuntime and warn — the block install (SKILL S5) is a separate scripted step.
  //
  // Probe whether the block file actually exists under the app's src/blocks/...; the specifier we
  // return is the SAME documented alias either way (shadcn installs to a known path), but the
  // EXISTENCE result drives whether we emit a `use-step-up` import that would otherwise fail to
  // compile (gotchas BLOCKS-009: a flow without step-up has no step-up-provider on disk).
  function blockFileExists(relGuessParts) {
    const guess = join(APP_DIR, 'src', 'blocks', ...relGuessParts);
    for (const ext of ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']) {
      if (existsSync(guess + ext)) return true;
    }
    return false;
  }
  const RUNTIME_SPEC = '@/blocks/runtime/blocks-runtime';
  const STEPUP_SPEC = '@/blocks/auth/use-step-up/step-up-provider';
  // StepUpProvider is OPTIONAL: only wrap with it when the use-step-up / step-up-provider block is
  // actually installed under the app (the chosen flows may not include step-up). Importing a block
  // that isn't on disk → "Cannot find module" at build. When it is absent, BlocksRuntime renders
  // children directly (a fragment) — the app still compiles + every non-step-up flow works.
  const stepUpInstalled = blockFileExists(['auth', 'use-step-up', 'step-up-provider']);
  const blocksInstalled = existsSync(join(APP_DIR, 'src', 'blocks'));
  if (!blocksInstalled) {
    warn(`src/blocks not present yet — writing blocks-providers.tsx with the documented BlocksRuntime import path (${RUNTIME_SPEC}). Install the flow's blocks (SKILL S5) so it resolves before building.`);
  }
  if (stepUpInstalled) {
    info(`StepUpProvider block found (${STEPUP_SPEC}) — blocks-providers.tsx will wrap children in <StepUpProvider> (reconciled below even if a pre-install pass wrote it without).`);
  } else {
    info(`StepUpProvider block not installed (no ${STEPUP_SPEC}) — OMITTING the StepUpProvider import; BlocksRuntime will render children directly. Add the use-step-up block (SKILL S5) only if a flow needs step-up.`);
  }

  // PRE-FLIGHT the layout anchor BEFORE writing any blocks file, so a layout-shape mismatch
  // fails CLEANLY (no orphan blocks-providers.tsx left behind — no half-patch across files).
  const LAYOUT = join(APP_DIR, 'src', 'app', 'layout.tsx');
  if (!existsSync(LAYOUT)) {
    die(`expected ${LAYOUT} (the template root layout) — not found. Wire <BlocksProviders> inside <AppProvider> by hand.`);
  }
  let layout = readFileSync(LAYOUT, 'utf8');
  const layoutBefore = layout;
  const layoutAlreadyWired = /BlocksProviders/.test(layout);
  const openRe = /(<AppProvider>)/;
  const closeRe = /(<\/AppProvider>)/;
  if (!layoutAlreadyWired && (!openRe.test(layout) || !closeRe.test(layout))) {
    die('layout.tsx does not contain a <AppProvider>…</AppProvider> wrapper to nest into (template shape moved). Mount <BlocksProviders> inside <AppProvider> by hand.');
  }

  const PROVIDERS = join(APP_DIR, 'src', 'components', 'blocks-providers.tsx');
  // The StepUpProvider import + wrapper are emitted ONLY when the use-step-up block is installed
  // (see stepUpInstalled above). Without it, BlocksRuntime wraps children directly so the file
  // always compiles regardless of which flows the app chose.
  const stepUpImport = stepUpInstalled ? `import { StepUpProvider } from '${STEPUP_SPEC}';\n` : '';
  const stepUpComment = stepUpInstalled
    ? `// 'auth' + 'admin' namespaces (configures each + attaches Authorization per request via getToken);\n// AppProvider still owns 'app'. StepUpProvider wraps children (the use-step-up block is installed).`
    : `// 'auth' + 'admin' namespaces (configures each + attaches Authorization per request via getToken);\n// AppProvider still owns 'app'. StepUpProvider is omitted (no use-step-up block installed for the\n// chosen flows) — add it back via SKILL S5 if a flow needs step-up.`;
  const childrenExpr = stepUpInstalled ? `<StepUpProvider>{children}</StepUpProvider>` : `<>{children}</>`;
  const providersBody = `'use client';

import type { ReactNode } from 'react';
import { BlocksRuntime } from '${RUNTIME_SPEC}';
${stepUpImport}import { TokenManager } from '@/lib/auth/token-manager';

// Owns the getToken closure on the client side, so layout.tsx (a Server Component) never passes
// a function across the server→client boundary (gotchas BLOCKS-009). BlocksRuntime owns the
${stepUpComment}
// Generated by scripts/wire-app.mjs.
export function BlocksProviders({ children }: { children: ReactNode }) {
  return (
    <BlocksRuntime
      namespaces={['auth', 'admin']}
      getToken={() => TokenManager.getToken('admin').token?.accessToken}
    >
      ${childrenExpr}
    </BlocksRuntime>
  );
}
`;
  // Idempotence guard with a STEP-UP RECONCILE (regression fix). A prior run on the S3
  // PRE-INSTALL pass (before `shadcn add` installed use-step-up) legitimately wrote this file
  // WITHOUT the StepUpProvider wrapper. The old guard then no-op'd on mere BlocksRuntime presence
  // at S5 — leaving a stale wrapper that does NOT mount StepUpProvider, so useStepUp() throws at
  // runtime for step-up / account-deletion / org apps. So: re-write whenever the file is absent,
  // missing BlocksRuntime, OR the desired StepUpProvider wrapping differs from what's on disk
  // (step-up now installed but the file doesn't wrap; or step-up removed but the file still wraps).
  // Detection is by the INSTALLED block (stepUpInstalled), not run order — so re-running is safe.
  const existingProviders = existsSync(PROVIDERS) ? readFileSync(PROVIDERS, 'utf8') : '';
  const existingHasRuntime = /BlocksRuntime/.test(existingProviders);
  // Detect the actual JSX WRAPPER, not any mention of the string: the pre-install file's
  // explanatory comment literally contains "StepUpProvider is omitted…", so a bare /StepUpProvider/
  // match would FALSE-POSITIVE and skip the reconcile (the very regression this fixes). Match the
  // opening wrapper tag `<StepUpProvider>` instead.
  const existingWrapsStepUp = /<StepUpProvider[\s>]/.test(existingProviders);
  const stepUpInSync = existingWrapsStepUp === stepUpInstalled;
  if (existingHasRuntime && stepUpInSync) {
    info(
      stepUpInstalled
        ? 'src/components/blocks-providers.tsx already wraps children in <StepUpProvider> (use-step-up installed) — no change'
        : 'src/components/blocks-providers.tsx already present (BlocksRuntime wrapper, no step-up) — no change'
    );
  } else {
    const why = !existingHasRuntime
      ? 'writing'
      : stepUpInstalled
        ? 'RE-writing to add the <StepUpProvider> wrapper (use-step-up installed since the first pass — without this useStepUp() throws at runtime)'
        : 'RE-writing to drop the stale <StepUpProvider> wrapper (no use-step-up block installed for the chosen flows)';
    if (dryRun) info(`[dry-run] would ${existingHasRuntime ? 're-write' : 'write'} src/components/blocks-providers.tsx (${stepUpInstalled ? 'with' : 'without'} StepUpProvider)`);
    else {
      writeFileSync(PROVIDERS, providersBody);
      pass(`blocks-providers.tsx: ${why} (BlocksRuntime${stepUpInstalled ? ' + StepUpProvider' : ', no step-up'} wrapper)`);
    }
    changed++;
  }

  // Wire <BlocksProviders> into layout.tsx, INSIDE <AppProvider> (anchor pre-validated above).
  if (layoutAlreadyWired) {
    info('layout.tsx already mounts <BlocksProviders> — no change');
  } else {
    // 1) add the import after the AppProvider import (or at the top of the import block).
    if (!/from '@\/components\/blocks-providers'/.test(layout)) {
      const appProviderImport = /import\s*\{\s*AppProvider\s*\}\s*from\s*['"]@\/components\/app-provider['"];?\n/;
      const importLine = `import { BlocksProviders } from '@/components/blocks-providers';\n`;
      if (appProviderImport.test(layout)) {
        layout = layout.replace(appProviderImport, (m) => m + importLine);
      } else {
        // Fallback: prepend after the first import line.
        layout = layout.replace(/(^import .*\n)/m, (m) => m + importLine);
      }
    }
    // 2) nest the children: <AppProvider> → <AppProvider><BlocksProviders> and the matching close.
    layout = layout.replace(openRe, '$1\n\t\t\t\t\t<BlocksProviders>');
    layout = layout.replace(closeRe, '</BlocksProviders>\n\t\t\t\t$1');

    if (!/BlocksProviders/.test(layout) || layout === layoutBefore) {
      die('layout.tsx: failed to nest <BlocksProviders> inside <AppProvider> cleanly — left untouched. Wire it by hand (blocks-onramp Step 5b).');
    }
    if (dryRun) info('[dry-run] would wire <BlocksProviders> into layout.tsx inside <AppProvider>');
    else {
      writeFileSync(LAYOUT, layout);
      pass('layout.tsx: mounted <BlocksProviders> inside <AppProvider> (import + JSX)');
    }
    changed++;
  }

  // ── (e) GENERATED SDK ALIASES — bind @/generated/{auth,admin} onto the existing SDK ──
  // The installed auth blocks + blocks-runtime import their hooks from `@/generated/auth`
  // (→ src/graphql/sdk/auth) and `@/generated/admin` (→ src/graphql/sdk/admin). The template
  // generates those SDKs at src/graphql/sdk/<ns> but does NOT alias @/generated/* onto them, so
  // without this the build can't resolve `@/generated/auth` → `useSignInMutation`. Add the TWO
  // explicit keys (blocks-onramp Step 1 / SKILL.md:307) — NOT a bare `@/generated/*` wildcard,
  // which would shadow the `@/*` → `./src/*` wildcard the template relies on. Idempotent: a no-op
  // when both keys are already present and correct.
  const GEN_ALIASES = {
    '@/generated/auth': ['./src/graphql/sdk/auth'],
    '@/generated/admin': ['./src/graphql/sdk/admin'],
  };
  const TSCONFIG = join(APP_DIR, 'tsconfig.json');
  if (!existsSync(TSCONFIG)) {
    die(`expected ${TSCONFIG} (the app's tsconfig) — not found. Add the @/generated/{auth,admin} path aliases by hand (blocks-onramp Step 1).`);
  }
  {
    const raw = readFileSync(TSCONFIG, 'utf8');
    // tsconfig.json is JSONC: strip // and /* */ comments + trailing commas before JSON.parse.
    // (string-literal-safe: skip anything inside a "…" string so a `//` or `,}` in a path value
    // is never mistaken for a comment / trailing comma.)
    const stripJsonc = (s) => {
      let out = '';
      let inStr = false;
      let inLine = false;
      let inBlock = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const next = s[i + 1];
        if (inLine) {
          if (ch === '\n') {
            inLine = false;
            out += ch;
          }
          continue;
        }
        if (inBlock) {
          if (ch === '*' && next === '/') {
            inBlock = false;
            i++;
          }
          continue;
        }
        if (inStr) {
          out += ch;
          if (ch === '\\') {
            out += next ?? '';
            i++;
          } else if (ch === '"') {
            inStr = false;
          }
          continue;
        }
        if (ch === '"') {
          inStr = true;
          out += ch;
          continue;
        }
        if (ch === '/' && next === '/') {
          inLine = true;
          i++;
          continue;
        }
        if (ch === '/' && next === '*') {
          inBlock = true;
          i++;
          continue;
        }
        out += ch;
      }
      // drop trailing commas: `,}` / `,]` (whitespace between allowed) — now comment-free.
      return out.replace(/,(\s*[}\]])/g, '$1');
    };
    let json;
    try {
      json = JSON.parse(stripJsonc(raw));
    } catch (e) {
      die(`could not parse ${TSCONFIG} as JSON(C) (${e.message}). Add the @/generated/{auth,admin} path aliases by hand (blocks-onramp Step 1).`);
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      die(`${TSCONFIG} is not a JSON object — add the @/generated/{auth,admin} path aliases by hand (blocks-onramp Step 1).`);
    }
    const co = json.compilerOptions;
    if (!co || typeof co !== 'object' || Array.isArray(co)) {
      die(`${TSCONFIG} has no compilerOptions object to add "paths" to (template shape moved). Add the @/generated/{auth,admin} path aliases by hand (blocks-onramp Step 1).`);
    }
    if (!co.paths || typeof co.paths !== 'object' || Array.isArray(co.paths)) {
      co.paths = {};
    }
    const sameTarget = (k) =>
      Array.isArray(co.paths[k]) &&
      co.paths[k].length === GEN_ALIASES[k].length &&
      co.paths[k].every((v, i) => v === GEN_ALIASES[k][i]);
    const missing = Object.keys(GEN_ALIASES).filter((k) => !sameTarget(k));
    if (missing.length === 0) {
      info('tsconfig.json already binds @/generated/{auth,admin} onto the SDK (no change)');
    } else {
      for (const k of missing) co.paths[k] = [...GEN_ALIASES[k]];
      // Preserve the file's indentation style (the template uses tabs; default to 2 spaces).
      const indentTab = /^\t/m.test(raw);
      const indent = indentTab ? '\t' : 2;
      const serialized = JSON.stringify(json, null, indent) + (raw.endsWith('\n') ? '\n' : '');
      if (dryRun) {
        info(`[dry-run] would add ${missing.map((k) => `"${k}"`).join(' + ')} to tsconfig.json compilerOptions.paths`);
      } else {
        writeFileSync(TSCONFIG, serialized);
        pass(`tsconfig.json: bound ${missing.map((k) => `"${k}"`).join(' + ')} → src/graphql/sdk (so @/generated/{auth,admin} resolves)`);
      }
      changed++;
    }
  }
} else {
  info('--no-blocks: skipped BlocksRuntime/StepUpProvider wiring (did env + collision fix only)');
}

console.log('------------------------------------------------------------');
if (dryRun) {
  warn(`dry-run complete — ${changed} change(s) WOULD be applied. Re-run without --dry-run to apply.`);
} else if (changed === 0) {
  pass('app already fully wired (env + collision + blocks) — nothing to do');
} else {
  pass(`app wired — ${changed} file(s) updated. Next: ONE \`pnpm install\` at the workspace root (materializes the deps declared above — no separate \`pnpm add\` rounds), then \`pnpm codegen\`, then build (SKILL.md S4/S8).`);
}
if (!dryRun) {
  // The dev port is persisted in run-state; the gates read it from there. Surfaced here so a hand
  // run uses the SAME free port (Next honors PORT via the dev/start script's `--port ${PORT:-N}`).
  info(`run the app on its allocated port: PORT=${APP_PORT} pnpm dev  (→ ${`http://localhost:${APP_PORT}`})`);
}
process.exit(0);
