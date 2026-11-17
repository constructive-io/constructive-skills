---
name: constructive-services-schemas
description: >
  Create and configure Constructive services (APIs), attach database schemas to them,
  route hostnames to them, and manage schema grants using the @constructive-io/sdk TypeScript SDK.
  Use when: "create an API", "set up a service", "attach schema to API", "configure domains",
  "route a hostname to an API", "grant schema access", "set up service routing".
compatibility: Node.js 18+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Services & Schemas

Configure Constructive services (APIs), attach database schemas, set up domain routing, and manage access — all via the `@constructive-io/sdk` TypeScript SDK with zero SQL.

## When to Apply

Use this skill when:
- Creating a new API service for a Constructive database
- Attaching database schemas to an API to expose them via GraphQL
- Routing a hostname to an API or site
- Granting role-based access to schemas
- Querying existing APIs with their attached schemas and domains

## Core Concepts

### Entity Hierarchy

```
Database (top-level container)
├── Schema (database schema, e.g. "public" — auto-created with database)
│   ├── Table, View, SchemaGrant, ...
│   └── ApiSchema (join: links Schema ↔ Api)
├── Api (service endpoint with role-based access)
│   ├── ApiSchema (which schemas this API exposes)
│   ├── ApiSetting (per-API feature flags and request bounds)
│   └── CorsSetting (per-API CORS origins)
├── Site (web property; metadata on SiteMetadatum)
├── Domain (a claimed hostname)
└── Route (domain + path → an Api, Site, function, bucket, ...)
```

### Key Relationships

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| **Api** | A service endpoint | `databaseId`, `name`, `roleName`, `anonRole`, `isPublished`, `serviceHostname` |
| **ApiSchema** | Links an Api to a Schema | `databaseId`, `apiId`, `schemaId` |
| **Domain** | A claimed hostname | `databaseId`, `hostname`, `managed`, `isWildcard`, `verificationStatus` |
| **Route** | Hostname + path → target | `databaseId`, `domainId`, `path`, `targetApiId`, `targetSiteId`, ... |
| **Schema** | Database schema container | `databaseId`, `name`, `schemaName` |
| **SchemaGrant** | Grants a role access to a schema | `databaseId`, `schemaId`, `granteeName` |

Every entity requires a `databaseId` — the UUID of the parent Database.

## SDK Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const sdk = createClient({
  endpoint: 'https://your-constructive-api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});
```

## Creating an API

An API defines a service endpoint with role-based access control.

```typescript
const result = await sdk.api
  .create({
    data: {
      databaseId,            // required: parent database UUID
      name: 'public',        // required: API name
      roleName: 'authenticated', // role for authenticated users
      anonRole: 'anonymous',    // role for anonymous access
      isPublished: true,        // whether other scopes may see and route to this API
    },
    select: { id: true, name: true, databaseId: true },
  })
  .execute();

if (!result.ok) {
  throw new Error(`createApi failed: ${JSON.stringify(result.errors)}`);
}

const api = result.data.createApi.api;
```

### Required fields for `api.create`:
- `databaseId` (string) — parent database UUID
- `name` (string) — API name (e.g., `"public"`, `"admin"`, `"meta"`)

### Optional fields:
- `roleName` (string) — role for authenticated users (e.g., `"authenticated"`, `"administrator"`)
- `anonRole` (string) — role for anonymous access (e.g., `"anonymous"`, `"administrator"`)
- `isPublished` (boolean) — whether other scopes may see and route to this API surface
- `config` (JSON) — module-specific configuration for this API surface

`serviceHostname` is read-only: the API's platform-issued hostname (a managed, verified domain routed to it).

## Attaching Schemas to an API

Use `apiSchema` to link a Schema to an Api. This is a many-to-many join — one API can expose multiple schemas, and one schema can be exposed by multiple APIs.

```typescript
const linkResult = await sdk.apiSchema
  .create({
    data: {
      databaseId,   // required: parent database UUID
      apiId: api.id, // required: the API to attach to
      schemaId: publicSchema.id, // required: the schema to expose
    },
    select: { id: true },
  })
  .execute();

