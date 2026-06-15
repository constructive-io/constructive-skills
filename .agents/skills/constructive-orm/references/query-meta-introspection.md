# `_meta` Introspection Endpoint

Every Constructive PostGraphile API (using `graphile-settings` with `MetaSchemaPreset`) exposes a `_meta` root query field that provides runtime schema metadata. This is richer than standard GraphQL introspection — it includes PostgreSQL-specific information like `isNotNull`, `hasDefault`, FK constraints, indexes, server-side inflection names, storage buckets, search configuration, enum values, i18n configuration, and realtime subscription info.

## When to Use `_meta` vs Standard Introspection

| Feature | `_meta` | Standard Introspection |
|---|---|---|
| Field names and types | Yes | Yes |
| `isNotNull` / `hasDefault` | Yes (direct) | Inferred from `CreateInput` nullability |
| FK constraints with referenced table | Yes (direct) | Not available |
| PK / unique constraints | Yes (direct) | Not available |
| Server inflection names | Yes (direct) | Inferred from type/query names |
| Relation metadata (belongsTo, hasMany, manyToMany) | Yes (direct) | Must be reverse-engineered |
| Enum allowed values | Yes (direct) | Available via `__type` introspection |
| Storage bucket detection | Yes (direct) | Not available |
| Search algorithm configuration | Yes (direct) | Not available |
| i18n translatable fields | Yes (direct) | Not available |
| Realtime subscription field names | Yes (direct) | Not available |
| Works with any GraphQL endpoint | No (PostGraphile only) | Yes |

**Use `_meta`** when you need constraint information, relation metadata, enum values, feature detection, or richer field metadata at runtime (e.g., building dynamic forms or CRUD UIs).

**Use standard introspection** when working with non-PostGraphile endpoints or when constraint data isn't needed.

## Full `_meta` Query

```graphql
query GetMeta {
  _meta {
    tables {
      name
      schemaName
      fields {
        name
        isNotNull
        hasDefault
        isPrimaryKey
        isForeignKey
        description
        type {
          pgType
          gqlType
          isArray
          subtype
        }
        enumValues {
          name
          values
        }
      }
      inflection {
        tableType
        allRows
        conditionType
        connection
        edge
        createInputType
        createPayloadType
        deletePayloadType
        filterType
        orderByType
        patchType
        updatePayloadType
      }
      query {
        all
        one
        create
        update
        delete
      }
      indexes {
        name
        isUnique
        isPrimary
        columns
        fields { name }
      }
      constraints {
        primaryKey { name fields { name } }
        unique { name fields { name } }
        foreignKey {
          name
          referencedTable
          referencedFields
          fields { name }
          refFields { name }
        }
      }
      primaryKeyConstraints {
        name
        fields { name }
      }
      foreignKeyConstraints {
        name
        fields { name }
        referencedTable
        referencedFields
        refTable { name }
        refFields { name }
      }
      uniqueConstraints {
        name
        fields { name }
      }
      relations {
        belongsTo {
          fieldName
          isUnique
          type
          keys { name }
          references { name }
        }
        has {
          fieldName
          isUnique
          type
          keys { name }
          referencedBy { name }
        }
        hasOne {
          fieldName
          isUnique
          type
          keys { name }
          referencedBy { name }
        }
        hasMany {
          fieldName
          isUnique
          type
          keys { name }
          referencedBy { name }
        }
        manyToMany {
          fieldName
          type
          rightTable { name }
          junctionTable { name }
          leftKeyAttributes { name }
          rightKeyAttributes { name }
          junctionLeftConstraint {
            name
            referencedTable
            referencedFields
            fields { name }
            refFields { name }
          }
          junctionRightConstraint {
            name
            referencedTable
            referencedFields
            fields { name }
            refFields { name }
          }
          junctionLeftKeyAttributes { name }
          junctionRightKeyAttributes { name }
        }
      }
      storage {
        isFilesTable
        isBucketsTable
      }
      search {
        algorithms
        columns { name algorithm }
        hasUnifiedSearch
        config {
          weights
          boostRecent
          boostRecencyField
          boostRecencyDecay
        }
      }
      i18n {
        translationTable
        translatableFields { name type }
      }
      realtime {
        subscriptionFieldName
      }
    }
  }
}
```

## Response Structure

The `_meta` response follows these TypeScript types:

