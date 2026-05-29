# EventTracker Reference

The `EventTracker` node type creates AFTER triggers on a table that call `record_event()` whenever rows change. It follows the same pattern as `JobTrigger` — same compound conditions syntax, same `watch_fields` behavior — but records events to the events module instead of enqueuing background jobs.

**Category prefix:** `event` (generates `event_tracker` slug in the Node Type Registry).

## Parameter Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `event_name` | string | **(required)** | Event type name to record (e.g., `"avatar_uploaded"`, `"order_completed"`) |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["INSERT"]` | Which DML events fire the trigger |
| `count` | integer | `1` | Number of events to record per trigger fire |
| `toggle` | boolean | `false` | Toggle mode (see below) |
| `actor_field` | string (column-ref) | `"owner_id"` | Column containing the actor (user) ID |
| `entity_field` | string (column-ref) | — | Column containing the entity ID for entity-scoped events |
| `auto_register_type` | boolean | `true` | Register `event_name` in event_types catalog during provisioning |
| `watch_fields` | string[] | — | UPDATE-only: fire when these columns change |
| `condition_field` | string | — | Legacy: column for simple WHEN clause |
| `condition_value` | string | — | Legacy: value to match |
| `conditions` | object \| array | — | Compound conditions (same syntax as JobTrigger) |

**Constraints:** `conditions`, `condition_field`, and `watch_fields` are mutually exclusive.

## Compound Conditions

EventTracker uses the exact same compound condition system as JobTrigger. Column types are resolved automatically from the PostgreSQL schema.

### Leaf condition

```json
{ "field": "status", "op": "=", "value": "active", "row": "NEW" }
```

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `field` | yes | — | Column name (validated against the table) |
| `op` | yes | — | `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM` |
| `value` | conditional | — | Comparison value (omit for `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM`) |
| `row` | no | `"NEW"` | Row reference: `"NEW"` or `"OLD"` |
| `ref` | no | — | Column reference for field-to-field comparison: `{ "field": "...", "row": "..." }` |

### Array shorthand (implicit AND)

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "profile_completed",
    "events": ["UPDATE"],
    "conditions": [
      { "field": "display_name", "op": "IS NOT NULL" },
      { "field": "avatar_url", "op": "IS NOT NULL" },
      { "field": "bio", "op": "IS NOT NULL" }
    ]
  }
}
```

### Nested combinators (AND/OR/NOT)

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "order_completed",
    "events": ["UPDATE"],
    "conditions": {
      "AND": [
        { "field": "status", "op": "=", "value": "completed" },
        { "field": "status", "op": "!=", "value": "completed", "row": "OLD" },
        { "NOT": { "field": "is_test", "op": "=", "value": true } }
      ]
    }
  }
}
```

## Toggle Mode

When `toggle: true`, the trigger records an event when the condition becomes true and removes it when the condition becomes false. This is useful for boolean state tracking:

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "email_verified",
    "events": ["UPDATE"],
    "toggle": true,
    "condition_field": "is_email_verified"
  }
}
```

- Row changes with `is_email_verified = true` → `record_event('email_verified', actor_id)`
- Row changes with `is_email_verified = false` → event count is decremented

Toggle mode works with compound conditions too — the conditions determine the "on" state.

## Entity-Scoped Events

By default, events are user-scoped (attributed to `actor_field`). For entity-scoped events (e.g., per-org, per-team), add `entity_field`:

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "document_uploaded",
    "events": ["INSERT"],
    "actor_field": "created_by",
    "entity_field": "org_id"
  }
}
```

This calls the entity variant of `record_event(step, actor_id, entity_id)`, which stores the event scoped to both user and entity.

### FK-based entity resolution (entity_lookup)

When `entity_field` is a FK (not a direct entity_id), combine with `entity_lookup`:

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "message_sent",
    "events": ["INSERT"],
    "actor_field": "sender_id",
    "entity_field": "channel_id",
    "entity_lookup": {
      "obj_table": "channels",
      "obj_field": "entity_id"
    }
  }
}
```

The generator resolves `channel_id → channels.entity_id` at provision time and bakes the JOIN as static SQL in the trigger.

## Common Patterns

### Track avatar upload (UPDATE with condition)

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "avatar_uploaded",
    "events": ["UPDATE"],
    "watch_fields": ["avatar_url"],
    "conditions": { "field": "avatar_url", "op": "IS NOT NULL" }
  }
}
```

### Track first project creation (INSERT)

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "first_project_created",
    "events": ["INSERT"],
    "actor_field": "owner_id"
  }
}
```

### Track status transition (compound conditions)

```json
{
  "$type": "EventTracker",
  "data": {
    "event_name": "order_shipped",
    "events": ["UPDATE"],
    "conditions": {
      "AND": [
        { "field": "status", "op": "=", "value": "shipped" },
        { "field": "status", "op": "!=", "value": "shipped", "row": "OLD" }
      ]
    }
  }
}
```

### Multiple EventTrackers on one table

A single table can have multiple EventTracker nodes for different events:

```json
{
  "table_name": "user_profiles",
  "nodes": [
    { "$type": "EventTracker", "data": {
      "event_name": "avatar_uploaded",
      "events": ["UPDATE"],
      "watch_fields": ["avatar_url"],
      "conditions": { "field": "avatar_url", "op": "IS NOT NULL" }
    }},
    { "$type": "EventTracker", "data": {
      "event_name": "profile_completed",
      "events": ["UPDATE"],
      "conditions": [
        { "field": "display_name", "op": "IS NOT NULL" },
        { "field": "avatar_url", "op": "IS NOT NULL" }
      ]
    }},
    { "$type": "EventTracker", "data": {
      "event_name": "bio_added",
      "events": ["UPDATE"],
      "watch_fields": ["bio"],
      "conditions": { "field": "bio", "op": "IS NOT NULL" }
    }}
  ],
  "fields": [
    { "name": "display_name", "type": { "name": "text" } },
    { "name": "avatar_url", "type": { "name": "text" } },
    { "name": "bio", "type": { "name": "text" } }
  ]
}
```

### EventTracker + JobTrigger on same table

EventTracker and JobTrigger coexist naturally — same table can track events AND enqueue background jobs:

```json
{
  "table_name": "invoices",
  "nodes": [
    { "$type": "EventTracker", "data": {
      "event_name": "invoice_paid",
      "events": ["UPDATE"],
      "conditions": {
        "AND": [
          { "field": "status", "op": "=", "value": "paid" },
          { "field": "status", "op": "!=", "value": "paid", "row": "OLD" }
        ]
      }
    }},
    { "$type": "JobTrigger", "data": {
      "task_identifier": "send_receipt_email",
      "events": ["UPDATE"],
      "conditions": {
        "AND": [
          { "field": "status", "op": "=", "value": "paid" },
          { "field": "status", "op": "!=", "value": "paid", "row": "OLD" }
        ]
      }
    }}
  ]
}
```
