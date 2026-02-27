# CLI Reference

Complete reference for `@constructive-io/graphql-codegen` CLI.

**Note**: The CLI does not use subcommands. All options are passed directly to `graphql-codegen`.

```bash
npx @constructive-io/graphql-codegen [options]
```

### Source Options (choose one)

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | - |
| `--schema-file <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--schema-dir <path>` | - | Directory of `.graphql` files (auto multi-target) | - |
| `--schemas <list>` | - | PostgreSQL schemas (comma-separated) | - |
| `--api-names <list>` | - | API names for auto schema discovery | - |
| `--config <path>` | `-c` | Path to config file | `graphql-codegen.config.ts` |

### Generator Options

| Option | Description | Default |
|--------|-------------|---------|
| `--react-query` | Generate React Query hooks | `false` |
| `--orm` | Generate ORM client | `false` |
| `--cli` | Generate inquirerer-based CLI | `false` |

### Schema Export Options

| Option | Description | Default |
|--------|-------------|--------|
| `--schema-only` | Export schema to `.graphql` file (no code generation) | `false` |
| `--schema-only-output <dir>` | Output directory for schema export | Same as `--output` |
| `--schema-only-filename <name>` | Filename for exported schema | `schema.graphql` |

### Output Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--output <dir>` | `-o` | Output directory | `./generated/graphql` |
| `--target <name>` | `-t` | Target name (for multi-target configs) | - |

### Other Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--verbose` | `-v` | Show detailed output | `false` |
| `--dry-run` | - | Preview without writing files | `false` |
| `--help` | `-h` | Show help message | - |

## Examples

### Schema Export (recommended first step)

```bash
# Export from database
npx @constructive-io/graphql-codegen --schema-only --schemas public --schema-only-output ./schemas --schema-only-filename public.graphql

# Export from endpoint
npx @constructive-io/graphql-codegen --schema-only -e https://api.example.com/graphql --schema-only-output ./schemas

# Export from PGPM module (via config)
npx @constructive-io/graphql-codegen --schema-only -c graphql-codegen.config.ts
```

### From Schema Directory (recommended)

```bash
# Generate from directory of .graphql files (auto multi-target)
npx @constructive-io/graphql-codegen --react-query --orm --schema-dir ./schemas -o ./generated
```

### From Schema File

```bash
# Generate from .graphql file
npx @constructive-io/graphql-codegen --react-query -s ./schema.graphql -o ./generated

# With both generators
npx @constructive-io/graphql-codegen --react-query --orm -s ./schema.graphql
```

### From GraphQL Endpoint

```bash
# Generate React Query hooks
npx @constructive-io/graphql-codegen --react-query -e https://api.example.com/graphql

# Generate ORM client
npx @constructive-io/graphql-codegen --orm -e https://api.example.com/graphql

# Generate all three
npx @constructive-io/graphql-codegen --react-query --orm --cli -e https://api.example.com/graphql

# With custom output
npx @constructive-io/graphql-codegen --react-query -e https://api.example.com/graphql -o ./generated

# With authorization
npx @constructive-io/graphql-codegen --orm -e https://api.example.com/graphql -a "Bearer token123"
```

### From Database

```bash
# Explicit schemas
npx @constructive-io/graphql-codegen --react-query --schemas public,app_public

# Auto-discover from API names
npx @constructive-io/graphql-codegen --orm --api-names my_api

# With custom output
npx @constructive-io/graphql-codegen --react-query --schemas public -o ./generated
```

### Using Config File

```bash
# Use default config file (graphql-codegen.config.ts)
npx @constructive-io/graphql-codegen

# Use specific config file
npx @constructive-io/graphql-codegen -c ./config/codegen.config.ts

# Override config with CLI options
npx @constructive-io/graphql-codegen -c ./config.ts --react-query --orm

# Multi-target: generate specific target
npx @constructive-io/graphql-codegen --target production

# Multi-target: generate all targets
npx @constructive-io/graphql-codegen
```

### Development Workflow

```bash
# Dry run to preview changes
npx @constructive-io/graphql-codegen --react-query -e https://api.example.com/graphql --dry-run

# Verbose output for debugging
npx @constructive-io/graphql-codegen --orm -e https://api.example.com/graphql --verbose
```

## Environment Variables

The CLI respects these environment variables:

| Variable | Description |
|----------|-------------|
| `PGHOST` | PostgreSQL host (for database introspection) |
| `PGPORT` | PostgreSQL port |
| `PGDATABASE` | PostgreSQL database name |
| `PGUSER` | PostgreSQL user |
| `PGPASSWORD` | PostgreSQL password |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error |
| `3` | Network/schema error |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No code generated | Add `--react-query`, `--orm`, or `--cli` flag |
| "Cannot use both endpoint and schemas" | Choose one schema source |
| "schemas and apiNames are mutually exclusive" | Use either `--schemas` or `--api-names`, not both |
| Database connection errors | Check `PG*` environment variables |
| Schema export produces empty file | Verify database/endpoint has tables in specified schemas |
| `--schema-dir` generates nothing | Ensure directory contains `.graphql` files |
