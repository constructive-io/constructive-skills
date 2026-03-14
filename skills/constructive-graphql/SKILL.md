---
name: constructive-graphql
description: "GraphQL and API layer for Constructive — build-time code generation (React Query hooks, Prisma-like ORM, CLI), runtime query generation from PostGraphile schema metadata, dynamic CRUD forms via _meta introspection, and pgvector integration for similarity search in GraphQL. Use when asked to generate GraphQL hooks, generate ORM, set up codegen, build dynamic forms, create CRUD UI, runtime query generation, or integrate pgvector with PostGraphile."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive GraphQL

Unified skill for the GraphQL and API layer in the Constructive ecosystem. Covers build-time code generation, runtime query generation, dynamic form rendering, and pgvector integration.

## Build-Time Code Generation (codegen)

- Generate type-safe React Query hooks, Prisma-like ORM client, or inquirerer-based CLI from GraphQL endpoints, schema files, databases, or PGPM modules using `@constructive-io/graphql-codegen`
- Supports schema export, multi-target generation, documentation output (README, AGENTS.md, MCP tools, skill files), and Node.js HTTP adapter for localhost subdomain routing
- Also generates documentation in multiple formats alongside code

**Trigger phrases:** "generate GraphQL hooks", "generate ORM", "generate CLI", "set up codegen", "generate docs", "generate skills", "export schema", implementing data fetching for a PostGraphile backend

See [codegen.md](./references/codegen.md) for details.

**Additional codegen references:**
- Workflow guides: [codegen-generate-sdk.md](./references/codegen-generate-sdk.md), [codegen-generate-schemas.md](./references/codegen-generate-schemas.md), [codegen-generate-cli.md](./references/codegen-generate-cli.md), [codegen-generate-node.md](./references/codegen-generate-node.md)
- Generated code usage: [codegen-hooks-patterns.md](./references/codegen-hooks-patterns.md), [codegen-hooks-output.md](./references/codegen-hooks-output.md), [codegen-orm-patterns.md](./references/codegen-orm-patterns.md), [codegen-orm-output.md](./references/codegen-orm-output.md)
- Supporting references: [codegen-error-handling.md](./references/codegen-error-handling.md), [codegen-relations.md](./references/codegen-relations.md), [codegen-query-keys.md](./references/codegen-query-keys.md), [codegen-node-http-adapter.md](./references/codegen-node-http-adapter.md), [codegen-cli-reference.md](./references/codegen-cli-reference.md), [codegen-config-reference.md](./references/codegen-config-reference.md)

## Runtime Query Generation (graphql-query)

- Browser-safe runtime GraphQL query generation from PostGraphile schema metadata using `@constructive-io/graphql-query`
- Provides generators for SELECT, FindOne, Count, Create, Update, and Delete operations, with field selection presets and relation field mapping
- Supports two introspection paths: standard GraphQL introspection and the PostGraphile `_meta` endpoint
- Core package that `graphql-codegen` depends on; use subpath imports for browser safety

**Trigger phrases:** "runtime query generation", "dynamic GraphQL queries", "browser-safe query builder", "PostGraphile _meta introspection", "CleanTable", "buildSelect", "buildFindOne"

See [runtime-queries.md](./references/runtime-queries.md) for details.

**Additional query references:**
- [query-generators-api.md](./references/query-generators-api.md) -- Complete API reference for all generators
- [query-meta-introspection.md](./references/query-meta-introspection.md) -- Full `_meta` query structure, response types, and `cleanTable()` adapter

## Dynamic CRUD Forms via _meta (meta-forms)

- Use the `_meta` GraphQL endpoint to introspect table schema at runtime and render fully dynamic CRUD forms with zero static field configuration
- Provides `DynamicFormCard` (create/edit/delete), `DynamicField` component, `useMeta`/`useTableMeta` hooks, and field renderer utilities
- Supports locked FK pre-fill from context via `defaultValues` and `defaultValueLabels` for related-record (O2M/M2M) patterns
- Automatic pgType-to-input mapping, required field detection, and system field exclusion

**Trigger phrases:** "build dynamic forms", "create CRUD UI", "DynamicFormCard", "_meta forms", "dynamic form for any table", "locked FK pre-fill", "defaultValues"

See [meta-forms.md](./references/meta-forms.md) for details.

## pgvector Integration for PostGraphile (pgvector-graphql)

- Integrate pgvector with PostGraphile v5 so `vector(n)` columns are surfaced as a `Vector` GraphQL scalar via `VectorCodecPlugin`
- Add vector similarity search (cosine, L2, inner product) as first-class GraphQL query fields via `PgVectorPlugin`/`PgVectorPreset`
- Covers codec registration, search field generation, codegen scalar mapping, SQL search function alternatives, and integration testing patterns

**Trigger phrases:** "expose vector search in GraphQL", "add embedding column to schema", "surface pgvector types in PostGraphile", "register vector codec", "vector similarity search", "AI-powered GraphQL APIs"

See [pgvector-graphql.md](./references/pgvector-graphql.md) for details.
