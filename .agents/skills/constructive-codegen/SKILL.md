---
name: constructive-codegen
description: "Code generation pipeline — config, templates, AST transforms, schema introspection, and generating typed TypeScript clients (ORM, hooks, CLI) from GraphQL schemas. Use when asked to 'generate code', 'codegen', 'generate ORM', 'generate hooks', 'generate CLI', 'cnc codegen', 'graphql-codegen config', 'schema export', 'introspection', or when working with @constructive-io/graphql-codegen."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Codegen

The code generation pipeline: introspect a GraphQL schema → generate typed TypeScript clients (ORM, React Query hooks, CLI).

## When to Apply

Use this skill when:
- Generating TypeScript clients from a GraphQL schema
- Configuring codegen options (output paths, targets, schema sources)
- Understanding the generation pipeline (introspection → AST → templates → output)
- Exporting GraphQL SDL from a database or endpoint
- Working with `@constructive-io/graphql-codegen` or `cnc codegen`

## The Pipeline

```
Schema Source (file / endpoint / db / pgpm module)
  → Introspection (GraphQL SDL)
    → AST Transform (normalize types, relations, search fields)
      → Template Rendering (ORM classes, hooks, CLI commands)
        → Output (TypeScript files)
```

## Quick Start

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
  cli: true,
});
```

Or via CLI:

```bash
cnc codegen --orm --react-query --cli \
  --schema ./schemas/public.graphql \
  --output ./src/generated
```

## Schema Sources

| Source | Config |
|--------|--------|
| GraphQL SDL file | `schemaFile: './schema.graphql'` |
| Running endpoint | `endpoint: 'http://localhost:5000/graphql'` |
| Database connection | `db: { connectionString: '...' }` |
| pgpm module | `pgpmModule: 'my-module'` |

## Generation Targets

| Target | Output | Use |
|--------|--------|-----|
| `orm: true` | Prisma-like ORM client | Server-side queries |
| `reactQuery: true` | React Query hooks | Client-side data fetching |
| `cli: true` | Interactive CLI commands | Admin tooling |
| `schemas: true` | GraphQL SDL export | Schema distribution |

## Relation Handling

Codegen auto-detects relations and generates:
- Nested select types for related entities
- Relation-aware create/update inputs
- Junction table helpers for ManyToMany

See [codegen-relations.md](./references/codegen-relations.md) for details.

## Error Handling

Generated clients use discriminated unions — `.execute()` returns `{ data, errors }`, not thrown exceptions. Chain `.execute().unwrap()` for throw-on-error behavior.

See [codegen-error-handling.md](./references/codegen-error-handling.md) for patterns.

## References

| File | Content |
|------|---------|
| [codegen.md](./references/codegen.md) | Full codegen setup and overview |
| [codegen-config-reference.md](./references/codegen-config-reference.md) | All configuration options |
| [codegen-generate-schemas.md](./references/codegen-generate-schemas.md) | Schema export and SDL generation |
| [codegen-generate-sdk.md](./references/codegen-generate-sdk.md) | ORM/SDK generation details |
| [codegen-generate-cli.md](./references/codegen-generate-cli.md) | CLI generation details |
| [codegen-cli-reference.md](./references/codegen-cli-reference.md) | CLI command reference |
| [codegen-relations.md](./references/codegen-relations.md) | Relation handling in codegen |
| [codegen-error-handling.md](./references/codegen-error-handling.md) | Error handling patterns |

## Cross-References

- **Generated ORM patterns:** [`constructive-orm`](../constructive-orm/SKILL.md)
- **Generated hooks patterns:** [`constructive-hooks`](../constructive-hooks/SKILL.md)
- **Data modeling (tables, fields):** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
