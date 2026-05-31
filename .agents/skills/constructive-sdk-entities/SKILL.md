---
name: constructive-sdk-entities
description: "Custom entity types and dynamic entity provisioning — how to create custom entities (channels, departments, teams, data rooms) with per-entity storage, permissions, memberships, invites, agent modules, namespace modules, function modules, and graph modules via the ORM, CLI, or blueprint definitions. Covers the entity hierarchy, permissions per entity type, entity-scoped storage (buckets + file uploads), agent_module (threads, messages, tasks, prompts, knowledge with AuthzMemberOwner), namespace_module (namespace_events partitioned K8s metrics log), function_module (definitions, invocations, execution_logs), graph_module (FBP graph permissions with merkle_store_module), invite system, and the provisioning lifecycle. Use when asked to 'create entity types', 'add channels/teams/data rooms', 'provision entity storage', 'entity-scoped buckets', 'agent_module', 'agents config', 'namespace_events', 'namespace_module', 'function_module', 'entity functions', 'graph_module', 'entity graphs', 'invite users', 'profile assignment', or when working with entity_types in blueprints."
metadata:
  author: constructive-io
  version: "2.2.0"
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

Each entry either **creates** a new entity type (has `name` + `prefix`) or **extends** an existing one (only `prefix`, no `name`). Extend entries add capabilities like storage to built-in types (e.g., `"org"`) without creating new entity types.

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
- `permissions_module` (scope: channel)
- `memberships_module` (scope: channel)
- `limits_module` (scope: channel, if `has_limits`)
- `invites_module` (scope: channel, if `has_invites`, or auto-provisioned when `emails_module` exists)
- `storage_module` (scope: channel, if `has_storage`)

### Optional Modules
- `profiles_module` (scope: channel, if `has_profiles`) — Named permission roles
- `events_module` (scope: channel, if `has_levels`) — Event tracking, achievements, gamification. See [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md)
- `agent_module` (scope: channel, if `agents` config provided) — AI agent tables (threads, messages, tasks, plans, prompts, knowledge)
- `namespace_module` (scope: channel, if `namespaces` config provided) — K8s-style namespace containers + partitioned event log

---

## Entity-Scoped Agent Module

When the `agents` field is provided in entity_type_provision, the system creates AI agent tables for that entity:

### Tables Created
- `{prefix}_agent_thread` — Conversation threads with `tags citext[]` for organizing (AuthzMemberOwner — private to owner within entity)
- `{prefix}_agent_message` — Chat messages in threads (AuthzMemberOwner)
- `{prefix}_agent_plan` — Workflow plans with ordered tasks and approval gates (AuthzMemberOwner, optional via `has_plans`)
- `{prefix}_agent_task` — Task tracking (AuthzMemberOwner) — belongs to plan when `has_plans`, otherwise to thread
- `{prefix}_agent_prompt` — Shared prompt templates (AuthzEntityMembership — shared within entity)
- `{prefix}_agent_resource` — Unified skills + knowledge base (AuthzEntityMembership, optional via `has_resources`). Has `kind = 'skill' | 'knowledge' | 'convention'` column, searchable and embeddable.
- `{prefix}_agent` — Agent registry (AuthzEntityMembership, optional via `has_agents`)
- `{prefix}_agent_persona` — Agent persona templates (AuthzEntityMembership, optional via `has_agents`)

