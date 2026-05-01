# Entity Field Reference

Detailed field reference for all service and schema-related entities in the `@constructive-io/sdk`.

## Api

The core service entity. Defines a GraphQL API endpoint with role-based access control.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `name` | `string` | yes | API name (e.g., `"public"`, `"admin"`) |
| `dbname` | `string` | no | Database name override |
| `roleName` | `string` | no | Role for authenticated users |
| `anonRole` | `string` | no | Role for anonymous access |
| `isPublic` | `boolean` | no | Whether API is publicly accessible |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `database` | `Database` | Parent database |
| `rlsModule` | `RlsModule` | Row-level security module |
| `apiModules` | `ApiModule[]` (connection) | Config modules attached to this API |
| `apiSchemas` | `ApiSchema[]` (connection) | Schemas exposed by this API |
| `domains` | `Domain[]` (connection) | Domains routing to this API |

### Filter Fields (`ApiFilter`)

All scalar fields support standard filter operators: `equalTo`, `notEqualTo`, `in`, `notIn`, `isNull`, etc.
String fields additionally support: `like`, `likeInsensitive`, `includes`, `startsWith`, `endsWith`.

### CRUD Operations

```typescript
// Create
sdk.api.create({ data: { databaseId, name, ... }, select: { ... } })

// Read
sdk.api.findMany({ select: { ... }, where: { ... }, first: 10 })
sdk.api.findFirst({ select: { ... }, where: { name: { equalTo: 'public' } } })
sdk.api.findOne({ id: apiId, select: { ... } })

// Update
sdk.api.update({ where: { id: apiId }, data: { ... }, select: { ... } })

// Delete
sdk.api.delete({ where: { id: apiId }, select: { ... } })
```

---

## ApiSchema

Join entity linking an Api to a Schema. This is what makes a schema's tables/views available through a specific API endpoint.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `apiId` | `string` | yes | The API to attach to |
| `schemaId` | `string` | yes | The schema to expose |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `api` | `Api` | The linked API |
| `database` | `Database` | Parent database |
| `schema` | `Schema` | The linked schema |

### CRUD Operations

```typescript
// Create (attach a schema to an API)
sdk.apiSchema.create({ data: { databaseId, apiId, schemaId }, select: { ... } })

// Query with relations
sdk.apiSchema.findMany({
  select: {
    id: true,
    api: { select: { id: true, name: true } },
    schema: { select: { id: true, name: true } },
  },
})

// Delete (detach a schema from an API)
sdk.apiSchema.delete({ where: { id: apiSchemaId }, select: { ... } })
```

---

## ApiModule

Named JSON configuration blob attached to an API. Used for custom configuration like CORS, rate limiting, feature flags, etc.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `apiId` | `string` | yes | The API this module belongs to |
| `name` | `string` | yes | Module name (e.g., `"cors_config"`) |
| `data` | `JSON` | yes | Module configuration (arbitrary JSON object) |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `api` | `Api` | The parent API |
| `database` | `Database` | Parent database |

### CRUD Operations

```typescript
// Create
sdk.apiModule.create({
  data: { databaseId, apiId, name: 'my_module', data: { key: 'value' } },
  select: { id: true, name: true },
})

// Update module data
sdk.apiModule.update({
  where: { id: moduleId },
  data: { data: { key: 'new-value' } },
  select: { id: true },
})
```

---

## Domain

Maps a subdomain + domain combination to an API and/or Site for routing.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `apiId` | `string` | no | API to route to |
| `siteId` | `string` | no | Site to route to |
| `subdomain` | `string` | no | Subdomain (e.g., `"api"`, `"app"`) |
| `domain` | `string` | no | Domain (e.g., `"example.com"`) |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `api` | `Api` | The linked API (if any) |
| `database` | `Database` | Parent database |
| `site` | `Site` | The linked site (if any) |

### CRUD Operations

```typescript
// Create with immediate API link
sdk.domain.create({
  data: { databaseId, subdomain: 'api', domain: 'example.com', apiId: api.id },
  select: { id: true },
})

// Create first, link later
const domain = await sdk.domain.create({
  data: { databaseId, subdomain: 'app', domain: 'example.com' },
  select: { id: true },
}).unwrap();

await sdk.domain.update({
  where: { id: domain.createDomain.domain.id },
  data: { siteId: site.id },
  select: { id: true },
}).execute();
```

