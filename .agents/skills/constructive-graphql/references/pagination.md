# Pagination

Complete reference for pagination in Constructive's GraphQL layer — covering the Connection model, offset vs cursor pagination, forward vs backward paging, nested relations, and usage across ORM, React Query hooks, and runtime query builder.

## The Connection Model

Every list field in PostGraphile returns a **Connection** type, not a raw array. This is based on the [Relay Cursor Connections Specification](https://relay.dev/graphql/connections.htm) with PostGraphile enhancements:

```graphql
type UsersConnection {
  nodes: [User!]!              # The records
  totalCount: Int!             # Total matching rows
  pageInfo: PageInfo!          # Pagination metadata
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: Cursor          # Cursor of first row in page
  endCursor: Cursor            # Cursor of last row in page
}
```

Constructive uses `nodes` exclusively. Cursors for page-level navigation come from `pageInfo.startCursor` / `pageInfo.endCursor`.

---

## Connection Arguments

Every connection field accepts these pagination arguments:

| Argument | Type | Purpose |
|----------|------|---------|
| `first` | `Int` | Take first N rows (forward pagination) |
| `last` | `Int` | Take last N rows (backward pagination) |
| `after` | `Cursor` | Start after this cursor (forward cursor pagination) |
| `before` | `Cursor` | Start before this cursor (backward cursor pagination) |
| `offset` | `Int` | Skip N rows (offset pagination) |
| `condition` | `*Condition` | Exact-match filter |
| `filter` / `where` | `*Filter` | Rich filter (comparison operators) |
| `orderBy` | `[*OrderBy!]` | Sort order |

---

## Offset-Based Pagination

Skip N rows, take M. Simple, supports random page access ("page 3 of 12").

### ORM

```typescript
// Page 1
const page1 = await db.user.findMany({
  select: { id: true, name: true, email: true },
  first: 20,
  offset: 0,
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();

// Page 3
const page3 = await db.user.findMany({
  select: { id: true, name: true, email: true },
  first: 20,
  offset: 40,   // (page - 1) * pageSize
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();
```

### React Query Hooks

```typescript
function UserTable({ page, pageSize }: { page: number; pageSize: number }) {
  const { data, isLoading } = useUsersQuery({
    first: pageSize,
    offset: (page - 1) * pageSize,
    orderBy: ['CREATED_AT_DESC'],
  });

  const users = data?.users?.nodes ?? [];
  const total = data?.users?.totalCount ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <table>{/* render users */}</table>
      <Pagination current={page} total={totalPages} />
    </>
  );
}
```

### Runtime Query Builder

```typescript
import { buildSelect } from '@constructive-io/graphql-query';

const query = buildSelect(userTable, tables, {
  first: 20,
  offset: 40,
});
// Generated query includes $first: Int, $offset: Int variables
```

### Legacy QueryBuilder (graphql-query)

```typescript
const result = builder
  .query('User')
  .getMany()
  .select()
  .print();
// Pass { first: 20, offset: 40 } as variables at execution time
```

**Trade-offs:**
- Random page access (jump to page N)
- Performance degrades at high offsets — database must scan all skipped rows
- Rows can shift between pages if data is inserted/deleted between requests

---

## Cursor-Based Pagination

Resume from an opaque position marker. Stable, performant, ideal for infinite scroll.

### ORM — Forward Pagination

```typescript
// Page 1 — request pageInfo to get cursors
const page1 = await db.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  },
  first: 20,
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();
// page1 is ConnectionResult: { nodes, totalCount, pageInfo }
// pageInfo.endCursor and pageInfo.hasNextPage are always included

// Page 2 — pass endCursor from page 1
const page2 = await db.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  },
  first: 20,
  after: page1.pageInfo.endCursor,
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();
```

### ORM — Backward Pagination

```typescript
// Last 20 items
const lastPage = await db.user.findMany({
  select: { id: true, name: true },
  last: 20,
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();

// Previous page — use startCursor + before
const prevPage = await db.user.findMany({
  select: { id: true, name: true },
  last: 20,
  before: lastPage.pageInfo.startCursor,
  orderBy: ['CREATED_AT_DESC'],
}).execute().unwrap();
```

### React Query Hooks — Infinite Scroll

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { createClient } from '@/generated/orm';

const db = createClient({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${getToken()}` },
});

function InfiniteUserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['users', 'infinite'],
    queryFn: async ({ pageParam }) => {
      return db.user.findMany({
        select: { id: true, name: true, email: true },
        first: 20,
        after: pageParam,
        orderBy: ['CREATED_AT_DESC'],
      }).execute().unwrap();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage
        ? lastPage.pageInfo.endCursor
        : undefined,
  });

  const allUsers = data?.pages.flatMap((page) => page.nodes) ?? [];

  return (
    <>
      <ul>
        {allUsers.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </>
  );
}
```

### Runtime Query Builder

```typescript
import { buildSelect } from '@constructive-io/graphql-query';

// Cursor args trigger automatic pageInfo inclusion in the generated query
const query = buildSelect(userTable, tables, {
  first: 20,
  after: cursor,         // triggers pageInfo in output
  includePageInfo: true, // or set explicitly
});
```

**Trade-offs:**
- Stable pagination — inserting/deleting rows doesn't shift pages
- O(1) seek performance — no scanning skipped rows
- No random page access — must traverse sequentially
- Ideal for feeds, infinite scroll, real-time data

---

## Combining Offset and Cursor

PostGraphile supports both simultaneously on the same connection. You can mix them, though it's rarely needed:

```typescript
// Cursor + offset: "skip 5 after this cursor, then take 10"
const result = await db.user.findMany({
  select: { id: true, name: true },
  first: 10,
  after: someCursor,
  offset: 5,
}).execute().unwrap();
```

---

## Pagination on Nested Relations

Nested hasMany and manyToMany relations are also connections. Control their pagination independently:

```typescript
const user = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    name: true,
    // hasMany — paginate posts independently
    posts: {
      select: {
        id: true,
        title: true,
        // Nested hasMany — paginate comments too
        comments: {
          select: { id: true, body: true },
          first: 3,
        },
      },
      first: 10,
      orderBy: ['CREATED_AT_DESC'],
    },
    // manyToMany — paginate tags
    tags: {
      select: { id: true, name: true },
      first: 50,
    },
  },
}).execute();
```

In the ORM codegen, nested connections use a default `first: 20` limit unless you specify otherwise. The runtime `buildSelect` generator uses `first: 20` for nested hasMany/manyToMany relations.

---

## TypeScript Types

### ORM Generated Types

The ORM codegen generates these pagination-related types in the output:

```typescript
// Connection wrapper — returned by findMany()
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

// findMany arguments — includes all pagination params
interface FindManyArgs<TSelect, TWhere, TCondition, TOrderBy> {
  select?: TSelect;
  where?: TWhere;
  condition?: TCondition;
  orderBy?: TOrderBy[];
  first?: number;
  last?: number;
  after?: string;     // Cursor (opaque string)
  before?: string;    // Cursor (opaque string)
  offset?: number;
}
```

### Runtime Types

```typescript
// graphql-query types (types/query.ts)
interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}

interface ConnectionResult<T = unknown> {
  nodes: T[];
  totalCount: number;
  pageInfo: PageInfo;
}
```

---

## Offset vs Cursor — Decision Matrix

| Factor | Offset (`first`/`offset`) | Cursor (`first`/`after`) |
|--------|---------------------------|--------------------------|
| **Performance** | Degrades at high offsets | Constant — seeks directly |
| **Data stability** | Rows shift on insert/delete | Stable position |
| **Random access** | Yes — jump to any page | No — sequential only |
| **UI pattern** | Numbered page buttons | Infinite scroll / "Load More" |
| **Backward paging** | `offset: (page-1) * size` | `last: N, before: cursor` |
| **Sorting required** | Recommended but optional | Required (cursor encodes sort position) |
| **PostGraphile support** | Yes | Yes |
| **ORM support** | Yes | Yes |
| **Can combine** | Yes — both work on same connection | Yes |

**Rule of thumb:**
- **Admin tables, reports, dashboards** with page numbers → offset
- **Feeds, timelines, infinite scroll, mobile lists** → cursor
- **When in doubt** → cursor (better performance characteristics, PostGraphile default)

---

## Common Patterns

### Paginated Admin Table with Total Count

```typescript
async function getUsers(page: number, pageSize: number, search?: string) {
  const db = getDb();
  return db.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    where: search
      ? { or: [
          { name: { includes: search } },
          { email: { includes: search } },
        ]}
      : undefined,
    orderBy: ['CREATED_AT_DESC'],
    first: pageSize,
    offset: (page - 1) * pageSize,
  }).execute().unwrap();
  // result.totalCount gives you total for pagination UI
  // result.nodes gives you the page data
}
```

### Cursor-Based Feed with "Load More"

```typescript
async function loadFeed(cursor?: string) {
  const db = getDb();
  return db.post.findMany({
    select: {
      id: true,
      title: true,
      body: true,
      author: { select: { id: true, name: true, avatar: true } },
      createdAt: true,
    },
    where: { published: { equalTo: true } },
    orderBy: ['CREATED_AT_DESC'],
    first: 20,
    after: cursor,
  }).execute().unwrap();
  // result.pageInfo.hasNextPage — show "Load More" button
  // result.pageInfo.endCursor — pass to next loadFeed() call
}
```

### Count-Only Query

```typescript
// When you just need the count, not the data
const result = await db.user.findMany({
  select: { id: true },
  where: { role: { equalTo: 'ADMIN' } },
}).execute().unwrap();
// result.totalCount — the count you need
// result.nodes — minimal, just IDs (can't avoid selecting at least one field)
```

---

## Codebase Reference

| Component | File | Pagination Behavior |
|-----------|------|-------------------|
| **ORM codegen** `findMany` | `codegen/orm/model-generator.ts:290-457` | Generates `first`, `last`, `after`, `before`, `offset` args; always uses `nodes` |
| **ORM codegen** `ConnectionResult` | `codegen/templates/select-types.ts:11-22` | `{ nodes: T[], totalCount, pageInfo }` |
| **ORM runtime** `buildFindManyDocument` | `codegen/templates/query-builder.ts:204-320` | Builds connection query with `nodes`, `totalCount`, `pageInfo` |
| **Runtime** `buildSelect` | `query/generators/select.ts:351-526` | `nodes` always; `pageInfo` conditional on cursor args or `includePageInfo` |
| **Legacy QueryBuilder** | `query/query-builder.ts` | Pagination via variables at execution time |
| **Legacy AST** `getMany` | `query/ast.ts:183-302` | Builds `nodes`-based connection queries |
