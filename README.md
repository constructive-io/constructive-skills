This file originated from https://github.com/vercel-labs/agent-skills/blob/main/README.md and has been modified for this repository.

# Constructive Skills

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows.

Skills follow the [Agent Skills](https://agentskills.io/) format.

## Available Skills

### constructive-graphql-codegen

Generate and use type-safe React Query hooks or Prisma-like ORM client from PostGraphile GraphQL endpoints using `@constructive-io/graphql-codegen`.

**Use when:**
- "Generate GraphQL hooks"
- "Generate ORM from GraphQL"
- "Set up codegen for my GraphQL schema"
- "Use the generated hooks/ORM"
- "Query the database"
- "Fetch data with codegen"

**Features:**
- Generates React Query hooks (TanStack Query v5) for client-side data fetching
- Generates Prisma-like ORM client for server-side operations
- Type-safe select with const generics for narrowed return types
- Typed relation support (belongsTo, hasMany, manyToMany)
- Error handling with discriminated unions (`.unwrap()`, `.unwrapOr()`)
- Comprehensive usage patterns in references

**Requirements:**
- Node.js 18+
- PostGraphile v5+ endpoint with `_meta` query support

## Usage

Skills are automatically available to AI agents once installed. The agent will use them when relevant tasks are detected.

**Examples:**
```
Generate GraphQL hooks for my PostGraphile endpoint
```
```
Use the generated ORM to fetch user data with their posts
```
```
Set up codegen with filtering for specific tables
```

## Skill Structure

Each skill contains:
- `SKILL.md` - Instructions for the agent following the Agent Skills format
- `references/` - Supporting documentation loaded on-demand

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT
