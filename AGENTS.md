This file originated from https://github.com/vercel-labs/agent-skills/blob/main/AGENTS.md and has been modified for this repository.

# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A collection of skills for different AI agents for working with Constructive tooling. Skills are packaged instructions and scripts that extend agents' capabilities.

Skills are organized as **domain-grouped umbrella skills** — each skill covers an entire area of the platform with reference docs for subtopics, following the pattern established by [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills).

## Available Skills

| Skill | Domain | Covers |
|-------|--------|--------|
| `constructive` | Platform core | Safegres security model, services/schemas, deployment, server config, cloud functions, cnc CLI |
| `constructive-database` | Database | pgpm migrations, workspace/module init, boilerplate authoring, CI/CD for database testing |
| `constructive-graphql` | GraphQL & API | Code generation (hooks, ORM, CLI), runtime queries, dynamic CRUD forms, pgvector integration |
| `constructive-frontend` | UI & Frontend | @constructive-io/ui components, CRUD Stack cards, Next.js boilerplate |
| `constructive-testing` | Testing | pgsql-test, Drizzle ORM testing, Supabase testing, SQL parser testing |
| `constructive-ai` | AI & RAG | pgvector, Ollama embeddings, RAG pipelines, CI/CD for AI |
| `constructive-tooling` | DevOps & CLI | PNPM workspaces, CLI development (inquirerer), README formatting, planning/specs |
| `fbp` | Flow-Based Programming | FBP types, graph spec, evaluator, visual graph editor |

All skills are **background skills** (`user-invocable: false`) — they load automatically when their domain is relevant.

## Skill Structure

Each skill follows the umbrella pattern — an index SKILL.md linking to reference docs:

```
skills/
  {skill-name}/
    SKILL.md              # Index: frontmatter + H2 summaries linking to references
    references/           # Detailed documentation for each subtopic
      {topic}.md
```

### SKILL.md Format

Each umbrella skill has an index SKILL.md with YAML frontmatter:

```yaml
---
name: {skill-name}
description: {Description with trigger phrases covering ALL subtopics}
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---
```

The body contains H2 sections — one per subtopic — with:
- 2-4 bullet point summary
- Trigger phrases
- Link to the reference doc: `See [filename.md](./references/filename.md) for details.`

Required frontmatter fields:
- `name`: Max 64 chars, lowercase + numbers + hyphens, must match directory name
- `description`: Max 1024 chars, include trigger phrases from all subtopics

Optional frontmatter fields:
- `user-invocable`: Set to `false` for background skills (auto-loaded)
- `compatibility`: Environment requirements (Node.js version, dependencies)
- `metadata`: Key-value pairs (author, version)
- `license`: License reference

### Naming Conventions

- **Skill directory**: `kebab-case` (e.g., `constructive-graphql`, `constructive-ai`)
- **SKILL.md**: Always uppercase, always this exact filename
- **Reference docs**: `kebab-case.md`, prefixed with source name when absorbing sub-references (e.g., `pgpm-commands.md`, `ui-forms.md`)

### Best Practices for Context Efficiency

Skills are loaded on-demand — only the skill name and description are loaded at startup. The full `SKILL.md` loads into context only when the agent decides the skill is relevant. To minimize context usage:

- **Keep SKILL.md as an index** — summaries and links only, no code examples
- **Put detailed docs in `references/`** — agents read only what's needed for the current task
- **Write specific descriptions** — include trigger phrases from all absorbed subtopics so agents know when to activate
- **Use progressive disclosure** — SKILL.md links to references, which may link to sub-references
- **Split by topic** — each reference file covers one specific aspect (API, patterns, configuration, etc.)

### Reference Documentation

The `references/` directory contains detailed documentation split into focused sections for selective reading by agents.

**Structure:**
```
skills/
  {skill-name}/
    SKILL.md
    references/
      {topic}.md              # Main reference doc (one per absorbed subtopic)
      {prefix}-{subtopic}.md  # Sub-references from original skill's references/
```

**Best Practices:**
- **One file per absorbed skill** — each original skill becomes a reference doc
- **Prefix sub-references** — when an absorbed skill had its own references/, prefix those filenames (e.g., `pgpm-commands.md`, `ui-forms.md`)
- **Clear naming** — file names should indicate exactly what content they contain
- **Reference from SKILL.md** — list all reference files with brief descriptions so agents know which to read
- **Selective reading** — agents should read only the relevant reference files for their current task

### Adding a New Subtopic

To add a new subtopic to an existing umbrella skill:

1. Create the reference doc in `references/{topic}.md`
2. Add an H2 section to the skill's `SKILL.md` with summary and link
3. Update the `description` in frontmatter to include new trigger phrases

### Creating a New Umbrella Skill

Only create a new umbrella skill when the topic doesn't fit any existing domain. Follow the same pattern:

1. Create `skills/{skill-name}/SKILL.md` with the index format
2. Create `skills/{skill-name}/references/` with reference docs
3. Update this file and `CLAUDE.md` with the new skill
