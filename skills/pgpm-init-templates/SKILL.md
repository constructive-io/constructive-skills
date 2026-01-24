# pgpm-init-templates

Use `pgpm init --boilerplate` to scaffold projects from available templates, including non-PGPM workspaces.

## Overview

The `--boilerplate` flag enables interactive selection from all available templates in the boilerplate repository. This is useful when you want to create something other than the default PGPM module or workspace.

## Available Templates

The default boilerplate repository (`constructive-io/pgpm-boilerplates`) provides these templates:

### Default Variant (PGPM)

| Template | Command | Description |
|----------|---------|-------------|
| `default/workspace` | `pgpm init workspace` | PGPM workspace with pgpm.json, migrations support |
| `default/module` | `pgpm init` | PGPM module with pgpm.plan, .control file |

### PNPM Variant (Pure TypeScript/JavaScript)

| Template | Command | Description |
|----------|---------|-------------|
| `pnpm/workspace` | `pgpm init workspace --dir pnpm` | Pure PNPM workspace (no pgpm files) |
| `pnpm/module` | `pgpm init --dir pnpm` | Pure PNPM package (no pgpm.plan/.control) |

## Using --boilerplate

### Interactive Selection

```bash
pgpm init --boilerplate
```

This prompts you to select from all available templates in the repository. Useful when you're not sure which template to use or want to explore options.

### With Specific Template

```bash
# Select a specific template path
pgpm init pnpm/workspace --boilerplate
pgpm init pnpm/module --boilerplate
```

## Template Variants

### PGPM Templates (default/)

Use for PostgreSQL extension development with migrations:

```bash
# Create PGPM workspace
pgpm init workspace

# Create PGPM module (inside workspace)
pgpm init
```

**Creates:**
- `pgpm.json` / `pgpm.config.js` (workspace)
- `pgpm.plan` (module)
- `.control` file (module)
- Migration directories: `deploy/`, `revert/`, `verify/`

### PNPM Templates (pnpm/)

Use for pure TypeScript/JavaScript packages without PostgreSQL:

```bash
# Create PNPM workspace
pgpm init workspace --dir pnpm

# Create PNPM package (inside workspace)
pgpm init --dir pnpm
```

**Creates:**
- `pnpm-workspace.yaml` (workspace)
- `lerna.json` (workspace)
- Standard `package.json`
- `src/`, `__tests__/` directories
- No pgpm-specific files

## Non-Interactive Mode

When using `--boilerplate` in CI/CD, you must specify the template path:

```bash
# This will error in non-interactive mode (no template specified)
pgpm init --boilerplate --no-tty  # ERROR

# Correct: specify the template path
pgpm init pnpm/workspace --boilerplate --no-tty \
  --name my-workspace \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --license MIT
```

## Workspace Type Requirements

Templates specify what type of workspace they require:

| requiresWorkspace | Meaning |
|-------------------|---------|
| `"pgpm"` | Must be inside a PGPM workspace (has pgpm.json) |
| `"pnpm"` | Must be inside a PNPM workspace (has pnpm-workspace.yaml) |
| `"lerna"` | Must be inside a Lerna workspace (has lerna.json) |
| `"npm"` | Must be inside an npm workspace (package.json with workspaces) |
| `false` | Can be created anywhere |

## Examples

### Create a Pure TypeScript Monorepo

```bash
# 1. Create PNPM workspace
pgpm init workspace --dir pnpm
cd my-workspace

# 2. Create packages
pgpm init --dir pnpm  # Creates TypeScript package
```

### Create a PGPM Workspace with SQL Modules

```bash
# 1. Create PGPM workspace (default)
pgpm init workspace
cd my-workspace

# 2. Create SQL modules
pgpm init  # Creates module with pgpm.plan
```

### Mix PGPM and PNPM in Same Workspace

A PGPM workspace is also a valid PNPM workspace, so you can create both types of packages:

```bash
# 1. Create PGPM workspace
pgpm init workspace
cd my-workspace

# 2. Create SQL module
pgpm init
# Creates packages/my-sql-module with pgpm.plan

# 3. Create TypeScript package (manually or with different tooling)
# The workspace supports both
```

## Custom Boilerplate Repositories

Organizations can create custom boilerplate repositories with additional templates:

```bash
# Use custom repository
pgpm init --boilerplate --repo myorg/my-boilerplates

# List available templates interactively
pgpm init --boilerplate --repo myorg/my-boilerplates
```

## Best Practices

1. Use `--dir pnpm` for pure TypeScript/JavaScript packages
2. Use default templates for PostgreSQL extension development
3. Use `--boilerplate` when exploring available templates
4. Always specify template path with `--boilerplate` in CI/CD
5. Create organization-specific boilerplates for standardized project setup
