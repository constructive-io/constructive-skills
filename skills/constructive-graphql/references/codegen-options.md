# GenerateOptions Reference

Full interface reference for the `generate()` function from `@constructive-io/graphql-codegen`.

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
  schemaOnly?: boolean;
  schemaOnlyOutput?: string;
  schemaOnlyFilename?: string;   // Default: 'schema.graphql'

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

## Schema Sources

| Source | Config Key | Best For |
|--------|-----------|----------|
| Schema file | `schemaFile: './schema.graphql'` | Simple projects, deterministic builds |
| Schema directory | `schemaDir: './schemas'` | Multi-target from `.graphql` files |
| PGPM module (path) | `db.pgpm.modulePath` | Schema from a pgpm module |
| PGPM workspace | `db.pgpm.workspacePath + moduleName` | Schema from a pgpm workspace |
| Database | `db.schemas` or `db.apiNames` | Live database introspection |
| Endpoint | `endpoint` | Running GraphQL server |

## Filtering

Glob patterns for include/exclude:

| Pattern | Matches |
|---------|---------|
| `*` | Any string |
| `?` | Single character |
| `User` | Exact match "User" |
| `User*` | "User", "UserProfile", "UserSettings" |
| `*_archive` | "posts_archive", "users_archive" |

```typescript
await generate({
  schemaFile: './schema.graphql',
  output: './generated',
  orm: true,
  tables: {
    include: ['User', 'Post', 'Comment'],
    exclude: ['*_archive', '_*'],
  },
  queries: {
    include: ['currentUser', 'searchPosts'],
    exclude: ['debug*'],
  },
  mutations: {
    include: ['login', 'create*', 'update*'],
    exclude: ['delete*'],
  },
  excludeFields: ['__typename', 'internalId'],
});
```

## Documentation Options

```typescript
docs: {
  readme: true,   // README.md
  agents: true,   // AGENTS.md (thin router)
  mcp: false,     // mcp.json (MCP tool definitions)
  skills: true,   // skills/ (per-command .md skill files)
}
```

## CLI Options

```typescript
cli: {
  toolName: 'myapp',      // Config stored at ~/.myapp/
  entryPoint: true,        // Generate runnable index.ts
  builtinNames: {          // Override infra command names
    auth: 'credentials',
    context: 'env',
  },
}
```

When `cli: true`, `nodeHttpAdapter` is auto-enabled.

## Query Key Options

```typescript
queryKeys: {
  style: 'hierarchical',          // or 'flat'
  generateScopedKeys: true,
  generateCascadeHelpers: true,
  generateMutationKeys: true,
  relationships: {
    table: { parent: 'database', foreignKey: 'databaseId' },
    field: { parent: 'table', foreignKey: 'tableId' },
  },
}
```
