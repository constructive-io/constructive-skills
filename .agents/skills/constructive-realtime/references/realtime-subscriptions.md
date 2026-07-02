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
    { "name": "body", "type": { "name": "text" } },
    { "name": "author_id", "type": { "name": "uuid" } }
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
| `ephemeral` | `boolean` | `false` | Skip change_log writes; deliver via pg_notify directly |
| `subscriber_table_name` | `string` | `{source_table}_subscriber` | Custom name for the subscriber table |

**Tracking only inserts and deletes:**
```json
{
  "$type": "DataRealtime",
  "data": { "operations": ["INSERT", "DELETE"] }
}
```

**Ephemeral mode (high-frequency signals, no change_log):**
```json
{
  "$type": "DataRealtime",
  "data": { "ephemeral": true, "operations": ["INSERT"] }
}
```

**Custom subscriber table name:**
```json
{
  "$type": "DataRealtime",
  "data": { "subscriber_table_name": "message_watchers" }
}
```

## Ephemeral Realtime

Ephemeral mode (`ephemeral: true`) is designed for high-frequency, low-durability signals — cursor positions, presence indicators, typing status, live counters — where writing every event to `change_log` would create unnecessary WAL/write overhead.

### How It Differs from Normal Mode

| | Normal mode | Ephemeral mode |
|---|---|---|
| **Data path** | DML → `emit_change()` → INSERT change_log + pg_notify(wake) → `drain_changes()` → WebSocket | DML → `emit_change_ephemeral()` → pg_notify(full payload) → WebSocket |
| **Durability** | Events persisted in partitioned change_log | No persistence — fire-and-forget |
| **Catch-up** | Clients reconnect and poll from last cursor | No catch-up — missed events are gone |
| **Write cost** | One INSERT per event into change_log | Zero writes |
| **Subscriber table** | Created with RLS policies | Created with RLS policies (identical) |
| **Security** | RLS enforced at delivery time (drain reads subscriptions) | RLS enforced at subscription time (INSERT into subscriber table) |

### Blueprint Usage

```json
{
  "table_name": "cursor_positions",
  "nodes": [
    "DataId",
    { "$type": "DataRealtime", "data": { "ephemeral": true, "operations": ["INSERT"] } }
  ],
  "fields": [
    { "name": "user_id", "type": { "name": "uuid" } },
    { "name": "x", "type": { "name": "float8" } },
    { "name": "y", "type": { "name": "float8" } }
  ],
  "grants": [
    { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"]] }
  ]
}
```

### Overflow Safety

The ephemeral trigger includes overflow detection to stay within PostgreSQL's 8KB NOTIFY payload limit:

- **Row count overflow**: If a single statement affects > 50 rows, the payload is `{ op: 'INSERT', overflow: true, count: N }` instead of full row data.
- **Byte size overflow**: If the serialized row data exceeds 7500 bytes, the same overflow marker is sent.

Clients receiving an overflow payload should refetch the current state rather than applying individual row changes.

### When to Use Ephemeral vs Normal

**Use ephemeral for:**
- Cursor/pointer positions in collaborative editing
- Presence indicators (online/typing/idle)
- Live counters and progress bars
- Any signal where missing one event doesn't break the experience

**Use normal (default) for:**
- Chat messages, comments, document changes
- Anything where every event must be delivered at least once
- Audit-critical tables
- Tables where clients may reconnect and need to catch up

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

**Ephemeral mode** uses only path 1 (NOTIFY with full JSONB payload). There is no change log, so delivery is best-effort — if a client is disconnected when the event fires, it's gone.

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

### Step 3: Enable realtime on the server

Set `enable_realtime` in your database settings (or per-API settings). The server includes the realtime subscription plugin only when this is `true`.

```ts
// Via ORM
await db.databaseSetting.update({
  where: { id: settingId },
  data: { enableRealtime: true },
  select: { id: true },
}).execute();

// Or via CLI
cnc database-setting update --enable-realtime true
```

## GraphQL Subscription API

For each table with `DataRealtime`, the server generates a GraphQL subscription field. The field name follows the pattern `on{TypeName}Changed`.

### Generated Schema

