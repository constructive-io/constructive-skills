#!/usr/bin/env node
/**
 * scripts/check-scaffold.mjs — the scaffolder's OWN rot canary.
 *
 * Runs the provision generator on the FROZEN golden brief into a temp dir and
 * asserts that the generated schemas/core.ts is STRUCTURALLY EQUIVALENT to the
 * reference blueprint — the working golden app's core.ts (.scratch-goldenpath/v2/
 * goldenapp2 when present, else the blueprint the brief declaratively implies). The
 * canary flows through the SAME general emitter every real app uses; the check
 * PARSES both blueprints and compares them order-insensitively (tables, nodes by
 * $type, fields by name → type/default, policies by $type + CRUD, grants, relations,
 * FTS), ignoring comments/header/whitespace. That is stronger than a frozen byte
 * snapshot (it catches a dropped policy or flipped permissive) and tolerant of
 * cosmetic drift. It also exercises the three divergent intent shapes
 * (public-read+owner-write, org-membership multi-table+relation, raw escape hatch)
 * to prove the generator is generic, not over-fit to the canary.
 *
 * A RED check:scaffold means a harness edit broke the generator's contract. Run
 * after touching scripts/lib/brief.mjs, scripts/scaffold-provision.mjs, or the
 * provision templates.
 *
 * Usage: node scripts/check-scaffold.mjs    (pnpm check:scaffold)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import {
  loadBrief,
  buildBlueprintDefinition,
  computeModuleClosure,
} from './lib/brief.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS = path.resolve(__dirname, '..');

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const bad = (m) => { console.error(`  FAIL ${m}`); failures++; };

function mktemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function scaffold(briefRel, outDir, extra = []) {
  execFileSync('node', [
    path.join(HARNESS, 'scripts', 'scaffold-provision.mjs'),
    path.join(HARNESS, briefRel),
    outDir,
    ...extra,
  ], { stdio: 'pipe' });
}

// ════════════════════════════════════════════════════════════════════════════
// SEMANTIC blueprint equivalence (replaces the old byte-equal canary).
//
// The canary now flows through the SAME general emitter every real app uses, so a
// byte snapshot is the wrong contract — cosmetic header/comment/whitespace churn
// would false-RED, and (worse) freezing a snapshot just memorizes the generator
// against itself. Instead we PARSE both core.ts blueprints into plain objects and
// compare their STRUCTURE order-insensitively: tables (by table_name), each
// table's nodes (by $type + data), fields (by name → type/default/required),
// policies (by $type + privileges/permissive/data), grants, relations, and FTS.
// This is STRONGER (catches a dropped policy, a flipped permissive, a changed
// field type) yet tolerant of comment/header differences.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parse the `const definition: BlueprintDefinition = { … };` object literal out of
 * a generated/reference schemas/core.ts and evaluate it to a plain JS object.
 *
 * We only extract from the `= {` after the `definition` declaration through its
 * matching closing brace, so the file's leading header doc-comment is ignored, and
 * any inline `//` / `/* *​/` comments inside the literal are dropped by the JS
 * evaluator. The literal is plain JS (single-quoted strings, bareword keys, native
 * arrays/objects) once the TS type annotation is removed — no TS transpile needed.
 */
