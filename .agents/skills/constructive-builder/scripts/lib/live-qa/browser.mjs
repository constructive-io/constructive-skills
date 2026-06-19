/**
 * browser.mjs — the agent-browser (Chrome via CDP) DRIVER + page primitives for live-QA.
 *
 * EXTRACTED (purely structural) from scripts/live-qa.mjs. This is the DOM/browser kit every
 * flow driver builds on: the `agent-browser` child-process wrapper, the run-isolation origin
 * guard, the page-eval bridge, and the data-testid/role-keyed primitives (navigate/reload/
 * fill/click/wait/count/visible/text + the row-scoped affordance resolver + sleep + the 2xx
 * network probe). NONE of these contain a verdict decision or a routeFor()/openAndAwaitMount()
 * contract call-site — those stay in live-qa.mjs (the verdict ledger + the static-parse
 * contract surface). Behavior is byte-identical: same definitions, only relocated; the only
 * change is that the once-module-level mutable EXPECTED_ORIGIN is now this module's own state,
 * set via setExpectedOrigin() and read via getExpectedOrigin() (the driver/main use the same
 * set-once-then-read pattern as before).
 *
 * Zero deps beyond Node (>=18) + the report.mjs reporter. No import-time side effects (nothing
 * runs until a primitive is called); the agent-browser daemon persists state across calls.
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AB, AB_TIMEOUT } from './report.mjs';

// REPO_ROOT = the skill root (the dir that holds scripts/). live-qa.mjs computed this as
// resolve(<scripts/>, '..'); from scripts/lib/live-qa/browser.mjs the same dir is three up.
// `ab()` passes it as the agent-browser child cwd (the comment notes cwd is irrelevant to the
// daemon — but we keep the EXACT same value so the spawn is byte-identical to before).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ── agent-browser driver (Chrome via CDP) ────────────────────────────────────
// Each call is a fresh `agent-browser <args>` process; the browser persists via the
// daemon, so state carries across calls. Returns { ok, stdout, stderr }.
export function ab(args, { allowFail = false } = {}) {
  const res = spawnSync(AB, args, {
    encoding: 'utf8',
    env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: AB_TIMEOUT },
    // agent-browser talks to its own daemon; cwd is irrelevant but keep it stable.
    cwd: REPO_ROOT,
  });
  if (res.error && res.error.code === 'ENOENT') {
    // run_live_qa already gated on a browser being present, so this should not
    // happen — but if the bin name differs, fail loudly rather than skip.
    throw new Error(
      `'${AB}' not found on PATH. run_live_qa is supposed to gate on this; set LIVE_QA_BROWSER_BIN to the agent-browser binary.`
    );
  }
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const ok = res.status === 0;
  if (!ok && !allowFail) {
    throw new AbError(`agent-browser ${args.join(' ')} exited ${res.status}`, stdout, stderr);
  }
  return { ok, stdout, stderr, status: res.status };
}
export class AbError extends Error {
  constructor(msg, stdout, stderr) {
    super(msg);
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// ── RUN-ISOLATION (GAP-1: cross-run contamination) ───────────────────────────
// agent-browser is a PERSISTENT daemon: a prior or concurrent dogfood run (another app's
// dev-server on a different port) may have left a tab/session live. If we start driving
// against whatever tab the daemon hands us, we can grab a STALE tab whose origin is some
// OTHER app and false-PASS/FAIL against it. Two generic guards (NEITHER app/db/port-
// specific — both derive purely from the app-under-test URL the gate handed us):
//   • isolateBrowserSession() — close EVERY agent-browser session once before driving, so
//     no stale tab from another run survives. The next `open` (our first navigate) starts a
//     fresh session pointed at THIS app. Best-effort: close failing must never block the run.
//   • EXPECTED_ORIGIN + assertActiveTabOrigin() — record the app-under-test's origin once,
//     then (in navigate) REFUSE to interact with a tab whose origin is a DIFFERENT app
//     origin. Same-origin-as-the-app (incl. the daemon's pre-nav about:blank/blank, which is
//     not a competing app) is allowed; only an affirmatively-different http(s) origin is a
//     hard stop. This is what stops "drove the wrong run's app and reported a verdict for it".
// Disable the origin assertion (rare custom multi-origin run) with LIVE_QA_ASSERT_ORIGIN=0.
let EXPECTED_ORIGIN = ''; // set once from ctx.baseUrl in main(); '' ⇒ guard inert (unit/import).
export function getExpectedOrigin() {
  return EXPECTED_ORIGIN;
}
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
export function setExpectedOrigin(baseUrl) {
  EXPECTED_ORIGIN = originOf(baseUrl);
  return EXPECTED_ORIGIN;
}
export function originAssertEnabled() {
  const v = (process.env.LIVE_QA_ASSERT_ORIGIN || '').trim();
  return !/^(0|false|no|off)$/i.test(v); // strict by default; only an explicit falsy disables.
}
// Close every persistent agent-browser session so no stale tab from a prior/concurrent run
// survives into this one. Never throws (teardown-class op) — a close failure must not block QA.
export function isolateBrowserSession() {
  try {
    ab(['close', '--all'], { allowFail: true });
  } catch {
    /* a daemon with no open session / a close hiccup is fine — the next open starts clean */
  }
}
// REFUSE to drive a tab whose origin is a DIFFERENT app than the one under test. Reads the
// active tab's origin via the page itself (`location.origin`, same unwrap as pageEval). The
// daemon's pre-navigation blank tab reports origin 'null'/'' (NOT a competing app) → allowed.
// Only an affirmatively-different http(s) origin throws. Generic: compares to EXPECTED_ORIGIN
// (derived from the app URL the gate handed us), never a hard-coded host/port. `where` labels
// the call site in the error. Best-effort read: if we can't read the origin at all, we do NOT
// block (don't convert an unrelated CLI hiccup into a false gate failure).
export function assertActiveTabOrigin(where = 'drive') {
  if (!EXPECTED_ORIGIN || !originAssertEnabled()) return;
  let active = '';
  try {
    active = pageEval('location.origin');
  } catch {
    return; // can't read — don't manufacture a failure from a transient CLI/daemon hiccup.
  }
  // 'null'/'' = a blank/opaque tab (the daemon's pre-nav state) — not a competing app origin.
  if (!active || active === 'null') return;
  if (active !== EXPECTED_ORIGIN) {
    throw new Error(
      `live-QA refusing to ${where}: the active browser tab is on origin ${active}, not the app under test (${EXPECTED_ORIGIN}). ` +
        `A stale/concurrent agent-browser tab (another run's dev-server) was grabbed — run isolation failed. ` +
        `(set LIVE_QA_ASSERT_ORIGIN=0 to bypass for a deliberate multi-origin run.)`
    );
  }
}

