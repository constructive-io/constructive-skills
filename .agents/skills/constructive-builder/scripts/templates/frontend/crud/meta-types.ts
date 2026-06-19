/**
 * meta-types.ts — TypeScript types for the Constructive `_meta` introspection.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: lifted VERBATIM from constructive-frontend/references/meta-forms.md §2.
 * scripts/scaffold-frontend.mjs stamps this to <app>/src/types/meta.ts
 * (or <app>/src/components/crud/types/meta.ts). No placeholders — pure types,
 * generic across any Constructive-provisioned table.
 * ──────────────────────────────────────────────────────────────────────────
 */
export type MetaField = {
  name: string;
  isNotNull: boolean;
  hasDefault: boolean;
  type: { pgType: string; gqlType: string; isArray: boolean };
};

export type MetaTable = {
  name: string;
  fields: MetaField[];
  inflection: {
    tableType: string;
    createInputType: string;
    patchType: string | null;
    filterType: string | null;
    orderByType: string;
  };
  query: {
    all: string;         // e.g. "contacts"
    one: string | null;  // ⚠️ may be a non-existent root field — see use-meta / dynamic-form-card bug note
    create: string | null;
    update: string | null;
    delete: string | null;
  };
  primaryKeyConstraints: Array<{ name: string; fields: { name: string }[] }>;
  foreignKeyConstraints: Array<{
    name: string;
    fields: { name: string }[];
    referencedTable: string;
    referencedFields: string[];
  }>;
  uniqueConstraints: Array<{ name: string; fields: { name: string }[] }>;
};
