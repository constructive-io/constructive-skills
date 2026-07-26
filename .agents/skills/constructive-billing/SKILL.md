---
name: constructive-billing
description: "Billing, limits, plans, credits, feature flags, meters, usage tracking, rate enforcement, and threshold warnings. Use for billing setup, meters, quota checks, universal credits, cap tables, LimitEnforceCounter, LimitEnforceAggregate, LimitEnforceFeature, LimitEnforceRate, LimitTrackUsage, LimitWarningCounter, LimitWarningAggregate, LimitWarningRate, plan application, credit expiration, rollover credits, or billing and limits in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Billing & Limits

Metered usage tracking, credit management, quota enforcement, and feature gating. Two systems compose together:

Use the Billing feature pack through [`constructive-blocks`](../constructive-blocks/SKILL.md) for plans, subscriptions, usage, entitlements, credits, and activity UI. Its standalone view renders host-supplied billing resources and actions; its Console module discovers and adapts the explicit `billing` endpoint. This skill owns the billing and limits behavior underneath both surfaces.

| System | Purpose |
|--------|---------|
| **Limits** | Eight blueprint nodes for counter, aggregate, feature, and rate enforcement; billing usage tracking; and threshold warnings |
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

The canonical registry exports eight `Limit*` nodes. Their names encode whether they enforce a limit, track billable usage, or emit a warning; do not use the removed `LimitCounter`, `LimitAggregate`, or `LimitFeatureFlag` names.

### Enforcement

```json
{ "$type": "LimitEnforceCounter", "data": {
  "limit_name": "projects_per_user",
  "scope": "app",
  "actor_field": "owner_id"
} }
```

`LimitEnforceCounter` increments/decrements per-actor usage on configured events. `limit_name` is required; `scope` defaults to `app`, `actor_field` to `owner_id`, and `events` to `INSERT` + `DELETE`.

```json
{ "$type": "LimitEnforceAggregate", "data": {
  "limit_name": "seats",
  "scope": "org",
  "entity_field": "entity_id"
} }
```

`LimitEnforceAggregate` enforces a counter shared by an entity. `scope` defaults to `org`, `entity_field` to `entity_id`, and `events` to `INSERT` + `DELETE`.

```json
{ "$type": "LimitEnforceFeature", "data": {
  "feature_name": "analytics_enabled",
  "scope": "org",
  "entity_field": "entity_id"
} }
```

`LimitEnforceFeature` guards inserts using `COALESCE(per-entity cap, scope default, 0) > 0`. `feature_name` is required.

```json
{ "$type": "LimitEnforceRate", "data": {
  "meter_slug": "api_requests",
  "entity_field": "entity_id",
  "actor_field": "owner_id",
  "events": ["INSERT"]
} }
```

`LimitEnforceRate` checks configured sliding-window meter limits before `INSERT` or `UPDATE`. `meter_slug` is required; it needs the billing and meter-rate-limit modules.

### Usage tracking and warnings

`LimitTrackUsage` records billing-meter usage and reversals from table events. `meter_slug` is required, `quantity` defaults to `1`, and `events` defaults to `INSERT` + `DELETE`.

The warning nodes run after inserts and enqueue a job only when a configured threshold is crossed for the first time:

| Node | Required key | Scope defaults |
|---|---|---|
| `LimitWarningCounter` | `limit_name` | `scope: app`, `actor_field: owner_id` |
| `LimitWarningAggregate` | `limit_name` | `scope: org`, `entity_field: entity_id` |
| `LimitWarningRate` | `meter_slug` | `scope: app`, `entity_field: entity_id`, `actor_field: owner_id` |

All eight nodes accept the source-defined `entity_lookup` shape where entity resolution is relevant: `obj_table` and `obj_field` are required inside it, while `obj_schema` is optional.

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
- **Billing feature-pack UI:** [`constructive-blocks`](../constructive-blocks/SKILL.md)
