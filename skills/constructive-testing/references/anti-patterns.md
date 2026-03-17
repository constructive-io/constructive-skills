# Testing Anti-Patterns

Comprehensive catalog of testing anti-patterns found in the Constructive codebase, with explanations and correct alternatives.

## Anti-Pattern 1: Manual pg.Pool / pg.Client Creation

### The Problem

```typescript
// @ts-nocheck
const pg = require('pg');

const getDbString = (db) =>
  `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${db}`;

let pgPool;
beforeAll(() => {
  pgPool = new pg.Pool({
    connectionString: getDbString('postgres')
  });
});
afterAll(() => {
  pgPool.end();
});
```

### Why It's Wrong

1. **No test isolation**: Tests share the same database and can leak state between each other
2. **No automatic cleanup**: If a test fails, the database isn't cleaned up
3. **Fragile connection strings**: Manually constructing URLs misses default handling and config file resolution
4. **No RLS support**: Can't use `setContext()` for role-based testing
5. **No seeding utilities**: Can't use `loadJson()`, `loadSql()`, `loadCsv()`
6. **No savepoint management**: Can't use `beforeEach()`/`afterEach()` for transaction isolation
7. **Environment-dependent**: Requires specific env vars to be set, instead of using the unified env config system
8. **`@ts-nocheck`**: Often accompanies manual connections because the types don't work well

### The Fix

```typescript
import { getConnections, PgTestClient } from 'pgsql-test';

let pg: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, teardown } = await getConnections({
    db: { extensions: [] }
  }));
});

afterAll(async () => {
  await teardown();
});

beforeEach(async () => {
  await pg.beforeEach();
});

afterEach(async () => {
  await pg.afterEach();
});
```

## Anti-Pattern 2: Using pg-cache in Tests

### The Problem

```typescript
import { Pool } from 'pg';
import { getPgPool, teardownPgPools } from 'pg-cache';
import { getPgEnvOptions } from 'pg-env';

const config = getPgEnvOptions({ database: 'postgres' });
const adminPool = getPgPool(config);

// Manually create database
await adminPool.query(`CREATE DATABASE "${testDbName}"`);
// ... run tests ...
// Manually drop database
await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
```

### Why It's Wrong

1. **pg-cache is for production**: It's an LRU connection pool cache for server runtime, not for tests
2. **Manual database lifecycle**: Creating/dropping databases manually is error-prone
3. **No test isolation primitives**: No savepoints, no per-test rollback
4. **Complex cleanup**: Must manually tear down pools and drop databases, easy to leak

### The Fix

```typescript
import { getConnections } from 'pgsql-test';

// pgsql-test handles ALL of this: create DB, install extensions, seed, teardown
const { pg, db, teardown } = await getConnections();
```

### Exception

The only valid use of `getPgPool()` in tests is **when testing pg-cache itself** (e.g., `pg-cache/src/__tests__/lru.test.ts`). Infrastructure packages can test their own internals.

## Anti-Pattern 3: Missing beforeEach/afterEach Hooks

### The Problem

```typescript
let pg, db, teardown;
beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
});

afterAll(async () => {
  await teardown();
});

// NO beforeEach/afterEach!

it('creates a user', async () => {
  await pg.query("INSERT INTO users (name) VALUES ('Alice')");
  // ...
});

it('checks user count', async () => {
  // Alice from previous test is still here!
  const result = await pg.query('SELECT count(*) FROM users');
  expect(result.rows[0].count).toBe('0'); // FAILS!
});
```

### Why It's Wrong

Without `beforeEach()`/`afterEach()`, each test's data persists into subsequent tests. Test order becomes significant, tests become brittle, and failures are hard to diagnose.

### The Fix

```typescript
beforeEach(async () => {
  await pg.beforeEach();
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
  await pg.afterEach();
});
```

This creates savepoints before each test and rolls back after, giving each test a clean slate.

## Anti-Pattern 4: Using graphile-test When server-test is Needed

### The Problem

```typescript
import { getConnections } from 'graphile-test';

// Testing authentication headers — but graphile-test has no HTTP layer!
const { query } = await getConnections({ schemas: ['app_public'] });

// Can't test this:
// - Auth header parsing
// - CORS middleware
// - Cookie handling
// - HTTP status codes
```

### The Fix

Use `@constructive-io/graphql-server-test` when you need HTTP-level testing:

```typescript
import { getConnections } from '@constructive-io/graphql-server-test';

const { request, teardown } = await getConnections({
  schemas: ['app_public'],
  authRole: 'anonymous',
});

const res = await request
  .post('/graphql')
  .set('Authorization', 'Bearer token')
  .send({ query: '{ currentUser { id } }' });

expect(res.status).toBe(200);
```

## Anti-Pattern 5: Using pgsql-test When graphile-test is Available

### The Problem

```typescript
import { getConnections } from 'pgsql-test';

const { pg } = await getConnections();

// Manually executing GraphQL by calling PostGraphile functions directly
// This is fragile and doesn't test the actual schema
```

### The Fix

If you're testing GraphQL behavior, use graphile-test or higher:

```typescript
import { getConnections } from 'graphile-test';

const { query } = await getConnections({ schemas: ['app_public'] });
const result = await query(`{ allUsers { nodes { id name } } }`);
```

## Summary: When to Use What

| Scenario | Framework | Import |
|----------|-----------|--------|
| RLS policies, SQL functions, raw queries | `pgsql-test` | `import { getConnections } from 'pgsql-test'` |
| PostGraphile schema, basic GraphQL | `graphile-test` | `import { getConnections } from 'graphile-test'` |
| GraphQL with Constructive plugins | `@constructive-io/graphql-test` | `import { getConnections } from '@constructive-io/graphql-test'` |
| HTTP endpoints, auth, middleware | `@constructive-io/graphql-server-test` | `import { getConnections } from '@constructive-io/graphql-server-test'` |
| Testing pg-cache itself | `pg-cache` (exception) | Only for pg-cache's own tests |
| Everything else | **Never** `new pg.Pool()` | Use the frameworks above |
