/**
 * scripts/lib/scaffold-frontend/relations-m2m.mjs — N:M LINK MANAGEMENT (the M:N
 * relation-manager surface, SG-2 Stage 2).
 *
 * A brief with a RelationManyToMany (junction) provisions the link TABLE + its typed
 * SDK hooks (use<Junctions>Query / useCreate<Junction>Mutation / useDelete<Junction>-
 * Mutation) but, before this, generated NO UI to create/manage the links — you could
 * not attach/detach a linked record from the app (the Cleome field-guide↔observation
 * citations + observation cooccurrence had to be SEEDED by script). For each N:M
 * relation OWNED by a table (source_table === the table) we now stamp a generic
 * RELATION-MANAGER surface (templates/frontend/crud/relation-manager.tsx) and mount it
 * as a SECTION on the owning entity's page: it lists the records currently linked to a
 * chosen owning row and lets the user ADD (create a junction row) and REMOVE (delete it).
 *
 * SCOPE: the junction FK PAIR only (link / unlink). Junction PAYLOAD columns are the
 * deferred SG-3 grammar gap (the M:N `data:` block exposes no payload-column slot) — a
 * comment seam in the template notes payload is future; none are emitted here.
 *
 * GENERIC + CANARY-SAFE. Everything derives from the brief's N:M relation + the SAME
 * inflection the rest of the file uses (junction/source/target table → entityIdentifiers
 * + camel(singular)+'Id' FK keys). An app with NO RelationManyToMany emits NOTHING new
 * (manyToManyRelations returns [] → both seams are '' and no template file is written),
 * so the owner/blog/childfk canaries — and the CRM fixture (RelationBelongsTo only) —
 * stay byte-identical; only crm/cleome-style N:M briefs get the manager.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  camel,
  kebab,
  titleCase,
  pluralizeWords,
  entityIdentifiers,
  singularFromTable,
} from '../inflect.mjs';
import { CRUD_TEMPLATES_DIR } from './paths.mjs';
import { readTemplate, write, skip, assertNoUnsubstituted } from './writers.mjs';
import { makeColMapper } from './codegen-columns.mjs';
import { labelFieldFor } from './fields.mjs';
import { ORG_SCOPING_IMPORT, ORG_OWNER_CONST } from './scoping.mjs';

// The junction-node $types that MATERIALIZE an `entity_id` column on the link row (so an
// org-scoped junction's create MUST supply a non-null entity_id). Mirrors brief.mjs's
// NODE_PROVIDED_COLUMNS (the SAME source of truth the backend builder reads), narrowed to
// the entity_id producers. A junction whose `data.nodes` includes one of these kept its
// org security (AuthzEntityMembership honored); a DataId-only junction was coerced to
// AuthzAllowAll (GAP-1d) and has NO entity_id column → its create takes only the FK pair.
const JUNCTION_ENTITY_ID_NODES = new Set(['DataEntityMembership', 'DataOwnershipInEntity']);
// Authz* policy types whose junction is org-scoped (materializes entity_id). Mirrors
// brief.mjs's JUNCTION_MATERIALIZING_NODES key set — the SAME signal the backend uses to
// emit Pattern-3 nodes. Read from the policy INTENT so the frontend tracks the backend
// even when the brief states the intent WITHOUT explicit nodes (the default org path).
const JUNCTION_ORG_POLICY_TYPES = new Set(['AuthzEntityMembership', 'AuthzMemberOwner']);
// The `junction_policy:` shorthand → the Authz* type it resolves to (mirrors brief.mjs's
// JUNCTION_POLICY_SHORTHAND, narrowed to the type so the frontend reads the same intent).
const JUNCTION_POLICY_SHORTHAND_TYPE = {
  'org-membership': 'AuthzEntityMembership',
  'member-owner': 'AuthzMemberOwner',
};

/**
 * Whether a RelationManyToMany junction is ORG-SCOPED — i.e. it materializes an
 * `entity_id` column, so its create needs a non-null `entityId`. Tracks the backend's
 * Pattern-3 decision (brief.mjs liftManyToManySecurity) 1:1, GENERICALLY, with NO junction
 * name special-cased. A junction is org-scoped when EITHER:
 *   (a) its nodes (nested `data.nodes` or flat SDK `nodes`) include a DataEntityMembership
 *       / DataOwnershipInEntity (an advanced author declared the column), OR
 *   (b) its requested policy INTENT is org-scoped — nested `data.policy_type`, the
 *       `junction_policy:` shorthand, or a flat `policies[].$type` of AuthzEntityMembership
 *       / AuthzMemberOwner — AND the author did NOT force a non-materializing explicit
 *       `nodes` set (in which case the backend coerces to AuthzAllowAll and there is NO
 *       entity_id column). This is exactly when the backend emits the Pattern-3 node.
 */
