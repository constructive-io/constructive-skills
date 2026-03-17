# Testing Framework Details

Detailed API documentation for the higher-level testing frameworks in the Constructive stack.

For `pgsql-test` (SQL-level) documentation, see the **`pgsql-test` skill** — it covers `getConnections()`, `PgTestClient`, RLS testing, seeding, savepoints, snapshots, JWT context, and complex scenarios in full detail.

All frameworks below build on `pgsql-test` and return the same `pg`/`db` clients with the same lifecycle hooks.

---

## graphile-test (GraphQL Schema-Level)

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

## @constructive-io/graphql-test (Constructive Plugins)

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

## @constructive-io/graphql-server-test (HTTP-Level)

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
