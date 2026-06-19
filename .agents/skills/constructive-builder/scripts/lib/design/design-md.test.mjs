/** node --test scripts/lib/design/design-md.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, serializeDesignMd } from './design-md.mjs';

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
