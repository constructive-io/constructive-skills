/**
 * scripts/lib/scaffold-frontend/relations-fk.mjs — the belongs-to FK seam (the FK-picker input).
 *
 *   belongsToFks   reads brief.data_model.relations → every RelationBelongsTo on a table
 *                  (required / optional / self-referential), each described by the identifiers
 *                  its picker + create need (codegen-actual FK key, parent list hook, label
 *                  field, testid halves, required/selfRef flags).
 *   buildFkSeams   turns that list into the five entity-page seams (parent import / FK hooks /
 *                  select JSX / create-input keys / submit guard). EVERY seam is '' when there
 *                  are no FKs — the load-bearing default that keeps a no-FK page byte-identical.
 *
 * GENERIC: every identifier derives from the relation's field_name/target_table + inflection +
 * the codegen column mapper; no entity/column is hard-coded (the childfk canary proves it).
 */

import {
  camel,
  pascal,
  kebab,
  titleCase,
  entityIdentifiers,
  singularFromTable,
} from '../inflect.mjs';
import { makeColMapper } from './codegen-columns.mjs';
import { labelFieldFor } from './fields.mjs';

/**
 * EVERY belongs-to FK on one table — the FK-picker input. Reads brief.data_model.relations
 * and keeps every RelationBelongsTo whose source_table is THIS table, REQUIRED or OPTIONAL,
 * including SELF-REFERENTIAL ones (target == source). Earlier only REQUIRED non-self FKs
 * got a picker; optional + self-ref FKs fell through to a bare raw-UUID text box (SG-1).
 * Now all render the SAME <select> picker (optional ones simply allow the empty choice and
 * stay out of the submit guard).
 *
 * Each result describes one FK select:
 *   fkKey       — the FK input key (field_name `topic_id` → `topicId`), MAPPED to the
 *                 codegen-actual column name (a mangled FK column → its real SDK member); the
 *                 key spread into the create AND the base for every per-FK var name (unique
 *                 because a column name is unique on the table). The common `<parent>_id` shape
 *                 is multi-char so it is never mangled (childfk canary unchanged), but deriving
 *                 it from codegen keeps it correct for ANY FK column name.
 *   FkKeyPascal — PascalCase fkKey (`TopicId`) → the setter name `set<FkKeyPascal>`.
 *   fkKebab     — FK-column kebab (field_name minus a trailing _id, underscores → dashes):
 *                 the UNIQUE <fkColumn> half of the testid <entity>-<fkColumn>-select. Keyed
 *                 on the COLUMN, not the parent entity, so two FKs to the SAME parent
 *                 (author_id/reviewer_id → users) get DISTINCT testids. For the common
 *                 <parent>_id shape this equals the parent-entity kebab (topic_id → topic),
 *                 so the canary/childfk testids are unchanged.
 *   required    — true for a NON-NULL parent FK (drives the submit guard + non-empty default).
 *   selfRef     — true when target_table == source_table (the self-ref tree case).
 *   labelField  — the parent's display field (SG-6) or null (→ show the id).
 *   parentLabel — human parent label for the empty-state ("No Topics yet").
 *   ids         — entityIdentifiers(singular(target_table)): the PARENT's list-hook name
 *                 (use<EntitiesPascal>Query), data accessor (<entitiesCamel>), and testid
 *                 prefix (<entityKebab>, the <parentEntity> half of the testid).
 * Returns [] when the table has no belongs-to FK (the canary path).
 */
export function belongsToFks(brief, table, srcDir = null, ctx = null) {
  const relations = brief?.data_model?.relations ?? [];
  const tables = brief?.data_model?.tables ?? [];
  // Codegen-actual column mapper for THIS (child) table — used for the FK input key.
  const childEntity = singularFromTable(table?.name) || kebab(table?.name || '');
  const childMapCol = srcDir
    ? makeColMapper(srcDir, entityIdentifiers(childEntity).EntityPascal, ctx)
    : (n) => n;
  const out = [];
  for (const r of relations) {
    if (r?.$type !== 'RelationBelongsTo') continue;
    if (r.source_table !== table?.name) continue;
    if (!r.field_name || !r.target_table) continue;
    // FK input key → the codegen-actual name (SG-A for columns). The setter/var names derive
    // from the SAME (possibly remapped) key so they stay consistent JS identifiers.
    const fkKey = childMapCol(camel(r.field_name));
    const parentSingular = singularFromTable(r.target_table) || kebab(r.target_table);
    const parentTable = tables.find((t) => t.name === r.target_table) || null;
    // The parent's label field must be selected by ITS codegen-actual name → the parent table's
    // own mapper (a different interface than the child's).
    const parentMapCol = srcDir
      ? makeColMapper(srcDir, entityIdentifiers(parentSingular).EntityPascal, ctx)
      : (n) => n;
    out.push({
      fkKey,
      FkKeyPascal: pascal(fkKey),
      fkKebab: r.field_name.replace(/_id$/, '').replace(/_/g, '-'),
      required: r.is_required === true,
      selfRef: r.target_table === r.source_table,
      labelField: labelFieldFor(parentTable, parentMapCol),
      parentLabel: titleCase(parentSingular),
      ids: entityIdentifiers(parentSingular),
    });
  }
  return out;
}

