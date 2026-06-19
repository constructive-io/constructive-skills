#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-design.mjs — the design-system lint GATE (JSON-out), wrapping the pure
 * deterministic invariants engine (lib/design/invariants.mjs). It is to the design
 * subsystem what check-flows.mjs is to the flow catalog: a self-contained drift /
 * correctness guard that a build can run before compiling a theme.
 *
 * It lints a design SOURCE — either a design.md file (frontmatter parsed via the
 * skill's zero-dep YAML reader, through design-md.mjs) OR a brief whose `design:`
 * block carries inline colors/dials. It runs `lintDesign` (taste + WCAG-AA contrast
 * invariants) and, when the optional Google-Labs `design.md` CLI is ALREADY available
 * on PATH/locally, ALSO shells `<cli> lint` as extra signal — never required, never a
 * hard dependency (its absence or failure is reported, not fatal).
 *
 * GENERIC BY CONSTRUCTION: it reasons about color ROLES + dimension tokens only —
 * no app/entity/flow/domain literal anywhere. The source is whatever the caller names.
 *
 * Usage:
 *   node scripts/check-design.mjs --design <path/to/design.md>     # lint a design.md
 *   node scripts/check-design.mjs --brief  <path/to/brief.yaml>    # lint brief.design
 *   node scripts/check-design.mjs <path>                           # positional: .md => design, else brief
 *   node scripts/check-design.mjs --design <p> --external          # also try the (optional) design.md CLI
 *   node scripts/check-design.mjs --design <p> --json              # machine-readable (default is also JSON)
 *
 * Output: a single JSON object on stdout:
 *   { ok, source, kind, findings:[{rule,severity,msg}], counts:{error,warn,info}, external? }
 *
 * Exit codes (mirror check-flows.mjs):
 *   0  no ERROR findings (warnings/info allowed)
 *   1  at least one ERROR finding (lint failed)
 *   2  could not run (no/unreadable/unparseable source, bad args)
 *
 * Zero dependencies. Pure Node (>=18). Reuses the skill's design engine + YAML reader.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { lintDesign } from './lib/design/invariants.mjs';
import { compileDesign } from './lib/design/compile.mjs';
import { parseDesignMd } from './lib/design/design-md.mjs';
import { parseBrief } from './lib/brief-yaml.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function fail2(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, exit: 2 }) + '\n');
  process.exit(2);
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let designArg = '';
let briefArg = '';
let positional = '';
let tryExternal = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--design') designArg = argv[++i] || '';
  else if (a === '--brief') briefArg = argv[++i] || '';
  else if (a === '--external') tryExternal = true;
  else if (a === '--json') { /* JSON is always the output shape — accepted for parity */ }
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 47).join('\n'));
    process.exit(0);
  } else if (a.startsWith('--')) fail2(`unknown argument: ${a}`);
  else positional = a;
}

// Resolve the source + its kind ('design' = a design.md frontmatter, 'brief' = brief.design).
let sourcePath = '';
let kind = '';
if (designArg) { sourcePath = designArg; kind = 'design'; }
else if (briefArg) { sourcePath = briefArg; kind = 'brief'; }
else if (positional) {
  sourcePath = positional;
  kind = extname(positional).toLowerCase() === '.md' ? 'design' : 'brief';
} else {
  fail2('no source given. Pass --design <design.md>, --brief <brief.yaml>, or a positional path.');
}

const abs = resolve(process.cwd(), sourcePath);
if (!existsSync(abs)) fail2(`source not found: ${abs}`);

let text;
try {
  text = readFileSync(abs, 'utf8');
} catch (e) {
  fail2(`could not read ${abs}: ${e.message}`);
}

// Extract the design frontmatter object the invariants engine expects.
let design;
try {
  if (kind === 'design') {
    design = parseDesignMd(text).frontmatter || {};
  } else {
    const brief = parseBrief(text) || {};
    design = (brief && brief.design) || {};
    if (!brief.design) {
      // No design block in the brief: nothing to lint → trivially ok (absent-design
      // is the auto-propose path; a builder generates a design.md later and lints THAT).
      process.stdout.write(
        JSON.stringify({
          ok: true,
          source: abs,
          kind,
          findings: [],
          counts: { error: 0, warn: 0, info: 0 },
          note: 'brief has no design: block — nothing to lint (auto-propose path).',
        }) + '\n'
      );
      process.exit(0);
    }
  }
} catch (e) {
  fail2(`could not parse ${kind} source ${abs}: ${e.message}`);
}

