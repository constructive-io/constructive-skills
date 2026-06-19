# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows, following the [Agent Skills](https://agentskills.io/) format.

## Available Skills

| Skill | Description |
|-------|-------------|
| **constructive-features** | Feature catalog — router mapping every app capability to the authoritative skill |
| **constructive-builder** | End-to-end app builder — scaffold, provision (data model + RLS), wire Blocks + auth flows, and Chrome-verify a working CRUD app on Constructive in under 10 minutes (4 phases, 3 policy tiers) |
| **constructive-blueprints** | Declarative schema definition — blueprints, node type registry, module presets |
| **constructive-auth** | Identity, login, sessions, MFA, devices, auth settings, service settings |
| **constructive-security** | Authorization — Safegres protocol, 18 Authz* types, RLS, grants, storage policies |
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
| **constructive-frontend** | UI components (50+ on Base UI + Tailwind v4), CRUD Stack cards, meta-forms |
| **constructive-codegen** | Code generation pipeline — config, templates, AST transforms, introspection |
| **constructive-orm** | Generated ORM — query patterns, mutations, relations, pagination, _meta |
| **constructive-hooks** | Generated React Query hooks — query/mutation hooks, cache, optimistic updates |
| **constructive-platform** | Server config, services, domains, deployment, env, cloud functions, cnc CLI |

## Commands

### Package a skill for distribution
```bash
cd .agents/skills
zip -r {skill-name}.zip {skill-name}/
```

## Skill Structure

```
.agents/skills/
  {skill-name}/
    SKILL.md              # Required: skill definition (keep under 500 lines)
    references/           # Optional: detailed documentation
      {topic}.md
  {skill-name}.zip        # Required: packaged for distribution
```

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
- Zip file: Must match directory name: `{skill-name}.zip`

## Key Design Principles

- Skills are loaded on-demand (only name/description at startup, full SKILL.md when activated)
- Keep SKILL.md under 500 lines; put detailed docs in `references/` directory
- Write specific descriptions with trigger phrases so agents know when to activate
- Include "When to Apply" section in SKILL.md
- Provide concrete code examples, not just descriptions
