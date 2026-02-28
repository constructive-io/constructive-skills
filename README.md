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
| `constructive-ui` | Build UIs with @constructive-io/ui — 50+ components, cva variants, Tailwind CSS v4 theming, forms, overlays, layout, animations, command palette, Stack navigation, and advanced inputs. Includes 18 reference files covering foundations, theming, registry, motion, forms, overlays, layout, sidebar, data display, advanced inputs, combobox, command palette, card patterns, Stack navigation, sheet stacking, and more. |
| `constructive-crud-stack` | Build CRUD actions as Stack cards (iOS-style slide-in panels) for any Constructive CRM |
| `constructive-meta-forms` | Dynamic CRUD forms using the \_meta GraphQL endpoint — zero static field configuration |
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
| `pgpm` | PostgreSQL Package Manager — deterministic, plan-driven database migrations with dependency management. Covers CLI commands, workspaces, changes, deployments, Docker, environment, extensions, naming, plan format, publishing, SQL conventions, testing, and troubleshooting. Includes 15 reference files for detailed documentation on each topic. |

### Database Testing (pgsql-test)

| Skill | Description |
|-------|-------------|
| `pgsql-test` | PostgreSQL integration testing with pgsql-test — RLS policies, seeding, exceptions, snapshots, helpers, JWT context, and complex scenario setup. Includes 7 reference files for detailed documentation on each topic. |

### Drizzle ORM

| Skill | Description |
|-------|-------------|
| `drizzle-orm` | Schema design patterns and query building for PostgreSQL |
| `drizzle-orm-test` | Test PostgreSQL with Drizzle ORM |

### pgvector and RAG

| Skill | Description |
|-------|-------------|
| `pgvector-rag` | pgvector setup, embeddings, similarity search, RAG pipelines, Ollama integration, and agentic-kit RAG. Includes 6 reference files for detailed documentation on each topic. |

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
| `constructive-pnpm` | PNPM monorepo workspaces, publishing with makage and lerna, and large-scale monorepo management. Includes 3 reference files for detailed documentation on each topic. |

### CI/CD

| Skill | Description |
|-------|-------------|
| `github-workflows-pgpm` | GitHub Actions for database testing |
| `github-workflows-ollama` | GitHub Actions for Ollama and pgvector testing |

### CLI Development

| Skill | Description |
|-------|-------------|
| `inquirerer-cli` | Build interactive CLI tools with inquirerer, appstash for persistent storage, and yanse for terminal colors. Includes 4 reference files for detailed documentation on each topic. |

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
