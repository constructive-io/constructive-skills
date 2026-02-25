---
name: constructive-server-config
description: Configure and run the Constructive GraphQL server (cnc server), GraphiQL explorer (cnc explorer), and code generation (cnc codegen). Use when asked to "start the server", "run GraphiQL", "configure API routing", "generate types", or when working with the Constructive CLI and PostGraphile.
compatibility: Node.js 22+, PostgreSQL 17+, PostGraphile v5+
metadata:
  author: constructive-io
---

# Constructive Server Configuration

How to run and configure the Constructive GraphQL API server, explorer, and codegen tools.

## When to Apply

Use this skill when:
- Starting the Constructive GraphQL server (`cnc server`)
- Opening the GraphiQL explorer (`cnc explorer`)
- Running code generation (`cnc codegen`)
- Configuring API routing (header-based vs domain-based)
- Understanding the schema → PostGraphile → GraphQL pipeline

## The Constructive CLI (`cnc`)

The Constructive CLI (`cnc` or `constructive`) is the main entry point for running the platform.

### Core Commands

| Command | Purpose |
|---------|---------|
| `cnc server` | Start the GraphQL API server |
| `cnc explorer` | Start the GraphiQL explorer UI |
| `cnc codegen` | Generate TypeScript types and SDK from the running API |

## Starting the Server

### Basic Usage

```bash
# Start with default settings
cnc server

# Start with explicit host and port
cnc server --host 0.0.0.0 --port 3000

# Start with CORS origin (required for non-interactive / CI)
cnc server --host 0.0.0.0 --port 3000 --origin "*"
```

**Important:** When running non-interactively (CI, Docker, scripts), always pass `--origin` explicitly. Without it, the server may prompt for configuration.

### Server Options

| Option | Description | Default |
|--------|-------------|---------|
| `--host` | Bind address | `localhost` |
| `--port` | Listen port | `3000` |
| `--origin` | CORS allowed origin | (interactive prompt) |

### Environment Variables

The server reads its configuration from environment variables. Set these before starting:

```bash
eval "$(pgpm env)"  # Load database connection vars

# Required
export PGDATABASE=constructive

# API configuration
export API_IS_PUBLIC=true          # or false for admin mode
export API_EXPOSED_SCHEMAS=metaschema_public,services_public
export API_ANON_ROLE=anonymous     # Role for unauthenticated requests
export API_ROLE_NAME=authenticated # Role for authenticated requests
```

## API Routing Modes

### Public Mode (`API_IS_PUBLIC=true`)

Uses **domain-based routing**. Each site/app gets its own subdomain:

```
https://myapp.example.com/graphql → routes to myapp's schemas
```

- Used for external-facing APIs
- `API_ANON_ROLE=anonymous` — unauthenticated users get minimal access
- `API_ROLE_NAME=authenticated` — authenticated users get full access per RLS

### Admin Mode (`API_IS_PUBLIC=false`)

Uses **header-based routing**. The client sends headers to select the target:

```
X-Api-Name: my_api
X-Database-Id: <uuid>
X-Meta-Schema: metaschema_public
```

- Used for the Constructive admin UI
- `API_ANON_ROLE=administrator` — admin users get full schema access
- `API_ENABLE_SERVICES=true` — exposes the services schema for site/API management

## GraphiQL Explorer

```bash
cnc explorer
```

Opens an interactive GraphiQL interface in the browser for testing queries against the running server. Useful for:
- Exploring the generated schema
- Testing queries and mutations
- Debugging authentication and RLS policies

## Code Generation

### Using cnc codegen

```bash
cnc codegen
```

Generates TypeScript types and SDK code from the running GraphQL server. This is a convenience wrapper around `@constructive-io/graphql-codegen`.

### Using graphql-codegen directly

For more control, use the codegen package directly:

```bash
npx @constructive-io/graphql-codegen --react-query --orm -e http://localhost:3000/graphql -o ./generated
```

See the `constructive-graphql-codegen` skill for full codegen documentation.

## The Schema → GraphQL Pipeline

Understanding how database schemas become a GraphQL API:

```
PostgreSQL schemas (app_public, etc.)
        ↓
    PostGraphile v5 introspection
        ↓
    GraphQL schema (auto-generated)
        ↓
    cnc server (serves the API)
        ↓
    graphql-codegen (generates typed client)
        ↓
    React Query hooks / ORM / CLI
```

### Key Concepts

1. **Schemas are the source of truth** — tables, functions, views, and RLS policies in PostgreSQL define the API surface
2. **PostGraphile introspects automatically** — no manual schema writing needed
3. **Smart naming** — PostGraphile converts `snake_case` SQL to `camelCase` GraphQL automatically
4. **RLS is the auth layer** — Row-Level Security policies in Postgres control what each user can access via GraphQL

## Exposed Schemas

The `API_EXPOSED_SCHEMAS` variable controls which PostgreSQL schemas are exposed via GraphQL:

| Schema | Purpose |
|--------|---------|
| `metaschema_public` | Database metadata (tables, fields, constraints, etc.) |
| `services_public` | Service management (sites, APIs, domains, etc.) |
| `constructive_auth_public` | Authentication (login, register, tokens) |
| `app_public` (custom) | Application-specific tables and functions |

### Meta Schemas

`API_META_SCHEMAS` lists schemas used for schema validation and X-Meta-Schema routing:

```
API_META_SCHEMAS=metaschema_public,services_public,metaschema_modules_public,constructive_auth_public
```

## Common Workflows

### Start local dev server

```bash
eval "$(pgpm env)"
export PGDATABASE=constructive
cnc server --host 0.0.0.0 --port 3000 --origin "*"
```

### Explore the API

```bash
# In another terminal
cnc explorer
# Opens GraphiQL at http://localhost:3000/graphiql
```

### Generate SDK from running server

```bash
npx @constructive-io/graphql-codegen \
  --react-query --orm \
  -e http://localhost:3000/graphql \
  -o ./src/generated
```

### Run admin and public servers together

```bash
# Terminal 1 — Admin server
API_IS_PUBLIC=false API_ENABLE_SERVICES=true \
  cnc server --port 3002 --origin "*"

# Terminal 2 — Public server
API_IS_PUBLIC=true \
  cnc server --port 3000 --origin "*"
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Server hangs on start | Missing `--origin` flag | Add `--origin "*"` for non-interactive mode |
| No schemas exposed | `API_EXPOSED_SCHEMAS` not set | Set the env var with comma-separated schema names |
| Auth errors | Wrong role configuration | Check `API_ANON_ROLE` and `API_ROLE_NAME` |
| Can't connect to DB | Missing pgpm env | Run `eval "$(pgpm env)"` first |
| GraphiQL shows empty schema | Server not running or wrong port | Verify server is up and explorer points to correct URL |
