# `_meta` Introspection Endpoint

Every Constructive PostGraphile API (using `graphile-settings` with `MetaSchemaPreset`) exposes a `_meta` root query field that provides runtime schema metadata. This is richer than standard GraphQL introspection — it includes PostgreSQL-specific information like `isNotNull`, `hasDefault`, FK constraints, indexes, and server-side inflection names.

## When to Use `_meta` vs Standard Introspection

| Feature | `_meta` | Standard Introspection |
|---|---|---|
| Field names and types | Yes | Yes |
| `isNotNull` / `hasDefault` | Yes (direct) | Inferred from `CreateInput` nullability |
| FK constraints with referenced table | Yes (direct) | Not available |
| PK / unique constraints | Yes (direct) | Not available |
| Server inflection names | Yes (direct) | Inferred from type/query names |
| Relation metadata (belongsTo, hasMany, manyToMany) | Yes (direct) | Must be reverse-engineered |
| Works with any GraphQL endpoint | No (PostGraphile only) | Yes |

**Use `_meta`** when you need constraint information, relation metadata, or richer field metadata at runtime (e.g., building dynamic forms or CRUD UIs).

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
        type {
          pgType
          gqlType
          isArray
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
        fields { name }
      }
      primaryKeyConstraints {
        name
        fields { name }
      }
      foreignKeyConstraints {
        name
        fields { name }
        refTable { name }
        refFields { name }
      }
      uniqueConstraints {
        name
        fields { name }
      }
      checkConstraints {
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
        hasMany {
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
        manyToMany {
          fieldName
          type
          rightTable { name }
          junctionTable { name }
          leftKeyAttributes { name }
          rightKeyAttributes { name }
          junctionLeftKeyFields { name }
          junctionRightKeyFields { name }
        }
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
    tables?: MetaschemaTable[];
  };
}

interface MetaschemaTable {
  name: string;
  schemaName?: string;
  query: {
    all: string;          // e.g. "contacts" — the root query field for listing
    one?: string | null;  // e.g. "contact" — single-row lookup (see caveat below)
    create?: string;      // e.g. "createContact"
    update?: string;      // e.g. "updateContact"
    delete?: string;      // e.g. "deleteContact"
  };
  fields?: MetaschemaField[];
  inflection: MetaschemaTableInflection;
  indexes?: MetaschemaIndex[];
  primaryKeyConstraints?: MetaschemaPrimaryKeyConstraint[];
  foreignKeyConstraints?: MetaschemaForeignKeyConstraint[];
  uniqueConstraints?: MetaschemaUniqueConstraint[];
  checkConstraints?: MetaschemaCheckConstraint[];
  relations?: {
    belongsTo?: MetaschemaBelongsToRelation[];
    hasMany?: MetaschemaHasManyRelation[];
    hasOne?: MetaschemaHasOneRelation[];
    manyToMany?: MetaschemaManyToManyRelation[];
    // junctionLeftKeyFields and junctionRightKeyFields provide FK column
    // names on the junction table, enabling codegen to generate type-safe
    // add<Relation>()/remove<Relation>() methods with correct PK types.
  };
}

interface MetaschemaField {
  name: string;              // snake_case column name from PostgreSQL
  isNotNull?: boolean;       // NOT NULL constraint
  hasDefault?: boolean;      // has a DEFAULT value (auto-generated)
  type: {
    pgType: string;          // e.g. "uuid", "text", "int4", "timestamptz"
    gqlType: string;         // e.g. "UUID", "String", "Int", "Datetime"
    isArray: boolean;        // PostgreSQL array column
  };
}

interface MetaschemaTableInflection {
  tableType?: string;        // e.g. "Contact"
  allRows?: string;          // e.g. "contacts"
  conditionType?: string;    // e.g. "ContactCondition"
  connection?: string;       // e.g. "ContactsConnection"
  edge?: string;             // e.g. "ContactsEdge"
  createInputType?: string;  // e.g. "CreateContactInput"
  createPayloadType?: string;
  deletePayloadType?: string;
  filterType?: string;       // e.g. "ContactFilter"
  orderByType?: string;      // e.g. "ContactsOrderBy"
  patchType?: string;        // e.g. "ContactPatch"
  updatePayloadType?: string;
}
```

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
3. **Maps inflection** from `MetaschemaTableInflection` to `TableInflection`
4. **Maps query names** from `MetaschemaTableQuery` to `TableQueryNames`
5. **Flattens relations** into `belongsTo`, `hasOne`, `hasMany`, `manyToMany` arrays with normalized key references

### Dashboard `cleanTable()` Implementation

Located at `packages/data/src/data.types.ts`:

```ts
import type { CleanTable, TableInflection, TableQueryNames } from '@constructive-io/graphql-query/types/schema';

export function cleanTable(metaTable: MetaTable): CleanTable {
  return {
    name: metaTable.name,
    inflection: convertInflection(metaTable.inflection),
    query: convertQueryNames(metaTable.query),
    fields: (metaTable.fields || [])
      .filter(f => f != null)
      .map(field => ({
        name: pgFieldToCamelCase(field.name),  // snake_case → camelCase
        type: {
          gqlType: field.type.gqlType,
          isArray: field.type.isArray,
          pgType: field.type.pgType,
          // ...additional v4 fields (modifier, pgAlias, subtype, typmod)
        },
        isNotNull: field.isNotNull ?? field.type.isNotNull ?? null,
        hasDefault: field.hasDefault ?? field.type.hasDefault ?? null,
      })),
    relations: {
      belongsTo: /* ... map from _meta belongsTo relations ... */,
      hasOne:    /* ... map from _meta hasOne relations ... */,
      hasMany:   /* ... map from _meta hasMany relations ... */,
      manyToMany: /* ... map from _meta manyToMany relations ... */,
    },
  };
}
```

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
