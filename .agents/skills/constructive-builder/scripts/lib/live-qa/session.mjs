/**
 * session.mjs — authenticated GraphQL + Mailpit + auth-precondition helpers for live-QA.
 *
 * EXTRACTED (purely structural) from scripts/live-qa.mjs. This is the "shared driver helpers"
 * layer the flow drivers lean on to reach a REAL backend outcome and to stand up the signed-in
 * session most flows need: the in-page authed GraphQL fetch (through RLS, with the page's own
 * bearer), the Mailpit poller, the clean-profile wipe, and the sign-up/sign-in/sign-out
 * preconditions + the block-controlled auth testids. NONE of these contain a verdict decision
 * or a routeFor()/openAndAwaitMount() contract call-site — those stay in live-qa.mjs (the
 * verdict ledger + the static-parse contract surface). Behavior is byte-identical: same
 * definitions, only relocated, with the DOM/browser primitives + reporter now imported from the
 * sibling modules instead of being module-locals.
 *
 * Zero deps beyond Node (>=18) + the report/browser sibling modules + config.mjs (getMailpitUrl,
 * the SAME single source-of-truth live-qa.mjs already used). No import-time side effects.
 */

import { step } from './report.mjs';
import {
  ab,
  navigate,
  reload,
  waitTestid,
  fillTestid,
  clickTestid,
  pageEval,
  pageEvalRaw,
  pageEvalJson,
  Q_TESTID,
  sleep,
} from './browser.mjs';
import { getMailpitUrl } from '../config.mjs';

// ── §2.3 Authenticated GraphQL assertion from INSIDE the page → { data, errors }.
// For no-list-UI flows (sessions/emails/profile read-back/org rows) this is the REAL
// backend outcome: it fires through the deployed GraphQL with the page's own
// origin/CORS and the bearer pulled from localStorage, so a 2xx + the expected row goes
// THROUGH RLS (not around it). Returns the parsed { data, errors } or { errors:[…] }.
export async function gqlAuthed(endpoint, query, variables = {}) {
  if (!endpoint) return { data: null, errors: [{ message: 'no endpoint resolved (run-state/env)' }] };
  // Build a self-contained in-page async fetch. The token key is
  // constructive-auth-token:<namespace>[:scope]; value is JSON with accessToken|token.
  // NAMESPACE-AGNOSTIC token discovery: the CRM/dashboard host persists under
  // `:dashboard`, but the Blocks app template (BlocksRuntime namespaces=['auth','admin'])
  // persists the authed session under `:admin` (and may use `:auth`/`:app`). Scanning only
  // `:dashboard` found NO token on a Blocks app → an UNAUTHENTICATED fetch → currentUser=null
  // → resolveOwnedOrgId failed with "no currentUser" (the b2b org drivers all self-blocked).
  // We collect EVERY `constructive-auth-token:*` key that holds an accessToken|token and pick
  // by a small preference order (dashboard → admin → auth → app → first-seen) so the driver
  // works on both host shapes. (BLOCKS persists the same bearer under each namespace.)
  const js = `
    var endpoint = ${JSON.stringify(endpoint)};
    var query = ${JSON.stringify(query)};
    var variables = ${JSON.stringify(variables)};
    var token = null;
    try {
      var found = {}; // namespace/scope key -> token
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var m = /^constructive-auth-token:(.+)$/.exec(k);
        if (!m) continue;
        try { var v = JSON.parse(localStorage.getItem(k)); var t = (v && (v.accessToken || v.token)) || null; if (t) found[m[1]] = t; } catch (e) {}
      }
      var prefs = ['dashboard', 'admin', 'auth', 'app'];
      for (var p = 0; p < prefs.length && !token; p++) {
        for (var key in found) { if (key === prefs[p] || key.indexOf(prefs[p] + ':') === 0) { token = found[key]; break; } }
      }
      if (!token) { for (var anyKey in found) { token = found[anyKey]; break; } } // any token beats none
    } catch (e) {}
    var headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = 'Bearer ' + token;
    try {
      var res = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify({ query: query, variables: variables }) });
      var body = await res.json();
      return { status: res.status, data: (body && body.data) || null, errors: (body && body.errors) || null, hadToken: !!token };
    } catch (e) {
      return { status: 0, data: null, errors: [{ message: String((e && e.message) || e) }], hadToken: !!token };
    }`;
  try {
    return await abEvalAsync(js);
  } catch (e) {
    return { data: null, errors: [{ message: String((e && e.message) || e) }] };
  }
}

