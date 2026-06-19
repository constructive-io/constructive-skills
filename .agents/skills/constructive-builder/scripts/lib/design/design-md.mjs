/**
 * scripts/lib/design/design-md.mjs — parse/serialize a Google-Labs-style
 * `design.md`: a Markdown document with a YAML frontmatter block delimited by
 * `---` fences, followed by free prose.
 *
 * Frontmatter is parsed with the skill's EXISTING zero-dep YAML reader
 * (`parseBrief` from ../brief-yaml.mjs) — NO new dependency.
 *
 * ZERO-DEP. Node >=18 ESM. Pure functions.
 */

import { parseBrief } from '../brief-yaml.mjs';

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
  const frontmatter = yamlText.trim() === '' ? {} : parseBrief(yamlText);
  return { frontmatter: frontmatter || {}, prose };
}

/* ----------------------------------------------------------------------------
 * Serialization — emit a minimal-but-faithful YAML for the frontmatter we own.
 * We only need to round-trip the shapes the compiler produces/consumes (scalars,
 * flat maps, one level of nested maps, and short arrays). Keep it deterministic.
 * ------------------------------------------------------------------------- */

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function scalarToYaml(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  // Quote when the value could be misparsed (leading symbols, colons, '#',
  // braces, or looks numeric/boolean).
  if (
    s === '' ||
    /^[\s>|*&!%@`"'{}\[\],#-]/.test(s) ||
    /:\s|\s#/.test(s) ||
    /^(true|false|null|~)$/i.test(s) ||
    /^-?\d/.test(s)
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function emitValue(value, indent, lines) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPlainObject(item)) {
        // Inline as a flow map for compactness + safe re-parse.
        lines.push(`${pad}- ${flowMap(item)}`);
      } else {
        lines.push(`${pad}- ${scalarToYaml(item)}`);
      }
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isPlainObject(v) && Object.keys(v).length > 0) {
        lines.push(`${pad}${k}:`);
        emitValue(v, indent + 1, lines);
      } else if (Array.isArray(v) && v.length > 0) {
        lines.push(`${pad}${k}:`);
        emitValue(v, indent + 1, lines);
      } else if (isPlainObject(v) || Array.isArray(v)) {
        lines.push(`${pad}${k}: ${Array.isArray(v) ? '[]' : '{}'}`);
      } else {
        lines.push(`${pad}${k}: ${scalarToYaml(v)}`);
      }
    }
    return;
  }
  lines.push(`${pad}${scalarToYaml(value)}`);
}

function flowMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => {
    if (isPlainObject(v)) return `${k}: ${flowMap(v)}`;
    if (Array.isArray(v)) return `${k}: [${v.map((x) => scalarToYaml(x)).join(', ')}]`;
    return `${k}: ${scalarToYaml(v)}`;
  });
  return `{ ${parts.join(', ')} }`;
}

/** Serialize { frontmatter, prose } back into a `design.md` text. */
export function serializeDesignMd({ frontmatter = {}, prose = '' }) {
  const lines = [];
  emitValue(frontmatter, 0, lines);
  const fm = lines.join('\n');
  const body = (prose || '').trim();
  return `---\n${fm}\n---\n${body ? `\n${body}\n` : ''}`;
}
