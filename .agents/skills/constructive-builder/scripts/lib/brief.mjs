/**
 * scripts/lib/brief.mjs — the single home for app-brief parsing + the
 * intent → blueprint maps the scaffolders share.
 *
 * GENERIC BY CONSTRUCTION. Nothing here hard-codes `todos` or `email-password`
 * as a value: the brief drives everything. This module:
 *   1. parseBrief(text)      — a ZERO-DEP YAML reader scoped to the brief grammar
 *                              (block + flow maps/seqs, scalars, comments). No
 *                              external dep so the harness has no node_modules.
 *   2. validateBrief(brief)  — legible, fail-fast validation of the brief shape.
 *   3. POLICY_INTENTS        — policy-intent  → { nodes[], policies[] } emitters.
 *   4. RESTRICT_MODIFIERS    — restrict tag    → extra fields + a restrictive policy.
 *   5. FEATURE_NODES         — feature tag     → a data-behavior node (+ field/fts).
 *   6. NODE_MODULE_DEPS      — node $type      → module deps it pulls into the closure.
 *   7. presetBaseModules / flowModules / computeModuleClosure — the module union.
 *   8. buildTableDefinition / buildBlueprintDefinition — assemble the BlueprintDefinition.
 *
 * The maps below are the generator's CORE KNOWLEDGE. They emit the COMMON CASE as
 * explicit literal arrays; the long tail is reached via the brief's `nodes_raw` /
 * `policies_raw` escape hatches (passed through verbatim) and `// TODO: advanced`
 * seams the emitter writes. See:
 *   - constructive-blueprints/references/blueprint-definition-format.md (every key)
 *   - constructive-security/references/authz-types.md (the 18 Authz* shapes)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { getHubDatabase } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════════════════
// 1. ZERO-DEP YAML READER (scoped to the brief grammar)
// ════════════════════════════════════════════════════════════════════════════
// Supports exactly what fixtures/app-brief.template.yaml uses:
//   • block mappings   key: value  (nested by indentation)
//   • block sequences  - item      (item may be a scalar, a flow map, or a nested map)
//   • flow collections { k: v, ... } and [ a, b, ... ] (recursive, may nest)
//   • scalars: bare / "double" / 'single' quoted strings, ints, floats,
//     true/false/null, and bare tokens with internal '+' (e.g. public-read+owner-write)
//   • comments: full-line `#…` and trailing ` #…` (outside quotes/flow)
//   • document scalar `version: 1`
// This is deliberately a small, legible subset — NOT a general YAML engine. If a
// brief needs constructs beyond this, that is a signal to add to the grammar here
// (one home) rather than reach for a dep.

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

/** Read + parse a brief file from disk. */
export function loadBrief(briefPath) {
  const text = fs.readFileSync(briefPath, 'utf8');
  const brief = parseBrief(text);
  validateBrief(brief, briefPath);
  return brief;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. VALIDATION (legible, fail-fast)
// ════════════════════════════════════════════════════════════════════════════

const KNOWN_POLICIES = new Set([
  'owner',
  'org-membership',
  'member-owner',
  'public-read+owner-write',
  'public-lookup',
]);
// Parent-derived / hierarchical access intents that are RECOGNIZED by name (so we can
// give actionable guidance) but are NOT yet mapped to a generated policy. A table that
// asks for one of these ABORTS with a pointer at the raw escape hatch — we deliberately
// do NOT infer hierarchy from FKs (that would false-positive on legit FLAT patterns like
// CRM contacts belongs-to companies). The author must opt in explicitly via policies_raw.
const ABORT_POLICY_INTENTS = new Set([
  'org-hierarchy',
  'related-membership',
]);
const KNOWN_RESTRICTS = new Set(['temporal', 'read-only']);
const KNOWN_FEATURES = new Set([
  'soft-delete', 'slug', 'tags', 'jsonb', 'fts', 'publishable',
]);
const KNOWN_PRESETS = new Set([
  'auth:email', 'auth:email+magic', 'auth:sso', 'auth:passkey',
  'b2b', 'b2b:storage', 'full', 'minimal',
]);

class BriefError extends Error {}

function req(obj, keyPath, where) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) {
      throw new BriefError(`${where}: missing required key \`${keyPath}\``);
    }
    cur = cur[p];
  }
  return cur;
}

/** Validate the parsed brief, throwing a BriefError with a legible message. */
export function validateBrief(brief, where = 'brief') {
  if (!brief || typeof brief !== 'object') {
    throw new BriefError(`${where}: brief did not parse to a mapping`);
  }
  req(brief, 'app.id', where);
  req(brief, 'naming.db_name', where);
  const db = brief.naming.db_name;
  if (!/^[a-z][a-z0-9]*$/.test(db)) {
    throw new BriefError(`${where}: naming.db_name must be plain lowercase (no hyphens/underscores); got "${db}"`);
  }
  // modules.preset
  const preset = brief.modules?.preset;
  if (!preset) throw new BriefError(`${where}: missing required key \`modules.preset\` (e.g. auth:email | b2b | full | minimal)`);
  if (!KNOWN_PRESETS.has(preset)) {
    throw new BriefError(`${where}: unknown modules.preset "${preset}". Known: ${[...KNOWN_PRESETS].join(', ')}`);
  }
  // flows
  const flows = brief.flows ?? [];
  if (!Array.isArray(flows)) throw new BriefError(`${where}: \`flows\` must be a list`);
  // data_model.tables
  const tables = brief.data_model?.tables ?? [];
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new BriefError(`${where}: \`data_model.tables\` must be a non-empty list`);
  }
  const tableNames = new Set();
  for (const t of tables) {
    if (!t || typeof t !== 'object' || !t.name) {
      throw new BriefError(`${where}: every data_model.tables entry needs a \`name\``);
    }
    if (tableNames.has(t.name)) throw new BriefError(`${where}: duplicate table name "${t.name}"`);
    tableNames.add(t.name);
    const hasRaw = t.nodes_raw || t.policies_raw;
    if (!t.policy && !hasRaw) {
      throw new BriefError(`${where}: table "${t.name}" needs a \`policy\` intent (owner | org-membership | member-owner | public-read+owner-write | public-lookup) or a nodes_raw/policies_raw escape hatch`);
    }
    if (t.policy && ABORT_POLICY_INTENTS.has(t.policy)) {
      throw new BriefError(
        `${where}: table "${t.name}" uses policy "${t.policy}" — hierarchical / parent-derived access is not a mapped intent yet. ` +
        `Use policies_raw with AuthzRelatedEntityMembership or AuthzOrgHierarchy ` +
        `(see constructive-security/references/authz-types.md). ` +
        `Note: the org-membership intent gives FLAT own-entity access, NOT parent-derived.`
      );
    }
    if (t.policy && !KNOWN_POLICIES.has(t.policy)) {
      throw new BriefError(`${where}: table "${t.name}" has unknown policy "${t.policy}". Known: ${[...KNOWN_POLICIES].join(', ')} (or use nodes_raw/policies_raw)`);
    }
    for (const r of t.restrict ?? []) {
      if (!KNOWN_RESTRICTS.has(r)) throw new BriefError(`${where}: table "${t.name}" has unknown restrict "${r}". Known: ${[...KNOWN_RESTRICTS].join(', ')}`);
    }
    for (const f of t.features ?? []) {
      if (!KNOWN_FEATURES.has(f)) throw new BriefError(`${where}: table "${t.name}" has unknown feature "${f}". Known: ${[...KNOWN_FEATURES].join(', ')}`);
    }
    for (const fld of t.fields ?? []) {
      if (!fld || typeof fld !== 'object' || !fld.name) throw new BriefError(`${where}: table "${t.name}" has a field with no \`name\``);
      if (fld.type !== undefined && (typeof fld.type !== 'object' || !fld.type.name)) {
        throw new BriefError(`${where}: table "${t.name}" field "${fld.name}" — \`type\` must be an OBJECT { name: … } (FIELD-TYPE-001), not a bare string`);
      }
    }
  }
  // org policies require b2b
  const needsB2b = tables.some((t) => ['org-membership', 'member-owner'].includes(t.policy)) ||
    tables.some((t) => (t.restrict ?? []).includes('read-only'));
  const b2bPresets = new Set(['b2b', 'b2b:storage', 'full']);
  if (needsB2b && !b2bPresets.has(preset)) {
    throw new BriefError(`${where}: a table uses an org-scoped policy (org-membership / member-owner / restrict: read-only) but modules.preset is "${preset}". Org policies REQUIRE a b2b preset (b2b | b2b:storage | full) — the memberships module backs them.`);
  }
  return brief;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. POLICY INTENTS → { nodes, policies }
// ════════════════════════════════════════════════════════════════════════════
// Each emitter returns the COMMON-CASE nodes[] and policies[] for one access
// model. The emitter receives a small opts bag ({ fields }) so it can stay
// generic across any table. DataId is prepended and DataTimestamps appended by
// the assembler (buildTableDefinition), NOT here.

const ALL_CRUD = ['select', 'insert', 'update', 'delete'];

export const POLICY_INTENTS = {
  // owner: each row belongs to one user; only the owner reads/writes it.
  owner() {
    return {
      nodes: ['DataDirectOwner'],
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    };
  },

  // org-membership: FLAT own-entity access — any member of the row's OWN owning org/team
  // can read+write it. This is NOT parent-derived: it authorizes on the entity_id ON the
  // row, never by walking an FK up to a parent's org. For "members of the parent's org can
  // see this child" (parent-derived / hierarchical) reach for policies_raw with
  // AuthzRelatedEntityMembership or AuthzOrgHierarchy instead — see ABORT_POLICY_INTENTS.
  'org-membership'() {
    return {
      nodes: ['DataEntityMembership'],
      policies: [{
        $type: 'AuthzEntityMembership',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },

  // member-owner: the row is BOTH user-owned AND org-scoped; only the author,
  // and only within their org, sees it.
  'member-owner'() {
    return {
      nodes: ['DataOwnershipInEntity'],
      policies: [{
        $type: 'AuthzMemberOwner',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { owner_field: 'owner_id', entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },

  // public-read+owner-write: published rows readable by anyone authenticated;
  // only the owner can create/edit/unpublish. The two-policy stack.
  'public-read+owner-write'() {
    return {
      nodes: ['DataDirectOwner', 'DataPublishable'],
      policies: [
        {
          $type: 'AuthzDirectOwner',
          privileges: [...ALL_CRUD],
          permissive: true,
          data: { entity_field: 'owner_id' },
        },
        {
          $type: 'AuthzPublishable',
          privileges: ['select'],
          permissive: true,
          data: { is_published_field: 'is_published', published_at_field: 'published_at' },
        },
      ],
    };
  },

  // public-lookup: every authenticated user can read AND WRITE (no ownership).
  // This is authenticated read+write, NOT public-read.
  'public-lookup'() {
    return {
      nodes: [],
      policies: [{
        $type: 'AuthzAllowAll',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: {},
      }],
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 4. RESTRICT MODIFIERS → extra fields + a RESTRICTIVE policy (ANDed)
// ════════════════════════════════════════════════════════════════════════════
// Each returns { fields?, nodes?, policies } to splice onto the table. The
// policy is permissive:false so PostgreSQL ANDs it with the permissive base.

export const RESTRICT_MODIFIERS = {
  temporal() {
    return {
      fields: [
        { name: 'valid_from', type: { name: 'timestamptz' } },
        { name: 'valid_until', type: { name: 'timestamptz' } },
      ],
      policies: [{
        $type: 'AuthzTemporal',
        privileges: [...ALL_CRUD],
        permissive: false,
        data: { valid_from_field: 'valid_from', valid_until_field: 'valid_until' },
      }],
    };
  },

  'read-only'() {
    return {
      policies: [{
        $type: 'AuthzNotReadOnly',
        privileges: ['insert', 'update', 'delete'],
        permissive: false,
        data: { entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 5. FEATURE TAGS → a data-behavior node (+ implicit field / fts entry)
// ════════════════════════════════════════════════════════════════════════════
// Each returns { node?, field?, fts? }. `fts` is a top-level full_text_search[]
// entry the assembler hoists (it spans named text fields, not a node).

/**
 * Resolve the DataSlug `source_field_name` for a table — the text column the slug
 * trigger derives its value from. Hard-coding `'title'` ABORTS constructBlueprint on
 * any sluggable table without a `title` column ("source field \"title\" not found").
 * We DERIVE it deterministically, in priority order:
 *   1. a field conventionally named `title` or `name` (the common label columns),
 *   2. else the FIRST required, non-slug text field (the table's likely label),
 *   3. else the first non-slug text field,
 *   4. else fall back to `'title'` (nothing resolved — preserves the historical
 *      default so a brief that relies on a downstream/raw `title` still emits it).
 * A field is "text" when it has no explicit type (text is the assembler default) or
 * its type.name is `text`/`citext`. The `slug` helper column itself is never chosen.
 * Order #1 wins even when the title/name field is not the first text field, matching
 * the platform convention that those names ARE the label.
 */
function deriveSlugSource(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const isText = (f) => !f || !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const sluggable = (f) => f && f.name && f.name !== 'slug' && isText(f);
  // 1. conventional label column (title preferred over name when both exist)
  const titled = list.find((f) => sluggable(f) && f.name === 'title');
  if (titled) return titled.name;
  const named = list.find((f) => sluggable(f) && f.name === 'name');
  if (named) return named.name;
  // 2. first required non-slug text field
  const requiredText = list.find((f) => sluggable(f) && f.required);
  if (requiredText) return requiredText.name;
  // 3. first non-slug text field
  const anyText = list.find((f) => sluggable(f));
  if (anyText) return anyText.name;
  // 4. nothing resolved — historical default
  return 'title';
}

export const FEATURE_NODES = {
  'soft-delete'() { return { node: 'DataSoftDelete' }; },
  // slug: a `slug` text field + DataSlug trigger filling it from a derived source.
  // `opts.fields` is the brief table's declared fields so the source column is
  // resolved per-table (see deriveSlugSource) instead of hard-coded to 'title'.
  slug(opts = {}) {
    return {
      node: { $type: 'DataSlug', data: { field_name: 'slug', source_field_name: deriveSlugSource(opts.fields) } },
      field: { name: 'slug', type: { name: 'text' } },
    };
  },
  tags() { return { node: { $type: 'DataTags', data: { field_name: 'tags' } } }; },
  jsonb() { return { node: { $type: 'DataJsonb', data: { field_name: 'data' } } }; },
  publishable() { return { node: 'DataPublishable' }; },
  // fts is realized as a top-level full_text_search[] entry; the assembler fills
  // field_names from the table's text fields.
  fts() { return { fts: true }; },
};

// ════════════════════════════════════════════════════════════════════════════
// 6. NODE → MODULE DEPENDENCY CLOSURE
// ════════════════════════════════════════════════════════════════════════════
// A handful of nodes require their backing module to be in the provision list.
// Each value is a list of module entries (native tuples) to fold into the union.
// Most data/owner/membership nodes are satisfied by the auth/b2b preset modules
// the flows already carry, so they are NOT listed here.

export const NODE_MODULE_DEPS = {
  DataRealtime: ['realtime_module'],
  DataI18n: ['i18n_module'],
  LimitCounter: [['limits_module', { scope: 'app' }]],
  LimitFeatureFlag: [['limits_module', { scope: 'app' }]],
  SearchVector: ['ai_module'],
  ProcessImageEmbedding: ['ai_module'],
};

// ════════════════════════════════════════════════════════════════════════════
// 7. MODULE CLOSURE — union(preset base, flow modules, node deps, relation deps)
// ════════════════════════════════════════════════════════════════════════════

let _flowsCache = null;
/** Load references/flows.json (the module-union source of truth). */
export function loadFlows() {
  if (_flowsCache) return _flowsCache;
  // scripts/lib → ../../references/flows.json
  const flowsPath = process.env.FLOWS_JSON ||
    path.resolve(__dirname, '..', '..', 'references', 'flows.json');
  const data = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
  _flowsCache = Array.isArray(data) ? data : (data.flows ?? []);
  return _flowsCache;
}

/** Look up one flow's backend.modules (native tuples) by flow id. */
export function flowModules(flowId) {
  const flows = loadFlows();
  const f = flows.find((x) => (x.id || x.slug) === flowId);
  if (!f) {
    throw new BriefError(`unknown flow "${flowId}" — not in references/flows.json. Known: ${flows.map((x) => x.id).join(', ')}`);
  }
  return f.backend?.modules ?? [];
}

/**
 * Base modules for a preset, independent of flows. Because every flow already
 * embeds its preset's full module set, we derive each preset's base list from a
 * representative flow that ships under it — so the union stays correct even when
 * the chosen flows don't happen to include one carrying the full preset surface.
 * `minimal` provisions no auth modules. `extra` modules append on top.
 */
const PRESET_REPRESENTATIVE_FLOW = {
  'auth:email': 'email-password',
  'auth:email+magic': 'email-password',
  'auth:sso': 'social-oauth',
  'auth:passkey': 'connected-accounts',
  'b2b': 'organization',
  'b2b:storage': 'organization',
  'full': 'organization',
};

export function presetBaseModules(preset) {
  if (preset === 'minimal') return [];
  const rep = PRESET_REPRESENTATIVE_FLOW[preset];
  if (!rep) return [];
  try {
    return flowModules(rep);
  } catch {
    return [];
  }
}

/** Canonical string key for a module entry (string or [name, {scope}] tuple). */
function moduleKey(m) {
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) {
    const [name, opts] = m;
    const scope = opts && typeof opts === 'object' ? opts.scope : undefined;
    return scope ? `${name}:${scope}` : String(name);
  }
  return JSON.stringify(m);
}

/** Expand a brief `extra:` entry ('name' or 'name:scope') to a native module. */
function expandExtra(entry) {
  if (typeof entry !== 'string') return entry;
  const idx = entry.indexOf(':');
  if (idx === -1) return entry;
  const name = entry.slice(0, idx);
  const scope = entry.slice(idx + 1);
  return [name, { scope }];
}

/**
 * Compute the full module closure for a brief.
 *   union( presetBaseModules(preset),
 *          each chosen flow's backend.modules,
 *          node→module deps for every node across all tables,
 *          relation closure (M2M membership junction → b2b base),
 *          modules.extra )
 * De-duplicated by canonical key; FIRST occurrence wins for ordering so the
 * preset/flow order is preserved (the golden canary depends on this ordering).
 */
export function computeModuleClosure(brief, tableDefs) {
  const preset = brief.modules?.preset ?? 'auth:email';
  const ordered = [];
  const seen = new Set();
  const add = (m) => {
    const k = moduleKey(m);
    if (!seen.has(k)) { seen.add(k); ordered.push(m); }
  };

  // (a) preset base
  for (const m of presetBaseModules(preset)) add(m);
  // (b) each chosen flow
  for (const fid of brief.flows ?? []) {
    for (const m of flowModules(fid)) add(m);
  }
  // (c) node → module deps across every table
  for (const t of tableDefs ?? []) {
    for (const node of t.nodes ?? []) {
      const type = typeof node === 'string' ? node : node?.$type;
      for (const dep of NODE_MODULE_DEPS[type] ?? []) add(dep);
    }
  }
  // (d) relation closure — an org-scoped M2M junction pulls the b2b base in.
  // The junction's policy intent may live nested (data.policy_type — the brief
  // grammar) OR flat (policies[].$type — the SDK shape liftManyToManySecurity emits,
  // which an advanced author can also write by hand). Read BOTH so the closure stays
  // correct regardless of which form the brief used.
  const b2bBase = presetBaseModules('b2b');
  const isOrgJunctionPolicy = (t) => t === 'AuthzEntityMembership' || t === 'AuthzMemberOwner';
  for (const r of brief.data_model?.relations ?? []) {
    if (r?.$type !== 'RelationManyToMany') continue;
    const nested = r.data?.policy_type;
    const flat = Array.isArray(r.policies) ? r.policies.map((p) => p?.$type) : [];
    if (isOrgJunctionPolicy(nested) || flat.some(isOrgJunctionPolicy)) {
      for (const m of b2bBase) add(m);
    }
  }
  // (e) explicit extras
  for (const e of brief.modules?.extra ?? []) add(expandExtra(e));

  return ordered;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. ASSEMBLE THE BlueprintDefinition (tables + relations)
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_GRANTS = [{
  roles: ['authenticated'],
  privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']],
}];

/**
 * Build ONE BlueprintTable from a brief table spec.
 *
 *   nodes  = DataId  +  policy-intent nodes  +  restrict nodes  +  feature nodes
 *            +  { $type:'DataTimestamps', data:{ include_id:false } }   (always last)
 *   fields = brief fields (object-form type/default)  +  feature/restrict fields
 *   policies = policy-intent policies  +  restrict policies  (restrictive ANDed)
 *   grants = object-form full-CRUD for authenticated  (or a feature override)
 *
 * Returns { table, fts } where fts (or null) is a top-level full_text_search entry.
 * `nodes_raw` / `policies_raw` from the brief are spliced in verbatim (escape hatch).
 */
/** Discriminator for a node entry (string shorthand or { $type } object). */
function nodeType(n) {
  return typeof n === 'string' ? n : n?.$type;
}

export function buildTableDefinition(t) {
  // Composite primary keys are parsed but have no policy/data intent mapping yet — the
  // generator would otherwise SILENTLY drop the request and emit a normal surrogate
  // DataId, shipping a different key than the author asked for. ABORT loudly instead.
  if (t.use_composite_key || t.composite_key) {
    throw new BriefError(
      `table "${t.name}": composite primary keys are not a supported policy/data intent yet. ` +
      `Define the key explicitly via nodes_raw (DataCompositeField/DataId shape), ` +
      `or use a surrogate id plus a unique_constraints entry.`
    );
  }

  // Nodes are de-duplicated by $type (first occurrence wins) so a feature/restrict
  // that re-adds a node already supplied by the policy intent — e.g.
  // public-read+owner-write already brings DataPublishable, and `features:
  // [publishable]` would otherwise add it again — collapses cleanly.
  const nodes = [];
  const nodeSeen = new Set();
  const addNode = (n) => {
    const ty = nodeType(n);
    if (ty === 'DataTimestamps') return; // appended last, separately
    if (ty && nodeSeen.has(ty)) return;
    if (ty) nodeSeen.add(ty);
    nodes.push(n);
  };

  // Fields: brief-declared fields take precedence and are emitted FIRST (in brief
  // order). Feature/restrict fields are only added when the brief did not already
  // declare a field of that name (so `features:[slug]` + an explicit `slug` field
  // collapses to one).
  const fields = [];
  const fieldSeen = new Set();
  const addField = (f) => {
    if (fieldSeen.has(f.name)) return;
    fieldSeen.add(f.name);
    fields.push(f);
  };

  const policies = [];
  const featureFields = []; // feature/restrict-contributed fields, applied after brief fields
  let fts = null;

  addNode('DataId');

  // policy intent → nodes + policies
  if (t.policy) {
    const { nodes: pn, policies: pp } = POLICY_INTENTS[t.policy]();
    for (const n of pn) addNode(n);
    policies.push(...pp);
  }

  // restrict modifiers (RESTRICTIVE — ANDed). Fields deferred to featureFields.
  for (const r of t.restrict ?? []) {
    const out = RESTRICT_MODIFIERS[r]();
    for (const n of out.nodes ?? []) addNode(n);
    for (const f of out.fields ?? []) featureFields.push(f);
    if (out.policies) policies.push(...out.policies);
  }

  // feature nodes. Fields deferred to featureFields so brief fields win ordering.
  // The opts bag carries the brief's declared fields so a feature can derive a
  // per-table source column (e.g. slug → deriveSlugSource); emitters that need no
  // context simply ignore it.
  let wantsFts = false;
  for (const f of t.features ?? []) {
    const out = FEATURE_NODES[f]({ fields: t.fields ?? [] });
    if (out.node) addNode(out.node);
    if (out.field) featureFields.push(out.field);
    if (out.fts) wantsFts = true;
  }

  // brief-declared custom fields FIRST (object-form type/default → blueprint field)
  for (const fld of t.fields ?? []) {
    const out = { name: fld.name, type: fld.type ?? { name: 'text' } };
    if (fld.required) out.is_required = true;
    if (fld.default !== undefined) out.default = fld.default;
    if (fld.description) out.description = fld.description;
    if (fld.index) out.index = fld.index;
    addField(out);
  }
  // then any feature/restrict field the brief did not already declare
  for (const f of featureFields) addField(f);

  // nodes_raw / policies_raw escape hatches (verbatim passthrough)
  if (Array.isArray(t.nodes_raw)) for (const n of t.nodes_raw) addNode(n);
  if (Array.isArray(t.policies_raw)) policies.push(...t.policies_raw);

  // DataTimestamps is ALWAYS the last node.
  nodes.push({ $type: 'DataTimestamps', data: { include_id: false } });

  // fts realized as a top-level full_text_searches[] entry over the table's text
  // fields (skip the slug helper column). Shape is the platform's
  // BlueprintFullTextSearch: { table_name, field, sources[{ field, weight, lang }] }
  // — a tsvector column named `search` fed by the weighted source columns. The
  // engine reads `definition.full_text_searches` (plural).
  //
  // CRITICAL: the live provision_full_text_search procedure only RESOLVES an
  // existing tsvector field; it does NOT create one. So we must MATERIALIZE the
  // `search` tsvector COLUMN on the table here — otherwise constructBlueprint
  // aborts with 'tsvector field "search" not found' and the whole blueprint rolls
  // back. We add the column FIRST (deduped via addField in case the brief already
  // declared a `search` field), then derive sources from the table's text columns.
  // The sources filter (`type.name === 'text' && name !== 'slug'`) naturally
  // excludes this tsvector self-column (it is not 'text'), so it never feeds itself.
  if (wantsFts) {
    addField({ name: 'search', type: { name: 'tsvector' } });
    const sources = fields
      .filter((f) => f.type?.name === 'text' && f.name !== 'slug')
      .map((f) => ({ field: f.name, weight: 'A', lang: 'english' }));
    fts = { table_name: t.name, field: 'search', sources };
  }

  const table = {
    ref: t.name,
    table_name: t.name,
    nodes,
    fields,
    grants: t.grants ?? DEFAULT_GRANTS,
    use_rls: true,
    policies,
  };
  if (t.unique_constraints) table.unique_constraints = t.unique_constraints;

  return { table, fts };
}

// Map a human-readable FK delete action to the single-char enum the platform
// RelationBelongsTo.parameter_schema stores in character(1). The brief speaks the
// readable form ('SET NULL'); constructBlueprint needs 'n' or it dies with
// "value too long for character(1)". Already-coded single chars pass through.
const DELETE_ACTION_ENUM = {
  'SET NULL': 'n',
  CASCADE: 'c',
  RESTRICT: 'r',
  'SET DEFAULT': 'd',
  'NO ACTION': 'a',
};
const DELETE_ACTION_CODES = new Set(['c', 'r', 'n', 'd', 'a']);

function codeDeleteAction(v) {
  if (v == null) return v;
  const s = String(v).trim();
  if (DELETE_ACTION_CODES.has(s.toLowerCase())) return s.toLowerCase();
  const mapped = DELETE_ACTION_ENUM[s.toUpperCase()];
  if (mapped) return mapped;
  throw new BriefError(
    `relation delete_action '${v}' is not a recognized action ` +
    `(expected one of SET NULL, CASCADE, RESTRICT, SET DEFAULT, NO ACTION, or a coded n/c/r/d/a)`
  );
}

// ── M:N junction default node set ────────────────────────────────────────────
// A junction with no explicit nodes gets a DataId PK (the platform's documented
// "use nodes with DataId for UUID PK" path) + DataTimestamps, matching every other
// table the generator emits. (use_composite_key:true is the alternative — but the
// brief grammar's example pairs DataId with secured grants, so default to that.)
const JUNCTION_DEFAULT_NODES = [
  { $type: 'DataId', data: {} },
  { $type: 'DataTimestamps', data: { include_id: false } },
];

// Authz policy types whose RLS predicate dereferences an OWNERSHIP COLUMN on the
// table they protect: AuthzEntityMembership/AuthzNotReadOnly read `entity_id`,
// AuthzMemberOwner reads `owner_id`+`entity_id`, AuthzDirectOwner reads `owner_id`.
// On a parent table those columns are materialized by the policy-paired DATA node
// (DataEntityMembership→entity_id, DataOwnershipInEntity→owner_id+entity_id,
// DataDirectOwner→owner_id). A pure-FK junction carries only DataId (its two FK
// columns + a PK), so NONE of these columns exist on it — applying such a policy
// makes constructBlueprint abort the WHOLE provision with `column "<col>" does not
// exist` (it never even creates the parent tables). The columns each type needs:
const POLICY_OWNERSHIP_COLUMNS = {
  AuthzEntityMembership: ['entity_id'],
  AuthzNotReadOnly: ['entity_id'],
  AuthzMemberOwner: ['owner_id', 'entity_id'],
  AuthzDirectOwner: ['owner_id'],
};

// The DATA nodes that materialize each ownership column on a junction (so a junction
// that DOES carry one — an advanced author may add DataEntityMembership to its nodes —
// keeps the parent-matching policy instead of being coerced).
const NODE_PROVIDED_COLUMNS = {
  DataDirectOwner: ['owner_id'],
  DataEntityMembership: ['entity_id'],
  DataOwnershipInEntity: ['owner_id', 'entity_id'],
};

/** Columns the junction's node set actually materializes (union over its DATA nodes).
 *  (nodeType — the string|object node discriminator — is defined once above.) */
function columnsFromNodes(nodes) {
  const cols = new Set();
  for (const n of nodes ?? []) {
    for (const c of NODE_PROVIDED_COLUMNS[nodeType(n)] ?? []) cols.add(c);
  }
  return cols;
}

// A junction that secures to its parents' access model uses the SAME Authz* policy
// the parent tables use. We re-key the brief's `policy_type` + `policy_data` into a
// single permissive all-CRUD policy. This is the junction counterpart to
// POLICY_INTENTS — but a junction is one FK row, so a single policy suffices.
//
// 🚨 PROVISION-SAFETY COERCION (LOUD): if the requested policy dereferences an ownership
// column the junction's NODES do not materialize (the common case: an org-scoped
// `AuthzEntityMembership` on a DataId-only junction → needs `entity_id`, which no
// junction node provides), the policy can't be honored — emitting it verbatim aborts
// the ENTIRE constructBlueprint with `column "entity_id" does not exist` (proven on
// the desk2 fixture: 0 tables created). A pure-FK junction's rows are reachable ONLY
// via FKs into the org-secured parents, so authenticated read+write on the junction
// is transitively org-scoped already. We therefore coerce to `AuthzAllowAll` (no
// column dependency) so the junction is GRANTed + SECURED for `authenticated` and the
// app provisions. This is the M:N analog of GAP-1d's "secure the junction" intent,
// done in a column-safe shape — but it is NOT silent: per-row/org-scoped junction
// security is NOT forwarded by the platform (GAP-1d), so the result is
// security-INCOMPLETE. We emit a prominent warning AND record a structured entry in
// `warnings[]` so the build output surfaces it (stderr here, and the provision step
// re-prints brief.warnings[] — scaffold-provision.mjs). (To keep the parent-matching
// policy, give the junction the matching DATA node in the brief — e.g.
// nodes: [DataEntityMembership] — so the column exists; then this coercion is a no-op
// and no warning is recorded.)
function junctionPolicy(policyType, policyData, junctionNodes, junctionName = 'junction', warnings) {
  const needed = POLICY_OWNERSHIP_COLUMNS[policyType] ?? [];
  const have = columnsFromNodes(junctionNodes);
  const missing = needed.filter((c) => !have.has(c));
  if (missing.length > 0) {
    // Column-safe coercion (see the function header). Emit a CLEAN AuthzAllowAll —
    // no extra keys, since this literal is forwarded to constructBlueprint verbatim.
    const keepNode = missing.includes('owner_id') ? 'DataOwnershipInEntity' : 'DataEntityMembership';
    const message =
      `M:N junction ${junctionName}: per-row/org-scoped security is not forwarded by the platform (GAP-1d). ` +
      `This junction is AuthzAllowAll (any authenticated user) — security-incomplete pending the upstream fix. ` +
      `(${policyType} would need column(s) ${missing.join('+')}; to keep it, add nodes:[${keepNode}] to the relation.)`;
    // (a) prominent, immediate signal on the build output.
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`[brief] WARNING — ${message}\n`);
    }
    // (b) structured record on brief.warnings[] so the build output can re-surface it
    // (the provision step prints brief.warnings[] — scaffold-provision.mjs).
    if (Array.isArray(warnings)) {
      warnings.push({
        code: 'M2N_JUNCTION_ALLOW_ALL',
        gap: 'GAP-1d',
        junction: junctionName,
        requested_policy: policyType,
        applied_policy: 'AuthzAllowAll',
        missing_columns: missing,
        severity: 'security-incomplete',
        message,
      });
    }
    return {
      $type: 'AuthzAllowAll',
      privileges: [...ALL_CRUD],
      permissive: true,
      data: {},
    };
  }
  return {
    $type: policyType,
    privileges: [...ALL_CRUD],
    permissive: true,
    data: policyData ?? {},
  };
}

/**
 * Lift a RelationManyToMany's NESTED `data.{nodes, policy_type, policy_data, grants,
 * policies}` block into the FLAT top-level `nodes` / `grants` / `policies` keys that
 * construct_blueprint actually reads off each relation object (verified against the
 * deployed metaschema_modules_public.construct_blueprint procedure: it reads
 * v_relation_entry->'nodes' / ->'grants' / ->'policies' at the TOP level and forwards
 * them to provision_relation → provision_table; a nested `data` block is IGNORED).
 *
 * THIS IS THE FIX for the deny-all junction (0 grants / 0 policies): the documented
 * brief grammar nests security under `data:`, but the platform never unwraps it. We
 * translate the intent (policy_type/policy_data) into the SDK's flat security shape
 * (RelationManyToManyParams: top-level nodes[], grants[], policies[]) so the junction
 * is GRANTed + SECURED for `authenticated` exactly like its parent tables.
 *
 * Precedence: an explicit flat key on the relation wins (advanced authors may already
 * speak the SDK shape); otherwise we derive it from the nested `data` block. A junction
 * with neither flat keys nor a `data` block is left bare (the author opted out) — but
 * we WARN nowhere here; the scaffolder seam header surfaces it.
 *
 * `warnings` (optional) is the brief-level sink junctionPolicy records its loud
 * AuthzAllowAll coercion into (GAP-1d). Threaded from buildBlueprintDefinition.
 */
function liftManyToManySecurity(r, warnings) {
  const d = (r.data && typeof r.data === 'object') ? r.data : {};
  // Human-legible junction name for the warning: the brief grammar's
  // junction_table_name, else a derived <source>_<target> label.
  const junctionName = r.junction_table_name ||
    [r.source_table, r.target_table].filter(Boolean).join('_') || 'junction';

  // (1) nodes — flat key wins; else nested data.nodes; else the DataId+Timestamps default.
  let nodes;
  if (Array.isArray(r.nodes)) nodes = r.nodes;
  else if (Array.isArray(d.nodes)) nodes = d.nodes;
  else nodes = [...JUNCTION_DEFAULT_NODES];

  // (2) grants — flat key wins; else nested data.grants; else the standard
  // object-form full-CRUD-for-authenticated (the same DEFAULT_GRANTS the tables use,
  // minus update which a pure FK junction rarely needs but is harmless to include).
  let grants;
  if (Array.isArray(r.grants)) grants = r.grants;
  else if (Array.isArray(d.grants)) grants = d.grants;
  else grants = JSON.parse(JSON.stringify(DEFAULT_GRANTS));

  // (3) policies — flat key wins; else nested data.policies; else derive ONE policy
  // from the data.policy_type (+ data.policy_data) intent. With no policy intent at
  // all we leave policies empty (RLS on, deny-all) — but that is exactly the bug we
  // are fixing, so a junction that omits policy_type is a brief smell, not our default.
  let policies;
  if (Array.isArray(r.policies)) policies = r.policies;
  else if (Array.isArray(d.policies)) policies = d.policies;
  else if (d.policy_type) policies = [junctionPolicy(d.policy_type, d.policy_data, nodes, junctionName, warnings)];
  else policies = [];

  return { nodes, grants, policies };
}

/** Build a relation entry from a brief relations[] spec (verbatim, $type-keyed).
 *  `warnings` (optional) is the brief-level sink the M:N junction-security coercion
 *  records into; pass it from buildBlueprintDefinition. */
export function buildRelation(r, warnings) {
  // The brief relation grammar mirrors the blueprint relation shape 1:1, except
  // delete_action is normalized from the readable form to the single-char enum.
  const out = { ...r };
  if ('delete_action' in out) out.delete_action = codeDeleteAction(out.delete_action);

  // RelationManyToMany: translate the NESTED security block into the FLAT SDK form
  // construct_blueprint reads (top-level nodes/grants/policies). Without this the
  // junction ships deny-all (0 grants / 0 policies) because the platform never
  // unwraps `data:`. We emit the flat keys AND drop the now-redundant nested `data`
  // (its non-security fields — junction_table_name, *_field_name, use_composite_key —
  // are already top-level in the brief grammar; only the security keys lived under
  // `data`, and those are now lifted). See liftManyToManySecurity for the contract.
  if (out.$type === 'RelationManyToMany') {
    const { nodes, grants, policies } = liftManyToManySecurity(out, warnings);
    out.nodes = nodes;
    out.grants = grants;
    out.policies = policies;
    // Strip the nested `data` block: construct_blueprint ignores it, and leaving it
    // in the emitted relation literal would be misleading (it looks load-bearing).
    delete out.data;
  }

  return out;
}

/** Build the whole BlueprintDefinition object from the brief.
 *  Side effect: records any soft, security-INCOMPLETE outcomes (today: M:N junction
 *  AuthzAllowAll coercion, GAP-1d) onto `brief.warnings[]` so the build output can surface
 *  them (the provision step prints brief.warnings[]; live-QA does not read it). Hard,
 *  unsupported intents (composite PK, parent-derived access) THROW from
 *  buildTableDefinition / validateBrief instead. */
export function buildBlueprintDefinition(brief) {
  // The warnings sink lives on the brief so callers that already hold the brief object
  // (scaffold-provision, check-scaffold) can read it back after generation.
  const warnings = Array.isArray(brief.warnings) ? brief.warnings : (brief.warnings = []);
  const tables = [];
  const ftsEntries = [];
  for (const t of brief.data_model?.tables ?? []) {
    const { table, fts } = buildTableDefinition(t);
    tables.push(table);
    if (fts) ftsEntries.push(fts);
  }
  // NB: an explicit arrow (NOT a bare `.map(buildRelation)`) so Array.map's index arg
  // is not mistaken for the `warnings` sink.
  const relations = (brief.data_model?.relations ?? []).map((r) => buildRelation(r, warnings));
  const def = { tables, relations };
  // PLURAL key — the blueprint engine reads `definition.full_text_searches`.
  if (ftsEntries.length) def.full_text_searches = ftsEntries;
  return def;
}

// ════════════════════════════════════════════════════════════════════════════
// 9. APP-IDENTITY RESOLUTION (the single home for the db_name → APP_ID derivation
//    and the subdomain precedence the .sh phase scripts share)
// ════════════════════════════════════════════════════════════════════════════
// These centralize two identity derivations that were copy-pasted across the .sh
// scripts (golden-path / genericity-check / verify-phase): turning a brief's
// db_name into the per-app build-state id (APP_ID), and resolving the GraphQL
// subdomain for a database. .sh callers reach them through `node -e` exactly like
// they reach config.mjs/ports.mjs, so there is one definition, not three.

/** Sanitize a db_name into the per-app build-state id: plain lowercase [a-z0-9].
 *  Mirrors the historical `gsub(/[^a-z0-9]/,"",v)` the .sh scripts ran on db_name. */
function sanitizeAppId(dbName) {
  return String(dbName == null ? '' : dbName).replace(/[^a-z0-9]/g, '');
}

/**
 * resolveAppId(brief) → the per-app build-state id derived from the brief's db_name
 * (the brief's `naming.db_name`, else a top-level `db_name`), sanitized to plain
 * lowercase [a-z0-9]. Returns '' when no db_name is present.
 *
 * `brief` may be EITHER a parsed brief object OR the raw YAML text (the form the
 * .sh scripts have on hand — a file's contents); a string is parsed with the same
 * comment-aware parseBrief the rest of this module uses. TOLERANT by design: any
 * parse/shape problem yields '' (never throws), matching the old awk's
 * `2>/dev/null || true` behaviour so an unreadable brief just leaves APP_ID unset
 * and the caller falls back to the legacy singleton build/ path.
 *
 * This replaces the duplicated
 *   awk -F': ' '$1 ~ /^[[:space:]]*db_name$/ {v=$2; gsub(/[^a-z0-9]/,"",v); print v; exit}'
 * across golden-path.sh / genericity-check.sh / verify-phase.sh. It is also MORE
 * correct than that awk on a db_name line carrying a trailing `# comment` (the awk
 * concatenated the comment words into the id); real briefs carry no such comment so
 * the resolved id is byte-identical for every brief those scripts actually use.
 */
export function resolveAppId(brief) {
  let obj = brief;
  if (typeof brief === 'string') {
    try {
      obj = parseBrief(brief);
    } catch {
      return '';
    }
  }
  if (!obj || typeof obj !== 'object') return '';
  const db = (obj.naming && obj.naming.db_name != null) ? obj.naming.db_name
    : (obj.db_name != null ? obj.db_name : '');
  return sanitizeAppId(db);
}

/** Read `database.subdomain` from a run-state JSON file; '' if absent/unreadable. */
function subdomainFromState(statePath) {
  if (!statePath) return '';
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return (s && s.database && s.database.subdomain) ? String(s.database.subdomain) : '';
  } catch {
    return '';
  }
}

/** Query the platform metaschema for a database's provisioned subdomain; '' on any
 *  failure (no psql, no row, hub down). Mirrors verify-phase.sh's psql lookup verbatim. */
function subdomainFromPlatform(dbName, hubDatabase) {
  if (!dbName) return '';
  const sql =
    'SELECT dpm.subdomain ' +
    'FROM metaschema_modules_public.database_provision_module dpm ' +
    'JOIN metaschema_public.database d ON d.id = dpm.database_id ' +
    `WHERE d.name = '${dbName}';`;
  try {
    const out = execFileSync('psql', ['-d', hubDatabase, '-t', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.replace(/\s+/g, ''); // tr -d ' ' (+ trim the trailing newline psql -t leaves)
  } catch {
    return '';
  }
}

/**
 * subdomainFor(dbName, opts?) → the GraphQL subdomain for a database, following the
 * SAME precedence verify-phase.sh's resolve_subdomain uses:
 *   1. the run-state's stored `database.subdomain` (opts.statePath, else $STATE_PATH),
 *   2. the platform metaschema lookup (psql against the hub database),
 *   3. fall back to dbName itself.
 *
 * opts:
 *   statePath    — run-state JSON to read the stored subdomain from
 *                  (defaults to process.env.STATE_PATH, the var the .sh scripts export)
 *   hubDatabase  — the hub Postgres database to query (defaults to
 *                  process.env.PG_HUB_DATABASE, else config db.hubDatabase, else 'constructive')
 *   noFallback   — when true, return '' (instead of dbName) if neither the run-state nor
 *                  the platform lookup resolved a subdomain. This lets a caller apply its
 *                  OWN fallback + side effects (verify-phase.sh emits a `warn` on pure
 *                  fallback, which it can only do if it can tell resolution failed). The
 *                  default (false) keeps the documented 3-step precedence ending in dbName.
 *
 * TOLERANT: a missing state file / absent psql / down hub each fall through to the
 * next step, so the worst case is the dbName fallback (or '' with noFallback) — never a throw.
 */
export function subdomainFor(dbName, opts = {}) {
  const statePath = opts.statePath != null ? opts.statePath : process.env.STATE_PATH;
  // 1. run-state
  const fromState = subdomainFromState(statePath);
  if (fromState) return fromState;
  // 2. platform lookup
  const hubDatabase = opts.hubDatabase != null ? opts.hubDatabase
    : (process.env.PG_HUB_DATABASE || resolveHubDatabase());
  const fromPlatform = subdomainFromPlatform(dbName, hubDatabase);
  if (fromPlatform) return fromPlatform;
  // 3. db-name fallback (or '' when the caller wants to own the fallback)
  if (opts.noFallback) return '';
  return String(dbName == null ? '' : dbName);
}

/** Resolve the hub Postgres database name via the single config loader (config.mjs's
 *  getHubDatabase), which applies the SAME env override (CONSTRUCTIVE_HUB_DATABASE) and
 *  'constructive' default. Wrapped in a tolerant try/catch so a missing/unreadable
 *  constructive.config.json still falls back to 'constructive' (the historical behavior),
 *  keeping subdomainFor a never-throw resolver. */
function resolveHubDatabase() {
  try {
    return getHubDatabase();
  } catch {
    return 'constructive';
  }
}

export { BriefError };
