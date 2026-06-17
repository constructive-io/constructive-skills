/**
 * scripts/lib/scaffold-frontend/fields.mjs — per-table FIELD derivation: which column is the
 * row label, the list/create selection sets, the required-non-text create defaults, the
 * temporal/soft-delete restrict signals + their seams, the policies_raw owner columns, and
 * the parent label field an FK/M:N picker shows.
 *
 * Every name is the brief camelCase MAPPED through `mapCol` (the codegen-actual column name;
 * see codegen-columns.mjs) so a platform-mangled column is referenced by its real SDK member.
 * `mapCol` defaults to identity so a codegen-free caller (every canary) is byte-identical.
 *
 * GENERIC: everything derives from `data_model.tables[].fields` / `.policy` / `.restrict` /
 * `.features` — no entity/column name is hard-coded.
 */

import { camel } from '../inflect.mjs';

/**
 * The label field to SHOW for a parent row in an FK picker (SG-6): the first REQUIRED
 * text field of the parent table, else a conventional slug/name/title/label text field,
 * else any text field, else null (→ the picker falls back to the raw id). Derived ONLY
 * from the parent table's `data_model.tables[].fields` so the key is a guaranteed-real
 * column, and inflected camelCase to match the SDK/_meta (first_name → firstName).
 * GENERIC: this is the same priority pickTitleField uses for the OWN row label, applied to
 * the PARENT — no entity/column is hard-coded.
 */
export function labelFieldFor(parentTable, mapCol = (n) => n) {
  const fields = parentTable?.fields ?? [];
  const isText = (f) => !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const requiredText = fields.find((f) => f.required && isText(f) && f.name !== 'slug');
  if (requiredText) return mapCol(camel(requiredText.name));
  const conventional = fields.find((f) => isText(f) && ['slug', 'name', 'title', 'label'].includes(camel(f.name)));
  if (conventional) return mapCol(camel(conventional.name));
  const anyText = fields.find((f) => isText(f) && f.name !== 'slug');
  if (anyText) return mapCol(camel(anyText.name));
  return null;
}

/**
 * The field shown as each row's label + bound to the quick-add input. The
 * generator prefers, in order: the first REQUIRED text field, the first text
 * field, a conventional name (title/name/label), else 'title'. Emitted camelCase
 * because the SDK/_meta inflect snake → camel, then mapped through `mapCol` to the
 * codegen-actual name (the title is BOTH a selection key and the create mutate key, so a
 * mangled text column must use its real codegen name). `mapCol` defaults to identity so
 * existing callers (codegen-free) are unchanged.
 */
export function pickTitleField(table, mapCol = (n) => n) {
  const fields = table?.fields ?? [];
  const isText = (f) => !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const requiredText = fields.find((f) => f.required && isText(f) && f.name !== 'slug');
  if (requiredText) return mapCol(camel(requiredText.name));
  const anyText = fields.find((f) => isText(f) && f.name !== 'slug');
  if (anyText) return mapCol(camel(anyText.name));
  const conventional = fields.find((f) => ['title', 'name', 'label'].includes(camel(f.name)));
  if (conventional) return mapCol(camel(conventional.name));
  return 'title';
}

/**
 * The owner-uuid columns a `policies_raw` table declares via an Authz*Owner* policy's
 * `data.entity_fields` (SG-2). A table reached through the policies_raw ESCAPE HATCH gets
 * NO mapped-policy scoping const, so its required owner uuid columns (e.g. an
 * AuthzDirectOwnerAny over a pair of owner uuid columns) are never set and every INSERT
 * NOT-NULL/RLS-rejects. We read EVERY policies_raw entry's `data.entity_fields` (the generic
 * shape ALL the owner-style raw Authz types use: entity_fields is a list of uuid columns the
 * actor must own) and return them camelCased + de-duped, so the create can set each to the
 * actor id (a self-default — the actor owns the row it creates). Returns [] for a table with
 * no policies_raw owner fields (every mapped-policy table → unchanged).
 */
export function policiesRawOwnerFields(table, mapCol = (n) => n) {
  const raw = Array.isArray(table?.policies_raw) ? table.policies_raw : [];
  const cols = [];
  for (const p of raw) {
    const ef = p?.data?.entity_fields;
    if (Array.isArray(ef)) {
      for (const c of ef) if (c) cols.push(mapCol(camel(c))); // codegen-actual owner-uuid column name
    }
  }
  return [...new Set(cols)];
}

