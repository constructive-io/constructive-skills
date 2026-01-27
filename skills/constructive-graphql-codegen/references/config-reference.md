# Configuration Reference (v3.1.x)

Complete reference for `graphql-codegen.config.ts` configuration options.


## Configuration File

Create configuration using:

```bash
npx graphql-codegen init
```

Or manually create `graphql-codegen.config.ts`:

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  targets: {
    default: {
      endpoint: 'https://api.example.com/graphql',
      output: './src/generated/hooks',
    },
  },
});
```

## Full Configuration Interface

```typescript
interface GraphQLSDKConfig {
  // Single-target config
  endpoint?: string;
  schemaFile?: string;  // Renamed from 'schema' in v3.0
  db?: DbConfig;        // NEW in v3.0
  output?: string;
  // ... other options
  
  // OR Multi-target config (simplified in v3.0)
  [targetName: string]: GraphQLSDKConfigTarget;
}

interface GraphQLSDKConfigTarget {
  // Schema Source (choose one)
  endpoint?: string;           // GraphQL endpoint URL
  schemaFile?: string;         // Path to .graphql file (renamed from 'schema')
  db?: DbConfig;               // NEW: Database introspection

  // Output Configuration
  output?: string;  // Default: './generated/graphql'

  // Authentication
  headers?: Record<string, string>;

  // Filtering
  tables?: TableFilter;
  queries?: OperationFilter;
  mutations?: OperationFilter;
  excludeFields?: string[];  // Global field exclusion

  // Code Generation
  codegen?: CodegenOptions;
  reactQuery?: boolean;        // CHANGED: Now boolean (was ReactQueryOptions)
  orm?: boolean;               // CHANGED: Now boolean (was ORMOptions)
  queryKeys?: QueryKeyConfig;
  
  // Watch mode (REMOVED in v3.0)
  // watch?: WatchConfig;
}

// NEW in v3.0: Database configuration
interface DbConfig {
  config?: Partial<PgConfig>;  // PostgreSQL connection
  pgpm?: PgpmConfig;           // PGPM module configuration
  schemas?: string[];          // Explicit schemas
  apiNames?: string[];         // Auto-discover schemas from API
  keepDb?: boolean;            // Keep ephemeral DB (debugging)
}

interface PgpmConfig {
  modulePath?: string;         // Path to PGPM module
  workspacePath?: string;      // Path to PGPM workspace
  moduleName?: string;         // Module name in workspace
}

interface TableFilter {
  include?: string[];       // Default: ['*']
  exclude?: string[];       // Default: []
  systemExclude?: string[]; // Default: []
}

interface OperationFilter {
  include?: string[];       // Default: ['*']
  exclude?: string[];       // Default: []
  systemExclude?: string[]; // Default: ['_meta', 'query'] for queries, [] for mutations
}

interface CodegenOptions {
  maxFieldDepth?: number;    // Default: 2
  skipQueryField?: boolean;  // Default: true
}

interface QueryKeyConfig {
  style?: 'flat' | 'hierarchical';  // Default: 'hierarchical'
  generateScopedKeys?: boolean;     // Default: true
  generateCascadeHelpers?: boolean; // Default: true
  generateMutationKeys?: boolean;   // Default: true
  relationships?: Record<string, EntityRelationship>;
}
```

## Configuration Options

### Schema Source

Choose one of:

#### `endpoint`

GraphQL endpoint URL for live introspection.

```typescript
{
  endpoint: 'https://api.example.com/graphql',
}
```

#### `schemaFile`

Path to GraphQL schema file (.graphql). 

```typescript
{
  schemaFile: './schema.graphql',
}
```

#### `db` (NEW in v3.0)

Database configuration for direct PostgreSQL introspection.

```typescript
// Explicit schemas
{
  db: {
    schemas: ['public', 'app_public'],
  },
}

// Auto-discover from API names
{
  db: {
    apiNames: ['my_api'],  // Queries services_public.api_schemas
  },
}

// With explicit database config
{
  db: {
    config: {
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      user: 'postgres',
    },
    schemas: ['public'],
  },
}

