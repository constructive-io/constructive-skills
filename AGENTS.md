This file originated from https://github.com/vercel-labs/agent-skills/blob/main/AGENTS.md and has been modified for this repository.

# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are organized into umbrella skills that consolidate related functionality:

| Skill | Absorbs | Purpose |
|-------|---------|---------|
| **constructive-features** | *(router)* | Feature catalog routing to the authoritative skill for every capability |
| **constructive-builder** | agentic-flow harness | End-to-end app builder — scaffold, provision (data model + RLS), wire Blocks + auth flows, Chrome-verify a working CRUD app in under 10 minutes (4 phases, 3 policy tiers) |
| **constructive-blueprints** | blueprint refs from constructive-platform | Declarative schema definition — blueprints, node type registry, presets |
| **constructive-auth** | auth/device/service refs from constructive-platform, auth-flow from constructive-sdk | Identity, login, sessions, MFA, devices |
| **constructive-security** | constructive-safegres, constructive-sdk-security | Authorization — Safegres, Authz* types, RLS, grants, storage policies |
| **constructive-access-control** | *(standalone)* | Access control — roles, permissions, profiles, grants, membership access, entity-scoped authorization |
| **constructive-entities** | constructive-sdk-entities | Multi-tenancy, memberships, invites, entity types, entity-scoped storage |
| **constructive-data-modeling** | constructive-sdk-tables, fields, relations, constraints, indexes, sdk-database | Tables, fields, relations, constraints, indexes (SDK CRUD) |
| **constructive-billing** | constructive-sdk-billing, constructive-sdk-limits | Billing, limits, plans, credits, feature flags, meters |
| **constructive-storage** | constructive-sdk-uploads | Uploads, buckets, presigned URLs, file lifecycle |
| **constructive-search** | search refs from constructive-sdk-graphql, graphile-postgis | All search strategies — tsvector, BM25, trigram, pgvector, PostGIS, unified |
| **constructive-agents** | constructive-sdk-ai | AI — agent module, LLM, RAG, embeddings, agentic-kit |
| **constructive-events** | constructive-sdk-events | EventTracker, achievements, referrals, invite virality |
| **constructive-notifications** | *(standalone)* | Notifications — inbox, delivery, channels, preferences, bounce/complaint handling, suppression |
| **constructive-realtime** | realtime refs from constructive-platform | Subscriptions, change_log |
| **constructive-jobs** | *(standalone)* | Background jobs, JobTrigger, Knative worker pipeline |
| **constructive-flow-graphs** | graph_module, merkle_store | Graph module + merkle store (SDK-authorable) with FBP spec links |
| **constructive-i18n** | constructive-sdk-i18n | Internationalization — DataI18n, multilingual search, i18n_module |
| **constructive-frontend** | *(standalone)* | UI components (50+ on Base UI + Tailwind v4), CRUD Stack cards, meta-forms |
| **constructive-codegen** | codegen refs from constructive-sdk-graphql | Code generation pipeline — config, templates, AST transforms |
| **constructive-orm** | ORM refs from constructive-sdk-graphql | Generated ORM — query patterns, mutations, relations, pagination, _meta |
| **constructive-hooks** | hooks refs from constructive-sdk-graphql | Generated React Query hooks — cache, optimistic updates |
| **constructive-platform** | constructive-sdk-api, sdk-services, sdk-site, monorepo-setup | Server config, services, domains, deployment, env, cnc CLI (slimmed) |

Each umbrella skill has a `SKILL.md` router and a `references/` directory with detailed topic-specific documentation.

## Creating a New Skill

### Directory Structure

```
.agents/skills/
  {skill-name}/           # kebab-case directory name
    SKILL.md              # Required: skill definition
    scripts/              # Required: executable scripts
      {script-name}.sh    # Bash scripts (preferred)
  {skill-name}.zip        # Required: packaged for distribution
```

### Naming Conventions

- **Skill directory**: `kebab-case` (e.g., `constructive-codegen`, `log-monitor`)
- **SKILL.md**: Always uppercase, always this exact filename
- **Scripts**: `kebab-case.sh` (e.g., `deploy.sh`, `fetch-logs.sh`)
- **Zip file**: Must match directory name exactly: `{skill-name}.zip`

### SKILL.md Format

```markdown
---
name: {skill-name}
description: {One sentence describing when to use this skill. Include trigger phrases like "Deploy my app", "Check logs", etc.}
---

# {Skill Title}

{Brief description of what the skill does.}

## How It Works

{Numbered list explaining the skill's workflow}

## Usage

```bash
bash /mnt/skills/user/{skill-name}/scripts/{script}.sh [args]
```

**Arguments:**
- `arg1` - Description (defaults to X)

**Examples:**
{Show 2-3 common usage patterns}

## Output

{Show example output users will see}

## Present Results to User

{Template for how agent should format results when presenting to users}

## Troubleshooting

{Common issues and solutions, especially network/permissions errors}
```

### Best Practices for Context Efficiency

Skills are loaded on-demand — only the skill name and description are loaded at startup. The full `SKILL.md` loads into context only when the agent decides the skill is relevant. To minimize context usage:

- **Keep SKILL.md under 500 lines** — put detailed reference material in separate files
- **Write specific descriptions** — helps the agent know exactly when to activate the skill
- **Use progressive disclosure** — reference supporting files that get read only when needed
- **Prefer scripts over inline code** — script execution doesn't consume context (only output does)
- **File references work one level deep** — link directly from SKILL.md to supporting files

### Reference Documentation

The `references/` directory contains detailed documentation split into focused sections for selective reading by agents. This minimizes token usage by allowing agents to read only what's needed for the specific task.

**Structure:**
```
.agents/skills/
  {skill-name}/
    SKILL.md
    references/
      {topic-1}.md    # Focused documentation on specific topic
      {topic-2}.md    # Another focused topic
```

**Best Practices:**
- **Split by topic** — separate concerns into individual files (e.g., `cli-reference.md`, `hooks-patterns.md`, `error-handling.md`)
- **Clear naming** — file names should indicate exactly what content they contain
- **Reference from SKILL.md** — list all reference files with brief descriptions so agents know which to read
- **Selective reading** — agents should read only the relevant reference files for their current task
- **Keep focused** — each reference file should cover one specific aspect (API, patterns, configuration, etc.)

**Example:**
If a skill generates both hooks and ORM code, split references into:
- `hooks-output.md` - API reference for generated hooks
- `hooks-patterns.md` - Usage patterns and examples for hooks
- `orm-output.md` - API reference for generated ORM
- `orm-patterns.md` - Usage patterns and examples for ORM
- `config-reference.md` - Configuration options

This allows agents helping with ORM queries to read only `orm-patterns.md` instead of loading all documentation.

### Script Requirements

- Use `#!/bin/bash` shebang
- Use `set -e` for fail-fast behavior
- Write status messages to stderr: `echo "Message" >&2`
- Write machine-readable output (JSON) to stdout
- Include a cleanup trap for temp files
- Reference the script path as `/mnt/skills/user/{skill-name}/scripts/{script}.sh`

### Creating the Zip Package

After creating or updating a skill:

```bash
cd .agents/skills
zip -r {skill-name}.zip {skill-name}/
```
