# Generate Node.js HTTP Adapter

Generate a `NodeHttpAdapter` for Node.js applications that need to make GraphQL requests to `*.localhost` subdomain-based endpoints. This solves the problem that Node.js cannot resolve `*.localhost` hostnames and the Fetch API silently drops the `Host` header.

## When to Use

- Building a Node.js application (not browser) that talks to a Constructive GraphQL API
- Your API uses subdomain-based routing (e.g., `app-public-mydb.localhost:3000/graphql`)
- You're generating a CLI tool (auto-enabled)
- You get `ENOTFOUND` errors when trying to reach `*.localhost` endpoints from Node.js

## How It Works

The `NodeHttpAdapter` uses `node:http` / `node:https` directly instead of the Fetch API. It:
1. Rewrites `*.localhost` hostnames to `localhost`
2. Injects the original hostname as the `Host` header
3. Implements the `GraphQLAdapter` interface so it can be passed to `createClient()`

## Programmatic API

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Explicit opt-in
await generate({
  endpoint: 'http://api.localhost:3000/graphql',
  output: './generated',
  orm: true,
  nodeHttpAdapter: true,
});

// Auto-enabled when CLI is enabled
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: true,
  // nodeHttpAdapter is automatically true here
});

// Explicitly disable for CLI (rare)
await generate({
  schemaFile: './schemas/public.graphql',
  output: './generated',
  cli: true,
  nodeHttpAdapter: false,  // Override auto-enable
});
```

## Auto-Enable Rules

From `generate.ts`:

```typescript
const useNodeHttpAdapter =
  options.nodeHttpAdapter === true ||
  (runCli && options.nodeHttpAdapter !== false);
```

- `nodeHttpAdapter: true` -- always enabled
- `cli: true` without `nodeHttpAdapter` set -- auto-enabled
- `cli: true` with `nodeHttpAdapter: false` -- explicitly disabled
- Neither `cli` nor `nodeHttpAdapter` set -- disabled

## Generated Output

When enabled, `node-fetch.ts` is generated in the ORM output directory:

```
{output}/orm/
├── index.ts
├── client.ts
├── types.ts
├── node-fetch.ts      # <-- NodeHttpAdapter
└── models/
    └── ...
```

When CLI is also enabled, a copy is generated in the CLI directory too:

```
{output}/cli/
├── node-fetch.ts      # <-- NodeHttpAdapter (for CLI executor)
└── ...
```

## Using the Generated Adapter

### With ORM Client

```typescript
import { createClient } from './generated/orm';
import { NodeHttpAdapter } from './generated/orm/node-fetch';

const adapter = new NodeHttpAdapter(
  'http://app-public-mydb.localhost:3000/graphql',
  { Authorization: 'Bearer <token>' }
);

const db = createClient({ adapter });

// All requests go through NodeHttpAdapter
const users = await db.user.findMany({
  select: { id: true, name: true },
}).execute().unwrap();
```

### Updating Headers at Runtime

```typescript
const adapter = new NodeHttpAdapter(endpoint);

// Set headers after construction
adapter.setHeaders({
  Authorization: `Bearer ${newToken}`,
  'X-Custom-Header': 'value',
});

const db = createClient({ adapter });
```

## NodeHttpAdapter API

```typescript
class NodeHttpAdapter implements GraphQLAdapter {
  constructor(
    endpoint: string,
    headers?: Record<string, string>
  );

  execute<T>(
    document: string,
    variables?: Record<string, unknown>
  ): Promise<QueryResult<T>>;

  setHeaders(headers: Record<string, string>): void;
  getEndpoint(): string;
}
```

## The Problem It Solves

Constructive uses subdomain-based routing where different APIs are accessed via different subdomains:

```
app-public-mydb.localhost:3000/graphql   # public API
app-admin-mydb.localhost:3000/graphql    # admin API
auth.localhost:3000/graphql              # auth API
```

Node.js has two issues with this:
1. **DNS resolution**: `*.localhost` doesn't resolve in Node.js (DNS `ENOTFOUND`)
2. **Host header**: The Fetch API silently drops the `Host` header

The adapter rewrites requests:
- URL: `http://app-public-mydb.localhost:3000/graphql` -> `http://localhost:3000/graphql`
- Header: `Host: app-public-mydb.localhost`

## Alternative: Manual node:http

If you don't want to use the generated adapter, you can use `node:http` directly. See `node-http-adapter.md` for Option B (Manual) and Option C (localAdapter).

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ENOTFOUND` on `*.localhost` | Enable `nodeHttpAdapter: true` |
| No `node-fetch.ts` generated | Ensure `orm: true` or `cli: true` is set alongside `nodeHttpAdapter: true` |
| Adapter not used | Pass `adapter` to `createClient({ adapter })`, not just `endpoint` |
| HTTPS certificate errors | NodeHttpAdapter uses `node:http`/`node:https`; check your cert config |
