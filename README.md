# Constructive Skills

<p align="center" width="100%">
  <img height="150" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/logo.svg" />
</p>

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions that extend agent capabilities for PostgreSQL development, GraphQL workflows, and monorepo management.

Skills follow the [Agent Skills](https://agentskills.io/) format.

## Available Skills

### PGPM (PostgreSQL Package Manager)

| Skill | Description |
|-------|-------------|
| `pgpm-cli` | Complete CLI reference for all pgpm commands |
| `pgpm-workspace` | Create and manage pgpm workspaces |
| `pgpm-changes` | Author database changes with deploy/revert/verify |
| `pgpm-dependencies` | Manage module dependencies |
| `pgpm-docker` | Manage PostgreSQL Docker containers |
| `pgpm-env` | Manage PostgreSQL environment variables |
| `pgpm-testing` | Run PostgreSQL integration tests |
| `pgpm-publishing` | Publish @pgpm/* SQL modules to npm |
| `pgpm-troubleshooting` | Common issues and solutions |

### Database Testing (pgsql-test)

| Skill | Description |
|-------|-------------|
| `pgsql-test-rls` | Test Row-Level Security policies |
| `pgsql-test-seeding` | Seed test databases with loadJson/loadSql/loadCsv |
| `pgsql-test-exceptions` | Handle aborted transactions in tests |
| `pgsql-test-snapshot` | Snapshot testing utilities (pruneIds, pruneDates) |

### Drizzle ORM

| Skill | Description |
|-------|-------------|
| `drizzle-orm` | Schema design patterns and query building |
| `drizzle-orm-test` | Test PostgreSQL with Drizzle ORM |

### GraphQL

| Skill | Description |
|-------|-------------|
| `graphql-codegen` | Generate typed SDK from PostGraphile endpoints |
| `constructive-graphql-codegen` | React Query hooks and ORM client generation |

### PNPM Workspaces

| Skill | Description |
|-------|-------------|
| `pnpm-workspace` | Create and configure PNPM monorepos |
| `pnpm-publishing` | Publish TypeScript packages with makage |
| `monorepo-management` | Best practices for large PNPM monorepos |

### CI/CD and Configuration

| Skill | Description |
|-------|-------------|
| `github-workflows-pgpm` | GitHub Actions for database testing |
| `environment-configuration` | Configure environments with @pgpmjs/env |

### Other

| Skill | Description |
|-------|-------------|
| `pgsql-parser-testing` | Test the pgsql-parser repository |
| `supabase-test` | Test Supabase applications |
| `readme-formatting` | Format READMEs with Constructive branding |
| `constructive-functions` | Cloud functions with PGPM |

## Usage

Skills are automatically available to AI agents once installed. The agent will use them when relevant tasks are detected.

**Examples:**
```
Deploy my database changes with pgpm
```
```
Write a test for my RLS policy
```
```
Generate GraphQL hooks for my PostGraphile endpoint
```

## Skill Structure

Each skill contains:
- `SKILL.md` — Instructions for the agent following the Agent Skills format
- `references/` — Supporting documentation loaded on-demand (optional)

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT
