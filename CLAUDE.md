# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows, following the [Agent Skills](https://agentskills.io/) format.

Skills are organized as **domain-grouped umbrella skills** — each skill covers an entire area of the platform with reference docs for subtopics, following the pattern established by [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills).

## Available Skills

| Skill | Domain | Type | Covers |
|-------|--------|------|--------|
| `constructive` | Platform core | background | Safegres security model, services/schemas, deployment, server config, cloud functions, cnc CLI |
| `constructive-database` | Database | background | pgpm migrations, workspace/module init, boilerplate authoring, CI/CD for database testing |
| `constructive-graphql` | GraphQL & API | background | Code generation (hooks, ORM, CLI), runtime queries, dynamic CRUD forms, pgvector integration |
| `constructive-frontend` | UI & Frontend | background | @constructive-io/ui components, CRUD Stack cards, Next.js boilerplate |
| `constructive-testing` | Testing | background | pgsql-test, Drizzle ORM testing, Supabase testing, SQL parser testing |
| `constructive-ai` | AI & RAG | background | pgvector, Ollama embeddings, RAG pipelines, CI/CD for AI |
| `constructive-tooling` | DevOps & CLI | background | PNPM workspaces, CLI development (inquirerer), README formatting, planning/specs |
| `fbp` | Flow-Based Programming | background | FBP types, graph spec, evaluator, visual graph editor |

## Skill Structure

Each skill follows the umbrella pattern — an index SKILL.md with reference docs:

```
skills/
  {skill-name}/
    SKILL.md              # Index: frontmatter + H2 summaries linking to references
    references/           # Detailed documentation for each subtopic
      {topic}.md
```

### SKILL.md Format

```yaml
---
name: {skill-name}
description: {Description with trigger phrases for when to use this skill}
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---
```

Required frontmatter fields:
- `name`: Max 64 chars, lowercase + numbers + hyphens, must match directory name
- `description`: Max 1024 chars, include trigger phrases from all subtopics
- `user-invocable`: Set to `false` for background skills (auto-loaded)

Optional frontmatter fields:
- `compatibility`: Environment requirements (Node.js version, dependencies)
- `metadata`: Key-value pairs (author, version)
- `license`: License reference

### Naming Conventions

- Skill directory: `kebab-case`
- SKILL.md: Always uppercase, exact filename
- Reference docs: `kebab-case.md`, prefixed with source skill name when absorbing sub-references (e.g., `pgpm-commands.md`)

## Key Design Principles

- **Umbrella skills over individual skills** — group related topics into one skill with reference docs, not many small skills
- Skills are loaded on-demand (only name/description at startup, full SKILL.md when activated)
- Keep SKILL.md as an index (summaries + links); put detailed docs in `references/`
- Write specific descriptions with trigger phrases from ALL absorbed subtopics
- Background skills (`user-invocable: false`) load automatically — use for foundational knowledge
