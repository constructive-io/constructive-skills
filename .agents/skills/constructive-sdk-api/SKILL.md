---
name: constructive-sdk-api
description: Create and manage GraphQL APIs in Constructive using the type-safe SDK. Use when asked to "create an API", "configure API endpoints", "link schemas to APIs", "manage API modules", or when working with services_public.apis operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive API Management

Create and manage GraphQL APIs in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Creating a new API endpoint for a database
- Linking schemas to APIs
- Configuring API roles and permissions
- Managing API modules and extensions
- Working with the `services_public.apis` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## API Schema

The `services_public.apis` table stores API configuration:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `name` | text | API name (unique per database) |
| `dbname` | text | PostgreSQL database name |
| `roleName` | text | Default role (e.g., 'authenticated') |
| `anonRole` | text | Anonymous role (e.g., 'anonymous') |
| `isPublic` | boolean | Whether API is publicly accessible |

## SDK Client Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'https://api.constructive.io/graphql',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});
```

## Creating an API

### Basic API Creation

```typescript
const result = await db.api.create({
  data: {
    databaseId: databaseId,
    name: 'public',
    roleName: 'authenticated',
    anonRole: 'anonymous',
    isPublic: true,
  },
  select: {
    id: true,
    name: true,
    roleName: true,
    isPublic: true,
  },
}).execute();

if (result.ok) {
  const api = result.data.createApi.api;
  console.log('Created API:', api.id);
  console.log('API name:', api.name);
} else {
  console.error('Failed to create API:', result.errors);
}
```

### Standard API Types

Constructive databases typically have these APIs:

| API Name | Role | Anon Role | Public | Purpose |
|----------|------|-----------|--------|---------|
| `public` | authenticated | anonymous | true | Main public API |
| `admin` | authenticated | anonymous | true | Admin operations |
| `private` | administrator | administrator | false | Internal operations |
| `auth` | authenticated | anonymous | true | Authentication endpoints |
| `app` | authenticated | anonymous | true | User-defined tables only |

### Create Multiple APIs

```typescript
const apiConfigs = [
  { name: 'public', roleName: 'authenticated', anonRole: 'anonymous', isPublic: true },
  { name: 'admin', roleName: 'authenticated', anonRole: 'anonymous', isPublic: true },
  { name: 'private', roleName: 'administrator', anonRole: 'administrator', isPublic: false },
  { name: 'auth', roleName: 'authenticated', anonRole: 'anonymous', isPublic: true },
  { name: 'app', roleName: 'authenticated', anonRole: 'anonymous', isPublic: true },
];

for (const config of apiConfigs) {
  const result = await db.api.create({
    data: {
      databaseId: databaseId,
      ...config,
    },
    select: { id: true, name: true },
  }).execute();

  if (result.ok) {
    console.log(`Created ${config.name} API:`, result.data.createApi.api.id);
  }
}
```

## Linking Schemas to APIs

APIs expose schemas via the `api_schemas` junction table:

```typescript
const result = await db.apiSchema.create({
  data: {
    databaseId: databaseId,
    apiId: apiId,
    schemaId: schemaId,
  },
  select: {
    id: true,
    apiId: true,
    schemaId: true,
  },
}).execute();

if (result.ok) {
  console.log('Linked schema to API');
}
```

### Link Multiple Schemas

```typescript
const schemaIds = [publicSchemaId, usersSchemaId, authSchemaId];

