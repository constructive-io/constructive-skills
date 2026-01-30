---
name: constructive-graphql-codegen
description: Generate and use type-safe React Query hooks or Prisma-like ORM client from GraphQL endpoints, databases, or PGPM modules using @constructive-io/graphql-codegen v3.x. Use when asked to "generate GraphQL hooks", "generate ORM", "set up codegen", "use generated hooks", "query with ORM", "fetch data", or when implementing data fetching for a PostGraphile backend or PostgreSQL database.
compatibility: Node.js 22+, PostgreSQL 14+, PostGraphile v5+ (optional)
metadata:
  author: constructive-io
  version: "3.1.x"
---

# Constructive GraphQL Codegen

Generate type-safe React Query hooks or Prisma-like ORM client from PostGraphile GraphQL endpoints.

## When to Apply

Use this skill when:
- Setting up GraphQL code generation for a PostGraphile backend
- User asks to generate hooks, ORM, or type-safe GraphQL client
- Implementing features that need to fetch or mutate data
- Using previously generated hooks or ORM code
- Regenerating code after schema changes

**Important**: Always prefer generated code over raw GraphQL queries or SQL.

## Quick Start

### Installation

```bash
pnpm add @constructive-io/graphql-codegen
```

### Generate React Query Hooks

```bash
npx @constructive-io/graphql-codegen --react-query -e https://api.example.com/graphql -o ./generated
```

### Generate ORM Client

```bash
npx @constructive-io/graphql-codegen --orm -e https://api.example.com/graphql -o ./generated
```

### Generate from Database

```bash
npx @constructive-io/graphql-codegen --react-query --schemas public,app_public -o ./generated
```

## Programmatic API

Use the `generate()` function to integrate codegen into your build scripts or tools.

### Import and Basic Usage

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Generate from endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  output: './generated',
  reactQuery: true,
  orm: true,
});

// Node.js with undici dispatcher (fixes localhost DNS issues)
await generate({
  endpoint: 'http://api.localhost:3000/graphql',
  output: './generated',
  reactQuery: true,
  browserCompatible: false,  // Use undici with custom dispatcher
});
```

### Schema Sources

```typescript
// From GraphQL endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer token' },
  reactQuery: true,
});

// From schema file
await generate({
  schemaFile: './schema.graphql',
  output: './generated',
  orm: true,
});

// From database (explicit schemas)
await generate({
  db: { schemas: ['public', 'app_public'] },
  reactQuery: true,
});

// From database (auto-discover via API names)
await generate({
  db: { apiNames: ['my_api'] },
  orm: true,
});

// From PGPM module
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  reactQuery: true,
});
```

### Generate Options

```typescript
interface GenerateOptions {
  // Schema source (choose one)
  endpoint?: string;
  schemaFile?: string;
  db?: {
    config?: { host, port, database, user, password };
    schemas?: string[];
    apiNames?: string[];
    pgpm?: { modulePath, workspacePath, moduleName };
    keepDb?: boolean;
  };
  
  // Output
  output?: string;  // Default: './generated/graphql'
  
  // Generators
  reactQuery?: boolean;  // Default: false
  orm?: boolean;         // Default: false
  
  // Filtering
  tables?: { include?, exclude?, systemExclude? };
  queries?: { include?, exclude?, systemExclude? };
  mutations?: { include?, exclude?, systemExclude? };
  excludeFields?: string[];
  
  // Authentication
  headers?: Record<string, string>;
  authorization?: string;  // Convenience for Authorization header
  
  // Client Options
  browserCompatible?: boolean;  // Default: true (use false for Node.js with undici)
  
  // Options
  verbose?: boolean;
  dryRun?: boolean;
  skipCustomOperations?: boolean;
}
```

### Build Script Example

```typescript
// scripts/codegen.ts
import { generate } from '@constructive-io/graphql-codegen';

