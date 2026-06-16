#!/usr/bin/env node
/**
 * scripts/check-flow-surfaces.mjs — REGRESSION GUARD for the mounter↔driver contract.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Wave-2 fix that lets the live-QA drivers actually REACH the flow pages they
 * test works by a CONTRACT between two files:
 *   • scripts/scaffold-frontend.mjs (the MOUNTER) — step (f) mounts each brief flow's
 *     blocks on a real Next surface AND writes build/<app-id>/flow-surfaces.json:
 *         { flows: { "<flow>": { path, shellTestid } } }
 *   • scripts/live-qa.mjs (the DRIVER) — routeFor('<flow>', fallback) looks the flow's
 *     surface path up in that manifest and navigates there.
 * If either side drifts (the mounter stops emitting a key/path the driver requests, or
 * the driver starts requesting a key the mounter never emits, or a manifest path points
 * at a page that was never written) the drivers silently navigate to a 404 and
 * self-report partial(block-not-mounted) — the EXACT class of bug that made the
 * b2b/townboard flows un-QA-able. That desync is INVISIBLE to every other gate (tsc,
 * build, check:scaffold all stay green). This guard makes it RED.
 *
 * WHAT IT ASSERTS (hub-free — pure dry-scaffold into a temp dir; no :3000, no DB)
 * ─────────────────────────────────────────────────────────────────────────────
 *   (1a) NO ORPHAN MANIFEST PATH — every flow-surfaces path the mounter emits resolves
 *        to a page file the SAME scaffold run actually wrote (app/<segs>/page.tsx).
 *        Catches "manifest path points to no emitted page".
 *   (1b) MOUNTED ⇒ MANIFESTED — every surface-producing flow in the brief gets a
 *        manifest entry. Catches a silently-dropped mount/manifest entry (the
 *        deliberate-removal case the self-check exercises).
 *   (2)  DRIVER KEYS ⊆ MANIFEST — every key live-qa.mjs's routeFor('<key>', …) will
 *        look up (parsed STATICALLY from live-qa.mjs), for a brief that enables the
 *        flow backing that key, is present in the manifest. Catches the two-sided
 *        desync (driver requests a key the mounter dropped, incl. the derived
 *        `<flow>-landing` keys).
 *   (4)  DRIVER SENTINEL ⊆ MANIFESTED SURFACE — for every flow that has a live-qa driver
 *        with mount sentinels (parsed STATICALLY from its openAndAwaitMount(ctx,'<flow>',…)
 *        markers), the page the flow's manifest path points to must PROVIDE at least one of
 *        those sentinels — either by mounting the BLOCK the testid lives in (block-tag
 *        present) or by emitting the testid LITERALLY (shell/aggregate sentinels). Catches
 *        the mounter-vs-driver MISMATCH class (1a)+(2) miss: a driver pointed at the WRONG
 *        surface — e.g. organization → the /org/[orgId]/settings page (mounts
 *        <OrgSettingsForm) while the driver requires org-username/org-submit (the
 *        <OrgCreateCard create surface) — resolves to a real page (passes 1a) and the
 *        routeFor key exists (passes 2), yet every action testid is ABSENT at live-QA →
 *        partial(block-not-mounted). Here that is a hard FAIL. (Assertion-number 3 is the
 *        org URL-param-shape check, kept inline below.)
 *
 * The CANARY (golden brief, flows:[email-password]) emits ZERO flow pages and an empty
 * manifest, so every assertion passes trivially — the guard is additive and never
 * touches the frozen canary's behavior.
 *
 * ISOLATION: the mounter writes the manifest into THIS repo's build/ (build/<db>/…
 * AND the legacy build/flow-surfaces.json), not the temp app dir. To stay
 * side-effect-free on shared build/ state (other agents read it), we (a) use a UNIQUE
 * throwaway db_name per brief so build/<db>/ is brand-new + removable, and (b)
 * snapshot+restore the legacy build/flow-surfaces.json around the run.
 *
 * Usage: node scripts/check-flow-surfaces.mjs    (pnpm check:flow-surfaces;
 *        also invoked at the tail of pnpm check:scaffold so it runs in the gate path).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { loadBrief } from './lib/brief.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS = path.resolve(__dirname, '..');
const SCAFFOLD = path.join(HARNESS, 'scripts', 'scaffold-frontend.mjs');
const LIVE_QA = path.join(HARNESS, 'scripts', 'live-qa.mjs');
const BUILD_DIR = path.join(HARNESS, 'build');
const LEGACY_MANIFEST = path.join(BUILD_DIR, 'flow-surfaces.json');

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const bad = (m) => { console.error(`  FAIL ${m}`); failures++; };

function mktemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Strip JS comments (`// …` and `/* … *\/`) from source, leaving string/template literals
 * intact, so the routeFor() static parse only sees EXECUTED call-sites — never a routeFor
 * reference that appears inside prose. A tiny character-scan state machine (NOT a regex) so
 * a `//` inside a string (e.g. `'http://…'`) or a `/* *\/` inside a template literal is NOT
 * treated as a comment. Comment bodies are replaced with spaces (length-neutral is
 * unnecessary here; we only scan the result for routeFor(...)).
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'sq'; out += c; i++; continue; }
      if (c === '"') { mode = 'dq'; out += c; i++; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c; // keep newlines so line numbers/context survive
      i++; continue;
    }
    // string/template modes — copy verbatim, honoring backslash escapes.
    if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
    if (mode === 'sq' && c === "'") mode = 'code';
    else if (mode === 'dq' && c === '"') mode = 'code';
    else if (mode === 'tpl' && c === '`') mode = 'code';
    out += c; i++;
  }
  return out;
}

/** app-router page path for a route path: app/<seg>/<seg>/page.tsx (mirrors routeSegments()). */
function pageRelForRoute(routePath) {
  const segs = String(routePath || '/')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean);
  return path.join('app', ...segs, 'page.tsx');
}

/**
 * STATIC parse of every routeFor('<literal>', …) call in live-qa.mjs. These literals
 * ARE the manifest keys the drivers will look up — the consumer side of the contract.
 * Parsing the source (not importing it) keeps the guard hub-free and immune to live-qa's
 * heavy top-level config. Returns a de-duped, sorted array of key strings.
 */
function driverRouteKeys() {
  const raw = fs.readFileSync(LIVE_QA, 'utf8');
  // Strip comments BEFORE scanning so a routeFor(...) reference that appears only inside a
  // // line-comment or /* block-comment */ (a documentation mention, e.g. the org-route
  // navigation note that illustrates `routeFor('<flow>', …)`) is NOT mistaken for a real
  // driver call-site. Only EXECUTED routeFor() calls are consumer keys; a commented one is
  // not a contract the mounter must satisfy. This keeps the static parse robust to prose
  // that names routeFor without invoking it (which would otherwise inject a phantom key
  // like `<flow>` with no backing flow and trip the coverage breadcrumb).
  const src = stripComments(raw);
  const keys = new Set();
  // routeFor('key', …)  /  routeFor("key", …)  — first string arg only.
  const re = /routeFor\(\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src))) keys.add(m[2]);
  if (keys.size === 0) {
    // The parse is load-bearing — a routeFor rename/refactor that makes this return
    // nothing would silently neuter assertion (2). Fail loudly instead.
    bad('contract parse: found ZERO routeFor(\'…\') call-sites in live-qa.mjs — the static ' +
      'parse (or live-qa\'s routeFor API) changed; update check-flow-surfaces.mjs to re-derive the consumer keys.');
  }
  return [...keys].sort();
}

/**
 * STATIC parse of every openAndAwaitMount(ctx, '<flow>', route, <markers>, …) call in
 * live-qa.mjs → a map { '<flow>': [sentinel-testid, …] }. Those markers are the
 * MOUNT-SENTINEL testids the driver waits for after navigating to the flow's surface
 * (openAndAwaitMount returns true on the FIRST one that appears) — i.e. the testids that
 * PROVE the driver reached the RIGHT surface. We parse the source (not import it) to stay
 * hub-free. Only STRING-literal markers are collected; non-literal entries (a template like
 * `social-btn-` or an identifier like t.email) are skipped — they are not a fixed contract
 * the manifested page must satisfy, and the any-of semantics mean the literal siblings carry
 * the check. A flow with NO openAndAwaitMount (e.g. email-verification, which drives via a
 * bare navigate/pageEval) yields no entry → it is exempt from the surface-testid assertion
 * (there is no mount sentinel to pin), while the routeFor-key assertions still cover it.
 */
