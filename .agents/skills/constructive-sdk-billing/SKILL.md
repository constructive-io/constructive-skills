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

Key fields:
- `slug`: unique identifier (`api_requests`, `storage_gb`, `universal`)
- `credit_cost`: universal credits consumed per unit (NULL = no fallback)
- `period_interval`: reset cadence (`'1 month'`, `'1 year'`, NULL = never)
- `rollover_cap`: max unused units carried forward on reset (NULL = unlimited)

### Balances

One row per (entity, meter). Tracks current state without needing to aggregate the ledger. Updated atomically by `record_usage` under row-level locks.

### Credits

Credits are granted via `meter_credits` (append-only). An AFTER INSERT trigger automatically updates the balance and writes a ledger entry. Three credit types control reset behavior:

| Type | On period reset | Example |
|---|---|---|
| `permanent` | Survives | One-time purchase, promo code |
| `period` | Zeroed | "1000 API calls/month included with Pro" |
| `rollover` | Unused portion carries forward (capped) | "Unused credits roll over, max 500" |

Credits can also have an `expires_at` timestamp. Expired credits are automatically removed on next access (lazy enforcement).

### Universal Credits

A fallback credit pool shared across meters. A meter opts in by setting `credit_cost > 0`. When a meter's own quota is exceeded, the system automatically deducts `credit_cost * quantity` from the `universal` meter's balance.

---

## Blueprint Provisioning

### billing_module

Enable billing in your blueprint's modules list:

```ts
modules: ['billing_module']
```

This creates:
- `meters` table (public schema)
- `balances` table (private schema)
- `ledger` table (public schema)
- `meter_credits` table (public schema)
- `record_usage()` function (private, SECURITY DEFINER)
- `check_billing_quota()` function (private, SECURITY DEFINER, STABLE)
- `meter_credits_trigger` (AFTER INSERT on meter_credits)

### billing_provider_module

Optional bridge to external payment providers:

```ts
modules: ['billing_module', 'billing_provider_module']
```

This adds:
- `billing_customers` (maps entities to Stripe/Paddle customer IDs)
- `billing_products` (maps internal products to external product IDs)
- `billing_subscriptions` (subscription lifecycle)
- `billing_events` (webhook dedup via idempotency key)
- `process_billing_event()` function (dedup gate)

---

## Setting Up Meters

After provisioning, configure meters by inserting rows:

```sql
-- Monthly API quota
INSERT INTO app_public.meters (slug, display_name, meter_type, period_interval)
VALUES ('api_calls', 'API Calls', 'quota', '1 month');

-- Storage (never resets)
INSERT INTO app_public.meters (slug, display_name, meter_type)
VALUES ('storage_gb', 'Storage (GB)', 'quota');

-- Universal credit pool (monthly reset)
INSERT INTO app_public.meters (slug, display_name, meter_type, period_interval)
VALUES ('universal', 'Universal Credits', 'credit_pool', '1 month');

-- API calls fall back to universal credits (2 credits per call)
UPDATE app_public.meters SET credit_cost = 2 WHERE slug = 'api_calls';

-- Monthly tokens with rollover (max 500 carry forward)
INSERT INTO app_public.meters (slug, display_name, meter_type, period_interval, rollover_cap)
VALUES ('tokens', 'Tokens', 'quota', '1 month', 500);
```

---

## Granting Credits

Credits are granted by inserting into `meter_credits`. The trigger handles everything else.

```sql
-- Monthly plan grant (resets each period)
INSERT INTO app_public.meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<meter-uuid>', '<entity-uuid>', 1000, 'period');

-- One-time permanent purchase
INSERT INTO app_public.meter_credits (meter_id, entity_id, amount, credit_type, reason)
VALUES ('<meter-uuid>', '<entity-uuid>', 500, 'permanent', 'purchase:invoice_123');

-- Rollover bonus credits
INSERT INTO app_public.meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<meter-uuid>', '<entity-uuid>', 200, 'rollover');

-- Promo credits that expire at year end
INSERT INTO app_public.meter_credits (meter_id, entity_id, amount, credit_type, expires_at, reason)
VALUES ('<meter-uuid>', '<entity-uuid>', 500, 'permanent', '2026-12-31', 'promo:WELCOME2026');
```

