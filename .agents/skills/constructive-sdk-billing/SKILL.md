---
name: constructive-sdk-billing
description: SDK-level guide to the Constructive billing system — provisioning meters, granting credits (permanent/period/rollover with expiration), recording usage, checking quotas, universal credits waterfall, billing provider bridge, meter_sources (automated reconciliation), usage_summary (daily rollup), and category_meter (three-tier credit waterfall). Use when asked to 'set up billing', 'create meters', 'grant credits', 'record usage', 'check quota', 'universal credits', 'billing provider', 'credit expiration', 'rollover credits', 'period reset', 'meter_sources', 'usage_summary', 'category_meter', 'reconcile usage', 'billing dashboard', 'category credits', or when working with billing in blueprints or the ORM.
---

# Constructive Billing (SDK-Level Guide)

The billing system provides metered usage tracking, credit management, and quota enforcement. It is split into two independent modules that compose together:

| Module | Purpose |
|---|---|
| `billing_module` | Meters, balances, ledger, credits, usage tracking, universal credits |
| `billing_provider_module` | External provider bridge (Stripe, Paddle), webhook dedup |

Related skills:
- **`constructive-db-billing`**: SQL-level internals, AST code generation pipeline, locking patterns
- **`constructive-safegres`**: Authorization policy types used by billing RLS
- **`constructive-sdk-security`**: How to provision RLS and grants via SDK
- **`constructive-platform`**: Blueprint provisioning overview

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        billing_module                               │
│                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────────┐  │
│  │  meters   │   │ balances  │   │  ledger  │   │ meter_credits │  │
│  │ (config)  │   │ (state)   │   │ (audit)  │   │ (grants)      │  │
│  └─────┬─────┘   └─────┬─────┘   └────┬─────┘   └───────┬───────┘  │
│        │               │              │                  │          │
│        └───────┬───────┘              │                  │          │
│                │                      │                  │          │
│         record_usage()  ──────────────┘                  │          │
│         check_billing_quota()                            │          │
│                                          meter_credits_trigger()    │
│                                        (auto-updates balance)       │
├─────────────────────────────────────────────────────────────────────┤
│                   billing_provider_module (optional)                 │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │ billing_customers │  │ billing_products  │  │ billing_events  │   │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘   │
│  ┌──────────────────────┐                                           │
│  │ billing_subscriptions │   process_billing_event()                │
│  └──────────────────────┘   (idempotent webhook dedup)              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Concepts

### Meters

A meter defines **what** you track. Each meter is a billable dimension (API calls, storage, seats, etc.).

Key properties:
- **slug**: unique identifier (`llm_input_tokens`, `tts_characters`, `storage_gb`, `universal`)
- **unit**: what "1" means for this meter (`tokens`, `characters`, `seconds`, `pages`, `images`, `requests`, etc.)
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
- `meters` table — meter definitions and configuration
- `balances` table — per-entity usage state (locked during writes)
- `ledger` table — append-only audit trail of all state changes
- `meter_credits` table — credit grants (trigger auto-updates balances)
- `record_usage()` — usage recording + enforcement (SECURITY DEFINER)
- `check_billing_quota()` — read-only capacity check (SECURITY DEFINER, STABLE)
- `meter_credits_trigger` — AFTER INSERT trigger on meter_credits

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
- `process_billing_event()` — idempotent dedup gate

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

### Credit Grant Flow (pseudocode)

```
ON INSERT into meter_credits:
  meter = LOOKUP meter by meter_id
  balance = UPSERT balance for (entity_id, meter.slug)

  balance.purchased_credits += amount
  balance.effective_limit = balance.plan_limit + balance.purchased_credits

  IF credit_type = 'period':
    balance.period_credits += amount

  IF credit_type = 'rollover':
    balance.rollover_credits += amount

  IF expires_at IS SET:
    balance.next_expires_at = MIN(balance.next_expires_at, expires_at)

  WRITE ledger entry (type: 'credit_purchase', delta: +amount)
```

---

## Recording Usage

`record_usage` is a SECURITY DEFINER function. Call it from cloud functions (Knative workers) or custom GraphQL mutations with service-role access:

