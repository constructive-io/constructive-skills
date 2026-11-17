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
| `roleName` | `string` | no | Role for authenticated users |
| `anonRole` | `string` | no | Role for anonymous access |
| `isPublished` | `boolean` | no | Whether other scopes may see and route to this API surface |
| `config` | `JSON` | no | Module-specific configuration for this API surface |
| `serviceHostname` | `string` | read-only | The platform-issued hostname: a managed, verified domain routed to this API |
| `createdAt` / `updatedAt` | `string` | auto | Timestamps |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `apiSchemas` | `ApiSchema[]` (connection) | Schemas exposed by this API |
| `apiSetting` | `ApiSetting` | Per-API feature flags and request bounds (see `constructive-auth`) |
| `corsSettings` | `CorsSetting[]` (connection) | Per-API CORS origins |

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

## Domain

A claimed hostname. Claim one with the verbs in [`constructive-sites`](../../constructive-sites/SKILL.md) (e.g. `domainsAssignSubdomain`); what it serves is decided by its routes.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `databaseId` | `string` | Parent database UUID |
| `hostname` | `string` | The hostname (e.g. `"api.example.com"`) |
| `parentHostname` | `string` | The apex it was claimed under |
| `managed` | `boolean` | Whether the platform manages the hostname |
| `isWildcard` | `boolean` | Wildcard hostname |
| `isPublished` | `boolean` | Whether other scopes may see and route to it |
| `verificationStatus` / `verifiedAt` | `string` | Ownership verification state |
| `tlsStatus` / `tlsReadyAt` / `tlsSecretName` | `string` | Certificate state |
| `config` | `JSON` | Domain configuration |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `routes` | `Route[]` (connection) | Routes serving this hostname |
| `domainVerifications` | `DomainVerification[]` (connection) | Verification attempts |
| `domainEvents` | `DomainEvent[]` (connection) | Domain lifecycle events |

---

## Route

Maps `domainId` + `path` (+ optional `method`) to one target. Unique per `(domainId, path, method)`; the longest matching path prefix wins.

| Field | Type | Required on Create | Description |
|-------|------|-------------------|-------------|
| `databaseId` | `string` | yes | Parent database UUID |
| `domainId` | `string` | yes | Domain whose hostname this route serves |
| `path` | `string` | no | Path prefix (default `'/'`); must begin with `/`, no trailing slash |
| `method` | `string` | no | Uppercase HTTP method; NULL matches any |
| `priority` | `number` | no | Higher wins between otherwise-equal matches |
| `isActive` | `boolean` | no | Inactive routes are excluded from resolution |
| `anonymous` | `boolean` | no | Answers callers with no identity (target function must declare `anonymous_callable`) |
| `targetApiId` / `targetSiteId` / `targetFunctionId` / `targetBucketId` / `targetServiceId` / `targetRedirectId` | `string` | one | What the route serves |
| `servingSiteId` | `string` | no | Site whose surface the route serves |
| `previewRef` | `string` | no | Site preview this route serves; NULL = the published release |

```typescript
sdk.route.create({
  data: { databaseId, domainId, targetApiId: api.id },
  select: { id: true, path: true },
})
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

A web property. The site row carries its own `name`, `title` and `description`; branding and SEO fields (`ogImage`, `favicon`, `appleTouchIcon`, `logo`, `canonicalUrl`, `robots`, plus a metadata `title` / `description`) live on its `siteMetadatum` row. See [`constructive-sites`](../../constructive-sites/SKILL.md) for provisioning, releases and previews.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `databaseId` | `string` | Parent database UUID |
| `name` | `string` | Site name |
| `title` | `string` | Site title |
| `description` | `string` | Site description |
| `bucketId` | `string` | Bucket a static site serves from |
| `activeCommitId` | `string` | Active release (null = serve the bucket root) |
| `isPublished` | `boolean` | Whether the site is routable |
| `resourceId` / `installationId` / `installationMemberSlug` | `string` | Service-backed (SSR) site wiring |

### Relations (available via `select`)

| Relation | Type | Description |
|----------|------|-------------|
| `siteMetadatum` | `SiteMetadatum` | Branding and SEO metadata |
| `siteWebConfig` | `SiteWebConfig` | Serving rules |
| `siteRelease` | `SiteRelease` | Release state |
| `routesByServingSiteId` | `Route[]` (connection) | Routes serving this site |
| `pages`, `siteAppLinks`, `siteDeepLinks`, `siteErrorPages`, `siteModules`, `siteThemes` | connections | Owned rows |

### Image Type

Image fields on `siteMetadatum` accept an object with `url` and `mime`:

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
