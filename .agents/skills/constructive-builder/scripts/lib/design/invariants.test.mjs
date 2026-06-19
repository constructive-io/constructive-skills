/** node --test scripts/lib/design/invariants.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDesign } from './invariants.mjs';

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const sev = (findings, rule) => findings.find((f) => f.rule === rule)?.severity;

test('flags missing primary as an error', () => {
  const { ok, findings } = lintDesign({ colors: { surface: 'oklch(1 0 0)' } });
  assert.equal(ok, false);
  assert.equal(sev(findings, 'missing-primary'), 'error');
});

test('a clean trust-first design passes', () => {
  const { ok, findings } = lintDesign({
    colors: {
      primary: 'oklch(0.5 0.12 230)',
      surface: 'oklch(0.99 0 0)',
      'on-surface': 'oklch(0.22 0 0)',
      error: 'oklch(0.55 0.2 25)',
    },
    allow_brand_hue: true, // primary is in band but explicitly allowed
  });
  assert.equal(ok, true, JSON.stringify(findings));
});

test('flags the AI purple band for primary unless allowed', () => {
  const banded = {
    colors: { primary: 'oklch(0.55 0.2 280)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
  };
  let r = lintDesign(banded);
  assert.equal(has(r.findings, 'ai-purple-band'), true);
  assert.equal(sev(r.findings, 'ai-purple-band'), 'warn');
  // opt-in clears it
  r = lintDesign({ ...banded, allow_brand_hue: true });
  assert.equal(has(r.findings, 'ai-purple-band'), false);
});

test('flags pure/near black', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(0.05 0 0)', 'on-surface': 'oklch(0.95 0 0)' },
  });
  assert.equal(has(r.findings, 'pure-black'), true);
});

test('flags over-saturated color (>80% of gamut)', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.6 0.34 40)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
  });
  assert.equal(has(r.findings, 'saturation'), true);
});

test('flags more than one accent role', () => {
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
});

test('flags a contrast failure as error below 3:1', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(0.99 0 0)', 'on-surface': 'oklch(0.9 0 0)' },
  });
  assert.equal(has(r.findings, 'contrast-pairs'), true);
  assert.equal(r.ok, false);
});

test('flags non px/em/rem dimension units', () => {
  const r = lintDesign({
    colors: { primary: 'oklch(0.5 0.1 40)', surface: 'oklch(1 0 0)', 'on-surface': 'oklch(0.2 0 0)' },
    rounded: { md: '8pt' },
  });
  assert.equal(has(r.findings, 'dimension-units'), true);
});

test('warns on illegible explicit tint foreground', () => {
  const r = lintDesign({
    colors: {
      primary: 'oklch(0.5 0.1 40)',
      surface: 'oklch(1 0 0)',
      'on-surface': 'oklch(0.2 0 0)',
      success: 'oklch(0.6 0.13 150)',
      'success-foreground': 'oklch(0.95 0 0)', // light-on-light tint => fail
    },
  });
  assert.equal(has(r.findings, 'tint-foreground'), true);
});
