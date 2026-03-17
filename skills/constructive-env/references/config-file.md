# Configuration File Reference

PGPM and Constructive support project-level configuration via `pgpm.json` or `pgpm.config.js` files.

## Config File Discovery

The system walks up the directory tree from the current working directory looking for:

1. `pgpm.config.js` (checked first — supports dynamic config)
2. `pgpm.json` (static JSON config)

The first file found is used. If no config file is found, an empty object is returned (defaults still apply).

```
project/
├── packages/
│   └── my-module/     ← cwd
│       └── ...
├── pgpm.json          ← found by walking up
└── ...
```

## pgpm.json Format

```json
{
  "pg": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "postgres",
    "database": "myproject"
  },
  "db": {
    "extensions": ["plpgsql", "uuid-ossp", "postgis"],
    "prefix": "test-"
  },
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "deployment": {
    "fast": true,
    "useTx": true
  },
  "cdn": {
    "provider": "minio",
    "bucketName": "uploads",
    "minioEndpoint": "http://localhost:9000"
  },
  "graphile": {
    "schema": ["app_public", "app_private"]
  },
  "features": {
    "simpleInflection": true,
    "postgis": false
  },
  "api": {
    "isPublic": true,
    "exposedSchemas": ["app_public"],
    "anonRole": "anonymous"
  }
}
```

## pgpm.config.js Format

For dynamic configuration:

```javascript
module.exports = {
  pg: {
    host: process.env.CUSTOM_HOST || 'localhost',
    port: 5432,
  },
  deployment: {
    fast: process.env.NODE_ENV === 'development',
  }
};
```

Or with ES module default export:

```javascript
export default {
  pg: {
    database: 'myproject',
  },
};
```

## Workspace Resolution

The config system can also resolve workspace roots. These functions walk up the directory tree looking for workspace markers:

| Function | Looks For | Use Case |
|----------|-----------|----------|
| `resolvePgpmPath()` | `pgpm.config.js` or `pgpm.json` | Find PGPM workspace root |
| `resolvePnpmWorkspace()` | `pnpm-workspace.yaml` | Find pnpm workspace root |
| `resolveLernaWorkspace()` | `lerna.json` | Find Lerna workspace root |
| `resolveNpmWorkspace()` | `package.json` with `workspaces` field | Find npm workspace root |
| `resolveWorkspaceByType()` | Dispatches to the above based on type | Generic workspace resolution |

```typescript
import { resolvePgpmPath, resolveWorkspaceByType } from '@pgpmjs/env';

const pgpmRoot = resolvePgpmPath('/path/to/nested/dir');
// Returns '/path/to' if pgpm.json exists there

const workspaceRoot = resolveWorkspaceByType('/path/to/dir', 'pnpm');
// Returns the pnpm workspace root
```

## Config File + Env Vars Interaction

Config file values override defaults but are overridden by environment variables:

```
pgpmDefaults        →  { server: { port: 3000 } }
pgpm.json           →  { server: { port: 4000 } }     ← overrides default
PORT=5000           →  { server: { port: 5000 } }     ← overrides config
getEnvOptions({})   →  { server: { port: 5000 } }     ← final result
```

For Constructive packages, GraphQL-specific keys in the config file (`graphile`, `features`, `api`) are also merged:

```
pgpmDefaults                →  base
constructiveGraphqlDefaults →  graphile/features/api defaults
pgpm.json (graphile keys)   →  overrides graphql defaults
GRAPHILE_SCHEMA=...         →  overrides config
getEnvOptions({})           →  final result
```
