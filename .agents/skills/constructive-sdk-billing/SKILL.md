---
name: constructive-sdk-billing
description: SDK-level guide to the Constructive billing system — provisioning meters, granting credits (permanent/period/rollover with expiration), recording usage, checking quotas, universal credits waterfall, and the billing provider bridge. Use when asked to 'set up billing', 'create meters', 'grant credits', 'record usage', 'check quota', 'universal credits', 'billing provider', 'credit expiration', 'rollover credits', 'period reset', or when working with billing in blueprints or the ORM.
---

# Constructive Billing (SDK-Level Guide)

The billing system provides metered usage tracking, credit management, and quota enforcement. It is split into two independent modules that compose together:

| Module | Purpose |
|---|---|
| `billing_module` | Meters, balances, ledger, credits, usage tracking, universal credits |
| `billing_provider_module` | External provider bridge (Stripe, Paddle), webhook dedup |

Related skills:
- **`constructive-db-billing`** (private): SQL-level internals, AST code generation pipeline, locking patterns
- **`constructive-safegres`**: Authorization policy types used by billing RLS
- **`constructive-sdk-security`**: How to provision RLS and grants via SDK
- **`constructive-platform`**: Blueprint provisioning overview

---

## Concepts

### Meters

A meter defines **what** you track. Each meter is a billable dimension (API calls, storage, seats, etc.).

Key properties:
- **slug**: unique identifier (`api_requests`, `storage_gb`, `universal`)
- **credit_cost**: universal credits consumed per unit (NULL = no fallback to universal pool)
- **period_interval**: reset cadence (`'1 month'`, `'1 year'`, NULL = never resets)
- **rollover_cap**: max unused units carried forward on reset (NULL = unlimited rollover)

### Balances

One row per (entity, meter). Tracks current state without needing to aggregate the ledger. Updated atomically by `record_usage` under row-level locks.

Key fields: `current_usage`, `effective_limit`, `purchased_credits`, `period_start`, `period_credits`, `rollover_credits`, `next_expires_at`.

### Credits

Credits are granted via the `meter_credits` table (append-only). An AFTER INSERT trigger automatically updates the balance and writes a ledger entry. Three credit types control reset behavior:

| Type | On period reset | Example |
|---|---|---|
| `permanent` | Survives indefinitely | One-time purchase, promo code |
| `period` | Zeroed completely | "1000 API calls/month included with Pro" |
| `rollover` | Unused portion carries forward (capped) | "Unused credits roll over, max 500" |

Credits can also have an `expires_at` timestamp. Expired credits are automatically removed on next access (lazy enforcement).

### Universal Credits

A fallback credit pool shared across meters. A meter opts in by setting `credit_cost > 0`. When a meter's own quota is exceeded, the system automatically deducts `credit_cost * quantity` from the `universal` meter's balance.

The universal meter is just a regular meter with slug `'universal'` — it has its own balance, credits, and period settings.

---

## Blueprint Provisioning

### billing_module

Enable billing in your blueprint's modules list:

```ts
modules: ['billing_module']
```

This creates:
- `meters` table (public schema) — meter definitions
- `balances` table (private schema) — per-entity usage state
- `ledger` table (public schema) — append-only audit trail
- `meter_credits` table (public schema) — credit grants
- `record_usage()` function (private, SECURITY DEFINER) — usage recording + enforcement
- `check_billing_quota()` function (private, SECURITY DEFINER, STABLE) — read-only capacity check
- `meter_credits_trigger` (AFTER INSERT on meter_credits) — auto-updates balances on credit grant

### billing_provider_module

Optional bridge to external payment providers:

```ts
modules: ['billing_module', 'billing_provider_module']
```

This adds:
- `billing_customers` — maps entities to Stripe/Paddle customer IDs
- `billing_products` — maps internal products to external product IDs
- `billing_subscriptions` — subscription lifecycle tracking
- `billing_events` — webhook dedup via idempotency key
- `process_billing_event()` function — idempotent dedup gate

---

## Setting Up Meters (via ORM)

After provisioning, configure meters by creating rows via the ORM:

