/** node --test scripts/lib/design/blocks-contract.test.mjs
 *
 * RAIL 2 — the Blocks-contract validator (the ONE style-side hard rail). Drives the
 * real CLI (`scripts/check-design.mjs --globals <css>`) so the exact gate a build
 * runs is what we assert. A clean globals.css PASSES (exit 0); a globals.css that
 * drops a shadcn name OR breaks the Tailwind-v4 wiring FAILS (exit 1, error finding).
 *
 * GENERIC: the fixture css is synthesized here from the contract NAMES — no app /
 * entity / domain literal, no dependency on a checked-in app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERRIDE_SURFACE } from './compile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, '..', '..', 'check-design.mjs');

// Build a minimal-but-COMPLETE globals.css that satisfies RAIL 2: every shadcn
// contract name in both :root and .dark + the Tailwind-v4 wiring.
function goodCss() {
  const names = [...OVERRIDE_SURFACE].filter((n) => n !== 'radius');
  const decls = (val) => names.map((n) => `  --${n}: ${val};`).join('\n') + '\n  --radius: 0.5rem;';
  const colorMap = names.map((n) => `  --color-${n}: var(--${n});`).join('\n');
  return [
    "@import 'tailwindcss';",
    "@import 'tw-animate-css';",
    '@source "../";',
    '@custom-variant dark (&:is(.dark *));',
    ':root {',
    decls('oklch(0.5 0.05 250)'),
    '}',
    '.dark {',
    decls('oklch(0.3 0.05 250)'),
    '}',
    '@theme inline {',
    colorMap,
    '  --radius-md: var(--radius);',
    '}',
  ].join('\n');
}

function runValidator(css) {
  const dir = mkdtempSync(join(tmpdir(), 'rail2-'));
  const file = join(dir, 'globals.css');
  writeFileSync(file, css, 'utf8');
  try {
    const res = spawnSync(process.execPath, [CHECK, '--globals', file], { encoding: 'utf8' });
    const json = JSON.parse(res.stdout.trim());
    return { exit: res.status, json };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a clean globals.css PASSES the Blocks-contract validator (exit 0)', () => {
  const { exit, json } = runValidator(goodCss());
  assert.equal(exit, 0, `expected pass, findings=${JSON.stringify(json.findings)}`);
  assert.equal(json.ok, true);
  assert.equal(json.mode, 'blocks-contract');
  assert.equal(json.counts.error, 0);
  // on-ramp UI-dist @source / UI @import absent → advisory only (warn), not fail.
  assert.ok(json.findings.every((f) => f.severity !== 'error'));
});

test('dropping a shadcn name from :root HARD-FAILS (exit 1, rail2-name-missing)', () => {
  const css = goodCss().replace(/^  --primary: oklch[^\n]*\n/m, ''); // remove from FIRST (:root) block
  const { exit, json } = runValidator(css);
  assert.equal(exit, 1);
  assert.equal(json.ok, false);
  assert.ok(json.findings.some((f) => f.rule === 'rail2-name-missing' && f.severity === 'error'));
});

test('breaking @theme inline HARD-FAILS (exit 1, rail2-wiring)', () => {
  const css = goodCss().replace('@theme inline {', '@theme-OOPS inline {');
  const { exit, json } = runValidator(css);
  assert.equal(exit, 1);
  assert.ok(json.findings.some((f) => f.rule === 'rail2-wiring' && f.severity === 'error'));
});

test('removing @custom-variant dark HARD-FAILS (exit 1, rail2-wiring)', () => {
  const css = goodCss().replace(/@custom-variant dark[^\n]*\n/, '');
  const { exit, json } = runValidator(css);
  assert.equal(exit, 1);
  assert.ok(json.findings.some((f) => f.rule === 'rail2-wiring' && f.severity === 'error'));
});

test('removing every @source HARD-FAILS (exit 1, rail2-wiring)', () => {
  const css = goodCss().replace(/@source[^\n]*\n/g, '');
  const { exit, json } = runValidator(css);
  assert.equal(exit, 1);
  assert.ok(json.findings.some((f) => f.rule === 'rail2-wiring' && f.severity === 'error'));
});

test('a missing .dark block HARD-FAILS (Blocks break in dark mode)', () => {
  // strip the .dark{...} rule entirely
  const css = goodCss().replace(/\.dark \{[\s\S]*?\n\}\n/, '');
  const { exit, json } = runValidator(css);
  assert.equal(exit, 1);
  assert.ok(json.findings.some((f) => f.rule === 'rail2-dark-missing' || f.rule === 'rail2-name-missing'));
});

test('the on-ramp UI @source/@import, when PRESENT, clear the advisory warnings', () => {
  const css =
    goodCss().replace('@source "../";', '@source "../";\n@source "../../node_modules/@constructive-io/ui/dist";') +
    "\n@import '@constructive-io/ui/globals.css';";
  const { exit, json } = runValidator(css);
  assert.equal(exit, 0);
  assert.ok(!json.findings.some((f) => f.rule === 'blocks-onramp'), JSON.stringify(json.findings));
});