function parseBlueprintFromCore(src) {
  const anchor = src.indexOf('const definition');
  if (anchor === -1) throw new Error('core.ts has no `const definition` declaration');
  const eq = src.indexOf('=', anchor);
  const open = src.indexOf('{', eq);
  if (eq === -1 || open === -1) throw new Error('core.ts `definition` has no object literal');
  // Walk to the matching close brace, honoring strings/comments so a `}` inside a
  // string or comment does not end the scan early.
  let depth = 0, i = open, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = src.slice(open, i);
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${literal});`)();
}

/** Stable deep-sort: arrays of objects are sorted by their JSON, object keys by name. */
function canonValue(v) {
  if (Array.isArray(v)) {
    const items = v.map(canonValue);
    items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    return items;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]);
    return out;
  }
  return v;
}

/** Canonicalize a node (string shorthand → { $type } so both forms compare equal). */
function canonNode(n) {
  if (typeof n === 'string') return { $type: n };
  return canonValue({ $type: n.$type, data: n.data ?? null });
}

/** Canonicalize one table to an order-insensitive structural fingerprint. */
function canonTable(t) {
  return {
    ref: t.ref,
    table_name: t.table_name,
    use_rls: t.use_rls ?? null,
    // nodes BY $type + data (order-insensitive)
    nodes: (t.nodes ?? []).map(canonNode)
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    // fields BY name → type/default/required (order-insensitive)
    fields: (t.fields ?? []).map((f) => canonValue({
      name: f.name,
      type: f.type ?? null,
      is_required: f.is_required ?? false,
      default: f.default ?? null,
      index: f.index ?? null,
    })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    // policies BY $type + CRUD privileges + permissive + data (order-insensitive)
    policies: (t.policies ?? []).map((p) => canonValue({
      $type: p.$type,
      privileges: [...(p.privileges ?? [])],
      permissive: p.permissive ?? null,
      policy_name: p.policy_name ?? null,
      policy_role: p.policy_role ?? null,
      data: p.data ?? null,
    })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    grants: canonValue(t.grants ?? []),
    unique_constraints: canonValue(t.unique_constraints ?? null),
  };
}

/** Canonicalize a whole BlueprintDefinition (tables/relations/FTS/features). */
function canonBlueprint(def) {
  return {
    tables: (def.tables ?? []).map(canonTable)
      .sort((a, b) => (a.table_name < b.table_name ? -1 : 1)),
    relations: canonValue(def.relations ?? []),
    full_text_searches: canonValue(def.full_text_searches ?? []),
    features: canonValue(def.features ?? null),
  };
}

/** Deep-equal two canonical blueprints; returns the first differing key-path or null. */
function firstBlueprintDiff(a, b, prefix = '') {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' &&
      Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstBlueprintDiff(a[k], b[k], prefix ? `${prefix}.${k}` : String(k));
      if (d) return d;
    }
  }
  return { path: prefix || '(root)', gen: a, exp: b };
}

/** Assert two core.ts blueprints are structurally equivalent; reports the mismatch. */
function blueprintsEquivalent(genSrc, refDef, label) {
  const gen = canonBlueprint(parseBlueprintFromCore(genSrc));
  const ref = canonBlueprint(refDef);
  const diff = firstBlueprintDiff(gen, ref);
  if (!diff) return true;
  bad(`${label} — blueprint structure DIVERGED at ${diff.path}`);
  console.error(`    gen: ${JSON.stringify(diff.gen)}`);
  console.error(`    exp: ${JSON.stringify(diff.exp)}`);
  return false;
}

console.log('check:scaffold — provision generator rot canary\n');

// ── 1. canary brief → core.ts SEMANTIC blueprint equivalence ────────────────
// The canary (plain single owner table) is generated by the SAME general emitter
// every real app uses (there is no special byte-match branch). We parse its
// emitted blueprint and assert it is STRUCTURALLY EQUIVALENT to the reference
// blueprint — order-insensitive over tables/nodes/fields/policies/grants/relations
// /FTS, ignoring comments/header/whitespace. Reference = the working goldenapp2's
// core.ts when checked out, else the declarative blueprint the golden brief implies
// (buildBlueprintDefinition) — either way a real structural contract, not a frozen
// byte snapshot of the generator against itself.
{
  const out = mktemp('check-scaffold-golden-');
  scaffold('fixtures/golden-app-brief.yaml', out);
  const genPath = path.join(out, 'packages', 'provision', 'src', 'schemas', 'core.ts');
  if (!fs.existsSync(genPath)) {
    bad('canary: scaffold did not emit schemas/core.ts');
  } else {
    const gen = fs.readFileSync(genPath, 'utf8');
    const goldenSrc = path.resolve(HARNESS, '..', '..', '.scratch-goldenpath', 'v2',
      'goldenapp2', 'packages', 'provision', 'src', 'schemas', 'core.ts');
    if (fs.existsSync(goldenSrc)) {
      // Reference = parse the working app's core.ts → structural fingerprint.
      const refDef = parseBlueprintFromCore(fs.readFileSync(goldenSrc, 'utf8'));
      if (blueprintsEquivalent(gen, refDef, 'canary')) {
        ok('canary core.ts is structurally equivalent to the working goldenapp2 blueprint (general path; comments/header ignored)');
      }
    } else {
      // Reference app not checked out — compare the emitted blueprint to the one the
      // golden brief declaratively implies (still parses the real emitted TS, so it
      // catches a generator that silently drops/mangles a node/policy/field).
      const brief = loadBrief(path.join(HARNESS, 'fixtures', 'golden-app-brief.yaml'));
      const refDef = buildBlueprintDefinition(brief);
      if (blueprintsEquivalent(gen, refDef, 'canary (reference app absent)')) {
        ok('canary core.ts is structurally equivalent to the brief-derived blueprint (reference app absent)');
      }
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
}

// ── 2. golden module closure == the 13 auth:email modules ────────────────────
{
  const brief = loadBrief(path.join(HARNESS, 'fixtures', 'golden-app-brief.yaml'));
  const def = buildBlueprintDefinition(brief);
  const mods = computeModuleClosure(brief, def.tables);
  const hasAll = mods.some((m) => (Array.isArray(m) ? m[0] : m) === 'all');
  if (mods.length === 13 && !hasAll && mods[0] === 'users_module') {
    ok('golden module closure = 13 native-tuple auth:email modules (no [\'all\'])');
  } else {
    bad(`golden module closure unexpected (len ${mods.length}, hasAll=${hasAll})`);
  }
}

// ── 3. divergent shapes generate without error (genericity smoke) ────────────
const DIVERGENT = [
  {
    name: 'public-read+owner-write (blog)',
    brief: `version: 1
app: { id: smoke-blog, label: Smoke Blog }
naming: { db_name: smokeblog }
modules: { preset: auth:email }
flows: [email-password]
data_model:
  tables:
    - name: posts
      policy: public-read+owner-write
      features: [slug, tags, fts]
      fields:
        - { name: title, type: { name: text }, required: true }
        - { name: slug, type: { name: text } }
        - { name: body, type: { name: text } }
ui: { routes: [{ path: /posts, label: Posts, kind: crud, entity: post }] }
acceptance: { required_flows: [email-password] }
`,
    assert: (def) => {
      const t = def.tables[0];
      const types = t.nodes.map((n) => (typeof n === 'string' ? n : n.$type));
      const onePublishable = types.filter((x) => x === 'DataPublishable').length === 1;
      const oneSlugField = t.fields.filter((f) => f.name === 'slug').length === 1;
      const twoPolicy = t.policies.length === 2 &&
        t.policies[0].$type === 'AuthzDirectOwner' &&
        t.policies[1].$type === 'AuthzPublishable' &&
        JSON.stringify(t.policies[1].privileges) === JSON.stringify(['select']);
      const ftsList = def.full_text_searches ?? [];
      const fts0 = ftsList[0];
      const hasFts = ftsList.length === 1 &&
        fts0.table_name === 'posts' &&
        fts0.field === 'search' &&
        Array.isArray(fts0.sources) &&
        fts0.sources.every((s) => typeof s.field === 'string' && s.weight);
      // GAP #5 guard: the `search` tsvector COLUMN must be MATERIALIZED on the
      // table (exactly once, type tsvector) — the live provision_full_text_search
      // procedure only resolves an existing field, it never creates one. Without
      // this column constructBlueprint aborts ('tsvector field "search" not
      // found'). The broken fixture asserted only the top-level index shape, which
      // is why a missing column slipped through; assert the column here too.
      const searchCols = t.fields.filter((f) => f.name === 'search');
      const searchColMaterialized = searchCols.length === 1 &&
        searchCols[0].type?.name === 'tsvector';
      // The tsvector self-column must NEVER feed itself as an FTS source.
      const searchNotSource = fts0 && Array.isArray(fts0.sources) &&
        !fts0.sources.some((s) => s.field === 'search');
      return onePublishable && oneSlugField && twoPolicy && hasFts &&
        searchColMaterialized && searchNotSource;
    },
  },
  {
    name: 'org-membership multi-table + relation (CRM)',
    brief: `version: 1
