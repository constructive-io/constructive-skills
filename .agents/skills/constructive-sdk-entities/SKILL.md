---
name: constructive-sdk-entities
description: "Custom entity types and dynamic entity provisioning — how to create custom entities (channels, departments, teams, data rooms) with per-entity storage, permissions, memberships, and invites via the ORM, CLI, or blueprint definitions. Covers the entity hierarchy, permissions per entity type, entity-scoped storage (buckets + file uploads), invite system (email/blank/multiple types, profile assignment, email auto-verification), and the provisioning lifecycle. Use when asked to 'create entity types', 'add channels/teams/data rooms', 'provision entity storage', 'entity-scoped buckets', 'invite users', 'profile assignment', 'assign roles on invite', 'invite error codes', or when working with entity_types in blueprints."
metadata:
  author: constructive-io
  version: "2.1.0"
---

# Custom Entities & Dynamic Entity Provisioning

Constructive has a hierarchical entity type system. Every scope of membership — app, org, channel, department, team, data room — is a **membership type** with its own entity table, permissions, memberships, and security policies.

Types 1 (app) and 2 (org) are built-in. Types 3+ are **dynamic** — you define them at runtime via the ORM, CLI, or blueprint definitions.

Related skills:
- **Invites & profile assignment:** [invites.md](./references/invites.md) — invite types, claim flow, profile assignment, permission model, error codes
- **File uploads:** [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) — the full presigned URL upload flow, GraphQL mutations, client library, error codes
- **Blueprints:** `constructive-platform` → [blueprints.md](../constructive-platform/references/blueprints.md) — how `constructBlueprint()` works
- **Blueprint definition format:** `constructive-platform` → [blueprint-definition-format.md](../constructive-platform/references/blueprint-definition-format.md) — table/relation/policy JSONB spec
- **Safegres (security):** `constructive-safegres` — Authz* policy types for RLS
- **SQL-level provisioning:** `entity-types-and-provisioning` skill in `constructive-db`

---

## Core Concepts

### Entity Type Hierarchy

| Type ID | Name | Prefix | Entity Table | Created By |
|---------|------|--------|-------------|------------|
| 1 | App Member | `app` | `users` | Built-in |
| 2 | Organization Member | `org` | `users` (scoped) | Built-in |
| 3+ | Dynamic | varies | auto-created | You provision these |

Every entity type gets:
- An **entity table** (e.g. `channels`, `departments`)
- A **permissions module** with granular per-member permissions
- A **memberships module** for tracking who belongs to what
- **RLS security policies** on all tables
- Optional modules: limits, profiles, levels, invites, **storage**

### Permission Model

Each level has a standard set of permissions. The `create_entity` permission means **"create the next level down"**:

| Level | `create_entity` description | What it creates |
|-------|---------------------------|-----------------|
| App (type=1) | "Create organization entities." | Organizations |
| Org (type=2) | "Create child entities." | Channels, departments, etc. |
| Dynamic (type>=3) | "Create sub-entities." | Nested entity types |

Other standard permissions: `admin_members`, `create_invites`, `admin_invites`, `admin_limits`, `admin_permissions`, `admin_entity`.

### Parent-Child Relationships

Every dynamic entity type has a **parent type**. The parent defaults to `org` (type=2), but can be any previously-provisioned type:

```
app (1)
  └── org (2)
        ├── channel (3)    ← parent_entity = 'org'
        ├── department (4) ← parent_entity = 'org'
        │     └── team (5) ← parent_entity = 'department'
        └── data_room (6)  ← parent_entity = 'org', has_storage = true
```

Nested types must be provisioned **after** their parent type.

---

## Three Ways to Provision Entity Types

### 1. Blueprint Definition (Recommended)

Add `entity_types` to the blueprint `definition` JSONB. These are processed in **Phase 0** — before tables and relations — so blueprint tables can reference the entity tables they create.

See [blueprint-entity-types.md](./references/blueprint-entity-types.md) for the full spec and examples.

### 2. ORM / GraphQL Mutation

