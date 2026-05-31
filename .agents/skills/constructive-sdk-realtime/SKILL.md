---
name: constructive-sdk-realtime
description: "Realtime subscriptions and notifications for Constructive apps — the realtime_module (change_log, listener_node, subscriber_tables), the graphile-realtime-subscriptions PostGraphile plugin (@realtime smart tag, onXxxChanged subscription fields, NOTIFY payload format, overflow protection), CursorTracker at-least-once delivery (drain_changes polling, touch_listener heartbeat, cleanup_ephemeral), RealtimeManager bridge to PgSubscriber, notifications_module (inbox, channels, preferences, digest, topic subscriptions), database_settings.enable_realtime toggle, and codegen'd subscription hooks (useXxxSubscription). Use when asked to 'add realtime', 'enable subscriptions', 'realtime module', 'change_log', 'CursorTracker', 'drain_changes', 'listener_node', 'notifications module', 'notification preferences', 'push notifications', 'onXxxChanged', 'enable_realtime', 'subscriber_tables', or when working with realtime features in blueprints."
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Realtime

Realtime event delivery and notification infrastructure for the Constructive platform. Provides per-table GraphQL subscriptions backed by PostgreSQL LISTEN/NOTIFY with cursor-based at-least-once delivery guarantees, plus a full notification inbox system.

## When to Apply

- Enabling realtime subscriptions on tables (live updates in the UI)
- Configuring `enable_realtime` in `database_settings`
- Using `CursorTracker` or `RealtimeManager` for at-least-once delivery
- Setting up the `notifications_module` (inbox, channels, preferences, digest)
- Working with codegen'd `useXxxSubscription` hooks in React apps
- Understanding the `change_log` → NOTIFY → subscription pipeline

## Architecture

```
Row change (INSERT/UPDATE/DELETE)
  → emit_change trigger fires pg_notify("realtime:{schema}.{table}", "OP:rowId")
  → PostGraphile PgSubscriber receives NOTIFY
  → RealtimeSubscriptionsPlugin resolves subscription plans
  → Client receives { event, row, rowId, overflow }

Complementary at-least-once path:
  CursorTracker polls drain_changes() from change_log
    → RealtimeManager converts to NOTIFY format
      → Emits on PgSubscriber.eventEmitter (same channel)
        → Clients receive events identically to real NOTIFY
```

NOTIFY is instant but best-effort (missed during disconnects). Cursor polling catches up on anything missed. Together they provide at-least-once delivery. Duplicates are expected — clients should be idempotent.

## Enabling Realtime

Realtime requires two things: the `realtime_module` installed via provisioning, and `enable_realtime` toggled on in `database_settings`.

### 1. Install the module

The `realtime_module` is included in the `full` preset. For other presets, add it explicitly:

```typescript
await db.databaseProvisionModule.create({
  data: {
    databaseId,
    modules: ['realtime_module'],
  }
});
```

### 2. Enable via database_settings

```typescript
await db.databaseSettings.update({
  where: { databaseId },
  data: { enableRealtime: true }
});
```

Per-API override via `api_settings` (nullable — `null` inherits from `database_settings`):

```typescript
await db.apiSettings.update({
  where: { apiId },
  data: { enableRealtime: true }
});
```

### realtime_module Configuration

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `retention_hours` | integer | `168` (7 days) | How long `change_log` partitions are retained |
| `premake` | integer | `7` | Number of future partitions to pre-create |
| `interval` | text | `'1 day'` | Partition interval for `change_log` |
| `notify_channel` | text | `null` | Custom NOTIFY channel name (null = default) |
| `api_name` | text | `'realtime'` | API routing name for the realtime schema |

## PostGraphile Plugin

`graphile-realtime-subscriptions` is a PostGraphile v5 plugin that discovers tables tagged with `@realtime` and generates per-table subscription fields.

### Subscription Fields

For each `@realtime`-tagged table, the plugin creates:

- **`onXxxChanged(ids: [UUID!])`** — subscribe to changes on specific rows
- **`onXxxChanged`** (no args) — subscribe to any change on the table

### Event Payload

```typescript
{
  event: 'INSERT' | 'UPDATE' | 'DELETE' | 'INVALIDATE';
  row: FullRowType | null;    // fetched via RLS-gated resource.get()
  rowId: string | null;       // masked to null if RLS denies access
  overflow: boolean;          // true when INVALIDATE (client should refetch)
}
```

### Security / RLS Enforcement

- Row data is always fetched via the authenticated user's connection with JWT role and pgSettings
- For INSERT/UPDATE: if RLS denies access, `rowId` is masked (set to null) to prevent metadata leaks
- For DELETE: `row` is naturally null (row no longer exists)
- For INVALIDATE: client refetches via a normal RLS-gated query
- When `ids` are provided, only events for those rows are delivered (prevents cross-tenant leaks)

### Overflow Protection

Two layers prevent subscription storms:

1. **Database-side:** statements affecting > 50 rows send a single `INVALIDATE` instead of per-row events
2. **Plugin-side:** per-subscriber throttle (default 50 events/second/table) — drops individual events and sends one `INVALIDATE` when exceeded

### NOTIFY Payload Format

From the `emit_change` trigger:
- Normal: `"INSERT:uuid1,uuid2,..."` or `"UPDATE:uuid1"` or `"DELETE:uuid1"`
- Overflow: `"INVALIDATE"` (bulk statement affected > threshold rows)

## CursorTracker — At-Least-Once Delivery