if (!linkResult.ok) {
  throw new Error(`createApiSchema failed: ${JSON.stringify(linkResult.errors)}`);
}
```

### Required fields for `apiSchema.create`:
- `databaseId` (string)
- `apiId` (string) — the API to attach the schema to
- `schemaId` (string) — the schema to expose through this API

### Attaching multiple schemas to one API:

```typescript
const schemaIds = [publicSchemaId, usersSchemaId, authSchemaId];

for (const schemaId of schemaIds) {
  await sdk.apiSchema
    .create({
      data: { databaseId, apiId: api.id, schemaId },
      select: { id: true },
    })
    .execute();
}
```

## Routing a Hostname to an API

Routing is two rows: a **domain** (a claimed hostname) and a **route** (`domainId` + `path` → a target). The hostname-claim verbs (`domainsAssignSubdomain` under a published managed domain, custom-domain verification) are documented in [`constructive-sites`](../../constructive-sites/SKILL.md).

```typescript
// 1. Claim a hostname under a published managed apex
const { domainsAssignSubdomain } = await sdk.mutation
  .domainsAssignSubdomain(
    { input: { apex: 'apps.example.com', label: 'api' } },
    { select: { result: { select: { id: true, hostname: true } } } },
  )
  .unwrap();
const domainId = domainsAssignSubdomain.result.id;

// 2. Route it to the API (path defaults to '/')
await sdk.route
  .create({
    data: { databaseId, domainId, targetApiId: api.id },
    select: { id: true, path: true },
  })
  .unwrap();
```

Routes are unique per `(domainId, path, method)`; the longest matching path prefix wins, so one hostname can serve an API at `/graphql` and a site at `/`.

## Per-API Settings

Per-API feature flags and request-protection bounds live on `sdk.apiSetting`, and per-API CORS origins on `sdk.corsSetting` — see `constructive-auth` (`references/service-settings.md`).

## Granting Schema Access

Schema grants control which roles can access a schema.

```typescript
const grantResult = await sdk.schemaGrant
  .create({
    data: {
      schemaId: publicSchema.id,
      granteeName: 'authenticated',  // role name to grant access to
    },
    select: { id: true },
  })
  .execute();
```

### Required fields for `schemaGrant.create`:
- `schemaId` (string) — the schema to grant access to
- `granteeName` (string) — the role name (e.g., `"authenticated"`, `"anonymous"`)

### Optional fields:
- `databaseId` (string)

## Querying APIs with Relations

### List all APIs with their schemas and settings

```typescript
const apis = await sdk.api
  .findMany({
    select: {
      id: true,
      name: true,
      roleName: true,
      anonRole: true,
      isPublished: true,
      serviceHostname: true,
      apiSchemas: {
        select: {
          id: true,
          schema: {
            select: { id: true, name: true, schemaName: true },
          },
        },
      },
      apiSetting: {
        select: { enableRealtime: true, maxQueryDepth: true },
      },
      corsSettings: {
        select: { id: true, allowedOrigins: true },
      },
    },
  })
  .execute();
```

### Find a specific API by name

```typescript
const result = await sdk.api
  .findFirst({
    where: { name: { equalTo: 'public' } },
    select: {
      id: true,
      name: true,
      apiSchemas: {
        select: {
          schema: { select: { id: true, name: true } },
        },
      },
    },
  })
  .execute();
```

### Query a schema with its API links

```typescript
const schemaResult = await sdk.schema
  .findFirst({
    where: { name: { equalTo: 'public' } },
    select: {
      id: true,
      name: true,
      schemaName: true,
      apiSchemas: {
        select: {
          api: { select: { id: true, name: true } },
        },
      },
      schemaGrants: {
        select: { id: true, granteeName: true },
      },
    },
  })
  .execute();
```

## Complete End-to-End Example

This example shows a full service setup workflow: create a database, set up multiple APIs with different roles, attach schemas, route hostnames, and create a site.

```typescript
import { createClient } from '@constructive-io/sdk';