// From PGPM module
{
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
}
```

### Output

#### `output`

Directory for generated code.

```typescript
{
  output: './generated/hooks',  // Default: './generated/graphql'
}
```

**Note:** For React Query hooks, you typically want a different output than the default.

### Authentication

#### `headers`

HTTP headers for schema introspection requests.

```typescript
{
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    'X-Custom-Header': 'value',
  },
}
```

### Table Filtering

#### `tables.include`

Glob patterns for tables to include. Default: `['*']` (all tables).

```typescript
{
  tables: {
    include: ['User', 'Post', 'Comment'],
  },
}
```

#### `tables.exclude`

Glob patterns for tables to exclude. Default: `[]`.

```typescript
{
  tables: {
    exclude: ['*_archive', 'temp_*', '_*'],
  },
}
```

#### `tables.systemExclude`

System-level tables always excluded. Default: `[]`. Can be overridden.

```typescript
{
  tables: {
    systemExclude: [],  // Disable system excludes
  },
}
```

### Query Filtering

#### `queries.include`

Custom queries to include. Default: `['*']` (all queries).

```typescript
{
  queries: {
    include: ['currentUser', 'searchProducts'],
  },
}
```

#### `queries.exclude`

User-defined queries to exclude. Default: `[]`.

```typescript
{
  queries: {
    exclude: ['debug*', 'internal*'],
  },
}
```

#### `queries.systemExclude`

System-level queries always excluded. Default: `['_meta', 'query']`. Can be overridden to `[]` to disable.

```typescript
{
  queries: {
    systemExclude: [],  // Disable system excludes (not recommended)
  },
}
```

### Mutation Filtering

#### `mutations.include`

Mutations to include. Default: `['*']` (all mutations).

```typescript
{
  mutations: {
    include: ['login', 'logout', 'create*', 'update*'],
  },
}
```

#### `mutations.exclude`

User-defined mutations to exclude. Default: `[]`.

```typescript
{
  mutations: {
    exclude: ['delete*'],  // Exclude all delete mutations
  },
}
```

#### `mutations.systemExclude`

System-level mutations always excluded. Default: `[]`.

```typescript
{
  mutations: {
    systemExclude: ['__internal*'],  // Add system excludes
  },
}
```

### Code Generation Options

#### `codegen.maxFieldDepth`

Maximum depth for nested field generation. Default: `2`.

```typescript
{
  codegen: {
    maxFieldDepth: 3,  // Deeper nested types
  },
}
```

#### `codegen.skipQueryField`

Skip generating the root `query` field. Default: `true`.

```typescript
{
  codegen: {
    skipQueryField: false,
  },
}
```

### React Query Options

#### `reactQuery`

**CHANGED in v3.0:** Now a boolean flag. Default: `false`.

```typescript
{
  reactQuery: true,  // Generate React Query hooks
}
```

**v2.x (deprecated):**
```typescript
{
  reactQuery: { enabled: true },  // Old syntax
}
```

### Query Key Configuration

#### `queryKeys.style`

Query key structure style. Default: `'hierarchical'`.

```typescript
{
  queryKeys: {
    style: 'hierarchical',  // or 'flat'
  },
}
```

#### `queryKeys.generateScopedKeys`

Generate scope-aware query keys. Default: `true`.

```typescript
{
  queryKeys: {
    generateScopedKeys: true,
  },
}
```

#### `queryKeys.generateCascadeHelpers`

Generate cascade invalidation helpers. Default: `true`.

```typescript
{
  queryKeys: {
    generateCascadeHelpers: true,
  },
}
```

#### `queryKeys.generateMutationKeys`

Generate mutation keys for tracking. Default: `true`.

```typescript
{
  queryKeys: {
    generateMutationKeys: true,
  },
}
```

#### `queryKeys.relationships`

Define entity relationships for cascade invalidation.

```typescript
{
  queryKeys: {
    relationships: {
      table: { parent: 'database', foreignKey: 'databaseId' },
      field: { parent: 'table', foreignKey: 'tableId' },
    },
  },
}
```

### ORM Options

#### `orm`

**CHANGED in v3.0:** Now a boolean flag. Default: `false`.

```typescript
{
  orm: true,  // Generate ORM client
}
```

**v2.x (deprecated):**
```typescript
{
  orm: { enabled: true, output: './generated/orm' },  // Old syntax
}
```

**Note:** In v3.0, ORM is always generated to `{output}/orm` subdirectory.

### Global Field Exclusion

#### `excludeFields`

Exclude specific fields from all tables globally.

```typescript
{
  excludeFields: ['internalId', 'legacyField', '__typename'],
}
```

## Glob Pattern Syntax

Filtering supports glob patterns:

| Pattern | Matches |
|---------|---------|
| `*` | Any string |
| `?` | Single character |
| `User` | Exact match "User" |
| `User*` | "User", "UserProfile", "UserSettings" |
| `*User` | "User", "AdminUser", "SuperUser" |
| `*_archive` | "posts_archive", "users_archive" |

## Multi-Target Configuration

**Simplified in v3.0** - no `targets` wrapper needed.

```typescript
export default defineConfig({
  development: {
    endpoint: 'http://localhost:5555/graphql',
    output: './generated/dev',
    reactQuery: true,
  },
  production: {
    endpoint: 'https://api.prod.example.com/graphql',
    output: './generated/prod',
    reactQuery: true,
    headers: {
      Authorization: `Bearer ${process.env.PROD_API_TOKEN}`,
    },
  },
  admin: {
    db: { schemas: ['admin'] },
    output: './generated/admin',
    orm: true,
  },
});
```

Generate specific target:

```bash
npx graphql-codegen -t production
npx graphql-codegen -t admin
```

Generate all targets:

```bash
npx graphql-codegen
```

## Complete Example (v3.0)

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

// From GraphQL endpoint
export default defineConfig({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'http://localhost:5555/graphql',
  output: './generated',
  
  // Boolean flags (v3.0)
  reactQuery: true,
  orm: true,

  // Authentication
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },

  // Filter tables
  tables: {
    include: ['User', 'Post', 'Comment'],
    exclude: ['*_archive', '_*'],
  },

  // Filter queries
  queries: {
    include: ['currentUser', 'searchPosts', 'trending*'],
    exclude: ['debug*'],
  },

  // Filter mutations
  mutations: {
    include: ['login', 'logout', 'create*', 'update*'],
    exclude: ['delete*'],
  },

  // Exclude fields globally
  excludeFields: ['__typename', 'internalId'],

  // Code generation options
  codegen: {
    maxFieldDepth: 2,
    skipQueryField: true,
  },

  // Query key factory
  queryKeys: {
    style: 'hierarchical',
    generateScopedKeys: true,
    generateCascadeHelpers: true,
    generateMutationKeys: true,
  },
});

// From database (v3.0)
export default defineConfig({
  db: {
    schemas: ['public', 'app_public'],
    // OR apiNames: ['my_api'],
  },
  output: './generated',
  reactQuery: true,
});

// From PGPM module (v3.0)
export default defineConfig({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  output: './generated',
  orm: true,
});
```
