---
name: constructive-graphql-query
description: Use @constructive-io/graphql-query to generate GraphQL queries and mutations at runtime from PostGraphile schema metadata. Covers the _meta introspection endpoint, the cleanTable() adapter, and the full generator API (buildSelect, buildFindOne, buildCount, mutations). Use when building dynamic data layers, runtime query generation, or browser-based GraphQL against a Constructive PostGraphile backend.
compatibility: Browser + Node.js, PostGraphile v5+, graphql-query 3.3+
metadata:
  author: constructive-io
  version: "1.0.0"
---

# @constructive-io/graphql-query

Browser-safe runtime GraphQL query generation for PostGraphile schemas. Generate type-safe queries, mutations, and introspection pipelines at runtime or build time.

## When to Apply

Use this skill when:
- Generating GraphQL queries/mutations dynamically at runtime (e.g., in the browser)
- Working with PostGraphile's `_meta` introspection endpoint
- Building a dynamic data layer where the schema is not known ahead of time
- Using the Dashboard's spreadsheet/data features
- Replacing hand-written GraphQL with generated queries
- Needing browser-safe query generation (no Node.js APIs)

**Important**: For build-time code generation (writing `.ts` files to disk, generating React Query hooks, ORM, CLI), use the `constructive-graphql` skill instead. This package (`graphql-query`) is the **core** that `graphql-codegen` depends on.

---

## 1. Two Introspection Paths

There are two ways to get schema metadata into `CleanTable[]` — the format all generators require.

### Path A: Standard GraphQL Introspection (recommended for new code)

```ts
import {
  inferTablesFromIntrospection,
  SCHEMA_INTROSPECTION_QUERY,
} from '@constructive-io/graphql-query';

const response = await fetch('/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SCHEMA_INTROSPECTION_QUERY }),
});
const { data } = await response.json();
const tables = inferTablesFromIntrospection(data);
```

Works with **any** GraphQL endpoint. No PostGraphile-specific features required.

### Path B: PostGraphile `_meta` Endpoint

Every Constructive `app-public` GraphQL API exposes a `_meta` query (via `MetaSchemaPreset` in `graphile-settings`). It returns richer metadata than standard introspection — including `isNotNull`, `hasDefault`, FK constraints, indexes, and server-side inflection names.

```ts
import { cleanTable } from '@your-app/data'; // Dashboard adapter

const META_QUERY = `query {
  _meta {
    tables {
      name
      schemaName
      fields { name isNotNull hasDefault type { pgType gqlType isArray } }
      inflection { tableType allRows createInputType patchType filterType orderByType }
      query { all one create update delete }
      primaryKeyConstraints { name fields { name } }
      foreignKeyConstraints { name fields { name } referencedTable referencedFields }
      uniqueConstraints { name fields { name } }
      relations {
        belongsTo { fieldName isUnique type keys { name } references { name } }
        hasMany { fieldName isUnique type keys { name } referencedBy { name } }
        manyToMany { fieldName type rightTable { name } junctionTable { name } }
      }
    }
  }
}`;

const res = await fetch('/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: META_QUERY }),
});
const { data } = await res.json();
const tables = data._meta.tables.map(cleanTable); // → CleanTable[]
```

See `references/meta-introspection.md` for full `_meta` response types and the `cleanTable()` adapter.

---

## 2. Generate Queries

All generators take a `CleanTable` and return a `TypedDocumentString` — call `.toString()` or pass directly to a GraphQL client.

### SELECT (paginated list)

```ts
import { buildSelect } from '@constructive-io/graphql-query';

const userTable = tables.find(t => t.name === 'User')!;
const query = buildSelect(userTable, tables);
```

Generates:
```graphql
query getUsersQuery(
  $first: Int, $last: Int, $after: Cursor, $before: Cursor,
  $offset: Int, $condition: UserCondition,
  $filter: UserFilter, $orderBy: [UsersOrderBy!]
) {
  users(first: $first, last: $last, offset: $offset,
        after: $after, before: $before,
        condition: $condition, filter: $filter, orderBy: $orderBy) {
    totalCount
    pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
    nodes { id name email createdAt }
  }
}
```

### FindOne (by primary key)

```ts
import { buildFindOne } from '@constructive-io/graphql-query';
const query = buildFindOne(userTable);
```

Generates:
```graphql
query getUserQuery($id: UUID!) {
  user(id: $id) { id name email createdAt }
}
```

### Count

```ts
import { buildCount } from '@constructive-io/graphql-query';
const query = buildCount(userTable);
```

Generates:
```graphql
query getUsersCountQuery($condition: UserCondition, $filter: UserFilter) {
  users(condition: $condition, filter: $filter) { totalCount }
}
```

