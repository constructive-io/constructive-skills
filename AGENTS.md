This file originated from https://github.com/vercel-labs/agent-skills/blob/main/AGENTS.md and has been modified for this repository.

# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are organized into umbrella skills that consolidate related functionality:

| Skill | Absorbs | Purpose |
|-------|---------|---------|
| **constructive-features** | *(router)* | Maps application capabilities to Blocks feature packs and authoritative domain skills |
| **constructive-blocks** | Constructive Blocks | Feature packs, Console Kit, registry installation, tenant descriptors, discovery, and runtime contracts |
| **constructive-builder** | application harness | Agent-driven frontend assembly and acceptance against an existing workspace and already-provisioned tenant |
| **constructive-blueprints** | blueprint refs from constructive-platform | Declarative schema definition — blueprints, node type registry, presets |
| **constructive-auth** | auth/device/service refs from constructive-platform, auth-flow from constructive-sdk | Identity, login, sessions, MFA, devices |
| **constructive-principals** | *(standalone)* | Scoped sub-identities for API keys and agents — API key lifecycle, org scoping, read-only keys (SDK ORM) |
| **constructive-security** | constructive-safegres, constructive-sdk-security | Authorization — 25 registry Authz nodes plus platform-applied `AuthzHumanOnly`, RLS, grants, storage policies |
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
| **constructive-frontend** | *(standalone)* | UI primitives, visual composition, CRUD Stack cards, and custom domain UI patterns |
| **constructive-codegen** | codegen refs from constructive-sdk-graphql | Optional generated clients for stable custom-domain schemas |
| **constructive-orm** | ORM refs from constructive-sdk-graphql | Optional generated ORM patterns for stable custom-domain schemas |
| **constructive-hooks** | hooks refs from constructive-sdk-graphql | Optional generated React Query hook patterns for fixed endpoints |
| **constructive-platform** | constructive-sdk-api, sdk-services, sdk-site, monorepo-setup | Server config, services, domains, deployment, env, cnc CLI (slimmed) |
| **constructive-architecture** | *(from sdk-agentic-flow)* | Platform mental model — core model, baseline, endpoint map, provisioning flow, data-module/policy pairing |
| **constructive-gotchas** | *(from sdk-agentic-flow)* | Platform gotchas with stable rule IDs (CODEGEN-001, TS-001, SERVER-001, …) cited by harness tools |
| **constructive-troubleshooting** | *(from sdk-agentic-flow)* | Failure recipes — exact error strings mapped to root causes and fixes per build phase |
| **constructive-secrets-config** | *(from sdk-agentic-flow)* | Secrets/config plumbing map — site-domain provisioning, email topology, API-key surface, env keys |
| **constructive-build-orchestrator** | *(from Constructive harness)* | State-machine router for harness-driven app builds (`.constructive/feature_list.json`) |
| **constructive-harness-init** | *(from Constructive harness)* | Bootstraps `.constructive/` from harness templates |
| **constructive-brief-intake** | *(from Constructive harness)* | Conversational/inferred brief intake — writes BRIEF.md + per-entity feature rows |
| **constructive-harness-tools** | *(from Constructive harness)* | Guide to the harness's typed tools (provision_database, provision_blueprint, run_codegen, …) |

Each umbrella skill has a `SKILL.md` router and a `references/` directory with detailed topic-specific documentation.

## Creating a New Skill

### Rule: Document the SDK/ORM API Surface Only — Never Direct SQL

Skills in this repository are API documentation for app builders. All examples MUST use the public SDK/ORM surface (`db.table.update(...)`, `db.query.requireStepUp(...)`, blueprint JSON, generated hooks/CLI) — never raw SQL (`UPDATE metaschema_public.table SET ...`, `psql`, direct table access). SQL is an internal implementation detail; showing it teaches agents to bypass the supported API. If a capability is only reachable via SQL, that's an SDK gap to flag — not something to document here. (Describing *generated* SQL behavior, e.g. "generates `WHEN (OLD.created_at < ...)`", is fine; authoring SQL is not.)

### Directory Structure

```
.agents/skills/
  {skill-name}/           # kebab-case directory name
    SKILL.md              # Required: skill definition
    scripts/              # Optional: executable helpers for deterministic workflows
      {script-name}.mjs   # Portable Node.js helper
      {script-name}.sh    # Bash helper when shell orchestration is the clearer fit
```

> `.zip` packages are **not** committed to this repo (they caused constant merge
> conflicts). `*.zip` is gitignored; distribution packaging happens out-of-band.

### Naming Conventions

- **Skill directory**: `kebab-case` (e.g., `constructive-codegen`, `log-monitor`)
- **SKILL.md**: Always uppercase, always this exact filename
- **Scripts**: `kebab-case.mjs` or `kebab-case.sh` (for example,
  `check-contract.mjs` or `fetch-logs.sh`)

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
node /absolute/path/to/constructive-skills/.agents/skills/{skill-name}/scripts/{script}.mjs [args]
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

When a skill includes executable helpers:

- Prefer deterministic Node.js `.mjs` helpers for portable parsing,
  validation, hashing, and structured output. Use Bash only when the work is
  genuinely shell orchestration.
- Resolve sibling resources from `import.meta.url` in Node.js. Never assume a
  current working directory or a fixed `/mnt/skills` installation path.
- Show invocations with an explicit absolute path to the active skills
  checkout so the same command works from any directory.
- Write diagnostics to stderr and machine-readable output to stdout.
- Make failures non-zero, clean temporary files, and keep helpers read-only
  unless the skill explicitly documents an output path.
- For Bash, use `#!/usr/bin/env bash`, `set -euo pipefail`, and a cleanup trap
  when temporary files are involved.

### Packaging

Skill `.zip` archives are not tracked in this repo — `*.zip` is gitignored. Do not
commit them; if a distributable package is needed it is produced out-of-band.
