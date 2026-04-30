# Generate CLI

Generate an interactive command-line interface (CLI) from a GraphQL schema using inquirerer. The generated CLI provides CRUD commands for each table and custom operations, plus built-in infrastructure commands for authentication and context management via appstash.

## When to Use

- Building a CLI tool to interact with a PostGraphile GraphQL API
- User asks to "generate CLI", "create a CLI tool", or "build a command-line client"
- You need a quick way to interact with an API from the terminal
- Building internal tooling or admin scripts

## Programmatic API

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Basic CLI generation
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: true,
});

// CLI with options
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: {
    toolName: 'myapp',       // Config stored at ~/.myapp/ via appstash
    entryPoint: true,         // Generate runnable index.ts
    builtinNames: {           // Override infra command names
      auth: 'credentials',   // Rename 'auth' command to 'credentials'
      context: 'env',        // Rename 'context' command to 'env'
    },
  },
});
```

## Important Behavior

- **ORM is always generated alongside CLI**: The CLI uses the ORM client internally. When `cli: true`, the ORM is auto-generated even if `orm` is not explicitly set.
- **Default tool name**: If `toolName` is not specified, defaults to `'app'`.

## CLI Configuration Options

```typescript
interface CliConfig {
  /**
   * Tool name for appstash config storage (e.g., 'myapp' stores at ~/.myapp/)
   * @default derived from output directory name, or 'app'
   */
  toolName?: string;

  /**
   * Override infra command names when they collide with target/table names.
   * Defaults: auth -> 'auth' (renamed to 'credentials' on collision),
   *           context -> 'context' (renamed to 'env' on collision)
   */
  builtinNames?: {
    auth?: string;
    context?: string;
  };

  /**
   * Generate a runnable index.ts entry point.
   * When true, generates an index.ts that imports the command map,
   * handles --version and --tty flags, and starts the inquirerer CLI.
   * @default false
   */
  entryPoint?: boolean;
}
```

## Output Structure

```
{output}/cli/
├── index.ts              # Entry point (only if entryPoint: true)
├── executor.ts           # CLI executor with command routing
├── command-map.ts        # Map of all commands (table + custom + infra)
├── context.ts            # Infrastructure: context management command
├── auth.ts               # Infrastructure: auth/credentials command
├── utils.ts              # Shared CLI utilities
└── commands/
    ├── users.ts           # Generated CRUD commands for 'users' table
    ├── posts.ts           # Generated CRUD commands for 'posts' table
    └── ...                # One file per table + custom operations
```

## Running the Generated CLI

### With entry point (`entryPoint: true`)

```bash
npx ts-node generated/cli/index.ts
# Or compile and run
npx tsc && node dist/generated/cli/index.js
```

### Without entry point (integrate into your own CLI)

```typescript
import { commands } from './generated/cli/command-map';
import { Inquirerer } from 'inquirerer';

const prompter = new Inquirerer();

// Run a specific command
await commands.users.list(argv, prompter);
await commands.users.get(argv, prompter);
await commands.users.create(argv, prompter);
await commands.users.update(argv, prompter);
await commands.users.delete(argv, prompter);
```

## Built-in Infrastructure Commands

The generated CLI includes two infrastructure commands:

### context -- Manage API endpoints and environments

```bash
myapp context create production --endpoint https://api.example.com/graphql
myapp context create staging --endpoint https://staging.example.com/graphql
myapp context list
myapp context use production
myapp context current
myapp context delete staging
```

Configuration is stored at `~/.{toolName}/config/` via appstash.

### auth -- Manage API credentials

```bash
myapp auth set-token <your-bearer-token>
myapp auth status
myapp auth logout
```

The token is stored per-context and automatically included as an `Authorization: Bearer` header in all requests.

### Builtin Name Collision Handling

If a table name collides with `auth` or `context`, the infrastructure command is automatically renamed:
- `auth` -> `credentials`
- `context` -> `env`

You can override these names explicitly:

```typescript
cli: {
  toolName: 'myapp',
  builtinNames: {
    auth: 'credentials',
    context: 'environments',
  },
}
```

## Multi-Target CLI (Unified)

When using `generateMulti()` with `unifiedCli`, all targets are combined into a single CLI with namespaced commands:

```typescript
import { generateMulti } from '@constructive-io/graphql-codegen';

await generateMulti({
  configs: {
    public: {
      schemaFile: './schemas/public.graphql',
      output: './generated/public',
      cli: true,
    },
    admin: {
      schemaFile: './schemas/admin.graphql',
      output: './generated/admin',
      cli: true,
    },
  },
  unifiedCli: {
    toolName: 'myapp',
    entryPoint: true,
  },
});
// Commands: myapp public users list, myapp admin users list, etc.
```

## Documentation for Generated CLI

When `docs` is enabled, the codegen generates documentation specific to the CLI:

```typescript
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: true,
  docs: {
    readme: true,   // README.md with command reference
    agents: true,   // AGENTS.md for LLM consumption
    mcp: true,      // mcp.json with CLI commands as MCP tools
    skills: true,   // Per-command skill files
  },
});
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No CLI generated | Add `cli: true` to generate options |
| `command not found` after generation | Use `npx ts-node` or compile TypeScript first |
| Auth errors | Run `{toolName} auth set-token <token>` to set credentials |
| Wrong endpoint | Run `{toolName} context use <name>` to switch contexts |
| Command name collision with `auth`/`context` | Use `builtinNames` to rename infrastructure commands |