```ts
interface MetaQuery {
  _meta?: {
    tables?: MetaTable[];
  };
}

interface MetaTable {
  name: string;
  schemaName: string;
  query: {
    all: string;          // e.g. "contacts" — the root query field for listing
    one?: string | null;  // e.g. "contact" — single-row lookup (see caveat below)
    create?: string;      // e.g. "createContact"
    update?: string;      // e.g. "updateContact"
    delete?: string;      // e.g. "deleteContact"
  };
  fields: MetaField[];
  inflection: MetaInflection;
  indexes: MetaIndex[];
  constraints: MetaConstraints;
  primaryKeyConstraints: MetaPrimaryKeyConstraint[];
  foreignKeyConstraints: MetaForeignKeyConstraint[];
  uniqueConstraints: MetaUniqueConstraint[];
  relations: MetaRelations;
  storage: MetaStorage | null;
  search: MetaSearch | null;
  i18n: MetaI18n | null;
  realtime: MetaRealtime | null;
}

interface MetaField {
  name: string;              // camelCase inflected field name
  isNotNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  description: string | null;
  type: {
    pgType: string;          // e.g. "uuid", "text", "int4", "timestamptz"
    gqlType: string;         // e.g. "UUID", "String", "Int", "Datetime"
    isArray: boolean;
    subtype?: string | null;
  };
  enumValues: MetaEnum | null;
}

interface MetaEnum {
  name: string;              // PostgreSQL enum type name (e.g. "status_enum")
  values: string[];          // Allowed values (e.g. ["active", "inactive", "pending"])
}

interface MetaInflection {
  tableType: string;         // e.g. "Contact"
  allRows: string;           // e.g. "contacts"
  conditionType: string;     // e.g. "ContactCondition"
  connection: string;        // e.g. "ContactsConnection"
  edge: string;              // e.g. "ContactsEdge"
  createInputType: string;   // e.g. "CreateContactInput"
  createPayloadType: string;
  deletePayloadType: string;
  filterType: string | null; // e.g. "ContactFilter"
  orderByType: string;       // e.g. "ContactsOrderBy"
  patchType: string | null;  // e.g. "ContactPatch"
  updatePayloadType: string | null;
}

interface MetaIndex {
  name: string;
  isUnique: boolean;
  isPrimary: boolean;
  columns: string[];
  fields: { name: string }[];
}

interface MetaConstraints {
  primaryKey: { name: string; fields: { name: string }[] } | null;
  unique: { name: string; fields: { name: string }[] }[];
  foreignKey: MetaForeignKeyConstraint[];
}

interface MetaForeignKeyConstraint {
  name: string;
  fields: { name: string }[];
  referencedTable: string;
  referencedFields: string[];
  refTable: { name: string };
  refFields: { name: string }[];
}

interface MetaPrimaryKeyConstraint {
  name: string;
  fields: { name: string }[];
}

interface MetaUniqueConstraint {
  name: string;
  fields: { name: string }[];
}

interface MetaRelations {
  belongsTo: MetaBelongsToRelation[];
  has: MetaHasRelation[];
  hasOne: MetaHasRelation[];
  hasMany: MetaHasRelation[];
  manyToMany: MetaManyToManyRelation[];
}

interface MetaBelongsToRelation {
  fieldName: string | null;
  isUnique: boolean;
  type: string | null;
  keys: { name: string }[];
  references: { name: string };
}

interface MetaHasRelation {
  fieldName: string | null;
  isUnique: boolean;
  type: string | null;
  keys: { name: string }[];
  referencedBy: { name: string };
}

interface MetaManyToManyRelation {
  fieldName: string | null;
  type: string | null;
  junctionTable: { name: string };
  junctionLeftConstraint: MetaForeignKeyConstraint;
  junctionLeftKeyAttributes: { name: string }[];
  junctionRightConstraint: MetaForeignKeyConstraint;
  junctionRightKeyAttributes: { name: string }[];
  leftKeyAttributes: { name: string }[];
  rightKeyAttributes: { name: string }[];
  rightTable: { name: string };
}
```

## Feature Metadata

### Storage (`storage`)

Identifies tables that are part of the Constructive storage system:

```ts
interface MetaStorage {
  isFilesTable: boolean;     // Table tagged with @storageFiles
  isBucketsTable: boolean;   // Table tagged with @storageBuckets
}
```

Returns `null` for tables without storage tags. When `isFilesTable: true`, the table manages uploaded files; use this to render file-picker UIs or show upload controls.

### Search (`search`)

Exposes which search algorithms are active on a table:

```ts
interface MetaSearch {
  algorithms: string[];      // e.g. ["bm25", "tsvector", "vector"]
  columns: { name: string; algorithm: string }[];  // Per-column search config
  hasUnifiedSearch: boolean; // Whether unifiedSearch composite filter is available
  config: MetaSearchConfig | null;
}

interface MetaSearchConfig {
  weights: string | null;    // JSON-encoded per-adapter weights
  boostRecent: boolean;      // Whether recency boosting is enabled
  boostRecencyField: string | null;
  boostRecencyDecay: number | null;
}
```

Returns `null` for tables without search. Use this to:
- Auto-render search bars with appropriate UX (fuzzy vs semantic toggle)
- Know which columns support which algorithm
- Determine if unified search is available for composite queries

### Enum Values (`enumValues` on fields)

Exposes PostgreSQL enum types and their allowed values per field:

```ts
interface MetaEnum {
  name: string;     // e.g. "status_enum"
  values: string[]; // e.g. ["active", "inactive", "pending"]
}
```

