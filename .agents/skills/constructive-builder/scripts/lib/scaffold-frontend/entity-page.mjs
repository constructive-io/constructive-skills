/**
 * scripts/lib/scaffold-frontend/entity-page.mjs — the per-entity domain UI emitter.
 *
 *   emitEntityPage  (step b) stamps a thin app/<route>/page.tsx from entity-page.tsx, wiring the
 *                   codegen'd SDK hooks + DynamicFormCard and splicing in the policy scoping,
 *                   belongs-to FK, and N:M relation-manager seams. EVERY seam collapses to the
 *                   empty string for the simple case (no FK / no N:M / owner policy), which is
 *                   what keeps the todos canary byte-identical.
 *   emitStubPage    (step d) a stub page for a non-CRUD route (dashboard|detail|custom).
 *   tableFor        resolve the data_model table a CRUD route binds to (explicit table:, else
 *                   inflection, else a positional fallback; HARD-FAILS rather than mis-scope).
 *
 * GENERIC: every identifier derives from the route entity + its backing table (inflection +
 * the codegen column mapper); no domain name is hard-coded.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  camel,
  pascal,
  kebab,
  titleCase,
  pluralizeWords,
  entityIdentifiers,
  singularFromTable,
} from '../inflect.mjs';
import { TEMPLATES_DIR } from './paths.mjs';
import { readTemplate, write, skip, assertNoUnsubstituted } from './writers.mjs';
import { makeColMapper } from './codegen-columns.mjs';
import {
  pickTitleField,
  pickCreateExtra,
  buildSelectionFields,
  buildCreateSelection,
  buildListWhere,
} from './fields.mjs';
import { scopingSeams } from './scoping.mjs';
import { buildFkSeams } from './relations-fk.mjs';
import { buildRelationManagerSeams } from './relations-m2m.mjs';
import { routeSegments } from './routes-nav.mjs';

// ════════════════════════════════════════════════════════════════════════════
// DENSITY SCALE (generic, dial-driven — NO entity/app literals).
//
// The DENSITY dial (brief.design.dials.density, 1–10) picks a SPACING scale that the
// generated pages bake into their Tailwind className strings at EMIT time. Three tiers,
// biased toward the trust-first / minimalist app rows (apps, not landing pages):
//   • density 1–3  → 'comfortable' (roomy — more padding, taller rhythm)
//   • density 4–6  → 'cozy'        (the DEFAULT, == the historical template literals)
//   • density 7–10 → 'compact'     (tight — dense rows, smaller gaps)
//
// The COZY tier reproduces the values the template used before this wave EXACTLY, so a
// brief with NO design block (density absent) emits byte-identical pages. Every token is
// a whole Tailwind class string (no arbitrary values), so the output stays within the
// boilerplate's compiled utility set. This is purely emit-time substitution — there is no
// `data-*` attribute and no globals.css rule, so it never couples to another agent's CSS.
// ════════════════════════════════════════════════════════════════════════════

const DENSITY_SCALES = {
  comfortable: {
    D_PAGE: 'px-6 py-16',
    D_HEAD_MB: 'mb-8',
    D_SECTION_MB: 'mb-10',
    D_FORM_GAP: 'gap-4',
    D_ROW_GAP: 'gap-4',
    D_ROW_PAD: 'px-5 py-4',
    D_EMPTY_PAD: 'px-6 py-16',
  },
  cozy: {
    // DEFAULT — these are the pre-wave literals, verbatim, so a design-less build is
    // byte-identical.
    D_PAGE: 'px-6 py-12',
    D_HEAD_MB: 'mb-6',
    D_SECTION_MB: 'mb-8',
    D_FORM_GAP: 'gap-3',
    D_ROW_GAP: 'gap-3',
    D_ROW_PAD: 'px-4 py-3',
    D_EMPTY_PAD: 'px-6 py-12',
  },
  compact: {
    D_PAGE: 'px-5 py-8',
    D_HEAD_MB: 'mb-4',
    D_SECTION_MB: 'mb-6',
    D_FORM_GAP: 'gap-2',
    D_ROW_GAP: 'gap-2',
    D_ROW_PAD: 'px-3 py-2',
    D_EMPTY_PAD: 'px-5 py-8',
  },
};

/**
 * Resolve the DENSITY dial (1–10, or a tier name) to a spacing-token bundle. Defaults to
 * 'cozy' (the historical look) when the dial is absent or unrecognized, so a brief with no
 * `design` block is unchanged. Accepts the numeric dial, a tier name ('comfortable'/'cozy'/
 * 'compact'), or undefined. Clamps out-of-range numbers. GENERIC — no entity input.
 */
export function resolveDensity(density) {
  if (typeof density === 'string') {
    const tier = density.toLowerCase();
    if (DENSITY_SCALES[tier]) return { tier, tokens: DENSITY_SCALES[tier] };
    return { tier: 'cozy', tokens: DENSITY_SCALES.cozy };
  }
  const n = Number(density);
  if (!Number.isFinite(n)) return { tier: 'cozy', tokens: DENSITY_SCALES.cozy };
  if (n <= 3) return { tier: 'comfortable', tokens: DENSITY_SCALES.comfortable };
  if (n >= 7) return { tier: 'compact', tokens: DENSITY_SCALES.compact };
  return { tier: 'cozy', tokens: DENSITY_SCALES.cozy };
}

/** The density token substitution pairs (__D_*__ → class string) for the given resolved
 *  density. Shared by emitEntityPage + emitStubPage so both pages share one spacing scale. */
function densitySubs(resolved) {
  const t = resolved?.tokens || DENSITY_SCALES.cozy;
  return Object.entries(t).map(([k, v]) => [`__${k}__`, v]);
}

/**
 * (b) Emit one entity page from the entity-page template, substituting the
 * per-entity identifiers. Idempotent: skips if the page already exists.
 *
 * `fks` (default []) is the table's belongs-to FKs (from belongsToFks(brief, table)):
 * required, optional, AND self-referential. For each one the page emits a parent-list-hook
 * import, a parent FK <select> picker bound to a default-selected state, the create-input FK
 * key, and (for REQUIRED FKs only) a submit guard. The EMPTY-ARRAY DEFAULT is load-bearing:
 * every FK seam collapses to the empty string when there are no FKs, so the no-FK path
 * (the todos canary) stays byte-identical to the pre-FIX-1 template.
 *
 * `m2mRels` (default []) is the N:M relations this table OWNS (manyToManyRelations(brief,
 * table)). For each one the page mounts a generic <…RelationManager> section (link/unlink
 * UI) and a relation-manager component is stamped under components/crud/relations/. The
 * EMPTY-ARRAY DEFAULT is equally load-bearing: both N:M seams collapse to '' when the table
 * owns no junction, so a non-N:M table (every canary) stays byte-identical.
 *
 * `density` (default undefined → 'cozy') is the resolved DENSITY scale (resolveDensity()),
 * threaded from scaffold-frontend.mjs which reads brief.design.dials.density. It only changes
 * spacing class strings; the DEFAULT ('cozy') reproduces the pre-wave literals, so a build with
 * no design block is byte-identical.
 */