`CursorTracker` manages the `listener_node` lifecycle and periodic `drain_changes()` polling. Source: `graphile-realtime-subscriptions/src/cursor-tracker.ts`.

### Lifecycle

1. **`start()`** → calls `touch_listener()` to register/heartbeat the listener node
2. **Periodic `drain_changes()` polling** — fetches new `change_log` entries
3. **Periodic `touch_listener()` heartbeat** — keeps the node alive
4. **`stop()`** → calls `cleanup_ephemeral()` to remove ephemeral subscriptions and delete the listener node

### Configuration

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `nodeId` | string | random UUID | Listener node ID. Stable = cursor continuity across restarts |
| `schema` | string | `'realtime_public'` | Schema containing `drain_changes`, `touch_listener`, `cleanup_ephemeral` |
| `pollIntervalMs` | number | `5000` | How often to poll `drain_changes()` (ms) |
| `heartbeatIntervalMs` | number | `30000` | How often to heartbeat via `touch_listener()` (ms) |
| `batchLimit` | number | `500` | Max `change_log` rows per `drain_changes()` call |
| `pool` | Queryable | **(required)** | pg.Pool or compatible query interface |
| `onChanges` | callback | no-op | Called with new `ChangeLogEntry[]` on each drain |
| `onError` | callback | log to console | Called on polling/heartbeat errors |

### ChangeLogEntry Shape

```typescript
interface ChangeLogEntry {
  id: string;
  occurred_at: string;
  source_schema: string;
  source_table: string;
  operation: string;                        // 'INSERT' | 'UPDATE' | 'DELETE'
  payload_after: Record<string, unknown> | null;
  payload_before: Record<string, unknown> | null;
  payload_diff: Record<string, unknown> | null;
  subscriber_ids: string[];
}
```

## RealtimeManager Bridge

`RealtimeManager` converts `ChangeLogEntry` objects from `drain_changes()` into NOTIFY-format payloads and emits them on PgSubscriber's internal EventEmitter. This means cursor-tracked events flow through the same subscription plans as real NOTIFY events — clients receive them identically.

```
CursorTracker (polls change_log)
  → RealtimeManager (converts to NOTIFY format: "OP:rowId")
    → PgSubscriber.eventEmitter.emit("realtime:{schema}.{table}", payload)
      → PostGraphile subscription plans deliver to clients
```

### Usage

```typescript
import { RealtimeManager } from 'graphile-realtime-subscriptions';

const manager = new RealtimeManager({
  pgSubscriber,         // from PostGraphile context
  pool,                 // pg.Pool from pg-cache
  nodeId: 'server-1',   // stable ID for cursor continuity
  pollIntervalMs: 5000,
  heartbeatIntervalMs: 30000,
  batchLimit: 500,
});

await manager.start();
// ... on shutdown:
await manager.stop();
```

## Database Tables (provisioned by realtime_module)

| Table | Schema | Purpose |
|-------|--------|---------|
| `change_log` | `realtime_public` | Partitioned event log (INSERT/UPDATE/DELETE records with before/after payloads) |
| `listener_node` | `realtime_public` | Active listener nodes with heartbeat tracking |
| `source_registry` | `realtime_public` | Registered source tables for change tracking |
| `subscriber_tables` | `realtime_private` | Per-listener subscription registrations |

`change_log` is partitioned by day with configurable retention (default 7 days, managed by pg_partman).

## Notifications Module

A platform module (`notifications_module`) that produces a complete notification inbox system. Included in the `full` preset.

### Enabling

```typescript
await db.databaseProvisionModule.create({
  data: {
    databaseId,
    modules: [{
      notifications_module: {
        has_channels: true,
        has_preferences: true,
        has_digest_metadata: false,
        has_subscriptions: false,
      }
    }],
  }
});
```

### Sub-Features (Toggle Flags)

| Flag | Default | Tables/Features Generated |
|------|---------|--------------------------|
| *(core — always on)* | — | `notifications` (inbox with category, kind, priority, topic, deep links, grouping, expiry) + `notification_read_state` (per-user sparse read/seen state) |
| `has_channels` | `true` | `notification_channels` (device/push endpoints with type, token, expiry) + `notification_delivery_log` (per-attempt delivery audit trail) |
| `has_preferences` | `true` | `notification_preferences` (per-user per-category channel preferences with mute/snooze) |
| `has_digest_metadata` | `false` | Adds `digest_bucket`, `deliver_after` fields to notifications for batched digest delivery |
| `has_subscriptions` | `false` | Topic-based follow/unfollow subscriptions |

## Codegen'd Subscription Hooks

When `enable_realtime` is on and the codegen runs, per-table subscription hooks are generated:

```typescript
// Generated hook — subscribe to changes on specific rows
const { data, error } = useMessagesSubscription({
  ids: [messageId],
});

// Subscribe to all changes on the table
const { data } = useMessagesSubscription();

// data shape:
// { event: 'INSERT', row: { id, content, ... }, rowId: '...', overflow: false }
```

See [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) for the full subscription hooks codegen reference.

## Related Skills

- **[`constructive-jobs`](../constructive-jobs/SKILL.md)** — Background jobs (JobTrigger, Knative workers) — separate from realtime subscriptions
- **[`constructive-platform`](../constructive-platform/SKILL.md)** — Platform architecture, `database_settings` service settings reference
- **[`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md)** — Subscription hooks codegen, watch mode, query key factories

For SQL-level internals (change_log partitioning, pg_partman retention, pg_cron maintenance), see the `constructive-db-partitioned-tables` skill in `constructive-io/constructive-db`.
