# Warning System

Usage warnings and threshold alerts emitted by the three canonical `LimitWarning*` blueprint nodes.

## Nodes

| Node | Watches | Required key | Defaults |
|---|---|---|---|
| `LimitWarningCounter` | Actor counter thresholds | `limit_name` | `scope: app`, `actor_field: owner_id` |
| `LimitWarningAggregate` | Entity aggregate thresholds | `limit_name` | `scope: org`, `entity_field: entity_id` |
| `LimitWarningRate` | Active sliding-window meter thresholds | `meter_slug` | `scope: app`, `entity_field: entity_id`, `actor_field: owner_id` |

Each node attaches an `AFTER INSERT` trigger. It reads warning thresholds from the provisioned limits scope and uses warning state to deduplicate the first crossing for an actor or entity.

When the target row reaches its entity through a foreign key, set `entity_field` to that FK and provide:

```json
{
  "entity_lookup": {
    "obj_table": "channels",
    "obj_field": "entity_id"
  }
}
```

`obj_table` and `obj_field` are required inside `entity_lookup`; `obj_schema` is optional and is resolved within the same database when omitted.

## Warning Events

When a threshold is crossed for the first time, the trigger enqueues the configured background job, which can drive:
- In-app notifications via the realtime subscription system
- Email alerts via cloud functions
- Webhook calls via the billing provider bridge

## Prerequisites

- Counter warnings require a limits module with warning tables enabled.
- Aggregate warnings also require aggregate limits for that scope.
- Rate warnings require limits warnings plus the rate-limit meters module.

Warnings do not enforce quota. Pair the matching warning node with `LimitEnforceCounter`, `LimitEnforceAggregate`, or `LimitEnforceRate` when the same threshold family must also block writes.