app: { id: smoke-crm, label: Smoke CRM }
naming: { db_name: smokecrm }
modules: { preset: b2b }
flows: [email-password, organization, org-members]
data_model:
  tables:
    - name: companies
      policy: org-membership
      fields: [{ name: name, type: { name: text }, required: true }]
    - name: contacts
      policy: org-membership
      fields: [{ name: full_name, type: { name: text }, required: true }]
  relations:
    - $type: RelationBelongsTo
      source_table: contacts
      target_table: companies
      field_name: company_id
      delete_action: SET NULL
      is_required: false
ui: { routes: [{ path: /contacts, label: Contacts, kind: crud, entity: contact }] }
acceptance: { required_flows: [email-password] }
`,
    assert: (def) => {
      const twoTables = def.tables.length === 2;
      const orgPolicy = def.tables.every((t) => t.policies[0].$type === 'AuthzEntityMembership');
      const rel = def.relations[0];
      const oneRel = def.relations.length === 1 && rel.$type === 'RelationBelongsTo' &&
        // 'SET NULL' in the brief must be coded to the single-char enum 'n'.
        rel.delete_action === 'n';
      return twoTables && orgPolicy && oneRel;
    },
    modAssert: (mods) => mods.length > 20 && !mods.some((m) => (Array.isArray(m) ? m[0] : m) === 'all'),
  },
  {
    name: 'raw escape hatch (advanced Authz)',
    brief: `version: 1
app: { id: smoke-raw, label: Smoke Raw }
naming: { db_name: smokeraw }
modules: { preset: auth:email }
flows: [email-password]
data_model:
  tables:
    - name: messages
      policy: owner
      nodes_raw: [{ $type: DataJsonb, data: { field_name: metadata } }]
      policies_raw: [{ $type: AuthzPeerOwnership, privileges: [select], permissive: true, data: { owner_field: owner_id, membership_type: 2 } }]
      fields: [{ name: body, type: { name: text }, required: true }]
ui: { routes: [{ path: /messages, label: Messages, kind: crud, entity: message }] }
acceptance: { required_flows: [email-password] }
`,
    assert: (def) => {
      const t = def.tables[0];
      const hasRawNode = t.nodes.some((n) => n && n.$type === 'DataJsonb');
      const hasRawPolicy = t.policies.some((p) => p.$type === 'AuthzPeerOwnership');
      return hasRawNode && hasRawPolicy;
    },
  },
];

for (const d of DIVERGENT) {
  const tmp = mktemp('check-scaffold-div-');
  const briefPath = path.join(tmp, 'brief.yaml');
  fs.writeFileSync(briefPath, d.brief);
  try {
    // run the real CLI (proves end-to-end), then re-derive the def for assertions
    execFileSync('node', [
      path.join(HARNESS, 'scripts', 'scaffold-provision.mjs'),
      briefPath, path.join(tmp, 'app'),
    ], { stdio: 'pipe' });
    const brief = loadBrief(briefPath);
    const def = buildBlueprintDefinition(brief);
    let pass = d.assert(def);
    if (pass && d.modAssert) pass = d.modAssert(computeModuleClosure(brief, def.tables));
    pass ? ok(`divergent: ${d.name}`) : bad(`divergent: ${d.name} — generated shape failed assertion`);
  } catch (err) {
    bad(`divergent: ${d.name} — generator threw: ${String(err.message).split('\n')[0]}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
if (failures > 0) {
  console.error(`check:scaffold FAIL — ${failures} check(s) failed. The provision generator's contract drifted.`);
  process.exit(1);
}
console.log('check:scaffold PASS — provision generator reproduces the canary AND handles the 3 divergent intent shapes.');
