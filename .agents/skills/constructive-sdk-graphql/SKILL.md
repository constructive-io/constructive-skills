---
name: constructive-sdk-graphql
description: "Unified GraphQL skill for Constructive — code generation (React Query hooks, Prisma-like ORM, CLI, subscription hooks, query key factories), watch mode, runtime query generation, search (tsvector, BM25, trgm, pgvector, PostGIS, unified composite), pagination, and documentation/skills auto-generation. Use when asked to generate hooks, ORM, CLI, query data, add search, paginate results, use watch mode, subscription hooks, query key invalidation, or work with @constructive-io/graphql-codegen or @constructive-io/graphql-query."
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

`searchScore` is computed server-side — no need to select individual score fields. See [search-composite.md](./references/search-composite.md) for all strategies and combined patterns.

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

See [search-composite.md](./references/search-composite.md) for the decision matrix and combined query patterns.

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
| [search-composite.md](./references/search-composite.md) | Search overview, decision matrix, combined patterns | Choosing a strategy, combining algorithms, score fields |
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

## Subscription Hooks Codegen

Codegen generates per-table `useXxxSubscription` hooks and a shared `useConnectionState` hook for real-time data. Source: `graphql/codegen/src/core/codegen/subscriptions.ts`.

### Output Structure

```
subscriptions/
  useContactSubscription.ts   # Per-table subscription hook
  useConnectionState.ts        # Shared connection-state hook
```

### Generated Hook Shape

Each per-table hook wraps `getClient().subscribe()` with typed callbacks:

```typescript
import { useContactSubscription } from '@/generated/hooks/subscriptions';
import type { SubscriptionEvent, Unsubscribe } from '@/generated/orm/client';

// Subscribe to real-time changes on a table
useContactSubscription({
  onEvent: (event: SubscriptionEvent<Contact>) => {
    // event.event = 'INSERT' | 'UPDATE' | 'DELETE'
    // event.contact = typed row data
    // event.timestamp = server timestamp
  },
  onError: (error: Error) => { /* optional error handler */ },
  enabled: true,                // toggle subscription on/off
  invalidateQueries: true,      // auto-invalidate React Query cache on events
});
```

The `invalidateQueries` option integrates with the query-key factory — when a subscription event arrives, all queries for that table are automatically invalidated via `queryClient.invalidateQueries()`.

## Codegen Watch Mode

Live-reload codegen that polls a GraphQL endpoint for schema changes and regenerates the SDK automatically. Source: `graphql/codegen/src/core/watch/`.

### Usage

```bash
cnc codegen --watch                          # watch default target
cnc codegen --watch --target public          # watch a specific target
cnc codegen --watch --verbose                # verbose polling logs
```

### Architecture

```
WatchOrchestrator
  ├── SchemaPoller       — polls endpoint via introspection query
  ├── SchemaCache        — in-memory hash comparison (no file I/O)
  ├── debounce()         — coalesces rapid schema changes
  └── regenerate()       — re-runs the configured generator (ORM or hooks)
```

### Config Options (in `defineConfig`)

```typescript
{
  watch: {
    pollInterval: 5000,   // ms between introspection polls (default: 5000)
    debounce: 1000,        // ms debounce before regeneration (default: 1000)
    touchFile: null,       // optional file path to touch on schema change
    clearScreen: true,     // clear terminal on regeneration
  }
}
```

Events emitted: `poll-start`, `poll-success`, `poll-error`, `schema-changed`, `schema-unchanged`.

## Query Key Factory

Codegen generates hierarchical, scoped cache keys following the [lukemorales/query-key-factory](https://tanstack.com/query/docs/framework/react/community/lukemorales-query-key-factory) pattern. Source: `graphql/codegen/src/core/codegen/query-keys.ts`.

### Output Shape

```typescript
// Generated query-keys.ts
export const contactKeys = {
  all: ['contacts'] as const,
  byOrganization: (organizationId: string) =>
    ['contacts', { organizationId }] as const,
  scoped: (scope?: ContactScope) => {
    if (scope?.organizationId) return contactKeys.byOrganization(scope.organizationId);
    return contactKeys.all;
  },
} as const;
```

For entities with parent-child relationships (`EntityRelationship` config), the factory generates `byParent` accessors for each ancestor, creating a full hierarchy of scoped keys.

### Usage for Cache Invalidation

```typescript
import { contactKeys } from '@/generated/hooks/query-keys';

// Invalidate all contacts
queryClient.invalidateQueries({ queryKey: contactKeys.all });

// Invalidate contacts scoped to an organization
queryClient.invalidateQueries({
  queryKey: contactKeys.byOrganization('org-123'),
});
```

See [codegen-query-keys.md](./references/codegen-query-keys.md) for the full reference.

## Docs / Skills Auto-Generation

Codegen can emit agent skill markdown (SKILL.md format) and README documentation alongside the generated SDK. Source: `hooks-docs-generator.ts`, `target-docs-generator.ts`.

### Enabling

```typescript
await generate({
  // ...
  docs: true,           // enable all doc generation (readme + agents + skills)
  // or granular:
  docs: {
    readme: true,        // per-target README.md with setup + hook/ORM tables
    agents: true,        // AGENTS.md for AI coding assistants
    skills: true,        // SKILL.md in agentskills.io format
  },
});
```

### What Gets Generated

- **Target README** (`README.md`): Overview of table count, custom operations, available generators (ORM/hooks/CLI), setup snippets, and links to per-module docs.
- **Hooks README** (`hooks/README.md`): Full hook reference table (query/mutation hooks per table + custom operations) with usage examples.
- **Root README** (`README.md` at output root): Multi-target index linking each API target to its endpoint and docs.
- **SKILL.md**: Agent-consumable skill file with hook names, ORM patterns, and CLI commands.

## `cleanStaleTargets` in `generateMulti()`

When running multi-target codegen, stale output directories from previously configured targets can accumulate. The `cleanStaleTargets` option auto-removes them:

```typescript
await generateMulti({
  configs: [publicConfig, adminConfig],
  cleanStaleTargets: true,  // removes subdirs in output root that don't match any current target
});
```

This is a config-level option — not a CLI flag. It compares subdirectory names in the output root against the set of active target names and removes any that are no longer configured.

## Cross-References

- `constructive-sdk-ai` — [agentic-kit.md](../constructive-sdk-ai/references/agentic-kit.md): Multi-provider LLM abstraction for RAG generation step
- `constructive-sdk-ai` — [rag-pipeline.md](../constructive-sdk-ai/references/rag-pipeline.md): End-to-end RAG pipeline architecture
- `graphile-search` — Plugin architecture and adapter internals (team-level, not SDK consumers)
- `constructive-platform` — Platform core: server config, deployment, CNC CLI
- `pgpm` — Database migrations and module management
