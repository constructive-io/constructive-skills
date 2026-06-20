#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-design.mjs — the design GATE (JSON-out). Post-pivot it has TWO modes:
 *
 *  1) DESIGN-SOURCE mode (default for a design.md / brief): the design.md is the
 *     FULL design spec the agent authors from. So taste rules are ADVISORY here —
 *     `lintDesign` runs, but its findings are warnings/info that DO NOT fail the
 *     gate. The ONLY things that fail are STRUCTURAL: a `missing-primary` (nothing
 *     to synthesize) or a genuine compile throw (the design can't be themed at
 *     all). `--strict` re-escalates the advisory taste findings to errors for a
 *     user who wants the old enforcing behavior.
 *
 *  2) BLOCKS-CONTRACT mode (`--globals <globals.css>` / `--app <appRoot>`): the one
 *     STYLE-SIDE HARD RAIL (RAIL 2). Given a generated app's `globals.css`, it
 *     asserts the shadcn token NAMES survive in BOTH `:root` and `.dark` and the
 *     Tailwind-v4 wiring (`@import 'tailwindcss'`, a non-empty `@theme inline`,
 *     `@custom-variant dark`, ≥1 `@source`) is intact — so Blocks RENDER. A dropped
 *     / renamed shadcn name or broken wiring = ERROR. The Blocks on-ramp's UI-dist
 *     `@source` + UI `@import` are advisory (legitimately absent pre-S5).
 *
 * GENERIC BY CONSTRUCTION: color ROLES + token NAMES only — no app/entity/flow/domain
 * literal anywhere.
 *
 * Usage:
 *   node scripts/check-design.mjs --design <path/to/design.md>     # advisory lint a design.md
 *   node scripts/check-design.mjs --brief  <path/to/brief.yaml>    # advisory lint brief.design
 *   node scripts/check-design.mjs <path>                           # positional: .md => design, else brief
 *   node scripts/check-design.mjs --design <p> --strict            # taste findings become errors (old behavior)
 *   node scripts/check-design.mjs --globals <app/src/app/globals.css>  # RAIL 2 Blocks-contract validator (HARD)
 *   node scripts/check-design.mjs --app <appRoot>                  # resolves <appRoot>/src/app/globals.css
 *   node scripts/check-design.mjs --design <p> --external          # also try the (optional) design.md CLI
 *
 * Output: a single JSON object on stdout:
 *   design mode:  { ok, source, kind, mode:'design', findings:[{rule,severity,msg}], counts:{error,warn,info}, external? }
 *   blocks mode:  { ok, source, mode:'blocks-contract', findings:[...], counts:{...} }
 *
 * Exit codes (mirror check-flows.mjs):
 *   0  no ERROR findings (warnings/info allowed)
 *   1  at least one ERROR finding (gate failed)
 *   2  could not run (no/unreadable/unparseable source, bad args)
 *
 * Zero dependencies. Pure Node (>=18). Reuses the skill's design engine + YAML reader.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { lintDesign } from './lib/design/invariants.mjs';
import { compileDesign, OVERRIDE_SURFACE } from './lib/design/compile.mjs';
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
let globalsArg = '';
let appArg = '';
let positional = '';
let tryExternal = false;
let strict = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--design') designArg = argv[++i] || '';
  else if (a === '--brief') briefArg = argv[++i] || '';
  else if (a === '--globals') globalsArg = argv[++i] || '';
  else if (a === '--app') appArg = argv[++i] || '';
  else if (a === '--external') tryExternal = true;
  else if (a === '--strict') strict = true;
  else if (a === '--json') { /* JSON is always the output shape — accepted for parity */ }
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 60).join('\n'));
    process.exit(0);
  } else if (a.startsWith('--')) fail2(`unknown argument: ${a}`);
  else positional = a;
}

