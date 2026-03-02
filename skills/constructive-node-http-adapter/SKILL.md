---
name: constructive-node-http-adapter
description: Fix Node.js *.localhost DNS resolution and Host header issues when calling Constructive's subdomain-routed GraphQL server.
metadata:
  author: constructive-io
  version: "1.0.0"
---

# NodeHttpAdapter — Localhost Subdomain Routing

## The Problem

Constructive uses subdomain-based routing (`*.localhost`). Node.js can't resolve these (DNS `ENOTFOUND`) and the Fetch API silently drops the `Host` header.

## Option A: Generated NodeHttpAdapter (Recommended)

```typescript
await generate({
  endpoint: 'http://localhost:3000/graphql',
  headers: { Host: 'app-public-mydb.localhost' },
  output: './generated/mydb/sdk',
  nodeHttpAdapter: true,
  orm: true,
});
```

```typescript
import { NodeHttpAdapter } from './generated/mydb/sdk/orm/node-fetch';

const adapter = new NodeHttpAdapter(
  'http://app-public-mydb.localhost:3000/graphql',
  { Authorization: 'Bearer <token>' }
);
const db = createClient({ adapter });
```

Automatically rewrites `*.localhost` → `localhost` + injects `Host` header.

## Option B: Manual `node:http`

```typescript
import http from 'node:http';

function httpPost(subdomain: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/graphql', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': `${subdomain}.localhost`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
```

## Option C: localAdapter (SDK adapter)

```typescript
import http from 'node:http';
import type { GraphQLAdapter } from '@constructive-io/graphql-types';

export function localAdapter(subdomain: string, headers?: Record<string, string>): GraphQLAdapter {
  return {
    async execute(document, variables) {
      const body = JSON.stringify({ query: document, variables: variables ?? {} });
      const raw = await httpPost(subdomain, body, headers);
      const json = JSON.parse(raw);
      return json.errors?.length > 0
        ? { ok: false, data: null, errors: json.errors }
        : { ok: true, data: json.data, errors: undefined };
    }
  };
}
```

## API

```typescript
class NodeHttpAdapter {
  constructor(endpoint: string, headers?: Record<string, string>);
  execute<T>(document: string, variables?: Record<string, unknown>): Promise<QueryResult<T>>;
  setHeaders(headers: Record<string, string>): void;
  getEndpoint(): string;
}
```

## Related

- `constructive-graphql-codegen` — generates `NodeHttpAdapter` with `nodeHttpAdapter: true`
