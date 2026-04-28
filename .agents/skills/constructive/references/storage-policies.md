# Storage Security Policies

Constructive storage (buckets, files, upload requests) supports configurable per-bucket security policies via the `policies` array in `storage_config`. This lets blueprint authors compose specific `Authz*` node types per entity type's storage tables, instead of always getting the hardcoded defaults.

## Two layers of storage access control

| Layer | Controlled by | What it does |
|-------|--------------|--------------|
| **Transport (S3/MinIO)** | `is_public` | Sets the S3 bucket ACL. `true` = publicly readable URLs, `false` = presigned URLs required |
| **Data (RLS)** | `policies` | Controls which authenticated users can SELECT/INSERT/UPDATE/DELETE rows in the buckets, files, and upload_requests tables |

These are complementary, not redundant. A bucket can be `is_public: true` (anyone with the URL can download) but still have RLS policies restricting who can upload or delete.

## The three storage tables

When `has_storage: true`, the system creates three tables per entity type, prefixed with the entity's `prefix`:

| Logical name | Physical table (prefix=`data_room`) | Key columns | Notes |
|---|---|---|---|
| **buckets** | `data_room_buckets` | `owner_id`, `is_public`, `key`, `type` | Container metadata |
| **files** | `data_room_files` | `actor_id`, `is_public`, `key`, `mime_type`, `size`, `status` | Individual file records |
| **upload_requests** | `data_room_upload_requests` | `file_id`, `bucket_id`, `status` | In-flight upload tracking |

**Column availability matters for policy scoping:**
- **Buckets** has `is_public` and `owner_id` — supports `AuthzPublishable` and `AuthzDirectOwner`
- **Files** has `is_public` and `actor_id` — supports `AuthzPublishable` and `AuthzDirectOwner`
- **Upload requests** has neither `is_public` nor `actor_id` — only supports membership-based policies

## Configuring storage policies

Storage is provisioned via `entity_type_provision` with `has_storage: true`. The optional `storage_config` JSONB column controls bucket behavior:

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] }
    ]
  }
}
```

### Blueprint definition

In a blueprint `membership_types[]` entry:

```json
{
  "name": "Data Room",
  "prefix": "data_room",
  "parent_entity": "org",
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzDirectOwner", "privileges": ["update", "delete"], "tables": ["files"] }
    ]
  }
}
```

### ORM

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room',
    prefix: 'data_room',
    parentEntity: 'org',
    hasStorage: true,
    storageConfig: {
      policies: [
        { $type: 'AuthzEntityMembership', privileges: ['select', 'insert', 'update', 'delete'] },
        { $type: 'AuthzDirectOwner', privileges: ['update', 'delete'], tables: ['files'] },
      ],
    },
  },
}).execute();
```

## Policy object format

Each entry in the `policies` array is a policy object with explicit privileges and optional table scoping:

```json
{
  "$type": "AuthzEntityMembership",
  "privileges": ["select", "insert", "update", "delete"],
  "data": { "entity_field": "owner_id", "membership_type": 5 },
  "tables": ["buckets", "files", "upload_requests"]
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `$type` | string | **Yes** | — | Authz* node type name |
| `privileges` | string[] | **Yes** | — | Privileges to apply. Intersected with what each storage table supports |
| `data` | object | No | *(auto-derived)* | Policy data. When omitted, derived from membership_type and known Authz* conventions |
| `tables` | string[] | No | all three | Which storage tables to apply this policy to (see below) |
| `policy_name` | string | No | *(auto-derived)* | Custom suffix for the generated policy name |

### The `tables` key

The `tables` key uses **logical names** (`"buckets"`, `"files"`, `"upload_requests"`), not the prefixed physical table names. The function already knows the prefix from the storage module context and resolves the full table names internally.

```json
// Applies to data_room_buckets and data_room_files (NOT data_room_upload_requests)
{ "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] }
```

- **Omit `tables`** → policy applies to all three storage tables
- **Specify `tables`** → policy applies only to the listed tables

This is how you avoid applying a policy to a table that doesn't have the required columns. For example, `AuthzPublishable` needs `is_public` and `AuthzDirectOwner` needs `actor_id` — neither exists on `upload_requests`.

### Privilege intersection per table

Requested privileges are intersected with what each table supports:

- **Buckets:** select, insert, update, delete
- **Files:** select, insert, update, delete
- **Upload requests:** select, insert, update *(no delete)*

If you request `["select", "insert", "update", "delete"]` on upload_requests, only select/insert/update are applied — delete is silently dropped.

## How `policies` flows through provisioning

```
storage_config.policies  (JSONB array on entity_type_provision)
    |
    v
insert_entity_type_provision trigger  (extracts jsonb)
    |
    v
storage_module.policies  (jsonb column)
    |
    v
insert_storage_module trigger
    |
    v
apply_storage_security(v_policies jsonb)
    |
    v
metaschema.create_policy() per entry per table (buckets, files, upload_requests)
```

## Defaults (when `policies` is omitted)

When `policies` is `NULL` or omitted, the system applies sensible defaults:

| Table | Policies applied |
|-------|-----------------|
| Buckets | `AuthzPublishable` (SELECT) + membership policy (full CRUD) |
| Files | `AuthzPublishable` (SELECT, INSERT) + membership policy (full CRUD) + `AuthzDirectOwner` (UPDATE, DELETE) |
| Upload Requests | membership policy (SELECT, INSERT, UPDATE) |

The "membership policy" is `AuthzMembership` for app-level storage (no `membership_type`) or `AuthzEntityMembership` for entity-scoped storage (has `membership_type`).

## Typical policy combinations

### 1. Private entity files (default)

The most common pattern. Entity members can CRUD their storage; no one else can see the files.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] }
    ]
  }
}
```

**Use case:** Internal team documents, project files, private org resources.

**Equivalent to omitting `policies` entirely** (this is the default behavior for entity-scoped storage), except the default also adds `AuthzPublishable` and `AuthzDirectOwner`. Specifying just `AuthzEntityMembership` gives a tighter policy set.

### 2. Public assets with member write

Entity members can upload and manage files. Published files are readable by anyone with a valid session (via `AuthzPublishable` SELECT policy).

```json
{
  "has_storage": true,
  "storage_config": {
    "is_public": true,
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] }
    ]
  }
}
```

**Use case:** Marketing assets, public documentation, shared media libraries.

**Note:** `is_public: true` makes the S3 bucket publicly readable (no presigned URL needed for downloads). `AuthzPublishable` adds a permissive SELECT RLS policy so the database rows are visible. Both layers work together for truly public read access.

**Note:** `AuthzPublishable` is scoped to `["buckets", "files"]` because `upload_requests` lacks the `is_public` column that the policy requires.

### 3. Owner-only private documents

Only the file owner (the user who uploaded it) can update/delete their files. Other entity members have read-only access.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select"] },
      { "$type": "AuthzDirectOwner", "privileges": ["update", "delete"], "tables": ["files"] }
    ]
  }
}
```

**Use case:** Personal documents, private uploads in a shared workspace, compliance/diligence files that are per-user.

**Note:** `AuthzDirectOwner` is scoped to `["files"]` because it uses the `actor_id` column, which only exists on the files table.

### 4. Full CRUD with owner delete + public read

The "kitchen sink" — entity members get full CRUD, published content is publicly readable, and file uploaders can manage their own files.

```json
{
  "has_storage": true,
  "storage_config": {
    "is_public": true,
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] },
      { "$type": "AuthzDirectOwner", "privileges": ["update", "delete"], "tables": ["files"] }
    ]
  }
}
```

### 5. Read-only entity storage

Members can view files but not upload, update, or delete.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select"] }
    ]
  }
}
```

## Available policy types for storage

Any `Authz*` node type from the registry can be used. The most relevant ones for storage:

| Type | When to use | Required columns | Scope with `tables` |
|------|------------|-----------------|---------------------|
| `AuthzEntityMembership` | Members of the entity can access (most common) | `owner_id` | All three |
| `AuthzDirectOwner` | Only the uploader/owner can access | `actor_id` (files), `owner_id` (buckets) | `["files"]` or `["buckets", "files"]` |
| `AuthzPublishable` | Published files are publicly readable (SELECT only) | `is_public` | `["buckets", "files"]` |
| `AuthzMembership` | App-level membership gate (any authenticated member) | — | All three |
| `AuthzAllowAll` | No restrictions (use sparingly) | — | All three |
| `AuthzDenyAll` | Lock down completely (admin override only) | — | All three |

See the [`constructive-safegres`](../constructive-safegres/SKILL.md) skill for the full list of 14 Authz* types and their config shapes.

## Cross-references

- **Safegres protocol (Authz* types):** [`constructive-safegres`](../constructive-safegres/SKILL.md)
- **Custom entities & provisioning:** [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md)
- **Blueprint definition format:** [blueprint-definition-format.md](./blueprint-definition-format.md)
- **Upload flow (GraphQL mutations, client library):** [`constructive-uploads`](../constructive-uploads/SKILL.md)
- **Multi-scope bucket resolution:** `multi-scope-bucket-resolution` skill in `constructive-db`
- **SQL-level security details:** `constructive-db-security-sql` skill in `constructive-db`