Use the `entityTypeProvision` table for direct provisioning outside of blueprints.

See [orm-provisioning.md](./references/orm-provisioning.md) for ORM examples.

### 3. CLI

```bash
# Direct entity type provision (inserts into entity_type_provision trigger table)
constructive public:entity-type-provision create \
  --databaseId <UUID> \
  --name "Channel Member" \
  --prefix "channel" \
  --description "Membership to a channel." \
  --parentEntity "org" \
  --isVisible true \
  --hasLimits false \
  --hasProfiles false \
  --hasLevels false \
  --skipEntityPolicies false
```

---

## What Gets Created

When you provision a new entity type (e.g. prefix=`channel`), the system creates:

### Tables
- `channels` — Entity table (with `id`, `name`, `owner_id`, `created_at`, `updated_at`)
- `channel_permissions` — Per-member permission grants
- `channel_permission_defaults` — Default permission values
- `channel_limits` — Rate limits per member (if `has_limits`)
- `channel_limit_defaults` — Default limit values (if `has_limits`)
- `channel_members` — Member list (user_id + entity_id)
- `channel_memberships` — Membership state (active, suspended, etc.)
- `channel_membership_defaults` — Default membership values
- `channel_grants` / `channel_admin_grants` / `channel_owner_grants` — Computed grants
- `channel_acl` — Access control list

### Storage Tables (if `has_storage`)
- `channel_buckets` — Bucket configuration (key, type, is_public, allowed_mime_types, max_file_size)
- `channel_files` — File records (key, mime_type, size, filename, is_public, owner_id)

### Modules Registered
- `permissions_module:channel`
- `memberships_module:channel`
- `limits_module:channel` (if `has_limits`)
- `invites_module:channel` (if `has_invites`, or auto-provisioned when `emails_module` exists)
- `storage_module:channel` (if `has_storage`)

### Optional Modules
- `profiles_module:channel` (if `has_profiles`) — Named permission roles
- `levels_module:channel` (if `has_levels`) — Gamification/achievements

---

## Entity-Scoped Storage (Buckets & File Uploads)

When `has_storage: true`, the system provisions a `storage_module` for the entity type. This creates dedicated buckets and files tables with RLS policies scoped to entity membership.