/**
 * The REQUIRED NON-TEXT fields a quick-add create must supply a minimal value for (SG-B).
 * pickTitleField only binds the first required TEXT field; any OTHER required column with no
 * DB default — a date, integer, numeric, boolean, or timestamp — is dropped from the quick-add
 * mutate, so the create NOT-NULL-rejects (e.g. a required `observed_on` date column the title
 * input can't fill). This collects ALL `required: true` fields with no `default` and returns,
 * for each non-text one, the camelCase key + a type-appropriate minimal literal:
 *   date        → today (YYYY-MM-DD)        integer/numeric → 0
 *   boolean     → the field default, else false
 *   timestamptz → the current instant (ISO)
 * SKIPPED (handled elsewhere or unfabricable): the titleField (already bound), any TEXT/citext
 * field (text is the title or an optional field), uuid columns (FK columns are supplied by the
 * FK seams; owner uuid columns by the policy/policies_raw scoping — a random uuid is never
 * fabricated), and json (no sensible non-null minimal). GENERIC: keyed off the brief field
 * type, no entity/column hard-coding — exactly how the backend builder reads field types.
 * Each fragment includes its own leading `, ` so it splices into the mutate after the title.
 */
export function requiredNonTextDefaults(table, titleField, mapCol = (n) => n) {
  const fields = table?.fields ?? [];
  const out = [];
  for (const f of fields) {
    if (f.required !== true) continue;
    if (f.default !== undefined) continue; // a DB default fills it — don't override
    const key = mapCol(camel(f.name)); // codegen-actual name (a mangled column → its real SDK key)
    if (key === titleField) continue; // already bound to the quick-add input
    const type = f.type?.name || 'text';
    if (type === 'text' || type === 'citext') continue; // title or optional text
    let literal;
    if (type === 'date') literal = 'new Date().toISOString().slice(0, 10)';
    else if (type === 'integer' || type === 'bigint' || type === 'smallint' || type === 'numeric' || type === 'decimal' || type === 'real' || type === 'double precision' || type === 'float') literal = '0';
    else if (type === 'boolean') literal = 'false';
    else if (type === 'timestamptz' || type === 'timestamp' || type === 'timestamptz_ms') literal = 'new Date().toISOString()';
    else continue; // uuid (FK/owner — handled elsewhere), json, or unknown — never fabricate
    out.push(`, ${key}: ${literal}`);
  }
  return out.join('');
}

/**
 * True when the table opted into the `temporal` restrict (restrict: [temporal] →
 * RESTRICT_MODIFIERS.temporal in lib/brief.mjs). That modifier adds two nullable
 * `valid_from`/`valid_until` timestamptz columns AND a RESTRICTIVE `AuthzTemporal`
 * policy whose INSERT WITH-CHECK only passes for a row that is IN-WINDOW
 * (valid_from <= now() AND (valid_until IS NULL OR valid_until > now())). Detected
 * GENERICALLY off the brief's `restrict` tag — no entity hard-coding — exactly the
 * way buildTableDefinition consumes RESTRICT_MODIFIERS, so it tracks the modifier 1:1.
 */
export function isTemporalTable(table) {
  return Array.isArray(table?.restrict) && table.restrict.includes('temporal');
}

/**
 * The policy-derived extra create-input keys the quick-add spreads. Per the
 * table's policy intent the create needs a non-null scoping column:
 *   owner / public-read+owner-write  -> `, ownerId`  (DataDirectOwner.owner_id)
 *   org-membership                    -> `, entityId: activeOrgId`
 *                                        (AuthzEntityMembership.entity_id — the active org)
 *   member-owner                      -> `, ownerId, entityId: activeOrgId` (SG-C: AuthzMemberOwner
 *                                        needs BOTH owner_id AND entity_id — the prior code emitted
 *                                        only entityId, so every member-owner create NOT-NULL-rejected
 *                                        on owner_id. The ownerId is the actor, like the owner tier.)
 *   public-lookup                     -> '' (no ownership column)
 *   policies_raw owner fields         -> `, <col>: ownerId` per declared entity_fields column (SG-2:
 *                                        a policies_raw ESCAPE-HATCH table gets no mapped scoping const,
 *                                        so its required owner uuid columns were never set. Each is set
 *                                        to the actor id — a self-default, e.g. lend-to-self.)
 *
 * PLUS, when the table is `restrict: [temporal]`, a temporal WINDOW fragment so the
 * quick-add row PASSES the RESTRICTIVE AuthzTemporal INSERT WITH-CHECK (else every
 * generated create is rejected — proven: a curl with an explicit window inserts, the
 * generated form does not). We supply `validFrom` as the CURRENT instant computed
 * from the runtime clock at submit time (`new Date().toISOString()` — emitted-app
 * code, which may use the JS Date API) and OMIT `validUntil` so the column stays NULL
 * (open-ended) — the in-window shape: valid_from <= now() AND valid_until IS NULL.
 * The two fragments compose (a table can be BOTH owner-scoped AND temporal), so the
 * order is `[, <policy key>][, validFrom: …]`.
 *
 * PLUS the SG-B required-non-text defaults — a minimal value for every required column the
 * quick-add title binding can't fill (date/int/bool/timestamp), so the create is not
 * NOT-NULL-rejected on a required non-text column.
 *
 * Returned as a code fragment spliced INTO THE MUTATION BODY ONLY (a real expression
 * context) after the title field — it INCLUDES its own leading `, ` so the empty case
 * collapses cleanly to `mutate({ title: t })`. It is NEVER injected into the JSDoc
 * header: a `/* … *​/` fragment there would prematurely close the doc-comment (gap #2).
 */
