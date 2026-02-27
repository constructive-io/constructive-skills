---
name: pgpm-export
description: "Export a live Constructive SDK database back into a pgpm workspace as two portable packages: the extension (SQL schema) and the service/meta package (metaschema records). Use when: (1) backing up a Constructive DB to source control, (2) migrating a Constructive DB to a new environment, (3) turning a provisioned SDK database into a versioned pgpm module. NOT for: initial provisioning (use constructive-sdk skill), code generation for frontend hooks (use constructive-graphql-codegen)."
---

# pgpm export — Export Constructive DB to pgpm Workspace

## What It Does

`pgpm export` reads a live Constructive database and writes **two pgpm packages** to your workspace:

| Package | CLI param | Contains | Required extensions |
|---|---|---|---|
| **Extension** (`extensionName`) | `--extensionName crm` | Raw SQL migrations — tables, RLS policies, functions, indexes | `plpgsql`, `uuid-ossp`, `citext`, `pgcrypto`, `metaschema-schema`, etc. |
| **Service/Meta** (`metaExtensionName`) | `--metaExtensionName crm-svc` | Metaschema records — database, table, field, policy, rls_module, apis, domains rows as SQL INSERTs | `plpgsql`, `metaschema-schema`, `metaschema-modules`, `services` |

Both outputs are full pgpm modules with `pgpm.plan`, `deploy/`, `revert/`, `verify/` directories. They can be deployed to any pgpm-managed Postgres instance to recreate the database from scratch.

---

## How It Works (Internals)

1. Connects to the host `postgres` DB → lists all non-template databases
2. Connects to the selected DB → queries `metaschema_public.database` for the database ID
3. Reads `db_migrate.sql_actions WHERE database_id = $1` — these are the raw SQL migrations
4. Applies a **schema name replacer** — renames internal schema names (e.g. `demo-crm-1772181642234-a8eba4e4-app-public`) to portable names (e.g. `crm_app_public`) using `extensionName` as the prefix
5. Writes extension package to `<outdir>/<extensionName>/`
6. Reads `metaschema_public.*` records (tables, fields, policies, modules...) via `export-meta`
7. Writes service package to `<serviceOutdir>/<metaExtensionName>/` (defaults to same as `outdir`)

---

## CLI Usage (Interactive TUI)

```bash
# Must run from workspace root (where pgpm.json lives)
cd ~/Constructive/teammate

# Ensure pgpm env is active
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/Cellar/libpq/18.2/bin:$PATH"
eval "$(pgpm env)"

pgpm export
```

**Prompts you through:**
1. Select Postgres database (e.g. `constructive`)
2. Select database_id (e.g. `demo-crm-1772181642234`)
3. Author (default: from git config)
4. Extension name (e.g. `crm`)
5. Meta extension name (e.g. `crm-svc`)
6. Schema names to include (checkbox, defaults to all)

**Output lands at:** `<workspacePath>/packages/<extensionName>/` and `<workspacePath>/packages/<metaExtensionName>/`

⚠️ The CLI hardcodes output to `workspace/packages/` — you cannot change the output directory via CLI flags. Use the programmatic API for custom paths (see below).

---

## Programmatic Usage (Non-Interactive + Custom Dirs)

Use this when you want non-interactive export, custom `outdir`/`serviceOutdir`, or to run from scripts.

```typescript
import { exportMigrations, PgpmPackage } from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { resolve } from 'path';

const workspaceRoot = '/path/to/your/workspace';
const project = new PgpmPackage(workspaceRoot);
project.ensureWorkspace();
project.resetCwd(project.workspacePath);

const options = getEnvOptions(); // reads PGHOST, PGPORT, PGUSER, PGPASSWORD from env

await exportMigrations({
  project,
  options,
  dbInfo: {
    dbname: 'constructive',              // host postgres DB
    databaseName: 'demo-crm-1772181642234', // human name
    database_ids: ['<uuid-from-metaschema_public.database>']
  },
  author: 'pyramation <dan@constructive.io>',
  schema_names: ['app_public', 'app_private', /* ...all schema names... */],
  extensionName: 'crm',
  metaExtensionName: 'crm-svc',
  // Both default to workspace/packages/ if omitted:
  outdir: resolve(workspaceRoot, 'packages'),
  serviceOutdir: resolve(workspaceRoot, 'packages'), // can differ from outdir!
  // Optional:
  repoName: 'constructive-apps',
  username: 'pyramation-studio',
  skipSchemaRenaming: false, // true = keep raw infra schema names (rarely needed)
});
```

### The `serviceOutdir` Option

`exportMigrationsToDisk` has a `serviceOutdir` parameter that lets you route the service/meta package to a **different directory** than the extension package:

