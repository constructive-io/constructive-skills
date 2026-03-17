# Testing Framework Details

Detailed API documentation for each testing framework in the Constructive stack.

## 1. pgsql-test (SQL-Level)

**Package**: `pgsql-test`
**Source**: `postgres/pgsql-test/`

### `getConnections(opts?, seedAdapters?)`

Creates an isolated test database and returns connection clients.

**Parameters:**
- `opts.pg` — Partial `PgConfig` overrides (host, port, user, database, etc.)
- `opts.db` — Partial `PgTestConnectionOptions` (extensions, prefix, template, rootDb, etc.)
- `seedAdapters` — Array of `SeedAdapter[]` (defaults to `[seed.pgpm()]`)

**Returns:**
```typescript
interface GetConnectionResult {
  pg: PgTestClient;         // Superuser client (bypasses RLS)
  db: PgTestClient;         // App-level client (enforces RLS)
  admin: DbAdmin;           // Database admin operations
  teardown: (opts?) => Promise<void>;  // Cleanup function
  manager: PgTestConnector; // Connection manager (pool access)
}
```

**Lifecycle:**
1. Creates a unique database with UUID-based name
2. Creates app-level user role
3. Installs extensions (from `opts.db.extensions` or defaults)
4. Runs seed adapters (default: pgpm seed)
5. Returns `pg` (superuser) and `db` (app-level) clients

**Teardown:**
```typescript
await teardown();                    // Default: drops database
await teardown({ keepDb: true });    // Keep database for debugging
```

### `PgTestClient` API

```typescript
// Transaction isolation
await client.beforeEach();   // Start savepoint
await client.afterEach();    // Rollback to savepoint

// Context management (for RLS)
client.setContext({ role: 'authenticated', 'jwt.claims.user_id': id });
client.clearContext();

// Queries
const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);

// Savepoint management (for expected failures)
await client.savepoint('name');
await client.rollback('name');

// Seeding
await client.loadJson({ 'schema.table': [{ col: 'val' }] });
await client.loadSql(['/path/to/seed.sql']);
await client.loadCsv({ 'schema.table': '/path/to/data.csv' });
```

### Pool Access (when needed)

If you genuinely need a raw `Pool` object (rare), get it from the manager:

```typescript
const { manager, pg } = await getConnections();
const pool = manager.getPool(pg.config);
```

This is still managed by pgsql-test and cleaned up on teardown.

---

## 2. graphile-test (GraphQL Schema-Level)

**Package**: `graphile-test`
**Source**: `graphile/graphile-test/`

Builds on `pgsql-test` — adds PostGraphile schema generation and GraphQL query execution.

### Connection Variants

| Function | Query Signature | Response |
|----------|----------------|----------|
| `getConnections()` | `query(q, vars?, commit?, reqOpts?)` | `{ data, errors }` |
| `getConnectionsUnwrapped()` | `query(q, vars?, commit?, reqOpts?)` | `data` (throws on errors) |
| `getConnectionsObject()` | `query({ query, variables, commit, reqOptions })` | `{ data, errors }` |
| `getConnectionsObjectUnwrapped()` | `query({ query, variables, commit, reqOptions })` | `data` (throws on errors) |
| `getConnectionsWithLogging()` | Same as `getConnections` | Logs queries + results |
| `getConnectionsWithTiming()` | Same as `getConnections` | Logs query duration |

### Input Options

```typescript
interface GetConnectionsInput {
  schemas: string[];              // Required: schemas to expose
  extends?: GraphileConfig.Preset[];  // Additional presets
  preset?: Partial<GraphileConfig.Preset>;  // Preset overrides
}
```

Combined with `GetConnectionOpts` from pgsql-test for database configuration.

### Usage

```typescript
import { getConnections } from 'graphile-test';

const { pg, db, query, teardown } = await getConnections({
  schemas: ['app_public'],
});

// Positional API
const result = await query(`{ allUsers { nodes { id } } }`);
const result = await query(gql`...`, { userId: '123' });
const result = await query(`mutation { ... }`, {}, true); // commit=true
```

### Object API

```typescript
import { getConnectionsObject } from 'graphile-test';

const { query } = await getConnectionsObject({ schemas: ['app_public'] });

const result = await query({
  query: `{ allUsers { nodes { id } } }`,
  variables: { first: 10 },
  commit: false,
  reqOptions: { role: 'admin' },
});
```

---

## 3. @constructive-io/graphql-test (Constructive Plugins)

**Package**: `@constructive-io/graphql-test`
**Source**: `graphql/test/`

Same API as `graphile-test` but loads all Constructive graphile-settings plugins (search, pgvector, postgis, upload, SQL validator, etc.).

### Difference from graphile-test

- **graphile-test**: Loads a minimal PostGraphile preset
- **@constructive-io/graphql-test**: Loads the full Constructive preset via `graphile-settings`

Use this when testing features that depend on Constructive-specific plugins.

### Additional Export

```typescript
import { GraphQLTestAdapter } from '@constructive-io/graphql-test';
```

`GraphQLTestAdapter` provides SDK integration for testing generated code against the test schema.

---

## 4. @constructive-io/graphql-server-test (HTTP-Level)

**Package**: `@constructive-io/graphql-server-test`
**Source**: `graphql/server-test/`

Full HTTP testing with a real Express + PostGraphile server via SuperTest.

### `getConnections(input, seedAdapters?)`

**Input:**
```typescript
interface GetConnectionsInput {
  schemas: string[];          // Schemas to expose
  authRole?: string;          // Default auth role (sets anonRole + roleName)
  server?: {
    host?: string;            // Default: '127.0.0.1'
    port?: number;            // Default: 0 (OS-assigned)
    api?: Partial<ApiOptions>;  // API configuration overrides
  };
  graphile?: GraphileOptions; // Graphile preset overrides
}
```

**Returns:**
```typescript
interface GetConnectionsResult {
  pg: PgTestClient;           // Superuser client
  db: PgTestClient;           // App-level client
  server: ServerInfo;         // Server info (url, port, httpServer)
  request: supertest.Agent;   // SuperTest agent
  query: GraphQLQueryFn;      // Convenience query function
  teardown: () => Promise<void>;  // Stops server + drops DB
}
```

### SuperTest Usage

```typescript
const { request, query, teardown } = await getConnections({
  schemas: ['app_public'],
  authRole: 'anonymous',
});

// Quick GraphQL query
const result = await query(`{ __typename }`);

// Full SuperTest control
const res = await request
  .post('/graphql')
  .set('Authorization', 'Bearer my-token')
  .set('Content-Type', 'application/json')
  .send({ query: '{ currentUser { id } }' });

expect(res.status).toBe(200);
expect(res.body.data.currentUser).toBeDefined();
```

### Server Info

```typescript
const { server } = await getConnections({ schemas: ['app_public'] });

console.log(server.url);        // http://127.0.0.1:54321
console.log(server.graphqlUrl); // http://127.0.0.1:54321/graphql
console.log(server.port);       // 54321
```

The server uses port 0 by default so the OS assigns an available port, avoiding conflicts in parallel test runs.
