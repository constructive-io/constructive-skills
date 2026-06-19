#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * wire-design.mjs — the THEME applier. An idempotent, --dry-run-able codemod that
 * turns a resolved design (the brief's `design:` block and/or an emitted `design.md`)
 * into the generated app's look-and-feel, mirroring wire-app.mjs's marker/anchor +
 * fail-loud-never-half-write discipline.
 *
 * It does up to FOUR things, each independently idempotent (re-run = safe no-op):
 *   (1) GLOBALS OVERRIDE BLOCK — compiles the design (compile.mjs: role→shadcn remap,
 *       OKLCH dark-derivation, WCAG-AA contrast repair, tint-foreground contract) into
 *       the SINGLE marked override region and writes it into the app's
 *       src/app/globals.css. Placed AFTER the `.dark { … }` cascade and BEFORE
 *       `@theme inline {` so it wins by source order over both the template tokens and
 *       any installed Blocks `@import`. Emits ONLY thematic override-surface vars —
 *       NEVER structural blocks (`@theme inline`, `@source`, `--z-layer-*`, `@layer …`).
 *       Idempotent: locate the `>>>`/`<<<` sentinels and REPLACE in place, else insert
 *       at the structural anchor.
 *   (2) FONT LOADER SWAP (optional) — when the design names a non-Geist font, swaps the
 *       next/font/google loader import + call in layout.tsx, KEEPING the variable NAMES
 *       `--font-geist-sans` / `--font-geist-mono` (the `@theme inline` maps
 *       `--font-sans: var(--font-geist-sans)`, so the names must not change) and the
 *       body className tokens. A non-allowlisted family falls back to Geist (a no-op).
 *   (3) defaultTheme (optional) — sets the ThemeProvider `defaultTheme` in layout.tsx
 *       from the design's `default_mode` (light|dark).
 *   (4) BRANDING (optional) — sets branding.ts `name` / `tagline` from the brief's
 *       `app.label` (name) — never an entity/domain literal; derived from the brief.
 *
 * NO-OP CONTRACT (today's look preserved): if NEITHER a brief `design:` block NOR a
 * design.md is resolvable, OR the resolved design's `preset === 'constructive'`, the
 * script is a clean NO-OP — it writes nothing and exits 0. (A compile failure also
 * degrades to a loud-but-non-destructive no-op of the globals step, never a half-write.)
 *
 * GENERIC BY CONSTRUCTION: every value comes from the design tokens / dials / app.label
 * — no app/entity/flow/domain literal anywhere.
 *
 * Usage (TWO accepted forms so it slots into scaffold-app AND runs standalone):
 *   node scripts/wire-design.mjs --app <appPath> [--brief <p>] [--design <p>] [--dry-run]
 *   node scripts/wire-design.mjs <brief> <appDir> [--dry-run]      # the runScaffolder shape
 *     --app <appPath>  the WORKSPACE ROOT (dir holding packages/) OR the app package dir
 *                      directly (same <app> the other scaffolders take). DERIVES the app
 *                      package (probes <app>/packages/app, <app>/app, else <app> itself).
 *     --brief <p>      brief.yaml carrying the optional `design:` block + `app.label`.
 *     --design <p>     an explicit design.md (overrides/augments brief.design). If omitted,
 *                      a `design.md` next to the app (packages/app/design.md or the app dir)
 *                      is auto-discovered.
 *     --dry-run        report what WOULD change; write nothing.
 *
 * Exit: 0 = applied (or no-op / nothing to do) · non-zero = bad input or a structural
 *       shape mismatch on globals.css (with a manual pointer). Never half-writes.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDesign, renderOverrideBlock, BEGIN_SENTINEL, END_SENTINEL } from './lib/design/compile.mjs';
import { parseDesignMd } from './lib/design/design-md.mjs';
import { resolveFont } from './lib/design/fonts.mjs';
import { parseBrief } from './lib/brief-yaml.mjs';

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
const FALLBACK =
  'manual fallback: references/design-system.md (the override-block contract) — paste the compiled ' +
  ':root/.dark override region into src/app/globals.css AFTER the .dark{} block and BEFORE @theme inline.';
function die(msg) {
  console.error(`  ${C.red('FAIL')}: ${msg}`);
  console.error(`        FIX: ${FALLBACK}`);
  process.exit(1);
}
function rel(p) {
  if (!p) return String(p);
  return p.startsWith(REPO_ROOT + '/') ? p.slice(REPO_ROOT.length + 1) : p;
}

// ── args (accept BOTH the --flag form AND the `<brief> <appDir>` positional form) ──
const argv = process.argv.slice(2);
let appArg = '';
let briefArg = '';
let designArg = '';
let dryRun = false;
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--app') appArg = argv[++i] || '';
  else if (a === '--brief') briefArg = argv[++i] || '';
  else if (a === '--design') designArg = argv[++i] || '';
  else if (a === '--dry-run') dryRun = true;
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 62).join('\n'));
    process.exit(0);
  } else if (a.startsWith('--')) die(`unknown argument: ${a}`);
  else positionals.push(a);
}
// runScaffolder shape: node wire-design.mjs <brief> <appDir> [--dry-run]
if (positionals.length && !briefArg) briefArg = positionals[0];
if (positionals.length > 1 && !appArg) appArg = positionals[1];

