# ORM Patterns

Advanced patterns for using the generated Prisma-like ORM client.

## Client Setup

### Per-Scope Client

```typescript
// src/lib/db.ts
import { createClient } from '@/generated/orm';

export function createDomainClient(endpoint: string, accessToken: string) {
  return createClient({
    endpoint,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Usage
import { createDomainClient } from '@/lib/db';

const db = createDomainClient(dataEndpoint, accessToken);
const users = await db.user.findMany({...}).execute();
```

Never cache this client across tenant or identity scopes. In server code, create
it per request; in a browser, bind it to one mounted tenant/session instance.

### Per-Request Client (Next.js Server Components)

```typescript
// src/lib/db.ts
import { createClient } from '@/generated/orm';
import { cookies } from 'next/headers';

export async function createRequestClient(endpoint: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;

  return createClient({
    endpoint,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// Usage in Server Component
async function UserPage({ params }: { params: { id: string } }) {
  const db = await createRequestClient(dataEndpoint);
  const user = await db.user.findOne({
    id: params.id,
    select: { id: true, name: true },
  }).execute().unwrap();

  return <UserProfile user={user} />;
}
```

## Query Patterns

### Find First Matching Record

```typescript
// Find first user matching criteria
// Note: Field names (name, email, role) are schema-specific examples
const result = await db.user.findFirst({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
}).execute();

// Handle result with Result pattern
if (result.ok) {
  const user = result.data.users.nodes[0];
  if (user) {
    console.log('Found admin:', user.name);
  }
}

// Or use unwrap() to throw on error
const user = await db.user.findFirst({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
}).execute().unwrap();
```

**Note:** `findFirst()` does NOT support `orderBy`. If you need ordering, use `findMany()` with `first: 1`:

```typescript
const result = await db.user.findMany({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
  orderBy: ['CREATED_AT_DESC'],
  first: 1,
}).execute();
```

### Complex Filtering

```typescript
// Search with multiple conditions
async function searchUsers(db: DomainClient, query: string, filters: UserFilters) {
  return db.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    where: {
      and: [
        // Text search across multiple fields
        {
          or: [
            { name: { includes: query } },
            { email: { includes: query } },
          ],
        },
        // Additional filters
        ...(filters.role ? [{ role: { equalTo: filters.role } }] : []),
        ...(filters.active !== undefined
          ? [{ active: { equalTo: filters.active } }]
          : []),
        ...(filters.createdAfter
          ? [{ createdAt: { greaterThanOrEqualTo: filters.createdAfter } }]
          : []),
      ],
    },
    orderBy: ['CREATED_AT_DESC'],
    first: filters.limit ?? 20,
    offset: filters.offset ?? 0,
  }).execute();
}
```

### Conditional Selects

```typescript
// Build select object dynamically
function buildUserSelect(includeDetails: boolean) {
  const baseSelect = {
    id: true,
    name: true,
    email: true,
  } as const;

  if (includeDetails) {
    return {
      ...baseSelect,
      bio: true,
      avatar: true,
      createdAt: true,
      posts: {
        select: { id: true, title: true },
        first: 5,
      },
    } as const;
  }

  return baseSelect;
}

// Usage
const users = await db.user.findMany({
  select: buildUserSelect(includeDetails),
}).execute();
```

### Aggregation Queries

```typescript
// Get counts with filters
async function getUserStats(db: DomainClient) {
  const [totalResult, activeResult, adminResult] = await Promise.all([
    db.user.findMany({
      select: { id: true },
    }).execute(),
    db.user.findMany({
      select: { id: true },
      where: { active: { equalTo: true } },
    }).execute(),
    db.user.findMany({
      select: { id: true },
      where: { role: { equalTo: 'ADMIN' } },
    }).execute(),
  ]);

  return {
    total: totalResult.ok ? totalResult.value.length : 0,
    active: activeResult.ok ? activeResult.value.length : 0,
    admins: adminResult.ok ? adminResult.value.length : 0,
  };
}
```

## Relation Patterns

### Eager Loading

```typescript
// Load user with all related data
async function getUserWithDetails(db: DomainClient, id: string) {
  return db.user.findOne({
    id,
    select: {
      id: true,
      name: true,
      email: true,
      profile: {
        select: { bio: true, avatar: true, website: true },
      },
      posts: {
        select: {
          id: true,
          title: true,
          publishedAt: true,
          comments: {
            select: { id: true, body: true },
            first: 3,
          },
        },
        where: { published: { equalTo: true } },
        orderBy: ['PUBLISHED_AT_DESC'],
        first: 10,
      },
      followers: {
        select: { id: true, name: true, avatar: true },
        first: 5,
      },
    },
  }).execute();
}
```

### Filtered Relations

```typescript
// Get users with only their published posts
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
      where: {
        and: [
          { published: { equalTo: true } },
          { publishedAt: { greaterThanOrEqualTo: '2024-01-01' } },
        ],
      },
      orderBy: ['PUBLISHED_AT_DESC'],
    },
  },
}).execute();
```

