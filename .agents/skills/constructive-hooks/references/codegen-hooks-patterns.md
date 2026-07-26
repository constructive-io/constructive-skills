# Generated hook patterns

Use generated React Query hooks only after verifying that their transport is correctly scoped for the application. These patterns assume a fixed endpoint or an instance-scoped request layer; they do not rely on mutable process-wide configuration.

## QueryClient lifecycle

Create one QueryClient per browser application instance and a fresh client per server request. When a browser client can switch databases or identities, partition keys by that scope or clear scoped data before the switch completes.

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

Do not combine this provider with a module-level tenant endpoint or token. The request transport must already be fixed for this mount or injected through an instance-scoped layer.

## Dependent queries

Use the `enabled` option when the second query depends on an identifier the first request may not reveal under RLS:

```tsx
const project = useProjectQuery({ id: projectId });
const ownerId = project.data?.project?.ownerId;
const owner = useUserQuery(
  { id: ownerId ?? '' },
  { enabled: typeof ownerId === 'string' }
);
```

If the first request returns no row, keep the dependent request disabled. Do not interpret the missing row as a reason to use a broader endpoint.

## Cache invalidation

After create, invalidate the relevant collection keys. After update, invalidate the affected detail and collection keys. After delete, remove the detail and invalidate collections.

When cache data is identity-scoped, include the database and identity in the key prefix or clear the prior prefix synchronously during sign-out.

## Optimistic updates

Use optimistic updates only when rollback is deterministic:

1. Cancel the exact queries being updated.
2. Snapshot their previous values.
3. Apply the smallest optimistic change.
4. Restore snapshots on error.
5. Invalidate on settlement so PostgreSQL and RLS decide the final visible state.

Do not optimistically add rows the user could not previously read or assume a successful mutation makes the returned row visible under the subsequent SELECT policy.

## Pagination

Prefer cursor pagination for changing datasets. Keep the endpoint, database, identity, filters, and ordering stable across pages, and discard the chain when any of those inputs changes.
