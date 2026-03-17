---
name: constructive-env
description: Unified environment configuration for Constructive and PGPM projects — typed defaults, env var parsing, config file discovery, and hierarchical option merging. Use when asked to "configure environment", "set env vars", "manage defaults", "use getEnvOptions", "configure database connection", "set up server config", "configure SMTP", "configure CDN", "manage configuration hierarchy", or when working with @pgpmjs/env or @constructive-io/graphql-env.
compatibility: Node.js 18+, @pgpmjs/env, @constructive-io/graphql-env
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Environment Configuration

Unified, type-safe environment configuration for all Constructive and PGPM projects. Two packages work together to provide a clean, hierarchical configuration system with sensible defaults.

## When to Apply

Use this skill when:
- Configuring database connections, server settings, CDN, SMTP, or jobs programmatically
- Understanding how environment variables map to typed configuration objects
- Setting up `pgpm.json` config files
- Writing code that needs to read environment-aware configuration
- Choosing between `@pgpmjs/env` and `@constructive-io/graphql-env`
- Understanding the merge hierarchy (defaults → config file → env vars → overrides)

## Architecture Overview

Two packages form a layered configuration system:

```
@pgpmjs/types          →  PgpmOptions interface + pgpmDefaults
    ↓
@pgpmjs/env            →  getEnvVars() + loadConfigSync() + getEnvOptions()
    ↓  (extends)
@constructive-io/graphql-types  →  ConstructiveOptions interface + constructiveDefaults
    ↓
@constructive-io/graphql-env    →  getGraphQLEnvVars() + getEnvOptions()
```

### Which Package to Import

| You're working in... | Import from |
|----------------------|-------------|
| PGPM packages (`pgpm/*`) | `@pgpmjs/env` |
| PostgreSQL tools (`postgres/*`) | `@pgpmjs/env` or `pg-env` |
| GraphQL server, explorer, codegen | `@constructive-io/graphql-env` |
| Constructive CLI commands | `@constructive-io/graphql-env` |
| Job functions, SMTP | `@pgpmjs/env` |
| Tests (pgsql-test based) | `@pgpmjs/env` (via `getConnEnvOptions`) |

**Rule of thumb:** If your code needs GraphQL/Graphile/API options, use `@constructive-io/graphql-env`. Otherwise, use `@pgpmjs/env`.

## Merge Hierarchy

Options are merged in this order (later overrides earlier):

1. **Defaults** — `pgpmDefaults` (+ `constructiveGraphqlDefaults` for GraphQL layer)
2. **Config file** — `pgpm.json` or `pgpm.config.js` discovered by walking up directories
3. **Environment variables** — parsed from `process.env`
4. **Runtime overrides** — passed programmatically to `getEnvOptions()`

Arrays are **replaced**, not concatenated — the later source wins completely.

## Quick Start

### Core PGPM Options

```typescript
import { getEnvOptions } from '@pgpmjs/env';

// Get fully merged options (defaults + config + env + overrides)
const opts = getEnvOptions();

// With runtime overrides
const opts = getEnvOptions({
  pg: { database: 'mydb' },
  deployment: { fast: true }
});

// With custom working directory and env object
const opts = getEnvOptions({}, '/path/to/project', process.env);
```

### Constructive Options (includes GraphQL)

```typescript
import { getEnvOptions } from '@constructive-io/graphql-env';

// Gets everything: PGPM defaults + GraphQL defaults + config + env + overrides
const opts = getEnvOptions({
  pg: { database: 'constructive' },
  api: { isPublic: true }
});
```

### Specialized Accessors

```typescript
import { getConnEnvOptions, getDeploymentEnvOptions } from '@pgpmjs/env';

// Database connection options with roles resolved
const connOpts = getConnEnvOptions({ prefix: 'test-' });

// Deployment options only
const deployOpts = getDeploymentEnvOptions({ fast: true });
```

## Type System

### PgpmOptions (core)

```typescript
interface PgpmOptions {
  db?: Partial<PgTestConnectionOptions>;  // DB config, roles, connections
  pg?: Partial<PgConfig>;                 // PostgreSQL connection (host, port, user, etc.)
  server?: ServerOptions;                 // HTTP server (host, port, trustProxy, origin)
  cdn?: CDNOptions;                       // S3/MinIO file storage
  deployment?: DeploymentOptions;         // Migration deployment settings
  migrations?: MigrationOptions;          // Code generation settings
  jobs?: JobsConfig;                      // Job worker/scheduler config
  errorOutput?: ErrorOutputOptions;       // Error formatting
  smtp?: SmtpOptions;                     // Email configuration
}
```

### ConstructiveOptions (extends PgpmOptions)

```typescript
interface ConstructiveOptions extends PgpmOptions {
  graphile?: GraphileOptions;             // PostGraphile schema config
  features?: GraphileFeatureOptions;      // Feature flags (inflection, PostGIS)
  api?: ApiOptions;                       // API routing (public/admin, roles, schemas)
}
```

## Utility Functions

### Env Var Parsers

```typescript
import { parseEnvBoolean, parseEnvNumber } from '@pgpmjs/env';

parseEnvBoolean('true');    // true
parseEnvBoolean('1');       // true
parseEnvBoolean('yes');     // true
parseEnvBoolean('false');   // false
parseEnvBoolean(undefined); // undefined

parseEnvNumber('5432');     // 5432
parseEnvNumber('invalid');  // undefined
```

### Node Environment

```typescript
import { getNodeEnv } from '@pgpmjs/env';

const env = getNodeEnv(); // 'development' | 'production' | 'test'
```

### Config File Discovery

```typescript
import { loadConfigSync, resolvePgpmPath } from '@pgpmjs/env';

// Load pgpm.json by walking up directory tree
const config = loadConfigSync('/path/to/project');

// Find the pgpm config file path
const pgpmPath = resolvePgpmPath('/path/to/project');
```

## Anti-Patterns

**Never do this:**

```typescript
// BAD: Manual env var access scattered throughout code
const host = process.env.PGHOST || 'localhost';
const port = parseInt(process.env.PGPORT || '5432');
const usePublic = process.env.API_IS_PUBLIC === 'true';
```

**Do this instead:**

```typescript
// GOOD: Use the unified configuration system
import { getEnvOptions } from '@pgpmjs/env';
const opts = getEnvOptions();
const { host, port } = opts.pg;
```

```typescript
// GOOD: For Constructive/GraphQL packages
import { getEnvOptions } from '@constructive-io/graphql-env';
const opts = getEnvOptions();
const { isPublic } = opts.api;
```

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [references/env-vars.md](references/env-vars.md) | Complete environment variables reference | Looking up specific env var names, defaults, and which config key they map to |
| [references/defaults.md](references/defaults.md) | Default values for all configuration | Understanding what values are used when nothing is overridden |
| [references/config-file.md](references/config-file.md) | pgpm.json configuration | Setting up project-level configuration files |

## Cross-References

- `pgpm` skill (`references/env.md`) — The `pgpm env` CLI command for shell-level env var management
- `constructive-server-config` skill — Server-specific env vars and startup configuration
- `constructive-deployment` skill — Deployment-specific configuration
- `constructive-functions` skill — Using `parseEnvBoolean` in Knative functions