### Nested Mutations

```typescript
// Create user with related records
const user = await db.user.create({
  input: {
    name: 'John Doe',
    email: 'john@example.com',
    profile: {
      create: {
        bio: 'Software developer',
        website: 'https://johndoe.com',
      },
    },
  },
  select: {
    id: true,
    name: true,
    profile: { select: { bio: true } },
  },
}).execute();
```

## Transaction-Like Patterns

### Sequential Operations

```typescript
async function transferCredits(db: DomainClient, fromId: string, toId: string, amount: number) {
  // Verify source has enough credits
  const source = await db.user.findOne({
    id: fromId,
    select: { id: true, credits: true },
  }).execute().unwrap();

  if (source.credits < amount) {
    throw new Error('Insufficient credits');
  }

  // Perform updates sequentially
  await db.user.update({
    id: fromId,
    patch: { credits: source.credits - amount },
  }).execute().unwrap();

  const target = await db.user.findOne({
    id: toId,
    select: { credits: true },
  }).execute().unwrap();

  await db.user.update({
    id: toId,
    patch: { credits: target.credits + amount },
  }).execute().unwrap();

  // Create transaction record
  await db.transaction.create({
    input: {
      fromUserId: fromId,
      toUserId: toId,
      amount,
      type: 'TRANSFER',
    },
  }).execute().unwrap();
}
```

### Batch Operations

```typescript
// Update multiple records
async function deactivateInactiveUsers(db: DomainClient, daysSinceLogin: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSinceLogin);

  // Find inactive users
  const inactiveUsers = await db.user.findMany({
    select: { id: true },
    where: {
      and: [
        { active: { equalTo: true } },
        { lastLoginAt: { lessThan: cutoffDate.toISOString() } },
      ],
    },
  }).execute().unwrap();

  // Update each user
  const results = await Promise.allSettled(
    inactiveUsers.map((user) =>
      db.user.update({
        id: user.id,
        patch: { active: false },
      }).execute()
    )
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  return { succeeded, failed, total: inactiveUsers.length };
}
```

## Caching Patterns

### Request-Level Caching

```typescript
import { cache } from 'react';

// Cache per-request in React Server Components
export const getUser = cache(async (id: string) => {
  const db = createRequestClient();
  return db.user.findOne({
    id,
    select: { id: true, name: true, email: true },
  }).execute();
});

// Multiple calls in same request reuse the result
async function UserPage({ params }: { params: { id: string } }) {
  const user = await getUser(params.id);
  // ...
}

async function UserSidebar({ userId }: { userId: string }) {
  const user = await getUser(userId); // Cached if same ID
  // ...
}
```

### External Cache

```typescript
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function getCachedUser(
  db: DomainClient,
  databaseId: string,
  identityId: string,
  id: string,
) {
  const cacheKey = `${databaseId}:${identityId}:user:${id}`;

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch through the caller's scoped client
  const result = await db.user.findOne({
    id,
    select: { id: true, name: true, email: true, role: true },
  }).execute();

  if (result.ok) {
    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(result.value));
    return result.value;
  }

  return null;
}

async function invalidateUserCache(databaseId: string, identityId: string, id: string) {
  await redis.del(`${databaseId}:${identityId}:user:${id}`);
}
```

## QueryBuilder API

### Inspect Generated GraphQL

```typescript
const query = db.user.findMany({
  select: { id: true, name: true, email: true },
  where: { role: { equalTo: 'ADMIN' } },
  first: 10,
});

// Note: Inspect methods may not be available in all generated ORMs
// Check your generated QueryBuilder for available debugging methods

// Execute when ready
const result = await query.execute();
```

### Debug Queries

```typescript
// Log all queries in development
async function executeWithLogging<T>(query: any) {
  if (process.env.NODE_ENV === 'development') {
    // Note: toGraphQL() and getVariables() methods may not be available
    // Check your generated ORM for available debugging methods
    console.log('Executing query...');
  }
  return query.execute();
}

// Usage
const result = await executeWithLogging(
  db.user.findMany({ select: { id: true }, first: 10 })
);
```

## Client Configuration

### Creating Client with Headers

```typescript
import { createClient } from '@/generated/orm';

function createScopedClient(endpoint: string, accessToken: string) {
  return createClient({
    endpoint,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Use the client for requests
const db = createScopedClient(dataEndpoint, accessToken);
const users = await db.user.findMany({}).execute();
```

### Identity changes

When the tenant or identity changes, discard the old client and create a new
binding from the host's explicit endpoint and session. Clear identity-scoped
query caches before another user can inherit them. Authentication belongs to
the Authentication feature-pack adapter or an explicit auth client; do not add
an ad hoc session header to a domain ORM client.

Repository helpers should accept that scoped client as an explicit dependency.
This keeps endpoint, identity, and cache ownership visible at the call site and
prevents a repository module from hiding a cross-tenant singleton.