// ── resolve the app package dir (mirrors wire-app.mjs's appUnder probing) ──────
function appUnder(base) {
  if (!base) return '';
  const absBase = isAbsolute(base) ? base : resolve(process.cwd(), base);
  const isApp = (d) => existsSync(join(d, 'package.json')) && existsSync(join(d, 'src'));
  if (isApp(absBase)) return absBase; // base IS already the app package
  for (const sub of [join(absBase, 'packages', 'app'), join(absBase, 'app')]) {
    if (isApp(sub)) return sub;
  }
  return '';
}

const APP_DIR = appUnder(appArg || process.env.WIRE_APP_DIR || process.cwd());
if (!APP_DIR) {
  die(
    `could not locate the scaffolded app dir (needs package.json + src/). Pass --app <workspaceRoot> ` +
      `(probes packages/app then app/) or the app package dir directly — the same <app> ` +
      `scaffold-provision/scaffold-frontend take.`
  );
}
info(`app dir: ${APP_DIR}`);

// ── resolve the design source: brief.design and/or a design.md ────────────────
function readBriefObj(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return parseBrief(readFileSync(path, 'utf8')) || null;
  } catch (e) {
    warn(`could not parse brief ${rel(path)} (${e.message}) — ignoring its design block`);
    return null;
  }
}

const BRIEF = briefArg ? readBriefObj(briefArg) : null;
const briefDesign = BRIEF && BRIEF.design && typeof BRIEF.design === 'object' ? BRIEF.design : null;

