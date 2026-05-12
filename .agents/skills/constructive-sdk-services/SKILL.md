---
name: constructive-sdk-services
description: Manage the services schema in Constructive including domains, API schemas, and site configuration. Use when asked to "configure domains", "link APIs to domains", "manage services", or when working with the services_public schema.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Services Schema Management

Manage the services schema in Constructive, which coordinates databases, APIs, sites, and domains.

## When to Apply

Use this skill when:
- Configuring domain routing for APIs and sites
- Linking schemas to APIs
- Managing the overall services infrastructure
- Understanding the relationship between databases, APIs, sites, and domains
- Working with the `services_public` schema

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Services Schema Overview

The `services_public` schema contains tables that coordinate the Constructive infrastructure:

```
services_public
├── apis              # GraphQL API endpoints
├── api_schemas       # Links schemas to APIs
├── api_modules       # API plugins/extensions
├── api_extensions    # PostGraphile extensions
├── sites             # Site configuration
├── site_themes       # Site visual themes
├── site_modules      # Site functionality modules
├── site_metadata     # Site key-value config
├── domains           # Domain routing
└── apps              # Mobile/web app config
```

## Entity Relationships

```
database (metaschema_public)
    │
    ├── schemas (metaschema_public)
    │       │
    │       └── api_schemas ──► apis
    │
    ├── apis (services_public)
    │       │
    │       ├── api_modules
    │       ├── api_extensions
    │       └── domains
    │
    └── sites (services_public)
            │
            ├── site_themes
            ├── site_modules
            ├── site_metadata
            ├── apps
            └── domains
```

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

## Domain Management

Domains route requests to APIs or sites:

### Create a Domain

```typescript
const result = await db.domain.create({
  data: {
    databaseId: databaseId,
    subdomain: 'api',
    domain: 'myapp.constructive.io',
    apiId: publicApiId,  // Route to API
    // OR
    // siteId: siteId,   // Route to site
  },
  select: {
    id: true,
    subdomain: true,
    domain: true,
  },
}).execute();

if (result.ok) {
  const domain = result.data.createDomain.domain;
  console.log(`Created domain: ${domain.subdomain}.${domain.domain}`);
}
```

### Standard Domain Configuration

A typical Constructive database has these domains:

| Subdomain | Routes To | Purpose |
|-----------|-----------|---------|
| `api` | public API | Main GraphQL endpoint |
| `admin` | admin API | Admin operations |
| `private` | private API | Internal operations |
| `auth` | auth API | Authentication |
| `app` | app API | User-defined tables |
| (none) | site | Web application |

### Create All Standard Domains

```typescript
const domainConfigs = [
  { subdomain: 'api', apiId: publicApiId },
  { subdomain: 'admin', apiId: adminApiId },
  { subdomain: 'private', apiId: privateApiId },
  { subdomain: 'auth', apiId: authApiId },
  { subdomain: 'app', apiId: appApiId },
  { subdomain: null, siteId: siteId },  // Root domain for site
];

for (const config of domainConfigs) {
  const result = await db.domain.create({
    data: {
      databaseId: databaseId,
      subdomain: config.subdomain,
      domain: 'myapp.constructive.io',
      apiId: config.apiId || null,
      siteId: config.siteId || null,
    },
    select: { id: true, subdomain: true },
  }).execute();

  if (result.ok) {
    const d = result.data.createDomain.domain;
    console.log(`Created: ${d.subdomain || '(root)'}.myapp.constructive.io`);
  }
}
```

### Query Domains

```typescript
const result = await db.domain.findMany({
  select: {
    id: true,
    subdomain: true,
    domain: true,
    api: {
      id: true,
      name: true,
    },
    site: {
      id: true,
      title: true,
    },
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();

if (result.ok) {
  const domains = result.data.domains.nodes;
  domains.forEach(d => {
    const target = d.api ? `API: ${d.api.name}` : `Site: ${d.site?.title}`;
    console.log(`${d.subdomain || '(root)'}.${d.domain} -> ${target}`);
  });
}
```

### Update Domain Routing

```typescript
const result = await db.domain.update({
  where: { id: domainId },
  data: {
    apiId: newApiId,
    siteId: null,  // Clear site routing
  },
  select: {
    id: true,
    subdomain: true,
    apiId: true,
  },
}).execute();
```

## API Schema Linking

Link schemas to APIs to expose them via GraphQL:

