---
name: graphql-codegen
description: Generate type-safe GraphQL SDKs from your Constructive database schema. Use when generating type-safe React Query hooks, creating a Prisma-like ORM client, or building typed GraphQL queries and mutations for cloud functions.
---

Generate type-safe GraphQL SDKs from your Constructive database schema.

## When to Apply

Use this skill when:
- Generating type-safe React Query hooks from a GraphQL schema
- Creating a Prisma-like ORM client for GraphQL operations
- Building typed GraphQL queries and mutations for cloud functions
- Setting up codegen from a database, endpoint, or PGPM module

## Overview

`@constructive-io/graphql-codegen` generates two types of SDKs:

1. **React Query Hooks** — `useQuery` and `useMutation` hooks with full typing
2. **ORM Client** — Prisma-like fluent API (`db.user.findMany()`, `db.mutation.login()`)

Both provide compile-time type safety, autocomplete, and type inference based on your select clauses.

## Installation

```bash
pnpm add @constructive-io/graphql-codegen
```

## Programmatic API

### Generate from Endpoint

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  endpoint: 'https://api.example.com/graphql',
  output: './generated',
  headers: { Authorization: 'Bearer <token>' },
  reactQuery: true,  // Generate React Query hooks
  orm: true,         // Generate ORM client
});
```

### Generate from Database

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  db: {
    schemas: ['public', 'app_public'],
  },
  output: './generated',
  reactQuery: true,
});
```

### Generate from PGPM Module

```typescript
import { generate } from '@constructive-io/graphql-codegen';

await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['public'],
  },
  output: './generated',
  orm: true,
});
```

## Configuration Options

```typescript
interface GraphQLSDKConfigTarget {
  endpoint?: string;                    // GraphQL endpoint URL
  schemaFile?: string;                  // Path to .graphql schema file
  db?: DbConfig;                        // Database configuration

  output?: string;                      // Output directory (default: './generated/graphql')
  headers?: Record<string, string>;     // HTTP headers for endpoint requests

  reactQuery?: boolean;                 // Generate React Query hooks
  orm?: boolean;                        // Generate ORM client

  tables?: {
    include?: string[];                 // Glob patterns (default: ['*'])
    exclude?: string[];                 // Glob patterns (default: [])
  };

  queries?: {
    include?: string[];                 // Glob patterns (default: ['*'])
    exclude?: string[];                 // Glob patterns (default: ['_meta', 'query'])
  };

  mutations?: {
    include?: string[];                 // Glob patterns (default: ['*'])
    exclude?: string[];                 // Glob patterns (default: [])
  };
}
```

## ORM Client Usage

The ORM client provides a Prisma-like fluent API for GraphQL operations.

### Setup

```typescript
import { createClient } from './generated/orm';

const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});
```

### Query Operations

```typescript
// Find many with filtering and pagination
const result = await db.user
  .findMany({
    select: { id: true, username: true, email: true },
    where: { status: { equalTo: 'active' } },
    first: 20,
    orderBy: ['CREATED_AT_DESC'],
  })
  .execute();

if (result.ok) {
  console.log(result.data.users.nodes);
} else {
  console.error(result.errors);
}

// Find one by ID
const user = await db.user
  .findFirst({
    select: { id: true, username: true },
    where: { id: { equalTo: 'user-123' } },
  })
  .unwrap();
```

### Mutation Operations

```typescript
// Create
const newUser = await db.user
  .create({
    data: { username: 'john', email: 'john@example.com' },
    select: { id: true, username: true },
  })
  .execute();

// Update
const updated = await db.user
  .update({
    where: { id: 'user-id' },
    data: { displayName: 'John Doe' },
    select: { id: true, displayName: true },
  })
  .execute();

// Delete
const deleted = await db.user
  .delete({ where: { id: 'user-id' } })
  .execute();
```

### Custom Operations

Custom queries and mutations are available on `db.query` and `db.mutation`:

```typescript
// Custom query
const currentUser = await db.query
  .currentUser({ select: { id: true, username: true } })
  .unwrap();

// Custom mutation (e.g., login)
const login = await db.mutation
  .login(
    { input: { email: 'user@example.com', password: 'secret' } },
    { select: { apiToken: { select: { accessToken: true } } } }
  )
  .unwrap();

console.log(login.login.apiToken?.accessToken);
```

### Select & Type Inference

The ORM uses const generics to infer return types based on your select clause:

```typescript
const users = await db.user
  .findMany({
    select: { id: true, username: true },
  })
  .unwrap();

// TypeScript knows the exact shape:
// users.users.nodes[0] is { id: string; username: string | null }

// Accessing unselected fields is a compile error:
// users.users.nodes[0].email  // Error: Property 'email' does not exist
```

### Relations

Relations are fully typed in select types:

```typescript
// BelongsTo relation
const orders = await db.order
  .findMany({
    select: {
      id: true,
      customer: {
        select: { id: true, username: true },
      },
    },
  })
  .unwrap();

// HasMany relation with pagination
const users = await db.user
  .findMany({
    select: {
      id: true,
      orders: {
        select: { id: true, total: true },
        first: 10,
        orderBy: ['CREATED_AT_DESC'],
      },
    },
  })
  .unwrap();
```