### Blueprint: Entity with Storage

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
          { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
          { "$type": "AuthzPublishable", "privileges": ["select"], "tables": ["buckets", "files"] }
        ]
      }
    }
  ]
}
```

This creates `data_room_buckets` and `data_room_files` tables, secured with the specified RLS policies. The `"tables"` key uses **logical names** (`"buckets"`, `"files"`), not the prefixed physical table names — the function resolves the prefix internally.

### ORM: Entity with Storage

```typescript
const result = await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room',
    prefix: 'data_room',
    parentEntity: 'org',
    hasStorage: true,
    storageConfig: {
      policies: [
        { $type: 'AuthzEntityMembership', privileges: ['select', 'insert', 'update', 'delete'] },
        { $type: 'AuthzPublishable', privileges: ['select'], tables: ['buckets', 'files'] },
      ],
    },
  },
  select: {
    outMembershipType: true,
    outEntityTableId: true,
    outInstalledModules: true,
  },
}).execute();
// outInstalledModules includes 'storage_module:data_room'
```

### Creating Buckets for an Entity

After provisioning the entity type with storage, create bucket rows for each entity instance:

```typescript
// Create a 'documents' bucket for a specific data room
await db.dataRoomBucket.create({
  data: {
    key: 'documents',
    type: 'private',
    isPublic: false,
    ownerId: dataRoomId,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
    maxFileSize: 10485760,  // 10MB
  },
}).execute();
```

Or via the `provisionBucket` GraphQL mutation:

```graphql
mutation {
  provisionBucket(input: {
    bucketKey: "documents"
    ownerId: "data-room-uuid"
  }) {
    success
    bucketName
    accessType
  }
}
```

### Uploading to Entity-Scoped Buckets

Pass `ownerId` in the `requestUploadUrl` mutation to target the entity's storage:

```typescript
const { data } = await graphqlClient.mutate({
  mutation: REQUEST_UPLOAD_URL,
  variables: {
    input: {
      bucketKey: 'documents',
      ownerId: dataRoomId,     // entity instance UUID
      contentHash,
      contentType: 'application/pdf',
      size: file.size,
      filename: 'contract.pdf',
    },
  },
});
```

The plugin resolves the correct storage module by probing entity tables for the `ownerId`, then uses that module's file tables. See [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) for the complete upload flow, deduplication, error codes, and client library.

### `storage_config` Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `is_public` | boolean | `false` | S3 bucket ACL — `true` = publicly readable, `false` = presigned URLs required |
| `provisions` | object | `null` | Per-table overrides keyed by `"files"` or `"buckets"`. Each value: `{ nodes, fields, grants, use_rls, policies }`. Fanned out to `secure_table_provision`. When a key includes `policies[]`, those REPLACE the default storage policies for that table |

Each policy object (inside `provisions.{table}.policies`) has `$type` (required), `privileges` (required), plus optional `data` and `policy_name`. Missing `data` is auto-populated with storage-specific defaults (e.g., `AuthzPublishable` → `{"is_published_field": "is_public", "require_published_at": false}`).

### Default Storage Policies

When `provisions` is omitted (or a table key has no `policies`), the system applies **sensible locked-down defaults**: membership gets `select` + `insert`, `AuthzDirectOwner` on `actor_id` gates `update` + `delete`, and `AuthzPublishable` on `is_public` gates public `select`. See [storage-policies.md](../constructive-platform/references/storage-policies.md) for the full default policy matrix.

When a table key includes `policies[]`, defaults are skipped **for that table only** — other tables without a `policies` key still get defaults. It's per-table replacement, not all-or-nothing.

### Typical Policy Combinations

| Combination | Use case |
|-------------|----------|
| *(omit provisions entirely)* | Locked-down default: members view/upload, only creator can update/delete |
| `provisions.files.policies: [{ "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] }]` | Full CRUD for all members on files (buckets still get defaults) |
| Per-table explicit policies on both keys | Full custom: you control exactly what each storage table gets |
| `provisions.files.nodes: [{ "$type": "SearchBm25", ... }]` (no policies key) | Add search to files, keep default policies |

---

## Querying Membership Types

### List all types

```typescript
const types = await db.membershipType.findMany({
  select: {
    id: true,
    name: true,
    prefix: true,
    description: true,
    parentMembershipType: true,
    hasLimits: true,
    hasProfiles: true,
    hasLevels: true,
  }
}).execute();
// Returns: [{ id: 1, name: 'App Member', prefix: 'app', ... }, ...]
```

### Find a specific type by prefix

```typescript
const channelType = await db.membershipType.findMany({
  where: { prefix: { equalTo: 'channel' } },
  select: { id: true, name: true }
}).execute();
```

### CLI

```bash
constructive public:membership-type list --select id,name,prefix,parentMembershipType
constructive public:membership-type find --where.prefix channel --select id,name
```

---

## Querying Membership Types Module

The `membershipTypesModule` tracks which databases have the membership types infrastructure installed:

```typescript
const modules = await db.membershipTypesModule.findMany({
  where: { databaseId: { equalTo: dbId } },
  select: { id: true, tableName: true }
}).execute();
```

---

## Cross-References

- **Invites (full reference):** [invites.md](./references/invites.md) — invite types, claim flow, profile assignment, permission model, error codes
- **File uploads (full reference):** [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) — presigned URL flow, GraphQL mutations, client library, error codes
- **Blueprint definition format:** [blueprint-definition-format.md](../constructive-platform/references/blueprint-definition-format.md) — `entity_types` is a top-level key alongside `storage`, `tables`, `relations`, etc.
- **ORM provisioning examples:** [orm-provisioning.md](./references/orm-provisioning.md)
- **Blueprint entity_types spec:** [blueprint-entity-types.md](./references/blueprint-entity-types.md)
- **SQL-level detail:** `entity-types-and-provisioning` skill in `constructive-db` repo