const sdk = createClient({
  endpoint: 'https://your-api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});

// 1. Create a database (schemas like "public" are auto-created)
const dbResult = await sdk.database
  .create({
    data: { name: 'my-project', ownerId: userId },
    select: {
      id: true,
      schemas: { select: { id: true, name: true }, first: 10 },
    },
  })
  .execute();

const database = dbResult.data.createDatabase.database;
const databaseId = database.id;
const publicSchema = database.schemas?.nodes?.find(
  (s) => s.name === 'public'
);

// 2. Hostnames already claimed for this database (see "Routing a Hostname to an API")
const domains: Record<string, string> = { api: apiDomainId, app: appDomainId, meta: metaDomainId };

// 3. Helper: create an API, attach schemas, and route a hostname to it
async function setupApi(opts: {
  name: string;
  roleName: string;
  anonRole: string;
  schemaIds?: string[];
  domainId: string;
}) {
  // Create the API
  const apiResult = await sdk.api
    .create({
      data: {
        databaseId,
        name: opts.name,
        roleName: opts.roleName,
        anonRole: opts.anonRole,
        isPublished: true,
      },
      select: { id: true, name: true },
    })
    .execute();

  const api = apiResult.data.createApi.api;

  // Attach schemas
  for (const schemaId of opts.schemaIds ?? []) {
    await sdk.apiSchema
      .create({
        data: { databaseId, apiId: api.id, schemaId },
        select: { id: true },
      })
      .execute();
  }

  // Route the hostname to this API
  await sdk.route
    .create({
      data: { databaseId, domainId: opts.domainId, targetApiId: api.id },
      select: { id: true },
    })
    .execute();

  return api;
}

// 4. Set up services
await setupApi({
  name: 'public',
  roleName: 'authenticated',
  anonRole: 'anonymous',
  schemaIds: [publicSchema.id],
  domainId: domains['api'],
});

await setupApi({
  name: 'meta',
  roleName: 'authenticated',
  anonRole: 'anonymous',
  domainId: domains['meta'],
});

// 5. Create a site and route the app hostname to it
const siteResult = await sdk.site
  .create({
    data: {
      databaseId,
      title: 'My App',
      description: 'My Constructive application',
    },
    select: { id: true },
  })
  .execute();

await sdk.route
  .create({
    data: { databaseId, domainId: domains['app'], targetSiteId: siteResult.data.createSite.site.id },
    select: { id: true },
  })
  .execute();
```

## Updating and Deleting

### Update an API

```typescript
await sdk.api
  .update({
    where: { id: apiId },
    data: { isPublished: false, anonRole: 'authenticated' },
    select: { id: true, isPublished: true },
  })
  .execute();
```

### Remove a schema from an API

```typescript
await sdk.apiSchema
  .delete({
    where: { id: apiSchemaId },
    select: { id: true },
  })
  .execute();
```

### Stop routing a hostname

```typescript
await sdk.route
  .delete({
    where: { id: routeId },
    select: { id: true },
  })
  .execute();
```

## Common Patterns

### Multiple APIs, same database

A single database typically has several APIs with different access levels:

| API Name | `roleName` | `anonRole` | Purpose |
|----------|-----------|-----------|---------|
| `public` | `authenticated` | `anonymous` | Public-facing API |
| `meta` | `authenticated` | `anonymous` | Metadata/schema introspection |

> **DANGEROUS — Development/Testing Only!**
>
> APIs with `administrator` as both `roleName` and `anonRole` (e.g., `admin`, `super`)
> should **never** exist in production. These grant full administrator access to
> anonymous users. They are only used in local development and test environments.
> If you see administrator APIs in a production setup, treat it as a critical
> security misconfiguration.

### Domain routing pattern

Each API gets its own hostname, routed with one `route` row:

| Hostname | Route target |
|----------|--------------|
| `api.example.com` | `targetApiId` → `public` API |
| `app.example.com` | `targetSiteId` → Site (frontend) |
| `meta.example.com` | `targetApiId` → `meta` API |

## Error Handling

All SDK operations return a discriminated union. Always check `.ok`:

```typescript
const result = await sdk.api.create({ ... }).execute();

if (!result.ok) {
  console.error('Failed:', result.errors);
  // result.errors is GraphQLError[]
  return;
}

// Safe to access result.data
const api = result.data.createApi.api;
```

Or use `.unwrap()` to throw on error:

```typescript
const data = await sdk.api.create({ ... }).unwrap();
const api = data.createApi.api;
```

## References

- For detailed ORM field reference, see `references/entity-fields.md`
- Related skill: `constructive-graphql-codegen` — generate the typed SDK
- Related skill: `constructive-functions` — build cloud functions using the SDK