export function pickCreateExtra(table, titleField, mapCol = (n) => n) {
  const policy = table?.policy;
  let extra = '';
  if (policy === 'owner' || policy === 'public-read+owner-write') extra += ', ownerId';
  else if (policy === 'org-membership') extra += ', entityId: activeOrgId';
  // SG-C — member-owner needs BOTH owner_id (NOT NULL) AND entity_id.
  else if (policy === 'member-owner') extra += ', ownerId, entityId: activeOrgId';
  // SG-2 — policies_raw owner entity_fields: set each declared owner uuid column to the actor id.
  for (const col of policiesRawOwnerFields(table, mapCol)) extra += `, ${col}: ownerId`;
  // SG-B — required non-text columns the title binding can't fill (date/int/bool/timestamp).
  extra += requiredNonTextDefaults(table, titleField, mapCol);
  // Temporal window: land the row IN-window so the RESTRICTIVE AuthzTemporal WITH-CHECK
  // passes AND the row is immediately visible (valid_from = now ≤ now; valid_until NULL).
  if (isTemporalTable(table)) extra += ', validFrom: new Date().toISOString()';
  return extra;
}

/**
 * The list-query `selection.fields` object body (codegen 4.45.1+ HookStrictSelect
 * mandates a non-empty fields set). Always includes `id` + the label field, then every
 * brief field on the table. Each field name is the brief camelCase (the SDK/_meta inflect
 * snake → camel) MAPPED through `mapCol` to the codegen-actual name, so a platform-mangled
 * column (e.g. brief `elevation_m` → codegen `elevationm`) is selected by its real SDK
 * member instead of the brief-derived `elevationM` (which the SDK row type lacks → tsc
 * break). Derived ONLY from `data_model.tables[].fields` (every key is a real column) +
 * the codegen interface; `mapCol` defaults to identity so a codegen-free caller is
 * unchanged. The passed `titleField` is already mapped by the caller.
 * Returned as the indented body lines that fill the __SELECTION_FIELDS__ seam (which
 * sits at 8-space indent inside `fields: { … }`).
 */
export function buildSelectionFields(table, titleField, mapCol = (n) => n) {
  const keys = ['id', titleField];
  for (const f of table?.fields ?? []) {
    const k = mapCol(camel(f.name));
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k, i) => `${i === 0 ? '' : '        '}${k}: true,`).join('\n');
}

/**
 * The create-mutation `selection.fields` body — the minimal `id` + label field the
 * onSuccess refetch needs. Fills the __CREATE_SELECTION__ seam (8-space indent).
 */
export function buildCreateSelection(titleField) {
  const keys = ['id'];
  if (titleField && titleField !== 'id') keys.push(titleField);
  return keys.map((k, i) => `${i === 0 ? '' : '        '}${k}: true,`).join('\n');
}

/** True when the table opted into soft-delete (features: [soft-delete] → DataSoftDelete). */
export function isSoftDeleteTable(table) {
  return Array.isArray(table?.features) && table.features.includes('soft-delete');
}

/**
 * The list-query `where` filter that fills the __LIST_WHERE__ seam (which sits at the
 * `fields: { … },` indent inside `selection: { … }`, i.e. 6 spaces). For a SOFT-DELETE
 * table the Delete affordance flips `is_deleted` true and the row PERSISTS, so without a
 * list filter it stays visible (the MED residual). We emit the typed list `where`
 * `{ isDeleted: { equalTo: false } }` so soft-deleted rows drop out of the active list
 * while remaining in the DB. The filter is GraphQL-inflected `isDeleted` (DataSoftDelete's
 * column) via the codegen <Table>Filter (isDeleted: BooleanFilter, equalTo: boolean) — the
 * codegen-correct list `where`, NOT a top-level `condition`. Non-soft-delete tables get an
 * empty string (no filter line at all — they are unchanged).
 *
 * Returned WITH a leading newline so it inserts cleanly right after the `fields: { … },`
 * block; the empty case collapses to nothing (the next line stays `orderBy:`).
 */
export function buildListWhere(table) {
  if (!isSoftDeleteTable(table)) return '';
  // DataSoftDelete materializes `is_deleted` → GraphQL inflects it to `isDeleted`; the
  // BooleanFilter operator is `equalTo`. Filter to the not-soft-deleted rows.
  return '\n      // Soft-delete: hide rows whose DataSoftDelete `isDeleted` flag is set' +
    ' (the row persists in the DB; Delete only flips the flag).' +
    '\n      where: { isDeleted: { equalTo: false } },';
}
