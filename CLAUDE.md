# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows, following the [Agent Skills](https://agentskills.io/) format.

## Available Skills

### constructive-graphql-codegen

Generate and use type-safe React Query hooks or Prisma-like ORM client from PostGraphile GraphQL endpoints.

**Triggers**: "generate GraphQL hooks", "generate ORM", "set up codegen", "use generated hooks", "query with ORM", "fetch data"

## Commands

### Package a skill for distribution
```bash
cd skills
zip -r {skill-name}.zip {skill-name}/
```

## Skill Structure

```
skills/
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
