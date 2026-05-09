---
name: constructive-sdk-limits
description: SDK-level guide to the Constructive limits system — blueprint nodes (DataLimitCounter, DataFeatureFlag), module provisioning, ORM operations for managing limits/caps/plans/credits, and the generated enforcement functions. Use when asked to 'set up limits', 'check limits', 'feature flags', 'cap tables', 'aggregate limits', 'entity limits', 'database limits', 'resolve cap', 'apply plan', 'transfer quota', 'limit credits', 'DataLimitCounter', 'DataFeatureFlag', or when working with limits in blueprints or the ORM.
---

# Constructive Limits (SDK-Level Guide)

The limits system provides usage metering, feature gating, and quota enforcement — all configurable through **blueprints** and the **ORM**. No SQL required from end users.

Related skills:
- **`constructive-sdk-billing`**: Billing meters, ledger, universal credits, billing provider bridge
- **`constructive-platform`**: Blueprint provisioning overview
- **`constructive-db-limits`**: SQL-level architecture reference (internal implementation)

---

## Quick Start: Blueprint Setup

### 1. Enable the limits module

Add `limits_module` to your blueprint's modules list:

```ts
{
  modules: ['limits_module'],
  // ... rest of blueprint
}
```

This generates all limits tables, functions, and triggers for your database. It provisions per-scope:
- **App-level** (`membership_type = 1`): per-user limits, caps, credit codes
- **Org-level** (`membership_type = 2`): per-user limits + aggregate entity limits, caps, hierarchy checks

### 2. Attach limit tracking to tables (DataLimitCounter)

Add `DataLimitCounter` to any table's nodes to automatically track usage:

```ts
{
  tables: [{
    name: 'projects',
    fields: [
      { name: 'id', type: 'uuid' },
      { name: 'name', type: 'text' },
      { name: 'owner_id', type: 'uuid' }
    ],
    nodes: [
      'DataId',
      'DataTimestamps',
      {
        $type: 'DataLimitCounter',
        data: {
          limit_name: 'projects',       // matches a limit_defaults entry
          scope: 'app',                 // 'app' or 'org'
          actor_field: 'owner_id',      // field holding the user/entity ID
          events: ['INSERT', 'DELETE']  // default: increment on insert, decrement on delete
        }
      }
    ]
  }]
}
```

**What this does:** When a row is inserted into `projects`, the `projects` limit counter for the `owner_id` user is automatically incremented. When deleted, it’s decremented. If the user has hit their max, the INSERT is rejected.

### 3. Gate tables behind feature flags (DataFeatureFlag)

Add `DataFeatureFlag` to gate an entire table behind a boolean cap:

```ts
{
  tables: [{
    name: 'analytics_reports',
    fields: [
      { name: 'id', type: 'uuid' },
      { name: 'entity_id', type: 'uuid' },
      { name: 'report_data', type: 'jsonb' }
    ],
    nodes: [
      'DataId',
      'DataTimestamps',
      {
        $type: 'DataFeatureFlag',
        data: {
          feature_name: 'enable_analytics',  // cap name in caps_defaults
          scope: 'org',                      // 'app' or 'org'
          entity_field: 'entity_id'          // field holding entity ID (org scope only)
        }
      }
    ]
  }]
}
```

**What this does:** Before any INSERT into `analytics_reports`, the system checks `resolve_cap('enable_analytics', NEW.entity_id)`. If the cap is `0` (disabled), the insert is rejected with `FEATURE_DISABLED`. No application code needed.

---

## Data* Node Reference

### DataLimitCounter