```typescript
outdir: resolve(workspaceRoot, 'packages'),      // crm extension → packages/crm/
serviceOutdir: resolve(workspaceRoot, 'services'), // crm-svc → services/crm-svc/
```

This is useful when you want extensions and service configs in separate top-level directories.

---

## Getting the database_id

```bash
# Connect to the constructive DB and look up the database
psql constructive -c "SELECT id, name FROM metaschema_public.database;"

# Or use pgpm env first:
eval "$(pgpm env)"
psql $PGDATABASE -c "SELECT id, name FROM metaschema_public.database;"
```

## Getting schema_names

```bash
psql constructive -c "SELECT schema_name FROM metaschema_public.schema WHERE database_id = '<database_id>';"
```

---

## Re-Running (Idempotency)

If the output package directory already exists:
- **Interactive:** prompts to confirm overwrite (`deploy/`, `revert/`, `verify/` dirs are deleted and rewritten)
- **Non-interactive (no prompter):** overwrites without prompting

The `pgpm.json` and `package.json` for the module are NOT recreated if they already exist — only the SQL files are refreshed.

---

## Example: Export CRM to constructive-apps

```bash
cd ~/Constructive/teammate
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/Cellar/libpq/18.2/bin:$PATH"
eval "$(pgpm env)"
pgpm export
# Select: constructive → demo-crm-1772181642234 → crm → crm-svc → all schemas
# Output: packages/crm/ + packages/crm-svc/
```

Or programmatically with a script at `backends/crm/export.ts`:

```typescript
// backends/crm/export.ts
import { exportMigrations, PgpmPackage } from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { getPgPool } from 'pg-cache';
import { resolve } from 'path';

const WORKSPACE = resolve(__dirname, '../..');     // ~/Constructive/teammate
const DB_NAME = 'constructive';
const DB_DISPLAY_NAME = 'demo-crm-1772181642234';
const EXT_NAME = 'crm';
const SVC_NAME = 'crm-svc';

async function main() {
  const project = new PgpmPackage(WORKSPACE);
  project.ensureWorkspace();
  project.resetCwd(project.workspacePath);

  const options = getEnvOptions();

  // Look up database_id
  const pool = getPgPool({ ...options.pg, database: DB_NAME });
  const { rows } = await pool.query(
    `SELECT id, name FROM metaschema_public.database WHERE name = $1`,
    [DB_DISPLAY_NAME]
  );
  if (!rows.length) throw new Error(`Database ${DB_DISPLAY_NAME} not found`);
  const databaseId = rows[0].id;

  // Get all schema names
  const { rows: schemaRows } = await pool.query(
    `SELECT schema_name FROM metaschema_public.schema WHERE database_id = $1`,
    [databaseId]
  );
  const schema_names = schemaRows.map((r: any) => r.schema_name);
  pool.end();

  await exportMigrations({
    project,
    options,
    dbInfo: { dbname: DB_NAME, databaseName: DB_DISPLAY_NAME, database_ids: [databaseId] },
    author: 'pyramation <dan@constructive.io>',
    schema_names,
    extensionName: EXT_NAME,
    metaExtensionName: SVC_NAME,
    outdir: resolve(WORKSPACE, 'packages'),
    serviceOutdir: resolve(WORKSPACE, 'packages'), // same dir, or split if desired
    repoName: 'constructive-apps',
    username: 'pyramation-studio',
  });

  console.log('✅ Export complete → packages/crm + packages/crm-svc');
}

main().catch(console.error);
```

---

## Schema Name Replacement

During export, internal schema names like `demo-crm-1772181642234-a8eba4e4-app-public` are replaced with portable names derived from `extensionName`:

```
demo-crm-1772181642234-a8eba4e4-app-public  →  crm_app_public
demo-crm-1772181642234-a8eba4e4-app-private →  crm_app_private
```

This makes the exported SQL deployable anywhere without database-ID-specific schema names.

---

## What's Exported (Service Package Table Order)

The service/meta package exports rows from these tables (in dependency order):

```
database → schema → table → field → policy → index → trigger →
rls_function → procedure → constraints → schema_grant → table_grant →
domains → sites → apis → apps → site_modules → api_modules → api_schemas →
rls_module → memberships_module → invites_module → emails_module → sessions_module →
profiles_module → secure_table_provision → ...
```

Each table gets its own `deploy/migrate/<tableName>.sql` file.

---

## Workspace pgpm.json

Make sure `packages/*` is in the workspace `pgpm.json` so the exported modules are picked up:

```json
{
  "packages": [
    "packages/*",
    "extensions/*"
  ]
}
```
