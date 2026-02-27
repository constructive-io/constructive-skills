---
name: graphql-codegen
description: "DEPRECATED: Use the `constructive-graphql-codegen` skill instead. This skill is kept for backward compatibility only."
---

# GraphQL Codegen (Deprecated)

**This skill has been superseded by `constructive-graphql-codegen`.**

Please use the `constructive-graphql-codegen` skill for all GraphQL code generation tasks. It covers:

- All schema sources: schema directory (recommended), schema file, endpoint, database, PGPM module
- Schema export (`schemaOnly`) for deterministic workflows
- All generators: React Query hooks, ORM client, CLI
- Documentation generation: README, AGENTS.md, MCP tools, skill files
- Multi-target configuration (via `schemaDir`, explicit targets, or `apiNames` auto-expansion)
- Node.js HTTP adapter for localhost subdomain resolution
- Filtering, authentication, and all configuration options

## Migration

Replace any reference to this skill with `constructive-graphql-codegen`.