Declaratively attaches limit increment/decrement triggers to a table.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit_name` | text | *(required)* | Name of the limit to track (must match a `limit_defaults` entry) |
| `scope` | text | `'app'` | `'app'` (user-level) or `'org'` (entity-level) |
| `actor_field` | text | `'owner_id'` | Field on target table holding the actor/entity ID |
| `events` | text[] | `['INSERT', 'DELETE']` | DML events to track: `INSERT`, `DELETE`, `UPDATE` |

**Behavior per event:**
- `INSERT` → BEFORE trigger: checks limit, increments counter. Rejects if over max.
- `DELETE` → AFTER trigger: decrements counter.
- `UPDATE` → BEFORE trigger: adjusts if the tracked field changes (old actor decremented, new actor incremented).

### DataFeatureFlag

Gates a table behind a boolean feature flag backed by cap tables.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `feature_name` | text | *(required)* | Cap name (must exist in `caps_defaults`) |
| `scope` | text | `'app'` | `'app'` (global check) or `'org'` (per-entity check) |
| `entity_field` | text | `'entity_id'` | Field on target table holding entity ID (org scope only) |

**Resolution:** `COALESCE(per-entity cap override, scope default, 0)` — if the result is ≤ 0, raises `FEATURE_DISABLED`.

---

## Managing Limits via ORM

Once the limits module is provisioned, all limits tables are exposed via the generated ORM/GraphQL API. Users manage limits through standard CRUD operations.

### Setting Up Limit Defaults (what users are allowed)

```ts
// Set default max for a named limit
await client.orgLimitDefaults.create({
  name: 'projects',
  max: 10,           // users can create up to 10 projects
  soft_max: 8        // warning at 8
});

// Unlimited
await client.orgLimitDefaults.create({
  name: 'messages',
  max: -1            // negative = unlimited
});

// Time-windowed limit (resets daily)
await client.orgLimitDefaults.create({
  name: 'api_calls',
  max: 1000,
  window_duration: '1 day'
});
```

### Setting Up Feature Flags (caps)

```ts
// Scope-level defaults (all entities start with this)
await client.orgCapsDefaults.create({
  name: 'enable_aggregates',
  max: 0                          // disabled by default
});

await client.orgCapsDefaults.create({
  name: 'max_file_upload_size',
  max: 10485760                   // 10MB default
});

// Per-entity override (enable for a specific database/org)
await client.orgLimitCaps.create({
  name: 'enable_aggregates',
  entity_id: databaseId,
  max: 1                          // enabled for this entity
});
```

### Cap Value Convention

| `max` value | Meaning |
|---|---|
| `0` | Feature disabled |
| `1` | Feature enabled (boolean flag) |
| `N > 1` | Numeric cap (max file size in bytes, max bulk items, etc.) |
| `< 0` | Unlimited |

### Applying Plans

Plans set `max` for multiple limits at once:

```ts
// Define a plan with quotas
await client.orgPlans.create({
  name: 'pro',
  quotas: {
    seats: 50,
    api_calls: 100000,
    storage_gb: 100
  }
});

// Apply plan to an entity (sets all maxes at once)
await client.orgLimitAggregates.applyPlan({
  plan_name: 'pro',
  entity_id: databaseId
});
```

### Granting Credits

Credits bump the effective ceiling for a limit:

```ts
// Grant permanent credits (survive window resets)
await client.orgLimitCredits.create({
  default_limit_id: seatsLimitDefId,
  entity_id: orgId,
  amount: 10,
  credit_type: 'permanent',
  reason: 'purchase:invoice_123'
});

// Grant period credits (reset on window expiry)
await client.orgLimitCredits.create({
  default_limit_id: apiCallsLimitDefId,
  actor_id: userId,
  amount: 500,
  credit_type: 'period',
  reason: 'promo:WELCOME'
});
```

### Credit Codes (self-service redemption)

```ts
// Admin creates a redeemable code
const code = await client.appLimitCreditCodes.create({
  code: 'WELCOME2026',
  max_redemptions: 1000,
  expires_at: '2026-12-31'
});

// Define what the code grants
await client.appLimitCreditCodeItems.create({
  credit_code_id: code.id,
  default_limit_id: seatsLimitDefId,
  amount: 5,
  credit_type: 'permanent'
});

// User redeems (trigger validates + cascades to limit_credits)
await client.appLimitCreditRedemptions.create({
  credit_code_id: code.id,
  entity_id: userOrgId
});
```

---

## Three Enforcement Layers

The limits module generates three distinct layers. Understanding which to use is key:

| Use Case | Layer | Blueprint Node |
|----------|-------|----------------|
| "Can user Y create another project?" | Per-user limits | `DataLimitCounter` (scope: `'app'`) |
| "Can this org add another seat?" | Aggregate entity limits | `DataLimitCounter` (scope: `'org'`) |
| "Is feature X enabled for this entity?" | Cap tables | `DataFeatureFlag` |
| "What's the max file upload size?" | Cap tables | Read via ORM: `orgCapsDefaults` / `orgLimitCaps` |
| "Apply Pro plan to this entity" | Plans | `applyPlan()` via ORM |
| "Move 50 seats from team A to team B" | Transfer | `transferQuota()` via ORM |
| "Check limits up the org hierarchy" | Cascade | `cascadeCheck()` via ORM |

### Per-User Limits

Keyed on `(name, actor_id, entity_id)`. Tracks what individual users can do.

- Enforced automatically by `DataLimitCounter` triggers
- Defaults to `current_user_id()` from JWT context
- Configure via ORM: `orgLimitDefaults.create({ name, max, soft_max, window_duration })`

### Aggregate Entity Limits

Keyed on `(name, entity_id)`. Tracks what an entity (org/database) can do as a whole.

- Enforced automatically by `DataLimitCounter` with `scope: 'org'`
- Supports hierarchy-aware cascade checks (walks `owner_id` chain)
- Supports quota transfer between entities
- Configure via ORM: `orgLimitDefaults.create(...)` + plan application

### Cap Tables (Feature Flags)

Keyed on `(name, entity_id)`. Boolean feature toggles and static config values. No counters.

- Enforced automatically by `DataFeatureFlag` trigger on table inserts
- Manage via ORM: `orgCapsDefaults` (scope defaults) + `orgLimitCaps` (per-entity overrides)

---

## Using database_id as entity_id

For platform-level gating where databases are owned by orgs, model `database_id` as the `entity_id`:

| Need | Approach |
|------|----------|
| Meter API calls per database | `DataLimitCounter` with `scope: 'org'`, `actor_field: 'database_id'` |
| Gate features per database | `DataFeatureFlag` with `scope: 'org'`, `entity_field: 'database_id'` |
| Apply a plan to a database | `client.orgLimitAggregates.applyPlan({ plan_name: 'pro', entity_id: databaseId })` |
| Check hierarchy (db → org → app) | Cascade check walks `owner_id` automatically |
| Move quota between databases | `client.orgLimitAggregates.transferQuota({ ... })` |

The `entity_id` column accepts any UUID — it doesn't care whether it represents an org, database, team, or any other entity.

---

## Time Windows

Limits support automatic periodic resets:

```ts
await client.orgLimitDefaults.create({
  name: 'api_calls',
  max: 1000,
  window_duration: '1 day'   // resets daily
});
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

---

## Complete Blueprint Example

```ts
{
  modules: ['limits_module'],
  tables: [
    {
      name: 'documents',
      fields: [
        { name: 'id', type: 'uuid' },
        { name: 'title', type: 'text' },
        { name: 'owner_id', type: 'uuid' },
        { name: 'entity_id', type: 'uuid' }
      ],
      nodes: [
        'DataId',
        'DataTimestamps',
        // Track per-user document creation
        {
          $type: 'DataLimitCounter',
          data: {
            limit_name: 'documents_per_user',
            scope: 'app',
            actor_field: 'owner_id'
          }
        },
        // Track org-wide document count
        {
          $type: 'DataLimitCounter',
          data: {
            limit_name: 'documents_total',
            scope: 'org',
            actor_field: 'entity_id',
            events: ['INSERT', 'DELETE']
          }
        },
        // Gate behind premium feature flag
        {
          $type: 'DataFeatureFlag',
          data: {
            feature_name: 'enable_documents',
            scope: 'org',
            entity_field: 'entity_id'
          }
        }
      ]
    }
  ]
}
```

This single blueprint definition:
- Limits each user to N documents (configured via `orgLimitDefaults`)
- Limits the org as a whole to M documents (configured via plan application)
- Gates the entire table behind a feature flag (disabled until cap is set to 1)
- All without writing any SQL

---

## Reference Files

For SQL-level implementation details:

- `references/function-signatures.md` — All 25+ generated SQL functions with exact signatures
- `references/tables-and-fields.md` — Full schema reference for all generated tables
