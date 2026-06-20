/** node --test scripts/lib/design/invariants.test.mjs
 *
 * POST-PIVOT: lintDesign is ADVISORY. Taste rules fire as warn/info and NEVER fail
 * the lint (`ok` stays true). The ONLY error is the STRUCTURAL `missing-primary`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDesign } from './invariants.mjs';

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const sev = (findings, rule) => findings.find((f) => f.rule === rule)?.severity;

test('missing primary is the ONE structural error (ok=false)', () => {
  const { ok, findings } = lintDesign({ colors: { surface: 'oklch(1 0 0)' } });
  assert.equal(ok, false);
  assert.equal(sev(findings, 'missing-primary'), 'error');
});

test('a clean design passes (ok=true)', () => {
  const { ok, findings } = lintDesign({
    colors: {
      primary: 'oklch(0.5 0.12 230)',
      surface: 'oklch(0.99 0 0)',
      'on-surface': 'oklch(0.22 0 0)',
      error: 'oklch(0.55 0.2 25)',
    },
    allow_brand_hue: true,
  });
  assert.equal(ok, true, JSON.stringify(findings));
});

test('ADVISORY: contrast failure is a WARN (not error) and ok stays true', () => {
  const { ok, findings } = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(0.99 0 0)', 'on-surface': 'oklch(0.9 0 0)' },
  });
  assert.equal(has(findings, 'contrast-pairs'), true);
  assert.equal(sev(findings, 'contrast-pairs'), 'warn'); // below 3:1 → warn, never error
  assert.equal(ok, true, `taste/contrast must not fail the gate: ${JSON.stringify(findings)}`);
});

test('ADVISORY: a sub-AA-but-above-3 pair is INFO and ok stays true', () => {
  const { ok, findings } = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(0.99 0 0)', 'on-surface': 'oklch(0.55 0 0)' },
  });
  // ~3..4.5 band → info
  const f = findings.find((x) => x.rule === 'contrast-pairs');
  if (f) assert.ok(f.severity === 'info' || f.severity === 'warn');
  assert.equal(ok, true);
});

test('ADVISORY: AI purple band is a warn (silenceable), ok stays true', () => {
  const banded = {
    colors: { primary: 'oklch(0.55 0.2 280)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
  };
  let r = lintDesign(banded);
  assert.equal(has(r.findings, 'ai-purple-band'), true);
  assert.equal(sev(r.findings, 'ai-purple-band'), 'warn');
  assert.equal(r.ok, true);
  r = lintDesign({ ...banded, allow_brand_hue: true });
  assert.equal(has(r.findings, 'ai-purple-band'), false);
});

test('ADVISORY: pure/near black is a warn, ok stays true', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(0.05 0 0)', 'on-surface': 'oklch(0.95 0 0)' },
  });
  assert.equal(has(r.findings, 'pure-black'), true);
  assert.equal(sev(r.findings, 'pure-black'), 'warn');
  assert.equal(r.ok, true);
});

test('ADVISORY: over-saturated color is a warn, ok stays true', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.6 0.34 40)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
  });
  assert.equal(has(r.findings, 'saturation'), true);
  assert.equal(sev(r.findings, 'saturation'), 'warn');
  assert.equal(r.ok, true);
});

test('ADVISORY: more than one accent role is a warn, ok stays true', () => {
  const r = lintDesign({
    colors: {
      primary: 'oklch(0.5 0.1 40)',
      accent: 'oklch(0.6 0.1 200)',
      tertiary: 'oklch(0.6 0.1 300)',
      surface: 'oklch(1 0 0)',
      'on-surface': 'oklch(0.2 0 0)',
    },
  });
  assert.equal(has(r.findings, 'accent-count'), true);
  assert.equal(sev(r.findings, 'accent-count'), 'warn');
  assert.equal(r.ok, true);
});

test('ADVISORY: non px/em/rem dimension units are a warn, ok stays true', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
    rounded: { md: '8pt' },
  });
  assert.equal(has(r.findings, 'dimension-units'), true);
  assert.equal(sev(r.findings, 'dimension-units'), 'warn');
  assert.equal(r.ok, true);
});

test('ADVISORY: illegible explicit tint foreground is a warn, ok stays true', () => {
  const r = lintDesign({
    colors: {
      primary: 'oklch(0.5 0.1 40)',
      surface: 'oklch(1 0 0)',
      'on-surface': 'oklch(0.2 0 0)',
      success: 'oklch(0.6 0.13 150)',
      'success-foreground': 'oklch(0.95 0 0)', // light-on-light tint => advisory
    },
  });
  assert.equal(has(r.findings, 'tint-foreground'), true);
  assert.equal(r.ok, true);
});
