# Generate SDK (Hooks + ORM)

Generate type-safe React Query hooks and/or a Prisma-like ORM client from a GraphQL schema. This is the primary code generation workflow for building applications that consume a PostGraphile GraphQL API.

## When to Use

- Building a React frontend that needs to fetch/mutate data from a PostGraphile backend
- Building a Node.js backend or script that needs a typed GraphQL client
- User asks to "generate hooks", "generate ORM", "generate SDK", or "set up codegen"
- Implementing features that need to fetch or mutate data
- Regenerating code after schema changes

## Generators

| Generator | Flag | Output Directory | Use Case |
|-----------|------|-----------------|----------|
| React Query hooks | `reactQuery: true` | `{output}/hooks/` | React frontends with TanStack Query |
| ORM client | `orm: true` | `{output}/orm/` | Server-side Node.js, scripts, CLI tools |

Both can be enabled simultaneously. When both are enabled, shared types are generated in `{output}/types/` and each generator references them.

**Important**: When `reactQuery: true`, ORM is also generated automatically (hooks delegate to ORM internally).

## Programmatic API

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Generate React Query hooks only
await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
});

// Generate ORM client only
await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  orm: true,
});

// Generate both hooks and ORM
await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
});

// With filtering and options
await generate({
  schemaFile: './schemas/public.graphql',
  output: './src/generated',
  reactQuery: true,
  orm: true,
  tables: {
    include: ['User', 'Post', 'Comment'],
    exclude: ['*_archive'],
  },
  queries: {
    include: ['currentUser', 'searchPosts'],
  },
  mutations: {
    exclude: ['delete*'],
  },
  docs: true,  // Generate README, AGENTS.md alongside code
});
```

## Output Structure

### React Query Hooks (`{output}/hooks/`)

```
hooks/
├── index.ts              # Barrel export (all hooks, types, configure)
├── client.ts             # configure() function and execute()
├── types.ts              # Entity interfaces, filter types, input types
├── queryKeys.ts          # Centralized query key management
├── queries/
│   ├── useUsersQuery.ts  # List query: use{Table}sQuery
│   ├── useUserQuery.ts   # Single item: use{Table}Query
│   └── ...               # Custom queries
└── mutations/
    ├── useCreateUserMutation.ts
    ├── useUpdateUserMutation.ts
    ├── useDeleteUserMutation.ts
    └── ...               # Custom mutations
```

### ORM Client (`{output}/orm/`)

```
orm/
├── index.ts      # Main export (createClient, types)
├── client.ts     # createClient() function
├── types.ts      # All TypeScript types
└── models/       # Entity model implementations
    ├── user.ts
    ├── post.ts
    └── ...
```

## Using Generated Hooks

### Configure Client (once at app startup)

```typescript
import { configure } from '@/generated/hooks';