```graphql
extend type Subscription {
  """Subscribe to changes. Pass ids to watch specific rows, or no args for all."""
  onDocumentsChanged(ids: [UUID!]): DocumentsSubscriptionPayload
}

type DocumentsSubscriptionPayload {
  """The DML operation: INSERT, UPDATE, DELETE, or INVALIDATE."""
  event: String!
  """The current row state (null for DELETE, INVALIDATE, or if RLS denies access)."""
  documents: Documents
  """The changed row ID (null for INVALIDATE, or masked when RLS denies access)."""
  rowId: UUID
  """True when too many changes occurred and the client should refetch."""
  overflow: Boolean!
}
```

### Subscription Modes

| Mode | Arguments | Behavior |
|------|-----------|----------|
| Specific rows | `ids: [UUID!]` | Only delivers events for the listed row IDs |
| Full collection | _(none)_ | Delivers all events for the table (subject to RLS) |

### Payload Fields

| Field | Type | Description |
|-------|------|-------------|
| `event` | `String!` | `INSERT`, `UPDATE`, `DELETE`, or `INVALIDATE` |
| `{tableName}` | `TableType` | Current row data (null for DELETE, INVALIDATE, or RLS-denied) |
| `rowId` | `UUID` | Changed row ID (null for INVALIDATE, masked when RLS denies access) |
| `overflow` | `Boolean!` | `true` when too many changes occurred — client should refetch |

### Raw GraphQL Usage

```graphql
# Watch specific rows
subscription {
  onDocumentsChanged(ids: ["uuid-a", "uuid-b"]) {
    event
    rowId
    documents { id title content updatedAt }
    overflow
  }
}

# Watch all changes on a table
subscription {
  onMessagesChanged {
    event
    rowId
    messages { id body authorId createdAt }
    overflow
  }
}
```

### Overflow Handling

When a single SQL statement affects more than 50 rows, the event is `INVALIDATE` with `overflow: true` instead of individual row events. The client should respond by refetching the relevant query. The server also applies per-subscriber rate limiting (50 events/second/table) — if exceeded, a synthetic `INVALIDATE` is sent.

## Client-Side Usage

### ORM Client (TypeScript)

The generated ORM client includes a `subscribe()` method when realtime is configured. Pass a `graphql-ws` client instance via the `realtime` config:

```ts
import { createClient as createWsClient } from 'graphql-ws';
import { createClient } from './orm';

const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
  realtime: {
    client: createWsClient({ url: 'wss://api.example.com/graphql' }),
  },
});

// Subscribe to changes on a table
const unsubscribe = db.subscribe(
  { fieldName: 'onDocumentsChanged', tableName: 'documents', dataFieldName: 'documents' },
  'subscription { onDocumentsChanged { event documents { id title } overflow } }',
  {},
  {
    onEvent: (event) => {
      console.log(event.operation, event.data);
    },
    onError: (err) => console.error(err),
  },
);

// Later: cancel the subscription
unsubscribe();
```

### React Hooks (Codegen)

For tables with `DataRealtime`, `cnc codegen` generates per-table subscription hooks in the `hooks/subscriptions/` directory. These hooks automatically invalidate React Query cache on events.

```tsx
import { useDocumentsSubscription } from './hooks/subscriptions/useDocumentsSubscription';
import { useConnectionState } from './hooks/subscriptions/useConnectionState';

function DocumentList() {
  // Subscribe to realtime changes — auto-invalidates queries
  useDocumentsSubscription({
    onEvent: (event) => {
      console.log(event.operation, event.data);
      // event.operation: 'INSERT' | 'UPDATE' | 'DELETE'
      // event.data: the row, or null for DELETE
    },
    onError: (err) => console.error(err),
    enabled: true,            // default true, set false to pause
    invalidateQueries: true,  // default true, auto-invalidates React Query cache
  });

  // Monitor WebSocket connection state
  const state = useConnectionState();
  // state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

  return <div>Connection: {state}</div>;
}
```

### Generated Hook Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onEvent` | `(event) => void` | _(required)_ | Called when a subscription event is received |
| `onError` | `(error) => void` | — | Called on subscription errors |
| `enabled` | `boolean` | `true` | Set `false` to pause the subscription |
| `invalidateQueries` | `boolean` | `true` | Auto-invalidate React Query cache on events |

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
        { "name": "title", "type": { "name": "text" } },
        { "name": "content", "type": { "name": "jsonb" } }
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
        { "name": "document_id", "type": { "name": "uuid" } },
        { "name": "editor_id", "type": { "name": "uuid" } },
        { "name": "patch", "type": { "name": "jsonb" } }
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