// Run JS in the page and return its result as a NATURAL string. agent-browser's
// `eval` JSON-ENCODES the evaluated value before printing (a page string "ok" comes
// back on stdout as the 5 bytes `"ok"`, a boolean as `true`, a number as `5`). So we
// JSON-parse that one wrapper layer and return the unwrapped scalar as a string —
// `'ok'`, `'true'`, `'5'` — which is exactly what the callers below compare against
// (`=== 'true'`, `Number.parseInt`, `=== 'ok'`). Without unwrapping, a string result
// keeps agent-browser's quotes (`"ok"`) and every string compare/fill check fails.
export function pageEvalRaw(js) {
  const { stdout } = ab(['eval', js]);
  return stdout.trim();
}
export function pageEval(js) {
  const raw = pageEvalRaw(js);
  try {
    const v = JSON.parse(raw); // strip agent-browser's single JSON-encoding layer
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v); // objects/arrays → JSON text
    return String(v); // string/number/boolean → natural string form
  } catch {
    // Not JSON-wrapped (older agent-browser, or already-bare output) — use as-is.
    return raw;
  }
}

// Run JS that returns a JSON-able value; return the PARSED value. agent-browser already
// JSON-encodes the eval result, so we must NOT wrap the expression in our own
// JSON.stringify (that double-encodes — a returned 'ok' would come back as the string
// '"ok"'). Evaluate the expression directly and parse agent-browser's single encoding.
export function pageEvalJson(js) {
  const raw = pageEvalRaw(`(function(){ ${js} })()`);
  const text = raw.trim();
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
    throw new Error(`could not parse agent-browser eval output as JSON: ${JSON.stringify(text).slice(0, 240)}`);
  }
}

// ── page primitives, ALL keyed on data-testid / role (never text/CSS) ─────────
// We do the DOM work inside `eval` so selection + native input events + assertions
// share one robust primitive and we never hand fragile selector strings across the
// CLI shell boundary. data-testid is the contract blocks must honor.

