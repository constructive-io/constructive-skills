---
name: constructive-sdk-database
description: Create and manage databases in Constructive using the type-safe SDK. Use when asked to "create a database", "provision a database", "manage database metadata", or when working with metaschema_public.database operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Database Management

Create and manage databases in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Creating a new database in Constructive
- Querying existing databases
- Updating database metadata (name, label)
- Understanding the database provisioning workflow
- Working with the `metaschema_public.database` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Database Schema

The `metaschema_public.database` table stores database metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `ownerId` | uuid | Owner user ID |
| `schemaName` | text | Public schema name (auto-generated) |
| `privateSchemaName` | text | Private schema name (auto-generated) |
| `name` | text | Database name (min 3 chars) |
| `label` | text | Human-readable label |
| `hash` | uuid | Unique hash |

When a database is created, triggers automatically create the public and private schemas.

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

## Creating a Database

### Basic Database Creation

```typescript
const result = await db.database.create({
  data: {
    name: 'my-app',
    ownerId: userId,
    label: 'My Application',
  },
  select: {
    id: true,
    name: true,
    schemaName: true,
    privateSchemaName: true,
  },
}).execute();

if (result.ok) {
  const database = result.data.createDatabase.database;
  console.log('Created database:', database.id);
  console.log('Public schema:', database.schemaName);
  console.log('Private schema:', database.privateSchemaName);
} else {
  console.error('Failed to create database:', result.errors);
}
```

### Full Database Provisioning

For a complete database with APIs, domains, and modules, use the `databaseProvisionModule`:

```typescript
const result = await db.databaseProvisionModule.create({
  data: {
    databaseName: 'my-app',
    ownerId: userId,
    subdomain: 'my-app',
    domain: 'constructive.io',
    modules: ['users_module', 'user_auth_module', 'permissions_module:app'],
    options: {
      tokens_expiration: '30 days',
      site: {
        title: 'My Application',
        description: 'A great app built with Constructive',
      },
    },
    bootstrapUser: true,
  },
  select: {
    id: true,
    databaseId: true,
    status: true,
    errorMessage: true,
  },
}).execute();

if (result.ok) {
  const provision = result.data.createDatabaseProvisionModule.databaseProvisionModule;
  console.log('Provisioning status:', provision.status);
  console.log('Database ID:', provision.databaseId);
} else {
  console.error('Provisioning failed:', result.errors);
}
```

### Available Modules

When provisioning, you can specify which modules to install:

| Module | Description |
|--------|-------------|
| `users_module` | User management |
| `user_auth_module` | Authentication (sign in, sign up) |
| `tokens_module` | JWT token management |
| `user_state_module` | User state storage (plaintext key-value, e.g. API keys) |
| `config_secrets_user_module` | User secrets (encrypted, e.g. password hashes) |
| `config_secrets_org_module` | Org-scoped encrypted secrets (optional, requires orgs) |
| `permissions_module:app` | App-level permissions |
| `permissions_module:org` | Org-level permissions |
| `memberships_module:app` | App memberships |
| `memberships_module:org` | Org memberships |
| `emails_module` | Email addresses |
| `invites_module` | User invitations |
| `profiles_module` | User profiles |
| `hierarchy_module` | Org hierarchy |

Pass an explicit list of these module names — there is **no `['all']` sentinel** (it matches zero branches in `provision_database_modules` and installs nothing). For a basic auth app use the `auth:email` list; for everything use the `full` preset's list. See `constructive-sdk`'s `references/provisioning.md` and the `constructive-platform` `module-presets.md` catalog.

## Querying Databases

### Find All Databases

```typescript
const result = await db.database.findMany({
  select: {
    id: true,
    name: true,
    label: true,
    ownerId: true,
    createdAt: true,
  },
  first: 20,
}).execute();

if (result.ok) {
  const databases = result.data.databases.nodes;
  databases.forEach(d => console.log(`${d.name}: ${d.id}`));
}
```

### Find Database by Name

```typescript
const result = await db.database.findFirst({
  select: {
    id: true,
    name: true,
    schemaName: true,
    privateSchemaName: true,
  },
  where: {
    name: { equalTo: 'my-app' },
  },
}).execute();

if (result.ok && result.data.databases.nodes.length > 0) {
  const database = result.data.databases.nodes[0];
  console.log('Found database:', database.id);
}
```

### Find Database with Relations

```typescript
const result = await db.database.findMany({
  select: {
    id: true,
    name: true,
    schemas: {
      nodes: {
        id: true,
        name: true,
        isPublic: true,
      },
    },
    apis: {
      nodes: {
        id: true,
        name: true,
        isPublic: true,
      },
    },
    sites: {
      nodes: {
        id: true,
        title: true,
      },
    },
  },
  where: {
    ownerId: { equalTo: userId },
  },
}).execute();
```

## Updating a Database

```typescript
const result = await db.database.update({
  where: { id: databaseId },
  data: {
    label: 'Updated Label',
  },
  select: {
    id: true,
    label: true,
    updatedAt: true,
  },
}).execute();

if (result.ok) {
  console.log('Updated database:', result.data.updateDatabase.database);
}
```

## Deleting a Database

```typescript
const result = await db.database.delete({
  where: { id: databaseId },
}).execute();

if (result.ok) {
  console.log('Deleted database:', result.data.deleteDatabase.database.id);
}
```

**Warning**: Deleting a database cascades to all related schemas, tables, APIs, sites, and domains.

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available, use the JSON dialect that generates GraphQL:

```json
{
  "operation": "mutation",
  "model": "database",
  "action": "create",
  "data": {
    "name": "my-app",
    "ownerId": "uuid-here",
    "label": "My Application"
  },
  "select": {
    "id": true,
    "name": true,
    "schemaName": true
  }
}
```

This compiles to the equivalent GraphQL mutation.

## Error Handling

```typescript
const result = await db.database.create({
  data: { name: 'ab', ownerId: userId }, // Too short!
  select: { id: true },
}).execute();

if (!result.ok) {
  // Handle validation errors
  result.errors.forEach(error => {
    console.error(`Error: ${error.message}`);
    // "new row for relation "database" violates check constraint "db_namechk""
  });
}
```

## Database Lifecycle

1. **Create Database** - Insert into `metaschema_public.database`
2. **Triggers Fire** - Auto-create public/private schemas
3. **Provision APIs** - Create APIs (public, admin, private, auth, app)
4. **Provision Domains** - Create domain mappings
5. **Provision Site** - Create site with themes and metadata
6. **Install Modules** - Install selected modules (users, auth, etc.)

## Best Practices

1. **Use provisioning for new apps** - Use `databaseProvisionModule` for complete setup
2. **Select only needed fields** - Minimize response payload
3. **Handle errors explicitly** - Check `result.ok` before accessing data
4. **Use meaningful names** - Database names should be URL-safe slugs
5. **Set owner correctly** - Always specify `ownerId` for proper RLS

## References

- Related skill: [`constructive-sdk-tables`](../constructive-sdk-tables) for table management after database creation
- Related skill: [`constructive-sdk-fields`](../constructive-sdk-fields) for field (column) management
- Related skill: [`constructive-sdk-indexes`](../constructive-sdk-indexes) for index management
- Related skill: [`constructive-sdk-security`](../constructive-sdk-security) for RLS, grants, and `secureTableProvision`
- Related skill: [`constructive-sdk-api`](../constructive-sdk-api) for API management
- Related skill: [`constructive-sdk-site`](../constructive-sdk-site) for site management
- Related skill: [`constructive-sdk-services`](../constructive-sdk-services) for services schema overview
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
