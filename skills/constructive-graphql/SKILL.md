---
name: constructive-graphql
description: Comprehensive skill for the Constructive GraphQL layer. Covers code generation (ORM, React Query hooks, CLI), querying via the generated TypeScript SDK (pagination, search, relations, filtering, error handling), and all search strategies (tsvector, BM25, trigram, pgvector, PostGIS, unified searchScore). Use when generating a GraphQL SDK, querying data through the codegen'd client, adding search to tables, or working with pagination/cursors.
compatibility: Node.js 22+, PostgreSQL 14+, PostGraphile v5+, @constructive-io/graphql-codegen
metadata:
  author: constructive-io
  version: "5.0.0"
---

# Constructive GraphQL

Design your database, run codegen, query with a fully typed TypeScript SDK.

## When to Apply

Use this skill when:
- Setting up GraphQL code generation (hooks, ORM, CLI, docs)
- Querying or mutating data via the generated ORM or React Query hooks
- Adding search to tables (full-text, BM25, fuzzy, vector, spatial)
- Working with pagination, cursors, or infinite scroll
- Handling errors, relations, or cache invalidation
- Exporting GraphQL schemas

**Important**: Always prefer generated code over raw GraphQL queries or SQL.

## The Flow

```
1. Design your database
   (tables, fields, indexes, relations, search columns via @constructive-io/sdk)
        |
2. Run codegen
   cnc codegen --orm --react-query
        |
3. Query with your typed SDK
   db.user.findMany({ select, where, orderBy, first, after }).execute()
```

## Quick Start

### Install

```bash
pnpm add @constructive-io/graphql-codegen
```

### Generate

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
});
```

### ORM Client

```typescript
import { createClient } from '@/generated/orm';

const db = createClient({
  endpoint: process.env.GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${token}` },
});

// Query with full type safety
const users = await db.user.findMany({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
  orderBy: ['CREATED_AT_DESC'],
  first: 20,
}).execute().unwrap();
```

### React Query Hooks

```typescript
import { configure, useUsersQuery } from '@/generated/hooks';

configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${token}` },
});