// design.md: explicit --design, else auto-discover next to the app.
function discoverDesignMd() {
  if (designArg) return isAbsolute(designArg) ? designArg : resolve(process.cwd(), designArg);
  for (const cand of [
    join(APP_DIR, 'design.md'),
    join(APP_DIR, '..', 'design.md'),
    join(dirname(APP_DIR), 'design.md'),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return '';
}
const DESIGN_MD_PATH = discoverDesignMd();
let designMd = null;
if (DESIGN_MD_PATH && existsSync(DESIGN_MD_PATH)) {
  try {
    designMd = parseDesignMd(readFileSync(DESIGN_MD_PATH, 'utf8')).frontmatter || null;
    info(`design.md: ${rel(DESIGN_MD_PATH)}`);
  } catch (e) {
    warn(`could not parse design.md ${rel(DESIGN_MD_PATH)} (${e.message}) — ignoring it`);
  }
}

// Merge precedence: a design.md (the durable, lint-gated record) wins over the brief's
// inline `design:` block, but the brief can still contribute keys the design.md omits.
// Both are color-role/token maps — no domain knowledge merged.
function mergeDesign(briefD, mdD) {
  if (!briefD && !mdD) return null;
  if (!mdD) return briefD;
  if (!briefD) return mdD;
  const out = { ...briefD, ...mdD };
  if (briefD.colors || mdD.colors) out.colors = { ...(briefD.colors || {}), ...(mdD.colors || {}) };
  if (briefD.font || mdD.font || mdD.typography) {
    out.font = { ...(briefD.font || {}), ...(mdD.font || {}), ...(mdD.typography || {}) };
  }
  if (briefD.dark || mdD.dark) out.dark = mdD.dark != null ? mdD.dark : briefD.dark;
  return out;
}
const DESIGN = mergeDesign(briefDesign, designMd);

// ── THE NO-OP CONTRACT ────────────────────────────────────────────────────────
// Absent design OR the opt-out preset => keep today's look exactly: write nothing.
if (!DESIGN) {
  info('no design resolved (no brief design: block, no design.md) — NO-OP, keeping the default look.');
  process.exit(0);
}
const preset = String(DESIGN.preset || '').trim().toLowerCase();
if (preset === 'constructive') {
  info("design.preset === 'constructive' (the opt-out) — NO-OP, reproducing the default Constructive look.");
  process.exit(0);
}

const defaultMode = String(DESIGN.default_mode || DESIGN.defaultMode || '').trim().toLowerCase() || undefined;

// ── compile (pure, contrast-repaired) ─────────────────────────────────────────
let compiled;
try {
  compiled = compileDesign(DESIGN, { defaultMode });
} catch (e) {
  // A compile failure must NOT damage the app — degrade to a non-destructive no-op
  // of the theme (today's look preserved) with a loud pointer, never a half-write.
  warn(
    `compileDesign failed (${e.message}) — leaving globals.css UNCHANGED (default look preserved). ` +
      `Fix the design source (run scripts/check-design.mjs) and re-run.`
  );
  process.exit(0);
}
for (const w of compiled.warnings || []) info(`compile: ${w}`);

let changed = 0;

// ── (1) GLOBALS OVERRIDE BLOCK ────────────────────────────────────────────────
{
  const GLOBALS = join(APP_DIR, 'src', 'app', 'globals.css');
  if (!existsSync(GLOBALS)) {
    die(`expected ${GLOBALS} (the template global stylesheet) — not found. Apply the override block by hand.`);
  }
  let css = readFileSync(GLOBALS, 'utf8');
  const before = css;

  // The compiled override region (the SINGLE marked block; compile asserts override-surface only).
  const block = renderOverrideBlock({ light: compiled.light, dark: compiled.dark }).replace(/\n+$/, '') + '\n';

  // Idempotence: if a prior region exists (located by the byte-identical sentinels),
  // REPLACE it in place; else insert at the structural anchor.
  const beginIdx = css.indexOf(BEGIN_SENTINEL);
  const endIdx = css.indexOf(END_SENTINEL);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const regionStart = beginIdx;
    const regionEnd = endIdx + END_SENTINEL.length;
    // Swallow a single trailing newline so re-runs don't grow blank lines.
    let tail = regionEnd;
    if (css[tail] === '\n') tail += 1;
    const replacement = block; // already ends with one newline
    css = css.slice(0, regionStart) + replacement + css.slice(tail);
    if (css === before) {
      info('globals.css: design override block already up-to-date (no change)');
    } else {
      if (dryRun) info('[dry-run] would REPLACE the existing design override block in globals.css (idempotent in-place update)');
      else {
        writeFileSync(GLOBALS, css);
        pass('globals.css: updated the design override block (thematic tokens only; structural blocks untouched)');
      }
      changed++;
    }
  } else if (beginIdx !== -1 || endIdx !== -1) {
    die('globals.css has only ONE of the design-override sentinels — a corrupt/half-written region. Remove the stray sentinel and re-run.');
  } else {
    // Insert at the structural anchor: AFTER the `.dark { … }` block and BEFORE `@theme inline {`.
    // We anchor on `@theme inline` (the start of the structural region) and insert the override
    // block immediately before it, so it follows the entire `:root`/`.dark` token cascade and
    // wins by source order. This is robust whether or not a Blocks `@import` is present above.
    const themeAnchor = css.indexOf('@theme inline');
    if (themeAnchor === -1) {
      die(
        'globals.css: could not find the `@theme inline` structural anchor to place the override block before. ' +
          'The template shape moved; paste the override region by hand AFTER the .dark{} block.'
      );
    }
    // Find the start of the line carrying `@theme inline` so we insert cleanly above it.
    let lineStart = css.lastIndexOf('\n', themeAnchor);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    const insertion = block + '\n';
    css = css.slice(0, lineStart) + insertion + css.slice(lineStart);
    if (dryRun) {
      info('[dry-run] would INSERT the design override block into globals.css (after .dark{}, before @theme inline)');
    } else {
      writeFileSync(GLOBALS, css);
      pass('globals.css: inserted the design override block (after .dark{}, before @theme inline — wins by source order)');
    }
    changed++;
  }
}

// ── (2) FONT LOADER SWAP + (3) defaultTheme (layout.tsx) ──────────────────────
{
  const LAYOUT = join(APP_DIR, 'src', 'app', 'layout.tsx');
  if (!existsSync(LAYOUT)) {
    warn(`layout.tsx not found at ${rel(LAYOUT)} — skipping the font/defaultTheme swap (globals override still applied).`);
  } else {
    let lay = readFileSync(LAYOUT, 'utf8');
    const before = lay;

    // (2) FONT SWAP — only when a NON-Geist allowlisted family is requested. The variable
    // NAMES (--font-geist-sans / --font-geist-mono) and the body className tokens are KEPT;
    // only the loader import + call change. A non-allowlisted family resolves to Geist =>
    // no swap (a clean no-op). We anchor on the template's exact loader declarations.
    const fontCfg = compiled.fonts || {};
    const sans = fontCfg.sans || resolveFont(undefined, { role: 'sans' });
    const mono = fontCfg.mono || resolveFont(undefined, { role: 'mono' });

    // Swap one loader: change the import + the `const X = Loader({ variable: '<var>' ...})`
    // call, keeping the variable string. Idempotent: if the loader already matches, no change.
    function swapLoader(text, role, resolved) {
      // Geist/Geist_Mono is the template default — no swap needed.
      if (resolved.loaderName === (role === 'mono' ? 'Geist_Mono' : 'Geist')) return text;
      const variable = role === 'mono' ? '--font-geist-mono' : '--font-geist-sans';
      // Find the `const <ident> = <Loader>({ variable: '<variable>', ... })` declaration.
      const callRe = new RegExp(
        `(const\\s+\\w+\\s*=\\s*)([A-Za-z_][\\w]*)(\\(\\s*\\{[^}]*?variable:\\s*'${variable.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}'[^}]*?\\}\\s*\\))`,
        'm'
      );
      const m = callRe.exec(text);
      if (!m) return text; // template shape moved for this loader — leave it (no half-write)
      if (m[2] === resolved.loaderName) return text; // already the requested loader
      // Rewrite the loader name in the call.
      let out = text.replace(callRe, (full, pre, _loader, rest) => `${pre}${resolved.loaderName}${rest}`);
      // Rewrite the import that brought in the old loader. The template imports both from one line:
      //   import { Geist, Geist_Mono } from 'next/font/google';
      // Replace the specific loader identifier in that import with the new one (dedupe-safe).
      const importRe = /import\s*\{([^}]*)\}\s*from\s*'next\/font\/google';/;
      const im = importRe.exec(out);
      if (im) {
        const names = im[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const oldName = m[2];
        const idx = names.indexOf(oldName);
        if (idx !== -1) names[idx] = resolved.loaderName;
        // Dedupe (the other role may already import the same family).
        const uniq = [...new Set(names)];
        out = out.replace(importRe, `import { ${uniq.join(', ')} } from 'next/font/google';`);
      }
      return out;
    }

    let layNext = lay;
    layNext = swapLoader(layNext, 'sans', sans);
    layNext = swapLoader(layNext, 'mono', mono);
    if (layNext !== lay) {
      lay = layNext;
      if (dryRun) info(`[dry-run] would swap the next/font loader(s) in layout.tsx (sans=${sans.family}, mono=${mono.family}; variable names kept)`);
      else info(`layout.tsx: swapped next/font loader(s) (sans=${sans.family}, mono=${mono.family}) — variable names + body classNames kept`);
    } else {
      info('layout.tsx: fonts unchanged (Geist default or already applied)');
    }

    // (3) defaultTheme — set the ThemeProvider defaultTheme from default_mode, idempotently.
    if (defaultMode === 'light' || defaultMode === 'dark') {
      const dtRe = /(<ThemeProvider\b[^>]*\bdefaultTheme=)(['"])(light|dark|system)(\2)/;
      const dm = dtRe.exec(lay);
      if (dm) {
        if (dm[3] !== defaultMode) {
          lay = lay.replace(dtRe, (full, pre, q, _v, q2) => `${pre}${q}${defaultMode}${q2}`);
          if (dryRun) info(`[dry-run] would set ThemeProvider defaultTheme='${defaultMode}' in layout.tsx`);
          else info(`layout.tsx: set ThemeProvider defaultTheme='${defaultMode}'`);
        } else {
          info(`layout.tsx: defaultTheme already '${defaultMode}' (no change)`);
        }
      } else {
        warn(`layout.tsx: no <ThemeProvider defaultTheme='…'> anchor found — could not set defaultTheme='${defaultMode}' (skipped).`);
      }
    }

    if (lay !== before) {
      if (!dryRun) writeFileSync(LAYOUT, lay);
      changed++;
    }
  }
}

// ── (4) BRANDING (optional) — set name/tagline from the brief's app.label ──────
{
  const label = BRIEF && BRIEF.app && typeof BRIEF.app === 'object' ? BRIEF.app.label : '';
  const tagline = DESIGN.tagline || (DESIGN.branding && DESIGN.branding.tagline) || '';
  if (label || tagline) {
    const BRANDING = join(APP_DIR, 'src', 'config', 'branding.ts');
    if (!existsSync(BRANDING)) {
      info(`branding.ts not found at ${rel(BRANDING)} — skipping the name/tagline set (optional).`);
    } else {
      let br = readFileSync(BRANDING, 'utf8');
      const before = br;
      const esc = (s) => String(s).replace(/'/g, "\\'");
      // Replace ONLY the first `name:` / `tagline:` string value inside the `branding` object.
      if (label) {
        const nameRe = /(\bname:\s*)(['"])(?:[^'"\\]|\\.)*(\2)/;
        if (nameRe.test(br)) br = br.replace(nameRe, (full, pre, q) => `${pre}${q}${esc(label)}${q}`);
      }
      if (tagline) {
        const tagRe = /(\btagline:\s*)(['"])(?:[^'"\\]|\\.)*(\2)/;
        if (tagRe.test(br)) br = br.replace(tagRe, (full, pre, q) => `${pre}${q}${esc(tagline)}${q}`);
      }
      if (br !== before) {
        if (dryRun) info(`[dry-run] would set branding.ts name${label ? `='${label}'` : ''}${tagline ? ` / tagline='${tagline}'` : ''}`);
        else {
          writeFileSync(BRANDING, br);
          pass(`branding.ts: set name/tagline from the brief (name='${label || '(unchanged)'}')`);
        }
        changed++;
      } else {
        info('branding.ts: name/tagline already match (no change)');
      }
    }
  }
}

if (changed === 0) info('wire-design: nothing to change (already wired or no-op).');
else if (dryRun) info(`wire-design: ${changed} change(s) would be applied (dry-run).`);
else pass(`wire-design: applied ${changed} change(s).`);
process.exit(0);
