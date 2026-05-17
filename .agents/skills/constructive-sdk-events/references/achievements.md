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

`tg_check_achievements` fires AFTER INSERT or UPDATE on `event_aggregates`. It calls `level_achieved()` which checks all requirements for all levels. When all requirements are met, it INSERTs into `level_grants` (with a unique constraint to prevent re-grants).

### 3. Reward Granting

`tg_achievement_reward` fires AFTER INSERT on `level_grants`. It loops over `achievement_rewards` by `level_name` and INSERTs into `limit_credits` for each matching reward. This trigger is SECURITY DEFINER — users don't need credits INSERT permission.

### 4. Idempotency

`grant_achievement` is a callable function that grants an achievement idempotently. The unique constraint on `level_grants(level_name, actor_id)` (or `level_grants(level_name, actor_id, entity_id)`) prevents double-granting. The reward trigger only fires on the initial INSERT.

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
| `reward_type` | `"limit_credit"` \| `"meter_credit"` | **Yes** | — | Which credit system. `limit_credit` grants to the limits module's `limit_credits` table. |
| `target_name` | string | **Yes** | — | Limit name (for `limit_credit`) or meter slug (for `meter_credit`). Must match a provisioned limit or meter. |
| `amount` | integer | **Yes** | — | Number of credits to grant. |
| `credit_type` | string | No | `"permanent"` | Credit type: `"permanent"`, `"expiring"`, etc. |

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

## Provisioning Order

`constructBlueprint()` processes achievements in Phase 7:
1. Resolves `events_module` by `entity_prefix` + `membership_type`
2. INSERTs into `levels` (the level definition)
3. INSERTs into `level_requirements` (one per requirement)
4. INSERTs into `achievement_rewards` (one per reward)

The events_module must already exist (Phase 0 entity types with `has_levels: true`), and limits must be provisioned (Phase 0 entity types with `has_limits: true`) for reward grants to work.
