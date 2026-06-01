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
npx skills add constructive-io/constructive-skills --skill constructive-security
```

## Available Skills

Skills are organized into 21 umbrella skills. Each has a `SKILL.md` and a `references/` directory with detailed documentation.

| Skill | Description |
|-------|-------------|
| `constructive-features` | Feature catalog — router mapping every capability to the authoritative skill |
| `constructive-blueprints` | Declarative schema definition — blueprints, node type registry, presets |
| `constructive-auth` | Identity, login, sessions, MFA, devices, auth settings |
| `constructive-security` | Authorization — Safegres protocol, Authz* types, RLS, grants, storage policies. See [safegres.com](https://safegres.com) |
| `constructive-entities` | Multi-tenancy — entity types, memberships, invites, entity-scoped storage |
| `constructive-data-modeling` | Tables, fields, relations, constraints, indexes, database provisioning |
| `constructive-billing` | Billing, limits, plans, credits, feature flags, meters |
| `constructive-storage` | Uploads, buckets, presigned URLs, file lifecycle, upload-client |
| `constructive-search` | All search strategies — tsvector, BM25, trigram, pgvector, PostGIS, unified composite |
| `constructive-agents` | AI — agent module, LLM providers, RAG pipelines, embeddings, agentic-kit |
| `constructive-events` | EventTracker, achievements, referrals, invite virality, gamification |
| `constructive-realtime` | Subscriptions, notifications, change_log, CursorTracker |
| `constructive-jobs` | Background jobs — JobTrigger, Process* wrappers, Knative worker, scheduling |
| `constructive-flow-graphs` | Graph module + merkle store (SDK-authorable) with FBP spec links |
| `constructive-i18n` | Internationalization — DataI18n, multilingual search, lang_column, i18n_module |
| `constructive-frontend` | UI components (50+ on Base UI + Tailwind v4), CRUD Stack cards, meta-forms |
| `constructive-blocks` | Copy-in UI blocks distributed via a shadcn registry (`@constructive/<block>`) that bind to the host app's per-application generated GraphQL SDK. Install/wire/author flow, `blocks-runtime`, `requires.json` manifests, and a bundled `check-sdk.mjs` preflight that proves the host SDK exports every operation a block needs. |
| `constructive-codegen` | Code generation pipeline — config, templates, AST transforms, introspection |
| `constructive-orm` | Generated ORM — query patterns, mutations, relations, pagination, _meta |
| `constructive-hooks` | Generated React Query hooks — query/mutation hooks, cache, optimistic updates |
| `constructive-platform` | Server config, services, domains, deployment, env, cloud functions, cnc CLI |

### Skills in Other Repos

Some skills live alongside their source code in other repositories:

| Skill | Repo | Description |
|-------|------|-------------|
| `pgpm` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | PostgreSQL Package Manager — migrations, CLI, Docker, CI/CD, starter kits |
| `constructive-pnpm` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | PNPM workspace management, dist-folder publishing |
| `constructive-setup` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | Monorepo setup, local dev environment |
| `constructive-testing` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | All test frameworks (pgsql-test, drizzle-orm-test, supabase-test) |
| `constructive-cli` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | Generated CLI commands, scaffolding |
| `graphile-search` | [constructive-io/constructive](https://github.com/constructive-io/constructive) | Unified search plugin internals |
| `dev-utils` | [constructive-io/dev-utils](https://github.com/constructive-io/dev-utils) | CLI framework (inquirerer, yanse, appStash) and 25+ packages |
| `fbp` | [constructive-io/fbp](https://github.com/constructive-io/fbp) | Flow-Based Programming — types, spec, evaluator, graph editor |

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

Skills are located at `.agents/skills/` following the [Agent Skills](https://agentskills.io/) standard, making them auto-discoverable by Devin, Claude Code, Cursor, Copilot, and other compatible agents.

Each skill contains:
- `SKILL.md` - Instructions for the agent following the Agent Skills format
- `references/` - Supporting documentation loaded on-demand (optional)

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT
