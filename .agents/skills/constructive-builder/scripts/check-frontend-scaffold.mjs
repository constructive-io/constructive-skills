#!/usr/bin/env node
/**
 * scripts/check-frontend-scaffold.mjs — the FRONTEND scaffolder's rot canary for the
 * required-belongs-to FK emission (FIX-1).
 *
 * WHY THIS EXISTS (the gap check:scaffold cannot see)
 * ───────────────────────────────────────────────────
 * check-scaffold.mjs asserts the BACKEND blueprint (it parses the generated
 * schemas/core.ts via parseBlueprintFromCore and compares tables/nodes/policies/
 * relations). That makes it BLIND to a FRONTEND-emission change: a child table with a
 * REQUIRED belongs-to FK must produce an entity page whose create supplies the non-null
 * parent FK, or every child create NOT-NULL/RLS-rejects at runtime — yet the blueprint
 * (and thus check:scaffold) is identical whether or not the page emits that FK input.
 * That desync is INVISIBLE to check:scaffold (and to tsc/build, since the page is valid
 * TS either way). This guard makes it RED.
 *
 * WHAT IT ASSERTS (hub-free — a SINGLE dry-scaffold of the child-FK fixture; no :3000,
 * no DB, no Phase-3 codegen — the page emission is pure template text)
 * ─────────────────────────────────────────────────────────────────────────────
 * For the COMMITTED child-FK fixture fixtures/test-childfk-brief.yaml — `posts` BELONGS-TO
 * `topics` via a REQUIRED FK (topic_id) — the generated CHILD page (app/posts/page.tsx)
 * must emit ALL THREE pieces of the required-FK contract:
 *   (1) the camelCase FK key (topicId) INSIDE the create mutate — so the non-null parent
 *       FK is actually sent on create;
 *   (2) the parent list-hook import (useTopicsQuery) — the data source the FK picker reads;
 *   (3) the FK picker testid (post-topic-select) — the <entity>-<parentEntity>-select the
 *       live-QA driver picks a parent from before creating the child.
 * Every expected string is DERIVED from the brief (the relation's field_name/target_table
 * + the route entity) with the SAME inflection scaffold-frontend.mjs uses — nothing is
 * hard-coded to `post`/`topic`, so the guard tracks the generator generically.
 *
 * HOW IT CAPTURES THE EMITTED PAGE TEXT
 * ─────────────────────────────────────
 * scaffold-frontend.mjs is the OTHER agent's file; this guard does not import its
 * internals and does not depend on its private token names — it asserts the OBSERVABLE
 * OUTPUT. It first runs the scaffolder in --dry-run and, if the dry-run prints the page
 * body to stdout, greps that. Otherwise it does a real (non-dry) write into a throwaway
 * temp app skeleton and reads the emitted app/<child>/page.tsx file. Either way it greps
 * the SAME page TEXT — no codegen, no SDK, no network.
 *
 * A RED check:frontend-scaffold means the required-FK frontend emission drifted (or is
 * incomplete): a child page that won't be able to create a row because it never sends /
 * never lets the user pick the required parent FK. Run after touching
 * scripts/scaffold-frontend.mjs or scripts/templates/frontend/entity-page.tsx.
 *
 * Usage: node scripts/check-frontend-scaffold.mjs    (pnpm check:frontend-scaffold)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { loadBrief } from './lib/brief.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS = path.resolve(__dirname, '..');
const SCAFFOLD = path.join(HARNESS, 'scripts', 'scaffold-frontend.mjs');
const FIXTURE = path.join(HARNESS, 'fixtures', 'test-childfk-brief.yaml');

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const bad = (m) => { console.error(`  FAIL ${m}`); failures++; };

function mktemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ════════════════════════════════════════════════════════════════════════════
// Inflection — a SMALL copy of scaffold-frontend.mjs's helpers (words/pascal/camel/
// kebab/pluralizeWords/singularFromTable), so the EXPECTED strings are derived the
// SAME way the generator derives the emitted ones. Kept local (not imported) because
// scaffold-frontend.mjs is a CLI with top-level side effects (arg parse / process.exit /
// main()) — importing it to reuse five pure helpers would run all of that.
// ════════════════════════════════════════════════════════════════════════════

function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
function pascal(name) {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function camel(name) {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function kebab(name) {
  return words(name).join('-');
}
function pluralizeWords(name) {
  const ws = words(name);
  if (ws.length === 0) return [];
  const last = ws[ws.length - 1];
  let plural;
  if (/[^aeiou]y$/.test(last)) plural = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/.test(last)) plural = last + 'es';
  else plural = last + 's';
  return [...ws.slice(0, -1), plural];
}
function wordsToPascal(ws) {
  return ws.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
/** Singular entity from a table name (drop a trailing plural) — mirrors scaffold-frontend. */
function singularFromTable(tableName) {
  if (!tableName) return null;
  const ws = words(tableName);
  if (ws.length === 0) return null;
  let last = ws[ws.length - 1];
  if (/ies$/.test(last)) last = last.slice(0, -3) + 'y';
  else if (/(s|x|z|ch|sh)es$/.test(last)) last = last.slice(0, -2);
  else if (/s$/.test(last)) last = last.slice(0, -1);
  return [...ws.slice(0, -1), last].join('-');
}