```ts
const result = await client.recordUsage({
  slug: 'api_calls',
  entityId: entityId,
  quantity: 10,
  metadata: { requestId: 'abc123' },
});
// Returns: boolean (true = allowed, false = over quota or meter not found)
```

### `record_usage` Full Flow (pseudocode)

```
FUNCTION record_usage(slug, entity_id, quantity, metadata):
  meter = LOOKUP meter by slug
  IF meter NOT FOUND: RETURN false

  balance = LOCK balance row for (entity_id, slug)   ← FOR UPDATE
  IF balance NOT FOUND:
    balance = CREATE default balance row              ← lazy-init
    LOCK the new row

  ┌──────────────────────────────────────────────┐
  │ PHASE 1: Credit Expiration                   │
  │ (runs BEFORE period reset)                   │
  ├──────────────────────────────────────────────┤
  │ IF balance.next_expires_at <= now():         │
  │   expired = AGGREGATE expired credits        │
  │   FOR EACH type (permanent, period, rollover)│
  │     balance.purchased_credits -= amount      │
  │     IF type = period:                        │
  │       balance.period_credits -= amount       │
  │     IF type = rollover:                      │
  │       balance.rollover_credits -= amount     │
  │   DELETE expired credit rows                 │
  │   RECALCULATE effective_limit                │
  │   UPDATE next_expires_at to next soonest     │
  │   WRITE ledger (type: 'expired')             │
  └──────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────┐
  │ PHASE 2: Period Reset                        │
  │ (runs AFTER expiration)                      │
  ├──────────────────────────────────────────────┤
  │ IF meter.period_interval IS NOT NULL         │
  │   AND balance.period_start                   │
  │       + meter.period_interval <= now():      │
  │                                              │
  │   unused = effective_limit - current_usage   │
  │                                              │
  │   // Handle rollover                         │
  │   IF balance.rollover_credits > 0:           │
  │     rollover = MIN(unused, rollover_credits, │
  │                    meter.rollover_cap)        │
  │     balance.purchased_credits -= rollover_cr │
  │     balance.purchased_credits += rollover    │
  │     balance.rollover_credits = rollover      │
  │     WRITE ledger (type: 'rollover')          │
  │                                              │
  │   // Zero period credits                     │
  │   balance.purchased_credits -= period_credits│
  │   balance.period_credits = 0                 │
  │                                              │
  │   // Reset usage counter                     │
  │   WRITE ledger (type: 'reset',               │
  │                 delta: -current_usage)        │
  │   balance.current_usage = 0                  │
  │   RECALCULATE effective_limit                │
  │   balance.period_start = now()               │
  └──────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────┐
  │ PHASE 3: Quota Check + Universal Waterfall   │
  ├──────────────────────────────────────────────┤
  │ new_usage = balance.current_usage + quantity  │
  │                                              │
  │ IF new_usage <= balance.effective_limit:      │
  │   → ALLOW (meter has capacity)               │
  │                                              │
  │ ELSE IF meter.credit_cost > 0:               │
  │   → TRY universal credits waterfall          │
  │   (see "Universal Credits Waterfall" below)  │
  │                                              │
  │ ELSE:                                        │
  │   → REJECT (over quota, no fallback)         │
  └──────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────┐
  │ PHASE 4: Record Usage                        │
  ├──────────────────────────────────────────────┤
  │ balance.current_usage += quantity             │
  │ UPDATE balance                               │
  │ WRITE ledger (type: 'increment',             │
  │               delta: +quantity)               │
  │ RETURN true                                  │
  └──────────────────────────────────────────────┘
```

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

### `check_billing_quota` Flow (pseudocode)