/**
 * Build the five entity-page FK seams for a table's belongs-to FKs (REQUIRED, OPTIONAL, and
 * SELF-REFERENTIAL — all render the same picker; SG-1).
 * `entityKebab` is the CHILD entity's testid prefix (the <entity> half of the contract
 * testid <entity>-<fkColumn>-select); each FK's fkKebab is the <fkColumn> half. EVERY seam is
 * the empty string when `fks` is empty — that is what keeps the no-FK canary byte-identical.
 * The two WHOLE-LINE seams (parentHookImport / parentFkHook) begin with a leading '\n' when
 * non-empty and are placed in the template with no line of their own, so the empty case leaves
 * no stray blank line; the three mid-expression/JSX seams carry their own leading separator
 * (', ' / ' || ' / '\n') exactly like the existing __CREATE_EXTRA__ seam. Per-FK variables are
 * keyed by the unique fkKey so multiple FKs (or two FKs to the same parent) never collide;
 * duplicate parent imports are de-duped.
 *
 * REQUIRED vs OPTIONAL/SELF-REF (the SG-1 split):
 *   • REQUIRED FK — defaults to the first parent once loaded (so a child create always has a
 *     parent), is unconditionally spread into the create, and adds a submit guard (` || !fk`).
 *     This path is BYTE-IDENTICAL to the prior required-only behavior (the childfk canary).
 *   • OPTIONAL / SELF-REF FK — no non-empty default (the empty choice is valid → the column
 *     stays NULL), an extra "— none —" option to clear it, NO submit guard, and the create key
 *     is spread CONDITIONALLY (`...(fk ? { fk } : {})`) so an unset optional FK is omitted from
 *     the mutate rather than sent as ''. A self-ref FK reads the SAME table's list (it is just a
 *     belongs-to onto its own table), so no special hook is needed.
 *
 * LABEL (SG-6): each FK fetches its parent's labelField (when one exists) alongside id and
 * renders it as the <option> TEXT (value stays the id) — so the picker shows a human name, not
 * a raw UUID. When the parent has no text label the picker falls back to the id.
 *
 * `ownListHook` is the page's OWN list-hook name (the table-derived use<Entities>Query the
 * template already imports). A SELF-REF FK's parent IS the page's own table, so its import is
 * SKIPPED to avoid a duplicate-import TS error — the FK hook block reuses the already-imported
 * hook. Pass null to import every FK's hook (no own-hook to de-dupe against).
 */