async function main() {
  console.log('Generating GraphQL code...');
  
  const result = await generate({
    endpoint: process.env.GRAPHQL_ENDPOINT!,
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
    },
    output: './src/generated',
    reactQuery: true,
    orm: true,
    tables: {
      include: ['User', 'Post', 'Comment'],
    },
  });
  
  if (!result.success) {
    console.error('Codegen failed:', result.error);
    process.exit(1);
  }
  
  console.log('✓ Code generated successfully');
}

main();
```

### Browser vs Node.js Compatibility

**`browserCompatible` option** (v3.1.x):
- **`true` (default)**: Generates browser-compatible client using standard `fetch`
- **`false`**: Generates Node.js client with undici dispatcher for proper `*.localhost` DNS resolution

```typescript
// Node.js environment with localhost subdomains
await generate({
  endpoint: 'http://api.localhost:3000/graphql',
  reactQuery: true,
  browserCompatible: false,  // Fixes DNS resolution on macOS
});

// Browser/universal environment
await generate({
  endpoint: 'https://api.example.com/graphql',
  reactQuery: true,
  browserCompatible: true,  // Default
});
```

## CLI Commands

**Note**: The CLI does not use subcommands. All options are passed directly to `graphql-codegen`.

| Command | Purpose |
|---------|---------|
| `npx @constructive-io/graphql-codegen` | Generate code (use `--react-query` and/or `--orm` flags) |
| `npx @constructive-io/graphql-codegen --react-query` | Generate React Query hooks |
| `npx @constructive-io/graphql-codegen --orm` | Generate ORM client |
| `npx @constructive-io/graphql-codegen --react-query --orm` | Generate both hooks and ORM |

### Common Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | GraphQL endpoint URL |
| `-s, --schema-file <path>` | Path to GraphQL schema file |
| `--schemas <list>` | PostgreSQL schemas (comma-separated) |
| `--api-names <list>` | API names for auto schema discovery |
| `-o, --output <dir>` | Output directory (default: `./generated/graphql`) |
| `-c, --config <path>` | Config file path |
| `--react-query` | Generate React Query hooks |
| `--orm` | Generate ORM client |
| `-a, --authorization <token>` | Authorization header |
| `-t, --target <name>` | Target name in multi-target config |
| `--dry-run` | Preview without writing |
| `-v, --verbose` | Show detailed output |

## Configuration File

Create a configuration file manually:

**File: `graphql-codegen.config.ts`**

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

// From GraphQL endpoint
export default defineConfig({
  endpoint: 'https://api.example.com/graphql',
  output: './generated',
  reactQuery: true,  // Generate React Query hooks
  orm: true,         // Generate ORM client
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});

// From database (new in v3.0)
export default defineConfig({
  db: {
    schemas: ['public', 'app_public'],  // Explicit schemas
    // OR
    apiNames: ['my_api'],  // Auto-discover schemas from API
  },
  output: './generated',
  reactQuery: true,
});

// From PGPM module (new in v3.0)
export default defineConfig({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  output: './generated',
  orm: true,
});
```

### Multi-Target Configuration

```typescript
// Simple multi-target (v3.0 - no 'targets' wrapper needed)
export default defineConfig({
  public: {
    endpoint: 'https://api.example.com/graphql',
    output: './generated/public',
    reactQuery: true,
  },
  admin: {
    db: { schemas: ['admin'] },
    output: './generated/admin',
    orm: true,
  },
});
```

## Using Generated Hooks

### Configure Client (once at app startup)

```typescript
import { configure } from '@/generated/hooks';

configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${getToken()}` },
});
```

### Query Data

```typescript
import { useUsersQuery } from '@/generated/hooks';

