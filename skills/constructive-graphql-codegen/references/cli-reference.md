# CLI Reference

Complete reference for `graphql-codegen` CLI commands.

## graphql-codegen generate

Generate type-safe React Query hooks and/or ORM client from GraphQL schema.

```bash
npx @constructive-io/graphql-codegen generate [options]
```

### Source Options (choose one)

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | - |
| `--schema-file <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--schemas <list>` | - | PostgreSQL schemas (comma-separated) | - |
| `--api-names <list>` | - | API names for auto schema discovery | - |
| `--config <path>` | `-c` | Path to config file | `graphql-codegen.config.ts` |

### Generator Options

| Option | Description | Default |
|--------|-------------|---------|
| `--reactQuery` | Generate React Query hooks | `false` |
| `--orm` | Generate ORM client | `false` |

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
| `--keep-db` | - | Keep ephemeral database (debugging) | `false` |
| `--help` | `-h` | Show help message | - |
| `--version` | - | Show version number | - |

## Examples

### From GraphQL Endpoint

```bash
# Generate React Query hooks
npx @constructive-io/graphql-codegen generate --reactQuery --endpoint https://api.example.com/graphql

# Generate ORM client
npx @constructive-io/graphql-codegen generate --orm --endpoint https://api.example.com/graphql

# Generate both
npx @constructive-io/graphql-codegen generate --reactQuery --orm --endpoint https://api.example.com/graphql

# With custom output
npx @constructive-io/graphql-codegen generate --reactQuery --endpoint https://api.example.com/graphql --output ./generated

# With authorization
npx @constructive-io/graphql-codegen generate --orm --endpoint https://api.example.com/graphql --authorization "Bearer token123"
```

### From Schema File

```bash
# Generate from .graphql file
npx @constructive-io/graphql-codegen generate --reactQuery --schema-file ./schema.graphql --output ./generated

# With both generators
npx @constructive-io/graphql-codegen generate --reactQuery --orm --schema-file ./schema.graphql
```

### From Database

```bash
# Explicit schemas
npx @constructive-io/graphql-codegen generate --reactQuery --schemas public,app_public

# Auto-discover from API names
npx @constructive-io/graphql-codegen generate --orm --api-names my_api

# With custom output
npx @constructive-io/graphql-codegen generate --reactQuery --schemas public --output ./generated
```

### Using Config File

```bash
# Use default config file (graphql-codegen.config.ts)
npx @constructive-io/graphql-codegen generate

# Use specific config file
npx @constructive-io/graphql-codegen generate --config ./config/codegen.config.ts

# Override config with CLI options
npx @constructive-io/graphql-codegen generate --config ./config.ts --reactQuery --orm

# Multi-target: generate specific target
npx @constructive-io/graphql-codegen generate --target production

# Multi-target: generate all targets
npx @constructive-io/graphql-codegen generate
```

### Development Workflow

```bash
# Dry run to preview changes
npx @constructive-io/graphql-codegen generate --reactQuery --endpoint https://api.example.com/graphql --dry-run

# Verbose output for debugging
npx @constructive-io/graphql-codegen generate --orm --endpoint https://api.example.com/graphql --verbose

# Keep ephemeral database for debugging (when using PGPM modules)
npx @constructive-io/graphql-codegen generate --schemas public --keep-db
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
| No code generated | Add `--reactQuery` or `--orm` flag |
| "Cannot use both endpoint and schemas" | Choose one schema source |
| "schemas and apiNames are mutually exclusive" | Use either `--schemas` or `--api-names`, not both |
| Database connection errors | Check `PG*` environment variables |