---

## Schema

A database schema that contains tables, views, and other database objects. Schemas are auto-created when a database is created (e.g., `"public"`).

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `name` | `string` | yes | Schema name identifier |
| `schemaName` | `string` | yes | PostgreSQL schema name |
| `label` | `string` | no | Display label |
| `description` | `string` | no | Description |
| `smartTags` | `JSON` | no | PostGraphile smart tags |
| `category` | `ObjectCategory` | no | Category classification |
| `module` | `string` | no | Module name |
| `scope` | `number` | no | Scope level |
| `tags` | `string[]` | no | Tags |
| `isPublic` | `boolean` | no | Whether schema is public |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `database` | `Database` | Parent database |
| `tables` | `Table[]` (connection) | Tables in this schema |
| `views` | `View[]` (connection) | Views in this schema |
| `schemaGrants` | `SchemaGrant[]` (connection) | Access grants for this schema |
| `apiSchemas` | `ApiSchema[]` (connection) | APIs that expose this schema |
| `tableTemplateModules` | `TableTemplateModule[]` (connection) | Template modules |

### Querying schemas from a database

When you create a database, schemas like `"public"` are auto-provisioned. You can access them via the database's `schemas` relation:

```typescript
const dbResult = await sdk.database
  .create({
    data: { name: 'my-project', ownerId: userId },
    select: {
      id: true,
      schemas: { select: { id: true, name: true }, first: 10 },
    },
  })
  .execute();

const publicSchema = dbResult.data.createDatabase.database.schemas?.nodes?.find(
  (s) => s.name === 'public'
);
```

---

## SchemaGrant

Grants a database role access to a schema.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | no | Parent database UUID |
| `schemaId` | `string` | yes | Schema to grant access to |
| `granteeName` | `string` | yes | Role name to grant access |

### CRUD Operations

```typescript
// Grant access
sdk.schemaGrant.create({
  data: { schemaId, granteeName: 'authenticated' },
  select: { id: true },
})

// Query grants for a schema
sdk.schemaGrant.findMany({
  where: { schemaId: { equalTo: schemaId } },
  select: { id: true, granteeName: true },
})

// Revoke access
sdk.schemaGrant.delete({
  where: { id: grantId },
  select: { id: true },
})
```

---

## Site

Website metadata container for branding, SEO, and asset references.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `databaseId` | `string` | yes | Parent database UUID |
| `title` | `string` | no | Site title |
| `description` | `string` | no | Site description |
| `ogImage` | `Image` | no | OpenGraph image (`{ url, mime }`) |
| `favicon` | `string` | no | Favicon URL |
| `appleTouchIcon` | `Image` | no | Apple touch icon (`{ url, mime }`) |
| `logo` | `Image` | no | Logo image (`{ url, mime }`) |
| `dbname` | `string` | no | Database name |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `database` | `Database` | Parent database |
| `app` | `App` | Associated mobile app |
| `domains` | `Domain[]` (connection) | Domains routing to this site |
| `siteMetadata` | `SiteMetadatum[]` (connection) | Additional metadata |
| `siteModules` | `SiteModule[]` (connection) | Config modules |
| `siteThemes` | `SiteTheme[]` (connection) | Theme configurations |

### Image Type

Image fields accept an object with `url` and `mime`:

```typescript
{
  url: 'https://example.com/logo.png',
  mime: 'image/png',
}
```

---

## Database

Top-level container for all entities.

### Fields

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `id` | `string` | auto | UUID primary key |
| `ownerId` | `string` | no | Owner user UUID |
| `name` | `string` | no | Database name |
| `label` | `string` | no | Display label |

### Key Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `owner` | `User` | Database owner |
| `schemas` | `Schema[]` (connection) | Database schemas |
| `apis` | `Api[]` (connection) | API services |
| `domains` | `Domain[]` (connection) | Domain mappings |
| `sites` | `Site[]` (connection) | Site configurations |
| `tables` | `Table[]` (connection) | All tables |
| `apiSchemas` | `ApiSchema[]` (connection) | All API-schema links |
| `apiModules` | `ApiModule[]` (connection) | All API modules |
