---
name: constructive-cli-server
description: Start and configure the Constructive GraphQL server using `cnc server`. Use when asked to "start the server", "run cnc server", "start GraphQL API", or when needing a running GraphQL endpoint for CLI testing or development.
compatibility: Node.js 22+, PostgreSQL 17+, @constructive-io/cli 7.1.3+
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive CLI Server (`cnc server`)

Start the Constructive GraphQL development server. The server exposes a multi-target GraphQL API with subdomain-based routing, supporting public, auth, admin, and objects endpoints.

## When to Apply

Use this skill when:
- Starting the GraphQL server for local development
- Running the server for CLI e2e testing
- Setting up a GraphQL endpoint for the generated Constructive CLI
- Debugging API routing or server configuration
- Running the server in CI for integration tests

## Prerequisites

- PostgreSQL 17+ running with a deployed Constructive database (see `constructive-local-env` skill)
- `@constructive-io/cli` installed globally (`npm install -g @constructive-io/cli`)
- Database users bootstrapped via `pgpm admin-users bootstrap --yes && pgpm admin-users add --test --yes`

## Installation

```bash
npm install -g @constructive-io/cli
```

This installs the `cnc` (and `constructive`) binary globally.

## Quick Start

```bash
# Start with defaults (port 5555, auto-detect database)
cnc server

# Start on a specific port with a specific database
PGDATABASE=constructive cnc server --port 5555

# Start with CORS wildcard (for local dev)
cnc server --origin '*'
```

## Command Reference

```
cnc server [OPTIONS]

Start Constructive GraphQL development server.

Options:
  --help, -h              Show help message
  --port <number>         Server port (default: 5555)
  --origin <url>          CORS origin URL (exact URL or * for wildcard)
  --simpleInflection      Use simple inflection (default: true)
  --oppositeBaseNames     Use opposite base names (default: false)
  --postgis               Enable PostGIS extension (default: true)
  --servicesApi           Enable Services API (default: true)
  --cwd <directory>       Working directory (default: current directory)
  --database <name>       Database to use (or set PGDATABASE env var)
```

## Endpoints

The server uses subdomain-based routing via the `Host` header. For local development, `*.localhost` resolves to `127.0.0.1` automatically.

| Target   | Endpoint                                    | Description                        |
|----------|---------------------------------------------|------------------------------------|
| Public   | `http://api.localhost:<port>/graphql`        | Public API (databases, tables, fields, schemas) |
| Auth     | `http://auth.localhost:<port>/graphql`       | Authentication (sign-up, sign-in, tokens)       |
| Objects  | `http://objects.localhost:<port>/graphql`    | Object store (blobs, trees, commits)            |
| Admin    | `http://admin.localhost:<port>/graphql`      | Admin operations                                |

Default port is **5555**.

## Non-Interactive Mode

When `PGDATABASE` is set, the server skips the interactive database selection prompt. All other options have sensible defaults and can be passed as CLI flags:

```bash
# Fully non-interactive — suitable for CI or scripts
PGDATABASE=constructive cnc server --port 5555
```

## Environment Variables

The server reads PostgreSQL connection details from standard `PG*` environment variables:

| Variable      | Default     | Description              |
|---------------|-------------|--------------------------|
| `PGHOST`      | `localhost` | PostgreSQL host          |
| `PGPORT`      | `5432`      | PostgreSQL port          |
| `PGUSER`      | `postgres`  | PostgreSQL user          |
| `PGPASSWORD`  | (none)      | PostgreSQL password      |
| `PGDATABASE`  | (prompt)    | Database name            |
| `NODE_ENV`    | `development` | Environment (affects CORS warnings) |

## Step-by-Step: Local Development

### 1. Ensure database is deployed

```bash
# If not already done:
pgpm docker start
eval "$(pgpm env)"
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes

cd application/constructive
pgpm deploy --createdb --recursive --yes
```

### 2. Start the server

```bash
PGDATABASE=constructive cnc server --port 5555
```

Wait for the log line: `listening at http://0.0.0.0:5555`

### 3. Verify the server is running

```bash
curl -s http://api.localhost:5555/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __typename }"}' | jq
```

Expected response:
```json
{
  "data": {
    "__typename": "Query"
  }
}
```

