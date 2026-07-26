---
name: constructive-orm
description: "Use the optional generated Constructive ORM for typed queries, mutations, relations, pagination, and custom-domain server workflows against a stable GraphQL schema. Use when asked about findMany, findOne, create, update, delete, relations, or pagination in generated ORM code. Use Blocks runtime for dynamic tenant consoles and generic _meta CRUD."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive ORM

Use the generated Prisma-like ORM for stable custom-domain schemas. It is optional and must remain endpoint-scoped. Console Kit uses runtime discovery, standalone Data introspects through Sheets, and the other standalone feature packs receive resources and actions from their host.

## When to Apply

Use this skill when:

- A project has deliberately generated an ORM from a stable domain schema.
- Implementing typed queries, mutations, relations, or pagination in server code.
- Creating a client for one explicit endpoint and request/session scope.
- Debugging generated ORM output or regeneration drift.

Use [`constructive-blocks`](../constructive-blocks/SKILL.md) for Console Kit and feature-pack data. Use [`constructive-frontend`](../constructive-frontend/SKILL.md) for bespoke runtime `_meta` UI.

## Per-Scope Client

Create the ORM client from an explicit endpoint for the current request or tenant. Do not export a mutable process-wide client when endpoints or identities can change.

```ts
import { createClient } from '@/generated/orm';

export function createDomainClient(endpoint: string, accessToken: string) {
  return createClient({
    endpoint,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
```

Keep the token in the host session or server request boundary and create/dispose the binding with that scope.

## Query and Mutation Shape

```ts
const db = createDomainClient(dataEndpoint, accessToken);

const projects = await db.project.findMany({
  select: { id: true, name: true, completed: true },
  first: 20
}).execute().unwrap();

await db.project.update({
  where: { id: projectId },
  data: { completed: true },
  select: { id: true, completed: true }
}).execute().unwrap();
```

`.execute()` returns the generated result shape; use the generator's explicit unwrap/error helper where the caller wants thrown errors. Never interpret an empty collection as proof that the schema lacks rows—the active identity's RLS policy may be filtering them.

## Pagination

Prefer cursor pagination for mutable datasets and stable traversal. Offset pagination is suitable for bounded administrative views where page-number navigation matters and drift is acceptable.

See [pagination.md](./references/pagination.md) for generated pagination patterns.

## Runtime Metadata

The generated ORM is not the owner of the current `_meta` contract. Import the contract documents, types, compatibility guards, and operation-analysis helpers from `@constructive-io/data`, then reconcile `_meta` with standard introspection.

See [query-meta-introspection.md](./references/query-meta-introspection.md) for the evidence model. Use the Data feature pack instead of rebuilding generic table CRUD.

## References

| File | Content |
|---|---|
| [codegen-orm-output.md](./references/codegen-orm-output.md) | Generated ORM output |
| [codegen-orm-patterns.md](./references/codegen-orm-patterns.md) | Advanced custom-domain patterns |
| [pagination.md](./references/pagination.md) | Cursor and offset pagination |
| [query-generators-api.md](./references/query-generators-api.md) | Runtime operation generators |
| [query-runtime.md](./references/query-runtime.md) | Runtime query construction |
| [query-meta-introspection.md](./references/query-meta-introspection.md) | Current `_meta` and introspection boundary |
| [codegen-query-keys.md](./references/codegen-query-keys.md) | Generated query keys |

## Cross-References

- [`constructive-codegen`](../constructive-codegen/SKILL.md) — generation and regeneration.
- [`constructive-hooks`](../constructive-hooks/SKILL.md) — optional fixed-endpoint React Query layer.
- [`constructive-security`](../constructive-security/SKILL.md) — RLS and effective authorization.
