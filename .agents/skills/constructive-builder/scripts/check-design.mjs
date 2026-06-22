#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-design.mjs — the ONE style-side hard rail (RAIL 2): the Blocks-contract
 * validator.
 *
 * The design.md is the FULL design spec and the AGENT authors the whole frontend
 * from it; there is no machine "taste" gate. The only thing a build must still
 * guarantee mechanically is FUNCTIONAL: the generated app's `globals.css` keeps the
 * shadcn token NAMES + the Tailwind-v4 wiring intact so Blocks RENDER. This script
 * checks exactly that and nothing else.
 *
 * Given a generated app's `globals.css` it asserts the shadcn token names survive in
 * BOTH `:root` and `.dark` and the Tailwind-v4 wiring (`@import 'tailwindcss'`, a
 * non-empty `@theme inline` carrying the `--color-*: var(--*)` map, `@custom-variant
 * dark`, ≥1 `@source`) is intact. A dropped/renamed shadcn name or broken wiring =
 * ERROR. The Blocks on-ramp's UI-dist `@source` + UI `@import` are ADVISORY (they are
 * legitimately absent before Blocks are installed).
 *
 * GENERIC BY CONSTRUCTION: it reasons only about token NAMES + wiring directives — no
 * app/entity/flow/domain literal anywhere.
 *
 * Usage:
 *   node scripts/check-design.mjs --globals <app/src/app/globals.css>
 *   node scripts/check-design.mjs --app <appRoot>   # resolves <appRoot>/src/app/globals.css
 *
 * Output: a single JSON object on stdout:
 *   { ok, source, mode:'blocks-contract', findings:[{rule,severity,msg}], counts:{error,warn,info} }
 *
 * Exit codes:
 *   0  no ERROR findings (warnings/info allowed)
 *   1  at least one ERROR finding (gate failed)
 *   2  could not run (no/unreadable input, bad args)
 *
 * Zero dependencies. Pure Node (>=18).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OVERRIDE_SURFACE } from './lib/design/tokens.mjs';

function fail2(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, exit: 2 }) + '\n');
  process.exit(2);
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let globalsArg = '';
let appArg = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--globals') globalsArg = argv[++i] || '';
  else if (a === '--app') appArg = argv[++i] || '';
  else if (a === '--json') { /* JSON is always the output shape — accepted for parity */ }
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 40).join('\n'));
    process.exit(0);
  } else if (a.startsWith('--')) fail2(`unknown argument: ${a}`);
  else fail2(`unexpected positional argument: ${a} (pass --globals <css> or --app <appRoot>)`);
}

if (!globalsArg && !appArg) {
  fail2('no source given. Pass --globals <path/to/globals.css> or --app <appRoot>.');
}

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