export const Q_TESTID = (id) =>
  `document.querySelector('[data-testid=${JSON.stringify(id)}]')`;

// ── GAP-6: interactability guard ──────────────────────────────────────────────
// A driver that fills/clicks an element WITHOUT checking it is visible would happily
// drive a `display:none` / `visibility:hidden` / zero-size node and report success —
// masking a real regression (a block that renders the control but hides it, e.g. a
// collapsed section, an aria-hidden overlay, a 0×0 button). `isInteractable(el)` is the
// shared in-page predicate every fill/click primitive runs once it has resolved the
// element by data-testid: the element must be (a) connected to a layout box
// (offsetParent !== null — null for display:none and for position:fixed-but-hidden), OR
// have a non-empty client rect; AND (b) not display:none / visibility:hidden / opacity:0
// per the computed style on itself or any ancestor; AND (c) have a real size
// (width·height > 0). It returns true for a genuinely-interactable control and false for
// an invisible one, so the primitive can FAIL LOUDLY ('invisible') rather than silently
// "succeed" against a hidden node. Pure DOM string (inlined into each primitive's eval) —
// `EL` is the in-page variable already holding the resolved element.
export const IS_INTERACTABLE_JS = (EL) => `(function(__el){
    if (!__el) return false;
    // Walk self+ancestors for display:none / visibility:hidden / opacity:0 (any one hides it).
    for (var n = __el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = window.getComputedStyle(n);
      if (!cs) continue;
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    // offsetParent === null ⇒ not laid out (display:none subtree); allow position:fixed
    // (offsetParent is null by spec) only when it still has a real client rect.
    var rect = __el.getClientRects && __el.getClientRects().length ? __el.getBoundingClientRect() : null;
    var hasBox = (__el.offsetParent !== null) || (rect && rect.width > 0 && rect.height > 0);
    if (!hasBox) return false;
    // Real size: a 0×0 control cannot be interacted with.
    if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
    return true;
  })(${EL})`;

export function navigate(url) {
  ab(['open', url]);
  ab(['wait', '--load', 'networkidle'], { allowFail: true });
  // RUN-ISOLATION (GAP-1): when we just navigated to an APP-origin URL, confirm the tab
  // actually landed there. If the daemon handed us a stale tab on another run's origin (and
  // the open silently no-op'd / a concurrent tab is active), this throws rather than letting
  // the driver interact with the wrong app. Only asserted when the target IS the app origin
  // (external links — e.g. a 2nd-origin handoff — legitimately differ and are not checked).
  if (EXPECTED_ORIGIN && originOf(url) === EXPECTED_ORIGIN) assertActiveTabOrigin('navigate');
}

export function reload() {
  ab(['reload']);
  ab(['wait', '--load', 'networkidle'], { allowFail: true });
}

// Wait until a [data-testid] element exists (polls in-page). Throws on timeout.
export function waitTestid(id, { timeoutMs = 20000, what = id } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const present = pageEval(`!!${Q_TESTID(id)}`);
    if (present === 'true') return;
    sleep(400);
  }
  throw new Error(`timed out waiting for [data-testid="${what}"] (${timeoutMs}ms)`);
}

// Fill an input/textarea selected by data-testid using the NATIVE value setter +
// real input/change events, so React's controlled inputs register the change.
export function fillTestid(id, value) {
  // GAP-6: resolve the element, then ASSERT it is interactable BEFORE writing — a
  // display:none / visibility:hidden / 0×0 input must fail loudly ('invisible'), not be
  // silently filled (which would mask a block that renders a hidden field).
  const js = `
    var el = ${Q_TESTID(id)};
    if (!el) return 'missing';
    if (!${IS_INTERACTABLE_JS('el')}) return 'invisible';
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';`;
  const out = pageEvalJson(`${js}`);
  if (out === 'invisible')
    throw new Error(`[data-testid="${id}"] is present but NOT interactable (display:none / visibility:hidden / 0×0) — refusing to fill a hidden element (GAP-6)`);
  if (out !== 'ok') throw new Error(`could not fill [data-testid="${id}"] (got: ${out})`);
}