export function emitEntityPage(srcDir, route, table, ctx, fks = [], m2mRels = [], density) {
  const entity = route.entity || singularFromTable(table?.name) || kebab(route.path);
  // SG-A — the SDK hooks (use<Entities>Query / useCreate<Entity>Mutation), the data accessor
  // (data.<entities>) and the DynamicFormCard `_meta` tableName ALL derive from the TABLE name
  // (codegen generates them from the table), NOT the route ENTITY. For the common case where the
  // entity inflects to the table (todo↔todos) these coincide → byte-identical canary; for an
  // ALIAS entity (a route whose entity does not inflect to its backing table) they DIVERGE and
  // the page must import the REAL table-derived hooks — deriving them from the alias would import
  // hooks that codegen never generated (the silent-break the old tableFor produced).
  const tableEntity = singularFromTable(table?.name) || entity;
  const sdkIds = entityIdentifiers(tableEntity); // SDK/_meta-facing identifiers (from the table)
  const ids = entityIdentifiers(entity); // UI/testid-facing identifiers (from the route entity)
  const label = route.label || titleCase(entity);
  // Lower-cased label for the prose copy (subtext / empty / error). Derived from the label,
  // so it tracks an explicit `route.label` ("Field Guides" → "field guides") AND a derived one.
  const labelLower = label.toLowerCase();
  // Resolved DENSITY scale → the spacing class strings the page bakes in. Defaults to 'cozy'
  // (the historical literals) when no design dial is present, so the page is byte-identical.
  const dSubs = densitySubs(resolveDensity(density));
  // SG-A for COLUMNS — remap every brief-derived column name to the name codegen ACTUALLY
  // emitted for THIS table's SDK row interface (sdkIds.EntityPascal, the same `_meta` type the
  // page already names). When the SDK isn't present (dry-run / canary) this is the identity, so
  // the brief-derived name is used unchanged (canary byte-identical). Threaded into every
  // column-emitting helper below so a platform-mangled column (e.g. elevation_m → elevationm) is
  // referenced by its real codegen name in the selection AND the create mutate — not the brief's.
  const mapCol = makeColMapper(srcDir, sdkIds.EntityPascal, ctx);
  const titleField = pickTitleField(table, mapCol);
  const createExtra = pickCreateExtra(table, titleField, mapCol);
  const scoping = scopingSeams(table);
  const selectionFields = buildSelectionFields(table, titleField, mapCol);
  const createSelection = buildCreateSelection(titleField);
  const listWhere = buildListWhere(table);
  // The page's OWN list hook (table-derived) — passed so a self-ref FK doesn't re-import it.
  const ownListHook = `use${sdkIds.EntitiesPascal}Query`;
  const fkSeams = buildFkSeams(ids.entityKebab, fks, ownListHook);
  // N:M link-management seams (the relation-manager sections this table owns). Both '' for
  // a non-N:M table (byte-identical canary). Side-effect: stamps each junction's manager
  // component (idempotent), so the page's imports resolve. Uses the table-derived titleField
  // for the owner picker's label (the SAME field the row label binds to).
  const relSeams = buildRelationManagerSeams(srcDir, m2mRels, titleField, ctx);

  // The page DIRECTORY is the route PATH (so the Next.js URL matches the brief's
  // `path`), NOT the entity — e.g. `path: /todos, entity: todo` lands at app/todos/
  // (serving /todos) while every identifier/testid still derives from `todo`.
  const dest = path.join(srcDir, 'app', ...routeSegments(route.path), 'page.tsx');
  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return { entity, ids, label };
  }

  let body = readTemplate(TEMPLATES_DIR, 'entity-page.tsx');
  // Order matters: the longer tokens (__Create_Entity__, __Entities__) before the
  // shorter (__Entity__) so a prefix never clobbers a longer match.
  const subs = [
    // SDK/_meta-facing identifiers → derived from the TABLE (sdkIds) so the page imports the
    // REAL codegen'd hooks + names the real `_meta` type, even for an ALIAS entity (SG-A). The
    // list/create hooks, the data accessor, the component + create-const names, and the
    // DynamicFormCard tableName all use the table singular — consistent and codegen-correct.
    ['__Create_Entity__', sdkIds.CreateEntityPascal],
    ['__Entities__', sdkIds.EntitiesPascal],
    ['__entities__', sdkIds.entitiesCamel],
    ['__Entity__', sdkIds.EntityPascal],
    // UI/testid-facing identifiers → derived from the route ENTITY alias (the testid prefix +
    // heading the live-QA driver and the user see). The empty-state testid is the kebab PLURAL of
    // the entity (consistent with the singular <entity>-row/-edit testids), kept SEPARATE from the
    // table-derived data accessor so an alias entity's testids all share the entity prefix while
    // the data accessor still reads the real table key. For the common case (entity inflects to the
    // table) this equals the old camel-plural for single-word entities → byte-identical canary.
    ['__entity__', ids.entityKebab],
    ['__ENTITIES_EMPTY_TESTID__', `${pluralizeWords(entity).join('-')}-empty`],
    // The lower-cased label (for the subtext / empty / error prose) goes BEFORE __ENTITY_LABEL__
    // so the longer token matches first (the split/join convention) — purely cosmetic copy.
    ['__ENTITY_LABEL_LOWER__', labelLower],
    ['__ENTITY_LABEL__', label],
    ['__TITLE_FIELD__', titleField],
    ['__SELECTION_FIELDS__', selectionFields],
    ['__LIST_WHERE__', listWhere],
    ['__CREATE_SELECTION__', createSelection],
    // Scoping seams (policy-derived): the lone scoping import + the scoping-id const + the
    // active-org submit guard. For owner/public tables these reproduce the prior template
    // EXACTLY (TokenManager import + ownerId const + empty guard) → byte-identical canary; an
    // org-membership table instead reads the active org from useActiveOrg() (the single source
    // of truth) and gates the create on it being resolved.
    ['__SCOPING_IMPORT__', scoping.scopingImport],
    ['__OWNER_CONST__', scoping.ownerConst],
    ['__ORG_SUBMIT_GUARD__', scoping.orgSubmitGuard],
    // Detailed-create scoping (b2b form-gap fix): pass the active org as a context default to the
    // schema-driven DynamicFormCard (it hides entity_id, a SYSTEM field, so the form can't collect
    // it) + gate the "Details…" button/handler on a resolved active org. ALL '' for owner/public →
    // the detailed-create push + Details button stay byte-identical for the non-org canaries.
    ['__DETAILED_CREATE_DEFAULTS__', scoping.detailedCreateDefaults],
    ['__DETAILS_GUARD__', scoping.detailsGuard],
    ['__DETAILS_DISABLED__', scoping.detailsDisabled],
    // Belongs-to FK seams (required + optional + self-ref). EACH is '' when there are no
    // FKs (byte-identical canary). __CREATE_EXTRA__ stays before __CREATE_FK_EXTRA__ on the
    // mutate line; the two whole-line seams (__PARENT_HOOK_IMPORT__/__PARENT_FK_HOOK__) carry
    // their own leading newline so the empty case leaves no stray blank line.
    ['__CREATE_EXTRA__', createExtra],
    ['__PARENT_HOOK_IMPORT__', fkSeams.parentHookImport],
    ['__PARENT_FK_HOOK__', fkSeams.parentFkHook],
    ['__FK_SELECT_JSX__', fkSeams.fkSelectJsx],
    ['__CREATE_FK_EXTRA__', fkSeams.createFkExtra],
    ['__SUBMIT_GUARD__', fkSeams.submitGuard],
    // N:M relation-manager seams. EACH is '' when the table owns no junction (byte-identical
    // canary). __RELATION_MANAGER_IMPORT__ carries its own leading newline (like the FK hook
    // import); __RELATION_MANAGER_JSX__ mounts the manager sections after the entity list.
    ['__RELATION_MANAGER_IMPORT__', relSeams.relationManagerImport],
    ['__RELATION_MANAGER_JSX__', relSeams.relationManagerJsx],
    // DENSITY spacing tokens (__D_*__ → Tailwind class strings) — resolved from the design
    // dial; 'cozy' default == the pre-wave literals (byte-identical when no design block).
    ...dSubs,
  ];
  for (const [tok, val] of subs) {
    body = body.split(tok).join(val);
  }
  assertNoUnsubstituted(dest, body);
  write(dest, body, ctx);
  return { entity, ids, label };
}

