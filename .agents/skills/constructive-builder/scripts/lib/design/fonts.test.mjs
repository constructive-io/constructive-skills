/** node --test scripts/lib/design/fonts.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFont, listFonts } from './fonts.mjs';

test('resolves an allowlisted sans font and binds the geist-sans variable', () => {
  const f = resolveFont('Outfit', { role: 'sans' });
  assert.equal(f.family, 'Outfit');
  assert.equal(f.loaderName, 'Outfit');
  assert.equal(f.variable, '--font-geist-sans');
  assert.match(f.importLine, /import \{ Outfit \} from 'next\/font\/google';/);
  assert.equal(f.warning, undefined);
});

test('resolves a multi-word mono font to its underscored loader', () => {
  const f = resolveFont('JetBrains Mono', { role: 'mono' });
  assert.equal(f.loaderName, 'JetBrains_Mono');
  assert.equal(f.variable, '--font-geist-mono');
});

test('unknown font falls back to Geist + warns', () => {
  const f = resolveFont('Papyrus', { role: 'sans' });
  assert.equal(f.family, 'Geist');
  assert.equal(f.variable, '--font-geist-sans');
  assert.match(f.warning, /not on the sans allowlist/);
});

test('empty/undefined => Geist fallback without a warning', () => {
  const f = resolveFont(undefined, { role: 'sans' });
  assert.equal(f.family, 'Geist');
  assert.equal(f.warning, undefined);
});

test('listFonts returns both ramps', () => {
  const { sans, mono } = listFonts();
  assert.ok(sans.includes('Geist'));
  assert.ok(mono.includes('Geist Mono'));
});