### Blueprint: Entity with Agent Module

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "agents": [{
        "has_plans": true,
        "has_resources": true,
        "has_agents": true,
        "resources": [{ "dimensions": 1536, "chunk_size": 500, "chunk_strategy": "sentence" }]
      }]
    }
  ]
}
```

This produces: `data_room_agent_thread`, `data_room_agent_message`, `data_room_agent_plan`, `data_room_agent_task`, `data_room_agent_prompt`, `data_room_agent_resource`, `data_room_agent`, `data_room_agent_persona`.

### Feature Flags

| Flag | Default | Description |
|------|---------|-------------|
| `has_plans` | `false` | Provision an `agent_plan` table for workflow plans with approval gates |
| `has_resources` | `false` | Provision a unified `agent_resource` table (skills + knowledge + conventions) with auto-chunking (ProcessChunks) and vector embeddings |
| `has_agents` | `false` | Provision `agent` + `agent_persona` tables for agent registry and templates. Implies `has_resources`. |

### Security Model
- **Private tables** (thread, message, task, plan): `AuthzMemberOwner` — actor must own the row AND be a member of the entity
- **Shared tables** (prompt, resource, agent, persona): `AuthzEntityMembership` — any entity member can read/write

### Resources (opt-in via `has_resources`)
When `has_resources: true`, a unified `agent_resource` table is created with:
- `kind` column: `'skill' | 'knowledge' | 'convention'`
- `slug` for portable human-readable identifiers
- Full-text search (tsvector on title, description, body)
- Vector embedding (pgvector HNSW) for semantic search
- Auto-chunking via ProcessChunks (configurable via `resources` array)
- `DataArchivable` for user-reversible archiving

The `resources` configuration array accepts:
```json
[{ "dimensions": 768, "chunk_size": 1000, "chunk_overlap": 200, "chunk_strategy": "paragraph" }]
```

### Config Table
The `agent_module` config table tracks:
- `thread_table_name`, `message_table_name`, `task_table_name`, `prompts_table_name`, `plan_table_name`, `agent_table_name`, `persona_table_name`, `resource_table_name`
- `has_plans boolean` — whether plan table + approval workflow are provisioned
- `has_resources boolean` — whether unified resource table is provisioned
- `has_agents boolean` — whether agent + persona tables are provisioned
- `resources jsonb` — resource configuration (dimensions, chunk_size, etc.)
- `api_name` — GraphQL API to expose tables on (default: `'agent'`)

### Prefix Composition (PR #1332)

Table names use explicit prefix-based composition (replaces brittle regex):

| Scope | Prefix | Thread table |
|-------|--------|--------------|
| App-level (no entity) | — | `agent_thread` |
| Entity-scoped (default) | `data_room` | `data_room_agent_thread` |
| Entity-scoped (custom key) | `data_room` + key `support` | `data_room_support_agent_thread` |

---

## Entity-Scoped Namespace Module

When `namespaces` config is provided in entity_type_provision (or via blueprint `entity_types[].namespaces`), the system creates K8s-style namespace containers with a partitioned event log for lifecycle tracking and resource metrics.

### Tables Created
- `{prefix}_namespaces` — Logical namespace containers (name, labels jsonb, annotations jsonb, is_active)
- `{prefix}_namespace_events` — Monthly-partitioned audit log of namespace events + K8s resource metrics

### Blueprint: Entity with Namespace Module

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "namespaces": true
    }
  ]
}
```

This produces: `data_room_namespaces` (with computed `namespace_name` via inflection), `data_room_namespace_events` (partitioned).

### `namespace_events` Event Types

`created` | `activated` | `deactivated` | `labels_updated` | `annotations_updated` | `renamed` | `deleted` | `metrics_snapshot` | `scaled` | `quota_exceeded` | `resource_warning`

### K8s Resource Metrics Columns (nullable — only present on metric events)

| Column | Type | Description |
|--------|------|-------------|
| `cpu_millicores` | integer | CPU usage in millicores |
| `memory_bytes` | bigint | Memory usage in bytes |
| `storage_bytes` | bigint | Storage usage in bytes |
| `network_ingress_bytes` | bigint | Network ingress in bytes |
| `network_egress_bytes` | bigint | Network egress in bytes |
| `pod_count` | integer | Number of active pods |
| `metrics` | jsonb | Additional metrics (gpu, replicas, quotas) |

### Partition Config
- **Strategy:** Range on `created_at`
- **Interval:** 1 month
- **Retention:** 12 months (detach, keep table)
- **Premake:** 2 months ahead

### Security
Uses `apply_module_security` with `manage_namespaces` permission. Namespace INSERT triggers a `namespace:provision` job for cloud integration.