// Evaluate an ASYNC in-page body (with top-level await) and return the parsed JSON
// result. agent-browser's `eval` awaits a returned promise and JSON-encodes the result
// once; we wrap in an async IIFE and strip that single layer. Falls back to extracting
// the first {…}/[…] block if the runner prints extra noise around the JSON.
export async function abEvalAsync(js) {
  const raw = pageEvalRaw(`(async function(){ ${js} })()`);
  const text = (raw || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[[{].*[\]}]/s);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    throw new Error(`could not parse in-page eval as JSON: ${JSON.stringify(text).slice(0, 240)}`);
  }
}

// ── §2.4 Mailpit poller → { html, text, links[], params, message } | null.
// Polls the Mailpit v1 API for the newest message matching `to` (+ optional subject)
// created at/after `sinceMs` (capture Date.now() BEFORE triggering the send), then pulls
// the body and extracts the app link + its named URL params. Returns null on timeout.
export async function pollMailpit({ to, subjectIncludes, sinceMs = 0, timeoutMs = 20000 } = {}) {
  const base = (process.env.LIVE_QA_MAILPIT_URL || getMailpitUrl()).replace(/\/+$/, '');
  const fetchJson = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
  const addrMatches = (m) => {
    // Mailpit message summary: To is an array of { Address, Name }.
    const list = (m && (m.To || m.to)) || [];
    return list.some((a) => String((a && (a.Address || a.address)) || a).toLowerCase().includes(String(to).toLowerCase()));
  };
  const subjMatches = (m) =>
    !subjectIncludes || String((m && (m.Subject || m.subject)) || '').toLowerCase().includes(String(subjectIncludes).toLowerCase());
  const createdMs = (m) => {
    const c = (m && (m.Created || m.created)) || 0;
    const t = Date.parse(c);
    return Number.isNaN(t) ? 0 : t;
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await fetchJson(`${base}/api/v1/messages?limit=20`);
    const msgs = (list && (list.messages || list.Messages)) || [];
    const candidate = msgs
      .filter((m) => addrMatches(m) && subjMatches(m) && (!sinceMs || createdMs(m) >= sinceMs - 1000))
      .sort((a, b) => createdMs(b) - createdMs(a))[0];
    if (candidate) {
      const id = candidate.ID || candidate.id;
      const full = await fetchJson(`${base}/api/v1/message/${id}`);
      const html = (full && (full.HTML || full.html)) || '';
      const text = (full && (full.Text || full.text)) || '';
      const body = `${html}\n${text}`;
      const links = (body.match(/https?:\/\/[^\s"'<>)]+/g) || [])
        // HTML-entity-decode &amp; → & so multi-param links (?role_id=…&amp;reset_token=…) parse.
        .map((s) => s.replace(/&amp;/g, '&').replace(/[.,]+$/, ''));
      // Merge all params seen across the candidate links (verify/reset/delete carry token+ids).
      const params = {};
      for (const link of links) {
        try {
          new URL(link).searchParams.forEach((val, key) => {
            if (!(key in params)) params[key] = val;
          });
        } catch {
          /* skip non-URL */
        }
      }
      // Param-name BRIDGE (FLOW-QA mail2): the backend email templates emit verb-prefixed
      // token params (reset_token / verification_token / deletion_token / confirmation_token)
      // and camelCase ids, but the drivers + the reset/verify/delete BLOCKS read the generic
      // `token` / snake_case ids. Alias them so the driver extracts a token regardless of the
      // template's spelling (and then re-emits the generic names the blocks read). Generic
      // `token` always wins if already present.
      const alias = (canon, ...alts) => {
        if (params[canon] != null) return;
        for (const a of alts) if (params[a] != null) { params[canon] = params[a]; return; }
      };
      alias('token', 'reset_token', 'verification_token', 'verify_token', 'deletion_token', 'confirmation_token', 'confirm_token', 'email_token');
      alias('role_id', 'roleId');
      alias('email_id', 'emailId');
      alias('user_id', 'userId');
      return { html, text, links, params, message: candidate };
    }
    await sleepAsync(1000);
  }
  return null;
}

// Async sleep (the foreground `sleep` binary is blocked by the harness; setTimeout is fine).
export function sleepAsync(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── CLEAN-PROFILE / auth isolation ────────────────────────────────────────────
// The owner dogfood proved a STALE token in a polluted Chrome profile attaches a bogus
// `Authorization: Bearer <old-jwt>` to the UNAUTHENTICATED signUp call, which the auth
// server then rejects (UNAUTHENTICATED) — masking AND causing state-dependent failures.
// Before every flow's signup we wipe the APP-ORIGIN auth storage so signUp goes out with
// NO bearer (which is what an anonymous signUp must do). We must be standing on the app
// origin for localStorage/sessionStorage to be the APP's (cross-origin storage is
// partitioned), so callers navigate to the app origin first, then call this. We clear:
//   • EVERY `constructive-auth-token:*` key (the bearer the gqlAuthed fetch would pick up)
//     — at minimum `:admin`, plus `:dashboard`/`:auth`/`:app`/scoped variants,
//   • EVERY `constructive-remember-me:*` key (incl. `:admin`),
//   • then, defensively, ALL of localStorage + sessionStorage for this origin,
// and report how many auth keys were removed (evidence the wipe actually ran). Selector is
// the storage key by exact name / prefix — not DOM — so it is robust to block restyles.
// Generic for EVERY flow (the helper is origin-scoped, not flow-specific).
export function clearAuthState() {
  const removed = pageEvalJson(`
    var removed = [];
    try {
      // Pass 1 — explicitly the documented auth keys (admin namespace + common variants),
      // matched by prefix so scoped keys (…:admin:<scope>) are caught too.
      var prefixes = ['constructive-auth-token', 'constructive-remember-me'];
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k) continue;
        for (var p = 0; p < prefixes.length; p++) {
          if (k === prefixes[p] || k.indexOf(prefixes[p] + ':') === 0) { removed.push(k); localStorage.removeItem(k); break; }
        }
      }
      // Pass 2 — defensively clear the rest of this origin's web storage so NOTHING (a
      // cached session, a remembered email, an SDK cache) leaks across flows/runs.
      localStorage.clear();
    } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    return removed;`);
  return Array.isArray(removed) ? removed : [];
}

// ── B2B post-signup membership: now PLATFORM-NATIVE ─────────────────────────
// A fresh email-password signup on the b2b/org tier used to get a users row + a public
// org_memberships row but NOT the private org_memberships_sprt row the AuthzEntityMembership
// RLS reads, so the first org-scoped create was RLS-denied (upstream GAP-1b/1c). The platform
// now self-seeds that personal-org sprt row on signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED
// 2026-06-15), so the actor can create org-scoped rows immediately after signup with no
// post-signup reconcile step. The former harness-side after-signup hook (which shelled out to
// a reconcile script) is therefore removed — a genuine RLS denial now surfaces directly at the
// create assertion as a real backend signal, never masked.

// ── §2.5 Auth precondition — ensure a signed-in session (most flows need one).
// Reuses the EXACT signup steps the email-password driver proved. Idempotent within a
// run (skips when the authed-shell marker is already present, unless fresh=true).
// Returns { email, password } on success, or a STRING reason on failure (so the caller
// reports partial(<reason>) rather than a misleading flow-specific error).
export async function ensureSignedIn(ctx, { fresh = false } = {}) {
  const t = authTestids();
  const baseUrl = ctx.baseUrl;
  // Already signed in? (only honored when not asked for a fresh account)
  if (!fresh && pageEval(`!!${Q_TESTID(t.authedMarker)}`) === 'true') {
    return ctx._creds || { email: '', password: '' };
  }
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const email = fresh
    ? `liveqa+${stamp}@example.com`
    : process.env.LIVE_QA_SIGNUP_EMAIL || `liveqa+${stamp}@example.com`;
  const password = process.env.LIVE_QA_SIGNUP_PASSWORD || `LiveQa!${stamp}`;
  try {
    // CLEAN PROFILE FIRST: stand on the app origin, wipe any leftover auth storage, then
    // RELOAD so the app re-initializes with NO in-memory token — otherwise a stale bearer
    // (a prior session's, or another flow's) attaches to the anonymous signUp →
    // UNAUTHENTICATED (the exact failure the owner dogfood hit). Done for EVERY flow's
    // signup, not just owner. We navigate to the signup page (app origin) up front so the
    // storage we clear is the APP's; the reload lands us back here token-free.
    step('clear app-origin auth state (clean profile) before signup');
    navigate(`${baseUrl}${t.signupPath}`);
    const wiped = clearAuthState();
    step(`cleared ${wiped.length} auth storage key(s)${wiped.length ? ` (${wiped.join(', ')})` : ''}; reloading token-free`);
    reload();
    step(`open the sign-up page (${t.signupPath})`);
    navigate(`${baseUrl}${t.signupPath}`);
    if (pageEval(`!!${Q_TESTID(t.signupLink)}`) === 'true') clickTestid(t.signupLink);
    waitTestid(t.email, { what: `${t.email} (sign-up email field)` });
    step(`sign up ${email}`);
    fillTestid(t.email, email);
    fillTestid(t.password, password);
    if (pageEval(`!!${Q_TESTID(t.confirm)}`) === 'true') {
      step(`confirm-password field present — filling it (testid "${t.confirm}")`);
      fillTestid(t.confirm, password);
    }
    clickTestid(t.submit);
    step('assert the authenticated shell rendered');
    waitTestid(t.authedMarker, { what: `${t.authedMarker} (authenticated-only marker)`, timeoutMs: 25000 });
    // B2B tier: the platform self-seeds the fresh actor's personal-org membership row on signup
    // (PLATFORM-GAPS.md GAP-1b/1c, CLOSED), so the caller's first org-scoped create works with no
    // post-signup reconcile step. A genuine RLS denial now surfaces at the create assertion.
  } catch (err) {
    return `signup-failed (${(err && err.message) || String(err)})`;
  }
  const creds = { email, password };
  ctx._creds = creds; // cache so step-up / re-login flows can re-enter the password
  return creds;
}

// Sign IN an existing account (email + password) via the sign-in card. Used by the
// flows that prove a credential change by re-authenticating. Returns true on
// authed-shell, else a string reason.
export async function signInWith(ctx, email, password) {
  const t = authTestids();
  try {
    navigate(`${ctx.baseUrl}${t.signinPath}`);
    waitTestid(t.email, { what: `${t.email} (sign-in email field)` });
    fillTestid(t.email, email);
    fillTestid(t.password, password);
    clickTestid(t.signInSubmit);
    waitTestid(t.authedMarker, { what: `${t.authedMarker} after sign-in`, timeoutMs: 25000 });
    return true;
  } catch (err) {
    return `sign-in-failed (${(err && err.message) || String(err)})`;
  }
}

// Sign up a SECOND throwaway actor (to seed a pending-membership fixture) WITHOUT losing
// the primary actor's owned-org session. We sign out, sign up a fresh account, capture its
// currentUser.id, then sign the PRIMARY actor back in (ctx._creds) so the org OWNER is the
// one who drives approve/revoke afterwards. Returns { userId, email } or a string reason —
// the fixture seeder turns a reason into partial (never a hard fail). Best-effort throughout.
export async function signUpSecondActor(ctx) {
  const primary = ctx._creds && ctx._creds.email ? { ...ctx._creds } : null;
  // Mint a fresh, isolated account in the same browser (fresh:true forces a new signup).
  signOutBestEffort();
  const creds = await ensureSignedIn(ctx, { fresh: true });
  if (typeof creds === 'string') {
    // Restore the primary owner before bailing so later drivers keep their session.
    if (primary) await signInWith(ctx, primary.email, primary.password);
    return `2nd-actor signup failed (${creds})`;
  }
  // Read the new actor's id through its own authed session.
  let userId = '';
  try {
    const res = await gqlAuthed(ctx.authEndpoint, `query { currentUser { id } }`);
    userId = (res?.data?.currentUser?.id && String(res.data.currentUser.id)) || '';
  } catch {
    /* ignore — degrade to no id */
  }
  // Restore the PRIMARY owner's session (the one that owns the org we seed against). If we
  // can't, the caller's subsequent owner-only ops would run as the wrong actor — report it.
  if (primary) {
    const back = await signInWith(ctx, primary.email, primary.password);
    if (back !== true) return `seeded a 2nd actor but could not restore the org owner's session (${back})`;
    ctx._creds = primary; // keep the owner current for the detail drivers
  }
  if (!userId) return '2nd actor created but its currentUser.id was not resolvable';
  return { userId, email: creds.email };
}

// Sign OUT (best-effort; never throws). Used before a re-login assertion.
export function signOutBestEffort() {
  const t = authTestids();
  try {
    if (pageEval(`!!${Q_TESTID(t.signOut)}`) === 'true') {
      clickTestid(t.signOut);
      sleep(800);
      return;
    }
  } catch {
    /* ignore */
  }
  // No sign-out control on the current surface (the account page ships none). Fall back to
  // clearing the persisted auth token so the session ends: BlocksRuntime/TokenManager keeps
  // the access token in localStorage, so wiping it (then a reload) drops the authed session.
  // (FLOW-QA mail2 — needed so password-reset can reach the logged-out /forgot-password.)
  try {
    ab(['eval', 'try{localStorage.clear();sessionStorage.clear();}catch(e){}; true'], { allowFail: true });
    sleep(300);
  } catch {
    /* ignore */
  }
}

// The BLOCK-controlled auth testids + auth routes (shared by ensureSignedIn / signInWith
// and the email-password driver). All overridable via env for briefs that rename them.
// FormField renders data-testid={testId ?? field.name}: email field = 'email',
// password = 'password', sign-up submit = 'sign-up-submit', sign-in submit = 'sign-in-submit'.
export function authTestids() {
  return {
    email: process.env.LIVE_QA_TID_EMAIL || 'email',
    password: process.env.LIVE_QA_TID_PASSWORD || 'password',
    confirm: process.env.LIVE_QA_TID_CONFIRM || 'confirmPassword',
    submit: process.env.LIVE_QA_TID_AUTH_SUBMIT || 'sign-up-submit',
    signInSubmit: process.env.LIVE_QA_TID_SIGNIN_SUBMIT || 'sign-in-submit',
    signOut: process.env.LIVE_QA_TID_SIGNOUT || 'sign-out-button',
    signupPath: process.env.LIVE_QA_SIGNUP_PATH || '/sign-up',
    signinPath: process.env.LIVE_QA_SIGNIN_PATH || '/sign-in',
    signupLink: process.env.LIVE_QA_TID_SIGNUP_LINK || 'auth-signup-link',
    authedMarker: process.env.LIVE_QA_TID_AUTHED || 'authed-shell',
  };
}
