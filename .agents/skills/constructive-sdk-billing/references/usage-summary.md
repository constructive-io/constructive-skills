# Usage Summary (Daily Rollup)

The `usage_summary` table provides a permanent monthly roll-up of usage per entity per meter. This is the user-facing billing dashboard data — it survives period resets and provides historical billing records.

## Table Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `entity_id` | uuid | Entity (org, team, user) this summary belongs to |
| `organization_id` | uuid | Resolved billable organization via `get_organization_id` |
| `entity_type` | text | Entity type prefix (e.g. `'org'`, `'team'`, `'app'`) |
| `meter_slug` | citext | Which meter this summary tracks |
| `period_start` | timestamptz | Start of the billing period for this summary row |

Additional fields track `total_usage`, `peak_usage`, and `cost` for the period.

## Rollup Lifecycle

```
Real-time usage (record_usage)
  → balances table updated (current period state)
  → ledger entries written (append-only audit)

Periodic rollup job (reconcile or scheduled)
  → Aggregates ledger/balance data per (entity, meter, period)
  → Upserts into usage_summary (one row per entity/meter/period)
  → Serves billing dashboard queries
```

The `usage_summary` table is the canonical source for historical billing:
- `balances` shows **current** state (reset each period)
- `ledger` is the full **audit trail** (append-only, very granular)
- `usage_summary` is the **aggregated** historical record (one row per entity/meter/period)

## Querying via ORM

```typescript
// Get monthly usage breakdown for an org
const summaries = await db.usageSummary.findMany({
  where: {
    entityId: { equalTo: orgId },
    periodStart: { greaterThanOrEqualTo: '2026-01-01' },
  },
  orderBy: { periodStart: 'DESC' },
  select: {
    meterSlug: true,
    periodStart: true,
    entityType: true,
  },
}).execute();

// Get usage for a specific meter over time
const apiUsage = await db.usageSummary.findMany({
  where: {
    entityId: { equalTo: orgId },
    meterSlug: { equalTo: 'api_calls' },
  },
  orderBy: { periodStart: 'ASC' },
  select: {
    periodStart: true,
    meterSlug: true,
  },
}).execute();
```