// Click an element selected by data-testid (buttons, links, submit).
export function clickTestid(id) {
  // GAP-6: the click target must be interactable — a present-but-hidden control returns
  // 'invisible' and we throw, so driving an offscreen/display:none button fails loudly.
  const js = `
    var el = ${Q_TESTID(id)};
    if (!el) return 'missing';
    if (!${IS_INTERACTABLE_JS('el')}) return 'invisible';
    el.click();
    return 'ok';`;
  const out = pageEvalJson(`${js}`);
  if (out === 'invisible')
    throw new Error(`[data-testid="${id}"] is present but NOT interactable (display:none / visibility:hidden / 0×0) — refusing to click a hidden element (GAP-6)`);
  if (out !== 'ok') throw new Error(`could not click [data-testid="${id}"] (got: ${out})`);
}

// Click an element by data-testid and RE-ASSERT an outcome predicate, retrying the click
// when the first attempt didn't take (the agent-browser create/confirm clicks are flaky:
// a click can land before the handler is bound, or be swallowed by a transient overlay).
// `verify()` returns true once the click took (e.g. a dialog opened, a row appeared). On
// each retry we (a) re-resolve by the SAME data-testid (the contract selector) and fire a
// native pointer sequence in addition to .click() — a DOM-level fallback that triggers
// handlers bound to pointer/mouse events — then re-check `verify()`. Returns true if the
// outcome held within `tries`, false otherwise (caller decides pass/partial). NEVER throws
// (best-effort), so a flaky-but-eventually-fine click doesn't hard-fail a real success.
export function clickTestidVerify(id, verify, { tries = 3, settleMs = 600 } = {}) {
  const fireNative = `
    var el = ${Q_TESTID(id)};
    if (!el) return 'missing';
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var opts = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new MouseEvent('pointerdown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (e) {}
    try { el.click(); } catch (e) {}
    return 'ok';`;
  for (let i = 0; i < tries; i++) {
    try {
      if (i === 0) clickTestid(id); // first attempt: the plain .click() (unchanged path)
      else pageEvalJson(fireNative); // retries: native pointer sequence + .click() fallback
    } catch {
      /* the element may be missing on this tick — fall through to verify + retry */
    }
    sleep(settleMs);
    try {
      if (verify()) return true;
    } catch {
      /* verify itself can transiently throw mid-render — retry */
    }
  }
  // One last verify after the loop (the outcome may have landed on the final settle tick).
  try {
    return !!verify();
  } catch {
    return false;
  }
}

// Count elements matching a data-testid (e.g. list rows share one testid).
export function countTestid(id) {
  const n = pageEval(`document.querySelectorAll('[data-testid=${JSON.stringify(id)}]').length`);
  return Number.parseInt(n, 10) || 0;
}

// GAP-6 companion: true ONLY when the element exists AND is interactable (visible + sized).
// Use this — not a bare presence check — to detect that a DIALOG/section has VISIBLY
// appeared (Base UI portals can keep a CLOSED dialog in the DOM hidden, so presence ≠
// open). Reuses the same IS_INTERACTABLE_JS predicate the fill/click primitives enforce,
// so "the dialog is up" means the same thing as "we can drive it".
export function visibleTestid(id) {
  const js = `
    var el = ${Q_TESTID(id)};
    if (!el) return false;
    return ${IS_INTERACTABLE_JS('el')};`;
  return pageEvalJson(js) === true;
}

// True if any element with this data-testid contains the given text. Used ONLY to
// confirm a row we just created is the one that persisted — the SELECTOR is still a
// testid; text is the payload we wrote, not a brittle locator.
export function testidContainsText(id, text) {
  const js = `
    var els = Array.prototype.slice.call(document.querySelectorAll('[data-testid=${JSON.stringify(id)}]'));
    return els.some(function (e) { return (e.textContent || '').indexOf(${JSON.stringify(text)}) !== -1; });`;
  return pageEvalJson(js) === true;
}

// Like testidContainsText but the testid is a PREFIX (dynamic per-row testids such as
// email-address-${id} / email-row-${id}). `prefixRe` is a RegExp matching the testid
// attribute; returns true if ANY such element's text contains `text`. Selector is still
// the data-testid attribute (matched by prefix), never CSS/visible-text.
export function testidContainsTextAny(prefixRe, text) {
  const js = `
    var src = ${JSON.stringify(prefixRe.source)}, flags = ${JSON.stringify(prefixRe.flags)};
    var re = new RegExp(src, flags);
    var els = Array.prototype.slice.call(document.querySelectorAll('[data-testid]'));
    return els.some(function (e) {
      var tid = e.getAttribute('data-testid') || '';
      return re.test(tid) && (e.textContent || '').indexOf(${JSON.stringify(text)}) !== -1;
    });`;
  return pageEvalJson(js) === true;
}

