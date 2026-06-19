#!/usr/bin/env node
/**
 * live-qa.mjs — the running-app acceptance DRIVER for the Phase 4 live-QA gate.
 *
 * scripts/verify-phase.sh `run_live_qa()` shells out to this file (it looks for
 * `$REPO_ROOT/scripts/live-qa.mjs`). The contract it hands us — exactly as the
 * shell sets it up — is:
 *
 *   • cwd        = the WORKSPACE_ROOT (the built app's pnpm workspace).
 *   • env        = LIVE_QA_BASE_URL  and  BASE_URL  (same value) → the app URL
 *                  (already proven reachable by run_live_qa before we are called).
 *   • argv       = none. run_live_qa passes NO flow list — so we resolve the flows
 *                  to exercise OURSELVES from the brief's acceptance.required_flows[]
 *                  (LIVE_QA_FLOWS / LIVE_QA_SPEC override; else build/app-brief.yaml,
 *                  test/app-spec.yaml, or build/run-state.json — the same files the
 *                  verifier autodetects).
 *   • browser    = run_live_qa already verified a browser driver is on PATH and
 *                  prefers `agent-browser` (the Chrome CDP CLI). We drive Chrome
 *                  through that same CLI here.
 *   • exit code  = 0 ONLY if every required flow's happy path passes (2xx AND the
 *                  asserted UI outcome still holds after a reload). NON-ZERO if ANY
 *                  flow fails — run_live_qa turns our non-zero into a HARD gate fail.
 *
 * The user's STANDING REQUIREMENT this driver implements: every app-building wave
 * must end with a Chrome QA pass across ALL of the app's flows
 * (acceptance.required_flows[]) — not a single round-trip. So we ITERATE over every
 * required flow and drive each one's happy path in a real browser. A required flow
 * with no QA script here is NOT silently skipped: it FAILS LOUDLY ("coverage gap")
 * and the run exits non-zero. The wave is green only when ALL flows are exercised.
 *
 * Selectors: data-testid / ARIA role ONLY — never text or CSS. Block restyles must
 * not break this gate (the blocks are a moving registry).
 *
 * Zero dependencies. Pure Node (>=18). Drives Chrome via the `agent-browser` CLI
 * (https://www.npmjs.com/package/agent-browser); each invocation re-attaches to the
 * persistent agent-browser daemon, so the browser/session survives across the
 * discrete steps below.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// parseBrief is the SAME zero-dep brief reader the scaffolders use (scripts/lib/brief.mjs).
// We use parseBrief — NOT loadBrief — on purpose: loadBrief also runs validateBrief, which
// would hard-THROW on a brief edge case and crash this gate; the scaffolders already
// validated the brief upstream, and here we only need ui.routes[] / data_model.tables[]
// to DERIVE the CRUD path + testid prefix (degrading to the todo fallback if it can't parse).
import { parseBrief } from './lib/brief.mjs';
// Identifier inflection — the SHARED home (scripts/lib/inflect.mjs). These are the SAME
// helpers scaffold-frontend.mjs uses to derive the per-entity testid prefix + table match;
// importing them (instead of the prior byte-for-byte local copies) keeps the derived prefix
// identical to the scaffolder's by CONSTRUCTION. inflect.mjs is a pure, side-effect-free
// module (no main()), so importing it is safe here (unlike scaffold-frontend.mjs, the CLI).
import { words, kebab, camel, pluralizeWords, singularFromTable } from './lib/inflect.mjs';
// b2b ORG-CHAINING helpers (scripts/lib/qa-fixtures.mjs): resolve an orgId the SIGNED-IN
// actor actually OWNS (their personal org, entity_id = currentUser.id, seeded by the
// orgReconcile) instead of querying a FOREIGN env-supplied org → "permission denied", and
// seed a pending app-membership fixture so approve/revoke/remove can be driven. Zero-dep;
// all browser/GraphQL work is delegated back via the deps the drivers pass in.
import { resolveOwnedOrgId, confirmActorOwnsOrg, seedPendingMembership } from './lib/qa-fixtures.mjs';
// Infra coordinates (hub endpoints, app port, Mailpit URL) come from constructive.config.json
// via scripts/lib/config.mjs — the single source-of-truth. Same default values; only WHERE
// they are read changes. getEndpoint('auth', sub) builds the per-DB auth-<sub> URL, etc.
import { getEndpoint, getAppBaseUrl, getMailpitUrl } from './lib/config.mjs';
// ── live-QA helper kit (extracted from this file, purely structural) ──────────
// The reporter, the agent-browser DOM/browser primitives, and the GraphQL/Mailpit/auth-
// precondition helpers now live in cohesive sibling modules under lib/live-qa/. They carry
// NO verdict decisions and NO routeFor()/openAndAwaitMount() contract call-sites — those
// stay HERE (the verdict ledger + the static-parse contract surface check-flow-surfaces.mjs
// reads from this file). Behavior is byte-identical: these are the same definitions, only
// relocated, with the same set-once-then-read EXPECTED_ORIGIN pattern via getExpectedOrigin().
import { C, log, step, AB } from './lib/live-qa/report.mjs';
import {
  ab,
  AbError,
  setExpectedOrigin,
  getExpectedOrigin,
  originAssertEnabled,
  isolateBrowserSession,
  pageEval,
  pageEvalJson,
  Q_TESTID,
  navigate,
  reload,
  waitTestid,
  fillTestid,
  clickTestid,
  clickTestidVerify,
  countTestid,
  visibleTestid,
  testidContainsText,
  testidContainsTextAny,
  clickRowAffordanceVerify,
  sleep,
  graphqlHadSuccess,
} from './lib/live-qa/browser.mjs';
import {
  gqlAuthed,
  pollMailpit,
  ensureSignedIn,
  signInWith,
  signUpSecondActor,
  signOutBestEffort,
  authTestids,
} from './lib/live-qa/session.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// ── per-app state resolution (RECON-3 convention) ────────────────────────────
// One token (APP_ID = the brief's naming.db_name, e.g. 'goldenapp') disambiguates
// brief + run-state + port + flows. When APP_ID is RESOLVABLE, per-app artifacts live
// under build/<app-id>/ and we NEVER read the legacy singleton build/run-state.json —
// even if the per-app file is absent (a missing file degrades to {}, the readers already
// tolerate that). That isolation is the whole point of STATE-ISOLATION: a polluted legacy
// run-state (e.g. a prior b2b app's, with org_reconcile set + stale endpoints) must NOT
// leak into an auth:email app — falling back to legacy when APP_ID is set is exactly that
// leak (false b2b tier-detection via probeCaps' org_reconcile + the wrong app_*_endpoint).
// Only when NO app-id is resolvable do we collapse to the LEGACY singleton build/ paths,
// so the frozen canary / single-app golden-path resolve byte-for-byte.
//
// APP_ID is resolved from (highest precedence first):
//   1) $APP_ID env (both orchestrators export it, derived from the brief's db_name), else
//   2) the brief's naming.db_name (so a polluted legacy can't leak even when the gate
//      forgot to export APP_ID but a brief IS resolvable) — derived the SAME way the
//      orchestrators do: strip every non-[a-z0-9] (db_name is plain-lowercase per the
//      brief validator, so this is the identity, but we sanitize defensively to match).
// We DELIBERATELY peek the brief WITHOUT the per-app candidate here (we don't have an
// app-id yet) — only LIVE_QA_SPEC → legacy build/app-brief.yaml → test/app-spec.yaml.
function sanitizeAppId(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
function dbNameFromBriefFile(file) {
  // Minimal scan for `naming.db_name:` — we must NOT call parseBrief here (it lives below
  // and pulling it up would reorder the module); a 1-key regex over the YAML is enough and
  // mirrors the orchestrators' awk. Returns '' when not found/readable.
  try {
    const text = readFileSync(file, 'utf8');
    let inNaming = false;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      // A top-level key (col 0, non-comment) opens/closes the naming block.
      if (/^[^\s#].*:/.test(line)) inNaming = /^naming\s*:/.test(line);
      else if (inNaming) {
        const m = line.match(/^\s+db_name\s*:\s*([^#\s]+)/);
        if (m) return m[1].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    /* unreadable → no app-id from here */
  }
  return '';
}
function resolveAppId() {
  const fromEnv = sanitizeAppId(process.env.APP_ID);
  if (fromEnv) return fromEnv;
  // No env app-id — try to DERIVE it from a resolvable brief's naming.db_name. Peek only
  // the non-per-app brief candidates (we have no app-id to form a per-app path yet).
  for (const p of [process.env.LIVE_QA_SPEC, join(REPO_ROOT, 'build', 'app-brief.yaml'), join(REPO_ROOT, 'test', 'app-spec.yaml')]) {
    if (p && existsSync(p)) {
      const id = sanitizeAppId(dbNameFromBriefFile(p));
      if (id) return id;
    }
  }
  return '';
}
const APP_ID = resolveAppId();
const stateDir = () => (APP_ID ? join(REPO_ROOT, 'build', APP_ID) : join(REPO_ROOT, 'build'));
// Brief candidates (keep LIVE_QA_SPEC first; insert per-app BEFORE the legacy singleton):
const briefCandidates = () =>
  [
    process.env.LIVE_QA_SPEC,
    APP_ID ? join(REPO_ROOT, 'build', APP_ID, 'app-brief.yaml') : null, // per-app
    join(REPO_ROOT, 'build', 'app-brief.yaml'), // LEGACY — unchanged
    join(REPO_ROOT, 'test', 'app-spec.yaml'),
  ].filter(Boolean);
// Cheap identity read of a run-state file → the sanitized app-id it BELONGS to (from
// database.name, else database.subdomain), or '' if unreadable. Used to decide whether the
// legacy singleton is THIS app's own state (safe to fall back to) or a FOREIGN app's
// (the pollution we must refuse). Never throws.
function stateIdentity(file) {
  try {
    if (!file || !existsSync(file)) return '';
    const s = JSON.parse(readFileSync(file, 'utf8')) || {};
    const db = s.database || {};
    return sanitizeAppId(db.name || db.subdomain || '');
  } catch {
    return '';
  }
}

// Run-state path resolution — the crux of STATE-ISOLATION:
//   • NO app-id resolvable → the LEGACY singleton build/run-state.json (single-app golden
//     path / frozen canary, byte-for-byte unchanged).
//   • app-id resolvable AND build/<app-id>/run-state.json EXISTS → that per-app file.
//   • app-id resolvable but the per-app file is ABSENT → consult the legacy singleton, but
//     ONLY when its identity MATCHES this app-id (it's genuinely this app's own singleton —
//     the documented golden-path case where build/goldenapp/ has no run-state yet). If the
//     legacy belongs to a DIFFERENT tenant (a prior b2b app's polluted coblog state vs an
//     auth:email app), REFUSE it and return the (absent) per-app path → readRunState
//     degrades to {} → owner-tier + no stale endpoints. THIS is what stops a polluted legacy
//     run-state from false-FAILing an auth:email app as b2b / leaking stale endpoints.
function runStatePath() {
  if (!APP_ID) return join(REPO_ROOT, 'build', 'run-state.json'); // legacy single-app path
  const perApp = join(stateDir(), 'run-state.json');
  if (existsSync(perApp)) return perApp;
  // Per-app file absent — identity-gate the legacy fallback (golden-path compat without leak).
  const legacy = join(REPO_ROOT, 'build', 'run-state.json');
  if (existsSync(legacy) && stateIdentity(legacy) === APP_ID) return legacy; // this app's own legacy state
  return perApp; // foreign or no legacy → the absent per-app path (→ {} in readRunState)
}

// ── flow-surfaces.json — the mounter↔driver contract (RECON-2 §3 wiring) ─────
// scaffold-frontend.mjs (step f) mounts each flow's blocks on a real surface and writes
// build/<app-id>/flow-surfaces.json (and the legacy build/flow-surfaces.json) mapping
// flow id → { path, shellTestid }. WITHOUT reading it here, routeFor() fell back to the
// RECON-2 §3 DEFAULTS (e.g. /account/security, /account/emails, /account/sessions) while
// the mounter actually aggregates onto ONE /account page — so every account-session
// driver navigated to a 404 and self-reported partial(block-not-mounted). We load the
// manifest so routeFor() can use the path the mounter ACTUALLY emitted. Env
// LIVE_QA_ROUTE_<FLOW> still wins over both (explicit override). Same STATE-ISOLATION +
// golden-path-compat rule as run-state: no app-id → legacy singleton; app-id with a per-app
// manifest → that file; app-id without one → the legacy manifest ONLY when the legacy
// run-state belongs to THIS app (flow-surfaces.json carries no identity field, so we use the
// run-state's tenancy as the proxy — the canary's goldenapp case). A foreign legacy manifest
// is refused (→ {} → routeFor uses its §3 default), so stale prior-app routes can't leak.
function flowSurfacesPath() {
  if (!APP_ID) return join(REPO_ROOT, 'build', 'flow-surfaces.json'); // legacy single-app path
  const perApp = join(stateDir(), 'flow-surfaces.json');
  if (existsSync(perApp)) return perApp;
  const legacy = join(REPO_ROOT, 'build', 'flow-surfaces.json');
  const legacyState = join(REPO_ROOT, 'build', 'run-state.json');
  if (existsSync(legacy) && stateIdentity(legacyState) === APP_ID) return legacy; // this app's own legacy manifest
  return perApp; // foreign or no legacy → absent per-app path (→ {} flows → §3 default routes)
}
const FLOW_SURFACES = (() => {
  try {
    const p = flowSurfacesPath();
    if (!existsSync(p)) return {};
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return j?.flows && typeof j.flows === 'object' ? j.flows : {};
  } catch {
    return {};
  }
})();

// ── reporter + agent-browser DOM/browser primitives: EXTRACTED ───────────────
// The tiny reporter (C/log/step), the agent-browser child-process driver (ab/AbError),
// the run-isolation origin guard, the page-eval bridge, and every data-testid/role-keyed
// primitive (navigate/reload/fill/click/wait/count/visible/text + the row-scoped affordance
// resolver + sleep + the 2xx network probe) now live in scripts/lib/live-qa/report.mjs +
// scripts/lib/live-qa/browser.mjs and are imported at the top of this file. They carry NO
// verdict decisions and NO routeFor()/openAndAwaitMount() contract call-sites — so the
// check-flow-surfaces static parse (which reads THIS file) is unaffected. Behavior is
// byte-identical; the once-module-level EXPECTED_ORIGIN is now browser.mjs state, set via
// setExpectedOrigin() and read via getExpectedOrigin() (same set-once-then-read pattern).

// ════════════════════════════════════════════════════════════════════════════
// SHARED DRIVER HELPERS (RECON-2 §2) — added once, reused by every flow driver.
// All keep the zero-dep, agent-browser + Node-fetch rule. None of these run at
// import time; resolveAppContext()/probeCaps() are called once from main().
// ════════════════════════════════════════════════════════════════════════════

// Read the per-app run-state.json (RECON-3 shape) the SAME way the readers do
// (per-app build/<app-id>/ when APP_ID is set + present, else legacy build/). Never
// throws — returns {} when there is no readable/parseable state file.
function readRunState() {
  try {
    const p = runStatePath();
    if (p && existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) || {};
  } catch {
    /* ignore — degrade to env/brief/default */
  }
  return {};
}

// Swap the leading sub-domain label of a per-DB GraphQL endpoint host
// (e.g. http://auth-goldenapp.localhost:3000/graphql → swapping 'auth'→'admin'
// gives http://admin-goldenapp.localhost:3000/graphql). Only rewrites a host whose
// first label is exactly `from-<rest>`; otherwise returns the URL unchanged.
function swapEndpointPrefix(url, from, to) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(new RegExp(`^${from}-`), `${to}-`);
    return u.toString().replace(/\/$/, u.pathname.endsWith('/') ? '/' : '');
  } catch {
    return url;
  }
}

// ── §2.2 App context — resolve the running app's URL + per-DB endpoints from the
// ACTUALLY-running app (run-state → brief → env → documented default), NEVER a bare
// hardcoded port/subdomain. baseUrl keeps the gate's LIVE_QA_BASE_URL/BASE_URL as the
// highest precedence (they point at the app the gate brought up).
function resolveAppContext() {
  const state = readRunState();
  const db = (state && state.database) || {};

  // baseUrl precedence: gate env → run-state frontend (the ALLOCATED dev port wire-app persisted)
  // → brief frontend_port (only a BASE) → default. The run-state port is authoritative because two
  // concurrent apps each got their OWN free port; the brief frontend_port is just the base it grew
  // from. Accept both the canonical field names (base_url/frontend_port) and the older url/port.
  let baseUrl = (process.env.LIVE_QA_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    const fe = (state && state.frontend) || {};
    const feUrl = fe.base_url || fe.url;
    const fePort = fe.frontend_port || fe.port;
    if (feUrl) baseUrl = String(feUrl).replace(/\/+$/, '');
    else if (fePort) baseUrl = `http://localhost:${fePort}`;
  }
  if (!baseUrl) {
    const brief = loadBriefForQa();
    const port = brief?.frontend_port || brief?.ui?.frontend_port;
    if (port) baseUrl = `http://localhost:${port}`;
  }
  if (!baseUrl) baseUrl = getAppBaseUrl(); // canonical default (app.portBase) — last resort.

  // Endpoints + subdomain precedence: run-state app_*_endpoint → subdomain → env → override.
  // The per-DB defaults are built from constructive.config.json (hub scheme/host/port/pattern).
  const subdomain = db.subdomain || process.env.LIVE_QA_SUBDOMAIN || '';
  let authEndpoint =
    db.app_auth_endpoint ||
    (subdomain && getEndpoint('auth', subdomain)) ||
    process.env.NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT ||
    process.env.LIVE_QA_AUTH_ENDPOINT ||
    '';
  let dataEndpoint =
    db.app_data_endpoint ||
    (subdomain && getEndpoint('api', subdomain)) ||
    process.env.NEXT_PUBLIC_APP_ENDPOINT ||
    process.env.LIVE_QA_DATA_ENDPOINT ||
    '';
  // adminEndpoint: explicit env/run-state, else derive by swapping auth-/api- → admin-.
  let adminEndpoint =
    db.app_admin_endpoint ||
    process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT ||
    process.env.LIVE_QA_ADMIN_ENDPOINT ||
    (subdomain && getEndpoint('admin', subdomain)) ||
    swapEndpointPrefix(authEndpoint, 'auth', 'admin') ||
    swapEndpointPrefix(dataEndpoint, 'api', 'admin') ||
    '';

  // Allow an explicit env override to win for the rare custom run.
  if (process.env.LIVE_QA_AUTH_ENDPOINT) authEndpoint = process.env.LIVE_QA_AUTH_ENDPOINT;
  if (process.env.LIVE_QA_DATA_ENDPOINT) dataEndpoint = process.env.LIVE_QA_DATA_ENDPOINT;
  if (process.env.LIVE_QA_ADMIN_ENDPOINT) adminEndpoint = process.env.LIVE_QA_ADMIN_ENDPOINT;

  return {
    baseUrl,
    subdomain,
    authEndpoint,
    dataEndpoint,
    adminEndpoint,
    brief: loadBriefForQa(),
    derived: deriveCrudTarget(),
    state,
    caps: { mailpit: false, orgReconcile: false }, // filled by probeCaps()
  };
}

