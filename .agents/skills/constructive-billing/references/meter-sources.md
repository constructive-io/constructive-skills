# Meter Sources

Configuration for how meters receive usage data.

## Source Types

| Source | Description |
|--------|-------------|
| `manual` | Usage recorded explicitly via `record_usage()` |
| `trigger` | Usage recorded automatically by database triggers (LimitCounter/LimitAggregate) |
| `external` | Usage synced from external billing provider |

## Trigger-Based Sources

When a `LimitCounter` or `LimitAggregate` node is attached to a table, it automatically creates triggers that increment usage on INSERT and decrement on DELETE. No manual `record_usage()` call is needed.

## External Sources

The billing provider module can sync usage from external systems (Stripe, Paddle) via the `process_billing_event()` function, which handles idempotent webhook deduplication.