```
FUNCTION check_billing_quota(slug, entity_id, quantity):
  meter = LOOKUP meter by slug
  IF meter NOT FOUND: RETURN false

  balance = READ balance for (entity_id, slug)   ← NO lock (read-only)
  IF balance NOT FOUND: RETURN true               ← no usage yet = OK

  // Simulate expiration in local variables (no writes)
  check_usage = balance.current_usage
  check_limit = balance.effective_limit

  IF balance.next_expires_at <= now():
    expired_total = SUM expired credit amounts
    check_limit -= expired_total

  // Simulate period reset in local variables (no writes)
  IF meter.period_interval IS NOT NULL
    AND balance.period_start + meter.period_interval <= now():
    check_usage = 0
    check_limit = RECALCULATE (plan_limit + adjusted credits)

  // Check capacity
  IF check_usage + quantity <= check_limit:
    RETURN true

  // Try universal waterfall (also read-only)
  IF meter.credit_cost > 0:
    universal_balance = READ balance for (entity_id, 'universal')
    cost = meter.credit_cost * quantity
    IF universal has capacity for cost: RETURN true

  RETURN false
```

**Important:** This function is STABLE (read-only, no side effects). It is safe for use in RLS policy expressions — PostgreSQL will not trigger per-row writes.

---

## Period Reset (Detail)

Periods define billing cycles per meter. Each meter independently decides its reset cadence.

### Configuration

| `period_interval` value | Behavior |
|---|---|
| `'1 month'` | Monthly reset cycle |
| `'1 year'` | Annual reset cycle |
| `'7 days'` | Weekly reset cycle |
| `NULL` | No reset — credits accumulate forever (accrual mode) |

### Period Reset Timeline

```
Period 1                    Period 2                    Period 3
├────────────────────────┤├────────────────────────┤├──────────
│ period_start            │ period_start            │ period_start
│                         │                         │
│ usage accumulates...    │ usage accumulates...    │ ...
│ ─────────────>          │ ─────────────>          │
│                         │                         │
│ AT PERIOD BOUNDARY:     │                         │
│ 1. current_usage → 0   │                         │
│ 2. period credits → 0  │                         │
│ 3. rollover calculated │                         │
│ 4. period_start = now() │                         │
```

### What resets vs what doesn't

```
                     Period reset
                         │
 ┌───────────────────────┼───────────────────────┐
 │     ZEROED            │     SURVIVES           │
 ├───────────────────────┼───────────────────────┤
 │ current_usage → 0     │ permanent credits      │
 │ period_credits → 0    │ plan_limit             │
 │                       │ rollover (up to cap)   │
 └───────────────────────┴───────────────────────┘
```

---

## Credit Expiration (Detail)

Credits can have an `expires_at` timestamp. Expiration is enforced lazily — expired credits are cleaned up on the next call to `record_usage`.

### Expiration Flow (pseudocode)

```
// Runs inside record_usage, BEFORE period reset

IF balance.next_expires_at <= now():
  expired_credits = FIND all meter_credits
    WHERE entity_id = entity AND meter_id = meter
    AND expires_at <= now()

  // Aggregate by type
  expired_permanent = SUM(amount) WHERE credit_type = 'permanent'
  expired_period    = SUM(amount) WHERE credit_type = 'period'
  expired_rollover  = SUM(amount) WHERE credit_type = 'rollover'
  expired_total     = expired_permanent + expired_period + expired_rollover

  // Subtract from balance
  balance.purchased_credits -= expired_total
  balance.period_credits    -= expired_period
  balance.rollover_credits  -= expired_rollover
  balance.effective_limit   = balance.plan_limit + balance.purchased_credits

  // Clean up
  DELETE expired credit rows
  balance.next_expires_at = MIN(remaining credits' expires_at) or NULL
  WRITE ledger (type: 'expired', delta: -expired_total)
```

### Why expiration runs before period reset

```
  record_usage called
         │
         ▼
  ┌─────────────────┐
  │  1. EXPIRATION   │  ← Remove dead credits first
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  2. PERIOD RESET │  ← Rollover calculated on surviving credits only
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  3. QUOTA CHECK  │  ← Check against clean state
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  4. RECORD USAGE │
  └─────────────────┘
```

If expiration ran after reset, expired credits could inflate the rollover calculation — carrying forward credits that should already be gone.

---

## Rollover Credits (Detail)

Rollover credits carry unused capacity forward across period resets, up to a configurable cap.

### Rollover Calculation (pseudocode)

