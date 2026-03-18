# React Query Hooks Patterns

Advanced patterns for using generated React Query hooks.

## Setup Patterns

### Next.js App Router Setup

```typescript
// src/app/providers.tsx
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { configure } from '@/generated/hooks';

// Configure once at module level
configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### Dynamic Auth Headers

```typescript
// src/lib/graphql.ts
import { configure } from '@/generated/hooks';

let configured = false;

export function setupGraphQL(token: string) {
  configure({
    endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  configured = true;
}

export function isConfigured() {
  return configured;
}
```

## Query Patterns

### Dependent Queries

Execute a query only after another completes:

```typescript
function UserPosts({ userId }: { userId: string }) {
  const { data: user } = useUserQuery({ id: userId });

  const { data: posts } = usePostsQuery(
    {
      filter: { authorId: { eq: user?.user?.id } },
    },
    {
      enabled: !!user?.user?.id, // Only run when user is loaded
    }
  );

  return <PostList posts={posts?.posts?.nodes ?? []} />;
}
```

### Parallel Queries

Fetch multiple resources in parallel:

```typescript
function Dashboard() {
  const usersQuery = useUsersQuery({ first: 5 });
  const postsQuery = usePostsQuery({ first: 10 });
  const statsQuery = useStatsQuery();

  const isLoading =
    usersQuery.isLoading || postsQuery.isLoading || statsQuery.isLoading;

  if (isLoading) return <Spinner />;

  return (
    <>
      <UsersSummary users={usersQuery.data?.users?.nodes} />
      <RecentPosts posts={postsQuery.data?.posts?.nodes} />
      <Stats stats={statsQuery.data?.stats} />
    </>
  );
}
```

### Infinite Scroll / Load More

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { execute, queryKeys } from '@/generated/hooks';

function InfiniteUserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: async ({ pageParam }) => {
      return execute(`
        query Users($after: Cursor) {
          users(first: 10, after: $after) {
            nodes { id name email }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { after: pageParam });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.users.pageInfo.hasNextPage
        ? lastPage.users.pageInfo.endCursor
        : undefined,
  });

  const allUsers = data?.pages.flatMap((page) => page.users.nodes) ?? [];

  return (
    <>
      <ul>
        {allUsers.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </>
  );
}
```

### Polling / Auto-Refresh

```typescript
function LiveNotifications() {
  const { data } = useNotificationsQuery(
    { filter: { read: { eq: false } } },
    {
      refetchInterval: 30000, // Poll every 30 seconds
      refetchIntervalInBackground: true,
    }
  );

  return <NotificationBadge count={data?.notifications?.totalCount ?? 0} />;
}
```

### Optimistic Updates

```typescript
function ToggleFavorite({ postId, isFavorite }: Props) {
  const queryClient = useQueryClient();
  const toggleFavorite = useToggleFavoriteMutation({
    onMutate: async ({ postId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });

      // Snapshot previous value
      const previous = queryClient.getQueryData(queryKeys.posts.detail(postId));

      // Optimistically update
      queryClient.setQueryData(queryKeys.posts.detail(postId), (old: any) => ({
        ...old,
        post: { ...old.post, isFavorite: !old.post.isFavorite },
      }));

      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      queryClient.setQueryData(
        queryKeys.posts.detail(variables.postId),
        context?.previous
      );
    },
    onSettled: (data, error, { postId }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
    },
  });

  return (
    <button onClick={() => toggleFavorite.mutate({ postId })}>
      {isFavorite ? '❤️' : '🤍'}
    </button>
  );
}
```

## Cache Management

### Invalidation Patterns

```typescript
// Invalidate all users
queryClient.invalidateQueries({ queryKey: queryKeys.users.all });

// Invalidate only user lists (not individual users)
queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });

// Invalidate specific user
queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(userId) });

// Invalidate multiple related queries
await Promise.all([
  queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  queryClient.invalidateQueries({ queryKey: queryKeys.posts.all }),
]);
```

### Pre-populate Cache

```typescript
// After fetching a list, populate individual item caches
const { data } = useUsersQuery({ first: 50 });

useEffect(() => {
  data?.users?.nodes.forEach((user) => {
    queryClient.setQueryData(queryKeys.users.detail(user.id), { user });
  });
}, [data, queryClient]);
```

### Prefetching

```typescript
function UserListItem({ user }: { user: User }) {
  const queryClient = useQueryClient();

  const prefetchUser = () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.users.detail(user.id),
      queryFn: () => fetchUser(user.id),
      staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
    });
  };

  return (
    <Link
      href={`/users/${user.id}`}
      onMouseEnter={prefetchUser}
      onFocus={prefetchUser}
    >
      {user.name}
    </Link>
  );
}
```

## Error Handling

### Global Error Handler

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      onError: (error) => {
        toast.error(`Operation failed: ${error.message}`);
      },
    },
  },
});
```

### Per-Query Error Handling

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, error, isError, refetch } = useUserQuery(
    { id: userId },
    {
      onError: (error) => {
        console.error('Failed to fetch user:', error);
        Sentry.captureException(error);
      },
    }
  );

  if (isError) {
    return (
      <ErrorCard
        message={error.message}
        onRetry={() => refetch()}
      />
    );
  }

  return <UserCard user={data?.user} />;
}
```

## TypeScript Patterns

### Extracting Types

```typescript
import type { User, Post, UsersQueryVariables } from '@/generated/hooks';

// Use generated types
interface UserCardProps {
  user: User;
}

// Type query variables
function buildUserFilter(search: string): UsersQueryVariables['filter'] {
  return {
    OR: [
      { name: { contains: search } },
      { email: { contains: search } },
    ],
  };
}
```

### Generic Data Table

```typescript
import type { User, Post } from '@/generated/hooks';

interface DataTableProps<T> {
  data: T[];
  columns: {
    key: keyof T;
    header: string;
    render?: (value: T[keyof T], item: T) => React.ReactNode;
  }[];
}

function DataTable<T extends { id: string }>({
  data,
  columns,
}: DataTableProps<T>) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={String(col.key)}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={item.id}>
            {columns.map((col) => (
              <td key={String(col.key)}>
                {col.render
                  ? col.render(item[col.key], item)
                  : String(item[col.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Usage with generated types
<DataTable<User>
  data={users}
  columns={[
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'createdAt', header: 'Created', render: (v) => formatDate(v) },
  ]}
/>
```
