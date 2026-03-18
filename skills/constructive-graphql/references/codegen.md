# Code Generation

Detailed reference for the `@constructive-io/graphql-codegen` programmatic API, schema sources, multi-target generation, and documentation generation.

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

## Schema Sources

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

## Schema Export

Export a schema to a `.graphql` SDL file without generating code. Useful for creating portable, version-controllable schema artifacts:

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Export from database
await generate({
  db: { schemas: ['public'] },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'public.graphql',
});

// Export from PGPM module
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['app_public'],
  },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'app_public.graphql',
});

// Export from endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
});
```

## Multi-Target Generation

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

## Documentation Generation

```typescript
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  orm: true,
  docs: true,  // Enable all doc formats
  // OR configure individually:
  docs: {
    readme: true,   // README.md
    agents: true,   // AGENTS.md (thin router -- see below)
    mcp: false,     // mcp.json (MCP tool definitions)
    skills: true,   // skills/ (per-command .md skill files)
  },
});
```

### Thin AGENTS.md Pattern

When `docs.agents: true`, the codegen generates a thin **AGENTS.md** file that acts as a router -- it lists available skills and reference files rather than duplicating their content. This keeps the AGENTS.md small and points agents to the detailed per-entity skill files in `skills/`.

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

## Build Script Example

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