```
// Runs during period reset, inside record_usage

unused = balance.effective_limit - balance.current_usage

IF balance.rollover_credits > 0:
  // How much can carry forward?
  rollover_amount = MIN(
    unused,                    // can't roll over more than was unused
    balance.rollover_credits,  // can't roll over more than rollover pool
    meter.rollover_cap         // can't exceed the cap (NULL = unlimited)
  )

  // Replace old rollover with new
  balance.purchased_credits -= balance.rollover_credits   // remove old
  balance.purchased_credits += rollover_amount             // add carried
  balance.rollover_credits = rollover_amount               // track new

  WRITE ledger (type: 'rollover', delta: +rollover_amount)
```

### Rollover Example

```
Month 1: rollover_credits = 1000, rollover_cap = 500, used 700 of 1500 limit
  unused = 1500 - 700 = 800
  rollover = MIN(800, 1000, 500) = 500  ← capped at rollover_cap
  → 500 credits carry to Month 2

Month 2: rollover_credits = 500, used 0 of 1200 limit
  unused = 1200 - 0 = 1200
  rollover = MIN(1200, 500, 500) = 500  ← full rollover carries again
  → 500 credits carry to Month 3

Month 3: rollover_credits = 500, used 1200 of 1200 limit
  unused = 1200 - 1200 = 0
  rollover = MIN(0, 500, 500) = 0       ← nothing unused to roll over
  → 0 credits carry to Month 4
```

---

## Universal Credits Waterfall (Detail)

When a meter's own quota is exceeded, the system can fall back to a shared universal credit pool.

### Waterfall Flow (pseudocode)

```
// Inside record_usage, after quota check fails

IF meter.credit_cost IS NULL OR meter.credit_cost = 0:
  RETURN false  ← no universal fallback configured

cost = meter.credit_cost * quantity

universal_balance = LOCK balance for (entity_id, 'universal')

IF universal_balance NOT FOUND:
  RETURN false  ← no universal pool

// Apply same lazy checks to universal balance
RUN expiration check on universal_balance
RUN period reset on universal_balance

IF universal_balance.current_usage + cost > universal_balance.effective_limit:
  RETURN false  ← universal pool exhausted

// Deduct from universal
universal_balance.current_usage += cost
WRITE ledger on universal meter (type: 'credit_deduction', delta: +cost)
RETURN true  ← allowed via universal credits
```

### Waterfall Diagram

```
  record_usage('api_calls', entity, 10)
         │
         ▼
  ┌──────────────────────┐
  │ api_calls balance     │
  │ usage: 950 / limit: 1000 │
  │ 950 + 10 = 960 ≤ 1000│
  │ → ALLOW (own quota)   │
  └──────────────────────┘

  record_usage('api_calls', entity, 100)
         │
         ▼
  ┌──────────────────────┐
  │ api_calls balance     │
  │ usage: 960 / limit: 1000 │
  │ 960 + 100 = 1060 > 1000 │
  │ → OVER LIMIT          │
  │ credit_cost = 2       │
  └──────────┬───────────┘
             │ cost = 2 * 100 = 200
             ▼
  ┌──────────────────────┐
  │ universal balance     │
  │ usage: 300 / limit: 500 │
  │ 300 + 200 = 500 ≤ 500│
  │ → ALLOW (via universal)│
  └──────────────────────┘

  record_usage('api_calls', entity, 50)
         │
         ▼
  ┌──────────────────────┐
  │ api_calls balance     │
  │ usage: 1060 / limit: 1000│
  │ 1060 + 50 = 1110 > 1000│
  │ → OVER LIMIT          │
  │ credit_cost = 2       │
  └──────────┬───────────┘
             │ cost = 2 * 50 = 100
             ▼
  ┌──────────────────────┐
  │ universal balance     │
  │ usage: 500 / limit: 500 │
  │ 500 + 100 = 600 > 500│
  │ → REJECT (exhausted)  │
  └──────────────────────┘
```

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

### Webhook Dedup Flow (pseudocode)

```
FUNCTION process_billing_event(provider, idempotency_key, payload):
  TRY INSERT into billing_events (provider, idempotency_key, payload)
    ON CONFLICT (provider, idempotency_key) DO NOTHING

  IF row was inserted:
    RETURN true   ← new event, proceed with processing
  ELSE:
    RETURN false  ← duplicate, skip
```