### Error Handling

```typescript
// Discriminated union (recommended)
const result = await db.user.findMany({ select: { id: true } }).execute();

if (result.ok) {
  console.log(result.data.users.nodes);
} else {
  console.error(result.errors);
}

// .unwrap() - throws on error
try {
  const data = await db.user.findMany({ select: { id: true } }).unwrap();
} catch (error) {
  if (error instanceof GraphQLRequestError) {
    console.error('GraphQL errors:', error.errors);
  }
}

// .unwrapOr() - returns default on error
const data = await db.user
  .findMany({ select: { id: true } })
  .unwrapOr({ users: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, hasPreviousPage: false } } });
```

## React Query Hooks

### Setup

```tsx
import { configure } from './generated/hooks';

configure({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});
```

### Query Hooks

```tsx
import { useCarsQuery, useCarQuery } from './generated/hooks';

function CarList() {
  const { data, isLoading, isError, error } = useCarsQuery({
    first: 10,
    filter: { brand: { equalTo: 'Tesla' } },
    orderBy: ['CREATED_AT_DESC'],
  });

  if (isLoading) return <div>Loading...</div>;
  if (isError) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.cars.nodes.map((car) => (
        <li key={car.id}>{car.brand} - ${car.price}</li>
      ))}
    </ul>
  );
}
```

### Mutation Hooks

```tsx
import { useCreateCarMutation } from './generated/hooks';

function CarForm() {
  const createCar = useCreateCarMutation({
    onSuccess: (data) => {
      console.log('Created car:', data.createCar.car.id);
    },
  });

  return (
    <button
      onClick={() => createCar.mutate({ input: { car: { brand: 'Tesla', price: 80000 } } })}
      disabled={createCar.isPending}
    >
      Create
    </button>
  );
}
```

### Custom Hooks

```tsx
import { useCurrentUserQuery, useLoginMutation } from './generated/hooks';

function UserProfile() {
  const { data } = useCurrentUserQuery();
  return <h1>Welcome, {data?.currentUser?.username}</h1>;
}

function LoginForm() {
  const login = useLoginMutation({
    onSuccess: (data) => {
      const token = data.login.apiToken?.accessToken;
      if (token) localStorage.setItem('token', token);
    },
  });

  return (
    <button onClick={() => login.mutate({ input: { email: 'user@example.com', password: 'secret' } })}>
      Login
    </button>
  );
}
```

## Generated Output Structure

### ORM Client

```
generated/orm/
├── index.ts              # createClient() factory
├── client.ts             # OrmClient class
├── query-builder.ts      # QueryBuilder with execute(), unwrap()
├── select-types.ts       # Type utilities
├── input-types.ts        # All generated types
├── models/
│   ├── user.ts           # UserModel class
│   └── ...
├── query/
│   └── index.ts          # Custom query operations
└── mutation/
    └── index.ts          # Custom mutation operations
```

### React Query Hooks

```
generated/hooks/
├── index.ts              # Main barrel export
├── client.ts             # configure() and execute()
├── types.ts              # Entity interfaces, filters, enums
├── queries/
│   ├── useCarsQuery.ts
│   ├── useCarQuery.ts
│   └── ...
└── mutations/
    ├── useCreateCarMutation.ts
    ├── useUpdateCarMutation.ts
    └── ...
```

## CLI Usage

```bash
# Generate from endpoint
graphql-codegen --endpoint https://api.example.com/graphql --output ./generated --react-query

# Generate from config file
graphql-codegen --config graphql-codegen.config.ts

# Generate ORM client
graphql-codegen --endpoint https://api.example.com/graphql --output ./generated --orm
```

## Config File

Create `graphql-codegen.config.ts`:

```typescript
import type { GraphQLSDKConfig } from '@constructive-io/graphql-codegen';

export default {
  endpoint: 'https://api.example.com/graphql',
  output: './generated/graphql',
  headers: { Authorization: 'Bearer <token>' },
  reactQuery: true,
  orm: true,
} satisfies GraphQLSDKConfig;
```

## Using in Cloud Functions

For cloud functions, use the ORM client instead of raw gql strings:

```typescript
import { createClient } from './generated/orm';

export default async (params: any, context: any) => {
  const db = createClient({
    endpoint: process.env.GRAPHQL_ENDPOINT || 'http://constructive-server:3000/graphql',
    headers: context.headers,
  });

  // Type-safe query
  const users = await db.user
    .findMany({
      select: { id: true, username: true },
      first: 10,
    })
    .unwrap();

  return { users: users.users.nodes };
};
```

## Best Practices

1. **Generate during build** — Run codegen as part of your build process
2. **Commit generated code** — Include generated files in version control for CI
3. **Use select clauses** — Always specify select for optimal queries and type inference
4. **Prefer ORM for functions** — Use ORM client in cloud functions for type safety
5. **Use discriminated unions** — Prefer `.execute()` over `.unwrap()` for explicit error handling

## References

- Related skill: `constructive-functions` for cloud function development
- [@constructive-io/graphql-codegen on npm](https://www.npmjs.com/package/@constructive-io/graphql-codegen)
- [TanStack Query docs](https://tanstack.com/query/latest)
