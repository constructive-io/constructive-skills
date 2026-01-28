# CLI Reference

Complete reference for `graphql-codegen` CLI commands.

## graphql-codegen

Generate type-safe React Query hooks and/or ORM client from GraphQL schema.

```bash
npx graphql-codegen [options]
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
| `--react-query` | Generate React Query hooks | `false` |
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
npx graphql-codegen --react-query -e https://api.example.com/graphql

# Generate ORM client
npx graphql-codegen --orm -e https://api.example.com/graphql

# Generate both
npx graphql-codegen --react-query --orm -e https://api.example.com/graphql

# With custom output
npx graphql-codegen --react-query -e https://api.example.com/graphql -o ./src/generated

# With authorization
npx graphql-codegen --orm -e https://api.example.com/graphql -a "Bearer token123"
```

### From Schema File

```bash
# Generate from .graphql file
npx graphql-codegen --react-query -s ./schema.graphql -o ./generated

# With both generators
npx graphql-codegen --react-query --orm -s ./schema.graphql
```

### From Database

```bash
# Explicit schemas
npx graphql-codegen --react-query --schemas public,app_public

# Auto-discover from API names
npx graphql-codegen --orm --api-names my_api

# With custom output
npx graphql-codegen --react-query --schemas public -o ./generated
```

### Using Config File

```bash
# Use default config file (graphql-codegen.config.ts)
npx graphql-codegen

# Use specific config file
npx graphql-codegen -c ./config/codegen.config.ts

# Override config with CLI options
npx graphql-codegen -c ./config.ts --react-query --orm

# Multi-target: generate specific target
npx graphql-codegen -t production

# Multi-target: generate all targets
npx graphql-codegen
```

### Development Workflow

```bash
# Dry run to preview changes
npx graphql-codegen --react-query -e https://api.example.com/graphql --dry-run

# Verbose output for debugging
npx graphql-codegen --orm -e https://api.example.com/graphql -v

# Keep ephemeral database for debugging (when using PGPM modules)
npx graphql-codegen --schemas public --keep-db
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
| No code generated | Add `--react-query` or `--orm` flag |
| "Cannot use both endpoint and schemas" | Choose one schema source |
| "schemas and apiNames are mutually exclusive" | Use either `--schemas` or `--api-names`, not both |
| Database connection errors | Check `PG*` environment variables |
