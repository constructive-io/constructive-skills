/**
 * report.mjs — the tiny TTY reporter + run_live_qa contract config for the live-QA driver.
 *
 * EXTRACTED (purely structural) from scripts/live-qa.mjs so the reporter (`C`/`log`/`step`)
 * and the agent-browser contract constants (BASE_URL / AB / AB_TIMEOUT) have ONE home shared
 * by the driver file and the browser/session helper modules. Zero deps; no import-time side
 * effects beyond reading process.stdout.isTTY / process.env (the SAME reads as before — the
 * consts are evaluated once at import, exactly as the module-level consts were in live-qa.mjs).
 * Behavior is byte-identical: these are the same definitions, only relocated.
 */

// ── tiny reporter ───────────────────────────────────────────────────────────
export const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s, yellow: (s) => s };
export const log = (s = '') => console.log(s);
export const step = (s) => console.log(`    ${C.dim('·')} ${s}`);

// ── config from the run_live_qa contract ─────────────────────────────────────
// NOTE: drivers no longer read this BASE_URL directly — they use ctx.baseUrl from
// resolveAppContext() (run-state → brief → env → default). This kept const is the
// gate-exported value resolveAppContext() treats as HIGHEST precedence; retained for
// backward-compat / any custom override path that still references the bare URL.
export const BASE_URL = (process.env.LIVE_QA_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
export const AB = process.env.LIVE_QA_BROWSER_BIN || 'agent-browser';
// agent-browser's per-command Playwright timeout (ms). Generous: a cold Next dev
// server + per-DB GraphQL round-trip can be slow on first paint.
export const AB_TIMEOUT = process.env.LIVE_QA_AB_TIMEOUT || '30000';
