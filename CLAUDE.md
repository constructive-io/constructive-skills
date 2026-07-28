# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows, following the [Agent Skills](https://agentskills.io/) format.

## Available Skills

| Skill | Description |
|-------|-------------|
| **constructive-features** | Intent router — maps capabilities to Blocks feature packs and authoritative domain skills |
| **constructive-blocks** | Feature packs, Console Kit, registry installation, tenant descriptors, discovery, and runtime contracts |
| **constructive-builder** | Agent-driven tenant frontend harness — assembles and acceptance-checks Blocks against an existing workspace and already-provisioned tenant |
| **constructive-blueprints** | Declarative schema definition — blueprints, node type registry, module presets |
| **constructive-auth** | Identity, login, sessions, MFA, devices, auth settings, service settings |
| **constructive-principals** | Scoped sub-identities for API keys and agents — create/scope/revoke via the SDK ORM, read-only keys, org scoping |
| **constructive-security** | Authorization — 25 registry Authz nodes plus platform-applied `AuthzHumanOnly`, RLS, grants, storage policies |
| **constructive-access-control** | Access control — roles, permissions, profiles, grants, membership access, entity-scoped authorization |
| **constructive-entities** | Multi-tenancy — entity types, memberships, invites, entity-scoped storage, agent module |
| **constructive-data-modeling** | Tables, fields, relations, constraints, indexes, database provisioning (SDK CRUD) |
| **constructive-billing** | Billing, limits, plans, credits, feature flags, meters, usage tracking |
| **constructive-storage** | Uploads, buckets, presigned URLs, file lifecycle, upload-client |
| **constructive-search** | All search strategies — tsvector, BM25, trigram, pgvector, PostGIS, unified composite |
| **constructive-agents** | AI — agent module, LLM providers, RAG pipelines, embeddings, agentic-kit |
| **constructive-events** | EventTracker, achievements, referrals, invite virality, gamification |
| **constructive-notifications** | Notifications — inbox, delivery, channels, preferences, bounce/complaint handling, suppression list |
| **constructive-realtime** | Subscriptions, change_log, CursorTracker |
| **constructive-jobs** | Background jobs — JobTrigger, Process* wrappers, Knative worker, scheduling |
| **constructive-flow-graphs** | Graph module + merkle store (SDK-authorable) with FBP spec links |
| **constructive-i18n** | Internationalization — DataI18n, multilingual search, lang_column, i18n_module |
| **constructive-frontend** | UI primitives, visual composition, CRUD Stack cards, and custom domain UI patterns |
| **constructive-codegen** | Optional generated clients for stable custom-domain schemas |
| **constructive-orm** | Optional generated ORM patterns for stable custom-domain schemas |
| **constructive-hooks** | Optional generated React Query hook patterns for fixed endpoints |
| **constructive-platform** | Server config, services, domains, deployment, env, cloud functions, cnc CLI |
| **constructive-architecture** | Platform mental model — core model, baseline, endpoint map, provisioning flow, data-module/policy pairing |
| **constructive-gotchas** | Platform gotchas with stable rule IDs (CODEGEN-001, TS-001, SERVER-001, …) |
| **constructive-troubleshooting** | Failure recipes — exact error strings mapped to root causes and fixes |
| **constructive-secrets-config** | Secrets/config plumbing — site-domain provisioning, email topology, API-key surface, env keys |
| **constructive-harness** | The harness build workflow — init, brief intake, build orchestration, and the typed database/schema/codegen tools |

## Skill Structure

```
.agents/skills/
  {skill-name}/
    SKILL.md              # Required: skill definition (keep under 500 lines)
    references/           # Optional: detailed documentation
      {topic}.md
```

> `.zip` packages are **not** committed to this repo (they caused constant merge
> conflicts). `*.zip` is gitignored; do not commit skill archives.

### SKILL.md Format

Each skill requires a SKILL.md with YAML frontmatter:
```yaml
---
name: {skill-name}
description: {Description with trigger phrases for when to use this skill}
compatibility: {Environment requirements}
metadata:
  author: constructive-io
  version: "1.0.0"
---
```

Required frontmatter fields:
- `name`: Max 64 chars, lowercase + numbers + hyphens, must match directory name
- `description`: Max 1024 chars, include trigger phrases

Optional frontmatter fields:
- `compatibility`: Environment requirements (Node.js version, dependencies)
- `metadata`: Key-value pairs (author, version)
- `license`: License reference

### Naming Conventions

- Skill directory: `kebab-case`
- SKILL.md: Always uppercase, exact filename

## Key Design Principles

- **Document the SDK/ORM API surface only — never direct SQL.** Skills are API documentation for app builders: all examples must use the public SDK/ORM (`db.table.update(...)`, blueprint JSON, generated hooks/CLI), never raw SQL or direct table access. If something is only reachable via SQL, flag it as an SDK gap instead of documenting the SQL. (Describing generated SQL behavior is fine; authoring SQL is not.)

- Skills are loaded on-demand (only name/description at startup, full SKILL.md when activated)
- Keep SKILL.md under 500 lines; put detailed docs in `references/` directory
- Write specific descriptions with trigger phrases so agents know when to activate
- Include "When to Apply" section in SKILL.md
- Provide concrete code examples, not just descriptions
