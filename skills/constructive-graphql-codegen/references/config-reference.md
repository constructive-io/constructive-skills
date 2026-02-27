# Configuration Reference

Complete reference for `graphql-codegen.config.ts` configuration options.


## Configuration File

Create configuration using:

```bash
npx @constructive-io/graphql-codegen init
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
  schemaFile?: string;
  schemaDir?: string;          // Directory of .graphql files — auto-expands to multi-target
  db?: DbConfig;
  output?: string;
  // ... other options
  
  // OR Multi-target config 
  [targetName: string]: GraphQLSDKConfigTarget;
}

interface GraphQLSDKConfigTarget {
  // Schema Source (choose one)
  endpoint?: string;           // GraphQL endpoint URL
  schemaFile?: string;         // Path to .graphql file
  schemaDir?: string;          // Directory of .graphql files (auto multi-target)
  db?: DbConfig;               // Database introspection

  // Output Configuration
  output?: string;  // Default: './generated/graphql'

  // Generators
  reactQuery?: boolean;        // Generate React Query hooks
  orm?: boolean;               // Generate ORM client
  cli?: CliConfig | boolean;   // Generate inquirerer-based CLI

  // Schema export (instead of code generation)
  schemaOnly?: boolean;          // Export schema to .graphql file, skip codegen
  schemaOnlyOutput?: string;     // Output directory for exported schema
  schemaOnlyFilename?: string;   // Filename (default: 'schema.graphql')

  // Documentation (generated alongside code)
  docs?: DocsConfig | boolean; // { readme, agents, mcp, skills }

  // Node.js HTTP adapter
  nodeHttpAdapter?: boolean;   // Auto-enabled when cli is true

  // Authentication
  headers?: Record<string, string>;
  authorization?: string;      // Convenience for Authorization header

  // Filtering
  tables?: TableFilter;
  queries?: OperationFilter;
  mutations?: OperationFilter;
  excludeFields?: string[];  // Global field exclusion

  // Code Generation
  codegen?: CodegenOptions;
  queryKeys?: QueryKeyConfig;

  // Options
  verbose?: boolean;
  dryRun?: boolean;
  skipCustomOperations?: boolean;
}

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

Choose one of (see the main skill document for the recommended two-step workflow using `schemaDir`):

#### `schemaDir` (recommended)

Directory containing `.graphql` schema files. Each file automatically becomes a separate target:

```typescript
{
  schemaDir: './schemas',   // Contains public.graphql, admin.graphql, etc.
  output: './generated',    // Produces ./generated/public/, ./generated/admin/
}
```

#### `endpoint`

GraphQL endpoint URL for live introspection.

```typescript
{
  endpoint: 'https://api.example.com/graphql',
}
```

#### `schemaFile`

Path to a single GraphQL schema file (.graphql).

```typescript
{
  schemaFile: './schema.graphql',
}
```

#### `db`

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

### Generator Options

#### `reactQuery`

Generate React Query hooks. Default: `false`.

```typescript
{
  reactQuery: true,
}
```

#### `cli`

Generate inquirerer-based CLI commands. Default: `false`. When enabled, `nodeHttpAdapter` is auto-enabled.

```typescript
{
  cli: true,  // Generate CLI with defaults
  // OR with options:
  cli: {
    toolName: 'myapp',       // Config stored at ~/.myapp/
    entryPoint: true,         // Generate runnable index.ts
    builtinNames: {           // Override infra command names
      auth: 'credentials',
      context: 'env',
    },
  },
}
```

### Schema Export Options

#### `schemaOnly`

Export schema to `.graphql` file without generating any code. Default: `false`.

```typescript
{
  schemaOnly: true,
  schemaOnlyOutput: './schemas',       // Output directory
  schemaOnlyFilename: 'public.graphql', // Filename (default: 'schema.graphql')
}
```

### Documentation Options

#### `docs`

Generate documentation alongside code. Default: `{ readme: true, agents: true, mcp: false, skills: false }`.

```typescript
{
  docs: true,  // Enable all doc formats
  // OR configure individually:
  docs: {
    readme: true,   // README.md — human-readable overview
    agents: true,   // AGENTS.md — structured for LLM consumption
    mcp: false,     // mcp.json — MCP tool definitions
    skills: true,   // skills/ — per-command .md skill files (Devin-compatible)
  },
}
```

### Node.js HTTP Adapter

#### `nodeHttpAdapter`

Generate `node-fetch.ts` using `node:http` for localhost subdomain resolution. Auto-enabled when `cli: true`. Default: `false`.

```typescript
{
  nodeHttpAdapter: true,
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

Generate Prisma-like ORM client. Default: `false`. ORM is auto-enabled when `reactQuery` or `cli` is enabled.

```typescript
{
  orm: true,
}
```

ORM is always generated to `{output}/orm` subdirectory.

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

There are three ways to get multi-target generation:

### 1. Schema directory (recommended)

`schemaDir` automatically creates one target per `.graphql` file:

```typescript
export default defineConfig({
  schemaDir: './schemas',   // Contains public.graphql, admin.graphql
  output: './generated',    // Produces ./generated/public/, ./generated/admin/
  reactQuery: true,
  orm: true,
});
```

### 2. Explicit multi-target

Targets can mix any schema source:

```typescript
export default defineConfig({
  public: {
    schemaFile: './schemas/public.graphql',
    output: './generated/public',
    reactQuery: true,
  },
  admin: {
    endpoint: 'https://admin.example.com/graphql',
    output: './generated/admin',
    orm: true,
    cli: true,
  },
  internal: {
    db: { schemas: ['internal'] },
    output: './generated/internal',
    orm: true,
  },
});
```

### 3. Auto-expand from multiple API names

```typescript
export default defineConfig({
  db: { apiNames: ['public', 'admin'] },
  output: './generated',
  orm: true,
});
```

Generate specific target:

```bash
npx @constructive-io/graphql-codegen --target production
npx @constructive-io/graphql-codegen --target admin
```

Generate all targets:

```bash
npx @constructive-io/graphql-codegen
```

## Complete Examples

### Recommended: Schema directory

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  schemaDir: './schemas',
  output: './generated',
  reactQuery: true,
  orm: true,
  docs: { readme: true, agents: true },
});
```

### From endpoint with full options

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'http://localhost:5555/graphql',
  output: './generated',
  reactQuery: true,
  orm: true,

  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },

  tables: {
    include: ['User', 'Post', 'Comment'],
    exclude: ['*_archive', '_*'],
  },

  queries: {
    include: ['currentUser', 'searchPosts', 'trending*'],
    exclude: ['debug*'],
  },

  mutations: {
    include: ['login', 'logout', 'create*', 'update*'],
    exclude: ['delete*'],
  },

  excludeFields: ['__typename', 'internalId'],

  codegen: {
    maxFieldDepth: 2,
    skipQueryField: true,
  },

  queryKeys: {
    style: 'hierarchical',
    generateScopedKeys: true,
    generateCascadeHelpers: true,
    generateMutationKeys: true,
  },
});
```

### From database

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  db: {
    schemas: ['public', 'app_public'],
    // OR apiNames: ['my_api'],
  },
  output: './generated',
  reactQuery: true,
});
```

### From PGPM module

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  output: './generated',
  orm: true,
});
```