export function junctionOrgScoped(rel) {
  const explicitNodes = Array.isArray(rel?.data?.nodes)
    ? rel.data.nodes
    : Array.isArray(rel?.nodes)
      ? rel.nodes
      : null;
  // (a) explicit materializing node present → org-scoped regardless of policy form.
  if (explicitNodes && explicitNodes.some((n) => JUNCTION_ENTITY_ID_NODES.has(typeof n === 'string' ? n : n?.$type))) {
    return true;
  }
  // If the author forced an explicit nodes set WITHOUT a materializing node, the backend
  // can't honor an org policy (it coerces to AuthzAllowAll) → no entity_id column.
  if (explicitNodes) return false;
  // (b) no explicit nodes → org-scoped iff the requested policy intent is org-scoped
  // (the default Pattern-3 path materializes entity_id). Read the intent from all forms.
  const nested = rel?.data?.policy_type;
  const short = (typeof rel?.junction_policy === 'string')
    ? JUNCTION_POLICY_SHORTHAND_TYPE[rel.junction_policy]
    : undefined;
  const flat = Array.isArray(rel?.policies) ? rel.policies.map((p) => p?.$type) : [];
  return JUNCTION_ORG_POLICY_TYPES.has(nested) ||
    JUNCTION_ORG_POLICY_TYPES.has(short) ||
    flat.some((t) => JUNCTION_ORG_POLICY_TYPES.has(t));
}

/**
 * EVERY RelationManyToMany OWNED by `table` (source_table === table.name) — the N:M
 * relations whose manager mounts on THIS entity's page. The owning side is the SOURCE
 * (e.g. a field_guide owns its guide_citations → observations), matching the brief's
 * source/target direction; the manager attaches/detaches the TARGET records.
 *
 * Each result describes one junction manager, every identifier DERIVED (zero literals):
 *   junctionName  — the junction table name (junction_table_name, else <source>_<target>).
 *   junctionIds   — entityIdentifiers(singular(junctionName)): the junction list hook
 *                   (use<Junctions>Query), data accessor (<junctions>), create/delete
 *                   hook bases, DynamicFormCard `_meta` type, and the testid prefix.
 *   ownFkKey      — the junction FK column → the OWNING row (camel(singular(source))+'Id').
 *   otherFkKey    — the junction FK column → the LINKED record (camel(singular(target))+'Id').
 *   otherIds      — entityIdentifiers(singular(target_table)): the LINKED entity's list hook
 *                   (the add-picker's options source) + data accessor.
 *   otherLabelField — the linked table's display field (labelFieldFor) or null (→ show id).
 *   otherLabel    — the linked entity's human label ("Observations") for the empty/picker.
 *   relLabel      — the section heading (titleCase of the junction name).
 *   relKebab      — kebab singular of the junction → the data-testid prefix base.
 *   orgScoped     — true when the junction materializes entity_id (junctionOrgScoped) → the
 *                   create needs `entityId: activeOrgId`.
 * Returns [] when the table owns no N:M relation (the canary path — emits NOTHING new).
 */
