# Storage Security Policies

Constructive storage (buckets, files) supports configurable security policies via the `policies` array. This lets blueprint authors compose specific `Authz*` node types per storage scope's tables, instead of always getting the sensible defaults.

Storage can be provisioned at three levels:
- **App-level** — via the top-level `storage` key with `scope: "app"` (default) in the blueprint definition (Phase 0.5)
- **Org-level** — via the top-level `storage` key with `scope: "org"` in the blueprint definition (Phase 0.5). Creates per-org/user storage (`org_buckets`/`org_files`) with `owner_id`
- **Entity-scoped** — via `storage: [...]` on an `entity_types[]` entry (Phase 0)

## Two layers of storage access control

| Layer | Controlled by | What it does |
|-------|--------------|--------------|
| **Transport (S3/MinIO)** | `is_public` | Sets the S3 bucket ACL. `true` = publicly readable URLs, `false` = presigned URLs required |
| **Data (RLS)** | `policies` | Controls which authenticated users can SELECT/INSERT/UPDATE/DELETE rows in the buckets and files tables |

These are complementary, not redundant. A bucket can be `is_public: true` (anyone with the URL can download) but still have RLS policies restricting who can upload or delete.

## The two storage tables

When `has_storage: true`, the system creates two tables per entity type, prefixed with the entity's `prefix`:

| Logical name | Physical table (prefix=`data_room`) | Key columns | Notes |
|---|---|---|---|
| **buckets** | `data_room_buckets` | `owner_id`, `is_public`, `key`, `type` | Container metadata |
| **files** | `data_room_files` | `actor_id`, `is_public`, `key`, `mime_type`, `size` | Individual file records |

**Column availability matters for policy scoping:**
- **Buckets** has `is_public` and `actor_id` — supports `AuthzPublishable` and the owner policies (`actor_id` is provenance only; the defaults do not grant bucket authorship)
- **Files** has `is_public` and `actor_id` — supports `AuthzPublishable` and the owner policies

> **Authorship must be membership-fenced.** Storage tables always carry a membership policy, so an author arm must be `AuthzAppMemberOwner` (app-level storage) or `AuthzMemberOwner` (entity-scoped storage), never a bare `AuthzDirectOwner`. Permissive policies are ORed: a bare owner policy would let a removed member keep updating and deleting the files they uploaded.

## Configuring storage policies

Storage policies can be configured at two levels:

### App-level storage (top-level `storage` key)

The blueprint `storage` key provisions app-level storage (Phase 0.5). Bucket seeding, config overrides, and policies are all configured here:

```json
{
  "storage": {
    "buckets": [
      { "name": "avatars", "is_public": true, "allowed_mime_types": ["image/png", "image/jpeg"] },
      { "name": "documents", "is_public": false, "max_file_size": 52428800 }
    ],
    "policies": [
      { "$type": "AuthzAppMembership", "privileges": ["select", "insert"] },
      { "$type": "AuthzAppMemberOwner", "privileges": ["update", "delete"], "tables": ["files"], "data": {"owner_field": "actor_id"} }
    ],
    "upload_url_expiry_seconds": 1800,
    "download_url_expiry_seconds": 3600,
    "default_max_file_size": 104857600,
    "allowed_origins": ["https://app.example.com"]
  },
  "entity_types": [ ... ],
  "tables": [ ... ]
}
```

