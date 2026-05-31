---
name: constructive-hooks
description: "Generated React Query hooks — query/mutation hooks, cache management, optimistic updates, and hook patterns. Use when asked to 'use hooks', 'React Query hooks', 'useQuery', 'useMutation', 'cache invalidation', 'optimistic updates', 'generated hooks', or when working with the generated React Query client from @constructive-io/graphql-codegen."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Hooks

Generated React Query hooks for Constructive — typed query/mutation hooks with cache management and optimistic updates.

## When to Apply

Use this skill when:
- Using generated React Query hooks in a React/Next.js app
- Configuring the hooks client (endpoint, auth headers)
- Implementing cache invalidation and optimistic updates
- Understanding the generated hook naming conventions

## Quick Start

```typescript
import { configure, useUsersQuery, useCreateUserMutation } from '@/generated/hooks';

// Configure once at app startup
configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${getToken()}` },
});

// Query hook
function UserList() {
  const { data, isLoading } = useUsersQuery({ first: 10 });
  return <ul>{data?.users?.nodes.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

// Mutation hook
function CreateUser() {
  const create = useCreateUserMutation();
  return (
    <button onClick={() => create.mutate({ input: { name: 'John' } })}>
      Create
    </button>
  );
}
```

## Naming Conventions

| Operation | Hook Name | Example |
|-----------|-----------|---------|
| Query (list) | `use{Table}sQuery` | `useUsersQuery` |
| Query (single) | `use{Table}Query` | `useUserQuery` |
| Create | `useCreate{Table}Mutation` | `useCreateUserMutation` |
| Update | `useUpdate{Table}Mutation` | `useUpdateUserMutation` |
| Delete | `useDelete{Table}Mutation` | `useDeleteUserMutation` |

## Cache Management

Generated hooks use React Query's cache with auto-generated query keys. After mutations, invalidate related queries:

```typescript
const queryClient = useQueryClient();
const create = useCreateUserMutation({
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  },
});
```

## References

| File | Content |
|------|---------|
| [codegen-hooks-output.md](./references/codegen-hooks-output.md) | Generated hooks API reference |
| [codegen-hooks-patterns.md](./references/codegen-hooks-patterns.md) | Advanced hook patterns and examples |

## Cross-References

- **Code generation pipeline:** [`constructive-codegen`](../constructive-codegen/SKILL.md)
- **ORM patterns (server-side):** [`constructive-orm`](../constructive-orm/SKILL.md)
- **Frontend components:** [`constructive-frontend`](../constructive-frontend/SKILL.md)
