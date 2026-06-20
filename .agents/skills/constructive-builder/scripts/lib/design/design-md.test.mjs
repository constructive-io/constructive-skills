/** node --test scripts/lib/design/design-md.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, serializeDesignMd } from './design-md.mjs';
import { compileDesign } from './compile.mjs';

const SAMPLE = `---
name: Editorial Calm
description: warm, trustworthy, print feel
colors:
  primary: "oklch(0.55 0.12 40)"
  surface: "oklch(0.99 0 0)"
  on-surface: "oklch(0.25 0 0)"
rounded:
  md: "0.375rem"
allow_brand_hue: true
---

# Editorial Calm

A warm editorial theme with generous line height.
`;

test('parseDesignMd splits frontmatter + prose', () => {
  const { frontmatter, prose } = parseDesignMd(SAMPLE);
  assert.equal(frontmatter.name, 'Editorial Calm');
  assert.equal(frontmatter.colors.primary, 'oklch(0.55 0.12 40)');
  assert.equal(frontmatter.rounded.md, '0.375rem');
  assert.equal(frontmatter.allow_brand_hue, true);
  assert.match(prose, /generous line height/);
});

test('parseDesignMd tolerates a doc with no frontmatter', () => {
  const { frontmatter, prose } = parseDesignMd('# just prose\n\nhello');
  assert.deepEqual(frontmatter, {});
  assert.match(prose, /just prose/);
});

test('serialize -> parse round-trips frontmatter values', () => {
  const { frontmatter, prose } = parseDesignMd(SAMPLE);
  const text = serializeDesignMd({ frontmatter, prose });
  const again = parseDesignMd(text);
  assert.equal(again.frontmatter.name, frontmatter.name);
  assert.equal(again.frontmatter.colors.primary, frontmatter.colors.primary);
  assert.equal(again.frontmatter.rounded.md, frontmatter.rounded.md);
  assert.equal(again.frontmatter.allow_brand_hue, true);
  assert.match(again.prose, /generous line height/);
});

test('serialize emits a fenced frontmatter block', () => {
  const text = serializeDesignMd({ frontmatter: { name: 'X', colors: { primary: 'oklch(0.5 0.1 200)' } }, prose: 'body' });
  assert.match(text, /^---\n/);
  assert.match(text, /\n---\n/);
  assert.match(text, /body/);
});

// REGRESSION: a hand-authored design.md may write color VALUES UNQUOTED — the
// spaces/parens/commas inside `oklch()`/`rgb()`/`color-mix()` must NOT make the
// zero-dep reader drop the value (which read as a false "missing primary").
const UNQUOTED = `---
name: Unquoted Color
colors:
  primary: oklch(0.55 0.34 280)
  surface: oklch(0.99 0 0)
  on-surface: rgb(40, 40, 48)
tokens:
  --brand-blend: color-mix(in oklch, oklch(0.6 0.2 280) 60%, white)
---

# Unquoted Color
A theme whose colors are written without quotes.
`;

test('parseDesignMd tolerates UNQUOTED oklch()/rgb()/color-mix() values', () => {
  const { frontmatter } = parseDesignMd(UNQUOTED);
  // The function text is preserved verbatim as the scalar (no split on inner
  // spaces/commas, no false-absent primary).
  assert.equal(frontmatter.colors.primary, 'oklch(0.55 0.34 280)');
  assert.equal(frontmatter.colors.surface, 'oklch(0.99 0 0)');
  assert.equal(frontmatter.colors['on-surface'], 'rgb(40, 40, 48)');
  // A nested-paren, inner-comma custom token survives as ONE opaque scalar.
  assert.equal(frontmatter.tokens['--brand-blend'], 'color-mix(in oklch, oklch(0.6 0.2 280) 60%, white)');
});

test('an UNQUOTED-color design.md compiles (primary survives verbatim, no missing-primary)', () => {
  const { frontmatter } = parseDesignMd(UNQUOTED);
  const { light } = compileDesign(frontmatter);
  // primary is present (NOT the neutral missing-primary default) and verbatim.
  assert.equal(light['--primary'], 'oklch(0.55 0.34 280)');
  assert.ok(light['--background'] != null && light['--foreground'] != null);
  // the unquoted custom token passes through verbatim too.
  assert.equal(light['--brand-blend'], 'color-mix(in oklch, oklch(0.6 0.2 280) 60%, white)');
});

test('pre-quoting is idempotent — already-quoted values are unchanged', () => {
  const { frontmatter } = parseDesignMd(SAMPLE); // SAMPLE uses quoted oklch()
  assert.equal(frontmatter.colors.primary, 'oklch(0.55 0.12 40)');
});
