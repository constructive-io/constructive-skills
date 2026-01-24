# pgpm-init

Initialize PGPM workspaces and modules using the `pgpm init` command.

## Overview

The `pgpm init` command scaffolds new workspaces and modules from templates. It supports interactive prompts, non-interactive mode for CI/CD, and custom template repositories.

## Basic Commands

### Create a Workspace

```bash
pgpm init workspace
```

Creates a new PGPM workspace with:
- `pgpm.json` configuration
- `pnpm-workspace.yaml`
- `lerna.json` for versioning
- GitHub Actions workflows
- Jest testing setup
- TypeScript configuration

### Create a Module

```bash
# Inside a workspace
pgpm init

# Or explicitly
pgpm init module
```

Creates a new PGPM module with:
- `pgpm.plan` for migrations
- `.control` file for PostgreSQL extension metadata
- `package.json`
- `__tests__/` directory
- `sql/`, `deploy/`, `revert/`, `verify/` directories

## Non-Interactive Mode

For CI/CD pipelines and automation, use `--no-tty` or set `CI=true`:

```bash
# Using --no-tty flag
pgpm init workspace --no-tty \
  --name my-workspace \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --license MIT

# Using CI environment variable
CI=true pgpm init workspace \
  --name my-workspace \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --license MIT
```

### Required Parameters for Non-Interactive Workspace

| Parameter | Description |
|-----------|-------------|
| `--name` | Workspace name (becomes directory name) |
| `--fullName` | Author's full name |
| `--email` | Author's email |
| `--username` | GitHub username |
| `--license` | License (MIT, Apache-2.0, etc.) |

### Required Parameters for Non-Interactive Module

| Parameter | Description |
|-----------|-------------|
| `--moduleName` | Module name |
| `--moduleDesc` | Module description |
| `--fullName` | Author's full name |
| `--email` | Author's email |
| `--username` | GitHub username |
| `--repoName` | Repository name |
| `--license` | License |
| `--access` | npm access level (public/restricted) |
| `--extensions` | PostgreSQL extensions (comma-separated) |

Example:

```bash
pgpm init --no-tty \
  --moduleName my-module \
  --moduleDesc "My PostgreSQL module" \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --repoName my-workspace \
  --license MIT \
  --access public \
  --extensions "plpgsql,uuid-ossp"
```

## Custom Templates

### Use a Different Repository

```bash
pgpm init workspace --repo owner/repo
pgpm init workspace --repo https://github.com/owner/repo.git
```

### Use a Specific Branch

```bash
pgpm init workspace --repo owner/repo --from-branch develop
```

### Use a Template Variant

```bash
# Use the pnpm variant instead of default
pgpm init workspace --dir pnpm
pgpm init module --dir pnpm
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help message |
| `--cwd <directory>` | Working directory (default: current directory) |
| `--repo <repo>` | Template repository (default: constructive-io/pgpm-boilerplates) |
| `--from-branch <branch>` | Branch/tag to use when cloning repo |
| `--dir <variant>` | Template variant directory (e.g., pnpm, supabase) |
| `--boilerplate` | Prompt to select from available boilerplates |
| `--no-tty` | Run in non-interactive mode |

## Workflow Examples

### Starting a New Project

```bash
# 1. Create workspace
pgpm init workspace
cd my-workspace

# 2. Create first module
pgpm init
cd packages/my-module

# 3. Add a database change
pgpm add my_first_change

# 4. Deploy to database
pgpm deploy --createdb
```

### CI/CD Pipeline Setup

```yaml
# .github/workflows/setup.yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - name: Install pgpm
        run: npm install -g pgpm

      - name: Create workspace
        run: |
          pgpm init workspace --no-tty \
            --name test-workspace \
            --fullName "CI Bot" \
            --email "ci@example.com" \
            --username ci-bot \
            --license MIT
```

## Template Caching

Templates are cached locally under `~/.pgpm/cache/repos` with a one-week TTL. To force a fresh pull:

```bash
pgpm cache clean
```

## Best Practices

1. Use `--no-tty` in CI/CD pipelines to avoid hanging on prompts
2. Pin template versions with `--from-branch` for reproducible builds
3. Create custom boilerplates for organization-specific standards
4. Use `pgpm cache clean` if templates seem outdated