/**
 * (d) Emit a stub page for a non-CRUD route (dashboard|detail|custom) with a
 * clearly-marked seam. Idempotent.
 *
 * `density` (default undefined → 'cozy') is the resolved DENSITY scale, so the stub's page
 * spacing matches the CRUD pages. The 'cozy' default reproduces the pre-wave padding, and the
 * heading hierarchy (weight+muted-subtext) matches the entity pages so a mixed app reads as one.
 */
export function emitStubPage(srcDir, route, ctx, density) {
  const label = route.label || titleCase(kebab(route.path || 'page'));
  const dest = path.join(srcDir, 'app', ...routeSegments(route.path), 'page.tsx');
  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return;
  }
  const { tokens } = resolveDensity(density);
  const componentName = pascal(label || 'Page') + 'Page';
  const kind = route.kind || 'custom';
  const body = `'use client';

/**
 * ${route.path || '/'} — ${label} (kind: ${kind}).
 *
 * STUB emitted by scripts/scaffold-frontend.mjs for a non-CRUD route. The generic
 * CRUD path (typed list + DynamicFormCard) only covers \`kind: crud\`; richer
 * surfaces are yours to build.
 *
 * // TODO: custom UI — build with @constructive-io/ui; see constructive-frontend
 * //   (CRUD Stack cards, meta-forms, the 50+ Base UI components). For a read list
 * //   use the typed @sdk/app hooks directly; for create/edit reuse DynamicFormCard
 * //   from @/components/crud/dynamic-form-card.
 *
 * PRESENTATION SEAM: restructure this page freely per the design.md (see
 * references/art-direction.md) — re-compose the layout, the shell, the width clamp.
 * PRESERVE the functional contract for whatever you mount: any <entity>-* testids,
 * row-scoping, the hooks/selection/refetch/Stack-pushes, and the scoping const(s).
 */
export default function ${componentName}() {
  return (
    <div data-testid="authed-shell" className="mx-auto max-w-2xl ${tokens.D_PAGE}">
      <header className="${tokens.D_HEAD_MB}">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">${label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* TODO: custom UI — build with @constructive-io/ui; see constructive-frontend */}
          This ${kind} page is a scaffold stub. Replace it with your UI.
        </p>
      </header>
    </div>
  );
}
`;
  write(dest, body, ctx);
}