### 4. Use with the generated CLI

```bash
cd sdk/constructive-cli

# Create context pointing to local server
npx tsx cli/index.ts context create local \
  --publicEndpoint http://api.localhost:5555/graphql \
  --authEndpoint http://auth.localhost:5555/graphql \
  --objectsEndpoint http://objects.localhost:5555/graphql \
  --adminEndpoint http://admin.localhost:5555/graphql

npx tsx cli/index.ts context use local

# Sign up and get token
npx tsx cli/index.ts auth:sign-up --input '{"email":"dev@example.com","password":"pass123"}'
```

## Step-by-Step: CI / GitHub Actions

Use this pattern in a workflow to start `cnc server` for e2e testing:

```yaml
- name: Install cnc globally
  run: npm install -g @constructive-io/cli@7.1.3

- name: Deploy constructive-local
  run: |
    cd application/constructive
    pgpm deploy --createdb --recursive --yes

- name: Start cnc server
  run: |
    PGDATABASE=constructive cnc server --port 5555 &
    # Wait for server readiness
    for i in $(seq 1 30); do
      if curl -sf http://api.localhost:5555/graphql \
        -H 'Content-Type: application/json' \
        -d '{"query":"{ __typename }"}' > /dev/null 2>&1; then
        echo "Server is ready!"
        break
      fi
      if [ "$i" -eq 30 ]; then
        echo "Server failed to start after 30 seconds"
        exit 1
      fi
      sleep 1
    done

- name: Run CLI e2e tests
  run: |
    cd sdk/constructive-cli
    bash test/test-cli-e2e.sh
```

## Architecture Notes

### Services API mode

By default, `--servicesApi` is `true`. This enables the Constructive services routing layer, which routes requests based on the `Host` header subdomain to the correct schema/role combination. This is the recommended mode for Constructive applications.

When `--servicesApi` is `false`, the server falls back to exposing raw PostgreSQL schemas and prompts for schema selection, auth role, and role name.

### Server internals

The `cnc server` command:
1. Reads `PGDATABASE` or prompts for database selection
2. Collects configuration options (inflection, PostGIS, CORS, etc.)
3. Calls `GraphQLServer()` from `@constructive-io/graphql-server`
4. Starts an Express server with middleware for:
   - Subdomain-based API routing (`@constructive-io/url-domains`)
   - JWT authentication
   - PostGraphile GraphQL engine
   - CORS handling (per-API or fallback)
   - Health check endpoint at `/healthz`
5. Listens for PostgreSQL `schema:update` notifications to auto-flush caches

### Source code

The `cnc server` command is implemented in:
- `constructive/packages/cli/src/commands/server.ts` — CLI command handler
- `constructive/graphql/server/src/server.ts` — `GraphQLServer` class and factory

## Troubleshooting

### Server won't start — "Port 5555 is already in use"

Another instance is running. Kill it:
```bash
lsof -ti:5555 | xargs kill -9
```

### "Could not connect to database" or connection refused

Ensure PostgreSQL is running and env vars are set:
```bash
pgpm docker status
eval "$(pgpm env)"
psql -c "SELECT 1"
```

### Server starts but endpoints return 404

The database may not have the Constructive schema deployed. Deploy it:
```bash
cd application/constructive
pgpm deploy --createdb --recursive --yes
```

### CORS errors in browser

Pass `--origin` to set the allowed origin:
```bash
cnc server --origin 'http://localhost:3000'
# Or for any origin during development:
cnc server --origin '*'
```

### Subdomain routing not working

`*.localhost` should resolve to `127.0.0.1` automatically on most systems. If not, add entries to `/etc/hosts`:
```
127.0.0.1 api.localhost
127.0.0.1 auth.localhost
127.0.0.1 objects.localhost
127.0.0.1 admin.localhost
```

## References

- [@constructive-io/cli package](https://github.com/constructive-io/constructive/tree/main/packages/cli)
- [@constructive-io/graphql-server package](https://github.com/constructive-io/constructive/tree/main/graphql/server)
- [constructive-db CLI e2e tests](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-cli/test)
- Related skill: `constructive-local-env` for full local environment setup
- Related skill: `constructive-graphql-codegen` for generating CLI from schema