function driverSentinels() {
  const src = stripComments(fs.readFileSync(LIVE_QA, 'utf8'));
  const out = {}; // flow -> Set of sentinel testids
  // openAndAwaitMount(ctx, '<flow>', <route-expr>, <markers>, …) — capture the flow literal
  // and the raw markers arg (a single string or a [ … ] list). The 3rd positional arg
  // (route) is an expression we don't need, so skip to the markers: match the flow, then
  // grab the markers token (a quoted string OR a bracketed list) that follows the route arg.
  const callRe = /openAndAwaitMount\(\s*ctx\s*,\s*(['"])([^'"]+)\1\s*,\s*([^,]+?)\s*,\s*(\[[^\]]*\]|(['"])[^'"]*\5)/g;
  let m;
  while ((m = callRe.exec(src))) {
    const flow = m[2];
    const markersRaw = m[4];
    const ids = out[flow] || (out[flow] = new Set());
    // Pull every '…' / "…" string literal out of the markers token (works for both the
    // single-string form and the [ 'a', 'b', `tpl`, ident ] list — template/ident entries
    // simply contribute no string-literal match and are skipped, by design).
    const strRe = /(['"])([^'"]+)\1/g;
    let s;
    while ((s = strRe.exec(markersRaw))) ids.add(s[2]);
  }
  // Freeze to plain sorted arrays.
  const frozen = {};
  for (const [flow, set] of Object.entries(out)) frozen[flow] = [...set].sort();
  if (Object.keys(frozen).length === 0) {
    // Load-bearing parse: an openAndAwaitMount rename/refactor that returns nothing would
    // silently neuter assertion (4). Fail loudly (mirrors driverRouteKeys()).
    bad('contract parse: found ZERO openAndAwaitMount(ctx, \'…\', …) call-sites in live-qa.mjs — the ' +
      'static parse (or live-qa\'s mount API) changed; update check-flow-surfaces.mjs to re-derive the driver sentinels.');
  }
  return frozen;
}

/**
 * SENTINEL → PROVIDER registry. Each mount-sentinel testid the drivers wait on is PROVIDED
 * on a flow's surface in exactly one of two ways, and BOTH are checkable from the emitted
 * page file text (no block source is copied into the dry-scaffold, so a driver's deep block
 * testid like `org-username` is NEVER a literal in the page — it lives inside the BLOCK the
 * page mounts):
 *   • { block: '<BlockTag' } — the testid lives inside that block component; the page
 *     "provides" it iff the page mounts that block (its JSX tag appears in the page source).
 *     This is the load-bearing signal for the mounter↔driver SURFACE match: the org-create
 *     sentinels (org-username/org-submit) are provided by <OrgCreateCard, NOT by the
 *     <OrgSettingsForm the OLD organization=settings surface mounts — so pointing the
 *     organization surface at the settings page fails this check (the exact mismatch class
 *     the fleet QA hit).
 *   • { literal: true } — the testid is emitted DIRECTLY by the scaffolder onto the page
 *     (an APP-controlled shell/aggregate sentinel: account-page / authed-shell), so the page
 *     "provides" it iff `data-testid="<id>"` appears literally in the page source.
 * Sourced from scaffold-frontend.mjs FLOW_SURFACES (each entry's block import + its
 * `// testids:` note) and the dedicated-route templates. EVERY string-literal sentinel
 * driverSentinels() parses MUST have an entry here; an unmapped sentinel fails the gate
 * loudly (see assertion (4) in assertContract) so a newly-added driver marker can't slip
 * through unchecked. The block tag is matched as a substring of the page source, so an intentionally
 * COMMENTED block seam (cross-origin's <CrossOriginLink, emitted as a // TODO seam) still
 * counts as "the seam is on this surface" — matching the cross-origin driver's own tolerance
 * of a non-live mount (it proves the flow via the backend token mint, not the in-page click).
 */
const SENTINEL_PROVIDERS = {
  // ── account-session: SECTIONS on the /account aggregate (block tags) + shell literals ──
  'display-name': { block: '<AccountProfileCard' },
  'save-profile-btn': { block: '<AccountProfileCard' },
  'add-email-button': { block: '<AccountEmailsList' },
  'add-email-input': { block: '<AccountEmailsList' },
  'change-password-submit': { block: '<ChangePasswordForm' },
  'current-password': { block: '<ChangePasswordForm' },
  'revoke-confirm-button': { block: '<AccountSessionsList' },
  'revoke-all-button': { block: '<AccountSessionsList' },
  'create-key-button': { block: '<AccountApiKeysList' },
  'no-providers-message': { block: '<AccountConnectedAccounts' },
  'account-danger-confirm': { block: '<AccountDangerCard' },
  // APP-controlled shell sentinels the scaffolder emits literally on the surface.
  'authed-shell': { literal: true }, // CRUD-page shell + /account aggregate header
  'account-page': { literal: true }, // /account aggregate shell (scaffold account template)
  // ── authentication: dedicated-route blocks + the /sign-in add-on hosts ──
  'forgot-password-submit': { block: '<ForgotPasswordPage' },
  'reset-password-submit': { block: '<ResetPasswordPage' },
  'auth-social-buttons': { block: '<AuthSocialButtons' }, // live-mounted add-on on /sign-in
  email: { block: '<SignInCard' }, // social-oauth's host: the sign-in card's email field
  'cross-origin-link-trigger': { block: '<CrossOriginLink' }, // COMMENTED seam on /sign-in (tolerated)
  // ── authorization: /org/[orgId]/<sub> admin blocks + the /org/new create card ──
  'org-username': { block: '<OrgCreateCard' }, // org CREATE — NOT <OrgSettingsForm
  'org-submit': { block: '<OrgCreateCard' },
  'confirm-remove': { block: '<MembersList' },
  'confirm-transfer': { block: '<MembersList' },
  'add-role-button': { block: '<OrgRolesEditor' },
  'empty-state': { block: '<OrgRolesEditor' }, // roles-editor empty state (block-internal)
  'invite-submit': { block: '<InviteDialog' },
  'invite-email': { block: '<InviteDialog' },
  'approve-button': { block: '<OrgAppMemberships' },
  'revoke-button': { block: '<OrgAppMemberships' },
};

/**
 * Does the emitted page at `pageAbsPath` PROVIDE `sentinel`? Reads the page source and
 * applies the sentinel's registry rule (block-tag substring, or literal data-testid). A
 * sentinel with no registry entry returns { provided:false, unmapped:true } so the caller
 * can fail loudly rather than vacuously pass.
 */
function pageProvidesSentinel(pageAbsPath, sentinel) {
  const rule = SENTINEL_PROVIDERS[sentinel];
  if (!rule) return { provided: false, unmapped: true };
  let text = '';
  try { text = fs.readFileSync(pageAbsPath, 'utf8'); } catch { return { provided: false }; }
  if (rule.literal) return { provided: text.includes(`data-testid="${sentinel}"`) };
  return { provided: text.includes(rule.block) };
}

/**
 * Run the REAL scaffold-frontend CLI on a brief into a fresh temp app dir, returning
 * { srcDir, manifest, written } where manifest is the parsed per-app flow-surfaces.json
 * and `written` is the set of page files emitted (absolute paths under srcDir).
 *
 * Isolated: the brief carries a UNIQUE throwaway db_name, so the per-app manifest lands
 * at build/<db>/flow-surfaces.json (a new dir we delete) and the legacy singleton is
 * snapshot+restored by the caller. A non-dry run is REQUIRED — --dry-run writes neither
 * the page files nor the manifest to disk (write()/writeFlowSurfacesManifest both no-op).
 */
function scaffold(briefText, dbName) {
  const tmp = mktemp('cfs-app-');
  const briefPath = path.join(tmp, 'brief.yaml');
  fs.writeFileSync(briefPath, briefText);
  const appDir = path.join(tmp, 'app');
  fs.mkdirSync(appDir, { recursive: true });

  execFileSync('node', [SCAFFOLD, briefPath, appDir], { stdio: 'pipe' });

  // resolveAppSrc() defaults a fresh dir to <appDir>/packages/app/src.
  const srcDir = path.join(appDir, 'packages', 'app', 'src');
  const manifestPath = path.join(BUILD_DIR, dbName, 'flow-surfaces.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;

  // Collect every emitted page.tsx under the app src (the pages the mounter wrote).
  const written = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === 'page.tsx') written.add(p);
    }
  };
  walk(path.join(srcDir, 'app'));

  return { tmp, srcDir, manifest, written };
}

/**
 * Assert the contract for one scaffolded brief.
 *  - `surfaceFlows`: the brief flows we KNOW produce a surface (for assertion 1b).
 *  - `driverKeys`:   the routeFor keys parsed from live-qa.mjs (for assertion 2),
 *                    already filtered to those whose backing flow is in this brief.
 *  - `driverSentinelsMap`: { flow: [sentinel-testid, …] } parsed from live-qa.mjs's
 *                    openAndAwaitMount calls (for assertion 4). Defaults to {} so existing
 *                    callers that don't pass it skip the surface-testid check.
 * Returns the parsed manifest.flows (or {} ) so the caller can do extra checks.
 */
function assertContract(label, result, surfaceFlows, driverKeys, sink = { ok, bad }, driverSentinelsMap = {}) {
  const { srcDir, manifest, written } = result;
  if (!manifest) {
    sink.bad(`${label}: scaffold emitted NO per-app flow-surfaces.json (the mounter↔driver manifest is missing)`);
    return {};
  }
  const flows = manifest.flows && typeof manifest.flows === 'object' ? manifest.flows : {};

  // (1a) every manifest path resolves to an emitted page file.
  for (const [flow, surf] of Object.entries(flows)) {
    const rp = surf?.path;
    if (!rp) {
      sink.bad(`${label}: manifest flow "${flow}" has no \`path\` — the driver's routeFor() would resolve undefined`);
      continue;
    }
    const expected = path.join(srcDir, pageRelForRoute(rp));
    if (!written.has(expected)) {
      sink.bad(`${label}: manifest flow "${flow}" → path "${rp}" points at NO emitted page (expected ` +
        `${path.relative(srcDir, expected)}). Mounter wrote a manifest entry for a surface it never emitted.`);
    }
  }
  if (Object.keys(flows).length > 0 &&
      Object.entries(flows).every(([f, s]) => s?.path && written.has(path.join(srcDir, pageRelForRoute(s.path))))) {
    sink.ok(`${label}: all ${Object.keys(flows).length} manifest path(s) resolve to an emitted page`);
  }

  // (1b) every surface-producing brief flow is in the manifest.
  const missingMounted = surfaceFlows.filter((f) => !(f in flows));
  if (missingMounted.length) {
    sink.bad(`${label}: surface-producing flow(s) [${missingMounted.join(', ')}] in the brief have NO manifest entry — ` +
      'the mounter dropped a flow the live-QA driver expects to navigate to.');
  } else if (surfaceFlows.length) {
    sink.ok(`${label}: all ${surfaceFlows.length} surface-producing brief flow(s) are manifested`);
  }

  // (2) every driver routeFor key whose flow is enabled here exists in the manifest.
  const missingForDriver = driverKeys.filter((k) => !(k in flows));
  if (missingForDriver.length) {
    sink.bad(`${label}: live-qa.mjs routeFor() looks up [${missingForDriver.join(', ')}] but the manifest has no such ` +
      'key — the driver would fall back to its hard-coded route (a 404 here) and self-report ' +
      'partial(block-not-mounted). Re-sync scaffold-frontend.mjs emitFlowSurfaces() with the driver.');
  } else if (driverKeys.length) {
    sink.ok(`${label}: all ${driverKeys.length} driver routeFor key(s) reachable in this brief are manifested`);
  }

  // (3) ORG URL-PARAM SHAPE — every org admin sub-route surface uses the `[orgId]` dynamic
  // segment (`/org/[orgId]/<sub>`). The mounter emits org pages under app/org/[orgId]/ and
  // the driver interpolates the concrete id before navigating; a regression that dropped the
  // bracket (back to the flat /org/<sub>) would still resolve to a valid FILE path and slip
  // past (1a), so pin the shape here. We can't import the mounter's FLOW_SURFACES kinds, so we
  // recognize an org ADMIN surface structurally: a `/org/…` path with a sub-segment that is NOT
  // the static index (`/org`) or the static create page (`/org/new`) — those are intentionally
  // NON-bracket siblings and never surface-mapped flows. The manifest path is validated as a
  // FILE-path TEMPLATE (it CONTAINS the literal `[orgId]`); the guard must NOT interpolate.
  const orgShapeBad = Object.entries(flows).filter(([, surf]) => {
    const p = surf?.path || '';
    if (!/^\/org(\/|$)/.test(p)) return false; // not an org surface
    if (p === '/org' || p === '/org/new') return false; // static siblings (no [orgId])
    return !/^\/org\/\[orgId\]\//.test(p); // an org admin sub-route MUST carry [orgId]
  });
  if (orgShapeBad.length) {
    sink.bad(`${label}: org admin surface(s) [${orgShapeBad.map(([f, s]) => `${f}→${s.path}`).join(', ')}] do NOT use the ` +
      '`/org/[orgId]/<sub>` URL-param shape — the mounter must emit org pages under app/org/[orgId]/ and the driver ' +
      'interpolates the concrete id. A flat /org/<sub> would resolve to a file but desync from the URL-param driver.');
  } else {
    const orgSurfaces = Object.values(flows).filter((s) => /^\/org\/\[orgId\]\//.test(s?.path || ''));
    if (orgSurfaces.length) {
      sink.ok(`${label}: all ${orgSurfaces.length} org admin surface(s) use the /org/[orgId]/<sub> URL-param shape`);
    }
  }

  // (4) DRIVER SENTINEL ⊆ MANIFESTED SURFACE — for every flow that BOTH (a) has a manifest
  // entry whose path resolves to an emitted page AND (b) has a live-qa driver with parsed
  // mount sentinels, assert the manifested page PROVIDES at least ONE of those sentinels (the
  // any-of semantics of openAndAwaitMount: the driver mounts on the FIRST sentinel that
  // appears). This is the durable fix for the mounter-vs-driver MISMATCH class the route-only
  // checks (1a/2) missed: assertions (1a)+(2) only prove the driver's routeFor key resolves
  // to SOME emitted page — NOT that the page is the RIGHT one (carries the testids the driver
  // then fills/clicks). A driver pointed at the wrong surface (e.g. organization → the
  // settings page that mounts <OrgSettingsForm, NOT the <OrgCreateCard the org-username/
  // org-submit sentinels live in) passes (1a)+(2) but every action testid is ABSENT at
  // live-QA → the run mis-reports partial(block-not-mounted). Here that is a hard FAIL.
  // We read the emitted page (block tags / literal data-testids) and check providability via
  // SENTINEL_PROVIDERS. An UNMAPPED sentinel fails loudly (a new driver marker must be
  // classified, never vacuously pass). Flows without parsed sentinels (no openAndAwaitMount,
  // e.g. email-verification) are skipped — there is no mount sentinel to pin.
  for (const [flow, surf] of Object.entries(flows)) {
    const sentinels = driverSentinelsMap[flow];
    if (!sentinels || sentinels.length === 0) continue; // no driver mount sentinel for this flow
    const rp = surf?.path;
    if (!rp) continue; // already flagged by (1a)
    const pageAbs = path.join(srcDir, pageRelForRoute(rp));
    if (!written.has(pageAbs)) continue; // already flagged by (1a) — don't double-report
    const unmapped = [];
    let providedBy = null;
    for (const s of sentinels) {
      const r = pageProvidesSentinel(pageAbs, s);
      if (r.unmapped) { unmapped.push(s); continue; }
      if (r.provided) { providedBy = s; break; }
    }
    // PRECEDENCE (any-of): a single PROVIDED sentinel satisfies the flow (the driver mounts
    // on the first one that appears) — even if a SIBLING marker is unmapped. Only when NOTHING
    // is provided do we distinguish "can't tell" (every marker unmapped → loud classify-me
    // fail) from a real surface MISMATCH (some markers were classified but the page provides
    // none of them).
    if (!providedBy && unmapped.length === sentinels.length) {
      sink.bad(`${label}: driver sentinel(s) [${unmapped.join(', ')}] for flow "${flow}" are NOT in SENTINEL_PROVIDERS — ` +
        'a new live-qa.mjs mount marker is unclassified; add it to check-flow-surfaces.mjs SENTINEL_PROVIDERS (block tag or literal) ' +
        'so its surface presence is actually checked (refusing to vacuously pass).');
      continue;
    }
    if (providedBy) {
      sink.ok(`${label}: flow "${flow}" surface ${rp} provides driver sentinel "${providedBy}"`);
    } else {
      sink.bad(`${label}: flow "${flow}" is manifested at ${rp} but that page provides NONE of the live-qa driver's mount ` +
        `sentinels [${sentinels.join(', ')}] — the driver navigates there, never mounts, and self-reports ` +
        'partial(block-not-mounted). The manifested surface is the WRONG page for this flow (mounter↔driver MISMATCH): ' +
        'point scaffold-frontend.mjs FLOW_SURFACES at the surface that mounts the block carrying those testids.');
    }
  }

  return flows;
}

console.log('check:flow-surfaces — mounter↔driver contract guard\n');

// The driver keys are derived ONCE from live-qa.mjs (the consumer side of the contract).
const DRIVER_KEYS = driverRouteKeys();
// The driver MOUNT SENTINELS (flow → [testid,…]), also derived ONCE — the consumer side for
// assertion (4): which testids each flow's driver waits for on its manifested surface.
const DRIVER_SENTINELS = driverSentinels();
// The brief flow that BACKS a routeFor key: strip a trailing `-landing` (those keys are
// DERIVED by the mounter from the base flow, e.g. password-reset ⇒ password-reset-landing).
const backingFlow = (k) => k.replace(/-landing$/, '');

// Snapshot the legacy singleton so the run leaves shared build/ state pristine.
const legacyBefore = fs.existsSync(LEGACY_MANIFEST)
  ? fs.readFileSync(LEGACY_MANIFEST)
  : null;
const cleanup = []; // throwaway build/<db>/ dirs + temp app dirs to remove

function restoreShared() {
  // Restore (or remove) the legacy singleton to its pre-run bytes.
  try {
    if (legacyBefore !== null) fs.writeFileSync(LEGACY_MANIFEST, legacyBefore);
    else if (fs.existsSync(LEGACY_MANIFEST)) fs.rmSync(LEGACY_MANIFEST, { force: true });
  } catch { /* best-effort */ }
  for (const p of cleanup) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

try {
  // ── A. CANARY — golden brief (flows:[email-password]) → empty manifest, trivial pass ─
  {
    const db = `cfsguard${process.pid}canary`;
    const goldenSrc = fs.readFileSync(path.join(HARNESS, 'fixtures', 'golden-app-brief.yaml'), 'utf8');
    // Re-point the db_name to a throwaway so we never touch a real build/<app>/ dir.
    const briefText = goldenSrc.replace(/^(\s*db_name:\s*).*$/m, `$1${db}`);
    // Sanity: the canary really is single-flow email-password (no surface flows).
    const brief = loadBrief(path.join(HARNESS, 'fixtures', 'golden-app-brief.yaml'));
    const canaryFlows = Array.isArray(brief.flows) ? brief.flows : [];
    const res = scaffold(briefText, db);
    cleanup.push(res.tmp, path.join(BUILD_DIR, db));
    // No surface flows, no driver keys reachable → assertions are vacuously satisfied.
    // (The empty manifest also makes assertion (4) a no-op — no manifested flow to check.)
    const surfaceFlows = []; // email-password has no surface (handled by step e)
    assertContract('canary (golden, email-password)', res, surfaceFlows, [], { ok, bad }, DRIVER_SENTINELS);
    const flows = res.manifest?.flows ?? {};
    if (canaryFlows.length === 1 && canaryFlows[0] === 'email-password' && Object.keys(flows).length === 0) {
      ok('canary: single-flow email-password emits an empty flow-surfaces manifest (no surfaces to drift)');
    } else {
      bad(`canary: expected flows:[email-password] ⇒ empty manifest, got flows=${JSON.stringify(canaryFlows)} ` +
        `manifest keys=${JSON.stringify(Object.keys(flows))}`);
    }
  }

  // ── B. MULTI-FLOW — a brief enabling EVERY surface-producing flow the drivers reach ─
  // Covers all FLOW_SURFACES kinds: aggregate-account (profile/account-emails/change-
  // password/sessions/api-keys/account-deletion/connected-accounts), dedicated-route
  // (password-reset/email-verification), auth-form-addon (cross-origin/social-oauth),
  // and org-route (organization/org-members/org-roles/org-invites/app-memberships).
  // email-password ⇒ /sign-in page (cross-origin's surface); step-up silences the
  // StepUpProvider warning. b2b preset so the org flows are well-formed.
  const MULTI_DB = `cfsguard${process.pid}multi`;
  const MULTI_FLOWS = [
    'email-password', 'step-up',
    'profile', 'account-emails', 'change-password', 'sessions', 'api-keys',
    'connected-accounts', 'account-deletion',
    'password-reset', 'email-verification', 'cross-origin', 'social-oauth',
    'organization', 'org-members', 'org-roles', 'org-invites', 'app-memberships',
  ];
  // The flows that PRODUCE a surface (everything except email-password + step-up, which
  // are intentionally absent from FLOW_SURFACES). This is assertion (1b)'s expected set.
  const SURFACE_FLOWS = MULTI_FLOWS.filter((f) => f !== 'email-password' && f !== 'step-up');
  {
    const flowsYaml = MULTI_FLOWS.map((f) => `  - ${f}`).join('\n');
    const briefText = `version: 1
app: { id: cfs-multi, label: CFS Multi }
naming: { db_name: ${MULTI_DB} }
modules: { preset: b2b }
flows:
${flowsYaml}
data_model:
  tables:
    - name: notes
      policy: owner
      fields: [{ name: title, type: { name: text }, required: true }]
ui:
  routes:
    - { path: /notes, label: Notes, kind: crud, entity: note }
acceptance: { required_flows: [email-password] }
`;
    const res = scaffold(briefText, MULTI_DB);
    cleanup.push(res.tmp, path.join(BUILD_DIR, MULTI_DB));

    // The driver keys reachable IN THIS brief: a routeFor key counts iff its backing flow
    // is enabled (so we never demand a manifest entry for a flow this brief didn't install).
    const reachableDriverKeys = DRIVER_KEYS.filter((k) => MULTI_FLOWS.includes(backingFlow(k)));

    assertContract('multi-flow (all surfaces)', res, SURFACE_FLOWS, reachableDriverKeys, { ok, bad }, DRIVER_SENTINELS);

    // Coverage breadcrumb: make sure this brief actually exercised the driver keys
    // (not silently filtered to nothing — which would make assertion 2 vacuous).
    if (reachableDriverKeys.length < DRIVER_KEYS.length) {
      const unreached = DRIVER_KEYS.filter((k) => !MULTI_FLOWS.includes(backingFlow(k)));
      bad(`multi-flow: brief does not enable the backing flow for driver key(s) [${unreached.join(', ')}] ` +
        `(backing flows [${[...new Set(unreached.map(backingFlow))].join(', ')}]) — add them to MULTI_FLOWS so ` +
        'the contract for every driver routeFor() is actually checked.');
    } else {
      ok(`multi-flow: exercises ALL ${DRIVER_KEYS.length} driver routeFor key(s)`);
    }
  }

  // ── C. SELF-CHECK — a deliberately desynced manifest MUST be caught ────────────────
  // Re-scaffold a small multi-flow brief, then DELETE one manifest entry and run the
  // REAL assertContract() against the tampered manifest through a CAPTURING sink. This
  // proves the production assertion path (not a shadow copy) actually flags the desync,
  // so a future regression of assertContract() itself is caught too. The capturing sink
  // keeps these intentional failures out of the real verdict.
  {
    const db = `cfsguard${process.pid}neg`;
    const briefText = `version: 1
app: { id: cfs-neg, label: CFS Neg }
naming: { db_name: ${db} }
modules: { preset: b2b }
flows:
  - email-password
  - profile
  - password-reset
data_model:
  tables:
    - name: notes
      policy: owner
      fields: [{ name: title, type: { name: text }, required: true }]
ui:
  routes:
    - { path: /notes, label: Notes, kind: crud, entity: note }
acceptance: { required_flows: [email-password] }
`;
    const res = scaffold(briefText, db);
    cleanup.push(res.tmp, path.join(BUILD_DIR, db));
    const flows = res.manifest?.flows ?? {};
    // Tamper: drop the 'profile' surface entry, simulating a mounter that stopped
    // emitting it while the live-QA 'profile' driver still routeFor('profile', …)s.
    const tampered = { ...res.manifest, flows: { ...flows } };
    delete tampered.flows.profile;
    const negRes = { ...res, manifest: tampered };
    // Capturing sink — record failures instead of incrementing the real counter.
    const caught = [];
    const sink = { ok: () => {}, bad: (m) => caught.push(m) };
    // Drive the REAL assertion path: 'profile' is a surface flow + a driver routeFor key,
    // so both (1b) and (2) must fire now that its manifest entry is gone.
    assertContract('self-check (tampered)', negRes,
      ['profile', 'password-reset'],
      DRIVER_KEYS.filter((k) => ['profile', 'password-reset'].includes(backingFlow(k))),
      sink);
    const tripped1b = caught.some((m) => /surface-producing flow\(s\) \[[^\]]*profile/.test(m));
    const tripped2 = caught.some((m) => /routeFor\(\) looks up \[[^\]]*profile/.test(m));
    if (tripped1b && tripped2) {
      ok('self-check: real assertContract() catches a removed manifest entry via assertions (1b) + (2)');
    } else {
      bad(`self-check: removing the 'profile' manifest entry did NOT trip assertContract() ` +
        `(1b=${tripped1b}, 2=${tripped2}; caught ${caught.length}) — the guard would miss a real ` +
        'mounter↔driver drift. Fix the assertion logic.');
    }
  }

  // ── D. SELF-CHECK — the MISMATCH class (organization=settings vs driver=create) ─────
  // This is the regression the route-only checks MISSED and assertion (4) exists to catch.
  // We scaffold a brief with `organization` (which emits BOTH the org-route /org/[orgId]/
  // settings page that mounts <OrgSettingsForm AND the static /org/new page that mounts
  // <OrgCreateCard), then drive the REAL assertContract() path twice through a CAPTURING
  // sink (so these intentional results never touch the real verdict):
  //   • MISMATCH: re-point the `organization` manifest entry at the /org/[orgId]/settings
  //     page (the settings-form surface) while the live-qa `organization` driver still
  //     requires org-username/org-submit (the <OrgCreateCard sentinels). Assertion (4) MUST
  //     flag it ("provides NONE of the live-qa driver's mount sentinels"). This is the exact
  //     mismatch the fleet QA hit — and what the sibling scaffold-frontend fix removes by
  //     pointing `organization` at /org/new.
  //   • CORRECTED: re-point `organization` at /org/new (the <OrgCreateCard create surface,
  //     the sibling's fix). Assertion (4) MUST NOT flag it — proving the strengthened guard
  //     PASSES on the corrected surface (no over-fitting that would red the fixed tree).
  {
    const db = `cfsguard${process.pid}mismatch`;
    const briefText = `version: 1
app: { id: cfs-mm, label: CFS Mismatch }
naming: { db_name: ${db} }
modules: { preset: b2b }
flows:
  - email-password
  - organization
data_model:
  tables:
    - name: notes
      policy: owner
      fields: [{ name: title, type: { name: text }, required: true }]
ui:
  routes:
    - { path: /notes, label: Notes, kind: crud, entity: note }
acceptance: { required_flows: [email-password] }
`;
    const res = scaffold(briefText, db);
    cleanup.push(res.tmp, path.join(BUILD_DIR, db));
    const baseFlows = res.manifest?.flows ?? {};
    const SETTINGS_PATH = '/org/[orgId]/settings'; // mounts <OrgSettingsForm (NOT org-create)
    const CREATE_PATH = '/org/new'; // mounts <OrgCreateCard (org-username/org-submit)
    // Sanity: both target pages were emitted (the brief installs the org-route AND the static
    // org pages), so the only thing varying between the two legs is WHICH the manifest points
    // at — isolating assertion (4)'s surface-testid check from (1a)'s page-existence check.
    const settingsPage = path.join(res.srcDir, pageRelForRoute(SETTINGS_PATH));
    const createPage = path.join(res.srcDir, pageRelForRoute(CREATE_PATH));
    if (!res.written.has(settingsPage) || !res.written.has(createPage)) {
      bad(`self-check(mismatch): expected BOTH the org settings page (${SETTINGS_PATH}) and the org create page ` +
        `(${CREATE_PATH}) to be emitted by the organization brief, but settings=${res.written.has(settingsPage)} ` +
        `create=${res.written.has(createPage)} — cannot exercise the mismatch self-check.`);
    } else {
      // Restrict the driver maps to `organization` so this self-check is hermetic (it asserts
      // ONLY assertion (4)'s behavior on the organization surface, not the other flows).
      const orgSentinels = { organization: DRIVER_SENTINELS.organization || [] };
      if (!orgSentinels.organization.length) {
        bad('self-check(mismatch): driverSentinels() parsed NO mount sentinels for the `organization` driver — the ' +
          'openAndAwaitMount(ctx, \'organization\', …) parse broke; assertion (4) cannot be exercised.');
      } else {
        // (4) drives off the manifest; (1a)/(1b)/(2)/(3) also run but pass on this well-formed
        // org surface, so the only flags we assert on are (4)'s organization messages.
        const orgKeys = DRIVER_KEYS.filter((k) => backingFlow(k) === 'organization');

        // MISMATCH leg — organization → the settings page.
        const mmManifest = { ...res.manifest, flows: { ...baseFlows, organization: { path: SETTINGS_PATH, shellTestid: 'org-settings-page' } } };
        const mmCaught = [];
        assertContract('self-check (org→settings mismatch)', { ...res, manifest: mmManifest },
          ['organization'], orgKeys, { ok: () => {}, bad: (m) => mmCaught.push(m) }, orgSentinels);
        const flaggedMismatch = mmCaught.some((m) =>
          /flow "organization" is manifested at .*provides NONE of the live-qa driver's mount sentinels/.test(m));

        // CORRECTED leg — organization → /org/new (the sibling's fix).
        const okManifest = { ...res.manifest, flows: { ...baseFlows, organization: { path: CREATE_PATH, shellTestid: 'org-new-page' } } };
        const okCaught = [];
        assertContract('self-check (org→create corrected)', { ...res, manifest: okManifest },
          ['organization'], orgKeys, { ok: () => {}, bad: (m) => okCaught.push(m) }, orgSentinels);
        const flaggedCorrected = okCaught.some((m) => /flow "organization".*provides NONE/.test(m));

        if (flaggedMismatch && !flaggedCorrected) {
          ok('self-check: real assertContract() FLAGS organization→settings (driver=create) via assertion (4) and ' +
            'PASSES organization→/org/new (the corrected create-card surface)');
        } else {
          bad(`self-check(mismatch): assertion (4) did not behave as required ` +
            `(flaggedMismatch=${flaggedMismatch} [must be true], flaggedCorrected=${flaggedCorrected} [must be false]; ` +
            `mismatch-caught=${JSON.stringify(mmCaught)}; corrected-caught=${JSON.stringify(okCaught)}) — the ` +
            'strengthened guard would not catch the mounter↔driver MISMATCH class, or it over-fits and reds the corrected surface.');
        }
      }
    }
  }
} finally {
  restoreShared();
}

console.log('');
if (failures > 0) {
  console.error(`check:flow-surfaces FAIL — ${failures} check(s) failed. The mounter (scaffold-frontend.mjs ` +
    'emitFlowSurfaces) and the driver (live-qa.mjs routeFor) have DESYNCED — live-QA would navigate to a 404 ' +
    'and mis-report flows as partial(block-not-mounted).');
  process.exit(1);
}
console.log('check:flow-surfaces PASS — every mounted flow has a manifest entry whose path points to an emitted ' +
  'page that also PROVIDES its live-qa driver\'s mount sentinels (the right surface, not just a real one), AND ' +
  'every live-qa.mjs routeFor() key is reachable in the manifest.');