export function manyToManyRelations(brief, table, srcDir = null, ctx = null) {
  const relations = brief?.data_model?.relations ?? [];
  const tables = brief?.data_model?.tables ?? [];
  const out = [];
  for (const r of relations) {
    if (r?.$type !== 'RelationManyToMany') continue;
    if (r.source_table !== table?.name) continue;
    if (!r.target_table) continue;
    const junctionName =
      r.junction_table_name || [r.source_table, r.target_table].filter(Boolean).join('_');
    const sourceSingular = singularFromTable(r.source_table) || kebab(r.source_table);
    const targetSingular = singularFromTable(r.target_table) || kebab(r.target_table);
    const targetTable = tables.find((t) => t.name === r.target_table) || null;
    // The linked (target) table's label column must be selected by ITS codegen-actual name.
    const targetMapCol = srcDir
      ? makeColMapper(srcDir, entityIdentifiers(targetSingular).EntityPascal, ctx)
      : (n) => n;
    out.push({
      junctionName,
      junctionIds: entityIdentifiers(singularFromTable(junctionName) || kebab(junctionName)),
      // The junction FK columns the platform generates: <singular(table)>Id, camelCased
      // (verified against the codegen'd Create<Junction>Input — fieldGuideId/observationId).
      // These are structurally <entity>Id (multi-char tail) so the platform never mangles them.
      ownFkKey: camel(sourceSingular) + 'Id',
      otherFkKey: camel(targetSingular) + 'Id',
      otherIds: entityIdentifiers(targetSingular),
      otherLabelField: labelFieldFor(targetTable, targetMapCol),
      otherLabel: titleCase(pluralizeWords(targetSingular).join('-')),
      relLabel: titleCase(pluralizeWords(singularFromTable(junctionName) || junctionName).join('-')),
      relKebab: kebab(singularFromTable(junctionName) || junctionName),
      orgScoped: junctionOrgScoped(r),
    });
  }
  return out;
}

/**
 * Stamp ONE relation-manager component (templates/frontend/crud/relation-manager.tsx) per
 * N:M relation into <app>/src/components/crud/relations/<junction>-relation-manager.tsx,
 * substituting every junction-derived identifier. Idempotent: skips if the file already
 * exists. Returns the import path + the component name the entity page mounts.
 *
 * The two label seams collapse cleanly when the linked table has NO text label
 * (otherLabelField === null): the selection drops to bare `id`, the picker option shows
 * `opt.id`, and the resolved row label shows `hit.id` — never a leaked `?? undefined`.
 */
