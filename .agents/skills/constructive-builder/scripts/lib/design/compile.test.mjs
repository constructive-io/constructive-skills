/** node --test scripts/lib/design/compile.test.mjs
 *
 * POST-PIVOT behavior under test:
 *   • FAITHFUL EMIT — an authored design.md value is emitted VERBATIM (no clamp).
 *   • SYNTHESIS GUARANTEE — every shadcn contract name exists in both modes (RAIL 2).
 *   • PASS-THROUGH — custom `tokens:`/`extra:` vars + custom roles flow through verbatim.
 *   • .dark still DERIVED when no `dark:` map; authored dark wins verbatim.
 *   • renderOverrideBlock passes custom vars through, refuses ONLY structural wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileDesign,
  renderOverrideBlock,
  OVERRIDE_SURFACE,
  CONTRACT_NAMES,
  BEGIN_SENTINEL,
  END_SENTINEL,
} from './compile.mjs';
import { parseColor, contrastRatio } from './oklch.mjs';
import { parseDesignMd } from './design-md.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const DESIGN = {
  name: 'Test',
  colors: {
    primary: 'oklch(0.55 0.13 230)',
    surface: 'oklch(0.99 0 0)',
    'on-surface': 'oklch(0.25 0 0)',
    error: 'oklch(0.55 0.2 25)',
  },
  rounded: { md: '0.375rem' },
};

const close = (aStr, bStr, eps = 0.005) => {
  const a = parseColor(aStr);
  const b = parseColor(bStr);
  return Math.abs(a.l - b.l) <= eps && Math.abs(a.c - b.c) <= eps;
};

test('CONTRACT_NAMES aliases OVERRIDE_SURFACE (the synthesis-guarantee set)', () => {
  assert.equal(CONTRACT_NAMES, OVERRIDE_SURFACE);
});

test('synthesizes every shadcn contract name in BOTH modes (RAIL 2 holds)', () => {
  const { light, dark } = compileDesign(DESIGN);
  for (const bare of OVERRIDE_SURFACE) {
    assert.ok(light[`--${bare}`] != null, `light missing --${bare}`);
    assert.ok(dark[`--${bare}`] != null, `dark missing --${bare}`);
  }
});

test('FAITHFUL EMIT: an authored value is emitted VERBATIM (no contrast clamp)', () => {
  // A deliberately low-contrast authored pair: surface near-white, on-surface a mid
  // gray that does NOT reach AA. The OLD compiler clamped on-surface darker to force
  // AA; the pivot emits it verbatim.
  const authored = {
    name: 'Faithful',
    colors: {
      primary: 'oklch(0.55 0.13 230)',
      surface: 'oklch(0.99 0 0)',
      'on-surface': 'oklch(0.62 0 0)', // ~low contrast on near-white — intentionally
    },
  };
  const { light } = compileDesign(authored);
  assert.ok(close(light['--background'], 'oklch(0.99 0 0)'), `background not verbatim: ${light['--background']}`);
  assert.ok(close(light['--foreground'], 'oklch(0.62 0 0)'), `foreground was clamped, not verbatim: ${light['--foreground']}`);
  // and it really is below AA (proving no repair happened)
  const r = contrastRatio(parseColor(light['--foreground']), parseColor(light['--background']));
  assert.ok(r < 4.5, `expected sub-AA verbatim pair, got ${r.toFixed(2)}`);
});

test('FAITHFUL EMIT: an authored shadcn role (border/ring/muted) is verbatim', () => {
  const authored = {
    colors: {
      primary: 'oklch(0.55 0.13 230)',
      surface: 'oklch(0.99 0 0)',
      'on-surface': 'oklch(0.25 0 0)',
      border: 'oklch(0.7 0.05 30)',
      ring: 'oklch(0.6 0.2 300)',
      muted: 'oklch(0.95 0.02 90)',
      'muted-foreground': 'oklch(0.4 0.01 90)',
    },
  };
  const { light } = compileDesign(authored);
  assert.ok(close(light['--border'], 'oklch(0.7 0.05 30)'), `border: ${light['--border']}`);
  assert.ok(close(light['--ring'], 'oklch(0.6 0.2 300)'), `ring: ${light['--ring']}`);
  assert.ok(close(light['--muted'], 'oklch(0.95 0.02 90)'), `muted: ${light['--muted']}`);
  assert.ok(close(light['--muted-foreground'], 'oklch(0.4 0.01 90)'), `muted-foreground: ${light['--muted-foreground']}`);
});

test('FAITHFUL EMIT: an authored status tint + foreground is verbatim (no re-pair)', () => {
  const authored = {
    colors: {
      primary: 'oklch(0.55 0.13 230)',
      surface: 'oklch(0.99 0 0)',
      'on-surface': 'oklch(0.25 0 0)',
      success: 'oklch(0.55 0.16 150)',
      'success-foreground': 'oklch(0.99 0 0)',
    },
  };
  const { light } = compileDesign(authored);
  assert.ok(close(light['--success'], 'oklch(0.55 0.16 150)'), `success: ${light['--success']}`);
  assert.ok(close(light['--success-foreground'], 'oklch(0.99 0 0)'), `success-fg: ${light['--success-foreground']}`);
});

test('SYNTHESIS still derives unspecified names sensibly (border/muted-fg exist + legible)', () => {
  // DESIGN authors NO border/muted/muted-foreground → synthesis fills them.
  const { light } = compileDesign(DESIGN);
  assert.ok(light['--border'] != null);
  // synthesized muted-foreground should be legible on synthesized muted (sensible default)
  const r = contrastRatio(parseColor(light['--muted-foreground']), parseColor(light['--muted']));
  assert.ok(r >= 4.5 - 0.05, `synthesized muted-fg/muted = ${r.toFixed(2)} should be legible`);
});

test('PASS-THROUGH: custom tokens (tokens:/extra:) emit verbatim alongside shadcn names', () => {
  const withCustom = {
    ...DESIGN,
    tokens: { '--brand-glow': 'oklch(0.7 0.2 300)', '--space-rhythm': '1.5rem' },
    extra: { 'ornament-weight': '600' }, // bare name (no --) also accepted
  };
  const { light, dark } = compileDesign(withCustom);
  assert.equal(light['--brand-glow'], 'oklch(0.7 0.2 300)');
  assert.equal(light['--space-rhythm'], '1.5rem');
  assert.equal(light['--ornament-weight'], '600');
  // shared custom tokens also reach dark
  assert.equal(dark['--brand-glow'], 'oklch(0.7 0.2 300)');
  // shadcn names still present (RAIL 2 not disturbed)
  assert.ok(light['--primary'] != null && dark['--primary'] != null);
});

test('PASS-THROUGH: a dark.tokens override adds/overrides custom tokens in dark only', () => {
  const withCustom = {
    ...DESIGN,
    tokens: { '--brand-glow': 'oklch(0.7 0.2 300)' },
    dark: { tokens: { '--brand-glow': 'oklch(0.5 0.2 300)', '--dark-only': 'oklch(0.3 0 0)' } },
  };
  const { light, dark } = compileDesign(withCustom);
  assert.equal(light['--brand-glow'], 'oklch(0.7 0.2 300)');
  assert.equal(dark['--brand-glow'], 'oklch(0.5 0.2 300)'); // dark override wins
  assert.equal(dark['--dark-only'], 'oklch(0.3 0 0)');
  assert.equal(light['--dark-only'], undefined);
});

test('PASS-THROUGH: a structural-wiring custom token is DROPPED (+ warning), never emitted', () => {
  const withBad = {
    ...DESIGN,
    tokens: { '--color-primary': 'oklch(0.5 0.1 0)', '--font-sans': 'Comic Sans' },
  };
  const { light, warnings } = compileDesign(withBad);
  assert.equal(light['--color-primary'], undefined, 'structural --color-* must not pass through');
  assert.equal(light['--font-sans'], undefined, 'structural --font-* must not pass through');
  assert.ok(warnings.some((w) => /structural wiring/.test(w)));
});

test('all emitted color values are valid (oklch, custom, or radius rem)', () => {
  const { light, dark } = compileDesign({ ...DESIGN, tokens: { '--space-x': '1rem' } });
  for (const map of [light, dark]) {
    for (const [k, v] of Object.entries(map)) {
      if (k === '--radius' || k === '--space-x') {
        assert.match(v, /rem$/);
        continue;
      }
      if (!OVERRIDE_SURFACE.has(k.replace(/^--/, ''))) continue; // custom token, format is the author's call
      assert.doesNotThrow(() => parseColor(v), `invalid color for ${k}: ${v}`);
    }
  }
});

test('.dark is DERIVED (differs from light) when no dark: map', () => {
  const { light, dark } = compileDesign(DESIGN);
  const lbg = parseColor(light['--background']);
  const dbg = parseColor(dark['--background']);
  assert.ok(lbg.l > 0.8, 'light bg is light');
  assert.ok(dbg.l < 0.35, 'dark bg is dark');
});

test('explicit dark override is honored VERBATIM (authored surface + foreground)', () => {
  const withDark = {
    ...DESIGN,
    dark: { colors: { surface: 'oklch(0.18 0.01 250)', 'on-surface': 'oklch(0.96 0 0)' } },
  };
  const { dark } = compileDesign(withDark);
  assert.ok(close(dark['--background'], 'oklch(0.18 0.01 250)', 0.02), `dark bg: ${dark['--background']}`);
  assert.ok(close(dark['--foreground'], 'oklch(0.96 0 0)', 0.02), `dark fg: ${dark['--foreground']}`);
});

test('catalog presets all COMPILE without throwing (faithful, no clamp crashes)', () => {
  const CAT_DIR = resolve(HERE, '..', '..', '..', 'fixtures', 'design');
  const presets = readdirSync(CAT_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(presets.length >= 5, `expected >=5 catalog presets, found ${presets.length}`);
  for (const file of presets) {
    const design = parseDesignMd(readFileSync(resolve(CAT_DIR, file), 'utf8')).frontmatter || {};
    let compiled;
    assert.doesNotThrow(() => {
      compiled = compileDesign(design);
    }, `preset ${file} must compile without throwing`);
    // RAIL 2: every contract name present in both modes for every shipped preset.
    for (const bare of OVERRIDE_SURFACE) {
      assert.ok(compiled.light[`--${bare}`] != null, `${file}: light missing --${bare}`);
      assert.ok(compiled.dark[`--${bare}`] != null, `${file}: dark missing --${bare}`);
    }
  }
});

test('radius falls back through design.radius -> rounded.md -> default', () => {
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' }, radius: '1rem' }).radius, '1rem');
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' }, rounded: { md: '0.25rem' } }).radius, '0.25rem');
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' } }).radius, '0.5rem');
});

test('renderOverrideBlock wraps the marked region and PASSES custom vars through', () => {
  const { light, dark } = compileDesign({ ...DESIGN, tokens: { '--brand-glow': 'oklch(0.7 0.2 300)' } });
  const css = renderOverrideBlock({ light, dark });
  assert.ok(css.startsWith(BEGIN_SENTINEL));
  assert.ok(css.includes(END_SENTINEL));
  assert.match(css, /:root \{/);
  assert.match(css, /\.dark \{/);
  // custom var passes through (no longer rejected)
  assert.match(css, /--brand-glow: oklch\(0\.7 0\.2 300\);/);
  // a plain custom var does NOT throw
  assert.doesNotThrow(() => renderOverrideBlock({ light: { '--my-token': 'red' }, dark: {} }));
});

test('renderOverrideBlock STILL refuses a structural-wiring var (would break RAIL 2 wiring)', () => {
  assert.throws(() => renderOverrideBlock({ light: { '--color-primary': 'x' }, dark: {} }), /structural-wiring/);
  assert.throws(() => renderOverrideBlock({ light: { '--font-sans': 'x' }, dark: {} }), /structural-wiring/);
});

test('non-allowlisted font falls back to Geist with a warning (font handling unchanged)', () => {
  const { fonts, warnings } = compileDesign({ ...DESIGN, font: { sans: 'Comic Sans' } });
  assert.equal(fonts.sans.family, 'Geist');
  assert.ok(warnings.some((w) => /Comic Sans/.test(w)));
});

test('an allowlisted font resolves keeping the geist variable name', () => {
  const { fonts } = compileDesign({ ...DESIGN, font: { sans: 'Outfit', mono: 'JetBrains Mono' } });
  assert.equal(fonts.sans.family, 'Outfit');
  assert.equal(fonts.sans.variable, '--font-geist-sans');
  assert.equal(fonts.mono.family, 'JetBrains Mono');
  assert.equal(fonts.mono.variable, '--font-geist-mono');
});
