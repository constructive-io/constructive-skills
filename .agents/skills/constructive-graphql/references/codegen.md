---
name: constructive-graphql-codegen
description: Generate type-safe React Query hooks, Prisma-like ORM client, or inquirerer-based CLI from GraphQL endpoints, schema files/directories, databases, or PGPM modules using @constructive-io/graphql-codegen. Also generates documentation (README, AGENTS.md, skills/, mcp.json). Use when asked to "generate GraphQL hooks", "generate ORM", "generate CLI", "set up codegen", "generate docs", "generate skills", "export schema", or when implementing data fetching for a PostGraphile backend.
compatibility: Node.js 22+, PostgreSQL 14+, PostGraphile v5+ (optional)
metadata:
  author: constructive-io
  version: "4.5.x"
---

# Constructive GraphQL Codegen

Generate type-safe React Query hooks, Prisma-like ORM client, or inquirerer-based CLI from GraphQL schema files, endpoints, databases, or PGPM modules. Also generates documentation in multiple formats.

## When to Apply

Use this skill when:
- Setting up GraphQL code generation for a PostGraphile backend
- User asks to generate hooks, ORM, CLI, or type-safe GraphQL client
- Exporting a GraphQL schema from a database or endpoint
- Generating documentation (README, AGENTS.md, skill files, MCP tool definitions)
- Implementing features that need to fetch or mutate data
- Using previously generated hooks, ORM, or CLI code
- Regenerating code after schema changes

**Important**: Always prefer generated code over raw GraphQL queries or SQL.

## Installation

```bash
pnpm add @constructive-io/graphql-codegen
```

## Programmatic API

The `generate()` function is the primary entry point. All code generation goes through this function -- the CLI and config files are thin wrappers around it.

### Basic Usage

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Generate from a schema file
await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
});

// Generate from an endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
});

// Generate from a database
await generate({
  db: { schemas: ['public', 'app_public'] },
  output: './src/generated',
  reactQuery: true,
});

// Generate from a PGPM module
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['app_public'],
  },
  output: './src/generated',
  orm: true,
});
```

### Schema Sources

The codegen supports multiple schema sources. Choose the one that fits your workflow:

| Source | Config Key | Best For |
|--------|-----------|----------|
| Schema file | `schemaFile: './schema.graphql'` | Simple projects, deterministic builds |
| Schema directory | `schemaDir: './schemas'` | Multi-target from `.graphql` files |
| PGPM module (path) | `db.pgpm.modulePath` | Schema from a pgpm module |
| PGPM workspace | `db.pgpm.workspacePath + moduleName` | Schema from a pgpm workspace |
| Database | `db.schemas` or `db.apiNames` | Live database introspection |
| Endpoint | `endpoint` | Running GraphQL server |

```typescript
// From schema file
await generate({
  schemaFile: './schema.graphql',
  output: './generated',
  orm: true,
});

// From endpoint with auth
await generate({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer token' },
  reactQuery: true,
});

// From database (auto-discover via API names)
await generate({
  db: { apiNames: ['my_api'] },
  orm: true,
});

// From PGPM module (creates ephemeral DB, deploys, introspects, tears down)
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  reactQuery: true,
});

// From PGPM workspace + module name
await generate({
  db: {
    pgpm: {
      workspacePath: '.',
      moduleName: 'my-module',
    },
    schemas: ['app_public'],
  },
  orm: true,
});
```

### Schema Export

Export a schema to a `.graphql` SDL file without generating code. Useful for creating portable, version-controllable schema artifacts:

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Export from database
await generate({
  db: { schemas: ['public'] },
  schema: { enabled: true, output: './schemas', filename: 'public.graphql' },
});

// Export from PGPM module
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['app_public'],
  },
  schema: { enabled: true, output: './schemas', filename: 'app_public.graphql' },
});

// Export from endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  schema: { enabled: true, output: './schemas' },
});
```

### Multi-Target Generation

Use `generateMulti()` for generating from multiple schema sources in a single run:

```typescript
import { generate, generateMulti } from '@constructive-io/graphql-codegen';

// Option 1: Use schemaDir (auto-expands .graphql files to targets)
// Given schemas/public.graphql and schemas/admin.graphql:
await generate({
  schemaDir: './schemas',
  output: './generated',
  reactQuery: true,
  orm: true,
});
// Produces: generated/public/{hooks,orm}/, generated/admin/{hooks,orm}/

// Option 2: Explicit multi-target with generateMulti()
await generateMulti({
  configs: {
    public: {
      schemaFile: './schemas/public.graphql',
      output: './generated/public',
      reactQuery: true,
    },
    admin: {
      schemaFile: './schemas/admin.graphql',
      output: './generated/admin',
      orm: true,
    },
  },
});

// Option 3: Multiple API names auto-expand
await generate({
  db: { apiNames: ['public', 'admin'] },
  output: './generated',
  orm: true,
});
// Each API name becomes a target: generated/public/, generated/admin/
```

When multiple targets share the same PGPM module, the codegen automatically deduplicates ephemeral database creation.

### GenerateOptions

