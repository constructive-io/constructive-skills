/**
 * scripts/lib/design/design-md.mjs — PARSE-ONLY reader for a Google-Labs-style
 * `design.md`: a Markdown document with a YAML frontmatter block delimited by
 * `---` fences, followed by free prose.
 *
 * Sole consumer is scaffold-frontend.mjs, which calls parseDesignMd to read the
 * LAYOUT-DENSITY dial out of an emitted design.md's frontmatter. The frontmatter is
 * parsed with the skill's EXISTING zero-dep YAML reader (`parseBrief` from
 * ../brief-yaml.mjs) — NO new dependency — via the quoteUnquotedCssFunctions helper
 * that tolerates hand-authored UNQUOTED `oklch()`/`rgb()`/`color-mix()` values, so
 * the density read never trips over a design.md's color tokens.
 *
 * ZERO-DEP. Node >=18 ESM. Pure functions. There is no serializer: the design.md is
 * authored by the agent, never machine-emitted, so this module only reads.
 */

import { parseBrief } from '../brief-yaml.mjs';

/**
 * The CSS color/value FUNCTIONS a hand-authored `design.md` is allowed to write
 * UNQUOTED. Their argument lists contain spaces, parens, and (for `color-mix`)
 * inner commas + an `in <space>` token with no `:` — all of which the zero-dep
 * YAML reader would otherwise mis-tokenize (a flow `{…}`/`[…]` would split on the
 * inner comma; a bare scalar after a `:` is fine but a value INSIDE a flow map is
 * not). We pre-quote these verbatim so the reader sees one opaque scalar.
 */
const CSS_FN = /^(?:oklch|oklab|lch|lab|rgba?|hsla?|hwb|color-mix|color|var|calc|min|max|clamp|linear-gradient|radial-gradient|conic-gradient)$/i;

/**
 * Walk a frontmatter YAML string and wrap every UNQUOTED CSS-function value
 * (`oklch(…)`, `rgb(…)`, `color-mix(…)`, …) in double quotes, preserving the
 * function text verbatim. Quoting is skipped inside existing `'…'`/`"…"` strings
 * and for already-quoted values, so this is idempotent and safe to run on the
 * shipped (already-quoted) presets. Balanced parens are tracked so a nested call
 * like `color-mix(in oklch, oklch(…) 50%, white)` is captured as ONE token.
 */
function quoteUnquotedCssFunctions(yamlText) {
  let out = '';
  let i = 0;
  const n = yamlText.length;
  // A function name must start at a token boundary: line start, or after one of
  // these scalar-context delimiters (`:` `,` `[` `{` whitespace `>` `-`).
  const isBoundary = (ch) => ch === undefined || /[\s:,[{(>-]/.test(ch);
  while (i < n) {
    const c = yamlText[i];
    // Pass quoted strings (and their content) through untouched.
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        out += yamlText[i];
        if (yamlText[i] === q && yamlText[i - 1] !== '\\') { i++; break; }
        i++;
      }
      continue;
    }
    // A `#` outside quotes starts a comment to end-of-line — copy it verbatim.
    if (c === '#') {
      const eol = yamlText.indexOf('\n', i);
      const end = eol === -1 ? n : eol;
      out += yamlText.slice(i, end);
      i = end;
      continue;
    }
    // Try to match a CSS function name token at a boundary.
    if (/[A-Za-z]/.test(c) && isBoundary(yamlText[i - 1])) {
      let j = i;
      while (j < n && /[A-Za-z-]/.test(yamlText[j])) j++;
      const name = yamlText.slice(i, j);
      if (CSS_FN.test(name) && yamlText[j] === '(') {
        // Capture the balanced (...) group.
        let depth = 0;
        let k = j;
        for (; k < n; k++) {
          const ch = yamlText[k];
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (depth === 0) { k++; break; } }
        }
        if (depth === 0) {
          // Extend across trailing space-separated modifiers that belong to the
          // same value (e.g. `oklch(…) 50%`) up to a top-level `,` `]` `}` `\n` —
          // OR a ` #` comment start (which the reader strips), so a trailing
          // comment is NOT swallowed into the quoted value.
          while (k < n && !/[,\]}\n]/.test(yamlText[k])) {
            if (yamlText[k] === '#' && /\s/.test(yamlText[k - 1])) break;
            if (yamlText[k] === '(') { let d = 1; k++; while (k < n && d > 0) { if (yamlText[k] === '(') d++; else if (yamlText[k] === ')') d--; k++; } }
            else k++;
          }
          const value = yamlText.slice(i, k).replace(/\s+$/, '');
          const trailing = yamlText.slice(i + value.length, k);
          out += `"${value.replace(/"/g, '\\"')}"${trailing}`;
          i = k;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Split a `design.md` text into its frontmatter object + prose body.
 *   parseDesignMd(text) -> { frontmatter, prose }
 * Frontmatter keys: version?, name, description?, colors, typography, rounded,
 * spacing, components?, dark? (+ any extension fields like allow_brand_hue,
 * radius, default_mode — passed through untouched).
 * If there is no `---` fence the whole document is treated as prose with an
 * empty frontmatter object.
 */
export function parseDesignMd(text) {
  if (typeof text !== 'string') {
    throw new Error(`parseDesignMd expects a string, got ${typeof text}`);
  }
  // Normalize CRLF and a possible leading BOM.
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // Frontmatter must open with `---` on the first non-empty line.
  const fence = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/;
  const lead = src.replace(/^\s*\n/, ''); // tolerate blank lines before the fence
  const m = lead.match(fence);
  if (!m) {
    return { frontmatter: {}, prose: src.trim() };
  }
  const yamlText = m[1];
  const prose = (m[2] || '').trim();
  // Tolerate unquoted CSS-function values (`primary: oklch(0.55 0.34 280)`,
  // `rgb(10, 20, 30)`, `color-mix(in oklch, …)`) by pre-quoting them verbatim so
  // the zero-dep reader never splits on a value's internal space/paren/comma.
  const frontmatter =
    yamlText.trim() === '' ? {} : parseBrief(quoteUnquotedCssFunctions(yamlText));
  return { frontmatter: frontmatter || {}, prose };
}