/**
 * Resolve, from the brief, the CHILD route + its single required belongs-to FK and the
 * three derived contract strings the child page must emit. Returns null (with a console
 * note) if the fixture is missing the required-FK shape — that itself is a fixture-rot
 * FAIL the caller raises (a guard with nothing to assert is a silent pass we refuse).
 */
function resolveChildFkContract(brief) {
  const relations = brief.data_model?.relations ?? [];
  // The required belongs-to relation (FIX-1's trigger). The fixture declares exactly one.
  const rel = relations.find(
    (r) => r.$type === 'RelationBelongsTo' && r.is_required === true && r.field_name && r.target_table,
  );
  if (!rel) return null;

  const routes = brief.ui?.routes ?? [];
  // The CHILD route is the CRUD route whose entity is the singular of the relation's
  // source_table (posts → entity post). Fall back to matching the route path against the
  // source table if `entity` was omitted.
  const childEntityFromSource = singularFromTable(rel.source_table);
  const childRoute =
    routes.find((r) => (r.kind || 'crud') === 'crud' && r.entity && kebab(r.entity) === kebab(childEntityFromSource)) ||
    routes.find((r) => (r.kind || 'crud') === 'crud' && kebab(words(r.path).join('-')) === kebab(rel.source_table));
  if (!childRoute) return null;

  const childEntity = childRoute.entity || childEntityFromSource;
  const parentEntity = singularFromTable(rel.target_table);

  return {
    rel,
    childRoute,
    childEntity,
    parentEntity,
    routePath: childRoute.path,
    // (1) the camelCase FK key spread into the create mutate (topic_id → topicId).
    fkKey: camel(rel.field_name),
    // (2) the parent LIST hook the FK picker reads (topics → useTopicsQuery).
    parentListHook: 'use' + wordsToPascal(pluralizeWords(parentEntity)) + 'Query',
    // (3) the FK picker testid (post-topic-select) — the SHARED TESTID CONTRACT.
    fkSelectTestid: `${kebab(childEntity)}-${kebab(parentEntity)}-select`,
  };
}

