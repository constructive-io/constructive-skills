# Constructive Skills

<p align="center" width="100%">
  <img height="150" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/logo.svg" />
</p>

A collection of skills for AI coding agents working with [Constructive](https://constructive.io) tooling. Skills cover application feature packs, Console Kit, PostgreSQL development, authorization, GraphQL workflows, and platform operations.

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

Skills are organized into 25 focused skills. Every skill has a `SKILL.md`; references and executable helpers are included only where they add value.

| Skill | Description |
|-------|-------------|
| `constructive-features` | Intent router — maps application capabilities to Blocks feature packs and the domain skill that explains the underlying behavior |
| `constructive-blocks` | Constructive Blocks — feature packs, Console Kit, registry installation, tenant descriptors, capability discovery, and runtime contracts |
| `constructive-builder` | Agent-driven tenant frontend harness — assembles and acceptance-checks Blocks against an existing app workspace and already-provisioned tenant |
| `constructive-blueprints` | Declarative schema definition — blueprints, node type registry, presets |
| `constructive-auth` | Identity, login, sessions, MFA, devices, auth settings |
| `constructive-principals` | Scoped identities for API keys, agents, and service accounts |
| `constructive-security` | Authorization — 25 registry Authz nodes, platform-applied `AuthzHumanOnly`, RLS, grants, and storage policies. |
| `constructive-access-control` | Roles, permissions, profiles, grants, memberships, and hierarchy |
| `constructive-entities` | Multi-tenancy — entity types, memberships, invites, entity-scoped storage |
| `constructive-data-modeling` | Tables, fields, relations, constraints, indexes, database provisioning |
| `constructive-billing` | Billing, limits, plans, credits, feature flags, meters |
| `constructive-storage` | Uploads, buckets, presigned URLs, file lifecycle, upload-client |
| `constructive-search` | All search strategies — tsvector, BM25, trigram, pgvector, PostGIS, unified composite |
| `constructive-agents` | AI — agent module, LLM providers, RAG pipelines, embeddings, agentic-kit |
| `constructive-events` | EventTracker, achievements, referrals, invite virality, gamification |
| `constructive-notifications` | Inbox, delivery, channels, preferences, suppression, and message lifecycle |
| `constructive-realtime` | Subscriptions, change_log, CursorTracker |
| `constructive-jobs` | Background jobs — JobTrigger, Process* wrappers, Knative worker, scheduling |
| `constructive-flow-graphs` | Graph module + merkle store (SDK-authorable) with FBP spec links |
| `constructive-i18n` | Internationalization — DataI18n, multilingual search, lang_column, i18n_module |
| `constructive-frontend` | Constructive UI primitives, visual composition, CRUD Stack cards, and custom domain UI patterns |
| `constructive-codegen` | Optional generated clients for stable, custom domain UI and server workflows |
| `constructive-orm` | Optional generated ORM patterns for stable custom-domain schemas |
| `constructive-hooks` | Optional generated React Query hook patterns for fixed endpoints |
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

Write a test for my RLS policy

Generate GraphQL hooks for my PostGraphile endpoint

Install the b2b-storage Console Kit preset for this tenant

Set up authorization with Constructive Authz
```

## Skill Structure

Skills are located at `.agents/skills/` following the [Agent Skills](https://agentskills.io/) standard, making them auto-discoverable by Devin, Claude Code, Cursor, Copilot, and other compatible agents.

Each skill contains a `SKILL.md` following the Agent Skills format. A skill may also include focused `references/` and deterministic `scripts/` loaded only when needed.

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT
