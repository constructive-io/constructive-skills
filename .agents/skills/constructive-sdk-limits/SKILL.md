---
name: constructive-sdk-limits
description: SDK-level guide to the Constructive limits system — per-user limits, aggregate entity limits, cap tables (feature flags), plans, credits, cascade checks, and allocation modes. Use when asked to 'set up limits', 'check limits', 'feature flags', 'cap tables', 'aggregate limits', 'entity limits', 'database limits', 'resolve cap', 'apply plan', 'transfer quota', 'limit credits', or when working with limits in blueprints or the ORM.
---

# Constructive Limits (SDK-Level Guide)

The limits system provides usage metering, feature gating, and quota enforcement at multiple scopes. It generates three distinct enforcement layers:

| Layer | Keyed On | Purpose |
|---|---|---|
| Per-user limits | `(name, actor_id, entity_id)` | "Can user Y do X within entity Z?" |
| Aggregate entity limits | `(name, entity_id)` | "Can entity Z do X as a whole?" |
| Cap tables (feature flags) | `(name, entity_id)` | "Is feature X enabled for entity Z?" |

Related skills:
- **`constructive-sdk-billing`**: Billing meters, ledger, universal credits, billing provider bridge
- **`constructive-safegres`**: Authorization policy types used by limits RLS
- **`constructive-platform`**: Blueprint provisioning overview

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        limits_module                                  │
│                                                                      │
│  ┌──────────────────┐  ┌───────────────────┐  ┌──────────────────┐  │
│  │  {prefix}_limits  │  │ {prefix}_limit_   │  │ {prefix}_limit_  │  │
│  │  (per-user)       │  │ aggregates        │  │ caps             │  │
│  │                   │  │ (entity-level)    │  │ (feature flags)  │  │
│  └────────┬──────────┘  └────────┬──────────┘  └────────┬─────────┘  │
│           │                      │                      │            │
│    org_limits_check        aggregate_check         resolve_cap       │
│    org_limits_inc          aggregate_inc           cap_check_trigger  │
│    org_limits_dec          aggregate_dec                              │
│    check_soft              aggregate_check_soft                       │
│                                                                      │
│  ┌──────────────────┐  ┌───────────────────┐  ┌──────────────────┐  │
│  │ limit_defaults    │  │ limit_events      │  │ caps_defaults    │  │
│  │ (ceiling config)  │  │ (audit trail)     │  │ (scope defaults) │  │
│  └──────────────────┘  └───────────────────┘  └──────────────────┘  │
│                                                                      │
│  Cross-cutting:  apply_plan() · cascade_check() · transfer_quota()   │
│                  add_credits() · modify_limit()                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## When to Use What

| Use Case | Layer | Function |
|----------|-------|----------|
| "Is feature X enabled for this entity?" | Cap tables | `resolve_cap(cap_name, entity_id)` |
| "What's the max file upload size?" | Cap tables | `resolve_cap('max_file_upload_size', entity_id)` |
| "Can this entity add one more seat?" | Aggregate | `aggregate_check('seats', entity_id, 1)` |
| "Has this entity used N of M API calls?" | Aggregate | `aggregate_check('api_calls', entity_id, 1)` |
| "Can this user send another message today?" | Per-user | `org_limits_check('messages_per_day', 1)` |
| "Apply Pro plan to this entity" | Plans | `apply_plan('pro', entity_id)` |
| "Move 50 seats from team A to team B" | Transfer | `transfer_quota('seats', team_a_id, team_b_id, 50)` |
| "Check limits up the org hierarchy" | Cascade | `cascade_check('storage_gb', entity_id, 100)` |

---

## Blueprint Provisioning

Enable limits in your blueprint's modules list:

```ts
modules: ['limits_module']
```

The module is generated **per entity type** with a prefix derived from the entity name. For an entity type with `membership_type = 2` (org-level), it creates:

- `org_limits` — per-user usage counters within the entity
- `org_limit_defaults` — default ceiling values
- `org_limit_aggregates` — entity-level aggregate counters
- `org_limit_credits` — append-only credit grant ledger
- `org_limit_events` — audit trail of all changes
- `org_limit_caps` — per-entity feature flag overrides
- `org_caps_defaults` — scope-level default cap values
- All enforcement functions (25+) in the private schema as SECURITY DEFINER