/** The Next app-router page path the child route maps to: app/<segs>/page.tsx. */
function childPageRel(routePath) {
  const segs = String(routePath || '/').replace(/^\//, '').split('/').filter(Boolean);
  return path.join('app', ...segs, 'page.tsx');
}

/**
 * Capture the emitted CHILD page TEXT, hub-free + codegen-free. Strategy (robust to how
 * --dry-run is implemented by the other agent):
 *   1. Run scaffold-frontend in --dry-run; if its stdout already contains the page body
 *      (detected by the page-component marker), use that stdout.
 *   2. Otherwise do a REAL write into a throwaway temp app skeleton (just a src/ dir, so
 *      resolveAppSrc targets it) and read the emitted app/<child>/page.tsx file.
 * Returns { text, source } or throws with the scaffolder's stderr on a generation error.
 */
function captureChildPageText(routePath) {
  const childRel = childPageRel(routePath);
  const componentMarker = 'export default function'; // present in any emitted page body

  // ── 1. dry-run stdout ───────────────────────────────────────────────────────
  // Use a temp appDir so resolveAppSrc has a deterministic (empty) target; --dry-run
  // writes nothing. If the body is printed to stdout, grep that.
  const dryDir = mktemp('check-fe-dry-');
  try {
    let stdout = '';
    try {
      stdout = execFileSync('node', [SCAFFOLD, FIXTURE, dryDir, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // A non-zero exit in dry-run means the scaffolder THREW (e.g. an unsubstituted
      // placeholder — the in-progress FIX-1 state). Surface its message so the FAIL is
      // actionable, then re-throw so the caller reports it (don't silently fall through).
      const msg = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`scaffold-frontend --dry-run failed:\n${truncate(msg, 1200)}`);
    }
    if (stdout.includes(componentMarker) && stdout.includes('data-testid')) {
      return { text: stdout, source: `--dry-run stdout (page body printed)` };
    }
  } finally {
    fs.rmSync(dryDir, { recursive: true, force: true });
  }

  // ── 2. real write → read the emitted file ───────────────────────────────────
  const realDir = mktemp('check-fe-real-');
  try {
    // A bare src/ dir is enough: resolveAppSrc() picks <appDir>/src; the entity page is
    // written under it; app-routes.ts / sidebar-config.ts are absent → the appenders WARN
    // (non-fatal) and the page is still emitted. No codegen, no SDK, no network.
    fs.mkdirSync(path.join(realDir, 'src'), { recursive: true });
    try {
      execFileSync('node', [SCAFFOLD, FIXTURE, realDir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`scaffold-frontend (real write) failed:\n${truncate(msg, 1200)}`);
    }
    const pagePath = path.join(realDir, 'src', childRel);
    if (!fs.existsSync(pagePath)) {
      throw new Error(
        `scaffold-frontend did not emit the child page at src/${childRel} ` +
          `(looked under ${rel(realDir)}). The child route's page was not generated.`,
      );
    }
    return { text: fs.readFileSync(pagePath, 'utf8'), source: `emitted src/${childRel}` };
  } finally {
    fs.rmSync(realDir, { recursive: true, force: true });
  }
}

/** Slice out the `create<Entity>.mutate({ … })` argument so we assert the FK key is INSIDE it. */
function createMutateArg(text, childEntity) {
  const Entity = pascal(childEntity);
  // Anchor on `create<Entity>.mutate(` then capture to the matching close paren (balanced).
  const anchor = text.indexOf(`create${Entity}.mutate(`);
  if (anchor === -1) {
    // Fallback: any `.mutate(` call (the template names it create<Entity>, but tolerate a
    // rename so this guard checks the FK-inside-create semantics, not the hook's name).
    const generic = text.indexOf('.mutate(');
    if (generic === -1) return null;
    return balancedParen(text, text.indexOf('(', generic));
  }
  return balancedParen(text, text.indexOf('(', anchor));
}

/** Return the substring from the `(` at `openIdx` to its matching `)` (inclusive of inner text). */
function balancedParen(text, openIdx) {
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return text.slice(openIdx + 1); // unbalanced — return the tail (still greppable)
}

/** Is `hook` imported (appears on a line that starts an `import` or sits inside an import block)? */
function isImported(text, hook) {
  const lines = text.split('\n');
  let inImportBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^import\b/.test(t)) {
      if (t.includes(hook)) return true;       // single-line import that names the hook
      if (!t.includes(';')) inImportBlock = true; // multi-line import { … } opened
      else inImportBlock = false;
      continue;
    }
    if (inImportBlock) {
      if (t.includes(hook)) return true;        // hook listed inside a multi-line import
      if (t.includes(';') || /^\}/.test(t)) inImportBlock = false; // import block closed
    }
  }
  return false;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '\n  … (truncated)' : s;
}
function rel(p) {
  return path.relative(process.cwd(), p);
}

// ════════════════════════════════════════════════════════════════════════════
// Run
// ════════════════════════════════════════════════════════════════════════════

