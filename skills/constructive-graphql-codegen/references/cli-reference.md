# CLI Reference

Complete reference for `graphql-codegen` CLI commands.

## graphql-codegen generate

Generate React Query hooks from a PostGraphile GraphQL endpoint.

```bash
npx graphql-codegen generate [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required (or use config) |
| `--schema <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--output <dir>` | `-o` | Output directory | `./generated/graphql` |
| `--config <path>` | `-c` | Config file path | `graphql-codegen.config.ts` |
| `--target <name>` | `-t` | Target name in config | `default` |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--verbose` | `-v` | Verbose output | `false` |
| `--dry-run` | - | Preview without writing files | `false` |
| `--watch` | `-w` | Watch mode - auto-regenerate on schema changes | `false` |
| `--poll-interval <ms>` | - | Polling interval in milliseconds | `3000` |
| `--debounce <ms>` | - | Debounce delay before regenerating | `800` |
| `--touch <file>` | - | File to touch on schema change | - |
| `--no-clear` | - | Don't clear terminal on regeneration | - |

### Examples

```bash
# Basic generation
npx graphql-codegen generate -e https://api.example.com/graphql

# With custom output directory
npx graphql-codegen generate -e https://api.example.com/graphql -o ./generated/hooks

# With authorization
npx graphql-codegen generate -e https://api.example.com/graphql -a "Bearer token123"

# Using config file
npx graphql-codegen generate -c ./graphql-codegen.config.ts

# Specific target from config
npx graphql-codegen generate -t production

# Preview changes without writing
npx graphql-codegen generate -e https://api.example.com/graphql --dry-run

# Watch mode for development
npx graphql-codegen generate --watch
npx graphql-codegen generate --watch --poll-interval 5000 --debounce 1000

# From schema file instead of endpoint
npx graphql-codegen generate -s ./schema.graphql -o ./generated/hooks
```

## graphql-codegen generate-orm

Generate Prisma-like ORM client from a PostGraphile GraphQL endpoint.

```bash
npx graphql-codegen generate-orm [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required (or use config) |
| `--schema <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--output <dir>` | `-o` | Output directory | `./generated/orm` |
| `--config <path>` | `-c` | Config file path | `graphql-codegen.config.ts` |
| `--target <name>` | `-t` | Target name in config | `default` |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--verbose` | `-v` | Verbose output | `false` |
| `--dry-run` | - | Preview without writing files | `false` |
| `--skip-custom-operations` | - | Only generate table models | `false` |
| `--watch` | `-w` | Watch mode - auto-regenerate on schema changes | `false` |
| `--poll-interval <ms>` | - | Polling interval in milliseconds | `3000` |
| `--debounce <ms>` | - | Debounce delay before regenerating | `800` |
| `--touch <file>` | - | File to touch on schema change | - |
| `--no-clear` | - | Don't clear terminal on regeneration | - |

### Examples

```bash
# Basic ORM generation
npx graphql-codegen generate-orm -e https://api.example.com/graphql

# With custom output
npx graphql-codegen generate-orm -e https://api.example.com/graphql -o ./generated/db

# Watch mode for development
npx graphql-codegen generate-orm --watch

# Skip custom operations (only table CRUD)
npx graphql-codegen generate-orm -e https://api.example.com/graphql --skip-custom-operations

# Generate both hooks and ORM
npx graphql-codegen generate -c graphql-codegen.config.ts
npx graphql-codegen generate-orm -c graphql-codegen.config.ts
```

## graphql-codegen init

Create a configuration file interactively.

```bash
npx graphql-codegen init [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--directory <dir>` | `-d` | Target directory for config file | `.` |
| `--force` | `-f` | Force overwrite existing config | `false` |
| `--endpoint <url>` | `-e` | GraphQL endpoint URL to pre-populate | - |
| `--output <dir>` | `-o` | Output directory to pre-populate | `./generated` |

### Examples

```bash
# Create config (default: graphql-codegen.config.ts)
npx graphql-codegen init

# Pre-populate with endpoint and output
npx graphql-codegen init -e https://api.example.com/graphql -o ./generated/hooks

# Force overwrite existing config
npx graphql-codegen init --force
```

## graphql-codegen introspect

Inspect a GraphQL schema without generating code. Useful for debugging and verifying schema access.

```bash
npx graphql-codegen introspect [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required (or --schema) |
| `--schema <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--json` | - | Output as JSON | `false` |

### Examples

```bash
# Inspect schema from endpoint
npx graphql-codegen introspect -e https://api.example.com/graphql

# Inspect schema from file
npx graphql-codegen introspect -s ./schema.graphql

# Output as JSON for processing
npx graphql-codegen introspect -e https://api.example.com/graphql --json

# With authorization
npx graphql-codegen introspect -e https://api.example.com/graphql -a "Bearer token"
```

### Output

Without `--json`, outputs human-readable summary:
- Tables discovered via introspection
- Field counts and relation counts per table
- Total tables found

With `--json`, outputs structured data for programmatic use.

## Environment Variables

The CLI respects these environment variables:

| Variable | Description |
|----------|-------------|
| `GRAPHQL_ENDPOINT` | Default endpoint URL |
| `GRAPHQL_AUTH_TOKEN` | Default authorization token |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error |
| `3` | Network/schema error |
