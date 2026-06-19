/** node --test scripts/lib/design/compile.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDesign, renderOverrideBlock, OVERRIDE_SURFACE, BEGIN_SENTINEL, END_SENTINEL } from './compile.mjs';
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

test('compileDesign emits ONLY override-surface vars', () => {
  const { light, dark } = compileDesign(DESIGN);
  for (const map of [light, dark]) {
    for (const key of Object.keys(map)) {
      const bare = key.replace(/^--/, '');
      assert.ok(OVERRIDE_SURFACE.has(bare), `non-override-surface var emitted: ${key}`);
    }
  }
});

test('compileDesign produces all override-surface vars in both modes', () => {
  const { light, dark } = compileDesign(DESIGN);
  for (const bare of OVERRIDE_SURFACE) {
    assert.ok(light[`--${bare}`] != null, `light missing --${bare}`);
    assert.ok(dark[`--${bare}`] != null, `dark missing --${bare}`);
  }
});

test('all emitted color values are valid oklch (or radius rem)', () => {
  const { light, dark } = compileDesign(DESIGN);
  for (const map of [light, dark]) {
    for (const [k, v] of Object.entries(map)) {
      if (k === '--radius') {
        assert.match(v, /rem$/);
        continue;
      }
      assert.doesNotThrow(() => parseColor(v), `invalid color for ${k}: ${v}`);
    }
  }
});

test('.dark is derived (differs from light) and valid', () => {
  const { light, dark } = compileDesign(DESIGN);
  // background should invert from near-white to a dark band
  const lbg = parseColor(light['--background']);
  const dbg = parseColor(dark['--background']);
  assert.ok(lbg.l > 0.8, 'light bg is light');
  assert.ok(dbg.l < 0.35, 'dark bg is dark');
});

test('critical contrast pairs pass AA in both modes', () => {
  const { light, dark } = compileDesign(DESIGN);
  // Each foreground is checked against the surface it is ACTUALLY rendered on —
  // --muted-foreground is painted on --muted (and reused on --secondary), NOT on
  // --background. (The old test checked --muted-foreground/--background, the repair
  // target, which masked a real ~4.41:1 miss on the slightly-darker --muted tint.)
  const pairs = [
    ['--foreground', '--background'],
    ['--primary-foreground', '--primary'],
    ['--muted-foreground', '--muted'],
    ['--muted-foreground', '--secondary'],
    ['--destructive-foreground', '--destructive'],
    ['--secondary-foreground', '--secondary'],
  ];
  for (const map of [light, dark]) {
    for (const [fg, bg] of pairs) {
      const r = contrastRatio(parseColor(map[fg]), parseColor(map[bg]));
      assert.ok(r >= 4.5 - 0.05, `${fg}/${bg} = ${r.toFixed(2)} (mode ${map === dark ? 'dark' : 'light'})`);
    }
  }
});

test('catalog presets compile (never throw) and pass AA on rendered surfaces', () => {
  // Every shipped catalog preset (fixtures/design/*.md) must COMPILE without
  // throwing — including `constructive`, whose vivid mid-luminance sky-blue primary
  // historically crashed the explicit-dark-override branch — and the result's
  // critical text pairs must clear AA against the surface each is painted on. This
  // is the regression guard for both the no-throw contract AND the rendered-surface
  // contrast (a preset that crashes or under-contrasts is caught here, not silently
  // dropped at wire time).
  const CAT_DIR = resolve(HERE, '..', '..', '..', 'fixtures', 'design');
  const presets = readdirSync(CAT_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(presets.length >= 5, `expected >=5 catalog presets, found ${presets.length}`);
  const pairs = [
    ['--foreground', '--background'],
    ['--primary-foreground', '--primary'],
    ['--muted-foreground', '--muted'],
    ['--muted-foreground', '--secondary'],
    ['--destructive-foreground', '--destructive'],
    ['--secondary-foreground', '--secondary'],
    ['--card-foreground', '--card'],
    ['--success-foreground', '--success'],
    ['--warning-foreground', '--warning'],
    ['--info-foreground', '--info'],
  ];
  for (const file of presets) {
    const design = parseDesignMd(readFileSync(resolve(CAT_DIR, file), 'utf8')).frontmatter || {};
    let compiled;
    assert.doesNotThrow(() => {
      compiled = compileDesign(design);
    }, `preset ${file} must compile without throwing`);
    const { light, dark } = compiled;
    for (const map of [light, dark]) {
      for (const [fg, bg] of pairs) {
        const r = contrastRatio(parseColor(map[fg]), parseColor(map[bg]));
        assert.ok(
          r >= 4.5 - 0.05,
          `preset ${file}: ${fg}/${bg} = ${r.toFixed(2)} (mode ${map === dark ? 'dark' : 'light'})`
        );
      }
    }
  }
});

test('success/warning foreground honor the text-on-tint contract (not naive white)', () => {
  const { light, dark } = compileDesign(DESIGN);
  for (const tint of ['success', 'warning', 'info']) {
    const lr = contrastRatio(parseColor(light[`--${tint}-foreground`]), parseColor(light[`--${tint}`]));
    const dr = contrastRatio(parseColor(dark[`--${tint}-foreground`]), parseColor(dark[`--${tint}`]));
    assert.ok(lr >= 4.5 - 0.05, `light ${tint} tint-fg = ${lr.toFixed(2)}`);
    assert.ok(dr >= 4.5 - 0.05, `dark ${tint} tint-fg = ${dr.toFixed(2)}`);
    // In light mode the tint foreground should be DARKER than the tint (dark-on-light tint).
    const ltint = parseColor(light[`--${tint}`]);
    const lfg = parseColor(light[`--${tint}-foreground`]);
    assert.ok(lfg.l < ltint.l, `light ${tint} foreground should be darker than the tint`);
  }
});

test('explicit dark override is honored', () => {
  const withDark = {
    ...DESIGN,
    dark: { colors: { surface: 'oklch(0.18 0.01 250)', 'on-surface': 'oklch(0.96 0 0)' } },
  };
  const { dark } = compileDesign(withDark);
  const dbg = parseColor(dark['--background']);
  assert.ok(Math.abs(dbg.l - 0.18) < 0.02, `dark bg should follow override, got ${dbg.l}`);
});

test('radius falls back through design.radius -> rounded.md -> default', () => {
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' }, radius: '1rem' }).radius, '1rem');
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' }, rounded: { md: '0.25rem' } }).radius, '0.25rem');
  assert.equal(compileDesign({ colors: { primary: 'oklch(0.5 0.1 40)' } }).radius, '0.5rem');
});

test('renderOverrideBlock wraps exactly the marked region and rejects non-surface vars', () => {
  const { light, dark } = compileDesign(DESIGN);
  const css = renderOverrideBlock({ light, dark });
  assert.ok(css.startsWith(BEGIN_SENTINEL));
  assert.ok(css.includes(END_SENTINEL));
  assert.match(css, /:root \{/);
  assert.match(css, /\.dark \{/);
  // structural-safety guard
  assert.throws(() => renderOverrideBlock({ light: { '--font-sans': 'x' }, dark: {} }));
});

test('non-allowlisted font falls back to Geist with a warning', () => {
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