// ── BLOCKS-CONTRACT mode (RAIL 2) — runs first when --globals/--app given ──────
if (globalsArg || appArg) {
  const cssPath = globalsArg
    ? resolve(process.cwd(), globalsArg)
    : resolve(process.cwd(), appArg, 'src', 'app', 'globals.css');
  if (!existsSync(cssPath)) fail2(`globals.css not found: ${cssPath}`);
  let css;
  try {
    css = readFileSync(cssPath, 'utf8');
  } catch (e) {
    fail2(`could not read ${cssPath}: ${e.message}`);
  }
  const { findings } = validateBlocksContract(css);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const ok = counts.error === 0;
  process.stdout.write(
    JSON.stringify({ ok, source: cssPath, mode: 'blocks-contract', findings, counts }) + '\n'
  );
  process.exit(ok ? 0 : 1);
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

// ── lint (ADVISORY by default) ────────────────────────────────────────────────
// PIVOT: the design.md is the FULL spec the agent authors from. So taste findings
// are advisory — only the STRUCTURAL `missing-primary` is an error. With --strict
// the advisory taste findings (contrast / ai-purple / saturation / pure-black /
// accent-count / dimension-units / tint-foreground) are re-escalated to errors for
// a user who wants the old enforcing behavior.
const { findings } = lintDesign(design);
if (strict) {
  for (const f of findings) {
    if (f.severity !== 'error' && f.rule !== 'tint-foreground') {
      // keep info-level tint hints as-is; everything advisory-but-actionable → error.
      if (f.severity === 'warn') f.severity = 'error';
    }
  }
}

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
if (!isOptOut) {
  try {
    const compiled = compileDesign(design);
    for (const w of compiled.warnings || []) {
      // Surface compiler best-pole warnings (no AA-4.5 fg exists on a surface) as
      // ADVISORY findings. Post-pivot the compiler emits authored values verbatim
      // and rarely warns, but when it does it is informational, never a failure.
      if (/no AA-4\.5 foreground exists/.test(w)) {
        findings.push({ rule: 'contrast-uncompilable', severity: 'warn', msg: w });
      }
    }
  } catch (e) {
    // A genuine STRUCTURAL/parse throw (not a taste issue) — the design can't be
    // themed at all. This stays a hard error (wire-design would silently no-op).
    findings.push({
      rule: 'compile-failed',
      severity: 'error',
      msg: `design cannot be compiled into a theme (${e.message}). wire-design would degrade to a SILENT default-look no-op — fix the offending structural problem.`,
    });
  }
}

// PIVOT: the gate is ADVISORY for taste — `ok` is false ONLY if an ERROR finding
// exists (missing-primary, compile-failed, or a --strict-escalated taste rule).
const ok = !findings.some((f) => f.severity === 'error');
const counts = { error: 0, warn: 0, info: 0 };
for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

// ── optional best-effort external CLI (NEVER required) ─────────────────────────
// Only runs for a design.md source AND only when --external is asked AND a design.md
// CLI is already resolvable. We never install it; absence/failure is reported, not fatal.
let external;
if (tryExternal && kind === 'design') {
  external = runExternalLint(abs);
}

const report = { ok, source: abs, kind, mode: 'design', findings, counts };
if (external) report.external = external;
process.stdout.write(JSON.stringify(report) + '\n');
process.exit(ok ? 0 : 1);

/**
 * validateBlocksContract(css) — the RAIL 2 hard validator. Given a generated app's
 * `globals.css`, assert the shadcn-token contract + Tailwind-v4 wiring SURVIVE, so
 * Blocks render. Returns { findings:[{rule,severity,msg}] }; the caller fails on any
 * `error`. GENERIC — it reasons only about token NAMES + wiring directives.
 *
 * HARD (error):
 *   • every shadcn contract name DEFINED in BOTH the :root{} and .dark{} blocks
 *   • @import 'tailwindcss'
 *   • a non-empty @theme inline block carrying the --color-* mappings
 *   • @custom-variant dark
 *   • at least one @source
 * ADVISORY (warn — legitimately absent pre-Blocks-on-ramp/S5):
 *   • @source ".../@constructive-io/ui/dist"
 *   • @import '@constructive-io/ui/globals.css'
 */
function validateBlocksContract(css) {
  const findings = [];
  const add = (rule, severity, msg) => findings.push({ rule, severity, msg });

  // Extract ALL rule bodies whose selector matches (the contract is on the names
  // being DEFINED somewhere in a :root / .dark block — there may be several, e.g.
  // the boilerplate's base block + the generated override block). Brace-balanced
  // scan. Returns the concatenation of every matched body (or null if none).
  const ruleBodies = (selectorRe) => {
    const re = new RegExp(selectorRe.source, 'g');
    const bodies = [];
    let m;
    while ((m = re.exec(css))) {
      let i = css.indexOf('{', m.index + m[0].length - 1);
      if (i < 0) continue;
      let depth = 0;
      const start = i;
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
          depth--;
          if (depth === 0) {
            bodies.push(css.slice(start + 1, i));
            re.lastIndex = i + 1;
            break;
          }
        }
      }
    }
    return bodies.length ? bodies.join('\n') : null;
  };
  // `:root` — but NOT `.dark .x:root`-style; a `:root` token whose preceding char is
  // not a word/`.`/`#` (so we don't catch `:root` inside another selector segment).
  const rootBody = ruleBodies(/(?:^|[\s,}])\:root\s*\{/m);
  const darkBody = ruleBodies(/(?:^|[\s,}])\.dark\s*\{/m);

  if (rootBody == null) add('rail2-root-missing', 'error', 'no `:root { … }` block found — the shadcn light tokens have nowhere to live.');
  if (darkBody == null) add('rail2-dark-missing', 'error', 'no `.dark { … }` block found — the shadcn dark tokens have nowhere to live (Blocks render unstyled in dark mode).');

  const definedIn = (body, bare) => body != null && new RegExp(`(^|[\\s;{])--${bare}\\s*:`).test(body);

  for (const bare of OVERRIDE_SURFACE) {
    if (bare === 'radius') continue; // radius is a scalar, not a color token name
    if (rootBody != null && !definedIn(rootBody, bare)) {
      add('rail2-name-missing', 'error', `shadcn token --${bare} is not defined in :root — Blocks that read it (e.g. bg-${bare}) will render unstyled.`);
    }
    if (darkBody != null && !definedIn(darkBody, bare)) {
      add('rail2-name-missing', 'error', `shadcn token --${bare} is not defined in .dark — Blocks render unstyled/broken in dark mode.`);
    }
  }
  // --radius is part of the contract (drives --radius-* derivations); require it in :root.
  if (rootBody != null && !definedIn(rootBody, 'radius')) {
    add('rail2-name-missing', 'error', 'shadcn token --radius is not defined in :root — radius-derived utilities (rounded-*) break.');
  }

  // ── Tailwind-v4 wiring (hard) ──
  if (!/@import\s+['"]tailwindcss['"]/.test(css)) {
    add('rail2-wiring', 'error', "missing `@import 'tailwindcss'` — without it nothing generates.");
  }
  // @theme inline must be present AND non-empty AND carry the --color-* mappings.
  const themeBody = ruleBodies(/@theme\s+inline\s*\{/);
  if (themeBody == null || themeBody.trim() === '') {
    add('rail2-wiring', 'error', 'missing or empty `@theme inline { … }` — the --color-* → var(--*) map that lets `bg-primary` etc. resolve.');
  } else if (!/--color-[a-z-]+\s*:\s*var\(--/.test(themeBody)) {
    add('rail2-wiring', 'error', '`@theme inline` carries no `--color-*: var(--*)` mappings — shadcn utilities (bg-primary/text-muted-foreground) will not resolve.');
  }
  if (!/@custom-variant\s+dark\b/.test(css)) {
    add('rail2-wiring', 'error', 'missing `@custom-variant dark (…)` — `dark:` variants will not resolve against the .dark class.');
  }
  if (!/@source\b/.test(css)) {
    add('rail2-wiring', 'error', 'missing any `@source` directive — app/block source will not be scanned, so utilities will not generate.');
  }

  // ── Blocks on-ramp (advisory — absent pre-S5) ──
  if (!/@source\s+['"][^'"]*@constructive-io\/ui\/dist/.test(css)) {
    add('blocks-onramp', 'warn', "the Blocks on-ramp `@source \"…/@constructive-io/ui/dist\"` is absent — block utilities will not generate until wire-app (S5) adds it (OK if Blocks are not installed yet).");
  }
  if (!/@import\s+['"]@constructive-io\/ui\/globals\.css['"]/.test(css)) {
    add('blocks-onramp', 'warn', "the Blocks on-ramp `@import '@constructive-io/ui/globals.css'` is absent — brand tokens + base UI styles are added by wire-app (S5) (OK pre-install).");
  }

  return { findings };
}

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