When `policies` is omitted, sensible defaults are applied (see [Defaults](#defaults-when-policies-is-omitted) below). When `policies` is provided (non-empty array), **no defaults are applied** — explicit policies fully replace the defaults.

App-level storage uses `AuthzAppMembership` (hardcoded to `membership_type=1`) as the membership policy type.

### Entity-scoped storage (`entity_types[]` with `has_storage`)

Entity-scoped storage is provisioned via `entity_types[]` with `has_storage: true`:

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "has_storage": true,
      "storage_config": {
        "policies": [
          { "$type": "AuthzEntityMembership", "privileges": ["select", "insert"] },
          { "$type": "AuthzMemberOwner", "privileges": ["update", "delete"], "tables": ["files"],
            "data": { "owner_field": "actor_id", "entity_field": "owner_id", "entity_type": "data_room" } }
        ]
      }
    }
  ]
}
```

Entity-scoped storage uses `AuthzEntityMembership` (with `entity_field: 'owner_id'` and the entity's `membership_type`) as the membership policy type.

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
        { $type: 'AuthzEntityMembership', privileges: ['select', 'insert'] },
        { $type: 'AuthzMemberOwner', privileges: ['update', 'delete'], tables: ['files'],
          data: { owner_field: 'actor_id', entity_field: 'owner_id', entity_type: 'data_room' } },
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
  "tables": ["buckets", "files"]
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `$type` | string | **Yes** | — | Authz* node type name |
| `privileges` | string[] | **Yes** | — | Privileges to apply. Intersected with what each storage table supports |
| `data` | object | No | *(auto-derived)* | Policy data. When omitted, derived from membership_type and known Authz* conventions |
| `tables` | string[] | No | both | Which storage tables to apply this policy to (see below) |
| `policy_name` | string | No | *(auto-derived)* | Custom suffix for the generated policy name |

### The `tables` key

The `tables` key uses **logical names** (`"buckets"`, `"files"`), not the prefixed physical table names. The function already knows the prefix from the storage module context and resolves the full table names internally.

```json
// Applies to data_room_buckets and data_room_files only
{ "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] }
```

- **Omit `tables`** → policy applies to both storage tables
- **Specify `tables`** → policy applies only to the listed tables

This is how you avoid applying a policy to a table that doesn't have the required columns. For example, `AuthzPublishable` needs `is_public` — scope it to tables that have this column.

### Privilege intersection per table

Requested privileges are intersected with what each table supports:

- **Buckets:** select, insert, update, delete
- **Files:** select, insert, update, delete


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
metaschema.create_policy() per entry per table (buckets, files)
```

## Defaults (when `policies` is omitted)

When `policies` is `NULL` or omitted, `apply_storage_security` applies **sensible, locked-down defaults** based on the principle of least privilege. The defaults are the same for both app-level and entity-scoped storage — only the membership policy type differs.

### Default policy matrix

| Table | Policy | Privileges | Suffix | Purpose |
|-------|--------|-----------|--------|---------|
| **Buckets** | Membership | `select` | `mem` | Members can resolve buckets (no `AuthzPublishable` arm — `is_public` describes how objects are served, not who sees the row) |
| **Buckets** | Membership + `is_admin`/`is_owner` | `insert`, `update`, `delete` | `adm` | Buckets belong to the scope owner; management is admin-gated, never actor authorship |
| **Files** | `AuthzPublishable` (`is_public`) | `select` | `pub` | Public files readable by any authenticated user |
| **Files** | Membership | `select`, `insert` | `mem` | Members can view and upload files (with `restrict_reads`, SELECT requires the `read_files` capability) |
| **Files** | Compound member-owner (`actor_id`) | `update`, `delete` | `own` | Uploader can modify/delete their own files **while still a member**: `AuthzMemberOwner` (entity scopes), `AuthzAppMemberOwner` (app/platform), `AuthzRelatedMemberOwner` (database scope) |
| **Files** | Membership + capability | `update` / `delete` | escalation | Members holding `write_files` / `delete_files` (or `is_admin` at global scopes) can manage anyone's files |

### Membership policy type (auto-selected)

| Storage scope | Membership policy type | Policy data |
|---------------|----------------------|-------------|
| **App-level** (`membership_type IS NULL`) | `AuthzAppMembership` | `{}` |
| **Org-level** (`membership_type = 2`) | `AuthzEntityMembership` | `{"entity_field": "owner_id", "membership_type": 2}` |
| **Entity-scoped** (`membership_type = 3+`) | `AuthzEntityMembership` | `{"entity_field": "owner_id", "membership_type": <N>}` |

The system automatically uses the correct membership policy type based on the storage module's `membership_type` value.

### What this means in practice

- **Any authenticated member** can view buckets and view/upload files (via membership SELECT + INSERT)
- **The uploader** (matched by `actor_id`) can update or delete their own files, but only while they remain a member — authorship never survives losing membership (compound member-owner UPDATE + DELETE)
- **Privileged members** (`write_files` / `delete_files` capability, or admins) can manage anyone's files; bucket management is admin-only
- **Public content** (files where `is_public = true`) is readable by any authenticated user (via AuthzPublishable SELECT)

### Full replacement semantics

**Important:** If you provide **any** explicit `policies` array (even with just one entry), **none of the defaults are applied**. Explicit policies fully replace the defaults — there is no merging. This means if you customize policies, you must include all the policies you want (including membership, publishable, and owner policies if desired).

## Typical policy combinations

### 1. Private entity files (locked down — default)

The default when `policies` is omitted. Members can view and upload, but only the creator can modify or delete.

```json
{
  "has_storage": true
}
```

**Use case:** Internal team documents, project files, private org resources.

**Equivalent to the full default policy matrix** above. If you need slightly different behavior, provide explicit policies.

### 1b. Private entity files (full CRUD for all members)

All entity members get full CRUD — anyone can delete anyone's files. Less secure but simpler for collaborative use cases.

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

**Use case:** Shared workspaces where file ownership doesn't matter.

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



### 3. Owner-only private documents

Only the file owner (the user who uploaded it) can update/delete their files. Other entity members have read-only access.

```json
{
  "has_storage": true,
  "storage_config": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select"] },
      { "$type": "AuthzMemberOwner", "privileges": ["update", "delete"], "tables": ["files"],
        "data": { "owner_field": "actor_id", "entity_field": "owner_id", "entity_type": "data_room" } }
    ]
  }
}
```

**Use case:** Personal documents, private uploads in a shared workspace, compliance/diligence files that are per-user.

**Note:** the owner policy is scoped to `["files"]` because it uses the `actor_id` column, which only exists on the files table. It is `AuthzMemberOwner`, not `AuthzDirectOwner`, so an uploader who leaves the entity loses access to their files.

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
      { "$type": "AuthzMemberOwner", "privileges": ["update", "delete"], "tables": ["files"],
        "data": { "owner_field": "actor_id", "entity_field": "owner_id", "entity_type": "data_room" } }
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
| `AuthzMemberOwner` / `AuthzAppMemberOwner` | Only the uploader can access, and only while a member (entity-scoped / app-level storage) | `actor_id` + `owner_id` (files) | `["files"]` |
| `AuthzDirectOwner` | **Avoid on storage tables** — bare ownership survives membership removal; use the member-owner types above | `actor_id` | — |
| `AuthzPublishable` | Published files are publicly readable (SELECT only) | `is_public` | `["buckets", "files"]` |
| `AuthzAppMembership` | App-level membership gate (hardcoded type=1) | — | All three |
| `AuthzAllowAll` | No restrictions (use sparingly) | — | All three |
| `AuthzDenyAll` | Explicit `FALSE`; does not override another passing permissive policy | — | All three |

See the [`constructive-security`](../../constructive-security/SKILL.md) skill for all 25 registry Authz nodes and the separately platform-applied `AuthzHumanOnly` guard. `AuthzColumnSecurity` is registry-selectable but generates a column write guard rather than a stored storage RLS policy.

## Cross-references

- **Constructive Authz protocol (Authz* types):** [`constructive-security`](../../constructive-security/SKILL.md)
- **Custom entities & provisioning:** [`constructive-entities`](../../constructive-entities/SKILL.md)
- **Blueprint definition format:** [blueprint-definition-format.md](../../constructive-blueprints/references/blueprint-definition-format.md)
- **Upload flow (GraphQL mutations, client library):** [`constructive-storage`](../../constructive-storage/SKILL.md)
- **Multi-scope bucket resolution:** `multi-scope-bucket-resolution` skill in `constructive-db`
- **SQL-level security details:** `constructive-db-security-sql` skill in `constructive-db`
