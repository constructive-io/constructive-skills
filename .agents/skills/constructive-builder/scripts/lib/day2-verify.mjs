#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * day2-verify.mjs — the DAY-2 DUAL-ASSERTION helper.
 *
 * After a day-2 turn applies one schema/flow CHANGE to an already-built app, a "green"
 * turn must prove TWO things, not one:
 *   (a) NEW CAPABILITY — the thing the turn added round-trips end-to-end in a real
 *       browser (its new flow's signup → action → reload → asserted-persisted), AND
 *   (b) REGRESSION — every flow that worked BEFORE the change STILL works (the change
 *       didn't break the baseline).
 * A turn that passes (a) but fails (b) is a regression masquerading as a feature; a turn
 * that passes (b) but fails (a) is a no-op masquerading as a feature. This helper asserts
 * BOTH and returns a single structured verdict so the runner/scorecard can record it.
 *
 * ── HOW IT DRIVES (reuse, not reinvent) ──────────────────────────────────────
 * It does NOT re-implement the agent-browser driver. It SHELLS OUT to the existing
 * scripts/live-qa.mjs — the same driver scripts/verify-phase.sh's run_live_qa() runs —
 * once per assertion, scoping the flow set with LIVE_QA_FLOWS (csv). live-qa.mjs already:
 *   • resolves the brief + per-app run-state (APP_ID), derives per-entity testids,
 *   • drives Chrome via the agent-browser CLI, iterates each named flow's happy path,
 *   • exits 0 IFF every named flow passes (a documented-gap partial is still green; a
 *     broken/unmounted partial or hard fail is non-zero) — exactly the semantics we want.
 * So "new capability passes" === live-qa exit 0 for the new-capability flow(s), and
 * "regression passes" === live-qa exit 0 for the regression flow(s). We reproduce the
 * SAME env contract run_live_qa() hands the driver (cwd=app workspace; LIVE_QA_BASE_URL +
 * BASE_URL; an ABSOLUTE LIVE_QA_SPEC; APP_ID; any LIVE_QA_CRUD_PATH/testids the caller set).
 *
 * GENERIC BY CONSTRUCTION. Every app-specific value — which flows are "new", which are
 * "regression", the CRUD route to drive — comes from the ARGUMENTS (which the runner reads
 * from the turn's turns.json entry: new_capability_assert + regression_flows). Nothing here
 * hard-codes a domain/entity/flow. The CRUD path is just forwarded to the driver, which
 * DERIVES the entity testids from the brief itself.
 *
 * ── ASSERTIONS ────────────────────────────────────────────────────────────────
 * new_capability_assert (the turn's new behavior):
 *   { flows: ["<flow-id>", ...], crud_path?: "/things", base_url?, spec? }
 *   — drive exactly these flows (csv → LIVE_QA_FLOWS). crud_path (optional) picks WHICH
 *     entity the driver targets for a crud flow (LIVE_QA_CRUD_PATH); the driver derives the
 *     entity's testids from the brief — we never pin testids here. An EMPTY/absent flows[]
 *     means "this turn adds no NEW user-visible flow" (e.g. an additive column) → new_capability
 *     is reported `n/a` (not a fail): there is nothing new to round-trip, only a regression to
 *     guard. The persisted-effect proof is the same one live-qa enforces (2xx + survives reload).
 * regression_flows (the baseline that must still pass):
 *   ["<flow-id>", ...] — drive exactly these (csv → LIVE_QA_FLOWS). Empty/absent → regression
 *     is reported `n/a` (nothing to guard — unusual, but not a fail).
 *
 * ── VERDICT (returned + printed as JSON) ──────────────────────────────────────
 *   {
 *     new_capability: "pass" | "fail" | "n/a",
 *     regression:     "pass" | "fail" | "n/a",
 *     overall:        "pass" | "fail",       // pass IFF neither sub-assertion is "fail"
 *     details: { new_capability: {...}, regression: {...} }   // flows[], exit, evidence
 *   }
 * overall is "pass" only when NO sub-assertion failed (an "n/a" leg does not fail the turn).
 *
 * ── INVOCATION ────────────────────────────────────────────────────────────────
 * Programmatic (the runner uses this):
 *   import { dualVerify } from './lib/day2-verify.mjs';
 *   const verdict = await dualVerify({ appDir, brief, baseUrl, appId,
 *       newCapability: { flows, crudPath }, regressionFlows });
 * CLI (handy for a one-off / the runner via `node`):
 *   node scripts/lib/day2-verify.mjs \
 *     --app-dir <abs> --brief <abs> --base-url http://localhost:3085 [--app-id <appId>] \
 *     --new-flows email-password,password-reset [--crud-path /<entity-plural>] \
 *     --regression-flows email-password
 *   → prints the verdict JSON to stdout; exit 0 iff overall==pass.
 *
 * Zero dependencies. Pure Node (>=18). Drives Chrome only via the existing live-qa.mjs +
 * its agent-browser CLI — adds no browser code of its own.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // scripts/lib
const SCRIPTS_DIR = resolve(SCRIPT_DIR, '..'); // scripts/
const LIVE_QA = join(SCRIPTS_DIR, 'live-qa.mjs'); // the driver we reuse

// ── tiny colorizer (matches the live-qa/report.mjs palette; degrades when piped) ──
const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;
const c = (code, s) => (useColor ? `[${code}m${s}[0m` : String(s));
const C = {
  bold: (s) => c('1', s),
  dim: (s) => c('2', s),
  red: (s) => c('0;31', s),
  green: (s) => c('0;32', s),
  yellow: (s) => c('1;33', s),
};

/** Normalize a flow spec (array | csv string | falsy) into a clean string[]. */
function asFlowList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Run scripts/live-qa.mjs for EXACTLY the given flow subset and map its exit code to a
 * leg verdict. This is the single point of reuse — we hand the driver the SAME contract
 * run_live_qa() does (cwd=appDir; LIVE_QA_BASE_URL + BASE_URL; absolute LIVE_QA_SPEC;
 * LIVE_QA_FLOWS scopes the subset; APP_ID + any LIVE_QA_CRUD_PATH forwarded).
 *
 * @returns { result: 'pass'|'fail', exit, flows, crudPath, evidence, output }
 */
function driveFlows({ appDir, brief, baseUrl, appId, flows, crudPath, label, captureOutput }) {
  const flowList = asFlowList(flows);
  if (!flowList.length) {
    return { result: 'n/a', exit: null, flows: [], crudPath: crudPath || null, evidence: `no ${label} flows to drive` };
  }
  if (!existsSync(LIVE_QA)) {
    return {
      result: 'fail',
      exit: null,
      flows: flowList,
      crudPath: crudPath || null,
      evidence: `live-qa driver not found at ${LIVE_QA} — cannot drive ${label}`,
    };
  }

  const env = {
    ...process.env,
    // The SAME two vars run_live_qa exports — the app URL the driver attaches to.
    LIVE_QA_BASE_URL: baseUrl,
    BASE_URL: baseUrl,
    // Scope the driver to exactly this leg's flows (csv). live-qa's resolveRequiredFlows()
    // honors LIVE_QA_FLOWS first, so the OTHER flows in the brief are NOT driven for this leg.
    LIVE_QA_FLOWS: flowList.join(','),
  };
  // Absolute brief → the driver runs with cwd=appDir; a relative spec would existsSync()
  // against the wrong dir and resolve ZERO flows (the same trap verify-gates.sh §5b avoids).
  if (brief) env.LIVE_QA_SPEC = isAbsolute(brief) ? brief : resolve(process.cwd(), brief);
  // Per-app state isolation: pass APP_ID so the driver reads build/<app-id>/ not a foreign legacy.
  if (appId) env.APP_ID = appId;
  // crud_path selects WHICH entity a crud flow drives; the driver DERIVES the testids from the
  // brief (never pinned here) — exactly the genericity-check.sh convention.
  if (crudPath) env.LIVE_QA_CRUD_PATH = crudPath;

  const res = spawnSync('node', [LIVE_QA], {
    cwd: appDir,
    env,
    encoding: 'utf8',
    // When capturing (programmatic use) we keep stdout/stderr so the runner can log; when not
    // capturing (CLI), inherit so the driver's live table streams straight through.
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });

  const output = captureOutput ? `${res.stdout || ''}${res.stderr || ''}` : '';
  // live-qa exits 0 IFF every named flow passes (documented-gap partials stay green; a broken
  // partial / hard fail / coverage gap is non-zero) — precisely the leg semantics we want.
  const exit = res.status == null ? (res.error ? 1 : 1) : res.status;
  const ok = exit === 0;
  let evidence;
  if (ok) {
    evidence = `${label}: live-qa PASS for [${flowList.join(', ')}]`;
  } else if (res.error) {
    evidence = `${label}: could not launch live-qa (${res.error.message})`;
  } else {
    // Surface the driver's OVERALL/summary line if we captured it; else just the exit code.
    const tail = output
      .split('\n')
      .reverse()
      .find((l) => /OVERALL:|summary:|coverage gap|no live-QA script/.test(l));
    evidence = `${label}: live-qa FAIL (exit ${exit}) for [${flowList.join(', ')}]${tail ? ` — ${tail.replace(/\[[0-9;]*m/g, '').trim()}` : ''}`;
  }
  return { result: ok ? 'pass' : 'fail', exit, flows: flowList, crudPath: crudPath || null, evidence, output };
}

/**
 * dualVerify — assert BOTH legs and fold into one verdict.
 *
 * @param {object} o
 * @param {string} o.appDir            built app workspace root (driver cwd)
 * @param {string} o.brief             brief path (absolutized before handing to the driver)
 * @param {string} o.baseUrl           running app URL (LIVE_QA_BASE_URL/BASE_URL)
 * @param {string} [o.appId]           per-app state id (APP_ID) — keeps state isolated
 * @param {object} [o.newCapability]   { flows: string[]|csv, crudPath?: string }
 * @param {string[]|string} [o.regressionFlows]  the baseline flows to re-assert
 * @param {boolean} [o.captureOutput=true]  capture driver output (false → stream it)
 * @returns {Promise<object>} the verdict (also see the file header)
 */
export async function dualVerify(o) {
  const {
    appDir,
    brief,
    baseUrl,
    appId,
    newCapability = {},
    regressionFlows,
    captureOutput = true,
  } = o || {};

  if (!appDir) throw new Error('dualVerify: appDir is required (the built app workspace root)');
  if (!baseUrl) throw new Error('dualVerify: baseUrl is required (the running app URL)');

  // (a) NEW CAPABILITY — drive the turn's new flow(s).
  const newLeg = driveFlows({
    appDir,
    brief,
    baseUrl,
    appId,
    flows: newCapability.flows,
    crudPath: newCapability.crudPath || newCapability.crud_path,
    label: 'new-capability',
    captureOutput,
  });

  // (b) REGRESSION — drive the baseline flow(s) that must STILL pass. Reuse the SAME crud_path
  // the new leg used IFF the regression set needs an entity target and the caller didn't give a
  // separate one; harmless for non-crud flows (the driver ignores it for those).
  const regLeg = driveFlows({
    appDir,
    brief,
    baseUrl,
    appId,
    flows: regressionFlows,
    crudPath: newCapability.crudPath || newCapability.crud_path,
    label: 'regression',
    captureOutput,
  });

  // overall FAILS iff EITHER sub-assertion failed; an "n/a" leg is neutral.
  const overall = newLeg.result === 'fail' || regLeg.result === 'fail' ? 'fail' : 'pass';

  return {
    new_capability: newLeg.result,
    regression: regLeg.result,
    overall,
    details: {
      new_capability: { flows: newLeg.flows, crud_path: newLeg.crudPath, exit: newLeg.exit, evidence: newLeg.evidence },
      regression: { flows: regLeg.flows, crud_path: regLeg.crudPath, exit: regLeg.exit, evidence: regLeg.evidence },
    },
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const HELP = `day2-verify.mjs — DAY-2 dual assertion (new capability round-trips AND regression still passes).

Drives the EXISTING scripts/live-qa.mjs (agent-browser) once per assertion, scoping the
flows with LIVE_QA_FLOWS. Prints a verdict JSON; exit 0 iff overall==pass.

Usage:
  node scripts/lib/day2-verify.mjs --app-dir <abs> --base-url <url> [options]

Required:
  --app-dir <path>          built app workspace root (the driver's cwd)
  --base-url <url>          running app URL (e.g. http://localhost:3085)

Options:
  --brief <path>            brief to drive (absolutized; → LIVE_QA_SPEC). Strongly recommended:
                            the driver derives flows/entity testids from it.
  --app-id <id>             per-app state id (→ APP_ID) so build/<app-id>/ state is used
  --new-flows <csv>         the turn's NEW capability flow(s) to round-trip (empty → n/a)
  --crud-path <path>        which entity a crud flow drives (→ LIVE_QA_CRUD_PATH); testids
                            are still derived from the brief, never pinned here
  --regression-flows <csv>  the baseline flow(s) that must STILL pass (empty → n/a)
  --stream                  stream the driver output instead of capturing it
  -h, --help               this help

Verdict JSON shape:
  { new_capability: pass|fail|n/a, regression: pass|fail|n/a, overall: pass|fail, details: {...} }`;

function parseArgs(argv) {
  const out = { stream: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--app-dir': out.appDir = next(); break;
      case '--brief': out.brief = next(); break;
      case '--base-url': out.baseUrl = next(); break;
      case '--app-id': out.appId = next(); break;
      case '--new-flows': out.newFlows = next(); break;
      case '--crud-path': out.crudPath = next(); break;
      case '--regression-flows': out.regressionFlows = next(); break;
      case '--stream': out.stream = true; break;
      case '-h': case '--help': out.help = true; break;
      default:
        if (a.startsWith('--') && a.includes('=')) {
          const [k, v] = a.split(/=(.*)/s);
          ({
            '--app-dir': () => (out.appDir = v),
            '--brief': () => (out.brief = v),
            '--base-url': () => (out.baseUrl = v),
            '--app-id': () => (out.appId = v),
            '--new-flows': () => (out.newFlows = v),
            '--crud-path': () => (out.crudPath = v),
            '--regression-flows': () => (out.regressionFlows = v),
          }[k] || (() => { out._unknown = a; }))();
        } else {
          out._unknown = a;
        }
    }
  }
  return out;
}

function isMain() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (args._unknown) {
    console.error(`day2-verify: unknown argument: ${args._unknown}\n\n${HELP}`);
    process.exit(2);
  }
  if (!args.appDir || !args.baseUrl) {
    console.error('day2-verify: --app-dir and --base-url are required.\n\n' + HELP);
    process.exit(2);
  }

  dualVerify({
    appDir: args.appDir,
    brief: args.brief,
    baseUrl: args.baseUrl,
    appId: args.appId,
    newCapability: { flows: args.newFlows, crudPath: args.crudPath },
    regressionFlows: args.regressionFlows,
    captureOutput: !args.stream,
  })
    .then((verdict) => {
      // Human-readable two-line summary to stderr (so stdout stays pure JSON for piping).
      const tag = (r) => (r === 'pass' ? C.green('pass') : r === 'fail' ? C.red('fail') : C.yellow('n/a '));
      console.error(`${C.bold('day2-verify')}  new-capability=${tag(verdict.new_capability)}  regression=${tag(verdict.regression)}  →  ${verdict.overall === 'pass' ? C.green('OVERALL pass') : C.red('OVERALL fail')}`);
      console.error(C.dim(`  ${verdict.details.new_capability.evidence}`));
      console.error(C.dim(`  ${verdict.details.regression.evidence}`));
      // The machine-readable verdict on stdout.
      process.stdout.write(JSON.stringify(verdict) + '\n');
      process.exit(verdict.overall === 'pass' ? 0 : 1);
    })
    .catch((err) => {
      console.error(C.red('day2-verify crashed:'), (err && err.stack) || err);
      process.exit(2);
    });
}