### Mutations (Create / Update / Delete)

```ts
import {
  buildPostGraphileCreate,
  buildPostGraphileUpdate,
  buildPostGraphileDelete,
} from '@constructive-io/graphql-query';

const createQuery = buildPostGraphileCreate(userTable, tables);
const updateQuery = buildPostGraphileUpdate(userTable, tables);
const deleteQuery = buildPostGraphileDelete(userTable, tables);
```

See `references/generators-api.md` for full options and generated output for each mutation type.

---

## 3. Field Selection

Control which fields and relations are included:

```ts
// Presets
buildSelect(table, tables, { fieldSelection: 'minimal' }); // id + display fields
buildSelect(table, tables, { fieldSelection: 'all' });     // all scalar fields
buildSelect(table, tables, { fieldSelection: 'full' });    // scalars + relations

// Custom
buildSelect(table, tables, {
  fieldSelection: {
    select: ['id', 'name', 'email'],
    exclude: ['internalNotes'],
    include: {
      posts: ['id', 'title'],       // hasMany → wrapped in nodes { ... }
      organization: true,           // belongsTo → direct nesting
    },
  },
});
```

HasMany relations are automatically wrapped in the PostGraphile Connection pattern (`nodes { ... }` with a default `first: 20` limit). BelongsTo relations are nested directly.

---

## 4. Relation Field Mapping (Aliases)

Remap field names when server names differ from consumer expectations:

```ts
const query = buildSelect(userTable, tables, {
  relationFieldMap: {
    contact: 'contactByOwnerId',   // emits: contact: contactByOwnerId { ... }
    internalNotes: null,           // omit this relation
  },
});
```

---

## 5. Server-Aware Naming

All generators automatically prefer server-inferred names from `table.query` and `table.inflection`, falling back to local inflection:

```ts
import {
  toCamelCasePlural,
  toCreateMutationName,
  toPatchFieldName,
  toFilterTypeName,
} from '@constructive-io/graphql-query';

toCamelCasePlural('DeliveryZone', table);    // "deliveryZones" (from table.query.all)
toCreateMutationName('User', table);         // "createUser" (from table.query.create)
toPatchFieldName('User', table);             // "userPatch" (entity-specific, not generic "patch")
toFilterTypeName('User', table);             // "UserFilter" (from table.inflection.filterType)
```

---

## 6. Subpath Imports (Browser Safety)

The main entry point includes Node.js-only dependencies (PostGraphile, grafast). For browser usage, **always use subpath imports**:

```ts
// Browser-safe subpath imports
import { buildSelect, buildFindOne } from '@constructive-io/graphql-query/generators';
import { TypedDocumentString } from '@constructive-io/graphql-query/client';
import { getAll, getOne, createOne } from '@constructive-io/graphql-query/ast';
import type { CleanTable, CleanField } from '@constructive-io/graphql-query/types/schema';
import type { QueryOptions } from '@constructive-io/graphql-query/types/query';

// Do NOT use in browser:
// import { buildSelect } from '@constructive-io/graphql-query';  // pulls in Node.js deps
```

Available subpaths: `/generators`, `/client`, `/ast`, `/custom-ast`, `/types/schema`, `/types/query`, `/types/mutation`, `/types/selection`, `/types/core`, `/query-builder`, `/meta-object/convert`, `/meta-object/validate`.

---

## 7. Package Relationship

```
@constructive-io/graphql-query  ← this package (browser-safe core)
        |
        v
@constructive-io/graphql-codegen  (Node.js CLI, depends on graphql-query)
  + CLI entry points
  + File output (writes .ts files to disk)
  + React Query hook generation
  + Database introspection
  + Watch mode
```

| Scenario | Package |
|---|---|
| Runtime query generation in browser | `graphql-query` (subpath imports) |
| Runtime query generation in Node.js | `graphql-query` (main or subpath) |
| Build-time codegen (hooks, ORM, CLI) | `graphql-codegen` (uses `graphql-query` internally) |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Bundle error: `fs`, `pg`, `postgraphile` not found | Use subpath imports (see section 6) |
| Empty `CleanTable.fields` | Check that introspection response includes field data |
| Wrong mutation/query names | Ensure `table.query` and `table.inflection` are populated |
| `_meta` returns empty tables | Check auth headers — `_meta` requires authentication |
| `query.one` returns non-existent root field | Known issue — use `query.all` with `condition: { id: $id }` instead |

## References

- **`references/meta-introspection.md`** — Full `_meta` query structure, response types, `cleanTable()` adapter, and platform caveats
- **`references/generators-api.md`** — Complete API reference for all generators, options, and generated output examples
