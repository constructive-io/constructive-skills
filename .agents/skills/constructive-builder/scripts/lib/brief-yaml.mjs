/**
 * scripts/lib/brief-yaml.mjs — the ZERO-DEP YAML reader scoped to the brief grammar.
 *
 * Extracted VERBATIM from brief.mjs (§1) so the proven hand-rolled parser lives in
 * one cohesive module. No external dep so the harness has no node_modules.
 * `parseBrief(text)` is the only public entry point; the rest are its internals.
 *
 * Supports exactly what fixtures/app-brief.template.yaml uses:
 *   • block mappings   key: value  (nested by indentation)
 *   • block sequences  - item      (item may be a scalar, a flow map, or a nested map)
 *   • flow collections { k: v, ... } and [ a, b, ... ] (recursive, may nest)
 *   • scalars: bare / "double" / 'single' quoted strings, ints, floats,
 *     true/false/null, and bare tokens with internal '+' (e.g. public-read+owner-write)
 *   • comments: full-line `#…` and trailing ` #…` (outside quotes/flow)
 *   • document scalar `version: 1`
 * This is deliberately a small, legible subset — NOT a general YAML engine. If a
 * brief needs constructs beyond this, that is a signal to add to the grammar here
 * (one home) rather than reach for a dep.
 */

/** Strip a trailing ` # comment` that is outside any quote/flow context. */
function stripTrailingComment(line) {
  let inS = false; // '…'
  let inD = false; // "…"
  let depth = 0; // { } / [ ] nesting
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) { if (c === "'") inS = false; continue; }
    if (inD) { if (c === '"') inD = false; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === '#') {
      // A `#` starts a comment only if preceded by whitespace or at col 0,
      // and only when not inside a flow collection.
      if (depth <= 0 && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

/** Parse a scalar token into a JS value (string|number|boolean|null). */
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  // Quoted strings.
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  // Integer / float (no leading-zero octal surprises; require a clean numeric).
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // Bare string (covers identifiers, kebab, slugs, and tokens with '+' / '/' / ':').
  return s;
}

/**
 * Parse a FLOW collection starting at `str[i]` where str[i] is '{' or '['.
 * Returns { value, end } with `end` pointing just past the closing bracket.
 */
function parseFlow(str, i) {
  const open = str[i];
  const close = open === '{' ? '}' : ']';
  const isMap = open === '{';
  i++; // consume opener
  const out = isMap ? {} : [];
  for (;;) {
    // skip whitespace + commas
    while (i < str.length && /[\s,]/.test(str[i])) i++;
    if (i >= str.length) throw new Error(`Unterminated flow ${open}…${close}`);
    if (str[i] === close) { i++; break; }
    if (isMap) {
      // read a key up to ':'
      const keyStart = i;
      let depth = 0;
      while (i < str.length) {
        const c = str[i];
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        else if (c === ':' && depth === 0) break;
        i++;
      }
      const key = str.slice(keyStart, i).trim();
      if (str[i] !== ':') throw new Error(`Expected ':' in flow map near "${str.slice(keyStart, keyStart + 30)}"`);
      i++; // consume ':'
      while (i < str.length && /\s/.test(str[i])) i++;
      const { value, end } = parseFlowValue(str, i);
      out[key] = value;
      i = end;
    } else {
      const { value, end } = parseFlowValue(str, i);
      out.push(value);
      i = end;
    }
  }
  return { value: out, end: i };
}

/** Parse a single flow VALUE (scalar | nested {…} | nested [...]) at str[i]. */
function parseFlowValue(str, i) {
  while (i < str.length && /\s/.test(str[i])) i++;
  if (str[i] === '{' || str[i] === '[') return parseFlow(str, i);
  // scalar: read until top-level ',' or closing '}' ']' (respecting quotes/nesting)
  const start = i;
  let inS = false;
  let inD = false;
  let depth = 0;
  while (i < str.length) {
    const c = str[i];
    if (inS) { if (c === "'") inS = false; i++; continue; }
    if (inD) { if (c === '"') inD = false; i++; continue; }
    if (c === "'") { inS = true; i++; continue; }
    if (c === '"') { inD = true; i++; continue; }
    if (c === '{' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ']') { if (depth === 0) break; depth--; i++; continue; }
    if (c === ',' && depth === 0) break;
    i++;
  }
  return { value: parseScalar(str.slice(start, i)), end: i };
}

/** Tokenize the document into indented logical lines (comments/blank stripped). */
function tokenizeLines(text) {
  const lines = [];
  for (const rawLine of text.split('\n')) {
    // Tabs are not valid YAML indentation; normalize defensively.
    const line = stripTrailingComment(rawLine.replace(/\t/g, '  '));
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, content: line.trim(), raw: rawLine });
  }
  return lines;
}

