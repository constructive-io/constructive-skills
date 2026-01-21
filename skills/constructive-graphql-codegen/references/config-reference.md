# Configuration Reference

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
  targets: Record<string, GraphQLSDKConfigTarget>;
}

interface GraphQLSDKConfigTarget {
  // Schema Source (one required)
  endpoint?: string;
  schema?: string;

  // Output Configuration
  output?: string;

  // Authentication
  headers?: Record<string, string>;

  // Filtering
  tables?: TableFilter;
  queries?: OperationFilter;
  mutations?: OperationFilter;

  // Code Generation
  codegen?: CodegenOptions;

  // ORM-specific
  orm?: ORMOptions;
}

interface TableFilter {
  include?: string[];  // Glob patterns
  exclude?: string[];  // Glob patterns
}

interface OperationFilter {
  include?: string[];
  exclude?: string[];
}

interface CodegenOptions {
  maxFieldDepth?: number;
  skipQueryField?: boolean;
}

interface ORMOptions {
  output?: string;
  useSharedTypes?: boolean;
}
```

## Configuration Options

### Schema Source

Choose one of:

#### `endpoint`

GraphQL endpoint URL to introspect.

```typescript
{
  endpoint: 'https://api.example.com/graphql',
}
```

#### `schema`

Path to local GraphQL schema file.

```typescript
{
  schema: './schema.graphql',
}
```

### Output

#### `output`

Directory for generated code.

```typescript
{
  output: './src/generated/hooks',  // Default: './generated/graphql'
}
```

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

Glob patterns for tables to exclude.

```typescript
{
  tables: {
    exclude: ['*_archive', 'temp_*', '_*'],
  },
}
```

### Query Filtering

#### `queries.include`

Custom queries to include. Default: all discovered queries.

```typescript
{
  queries: {
    include: ['currentUser', 'searchProducts'],
  },
}
```

#### `queries.exclude`

Custom queries to exclude. Default: `['_meta', 'query']`.

```typescript
{
  queries: {
    exclude: ['_meta', 'query', 'debug*'],
  },
}
```

### Mutation Filtering

#### `mutations.include` / `mutations.exclude`

Same pattern as queries.

```typescript
{
  mutations: {
    include: ['login', 'logout', 'create*', 'update*'],
    exclude: ['delete*'],  // Exclude all delete mutations
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

### ORM Options

#### `orm.output`

Separate output directory for ORM code.

```typescript
{
  orm: {
    output: './src/generated/orm',
  },
}
```

#### `orm.useSharedTypes`

Share types between hooks and ORM outputs.

```typescript
{
  orm: {
    useSharedTypes: true,
  },
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

Define multiple targets for different environments or schemas:

```typescript
export default defineConfig({
  targets: {
    development: {
      endpoint: 'http://localhost:5555/graphql',
      output: './src/generated/dev',
    },
    production: {
      endpoint: 'https://api.prod.example.com/graphql',
      output: './src/generated/prod',
      headers: {
        Authorization: `Bearer ${process.env.PROD_API_TOKEN}`,
      },
    },
    admin: {
      endpoint: 'https://admin-api.example.com/graphql',
      output: './src/generated/admin',
      tables: {
        include: ['AdminUser', 'AuditLog', 'Permission'],
      },
    },
  },
});
```

Generate specific target:

```bash
npx graphql-codegen generate -t production
npx graphql-codegen generate -t admin
```

## Complete Example

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  targets: {
    default: {
      // Schema source
      endpoint: process.env.GRAPHQL_ENDPOINT || 'http://localhost:5555/graphql',

      // Output
      output: './src/generated/hooks',

      // Authentication
      headers: {
        Authorization: `Bearer ${process.env.API_TOKEN}`,
      },

      // Include specific tables
      tables: {
        include: ['User', 'Post', 'Comment', 'Category'],
        exclude: ['*_archive', '_*'],
      },

      // Include specific custom queries
      queries: {
        include: ['currentUser', 'searchPosts', 'trending*'],
        exclude: ['_meta', 'query', 'debug*'],
      },

      // Include specific mutations
      mutations: {
        include: ['login', 'logout', 'create*', 'update*'],
        exclude: ['delete*'],
      },

      // Code generation options
      codegen: {
        maxFieldDepth: 2,
        skipQueryField: true,
      },

      // ORM configuration
      orm: {
        output: './src/generated/orm',
        useSharedTypes: true,
      },
    },
  },
});
```