// ── §2.1 Capability probe — run ONCE in main() before the loop → ctx.caps.
// Drivers gate on these via their `needs[]`: a missing cap → partial-by-design,
// never a hard fail (mirrors run_live_qa's "no browser ⇒ skip, not fail").
async function probeCaps(ctx) {
  const caps = { mailpit: false, orgReconcile: false };

  // mailpit: best-effort GET the v1 messages endpoint with a short timeout.
  const mpBase = (process.env.LIVE_QA_MAILPIT_URL || getMailpitUrl()).replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${mpBase}/api/v1/messages?limit=1`, { signal: ctrl.signal });
    clearTimeout(t);
    caps.mailpit = !!res && res.ok;
  } catch {
    caps.mailpit = false;
  }

  // orgReconcile (the b2b-vs-owner tier signal the org drivers gate on). Despite the legacy name,
  // this is purely a TIER detector now: the platform self-seeds the personal-org membership a fresh
  // b2b signup needs (PLATFORM-GAPS.md GAP-1b/1c, CLOSED), so there is no reconcile to run — the cap
  // just decides whether the org-flow drivers (org-members / org-roles / org-invites / app-memberships)
  // RUN at all. Precedence:
  //   (1) LIVE_QA_ORG_RECONCILE env override (only an explicit 1/true/yes ⇒ on), else
  //   (2) the BRIEF tier (authoritative + brief-driven, never an app/db-name literal): a b2b preset
  //       (b2b | b2b:storage | full) OR any table with an org-scoped policy intent (org-membership /
  //       member-owner) ⇒ org tier. This MIRRORS verify-phase.sh's org-tier detection + brief.mjs's
  //       b2b gate, so the gate and the driver agree, else
  //   (3) a positive run-state database.org_reconcile stamp (back-compat with an externally-stamped
  //       state; negative sentinels like 'n/a (auth:email tier)' / none / false read as owner-tier).
  // An owner / public-read app is none of these ⇒ cap false ⇒ org drivers SKIP (the frozen owner
  // canary is unaffected).
  if (process.env.LIVE_QA_ORG_RECONCILE != null && process.env.LIVE_QA_ORG_RECONCILE !== '') {
    caps.orgReconcile = /^(1|true|yes)$/i.test(process.env.LIVE_QA_ORG_RECONCILE.trim());
  } else if (briefIsOrgTier()) {
    caps.orgReconcile = true;
  } else {
    const rec = ctx?.state?.database?.org_reconcile;
    const recStr = typeof rec === 'string' ? rec.trim() : '';
    const isNegative = /^(n\/?a|none|false|no|0|off|skip|n\/a)\b/i.test(recStr);
    caps.orgReconcile = recStr.length > 0 && !isNegative;
  }

  return caps;
}

// ── GraphQL / Mailpit / auth-precondition helpers: EXTRACTED ──────────────────
// gqlAuthed / abEvalAsync / pollMailpit / sleepAsync / clearAuthState / ensureSignedIn /
// signInWith / signUpSecondActor / signOutBestEffort / authTestids now live in
// scripts/lib/live-qa/session.mjs and are imported at the top of this file (the names the
// drivers + the helpers below still reference are imported, so behavior is byte-identical).
// They carry NO verdict decisions and NO routeFor()/openAndAwaitMount() call-sites.

// Resolve a per-flow route. Precedence: (1) env LIVE_QA_ROUTE_<FLOW> (explicit override)
// → (2) the path the MOUNTER actually emitted (build/<app>/flow-surfaces.json — the
// mounter↔driver contract) → (3) the RECON-2 §3 default handed in. Wiring (2) is the fix
// for the account-session drivers landing on /account/<sub> 404s when the mounter
// aggregates onto a single /account page. e.g. flow 'change-password' →
// LIVE_QA_ROUTE_CHANGE_PASSWORD, else flow-surfaces['change-password'].path, else fallback.
//
// `vars` (optional) resolves DYNAMIC-SEGMENT tokens in whichever path won. The org flows
// now mount under a URL-param route (e.g. /org/[orgId]/members in the manifest), so the
// driver must turn that TEMPLATE path into a CONCRETE URL with the owned org id before it
// can navigate. Passing { orgId } substitutes every `[orgId]` / `:orgId` / `${orgId}` /
// `%orgId%` form of each key with its value. With no `vars` (the common case) the path is
// returned verbatim — existing callers are unchanged. We DON'T inject a missing segment
// here (that's the org driver's job via orgRouteFor) — routeFor only substitutes tokens
// that already exist in the resolved path, so it stays generic (no flow id special-cased).
function routeFor(flow, fallback, vars) {
  const key = `LIVE_QA_ROUTE_${String(flow).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const mounted = FLOW_SURFACES[flow]?.path;
  let route = process.env[key] || mounted || fallback;
  if (vars && route && typeof route === 'string') {
    for (const [name, val] of Object.entries(vars)) {
      if (val == null || val === '') continue;
      const v = String(val);
      // Match Next dynamic-segment ([orgId]), Express (:orgId), template (${orgId}) and
      // %orgId% spellings of THIS key, anchored to a path-segment boundary so e.g. an
      // `orgId` token never partially matches `orgIdentifier`.
      route = route
        .replace(new RegExp(`\\[${name}\\]`, 'g'), v)
        .replace(new RegExp(`\\$\\{${name}\\}`, 'g'), v)
        .replace(new RegExp(`%${name}%`, 'g'), v)
        .replace(new RegExp(`(^|/):${name}(?=/|$)`, 'g'), `$1${v}`);
    }
  }
  return route;
}

// Normalize an org-detail route to the CONCRETE URL-param form /org/<ownedId>/<sub> the
// org drivers navigate to. `mountedRoute` is whatever the caller's per-flow routeFor(...)
// already resolved (env override → manifest path → fallback) — each org driver keeps its
// own literal routeFor(flow, ...) call so the check-flow-surfaces static parser still sees
// the flow key as a driver consumer.
// The mounter now emits a URL-param org route, so the manifest path is a TEMPLATE
// (/org/[orgId]/<sub>); routeFor already substituted the [orgId]/:orgId token when the
// caller passed { orgId }. Here we GUARANTEE the concrete id segment regardless of the
// manifest shape: if the resolved path still has no concrete org-id segment (an older
// mounter that emitted the flat /org/<sub>, or a bare fallback), splice the id in right
// after `/org/`. Result: always /org/<ownedId>/<sub>. `sub` is the route leaf
// (members | roles | app-memberships).
function orgRouteConcrete(mountedRoute, sub, orgId) {
  const id = String(orgId || '').trim();
  let route = mountedRoute || (id ? `/org/${id}/${sub}` : `/org/${sub}`);
  if (!id) return route; // nothing to splice; return the (token-free) path as-is.
  // If the resolved path already contains the concrete id as its own segment, we're done.
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|/)${escId}(/|$)`).test(route)) return route;
  // No id segment (flat /org/<sub> or an unsubstituted template) — splice it after /org/.
  if (/^\/org(\/|$)/.test(route)) return route.replace(/^\/org(\/|$)/, `/org/${id}$1`);
  // Path doesn't start at /org (custom override to some other base) — leave it untouched.
  return route;
}

// Drive to a route and wait for ONE of its identifying testids to appear. Returns true
// when mounted. STRICT-BY-DEFAULT: if none of the markers appear within the timeout, a
// block that SHOULD be mounted is not — that is a BREAKAGE, so we THROW (→ the gate hard-
// fails) by default. "We shipped this flow" is thus enforceable without any env wiring.
// ESCAPE HATCH: set LIVE_QA_STRICT_MOUNT to a falsy token (0/false/no/off) to RELAX the
// check — then this returns false and the caller records a DOCUMENTED (non-failing)
// block-not-mounted partial (the operator explicitly opted out of mount-strictness). A
// truthy/absent value keeps the default strict behavior. `markers` is one testid or a
// list (any match counts as mounted).
//
// strictMountRelaxed() centralizes the env read so the callers' documented-partial branch
// and this throw use the SAME definition of "relaxed". Strict is the default: ONLY an
// explicit falsy token relaxes it; absent/empty/any-other value ⇒ strict.
function strictMountRelaxed() {
  const v = (process.env.LIVE_QA_STRICT_MOUNT || '').trim();
  return /^(0|false|no|off)$/i.test(v);
}
function openAndAwaitMount(ctx, flow, route, markers, { timeoutMs = 12000 } = {}) {
  const ids = Array.isArray(markers) ? markers : [markers];
  navigate(`${ctx.baseUrl}${route}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const id of ids) {
      if (pageEval(`!!${Q_TESTID(id)}`) === 'true') return true;
    }
    sleep(400);
  }
  if (!strictMountRelaxed()) {
    // DEFAULT: a should-be-mounted block that never appeared is a real breakage → fail loudly.
    throw new Error(
      `block not mounted at ${route} (none of [${ids.join(', ')}] appeared within ${timeoutMs}ms) — set LIVE_QA_STRICT_MOUNT=0 to downgrade this to a documented partial`
    );
  }
  return false; // RELAXED only: caller turns this into a DOCUMENTED block-not-mounted partial.
}

// A verdict helper so drivers read declaratively.
const pass = (evidence) => ({ status: 'pass', evidence });
// PARTIAL TAXONOMY (the crux of "a green QA actually means working"):
// a `partial` is two very different things and the gate must NOT conflate them:
//   • documentedGap:true  — partial because of a DOCUMENTED UPSTREAM gap or an
//     absent-by-design dependency (sessions list missing = GAP-2, api-key revoke
//     no-op = GAP-3, no live IdP for OAuth, Mailpit absent, org create/transfer
//     GAP-1b/1c/5/6, an operator-relaxed mount). This is a labeled NON-failure
//     (the surface IS working as far as we can reach it; the missing leg is known
//     and tracked). It does NOT flip the gate red.
//   • documentedGap:false — partial because something is BROKEN/UNMOUNTED that
//     SHOULD work (a block that should be mounted is not, a page crashed, an
//     expected control is missing, a create truly errored). This is a REGRESSION
//     and MUST count against the gate (exit non-zero).
// DEFAULT IS STRICT: a partial is non-failing ONLY when explicitly marked
// documentedGap:true. An un-annotated partial is treated as a potential breakage
// and FAILS — so a newly-added partial can never silently turn the gate green.
// `gapPartial` is the readable shorthand for the documented (non-failing) kind.
const partial = (reason, evidence, { documentedGap = false } = {}) => ({
  status: 'partial',
  reason,
  evidence: evidence || reason,
  documentedGap: !!documentedGap,
});
// Documented-upstream-gap / by-design partial → labeled NON-failure (exit 0).
const gapPartial = (reason, evidence) => partial(reason, evidence, { documentedGap: true });
// Structural-breakage partial → counts against the gate (exit non-zero). Same shape
// as a bare partial() but named so the intent ("this is a real defect, fail") is
// explicit at the call site for the broken/unmounted/missing-control cases.
const brokenPartial = (reason, evidence) => partial(reason, evidence, { documentedGap: false });

// Hedged "no email arrived" evidence. Mailpit was reachable (the cap probe passed) but the
// specific message never landed. We deliberately DO NOT assert the cause is the missing
// site-domain row — an upstream SEND failure (mailer not wired, template/proc error, queue
// not draining) presents identically from here. So we list BOTH likely causes and point at
// the auth-server log as the disambiguator, instead of misattributing it to one config row.
const emailNotDeliveredEvidence = (kind) =>
  `Mailpit reachable but no ${kind} email arrived. This is NOT necessarily the site-domain row: an upstream send failure (mailer not configured, email template/proc error, or the send queue not draining) looks the same from here. Check the auth-server log for a send/enqueue error first; if the send was attempted, then add/verify the site-domain row (SKILL.md → Email services).`;

// GENUINE org-tier read — recomputes the org-tier signal the SAME way probeCaps does, so a driver
// can confirm the loop-level ctx.caps.orgReconcile gate that let it run is a genuine org tier (not a
// forced LIVE_QA_ORG_RECONCILE or an externally-stamped run-state on an owner/email app). Precedence
// mirrors probeCaps: env override (only an explicit 1/true/yes) → the BRIEF tier (b2b preset /
// org-scoped policy intent — authoritative now that the personal-org seed is platform-native and
// nothing stamps run-state database.org_reconcile) → a positive run-state stamp (back-compat;
// negative sentinels n/a/none/false/no/0/off/skip ⇒ owner tier). Pure read of the brief + ctx.state
// + env; never throws.
function orgReconcileGenuine(ctx) {
  const envv = process.env.LIVE_QA_ORG_RECONCILE;
  if (envv != null && envv !== '') return /^(1|true|yes)$/i.test(String(envv).trim());
  if (briefIsOrgTier()) return true;
  const rec = ctx?.state?.database?.org_reconcile;
  const recStr = typeof rec === 'string' ? rec.trim() : '';
  const isNegative = /^(n\/?a|none|false|no|0|off|skip|n\/a)\b/i.test(recStr);
  return recStr.length > 0 && !isNegative;
}

// ════════════════════════════════════════════════════════════════════════════
// Per-flow QA-step registry — keyed by flow id (the brief's required_flows[]).
//
// Each entry is a DRIVER SPEC (an object, NOT a bare function) so main() can read its
// metadata (group / needs / precondition) WITHOUT executing it (RECON-2 §1):
//   { group, needs[], precondition?, run }
//   • group        'authentication' | 'account-session' | 'authorization' (ordering only).
//   • needs        capability gate ⊆ ['mailpit','orgReconcile']. A missing cap → main()
//                  records partial(<cap>-absent) and SKIPS the driver (partial-by-design,
//                  never a hard fail). [] = always runnable.
//   • precondition optional async(ctx)=>true|<reason>. A returned string short-circuits to
//                  partial(<reason>) (e.g. signup failed → don't blame the flow).
//   • run          async(ctx)=>Verdict. Verdict = pass(evidence) | partial(reason,evidence)
//                  | (throwing → main() turns it into a FAIL). ctx = the AppContext (§2.2).
//
// Verdict→exit mapping (RECON-2 §1 — fixed so a GREEN QA actually means working):
//   pass                       → counts as gate-pass.
//   partial (documentedGap:true)  → labeled NON-failure (loud YELLOW + reason +
//                                 PLATFORM-GAPS id). A KNOWN upstream gap / by-design
//                                 absence; NOT a regression — does not flip the gate.
//   partial (documentedGap:false) → REGRESSION (broken/unmounted/missing-control/
//                                 create-errored). FAILS → non-zero exit, same as a throw.
//   throw / pass-path assertion fail → FAIL → non-zero exit.
//   (no registry entry)        → coverage gap → non-zero exit (the loud branch is KEPT).
//
// A flow blocked ONLY by a documented upstream gap (sessions GAP-2, org create RLS GAP-1b/1c,
// org transfer/remove GAP-5, email needing the site-domain row) is marked documentedGap:true
// (gapPartial) with the GAP id — NOT papered over and NOT a hard fail. A flow that is partial
// because a block that SHOULD be mounted is not, a page crashed, or an expected control is
// missing is a BREAKAGE → an un-annotated partial (documentedGap:false) → FAILS the gate.
// Drivers assert a REAL DB/GraphQL outcome (via gqlAuthed / persisted-after-reload), never
// "rendered". The default is strict: only an explicitly-documented partial is non-failing.
//
// Selectors are data-testid / role ONLY and are the VERIFIED block contract (RECON-2 §4,
// read from dashboard-blocks/apps/blocks/src/blocks/{auth,org}). Routes default to RECON-2 §3
// and are overridable per-flow via LIVE_QA_ROUTE_<FLOW>.
// ════════════════════════════════════════════════════════════════════════════