// ── lint (the deterministic gate) ─────────────────────────────────────────────
const { ok: lintOk, findings } = lintDesign(design);

// ── COMPILE-ABILITY (the gate must reflect what wire-design will actually do) ───
// A lint-clean design can still be untheme-able: compileDesign throwing (a genuinely
// impossible pairing) OR an explicit dark override pairing that cannot reach AA-4.5
// of EITHER polarity. wire-design degrades a compile failure to a SILENT default-look
// no-op, so if we did not surface this here a "green" lint would mask a design that
// renders with ZERO theme applied. We attempt the SAME compile wire-design runs and
// fold the result into the gate:
//   • a hard throw  → ERROR finding (design cannot be themed at all)
//   • compiler best-pole warnings (no AA-4.5 fg exists on a surface) → WARN findings,
//     so an impossible explicit-dark / brand-surface pairing is visible at the gate.
// (Only the `constructive` opt-out preset is exempt — wire-design treats it as a
// pure no-op that reproduces today's look, so its known sub-AA on-primary label is
// expected, not a gate failure.)
const presetName = String(design.preset || design.name || '').trim().toLowerCase();
const isOptOut = presetName === 'constructive';
let compileOk = true;
if (!isOptOut) {
  try {
    const compiled = compileDesign(design);
    for (const w of compiled.warnings || []) {
      // Surface only the contrast-impossibility warnings as gate findings; benign
      // font-fallback / missing-primary warnings are already covered by lint.
      if (/no AA-4\.5 foreground exists/.test(w)) {
        findings.push({ rule: 'contrast-uncompilable', severity: 'warn', msg: w });
      }
    }
  } catch (e) {
    compileOk = false;
    findings.push({
      rule: 'compile-failed',
      severity: 'error',
      msg: `design cannot be compiled into a theme (${e.message}). wire-design would degrade to a SILENT default-look no-op — fix the offending pairing (commonly a vivid mid-luminance primary/surface that cannot carry AA-4.5 text of either polarity).`,
    });
  }
}

const ok = lintOk && compileOk;
const counts = { error: 0, warn: 0, info: 0 };
for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

// ── optional best-effort external CLI (NEVER required) ─────────────────────────
// Only runs for a design.md source AND only when --external is asked AND a design.md
// CLI is already resolvable. We never install it; absence/failure is reported, not fatal.
let external;
if (tryExternal && kind === 'design') {
  external = runExternalLint(abs);
}

const report = { ok, source: abs, kind, findings, counts };
if (external) report.external = external;
process.stdout.write(JSON.stringify(report) + '\n');
process.exit(ok ? 0 : 1);

/**
 * Best-effort wrapper over an OPTIONAL Google-Labs `design.md` CLI. We probe a few
 * resolvable invocations WITHOUT triggering a network install:
 *   • a `design.md` binary on PATH,
 *   • a locally-installed `@google/design.md` (node_modules/.bin), if present.
 * `npx @google/design.md` is deliberately NOT auto-invoked unless it resolves offline,
 * because npx would otherwise reach the network — violating zero-dep / offline rules.
 * Returns { ran:false, reason } when unavailable, or { ran:true, exit, stdout, stderr }.
 */
function runExternalLint(designPath) {
  const candidates = [];
  // 1) a `design.md` binary directly on PATH.
  candidates.push({ cmd: 'design.md', args: ['lint', designPath] });
  // 2) a locally-installed bin next to this skill (no network).
  const localBin = resolve(SCRIPT_DIR, '..', 'node_modules', '.bin', 'design.md');
  if (existsSync(localBin)) candidates.push({ cmd: localBin, args: ['lint', designPath] });

  for (const c of candidates) {
    let res;
    try {
      res = spawnSync(c.cmd, c.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      continue;
    }
    if (res.error) continue; // ENOENT etc. — try the next candidate
    return {
      ran: true,
      cmd: c.cmd,
      exit: res.status,
      stdout: (res.stdout || '').trim().slice(0, 4000),
      stderr: (res.stderr || '').trim().slice(0, 2000),
    };
  }
  return { ran: false, reason: 'no offline design.md CLI found (optional — not required).' };
}