### Link a Schema to an API

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
```

### Query API Schemas

```typescript
const result = await db.apiSchema.findMany({
  select: {
    id: true,
    api: {
      id: true,
      name: true,
    },
    schema: {
      id: true,
      name: true,
      schemaName: true,
    },
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();

if (result.ok) {
  const links = result.data.apiSchemas.nodes;
  links.forEach(link => {
    console.log(`${link.api.name} API exposes ${link.schema.schemaName}`);
  });
}
```

### Remove Schema from API

```typescript
const result = await db.apiSchema.delete({
  where: { id: apiSchemaId },
}).execute();
```

## Complete Services Query

Query all services for a database:

```typescript
const result = await db.database.findFirst({
  select: {
    id: true,
    name: true,
    
    // APIs
    apis: {
      nodes: {
        id: true,
        name: true,
        isPublic: true,
        apiSchemas: {
          nodes: {
            schema: {
              id: true,
              name: true,
            },
          },
        },
        apiModules: {
          nodes: {
            id: true,
            name: true,
          },
        },
        domains: {
          nodes: {
            subdomain: true,
            domain: true,
          },
        },
      },
    },
    
    // Sites
    sites: {
      nodes: {
        id: true,
        title: true,
        siteThemes: {
          nodes: {
            theme: true,
          },
        },
        siteModules: {
          nodes: {
            name: true,
          },
        },
        apps: {
          nodes: {
            name: true,
          },
        },
        domains: {
          nodes: {
            subdomain: true,
            domain: true,
          },
        },
      },
    },
  },
  where: {
    id: { equalTo: databaseId },
  },
}).execute();
```

## Provisioning Workflow

The recommended way to set up services is via `databaseProvisionModule`:

```typescript
const result = await db.databaseProvisionModule.create({
  data: {
    databaseName: 'my-app',
    ownerId: userId,
    subdomain: 'my-app',
    domain: 'constructive.io',
    modules: ['all'],
    options: {
      site: {
        title: 'My Application',
        description: 'Built with Constructive',
      },
      theme: {
        primary: '#3b82f6',
        background: '#ffffff',
      },
    },
  },
  select: {
    id: true,
    status: true,
    databaseId: true,
  },
}).execute();
```

This automatically creates:
- Database with public/private schemas
- 5 APIs (public, admin, private, auth, app)
- 5 domains for APIs
- Site with theme and modules
- All specified modules

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available:

### Create Domain

```json
{
  "operation": "mutation",
  "model": "domain",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "subdomain": "api",
    "domain": "myapp.constructive.io",
    "apiId": "api-uuid-here"
  },
  "select": {
    "id": true,
    "subdomain": true,
    "domain": true
  }
}
```

### Link Schema to API

```json
{
  "operation": "mutation",
  "model": "apiSchema",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "apiId": "api-uuid-here",
    "schemaId": "schema-uuid-here"
  },
  "select": {
    "id": true
  }
}
```

## Domain Constraints

Domains have these constraints:

1. **Unique subdomain+domain** - Each combination must be unique
2. **One route per domain** - Either `apiId` OR `siteId`, not both
3. **Valid hostnames** - Subdomain and domain must be valid hostnames

```typescript
// This will fail - can't route to both API and site
const result = await db.domain.create({
  data: {
    databaseId: databaseId,
    subdomain: 'api',
    domain: 'myapp.constructive.io',
    apiId: apiId,
    siteId: siteId,  // Error!
  },
  select: { id: true },
}).execute();
```

## Error Handling

```typescript
const result = await db.domain.create({
  data: {
    databaseId: databaseId,
    subdomain: 'api',
    domain: 'myapp.constructive.io',  // Already exists!
    apiId: apiId,
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

1. **Use provisioning** - Let `databaseProvisionModule` handle setup
2. **Standard naming** - Use conventional subdomain names (api, admin, etc.)
3. **Minimal schema exposure** - Only link schemas that need to be public
4. **Separate concerns** - Use different APIs for different access levels
5. **Document domains** - Keep track of which domains route where

## Services Schema Tables Reference

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `apis` | API endpoints | name, roleName, isPublic |
| `api_schemas` | Schema-API links | apiId, schemaId |
| `api_modules` | API plugins | apiId, name, data |
| `api_extensions` | PostGraphile extensions | apiId, name |
| `sites` | Site config | title, description, logo |
| `site_themes` | Visual themes | siteId, theme |
| `site_modules` | Site functionality | siteId, name, data |
| `site_metadata` | Key-value config | siteId, key, value |
| `domains` | URL routing | subdomain, domain, apiId/siteId |
| `apps` | Mobile/web apps | siteId, name, appStoreLink |

## References

- Related skill: `constructive-sdk-database` for database management
- Related skill: `constructive-sdk-api` for API management
- Related skill: `constructive-sdk-site` for site management
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