### Provider Tables

| Table | Purpose |
|---|---|
| `billing_customers` | Maps `(provider, entity_id)` to external customer IDs |
| `billing_products` | Maps `(provider, resource_id)` to external product IDs |
| `billing_subscriptions` | Subscription lifecycle (status, period boundaries, metadata) |
| `billing_events` | Webhook dedup via `(provider, idempotency_key)` uniqueness |

### Provider Integration Flow

```
  Stripe/Paddle webhook
         │
         ▼
  ┌─────────────────────┐
  │ Cloud Function       │
  │ (Knative worker)     │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ process_billing_event│  ← Dedup check
  │ (idempotency_key)   │
  └──────────┬──────────┘
         ┌───┴───┐
         │       │
      new     duplicate
         │       │
         ▼       ▼
  Process event  Skip
  (grant credits,
   update sub,
   etc.)
```

---

## Meter Sources (Automated Reconciliation)

The `meter_sources` table maps billing meters to typed daily summary table columns for automated usage reconciliation. Each row tells `reconcile_typed_usage()` which column to aggregate from which summary table.

Source metric types: `table_usage` (from `usage_summary_db_table_stats_daily`), `query_time` (from `usage_summary_db_query_stats_daily`), `row_count` (trigger-based, skipped by reconcile).

```typescript
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
```

See [meter-sources.md](./references/meter-sources.md) for full schema, reconciliation flow, and additional examples.

---

## Usage Summary (Daily Rollup)

The `usage_summary` table provides permanent monthly roll-ups per entity per meter for billing dashboards. Key columns: `entity_id`, `organization_id`, `entity_type`, `meter_slug`, `period_start`.

```typescript
const summaries = await db.usageSummary.findMany({
  where: { entityId: { equalTo: orgId } },
  orderBy: { periodStart: 'DESC' },
  select: { meterSlug: true, periodStart: true, entityType: true },
}).execute();
```

See [usage-summary.md](./references/usage-summary.md) for rollup lifecycle, table schema, and query patterns.

---

## Category Meter (Three-Tier Credit Waterfall)

The `category_meter` column on `meters` (citext FK) groups meters into categories, enabling a three-tier waterfall: **meter → category → universal**.

```typescript
// Create category pool + assign meters
await db.meter.create({ data: { slug: 'ai_credits', displayName: 'AI Credits Pool', meterType: 'credit_pool', periodInterval: '1 month' } });
await db.meter.update({ where: { slug: 'llm_input_tokens' }, data: { categoryMeter: 'ai_credits' } });
```

When a meter's quota is exceeded: if `category_meter` is set → try category pool → if exhausted and `credit_cost > 0` → try universal.

See [category-meter.md](./references/category-meter.md) for full waterfall diagram and use cases.

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

### Ledger Timeline Example

```
Time  Entry Type        Delta   Usage After  Notes
─────────────────────────────────────────────────────────
T1    credit_purchase   +1000   0            Period credits granted
T2    increment         +50     50           API calls recorded
T3    increment         +200    250          More API calls
T4    expired           -100    250          Promo credits expired
T5    reset             -250    0            Monthly period boundary
T6    rollover          +300    0            Unused credits carried forward
T7    increment         +10     10           New period begins
T8    credit_deduction  +20     10           Universal credits used (on universal meter)
```

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

---

## Concurrency Model

```
  Concurrent requests for same entity + meter:

  Request A                    Request B
      │                            │
      ▼                            ▼
  LOCK balance row ──────►  WAIT (blocked)
      │                            │
  expiration check                 │
  period reset                     │
  quota check                      │
  update balance                   │
  write ledger                     │
  RELEASE lock ─────────►  ACQUIRE lock
                                   │
                               expiration check
                               period reset
                               quota check (sees A's usage)
                               update balance
                               write ledger
                               RELEASE lock
```

`record_usage` uses row-level locking (FOR UPDATE) to serialize concurrent access to the same balance. This prevents double-spending and ensures correct quota enforcement under concurrency. `check_billing_quota` does NOT lock — it's a best-effort read that may be slightly stale.
