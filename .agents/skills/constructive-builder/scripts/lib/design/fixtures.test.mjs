/**
 * scripts/lib/design/fixtures.test.mjs — the FIXTURE-DRIVEN engine contract test.
 *
 * Iterates every pair in `fixtures/design/__fixtures__/<name>.{design.md,expected.json}`,
 * parses the design.md via parseDesignMd, runs compileDesign / lintDesign, and asserts
 * each present key of expected.json against the README contract:
 *   light/dark         — deterministic role→var copies (epsilon-compared in OKLCH)
 *   radius             — exact radius string
 *   fonts.{sans,mono}  — resolved family names
 *   overrideSurfaceOnly— every emitted var ∈ OVERRIDE_SURFACE
 *   mustContain/Not    — substring presence/absence in the rendered override block
 *   contrast           — WCAG ratio of named pairs meets `min`
 *   lightnessOrder     — L(darker) < L(lighter)
 *   lint.{ok,expectFindings,forbidFindings,maxSeverity} — invariant findings
 *
 * Zero-dep. Node >=18. Run via `node --test scripts/lib/design/*.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDesign, renderOverrideBlock, OVERRIDE_SURFACE } from './compile.mjs';
import { lintDesign } from './invariants.mjs';
import { parseDesignMd } from './design-md.mjs';
import { parseColor, contrastRatio } from './oklch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(HERE, '..', '..', '..', 'fixtures', 'design', '__fixtures__');

const EPS = 0.06; // OKLCH tolerance — formatOklch rounding + derived-token slack.

function colorClose(aStr, bStr, eps = EPS) {
  const a = parseColor(aStr);
  const b = parseColor(bStr);
  // hue is angular + meaningless at low chroma; compare L and C tightly, h loosely.
  const dl = Math.abs(a.l - b.l);
  const dc = Math.abs(a.c - b.c);
  if (dl > eps || dc > eps) return false;
  if (a.c > 0.03 && b.c > 0.03) {
    let dh = Math.abs(((a.h - b.h + 540) % 360) - 180);
    if (dh > 25) return false;
  }
  return true;
}

function findingMatches(findings, spec) {
  // spec: { rule, severity } OR { anyRule:[...], severity }
  const rules = spec.anyRule || (spec.rule ? [spec.rule] : []);
  return findings.some((f) => {
    if (rules.length && !rules.includes(f.rule)) return false;
    if (spec.severity && f.severity !== spec.severity) return false;
    return true;
  });
}

const expectedFiles = readdirSync(FIX_DIR)
  .filter((f) => f.endsWith('.expected.json'))
  .sort();

assert.ok(expectedFiles.length >= 8, `expected >=8 fixtures, found ${expectedFiles.length}`);

for (const ef of expectedFiles) {
  const name = ef.replace(/\.expected\.json$/, '');
  test(`fixture: ${name}`, () => {
    const expected = JSON.parse(readFileSync(resolve(FIX_DIR, ef), 'utf8'));
    const mdPath = resolve(FIX_DIR, `${name}.design.md`);
    const design = parseDesignMd(readFileSync(mdPath, 'utf8')).frontmatter || {};

    // ── lint assertions ──
    if (expected.lint) {
      const { ok, findings } = lintDesign(design);
      const L = expected.lint;
      if (typeof L.ok === 'boolean') {
        assert.equal(ok, L.ok, `lint.ok mismatch; findings=${JSON.stringify(findings)}`);
      }
      for (const spec of L.expectFindings || []) {
        assert.ok(findingMatches(findings, spec), `missing finding ${JSON.stringify(spec)} in ${JSON.stringify(findings)}`);
      }
      for (const spec of L.forbidFindings || []) {
        assert.ok(!findingMatches(findings, spec), `forbidden finding present ${JSON.stringify(spec)}`);
      }
      if (L.maxSeverity === 'warn') {
        assert.ok(!findings.some((f) => f.severity === 'error'), `expected no error findings, got ${JSON.stringify(findings)}`);
      }
    }

    // Fixtures that are lint-only (no primary cannot compile) skip compile.
    const compileExpected =
      expected.light || expected.dark || expected.radius || expected.fonts ||
      expected.overrideSurfaceOnly || expected.mustContain || expected.mustNotContain ||
      expected.contrast || expected.lightnessOrder;
    if (!compileExpected) return;

    const opts = expected.compileOptions || {};
    const compiled = compileDesign(design, opts);
    const { light, dark } = compiled;
    const css = renderOverrideBlock({ light, dark });

    // ── direct role→var copies ──
    if (expected.light) {
      for (const [k, v] of Object.entries(expected.light)) {
        assert.ok(light[k] != null, `light missing ${k}`);
        assert.ok(colorClose(light[k], v), `light ${k}: got ${light[k]}, expected ≈ ${v}`);
      }
    }
    if (expected.dark) {
      for (const [k, v] of Object.entries(expected.dark)) {
        assert.ok(dark[k] != null, `dark missing ${k}`);
        assert.ok(colorClose(dark[k], v), `dark ${k}: got ${dark[k]}, expected ≈ ${v}`);
      }
    }

    // ── radius ──
    if (expected.radius) assert.equal(compiled.radius, expected.radius);

    // ── fonts ──
    if (expected.fonts) {
      if (expected.fonts.sans) assert.equal(compiled.fonts.sans.family, expected.fonts.sans);
      if (expected.fonts.mono) assert.equal(compiled.fonts.mono.family, expected.fonts.mono);
    }

    // ── override-surface allowlist ──
    if (expected.overrideSurfaceOnly) {
      for (const map of [light, dark]) {
        for (const key of Object.keys(map)) {
          assert.ok(OVERRIDE_SURFACE.has(key.replace(/^--/, '')), `non-override-surface var emitted: ${key}`);
        }
      }
    }

    // ── structural safety / sentinels ──
    for (const s of expected.mustContain || []) assert.ok(css.includes(s), `override block missing: ${s}`);
    for (const s of expected.mustNotContain || []) assert.ok(!css.includes(s), `override block must NOT contain: ${s}`);

    // ── contrast pairs ──
    for (const c of expected.contrast || []) {
      const map = c.mode === 'dark' ? dark : light;
      const r = contrastRatio(parseColor(map[c.fg]), parseColor(map[c.bg]));
      assert.ok(r >= c.min - 0.05, `${c.mode} ${c.fg}/${c.bg} = ${r.toFixed(2)} < ${c.min}`);
    }

    // ── lightness ordering ──
    for (const o of expected.lightnessOrder || []) {
      const map = o.mode === 'dark' ? dark : light;
      const ld = parseColor(map[o.darker]).l;
      const ll = parseColor(map[o.lighter]).l;
      assert.ok(ld < ll, `${o.mode}: L(${o.darker})=${ld.toFixed(3)} should be < L(${o.lighter})=${ll.toFixed(3)}`);
    }
  });
}
