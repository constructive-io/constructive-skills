# Meter Sources

Configuration for how meters receive usage data.

## Source Types

| Source | Description |
|--------|-------------|
| `manual` | Usage recorded explicitly via `record_usage()` |
| `trigger` | Billing usage recorded automatically by a `LimitTrackUsage` table trigger |
| `external` | Usage synced from external billing provider |

## Trigger-Based Sources

Attach `LimitTrackUsage` to record a billing meter automatically. `meter_slug` is required; `entity_field` defaults to `entity_id`, `quantity` to `1`, and `events` to `INSERT` + `DELETE`. An `UPDATE` event reverses usage for the old entity and records it for the new entity when `entity_field` changes.

`LimitEnforceCounter` and `LimitEnforceAggregate` maintain the limits subsystem's counters; they are enforcement nodes, not billing-meter source configuration.

## External Sources

The billing provider module can sync usage from external systems (Stripe, Paddle) via the `process_billing_event()` function, which handles idempotent webhook deduplication.
