# Default Configuration Values

These defaults are applied as the base layer before config file, env vars, and runtime overrides.

## PGPM Core Defaults (`pgpmDefaults`)

Source: `@pgpmjs/types`

The core PGPM defaults provide base values for database connection, server, and deployment configuration. These are used by `@pgpmjs/env`'s `getEnvOptions()`.

Key defaults include:

- **`db.rootDb`**: `'postgres'`
- **`db.prefix`**: `'test-db-'`
- **`db.extensions`**: `['plpgsql', 'uuid-ossp']`
- **`db.connections.app`**: Default app-level user/password
- **`db.connections.admin`**: Default admin user/password
- **`db.roles`**: Default role definitions
- **`server.port`**: `3000`
- **`server.host`**: `'localhost'`
- **`deployment.useTx`**: `true`
- **`deployment.fast`**: `false`
- **`deployment.usePlan`**: `true`
- **`deployment.cache`**: `false`

## GraphQL Defaults (`constructiveGraphqlDefaults`)

Source: `@constructive-io/graphql-types`

### Graphile Defaults (`graphileDefaults`)

```typescript
{
  schema: [],       // No schemas exposed by default
  extends: [],      // No preset extensions
  preset: {},       // No preset overrides
}
```

### Feature Defaults (`graphileFeatureDefaults`)

```typescript
{
  simpleInflection: true,      // Use PgSimplifyInflection
  oppositeBaseNames: true,     // Use opposite base names for relations
  postgis: true,               // Enable PostGIS support
}
```

### API Defaults (`apiDefaults`)

```typescript
{
  enableServicesApi: true,         // Services API routing enabled
  exposedSchemas: [],              // No schemas exposed by default
  anonRole: 'administrator',      // Default anonymous role
  roleName: 'administrator',      // Default authenticated role
  defaultDatabaseId: 'hard-coded', // Default database ID
  isPublic: true,                  // Public API mode (domain routing)
  metaSchemas: [
    'services_public',
    'metaschema_public',
    'metaschema_modules_public',
  ],
}
```

## Combined Defaults (`constructiveDefaults`)

When using `@constructive-io/graphql-env`, the full defaults are a deep merge of:

```typescript
constructiveDefaults = deepmerge.all([
  pgpmDefaults,
  constructiveGraphqlDefaults  // { graphile, features, api }
]);
```

This means all PGPM defaults are preserved and the GraphQL-specific defaults are layered on top.

## How Defaults Are Applied

Defaults form the first layer in the merge hierarchy:

```
defaults → config file → env vars → runtime overrides
```

If you set a value in a config file, it overrides the default. If you set an env var, it overrides both the default and the config file. Runtime overrides win over everything.

**Array behavior**: Arrays are **replaced**, not concatenated. If the default `db.extensions` is `['plpgsql', 'uuid-ossp']` and you set `DB_EXTENSIONS=postgis`, the result is `['postgis']` — the default array is fully replaced.
