---
name: constructive-testing
description: Testing best practices and framework selection for Constructive projects — choosing the right test framework (pgsql-test, graphile-test, graphql-test, server-test), avoiding anti-patterns like manual pg.Pool creation, and writing idiomatic integration tests. Use when asked to "write tests", "test GraphQL", "test database", "test API", "set up test framework", "choose testing approach", or when reviewing test code for best practices.
compatibility: Node.js 18+, Jest/Vitest, PostgreSQL, pgsql-test
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Testing Best Practices

Constructive provides a layered testing framework stack. Each layer builds on `pgsql-test` and provides progressively higher-level abstractions. **Always use the appropriate framework** — never manually create PostgreSQL connections in tests.

## When to Apply

Use this skill when:
- Writing any test that needs a PostgreSQL connection
- Choosing which test framework to use for a given scenario
- Reviewing test code for anti-patterns
- Setting up test infrastructure for a new package
- Testing GraphQL queries, mutations, or subscriptions
- Testing RLS policies or database-level logic
- Testing HTTP endpoints with SuperTest

## The Testing Framework Hierarchy

Choose the **highest-level framework** that fits your test scenario:

```
┌─────────────────────────────────────────────────────┐
│  @constructive-io/graphql-server-test               │  HTTP-level
│  SuperTest against real Express + PostGraphile       │  (full stack)
├─────────────────────────────────────────────────────┤
│  @constructive-io/graphql-test                      │  GraphQL + Constructive
│  GraphQL queries with all Constructive plugins      │  plugins loaded
├─────────────────────────────────────────────────────┤
│  graphile-test                                      │  GraphQL schema-level
│  GraphQL queries against PostGraphile schema        │  (no HTTP)
├─────────────────────────────────────────────────────┤
│  pgsql-test                                         │  SQL-level
│  Raw SQL queries, RLS, seeding, snapshots           │  (database only)
└─────────────────────────────────────────────────────┘
```

### Decision Flowchart

1. **Testing raw SQL, RLS policies, or database functions?** → `pgsql-test`
2. **Testing PostGraphile schema generation or basic GraphQL queries?** → `graphile-test`
3. **Testing GraphQL with Constructive plugins (search, pgvector, postgis, settings)?** → `@constructive-io/graphql-test`
4. **Testing HTTP endpoints, auth headers, middleware, or full request/response cycle?** → `@constructive-io/graphql-server-test`

## Quick Start Patterns

### SQL-Level Testing (`pgsql-test`)

Best for: RLS policies, database functions, raw SQL operations.

> **See the `pgsql-test` skill for full documentation** — it covers `getConnections()`, `PgTestClient`, RLS testing, seeding (`loadJson`/`loadSql`/`loadCsv`), savepoints, snapshots, JWT context, and complex multi-client scenarios.

All higher-level frameworks below build on `pgsql-test` — they return the same `pg` and `db` clients with the same lifecycle hooks.

### GraphQL Schema Testing (`graphile-test`)

Best for: Testing PostGraphile schema generation, GraphQL queries without HTTP.

```typescript
import { getConnections, seed } from 'graphile-test';
import type { PgTestClient } from 'pgsql-test';

let pg: PgTestClient;
let db: PgTestClient;
let query: (q: string, vars?: any) => Promise<any>;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, db, query, teardown } = await getConnections({
    schemas: ['app_public'],
  }));
});

afterAll(async () => {
  await teardown();
});

beforeEach(async () => {
  await pg.beforeEach();
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
  await pg.afterEach();
});

it('returns users via GraphQL', async () => {
  await pg.loadJson({
    'app_public.users': [{ id: 'user-1', name: 'Alice' }]
  });

  const result = await query(`{ allUsers { nodes { id name } } }`);
  expect(result.data.allUsers.nodes).toHaveLength(1);
});
```

### GraphQL + Constructive Plugins (`@constructive-io/graphql-test`)

Best for: Testing with full Constructive graphile-settings plugins loaded.

```typescript
import { getConnections } from '@constructive-io/graphql-test';
import type { PgTestClient } from 'pgsql-test';

let pg: PgTestClient;
let db: PgTestClient;
let query: (q: string, vars?: any) => Promise<any>;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, db, query, teardown } = await getConnections({
    schemas: ['app_public'],
  }));
});

// ... same beforeEach/afterEach pattern

it('uses search plugin', async () => {
  const result = await query(`{
    searchUsers(query: "alice") { nodes { id } }
  }`);
  expect(result.data.searchUsers).toBeDefined();
});
```

### HTTP-Level Testing (`@constructive-io/graphql-server-test`)

Best for: Testing full HTTP request/response cycle, auth headers, middleware.

```typescript
import { getConnections } from '@constructive-io/graphql-server-test';

let db, server, query, request, teardown;

beforeAll(async () => {
  ({ db, server, query, request, teardown } = await getConnections({
    schemas: ['app_public'],
    authRole: 'anonymous',
  }));
});

afterAll(async () => {
  await teardown();
});

it('handles GraphQL over HTTP', async () => {
  const result = await query(`{ __typename }`);
  expect(result.data.__typename).toBe('Query');
});

it('supports custom headers via SuperTest', async () => {
  const res = await request
    .post('/graphql')
    .set('Authorization', 'Bearer test-token')
    .send({ query: '{ currentUser { id } }' });

  expect(res.status).toBe(200);
});
```

## Anti-Patterns (Summary)

These are the most common mistakes. See [references/anti-patterns.md](references/anti-patterns.md) for detailed examples and fixes.

1. **Manual `pg.Pool` / `pg.Client` creation** — always use `getConnections()` from the appropriate framework
2. **Using `pg-cache` in tests** — it's for production connection pooling, not test isolation
3. **Manual `CREATE DATABASE` / `DROP DATABASE`** — `getConnections()` handles this automatically
4. **Missing `beforeEach`/`afterEach` hooks** — without them, tests leak state to each other
5. **Using a lower-level framework than needed** — e.g., raw SQL queries when testing GraphQL behavior (use `graphile-test` instead)

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [references/framework-details.md](references/framework-details.md) | Detailed API for each testing framework | Understanding getConnections variants, query functions, teardown options |
| [references/anti-patterns.md](references/anti-patterns.md) | Comprehensive anti-pattern catalog | Reviewing test code, understanding why patterns are wrong |

## Cross-References

- **`pgsql-test` skill** — The primary reference for SQL-level testing. Covers `getConnections()`, `PgTestClient`, RLS testing, seeding, savepoints, snapshots, JWT context, helpers, and complex scenarios in detail. Start here if you're writing database-level tests.
- **`drizzle-orm-test` skill** — Drop-in replacement for `pgsql-test` that adds type-safe queries with Drizzle ORM
- **`supabase-test` skill** — Testing Supabase applications with ephemeral databases and multi-user simulation
- **`constructive-env` skill** — How test frameworks resolve database configuration via `getEnvOptions()`
- **`pgpm` skill** (`references/testing.md`) — PGPM test setup and seed adapters