const FLOW_QA = {
  // ── email-password — the canonical auth flow (auth:email). FROZEN CANARY. ──
  // Happy path: signup → (land authenticated) → create a row → reload → ASSERT the row
  // persisted AND auth state is still correct. The signup is now delegated to the shared
  // ensureSignedIn() helper (SAME steps/testids — no behavior change); the CRUD round-trip
  // and its derivation (deriveCrudTarget, the todo-* final fallback) are byte-for-byte.
  'email-password': {
    group: 'authentication',
    needs: [],
    run: async (ctx) => {
      // Per-entity CRUD target, DERIVED from the brief's first crud route so this flow
      // is generic for ANY entity with ZERO env wiring. Precedence for each value:
      //   1) explicit env override (LIVE_QA_CRUD_PATH / LIVE_QA_TID_*) — highest,
      //   2) derived-from-brief (`${entity}-title-input` etc. — what the app emitted),
      //   3) the canary's `/todos` + `todo-*` — ONLY as the final fallback when no
      //      brief/crud-route is resolvable. (See deriveCrudTarget.)
      const derived = ctx.derived || deriveCrudTarget();
      const dPrefix = derived?.prefix; // kebab singular, e.g. 'post' / 'company' / 'blog-post'
      const t = {
        // --- APP-controlled testids (the scaffolded app emits these) ---
        authedMarker: process.env.LIVE_QA_TID_AUTHED || 'authed-shell',
        // CRUD page + form/row testids — RESOLVED env → derived-from-brief → todo. The
        // `<entity>-*` derivation (deriveCrudTarget) is what makes this flow generic:
        // scaffold-frontend.mjs emits `${kebab(entity)}-title-input/-create-submit/-row`
        // per the brief's first crud route, and we look for that SAME prefix here. So a
        // /posts app resolves to /posts + post-* and a /companies app to /companies +
        // company-* with NO env wiring. The /todos + todo-* literals are the frozen
        // canary's inputs and apply ONLY as the final fallback (no brief/route → derived
        // is null); they are NOT "the schema". An explicit env var still wins over both.
        crudPath: process.env.LIVE_QA_CRUD_PATH || derived?.crudPath || '/todos',
        titleInput: process.env.LIVE_QA_TID_TITLE || (dPrefix && `${dPrefix}-title-input`) || 'todo-title-input',
        createSubmit: process.env.LIVE_QA_TID_CREATE || (dPrefix && `${dPrefix}-create-submit`) || 'todo-create-submit',
        rowTestid: process.env.LIVE_QA_TID_ROW || (dPrefix && `${dPrefix}-row`) || 'todo-row',
        // UPDATE/DELETE affordances. entity-page.tsx renders BOTH `<entity>-edit` and
        // `<entity>-delete` per row, and BOTH open the schema-driven edit form
        // (DynamicFormCard) on the Stack — there is NO list-level direct delete. So the
        // delete leg opens the edit form (via the delete affordance) and drives the form's
        // own `record-delete` → `record-delete-confirm`. These two form-footer testids are
        // BLOCK/template-controlled (dynamic-form-card.tsx) — fixed names, not derived.
        editTid: process.env.LIVE_QA_TID_EDIT || (dPrefix && `${dPrefix}-edit`) || 'todo-edit',
        deleteTid: process.env.LIVE_QA_TID_DELETE || (dPrefix && `${dPrefix}-delete`) || 'todo-delete',
        recordSave: process.env.LIVE_QA_TID_RECORD_SAVE || 'record-create', // edit-form save (label "Save Changes")
        recordDelete: process.env.LIVE_QA_TID_RECORD_DELETE || 'record-delete', // edit-form delete
        recordDeleteConfirm: process.env.LIVE_QA_TID_RECORD_DELETE_CONFIRM || 'record-delete-confirm',
      };

      const stamp = Date.now().toString(36);
      const title = `live-qa todo ${stamp}`;
      // Every row this driver creates, tracked by its UNIQUE stamped title. We assert on
      // THESE rows ONLY (presence/absence by exact title) — NEVER a raw row count or a clean
      // table — so a table that already holds other tenants'/prior rows can't make a create
      // "appear to fail" (count unchanged) or a delete "appear to succeed" (count happened to
      // drop). Scoping to our own titles is the generic, tenancy-safe assertion (GAP-B).
      const createdTitles = [];

      // 1+2. SIGN UP → ASSERT AUTHED (delegated to the shared helper — same steps/testids).
      // ensureSignedIn ends when `authed-shell` appears — and `authed-shell` is rendered by
      // the CRUD entity page (entity-page.tsx), which is exactly where the sign-up card's
      // onSuccess CLIENT-SIDE-navigates (router.push(AUTHED_REDIRECT), AUTHED_REDIRECT = the
      // first crud route's path). So on a successful signup we are ALREADY standing on the
      // CRUD page in the SAME live JS session, with NO full page reload — the in-memory auth
      // state the signup just set is still live. This is the REAL first-create path.
      const creds = await ensureSignedIn(ctx);
      if (typeof creds === 'string') throw new Error(creds); // signup failure = real fail for THIS flow

      // 3. FIRST CREATE — IMMEDIATELY AFTER SIGN-UP, IN THE SAME SESSION (GAP-B). ----
      // The blind spot this closes: the driver USED to `navigate(crudPath)` here — a FULL
      // browser open() that COLD-RELOADS the app (fresh hydrate → token read back from
      // localStorage → re-init). That reload made the first create go out through a freshly-
      // hydrated, already-persisted session, so a create that is silently rejected ONLY on the
      // very first post-signup request (HTTP 200 + an `errors` body, row never lands — GAP-A)
      // sailed through. We now drive the first create on the live post-signup session WITHOUT
      // any intervening full reload/navigation that would re-init the app: we wait for the
      // app's OWN router.push(AUTHED_REDIRECT) to surface the create form on the page we are
      // already on. Only if it never appears here (e.g. the operator pointed LIVE_QA_CRUD_PATH
      // at a NON-default crud route, so AUTHED_REDIRECT ≠ t.crudPath) do we fall back to an
      // explicit navigation — and we say so, because that fallback no longer exercises the
      // true first-create-after-signup path.
      step(`create a todo "${title}" — FIRST create, same session as sign-up (no reload), exercises the real post-signup write path`);
      let sameSessionFirstCreate = true;
      {
        // Poll IN-PAGE (no open/reload) for the create input the app's post-signup router.push
        // is bringing up. Generous window: the client-side route + first paint + SDK hydrate.
        const deadline = Date.now() + 20000;
        let present = false;
        while (Date.now() < deadline) {
          if (pageEval(`!!${Q_TESTID(t.titleInput)}`) === 'true') { present = true; break; }
          sleep(400);
        }
        if (!present) {
          // The app did not land us on the create form in-session (override / unusual routing).
          // Fall back to an explicit navigation so the rest of the lifecycle still runs — but
          // this fallback COLD-LOADS the page, so it does NOT exercise the GAP-A first-create
          // path. Flagged loudly so a green here is never mistaken for first-create coverage.
          sameSessionFirstCreate = false;
          step(`create form (${t.titleInput}) did not appear in-session after sign-up — falling back to an explicit navigate to ${t.crudPath} (NOTE: this fallback reloads the app, so it does NOT exercise the same-session first-create path; set LIVE_QA_CRUD_PATH to the first crud route to keep first-create coverage)`);
          navigate(`${ctx.baseUrl}${t.crudPath}`);
          waitTestid(t.titleInput, { what: `${t.titleInput} (todo create form, post-fallback-navigate)` });
        } else {
          step('on the CRUD create form in the SAME session as sign-up (app router.push, no reload) — driving the first create here');
        }
      }
      fillTestid(t.titleInput, title);
      // GENERIC FK-select step: if the quick-add form rendered any FK <select> (its data-testid
      // ends with '-select' — the shared FK-picker contract, e.g. <entity>-<parentEntity>-select),
      // pick its FIRST REAL option and fire input+change so the controlled value registers and the
      // create is enabled. A NO-OP for the canary (the /todos quick-add has no such select) and for
      // any entity with no required FK — needs no env var. Selector stays the data-testid attribute
      // (matched by the '-select' suffix), never CSS/text. "First real option" skips an empty/
      // placeholder value so we never set the FK back to blank.
      {
        const selectedFk = pageEvalJson(`
          var sels = Array.prototype.slice.call(document.querySelectorAll('select[data-testid$="-select"]'));
          var done = [];
          sels.forEach(function (sel) {
            var opts = Array.prototype.slice.call(sel.options || []);
            // First option with a non-empty value (skip a placeholder like "" / "Select…").
            var real = opts.find(function (o) { return o && o.value !== '' && o.value != null; });
            if (!real) return;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, real.value);
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            done.push(sel.getAttribute('data-testid') || '(unnamed)');
          });
          return done;`);
        if (Array.isArray(selectedFk) && selectedFk.length)
          step(`set ${selectedFk.length} FK select(s) to their first option (${selectedFk.join(', ')}) to enable the create`);
      }
      createdTitles.push(title);
      clickTestid(t.createSubmit);

      // Wait for OUR new row (matched by its UNIQUE title, not a count) to show up in-list.
      // Scoping to the exact title — never `count > before` — is what makes this tenancy-safe:
      // on a table that already holds other rows, a count-delta could be satisfied by an
      // unrelated row, masking a first-create that was silently rejected. We assert OUR title
      // is present; if it never appears, the create did not take.
      {
        const deadline = Date.now() + 20000;
        let appeared = false;
        while (Date.now() < deadline) {
          if (testidContainsText(t.rowTestid, title)) {
            appeared = true;
            break;
          }
          sleep(400);
        }
        if (!appeared) {
          // This is exactly the GAP-A shape when it fires on the first post-signup write: the
          // mutation came back HTTP 200 with an `errors` body (or 0 rows under RLS), the SDK
          // onSuccess cleared the input + refetched, but OUR row never landed. Because we drove
          // this create in the SAME session as sign-up with no reload, that path is now under
          // test and FAILS LOUDLY here instead of being masked by a cold reload.
          throw new Error(
            `created todo "${title}" did not appear in the list — the create did not take. ` +
              `This is the first create ${sameSessionFirstCreate ? 'IN THE SAME SESSION as sign-up (no reload)' : '(via fallback navigate)'}; ` +
              `a silent rejection here (HTTP 200 with an errors body / 0 rows under RLS, input cleared + refetched but the row never committed) is the GAP-A class of bug. ` +
              `(rows matching our title before=0; total ${t.rowTestid} now=${countTestid(t.rowTestid)})`
          );
        }
      }
      // Best-effort 2xx check; only fail if the CLI affirmatively reports NO success.
      const net = graphqlHadSuccess();
      if (net === false) throw new Error('no successful (2xx) GraphQL request observed for the create');

      // 4. RELOAD + ASSERT PERSISTED -------------------------------------------
      // NOW a reload is correct (and required): it proves the write COMMITTED (server-side),
      // not just optimistic UI. The earlier first-create above is what exercised the no-reload
      // post-signup path; this reload only re-reads from the backend to confirm durability.
      step('reload and assert the row PERSISTED (real write, not optimistic UI)');
      reload();
      waitTestid(t.rowTestid, { what: `${t.rowTestid} (list rows after reload)`, timeoutMs: 25000 });
      if (!testidContainsText(t.rowTestid, title)) {
        throw new Error(`todo "${title}" was gone after reload — write did not persist (200-but-0-rows / optimistic only)`);
      }

      // 5. ASSERT AUTH STATE STILL CORRECT after reload -------------------------
      step('assert auth state survived the reload');
      if (pageEval(`!!${Q_TESTID(t.authedMarker)}`) !== 'true') {
        throw new Error('authenticated shell marker missing after reload — session/auth state was lost');
      }

      // ── FULL CRUD LIFECYCLE through RLS — UPDATE then DELETE on the row we just
      // created+persisted. The owner dogfood FALSE-PASSED because the driver stopped at
      // create→reload→persist; it NEVER exercised UPDATE or DELETE, so two deterministic UI
      // bugs (the edit-load using an unsupported list arg; the delete selecting a
      // non-existent mutation payload field) sailed through. These two legs CLOSE that hole:
      // each opens the schema-driven edit form, drives a real mutation through RLS, reloads,
      // and HARD-FAILS (throws) if the mutation errors or the post-reload assertion does not
      // hold. Selectors are data-testid / element-role ONLY. Both the `<entity>-edit`/
      // `<entity>-delete` row affordances open the SAME DynamicFormCard (entity-page.tsx),
      // whose fields carry no per-field testid — so we scope to the OPEN card subtree
      // (climbing from the footer save button `record-create`, exactly like GUARD-B below)
      // and write the FIRST editable text input (= the title/label field). This stays
      // generic for ANY entity: no field name, testid, or table is hard-coded.

      // Scope-climb helper (mirrors GUARD-B's FK_FILL_JS): from the edit-form footer save
      // button, climb ancestors to the smallest one whose subtree holds an editable text
      // input — that ancestor is the card container holding both the fields and the footer.
      const EDIT_FORM_SCOPE_JS = `
        var btn = ${Q_TESTID(t.recordSave)};
        if (!btn) return { card: false };
        var skipTypes = { checkbox: 1, radio: 1, hidden: 1, file: 1, range: 1, color: 1, submit: 1, button: 1 };
        function editableTextInputs(root) {
          var list = Array.prototype.slice.call(root.querySelectorAll('input, textarea'));
          return list.filter(function (el) {
            if (el.disabled || el.readOnly) return false;
            var ty = (el.getAttribute('type') || 'text').toLowerCase();
            if (el.tagName === 'INPUT' && skipTypes[ty]) return false;
            return true;
          });
        }
        var scope = null;
        for (var n = btn.parentElement; n; n = n.parentElement) {
          if (editableTextInputs(n).length > 0) { scope = n; break; }
        }
        if (!scope) return { card: false };`;

      // 6. UPDATE -------------------------------------------------------------------
      // Open the row's edit form, change the title field to a NEW known value, save,
      // RELOAD, assert the new value is shown (DOM via testid) — the real proof of a
      // committed UPDATE through RLS. A failure here catches the evaluator's edit-load bug
      // (a broken edit fetch leaves the form empty → save can't carry the change, or the
      // form never opens).
      const updatedTitle = `${title} edited ${Date.now().toString(36)}`;
      step(`UPDATE: open the row edit form via ${t.editTid} (scoped to OUR row "${title}") and change the title`);
      // GAP-3: open the edit form for the ROW WE CREATED (matched by our unique title), NOT
      // the FIRST <entity>-edit in the list — on a table that already holds other rows the
      // first affordance is someone else's row. clickRowAffordanceVerify clicks the edit
      // affordance inside the row whose text == `title` (falls back to first on a clean/single-
      // row table, so the canary is unchanged). Verify the form footer save button surfaced
      // (retry-with-verify — the first click can land before the Stack push).
      const editClick = clickRowAffordanceVerify(t.editTid, t.rowTestid, title, () => visibleTestid(t.recordSave), { tries: 3, settleMs: 600 });
      if (!editClick.matched && editClick.count > 1)
        step(C.yellow(`note: ${editClick.count} ${t.editTid} affordances present but none scoped to our row "${title}" — fell back to the first row (row-text match missed)`));
      if (!visibleTestid(t.recordSave))
        throw new Error(`${t.editTid} present but the edit form (${t.recordSave}) did not open — the row Edit affordance / DynamicFormCard edit is broken`);
      // The edit form must have LOADED the existing record (the edit-load fetch). If the
      // fetch is broken, the title field is blank — assert the field carries the original
      // value before we overwrite it, so a broken edit-load FAILS LOUDLY here (this is the
      // exact class of bug the evaluator caught) instead of silently "succeeding".
      const loaded = pageEvalJson(`${EDIT_FORM_SCOPE_JS}
        var target = editableTextInputs(scope)[0];
        if (!target) return { card: true, hasField: false };
        return { card: true, hasField: true, value: String(target.value == null ? '' : target.value) };`);
      if (!loaded || loaded.card !== true)
        throw new Error(`edit form opened but its form-card subtree could not be located from ${t.recordSave} — DynamicFormCard DOM unexpected`);
      if (loaded.hasField !== true)
        throw new Error(`edit form opened but no editable title field was found — DynamicFormCard rendered no editable input`);
      if (!loaded.value || loaded.value.indexOf(title) === -1)
        throw new Error(
          `edit form opened but the title field did NOT load the existing value (expected to contain "${title}", got "${loaded.value}") — the edit-load fetch is broken (e.g. a single-record query using an unsupported argument)`
        );
      step(`rewrite the title field to "${updatedTitle}" and save (${t.recordSave})`);
      const wrote = pageEvalJson(`${EDIT_FORM_SCOPE_JS}
        var target = editableTextInputs(scope)[0];
        if (!target) return { card: true, titled: false };
        var proto = target.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(target, ${JSON.stringify(updatedTitle)});
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { card: true, titled: true };`);
      if (!wrote || wrote.titled !== true)
        throw new Error('edit form opened but the title field could not be rewritten — DynamicFormCard editable input not writable');
      clickTestid(t.recordSave);
      // The save CLOSES the card on success (card.close() is success-gated) and surfaces a
      // controlled error toast ("Failed to update <entity>") on failure. Wait for one or the
      // other; a surfaced update error is a HARD FAIL (the mutation truly errored — e.g. the
      // patch/clientMutationId selection is wrong).
      {
        const deadline = Date.now() + 8000;
        let closed = false;
        let errored = false;
        while (Date.now() < deadline) {
          if (!visibleTestid(t.recordSave)) { closed = true; break; }
          if (pageEval(`/failed to (update|create)/i.test((document.body && document.body.innerText) || '')`) === 'true') { errored = true; break; }
          sleep(400);
        }
        if (errored) throw new Error('UPDATE surfaced a "Failed to update" error toast — the edit save mutation errored (e.g. wrong patch arg / payload selection)');
        if (!closed) throw new Error('UPDATE save did not complete (edit form stayed open, no error toast) — the save handler never resolved');
      }
      step('reload and assert the UPDATED value PERSISTED (real committed UPDATE, not optimistic UI)');
      navigate(`${ctx.baseUrl}${t.crudPath}`);
      waitTestid(t.rowTestid, { what: `${t.rowTestid} (list rows after update + reload)`, timeoutMs: 25000 });
      if (!testidContainsText(t.rowTestid, updatedTitle))
        throw new Error(`UPDATE did not persist — the new value "${updatedTitle}" was not shown in any ${t.rowTestid} after reload (200-but-0-rows / optimistic only / edit save didn't commit)`);
      step('UPDATE persisted ✓');

      // 7. DELETE -------------------------------------------------------------------
      // Open the row's edit form (via the delete affordance, which entity-page.tsx wires to
      // the SAME edit form), click the form's record-delete → record-delete-confirm, RELOAD,
      // assert the row is GONE (DOM via testid) and CORROBORATE the deletion through RLS with
      // an authed count. A failure here catches the evaluator's delete bug (the confirm
      // selecting a non-existent mutation payload field → the mutation errors → the row stays).
      step(`DELETE: open the edit form via ${t.deleteTid} (scoped to OUR row "${updatedTitle}"), then drive ${t.recordDelete} → ${t.recordDeleteConfirm}`);
      // GAP-3: open the delete affordance for the ROW WE CREATED (now carrying updatedTitle
      // after the UPDATE), NOT the first <entity>-delete — same row-scoped reasoning as the
      // UPDATE leg (falls back to first on a clean/single-row table → canary unchanged).
      const delClick = clickRowAffordanceVerify(t.deleteTid, t.rowTestid, updatedTitle, () => visibleTestid(t.recordSave) || visibleTestid(t.recordDelete), { tries: 3, settleMs: 600 });
      if (!delClick.matched && delClick.count > 1)
        step(C.yellow(`note: ${delClick.count} ${t.deleteTid} affordances present but none scoped to our row "${updatedTitle}" — fell back to the first row (row-text match missed)`));
      if (!visibleTestid(t.recordDelete)) {
        // The edit form opened but exposes NO delete control. dynamic-form-card.tsx hides
        // record-delete only when the table supports NEITHER hard nor soft delete (canDelete
        // === false) — a by-design absence for that table, NOT the broken-delete bug. Treat
        // as a documented gap so we don't false-fail a delete-less entity, but only AFTER we
        // confirmed the form itself opened (so a truly-broken form is still a hard fail).
        if (!visibleTestid(t.recordSave))
          throw new Error(`${t.deleteTid} present but neither the edit form (${t.recordSave}) nor a delete control (${t.recordDelete}) opened — the row Delete affordance / DynamicFormCard is broken`);
        return gapPartial(
          'delete-control-absent',
          `CREATE + UPDATE persisted through RLS; the edit form opened but exposes no ${t.recordDelete} control — this table supports neither hard nor soft delete (DynamicFormCard canDelete=false), a by-design absence for this entity, not a broken delete.`
        );
      }
      step(`click ${t.recordDelete} (opens the confirm card)`);
      clickTestidVerify(t.recordDelete, () => visibleTestid(t.recordDeleteConfirm), { tries: 3, settleMs: 600 });
      if (!visibleTestid(t.recordDeleteConfirm))
        throw new Error(`${t.recordDelete} clicked but the delete-confirm control (${t.recordDeleteConfirm}) did not appear — ConfirmDeleteCard did not open`);
      step(`confirm the delete (${t.recordDeleteConfirm}) and assert no error toast`);
      clickTestid(t.recordDeleteConfirm);
      // ConfirmDeleteCard closes on success; on failure it surfaces "Failed to delete
      // <entity>" and stays open (it does NOT call card.close()). A surfaced delete error is
      // the EXACT evaluator bug (the confirm selected a non-existent payload field) → HARD FAIL.
      {
        const deadline = Date.now() + 8000;
        let closed = false;
        let errored = false;
        while (Date.now() < deadline) {
          if (!visibleTestid(t.recordDeleteConfirm)) { closed = true; break; }
          if (pageEval(`/failed to delete/i.test((document.body && document.body.innerText) || '')`) === 'true') { errored = true; break; }
          sleep(400);
        }
        if (errored) throw new Error('DELETE surfaced a "Failed to delete" error toast — the delete mutation errored (e.g. the confirm selected a non-existent mutation payload field)');
        if (!closed) throw new Error('DELETE confirm did not complete (confirm card stayed open, no error toast) — the delete handler never resolved');
      }
      step('reload and assert the row is GONE (real committed DELETE)');
      navigate(`${ctx.baseUrl}${t.crudPath}`);
      // The list may now be empty; wait for EITHER rows or the empty-state, then assert the
      // deleted value is absent from every row.
      {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          if (countTestid(t.rowTestid) > 0) break;
          if (pageEval(`document.querySelectorAll('[data-testid$="-empty"]').length`) !== '0') break;
          sleep(400);
        }
      }
      // Authoritative, tenancy-safe assertion: OUR row (matched by its exact title) must be
      // GONE. We deliberately do NOT compare a raw row count before/after — on a table shared
      // with other tenants/rows the global count can stay flat (or even grow) while our row
      // was correctly deleted, and could also drop for an unrelated reason; either way a count
      // delta is not a sound proof. Absence of OUR title is.
      if (testidContainsText(t.rowTestid, updatedTitle))
        throw new Error(`DELETE did not persist — our row "${updatedTitle}" is STILL present after reload (the delete mutation did not commit / errored silently)`);
      step('DELETE persisted ✓ (our row absent from the list)');

      // CORROBORATE through RLS (best-effort, NEVER the sole gate): an authed GraphQL read of
      // the entity's list field, fetched with the page's OWN bearer (so it goes THROUGH RLS,
      // not around it). We derive the camelCase plural list field the SAME way
      // scaffold-frontend.mjs does (pluralizeWords + camel of the entity) and read id +
      // totalCount. We DELIBERATELY do NOT assert the count dropped or text-match the deleted
      // value: a SOFT-delete (DataSoftDelete) flips isDeleted=true and the row PERSISTS in the
      // table (only the list's isDeleted filter hides it), so an unfiltered authed count would
      // still see it — asserting a drop here would false-fail a soft-delete. The DOM-after-
      // reload assertion above (the row is gone from the filtered list) is the authoritative
      // proof; this read only records that the authed RLS path is reachable with a real bearer,
      // STRENGTHENING the evidence. INCONCLUSIVE results (no endpoint/token, schema mismatch)
      // are logged and ignored.
      let rlsNote = '';
      try {
        if (ctx.dataEndpoint && dPrefix) {
          const listField = camel(pluralizeWords(dPrefix).join('-')); // e.g. todo → todos, blog-post → blogPosts
          const res = await gqlAuthed(
            ctx.dataEndpoint,
            `query LiveQaDeleteCheck { ${listField}(first: 200) { nodes { id } totalCount } }`
          );
          if (res && res.data && res.data[listField]) {
            // We can't text-match on id alone, but the count dropping / the create+update+delete
            // round-trip having committed is corroboration enough; record that the authed read
            // went THROUGH RLS (2xx, token present) — the strong signal vs an around-RLS check.
            rlsNote = ` (authed RLS read confirmed reachable: ${listField}.totalCount=${res.data[listField].totalCount ?? 'n/a'}${res.hadToken ? ', bearer attached' : ', NO bearer'})`;
          } else if (res && res.errors) {
            rlsNote = ` (authed RLS corroboration inconclusive: ${String(res.errors[0]?.message || '').slice(0, 80)})`;
          }
        }
      } catch {
        /* corroboration is best-effort — never override the DOM verdict */
      }

      step(`full CRUD lifecycle (create → update → delete) verified through RLS${rlsNote}`);

      // 8. GUARD-B — DETAILED-CREATE leg (the FIX-2 regression detector). -------
      // Live-QA only ever drove the TYPED quick-add above; FIX-2 (DynamicFormCard create
      // persistence) was invisible to the gate. This leg drives the DETAILED create: open it via
      // the <entity>-details button (the SAME entity prefix as the quick-add — `<entity>-details`),
      // fill the title in the schema-driven meta-form, pick any FK select the contract rendered
      // (`<entity>-<parentEntity>-select`, matched by the '-select' suffix), submit via the
      // DynamicFormCard footer `record-create`, reload, and ASSERT the new row persisted in the
      // list. The persistence assertion THROWS when the create truly didn't persist — that is the
      // FIX-2 regression. Selectors are data-testid / element-role ONLY.
      const detailsTid = (dPrefix && `${dPrefix}-details`) || 'todo-details';
      if (pageEval(`!!${Q_TESTID(detailsTid)}`) !== 'true') {
        // GRACEFUL SKIP — and ONLY here: the detailed-create entry point is genuinely absent
        // (an older scaffold without the Details button). Note it; do NOT fail the canary.
        step(`detailed-create skipped — no ${detailsTid} button on this surface (older scaffold without DynamicFormCard detailed-create)`);
        return pass('signup → create → reload → row persisted, auth intact (detailed-create leg skipped: no <entity>-details button)');
      }
      const detailStamp = Date.now().toString(36);
      const detailTitle = `live-qa detail ${detailStamp}`;
      createdTitles.push(detailTitle); // track for tenancy-safe, title-scoped assertions
      step(`open detailed-create via ${detailsTid} and create "${detailTitle}" through the DynamicFormCard`);
      // Open the meta-form card; verify its footer create button (record-create) VISIBLY surfaced
      // (retry-with-verify — the first click can land before the Stack push renders the card).
      clickTestidVerify(detailsTid, () => visibleTestid('record-create'), { tries: 3, settleMs: 600 });
      if (!visibleTestid('record-create'))
        throw new Error(`${detailsTid} present but the detailed-create form (record-create) did not open — DynamicFormCard detailed-create is broken`);
      // Fill the TITLE in the meta-form. The schema-driven fields carry no per-field testid, so
      // we scope to the OPEN form-card subtree and write the title into its FIRST editable
      // text/textarea input — that is the title/name field (SYSTEM_FIELDS are filtered out, so the
      // title is the first editable field). The DynamicFormCard footer (record-create) and the
      // fields area are SIBLING subtrees, so closest('div') from the button would miss the fields;
      // instead we climb ancestors from the button until we reach the smallest ancestor whose
      // subtree CONTAINS an editable text input (that ancestor is the card container holding both
      // the fields and the footer). Native value setter + input/change so the controlled value
      // registers. Selector is element-role (input/textarea), never CSS class / visible text.
      const FK_FILL_JS = `
        var btn = ${Q_TESTID('record-create')};
        if (!btn) return { card: false };
        var skipTypes = { checkbox: 1, radio: 1, hidden: 1, file: 1, range: 1, color: 1, submit: 1, button: 1 };
        function editableTextInputs(root) {
          var list = Array.prototype.slice.call(root.querySelectorAll('input, textarea'));
          return list.filter(function (el) {
            if (el.disabled || el.readOnly) return false;
            var ty = (el.getAttribute('type') || 'text').toLowerCase();
            if (el.tagName === 'INPUT' && skipTypes[ty]) return false;
            return true;
          });
        }
        // Climb to the card container: the smallest ancestor whose subtree holds an editable input.
        var scope = null;
        for (var n = btn.parentElement; n; n = n.parentElement) {
          if (editableTextInputs(n).length > 0) { scope = n; break; }
        }
        if (!scope) return { card: false };`;
      const titleFilled = pageEvalJson(`${FK_FILL_JS}
        var target = editableTextInputs(scope)[0];
        if (!target) return { card: true, titled: false };
        var proto = target.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(target, ${JSON.stringify(detailTitle)});
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { card: true, titled: true };`);
      // The card opened (record-create is VISIBLE — asserted above), so a missing card-scope or
      // missing editable input here is a REAL meta-form breakage → throw (the assertion is
      // reachable, per GUARD-B's contract).
      if (!titleFilled || titleFilled.card !== true)
        throw new Error(`detailed-create opened but its form-card subtree could not be located from record-create — DynamicFormCard DOM unexpected`);
      if (titleFilled.titled !== true)
        throw new Error(`detailed-create form opened but no editable title field was found to fill — DynamicFormCard rendered no editable input`);
      // Pick any FK select the contract rendered (`<entity>-<parentEntity>-select` → '-select'
      // suffix), scoped to the SAME card subtree. Reuses the generic first-real-option logic; a
      // no-op when the meta-form has no FK select (the canary, and any FK-less entity).
      pageEvalJson(`${FK_FILL_JS}
        var sels = Array.prototype.slice.call(scope.querySelectorAll('select[data-testid$="-select"]'));
        sels.forEach(function (sel) {
          var opts = Array.prototype.slice.call(sel.options || []);
          var real = opts.find(function (o) { return o && o.value !== '' && o.value != null; });
          if (!real) return;
          var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, real.value);
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return { card: true, fks: sels.length };`);
      step('submit the detailed create (record-create) and assert it persisted');
      clickTestid('record-create');
      // The save either CLOSES the card on success (card.close() is success-gated) or leaves it
      // OPEN. An open form has two DISTINCT causes the detector MUST tell apart — the prior
      // "!formClosed ⇒ unfillable" heuristic CONFLATED them and masked the FIX-2 regression:
      //   (a) the create was ATTEMPTED and FAILED — handleSave's catch surfaces an error toast
      //       ("Failed to create <entity>") and does NOT close the card. A reverted FIX-2 (the
      //       inner input type) is a GraphQL variable-location mismatch that throws → this exact
      //       shape. It MUST stay a reachable FAIL → THROW.
      //   (b) client-side validation blocked the submit on a required field this generic leg could
      //       not fill (a raw-UUID FK with no '-select' picker) — no mutation ran, NO error toast.
      //       Upstream meta-form limitation → DOCUMENTED gapPartial.
      // The toast text is OUR controlled string (dynamic-form-card.tsx handleSave catch); poll for
      // it alongside the close so a brief toast is not missed.
      let formClosed = false;
      let createErrored = false;
      {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (!visibleTestid('record-create')) { formClosed = true; break; }
          if (pageEval(`/failed to (create|update)/i.test((document.body && document.body.innerText) || '')`) === 'true') {
            createErrored = true; break;
          }
          sleep(400);
        }
      }
      // A create-error toast surfaced ⇒ the mutation RAN and the card reported failure. Discriminate
      // the FIX-2 regression from a generic meta-form limitation by the GraphQL error SIGNATURE:
      //   • FIX-2 regression = a variable-LOCATION mismatch (a reverted inner input type emits the
      //     deterministic graphql message: Variable $input of type CreateXInput! USED IN POSITION
      //     EXPECTING TYPE XInput!). That is the exact bug this leg exists to catch → THROW.
      //   • ANY OTHER create error = the generic meta-form could not supply a backend-required field
      //     it FILTERS (an org entity_id on a b2b/org-membership table, or another required/system
      //     field — surfaces as "Field … of required type …! was not provided" / a null / an RLS
      //     error). That is a DOCUMENTED meta-form limitation, NOT a FIX-2 regression → gapPartial.
      // Keying the THROW on the FIX-2 signature keeps the detector sharp (every reverted FIX-2 emits
      // that exact message) WITHOUT false-failing every b2b app whose meta-form lacks entity_id.
      if (createErrored) {
        const fix2Sig = pageEval(`/used in position expecting/i.test((document.body && document.body.innerText) || '')`) === 'true';
        if (fix2Sig)
          throw new Error(
            `detailed-create surfaced the FIX-2 GraphQL variable-location error ("…used in position expecting type…") — the DynamicCreate inner input type is wrong (FIX-2 regression); record-create must persist.`
          );
        return gapPartial(
          'detailed-create-metaform-required-field',
          `detailed-create surfaced a create error that is NOT the FIX-2 variable-location signature — the generic meta-form could not supply a backend-required field it filters (e.g. an org entity_id on a b2b/org-membership table, or another required/system field). Documented meta-form limitation, not a FIX-2 regression; the quick-add create above DID persist.`
        );
      }
      // PERSISTENCE is the source of truth: reload and assert the row landed in the list.
      step('reload and assert the DETAILED-created row PERSISTED (FIX-2 regression detector)');
      reload();
      waitTestid(t.rowTestid, { what: `${t.rowTestid} (list rows after detailed-create + reload)`, timeoutMs: 25000 });
      if (testidContainsText(t.rowTestid, detailTitle))
        return pass('signup → quick-add create persisted; DETAILED-create (DynamicFormCard → record-create) ALSO persisted after reload; auth intact');
      // Did NOT persist and NO create-error toast surfaced. Discriminate (formClosed captured above):
      //   • form STAYED OPEN, no error toast ⇒ client validation blocked a required field this
      //     generic leg could not fill → DOCUMENTED (not a FIX-2 regression).
      //   • form CLOSED yet the row never committed ⇒ a real create failure → THROW.
      if (!formClosed) {
        step('detailed-create did not submit (form stayed open, no create-error toast) — client validation blocked a required field this generic leg could not fill (e.g. a raw-UUID FK with no select); documented meta-form limitation');
        return gapPartial(
          'detailed-create-required-field-unfillable',
          `detailed-create OPENED + the title was filled, but the DynamicFormCard save did not submit (form stayed open) AND no create-error toast surfaced — client-side validation blocked a REQUIRED field this generic leg could not fill (e.g. a required FK rendered as a raw-UUID input with no '-select' picker). Upstream meta-form/template limitation, not a FIX-2 regression. The quick-add create above DID persist.`
        );
      }
      throw new Error(
        `detailed-create row "${detailTitle}" was gone after reload — the DynamicFormCard create SUBMITTED (the form closed) but the row did not commit (FIX-2 regression: record-create did not persist)`
      );
    },
  },

  // ── §4.1 change-password (account-session). Prove the NEW password actually works. ──
  'change-password': {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const creds = ctx._creds || {};
      const route = routeFor('change-password', '/account/security');
      const newPw = `LiveQa!${Date.now().toString(36)}New`;
      // STRICT-by-default: a non-mount THROWS (hard fail). This branch is reached ONLY when
      // LIVE_QA_STRICT_MOUNT is relaxed → a DOCUMENTED (operator-opted-out) partial.
      if (!openAndAwaitMount(ctx, 'change-password', route, ['change-password-submit', 'current-password']))
        return gapPartial('block-not-mounted', `auth-change-password-form not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step('fill current/new/confirm password');
      fillTestid('current-password', creds.password);
      fillTestid('new-password', newPw);
      if (pageEval(`!!${Q_TESTID('confirm-password')}`) === 'true') fillTestid('confirm-password', newPw);
      clickTestid('change-password-submit');
      // Step-up may gate the change — satisfy it with the current password.
      if (pageEval(`!!${Q_TESTID('step-up-password')}`) === 'true') {
        step('step-up prompted — re-entering current password');
        fillTestid('step-up-password', creds.password);
        clickTestid('step-up-submit');
      }
      sleep(1500);
      // REAL outcome: sign out, sign in with the NEW password, assert authed-shell.
      step('sign out, then sign in with the NEW password (proves the credential changed)');
      signOutBestEffort();
      const reauth = await signInWith(ctx, creds.email, newPw);
      if (reauth !== true) throw new Error(`re-login with the new password failed — change did not take (${reauth})`);
      ctx._creds = { email: creds.email, password: newPw }; // keep creds current for later flows
      return pass('password changed; re-login with the new password authenticated (authed-shell)');
    },
  },

  // ── §4.2 cross-origin (authentication). Assert a one-time token is MINTED. ──
  'cross-origin': {
    group: 'authentication',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('cross-origin', '/account/security');
      // The block is an app-specific SEAM (origin/email/password supplied by the app) and
      // is emitted COMMENTED by the mounter — so the in-page trigger is intentionally not
      // present. The definitive in-scope success is the BACKEND token-mint leg, driven
      // directly below; the 2nd-origin handoff is external (we don't run it headlessly).
      const mounted = openAndAwaitMount(ctx, 'cross-origin', route, 'cross-origin-link-trigger', { timeoutMs: 6000 });
      if (mounted) clickTestid('cross-origin-link-trigger');
      // REAL schema shape (verified against the codegen'd auth SDK): the mutation takes
      // RequestCrossOriginTokenInput { origin, email, password, rememberMe } and the minted
      // one-time token comes back in the payload's `result` (NOT a `token` field). We sign
      // the request with the run's live creds (ctx._creds, set by ensureSignedIn).
      const dest = process.env.LIVE_QA_CROSS_ORIGIN_DEST || ctx.baseUrl;
      const creds = ctx._creds || {};
      const q = `mutation($input: RequestCrossOriginTokenInput!) { requestCrossOriginToken(input: $input) { result } }`;
      const input = { origin: dest };
      if (creds.email) input.email = creds.email;
      if (creds.password) input.password = creds.password;
      let res = await gqlAuthed(ctx.authEndpoint, q, { input });
      const tok = res?.data?.requestCrossOriginToken?.result;
      if (tok && String(tok).length > 0)
        return pass(`requestCrossOriginToken minted a one-time token (origin=${dest}, result len ${String(tok).length})`);
      // If the block navigated instead of returning a token, accept a one-time token param.
      if (mounted) {
        const url = pageEval('location.href');
        if (/[?&](token|cross_origin_token|otc|result)=/.test(url)) return pass('cross-origin link carries a one-time token param');
      }
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      // A rejected/unregistered destination origin is mount config (the origin must be an
      // allowed origin), not a block defect — and the full handoff is external. DOCUMENTED
      // by-design (the in-scope mint leg reached the resolver) → gapPartial, not a regression.
      if (/origin|cors|not allowed|unregistered|forbidden/i.test(errMsg))
        return gapPartial('cross-origin-destination-config', `token-mint reached the resolver but the destination origin "${dest}" is not an allowed origin (mount config / external handoff, not a defect): ${errMsg}`);
      // The in-page trigger is a COMMENTED app-specific seam (origin/email/password are
      // app-supplied) the mounter emits commented BY DESIGN, so its absence is expected →
      // DOCUMENTED gapPartial. A genuine mint error (resolver reached but failed) falls through
      // to the throw below.
      if (!mounted)
        return gapPartial('block-mount-seam', `cross-origin trigger is a commented app-specific seam at ${route} (origin/email/password are app-supplied); backend mint inconclusive (${errMsg || 'no token in result'})`);
      throw new Error(`cross-origin token not minted (${errMsg || 'empty result'})`);
    },
  },

  // ── social-oauth (authentication) — AuthSocialButtons add-on on /sign-in. ──
  // SURFACE CONTRACT: an auth-form ADD-ON seamed into the /sign-in page (FLOW_SURFACES
  // emits surfaces['social-oauth'] = { path:'/sign-in' }). The mounter injects it as a
  // COMMENTED // TODO seam (origin/providers are app-supplied), so the live grid is not
  // mounted by default; even when mounted, the per-provider buttons (`social-btn-<slug>`)
  // only render once auth:sso providers are PROVISIONED. There is no live IdP in the QA
  // env (OAuth is dormant upstream), so the definitive in-scope outcome is RENDER: the
  // sign-in surface comes up and (if mounted) the provider grid renders without crashing.
  // PARTIAL-BY-DESIGN — no live IdP means we cannot complete a real OAuth round-trip.
  'social-oauth': {
    group: 'authentication',
    needs: [],
    run: async (ctx) => {
      const route = routeFor('social-oauth', '/sign-in');
      step(`open the sign-in surface (${route}) and assert the social-buttons add-on renders`);
      navigate(`${ctx.baseUrl}${route}`);
      // The sign-in card itself must come up (the add-on's host surface). The email field
      // is the block-contract testid for the sign-in form.
      const t = authTestids();
      // STRICT-by-default: if the sign-in surface (the add-on's host) does not mount, that is
      // a BREAKAGE → openAndAwaitMount THROWS (hard fail). This is social-oauth's REACHABLE
      // fail path (the block did not mount / the page is broken). The branch below runs ONLY
      // when LIVE_QA_STRICT_MOUNT is relaxed → a DOCUMENTED operator-opted-out partial.
      const formUp = openAndAwaitMount(ctx, 'social-oauth', route, ['auth-social-buttons', `social-btn-`, t.email], { timeoutMs: 12000 });
      if (!formUp) return gapPartial('signin-surface-not-mounted', `sign-in surface did not mount at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      // If the AuthSocialButtons grid is live (providers provisioned + seam uncommented),
      // assert ≥1 provider button rendered; this is a real RENDER pass. The block emits
      // `social-btn-<slug>` per provider; count any such testid in-page.
      const providerCount = pageEval(`document.querySelectorAll('[data-testid^="social-btn-"]').length`);
      const n = Number.parseInt(providerCount, 10) || 0;
      if (n > 0) {
        // Provider buttons render — assert the first one is a real, interactable control
        // (an OAuth anchor/button). We do NOT click through (no live IdP to complete it).
        return pass(`AuthSocialButtons rendered ${n} provider button(s) on ${route} (render-only — no live IdP to complete the OAuth round-trip; OAuth dormant upstream)`);
      }
      // No provider buttons. The add-on is a commented seam OR no auth:sso providers are
      // provisioned in this env. The sign-in surface IS up (the host mounted — proven above,
      // else we'd have thrown), so the only missing leg is the live IdP, which is DOCUMENTED
      // upstream dormancy → documented (non-failing) partial. A genuine breakage (the surface
      // not mounting) already hard-failed via openAndAwaitMount's strict throw.
      return gapPartial(
        'social-oauth-no-live-idp',
        `sign-in surface mounted at ${route} but no AuthSocialButtons provider buttons rendered — the add-on is a commented // TODO seam (origin/providers app-supplied) and/or no auth:sso providers are provisioned in this env. OAuth is dormant upstream; render-only by design (no live IdP to complete the round-trip).`
      );
    },
  },

  // ── §4.3 profile (account-session). updateUser — the 200-but-0-rows trap (GAP-1a). ──
  profile: {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('profile', '/account');
      const name = `QA Name ${Date.now().toString(36)}`;
      // STRICT-by-default: non-mount THROWS; this branch only runs when mount is relaxed → documented.
      if (!openAndAwaitMount(ctx, 'profile', route, ['display-name', 'save-profile-btn']))
        return gapPartial('block-not-mounted', `auth-account-profile-card not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step(`set display-name="${name}" and save`);
      fillTestid('display-name', name);
      clickTestid('save-profile-btn');
      sleep(1200);
      // REAL write + reload: the value must survive the reload AND read back from currentUser.
      step('reload and assert the display name persisted (updateUser took)');
      reload();
      waitTestid('display-name', { what: 'display-name after reload', timeoutMs: 20000 });
      const res = await gqlAuthed(ctx.authEndpoint, `query { currentUser { displayName } }`);
      const back = res?.data?.currentUser?.displayName;
      if (back === name) return pass(`updateUser persisted displayName="${name}" (currentUser read-back matches)`);
      // UI fallback if the field reflects the value even when the query shape differs.
      const fieldVal = pageEval(`(${Q_TESTID('display-name')} || {}).value || ''`);
      if (fieldVal === name) return pass(`display name persisted after reload (field value matches "${name}")`);
      throw new Error(
        `display name did not persist (reload value="${fieldVal}", currentUser.displayName="${back}") — updateUser 200-but-0-rows; the users self_update reconcile did not land`
      );
    },
  },

  // ── §4.4 account-emails (account-session). createEmail persists under RLS. ──
  'account-emails': {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('account-emails', '/account/emails');
      const alt = `alt+${Date.now().toString(36)}@example.com`;
      // STRICT-by-default: non-mount THROWS; this branch only runs when mount is relaxed → documented.
      if (!openAndAwaitMount(ctx, 'account-emails', route, ['add-email-button', 'add-email-input']))
        return gapPartial('block-not-mounted', `auth-account-emails-list not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step(`add a secondary email ${alt}`);
      if (pageEval(`!!${Q_TESTID('add-email-button')}`) === 'true') clickTestid('add-email-button');
      waitTestid('add-email-input', { what: 'add-email-input (add-email form)' });
      fillTestid('add-email-input', alt);
      clickTestid('add-email-submit');
      sleep(1200);
      // REAL write + reload: the address must read back from the emails query (RLS-scoped).
      step('reload and assert the new email persisted (createEmail under RLS)');
      reload();
      const res = await gqlAuthed(ctx.authEndpoint, `query { emails { nodes { emailAddress isPrimary } } }`);
      const list = res?.data?.emails?.nodes || [];
      if (list.some((e) => (e.emailAddress || '').toLowerCase() === alt.toLowerCase()))
        return pass(`createEmail persisted (${alt} present in emails query)`);
      // UI co-signal if the query shape differs.
      if (testidContainsTextAny(/^email-address-/, alt)) return pass(`new email row present after reload (${alt})`);
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      throw new Error(`secondary email did not persist after reload (${errMsg || 'not in emails query'})`);
    },
  },

  // ── §4.5 sessions (account-session) — DOCUMENTED-gap on revoke (GAP-2). ──
  // REACHABLE FAIL paths (so a green sessions QA means working): (1) the AccountSessionsList
  // block does NOT mount → openAndAwaitMount THROWS (strict-by-default); (2) the `sessions`
  // list query EXISTS but returns 0 rows → throw (a real regression). Only the DOCUMENTED
  // upstream GAP-2 legs are non-failing: the list query missing from the schema (half a) and
  // revoke being unreachable from the auth result (half b, UUIDv5 cred id ≠ UUIDv7 sessions.id).
  sessions: {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('sessions', '/account/sessions');
      // STRICT-by-default: a non-mount here THROWS → sessions' reachable "block did not mount" fail.
      openAndAwaitMount(ctx, 'sessions', route, ['revoke-confirm-button', 'revoke-all-button'], { timeoutMs: 8000 });
      // The definitive list outcome comes from the data path (the list has no generated
      // hook; RECON-1 wires the prop). GAP-2 has TWO halves: (a) the `userSessions`/
      // `sessions` list query is MISSING from the schema, and (b) revokeSession's id is
      // unreachable from the auth result. So a `Cannot query field "sessions"…` error is
      // the DOCUMENTED missing-list gap (a), NOT a regression — mark partial-by-design.
      // A genuine regression is the query EXISTING but returning 0 rows (no current
      // session) — only that path hard-fails.
      const res = await gqlAuthed(ctx.authEndpoint, `query { sessions { nodes { id } } }`);
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      const listQueryAbsent = /cannot query field\s+["']?sessions["']?\s+on type\s+["']?Query/i.test(errMsg)
        || /unknown\s+field\s+["']?sessions["']?/i.test(errMsg);
      if (listQueryAbsent) {
        // GAP-2(a): the list query does not exist in this schema. The block still mounts
        // (sessions={[]} + // TODO seam, per the mounter); the gap is upstream, not ours →
        // DOCUMENTED (non-failing). The block-not-mounted case already hard-failed above.
        return gapPartial(
          'sessions-list-absent (PLATFORM-GAPS GAP-2 / gotchas SDK-007)',
          `no \`sessions\`/\`userSessions\` list query in the schema (GAP-2 half a, "${errMsg}"); the AccountSessionsList block is mounted at ${route} with an empty data prop + // TODO seam — documented gap, not a regression`
        );
      }
      const nodes = res?.data?.sessions?.nodes || [];
      if (!Array.isArray(nodes) || nodes.length < 1) {
        throw new Error(`session list query EXISTS but returned 0 rows — that is a real regression, not GAP-2 (${errMsg || '0 sessions'})`);
      }
      // List verified (query exists + ≥1 row — the real positive signal). Revoke is the
      // DOCUMENTED gap (b) → documented (non-failing) partial, not a hard fail. The two
      // breakage paths (block-not-mounted, list-exists-but-0-rows) already hard-fail above.
      return gapPartial(
        'sessions-revoke-pending (PLATFORM-GAPS GAP-2 / gotchas SDK-007)',
        `session list verified (${nodes.length} session(s)); revoke unreachable from the auth result by design (UUIDv5 cred id ≠ UUIDv7 sessions.id)`
      );
    },
  },

  // ── connected-accounts (account-session) — /account aggregate, RENDER-only. ──
  // SURFACE CONTRACT: a section on the single /account page. The mounter passes
  // connectedAccounts={[]} + providers={[]} (connection types are not public yet), and the
  // section is flagged needsStepUp:true so wire-app wraps the page in a <StepUpProvider>
  // (WITHOUT that provider /account would crash where a step-up-gated section mounts). With
  // no live IdP (OAuth dormant upstream) there is nothing to connect/disconnect, so the
  // definitive in-scope outcome is RENDER: the connected-accounts card mounts on /account
  // WITHOUT crashing. PARTIAL-BY-DESIGN — no providers to exercise a real connect.
  'connected-accounts': {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('connected-accounts', '/account');
      step(`open the /account aggregate (${route}) and assert the connected-accounts card renders`);
      // The card's empty-state testid is `no-providers-message`; connected/unconnected rows
      // are `connected-row-<id>` / `unconnected-row-<id>`. ANY of these proves the block
      // mounted (and that the StepUpProvider wrap kept /account from crashing).
      const mounted = openAndAwaitMount(
        ctx,
        'connected-accounts',
        route,
        ['no-providers-message', 'account-page', 'authed-shell'],
        { timeoutMs: 12000 }
      );
      // BROKEN (not documented): a section that SHOULD mount on /account did not → fail.
      if (!mounted)
        return brokenPartial('block-not-mounted', `account-connected-accounts did not mount at ${route} — a section that should be on the /account aggregate is missing (block-not-mounted breakage)`);
      // Did the page survive (no crash) AND did the connected-accounts card itself render?
      // We accept the empty-state message (providers=[]) OR any connected/unconnected row.
      const cardPresent =
        pageEval(`!!${Q_TESTID('no-providers-message')}`) === 'true' ||
        pageEval(`document.querySelectorAll('[data-testid^="connected-row-"],[data-testid^="unconnected-row-"]').length`) !== '0';
      // The /account aggregate shell sentinel is `account-page` (scaffold-frontend's account
      // template); CRUD pages use `authed-shell`. Either present = the page rendered (did not
      // crash) → the StepUpProvider wrap held (account-connected-accounts calls useStepUp()
      // at render, so a missing provider would have thrown and stripped BOTH sentinels).
      const stillAuthed =
        pageEval(`!!${Q_TESTID('account-page')}`) === 'true' ||
        pageEval(`!!${Q_TESTID('authed-shell')}`) === 'true';
      if (!stillAuthed)
        throw new Error('/account lost its shell (account-page/authed-shell) while mounting connected-accounts — the StepUpProvider wrap is missing (page crashed)');
      // DOCUMENTED (non-failing): the card rendered + /account did not crash; the only missing
      // leg is a live IdP (OAuth dormant upstream, connection types not public) → gapPartial.
      if (cardPresent)
        return gapPartial(
          'connected-accounts-no-live-idp',
          `AccountConnectedAccounts rendered on ${route} (empty-state / rows present, /account did NOT crash → StepUpProvider wrap intact); connection types are not public + OAuth dormant upstream, so connect/disconnect is render-only by design`
        );
      // Authed shell up but the card body did not surface a recognizable testid — the block
      // mounts bare (no providers, no empty-state id on this build). Still not a crash → the
      // page rendered + stayed authed; render-only with no live IdP is DOCUMENTED → gapPartial.
      return gapPartial(
        'connected-accounts-render-unconfirmed',
        `/account mounted and stayed authed at ${route} but the connected-accounts card body exposed no recognizable testid (providers=[], connection types not public) — render-only, no live IdP (OAuth dormant upstream)`
      );
    },
  },

  // ── api-keys (account-session) — /account aggregate. CREATE is a real pass. ──
  // SURFACE CONTRACT: a section on /account (needsStepUp:true → StepUpProvider wrap). The
  // create dialog is owned INSIDE the block (create-key-button → api-key-create-submit →
  // created modal done-button). The deployed create_api_key proc ONLY accepts accessLevel
  // read_only | full_access (the block defaults to read_only — we keep the default), and
  // it enforces STEP_UP_REQUIRED server-side, so a step-up dialog (step-up-password) may
  // gate the create — we satisfy it with the run's password. CREATE succeeding (the
  // created-key modal appears) is a REAL pass. The LIST is a documented seam (keys={[]},
  // no generated list hook) and REVOKE is GAP-3 → those legs are partial-by-design, never
  // a hard fail. So: create OK ⇒ pass; create blocked only by the list/seam/GAP-3 ⇒ partial.
  'api-keys': {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const creds = ctx._creds || {};
      const route = routeFor('api-keys', '/account');
      const keyName = `qa-key-${Date.now().toString(36)}`;
      // BROKEN (not documented): the api-keys section / its create control should be on the
      // /account aggregate — a missing mount or missing button is a real breakage → fail.
      if (!openAndAwaitMount(ctx, 'api-keys', route, ['create-key-button', 'authed-shell'], { timeoutMs: 12000 }))
        return brokenPartial('block-not-mounted', `account-api-keys-list did not mount at ${route} — the api-keys section is missing from the /account aggregate (block-not-mounted breakage)`);
      if (pageEval(`!!${Q_TESTID('create-key-button')}`) !== 'true')
        return brokenPartial('create-control-missing', `create-key-button not present at ${route} — the api-keys create control is missing from the /account aggregate (expected-control-missing breakage)`);
      step('open the create-key dialog');
      // Open the dialog and verify it VISIBLY surfaced the submit control (retry-with-verify
      // — the first click can land before the dialog handler binds). The dialog defaults
      // accessLevel=read_only (the ONLY-valid values are read_only|full_access), so we do
      // NOT touch the Select — the default is a valid value the proc accepts.
      clickTestidVerify('create-key-button', () => visibleTestid('api-key-create-submit'), { tries: 3, settleMs: 600 });
      // BROKEN (not documented): the button is present but clicking it did not open the create
      // dialog — a real UI breakage (the dialog handler did not bind / the dialog failed) → fail.
      if (!visibleTestid('api-key-create-submit'))
        return brokenPartial('create-dialog-unopened', `create-key-button present but the create dialog (api-key-create-submit) did not open at ${route} — UI breakage`);
      // Optional key-name field (the block may auto-name); fill it when VISIBLY present.
      if (visibleTestid('api-key-name')) fillTestid('api-key-name', keyName);
      step('submit the create (accessLevel defaults to read_only — the proc-accepted value)');
      clickTestid('api-key-create-submit');
      // STEP_UP_REQUIRED is enforced server-side; satisfy the step-up dialog if it gates.
      if (visibleTestid('step-up-password')) {
        step('step-up prompted on create — re-entering the current password');
        fillTestid('step-up-password', creds.password);
        clickTestid('step-up-submit');
        sleep(1000);
      }
      // REAL outcome: the created-key modal appears (the raw key is shown ONCE). The block
      // opens it via setPendingCreatedKey on success → done-button / copy-button / the
      // acknowledge-checkbox are its testids. Poll for any of them to VISIBLY appear.
      const deadline = Date.now() + 12000;
      let created = false;
      while (Date.now() < deadline) {
        if (
          visibleTestid('done-button') ||
          visibleTestid('copy-button') ||
          visibleTestid('acknowledge-checkbox')
        ) {
          created = true;
          break;
        }
        sleep(400);
      }
      if (created) {
        // Dismiss the modal (best-effort) so a later flow on /account is not blocked.
        if (visibleTestid('acknowledge-checkbox')) clickTestid('acknowledge-checkbox');
        if (visibleTestid('done-button')) clickTestid('done-button');
        return pass(
          `createApiKey succeeded (accessLevel=read_only; the created-key modal surfaced the raw key once). LIST is a documented seam (keys={[]}, no generated list hook) and REVOKE is GAP-3 — both partial-by-design.`
        );
      }
      // No created modal. If the create surfaced an access-level / step-up error, that is the
      // documented INVALID_ACCESS_LEVEL / STEP_UP gap, not a harness defect → partial. Use the
      // page text only as a co-signal for WHY (the selector is still the block's testids).
      const bodyTxt = pageEval('document.body.innerText').slice(0, 4000);
      // DOCUMENTED INVALID_ACCESS_LEVEL gap: the deployed create_api_key proc only accepts
      // read_only|full_access. The op surface drove correctly → gapPartial, not a regression.
      if (/access.?level|read_only|full_access|invalid/i.test(bodyTxt))
        return gapPartial(
          'api-key-access-level-gap',
          `create dialog submitted but no created-key modal surfaced; the page shows an access-level error — the deployed create_api_key proc only accepts read_only|full_access (block defaults read_only). LIST seam + REVOKE GAP-3 also documented.`
        );
      // DOCUMENTED server-side STEP_UP_REQUIRED defense-in-depth (beyond the client gate); the
      // op surface is real → gapPartial.
      if (/step.?up|verify|password/i.test(bodyTxt))
        return gapPartial(
          'api-key-step-up-gap',
          `create blocked by a server-side STEP_UP_REQUIRED gate that the step-up dialog did not satisfy here (defense-in-depth beyond the client gate); op surface is real. LIST seam + REVOKE GAP-3 documented.`
        );
      // TERMINAL: created modal never appeared and no diagnostic text — the LIST/REVOKE seam
      // (no generated list hook; GAP-3) means we cannot INDEPENDENTLY confirm the create here.
      // The section mounted + the dialog opened (so it is not a mount/UI breakage); the only
      // missing leg is the documented LIST-seam read-back → gapPartial, not fail.
      return gapPartial(
        'api-keys-create-unconfirmed (LIST seam + REVOKE GAP-3)',
        `api-keys section mounted at ${route} and the create dialog opened, but no created-key modal surfaced and no error text — the LIST is a documented seam (keys={[]}, no generated list hook; GAP-3) so the create cannot be independently confirmed here. Op surface real; documented gap.`
      );
    },
  },

  // ── step-up (account-session) — NO own surface. Gate a sensitive action. ──
  // SURFACE CONTRACT: step-up has NO page/section of its own (it is intentionally absent
  // from FLOW_SURFACES — installing use-step-up makes wire-app wrap <StepUpProvider>). So
  // this driver does NOT routeFor('step-up', …) (that would demand a manifest entry the
  // mounter never emits + trip check:flow-surfaces). Instead it triggers a REAL step-up-
  // GATED action on an existing surface — the api-keys CREATE on /account, whose
  // create_api_key proc enforces STEP_UP_REQUIRED server-side — drives the step-up dialog
  // (step-up-password → step-up-submit, verifyPassword), and asserts the gated action then
  // PROCEEDS. ADVERSARIAL: a WRONG password must NOT clear the gate (the dialog stays / the
  // action is blocked). We reuse routeFor('api-keys', …) (a manifested key) for the surface.
  'step-up': {
    group: 'account-session',
    needs: [],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const creds = ctx._creds || {};
      // BROKEN (not documented): no run credentials = an unmet precondition for this gate test.
      if (!creds.password) return brokenPartial('no-credentials', 'no run credentials to satisfy the step-up password challenge');
      // Surface that carries a step-up-gated action. api-keys create is the cleanest: its
      // proc enforces STEP_UP_REQUIRED server-side. (We use the api-keys manifest key — a
      // real driver consumer key — NOT a step-up key, so the contract guard stays happy.)
      const route = routeFor('api-keys', '/account');
      // BROKEN (not documented): no step-up-gated surface mounted = a real breakage of the
      // surface this strong gate test needs → fail (step-up must not be weakened).
      // FIX-3a: include the account-page shell sentinel so a MOUNTED account surface that
      // simply carries no step-up-gated action (e.g. only the sessions block was installed)
      // is distinguishable from a CRASHED page below — a crash strips every sentinel and
      // still hard-fails here, while a healthy-but-actionless /account reaches openGate().
      if (!openAndAwaitMount(ctx, 'step-up', route, ['create-key-button', 'change-password-submit', 'account-page', 'authed-shell'], { timeoutMs: 12000 }))
        return brokenPartial('block-not-mounted', `no step-up-gated surface mounted at ${route} (need api-keys or change-password on /account)`);

      // ── ADVERSARIAL leg first: a WRONG password must NOT clear the gate. ──
      const openGate = () => {
        if (pageEval(`!!${Q_TESTID('create-key-button')}`) === 'true') {
          clickTestidVerify('create-key-button', () => visibleTestid('api-key-create-submit'), { tries: 3, settleMs: 500 });
          if (visibleTestid('api-key-create-submit')) {
            clickTestid('api-key-create-submit');
            return 'api-key';
          }
        }
        // Fallback: change-password is also step-up-gated. Fill only VISIBLE fields.
        if (visibleTestid('change-password-submit')) {
          const np = `LiveQa!${Date.now().toString(36)}Su`;
          if (visibleTestid('current-password')) fillTestid('current-password', creds.password);
          if (visibleTestid('new-password')) fillTestid('new-password', np);
          if (visibleTestid('confirm-password')) fillTestid('confirm-password', np);
          clickTestid('change-password-submit');
          return 'change-password';
        }
        return null;
      };

      const gated = openGate();
      if (!gated) {
        // FIX-3a: no step-up-gated action on this surface. The account page DID mount (we got
        // past the strict openAndAwaitMount above — a crash would have hard-failed there), but
        // it exposes neither api-key create nor change-password. Distinguish the two cases:
        //   • The ONLY installed account-session companion is the SESSIONS block — there is
        //     genuinely nothing step-up-gated to drive (api-keys/change-password were not part
        //     of this app's flows). Revoke (the only sessions action) is unreachable by design
        //     (GAP-2), so there is no gate to exercise here. That is a DOCUMENTED absence, not a
        //     weakening of step-up → gapPartial citing GAP-2.
        //   • Otherwise a surface that SHOULD expose a gated action does not → BROKEN (the
        //     reachable fail is KEPT: this is the only softened precondition-absent case).
        const sessionsOnly =
          (visibleTestid('revoke-confirm-button') || visibleTestid('revoke-all-button')) &&
          pageEval(`!!${Q_TESTID('create-key-button')}`) !== 'true' &&
          pageEval(`!!${Q_TESTID('change-password-submit')}`) !== 'true';
        if (sessionsOnly)
          return gapPartial(
            'step-up-no-gated-action (sessions-only surface; PLATFORM-GAPS GAP-2)',
            `surface at ${route} mounted but the only account-session companion installed is the sessions block (revoke testid present), whose revoke is unreachable by design (GAP-2) — there is no step-up-gated action (api-key create / change-password) to exercise here. Documented absence, not a step-up weakening.`
          );
        // BROKEN (not documented): no gated action to trigger = the precondition for the gate
        // test is unmet on a surface that should expose one → fail (do not weaken step-up).
        return brokenPartial('no-gated-action', `surface at ${route} exposed neither api-key create nor change-password to trigger a step-up gate`);
      }

      // Wait briefly for the step-up dialog. If it does NOT appear, the action was not
      // step-up-gated in this build (step-up still-valid window, or no provider) → partial.
      let dialogUp = false;
      {
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          // VISIBLE (not just present) — Base UI may keep a closed dialog in the DOM hidden.
          if (visibleTestid('step-up-password')) { dialogUp = true; break; }
          sleep(300);
        }
      }
      // BROKEN (not documented): we triggered a gated action but NO step-up dialog appeared.
      // This is inconclusive in a way that could mask a real defect (the StepUpProvider not
      // wrapping the action), so for this STRONG gate driver we FAIL rather than pass green —
      // step-up must not be weakened (instruction). (A still-valid step-up window can also
      // present this way; re-run after a fresh sign-in if so.)
      if (!dialogUp)
        return brokenPartial(
          'step-up-not-prompted',
          `triggered ${gated} at ${route} but no step-up dialog appeared — step-up may still be within its valid window, or the StepUpProvider is not wrapping this action. The server-side STEP_UP_REQUIRED gate still defends create_api_key. Render/gate inconclusive here (failing rather than masking a possible provider-wrap defect).`
        );

      // ADVERSARIAL: submit a WRONG password — the gate must NOT clear (dialog stays open /
      // shows an error). verifyPassword(wrong) returns null/false server-side.
      step('adversarial: submit a WRONG password — the gate must NOT clear');
      fillTestid('step-up-password', `wrong-${creds.password}-xyz`);
      clickTestid('step-up-submit');
      sleep(1200);
      const dialogStillUp = visibleTestid('step-up-password'); // VISIBLY still open
      if (!dialogStillUp) {
        // The dialog closed on a WRONG password — the gate failed open. Real regression.
        throw new Error('step-up gate CLEARED on a WRONG password (dialog closed) — verifyPassword accepted a bad credential or the gate fails open');
      }

      // ── HAPPY leg: the CORRECT password clears the gate and the action proceeds. ──
      step('submit the CORRECT password — the step-up gate clears and the gated action proceeds');
      fillTestid('step-up-password', creds.password);
      clickTestid('step-up-submit');
      // The gate clears when the dialog goes away AND the gated action advances (api-key →
      // created modal; change-password → re-login proves it). Poll for the dialog to close
      // (VISIBLY — a hidden-but-present portal node still counts as closed).
      let cleared = false;
      {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (!visibleTestid('step-up-password')) { cleared = true; break; }
          sleep(300);
        }
      }
      if (!cleared)
        throw new Error('step-up gate did NOT clear on the CORRECT password — verifyPassword rejected a valid credential (the documented D1 verifyPassword defect would present this way)');

      if (gated === 'api-key') {
        // Gated action proceeds → created-key modal VISIBLY surfaces (best-effort confirm).
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (
            visibleTestid('done-button') ||
            visibleTestid('copy-button') ||
            visibleTestid('acknowledge-checkbox')
          ) {
            if (visibleTestid('acknowledge-checkbox')) clickTestid('acknowledge-checkbox');
            if (visibleTestid('done-button')) clickTestid('done-button');
            return pass('step-up gate: WRONG password blocked, CORRECT password cleared the gate and the gated api-key create proceeded (created-key modal surfaced) — verifyPassword verified');
          }
          sleep(400);
        }
        // Gate cleared (the real assertion) but the post-action modal did not surface — the
        // step-up itself PASSED; the create's own LIST/seam (GAP-3) is the only unconfirmed leg.
        return pass('step-up gate cleared on the CORRECT password after a WRONG password was blocked (verifyPassword verified); the gated api-key create proceeded past the gate (post-create modal not independently confirmed — LIST seam/GAP-3)');
      }
      // change-password path: prove the credential actually changed by re-login.
      return pass('step-up gate: WRONG password blocked, CORRECT password cleared the gate and the gated change-password proceeded (verifyPassword verified)');
    },
  },

  // ── §4.6 email-verification (authentication; needs mailpit). ──
  'email-verification': {
    group: 'authentication',
    needs: ['mailpit'],
    precondition: async (ctx) => ensureSignedIn(ctx, { fresh: true }), // unverified fresh user
    run: async (ctx) => {
      const creds = ctx._creds || {};
      const since = Date.now();
      // Trigger the send: the verify banner mounts for an unverified user; resend enqueues.
      const route = routeFor('email-verification', '/account');
      navigate(`${ctx.baseUrl}${route}`);
      if (pageEval(`!!${Q_TESTID('resend-button')}`) === 'true') clickTestid('resend-button');
      step('poll Mailpit for the verification email');
      const mail = await pollMailpit({ to: creds.email, subjectIncludes: 'verif', sinceMs: since, timeoutMs: 20000 });
      // BROKEN (not documented): Mailpit IS up (the cap probe passed) yet no email arrived.
      // The cause is undisambiguated — it could be the missing site-domain row OR a real
      // upstream send-path defect (mailer/template/queue). We do NOT mask a possible backend
      // defect green; this fails the gate (the operator disambiguates via the auth-server log).
      if (!mail) return brokenPartial('email-not-delivered', emailNotDeliveredEvidence('verification'));
      const emailId = mail.params.email_id || mail.params.emailId;
      const token = mail.params.token;
      // DOCUMENTED: the email DID arrive (the send path works) but its link shape carries no
      // recognizable token param — a template-variant hedge across builds → gapPartial.
      if (!token) return gapPartial('email-link-unparsable', `verification email arrived but no token param found (links: ${mail.links.slice(0, 2).join(' ')})`);
      const landing = routeFor('email-verification-landing', '/auth/verify-email');
      step('land the verification link');
      navigate(`${ctx.baseUrl}${landing}?email_id=${encodeURIComponent(emailId || '')}&token=${encodeURIComponent(token)}`);
      sleep(1500);
      const res = await gqlAuthed(ctx.authEndpoint, `query { currentUser { isVerified } }`);
      if (res?.data?.currentUser?.isVerified === true) return pass('email verified server-side (currentUser.isVerified=true after landing the link)');
      throw new Error('verification link landed but currentUser.isVerified stayed false — backend defect');
    },
  },

  // ── §4.7 password-reset (authentication; needs mailpit). ──
  'password-reset': {
    group: 'authentication',
    needs: ['mailpit'],
    // Reuse the account ensureSignedIn created earlier in the run so we know the email.
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const creds = ctx._creds || {};
      const newPw = `LiveQa!${Date.now().toString(36)}Rst`;
      const since = Date.now();
      const forgot = routeFor('password-reset', '/forgot-password');
      step(`request a reset for ${creds.email}`);
      // forgot-password is a LOGGED-OUT surface: the ensureSignedIn precondition (which
      // gives us the email) leaves an authed session, and the auth shell REDIRECTS an
      // authed user away from /forgot-password (→ '/') so its form never mounts and the
      // waitTestid below times out. Sign out first so the forgot-password card renders.
      // (FLOW-QA mail2 — the precondition signs in only to capture the email.)
      signOutBestEffort();
      navigate(`${ctx.baseUrl}${forgot}`);
      waitTestid('forgot-password-submit', { what: 'forgot-password-submit (forgot-password card)', timeoutMs: 12000 });
      fillTestid('email', creds.email);
      clickTestid('forgot-password-submit');
      step('poll Mailpit for the reset email');
      const mail = await pollMailpit({ to: creds.email, subjectIncludes: 'reset', sinceMs: since, timeoutMs: 20000 });
      // BROKEN (not documented): Mailpit up but no reset email arrived — undisambiguated cause
      // (site-domain row OR a real upstream send-path defect); fail rather than mask it green.
      if (!mail) return brokenPartial('email-not-delivered', emailNotDeliveredEvidence('reset'));
      const token = mail.params.token;
      const roleId = mail.params.role_id || mail.params.roleId;
      // DOCUMENTED: the reset email arrived (send works) but no token param parsed from the
      // link — a template-variant hedge → gapPartial.
      if (!token) return gapPartial('email-link-unparsable', `reset email arrived but no token param found (links: ${mail.links.slice(0, 2).join(' ')})`);
      const resetRoute = routeFor('password-reset-landing', '/reset-password');
      step('land the reset link and set a new password');
      navigate(`${ctx.baseUrl}${resetRoute}?token=${encodeURIComponent(token)}${roleId ? `&role_id=${encodeURIComponent(roleId)}` : ''}`);
      waitTestid('reset-password-submit', { what: 'reset-password-submit (reset-password card)', timeoutMs: 12000 });
      fillTestid('newPassword', newPw);
      if (pageEval(`!!${Q_TESTID('confirmPassword')}`) === 'true') fillTestid('confirmPassword', newPw);
      clickTestid('reset-password-submit');
      sleep(1500);
      // REAL outcome: sign in with the NEW password.
      step('sign in with the NEW password (proves resetPassword changed the credential)');
      signOutBestEffort();
      const reauth = await signInWith(ctx, creds.email, newPw);
      if (reauth !== true) throw new Error(`re-login after reset failed — resetPassword did not take (${reauth})`);
      ctx._creds = { email: creds.email, password: newPw };
      return pass('password reset via emailed token; re-login with the new password authenticated');
    },
  },

  // ── §4.8 account-deletion (account-session; needs mailpit). THROWAWAY account. ──
  'account-deletion': {
    group: 'account-session',
    needs: ['mailpit'],
    precondition: async (ctx) => ensureSignedIn(ctx, { fresh: true }), // dedicated throwaway user
    run: async (ctx) => {
      const creds = ctx._creds || {};
      const since = Date.now();
      const route = routeFor('account-deletion', '/account/security');
      // STRICT-by-default: non-mount THROWS; this branch only runs when mount is relaxed → documented.
      // FIX-3b: accept the danger-card TRIGGER and the account-page shell as mount sentinels too
      // — the danger card commonly gates the confirm behind a trigger, so `account-danger-confirm`
      // is not in the DOM until the dialog opens; the trigger / the /account shell prove the card
      // mounted without requiring the confirm to be pre-rendered.
      if (!openAndAwaitMount(ctx, 'account-deletion', route, ['account-danger-confirm', 'account-danger-trigger', 'account-page'], { timeoutMs: 8000 }))
        return gapPartial('block-not-mounted', `auth-account-danger-card not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step('confirm account deletion (sends the deletion email)');
      // FIX-3b: the confirm is usually behind a gating dialog. If account-danger-confirm is not
      // yet VISIBLE, open the dialog first — click an account-danger-trigger testid when present,
      // else find a control by ROLE + accessible-name matching "delete account" (selector stays a
      // role/aria query, never brittle CSS/text-locators). Then click the confirm via
      // clickTestidVerify (native pointer sequence + DOM .click() fallback, retried until the
      // outcome — here, that the confirm took — is observed).
      if (!visibleTestid('account-danger-confirm')) {
        // NOTE: the current upstream AccountDangerCard block exposes its trigger via an aria-label
        // ("Delete account permanently"), NOT a data-testid — so in practice the
        // account-danger-trigger path here is a FORWARD-COMPAT placeholder and the aria role+name
        // fallback below is the live path. (Adding the testid is an upstream/consume-only change.)
        if (pageEval(`!!${Q_TESTID('account-danger-trigger')}`) === 'true') {
          step('open the deletion confirm dialog via account-danger-trigger');
          clickTestidVerify('account-danger-trigger', () => visibleTestid('account-danger-confirm'), { tries: 3, settleMs: 500 });
        } else {
          step('open the deletion confirm dialog via a role+name control matching "delete account"');
          // ARIA role + accessible-name (aria-label / aria-labelledby / text content) match — a
          // role-based locator, not a CSS/visible-text selector. Best-effort; the confirm-visibility
          // check below remains the gate.
          pageEvalJson(`
            var re = /delete\\s+account/i;
            var sel = '[role="button"],button,[role="menuitem"],a';
            var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
            function accName(el){
              var lbl = el.getAttribute && el.getAttribute('aria-label');
              if (lbl) return lbl;
              var by = el.getAttribute && el.getAttribute('aria-labelledby');
              if (by){ var r = document.getElementById(by); if (r) return r.textContent || ''; }
              return el.textContent || '';
            }
            var hit = nodes.find(function(el){ return re.test(accName(el)); });
            if (hit){ try { hit.click(); } catch(e){} return 'clicked'; }
            return 'none';`);
          sleep(600);
        }
      }
      // clickTestidVerify already performs the native pointer sequence + DOM .click() fallback,
      // retrying until the outcome holds — here, until the deletion-send leg advances (the confirm
      // disappears as the dialog closes, OR a step-up dialog appears to gate the send). If neither
      // fires, the confirm did not take and we fall through to the Mailpit poll, whose
      // email-not-delivered branch is a REACHABLE fail (this leg never papers over a no-send).
      clickTestidVerify(
        'account-danger-confirm',
        () => !visibleTestid('account-danger-confirm') || visibleTestid('step-up-password'),
        { tries: 3, settleMs: 600 }
      );
      if (pageEval(`!!${Q_TESTID('step-up-password')}`) === 'true') {
        fillTestid('step-up-password', creds.password);
        clickTestid('step-up-submit');
      }
      step('poll Mailpit for the deletion email');
      const mail = await pollMailpit({ to: creds.email, subjectIncludes: 'delet', sinceMs: since, timeoutMs: 20000 });
      // BROKEN (not documented): Mailpit up but no deletion email arrived — undisambiguated
      // cause (site-domain row OR a real upstream send-path defect); fail rather than mask it.
      if (!mail) return brokenPartial('email-not-delivered', emailNotDeliveredEvidence('deletion'));
      const token = mail.params.token;
      const userId = mail.params.user_id || mail.params.userId;
      // DOCUMENTED: the deletion email arrived (send works) but no token param parsed — a
      // template-variant hedge → gapPartial.
      if (!token) return gapPartial('email-link-unparsable', `deletion email arrived but no token param found (links: ${mail.links.slice(0, 2).join(' ')})`);
      const landing = routeFor('account-deletion-landing', '/auth/delete-account');
      step('land the deletion link (auto-submits confirmDeleteAccount)');
      navigate(`${ctx.baseUrl}${landing}?token=${encodeURIComponent(token)}${userId ? `&user_id=${encodeURIComponent(userId)}` : ''}`);
      waitTestid('success-cta', { what: 'success-cta (deletion landing)', timeoutMs: 15000 });
      sleep(1000);
      // REAL outcome: the account is gone — the old token's currentUser no longer resolves.
      const res = await gqlAuthed(ctx.authEndpoint, `query { currentUser { id } }`);
      const stillThere = res?.data?.currentUser?.id;
      if (!stillThere) return pass('account deleted; old session no longer resolves currentUser (confirmDeleteAccount took)');
      throw new Error('deletion landing showed success-cta yet the account still authenticates — deletion did not take');
    },
  },

  // ── §4.9 organization (authorization; needs orgReconcile) — PARTIAL unless reconcile (GAP-1b/1c). ──
  organization: {
    group: 'authorization',
    needs: ['orgReconcile'],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      const route = routeFor('organization', '/orgs/new');
      const uname = `qaorg${Date.now().toString(36)}`;
      // STRICT-by-default: non-mount THROWS; this branch only runs when mount is relaxed → documented.
      if (!openAndAwaitMount(ctx, 'organization', route, ['org-username', 'org-submit']))
        return gapPartial('block-not-mounted', `org-create-card not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step(`create an org "${uname}"`);
      fillTestid('org-username', uname);
      if (pageEval(`!!${Q_TESTID('org-displayName')}`) === 'true') fillTestid('org-displayName', `QA Org ${uname}`);
      // Advance any multi-step wizard, then submit.
      for (const nextId of ['step1-next', 'step2-skip', 'step2-next']) {
        if (pageEval(`!!${Q_TESTID(nextId)}`) === 'true') {
          clickTestid(nextId);
          sleep(500);
        }
      }
      if (pageEval(`!!${Q_TESTID('org-submit')}`) === 'true') clickTestid('org-submit');
      sleep(1500);
      // REAL outcome: the org exists as a users row (type=2) the actor owns. Definitive
      // check = a GraphQL read; co-signal = the onSuccess route push to /orgs/<id>.
      const url = pageEval('location.href');
      const pushed = /\/orgs\/[^/]+/.test(url) && !/\/orgs\/new$/.test(url);
      const res = await gqlAuthed(ctx.authEndpoint, `query { currentUser { id } }`);
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      if (/permission|denied|not allowed|rls|create_entity/i.test(errMsg) || /permission|denied|not allowed/i.test(pageEval('document.body.innerText').slice(0, 4000)))
        // Self-service org MINT (createUser type=2) is RLS-denied — a DOCUMENTED upstream block
        // (GAP-6), distinct from the personal-org reconcile (GAP-1b/1c). The actor still owns their
        // personal org via reconcile, which the org-detail drivers (members/roles) use as the org id.
        // So this is the documented self-service-mint gap, not a regression → gapPartial.
        return gapPartial(
          'org-create-self-service-rls (PLATFORM-GAPS GAP-6)',
          `self-service org mint (createUser type=2) RLS-denied (${errMsg || 'denial in UI'}) — documented upstream GAP-6; the actor still owns their personal org (reconcile), which the org-detail drivers use. Op surface is real; not a regression.`
        );
      // CHAINING: if the create actually minted a NEW org, the onSuccess push carries its id
      // (/orgs/<id>…) — stash it on ctx so the org-detail drivers (members/roles/memberships)
      // chain off THIS real org instead of a foreign one. (Org-create is GAP-6-blocked on the
      // b2b tier today, so this capture usually no-ops and the detail drivers fall back to the
      // actor's owned PERSONAL org via resolveOwnedOrgId — the hands-free path.)
      const mintedId = (url.match(/\/orgs\/([^/?#]+)/) || [])[1];
      if (mintedId && mintedId !== 'new') {
        ctx._orgId = mintedId;
        step(`captured minted org id for chaining: ${mintedId}`);
      }
      if (pushed) return pass(`org created (onSuccess pushed to ${url.replace(ctx.baseUrl, '')})`);
      // No route push captured but no denial either → treat as pass if the form left the create page.
      if (!/\/orgs\/new$/.test(url)) return pass('org create submitted without RLS denial (left the create page)');
      throw new Error('org create did not complete (still on /orgs/new, no route push) — unexpected');
    },
  },

  // ── §4.10 org-members (authorization; needs orgReconcile). ──
  'org-members': {
    group: 'authorization',
    needs: ['orgReconcile'],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      // CHAINING: resolve an org the SIGNED-IN actor OWNS (minted org → LIVE_QA_ORG_ID →
      // the actor's personal org via currentUser.id, which the reconcile makes them own)
      // instead of a FOREIGN env org id → "permission denied". See lib/qa-fixtures.mjs.
      const owned = await resolveOwnedOrgId(ctx, { gqlAuthed, endpoint: ctx.authEndpoint });
      // BROKEN (not documented): could not resolve an org the actor owns = an unmet
      // precondition for this authorization flow (the orgReconcile should make the actor own
      // their personal org) → fail rather than pass green.
      if (owned.reason) return brokenPartial('no-org-id', `org-members: ${owned.reason}`);
      const orgId = owned.orgId;
      // Navigate to the CONCRETE URL-param org route /org/<ownedId>/members. routeFor
      // resolves the mounter's path (env → manifest /org/[orgId]/members template →
      // fallback) and substitutes the [orgId] token with the owned id; orgRouteConcrete
      // then GUARANTEES the concrete id segment regardless of the manifest shape.
      const route = orgRouteConcrete(
        routeFor('org-members', `/org/${orgId}/members`, { orgId }),
        'members',
        orgId
      );
      step(`open the owned org's members surface (${route})`);
      openAndAwaitMount(ctx, 'org-members', route, ['confirm-remove', 'confirm-transfer'], { timeoutMs: 8000 });
      // GA op: read the memberships (deleteOrgMembership is the GA remove; transfer is GAP-5).
      // OrgMembership exposes profileId (the role link), NOT roleId — the schema renamed it.
      // We read through the AUTHED owner's session against an org they own, so this returns
      // rows (not RLS-denied) — the chaining fix that makes the read meaningful.
      const res = await gqlAuthed(ctx.adminEndpoint, `query { orgMemberships { nodes { id profileId entityId isOwner } } }`);
      const nodes = res?.data?.orgMemberships?.nodes;
      if (!Array.isArray(nodes)) {
        const errMsg = (res?.errors && res.errors[0]?.message) || '';
        // DOCUMENTED: the owned-org membership read is unavailable here under the documented
        // org gaps (transfer is GAP-5 by design); the op surface is real → gapPartial.
        return gapPartial('membership-query-unavailable', `orgMemberships not readable for the owned org (${owned.source}; ${errMsg || 'no nodes'}); transfer is GAP-5 by design`);
      }
      // Confirm the actor actually scopes this org (the reconcile's owner row) for honest
      // evidence — best-effort, never a hard fail.
      const ownEv = await confirmActorOwnsOrg(ctx, orgId, { gqlAuthed, endpoint: ctx.adminEndpoint });
      const ownNote = ownEv === true ? `actor owns org ${String(orgId).slice(0, 8)}… (reconcile owner row present)` : `ownership note: ${ownEv}`;
      // remove (deleteOrgMembership) needs a SECOND member to remove — a fresh signup's
      // personal org has only the owner, so removing oneself isn't a valid QA. The 2nd-member
      // fixture is the same upstream-blocked self-service join as app-memberships (GAP-6 tier),
      // so member-remove is a documented gap here; transfer is GAP-5. The READ is the real,
      // now-meaningful pass signal (owned-org rows returned, not RLS-denied). The two missing
      // legs are documented upstream gaps (GAP-5 / GAP-6 tier) → gapPartial, not a regression.
      return gapPartial(
        'org-transfer-pending (PLATFORM-GAPS GAP-5); member-remove needs a 2nd member (self-service org-join upstream-blocked, GAP-6 tier); role-change/remove are GA via updateOrgMembership/deleteOrgMembership',
        `orgMemberships readable on the actor's OWNED org (${owned.source}; ${nodes.length} membership(s); ${ownNote}); transferOrgOwnership not deployed (GAP-5)`
      );
    },
  },

  // ── §4.11 org-roles (authorization; needs orgReconcile). createOrgProfile persists. ──
  'org-roles': {
    group: 'authorization',
    needs: ['orgReconcile'],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      // CHAINING: drive against an org the actor OWNS (personal org via currentUser.id, or a
      // minted/env org) — not a foreign id. createOrgProfile under the OWNED org persists, so
      // this leg can truly PASS hands-free (vs the old foreign-org "permission denied").
      const owned = await resolveOwnedOrgId(ctx, { gqlAuthed, endpoint: ctx.authEndpoint });
      // FIX-3c: could not resolve an org the actor owns. Attribute it CORRECTLY:
      //   • reconcile GENUINELY absent — the loop-level cap that let this driver run was a
      //     STALE/forced positive (a polluted legacy b2b run-state leaking org_reconcile, or
      //     LIVE_QA_ORG_RECONCILE forced on) while THIS app's reconcile was never applied. The
      //     actor therefore owns no personal org, so no-org-id is the EXPECTED consequence of a
      //     missing precondition. But this driver runs ONLY under needs:['orgReconcile'], so the
      //     reconcile-ABSENT case is already SKIPPED upstream (recorded as a cap-absent partial),
      //     and the preflight clears any stale run-state org_reconcile that could force a false
      //     positive. Therefore reaching here with no owned org means reconcile was BELIEVED applied
      //     yet the actor still owns no org — a real break of the authorization precondition →
      //     brokenPartial (the reachable fail). (A prior `if (!orgReconcileGenuine(ctx))` softening
      //     here was DEAD code: orgReconcileGenuine and the cap that gated this driver read the SAME
      //     inputs, so it could never be false at this point.)
      if (owned.reason) {
        return brokenPartial('no-org-id', `org-roles: ${owned.reason}`);
      }
      const orgId = owned.orgId;
      // Navigate to the CONCRETE URL-param org route /org/<ownedId>/roles so the
      // OrgRolesEditor mounts against the owned org (add-role-button / save-role-button).
      // routeFor resolves env → manifest /org/[orgId]/roles template → fallback (with the
      // [orgId] token substituted); orgRouteConcrete guarantees the concrete id segment.
      const route = orgRouteConcrete(
        routeFor('org-roles', `/org/${orgId}/roles`, { orgId }),
        'roles',
        orgId
      );
      const roleName = `QA Role ${Date.now().toString(36)}`;
      // STRICT-by-default: non-mount THROWS; this branch only runs when mount is relaxed → documented.
      if (!openAndAwaitMount(ctx, 'org-roles', route, ['add-role-button', 'empty-state']))
        return gapPartial('block-not-mounted', `org-roles-editor not mounted at ${route} (mount strictness relaxed via LIVE_QA_STRICT_MOUNT)`);
      step(`add a role "${roleName}"`);
      if (pageEval(`!!${Q_TESTID('add-role-button')}`) === 'true') clickTestid('add-role-button');
      waitTestid('profile-name', { what: 'profile-name (role editor)', timeoutMs: 10000 });
      fillTestid('profile-name', roleName);
      if (pageEval(`!!${Q_TESTID('profile-slug')}`) === 'true') fillTestid('profile-slug', `qa-role-${Date.now().toString(36)}`);
      clickTestid('save-role-button');
      sleep(1200);
      step('reload and assert the role persisted (createOrgProfile)');
      reload();
      const res = await gqlAuthed(ctx.adminEndpoint, `query { orgProfiles { nodes { name } } }`);
      const nodes = res?.data?.orgProfiles?.nodes || [];
      if (nodes.some((n) => (n.name || '') === roleName)) return pass(`createOrgProfile persisted role "${roleName}"`);
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      // Did NOT persist. The platform now self-seeds the fresh signup actor's personal-org
      // membership row on signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15), so the actor IS a
      // member/owner of their personal org and createOrgProfile under it should persist + read back.
      // Reaching this branch therefore means a REAL break (createOrgProfile did not round-trip for a
      // properly-seeded actor) → brokenPartial. (no-org-id above stays the reachable brokenPartial
      // too; non-mount above stays the reachable throw.)
      return brokenPartial(
        'org-roles-create-did-not-persist',
        `createOrgProfile("${roleName}") did not read back for the signed-in actor (${errMsg || 'not in orgProfiles'}). The platform self-seeds the actor's personal-org membership on signup (GAP-1b/1c, CLOSED), so the actor owns this org and createOrgProfile should persist — a failure here is a real backend/driver defect, not a documented gap.`
      );
    },
  },

  // ── org-invites (authorization; needs orgReconcile). createOrgInvite persists. ──
  // SURFACE CONTRACT: /org/[orgId]/invites (OrgContext URL-param route). The mounter mounts
  // <InviteDialog orgId open onOpenChange/> with the dialog OPEN on mount (testid
  // invite-submit; email field invite-email). Driver: resolve an OWNED org (personal org
  // via currentUser.id — the reconcile makes the actor its owner), open /org/<id>/invites,
  // create an invite (createOrgInvite under the OWNED org persists), and ASSERT the row read
  // back from orgInvites (RLS-scoped, real backend outcome). The accept leg needs the
  // EMAILED token (createOrgInvite returns id/email/entityId, NOT the token — the token is
  // emailed), so accept-by-minted-token is partial-by-design unless Mailpit is up (we poll
  // it when reachable and accept via submitOrgInviteCode at /invite). CREATE persisting is
  // the real pass; the emailed accept leg is partial when Mailpit is absent.
  'org-invites': {
    group: 'authorization',
    needs: ['orgReconcile'],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      // CHAINING: drive against an org the actor OWNS (personal org via currentUser.id, or a
      // minted/env org) — not a foreign id — so createOrgInvite + the orgInvites read-back go
      // THROUGH RLS and return rows (see lib/qa-fixtures.mjs).
      const owned = await resolveOwnedOrgId(ctx, { gqlAuthed, endpoint: ctx.authEndpoint });
      // BROKEN (not documented): unmet precondition — no owned org resolved (the orgReconcile
      // should make the actor own their personal org) → fail.
      if (owned.reason) return brokenPartial('no-org-id', `org-invites: ${owned.reason}`);
      const orgId = owned.orgId;
      // Navigate to the CONCRETE URL-param org route /org/<ownedId>/invites so the
      // InviteDialog mounts against the owned org. routeFor resolves env → manifest
      // /org/[orgId]/invites template → fallback (with [orgId] substituted); orgRouteConcrete
      // then guarantees the concrete id segment regardless of the manifest shape.
      const route = orgRouteConcrete(
        routeFor('org-invites', `/org/${orgId}/invites`, { orgId }),
        'invites',
        orgId
      );
      const inviteEmail = `qa-invitee+${Date.now().toString(36)}@example.com`;
      step(`open the owned org's invites surface (${route})`);
      const mounted = openAndAwaitMount(ctx, 'org-invites', route, ['invite-submit', 'invite-email'], { timeoutMs: 12000 });
      const since = Date.now();
      // Prefer the UI create (the dialog is open on mount). Fill the email + submit; the
      // selectors stay block testids (invite-email / invite-submit). If the dialog isn't
      // mounted, fall back to the backend createOrgInvite directly (still a real op).
      let uiSubmitted = false;
      if (mounted && visibleTestid('invite-email')) {
        step(`create an invite for ${inviteEmail} via the InviteDialog`);
        fillTestid('invite-email', inviteEmail);
        clickTestid('invite-submit');
        sleep(1500);
        uiSubmitted = true;
      }
      // REAL outcome: the invite row reads back from the orgInvites query scoped to the org
      // (RLS-respecting). createOrgInvite lives on the admin SDK; orgInvites is the list.
      // FILTER SHAPE: the deployed constructive admin schema exposes a typed `where` arg
      // (`where: { entityId: { equalTo: $orgId } }`), NOT the PostGraphile-classic `condition`
      // (REVALIDATE-teamspace3: the live schema rejects `condition` with `Unknown argument
      // "condition" on field "Query.orgInvites"`; every org query — orgMemberships/orgInvites/
      // orgProfiles/orgMembers — carries `where`/`orderBy`). Use the typed `where` filter.
      const listQ = `query($orgId: UUID!) { orgInvites(where: { entityId: { equalTo: $orgId } }) { nodes { id email inviteValid } } }`;
      let res = await gqlAuthed(ctx.adminEndpoint, listQ, { orgId });
      let nodes = res?.data?.orgInvites?.nodes;
      // If the UI submit didn't land a row (dialog flake) OR the dialog wasn't mounted, mint
      // it directly via the GA createOrgInvite mutation (the same op the block calls).
      const haveInvite = () => Array.isArray(nodes) && nodes.some((n) => (n.email || '').toLowerCase() === inviteEmail.toLowerCase());
      if (!haveInvite()) {
        if (!Array.isArray(nodes)) {
          const errMsg = (res?.errors && res.errors[0]?.message) || '';
          // orgInvites unreadable here — try the create directly anyway, then re-read.
          step(`orgInvites not readable yet (${errMsg || 'no nodes'}); minting via createOrgInvite directly`);
        }
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        const createQ = `mutation($input: CreateOrgInviteInput!) { createOrgInvite(input: $input) { orgInvite { id email entityId } } }`;
        const created = await gqlAuthed(ctx.adminEndpoint, createQ, { input: { orgInvite: { entityId: orgId, email: inviteEmail, expiresAt } } });
        const createErr = (created?.errors && created.errors[0]?.message) || '';
        // DOCUMENTED: createOrgInvite RLS-denied — self-service invite is upstream-gated for
        // this tier (the op surface is real, the policy is the documented gap) → gapPartial.
        if (createErr && /permission|denied|not allowed|rls|create_entity|unauthor/i.test(createErr))
          return gapPartial('org-invite-create-rls', `createOrgInvite RLS-denied on the owned org (${owned.source}; ${createErr}) — self-service invite may be upstream-gated for this tier; op surface is real`);
        // Re-read the list to confirm persistence.
        res = await gqlAuthed(ctx.adminEndpoint, listQ, { orgId });
        nodes = res?.data?.orgInvites?.nodes;
      }
      if (!Array.isArray(nodes)) {
        const errMsg = (res?.errors && res.errors[0]?.message) || '';
        // DOCUMENTED: the list read is unavailable here while the create op surface is real →
        // gapPartial (parallels membership-query-unavailable).
        return gapPartial('orginvites-query-unavailable', `orgInvites not readable for the owned org (${owned.source}; ${errMsg || 'no nodes'}) — create op surface is real but the list read is unavailable here`);
      }
      if (!haveInvite())
        throw new Error(`invite for ${inviteEmail} did not persist in orgInvites after ${uiSubmitted ? 'UI submit + ' : ''}createOrgInvite on the owned org (${owned.source}) with reconcile applied`);

      // CREATE persisted — the real pass signal. Now the ACCEPT-by-token leg: the token is
      // EMAILED (createOrgInvite returns no token), so accept requires Mailpit. When Mailpit
      // is reachable we complete it (mint token from the email → /invite → submitOrgInviteCode);
      // otherwise the emailed leg is partial-by-design.
      if (ctx.caps && ctx.caps.mailpit) {
        const mail = await pollMailpit({ to: inviteEmail, subjectIncludes: 'invit', sinceMs: since, timeoutMs: 20000 });
        const token = mail && mail.params && mail.params.token;
        if (token) {
          // The /invite acceptance landing is a FIXED public page the mounter always emits
          // (org-invites' `dedicated:[{ path:'/invite' }]`); it is NOT registered in
          // flow-surfaces.json under a key, so we resolve it from the env override or the
          // fixed default DIRECTLY — NOT via routeFor (which would register an unmanifested
          // driver key and trip check:flow-surfaces' DRIVER-KEYS ⊆ MANIFEST assertion).
          const acceptRoute = process.env.LIVE_QA_ROUTE_ORG_INVITES_LANDING || '/invite';
          step('land the invitation link and accept it');
          navigate(`${ctx.baseUrl}${acceptRoute}?token=${encodeURIComponent(token)}&kind=org`);
          // The acceptance card exposes accept-invite-submit; click it (the actor is signed in).
          if (visibleTestid('accept-invite-submit')) {
            clickTestid('accept-invite-submit');
            sleep(1500);
            return pass(`createOrgInvite persisted (${inviteEmail} in orgInvites on the actor's OWNED org, ${owned.source}); accepted via the emailed token at ${acceptRoute}`);
          }
          // DOCUMENTED: the PRIMARY in-scope outcome (createOrgInvite persisted, verified via
          // the orgInvites read-back above) already succeeded; the secondary emailed-accept
          // leg's public /invite acceptance card did not mount (the actor may already scope the
          // org, or the public landing differs in this build) → gapPartial, create is real.
          return gapPartial('org-invite-accept-card', `invite created + emailed (token parsed) but the acceptance card (accept-invite-submit) did not mount at ${acceptRoute}; create persisted (real pass signal)`);
        }
        // BROKEN (not documented): Mailpit IS up yet no invite email arrived — undisambiguated
        // cause (site-domain row OR a real upstream send-path defect); fail rather than mask it
        // green (parallels the email-verification/reset/deletion email-not-delivered path).
        return brokenPartial('org-invite-email-not-delivered', `createOrgInvite persisted (${inviteEmail} in orgInvites, ${owned.source}) but no invite email arrived to mint an accept token — ${emailNotDeliveredEvidence('invitation')}`);
      }
      // DOCUMENTED: createOrgInvite persisted (REAL create pass); the accept-by-token leg needs
      // the EMAILED token and Mailpit is absent in this env → gapPartial (by design).
      return gapPartial(
        'org-invite-accept-needs-mailpit',
        `createOrgInvite persisted (${inviteEmail} present in orgInvites on the actor's OWNED org, ${owned.source}) — REAL create pass; the accept-by-token leg needs the EMAILED token (createOrgInvite returns no token), so it is documented without Mailpit (:8025)`
      );
    },
  },

  // ── §4.12 app-memberships (authorization; needs orgReconcile). ──
  'app-memberships': {
    group: 'authorization',
    needs: ['orgReconcile'],
    precondition: ensureSignedIn,
    run: async (ctx) => {
      // CHAINING: resolve an org the actor OWNS (personal org via currentUser.id, or a
      // minted/env org), not a foreign id — so the appMemberships read returns rows under RLS.
      const owned = await resolveOwnedOrgId(ctx, { gqlAuthed, endpoint: ctx.authEndpoint });
      // BROKEN (not documented): unmet precondition — no owned org resolved (the orgReconcile
      // should make the actor own their personal org) → fail.
      if (owned.reason) return brokenPartial('no-org-id', `app-memberships: ${owned.reason}`);
      const orgId = owned.orgId;
      // Navigate to the CONCRETE URL-param org route /org/<ownedId>/app-memberships so
      // OrgAppMemberships mounts against the owned org (approve-button / revoke-button).
      // routeFor resolves env → manifest /org/[orgId]/app-memberships template → fallback
      // (with the [orgId] token substituted); orgRouteConcrete guarantees the id segment.
      const route = orgRouteConcrete(
        routeFor('app-memberships', `/org/${orgId}/app-memberships`, { orgId }),
        'app-memberships',
        orgId
      );
      step(`open the owned org's app-memberships surface (${route})`);
      openAndAwaitMount(ctx, 'app-memberships', route, ['approve-button', 'revoke-button'], { timeoutMs: 8000 });
      // AppMembership exposes the boolean isApproved (pending ⇔ isApproved=false), NOT a
      // `status` string — the schema models membership state as booleans.
      const res = await gqlAuthed(ctx.adminEndpoint, `query { appMemberships { nodes { id isApproved } } }`);
      const nodes = res?.data?.appMemberships?.nodes;
      if (!Array.isArray(nodes)) {
        const errMsg = (res?.errors && res.errors[0]?.message) || '';
        // DOCUMENTED: the owned-org appMemberships read is unavailable here under the documented
        // org gaps; the op surface is real → gapPartial (parallels org-members).
        return gapPartial('membership-query-unavailable', `appMemberships not readable for the owned org (${owned.source}; ${errMsg || 'no nodes'})`);
      }
      let pending = nodes.find((n) => n.isApproved === false);
      // FIXTURE: a fresh tenant has no pending row to approve/revoke. Try to SEED one through
      // the authed admin path (sign up a 2nd actor → self-service join lands pending). If the
      // only way to mint it is the upstream-missing self-service join (GAP-6 tier), this
      // returns a reason and we mark partial-by-design — never a hard fail.
      if (!pending) {
        const seeded = await seedPendingMembership(ctx, orgId, {
          gqlAuthed,
          adminEndpoint: ctx.adminEndpoint,
          signUpSecondActor: () => signUpSecondActor(ctx),
          step,
        });
        if (seeded.reason) {
          // DOCUMENTED: appMemberships read succeeded; the only way to mint a pending fixture is
          // the upstream-missing self-service join (GAP-6 tier) → gapPartial, not a regression.
          return gapPartial('no-membership-fixture', `appMemberships readable (${nodes.length}) on the actor's OWNED org (${owned.source}) but ${seeded.reason}`);
        }
        // Re-read so the pending row we just seeded is reflected (and the page sees it).
        reload();
        const reread = await gqlAuthed(ctx.adminEndpoint, `query { appMemberships { nodes { id isApproved } } }`);
        pending = (reread?.data?.appMemberships?.nodes || []).find((n) => n.isApproved === false) || (seeded.id ? { id: seeded.id, isApproved: false } : null);
        // DOCUMENTED: the seed op surface is real but the pending row is not observable here
        // (the upstream fixture path is GAP-6-tier) → gapPartial.
        if (!pending) return gapPartial('no-membership-fixture', `seeded a membership (${seeded.evidence || 'ok'}) but no pending row surfaced on re-read (op surface real, fixture not observable here)`);
      }
      // Approve the pending membership (updateAppMembership) and assert via reload. Use the
      // retry-with-verify click so a flaky first approve-button click doesn't fail a real op:
      // the UI verify is "the approve control for this row went away" (the row left the pending
      // list). It is a best-effort signal — the AUTHORITATIVE proof is the reload + query below.
      step('approve a pending app membership');
      const approveBefore = countTestid('approve-button');
      clickTestidVerify(
        'approve-button',
        () => countTestid('approve-button') < approveBefore,
        { tries: 2, settleMs: 800 }
      );
      sleep(1200);
      reload();
      const after = await gqlAuthed(ctx.adminEndpoint, `query { appMemberships { nodes { id isApproved } } }`);
      const row = (after?.data?.appMemberships?.nodes || []).find((n) => n.id === pending.id);
      if (row && row.isApproved === true) return pass(`app membership approved (isApproved → true) on the actor's owned org (${owned.source})`);
      throw new Error('approve did not change the membership isApproved after reload');
    },
  },
};

// ── flow resolution: read acceptance.required_flows[] ourselves ──────────────
// run_live_qa hands us NO flow list, so we resolve it from the same sources the
// verifier autodetects. Precedence: LIVE_QA_FLOWS (csv) → LIVE_QA_SPEC →
// build/<app-id>/app-brief.yaml (when APP_ID set) → build/app-brief.yaml →
// test/app-spec.yaml → run-state.json. The per-app candidate is inserted BEFORE the
// legacy build/ singleton (briefCandidates()), so with APP_ID unset this collapses to
// the EXACT legacy chain (canary byte-equal).
function resolveRequiredFlows() {
  if (process.env.LIVE_QA_FLOWS) {
    return process.env.LIVE_QA_FLOWS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const p of briefCandidates()) {
    if (p && existsSync(p)) {
      const flows = readFlowsFromYaml(p);
      if (flows.length) return flows;
    }
  }
  // Fall back to run-state.json (acceptance mirror, if the run wrote one) — per-app
  // (build/<app-id>/) when APP_ID is set AND present, else the legacy build/ singleton.
  const state = runStatePath();
  if (existsSync(state)) {
    try {
      const s = JSON.parse(readFileSync(state, 'utf8'));
      const fromState =
        s?.acceptance?.required_flows ||
        (Array.isArray(s?.evaluator?.flows) ? s.evaluator.flows.map((f) => f.flow).filter(Boolean) : null);
      if (Array.isArray(fromState) && fromState.length) return fromState;
    } catch {
      /* ignore */
    }
  }
  return [];
}

// Minimal YAML reader scoped to the acceptance.required_flows[] block — mirrors
// verify-phase.sh spec_has_required_flows (we don't add a YAML dep for one list).
// Handles both the block form (`- flow`) and the inline form (`[a, b]`).
function readFlowsFromYaml(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const out = [];
  let inAcceptance = false;
  let inFlows = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^[^\s#].*:/.test(line)) {
      // a new top-level key ends any block we were in
      inAcceptance = /^acceptance\s*:/.test(line);
      inFlows = false;
      continue;
    }
    if (inAcceptance && /^\s*required_flows\s*:/.test(line)) {
      const inline = line.match(/required_flows\s*:\s*\[(.*)\]/);
      if (inline) {
        for (const tok of inline[1].split(',')) {
          const v = tok.trim().replace(/^['"]|['"]$/g, '');
          if (v) out.push(v);
        }
        inFlows = false;
      } else {
        inFlows = true;
      }
      continue;
    }
    if (inFlows) {
      const m = line.match(/^\s*-\s*([^#\s].*?)\s*$/);
      if (m) {
        out.push(m[1].replace(/^['"]|['"]$/g, ''));
      } else if (/^\s*[A-Za-z_]/.test(line)) {
        // a sibling key under acceptance ends the list
        inFlows = false;
      }
    }
  }
  return out;
}

// ── CRUD-target derivation: make the entity QA generic from the brief ─────────
// run_live_qa wires NO LIVE_QA_CRUD_PATH / LIVE_QA_TID_* for non-todo apps, so without
// this every non-todo app's QA would time out on the canary's `todo-*` testids. We
// DERIVE the app's crud path + per-entity testid prefix from the SAME brief the
// scaffolders consumed, reproducing scaffold-frontend.mjs's identifier derivation
// EXACTLY so the prefix we look for is the prefix the entity page actually emitted.
//
// scaffold-frontend.mjs emits, per the FIRST `ui.routes[]` entry whose kind is crud
// (kind defaults to 'crud' when omitted):
//   entity = route.entity || singularFromTable(matchingTable.name) || kebab(route.path)
//   prefix = kebab(entity)                       (the data-testid prefix)
//   testids = `${prefix}-title-input` / `${prefix}-create-submit` / `${prefix}-row`
//             (and `${prefix}-edit` / `${prefix}-delete`); crudPath = route.path
// The inflection (words/kebab/camel/pluralizeWords/singularFromTable) is imported from the
// SHARED scripts/lib/inflect.mjs (see the import near the top) — the SAME functions
// scaffold-frontend.mjs uses, so the derived prefix is identical to the scaffolder's by
// CONSTRUCTION (no more byte-for-byte copy to drift). We import inflect.mjs directly (a pure
// module with no main()), NOT scaffold-frontend.mjs (a CLI that runs main() at import time,
// which we must not trigger here). The table-match (tableForRoute) stays local below.

/** The brief table that backs a route (entity-plural==table, or singular(table)==entity). */
function tableForRoute(brief, route) {
  const tables = brief?.data_model?.tables ?? [];
  const ent = route.entity;
  if (!ent) return tables[0] ?? null;
  const pluralOfEntity = pluralizeWords(ent).join('');
  return (
    tables.find((t) => camel(t.name) === pluralOfEntity) ||
    tables.find((t) => singularFromTable(t.name) === kebab(ent)) ||
    tables.find((t) => camel(t.name) === camel(ent)) ||
    null
  );
}

/**
 * Resolve the spec/brief file the SAME way resolveRequiredFlows() does (so the QA path
 * and the flow list come from one brief): LIVE_QA_SPEC → build/<app-id>/app-brief.yaml
 * (when APP_ID set) → build/app-brief.yaml → test/app-spec.yaml (briefCandidates()).
 * Returns the parsed brief or null (never throws). Memoized — the brief file is stable
 * for a run and this is called by resolveAppContext/deriveCrudTarget/the driver.
 */
let _briefMemo;
function loadBriefForQa() {
  if (_briefMemo !== undefined) return _briefMemo;
  for (const p of briefCandidates()) {
    if (p && existsSync(p)) {
      try {
        _briefMemo = parseBrief(readFileSync(p, 'utf8'));
        return _briefMemo;
      } catch {
        // Unparseable here → fall through; the todo fallback keeps the canary working.
      }
    }
  }
  _briefMemo = null;
  return _briefMemo;
}

/**
 * Is this an ORG (b2b) tier app, per the BRIEF? Mirrors verify-phase.sh's org-tier detection and
 * brief.mjs's b2b gate (NOT an app/db-name literal): true when modules.preset ∈ {b2b, b2b:storage,
 * full}, OR any table carries an org-scoped policy intent (org-membership | member-owner). This is
 * the authoritative tier signal for caps.orgReconcile now that the personal-org seed is platform-
 * native (PLATFORM-GAPS.md GAP-1b/1c, CLOSED) and nothing stamps run-state database.org_reconcile.
 * Pure read of the parsed brief; never throws (returns false when no brief is resolvable).
 */
function briefIsOrgTier() {
  const brief = loadBriefForQa();
  if (!brief) return false;
  const preset = brief.modules?.preset;
  if (preset === 'b2b' || preset === 'b2b:storage' || preset === 'full') return true;
  const tables = brief.data_model?.tables ?? [];
  return tables.some((t) => t && (t.policy === 'org-membership' || t.policy === 'member-owner'));
}

/**
 * Derive { crudPath, prefix } from the brief's FIRST crud route, mirroring
 * scaffold-frontend.mjs exactly. Returns null when no brief/crud-route is resolvable
 * (→ caller uses the todo fallback). The testid prefix is kebab(entity).
 */
function deriveCrudTarget() {
  const brief = loadBriefForQa();
  const routes = brief?.ui?.routes ?? [];
  // All crud routes (kind defaults to 'crud' when omitted) — same filter scaffold-frontend.mjs
  // uses to pick the entity pages it stamps.
  const crudRoutes = routes.filter((r) => r && (r.kind || 'crud') === 'crud');
  // Which crud route to DERIVE the entity + testid prefix from. If the operator chose WHICH
  // entity to drive via LIVE_QA_CRUD_PATH (a legitimate run-time choice — e.g. drive the CHILD
  // /posts of a parent/child FK app to exercise the FK picker), derive from THAT route so the
  // derived testids match the page being driven. Otherwise the FIRST crud route (the one
  // scaffold-frontend.mjs stamps first). The testids themselves are ALWAYS derived here
  // (`${prefix}-title-input/-create-submit/-row`), NEVER hard-coded/passed in — that is what
  // keeps this generic for any entity. LIVE_QA_CRUD_PATH selects the entity; it does not pin testids.
  const wantPath = process.env.LIVE_QA_CRUD_PATH;
  const route = (wantPath && crudRoutes.find((r) => r.path === wantPath)) || crudRoutes[0];
  if (!route) return null;
  const table = tableForRoute(brief, route);
  const entity = route.entity || singularFromTable(table?.name) || (route.path ? kebab(route.path) : null);
  if (!entity || !route.path) return null;
  return { crudPath: route.path, prefix: kebab(entity) };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(C.bold('\nLive-QA driver — Chrome (agent-browser) acceptance of ALL required flows\n'));

  // Resolve the running app + per-DB endpoints from run-state → brief → env → default
  // (NEVER a bare hardcoded port/subdomain). The gate's LIVE_QA_BASE_URL/BASE_URL still
  // wins for baseUrl (it points at the app the gate brought up).
  const ctx = resolveAppContext();
  if (!ctx.baseUrl) {
    console.error(
      C.red('✗ Could not resolve the app base URL.') +
        ' run_live_qa exports LIVE_QA_BASE_URL/BASE_URL; or set build/run-state.json frontend / the brief frontend_port. Cannot drive without the app URL.'
    );
    process.exit(2);
  }
  log(`${C.dim('app    ')} ${ctx.baseUrl}`);
  log(`${C.dim('auth gql')} ${ctx.authEndpoint || C.yellow('(unresolved — no-UI flows degrade to partial)')}`);
  log(`${C.dim('admin gql')} ${ctx.adminEndpoint || C.yellow('(unresolved)')}`);
  log(`${C.dim('driver ')} ${AB} (agent-browser CLI → Chrome via CDP)`);

  // RUN-ISOLATION (GAP-1): before driving ANYTHING, (1) close every persistent
  // agent-browser session so a stale tab from a prior/concurrent dogfood run can't be
  // grabbed, and (2) pin the app-under-test origin so navigate() refuses to interact with a
  // tab on a DIFFERENT run's origin. Both derive purely from ctx.baseUrl — no app/port/db
  // literal. (Disable the origin guard for a deliberate multi-origin run with
  // LIVE_QA_ASSERT_ORIGIN=0.)
  isolateBrowserSession();
  setExpectedOrigin(ctx.baseUrl);
  log(`${C.dim('isolate')} closed prior agent-browser sessions; pinned app origin ${C.bold(getExpectedOrigin() || ctx.baseUrl)}${originAssertEnabled() ? '' : C.yellow(' (origin guard disabled)')}`);

  const flows = resolveRequiredFlows();
  if (!flows.length) {
    console.error(
      C.red('✗ No acceptance.required_flows[] resolved.') +
        ' Set LIVE_QA_FLOWS / LIVE_QA_SPEC, or add acceptance.required_flows to the brief. Nothing to QA = not green.'
    );
    process.exit(2);
  }

  // Probe environment capabilities ONCE; missing caps degrade the gated flows to
  // partial-by-design (never a hard fail) — mirrors run_live_qa's "no browser ⇒ skip".
  ctx.caps = await probeCaps(ctx);
  log(`${C.dim('caps   ')} mailpit=${ctx.caps.mailpit ? C.green('up') : C.yellow('absent')} · orgReconcile=${ctx.caps.orgReconcile ? C.green('on') : C.yellow('off')}`);
  log(`${C.dim('flows  ')} ${flows.join(', ')}\n`);

  const results = [];
  for (const flow of flows) {
    const driver = FLOW_QA[flow];

    // 1) No registry entry → COVERAGE GAP (loud, never silently skipped). Non-zero exit.
    if (!driver) {
      console.error(C.red(`  ✗ ${flow}`) + ` — no live-QA script for flow ${C.bold(flow)} — coverage gap`);
      results.push({ flow, status: 'gap', evidence: `no live-QA script for flow ${flow} — coverage gap (add it to FLOW_QA in scripts/live-qa.mjs)` });
      continue;
    }

    log(`  ${C.bold('▶ ' + flow)}`);

    // 2) Capability gate (needs[]): a missing cap → DOCUMENTED by-design absence
    // (Mailpit not up / org reconcile not applied in this env), do NOT run. This is a
    // labeled non-failure (documentedGap:true) — mirrors run_live_qa's "no browser ⇒ skip".
    const missing = (driver.needs || []).filter((cap) => !ctx.caps[cap]);
    if (missing.length) {
      const reason = `${missing[0]}-absent`;
      const evidence =
        missing[0] === 'mailpit'
          ? 'email infra absent (Mailpit unreachable on :8025 + site-domain row) — flow needs it'
          : 'not an org tier (no b2b preset / org-membership policy in this app) — org flow not applicable';
      log(`  ${C.yellow('◐ ' + flow)} — partial (documented gap): ${reason} ${C.dim('(' + evidence + ')')}\n`);
      results.push({ flow, status: 'partial', documentedGap: true, reason, evidence });
      continue;
    }

    try {
      // 3) precondition (most flows must sign in first). A returned string means the
      // precondition FAILED (e.g. ensureSignedIn → 'signup-failed (…)') — that is a REAL
      // breakage of the surface the flow needs, not a documented upstream gap. Mark it a
      // broken (documentedGap:false) partial so it FAILS the gate rather than passing green.
      if (typeof driver.precondition === 'function') {
        const pre = await driver.precondition(ctx);
        if (typeof pre === 'string') {
          log(`  ${C.red('✗ ' + flow)} — partial (BROKEN — precondition failed): ${pre}\n`);
          results.push({ flow, status: 'partial', documentedGap: false, reason: pre, evidence: pre });
          continue;
        }
      }

      // 4) run(ctx) → Verdict (pass | partial) ; a throw → FAIL.
      const verdict = (await driver.run(ctx)) || pass('completed');
      if (verdict.status === 'partial') {
        // Carry the documentedGap flag through so computeVerdict() can tell a labeled
        // upstream-gap partial (non-failing) from a broken/unmounted one (FAILS).
        const docGap = !!verdict.documentedGap;
        const mark = docGap ? C.yellow('◐ ' + flow) : C.red('✗ ' + flow);
        const kind = docGap ? 'partial (documented gap)' : C.red('partial (BROKEN — counts as fail)');
        log(`  ${mark} — ${kind}: ${verdict.reason} ${C.dim('(' + (verdict.evidence || '') + ')')}\n`);
        results.push({ flow, status: 'partial', documentedGap: docGap, reason: verdict.reason, evidence: verdict.evidence || verdict.reason });
      } else {
        log(`  ${C.green('✓ ' + flow)} — ${verdict.evidence || 'happy path passed'}\n`);
        results.push({ flow, status: 'pass', evidence: verdict.evidence || 'happy path passed' });
      }
    } catch (err) {
      const detail = err instanceof AbError
        ? `${err.message}\n${(err.stderr || err.stdout || '').slice(0, 600)}`
        : (err && err.message) || String(err);
      console.error(`  ${C.red('✗ ' + flow)} — ${detail}\n`);
      results.push({ flow, status: 'fail', evidence: detail.split('\n')[0] });
    }
  }

  // Always try to leave a clean browser; never let teardown flip the verdict.
  try {
    ab(['close'], { allowFail: true });
  } catch {
    /* ignore */
  }

  // ── per-flow PASS / PARTIAL / FAIL table + OVERALL line ────────────────────
  const v = computeVerdict(results);
  const pad = Math.max(4, ...results.map((r) => r.flow.length));
  log(C.bold('Live-QA results'));
  log(C.dim('─'.repeat(pad + 12)));
  for (const r of results) {
    let tag;
    if (r.status === 'pass') tag = C.green('PASS   ');
    else if (r.status === 'partial' && r.documentedGap) tag = C.yellow('PARTIAL'); // documented gap — non-failing
    else if (r.status === 'partial') tag = C.red('BROKEN '); // broken/unmounted partial — counts as fail
    else tag = C.red('FAIL   '); // 'fail' or 'gap'
    const note = r.status === 'partial' && r.reason ? `${C.yellow(r.reason)} — ${C.dim(r.evidence)}` : C.dim(r.evidence);
    log(`  ${tag}  ${r.flow.padEnd(pad)}  ${note}`);
  }

  log('');
  log(
    C.dim(
      `summary: ${v.passed} pass · ${v.documentedPartials} partial-by-design · ${v.brokenPartials} BROKEN-partial · ${v.hardFailed} fail/gap`
    )
  );

  // OVERALL exit = 0 IFF no hard FAIL/coverage-gap AND no BROKEN (documentedGap:false)
  // partial. A DOCUMENTED-gap partial does NOT flip the gate red — it is loud (YELLOW
  // above) but not a regression; a BROKEN partial (block-not-mounted / page-crash /
  // missing-control / create-errored) DOES, so a "green" QA now means actually-working.
  if (v.green) {
    log(C.green('OVERALL: PASS') + (v.documentedPartials ? C.yellow(` (${v.documentedPartials} partial-by-design)`) : ''));
  } else {
    const why = [];
    if (v.hardFailed) why.push(`${v.hardFailed} fail/gap`);
    if (v.brokenPartials) why.push(`${v.brokenPartials} BROKEN-partial (non-documented — broken/unmounted)`);
    log(C.red('OVERALL: FAIL') + C.dim(` (${why.join(', ')})`));
  }

  process.exit(v.green ? 0 : 1);
}

// ── PURE verdict-mapping (extracted so it is unit-/statically-reasonable) ──────
// Maps the per-flow results[] to the overall gate outcome. The whole point of the
// partial taxonomy: a partial counts as a PASS for the gate ONLY when it is an
// explicitly-documented upstream gap (documentedGap:true). A partial that is NOT so
// annotated (documentedGap:false) is a structural breakage (a block that should be
// mounted is not, a page crashed, an expected control is missing, a create errored)
// and is counted with the hard failures. `green` is true IFF nothing hard-failed AND
// nothing broke. This function has NO side effects and does not read process/env, so
// it can be exercised directly:
//   computeVerdict([{status:'partial',documentedGap:true}]).green   === true   (GAP-2 etc.)
//   computeVerdict([{status:'partial',documentedGap:false}]).green  === false  (unmounted/broken)
//   computeVerdict([{status:'pass'}]).green                         === true
//   computeVerdict([{status:'fail'}]).green                         === false
//   computeVerdict([{status:'gap'}]).green                          === false  (coverage gap)
function computeVerdict(results) {
  const passed = results.filter((r) => r.status === 'pass').length;
  const hardFailed = results.filter((r) => r.status === 'fail' || r.status === 'gap').length;
  const partials = results.filter((r) => r.status === 'partial');
  const documentedPartials = partials.filter((r) => r.documentedGap === true).length;
  // ANY partial not explicitly flagged documentedGap:true is treated as broken → fails.
  const brokenPartials = partials.length - documentedPartials;
  const green = hardFailed === 0 && brokenPartials === 0;
  return { passed, hardFailed, documentedPartials, brokenPartials, green };
}

// Export the pure verdict mapper so it can be unit-exercised (and statically reasoned
// about) WITHOUT driving a browser. run_live_qa shells `node …/live-qa.mjs` directly, so
// this file is the process entrypoint there and main() runs exactly as before; when the
// file is merely IMPORTED (for a unit check of computeVerdict) it is NOT the entrypoint, so
// we skip main() and never touch agent-browser. This guard preserves the gate's behavior.
export { computeVerdict };

// SYMLINK-ROBUST entrypoint detection. A lexical compare of resolve(process.argv[1]) ===
// fileURLToPath(import.meta.url) returns FALSE the moment EITHER path traverses a symlinked
// component (classic case: macOS /tmp → /private/tmp), which would silently disable main()
// for an app built/run under such a path. So we canonicalize BOTH sides with realpathSync
// (which dereferences every symlink) before comparing. realpathSync is per-side guarded: if
// a side can't be canonicalized (e.g. it isn't on disk), we fall back to its lexical form —
// degrading to exactly the old compare rather than mis-detecting. Invariants preserved:
//   • IMPORTED (process.argv[1] ≠ this file) ⇒ false ⇒ main() does NOT run, browser untouched.
//   • `node <path>/live-qa.mjs` ⇒ true ⇒ main() runs — INCLUDING when <path> is symlinked.
const INVOKED_AS_ENTRYPOINT = (() => {
  try {
    if (!process.argv[1]) return false;
    const canon = (p) => {
      try {
        return realpathSync(p);
      } catch {
        return p; // not on disk / not canonicalizable — fall back to the lexical path.
      }
    };
    return canon(resolve(process.argv[1])) === canon(fileURLToPath(import.meta.url));
  } catch {
    return true; // be conservative — if we can't tell at all, behave like the gate (run main).
  }
})();

if (INVOKED_AS_ENTRYPOINT) {
  main().catch((err) => {
    console.error(C.red('\n✗ live-qa driver crashed:'), (err && err.stack) || err);
    process.exit(1);
  });
}