```ts
// Monthly API quota
await db.meter.create({
  data: {
    slug: 'api_calls',
    displayName: 'API Calls',
    meterType: 'quota',
    periodInterval: '1 month',
  },
});

// Storage (never resets)
await db.meter.create({
  data: {
    slug: 'storage_gb',
    displayName: 'Storage (GB)',
    meterType: 'quota',
  },
});

// Universal credit pool (monthly reset)
await db.meter.create({
  data: {
    slug: 'universal',
    displayName: 'Universal Credits',
    meterType: 'credit_pool',
    periodInterval: '1 month',
  },
});

// API calls fall back to universal credits (2 credits per call)
await db.meter.update({
  where: { slug: 'api_calls' },
  data: { creditCost: 2 },
});

// Monthly tokens with rollover (max 500 carry forward)
await db.meter.create({
  data: {
    slug: 'tokens',
    displayName: 'Tokens',
    meterType: 'quota',
    periodInterval: '1 month',
    rolloverCap: 500,
  },
});
```

---

## Granting Credits (via ORM)

Credits are granted by inserting into `meter_credits`. The trigger handles balance updates and ledger entries automatically.

```ts
// Monthly plan grant (resets each period)
await db.meterCredit.create({
  data: {
    meterId: meterId,
    entityId: entityId,
    amount: 1000,
    creditType: 'period',
    reason: 'plan:pro_monthly',
  },
});

// One-time permanent purchase
await db.meterCredit.create({
  data: {
    meterId: meterId,
    entityId: entityId,
    amount: 500,
    creditType: 'permanent',
    reason: 'purchase:invoice_123',
  },
});

// Rollover bonus credits
await db.meterCredit.create({
  data: {
    meterId: meterId,
    entityId: entityId,
    amount: 200,
    creditType: 'rollover',
  },
});

// Promo credits that expire at year end
await db.meterCredit.create({
  data: {
    meterId: meterId,
    entityId: entityId,
    amount: 500,
    creditType: 'permanent',
    expiresAt: '2026-12-31T00:00:00Z',
    reason: 'promo:WELCOME2026',
  },
});
```

### What happens on credit grant:
1. Trigger looks up the meter slug
2. Upserts balance row (creates if not exists)
3. Adds amount to `purchased_credits` and `effective_limit`
4. If `period` type: also increments `period_credits`
5. If `rollover` type: also increments `rollover_credits`
6. If `expires_at` set: updates `next_expires_at` (MIN tracking)
7. Writes a `credit_purchase` ledger entry

---

## Recording Usage

`record_usage` is a SECURITY DEFINER function on the private schema. Call it from cloud functions (Knative workers) or custom GraphQL mutations with service-role access:

```ts
// In a Knative cloud function with service-role credentials:
const result = await client.recordUsage({
  slug: 'api_calls',
  entityId: entityId,
  quantity: 10,
  metadata: { requestId: 'abc123' },
});
// Returns: boolean (true = allowed, false = over quota or meter not found)
```

### What happens internally:
1. Locks the balance row (prevents concurrent races)
2. Lazy-inits balance if this is the first access
3. Removes expired credits (if any have passed their `expires_at`)
4. Resets period if elapsed (zeroes usage, handles rollover math)
5. Checks quota; if over limit, tries universal credits waterfall
6. Updates balance and writes ledger entry

### Quantity
`quantity` defaults to 0 — callers must specify explicitly.

---

## Checking Quotas

`check_billing_quota` is a **read-only** capacity check (STABLE function):

```ts
const hasCapacity = await client.checkBillingQuota({
  slug: 'api_calls',
  entityId: entityId,
  quantity: 10,
});
// Returns: boolean (true = has capacity, false = would exceed quota)
```

This is a **hint, not a guarantee** — no locks, no writes. Safe for use in RLS policies. The actual enforcement happens in `record_usage`.

### Using as an RLS policy gate
`check_billing_quota` is STABLE, so PostgreSQL can use it in RLS policy expressions without per-row side effects. This enables automatic quota enforcement at the database level.

---

## Lazy Behaviors (No Cron Needed)

The billing system handles three operations lazily on access — no external scheduler or cron job required:

### 1. Period Reset
When `period_interval` is set and the period has elapsed, `record_usage` automatically:
- Zeros `current_usage`
- Removes `period` credits from the balance
- Carries forward unused `rollover` credits (capped by `rollover_cap`)
- Writes `reset` and `rollover` ledger entries
- Advances `period_start` to the new period boundary

### 2. Credit Expiration
When credits have `expires_at` in the past, `record_usage` automatically:
- Aggregates expired credit amounts by type
- Removes expired amounts from the balance counters
- Writes an `expired` ledger entry
- Updates `next_expires_at` to the next soonest expiration (or NULL)

Expiration runs **before** period reset to prevent expired credits from inflating rollover calculations.

### 3. Balance Lazy-Init
On first usage for a given entity+meter pair, `record_usage` creates the balance row automatically. No explicit initialization step is needed.

---

## Universal Credits Waterfall