export function emitRelationManager(srcDir, rel, ctx) {
  const dir = path.join(srcDir, 'components', 'crud', 'relations');
  const fileBase = `${rel.junctionName.replace(/_/g, '-')}-relation-manager`;
  const dest = path.join(dir, `${fileBase}.tsx`);
  const componentName = `${rel.junctionIds.EntityPascal}RelationManager`;
  const importPath = `@/components/crud/relations/${fileBase}`;

  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return { importPath, componentName };
  }

  // The linked-record selection.fields body + the two label expressions (SG-6).
  const labelSelect = rel.otherLabelField ? `id: true, ${rel.otherLabelField}: true` : 'id: true';
  // Picker <option> (loop var `opt`) + the labelForLink resolver (matched row `hit`).
  const optLabelExpr = rel.otherLabelField ? `opt.${rel.otherLabelField} ?? opt.id` : 'opt.id';
  const hitLabelExpr = rel.otherLabelField
    ? `(hit.${rel.otherLabelField} as string | undefined) ?? hit.id ?? '(unknown)'`
    : "hit.id ?? '(unknown)'";

  // Org-scoping seams — only an entity_id-materializing junction gets them (so a DataId-
  // only junction's create stays the bare FK pair, matching its codegen'd Create input).
  const orgImport = rel.orgScoped ? ORG_SCOPING_IMPORT : '';
  const orgConst = rel.orgScoped ? ORG_OWNER_CONST : '';
  const orgCreateKey = rel.orgScoped ? ', entityId: activeOrgId' : '';
  const orgAddGuard = rel.orgScoped ? ' || !activeOrgId' : '';

  let body = readTemplate(CRUD_TEMPLATES_DIR, 'relation-manager.tsx');
  const subs = [
    // longer tokens before shorter so a prefix never clobbers a longer match.
    ['__Create_Junction__', rel.junctionIds.CreateEntityPascal],
    ['__Delete_Junction__', 'Delete' + rel.junctionIds.EntityPascal],
    ['__JUNCTION_PASCAL__', rel.junctionIds.EntityPascal],
    ['__Junctions__', rel.junctionIds.EntitiesPascal],
    ['__junctions__', rel.junctionIds.entitiesCamel],
    ['__Others__', rel.otherIds.EntitiesPascal],
    ['__others__', rel.otherIds.entitiesCamel],
    ['__OWN_FK_KEY__', rel.ownFkKey],
    ['__OTHER_FK_KEY__', rel.otherFkKey],
    ['__OTHER_LABEL_SELECT__', labelSelect],
    ['__OTHER_LABEL_EXPR_FN__', hitLabelExpr],
    ['__OTHER_LABEL_EXPR__', optLabelExpr],
    ['__rel__', rel.relKebab],
    ['__REL_LABEL__', rel.relLabel],
    ['__OTHER_LABEL__', rel.otherLabel],
    ['__ORG_SCOPING_IMPORT__', orgImport],
    ['__ORG_SCOPING_CONST__', orgConst],
    ['__ORG_CREATE_KEY__', orgCreateKey],
    ['__ORG_ADD_GUARD__', orgAddGuard],
  ];
  for (const [tok, val] of subs) body = body.split(tok).join(val);
  assertNoUnsubstituted(dest, body);
  write(dest, body, ctx);
  return { importPath, componentName };
}

/**
 * Build the two entity-page seams that MOUNT the N:M relation managers for a table:
 *   • relationManagerImport — the per-junction `import { <Comp> } from '<path>';` lines,
 *     each on its own line with a leading '\n' when non-empty (mirrors parentHookImport).
 *   • relationManagerJsx    — the per-junction <…RelationManager ownerOptions={rows}
 *     ownerLabelOf={…} /> blocks, mounted as sections after the entity list. Passes the
 *     page's already-loaded `rows` as the owner options + a labelOf that reads the page's
 *     titleField (so the owner picker shows a name), so the manager is usable directly
 *     from the list page (pick an owner → manage its links) with NO detail route needed.
 *
 * BOTH seams are the empty string when `m2mRels` is empty — the load-bearing default that
 * keeps the no-N:M canary byte-identical (the seams collapse to nothing). The component is
 * stamped (emitRelationManager) as a side effect so the import resolves.
 */
export function buildRelationManagerSeams(srcDir, m2mRels, titleField, ctx) {
  if (!Array.isArray(m2mRels) || m2mRels.length === 0) {
    return { relationManagerImport: '', relationManagerJsx: '' };
  }
  const importLines = [];
  const jsxBlocks = [];
  for (const rel of m2mRels) {
    const { importPath, componentName } = emitRelationManager(srcDir, rel, ctx);
    importLines.push(`import { ${componentName} } from '${importPath}';`);
    jsxBlocks.push(
      [
        `      {/* N:M link management — ${rel.relLabel} (junction ${rel.junctionName}). */}`,
        `      <${componentName}`,
        `        ownerOptions={rows}`,
        `        ownerLabelOf={(row) => String(row.${titleField} ?? row.id)}`,
        `      />`,
      ].join('\n'),
    );
  }
  return {
    relationManagerImport: '\n' + importLines.join('\n'),
    relationManagerJsx: '\n' + jsxBlocks.join('\n'),
  };
}
