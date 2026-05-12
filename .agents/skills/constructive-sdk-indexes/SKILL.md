---
name: constructive-sdk-indexes
description: Create and manage database indexes in Constructive using the type-safe SDK. Use when asked to "add an index", "create a unique index", "add a partial index", "improve query performance", or when working with metaschema_public.index operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Index Management

Create and manage database indexes in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Adding indexes to improve query performance
- Creating unique indexes to enforce uniqueness constraints
- Creating partial (filtered) indexes with `whereClause`
- Adding covering indexes with `includeFieldIds`
- Specifying non-default access methods (GIN, GiST, etc.)
- Working with the `metaschema_public.index` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Index Schema

The `metaschema_public.index` table stores index metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID (required) |
| `tableId` | uuid | Parent table ID (required) |
| `name` | text | Index name |
| `fieldIds` | uuid[] | Fields to index |
| `includeFieldIds` | uuid[] | Additional fields to include (covering index) |
| `accessMethod` | text | Index access method (btree, hash, gin, gist, bm25, hnsw, ivfflat, etc.) |
| `indexParams` | jsonb | Access method-specific parameters |
| `options` | jsonb | WITH clause parameters (e.g., `{"m": 16, "ef_construction": 64}` for HNSW) |
| `opClasses` | text[] | Operator classes per field (e.g., `["vector_cosine_ops"]` for pgvector) |
| `whereClause` | jsonb | Partial index filter expression (AST) |
| `isUnique` | boolean | Whether the index enforces uniqueness |
| `smartTags` | jsonb | PostGraphile smart tags |
| `category` | object_category | 'core', 'module', or 'app' |
| `module` | text | Module that created this index |
| `scope` | int | Membership scope |
| `tags` | citext[] | Searchable tags |

## SDK Client Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'https://api.constructive.io/graphql',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});
```

## Creating Indexes

### Basic Index

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_contacts_email',
    fieldIds: [emailFieldId],
  },
  select: {
    id: true,
    name: true,
  },
}).execute();

if (result.ok) {
  const idx = result.data.createIndex.index;
  console.log('Created index:', idx.name);
} else {
  console.error('Failed to create index:', result.errors);
}
```

### Unique Index

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_users_username_unique',
    fieldIds: [usernameFieldId],
    isUnique: true,
  },
  select: {
    id: true,
    name: true,
    isUnique: true,
  },
}).execute();
```

### Composite Index

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_orders_customer_date',
    fieldIds: [customerIdFieldId, orderDateFieldId],
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Covering Index (INCLUDE)

Add non-key columns to avoid table lookups:

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_orders_customer_include_total',
    fieldIds: [customerIdFieldId],
    includeFieldIds: [totalFieldId, statusFieldId],
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Partial Index (WHERE clause)

Index only rows matching a condition:

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_orders_active',
    fieldIds: [customerIdFieldId],
    whereClause: {
      A_Expr: {
        kind: 'AEXPR_OP',
        name: [{ String: { sval: '=' } }],
        lexpr: { ColumnRef: { fields: [{ String: { sval: 'status' } }] } },
        rexpr: { A_Const: { sval: { sval: 'active' } } },
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

This creates: `CREATE INDEX idx_orders_active ON orders (customer_id) WHERE status = 'active'`

### GIN Index (for JSONB or array columns)

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_products_metadata_gin',
    fieldIds: [metadataFieldId],
    accessMethod: 'gin',
  },
  select: {
    id: true,
    name: true,
    accessMethod: true,
  },
}).execute();
```

### GiST Index (for full-text search, geometric data)

```typescript
const result = await db.index.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'idx_documents_search_gist',
    fieldIds: [searchVectorFieldId],
    accessMethod: 'gist',
  },
  select: {
    id: true,
    name: true,
    accessMethod: true,
  },
}).execute();
```

> **Search indexes** (BM25, HNSW, IVFFlat, trigram): See [`constructive-sdk-search`](../constructive-sdk-search) for complete create + query patterns for each search type.

## Querying Indexes

### Find Indexes for a Table

```typescript
const result = await db.index.findMany({
  select: {
    id: true,
    name: true,
    fieldIds: true,
    isUnique: true,
    accessMethod: true,
  },
  where: {
    tableId: { equalTo: tableId },
  },
}).execute();

if (result.ok) {
  const indexes = result.data.indices.nodes;
  indexes.forEach(idx => {
    console.log(`${idx.name} (unique: ${idx.isUnique}, method: ${idx.accessMethod})`);
  });
}
```

