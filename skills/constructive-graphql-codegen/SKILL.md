---
name: constructive-graphql-codegen
description: Generate type-safe React Query hooks, Prisma-like ORM client, or inquirerer-based CLI from GraphQL endpoints, databases, or PGPM modules using @constructive-io/graphql-codegen. Also generates documentation (README, AGENTS.md, skills/, mcp.json). Use when asked to "generate GraphQL hooks", "generate ORM", "generate CLI", "set up codegen", "generate docs", "generate skills", or when implementing data fetching for a PostGraphile backend.
compatibility: Node.js 22+, PostgreSQL 14+, PostGraphile v5+ (optional)
metadata:
  author: constructive-io
  version: "3.1.x"
---

# Constructive GraphQL Codegen

Generate type-safe React Query hooks, Prisma-like ORM client, or inquirerer-based CLI from PostGraphile GraphQL endpoints. Also generates documentation in multiple formats.

## When to Apply

Use this skill when:
- Setting up GraphQL code generation for a PostGraphile backend
- User asks to generate hooks, ORM, CLI, or type-safe GraphQL client
- Generating documentation (README, AGENTS.md, skill files, MCP tool definitions)
- Implementing features that need to fetch or mutate data
- Using previously generated hooks, ORM, or CLI code
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

### Generate CLI

```bash
npx @constructive-io/graphql-codegen --cli -e https://api.example.com/graphql -o ./generated
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
  cli?: CliConfig | boolean; // Default: false — generate inquirerer CLI
  
  // Documentation (generated alongside code)
  docs?: DocsConfig | boolean; // Default: { readme: true, agents: true, mcp: false, skills: false }
  
  // Node.js HTTP adapter (auto-enabled when cli is true)
  nodeHttpAdapter?: boolean; // Default: false
  
  // Filtering
  tables?: { include?, exclude?, systemExclude? };
  queries?: { include?, exclude?, systemExclude? };
  mutations?: { include?, exclude?, systemExclude? };
  excludeFields?: string[];
  
  // Authentication
  headers?: Record<string, string>;
  authorization?: string;  // Convenience for Authorization header
  
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

## CLI Commands

**Note**: The CLI does not use subcommands. All options are passed directly to `graphql-codegen`.

| Command | Purpose |
|---------|---------|
| `npx @constructive-io/graphql-codegen` | Generate code (use `--react-query`, `--orm`, and/or `--cli` flags) |
| `npx @constructive-io/graphql-codegen --react-query` | Generate React Query hooks |
| `npx @constructive-io/graphql-codegen --orm` | Generate ORM client |
| `npx @constructive-io/graphql-codegen --cli` | Generate inquirerer-based CLI |
| `npx @constructive-io/graphql-codegen --react-query --orm --cli` | Generate all three |

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
| `--cli` | Generate inquirerer-based CLI |
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

// From database
export default defineConfig({
  db: {
    schemas: ['public', 'app_public'],  // Explicit schemas
    // OR
    apiNames: ['my_api'],  // Auto-discover schemas from API
  },
  output: './generated',
  reactQuery: true,
});

// From PGPM module
export default defineConfig({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  output: './generated',
  orm: true,
});
```

### CLI Generation

```typescript
export default defineConfig({
  endpoint: 'https://api.example.com/graphql',
  output: './generated',
  cli: true,  // Generate CLI with default tool name
  // OR with options:
  cli: {
    toolName: 'myapp',      // Config stored at ~/.myapp/
    entryPoint: true,        // Generate runnable index.ts
    builtinNames: {          // Override infra command names
      auth: 'credentials',
      context: 'env',
    },
  },
});
```

When `cli: true`, `nodeHttpAdapter` is auto-enabled (Node.js HTTP adapter for localhost subdomain resolution).

### Documentation Generation

```typescript
export default defineConfig({
  endpoint: 'https://api.example.com/graphql',
  output: './generated',
  orm: true,
  docs: true,  // Enable all doc formats
  // OR configure individually:
  docs: {
    readme: true,   // README.md — human-readable overview
    agents: true,   // AGENTS.md — structured for LLM consumption
    mcp: false,     // mcp.json — MCP tool definitions
    skills: true,   // skills/ — per-command .md skill files (Devin-compatible)
  },
});
```

**`docs.skills`**: Generates a `skills/` directory with individual `.md` files for each command. Compatible with Devin and similar agent skill systems. Each skill file contains description, usage, and examples.

**`docs.agents`**: Generates an `AGENTS.md` with tool definitions, exact signatures, input/output schemas, workflow recipes, and machine-parseable sections.

**`docs.mcp`**: Generates an `mcp.json` with MCP (Model Context Protocol) tool definitions. Each CLI command becomes a tool with typed JSON Schema `inputSchema`.

### Node.js HTTP Adapter

```typescript
export default defineConfig({
  endpoint: 'http://api.localhost:3000/graphql',
  output: './generated',
  orm: true,
  nodeHttpAdapter: true,  // Generates node-fetch.ts with NodeHttpAdapter
});
```

The `NodeHttpAdapter` uses `node:http`/`node:https` for requests, enabling local development with subdomain-based routing (e.g., `auth.localhost:3000`). No global patching required.

```typescript
import { NodeHttpAdapter } from './orm/node-fetch';
import { createClient } from './orm';

const db = createClient({
  adapter: new NodeHttpAdapter(endpoint, headers),
});
```

### Multi-Target Configuration

```typescript
// Simple multi-target
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
    cli: true,
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

## Using Generated CLI

When `cli: true` is set, codegen generates inquirerer-based CLI commands to `{output}/cli/`.

### Generated Structure

```
generated/cli/
  commands/           # One file per table + custom operations
    users.ts          # CRUD commands for users table
    posts.ts          # CRUD commands for posts table
    my-query.ts       # Custom query command
  command-map.ts      # Maps command names to handlers
  executor.ts         # Command executor with auth context
  utils.ts            # Shared utilities
  node-fetch.ts       # NodeHttpAdapter for localhost
  index.ts            # Entry point (if entryPoint: true)
```

### Running the CLI

If `entryPoint: true` is set:

```bash
npx ts-node generated/cli/index.ts
```

Or integrate the command map into your own CLI:

```typescript
import { commands } from './generated/cli/command-map';
import { Inquirerer } from 'inquirerer';

const prompter = new Inquirerer();
await commands.users.list(argv, prompter);
```

### Built-in Infrastructure Commands

The CLI includes infrastructure commands:
- **auth** (or `credentials` if name collides) — manage API credentials stored via appstash
- **context** (or `env` if name collides) — manage endpoint and auth context

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

## Schema Sources

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
| No CLI generated | Add `cli: true` to config |
| Schema not accessible | Verify endpoint URL and auth headers |
| Missing `_meta` query | Ensure PostGraphile v5+ with Meta plugin |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match |
| Auth errors at runtime | Check `configure()` headers are set |
| Localhost fetch errors (Node.js) | Enable `nodeHttpAdapter: true` for localhost subdomain resolution |
| No skill files generated | Set `docs: { skills: true }` in config |

## References

For detailed documentation on specific topics only when needed, see [references/](references/):

- CLI options and configuration: `cli-reference.md`, `config-reference.md`
- Advanced usage patterns: `hooks-patterns.md`, `orm-patterns.md`
- Error handling and relations: `error-handling.md`, `relations.md`
- Query key factory and cache management: `query-keys.md`
- Generated output structure: `hooks-output.md`, `orm-output.md`