For `membership_type = 1` (app-level), it additionally creates:
- `app_limit_credit_codes` — admin-managed redeemable codes
- `app_limit_credit_code_items` — what each code grants
- `app_limit_credit_redemptions` — user redemption ledger

---

## Per-User Limits

Keyed on `(name, actor_id, entity_id)`. Tracks what individual users can do within an entity.

### Check (before allowing an action)

```sql
-- Defaults to current_user_id() from JWT
SELECT org_limits_check('messages_per_day', 1);

-- Explicit user
SELECT org_limits_check('messages_per_day', 1, some_user_id);
```

Returns `true` if allowed (`num + amount <= max` or `max < 0` for unlimited).

### Increment/Decrement (record usage)

```sql
-- User sent a message (auto-checks limit, returns false if exceeded)
SELECT org_limits_inc('messages_per_day', current_user_id(), 1);

-- User deleted a message
SELECT org_limits_dec('messages_per_day', current_user_id(), 1);
```

### Soft Limits (warnings)

```sql
-- Returns true if num >= soft_max (warning threshold)
SELECT org_limits_check_soft('messages_per_day', current_user_id());
```

---

## Aggregate Entity Limits

Keyed on `(name, entity_id)`. Tracks what an entity can do **as a whole**, regardless of which user.

### Check

```sql
-- Can this org add another member?
SELECT org_limit_aggregates_check('seats', org_id, 1);

-- Can this database handle another API call?
SELECT org_limit_aggregates_check('api_calls', database_id, 1);
```

### Increment/Decrement

```sql
-- Org added a member
SELECT org_limit_aggregates_inc('seats', org_id, 1);

-- Org removed a member
SELECT org_limit_aggregates_dec('seats', org_id, 1);
```

### Cascade Check (hierarchy-aware)

Walks up the `owner_id` chain, checking aggregate limits at each level:

```sql
-- Checks database -> parent org -> app
SELECT org_limit_aggregates_cascade_check('storage_gb', database_id, 100);
```

### Transfer Quota

Atomically moves `max` capacity between entities:

```sql
-- Move 50 seats from Team A to Team B
SELECT org_limit_aggregates_transfer_quota('seats', team_a_id, team_b_id, 50, current_user_id());
```

Fails if source would end up with `max < num` (can't take away capacity that's in use). Blocked in `pooled` allocation mode — only works in `budgeted` mode.

---

## Cap Tables (Feature Flags & Static Limits)

A **separate layer** from metered limits. Provides boolean feature flags and static configuration values **without counters**. Purely declarative.

### Convention

| `max` value | Meaning |
|---|---|
| `0` | Feature disabled |
| `1` | Feature enabled (boolean flag) |
| `N > 1` | Numeric cap (max file size, max bulk items) |
| `< 0` | Unlimited |

### Setting Defaults (scope-level)

```sql
INSERT INTO org_caps_defaults (name, max) VALUES
  ('enable_aggregates', 0),          -- disabled by default
  ('enable_advanced_analytics', 0),  -- disabled by default
  ('max_file_upload_size', 10485760); -- 10MB default
```

### Per-Entity Overrides

```sql
-- Enable aggregates for a specific database (Pro plan)
INSERT INTO org_limit_caps (name, entity_id, max) VALUES
  ('enable_aggregates', database_id, 1);
```

### Checking Caps

```sql
-- Returns bigint: 0 (disabled) or 1+ (enabled/cap value)
SELECT resolve_cap('enable_aggregates', database_id);

-- In application logic:
IF resolve_cap('enable_aggregates', database_id) > 0 THEN
  -- allow aggregate queries
END IF;
```

### Cap Check Trigger (Automatic Gating)

The cap check trigger can be attached to tables via `DataFeatureFlag` blueprint nodes. It automatically blocks inserts when a feature is disabled:

1. Extracts `entity_id` from the NEW row
2. Checks `limit_caps` for per-entity override
3. Falls back to `caps_defaults`
4. If `COALESCE(value, 0) <= 0` → raises `FEATURE_DISABLED (cap_name)`

No application code needed — the database enforces feature availability.

---

## Plans

Plans set `max` values for multiple limits at once via a `quotas` JSONB column.

### Applying a Plan

```sql
-- Sets max for each limit defined in the plan's quotas
SELECT apply_plan('pro', entity_id);
```

The `apply_plan` function:
1. Reads the plan's `quotas` JSONB (e.g., `{"seats": 50, "api_calls": 10000}`)
2. For each entry, creates or updates the limit row setting `max` and `plan_max`
3. Existing usage (`num`) is preserved — only ceilings change

---

## Credits

Credits modify `max` — they bump the ceiling that limits enforce.

### Via limit_credits table (recommended)

```sql
-- Grant 10 permanent credits for seats
INSERT INTO org_limit_credits (default_limit_id, actor_id, entity_id, amount, credit_type, reason)
VALUES (limit_def_id, NULL, org_id, 10, 'permanent', 'purchase:invoice_123');
```

The AFTER INSERT trigger automatically updates the limits table.

### Via function (direct)

```sql
-- Bump max for a specific user's limit
SELECT add_credits('api_calls', 1000, user_id, 'promo:WELCOME');

-- Bump max for aggregate entity limit
SELECT add_credits_aggregate('seats', 10, org_id, 'enterprise_upgrade');
```

### Credit Types

| Type | On window reset | Use case |
|---|---|---|
| `permanent` | Survives indefinitely | Purchases, admin grants, lifetime rewards |
| `period` | Zeroed on window expiry | Monthly plan allocations |

---

## Credit Codes (App-Level)

Admin-managed redeemable codes for self-service credit distribution.

```sql
-- Admin creates a code
INSERT INTO app_limit_credit_codes (code, max_redemptions, expires_at)
VALUES ('WELCOME2026', 1000, '2026-12-31');

-- Admin adds items to the code (what it grants)
INSERT INTO app_limit_credit_code_items (credit_code_id, default_limit_id, amount, credit_type)
VALUES (code_id, seats_limit_id, 5, 'permanent');

-- User redeems (trigger validates and cascades to limit_credits)
INSERT INTO app_limit_credit_redemptions (credit_code_id, entity_id)
VALUES (code_id, user_org_id);
```

---

## Time Windows

Limits support automatic periodic resets:

```sql
-- Set a daily window on a limit default
UPDATE org_limit_defaults SET
  max = 100,
  window_duration = '1 day'
WHERE name = 'api_calls';
```

On the next check/increment after the window expires:
1. `num` resets to 0
2. `period_credits` resets to 0
3. `max` recalculates as `plan_max + purchased_credits`
4. `window_start` updates to `now()`

---

## Allocation Modes

Controls how sub-entities share parent capacity:

| Mode | Behavior |
|---|---|
| `pooled` (default) | All sub-entities share the parent's aggregate limit freely |
| `budgeted` | Each sub-entity gets an explicit allocation; `transfer_quota` enabled |

Set on `org_membership_settings.limit_allocation_mode`.

---

## Using database_id as entity_id

For platform-level gating where databases are owned by orgs:

| Need | Function | Example |
|---|---|---|
| Numeric metering | `aggregate_check` | `aggregate_check('api_calls', database_id, 1)` |
| Feature flags | `resolve_cap` | `resolve_cap('enable_aggregates', database_id)` |
| Apply plan | `apply_plan` | `apply_plan('pro', database_id)` |
| Hierarchy check | `cascade_check` | `cascade_check('storage_gb', database_id, 100)` |
| Transfer quota | `transfer_quota` | `transfer_quota('seats', db_a, db_b, 10)` |

The `entity_id` column accepts any UUID — it doesn't care whether it represents an org, a database, a team, or any other entity.

---

## Reference Files

For deeper implementation details, see:

- `references/function-signatures.md` — Complete list of all 25+ generated functions with exact signatures
- `references/tables-and-fields.md` — Full schema reference for all generated tables