configure({
  endpoint: process.env.NEXT_PUBLIC_GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${getToken()}` },
});
```

### Query Data

```typescript
import { useUsersQuery } from '@/generated/hooks';

function UserList() {
  const { data, isLoading } = useUsersQuery({
    first: 10,
    filter: { role: { eq: 'ADMIN' } },
  });

  if (isLoading) return <Spinner />;
  return <ul>{data?.users?.nodes.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### Mutate Data

```typescript
import { useCreateUserMutation } from '@/generated/hooks';

function CreateUser() {
  const createUser = useCreateUserMutation();

  return (
    <button onClick={() => createUser.mutate({ input: { name: 'John' } })}>
      Create
    </button>
  );
}
```

### Cache Invalidation

```typescript
import { userKeys, invalidate, remove } from '@/generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

invalidate.user.all(queryClient);           // All user queries
invalidate.user.lists(queryClient);         // All list queries
invalidate.user.detail(queryClient, id);    // Specific user
remove.user(queryClient, userId);           // Remove from cache
```

For advanced hooks patterns (dependent queries, infinite scroll, optimistic updates, polling), see `hooks-patterns.md`.
For full hooks API reference, see `hooks-output.md`.
For query key factory details, see `query-keys.md`.

## Using Generated ORM

### Create Client

```typescript
import { createClient } from '@/generated/orm';

export const db = createClient({
  endpoint: process.env.GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
});
```

### Query Data

```typescript
const users = await db.user.findMany({
  select: { id: true, name: true, email: true },
  filter: { role: { eq: 'ADMIN' } },
  first: 10,
}).execute().unwrap();
```

### Relations

```typescript
const posts = await db.post.findMany({
  select: {
    id: true,
    title: true,
    author: { select: { id: true, name: true } },
  },
}).execute().unwrap();

// posts[0].author.name is fully typed
```

### Error Handling

```typescript
const result = await db.user.findOne({ id: '123' }).execute();

if (result.ok) {
  console.log(result.value.name);
} else {
  console.error(result.error.message);
}

// Or use helpers
const user = await db.user.findOne({ id }).execute().unwrap();         // throws on error
const user = await db.user.findOne({ id }).execute().unwrapOr(default); // fallback value
```

For advanced ORM patterns (singleton, per-request client, repository pattern, batch operations), see `orm-patterns.md`.
For full ORM API reference, see `orm-output.md`.
For error handling details, see `error-handling.md`.
For relation patterns, see `relations.md`.

## Multi-Target Generation

Generate from multiple schemas in a single run:

```typescript
import { generate, generateMulti } from '@constructive-io/graphql-codegen';

// Option 1: schemaDir auto-expands .graphql files to targets
await generate({
  schemaDir: './schemas',
  output: './generated',
  reactQuery: true,
  orm: true,
});
// Given schemas/public.graphql and schemas/admin.graphql:
// Produces: generated/public/{hooks,orm}/, generated/admin/{hooks,orm}/

// Option 2: Explicit multi-target
await generateMulti({
  configs: {
    public: {
      schemaFile: './schemas/public.graphql',
      output: './generated/public',
      reactQuery: true,
    },
    admin: {
      schemaFile: './schemas/admin.graphql',
      output: './generated/admin',
      orm: true,
    },
  },
});

// Option 3: Multiple API names auto-expand
await generate({
  db: { apiNames: ['public', 'admin'] },
  output: './generated',
  orm: true,
});
```

## Documentation Generation

Generate documentation alongside code:

```typescript
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  orm: true,
  docs: true,  // Enable all doc formats
  // OR configure individually:
  docs: {
    readme: true,   // README.md -- human-readable overview
    agents: true,   // AGENTS.md -- structured for LLM consumption
    mcp: false,     // mcp.json -- MCP tool definitions
    skills: true,   // skills/ -- per-command .md skill files
  },
});
```

## Build Script Example

```typescript
// scripts/codegen.ts
import { generate } from '@constructive-io/graphql-codegen';

async function main() {
  const result = await generate({
    schemaFile: './schemas/public.graphql',
    output: './src/generated',
    reactQuery: true,
    orm: true,
    tables: {
      include: ['User', 'Post', 'Comment'],
    },
  });

  if (!result.success) {
    console.error('Codegen failed:', result.message);
    process.exit(1);
  }

  console.log(result.message);
  // "Generated React Query and ORM for 3 tables. Files written to ./src/generated"
}

main();
```

## Filter Syntax

```typescript
// Comparison
filter: { age: { eq: 25 } }
filter: { age: { gte: 18, lt: 65 } }
filter: { status: { in: ['ACTIVE', 'PENDING'] } }

// String
filter: { name: { contains: 'john' } }
filter: { email: { endsWith: '.com' } }

// Logical
filter: {
  OR: [
    { role: { eq: 'ADMIN' } },
    { role: { eq: 'MODERATOR' } },
  ],
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No hooks generated | Add `reactQuery: true` |
| No ORM generated | Add `orm: true` |
| Missing custom queries/mutations | Check `queries.include` / `mutations.include` filters |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match `output` |
| Auth errors at runtime | Check `configure()` headers (hooks) or `createClient()` headers (ORM) |
| No docs generated | Set `docs: true` or `docs: { readme: true, agents: true }` |
