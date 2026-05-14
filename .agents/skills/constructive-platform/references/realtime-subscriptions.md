# Realtime Subscriptions

Constructive provides built-in realtime subscription support through the `DataRealtime` node type and the `realtime_module`. Tables opt in to realtime by adding `DataRealtime` to their blueprint `nodes[]` — the platform handles subscriber table creation, RLS policy derivation, change tracking, and partition management automatically.

## How It Works (SDK Perspective)

1. **Include `realtime_module`** in your database modules (included in `full` preset, or add `'realtime_module'` to your module list).
2. **Add `DataRealtime`** to any table's `nodes[]` in its blueprint definition.
3. The platform creates a **subscriber table** in `subscriptions_public` for that source table.
4. **SELECT policies** on the source table are analyzed and used to derive RLS policies on the subscriber table — subscribers can only see changes they're authorized to read.
5. **Statement-level triggers** (`emit_change()`) fire on INSERT/UPDATE/DELETE and write events to a partitioned change log, plus emit per-table NOTIFY signals for low-latency delivery.

## Enabling Realtime

### Step 1: Install the realtime module

Include `realtime_module` in your module list when provisioning a database. The `full` preset includes it automatically.

```ts
import { getModulePreset } from '@constructive-io/node-type-registry';

// Option A: use a preset that includes it
const preset = getModulePreset('full');

// Option B: add it to a custom module list
const modules = [...baseModules, 'realtime_module'];
```

The `realtime_module` provisions shared infrastructure:
- A `subscriptions_public` schema for subscriber tables
- A partitioned `change_log` table for durable event storage
- Partition lifecycle management (automatic creation and rotation)

### Step 2: Add DataRealtime to a table

In your blueprint definition, add `DataRealtime` to the table's `nodes[]`:

```json
{
  "table_name": "messages",
  "nodes": [
    "DataId",
    "DataTimestamps",
    { "$type": "DataEntityMembership", "data": { "entity_field_name": "channel_id" } },
    "DataRealtime"
  ],
  "fields": [
    { "name": "body", "type": "text" },
    { "name": "author_id", "type": "uuid" }
  ],
  "grants": [
    { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
  ],
  "use_rls": true,
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": { "entity_field": "channel_id", "membership_type": 2 },
      "privileges": ["select", "insert", "update", "delete"]
    }
  ]
}
```

This creates:
- `subscriptions_public.messages_subscriber` — the subscriber table with RLS policies derived from the source table's SELECT policies
- Statement-level triggers on `messages` that call `emit_change()` on INSERT, UPDATE, and DELETE

### DataRealtime Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `operations` | `string[]` | `['INSERT', 'UPDATE', 'DELETE']` | Which DML operations to track |
| `subscriber_table_name` | `string` | `{source_table}_subscriber` | Custom name for the subscriber table |

**Tracking only inserts and deletes:**
```json
{
  "$type": "DataRealtime",
  "data": { "operations": ["INSERT", "DELETE"] }
}
```

**Custom subscriber table name:**
```json
{
  "$type": "DataRealtime",
  "data": { "subscriber_table_name": "message_watchers" }
}
```

## How Subscription Security Works

Subscriber tables inherit security from the source table automatically. The platform inspects the source table's **SELECT policies** and derives equivalent RLS policies for the subscriber table. This means:

- If a user can SELECT rows from `messages` (because they're a channel member), they can subscribe to changes on `messages`.
- If a user loses SELECT access (removed from the channel), their subscription stops returning results.
- No manual policy configuration is needed on the subscriber table.

## Change Delivery

Changes flow through two complementary paths:

1. **NOTIFY signals** — low-latency PostgreSQL NOTIFY on a per-table channel for immediate push to connected clients. Includes row IDs in the payload with overflow detection for large batches.
2. **Change log polling** — a partitioned `change_log` table provides durable, ordered event storage. Clients that missed NOTIFY events (disconnection, restart) can catch up by polling from their last-seen cursor position.

This dual-path design provides **at-least-once delivery**: NOTIFY for speed, change log for reliability.

## Partitions

The `realtime_module` uses PostgreSQL native partitioning for the change log table. Partitions are managed automatically:

- **Range partitioning** on timestamp — new partitions are created as needed
- **Automatic rotation** — old partitions are detached and dropped based on retention policy
- **No manual partition management required** — the platform handles creation, attachment, and cleanup

### Declarative Partition Support

Tables in Constructive can also be declared as partitioned at the blueprint level. When a table is marked as partitioned, the platform:

1. Creates the table with the appropriate PostgreSQL partition strategy (range, list, or hash)
2. Manages partition lifecycle (creation, attachment, detachment)
3. Handles the constraint that partitioned tables cannot have unique indexes that don't include the partition key

This is used internally by `realtime_module` for the change log, but the partition infrastructure is general-purpose and available for any table that benefits from partitioning (e.g., time-series data, large append-only tables, multi-tenant data separation).

## Runtime Toggle

Realtime can be enabled or disabled per-database and per-API via the `enable_realtime` setting:

- `database_settings.enable_realtime` — database-wide default
- `api_settings.enable_realtime` — per-API override (takes precedence)

The server resolves the effective value using a COALESCE cascade: API setting > database setting > `false`.

## When to Use DataRealtime

**Good for:**
- Chat / messaging tables where users need live updates
- Collaborative editing (document changes, cursor positions)
- Activity feeds and notification streams
- Dashboards with live data
- Any table where connected clients need push updates on changes

**Not needed for:**
- Static reference data that rarely changes
- Tables only accessed via batch jobs
- Historical / archival tables
- Tables with no connected subscribers

## Complete Example

A collaborative document editor with realtime updates:

```json
{
  "tables": [
    {
      "table_name": "documents",
      "nodes": [
        "DataId", "DataTimestamps", "DataDirectOwner",
        "DataPublishable",
        "DataRealtime"
      ],
      "fields": [
        { "name": "title", "type": "text" },
        { "name": "content", "type": "jsonb" }
      ],
      "grants": [
        { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
      ],
      "use_rls": true,
      "policies": [
        {
          "$type": "AuthzDirectOwner",
          "data": { "owner_field": "owner_id" },
          "privileges": ["select", "insert", "update", "delete"]
        }
      ]
    },
    {
      "table_name": "document_edits",
      "nodes": [
        "DataId", "DataTimestamps",
        { "$type": "DataRealtime", "data": { "operations": ["INSERT"] } }
      ],
      "fields": [
        { "name": "document_id", "type": "uuid" },
        { "name": "editor_id", "type": "uuid" },
        { "name": "patch", "type": "jsonb" }
      ],
      "grants": [
        { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"]] }
      ]
    }
  ],
  "relations": [
    {
      "source_table": "document_edits",
      "target_table": "documents",
      "source_field": "document_id",
      "delete_action": "cascade"
    }
  ]
}
```

This gives you:
- `documents` table with owner-based security and realtime on all operations
- `document_edits` append-only table with realtime on inserts only
- Subscriber tables in `subscriptions_public` with derived RLS for both
