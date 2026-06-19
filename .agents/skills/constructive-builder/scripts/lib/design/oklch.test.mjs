/** node --test scripts/lib/design/oklch.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor,
  formatOklch,
  toSrgb,
  fromSrgb,
  contrastRatio,
  relativeLuminance,
  withLightness,
  rotateHue,
  isAiPurpleBand,
  ensureContrast,
} from './oklch.mjs';

const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

test('hex round-trips through OKLCH back to sRGB', () => {
  for (const hex of ['#ffffff', '#000000', '#3b82f6', '#e11d48', '#10b981', '#7c3aed']) {
    const oklch = parseColor(hex);
    const rgb = toSrgb(oklch);
    const back = fromSrgb(rgb);
    const rgb2 = toSrgb(back);
    assert.ok(near(rgb.r, rgb2.r, 2e-3), `${hex} r`);
    assert.ok(near(rgb.g, rgb2.g, 2e-3), `${hex} g`);
    assert.ok(near(rgb.b, rgb2.b, 2e-3), `${hex} b`);
  }
});

test('white and black map to expected OKLCH lightness', () => {
  const white = parseColor('#ffffff');
  const black = parseColor('#000000');
  assert.ok(near(white.l, 1.0, 1e-2));
  assert.ok(near(black.l, 0.0, 1e-2));
  assert.ok(white.c < 0.01);
  assert.ok(black.c < 0.01);
});

test('parseColor accepts oklch() and formatOklch round-trips', () => {
  const c = parseColor('oklch(0.55 0.16 250)');
  assert.ok(near(c.l, 0.55));
  assert.ok(near(c.c, 0.16));
  assert.ok(near(c.h, 250));
  const s = formatOklch(c);
  const c2 = parseColor(s);
  assert.ok(near(c2.l, 0.55, 1e-3));
  assert.ok(near(c2.h, 250, 1e-1));
});

test('parseColor accepts rgb()', () => {
  const fromRgb = parseColor('rgb(255, 255, 255)');
  assert.ok(near(fromRgb.l, 1.0, 1e-2));
});

test('contrastRatio matches known WCAG values', () => {
  const white = parseColor('#ffffff');
  const black = parseColor('#000000');
  // black-on-white is the canonical 21:1
  assert.ok(near(contrastRatio(white, black), 21, 0.1), `got ${contrastRatio(white, black)}`);
  // identical colors => 1:1
  assert.ok(near(contrastRatio(white, white), 1, 1e-3));
  // #767676 on white ~ 4.54:1 (the classic AA boundary gray)
  const gray = parseColor('#767676');
  const r = contrastRatio(gray, white);
  assert.ok(r > 4.4 && r < 4.7, `#767676/white expected ~4.54, got ${r}`);
});

test('relativeLuminance: white=1, black=0', () => {
  assert.ok(near(relativeLuminance(toSrgb(parseColor('#ffffff'))), 1, 1e-2));
  assert.ok(near(relativeLuminance(toSrgb(parseColor('#000000'))), 0, 1e-3));
});

test('isAiPurpleBand flags generic blue-purple, clears branded hues', () => {
  assert.equal(isAiPurpleBand({ h: 280, c: 0.2 }), true);
  assert.equal(isAiPurpleBand({ h: 265, c: 0.18 }), true);
  assert.equal(isAiPurpleBand({ h: 280, c: 0.05 }), false); // too desaturated
  assert.equal(isAiPurpleBand({ h: 150, c: 0.2 }), false); // green
  assert.equal(isAiPurpleBand({ h: 30, c: 0.2 }), false); // orange
});

test('rotateHue and withLightness are pure + correct', () => {
  const c = { l: 0.5, c: 0.1, h: 100, a: 1 };
  assert.equal(rotateHue(c, 40).h, 140);
  assert.equal(rotateHue(c, -150).h, 310);
  assert.equal(withLightness(c, 0.8).l, 0.8);
  assert.equal(c.h, 100, 'original unmutated');
});

test('ensureContrast makes a failing pair pass', () => {
  const bg = parseColor('#ffffff');
  const fg = parseColor('#cccccc'); // ~1.6:1 fail
  assert.ok(contrastRatio(fg, bg) < 4.5);
  const fixed = ensureContrast(fg, bg, 4.5);
  assert.ok(contrastRatio(fixed, bg) >= 4.5 - 1e-3, `got ${contrastRatio(fixed, bg)}`);
});

test('ensureContrast on a dark background lightens the foreground', () => {
  const bg = parseColor('oklch(0.21 0.006 285)');
  const fg = parseColor('oklch(0.3 0.05 285)');
  const fixed = ensureContrast(fg, bg, 4.5);
  assert.ok(contrastRatio(fixed, bg) >= 4.5 - 1e-3);
  assert.ok(fixed.l > fg.l, 'moved lighter against a dark bg');
});

test('ensureContrast is a no-op when already passing', () => {
  const bg = parseColor('#ffffff');
  const fg = parseColor('#000000');
  const fixed = ensureContrast(fg, bg, 4.5);
  assert.equal(fixed.l, fg.l);
});
