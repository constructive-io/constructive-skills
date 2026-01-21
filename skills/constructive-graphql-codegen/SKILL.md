---
name: constructive-graphql-codegen
description: Generate and use type-safe React Query hooks or Prisma-like ORM client from PostGraphile GraphQL endpoints using @constructive-io/graphql-codegen. Use when asked to "generate GraphQL hooks", "generate ORM", "set up codegen", "use generated hooks", "query with ORM", "fetch data", or when implementing data fetching for a PostGraphile backend.
compatibility: Node.js 22+, constructive-io and PostGraphile v5+ compatible graphQL endpoint with _meta query support
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive GraphQL Codegen

Generate type-safe React Query hooks or Prisma-like ORM client from PostGraphile GraphQL endpoints.

## When to Apply

Use this skill when:
- Setting up GraphQL code generation for a PostGraphile backend
- User asks to generate hooks, ORM, or type-safe GraphQL client
- Implementing features that need to fetch or mutate data
- Using previously generated hooks or ORM code
- Regenerating code after schema changes

**Important**: Always prefer generated code over raw GraphQL queries or SQL.

## Quick Start

### Installation

```bash
pnpm add @constructive-io/graphql-codegen
```

### Generate React Query Hooks

```bash
npx @constructive-io/graphql-codegen generate -e https://api.example.com/graphql -o ./src/generated/hooks
```

### Generate ORM Client

```bash
npx @constructive-io/graphql-codegen generate-orm -e https://api.example.com/graphql -o ./src/generated/orm
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `@constructive-io/graphql-codegen init` | Create configuration file |
| `@constructive-io/graphql-codegen generate` | Generate React Query hooks |
| `@constructive-io/graphql-codegen generate-orm` | Generate Prisma-like ORM |
| `@constructive-io/graphql-codegen introspect` | Inspect schema without generating |

### Common Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | GraphQL endpoint URL |
| `-o, --output <dir>` | Output directory |
| `-c, --config <path>` | Config file path |
| `-a, --authorization <token>` | Authorization header |
| `-t, --target <name>` | Target name in config |
| `--dry-run` | Preview without writing |

## Configuration File

Initialize configuration:

```bash
npx @constructive-io/graphql-codegen init
```

This creates `graphql-codegen.config.ts`:

```typescript
import { defineConfig } from '@constructive-io/graphql-codegen';

export default defineConfig({
  targets: {
    default: {
      endpoint: 'https://api.example.com/graphql',
      output: './src/generated/hooks',
      headers: {
        Authorization: `Bearer ${process.env.API_TOKEN}`,
      },
      tables: {
        include: ['User', 'Post', 'Comment'],
        exclude: ['*_archive', 'temp_*'],
      },
    },
  },
});
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
const user = await db.user.findOne({ id }).execute().unwrap(); // throws on error
const user = await db.user.findOne({ id }).execute().unwrapOr(defaultUser);
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
| Schema not accessible | Verify endpoint URL and auth headers |
| Missing `_meta` query | Ensure PostGraphile v5+ with Meta plugin |
| Type errors after regeneration | Delete output directory and regenerate |
| Import errors | Verify generated code exists and paths match |
| Auth errors at runtime | Check `configure()` headers are set |

## References

For detailed documentation on specific topics, see [references/](references/):

- CLI options and configuration: `cli-reference.md`, `config-reference.md`
- Advanced usage patterns: `hooks-patterns.md`, `orm-patterns.md`
- Error handling and relations: `error-handling.md`, `relations.md`
