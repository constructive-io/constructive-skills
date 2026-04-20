# Storage Security Policies

Constructive storage (buckets, files, upload requests) supports configurable per-bucket security policies via the `policies` array in `storage_config`. This lets blueprint authors compose specific `Authz*` node types per entity type's storage tables, instead of always getting the hardcoded defaults.

## Two layers of storage access control

| Layer | Controlled by | What it does |
|-------|--------------|--------------|
| **Transport (S3/MinIO)** | `is_public` | Sets the S3 bucket ACL. `true` = publicly readable URLs, `false` = presigned URLs required |
| **Data (RLS)** | `policies` | Controls which authenticated users can SELECT/INSERT/UPDATE/DELETE rows in the buckets, files, and upload_requests tables |

These are complementary, not redundant. A bucket can be `is_public: true` (anyone with the URL can download) but still have RLS policies restricting who can upload or delete.

## Configuring storage policies

Storage is provisioned via `entity_type_provision` with `has_storage: true`. The optional `storage_config` JSONB column controls bucket behavior:

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": ["AuthzEntityMembership", "AuthzPublishable"]
  }
}
```

### Blueprint definition

In a blueprint `membership_types[]` entry:

```json
{
  "name": "Data Room Member",
  "prefix": "data_room",
  "parent_entity": "org",
  "has_storage": true,
  "storage_config": {
    "policies": ["AuthzDirectOwner"]
  }
}
```

### ORM

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room Member',
    prefix: 'data_room',
    parentEntity: 'org',
    hasStorage: true,
    storageConfig: {
      policies: ['AuthzDirectOwner']
    }
  }
}).execute();
```

## How `policies` flows through provisioning

```
storage_config.policies  (JSONB array on entity_type_provision)
    |
    v
insert_entity_type_provision trigger  (extracts text[])
    |
    v
storage_module.policies  (text[] column)
    |
    v
insert_storage_module trigger
    |
    v
apply_storage_security(v_policies text[])
    |
    v
metaschema.create_policy() per Authz* type per table (buckets, files, upload_requests)
```

## Defaults (when `policies` is omitted)

When `policies` is `NULL` or omitted, the system applies the original hardcoded defaults:

| Table | Policies applied |
|-------|-----------------|
| Buckets | `AuthzPublishable` (SELECT) + membership policy (full CRUD) + `AuthzDirectOwner` (full CRUD) |
| Files | `AuthzPublishable` (SELECT, INSERT) + membership policy (full CRUD) + `AuthzDirectOwner` (UPDATE, DELETE) |
| Upload Requests | membership policy (SELECT, INSERT, UPDATE) |

The "membership policy" is `AuthzMembership` for app-level storage (no `membership_type`) or `AuthzEntityMembership` for entity-scoped storage (has `membership_type`).

## Custom policies (when `policies` is provided)

When `policies` is a non-empty array, **only the listed types are applied**. Each type gets appropriate privileges per table:

| Policy Type | Buckets | Files | Upload Requests |
|-------------|---------|-------|-----------------|
| `AuthzPublishable` | SELECT | SELECT, INSERT | -- |
| `AuthzDirectOwner` | full CRUD (`owner_id`) | UPDATE, DELETE (`actor_id`) | -- |
| `AuthzMembership` / `AuthzEntityMembership` | full CRUD | full CRUD | SELECT, INSERT, UPDATE |
| Other `Authz*` types | full CRUD | full CRUD | SELECT, INSERT, UPDATE |

Multiple policies compose via standard PostgreSQL RLS rules: permissive policies are OR'd together for SELECT.

## Typical policy combinations

### 1. Private entity files (default)

The most common pattern. Entity members can CRUD their storage; no one else can see the files.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": ["AuthzEntityMembership"]
  }
}
```

**Use case:** Internal team documents, project files, private org resources.

**Equivalent to omitting `policies` entirely** (this is the default behavior for entity-scoped storage), except the default also adds `AuthzPublishable` and `AuthzDirectOwner`. Specifying `["AuthzEntityMembership"]` alone gives a tighter policy set.

### 2. Public assets with member write

Entity members can upload and manage files. Published files are readable by anyone with a valid session (via `AuthzPublishable` SELECT policy).

```json
{
  "has_storage": true,
  "storage_config": {
    "is_public": true,
    "policies": ["AuthzEntityMembership", "AuthzPublishable"]
  }
}
```

**Use case:** Marketing assets, public documentation, shared media libraries.

**Note:** `is_public: true` makes the S3 bucket publicly readable (no presigned URL needed for downloads). `AuthzPublishable` adds a permissive SELECT RLS policy so the database rows are visible. Both layers work together for truly public read access.

### 3. Owner-only private documents

Only the file owner (the user who uploaded it) can access their files. Other entity members cannot see them.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": ["AuthzDirectOwner"]
  }
}
```

**Use case:** Personal documents, private uploads in a shared workspace, compliance/diligence files that are per-user.

**How it works:** `AuthzDirectOwner` checks `owner_id` on the buckets table and `actor_id` on the files table against the current user. No membership-based access is granted.

## Available policy types for storage

Any `Authz*` node type from the registry can be used. The most relevant ones for storage:

| Type | When to use |
|------|------------|
| `AuthzEntityMembership` | Members of the entity can access (most common) |
| `AuthzDirectOwner` | Only the uploader/owner can access |
| `AuthzPublishable` | Published files are publicly readable (SELECT only) |
| `AuthzMembership` | App-level membership gate (any authenticated member) |
| `AuthzAllowAll` | No restrictions (use sparingly) |
| `AuthzDenyAll` | Lock down completely (admin override only) |

See the [`constructive-safegres`](../constructive-safegres/SKILL.md) skill for the full list of 14 Authz* types and their config shapes.

## Cross-references

- **Safegres protocol (Authz* types):** [`constructive-safegres`](../constructive-safegres/SKILL.md)
- **Membership types & provisioning:** [`constructive-membership-types`](../constructive-membership-types/SKILL.md)
- **Blueprint definition format:** [blueprint-definition-format.md](./blueprint-definition-format.md)
- **Multi-scope bucket resolution:** `multi-scope-bucket-resolution` skill in `constructive-db`
- **SQL-level security details:** `constructive-db-security-sql` skill in `constructive-db`
