# Achievements Reference

Achievements are defined at the blueprint level (not as table nodes) because they're inherently cross-table — one achievement can reference events from multiple tables. The `achievements[]` section seeds levels, requirements, and reward definitions into the events module.

## Blueprint Structure

```json
{
  "achievements": [
    {
      "name": "getting_started",
      "description": "Complete your profile setup",
      "priority": 10,
      "entity_prefix": "app",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 },
        { "event_name": "profile_completed", "count": 1 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 5, "credit_type": "permanent" }
      ]
    }
  ]
}
```

## How Achievements Work

### 1. Event Accumulation

EventTracker nodes record events → `record_event()` calls `upsert_achievement()` which updates the `event_aggregates` table with running counts per user (or per user+entity).

### 2. Achievement Checking

`tg_check_achievements` fires after `event_aggregates` is updated. It calls `level_achieved()` which checks all requirements for all levels. When all requirements are met, it creates a `level_grants` row (with a unique constraint to prevent re-grants).

### 3. Reward Granting

`tg_achievement_reward` fires when a new `level_grants` row is created. It loops over `achievement_rewards` by `level_name` and grants credits (`limit_credits` or `meter_credits`) for each matching reward. This trigger is SECURITY DEFINER — users don't need direct write access to credits tables.

### 4. Idempotency

`grant_achievement` is a callable function that grants an achievement idempotently. The unique constraint on `level_grants(actor_id, level_name, period_start)` (or `+ entity_id` for entity variant) prevents double-granting within the same period. For non-periodic events, `period_start` defaults to a constant sentinel value, preserving earn-once semantics. For periodic events, a new `period_start` each period allows re-granting. The reward trigger fires once per grant.

## Achievement Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Unique level name (citext). Used as the key in `levels`, `level_requirements`, and `achievement_rewards`. |
| `description` | string | No | `null` | Human-readable description |
| `priority` | integer | No | `100` | Display ordering; lower values appear first |
| `entity_prefix` | string | No | `"app"` | Which entity type's events_module to seed into. Must match a provisioned entity type with `has_levels: true`. |
| `requirements` | array | **Yes** | — | One or more event requirements (see below) |
| `rewards` | array | No | `[]` | Credits to grant when the achievement is earned (see below) |

## Requirement Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_name` | string | **Yes** | Event type name. Must match an EventTracker's `event_name`, a step name, or an auto-generated event like `invite_claimed`. |
| `count` | integer | **Yes** | Number of events needed. The system checks `event_aggregates.count >= requirement.count`. |
| `description` | string | No | Human-readable description of what this requirement entails. |

## Reward Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reward_type` | `"limit_credit"` \| `"meter_credit"` | **Yes** | — | Which credit system to grant to (see below) |
| `target_name` | string | **Yes** | — | Limit name (for `limit_credit`) or meter slug (for `meter_credit`). Must match a provisioned limit or meter. |
| `amount` | integer | **Yes** | — | Number of credits to grant. |
| `credit_type` | string | No | `"permanent"` | Credit type: `"permanent"`, `"expiring"`, `"period"`, etc. |
| `expires_interval` | interval string | No | `null` | If set, granted credits expire after this duration (e.g., `"30 days"`). Only applies to `meter_credit` rewards. |

### Reward Types

**`limit_credit`** — Grants credits to the limits module's `limit_credits` table. The `target_name` must match a limit provisioned by a `LimitCounter` node. These credits increase the user's effective limit cap.

**`meter_credit`** — Grants credits to the billing module's `meter_credits` table. The `target_name` must match a meter slug from a provisioned `billing_module`. Requires both `events_module` and `billing_module` to be provisioned for the same database. These credits provide quota that is consumed by `record_usage()` calls.

**`expires_interval` (meter_credit only):** When set, the reward trigger computes an expiration timestamp at grant time (current time + the interval). The billing module's lazy expiration system handles the rest — expired credits are automatically skipped during usage checks. Useful for time-limited referral rewards.

```json
{
  "rewards": [
    {
      "reward_type": "meter_credit",
      "target_name": "api_calls",
      "amount": 100,
      "credit_type": "permanent",
      "expires_interval": "30 days"
    }
  ]
}
```

## Cross-Table Achievements

Achievements naturally span multiple tables because requirements reference `event_name` values, not tables. Multiple EventTrackers on different tables can feed the same achievement:

```json
{
  "tables": [
    {
      "table_name": "user_profiles",
      "nodes": [
        { "$type": "EventTracker", "data": { "event_name": "avatar_uploaded", "events": ["UPDATE"], "watch_fields": ["avatar_url"] } }
      ]
    },
    {
      "table_name": "projects",
      "nodes": [
        { "$type": "EventTracker", "data": { "event_name": "first_project_created", "events": ["INSERT"] } }
      ]
    },
    {
      "table_name": "team_members",
      "nodes": [
        { "$type": "EventTracker", "data": { "event_name": "team_joined", "events": ["INSERT"], "actor_field": "user_id" } }
      ]
    }
  ],
  "achievements": [
    {
      "name": "getting_started",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 },
        { "event_name": "first_project_created", "count": 1 },
        { "event_name": "team_joined", "count": 1 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 10 }
      ]
    }
  ]
}
```

## Multi-Scope Achievements

Different entity types can have independent achievements. Use `entity_prefix` to target the correct scope:

```json
{
  "entity_types": [
    { "prefix": "app", "has_levels": true, "has_limits": true },
    { "prefix": "org", "parent_entity": "app", "has_levels": true, "has_limits": true }
  ],
  "achievements": [
    {
      "name": "app_onboarding",
      "entity_prefix": "app",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 }
      ]
    },
    {
      "name": "org_starter",
      "entity_prefix": "org",
      "requirements": [
        { "event_name": "first_member_invited", "count": 1 }
      ]
    }
  ]
}
```

## Achievement + Limits Interaction

Achievement rewards grant credits via the limits module. The `target_name` must match a limit provisioned by a `LimitCounter` or similar node:

```json
{
  "tables": [
    {
      "table_name": "projects",
      "nodes": [
        { "$type": "LimitCounter", "data": { "limit_name": "projects" } },
        { "$type": "EventTracker", "data": { "event_name": "project_created", "events": ["INSERT"] } }
      ]
    }
  ],
  "achievements": [
    {
      "name": "prolific_creator",
      "requirements": [
        { "event_name": "project_created", "count": 10 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 5 }
      ]
    }
  ]
}
```

When the user creates their 10th project → `prolific_creator` achievement unlocks → 5 additional project credits are granted → the user's effective limit increases from the base cap.

## Period-Aware Event Aggregates

Event types can define a `period_interval` that resets aggregate counts each period. This enables per-period achievement re-qualification (e.g., "earn referral credit each billing cycle").

### How It Works

1. **`event_types.period_interval`** — Optional interval (e.g., `'1 month'`, `'1 hour'`). When set, the event type uses periodic counting instead of lifetime counting.

2. **`event_aggregates.period_start`** — Tracks the start of the current counting period. Set to `now()` on first event, refreshed when the period elapses.

3. **Lazy reset** — When `record_event()` upserts an aggregate, it checks:
   - If `period_start + period_interval <= now()` → the period has elapsed
   - Reset `count` to the incoming value (instead of accumulating)
   - Refresh `period_start` to `now()`
   - Otherwise → accumulate normally

This is the same lazy reset pattern used by the billing module's period-based credits.

### Registering Periodic Event Types

Event types with a `period_interval` are registered during provisioning. Use the ORM or CLI to create them:

```ts
// ORM
await client.eventTypes.create({
  data: {
    name: 'billing.subscription_active',
    periodInterval: '1 month'
  }
});
```

```bash
# CLI
csdk event-types create \
  --name billing.subscription_active \
  --period-interval '1 month'
```

Non-periodic event types (the default) omit `periodInterval` — they count events across the user's entire lifetime, unchanged from previous behavior.

## Re-Triggerable Achievements

When an event type has a `period_interval`, its aggregate count resets each period. This means an achievement's requirements can be re-met in a new period, resulting in a new `level_grants` row and a new reward grant.

### How It Works

`level_grants` has a UNIQUE constraint that includes `period_start`:
- **User variant:** `UNIQUE(actor_id, level_name, period_start)`
- **Entity variant:** `UNIQUE(actor_id, entity_id, level_name, period_start)`

When `tg_check_achievements` fires, it uses the aggregate's `period_start` (or a sentinel value for non-periodic events) when creating the `level_grants` row:
- **Non-periodic aggregates** (`period_start = NULL`) → sentinel value is constant → earn-once semantics preserved (same UNIQUE key every time = duplicate is ignored)
- **Periodic aggregates** → `period_start` changes each period → new UNIQUE key → new `level_grants` row → reward trigger fires again

### Example: Recurring Referral Credits

Define the periodic event type and a re-triggerable achievement in the blueprint:

```json
{
  "achievements": [
    {
      "name": "active_referral",
      "entity_prefix": "app",
      "requirements": [
        { "event_name": "billing.subscription_active", "count": 1 }
      ],
      "rewards": [
        {
          "reward_type": "meter_credit",
          "target_name": "api_calls",
          "amount": 50,
          "credit_type": "permanent",
          "expires_interval": "30 days"
        }
      ]
    }
  ]
}
```

Then register the event type as periodic via the ORM:

```ts
await client.eventTypes.create({
  data: {
    name: 'billing.subscription_active',
    periodInterval: '1 month'
  }
});
```

Each billing period:
1. Stripe `invoice.paid` webhook → webhook handler calls `record_event('billing.subscription_active', referrer_id)`
2. Aggregate count resets to 1 (lazy reset), new `period_start`
3. Achievement re-qualifies → new `level_grants` row with new `period_start`
4. Reward trigger fires → new meter credit granted with 30-day expiration
5. If referral churns → no webhook → no event → no new credit → old credit expires naturally

## Provisioning Order

`constructBlueprint()` processes achievements in Phase 7:
1. Resolves the `events_module` for the given `entity_prefix` + `membership_type`
2. Creates the level definition (name, description, priority)
3. Creates one `level_requirement` per requirement entry (event_name + count)
4. Creates one `achievement_reward` per reward entry (reward_type, target, amount)

The events_module must already exist (Phase 0 entity types with `has_levels: true`), and limits must be provisioned (Phase 0 entity types with `has_limits: true`) for `limit_credit` reward grants to work. For `meter_credit` rewards, a `billing_module` must be provisioned for the same database.