// ── ROW-SCOPED affordance resolution (GAP-3: row matching) ───────────────────
// The edit/delete legs must act on the row WE just created — not the FIRST row in the list.
// A bare clickTestid('<entity>-edit') resolves document.querySelector(...) = the FIRST match,
// which equals our row ONLY on a clean table; on a table that already holds other tenants'/
// prior rows it mis-fires on someone else's row. This in-page resolver finds the affordance
// (edit/delete) that belongs to the row whose visible text contains `rowText` (the unique
// stamped title the driver created). Strategy, all by data-testid / DOM structure (never CSS/
// visible-text as a SELECTOR — `rowText` is the payload we wrote, matched as row identity):
//   1) Collect every affordance element (data-testid == affordanceTestid).
//   2) For each, find the ROW it lives in: the nearest ancestor with data-testid==rowTestid
//      (the per-row container) IF that ancestor's text contains rowText; else the nearest
//      ancestor (of any kind) whose text contains rowText (covers list shapes where the
//      affordance sits in a sibling cell within a shared row wrapper). Pick the affordance
//      whose row matches our title.
//   3) If NO affordance's row matches rowText (e.g. a brand-new row not yet labeled, or the
//      title lives only in an off-row cell), fall back to the FIRST affordance — preserving
//      the prior behavior on a clean/single-row table (where the first row IS ours), so the
//      frozen canary is unchanged. The caller is told which path was taken.
// Returns { matched:boolean, count:number } — matched=true when we clicked the title-scoped
// affordance, false when we fell back to first. Generic for ANY entity: rowTestid +
// affordanceTestid are the caller's resolved testids and rowText is the created title; no
// entity/field/table literal appears here.
export const ROW_AFFORDANCE_RESOLVE_JS = (affordanceTestid, rowTestid, rowText) => `
    var affs = Array.prototype.slice.call(document.querySelectorAll('[data-testid=${JSON.stringify(affordanceTestid)}]'));
    if (!affs.length) return { found: false };
    var needle = ${JSON.stringify(rowText)};
    var ROW_TID = ${JSON.stringify(rowTestid)};
    // Does THIS affordance belong to the row carrying our title? Decision rule (generic):
    //   • If the affordance has a row-container ancestor (data-testid==ROW_TID), that container
    //     ALONE decides: ours IFF its text contains the needle. We do NOT climb past it to a
    //     looser ancestor — a shared list/page wrapper (or <body>) contains the needle SOMEWHERE
    //     for EVERY affordance, which would false-match the first affordance to our title. This
    //     was the trap: the per-row container is the authoritative scope when present.
    //   • Only when NO ROW_TID ancestor exists at all (a list shape with no per-row testid
    //     container) do we fall back to the SMALLEST ancestor whose text contains the needle —
    //     and require it to NOT enclose any OTHER affordance of this testid, so we never pick a
    //     shared wrapper that wraps several affordances (which would again mis-scope).
    function rowMatches(el) {
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.getAttribute && n.getAttribute('data-testid') === ROW_TID) {
          return (n.textContent || '').indexOf(needle) !== -1; // the row container is authoritative.
        }
      }
      // No per-row container: smallest ancestor that contains the needle AND wraps exactly ONE
      // affordance of this testid (so it's THIS affordance's own row, not a shared wrapper).
      for (var m = el; m && m.nodeType === 1; m = m.parentElement) {
        if ((m.textContent || '').indexOf(needle) === -1) continue;
        if (m.querySelectorAll('[data-testid=${JSON.stringify(affordanceTestid)}]').length === 1) return true;
        break; // the first needle-bearing ancestor already wraps >1 affordance → shared wrapper.
      }
      return false;
    }
    var target = null;
    for (var i = 0; i < affs.length; i++) { if (rowMatches(affs[i])) { target = affs[i]; break; } }
    var matched = !!target;
    if (!target) target = affs[0]; // fall back to first (clean/single-row table → that IS our row)`;

