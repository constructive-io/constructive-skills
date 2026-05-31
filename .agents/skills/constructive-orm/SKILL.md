---
name: constructive-orm
description: "Generated ORM — query patterns, mutations, relations, pagination, _meta introspection, runtime query building, and query keys. Use when asked to 'query data', 'ORM patterns', 'findMany', 'findOne', 'create', 'update', 'delete', 'paginate', 'cursor pagination', 'offset pagination', '_meta', 'runtime query', 'query builder', or when using the generated @constructive-io/sdk ORM client."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive ORM

The generated Prisma-like ORM client for Constructive — typed queries, mutations, relations, pagination, and runtime query building.

## When to Apply

Use this skill when:
- Querying data with the generated ORM (`db.user.findMany`, `db.user.create`, etc.)
- Implementing pagination (cursor-based or offset)
- Using `_meta` introspection for dynamic UI generation
- Building runtime queries programmatically
- Understanding query key patterns for cache management

## Quick Start

```typescript
import { createClient } from '@/generated/orm';

const db = createClient({
  endpoint: process.env.GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${token}` },
});

// Find many with filters
const users = await db.user.findMany({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
  first: 10,
}).execute().unwrap();

// Find one
const user = await db.user.findOne({ id: '123' }).execute().unwrap();

// Create
const newUser = await db.user.create({
  input: { name: 'John', email: 'john@example.com' },
}).execute().unwrap();

// Update
await db.user.update({
  where: { id: '123' },
  data: { name: 'Jane' },
  select: { id: true },
}).execute();

// Delete
await db.user.delete({ where: { id: '123' } }).execute();
```

## Error Handling

`.execute()` returns a discriminated union — it does NOT throw. Chain `.execute().unwrap()` for throw-on-error behavior.

## Pagination

### Cursor-Based (Recommended)

```typescript
const page1 = await db.user.findMany({
  first: 20,
  select: {
    id: true, name: true,
    __pageInfo: { hasNextPage: true, endCursor: true },
  },
}).execute().unwrap();

const page2 = await db.user.findMany({
  first: 20,
  after: page1.__pageInfo.endCursor,
  select: { id: true, name: true },
}).execute().unwrap();
```

### Offset-Based

```typescript
const page = await db.user.findMany({
  first: 20,
  offset: 40,
  select: { id: true, name: true, __totalCount: true },
}).execute().unwrap();
```

See [pagination.md](./references/pagination.md) for the full pagination reference.

## `_meta` Introspection

Query table metadata at runtime for dynamic form generation:

```typescript
const meta = await db._meta.table('users').execute();
// Returns: fields, types, constraints, relations, policies
```

See [query-meta-introspection.md](./references/query-meta-introspection.md) for the full _meta reference.

## Runtime Query Builder

Build GraphQL queries programmatically (browser-safe):

```typescript
import { buildQuery } from '@constructive-io/graphql-query';

const query = buildQuery('users', {
  select: { id: true, name: true },
  where: { role: { equalTo: 'ADMIN' } },
  first: 10,
});
```

See [query-runtime.md](./references/query-runtime.md) for the runtime query API.

## References

| File | Content |
|------|---------|
| [codegen-orm-output.md](./references/codegen-orm-output.md) | Generated ORM API reference |
| [codegen-orm-patterns.md](./references/codegen-orm-patterns.md) | Advanced ORM usage patterns |
| [pagination.md](./references/pagination.md) | Cursor vs offset, nested paging |
| [query-generators-api.md](./references/query-generators-api.md) | Query generator API reference |
| [query-runtime.md](./references/query-runtime.md) | Runtime query building |
| [query-meta-introspection.md](./references/query-meta-introspection.md) | _meta introspection reference |
| [codegen-query-keys.md](./references/codegen-query-keys.md) | Query key patterns for caching |

## Cross-References

- **Code generation pipeline:** [`constructive-codegen`](../constructive-codegen/SKILL.md)
- **React Query hooks:** [`constructive-hooks`](../constructive-hooks/SKILL.md)
- **Search queries:** [`constructive-search`](../constructive-search/SKILL.md)
- **Data modeling:** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
