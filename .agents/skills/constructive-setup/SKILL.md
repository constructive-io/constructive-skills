---
name: constructive-setup
description: "Set up the Constructive monorepo for development — install dependencies, start PostgreSQL via pgpm Docker, bootstrap users, build, and run tests. Use when asked to 'set up constructive', 'get constructive running', 'set up dev environment', 'bootstrap database', or when starting work in the constructive-io/constructive repo."
metadata:
  author: constructive-io
  version: "1.0.0"
  triggers: "user, model"
---

# Constructive Monorepo Setup

Lightweight setup guide for getting the `constructive-io/constructive` monorepo running locally. References detailed skills for each subsystem instead of duplicating their content.

## When to Apply

Use this skill when:
- Setting up the Constructive monorepo for the first time
- Starting a new development session that needs a running database
- Troubleshooting a broken local environment

## Prerequisites

- **Node.js 22+** — Required for correct pnpm module resolution with PostGraphile/Graphile packages. Node.js 20 causes duplicate `graphql` module instances and runtime errors ("Cannot use GraphQLObjectType from another module or realm"). Use `nvm install 22` or `volta install node@22` if needed.
- **pnpm 10+** — Pin to an exact version (e.g., `10.22.0`) in CI to avoid dependency resolution drift.

## Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL via pgpm Docker
pgpm docker start --image docker.io/constructiveio/postgres-plus:18 --recreate
eval "$(pgpm env)"

# 3. Bootstrap database users
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes

# 4. Build the monorepo
pnpm build

# 5. Run tests (from a specific package)
cd packages/yourmodule
pnpm test
```

## Step-by-Step Details

### 1. Verify Node.js Version

Constructive requires Node.js 22+. Different Node.js versions cause different pnpm module resolution behavior, which can lead to duplicate `graphql` module instances and cryptic runtime errors.

```bash
node --version  # Must be v22.x or higher
```

If you're on an older version, upgrade:
```bash
nvm install 22 && nvm use 22
# or
volta install node@22
```

### 2. Install Dependencies

The monorepo uses pnpm workspaces:

```bash
pnpm install
```

### 3. Start PostgreSQL

Use pgpm's Docker integration to start a local PostgreSQL container. The `postgres-plus:18` image includes all required extensions (PostGIS, pgvector, uuid-ossp, etc.).

```bash
pgpm docker start --image docker.io/constructiveio/postgres-plus:18 --recreate
eval "$(pgpm env)"
```

> **Important:** `eval "$(pgpm env)"` must be run as a separate command (not chained with `&&`) because the env vars aren't available until the command completes.

For full Docker options (custom ports, names, passwords), see the **pgpm** skill: [references/docker.md](../pgpm/references/docker.md)

For environment variable details, see the **pgpm** skill: [references/env.md](../pgpm/references/env.md)

### 4. Bootstrap Database Users

Create the required PostgreSQL roles for Constructive's security model:

```bash
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes
```

### 5. Build

```bash
pnpm build
```

This builds all packages in the monorepo. Required before running tests or starting servers.

### 6. Run Tests

Tests are run per-package:

```bash
cd packages/yourmodule   # or graphile/yourplugin, pgpm/core, etc.
pnpm test                # single run
pnpm test:watch          # watch mode
```

For testing patterns and frameworks, see the **constructive-testing** skill.

## Monorepo Layout

| Directory | Contents |
|-----------|----------|
| `packages/*` | Constructive CLI, ORM, query-builder, server-utils |
| `pgpm/*` | PGPM engine, CLI, shared types/logger/env |
| `graphql/*` | GraphQL server, explorer, codegen, types, query/react utilities |
| `graphile/*` | Graphile/PostGraphile plugins (postgis, search, etc.) |
| `postgres/*` | PostgreSQL tooling (pg-ast, pg-codegen, introspectron, pgsql-test) |
| `extensions/*` | PGPM extension modules |

For full navigation, see the repo's `AGENTS.md`.

## Cross-References

- **pgpm** skill — Database migrations, Docker, environment, CLI commands
  - [references/docker.md](../pgpm/references/docker.md) — Docker container management
  - [references/env.md](../pgpm/references/env.md) — Environment variables and `eval "$(pgpm env)"`
  - [references/cli.md](../pgpm/references/cli.md) — Full CLI command reference
- **constructive** skill — Platform architecture, blueprints, services, deployment
  - [references/deployment.md](../constructive/references/deployment.md) — Docker Compose, Makefile targets, production builds
  - [references/server-config.md](../constructive/references/server-config.md) — Running the GraphQL server
- **constructive-testing** skill — Test frameworks (pgsql-test, drizzle-orm-test, supabase-test)
- **constructive-graphql** skill — Codegen, ORM, search, pagination
