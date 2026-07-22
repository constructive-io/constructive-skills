# Indexes

Indexes are declared through the SDK ORM against the metaschema; each
`db.index.create` compiles to a PostgreSQL `CREATE INDEX ...`. One entity —
`db.index` — covers every shape, from a plain single-column btree to a partial
expression index. All examples use the SDK ORM; never author raw SQL.

## `db.index.create` fields

| Field | Type | Generates |
|-------|------|-----------|
| `fieldIds` | `uuid[]` | Indexed columns, in array order |
| `includeFieldIds` | `uuid[]` | `INCLUDE (...)` covering columns |
| `isUnique` | `boolean` | `CREATE UNIQUE INDEX` |
| `accessMethod` | `string` | `USING <method>` (`btree`, `gin`, `gist`, `hash`, `hnsw`, `ivfflat`, `bm25`, ...) |
| `opClasses` | `string[]` | Per-column operator class, positionally aligned with `fieldIds` |
| `options` | `json` | `WITH ( ... )` storage/build parameters |
| `whereClause` | `json` | `WHERE <predicate>` — **partial index** |
| `indexParams` | `json` | Expression elements — **expression index** |
| `name` | `string` | Index name (auto-generated when omitted) |

`fieldIds` is optional: an expression-only index (see below) supplies its columns
through `indexParams` instead.

## Simple index

```typescript
await db.index.create({
  data: { databaseId, tableId, fieldIds: [emailFieldId] },
  select: { id: true },
}).execute();
// → CREATE INDEX ... ON t (email)
```

## Unique index

```typescript
await db.index.create({
  data: { databaseId, tableId, fieldIds: [emailFieldId], isUnique: true },
  select: { id: true },
}).execute();
// → CREATE UNIQUE INDEX ... ON t (email)
```

## INCLUDE (covering) columns

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [tenantIdFieldId],
    includeFieldIds: [nameFieldId, statusFieldId],
  },
  select: { id: true },
}).execute();
// → CREATE INDEX ... ON t (tenant_id) INCLUDE (name, status)
```

## Access method, operator class, WITH-options

`opClasses` aligns positionally with `fieldIds`; `options` become `WITH ( ... )`.

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [embeddingFieldId],
    accessMethod: 'hnsw',
    opClasses: ['vector_cosine_ops'],
    options: { m: 16, ef_construction: 64 },
  },
  select: { id: true },
}).execute();
// → CREATE INDEX ... ON t USING hnsw (embedding vector_cosine_ops)
//     WITH (m = 16, ef_construction = 64)
```

## Partial index (`whereClause`)

A partial index only indexes rows matching a predicate. `whereClause` accepts the
**triggerCondition DSL** — the same condition format used by JobTrigger conditions
and `AuthzComposite` — so no SQL text is written:

| Shape | Example |
|-------|---------|
| Leaf | `{ field: 'active', op: '=', value: true }` |
| Field-to-field | `{ field: 'starts_at', op: '<', ref: { field: 'ends_at' } }` |
| Combinator | `{ AND: [ ... ] }`, `{ OR: [ ... ] }`, `{ NOT: { ... } }` |

```typescript
// CREATE INDEX ON t (created_at) WHERE (active = true)
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [createdAtFieldId],
    whereClause: { field: 'active', op: '=', value: true },
  },
  select: { id: true },
}).execute();
```

Compound predicate:

```typescript
// ... WHERE (status = 'open' AND NOT is_archived)
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [assigneeIdFieldId],
    whereClause: {
      AND: [
        { field: 'status', op: '=', value: 'open' },
        { NOT: { field: 'is_archived', op: '=', value: true } },
      ],
    },
  },
  select: { id: true },
}).execute();
```

The condition tree is compiled to a validated predicate AST server-side — the same
path used by `field.generationExpression`, `field.defaultValue`, and check
constraint expressions. Columns referenced by the predicate are added to the
index's dependencies automatically.

## Expression index (`indexParams`)

To index a computed expression such as `lower(email)` rather than a bare column,
supply `indexParams` as an array of expression elements. Each element is
`{ expr: <FieldGeneration DSL> }` — the same expression DSL used by
`field.generationExpression`, `field.defaultValue`, and exclusion `elementExpr`
(`{ function, args }`, `{ column }`, `{ operator, left, right }`, `{ cast }`, ... —
see [field-types.md](./field-types.md)), so no hand-shaped AST is needed. The
normalized elements are validated server-side via the platform's index AST
validation (`'index'` level) before the index is built, and referenced columns are
folded into the index name and dependencies.

```typescript
// CREATE INDEX ON t ((lower(email)))
await db.index.create({
  data: {
    databaseId,
    tableId,
    indexParams: [
      { expr: { function: 'lower', args: [{ column: 'email' }] } },
    ],
  },
  select: { id: true },
}).execute();
```

Column entries (`fieldIds`) and expression entries (`indexParams`) can be combined
in one index; column parts index first, followed by the expression elements:

```typescript
// CREATE INDEX ON t (tenant_id, (lower(email)))
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [tenantIdFieldId],
    indexParams: [
      { expr: { function: 'lower', args: [{ column: 'email' }] } },
    ],
  },
  select: { id: true },
}).execute();
```

> **Explicit raw-AST escape.** For an expression the FieldGeneration DSL can't
> represent, wrap a raw (server-sanitized) pgsql-parser AST node as
> `{ expr: { expression: <ast> } }`. A bare AST object with no DSL keys is
> **rejected** — the `expression` key is the only raw-AST entry point. Prefer the
> DSL; reach for the escape only when necessary rather than dropping to raw SQL.

## Combining a predicate with an expression

`whereClause` and `indexParams` compose — a partial expression index:

```typescript
// CREATE INDEX ON t ((lower(email))) WHERE (active = true)
await db.index.create({
  data: {
    databaseId,
    tableId,
    indexParams: [
      { expr: { function: 'lower', args: [{ column: 'email' }] } },
    ],
    whereClause: { field: 'active', op: '=', value: true },
  },
  select: { id: true },
}).execute();
```

## Notes

- `whereClause` and `indexParams` both default to `null`; omitting them leaves the
  simple/advanced index behavior (INCLUDE, opclass, access method, WITH-options,
  unique) exactly as before.
- The generated index name draws on indexed columns *and* columns referenced inside
  expression elements, so an expression-only index still gets a stable auto-name.
  Predicate-only columns (from `whereClause`) are excluded from the name, matching
  PostgreSQL.
- Not yet exposed via the SDK: an ergonomic builder for expression ASTs (see the
  escape-hatch note above). Flag it as an SDK gap rather than authoring raw SQL.
