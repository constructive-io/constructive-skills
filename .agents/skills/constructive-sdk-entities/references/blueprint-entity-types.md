# Blueprint Entity Types (Phase 0)

The `entity_types` array is a top-level key in the blueprint definition JSONB, alongside `storage`, `tables`, `relations`, `indexes`, etc. Entries are processed in **Phase 0** of `constructBlueprint()` — before tables and relations — so blueprint tables can reference the entity tables they create.

Each entry either **creates** a new entity type or **extends** an existing one:

- **Create** (has `name` + `prefix`): provisions a full entity table with membership modules, permissions, and security policies via `entity_type_provision`.
- **Extend** (only `prefix`, no `name`): looks up an existing entity type by prefix (e.g., `"org"`) and adds capabilities like storage — without creating a new entity type.

## Definition Shape

**Create** — new entity type:
```json
{
  "entity_types": [
    {
      "name": "Channel Member",
      "prefix": "channel",
      "description": "Membership to a channel.",
      "parent_entity": "org",
      "table_name": null,
      "is_visible": true,
      "has_limits": false,
      "has_profiles": false,
      "has_levels": false,
      "has_invites": false,
      "has_invite_achievements": false,
      "skip_entity_policies": false,
      "table_provision": null
    }
  ],
  "tables": [ ... ],
  "relations": [ ... ]
}
```

**Extend** — add storage to existing org:
```json
{
  "entity_types": [
    {
      "prefix": "org",
      "storage": [
        { "buckets": [{"name": "documents"}, {"name": "media", "is_public": true}] }
      ]
    }
  ],
  "tables": [ ... ]
}
```

When extending, the entry only needs `prefix` and the capabilities to add (e.g. `storage`). The extend path resolves the entity type from `memberships_module`, so it works for built-in types like `org` (membership_type=2) that aren't in `entity_type_provision`.

> **Two paths for org storage:** You can also use top-level `storage[{ scope: "org" }]` (Phase 0.5) — both produce the same result, similar to how constraints/indexes have inline and top-level paths.

## Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | No | — | Human-readable name (e.g. `"Channel Member"`). **Required** for creating new entity types. **Omit** to extend an existing type |
| `prefix` | string | **Yes** | — | SQL prefix for generated objects (e.g. `"channel"` → `channels` table). For extend entries, must match an existing entity type prefix (e.g. `"org"`) |
| `description` | string | No | `null` | Optional description of the entity type |
| `parent_entity` | string | No | `"org"` | Parent type prefix. Must be an already-provisioned type |
| `table_name` | string | No | `prefix + 's'` | Override entity table name (e.g. `"rooms"` instead of default `"channels"`) |
| `is_visible` | boolean | No | `true` | Gates the default `parent_member` SELECT policy. **No-op when `table_provision` is supplied.** See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |
| `has_limits` | boolean | No | `false` | Provision a `limits_module` for this type |
| `has_profiles` | boolean | No | `false` | Provision a `profiles_module` for named permission roles |
| `has_levels` | boolean | No | `false` | Provision a `levels_module` for gamification |
| `has_storage` | boolean | No | `false` | Provision a `storage_module` with buckets and files tables |
| `has_invites` | boolean | No | `false` | Provision entity-scoped invite tables (`{prefix}_invites`, `{prefix}_claimed_invites`) and a `submit_{prefix}_invite_code()` function |
| `has_invite_achievements` | boolean | No | `false` | Auto-attach an EventTracker to `claimed_invites` for invite-based achievements + wire the invitee achievement virality trigger. Requires `has_invites=true` AND `has_levels=true`. See [`constructive-sdk-events`](../../constructive-sdk-events/SKILL.md). |
| `storage_config` | object | No | `null` | Storage configuration when `has_storage` is true. See [Storage Config](#storage-config-has_storage-storage_config) |
| `skip_entity_policies` | boolean | No | `false` | Escape hatch: apply zero policies on the entity table. See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |
| `table_provision` | object | No | `null` | Override object for the entity table (nodes, fields, grants, policies). When supplied, `policies[]` **replaces** the five default entity-table policies. See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |
| `agents` | jsonb array | No | `null` | Agent module config. Provisions `agent_module` tables (thread, message, task, prompt, plan, knowledge). See [Agents Config](#agents-config) |
| `namespaces` | jsonb | No | `null` | Namespace module config. Provisions `namespace_module` tables (namespaces + namespace_events partitioned log). See [Namespaces Config](#namespaces-config) |
| `functions` | jsonb | No | `null` | Function module config. Provisions `function_module` tables (functions, invocations) |

## Storage Config (`has_storage`, `storage_config`)

When `has_storage: true`, the system provisions a `storage_module` for the entity type, creating `{prefix}_buckets` and `{prefix}_files` tables with RLS security policies.

The optional `storage_config` object controls bucket behavior:

```json
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
```

### `storage_config` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `is_public` | boolean | No | `false` | S3 bucket ACL — `true` = publicly readable URLs, `false` = presigned URLs required |
| `provisions` | object | No | `null` | Per-table overrides keyed by `"files"` or `"buckets"`. Each value uses the same shape as `table_provision`: `{ nodes, fields, grants, use_rls, policies }`. Fanned out to `secure_table_provision`. When a key includes `policies[]`, those REPLACE the default storage policies for that table; tables without a key still get defaults |
| `upload_url_expiry_seconds` | integer | No | *(module default)* | Override for presigned upload URL expiry time in seconds |
| `download_url_expiry_seconds` | integer | No | *(module default)* | Override for presigned download URL expiry time in seconds |
| `default_max_file_size` | bigint | No | *(module default)* | Default maximum file size in bytes |
| `allowed_origins` | text[] | No | *(module default)* | CORS allowed origins |

### Policy format (inside `provisions.{table}.policies`)

Each entry in a table's `policies` array is a policy object:

```json
{
  "$type": "AuthzEntityMembership",
  "privileges": ["select", "insert", "update", "delete"],
  "data": { "entity_field": "owner_id", "membership_type": 5 }
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `$type` | string | **Yes** | — | Authz* node type name |
| `privileges` | string[] | **Yes** | — | Privileges to apply |
| `data` | object | No | *(auto-derived)* | Policy data. When omitted, auto-populated with storage-specific defaults based on `$type` and membership_type |
| `policy_name` | string | No | *(auto-derived)* | Custom suffix for the generated policy name |

### Typical provisions combinations

```json
// Custom policies on files only — buckets get defaults
"provisions": {
  "files": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzPublishable", "privileges": ["select"] }
    ]
  }
}

// Full custom on both tables
"provisions": {
  "files": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] },
      { "$type": "AuthzDirectOwner", "privileges": ["update", "delete"] }
    ]
  },
  "buckets": {
    "policies": [
      { "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] }
    ]
  },
}

// Add search to files without overriding default policies
"provisions": {
  "files": {
    "nodes": [{ "$type": "SearchBm25", "data": { "language": "english" } }]
  }
}
```

**Important:** `AuthzPublishable` requires an `is_public` column and `AuthzDirectOwner` requires an `actor_id` column — scope them to tables that have these columns (buckets and files have both).

### Defaults (when `provisions` is omitted)

When `provisions` is absent (or a table key has no `policies`), these defaults are applied automatically:
- `AuthzPublishable` → buckets (SELECT), files (SELECT, INSERT)
- Membership policy → buckets/files (full CRUD)
- `AuthzDirectOwner` → files (UPDATE, DELETE)

When a table key **does** include `policies[]`, defaults are skipped **for that table only** — other tables still get defaults. It's per-table replacement, not all-or-nothing.

See [storage-policies.md](../../constructive-platform/references/storage-policies.md) for the full reference including the provisioning pipeline and all available policy types.

## Agents Config

The `agents` field provisions an `agent_module` for the entity type — creating AI agent infrastructure tables scoped to each entity instance.

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "agents": [{ "has_plans": true, "has_knowledge": true }]
    }
  ]
}
```

