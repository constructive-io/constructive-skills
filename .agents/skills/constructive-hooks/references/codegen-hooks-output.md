# Generated hooks output

`@constructive-io/graphql-codegen` can emit React Query hooks, operation types, query keys, and mutation helpers for a known schema. Exact files and exports depend on the generator version and configuration, so treat the generated directory as the API reference for that application.

## Intended surface

Generated output commonly contains:

```text
generated/hooks/
├── index.ts
├── types.ts
├── queryKeys.ts
├── queries/
└── mutations/
```

The schema snapshot owns hook names, variable types, result types, filters, relations, and mutation inputs. Regenerate when that schema changes and review the diff before merging.

## Transport audit

Before using generated hooks, inspect how requests receive their endpoint and credentials:

- Prefer an instance-scoped transport or request function tied to one mounted application scope.
- A mutable module-global transport is unsuitable for server rendering, concurrent tenant mounts, tenant switching, or identity switching.
- Never embed endpoint URLs or tokens in generated source.
- Never derive another endpoint from the generated endpoint.
- Clear or partition QueryClient state by database and identity when either can change.

If the generator version emits only a process-wide mutable client, use it only for a single immutable endpoint deployment or choose the per-instance Blocks/runtime data layer.

## Query keys

Generated query keys should distinguish collection, filtered-list, and detail data. Application code may add database and identity scope above the generated key when a QueryClient outlives either scope.

Invalidate the smallest key that covers the mutation result. Remove identity-scoped entries on sign-out before another identity can reuse them.

## Runtime limits

Generated hooks describe operations present at generation time. They do not establish current reachability, tenant identity, token validity, grants, or RLS visibility. Handle those outcomes from the actual request and never fall through to privileged routing.