for (const schemaId of schemaIds) {
  await db.apiSchema.create({
    data: {
      databaseId: databaseId,
      apiId: publicApiId,
      schemaId: schemaId,
    },
    select: { id: true },
  }).execute();
}
```

## Querying APIs

### Find All APIs for a Database

```typescript
const result = await db.api.findMany({
  select: {
    id: true,
    name: true,
    roleName: true,
    anonRole: true,
    isPublic: true,
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();

if (result.ok) {
  const apis = result.data.apis.nodes;
  apis.forEach(api => {
    console.log(`${api.name}: ${api.isPublic ? 'public' : 'private'}`);
  });
}
```

### Find API with Linked Schemas

```typescript
const result = await db.api.findFirst({
  select: {
    id: true,
    name: true,
    apiSchemas: {
      nodes: {
        id: true,
        schema: {
          id: true,
          name: true,
          schemaName: true,
        },
      },
    },
  },
  where: {
    databaseId: { equalTo: databaseId },
    name: { equalTo: 'public' },
  },
}).execute();

if (result.ok && result.data.apis.nodes.length > 0) {
  const api = result.data.apis.nodes[0];
  console.log('API schemas:');
  api.apiSchemas.nodes.forEach(as => {
    console.log(`  - ${as.schema.name} (${as.schema.schemaName})`);
  });
}
```

### Find API with Domains

```typescript
const result = await db.api.findMany({
  select: {
    id: true,
    name: true,
    domains: {
      nodes: {
        id: true,
        subdomain: true,
        domain: true,
      },
    },
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();
```

## Updating an API

```typescript
const result = await db.api.update({
  where: { id: apiId },
  data: {
    roleName: 'authenticated',
    isPublic: false,
  },
  select: {
    id: true,
    name: true,
    roleName: true,
    isPublic: true,
  },
}).execute();

if (result.ok) {
  console.log('Updated API:', result.data.updateApi.api);
}
```

## Deleting an API

```typescript
const result = await db.api.delete({
  where: { id: apiId },
}).execute();

if (result.ok) {
  console.log('Deleted API:', result.data.deleteApi.api.id);
}
```

## API Modules

API modules add functionality to APIs:

```typescript
const result = await db.apiModule.create({
  data: {
    databaseId: databaseId,
    apiId: apiId,
    name: 'postgraphile-plugin-connection-filter',
    data: {
      connectionFilterAllowedOperators: ['equalTo', 'notEqualTo', 'in', 'notIn'],
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Query API Modules

```typescript
const result = await db.apiModule.findMany({
  select: {
    id: true,
    name: true,
    data: true,
  },
  where: {
    apiId: { equalTo: apiId },
  },
}).execute();
```

## API Extensions

API extensions add PostGraphile plugins:

```typescript
const result = await db.apiExtension.create({
  data: {
    databaseId: databaseId,
    apiId: apiId,
    name: 'pg-simplify-inflector',
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available:

```json
{
  "operation": "mutation",
  "model": "api",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "name": "public",
    "roleName": "authenticated",
    "anonRole": "anonymous",
    "isPublic": true
  },
  "select": {
    "id": true,
    "name": true
  }
}
```

## API URL Patterns

APIs are accessed via domains:

| Subdomain | API | Example URL |
|-----------|-----|-------------|
| `api` | public | `https://api.myapp.constructive.io/graphql` |
| `admin` | admin | `https://admin.myapp.constructive.io/graphql` |
| `private` | private | `https://private.myapp.constructive.io/graphql` |
| `auth` | auth | `https://auth.myapp.constructive.io/graphql` |
| `app` | app | `https://app.myapp.constructive.io/graphql` |

## Error Handling

```typescript
const result = await db.api.create({
  data: {
    databaseId: databaseId,
    name: 'public', // Already exists!
    roleName: 'authenticated',
    anonRole: 'anonymous',
    isPublic: true,
  },
  select: { id: true },
}).execute();

if (!result.ok) {
  result.errors.forEach(error => {
    console.error(`Error: ${error.message}`);
    // "duplicate key value violates unique constraint"
  });
}
```

## Best Practices

1. **Use standard API names** - Stick to public, admin, private, auth, app
2. **Link schemas carefully** - Only expose schemas that should be accessible
3. **Set roles correctly** - Use appropriate roles for security
4. **Private APIs for internal use** - Set `isPublic: false` for admin operations
5. **Use API modules** - Add plugins for filtering, pagination, etc.

## References

- Related skill: `constructive-sdk-database` for database management
- Related skill: `constructive-sdk-site` for site management
- Related skill: `constructive-sdk-services` for services schema overview
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
- [PostGraphile documentation](https://www.graphile.org/postgraphile/)
