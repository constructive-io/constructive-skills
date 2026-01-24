# pgsql-seed

PostgreSQL seeding utilities for CSV, JSON, SQL data loading, and pgpm deployment.

## When to Apply

Use this skill when:
- Loading test data from CSV, JSON, or SQL files
- Seeding databases programmatically in tests or scripts
- Deploying pgpm packages from code
- Exporting table data to CSV

## Installation

```bash
npm install pgsql-seed
```

## CSV Loading (COPY Protocol)

Load data efficiently using PostgreSQL's COPY protocol:

```typescript
import { Client } from 'pg';
import { loadCsv, loadCsvMap, exportCsv } from 'pgsql-seed';

const client = new Client();
await client.connect();

// Load a single CSV file
await loadCsv(client, 'users', './data/users.csv');

// Load multiple CSV files
await loadCsvMap(client, {
  'users': './data/users.csv',
  'orders': './data/orders.csv'
});

// Export a table to CSV
await exportCsv(client, 'users', './backup/users.csv');
```

CSV headers must match column names exactly. COPY bypasses RLS.

## JSON Insertion

Insert rows from in-memory objects:

```typescript
import { Client } from 'pg';
import { insertJson, insertJsonMap } from 'pgsql-seed';

const client = new Client();
await client.connect();

// Insert rows into a single table
await insertJson(client, 'users', [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
]);

// Insert rows into multiple tables
await insertJsonMap(client, {
  'users': [{ name: 'Alice', email: 'alice@example.com' }],
  'orders': [{ user_id: 1, total: 99.99 }]
});
```

Order matters for foreign keys — insert parent tables first.

## SQL File Execution

Execute SQL files or strings:

```typescript
import { Client } from 'pg';
import { loadSql, loadSqlFiles, execSql } from 'pgsql-seed';

const client = new Client();
await client.connect();

// Execute a single SQL file
await loadSql(client, './migrations/001-schema.sql');

// Execute multiple SQL files
await loadSqlFiles(client, [
  './migrations/001-schema.sql',
  './migrations/002-data.sql'
]);

// Execute a SQL string with parameters
await execSql(client, 'INSERT INTO users (name) VALUES ($1)', ['Alice']);
```

## pgpm Deployment

Deploy pgpm packages programmatically:

```typescript
import { deployPgpm, loadPgpm } from 'pgsql-seed';

const config = {
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'password'
};

// Deploy the pgpm package in the current directory
await deployPgpm(config);

// Deploy from a specific directory
await deployPgpm(config, '/path/to/package');

// With caching enabled (faster for repeated deployments)
await deployPgpm(config, undefined, true);
```

## Client Compatibility

All functions accept either a raw `pg.Client`/`pg.PoolClient` or any wrapper object that exposes a `.client` property. This makes it compatible with testing utilities like `PgTestClient`:

```typescript
// Works with raw pg.Client
const client = new Client();
await loadCsv(client, 'users', './data/users.csv');

// Works with wrappers that have a .client property
const testClient = new PgTestClient(config);
await loadCsv(testClient, 'users', './data/users.csv');
```

## API Reference

### CSV Functions

| Function | Description |
|----------|-------------|
| `loadCsv(client, table, path)` | Load single CSV file into table |
| `loadCsvMap(client, map)` | Load multiple CSV files (`{ table: path }`) |
| `exportCsv(client, table, path)` | Export table to CSV file |

### JSON Functions

| Function | Description |
|----------|-------------|
| `insertJson(client, table, rows)` | Insert array of objects into table |
| `insertJsonMap(client, map)` | Insert into multiple tables (`{ table: rows[] }`) |

### SQL Functions

| Function | Description |
|----------|-------------|
| `loadSql(client, path)` | Execute single SQL file |
| `loadSqlFiles(client, paths)` | Execute multiple SQL files in order |
| `execSql(client, sql, values?)` | Execute SQL string with optional parameters |

### pgpm Functions

| Function | Description |
|----------|-------------|
| `deployPgpm(config, cwd?, cache?)` | Deploy pgpm package to database |
| `loadPgpm(config, cwd?, cache?)` | Alias for deployPgpm |

## Best Practices

1. **Order by dependencies** — Load parent tables before child tables
2. **Use CSV for bulk data** — COPY is faster than INSERT for large datasets
3. **Use JSON for test fixtures** — Inline data is more readable in tests
4. **Enable caching for pgpm** — Speeds up repeated deployments in CI
5. **Use schema-qualified names** — `'app.users'` instead of just `'users'`

## References

- Related skill: `pgsql-test-seeding` for test-specific seeding patterns
- Related skill: `pgsql-test` for database testing framework
- [pgsql-seed on npm](https://www.npmjs.com/package/pgsql-seed)
