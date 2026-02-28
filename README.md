# Constructive Skills

<p align="center" width="100%">
  <img height="150" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/logo.svg" />
</p>

A collection of skills for AI coding agents working with [Constructive](https://constructive.io) tooling. Skills are packaged instructions that extend agent capabilities for PostgreSQL development, authorization, GraphQL workflows, and monorepo management.

Skills follow the [Agent Skills](https://agentskills.io/) format.

## Installation

```bash
npx skills add constructive-io/constructive-skills
```

To install a specific skill:

```bash
npx skills add constructive-io/constructive-skills --skill constructive-safegres
```

## Available Skills

### Safegres (Authorization Protocol)

| Skill | Description |
|-------|-------------|
| `constructive-safegres` | Safegres security protocol for expressing authorization as Authz\* policy nodes (types + JSON configs). Defines each Authz\* type, its config shape, semantics, and when to use it. See [safegres.com](https://safegres.com) |

### Constructive Platform

| Skill | Description |
|-------|-------------|
| `constructive-crud-stack` | Build CRUD actions as Stack cards (iOS-style slide-in panels) for any Constructive CRM |
| `constructive-meta-forms` | Dynamic CRUD forms using the \_meta GraphQL endpoint — zero static field configuration |
| `constructive-card-ui` | Card-based interfaces using @constructive-io/ui (dashboards, stat cards, profile cards) |
| `constructive-command-palette` | Command palettes (Cmd+K / Ctrl+K) with navigation and executable commands |
| `constructive-nextjs-ui` | Next.js applications using the @constructive-io/ui component library |
| `constructive-deployment` | Deploy the Constructive platform locally and to production (Docker Compose, pgpm, CLI) |
| `constructive-functions` | Knative-style HTTP cloud functions for email, webhooks, and background jobs |
| `constructive-server-config` | Configure and run the Constructive GraphQL server, GraphiQL explorer, and code generation |
| `constructive-services-schemas` | Service schema configuration |
| `constructive-agent-e2e` | Full agentic development loop — provision DB, generate SDK, run app, screenshot, iterate |

### Boilerplates

| Skill | Description |
|-------|-------------|
| `constructive-boilerplate-nextjs-app` | Constructive App frontend boilerplate (Next.js + auth + org management + GraphQL SDK) |
| `constructive-boilerplate-authoring` | Create and customize boilerplate templates for pgpm init |
| `constructive-boilerplate-pgpm-init` | Initialize workspaces and modules using pgpm init (PGPM and PNPM templates) |

### GraphQL

| Skill | Description |
|-------|-------------|
| `constructive-graphql-codegen` | Generate type-safe React Query hooks, Prisma-like ORM client, or CLI from GraphQL endpoints |
| `cnc-execution-engine` | Execute GraphQL queries against Constructive APIs using the cnc CLI |

### PGPM (PostgreSQL Package Manager)

| Skill | Description |
|-------|-------------|
| `pgpm-cli` | Complete CLI reference for all pgpm commands |
| `pgpm-workspace` | Create and manage pgpm workspaces for modular PostgreSQL development |
| `pgpm-changes` | Author database changes with the three-file pattern (deploy/revert/verify) |
| `pgpm-dependencies` | Manage module dependencies in pgpm workspaces |
| `pgpm-deploy-lifecycle` | Full lifecycle of pgpm deployments — deploy, verify, revert, tagging, status |
| `pgpm-docker` | Manage PostgreSQL Docker containers for local development |
| `pgpm-env` | Manage PostgreSQL environment variables with profile support |
| `pgpm-environment-configuration` | Configure PostgreSQL and PGPM environments using @pgpmjs/env |
| `pgpm-extensions` | Manage PostgreSQL extensions and pgpm modules (.control files, extensions/) |
| `pgpm-module-naming` | npm package names vs control file names in pgpm modules |
| `pgpm-plan-format` | Understand and fix pgpm.plan file format issues |
| `pgpm-publishing` | Publish @pgpm/\* SQL modules to npm |
| `pgpm-sql-conventions` | SQL file format and conventions for pgpm migration scripts |
| `pgpm-testing` | Run PostgreSQL integration tests with isolated databases using pgsql-test |
| `pgpm-troubleshooting` | Common issues and solutions for pgpm, PostgreSQL, and testing |

### Database Testing (pgsql-test)

| Skill | Description |
|-------|-------------|
| `pgsql-test-rls` | Test Row-Level Security policies with pgsql-test |
| `pgsql-test-seeding` | Seed test databases with loadJson/loadSql/loadCsv |
| `pgsql-test-exceptions` | Handle aborted transactions when testing expected failures |
| `pgsql-test-snapshot` | Snapshot testing utilities (pruneIds, pruneDates) |
| `pgsql-test-helpers` | Reusable test helper functions and constants |
| `pgsql-test-jwt-context` | JWT claims and role-based context for RLS testing |
| `pgsql-test-scenario-setup` | Complex test scenarios with isolation and multi-client patterns |

### Drizzle ORM

| Skill | Description |
|-------|-------------|
| `drizzle-orm` | Schema design patterns and query building for PostgreSQL |
| `drizzle-orm-test` | Test PostgreSQL with Drizzle ORM |

### pgvector and RAG

| Skill | Description |
|-------|-------------|
| `pgvector-setup` | Set up pgvector for vector storage in PostgreSQL |
| `pgvector-embeddings` | Generate and store vector embeddings with Ollama |
| `pgvector-similarity-search` | Perform semantic similarity search with pgvector |
| `rag-pipeline` | Build complete RAG pipelines with pgvector and Ollama |
| `ollama-integration` | Integrate Ollama for local LLM inference |
| `agentic-kit-rag` | Configure agentic-kit for RAG with pgvector and PGPM |

### Flow-Based Programming (FBP)

| Skill | Description |
|-------|-------------|
| `fbp-spec` | Storage specification and manipulation API for FBP graphs |
| `fbp-types` | TypeScript types and GraphSchemata specification |
| `fbp-graph-editor` | Houdini-inspired visual graph editor built with React |
| `fbp-evaluator` | Lazy graph evaluator for dataflow computations |

### PNPM Workspaces

| Skill | Description |
|-------|-------------|
| `pnpm-workspace` | Create and configure PNPM monorepos |
| `pnpm-publishing` | Publish TypeScript packages with makage and lerna |
| `monorepo-management` | Best practices for large PNPM monorepos |

### CI/CD

| Skill | Description |
|-------|-------------|
| `github-workflows-pgpm` | GitHub Actions for database testing |
| `github-workflows-ollama` | GitHub Actions for Ollama and pgvector testing |

### CLI Development

| Skill | Description |
|-------|-------------|
| `inquirerer-cli-building` | Build interactive CLI tools with inquirerer |
| `inquirerer-anti-patterns` | Anti-patterns — do NOT use commander/inquirer.js/yargs in Constructive projects |
| `appstash-cli` | CLI application directory management (config, caching, logging, updates) |
| `yanse-terminal-colors` | Terminal color styling with yanse (not chalk) |

### Other

| Skill | Description |
|-------|-------------|
| `pgsql-parser-testing` | Test the pgsql-parser repository (SQL parser/deparser) |
| `supabase-test` | Test Supabase applications with supabase-test |
| `readme-formatting` | Format READMEs with Constructive branding |
| `planning-blueprinting` | In-repo planning and specification system for software projects |

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
```
Set up authorization with Safegres
```

## Skill Structure

Each skill contains:
- `SKILL.md` - Instructions for the agent following the Agent Skills format
- `references/` - Supporting documentation loaded on-demand (optional)

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT
