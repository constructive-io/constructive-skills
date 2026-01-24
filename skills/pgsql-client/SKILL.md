# pgsql-client

PostgreSQL client utilities with query helpers, RLS context management, database administration, and ephemeral database support.

## When to Apply

Use this skill when:
- Creating temporary databases for testing or code generation
- Managing database administration tasks (create, drop, templates, extensions)
- Working with RLS context in queries
- Streaming SQL to databases

## Installation

```bash
npm install pgsql-client
```

## Ephemeral Databases

Create temporary databases with unique UUID-based names for testing, code generation, or CI pipelines:

```typescript
import { createEphemeralDb } from 'pgsql-client';
import { Pool } from 'pg';

// Create a temporary database
const { name, config, admin, teardown } = createEphemeralDb();

// Use the database
const pool = new Pool(config);
await pool.query('SELECT 1');
await pool.end();

// Clean up when done
teardown();

// Or keep for debugging
teardown({ keepDb: true });
```

### Configuration Options

```typescript
const { config, teardown } = createEphemeralDb({
  prefix: 'test_',           // Database name prefix (default: 'ephemeral_')
  extensions: ['uuid-ossp'], // PostgreSQL extensions to install
  baseConfig: {              // Override connection settings
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'password'
  },
  verbose: true              // Enable logging
});
```

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Generated database name (e.g., `ephemeral_a1b2c3d4_...`) |
| `config` | `PgConfig` | Full PostgreSQL configuration for connecting |
| `admin` | `DbAdmin` | DbAdmin instance for additional operations |
| `teardown` | `function` | Function to drop the database |

### Use Cases

Ephemeral databases are useful for:
- **Code generation**: Generate types from a temporary schema
- **Integration tests**: Isolated database per test suite
- **CI pipelines**: Clean database state for each run
- **Local development**: Experiment without affecting shared databases

### Example: Code Generation Workflow

```typescript
import { createEphemeralDb } from 'pgsql-client';
import { deployPgpm } from 'pgsql-seed';
import { generate } from '@constructive-io/graphql-codegen';

// Create ephemeral database
const { config, teardown } = createEphemeralDb({
  prefix: 'codegen_',
  extensions: ['uuid-ossp', 'pgcrypto']
});

try {
  // Deploy schema
  await deployPgpm(config, './packages/my-module');

  // Generate types
  await generate({
    db: { schemas: ['public', 'app_public'] },
    output: './generated',
    orm: true
  });
} finally {
  // Always clean up
  teardown();
}
```

## DbAdmin

Database administration operations:

```typescript
import { DbAdmin } from 'pgsql-client';

const admin = new DbAdmin({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'mydb'
});

// Create a database
admin.create('mydb');

// Install extensions
admin.installExtensions(['uuid-ossp', 'pgcrypto'], 'mydb');

// Create from template (faster for repeated setups)
admin.createFromTemplate('template_db', 'test_db');

// Drop a database
admin.drop('mydb');
```

### DbAdmin Methods

| Method | Description |
|--------|-------------|
| `create(dbName?)` | Create a database |
| `drop(dbName?)` | Drop a database |
| `createFromTemplate(template, dbName?)` | Create database from template |
| `installExtensions(extensions, dbName?)` | Install PostgreSQL extensions |
| `connectionString(dbName?)` | Generate connection string |
| `createTemplateFromBase(base, template)` | Create template database |
| `cleanupTemplate(template)` | Clean up template database |
| `grantRole(role, user, dbName?)` | Grant role to user |
| `grantConnect(role, dbName?)` | Grant connect privilege |
| `createUserRole(user, password, dbName)` | Create user with roles |
| `loadSql(file, dbName)` | Load SQL file |
| `streamSql(sql, dbName)` | Stream SQL to database |

## PgClient

Query helpers with RLS context management:

```typescript
import { PgClient } from 'pgsql-client';

const client = new PgClient({
  host: 'localhost',
  port: 5432,
  user: 'app_user',
  password: 'password',
  database: 'mydb'
});

// Query helpers
const users = await client.any('SELECT * FROM users');
const user = await client.one('SELECT * FROM users WHERE id = $1', [userId]);
const maybeUser = await client.oneOrNone('SELECT * FROM users WHERE email = $1', [email]);

// Set RLS context
client.setContext({ role: 'authenticated', 'jwt.claims.user_id': userId });

// Or use the auth helper
client.auth({ role: 'authenticated', userId: userId });

// Close the connection
await client.close();
```

### PgClient Methods

| Method | Description |
|--------|-------------|
| `query(sql, values?)` | Execute query with context |
| `any(sql, values?)` | Return all rows |
| `one(sql, values?)` | Return exactly one row (throws if not exactly one) |
| `oneOrNone(sql, values?)` | Return one row or null |
| `many(sql, values?)` | Return many rows (throws if none) |
| `manyOrNone(sql, values?)` | Return rows or empty array |
| `none(sql, values?)` | Execute without returning rows |
| `result(sql, values?)` | Return full QueryResult |
| `begin()` | Begin transaction |
| `commit()` | Commit transaction |
| `savepoint(name?)` | Create savepoint |
| `rollback(name?)` | Rollback to savepoint |
| `setContext(ctx)` | Set session context variables |
| `auth(options?)` | Set authentication context |
| `clearContext()` | Clear context and reset to anonymous |
| `close()` | Close connection |

## Role Utilities

Map role names for anonymous, authenticated, and administrator roles:

```typescript
import { getRoleName, ROLES } from 'pgsql-client';

const anonRole = getRoleName('anonymous');     // 'anonymous'
const authRole = getRoleName('authenticated'); // 'authenticated'
const adminRole = getRoleName('administrator'); // 'administrator'
```

## Best Practices

1. **Use ephemeral databases for isolation** — Each test suite or CI run gets a clean database
2. **Always call teardown** — Use try/finally to ensure cleanup
3. **Use templates for speed** — Create a template once, then clone for each test
4. **Set context for RLS testing** — Use `setContext()` to simulate different users
5. **Use query helpers** — `one()`, `any()`, etc. provide better error messages than raw `query()`

## References

- Related skill: `pgsql-test` for database testing framework
- Related skill: `pgsql-seed` for data loading utilities
- Related skill: `graphql-codegen` for type generation from schemas
- [pgsql-client on npm](https://www.npmjs.com/package/pgsql-client)
