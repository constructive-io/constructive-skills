/**
 * field-renderer.ts — Field render utilities for dynamic `_meta` forms.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: lifted VERBATIM from constructive-frontend/references/meta-forms.md §5.
 * scripts/scaffold-frontend.mjs stamps this to <app>/src/lib/meta/field-renderer.ts.
 * The `@/types/meta` import is rewritten by the generator to wherever meta-types.ts
 * landed. No other placeholders — pure logic, generic across any table.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type { MetaField } from '@/types/meta';

/** System fields — always skip in forms (auto-managed by Constructive) */
export const SYSTEM_FIELDS = new Set([
  'id', 'entityId', 'createdAt', 'updatedAt',
  'created_at', 'updated_at', 'entity_id',
  // DataSoftDelete tombstone columns — managed by the Delete affordance (which issues
  // the soft-delete update), never hand-edited as a form field. Hidden in both the
  // camelCase (_meta-inflected) and snake forms.
  'isDeleted', 'is_deleted', 'deletedAt', 'deleted_at',
]);

export type FieldInputType =
  | 'text' | 'textarea' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'uuid' | 'json' | 'select' | 'hidden';

const TEXTAREA_HINTS = ['bio', 'description', 'notes', 'body', 'content', 'summary', 'details'];

export function getInputType(field: MetaField, isForeignKey: boolean): FieldInputType {
  if (SYSTEM_FIELDS.has(field.name)) return 'hidden';
  if (isForeignKey) return 'select';
  const pg = field.type.pgType.toLowerCase();
  switch (pg) {
    case 'text': case 'varchar': case 'citext':
      return TEXTAREA_HINTS.some((h) => field.name.toLowerCase().includes(h)) ? 'textarea' : 'text';
    case 'int2': case 'int4': case 'int8':
    case 'float4': case 'float8': case 'numeric': return 'number';
    case 'bool': case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'timestamp': case 'timestamptz': return 'datetime';
    case 'uuid': return 'uuid';
    case 'json': case 'jsonb': return 'json';
    default: return 'text';
  }
}

/**
 * A field is required if it's NOT NULL AND has no server-side default.
 * hasDefault=true = Constructive auto-generates the value (ids, timestamps, etc.) — never require in forms.
 */
export function isRequiredField(field: MetaField): boolean {
  return field.isNotNull && !field.hasDefault;
}

/**
 * WRITABLE-COLUMN INTERSECTION (generic, schema-introspected — fixes the generated/read-only
 * column class of bug).
 *
 * WHY THIS EXISTS
 * ───────────────
 * `_meta.tables[].fields` enumerates the table's COLUMNS, but some columns are NOT writable
 * through the GraphQL mutation input: a DB-GENERATED column (e.g. a full-text-search `tsvector`,
 * a generated/STORED computed column), or any column PostGraphile marks read-only. PostGraphile
 * OMITS those from the `<Type>Patch` (update) and `<Type>Input` (create) INPUT_OBJECTs entirely.
 * So a form that blindly sends every non-system column hard-fails at the GraphQL layer with
 * `Field "<col>" is not defined by type "<Type>Patch"` (verified live: a Post with a generated
 * `search: tsvector` → its `PostPatch` has no `search`, and an update carrying it is rejected),
 * AND a load that SELECTs every column then echoes it back re-introduces the same dropped column
 * on save.
 *
 * THE GENERIC FIX (no column-name heuristics)
 * ───────────────────────────────────────────
 * Derive the writable set by INTROSPECTING the relevant input type's `inputFields` (the caller
 * passes the names it got from a `__type(name: "<Type>Patch"|"<Type>Input")` query) and keep only
 * keys that input actually accepts. This is the authoritative, schema-driven source of truth — it
 * generalizes to ANY generated/computed/read-only column on ANY table, with zero name matching
 * ("search", "tsv", …). When introspection is unavailable (network/older schema) the caller may
 * pass `null` and we fall back to the previous behavior (send everything) — strictly no worse than
 * before, and only the generated-column edge regresses, exactly the pre-fix state.
 */

/**
 * Intersect a record with the input type's writable keys.
 * - `writable === null` → introspection unavailable; pass the input through unchanged (legacy
 *   fallback, no behavior change for tables that have no generated columns).
 * - otherwise keep only keys the input type accepts.
 * Generic across any table; pure (no I/O).
 */
export function filterToWritable<T extends Record<string, unknown>>(
  input: T,
  writable: Set<string> | null,
): Partial<T> {
  if (!writable) return input;
  const out: Partial<T> = {};
  for (const k of Object.keys(input)) {
    if (writable.has(k)) out[k as keyof T] = input[k as keyof T];
  }
  return out;
}

/**
 * Select-set for the edit-LOAD fetch: the column names to read back for an existing row.
 * We read only columns the Patch input can WRITE (so they round-trip on save) PLUS the primary
 * key column(s) (always needed to identify the row, even if the PK is not user-writable). This
 * mirrors `filterToWritable` on the way in. Generic; pure.
 * - `writable === null` → introspection unavailable; load all `allFieldNames` (legacy fallback).
 */
export function loadSelectionFields(
  allFieldNames: string[],
  writable: Set<string> | null,
  pkFieldNames: string[] = [],
): string[] {
  if (!writable) return allFieldNames;
  const keep = new Set<string>(pkFieldNames);
  for (const n of allFieldNames) if (writable.has(n)) keep.add(n);
  // preserve the table's field order for a stable, readable query
  return allFieldNames.filter((n) => keep.has(n));
}

/** camelCase → "Title Case" label */
export function toLabel(fieldName: string): string {
  return fieldName.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}
