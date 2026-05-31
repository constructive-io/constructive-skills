# Meter Sources (Automated Reconciliation)

The `meter_sources` table maps billing meters to typed daily summary table columns for automated usage reconciliation via `reconcile_typed_usage()`. Each row tells the reconciler which column to aggregate and how.

## Table Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `meter_slug` | text | Billing meter this source feeds (unique, indexed) |
| `source_metric` | text | Source table type: `table_usage`, `query_time`, or `row_count` |
| `dimension_path` | text | Column path within the source table to aggregate |
| `aggregation_type` | text | How to aggregate: `sum`, `max`, `avg`, etc. |
| `is_active` | boolean | Enable/disable this source without deleting |

## Source Metric Types

- `table_usage` — reads from `usage_summary_db_table_stats_daily`
- `query_time` — reads from `usage_summary_db_query_stats_daily`
- `row_count` — trigger-based counting (skipped by reconcile, updated in real time)

## Configuring via ORM

```typescript
// Map storage_gb meter to the table_usage daily summary
await db.meterSource.create({
  data: {
    meterSlug: 'storage_gb',
    sourceMetric: 'table_usage',
    dimensionPath: 'total_bytes',
    aggregationType: 'sum',
    isActive: true,
  },
  select: { id: true },
}).execute();

// Map query_time_seconds meter
await db.meterSource.create({
  data: {
    meterSlug: 'query_time_seconds',
    sourceMetric: 'query_time',
    dimensionPath: 'total_exec_time',
    aggregationType: 'sum',
    isActive: true,
  },
  select: { id: true },
}).execute();
```

## Reconciliation Flow

When `reconcile_typed_usage()` runs (typically via scheduled job):

1. Reads all active `meter_sources` rows
2. For each source, queries the corresponding daily summary table using `dimension_path`
3. Applies `aggregation_type` to compute the total per entity
4. Calls `record_usage()` with the aggregated value per entity

This automates billing for infrastructure-level metrics (storage, query time) that aren't tracked by application-level `record_usage` calls.