### What happens on INSERT:
1. Trigger looks up meter slug
2. Upserts balance row (creates if not exists)
3. Adds amount to `purchased_credits` and `effective_limit`
4. If `period` type: also increments `period_credits`
5. If `rollover` type: also increments `rollover_credits`
6. If `expires_at` set: updates `next_expires_at` (MIN tracking)
7. Writes `credit_purchase` ledger entry

---

## Recording Usage

Call the generated `record_usage` function to record consumption:

```sql
-- Record 10 API calls for an entity
SELECT app_private.record_usage('api_calls', '<entity-uuid>', 10);
-- Returns: true (success) or false (over quota / meter not found)

-- Record with metadata
SELECT app_private.record_usage('api_calls', '<entity-uuid>', 1, '{"request_id": "abc123"}');
```

### What happens internally:
1. Locks the balance row (FOR UPDATE)
2. Lazy-inits balance if needed
3. Removes expired credits (if any have `expires_at <= now()`)
4. Resets period (if `period_start + period_interval <= now()`)
5. Checks quota; if over limit, tries universal credits waterfall
6. Updates balance and writes ledger entry

### Quantity default
`quantity` defaults to 0 — callers must specify explicitly.

---

## Checking Quotas

Call `check_billing_quota` for a read-only capacity check:

```sql
-- Can this entity do 10 more API calls?
SELECT app_private.check_billing_quota('api_calls', '<entity-uuid>', 10);
-- Returns: true (has capacity) or false (would exceed quota)
```

This is a **read-only hint** — no locks, no writes. Safe for use in RLS policies (STABLE function). The actual enforcement happens in `record_usage`.

### Using as an RLS policy gate
`check_billing_quota` is STABLE, so PostgreSQL can use it in RLS policy expressions without per-row side effects.

---

## Lazy Behaviors (No Cron Needed)

The billing system handles three operations lazily on access:

### 1. Period Reset
When `period_interval` is set and the period has elapsed, `record_usage` automatically:
- Zeros `current_usage`
- Removes `period` credits
- Carries forward unused `rollover` credits (capped by `rollover_cap`)
- Writes `reset` and `rollover` ledger entries

### 2. Credit Expiration
When credits have `expires_at` in the past, `record_usage` automatically:
- Aggregates and deletes expired credit rows
- Subtracts expired amounts from the balance
- Writes an `expired` ledger entry

Expiration runs **before** period reset to prevent expired credits from inflating rollover.

### 3. Balance Lazy-Init
On first usage, `record_usage` creates the balance row if it doesn't exist (INSERT ON CONFLICT DO NOTHING).

---

## Universal Credits Waterfall

When a meter's quota is exceeded and `credit_cost` is set:

```
1. Check: is entity over the meter's own limit?
2. If yes and credit_cost > 0:
   a. Lock the universal balance
   b. Compute cost = credit_cost * quantity
   c. If universal has capacity: deduct and allow
   d. If universal exhausted: reject
3. If no credit_cost: reject
```

The universal meter is just a regular meter with slug `'universal'`. It has its own balance, credits, and period settings.

---

## Billing Provider Bridge

The `billing_provider_module` maps external payment events to internal billing operations.

### Webhook Processing

```sql
-- Dedup a webhook event (returns true if new, false if already processed)
SELECT app_private.process_billing_event(
  '<provider>',           -- 'stripe', 'paddle'
  '<idempotency-key>',   -- Stripe event ID, etc.
  '{"type": "invoice.paid", ...}'  -- raw webhook payload
);
```

