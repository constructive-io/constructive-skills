# Blueprint Membership Types (Phase 0)

The `membership_types` array is a top-level key in the blueprint definition JSONB, alongside `tables`, `relations`, `indexes`, etc. Entries are processed in **Phase 0** of `constructBlueprint()` — before tables and relations — so blueprint tables can reference the entity tables they create.

## Definition Shape

```json
{
  "membership_types": [
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
      "skip_entity_policies": false,
      "table_provision": null
    }
  ],
  "tables": [ ... ],
  "relations": [ ... ]
}
```

## Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Human-readable name (e.g. `"Channel Member"`, `"Department Member"`) |
| `prefix` | string | **Yes** | — | SQL prefix for generated objects (e.g. `"channel"` → `channels` table, `channel_permissions`, etc.) |
| `description` | string | No | `null` | Optional description of the entity type |
| `parent_entity` | string | No | `"org"` | Parent type prefix. Must be an already-provisioned type |
| `table_name` | string | No | `prefix + 's'` | Override entity table name (e.g. `"rooms"` instead of default `"channels"`) |
| `is_visible` | boolean | No | `true` | Gates the default `parent_member` SELECT policy. **No-op when `table_provision` is supplied.** See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |
| `has_limits` | boolean | No | `false` | Provision a `limits_module` for this type |
| `has_profiles` | boolean | No | `false` | Provision a `profiles_module` for named permission roles |
| `has_levels` | boolean | No | `false` | Provision a `levels_module` for gamification |
| `has_storage` | boolean | No | `false` | Provision a `storage_module` with buckets, files, and upload_requests tables |
| `storage_config` | object | No | `null` | Storage configuration when `has_storage` is true. See [Storage Config](#storage-config-has_storage-storage_config) |
| `skip_entity_policies` | boolean | No | `false` | Escape hatch: apply zero policies on the entity table. See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |
| `table_provision` | object | No | `null` | Override object for the entity table (nodes, fields, grants, policies). When supplied, `policies[]` **replaces** the five default entity-table policies. See [Entity-Table Policies](#entity-table-policies-is_visible-skip_entity_policies-table_provision) |

## Storage Config (`has_storage`, `storage_config`)

When `has_storage: true`, the system provisions a `storage_module` for the entity type, creating `{prefix}_buckets`, `{prefix}_files`, and `{prefix}_upload_requests` tables with RLS security policies.

The optional `storage_config` object controls bucket behavior:

```json
{
  "name": "Data Room Member",
  "prefix": "data_room",
  "parent_entity": "org",
  "has_storage": true,
  "storage_config": {
    "policies": ["AuthzEntityMembership", "AuthzPublishable"]
  }
}
```

### `storage_config` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `is_public` | boolean | No | `false` | S3 bucket ACL — `true` = publicly readable URLs, `false` = presigned URLs required |
| `policies` | string[] | No | `null` | Array of `Authz*` node type names. When provided, replaces the default storage security policies entirely |

### Typical policy combinations

| Combination | Use case |
|-------------|----------|
| `policies: ["AuthzEntityMembership"]` | Private entity files (default pattern) |
| `is_public: true, policies: ["AuthzEntityMembership", "AuthzPublishable"]` | Public assets with member write |
| `policies: ["AuthzDirectOwner"]` | Owner-only private docs |

See [storage-policies.md](../../constructive/references/storage-policies.md) for the full reference including the provisioning pipeline, privilege matrix, and all available policy types.

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
    { "name": "topic", "type": "text" }
  ],
  "grant_privileges": [ ["select", "*"], ["insert", "*"] ],
  "grant_roles": ["authenticated"],
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
| `grant_privileges` | array | No | inherited | Privilege tuples like `[["select","*"], ["insert","*"]]` |
| `grant_roles` | string[] | No | `["authenticated"]` | Roles that receive the grants |
| `policies` | array | No | `[]` | Safegres policy definitions (same `$type` discriminator as `tables[].policies[]`). When present, **fully replaces** the 5 defaults |

### When to use which

| Goal | Config |
|---|---|
| "Just give me the standard defaults" | leave all three fields at defaults |
| "Hide this entity from parent members but keep everything else" | `"is_visible": false` |
| "Add custom fields/grants on the entity table (no custom policies)" | `table_provision: { nodes, fields, grant_privileges }`. **Heads up:** because `table_provision` is the override flag, this skips the 5 default policies too. If you want custom nodes/fields **and** the default policies, also copy the 5 defaults into `table_provision.policies[]` |
| "I want a completely different policy model on this entity" | `table_provision: { policies: [...] }` with your own `policies[]` |
| "I'll add policies later myself" | `"skip_entity_policies": true` |

### Example: custom fields + custom policies

```json
{
  "name": "Data Room Member",
  "prefix": "data_room",
  "parent_entity": "org",
  "table_provision": {
    "nodes": [ { "$type": "DataTimestamps" } ],
    "fields": [
      { "name": "topic", "type": "text" }
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
  membership_types: [channelType],
  tables: [
    {
      table_name: 'messages',
      nodes: ['DataId', 'DataTimestamps'],
      fields: [
        { name: 'body', type: 'text' },
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

`target_table: 'channels'` works because `membership_types` entries are processed in Phase 0 and their entity tables are added to the `table_map` before Phase 1 (tables) and Phase 2 (relations).

## Validation

The `tg_validate_blueprint_definition` trigger validates `membership_types` entries on INSERT/UPDATE of both `blueprint` and `blueprint_template`. Required keys: `name`, `prefix`. All other keys are optional.

## ORM: Create a Blueprint with Membership Types

```typescript
// 1. Create a template with membership_types
const template = await db.blueprintTemplate.create({
  data: {
    name: 'team_collaboration',
    displayName: 'Team Collaboration',
    ownerId: userId,
    visibility: 'public',
    categories: ['collaboration'],
    tags: ['channels', 'messaging'],
    definition: {
      membership_types: [
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
          fields: [{ name: 'body', type: 'text' }],
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
    "membership_types": [
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
  "membership_types": [
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
  "membership_types": [
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
        { "name": "body", "type": "text" },
        { "name": "is_pinned", "type": "boolean" }
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