```typescript
interface GenerateOptions {
  // Schema source (choose one)
  endpoint?: string;
  schemaFile?: string;
  schemaDir?: string;       // Directory of .graphql files -- auto-expands to multi-target
  db?: {
    config?: { host, port, database, user, password };
    schemas?: string[];
    apiNames?: string[];    // Auto-discover schemas from services_public.api_schemas
    pgpm?: { modulePath, workspacePath, moduleName };
    keepDb?: boolean;       // Keep ephemeral DB after introspection (debugging)
  };

  // Output
  output?: string;  // Default: './generated/graphql'

  // Generators
  reactQuery?: boolean;  // Default: false
  orm?: boolean;         // Default: false
  cli?: CliConfig | boolean; // Default: false

  // Schema export (instead of code generation)
  schema?: {
    enabled?: boolean;           // Enable schema export mode
    output?: string;             // Output directory (default: same as output)
    filename?: string;           // Default: 'schema.graphql'
  };

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
  const result = await generate({
    schemaFile: './schemas/public.graphql',
    output: './src/generated',
    reactQuery: true,
    orm: true,
    tables: {
      include: ['User', 'Post', 'Comment'],
    },
  });

  if (!result.success) {
    console.error('Codegen failed:', result.message);
    process.exit(1);
  }

  console.log(result.message);
}

main();
```

### Documentation Generation

```typescript
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  orm: true,
  docs: true,  // Enable all doc formats
  // OR configure individually:
  docs: {
    readme: true,   // README.md
    agents: true,   // AGENTS.md (thin router — see below)
    mcp: false,     // mcp.json (MCP tool definitions)
    skills: true,   // skills/ (per-command .md skill files)
  },
});
```

### Thin AGENTS.md Pattern

When `docs.agents: true`, the codegen generates a thin **AGENTS.md** file that acts as a router — it lists available skills and reference files rather than duplicating their content. This keeps the AGENTS.md small and points agents to the detailed per-entity skill files in `skills/`.

The generated AGENTS.md includes:
- A summary of available entities and operations
- Links to per-entity skill files in `skills/`
- **Special field categories** that flag non-standard fields:
  - **PostGIS fields** (geometry/geography columns)
  - **pgvector fields** (vector embedding columns)
  - **Unified Search fields** (search score, rank, similarity, distance computed fields)

The special field categorization helps agents understand which fields are computed search scores vs. regular data columns, and routes them to the `graphile-search` skill for search-related documentation.

### Filtering Search Fields in Generated Docs

The codegen provides a `getSearchFields()` utility that categorizes computed fields by their search adapter origin:

```typescript
import { getSearchFields } from '@constructive-io/graphql-codegen';

const searchFields = getSearchFields(schema);
// Returns: { tsvector: [...], bm25: [...], trgm: [...], pgvector: [...] }
```

### Node.js HTTP Adapter

For Node.js apps using subdomain-based routing (e.g., `auth.localhost:3000`):

```typescript
await generate({
  endpoint: 'http://api.localhost:3000/graphql',
  output: './generated',
  orm: true,
  nodeHttpAdapter: true,  // Generates node-fetch.ts with NodeHttpAdapter
});
```

See `references/node-http-adapter.md` for usage details.

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

See `references/hooks-patterns.md` and `references/hooks-output.md` for advanced patterns.

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

See `references/orm-patterns.md` and `references/orm-output.md` for advanced patterns.

## Using Generated CLI

When `cli: true` is set, codegen generates inquirerer-based CLI commands to `{output}/cli/`.

```typescript
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: true,
  // OR with options:
  cli: {
    toolName: 'myapp',
    entryPoint: true,
    builtinNames: {
      auth: 'credentials',
      context: 'env',
    },
  },
});
```

When `cli: true`, `nodeHttpAdapter` is auto-enabled.

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

The CLI includes built-in infrastructure commands:
- **auth** (or `credentials` if name collides) -- manage API credentials
- **context** (or `env` if name collides) -- manage endpoint and auth context

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

## Query Key Factory (React Query)

Generated hooks include a centralized query key factory for type-safe cache management:

```typescript
import { userKeys, invalidate, remove } from '@/generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate queries (triggers refetch)
invalidate.user.all(queryClient);
invalidate.user.lists(queryClient);
invalidate.user.detail(queryClient, id);

// Remove from cache (for delete operations)
remove.user(queryClient, userId);
```

See `references/query-keys.md` for details.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No hooks generated | Add `reactQuery: true` |
| No CLI generated | Add `cli: true` |
| Schema not accessible | Verify endpoint URL and auth headers |
| Missing `_meta` query | Ensure PostGraphile v5+ with Meta plugin |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match |
| Auth errors at runtime | Check `configure()` headers are set |
| Localhost fetch errors (Node.js) | Enable `nodeHttpAdapter: true` |
| No skill files generated | Set `docs: { skills: true }` |
| Schema export produces empty file | Verify database/endpoint has tables in the specified schemas |
| `schemaDir` generates nothing | Ensure directory contains `.graphql` files (not `.gql` or other extensions) |
| Search fields not categorized in docs | Ensure `graphile-search` (`UnifiedSearchPreset`) is in PostGraphile preset |

## References

All references are in [references/](references/).

### Workflow Guides

Each major codegen workflow has a dedicated reference with full examples and options:

- **`generate-schemas.md`** -- Export GraphQL schemas to `.graphql` files (schema export workflow)
- **`generate-sdk.md`** -- Generate React Query hooks and/or ORM client (primary SDK workflow)
- **`generate-cli.md`** -- Generate inquirerer-based CLI with CRUD commands
- **`generate-node.md`** -- Generate NodeHttpAdapter for `*.localhost` subdomain routing

### Deep-Dive References

- **Using generated code**: `hooks-patterns.md`, `hooks-output.md`, `orm-patterns.md`, `orm-output.md`
- **Error handling and relations**: `error-handling.md`, `relations.md`
- **Query key factory and cache management**: `query-keys.md`
- **Node.js HTTP adapter (manual)**: `node-http-adapter.md`
- **CLI flags**: `cli-reference.md`
- **Configuration file (`defineConfig`)**: `config-reference.md`