export function buildFkSeams(entityKebab, fks = [], ownListHook = null) {
  if (!Array.isArray(fks) || fks.length === 0) {
    return { parentHookImport: '', parentFkHook: '', fkSelectJsx: '', createFkExtra: '', submitGuard: '' };
  }

  // (1) parent list-hook imports — mirror the page's own `} from '@sdk/app';` shape.
  // De-dupe by hook name so two FKs to the same parent table don't redeclare the import, AND
  // EXCLUDE the page's OWN list hook (`ownListHook`): a SELF-REF FK (or any FK onto the page's
  // own table) reads the list the template already imports at the top, so re-importing it here
  // would be a DUPLICATE-import TS error (TS2300). The self-ref FK hook block reuses that hook.
  const importLines = [
    ...new Set(
      fks
        .map((fk) => `use${fk.ids.EntitiesPascal}Query`)
        .filter((hook) => hook !== ownListHook)
        .map((hook) => `import { ${hook} } from '@sdk/app';`),
    ),
  ];
  const parentHookImport = importLines.length ? '\n' + importLines.join('\n') : '';

  // (2) parent FK hooks — one block per FK: fetch the parent list (id + the label field when
  // one exists; SG-6), hold the user's choice in state, and — for REQUIRED FKs — DEFAULT to the
  // first parent once loaded (no useEffect — a derived `<fkKey>` const, so the `react` import
  // stays `{ useState }`). An OPTIONAL/self-ref FK leaves the choice empty (NULL is valid).
  const hookBlocks = fks.map((fk) => {
    const choice = `${fk.fkKey}Choice`;
    const options = `${fk.fkKey}Options`;
    const labelSel = fk.labelField ? `id: true, ${fk.labelField}: true` : 'id: true';
    const kindNote = fk.selfRef
      ? 'optional self-ref belongs-to FK (the tree parent); NULL is valid'
      : fk.required
        ? 'required belongs-to FK; default to the first parent once loaded'
        : 'optional belongs-to FK; NULL is valid (no default)';
    const valueExpr = fk.required ? `${choice} || ${options}[0]?.id || ''` : choice;
    return [
      `  // ${fk.fkKey} — ${kindNote}.`,
      `  const ${fk.fkKey}Query = use${fk.ids.EntitiesPascal}Query({`,
      `    selection: { fields: { ${labelSel} } },`,
      `  });`,
      `  const ${options} = ${fk.fkKey}Query.data?.${fk.ids.entitiesCamel}?.nodes ?? [];`,
      `  const [${choice}, set${fk.FkKeyPascal}] = useState('');`,
      `  const ${fk.fkKey} = ${valueExpr};`,
    ].join('\n');
  });
  const parentFkHook = '\n' + hookBlocks.join('\n');

  // (3) FK select JSX — one per FK, at the form's 12-space child indent. The disabled
  // empty-state (testid <entity>-<fkColumn>-select-empty) shows when there are zero parents;
  // otherwise the bound select (testid <entity>-<fkColumn>-select). The testid is keyed on the
  // FK COLUMN (fkKebab) so two FKs to the same parent never share a testid. The <option> shows
  // the parent's label field when present (SG-6), else the id. Optional/self-ref FKs get a
  // leading "— none —" option so the column can be cleared to NULL.
  const selectBlocks = fks.map((fk) => {
    const options = `${fk.fkKey}Options`;
    const sel = `${entityKebab}-${fk.fkKebab}-select`;
    const optText = fk.labelField ? `{opt.${fk.labelField} ?? opt.id}` : '{opt.id}';
    const noneOption = fk.required ? '' : '\n                <option value="">— none —</option>';
    return [
      `            {${options}.length === 0 ? (`,
      `              <select`,
      `                data-testid="${sel}-empty"`,
      `                disabled`,
      `                className="rounded-md border px-3 py-2 text-sm"`,
      `              >`,
      `                <option>No ${fk.parentLabel} yet</option>`,
      `              </select>`,
      `            ) : (`,
      `              <select`,
      `                data-testid="${sel}"`,
      `                value={${fk.fkKey}}`,
      `                onChange={(e) => set${fk.FkKeyPascal}(e.target.value)}`,
      `                className="rounded-md border px-3 py-2 text-sm"`,
      `              >${noneOption}`,
      `                {${options}.map((opt) => (`,
      `                  <option key={opt.id} value={opt.id ?? ''}>`,
      `                    ${optText}`,
      `                  </option>`,
      `                ))}`,
      `              </select>`,
      `            )}`,
    ].join('\n');
  });
  const fkSelectJsx = '\n' + selectBlocks.join('\n');

  // (4) create-input FK keys — spread INSIDE the mutate call after __CREATE_EXTRA__; each
  // carries its own leading ', ' so the empty case collapses cleanly (mirrors createExtra).
  // REQUIRED FKs spread the key plainly (it always has a value); OPTIONAL/self-ref FKs spread
  // CONDITIONALLY so an unset FK is omitted (NULL) rather than sent as ''.
  const createFkExtra = fks
    .map((fk) => (fk.required ? `, ${fk.fkKey}: ${fk.fkKey}` : `, ...(${fk.fkKey} ? { ${fk.fkKey}: ${fk.fkKey} } : {})`))
    .join('');

  // (5) submit guard — appended to the submit button's `disabled` expression; each REQUIRED FK
  // carries its own leading ' || ' so submit stays disabled until every required parent is
  // chosen. Optional/self-ref FKs do NOT gate submit (NULL is valid).
  const submitGuard = fks.filter((fk) => fk.required).map((fk) => ` || !${fk.fkKey}`).join('');

  return { parentHookImport, parentFkHook, fkSelectJsx, createFkExtra, submitGuard };
}