### `agents[]` entry fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `has_plans` | boolean | `false` | Provision an `agent_plan` table for workflow plans with ordered tasks and approval gates. When true, tasks belong to plans (`plan_id NOT NULL`) instead of directly to threads. Hierarchy: thread → plan → task |
| `has_knowledge` | boolean | `false` | Provision a shared knowledge base table with auto-chunked child table (pgvector HNSW index for semantic retrieval) |
| `api_name` | string | `'agent'` | GraphQL API target to expose agent tables on |

### Tables created

With prefix `data_room`, `has_plans: true`, and `has_knowledge: true`:

| Table | Security | Description |
|-------|----------|-------------|
| `data_room_agent_thread` | `AuthzMemberOwner` | Conversation threads — private to owner within entity |
| `data_room_agent_message` | `AuthzMemberOwner` | Chat messages in threads (multi-modal `parts` jsonb) |
| `data_room_agent_plan` | `AuthzMemberOwner` | Workflow plans — ordered task lists with status lifecycle (draft → active → completed/failed/cancelled) |
| `data_room_agent_task` | `AuthzMemberOwner` | Task tracking — belongs to plan when `has_plans`, otherwise to thread |
| `data_room_agent_prompt` | `AuthzEntityMembership` | Shared prompt templates — any entity member |
| `data_room_agent_knowledge` | `AuthzEntityMembership` | Shared knowledge base (chunked for RAG) |
| `data_room_agent_knowledge_chunks` | *(inherited)* | Auto-generated chunks with vector embeddings |

### Plan table fields (when `has_plans: true`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key (DataId) |
| `owner_id` | uuid NOT NULL | DataDirectOwner, FK → users. Inherited from thread via DataInheritFromParent |
| `thread_id` | uuid NOT NULL | FK → agent_thread (CASCADE delete) |
| `entity_id` | uuid | Entity scope (DataInheritFromParent from thread, if entity-scoped) |
| `title` | text NOT NULL | Plan name |
| `description` | text | Optional longer context / goal |
| `status` | text NOT NULL DEFAULT 'draft' | Lifecycle: draft → active → completed / failed / cancelled |
| `created_at` / `updated_at` | timestamptz | DataTimestamps |

### Task approval fields (when `has_plans: true`)

When `has_plans` is enabled, `agent_task` gets `plan_id NOT NULL` (replacing `thread_id`) plus these approval fields:

| Field | Type | Description |
|-------|------|-------------|
| `plan_id` | uuid NOT NULL | FK → agent_plan (CASCADE delete) |
| `order_index` | integer | Position within the plan |
| `requires_approval` | boolean NOT NULL DEFAULT false | Marks this task as an approval gate |
| `approval_status` | text | `pending` / `approved` / `rejected` (NULL if not an approval task) |
| `approved_by` | uuid | FK → users — who approved/rejected |
| `approved_at` | timestamptz | When the decision was made |
| `approval_feedback` | text | Reviewer's feedback |

### Prefix composition rules (PR #1332)

The module uses explicit prefix-based composition (not regex):

| Scope | Prefix | Thread table |
|-------|--------|--------------|
| App-level (no entity) | — | `agent_thread` |
| Entity-scoped (default) | `data_room` | `data_room_agent_thread` |
| Entity-scoped (custom key) | `data_room` + key `support` | `data_room_support_agent_thread` |

### Security model

- **Private tables** (thread, message, task, plan): `AuthzMemberOwner` — actor must own the row AND be a member of the entity (via SPRT)
- **Shared tables** (prompt, knowledge): `AuthzEntityMembership` — any entity member can read/write
- **App-level fallback** (no entity_table_id): uses `AuthzDirectOwner` for private tables, `AuthzAppMembership` for shared tables
- **RLS inheritance** (when `has_plans`): `owner_id` + `entity_id` cascade via DataInheritFromParent: thread → plan → task

### Composing storage + agents on the same entity

