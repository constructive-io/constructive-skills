---
name: constructive-database
description: "Database schema management and migrations — pgpm (PostgreSQL Package Manager) for deterministic plan-driven migrations, workspace/module initialization with pgpm init, custom boilerplate template authoring, and GitHub Actions CI/CD for database testing. Use when asked to deploy database, run migrations, manage modules, add tables, create functions, write database changes, create workspaces, set up pgpm, scaffold templates, or configure database CI/CD pipelines."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# constructive-database

Consolidated skill for all database schema management, migrations, and CI/CD in the Constructive ecosystem.

## pgpm (PostgreSQL Package Manager)

- Deterministic, plan-driven database migrations with the three-file pattern (deploy/revert/verify)
- Workspace and module management, dependency resolution, extension handling, tagging, and publishing
- Docker-based local PostgreSQL setup, environment variable management, and integration testing with pgsql-test
- Complete CLI reference covering deploy, verify, revert, migrate, install, and all utility commands

**Triggers:** "deploy database", "run migrations", "manage pgpm modules", "add a table", "create a function", "add a migration", "write database changes", "create a workspace", "set up pgpm", "manage dependencies", "revert a migration", "verify deployments", "tag a release", "start postgres", "run database locally", "set up database environment", "load env vars", "add an extension", "install a module", "publish pgpm module", "test database", "write integration tests", "troubleshoot pgpm"

See [pgpm.md](./references/pgpm.md) for details.

### pgpm Sub-References

| Reference | Description |
|-----------|-------------|
| [pgpm-cli.md](./references/pgpm-cli.md) | Complete CLI command reference with all flags and options |
| [pgpm-workspace.md](./references/pgpm-workspace.md) | Creating and managing pgpm workspaces and monorepo structure |
| [pgpm-changes.md](./references/pgpm-changes.md) | Authoring deploy/revert/verify scripts with `pgpm add` |
| [pgpm-sql-conventions.md](./references/pgpm-sql-conventions.md) | SQL file format, header patterns, naming conventions |
| [pgpm-dependencies.md](./references/pgpm-dependencies.md) | Within-module and cross-module dependency management |
| [pgpm-deploy-lifecycle.md](./references/pgpm-deploy-lifecycle.md) | Deploy, verify, revert lifecycle and tagging |
| [pgpm-docker.md](./references/pgpm-docker.md) | Docker container management for local PostgreSQL |
| [pgpm-env.md](./references/pgpm-env.md) | Environment variable management and profiles |
| [pgpm-environment-configuration.md](./references/pgpm-environment-configuration.md) | @pgpmjs/env library API for programmatic configuration |
| [pgpm-extensions.md](./references/pgpm-extensions.md) | PostgreSQL extensions, pgpm modules, and .control file |
| [pgpm-module-naming.md](./references/pgpm-module-naming.md) | npm names vs control file names for dependency declarations |
| [pgpm-plan-format.md](./references/pgpm-plan-format.md) | pgpm.plan file format and fixing parse errors |
| [pgpm-publishing.md](./references/pgpm-publishing.md) | Bundling and publishing @pgpm/* modules to npm |
| [pgpm-testing.md](./references/pgpm-testing.md) | PostgreSQL integration tests with pgsql-test and Jest |
| [pgpm-troubleshooting.md](./references/pgpm-troubleshooting.md) | Common issues and solutions for connections, Docker, deploys |

## pgpm init (Workspace & Module Initialization)

- Scaffolding workspaces and modules with `pgpm init`, supporting PGPM and PNPM template variants
- Non-interactive mode (`--no-tty`) for CI/CD pipelines with all required parameters
- Custom template repositories via `--repo` and `--from-branch` flags
- The `-w` flag to create workspace + module in a single command

**Triggers:** "scaffolding a new workspace", "pgpm init", "create workspace", "initialize module", "set up pgpm project", "non-interactive init", "custom template repository"

See [pgpm-init.md](./references/pgpm-init.md) for details.

## Boilerplate Template Authoring

- Creating custom boilerplate repositories for `pgpm init` with `.boilerplate.json` configuration
- Placeholder system (`____placeholder____` pattern) for variable substitution in templates
- Question configuration with resolvers (`defaultFrom`, `setFrom`, `optionsFrom`) for dynamic defaults
- Template types (workspace, module, generic) and workspace requirement declarations

**Triggers:** "author custom boilerplate", "configure .boilerplate.json", "define placeholder questions", "set up custom template repository", "create boilerplate template"

See [boilerplate-authoring.md](./references/boilerplate-authoring.md) for details.

## GitHub Actions CI/CD for Database Testing

- PostgreSQL service containers with health checks and the Constructive postgres-plus image
- pgpm CLI caching, database user bootstrapping, and matrix-based parallel test execution
- SDK generation workflows, test sharding for large suites, and Docker image build/push
- MinIO service containers for S3-compatible storage testing

**Triggers:** "set up CI/CD for pgpm", "configure PostgreSQL in GitHub Actions", "run database tests in CI", "generate SDK in CI", "build Docker PostgreSQL image", "database CI/CD pipeline"

See [ci-cd.md](./references/ci-cd.md) for details.