### Find Unique Indexes

```typescript
const result = await db.index.findMany({
  select: {
    id: true,
    name: true,
    fieldIds: true,
  },
  where: {
    tableId: { equalTo: tableId },
    isUnique: { equalTo: true },
  },
}).execute();
```

### Get a Single Index

```typescript
const result = await db.index.findOne({
  id: indexId,
  select: {
    id: true,
    name: true,
    fieldIds: true,
    includeFieldIds: true,
    accessMethod: true,
    whereClause: true,
    isUnique: true,
  },
}).execute();
```

## Updating Indexes

```typescript
const result = await db.index.update({
  where: { id: indexId },
  data: {
    name: 'idx_renamed',
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

## Deleting Indexes

```typescript
const result = await db.index.delete({
  where: { id: indexId },
  select: {
    id: true,
    name: true,
  },
}).execute();

if (result.ok) {
  console.log('Deleted index:', result.data.deleteIndex.index.name);
}
```

## Access Methods Reference

| Method | Use Case |
|--------|----------|
| `btree` | Default. Equality and range queries (`=`, `<`, `>`, `BETWEEN`) |
| `hash` | Equality-only queries (`=`). Smaller than btree for this case |
| `gin` | JSONB containment (`@>`), array overlap (`&&`), full-text search, trigrams |
| `gist` | Geometric data, range types, full-text search, nearest-neighbor |
| `brin` | Very large tables with naturally ordered data (e.g., timestamps) |
| `bm25` | Relevance-ranked text search. See [`constructive-sdk-search`](../constructive-sdk-search) |
| `hnsw` | Fast approximate nearest-neighbor for pgvector. See [`constructive-sdk-search`](../constructive-sdk-search) |
| `ivfflat` | Lower-memory vector search. See [`constructive-sdk-search`](../constructive-sdk-search) |

## Common Patterns

### Unique Email per Organization

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId: contactsTableId,
    name: 'idx_contacts_org_email_unique',
    fieldIds: [orgIdFieldId, emailFieldId],
    isUnique: true,
  },
  select: { id: true },
}).execute();
```

### Soft-Delete Partial Index

Only index non-deleted rows:

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId,
    name: 'idx_active_records',
    fieldIds: [nameFieldId],
    whereClause: {
      NullTest: {
        arg: { ColumnRef: { fields: [{ String: { sval: 'deleted_at' } }] } },
        nulltesttype: 'IS_NULL',
      },
    },
  },
  select: { id: true },
}).execute();
```

## Best Practices

1. **Name indexes descriptively** - Use `idx_{table}_{fields}[_unique]` convention
2. **Index foreign keys** - Always index FK columns used in joins
3. **Use partial indexes for filtered queries** - Smaller index, better performance
4. **Use covering indexes for read-heavy queries** - Avoid table lookups with `includeFieldIds`
5. **Choose the right access method** - Default btree is correct for most cases; use GIN for JSONB/arrays
6. **Don't over-index** - Each index adds write overhead; only index columns used in WHERE/JOIN/ORDER BY
7. **For search indexes** - See [`constructive-sdk-search`](../constructive-sdk-search) for BM25, HNSW, IVFFlat, and trigram patterns

## Error Handling

```typescript
const result = await db.index.create({
  data: {
    databaseId,
    tableId,
    name: 'idx_duplicate',
    fieldIds: [fieldId],
  },
  select: { id: true },
}).execute();

if (!result.ok) {
  result.errors.forEach(error => {
    console.error(`Error: ${error.message}`);
    // "duplicate key value violates unique constraint"
  });
}
```

## References

- See [`constructive-sdk-search`](../constructive-sdk-search) for search indexes — full-text search (tsvector + GIN), BM25, pgvector, and trigram. For full-text search specifically, use `db.fullTextSearch.create()` rather than manually creating GIN/GiST indexes on tsvector columns.
- See [`constructive-sdk-fields`](../constructive-sdk-fields) for field (column) management via SDK
- See [`constructive-sdk-constraints`](../constructive-sdk-constraints) for check constraints and foreign keys
- See [`constructive-sdk-security`](../constructive-sdk-security) for RLS policies and grants
- See [`constructive-sdk`](../constructive-sdk) for full SDK lifecycle (sign-up, auth, database provisioning)
