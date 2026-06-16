/**
 * dynamic-form-card.tsx — schema-driven create/edit/delete Stack card.
 *
 * One component, any Constructive-provisioned table. Introspects `_meta` at runtime
 * (via useTableMeta) and renders the correct inputs — zero static field config.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: lifted VERBATIM from constructive-frontend/references/meta-forms.md §7
 * (DynamicFormCard + ConfirmDeleteCard). scripts/scaffold-frontend.mjs stamps this to
 * <app>/src/components/crud/dynamic-form-card.tsx.
 * Placeholders / rewrites:
 *   __APP_ENDPOINT__   ← the app-public GraphQL endpoint URL (mutations + fetch land
 *                        here). Reference imported a `CRM_ENDPOINT`; here it is inlined
 *                        so the CRUD infra is self-contained.
 *   @/lib/auth/token-manager ← the app's TokenManager (auth bridge). Left as-is.
 *   @/components/ui/stack, /button, /skeleton, /toast ← boilerplate UI primitives.
 *   @/lib/meta/*, @/types/meta ← the sibling CRUD-infra files this generator also stamps.
 * The documented platform-bug fix is carried through faithfully: single-record fetch
 * uses query.all with a `where: { id: { equalTo: $id } }` filter and reads nodes[0] —
 * NEVER query.one / <type>ById (non-existent root fields here), and NOT the stock
 * `condition` arg (Constructive's PostGraphile exposes operator-object `where` filters
 * instead). No bespoke form logic added.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardComponent } from '@/components/ui/stack';
import { useCardReady } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSuccessToast, showErrorToast } from '@/components/ui/toast';
import { SYSTEM_FIELDS, isRequiredField, filterToWritable, loadSelectionFields } from '@/lib/meta/field-renderer';
import { useTableMeta } from '@/lib/meta/use-meta';
import { DynamicField } from './dynamic-field';
import { Loader2 } from 'lucide-react';
import { TokenManager } from '@/lib/auth/token-manager';
import type { MetaTable } from '@/types/meta';

// The app-public GraphQL endpoint for THIS app — all domain CRUD lands here.
const APP_ENDPOINT = '__APP_ENDPOINT__';

export type DynamicFormCardProps = {
  /** Constructive table type name, e.g. 'Contact', 'Note', 'Deal' */
  tableName: string;
  /** Existing record ID — omit for create mode */
  recordId?: string;
  /**
   * Pre-set field values from context (typically FK fields).
   * e.g. { contactId: "uuid" } when adding a Note from a Contact page.
   * These fields are rendered as visible-but-locked (disabled, 🔒 icon).
   */
  defaultValues?: Record<string, unknown>;
  /**
   * Human-readable display labels for locked fields.
   * e.g. { contactId: "Kristopher Floyd" } → shows name, UUID as helper text.
   */
  defaultValueLabels?: Record<string, string>;
  /** Called after successful save or delete */
  onSuccess?: () => void;
};