function UserList() {
  const { data, isLoading } = useUsersQuery({
    first: 10,
    filter: { role: { eq: 'ADMIN' } },
  });

  if (isLoading) return <Spinner />;
  return <ul>{data?.users?.nodes.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### Mutate Data

```typescript
import { useCreateUserMutation } from '@/generated/hooks';

function CreateUser() {
  const createUser = useCreateUserMutation();

  return (
    <button onClick={() => createUser.mutate({ input: { name: 'John' } })}>
      Create
    </button>
  );
}
```

## Using Generated ORM

### Create Client

```typescript
import { createClient } from '@/generated/orm';

export const db = createClient({
  endpoint: process.env.GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
});
```

### Query Data

```typescript
const users = await db.user.findMany({
  select: { id: true, name: true, email: true },
  filter: { role: { eq: 'ADMIN' } },
  first: 10,
}).execute().unwrap();
```

### Relations

```typescript
const posts = await db.post.findMany({
  select: {
    id: true,
    title: true,
    author: { select: { id: true, name: true } },
  },
}).execute().unwrap();

// posts[0].author.name is fully typed
```

### Error Handling

```typescript
const result = await db.user.findOne({ id: '123' }).execute();

if (result.ok) {
  console.log(result.value.name);
} else {
  console.error(result.error.message);
}

// Or use helpers
const user = await db.user.findOne({ id }).execute().unwrap(); // throws on error
const user = await db.user.findOne({ id }).execute().unwrapOr(defaultUser);
```

## Schema Sources (v3.0)

### From GraphQL Endpoint

```bash
npx @constructive-io/graphql-codegen --react-query -e https://api.example.com/graphql
```

### From Database

```bash
# Explicit schemas
npx @constructive-io/graphql-codegen --orm --schemas public,app_public

# Auto-discover from API names
npx @constructive-io/graphql-codegen --react-query --api-names my_api
```

### From PGPM Module

```typescript
// In config file
export default defineConfig({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  reactQuery: true,
});
```

**Note:** The CLI does not have an `init` subcommand. Create config files manually. Watch mode was removed in v3.0 - use file watchers or development tools instead.

## Query Key Factory (React Query)

Generated hooks include a centralized query key factory for type-safe cache management:

```typescript
import { userKeys, invalidate, remove } from '@/generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate queries (triggers refetch)
invalidate.user.all(queryClient);        // All user queries
invalidate.user.lists(queryClient);      // All list queries
invalidate.user.detail(queryClient, id); // Specific user

// Remove from cache (for delete operations)
remove.user(queryClient, userId);

// Track in-flight mutations
import { userMutationKeys } from '@/generated/hooks';
import { useIsMutating } from '@tanstack/react-query';

const isMutating = useIsMutating({ mutationKey: userMutationKeys.all });
```

See `references/query-keys.md` for details.

## Filter Syntax

```typescript
// Comparison
filter: { age: { eq: 25 } }
filter: { age: { gte: 18, lt: 65 } }
filter: { status: { in: ['ACTIVE', 'PENDING'] } }

// String
filter: { name: { contains: 'john' } }
filter: { email: { endsWith: '.com' } }

// Logical
filter: {
  OR: [
    { role: { eq: 'ADMIN' } },
    { role: { eq: 'MODERATOR' } },
  ],
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No hooks generated | Add `reactQuery: true` to config  |
| Schema not accessible | Verify endpoint URL and auth headers |
| Missing `_meta` query | Ensure PostGraphile v5+ with Meta plugin |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match |
| Auth errors at runtime | Check `configure()` headers are set |
| Localhost fetch errors (Node.js) | Set `browserCompatible: false` to use undici dispatcher |
| `*.localhost` DNS issues on macOS | Use `browserCompatible: false` for proper subdomain resolution |

## References

For detailed documentation on specific topics only when needed, see [references/](references/):

- CLI options and configuration: `config-reference.md`
- Advanced usage patterns: `hooks-patterns.md`, `orm-patterns.md`
- Error handling and relations: `error-handling.md`, `relations.md`
- Query key factory and cache management: `query-keys.md`