/**
 * Recursive block parser. `lines` is the full token list; parses the block at
 * `start` whose entries sit at column `minIndent`. Returns { value, next }.
 */
function parseBlock(lines, start, minIndent) {
  // Decide map vs sequence by the first entry at this indent.
  const first = lines[start];
  const isSeq = first.content.startsWith('- ') || first.content === '-';
  if (isSeq) return parseSeqBlock(lines, start, minIndent);
  return parseMapBlock(lines, start, minIndent);
}

function parseMapBlock(lines, start, minIndent) {
  const obj = {};
  let i = start;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < minIndent) break;
    if (ln.indent > minIndent) {
      throw new Error(`Unexpected indentation at: "${ln.content}" (expected col ${minIndent})`);
    }
    const m = ln.content.match(/^([^:]+):(.*)$/s);
    if (!m) throw new Error(`Expected "key: value" mapping at: "${ln.content}"`);
    const key = m[1].trim();
    const rest = m[2].trim();
    if (rest === '') {
      // Value is a nested block (map or seq) on following deeper lines, OR empty.
      const childStart = i + 1;
      if (childStart < lines.length && lines[childStart].indent > minIndent) {
        const childIndent = lines[childStart].indent;
        const { value, next } = parseBlock(lines, childStart, childIndent);
        obj[key] = value;
        i = next;
      } else {
        obj[key] = null; // bare key with no value
        i++;
      }
    } else if (rest[0] === '{' || rest[0] === '[') {
      obj[key] = parseFlow(rest, 0).value;
      i++;
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return { value: obj, next: i };
}

function parseSeqBlock(lines, start, minIndent) {
  const arr = [];
  let i = start;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < minIndent) break;
    if (ln.indent > minIndent) {
      throw new Error(`Unexpected indentation in sequence at: "${ln.content}"`);
    }
    if (!(ln.content === '-' || ln.content.startsWith('- '))) break;
    const after = ln.content === '-' ? '' : ln.content.slice(2).trim();
    if (after === '') {
      // The item is a nested block on the following deeper lines.
      const childStart = i + 1;
      if (childStart < lines.length && lines[childStart].indent > minIndent) {
        const childIndent = lines[childStart].indent;
        const { value, next } = parseBlock(lines, childStart, childIndent);
        arr.push(value);
        i = next;
      } else {
        arr.push(null);
        i++;
      }
    } else if (after[0] === '{' || after[0] === '[') {
      arr.push(parseFlow(after, 0).value);
      i++;
    } else if (/^[^:{}\[\]]+:(\s|$)/.test(after) || /^[^:{}\[\]]+:.*$/.test(after) && after.includes(':')) {
      // The item is itself a mapping whose first key sits inline after the dash
      // (e.g. `- $type: RelationBelongsTo` followed by more keys indented to the
      // key's column). Re-home the inline key as a virtual line and continue the map.
      const keyCol = minIndent + 2; // column where the first key starts
      const virtual = { indent: keyCol, content: after, raw: ln.raw };
      // Build a temporary lines view: the virtual first key, then subsequent
      // real lines belonging to this item (indent >= keyCol).
      const sub = [virtual];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= keyCol) { sub.push(lines[j]); j++; }
      const { value } = parseMapBlock(sub, 0, keyCol);
      arr.push(value);
      i = j;
    } else {
      arr.push(parseScalar(after));
      i++;
    }
  }
  return { value: arr, next: i };
}

/** Parse a brief YAML string into a plain JS object. Zero deps. */
export function parseBrief(text) {
  const lines = tokenizeLines(text);
  if (lines.length === 0) return {};
  const baseIndent = lines[0].indent;
  const { value } = parseBlock(lines, 0, baseIndent);
  return value;
}