// Click the edit/delete affordance for the row carrying `rowText`. Mirrors clickTestid's
// interactability guard. Returns { matched, count } (see resolver). Throws like clickTestid
// when the affordance is missing/hidden.
export function clickRowAffordance(affordanceTestid, rowTestid, rowText) {
  const out = pageEvalJson(`${ROW_AFFORDANCE_RESOLVE_JS(affordanceTestid, rowTestid, rowText)}
    if (target == null) return { found: false };
    if (!${IS_INTERACTABLE_JS('target')}) return { found: true, matched: matched, count: affs.length, interactable: false };
    target.click();
    return { found: true, matched: matched, count: affs.length, interactable: true };`);
  if (!out || out.found !== true)
    throw new Error(`no [data-testid="${affordanceTestid}"] affordance found to act on the row "${rowText}"`);
  if (out.interactable === false)
    throw new Error(`[data-testid="${affordanceTestid}"] for row "${rowText}" is present but NOT interactable (display:none / visibility:hidden / 0×0) — refusing to click a hidden element (GAP-6)`);
  return { matched: !!out.matched, count: out.count || 0 };
}

// Retry-with-verify variant of clickRowAffordance (mirrors clickTestidVerify): clicks the
// title-scoped affordance, re-asserts `verify()`, retrying with a native pointer sequence on
// the SAME row-scoped target. NEVER throws (best-effort) — returns { ok, matched, count }.
export function clickRowAffordanceVerify(affordanceTestid, rowTestid, rowText, verify, { tries = 3, settleMs = 600 } = {}) {
  const fireNative = `${ROW_AFFORDANCE_RESOLVE_JS(affordanceTestid, rowTestid, rowText)}
    if (target == null) return { found: false };
    try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
    var opts = { bubbles: true, cancelable: true, view: window };
    try { target.dispatchEvent(new MouseEvent('pointerdown', opts)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('click', opts)); } catch (e) {}
    try { target.click(); } catch (e) {}
    return { found: true, matched: matched, count: affs.length };`;
  let matched = false;
  let count = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = i === 0 ? clickRowAffordance(affordanceTestid, rowTestid, rowText) : pageEvalJson(fireNative);
      if (r && typeof r.matched === 'boolean') matched = r.matched;
      if (r && typeof r.count === 'number') count = r.count;
    } catch {
      /* element may be missing on this tick — fall through to verify + retry */
    }
    sleep(settleMs);
    try {
      if (verify()) return { ok: true, matched, count };
    } catch {
      /* verify can transiently throw mid-render — retry */
    }
  }
  try {
    return { ok: !!verify(), matched, count };
  } catch {
    return { ok: false, matched, count };
  }
}

export function sleep(ms) {
  // Synchronous sleep without a foreground `sleep` binary (which the harness blocks)
  // and without blocking on a child longer than needed: spin on Atomics.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

// ── network assertion: did the data round-trip return 2xx? ───────────────────
// `agent-browser network requests` lists captured requests; we assert at least one
// GraphQL POST returned a 2xx during the action. STRICTLY best-effort: this is only a
// positive signal. It returns:
//   • true  — a captured graphql request shows a 2xx (definitive success), else
//   • null  — INCONCLUSIVE (cannot tell from here): command failed, OR the CLI build
//             does not passively capture / expose status (agent-browser 0.14.x prints
//             "No requests captured" unless monitoring was started — so the log is
//             empty even on a real successful write). The persisted-after-reload UI
//             assertion below is the REAL proof of a 2xx + committed write.
// It must NEVER return false on an empty/no-capture log (that is "don't know", not
// "the request failed") — returning false there would hard-fail a flow whose write
// actually succeeded. Only an affirmatively-captured non-2xx graphql request is a fail.
export function graphqlHadSuccess() {
  const { stdout, ok } = ab(['network', 'requests', '--filter', 'graphql'], { allowFail: true });
  if (!ok) return null; // command failed — can't tell from here
  if (/\b2\d\d\b/.test(stdout)) return true; // a captured graphql request shows 2xx
  // No 2xx in the dump. If we can SEE a captured graphql request line that affirmatively
  // shows a non-2xx (4xx/5xx) status, that's a real failure; otherwise (no graphql lines,
  // empty log, "No requests captured") it is INCONCLUSIVE → null, not a failure.
  if (/graphql/i.test(stdout) && /\b[45]\d\d\b/.test(stdout)) return false;
  return null;
}
