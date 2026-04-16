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
      "skip_entity_policies": false
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
| `is_visible` | boolean | No | `true` | Whether parent members can see child entities |
| `has_limits` | boolean | No | `false` | Provision a `limits_module` for this type |
| `has_profiles` | boolean | No | `false` | Provision a `profiles_module` for named permission roles |
| `has_levels` | boolean | No | `false` | Provision a `levels_module` for gamification |
| `skip_entity_policies` | boolean | No | `false` | Skip creating default RLS policies on the entity table |

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
