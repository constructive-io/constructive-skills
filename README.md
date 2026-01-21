This file originated from https://github.com/vercel-labs/agent-skills/blob/main/README.md and has been modified for this repository.

# Constructive Skills

A collection of skills for AI coding agents working with Constructive tooling. Skills are packaged instructions and scripts that extend agent capabilities for GraphQL development workflows.

Skills follow the [Agent Skills](https://agentskills.io/) format.

## Available Skills

### constructive-graphql-codegen

Generate type-safe React Query hooks or ORM code from GraphQL operations using Constructive's codegen tooling.

**Use when:**
- "Generate GraphQL hooks"
- "Create ORM code from GraphQL"
- "Set up codegen for my GraphQL operations"
- "Generate type-safe GraphQL code"

**Features:**
- Generates React Query hooks for client-side data fetching
- Generates ORM code for server-side database operations
- Supports both GraphQL endpoint and local database schema sources
- Full TypeScript type safety
- Configurable via config file or interactive prompts

**How it works:**
1. Checks for existing codegen configuration
2. Determines generation target (hooks or ORM) and schema source
3. Creates generation script using codegen function directly (preferred) or `cnc` CLI
4. Generates type-safe code from GraphQL operations

**Reference:** [Constructive Codegen Documentation](https://github.com/constructive-io/constructive/blob/main/graphql/codegen/README.md)

### use-constructive-generated-code

Use generated React Query hooks or ORM code from Constructive's codegen tooling in your application.

**Use when:**
- "Use the generated GraphQL hooks"
- "Implement this feature with the ORM code"
- "Query the database using generated code"
- "Working with previously generated codegen output"
- "Use codegen to do Graphql operations'

**Features:**
- Automatically identifies whether hooks or ORM code is available
- Guides proper usage of generated queries and mutations
- Enforces best practices: prefer generated code over raw SQL/GraphQL
- Ensures type safety through generated TypeScript types

**How it works:**
1. Verifies generated code exists and is properly configured
2. Identifies code type (hooks, ORM, or both)
3. Uses appropriate generated methods for queries and mutations
4. Avoids manual SQL or GraphQL operations when generated code is available

**Reference:** [Constructive Codegen Documentation](https://github.com/constructive-io/constructive/blob/main/graphql/codegen/README.md)

## Usage

Skills are automatically available to AI agents once installed. The agent will use them when relevant tasks are detected.

**Examples:**
```
Generate GraphQL hooks for my queries
```
```
Use the generated ORM to fetch user data
```
```
Set up codegen for my GraphQL schema
```

## Skill Structure

Each skill contains:
- `SKILL.md` - Instructions for the agent following the Agent Skills format
- `scripts/` - Helper scripts for automation (optional)
- `references/` - Supporting documentation (optional)

## Development

See [AGENTS.md](./AGENTS.md) for guidance on creating new skills for this repository.

## License

MIT