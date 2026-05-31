---
name: constructive-billing
description: "Billing, limits, plans, credits, feature flags, meters, and usage tracking. Use when asked to 'set up billing', 'create meters', 'grant credits', 'record usage', 'check quota', 'universal credits', 'billing provider', 'set up limits', 'feature flags', 'cap tables', 'LimitCounter', 'LimitAggregate', 'LimitFeatureFlag', 'apply plan', 'transfer quota', 'credit expiration', 'rollover credits', or when working with billing or limits in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Billing & Limits

Metered usage tracking, credit management, quota enforcement, and feature gating. Two systems compose together:

| System | Purpose |
|--------|---------|
| **Limits** | Blueprint-level nodes (`LimitCounter`, `LimitAggregate`, `LimitFeatureFlag`) for row-level enforcement |
| **Billing** | Meter-based usage tracking, credit grants, universal credits waterfall, billing provider bridge |

## When to Apply

Use this skill when:
- Adding metered limits to tables (per-user or per-entity quotas)
- Creating feature flags (boolean gates per entity/plan)
- Setting up billing meters, recording usage, checking quotas
- Granting credits (permanent, period, rollover, with expiration)
- Configuring universal credits as a fallback pool
- Integrating with billing providers (Stripe, Paddle)
- Managing plans and cap tables

## Limits (Blueprint Nodes)

Three blueprint nodes cover all limit enforcement:

### LimitCounter — Per-User Metered Limits

```json
{ "$type": "LimitCounter", "data": {
  "limit_name": "projects_per_user",
  "default_max": 10
}}
```

Fires a trigger on INSERT that checks `user_limit_counter < max`. Rejects with `LIMIT_EXCEEDED` if over quota.

### LimitAggregate — Per-Entity Aggregate Limits

```json
{ "$type": "LimitAggregate", "data": {
  "limit_name": "seats",
  "default_max": 50
}}
```

Counts total rows per entity (e.g., "50 seats per org").

### LimitFeatureFlag — Boolean Feature Gates

```json
{ "$type": "LimitFeatureFlag", "data": {
  "limit_name": "analytics_enabled"
}}
```

Gates access based on `limit_caps_defaults` (max=0 → disabled, max=1 → enabled).

## Billing Meters

A meter defines a billable dimension (API calls, storage, seats):

| Property | Purpose |
|----------|---------|
| `slug` | Unique identifier (`llm_input_tokens`, `storage_gb`, `universal`) |
| `unit` | What "1" means (`tokens`, `characters`, `seconds`, `pages`) |
| `credit_cost` | Universal credits per unit (NULL = no fallback) |
| `period_interval` | Reset cadence (`'1 month'`, `'1 year'`, NULL = never) |
| `rollover_cap` | Max unused units carried forward on reset |

### Recording Usage

```typescript
await db.mutation.recordUsage({
  input: { meterSlug: 'api_calls', quantity: 1 },
}).execute();
```

### Checking Quota

```typescript
const quota = await db.mutation.checkBillingQuota({
  input: { meterSlug: 'api_calls', quantity: 1 },
}).execute();
// quota.allowed === true/false
```

## Credits

Granted via `meter_credits` (append-only). Three types:

| Type | On Period Reset | Example |
|------|-----------------|---------|
| `permanent` | Survives indefinitely | One-time purchase |
| `period` | Zeroed completely | "1000 calls/month with Pro" |
| `rollover` | Unused carries forward (capped) | "Unused credits roll over, max 500" |

Credits can have `expires_at` for lazy expiration enforcement.

## Universal Credits

A fallback pool shared across meters. A meter opts in by setting `credit_cost > 0`. When a meter's own quota is exceeded, the system deducts `credit_cost * quantity` from the `universal` meter's balance.

## Cap Tables & Plans

- `limit_caps_defaults` — per-scope default values for all limit nodes
- `limit_caps` — per-entity overrides (e.g., "this org gets 100 projects")
- Plans are expressed as cap table presets applied to entities

## Billing Provider Bridge

`billing_provider_module` provides:
- `billing_customers` — customer records linked to external providers
- `billing_products` — product/plan catalog
- `billing_subscriptions` — subscription state
- `billing_events` — webhook dedup via `process_billing_event()`

## References

| File | Content |
|------|---------|
| [limits.md](./references/limits.md) | Full limits reference (blueprint nodes, ORM ops, cap tables) |
| [billing.md](./references/billing.md) | Billing meters, credits, usage, universal credits |
| [warning-system.md](./references/warning-system.md) | Usage warnings and threshold alerts |
| [category-meter.md](./references/category-meter.md) | Category-based meter grouping |
| [meter-sources.md](./references/meter-sources.md) | Meter source configuration |
| [usage-summary.md](./references/usage-summary.md) | Usage rollup and summary views |

## Cross-References

- **Events and achievement rewards:** [`constructive-events`](../constructive-events/SKILL.md)
- **Entity types (per-entity limits):** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