An entity type can have both `has_storage` + `storage` AND `agents` simultaneously (PR #1335):

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "data_room",
      "parent_entity": "org",
      "has_storage": true,
      "storage": [{ "buckets": [{ "name": "documents" }] }],
      "agents": [{ "has_plans": true, "has_knowledge": true }]
    }
  ]
}
```

This provisions both `storage_module` and `agent_module` for the entity type. The `construct_blueprint` function forwards `agents`, `namespaces`, and `functions` configs to `entity_type_provision`.

## Namespaces Config

The `namespaces` field provisions a `namespace_module` for the entity type — K8s-style logical namespace containers with a partitioned event log for lifecycle and metrics tracking.

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

### Tables created

| Table | Description |
|-------|-------------|
| `{prefix}_namespaces` | Logical namespace containers with name, labels (jsonb), annotations (jsonb), is_active flag |
| `{prefix}_namespace_events` | Monthly-partitioned audit log of namespace lifecycle events + K8s resource metrics |

### `namespace_events` columns

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | uuid | yes | UUIDv7 event identifier |
| `created_at` | timestamptz | yes | Event timestamp (partition key) |
| `namespace_id` | uuid | yes | FK to namespaces table |
| `event_type` | text | yes | One of: `created`, `activated`, `deactivated`, `labels_updated`, `annotations_updated`, `renamed`, `deleted`, `metrics_snapshot`, `scaled`, `quota_exceeded`, `resource_warning` |
| `actor_id` | uuid | no | User who triggered the event (NULL for system/automated) |
| `message` | text | no | Human-readable event description |
| `metadata` | jsonb | no | Structured context (old/new values, labels diff) |
| `cpu_millicores` | integer | no | CPU usage in millicores |
| `memory_bytes` | bigint | no | Memory usage in bytes |
| `storage_bytes` | bigint | no | Storage usage in bytes |
| `network_ingress_bytes` | bigint | no | Network ingress in bytes |
| `network_egress_bytes` | bigint | no | Network egress in bytes |
| `pod_count` | integer | no | Number of active pods |
| `metrics` | jsonb | no | Additional resource metrics (gpu, replicas, quotas) |
| `owner_id` | uuid | entity-scoped | Entity FK (only for entity-scoped namespaces) |

### Partition config

- **Strategy:** Range on `created_at`
- **Interval:** 1 month
- **Retention:** 12 months (detach, keep table)
- **Premake:** 2 months ahead

### Security

Namespace tables use `apply_module_security` with `manage_namespaces` permission — entity members with that permission can read/write namespace records.

## Entity-Table Policies (`is_visible`, `skip_entity_policies`, `table_provision`)

The entity table itself (e.g. `channels`) needs RLS policies so members can see / create / update / delete their own entities. Three fields interact to decide what ends up on that table:

### Decision matrix

| `skip_entity_policies` | `table_provision` | Result on the entity table |
|---|---|---|
| `false` (default) | `null` (default) | **5 defaults** (gated by `is_visible`) |
| `false` | object | **caller's `policies[]` only**; `is_visible` is a no-op |
| `true` | `null` | **0 policies** (escape hatch — you add them later) |
| `true` | object | **caller's `policies[]` only** |

**Mental model:** "defaults **OR** your overlay, never both." The presence of `table_provision` = "I know what I'm doing, give me full control." `is_visible` only matters on the defaults path.

### The 5 default policies

When `table_provision` is `null` and `skip_entity_policies` is `false`, the following policies are applied to the entity table (via `secure_table_provision` fanout):

| Default | Privilege | Summary |
|---|---|---|
| `self_member` | `SELECT` | Members of this entity can see it |
| `parent_member` | `SELECT` | Members of the **parent** entity can see it **— only when `is_visible: true`** |
| `admin_create` | `INSERT` | Parent members with `create_entity` permission can create one |
| `admin_update` | `UPDATE` | Entity admins can update |
| `admin_delete` | `DELETE` | Entity admins can delete |

If `is_visible: false`, the `parent_member` SELECT default is omitted and sibling entities become invisible to parent members (other 4 defaults still apply).

### `table_provision` shape

`table_provision` mirrors the same vocabulary as `tables[]` entries / `secure_table_provision` — so if you already know blueprint tables, you already know this:

```json
{
  "use_rls": true,
  "nodes": [ { "$type": "DataTimestamps" } ],
  "fields": [
    { "name": "topic", "type": { "name": "text" } }
  ],
  "grants": [
    { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"]] }
  ],
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": { "entity_field": "id", "entity_type": "channel" },
      "privileges": ["select"],
      "name": "self_member"
    }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `use_rls` | boolean | No | `true` | Whether to enable RLS on the entity table |
| `nodes` | array | No | `[]` | Data behavior nodes applied to the entity table (e.g. `DataTimestamps`) |
| `fields` | array | No | `[]` | Extra columns on the entity table |
| `grants` | array | No | `[]` | Unified grant objects: `[{ "roles": [...], "privileges": [[priv, cols], ...] }]`. Enables per-role targeting |
| `policies` | array | No | `[]` | Safegres policy definitions (same `$type` discriminator as `tables[].policies[]`). When present, **fully replaces** the 5 defaults |

### When to use which

| Goal | Config |
|---|---|
| "Just give me the standard defaults" | leave all three fields at defaults |
| "Hide this entity from parent members but keep everything else" | `"is_visible": false` |
| "Add custom fields/grants on the entity table (no custom policies)" | `table_provision: { nodes, fields, grants }`. **Heads up:** because `table_provision` is the override flag, this skips the 5 default policies too. If you want custom nodes/fields **and** the default policies, also copy the 5 defaults into `table_provision.policies[]` |
| "I want a completely different policy model on this entity" | `table_provision: { policies: [...] }` with your own `policies[]` |
| "I'll add policies later myself" | `"skip_entity_policies": true` |

### Example: custom fields + custom policies

```json
{
  "name": "Data Room",
  "prefix": "data_room",
  "parent_entity": "org",
  "table_provision": {
    "nodes": [ { "$type": "DataTimestamps" } ],
    "fields": [
      { "name": "topic", "type": { "name": "text" } }
    ],
    "policies": [
      {
        "$type": "AuthzEntityMembership",
        "data": { "entity_field": "id", "entity_type": "data_room" },
        "privileges": ["select", "update", "delete"],
        "name": "self_member"
      },
      {
        "$type": "AuthzEntityMembership",
        "data": { "entity_field": "owner_id", "entity_type": "org" },
        "privileges": ["insert"],
        "name": "org_insert"
      }
    ]
  }
}
```

## TypeScript Type

The `BlueprintMembershipType` interface (from `@constructive-io/node-type-registry`) defines the shape:

```typescript
import type { BlueprintMembershipType, BlueprintDefinition } from '@constructive-io/node-type-registry';

const channelType: BlueprintMembershipType = {
  name: 'Channel Member',
  prefix: 'channel',
  description: 'Membership to a channel.',
  parent_entity: 'org',
  has_limits: false,
  has_profiles: false,
  has_levels: false,
};

const definition: BlueprintDefinition = {
  entity_types: [channelType],
  tables: [
    {
      table_name: 'messages',
      nodes: ['DataId', 'DataTimestamps'],
      fields: [
        { name: 'body', type: { name: 'text' } },
      ],
      policies: [
        {
          $type: 'AuthzEntityMembership',
          data: { entity_field: 'channel_id', entity_type: 'channel' },
          privileges: ['select', 'insert', 'update', 'delete'],
          permissive: true,
        },
      ],
    },
  ],
  relations: [
    {
      $type: 'RelationBelongsTo',
      source_table: 'messages',
      target_table: 'channels',
      field_name: 'channel_id',
      is_required: true,
    },
  ],
};
```

**Key:** Use `entity_type: 'channel'` (the prefix string) instead of a hardcoded `membership_type` integer. `constructBlueprint()` resolves the prefix to the correct `membership_type` number at construction time, since Phase 0 has already provisioned the type. This avoids fragile numeric references that depend on provisioning order.

`target_table: 'channels'` works because `entity_types` entries are processed in Phase 0 and their entity tables are added to the `table_map` before Phase 1 (tables) and Phase 2 (relations).

## Validation

The `tg_validate_blueprint_definition` trigger validates `entity_types` entries on INSERT/UPDATE of both `blueprint` and `blueprint_template`. Required keys: `name`, `prefix`. All other keys are optional.

## ORM: Create a Blueprint with Entity Types

```typescript
// 1. Create a template with entity_types
const template = await db.blueprintTemplate.create({
  data: {
    name: 'team_collaboration',
    displayName: 'Team Collaboration',
    ownerId: userId,
    visibility: 'public',
    categories: ['collaboration'],
    tags: ['channels', 'messaging'],
    definition: {
      entity_types: [
        {
          name: 'Channel Member',
          prefix: 'channel',
          description: 'Membership to a channel.',
          parent_entity: 'org',
        },
      ],
      tables: [
        {
          table_name: 'messages',
          nodes: ['DataId', 'DataTimestamps'],
          fields: [{ name: 'body', type: { name: 'text' } }],
          policies: [
            {
              $type: 'AuthzEntityMembership',
              data: { entity_field: 'channel_id', entity_type: 'channel' },
              privileges: ['select', 'insert', 'update', 'delete'],
              permissive: true,
            },
          ],
        },
      ],
      relations: [
        {
          $type: 'RelationBelongsTo',
          source_table: 'messages',
          target_table: 'channels',
          field_name: 'channel_id',
          is_required: true,
        },
      ],
    },
  },
  select: { id: true, definitionHash: true },
}).execute();

// 2. Copy to an executable blueprint
const { blueprintId } = await db.mutation.copyTemplateToBlueprint({
  input: {
    templateId: template.id,
    databaseId: dbId,
    ownerId: userId,
  },
}).execute();

// 3. Execute — Phase 0 provisions channel entity type, then tables/relations
const result = await db.mutation.constructBlueprint({
  input: {
    blueprintId,
    schemaId,
  },
}).execute();
// result = { "channels": "<uuid>", "messages": "<uuid>" }
```

## CLI: Create a Blueprint with Membership Types

```bash
# Create template
constructive public:blueprint-template create \
  --name team_collaboration \
  --displayName "Team Collaboration" \
  --ownerId <UUID> \
  --definition '{
    "entity_types": [
      {
        "name": "Channel Member",
        "prefix": "channel",
        "description": "Membership to a channel.",
        "parent_entity": "org"
      }
    ],
    "tables": [...],
    "relations": [...]
  }'

# Copy to blueprint
constructive public:copy-template-to-blueprint \
  --input.templateId <UUID> \
  --input.databaseId <UUID> \
  --input.ownerId <UUID>

# Execute
constructive public:construct-blueprint \
  --input.blueprintId <UUID> \
  --input.schemaId <UUID>
```

## Nested Entity Types in Blueprints

To create nested hierarchies (e.g. org → channel → thread), list entries in parent-first order:

```json
{
  "entity_types": [
    {
      "name": "Channel Member",
      "prefix": "channel",
      "parent_entity": "org"
    },
    {
      "name": "Thread Member",
      "prefix": "thread",
      "parent_entity": "channel"
    }
  ]
}
```

Phase 0 processes entries **in order**, so parent types must appear before child types.

## Combining with Tables and Relations

A common pattern: provision entity types in Phase 0, then create domain tables in Phase 1 that FK to the entity tables:

```json
{
  "entity_types": [
    { "name": "Channel Member", "prefix": "channel", "parent_entity": "org" }
  ],
  "tables": [
    {
      "table_name": "messages",
      "nodes": [
        "DataId",
        "DataTimestamps",
        { "$type": "DataOwnershipInEntity", "data": { "entity_field": "channel_id" } }
      ],
      "fields": [
        { "name": "body", "type": { "name": "text" } },
        { "name": "is_pinned", "type": { "name": "boolean" } }
      ],
      "policies": [
        {
          "$type": "AuthzEntityMembership",
          "data": { "entity_field": "channel_id", "entity_type": "channel" },
          "privileges": ["select", "insert", "update", "delete"],
          "permissive": true
        }
      ]
    }
  ],
  "relations": [
    {
      "$type": "RelationBelongsTo",
      "source_table": "messages",
      "target_table": "channels",
      "field_name": "channel_id",
      "is_required": true
    }
  ]
}
```

The `channels` table is created by Phase 0 provisioning, so the `RelationBelongsTo` in Phase 2 can reference it by name.
