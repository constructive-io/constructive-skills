# Pagination

Constructive GraphQL uses the Relay connection pattern for all list queries. Every `findMany` returns a connection with `nodes`, `totalCount`, and `pageInfo`.

## Connection Structure

```typescript
interface ConnectionResult<T> {
  nodes: T[];
  totalCount: number;
  pageInfo: PageInfo;
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}
```

Every list query returns this shape:

```typescript
const result = await db.user.findMany({
  select: { id: true, name: true },
  first: 10,
}).execute();

if (result.ok) {
  const { nodes, totalCount, pageInfo } = result.value;
  // nodes: User[] — the actual records
  // totalCount: number — total matching records (regardless of pagination)
  // pageInfo.hasNextPage: boolean — more pages available?
  // pageInfo.endCursor: string — pass to `after` for next page
}
```

<details>
<summary>Equivalent GraphQL</summary>

```graphql
{
  users(first: 10) {
    nodes {
      id
      name
    }
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
```

</details>

## FindMany Pagination Options

```typescript
interface FindManyArgs {
  first?: number;   // Limit: return first N records
  last?: number;    // Return last N records (requires before cursor)
  after?: string;   // Forward cursor: records after this cursor
  before?: string;  // Backward cursor: records before this cursor
  offset?: number;  // Skip N records (simple offset)
}
```

---

## Offset-Based Pagination

The simplest approach — use `first` (limit) and `offset` (skip):

```typescript
const PAGE_SIZE = 20;

// Page 1
const page1 = await db.user.findMany({
  select: { id: true, name: true, email: true },
  orderBy: ['CREATED_AT_DESC'],
  first: PAGE_SIZE,
  offset: 0,
}).execute();

// Page 2
const page2 = await db.user.findMany({
  select: { id: true, name: true, email: true },
  orderBy: ['CREATED_AT_DESC'],
  first: PAGE_SIZE,
  offset: PAGE_SIZE,
}).execute();

// Page N
const pageN = await db.user.findMany({
  select: { id: true, name: true, email: true },
  orderBy: ['CREATED_AT_DESC'],
  first: PAGE_SIZE,
  offset: (pageNumber - 1) * PAGE_SIZE,
}).execute();
```

### When to Use Offset

- Simple page number navigation (page 1, 2, 3...)
- Admin tables with "go to page" controls
- Small datasets where performance isn't critical
- When you need to jump to arbitrary pages

### Offset Limitations

- **Performance**: Large offsets scan and skip rows (slow on big tables)
- **Instability**: If rows are inserted/deleted between pages, you may skip or duplicate records

---

## Cursor-Based Pagination

Use `after`/`before` with cursors from `pageInfo` for stable, performant pagination:

```typescript
const PAGE_SIZE = 20;

// First page
const page1 = await db.user.findMany({
  select: { id: true, name: true, email: true },
  orderBy: ['CREATED_AT_DESC'],
  first: PAGE_SIZE,
}).execute();

// Next page — use endCursor from previous page
if (page1.ok && page1.value.pageInfo.hasNextPage) {
  const page2 = await db.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: ['CREATED_AT_DESC'],
    first: PAGE_SIZE,
    after: page1.value.pageInfo.endCursor,
  }).execute();
}
```

### Backward Pagination

Use `last` + `before` to paginate backwards:

```typescript
// Previous page — use startCursor
if (currentPage.ok && currentPage.value.pageInfo.hasPreviousPage) {
  const prevPage = await db.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: ['CREATED_AT_DESC'],
    last: PAGE_SIZE,
    before: currentPage.value.pageInfo.startCursor,
  }).execute();
}
```

### When to Use Cursors

- Infinite scroll / "load more" UIs
- Real-time feeds where data changes frequently
- Large datasets where offset would be slow
- Any case where pagination stability matters

---

## Infinite Scroll (ORM)

```typescript
async function loadAllPages() {
  const PAGE_SIZE = 50;
  let allItems: User[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await db.user.findMany({
      select: { id: true, name: true },
      orderBy: ['CREATED_AT_DESC'],
      first: PAGE_SIZE,
      ...(cursor ? { after: cursor } : {}),
    }).execute();

    if (result.ok) {
      allItems = [...allItems, ...result.value.nodes];
      hasMore = result.value.pageInfo.hasNextPage;
      cursor = result.value.pageInfo.endCursor ?? undefined;
    } else {
      break;
    }
  }

  return allItems;
}
```

## Infinite Scroll (React Query Hooks)

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
          users(first: 20, after: $after, orderBy: CREATED_AT_DESC) {
            nodes { id name email }
            totalCount
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
  const totalCount = data?.pages[0]?.users.totalCount ?? 0;

  return (
    <>
      <p>{totalCount} total users</p>
      <ul>
        {allUsers.map((user) => (
          <li key={user.id}>{user.name} ({user.email})</li>
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

---

## Paginated Table Component

```typescript
import { useState } from 'react';

function PaginatedUserTable() {
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);

  const { data, isLoading } = useUsersQuery({
    first: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    orderBy: ['CREATED_AT_DESC'],
  });

  const totalCount = data?.users?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const users = data?.users?.nodes ?? [];

  return (
    <>
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td></tr>
          ))}
        </tbody>
      </table>
      <div>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          Previous
        </button>
        <span>Page {page + 1} of {totalPages}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}>
          Next
        </button>
      </div>
    </>
  );
}
```

---

## Pagination with Search

Pagination works seamlessly with search filters:

```typescript
const result = await db.article.findMany({
  where: { fullTextSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  first: 20,
  select: {
    title: true,
    searchScore: true,
  },
}).execute();

// totalCount reflects total matching results (not just this page)
console.log(`Found ${result.value.totalCount} results`);

// Paginate through search results
if (result.value.pageInfo.hasNextPage) {
  const nextPage = await db.article.findMany({
    where: { fullTextSearch: 'machine learning' },
    orderBy: 'SEARCH_SCORE_DESC',
    first: 20,
    after: result.value.pageInfo.endCursor,
    select: {
      title: true,
      searchScore: true,
    },
  }).execute();
}
```

---

## Pagination with Relations

Paginate nested relations independently:

```typescript
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
      first: 5,  // Only first 5 posts per user
      orderBy: ['CREATED_AT_DESC'],
    },
  },
  first: 10,
}).execute();
```

---

## Offset vs Cursor Comparison

| Feature | Offset (`first` + `offset`) | Cursor (`first` + `after`) |
|---------|---------------------------|--------------------------|
| Jump to arbitrary page | Yes | No |
| Stable under inserts/deletes | No | Yes |
| Performance on large datasets | Degrades with large offsets | Constant |
| Total page count | `Math.ceil(totalCount / pageSize)` | N/A (no page numbers) |
| Best UI pattern | Page number navigation | Infinite scroll / load more |
| Backward navigation | `offset: (page - 1) * size` | `last` + `before: startCursor` |