The function does `INSERT ... ON CONFLICT DO NOTHING` on `billing_events` to ensure idempotency. If the event is new, it returns true and your cloud function can proceed with the business logic (granting credits, updating subscriptions, etc.).

### Tables

| Table | Purpose |
|---|---|
| `billing_customers` | Maps `(provider, entity_id)` ↔ `external_customer_id` |
| `billing_products` | Maps `(provider, resource_id)` ↔ `external_product_id` |
| `billing_subscriptions` | Subscription lifecycle (status, period_start/end, metadata) |
| `billing_events` | Webhook dedup via `(provider, idempotency_key)` UNIQUE |

---

## Ledger Entry Types

All state changes are recorded in the append-only `ledger` table:

| `entry_type` | When | `delta` |
|---|---|---|
| `increment` | `record_usage` records consumption | +quantity |
| `credit_purchase` | Credit inserted via `meter_credits` | +amount |
| `reset` | Period reset zeroes usage | -old_usage |
| `rollover` | Unused credits carry forward | +rollover_amount |
| `expired` | Expired credits removed | -expired_total |
| `credit_deduction` | Universal credits consumed via waterfall | +cost (on universal meter) |
| `adjustment` | Manual admin adjustment | +/- amount |

---

## SDK Usage (ORM/GraphQL)

> **Note:** Full SDK types require codegen regeneration after provisioning the billing module. The ORM method signatures below show the expected patterns based on the table structure.

### Reading balances (via ORM)

```ts
// Get current balance for an entity + meter
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

### Granting credits (via ORM)

```ts
// Grant monthly period credits
await db.meterCredit.create({
  data: {
    meterId: meterId,
    entityId: entityId,
    amount: 1000,
    creditType: 'period',
    reason: 'plan:pro_monthly',
  },
});

// Grant permanent credits with expiration
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

### Reading ledger (via ORM)

```ts
// Get recent billing events for an entity
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

### Calling record_usage and check_billing_quota

These are SECURITY DEFINER functions on the private schema. They must be called via custom GraphQL mutations or from cloud functions (Knative workers) that have service-role access:

```ts
// In a Knative cloud function with service-role credentials:
const result = await pool.query(
  'SELECT app_private.record_usage($1, $2, $3, $4)',
  ['api_calls', entityId, quantity, JSON.stringify(metadata)]
);
const allowed = result.rows[0].record_usage; // boolean
```

---

## Common Patterns

### Monthly SaaS with overage billing
```sql
-- Base meter with monthly reset
INSERT INTO meters (slug, period_interval, credit_cost)
VALUES ('api_calls', '1 month', 1);

-- Universal credit pool for overages
INSERT INTO meters (slug, period_interval)
VALUES ('universal', '1 month');

-- Monthly allowance (period credits)
INSERT INTO meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<api_calls_meter>', '<entity>', 10000, 'period');

-- Universal credits for overages
INSERT INTO meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<universal_meter>', '<entity>', 500, 'period');
```

### Promotional credits with expiration
```sql
-- Time-limited promo
INSERT INTO meter_credits (meter_id, entity_id, amount, credit_type, expires_at, reason)
VALUES ('<meter>', '<entity>', 1000, 'permanent', '2026-06-30', 'promo:SUMMER2026');
```

### Rollover credits (use it or carry it)
```sql
-- Meter with rollover cap
INSERT INTO meters (slug, period_interval, rollover_cap)
VALUES ('tokens', '1 month', 500);

-- Rollover credits (unused carries forward, capped at 500)
INSERT INTO meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<meter>', '<entity>', 1000, 'rollover');
```

### Feature gating via quota check
```sql
-- Boolean-style: meter with limit of 1
INSERT INTO meters (slug) VALUES ('premium_export');
INSERT INTO meter_credits (meter_id, entity_id, amount, credit_type)
VALUES ('<meter>', '<entity>', 1, 'permanent');

-- Check in RLS or application code:
SELECT app_private.check_billing_quota('premium_export', '<entity>', 1);
```