---

## Entity-Scoped Function Module

The `functions[]` JSON array provisions `function_module` instances per entity type, creating serverless function management tables scoped to entity membership.

### Blueprint

```json
{
  "entity_types": [{
    "name": "Data Room",
    "prefix": "data_room",
    "functions": [{}]
  }]
}
```

Each element recognizes:
- `key` (text) — module discriminator (default: `'default'`)
- `policies` (jsonb[]) — RLS policy overrides (default: `apply_function_security()`)

### Tables Created

| Table | Description |
|-------|-------------|
| `{prefix}_function_definitions` | Function definitions (name, runtime, handler, config) |
| `{prefix}_function_invocations` | Invocation records with input/output payloads |
| `{prefix}_function_execution_logs` | Execution logs with timing, errors, and metadata |

### Permissions Registered
- `manage_functions` — create/update/delete function definitions
- `invoke_functions` — execute functions and view invocation results

Function INSERTs dispatch a `function:provision` job via the job trigger system. Depends on `config_secrets_module` for `resolve_function_secrets`.

---

## Entity-Scoped Graph Module

The `graphs[]` JSON array registers graph (FBP) permissions per entity type. Graph module depends on `merkle_store_module` for content-addressed storage of graph definitions.

### Blueprint

```json
{
  "entity_types": [{
    "name": "Data Room",
    "prefix": "data_room",
    "graphs": [{}]
  }]
}
```

Each element recognizes:
- `key` (text) — module discriminator (default: `'default'`)
- `policies` (jsonb[]) — RLS policy overrides (default: `apply_graph_security()`)

### What Gets Provisioned

Entity-scoped `graphs[]` **registers permission bits only** — the graph module tables (objects, stores, commits, refs) are provisioned separately via `graph_module` in the database modules array, which requires a resolved `merkle_store_module_id` dependency.

### Permissions Registered
- `manage_graphs` — create/update/delete graph definitions
- `execute_graphs` — run graph evaluations

The `graph_module` is auto-provisioned with a `merkle_store_module` prefix of `'graph'` when `graph_module` appears in the database modules list.

---

## Entity-Scoped Storage (Buckets & File Uploads)

When `has_storage: true`, the system provisions one or more `storage_module` entries for the entity type. This creates dedicated buckets and files tables with RLS policies scoped to entity membership.

### Blueprint: Entity with Storage

The `storage` field is a **JSON array** of storage module definitions (object form is no longer supported):

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "has_storage": true,
      "storage": [
        {
          "has_path_shares": true,
          "provisions": {
            "files": {
              "policies": [
                { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
                { "$type": "AuthzPublishable", "privileges": ["select"] }
              ]
            },
            "buckets": {
              "policies": [
                { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] }
              ]
            }
          },
          "buckets": [{ "name": "documents" }, { "name": "public-assets", "is_public": true }]
        }
      ]
    }
  ]
}
```

This creates `data_room_buckets` and `data_room_files` tables, secured with the specified RLS policies.

### Multi-module entity storage

An entity type can have multiple storage modules with different feature flags:

```json
{
  "has_storage": true,
  "storage": [
    { "has_path_shares": true, "has_confirm_upload": true, "buckets": [{ "name": "documents" }] },
    { "storage_key": "fn", "has_custom_keys": true, "has_confirm_upload": false, "buckets": [{ "name": "functions" }] }
  ]
}
```

This creates two table pairs: `data_room_buckets`/`data_room_files` (default) and `data_room_fn_buckets`/`data_room_fn_files` (functions). Each gets its own RLS, GraphQL mutations (`uploadDataRoomFile`, `uploadDataRoomFnFile`), and feature flags.

The `storage_key` must be max 16 chars, lowercase snake_case, and cannot be reserved words.

See [storage-config.md](./references/storage-config.md) for ORM provisioning examples, bucket creation, upload flow, `storage[]` entry field reference, and default policy matrix. For feature flag details (versioning, audit log, path shares, custom keys, confirm upload, GC), see [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md).

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