function UserList() {
  const { data, isLoading } = useUsersQuery({ first: 10 });
  if (isLoading) return <Spinner />;
  return <ul>{data?.users?.nodes.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### Search

```typescript
const result = await db.article.findMany({
  where: { fullTextSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  select: { title: true, searchScore: true },
}).execute();
```

### Pagination

```typescript
// Offset-based
const page1 = await db.user.findMany({
  select: { id: true, name: true },
  first: 20,
  offset: 0,
}).execute();

// Cursor-based
const page2 = await db.user.findMany({
  select: { id: true, name: true },
  first: 20,
  after: page1.users.pageInfo.endCursor,
}).execute();
```

## Filter Syntax

```typescript
// Comparison
where: { age: { equalTo: 25 } }
where: { age: { greaterThanOrEqualTo: 18, lessThan: 65 } }
where: { status: { in: ['ACTIVE', 'PENDING'] } }

// String
where: { name: { includes: 'john' } }
where: { email: { endsWith: '.com' } }

// Logical
where: {
  or: [
    { role: { equalTo: 'ADMIN' } },
    { role: { equalTo: 'MODERATOR' } },
  ],
}
```

## Error Handling

```typescript
const result = await db.user.findOne({
  id: '123',
  select: { id: true, name: true },
}).execute();

if (result.ok) {
  console.log(result.value.name);
} else {
  console.error(result.error.message);
}

// Or throw on error
const user = await db.user.findOne({ id, select: { id: true, name: true } }).execute().unwrap();

// Or provide a default
const user = await db.user.findOne({ id, select: { id: true, name: true } }).execute().unwrapOr(defaultUser);
```

## Search Strategy Overview

| Strategy | Best For | Score Direction |
|----------|----------|-----------------|
| **TSVector** | Keyword search with stemming ("running" matches "run") | Higher = better |
| **BM25** | Best relevance ranking for document search | More negative = better (sort ASC) |
| **Trigram** | Fuzzy matching, typo tolerance, fast ILIKE | 0..1, higher = more similar |
| **pgvector** | Semantic/embedding similarity, RAG | Lower distance = closer (sort ASC) |
| **PostGIS** | Location-based queries, geofencing, proximity | Depends on operator |

### Search Decision Matrix

| Need | Use |
|------|-----|
| Keyword search with stemming | TSVector |
| Best relevance ranking for documents | BM25 |
| Semantic similarity, embeddings, RAG | pgvector |
| Typo tolerance, fuzzy matching | Trigram |
| Fast `ILIKE` / prefix autocomplete | Trigram (GIN index) |
| Location-based proximity ("within 5km") | PostGIS |
| Multi-signal ranking (keyword + fuzzy + semantic) | Unified `searchScore` + `fullTextSearch` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No hooks generated | Add `reactQuery: true` to codegen options |
| No ORM generated | Add `orm: true` to codegen options |
| Schema not accessible | Verify endpoint URL and auth headers |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match |
| Auth errors at runtime | Check `configure()` / `createClient()` headers |
| Localhost fetch errors (Node.js) | Enable `nodeHttpAdapter: true` |
| Search fields not showing | Ensure `graphile-search` (`UnifiedSearchPreset`) is in PostGraphile preset |
| `searchScore` returns null | No search filter is active in the query — add a search `where` clause |
| `fullTextSearch` returns no results | Ensure table has tsvector, BM25, or trgm indexes |

---

## Reference Index

### Codegen Setup
- **`codegen.md`** -- Programmatic API, schema sources, multi-target, documentation generation
- **`codegen-options.md`** -- Full `GenerateOptions` interface reference
- **`config-reference.md`** -- `defineConfig` configuration file reference
- **`generate-schemas.md`** -- Export GraphQL schemas to `.graphql` files
- **`generate-sdk.md`** -- Generate React Query hooks and/or ORM client
- **`generate-cli.md`** -- Generate inquirerer-based CLI with CRUD commands
- **`generate-node.md`** -- Generate NodeHttpAdapter for `*.localhost` subdomain routing

### Using Generated Code
- **`orm-patterns.md`** -- ORM client setup, query patterns, relations, caching, repository pattern
- **`orm-output.md`** -- Generated ORM code structure and types
- **`hooks-patterns.md`** -- React Query hooks setup, dependent queries, infinite scroll, optimistic updates
- **`hooks-output.md`** -- Generated hooks code structure and types
- **`query-keys.md`** -- Query key factory, cache invalidation, pagination keys

### Common Patterns
- **`pagination.md`** -- Connection pattern, offset vs cursor pagination, pageInfo, infinite scroll
- **`relations.md`** -- Querying relations (belongsTo, hasMany, nested selects)
- **`error-handling.md`** -- Result pattern, unwrap, unwrapOr, error types

### Search
- **`search.md`** -- Search overview, all strategies, unified system, decision matrix
- **`search-tsvector.md`** -- Full-text search with tsvector + GIN indexes
- **`search-bm25.md`** -- BM25 ranked search
- **`search-trgm.md`** -- Trigram fuzzy matching (pg_trgm + GIN)
- **`search-pgvector.md`** -- Vector similarity search (pgvector + HNSW)
- **`search-postgis.md`** -- Spatial/geospatial search (PostGIS)
- **`search-composite.md`** -- Combined multi-algorithm search patterns, score field reference

### Advanced
- **`node-http-adapter.md`** -- NodeHttpAdapter for `*.localhost` subdomain routing
- **`cli-reference.md`** -- CLI flags and options

## Related Skills

- `constructive-graphql-query` (constructive-skills) -- Runtime query generation (browser-safe, `@constructive-io/graphql-query`)
- `graphile-search` (constructive-skills) -- Graphile search plugin architecture and adapter internals
