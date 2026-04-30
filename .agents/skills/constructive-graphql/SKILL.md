---
name: constructive-graphql
description: "Unified GraphQL skill for Constructive — code generation (React Query hooks, Prisma-like ORM, CLI), runtime query generation, search (tsvector, BM25, trgm, pgvector, PostGIS, unified composite), pagination, and documentation generation. Use when asked to generate hooks, ORM, CLI, query data, add search, paginate results, or work with @constructive-io/graphql-codegen or @constructive-io/graphql-query."
compatibility: Node.js 22+, PostgreSQL 14+, PostGraphile v5+
metadata:
  author: constructive-io
  version: "5.0.0"
---

# Constructive GraphQL

The complete GraphQL layer for Constructive: design your database → run codegen → query via typed SDK. Covers code generation, runtime query building, search across all algorithms, pagination, and documentation generation.

## When to Apply

Use this skill when:
- **Code generation**: Generating React Query hooks, ORM client, CLI, or documentation from a GraphQL schema
- **Querying**: Using the generated ORM or hooks to fetch, mutate, paginate, or search data
- **Search**: Adding or querying any search strategy (tsvector, BM25, trgm, pgvector, PostGIS) or the unified `unifiedSearch`/`searchScore` system
- **Runtime queries**: Building GraphQL queries dynamically at runtime (browser-safe `graphql-query` package)
- **Schema export**: Exporting GraphQL SDL from a database or endpoint

## The Flow

```
1. Design DB  →  Use @constructive-io/sdk to create tables, fields, indexes, search columns
2. Codegen    →  cnc codegen --orm --react-query (generates typed TS client)
3. Query      →  Use generated ORM/hooks to fetch, mutate, search, paginate
```

## Quick Start: Codegen

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  schemaFile: './schemas/public.graphql',  // or: endpoint, db, pgpm module
  output: './src/generated',
  reactQuery: true,
  orm: true,
});
```

See [codegen.md](./references/codegen.md) for full setup, schema sources, and options.

## Quick Start: ORM Queries

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
```

> **Error handling:** `.execute()` returns a discriminated union — it does NOT throw.
> Chain `.execute().unwrap()` to get throw-on-error behavior. See [codegen-error-handling.md](./references/codegen-error-handling.md) for full patterns.

## Quick Start: Search

The simplest way to search — `unifiedSearch` fans a single string to all text-compatible algorithms automatically:

```typescript
const results = await db.article.findMany({
  where: { unifiedSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  select: { title: true, searchScore: true },
}).execute();
```

`searchScore` is computed server-side — no need to select individual score fields. See [search.md](./references/search.md) for all strategies and combined patterns.

## Quick Start: Pagination

```typescript
// Cursor-based (recommended)
const page1 = await db.user.findMany({
  first: 20,
  select: {
    id: true, name: true,
    __pageInfo: { hasNextPage: true, endCursor: true },
  },
}).execute().unwrap();

// Next page
const page2 = await db.user.findMany({
  first: 20,
  after: page1.__pageInfo.endCursor,
  select: { id: true, name: true },
}).execute().unwrap();
```

See [pagination.md](./references/pagination.md) for the full pagination reference — offset vs cursor, forward vs backward, nested relation paging, and usage across ORM, hooks, and runtime query builder.

## Quick Start: React Query Hooks

```typescript
import { configure, useUsersQuery, useCreateUserMutation } from '@/generated/hooks';

// Configure once at app startup
configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${getToken()}` },
});

