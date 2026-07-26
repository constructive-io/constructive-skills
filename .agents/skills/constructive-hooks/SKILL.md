---
name: constructive-hooks
description: "Use optional generated React Query hooks for a stable custom-domain schema and fixed endpoint, including query keys, invalidation, optimistic updates, and pagination. Use when a project deliberately generated hooks. Do not use generated hooks as a Console Kit or feature-pack runtime, or with process-wide mutable tenant configuration."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Hooks

Generated React Query hooks are an optional convenience for custom-domain applications with a stable schema and fixed endpoint boundary. Console Kit uses runtime discovery and adapters, standalone Data introspects through Sheets, and the other standalone feature packs receive resources and actions from their host.

## When to Apply

Use this skill when:

- The project already generates React Query hooks for its domain schema.
- Implementing generated query or mutation hooks, invalidation, optimistic updates, or pagination.
- Reviewing whether a generated hook layer is safe for a fixed deployment.

Do not use this skill to wire a dynamic tenant console. If endpoint or identity can change at runtime, prefer the Blocks adapter/runtime or a request function scoped to the mounted tenant.

## Isolation Rule

A generated hook layer is safe only when its transport cannot leak between tenants, users, or server requests. Do not mutate process-wide endpoint or header state from application startup, sign-in effects, or tenant switching logic.

If the generated output exposes only mutable module-global transport, restrict it to a client application with one immutable endpoint and one well-defined credential transport, or regenerate/use a per-instance data layer. Never share that singleton across server requests.

## Query and Mutation Patterns

Generated hook names and inputs come from the schema used at generation time. Use the generated types rather than reconstructing names from `_meta` at runtime.

```tsx
function ProjectList() {
  const projects = useProjectsQuery({ first: 20 });

  if (projects.isLoading) return <ProjectListSkeleton />;
  if (projects.error) return <ProjectListError error={projects.error} />;

  return <ProjectRows projects={projects.data?.projects?.nodes ?? []} />;
}
```

After a mutation, invalidate the narrowest generated key that covers the changed resource. For optimistic updates, snapshot the prior cache value, update only data the current identity could already read, restore the snapshot on error, and reconcile from the server on settlement.

See [codegen-hooks-patterns.md](./references/codegen-hooks-patterns.md) for cache and isolation patterns, and [codegen-hooks-output.md](./references/codegen-hooks-output.md) for the generated surface.

## RLS Behavior

- An empty result can be a valid RLS-filtered response.
- A mutation root in generated code does not prove the active identity can execute it.
- Cache keys must include the database and identity scope when one QueryClient can outlive either.
- Clear identity-scoped cache entries before another user inherits the client.
- Never retry an authorization failure through an operator endpoint.

## Cross-References

- [`constructive-blocks`](../constructive-blocks/SKILL.md) — feature-pack and Console Kit runtime.
- [`constructive-codegen`](../constructive-codegen/SKILL.md) — generation and schema ownership.
- [`constructive-orm`](../constructive-orm/SKILL.md) — per-scope server-side generated client.
- [`constructive-frontend`](../constructive-frontend/SKILL.md) — custom-domain UI composition.