Returns `null` for non-enum fields. Detects:
- Direct enum types
- Domain-wrapped enums (domain → inner enum)
- Array-of-enum types

Use this to auto-generate `<select>` dropdowns or radio groups without hardcoding allowed values.

### i18n (`i18n`)

Identifies tables with internationalization via the `@i18n` smart tag:

```ts
interface MetaI18n {
  translationTable: string;             // e.g. "post_translations"
  translatableFields: MetaI18nField[];  // Fields that have translation overlays
}

interface MetaI18nField {
  name: string;   // GraphQL field name (e.g. "title")
  type: string;   // PostgreSQL type ("text" or "citext")
}
```

Returns `null` for non-i18n tables. Use this to:
- Auto-render language switchers in edit forms
- Show "translatable" badges on fields
- Build bulk translation workflows knowing which fields need localization

### Realtime (`realtime`)

Identifies tables with real-time subscription support via the `@realtime` smart tag:

```ts
interface MetaRealtime {
  subscriptionFieldName: string;  // e.g. "onPostChanged"
}
```

Returns `null` for non-realtime tables. Use this to:
- Auto-subscribe to changes without hardcoding subscription field names
- Show "live" indicators on tables/views that support real-time updates
- Build generic subscription wrappers that work with any realtime table

## The `cleanTable()` Adapter

The Dashboard uses a `cleanTable()` function to convert `_meta` response objects into `CleanTable` format — the canonical type used by all `graphql-query` generators.

```ts
import { cleanTable } from '@your-app/data';
import type { CleanTable } from '@constructive-io/graphql-query/types/schema';

// Fetch _meta
const { data } = await fetchGraphQL(META_QUERY);

// Convert each table from _meta format to CleanTable format
const tables: CleanTable[] = data._meta.tables.map(cleanTable);

// Now use with any generator
const query = buildSelect(tables[0], tables);
```

### What `cleanTable()` does

1. **Converts field names** from PostgreSQL `snake_case` to `camelCase` (e.g., `created_at` → `createdAt`)
2. **Normalizes nullability** — extracts `isNotNull` and `hasDefault` from either the field or its type (v4 vs v5 compat)
3. **Maps inflection** from `MetaInflection` to `TableInflection`
4. **Maps query names** from `MetaQuery` to `TableQueryNames`
5. **Flattens relations** into `belongsTo`, `hasOne`, `hasMany`, `manyToMany` arrays with normalized key references

## `_meta` Platform Caveats

### `query.one` may reference a non-existent root field

`_meta.query.one` returns the singular name (e.g., `"contact"`) but some Constructive configurations only expose plural queries (e.g., `contacts`). Using `query.one` as the root field may fail.

**Workaround — use `query.all` with a condition:**

```ts
function buildFetchById(table: MetaTable): string {
  const fieldNames = table.fields.map(f => f.name).join(' ');
  // Always use query.all + condition, NOT query.one
  return `
    query FetchById($id: UUID!) {
      ${table.query.all}(condition: { id: $id }) {
        nodes { ${fieldNames} }
      }
    }
  `;
}
const record = data[table.query.all].nodes[0];
```

### Authentication required

`_meta` requires an authenticated request. Unauthenticated requests return empty tables.

### Schema stability

`_meta` metadata is stable for the lifetime of a deployment — schema changes require a server restart. Cache with `staleTime: Infinity` in React Query:

```ts
useQuery({ queryKey: ['_meta'], queryFn: fetchMeta, staleTime: Infinity });
```

## Enabling `_meta` on Your Server

`_meta` is enabled by including `MetaSchemaPreset` in your PostGraphile configuration. The standard `ConstructivePreset` from `graphile-settings` includes it by default:

```ts
import { ConstructivePreset } from 'graphile-settings';

const preset = {
  extends: [ConstructivePreset],  // includes MetaSchemaPreset
  pgServices: [/* ... */],
};
```

Or include it individually:

```ts
import { MetaSchemaPreset } from 'graphile-settings';

const preset = {
  extends: [MetaSchemaPreset, /* other presets */],
  pgServices: [/* ... */],
};
```

## Smart Tag Detection

The `_meta` plugin detects features via PostGraphile smart tags on table codecs:

| Feature | Smart Tag | Value | Detection |
|---------|-----------|-------|-----------|
| Storage (files) | `@storageFiles` | `true` | Table-level tag |
| Storage (buckets) | `@storageBuckets` | `true` | Table-level tag |
| Search (tsvector) | — | — | Column type `tsvector` |
| Search (BM25) | `@bm25Index` | `true` | Column-level tag |
| Search (trigram) | `@trgmSearch` | `true` | Table/column-level tag |
| Search (vector) | — | — | Column type `vector` |
| Search config | `@searchConfig` | JSON | Table-level tag |
| Enum values | — | — | Field codec type with `values` property |
| i18n | `@i18n` | `<translation_table>` | Table-level tag |
| Realtime | `@realtime` | `true` | Table-level tag |