// Query
function UserList() {
  const { data, isLoading } = useUsersQuery({ first: 10 });
  return <ul>{data?.users?.nodes.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

// Mutate
function CreateUser() {
  const create = useCreateUserMutation();
  return <button onClick={() => create.mutate({ input: { name: 'John' } })}>Create</button>;
}
```

See [codegen-hooks-patterns.md](./references/codegen-hooks-patterns.md) for advanced patterns.

## Search Strategy Overview

| Strategy | Best For | Score Direction |
|----------|----------|-----------------|
| **TSVector** | Keyword search with stemming | Higher = better |
| **BM25** | Best relevance ranking for documents | More negative = better (sort ASC) |
| **Trigram** | Fuzzy matching, typo tolerance | 0..1, higher = more similar |
| **pgvector** | Semantic/embedding similarity, RAG | Lower distance = closer (sort ASC) |
| **PostGIS** | Location queries, geofencing, proximity | Depends on operator |
| **Unified** | Multi-signal ranking via `unifiedSearch` + `searchScore` | Higher = more relevant (0..1) |

See [search.md](./references/search.md) for the decision matrix and combined query patterns.

## Reference Guide

### Code Generation

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [codegen.md](./references/codegen.md) | Full codegen setup, schema sources, API | Setting up code generation, choosing schema source |
| [codegen-config-reference.md](./references/codegen-config-reference.md) | `defineConfig` file reference | Using config files instead of programmatic API |
| [codegen-cli-reference.md](./references/codegen-cli-reference.md) | CLI flags and options | Running codegen from command line |
| [codegen-generate-schemas.md](./references/codegen-generate-schemas.md) | Schema export workflow | Exporting `.graphql` SDL files |
| [codegen-generate-sdk.md](./references/codegen-generate-sdk.md) | SDK generation workflow | Generating React Query hooks and/or ORM |
| [codegen-generate-cli.md](./references/codegen-generate-cli.md) | CLI generation workflow | Generating inquirerer-based CLI |

### Using Generated Code

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [codegen-orm-patterns.md](./references/codegen-orm-patterns.md) | ORM query patterns | Using `findMany`, `findOne`, `create`, `update`, `delete` |
| [pagination.md](./references/pagination.md) | Pagination reference | Offset vs cursor, forward/backward paging, infinite scroll, nested relation pagination |
| [codegen-orm-output.md](./references/codegen-orm-output.md) | ORM generated output structure | Understanding what codegen produces |
| [codegen-hooks-patterns.md](./references/codegen-hooks-patterns.md) | React Query hook patterns | Using generated hooks in React components |
| [codegen-hooks-output.md](./references/codegen-hooks-output.md) | Hooks generated output structure | Understanding hook file structure |
| [codegen-error-handling.md](./references/codegen-error-handling.md) | **Error handling patterns (read first!)** | `.unwrap()` vs `.execute()`, silent error trap, `QueryResult<T>` discriminated union |
| [codegen-relations.md](./references/codegen-relations.md) | Relation queries and M:N mutations | Nested selects, belongsTo, hasMany, manyToMany, composite PKs, `expose_in_api`, add/remove methods |
| [codegen-query-keys.md](./references/codegen-query-keys.md) | Query key factory | Cache invalidation, `invalidate.*`, `remove.*` |

### Search

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [search.md](./references/search.md) | Search overview, decision matrix, combined patterns | Choosing a strategy, combining algorithms, score fields |
| [search-tsvector.md](./references/search-tsvector.md) | TSVector full-text search | Creating tsvector columns, GIN indexes, querying |
| [search-bm25.md](./references/search-bm25.md) | BM25 ranked search | Creating BM25 indexes, querying with negative scores |
| [search-trigram.md](./references/search-trigram.md) | Trigram fuzzy matching | `similarTo`, `wordSimilarTo`, `@trgmSearch` smart tag |
| [search-pgvector.md](./references/search-pgvector.md) | pgvector similarity | Creating vector columns, HNSW indexes, distance metrics |
| [search-postgis.md](./references/search-postgis.md) | PostGIS spatial queries | Geometry columns, spatial filters, proximity |
| [search-composite.md](./references/search-composite.md) | Unified composite system | `unifiedSearch`, `searchScore`, combined multi-algorithm patterns |
| [search-rag.md](./references/search-rag.md) | RAG patterns with ORM | Vector search for RAG, multi-table retrieval, hybrid search, embedding ingestion |

### Runtime Query Generation

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [query-runtime.md](./references/query-runtime.md) | `@constructive-io/graphql-query` package | Runtime/browser-safe query generation, `_meta` introspection |
| [query-generators-api.md](./references/query-generators-api.md) | Generator API reference | `buildSelect`, `buildFindOne`, `buildCount`, mutations |
| [query-meta-introspection.md](./references/query-meta-introspection.md) | `_meta` endpoint reference | PostGraphile metadata introspection, `cleanTable()` adapter |

## Cross-References

- `constructive-ai` — [agentic-kit.md](../constructive-ai/references/agentic-kit.md): Multi-provider LLM abstraction for RAG generation step
- `constructive-ai` — [rag-pipeline.md](../constructive-ai/references/rag-pipeline.md): End-to-end RAG pipeline architecture
- `graphile-search` — Plugin architecture and adapter internals (team-level, not SDK consumers)
- `constructive` — Platform core: server config, deployment, CNC CLI
- `pgpm` — Database migrations and module management
