# Usage Summary

Rollup and summary views for billing usage data.

## Rollup Process

Raw usage events in the ledger are aggregated into daily usage summaries per (entity, meter). This reduces query load for dashboards and reporting.

## Summary Views

- **Per-meter summary** — current usage, effective limit, remaining quota
- **Per-entity summary** — total usage across all meters for an entity
- **Per-category summary** — usage grouped by meter category

## Period Boundaries

Summaries respect meter `period_interval` settings. On period reset, `period_credits` are zeroed, `rollover_credits` are calculated (capped by `rollover_cap`), and `current_usage` resets to zero.