console.log('check:frontend-scaffold — required-FK frontend emission rot canary\n');

if (!fs.existsSync(FIXTURE)) {
  bad(`fixture missing: fixtures/test-childfk-brief.yaml (the committed child-FK rot canary). ` +
    `Restore it (a child table with a required belongs-to FK) so this guard has an input.`);
} else {
  const brief = loadBrief(FIXTURE);
  const c = resolveChildFkContract(brief);
  if (!c) {
    bad(`fixtures/test-childfk-brief.yaml no longer declares a required belongs-to FK + a matching ` +
      `child CRUD route — the fixture rotted away from the FIX-1 shape this guard exists to check. ` +
      `Restore a RelationBelongsTo with is_required: true and a crud route for its source table.`);
  } else {
    console.log(
      `  fixture: child=${c.childEntity} (route ${c.routePath}) belongs-to parent=${c.parentEntity} ` +
        `via required FK ${c.rel.field_name}\n  expecting: FK key "${c.fkKey}" in the create mutate, ` +
        `import "${c.parentListHook}", testid "${c.fkSelectTestid}"\n`,
    );
    let cap = null;
    try {
      cap = captureChildPageText(c.routePath);
    } catch (err) {
      bad(`could not capture the emitted ${c.childEntity} page — ${String(err.message)}`);
    }

    if (cap) {
      const text = cap.text;
      console.log(`  (page text captured from ${cap.source})\n`);

      // (1) the camelCase FK key INSIDE the create mutate.
      const mutateArg = createMutateArg(text, c.childEntity);
      if (mutateArg == null) {
        bad(`(1) FK key in create mutate — no \`create${pascal(c.childEntity)}.mutate( … )\` call found ` +
          `in the ${c.childEntity} page; the required FK "${c.fkKey}" cannot be sent on create.`);
      } else if (new RegExp(`\\b${c.fkKey}\\b`).test(mutateArg)) {
        ok(`(1) create mutate sends the required FK key "${c.fkKey}" (\`create${pascal(c.childEntity)}.mutate({ … ${c.fkKey} … })\`)`);
      } else {
        bad(`(1) the create mutate does NOT include the required FK key "${c.fkKey}" — the child create ` +
          `omits the non-null parent FK and will NOT-NULL/RLS-reject at runtime. mutate arg was: ` +
          `{${truncate(mutateArg.replace(/\s+/g, ' ').trim(), 200)}}`);
      }

      // (2) the parent list-hook import.
      if (isImported(text, c.parentListHook)) {
        ok(`(2) parent list-hook "${c.parentListHook}" is imported (the FK picker's data source)`);
      } else {
        bad(`(2) the parent list-hook "${c.parentListHook}" is NOT imported — the FK picker has no parent ` +
          `options to choose from. Expected an \`import { ${c.parentListHook} } from '@sdk/app';\` (or in the @sdk/app block).`);
      }

      // (3) the FK picker testid (post-topic-select).
      if (text.includes(c.fkSelectTestid)) {
        ok(`(3) FK picker testid "${c.fkSelectTestid}" is emitted (the <${c.childEntity}>-<${c.parentEntity}>-select the driver picks from)`);
      } else {
        bad(`(3) the FK picker testid "${c.fkSelectTestid}" is NOT emitted — live-QA cannot pick a parent ` +
          `${c.parentEntity} before creating a ${c.childEntity} (SHARED TESTID CONTRACT: <entity>-<parentEntity>-select).`);
      }
    }
  }
}

console.log('');
if (failures > 0) {
  console.error(
    `check:frontend-scaffold FAIL — ${failures} check(s) failed. The required-FK frontend emission ` +
      `(scaffold-frontend.mjs / templates/frontend/entity-page.tsx) drifted or is incomplete: a child ` +
      `page with a required belongs-to FK must import the parent list hook, render the ` +
      `<entity>-<parentEntity>-select picker, AND spread the camelCase FK key into the create mutate.`,
  );
  process.exit(1);
}
console.log(
  'check:frontend-scaffold PASS — the child-FK fixture emits the parent list-hook import, the FK picker ' +
    'testid, and the camelCase FK key in the create mutate.',
);