/**
 * Resolve the data_model table a CRUD route binds to. The route entity is a UI ALIAS
 * (the testid/label name) that need NOT inflect to the table name — e.g. a route whose
 * entity is a product label (`{ entity: ledger-entry }`) may point at a differently-named
 * backing table (`accounting_entries`) that the alias neither pluralizes nor singularizes to.
 *
 * RESOLUTION ORDER (most authoritative first):
 *   1. explicit `route.table` — the brief author names the backing table directly. This
 *      is the GENERIC escape hatch for an alias entity (SG-A): when the route name is a
 *      product label that does not inflect to the column-name table, declare `table:` and
 *      the binding is unambiguous. Validated against the real table set; a typo HARD-FAILS.
 *   2. inflection match on the entity — plural(entity) == table, singular(table) == entity,
 *      or singular table name == entity (the common case; the canaries take this path).
 *   3. positional fallback — the next still-UNCONSUMED table, IN BRIEF ORDER, matched to
 *      this route by position. CRUD routes are conventionally authored in table order, so
 *      an un-inflectable alias with no `table:` still resolves to its sibling table rather
 *      than silently mis-scoping to the wrong one.
 * If NONE resolve, we HARD-FAIL naming the unresolved alias + the remaining tables — we
 * NEVER fall back to tables[0] (the old behavior), which silently emitted a broken
 * owner-scoped page against nonexistent SDK hooks for any alias route.
 *
 * `consumed` (a Set of already-bound table names) makes the positional fallback skip
 * tables earlier routes already claimed, so each route lands on a distinct table.
 */
export function tableFor(brief, route, consumed = new Set()) {
  const tables = brief.data_model?.tables ?? [];
  const where = `route ${route.path || '(no path)'}`;

  // (1) explicit table: — authoritative. Must name a real table.
  if (route.table) {
    const hit = tables.find((t) => t.name === route.table || camel(t.name) === camel(route.table));
    if (hit) return hit;
    throw new Error(
      `scaffold-frontend: ${where} declares table: "${route.table}" but no data_model table ` +
        `has that name. Tables: ${tables.map((t) => t.name).join(', ') || '(none)'}.`,
    );
  }

  const ent = route.entity;
  if (!ent) {
    // No entity + no table: bind the next unconsumed table positionally (single-route apps
    // and the implicit-first-table convention). Fail loud if every table is taken.
    const next = tables.find((t) => !consumed.has(t.name));
    if (next) return next;
    throw new Error(
      `scaffold-frontend: ${where} has neither \`entity\` nor \`table\` and every data_model ` +
        `table is already bound to an earlier route — add an explicit \`table:\` to this route.`,
    );
  }

  // (2) inflection match.
  const pluralOfEntity = pluralizeWords(ent).join('');
  const byInflection =
    tables.find((t) => camel(t.name) === pluralOfEntity) ||
    tables.find((t) => singularFromTable(t.name) === kebab(ent)) ||
    tables.find((t) => camel(t.name) === camel(ent)); // singular table name
  if (byInflection) return byInflection;

  // (3) positional fallback — the next unconsumed table in brief order (alias without table:).
  const next = tables.find((t) => !consumed.has(t.name));
  if (next) return next;

  // (4) unresolved — fail LOUD instead of emitting a broken page.
  throw new Error(
    `scaffold-frontend: ${where} (entity "${ent}") does not match any data_model table by ` +
      `inflection and no unconsumed table remains for a positional bind. Add an explicit ` +
      `\`table:\` to the route. Tables: ${tables.map((t) => t.name).join(', ') || '(none)'}.`,
  );
}