When a meter's quota is exceeded and `credit_cost` is set:

1. Meter's own limit is exceeded
2. System checks if `credit_cost > 0` (meter opts into universal fallback)
3. Locks the universal meter's balance
4. Computes cost = `credit_cost * quantity`
5. If universal pool has capacity: deducts and allows the operation
6. If universal pool is exhausted: rejects the operation

The universal meter is just a regular meter with slug `'universal'`. It has its own balance, credits, period settings, and can even have rollover and expiration — everything composes.

---

## Billing Provider Bridge

The `billing_provider_module` maps external payment events to internal billing operations.

### Webhook Processing

The `process_billing_event` function provides idempotent webhook dedup:

```ts
const isNewEvent = await client.processBillingEvent({
  provider: 'stripe',
  idempotencyKey: stripeEvent.id,
  payload: stripeEvent,
});

if (isNewEvent) {
  // Process the event: grant credits, update subscriptions, etc.
}
```

The function uses an idempotency key to ensure each webhook is processed exactly once, even if the provider retries delivery.

### Provider Tables

| Table | Purpose |
|---|---|
| `billing_customers` | Maps `(provider, entity_id)` to external customer IDs |
| `billing_products` | Maps `(provider, resource_id)` to external product IDs |
| `billing_subscriptions` | Subscription lifecycle (status, period boundaries, metadata) |
| `billing_events` | Webhook dedup via `(provider, idempotency_key)` uniqueness |

---

## Ledger Entry Types

All state changes are recorded in the append-only `ledger` table for full audit trail:

| Entry Type | When | Delta |
|---|---|---|
| `increment` | `record_usage` records consumption | +quantity |
| `credit_purchase` | Credit inserted via `meter_credits` | +amount |
| `reset` | Period reset zeroes usage | -old_usage |
| `rollover` | Unused credits carry forward | +rollover_amount |
| `expired` | Expired credits removed | -expired_total |
| `credit_deduction` | Universal credits consumed via waterfall | +cost (on universal meter) |
| `adjustment` | Manual admin adjustment | +/- amount |

---

## SDK Usage Patterns

> **Note:** Full SDK types require codegen regeneration after provisioning the billing module. The ORM patterns below show the expected shape based on the table structure.

### Reading balances

```ts
const balance = await db.balance.findFirst({
  where: {
    entityId: entityId,
    meterSlug: 'api_calls',
  },
  select: {
    currentUsage: true,
    effectiveLimit: true,
    purchasedCredits: true,
    periodStart: true,
    periodCredits: true,
    rolloverCredits: true,
    nextExpiresAt: true,
  },
});
```

### Reading ledger history

```ts
const entries = await db.ledger.findMany({
  where: { entityId: entityId, meterSlug: 'api_calls' },
  orderBy: { createdAt: 'DESC' },
  take: 50,
  select: {
    delta: true,
    usageAfter: true,
    entryType: true,
    ledgerClass: true,
    metadata: true,
    createdAt: true,
  },
});
```

---

## Common Patterns

### Monthly SaaS with overage billing
1. Create an `api_calls` meter with `periodInterval: '1 month'` and `creditCost: 1`
2. Create a `universal` meter with `periodInterval: '1 month'`
3. Grant `period` credits on the API calls meter (monthly plan allowance)
4. Grant `period` credits on the universal meter (overage budget)
5. When the monthly allowance is used up, overages automatically draw from universal credits

### Promotional credits with expiration
- Grant `permanent` credits with an `expiresAt` date and a `reason` (e.g. `'promo:SUMMER2026'`)
- Credits are usable immediately and auto-removed after expiration on next access
- No cron needed — lazy enforcement handles cleanup

### Rollover credits (use it or carry it)
1. Create a meter with `periodInterval: '1 month'` and `rolloverCap: 500`
2. Grant `rollover` credits on that meter
3. Each month, unused credits carry forward up to the cap
4. Rollover credits that themselves go unused in the next period are re-evaluated against the cap

### Feature gating via quota check
1. Create a meter with no period (permanent capacity)
2. Grant 1 `permanent` credit to enable the feature
3. Use `check_billing_quota` in RLS policies or application code as a boolean gate
4. The STABLE function property ensures safe use in RLS without per-row side effects

### Per-entity credit configuration
A single meter can have all three credit types simultaneously:
- **period** credits: monthly plan allowance (zeroed on reset)
- **permanent** credits: one-time purchases that never expire
- **rollover** credits: bonus credits where unused portion carries forward

The admin chooses the credit type when granting — the system handles the rest.