async function appRequest(query: string, variables?: Record<string, unknown>) {
  // PER-REQUEST token read (gotchas SDK-008): the token is read HERE, inside the request
  // function, on every call — NEVER snapshotted at module load. So the FIRST create in a fresh
  // authenticated session (right after sign-up/sign-in, before any reload) already carries the
  // live bearer instead of going out anonymous (HTTP 200 + "permission denied" + 0 rows). Use
  // the `app` namespace (this is the app-public endpoint); TokenManager keys a single store but
  // the arg keeps the intent explicit and aligned with the SDK `app` adapter's per-request seam.
  const { token } = TokenManager.getToken('app');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token.accessToken}`;
  const res = await fetch(APP_ENDPOINT, {
    method: 'POST', headers, body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// Resolve the ACTUAL Query list field for a table — generically, via schema introspection.
//
// WHY (skill gap / upstream `_meta` inflection bug): `_meta.query.all` is the platform's NAIVE
// pluralization of the table type (Company → "companys", Contact → "contacts"). For a REGULAR
// English plural that matches PostGraphile's own field name, but for an IRREGULAR plural it does
// NOT: PostGraphile names the Query list field with proper English inflection (Company →
// `companies`, NOT `companys`), and there is no `companys`/`company` root field at all. So the
// edit-load fetch built from `_meta.query.all` queries a non-existent field ("Cannot query field
// \"companys\". Did you mean \"companies\"?"), the read fails, and the edit form loads BLANK — even
// though create/update/delete (whose `_meta` mutation names DO match the schema) work. (List/create
// go through the codegen SDK, which already uses the correct `companies`.)
//
// Generic fix (NO entity hard-coding): PostGraphile derives the connection TYPE name from the table
// TYPE (`<TableType>Connection`), and `_meta.inflection.tableType` reports that table type correctly.
// So the correct list field is the Query field whose return type is `<tableType>Connection`. We
// introspect the Query type once (cached per endpoint), match on that connection type, and fall back
// to `_meta.query.all` only if introspection can't resolve it. This handles regular AND irregular
// plurals identically. Durable fix is upstream: make `_meta.query.all`/`query.one` use the SAME
// inflection PostGraphile uses for the schema.
const __listFieldCache = new Map<string, string>();
async function resolveListField(table: MetaTable): Promise<string> {
  const tableType = table.inflection?.tableType;
  const fallback = table.query.all;
  if (!tableType) return fallback;
  if (__listFieldCache.has(tableType)) return __listFieldCache.get(tableType)!;
  try {
    const connType = `${tableType}Connection`;
    const data = await appRequest(
      `query ResolveListField { __type(name: "Query") { fields { name type { name ofType { name ofType { name } } } } } }`,
    );
    const fields: Array<{ name: string; type: { name?: string; ofType?: { name?: string; ofType?: { name?: string } } } }> =
      data?.__type?.fields ?? [];
    const match = fields.find((f) => {
      const t = f.type || {};
      return t.name === connType || t.ofType?.name === connType || t.ofType?.ofType?.name === connType;
    });
    const resolved = match?.name || fallback;
    __listFieldCache.set(tableType, resolved);
    return resolved;
  } catch {
    return fallback;
  }
}

// Resolve the WRITABLE column set for a GraphQL input type (e.g. `<Type>Patch` / `<Type>Input`) —
// generically, via schema introspection. See field-renderer's filterToWritable/loadSelectionFields
// for the WHY: PostGraphile omits DB-generated/read-only columns (a `tsvector` search column, a
// generated/STORED computed column, …) from these INPUT_OBJECTs, so a form that sends/echoes them
// hard-fails (`Field "<col>" is not defined by type "<Type>Patch"`). We introspect the input type's
// `inputFields` once (cached per type name) and return the accepted-key set. `null` typeName or a
// failed/empty introspection returns null → the caller uses its legacy pass-everything fallback
// (no behavior change for tables without generated columns).
const __inputFieldsCache = new Map<string, Set<string> | null>();
async function resolveInputFields(typeName: string | null | undefined): Promise<Set<string> | null> {
  if (!typeName) return null;
  if (__inputFieldsCache.has(typeName)) return __inputFieldsCache.get(typeName)!;
  try {
    const data = await appRequest(
      `query ResolveInputFields($n: String!) { __type(name: $n) { inputFields { name } } }`,
      { n: typeName },
    );
    const fields: Array<{ name: string }> | null = data?.__type?.inputFields ?? null;
    const set = fields && fields.length ? new Set(fields.map((f) => f.name)) : null;
    __inputFieldsCache.set(typeName, set);
    return set;
  } catch {
    __inputFieldsCache.set(typeName, null);
    return null;
  }
}

function buildFetchQuery(table: MetaTable, listField: string, selectFields: string[]): string {
  const fields = selectFields.join('\n      ');
  // Fetch one row via the list field + a `where` filter on the PK. Constructive's PostGraphile
  // exposes `where: <Type>Filter` with operator objects (id.equalTo) — NOT the stock `condition`
  // arg, and there is NO by-PK root field (query.one / <type>ById do not exist here). The list
  // field name is resolved by resolveListField() (schema-introspected, irregular-plural-safe) —
  // NOT trusted from `_meta.query.all`. The SELECT set is restricted to patch-writable columns
  // (+ the PK) by loadSelectionFields() so a DB-generated column is never read back and re-sent on
  // save. Only the `where`/equalTo convention is fixed.
  return `
    query DynamicFetch($id: UUID!) {
      ${listField}(where: { id: { equalTo: $id } }) {
        nodes { ${fields} }
      }
    }
  `;
}

export const DynamicFormCard: CardComponent<DynamicFormCardProps> = ({
  tableName, recordId, defaultValues, defaultValueLabels, onSuccess, card,
}) => {
  const isEditMode = !!recordId;
  const { isReady } = useCardReady();
  const tableMeta = useTableMeta(tableName);
  const queryClient = useQueryClient();

  // Seed formValues with defaultValues so locked fields are in place immediately
  const [formValues, setFormValues] = useState<Record<string, unknown>>(defaultValues ?? {});
  const [initialized, setInitialized] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fkFields = useMemo(
    () => new Set(tableMeta?.foreignKeyConstraints.flatMap((fk) => fk.fields.map((f) => f.name)) ?? []),
    [tableMeta],
  );

  const editableFields = useMemo(
    () => tableMeta?.fields.filter((f) => !SYSTEM_FIELDS.has(f.name)) ?? [],
    [tableMeta],
  );

  // PRIMARY-KEY column names (schema-derived) — always read on edit-load to identify the row even
  // when the PK is not user-writable. Defaults to `id` if `_meta` reports no PK constraint.
  const pkFieldNames = useMemo(() => {
    const names = tableMeta?.primaryKeyConstraints.flatMap((pk) => pk.fields.map((f) => f.name)) ?? [];
    return names.length ? names : ['id'];
  }, [tableMeta]);

  // WRITABLE-COLUMN SETS (generic, schema-introspected) — the keys the create/update INPUT types
  // actually accept. PostGraphile omits DB-generated/read-only columns (tsvector, generated/STORED,
  // …) from `<Type>Patch` / `<Type>Input`, so sending them hard-fails. We resolve both sets once
  // per table (cached) and use them to (a) restrict the edit-LOAD select, (b) filter the create
  // input, (c) filter the update patch — generically, with NO column-name heuristics. Null (older
  // schema / introspection unavailable) → callers fall back to pass-everything (pre-fix behavior).
  const { data: writableSets } = useQuery({
    queryKey: ['dynamic-input-fields', tableMeta?.inflection.tableType],
    queryFn: async () => {
      // IMPORTANT — introspect the INNER record input types, the ones the mutations below actually
      // declare, NOT the OUTER mutation-wrapper input. PostGraphile nests the columns one level
      // down: `createX(input: { x: XInput })` and `updateX(input: { id, xPatch: XPatch })`. The
      // wrapper `_meta.inflection.createInputType` (= `CreateXInput`) only has the keys
      // {clientMutationId, x} — filtering the column bag against THAT would strip every real field.
      // So the create writable set is `<TableType>Input` (the column-level type the create mutation
      // uses) and the update writable set is `<TableType>Patch` — both matching the mutation bodies.
      const [patch, create] = await Promise.all([
        resolveInputFields(tableMeta!.inflection.patchType),
        resolveInputFields(`${tableMeta!.inflection.tableType}Input`),
      ]);
      return { patch, create };
    },
    enabled: isReady && !!tableMeta,
    staleTime: Infinity,
  });
  const patchWritable = writableSets?.patch ?? null;
  const createWritable = writableSets?.create ?? null;

  // SOFT-DELETE detection (generic, schema-driven). A table provisioned with the
  // `soft-delete` feature (DataSoftDelete) gets an `is_deleted` boolean column but NO
  // hard-delete root mutation — `_meta.query.delete` is null. Without this branch the
  // Delete button vanishes and the soft-delete is unreachable from the UI. We detect the
  // flag column by its inflected name (GraphQL camelCases `is_deleted` → `isDeleted`;
  // tolerate the snake form too) and, when there is no hard delete, route Delete through
  // an UPDATE that sets the flag true. We capture the ACTUAL field name the schema
  // exposes so the patch key always matches the introspected column.
  const softDeleteField = useMemo(
    () => tableMeta?.fields.find((f) => f.name === 'isDeleted' || f.name === 'is_deleted')?.name ?? null,
    [tableMeta],
  );

  // TEMPORAL detection (generic, schema-driven). A table provisioned with the
  // `temporal` restrict (restrict: [temporal] → RESTRICT_MODIFIERS.temporal) gets two
  // nullable timestamptz columns — `valid_from` / `valid_until` — AND a RESTRICTIVE
  // AuthzTemporal RLS policy whose INSERT WITH-CHECK only admits an IN-WINDOW row
  // (valid_from <= now() AND (valid_until IS NULL OR valid_until > now())). These
  // columns are ordinary editable datetime fields here (not SYSTEM_FIELDS), but if the
  // user leaves `valid_from` blank the create omits it and the WITH-CHECK REJECTS the
  // row — a temporal table would be un-writable from this form. We capture the actual
  // field name the schema exposes (GraphQL camelCases `valid_from` → `validFrom`;
  // tolerate the snake form too) so the create path below can default it to the current
  // instant, landing the row in-window. Pure detection — the column stays user-editable.
  const validFromField = useMemo(
    () => tableMeta?.fields.find((f) => f.name === 'validFrom' || f.name === 'valid_from')?.name ?? null,
    [tableMeta],
  );
  // Delete-path precedence — SOFT delete WINS when the table opted into soft-delete.
  // On the live hub PostGraphile STILL generates a functional root `delete<Table>`
  // mutation for a `soft-delete` (DataSoftDelete) table — and that mutation PHYSICALLY
  // drops the row (verified: deleteSnippet → row gone). So a hard-delete-first rule would
  // silently DESTROY rows on a table whose whole point is recoverable deletes (data
  // loss). We therefore prefer the SOFT path (UPDATE the flag column) whenever the table
  // exposes a soft-delete flag + an update mutation, and fall back to the root hard delete
  // ONLY for tables with no soft-delete flag. (A table with neither shows no Delete.)
  const hasRootDelete = !!tableMeta?.query.delete;
  const canSoftDelete = !!softDeleteField && !!tableMeta?.query.update;
  const canHardDelete = hasRootDelete && !canSoftDelete;
  const canDelete = canSoftDelete || canHardDelete;

  // Locked = pre-set from defaultValues, cannot be changed by user
  const lockedFields = useMemo(
    () => new Set(Object.keys(defaultValues ?? {})),
    [defaultValues],
  );

  const { data: existingData, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['dynamic-record', tableName, recordId],
    queryFn: async () => {
      // Resolve the ACTUAL list field (irregular-plural-safe; see resolveListField) instead of
      // trusting _meta.query.all, and restrict the SELECT to patch-writable columns (+ the PK) so a
      // DB-generated column (tsvector, generated/STORED, …) is never read back and re-sent on save.
      const listField = await resolveListField(tableMeta!);
      const writable = await resolveInputFields(tableMeta!.inflection.patchType);
      const selectFields = loadSelectionFields(
        tableMeta!.fields.map((f) => f.name),
        writable,
        pkFieldNames,
      );
      const query = buildFetchQuery(tableMeta!, listField, selectFields);
      const data = await appRequest(query, { id: recordId });
      return (data[listField]?.nodes?.[0] ?? null) as Record<string, unknown> | null;
    },
    enabled: isReady && isEditMode && !!tableMeta,
    staleTime: 0,
  });

  // Initialize form from existing record — locked fields take precedence
  if (existingData && !initialized) {
    const initial: Record<string, unknown> = { ...(defaultValues ?? {}) };
    for (const field of editableFields) {
      if (!lockedFields.has(field.name) && existingData[field.name] !== undefined) {
        initial[field.name] = existingData[field.name];
      }
    }
    setFormValues(initial);
    setInitialized(true);
  }

  const setFieldValue = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
  };

  // Validate — skip locked fields (always satisfied by caller)
  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    for (const field of editableFields) {
      if (lockedFields.has(field.name)) continue;
      if (isRequiredField(field)) {
        const val = formValues[field.name];
        if (val === undefined || val === null || val === '') {
          errors[field.name] = `${field.name} is required`;
        }
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // EDIT-DRAWER LOAD GATE (generic, any entity) — in edit mode, Save is blocked until the existing
  // record's values have actually loaded into the form (`initialized`). WHY: the fetch is async; if
  // the user types into a field and hits Save before the load resolves, the (then incomplete) form
  // would PATCH stale/blank values — silently discarding the real row's data. We gate the action
  // (return early) AND disable the button (below) until the record is in. Create mode has nothing to
  // load, so it is never gated. (TanStack invalidation after save re-fetches and re-initializes.)
  const recordLoaded = !isEditMode || initialized;

  const handleSave = async () => {
    if (!tableMeta || !recordLoaded || !validate()) return;
    setIsSaving(true);
    try {
      const input: Record<string, unknown> = {};
      for (const field of editableFields) {
        const val = formValues[field.name];
        if (val !== undefined && val !== '') input[field.name] = val;
      }

      // The nested input ARG name is SCHEMA-INFLECTED off the table type, NOT a generic
      // `input`/`patch`: PostGraphile names them <camelSingular> (create) and
      // <camelSingular>Patch (update) — e.g. Snippet → `snippet` / `snippetPatch`. Using
      // the generic names hard-fails ("Field \"patch\" is not defined by type
      // UpdateSnippetInput"). Derive both from inflection.tableType (verified == the
      // GraphQL __typename) so the card matches whatever this hub generated.
      const camelSingular = tableMeta.inflection.tableType.charAt(0).toLowerCase() + tableMeta.inflection.tableType.slice(1);
      const patchArg = `${camelSingular}Patch`;
      const createArg = camelSingular;
      if (isEditMode) {
        // Drop any key the <Type>Patch input does not accept (DB-generated/read-only columns) so the
        // update never carries an unknown field. introspection-derived; no-op when the set is null.
        const patch = filterToWritable(input, patchWritable);
        const mutation = `
          mutation DynamicUpdate($id: UUID!, $patch: ${tableMeta.inflection.patchType}!) {
            ${tableMeta.query.update}(input: { id: $id, ${patchArg}: $patch }) { clientMutationId }
          }`;
        await appRequest(mutation, { id: recordId, patch });
      } else {
        // TEMPORAL create default: a `restrict: [temporal]` table's RESTRICTIVE
        // AuthzTemporal WITH-CHECK rejects any INSERT that is not in-window. If the user
        // left `valid_from` blank (the common case — it is just another datetime field),
        // default it to the CURRENT instant computed from the runtime clock at submit
        // time so the row lands in-window (valid_from = now ≤ now; valid_until stays NULL
        // = open-ended) and is immediately visible. A value the user DID set is kept.
        if (validFromField && (input[validFromField] === undefined || input[validFromField] === '')) {
          input[validFromField] = new Date().toISOString();
        }
        // Drop any key the <Type>Input create input does not accept (DB-generated/read-only columns)
        // so the insert never carries an unknown field. introspection-derived; no-op when null.
        const createInput = filterToWritable(input, createWritable);
        const mutation = `
          mutation DynamicCreate($input: ${tableMeta.inflection.tableType}Input!) {
            ${tableMeta.query.create}(input: { ${createArg}: $input }) { clientMutationId }
          }`;
        await appRequest(mutation, { input: createInput });
      }

      await queryClient.invalidateQueries({ queryKey: [tableMeta.query.all] });
      if (isEditMode) await queryClient.invalidateQueries({ queryKey: ['dynamic-record', tableName, recordId] });
      showSuccessToast({ message: isEditMode ? `${tableName} updated` : `${tableName} created` });
      onSuccess?.();
      card.close();
    } catch (err) {
      showErrorToast({
        message: `Failed to ${isEditMode ? 'update' : 'create'} ${tableName}`,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!tableMeta || !recordId || !canDelete) return;
    card.push({
      id: `confirm-delete-${recordId}`,
      title: `Delete ${tableName}?`,
      // Soft delete is recoverable (the row is flagged, not dropped); hard delete is not.
      description: canSoftDelete ? 'This can be undone by an admin.' : 'This cannot be undone.',
      Component: ConfirmDeleteCard,
      props: {
        tableName, recordId,
        // Hard delete uses the root delete mutation; soft delete uses the update mutation
        // to set the flag. ConfirmDeleteCard picks the path from `softDeleteField`.
        deleteMutation: canHardDelete ? tableMeta.query.delete! : tableMeta.query.update!,
        softDeleteField: canSoftDelete ? softDeleteField : null,
        patchType: tableMeta.inflection.patchType,
        tableType: tableMeta.inflection.tableType,
        listQueryKey: tableMeta.query.all,
        onSuccess: () => { onSuccess?.(); card.close(); },
      },
      width: 400,
    });
  };

  if (!tableMeta || (isEditMode && isLoadingRecord && !initialized)) {
    return (
      <div className="flex h-full flex-col p-4 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {editableFields.map((field) => (
          <DynamicField
            key={field.name}
            field={field}
            value={formValues[field.name]}
            onChange={(val) => setFieldValue(field.name, val)}
            isForeignKey={fkFields.has(field.name)}
            locked={lockedFields.has(field.name)}
            lockedLabel={defaultValueLabels?.[field.name]}
            error={fieldErrors[field.name]}
          />
        ))}
        {editableFields.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">No editable fields.</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        {isEditMode && canDelete ? (
          <Button
            variant="destructive"
            size="sm"
            data-testid="record-delete"
            onClick={handleDelete}
            disabled={isSaving}
          >
            Delete
          </Button>
        ) : <div />}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => card.close()} disabled={isSaving}>Cancel</Button>
          <Button data-testid="record-create" onClick={handleSave} disabled={isSaving || !recordLoaded}>
            {isSaving
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              : isEditMode ? 'Save Changes' : `Create ${tableName}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

type ConfirmDeleteCardProps = {
  tableName: string; recordId: string; deleteMutation: string;
  /**
   * When set, this is a SOFT delete: `deleteMutation` is the table's UPDATE mutation and
   * the confirm issues a patch setting this flag column true (the row stays, flagged).
   * When null, `deleteMutation` is the root hard-delete mutation (the row is dropped).
   */
  softDeleteField?: string | null;
  patchType?: string | null;
  tableType: string; listQueryKey: string; onSuccess?: () => void;
};

const ConfirmDeleteCard: CardComponent<ConfirmDeleteCardProps> = ({
  tableName, recordId, deleteMutation, softDeleteField, patchType, tableType, listQueryKey, onSuccess, card,
}) => {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const isSoftDelete = !!softDeleteField;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      if (isSoftDelete) {
        // Soft delete = an UPDATE that flips the DataSoftDelete flag. The nested patch ARG
        // is schema-inflected (<camelSingular>Patch, e.g. snippetPatch) — NOT a generic
        // `patch` (which hard-fails "Field patch is not defined by type UpdateSnippetInput").
        // Derive it from tableType, the same as handleSave. The patch key is the
        // introspected flag column.
        const patchArg = `${tableType.charAt(0).toLowerCase() + tableType.slice(1)}Patch`;
        const mutation = `mutation DynamicSoftDelete($id: UUID!, $patch: ${patchType}!) {
          ${deleteMutation}(input: { id: $id, ${patchArg}: $patch }) { clientMutationId }
        }`;
        await appRequest(mutation, { id: recordId, patch: { [softDeleteField as string]: true } });
      } else {
        const mutation = `mutation DynamicDelete($id: UUID!) {
          ${deleteMutation}(input: { id: $id }) { clientMutationId }
        }`;
        await appRequest(mutation, { id: recordId });
      }
      await queryClient.invalidateQueries({ queryKey: [listQueryKey] });
      showSuccessToast({ message: `${tableName} deleted` });
      onSuccess?.(); card.close();
    } catch (err) {
      showErrorToast({
        message: `Failed to delete ${tableName}`,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 p-4">
        <p className="text-muted-foreground text-sm">
          Are you sure you want to delete this {tableName.toLowerCase()}?{' '}
          {isSoftDelete ? 'It can be restored by an admin.' : 'This cannot be undone.'}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" onClick={() => card.close()} disabled={isDeleting}>Cancel</Button>
        <Button
          variant="destructive"
          data-testid="record-delete-confirm"
          onClick={handleConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting…</> : `Delete ${tableName}`}
        </Button>
      </div>
    </div>
  );
};
