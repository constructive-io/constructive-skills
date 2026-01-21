# CLI Reference

Complete reference for `@constructive-io/graphql-codegen` CLI commands.

## @constructive-io/graphql-codegen generate

Generate React Query hooks from a PostGraphile GraphQL endpoint.

```bash
npx @constructive-io/graphql-codegen generate [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required (or use config) |
| `--output <dir>` | `-o` | Output directory | `./generated/graphql` |
| `--config <path>` | `-c` | Config file path | `@constructive-io/graphql-codegen.config.ts` |
| `--target <name>` | `-t` | Target name in config | `default` |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--dry-run` | - | Preview without writing files | `false` |
| `--skip-custom-operations` | - | Only generate table CRUD hooks | `false` |

### Examples

```bash
# Basic generation
npx @constructive-io/graphql-codegen generate -e https://api.example.com/graphql

# With custom output directory
npx @constructive-io/graphql-codegen generate -e https://api.example.com/graphql -o ./src/hooks

# With authorization
npx @constructive-io/graphql-codegen generate -e https://api.example.com/graphql -a "Bearer token123"

# Using config file
npx @constructive-io/graphql-codegen generate -c ./config/@constructive-io/graphql-codegen.config.ts

# Specific target from config
npx @constructive-io/graphql-codegen generate -t production

# Preview changes without writing
npx @constructive-io/graphql-codegen generate -e https://api.example.com/graphql --dry-run
```

## @constructive-io/graphql-codegen generate-orm

Generate Prisma-like ORM client from a PostGraphile GraphQL endpoint.

```bash
npx @constructive-io/graphql-codegen generate-orm [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required (or use config) |
| `--output <dir>` | `-o` | Output directory | `./generated/orm` |
| `--config <path>` | `-c` | Config file path | `@constructive-io/graphql-codegen.config.ts` |
| `--target <name>` | `-t` | Target name in config | `default` |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--skip-custom-operations` | - | Only generate table models | `false` |

### Examples

```bash
# Basic ORM generation
npx @constructive-io/graphql-codegen generate-orm -e https://api.example.com/graphql

# With custom output
npx @constructive-io/graphql-codegen generate-orm -e https://api.example.com/graphql -o ./src/db

# Generate both hooks and ORM
npx @constructive-io/graphql-codegen generate -c @constructive-io/graphql-codegen.config.ts
npx @constructive-io/graphql-codegen generate-orm -c @constructive-io/graphql-codegen.config.ts
```

## @constructive-io/graphql-codegen init

Create a configuration file interactively.

```bash
npx @constructive-io/graphql-codegen init [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--format <format>` | `-f` | Config format: `ts`, `js`, `json` | `ts` |
| `--output <path>` | `-o` | Output file path | `./@constructive-io/graphql-codegen.config.ts` |

### Examples

```bash
# Create TypeScript config (default)
npx @constructive-io/graphql-codegen init

# Create JavaScript config
npx @constructive-io/graphql-codegen init -f js

# Create JSON config
npx @constructive-io/graphql-codegen init -f json -o ./config/@constructive-io/graphql-codegen.json
```

## @constructive-io/graphql-codegen introspect

Inspect a GraphQL schema without generating code. Useful for debugging and verifying schema access.

```bash
npx @constructive-io/graphql-codegen introspect [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | Required |
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--json` | - | Output as JSON | `false` |

### Examples

```bash
# Inspect schema
npx @constructive-io/graphql-codegen introspect -e https://api.example.com/graphql

# Output as JSON for processing
npx @constructive-io/graphql-codegen introspect -e https://api.example.com/graphql --json

# With authorization
npx @constructive-io/graphql-codegen introspect -e https://api.example.com/graphql -a "Bearer token"
```

### Output

Without `--json`, outputs human-readable summary:
- Tables discovered via `_meta` query
- Custom queries found
- Custom mutations found
- Schema statistics

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
