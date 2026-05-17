---
name: constructive-sdk-events
description: "Events, achievements, and gamification — EventTracker blueprint node for recording events on row changes, blueprint achievements[] for defining levels with requirements and credit rewards, invite-based achievements (has_invite_achievements), and the full virality chain. Use when asked to 'add analytics', 'track events', 'add achievements', 'gamification', 'record events', 'EventTracker', 'level requirements', 'achievement rewards', 'invite achievements', 'invite virality', 'credit grants for achievements', or when working with events_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Events & Achievements (SDK Guide)

The events system provides event tracking, gamification, and achievement-based credit rewards. Everything is configured through **blueprints** (EventTracker nodes + `achievements[]` section) and managed via the **ORM**.

Three capabilities compose together:
- **`EventTracker`** — table-level node. Attach to any table to declaratively record events when rows change. Same compound condition system as JobTrigger.
- **`achievements[]`** — top-level blueprint section. Define levels with requirements (event counts) and optional rewards (credit grants).
- **`has_invite_achievements`** — entity type flag. Auto-attaches EventTracker to `claimed_invites` and wires the invitee achievement virality chain.

Related skills:
- **`constructive-sdk-limits`**: Limits module, credit grants, cap tables
- **`constructive-sdk-billing`**: Billing meters, universal credits
- **`constructive-jobs`**: JobTrigger (shares the same compound conditions system)
- **`constructive-sdk-entities`**: Entity types, `has_invites`, membership types
- **`constructive-platform`**: Blueprint provisioning overview

---

## Architecture Overview

```
Table row change (INSERT/UPDATE/DELETE)
  → EventTracker trigger fires (compound conditions evaluated)
    → record_event(event_name, actor_id) / record_event(event_name, actor_id, entity_id)
      → app_events INSERT (partitioned, time-based retention)
      → upsert_achievement() → event_aggregates UPDATE
        → tg_check_achievements fires
          → level_achieved() = true → level_grants INSERT
            → tg_achievement_reward → limit_credits INSERT (credit grant)
            → tg_invitee_achievement → record_event('invitee_achieved_*', inviter_id)
```

All triggers are SECURITY DEFINER — users don't need direct INSERT permission on events or credits tables.

---

## Prerequisites

The events module must be provisioned before EventTracker or achievements can be used. This happens automatically when `has_levels: true` is set on an entity type:

```json
{
  "entity_types": [
    {
      "name": "Organization Member",
      "prefix": "org",
      "parent_entity": "app",
      "has_levels": true
    }
  ]
}
```

Setting `has_levels: true` provisions:
- Events tables: `{prefix}_steps`, `{prefix}_event_aggregates` (achievements), `{prefix}_levels`, `{prefix}_level_requirements`, `{prefix}_level_grants`, `{prefix}_achievement_rewards`
- Event types table: `{prefix}_event_types` (catalog)
- Partitioned event log: `{prefix}_events` (time-based partitions via pg_partman)
- Trigger functions: `record_event`, `upsert_achievement`, `level_achieved`, `grant_achievement`, `tg_check_achievements`
- Prune function: `prune_events` (retention management)

---

## EventTracker Blueprint Node

Add `EventTracker` to a table's `nodes[]` to auto-create triggers that record events:

```json
{
  "tables": [{
    "table_name": "user_profiles",
    "nodes": [
      { "$type": "EventTracker", "data": {
        "event_name": "avatar_uploaded",
        "events": ["UPDATE"],
        "watch_fields": ["avatar_url"],
        "conditions": { "field": "avatar_url", "op": "IS NOT NULL" }
      }}
    ],
    "fields": [
      { "name": "display_name", "type": "text" },
      { "name": "avatar_url", "type": "text" }
    ]
  }]
}
```

### Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `event_name` | string | **(required)** | Event type name to record (e.g., `"avatar_uploaded"`, `"order_completed"`) |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["INSERT"]` | Which DML events fire the trigger |
| `count` | integer | `1` | Number of events to record per trigger fire |
| `toggle` | boolean | `false` | Toggle mode: records event when condition is met, removes when condition is unmet |
| `actor_field` | string (column-ref) | `"owner_id"` | Column containing the actor (user) ID to attribute the event to |
| `entity_field` | string (column-ref) | — | Column containing the entity ID (org/group) for entity-scoped events. Omit for user-only events. |
| `auto_register_type` | boolean | `true` | Automatically register the `event_name` in the `event_types` catalog during provisioning |
| `watch_fields` | string[] | — | For UPDATE: only fire when these columns change |
| `condition_field` | string | — | Legacy: column for simple WHEN clause |
| `condition_value` | string | — | Legacy: value to match for `condition_field` |
| `conditions` | object \| array | — | Compound conditions for WHEN clause (same syntax as JobTrigger — see [references/event-tracker.md](references/event-tracker.md)) |

**Constraints:** `conditions`, `condition_field`, and `watch_fields` are mutually exclusive — only one can be specified per trigger.

See [references/event-tracker.md](references/event-tracker.md) for compound conditions syntax, toggle mode, entity-scoped examples, and common patterns.

---

## Blueprint Achievements

The top-level `achievements[]` section defines levels with requirements and optional rewards. Processed in **Phase 7** of `constructBlueprint()` — after tables, relations, and entity types.

```json
{
  "entity_types": [
    { "name": "App User", "prefix": "app", "has_levels": true, "has_limits": true }
  ],
  "tables": [
    {
      "table_name": "user_profiles",
      "nodes": [
        { "$type": "EventTracker", "data": {
          "event_name": "avatar_uploaded",
          "events": ["UPDATE"],
          "watch_fields": ["avatar_url"],
          "conditions": { "field": "avatar_url", "op": "IS NOT NULL" }
        }},
        { "$type": "EventTracker", "data": {
          "event_name": "profile_completed",
          "events": ["UPDATE"],
          "watch_fields": ["display_name"],
          "conditions": { "field": "display_name", "op": "IS NOT NULL" }
        }}
      ],
      "fields": [
        { "name": "display_name", "type": "text" },
        { "name": "avatar_url", "type": "text" }
      ]
    }
  ],
  "achievements": [
    {
      "name": "getting_started",
      "description": "Complete your profile",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 },
        { "event_name": "profile_completed", "count": 1 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 5 }
      ]
    }
  ]
}
```

### Achievement Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Unique level name (e.g., `"getting_started"`, `"power_user"`) |
| `description` | string | No | `null` | Human-readable description |
| `priority` | integer | No | `100` | Display ordering; lower = first |
| `entity_prefix` | string | No | `"app"` | Entity scope to resolve the correct events_module |
| `requirements` | array | **Yes** | — | Requirements that must be met (see below) |
| `rewards` | array | No | `[]` | Credits granted when achieved (see below) |

### Requirement Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_name` | string | **Yes** | Event type name (must match an EventTracker's `event_name` or a step name) |
| `count` | integer | **Yes** | Number of events needed to satisfy the requirement |
| `description` | string | No | Human-readable description |

### Reward Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reward_type` | `"limit_credit"` \| `"meter_credit"` | **Yes** | — | Credit system to grant to |
| `target_name` | string | **Yes** | — | Limit name or meter slug |
| `amount` | integer | **Yes** | — | Number of credits to grant |
| `credit_type` | string | No | `"permanent"` | `"permanent"`, `"expiring"`, etc. |

See [references/achievements.md](references/achievements.md) for cross-table achievements, multi-entity-scope examples, and the reward trigger chain.

---

## Invite Virality Achievements

Enable invite-based achievements per entity type:

```json
{
  "entity_types": [
    {
      "name": "App User",
      "prefix": "app",
      "has_levels": true,
      "has_invites": true,
      "has_invite_achievements": true
    }
  ],
  "achievements": [
    {
      "name": "social_butterfly",
      "description": "Invite 5 friends",
      "requirements": [
        { "event_name": "invite_claimed", "count": 5 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 10 }
      ]
    },
    {
      "name": "mentor",
      "description": "3 of your invitees earned Getting Started",
      "requirements": [
        { "event_name": "invitee_achieved_getting_started", "count": 3 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 50 }
      ]
    }
  ]
}
```

**Two tiers:**

1. **Simple (invite tracking):** `has_invite_achievements` auto-attaches an EventTracker to `{prefix}_claimed_invites` with `actor_field: "sender_id"`. When someone claims an invite, the SENDER gets an `invite_claimed` event.

2. **Meta (invitee achievements):** A SECURITY DEFINER trigger on `level_grants` resolves the inviter via `claimed_invites.sender_id` and records `invitee_achieved_{level_name}` events for the inviter. This enables achievements like "3 of your invitees earned Getting Started".

**Prerequisites:** `has_invite_achievements` requires both `has_invites: true` AND `has_levels: true`. Each entity type gets its own independent invite achievement tracking.

**Full virality chain:**
```
User A invites B → B claims → A gets 'invite_claimed' event
→ B completes profile → B earns 'getting_started' achievement
→ A gets 'invitee_achieved_getting_started' event
→ A earns 'mentor' achievement → A gets 50 credits
→ A invites more people
```

See [references/invite-virality.md](references/invite-virality.md) for detailed examples and the complete trigger chain.

---

## Reference Documentation

| File | Contents |
|------|----------|
| [references/event-tracker.md](references/event-tracker.md) | Full EventTracker parameter reference, compound conditions, toggle mode, entity-scoped examples |
| [references/achievements.md](references/achievements.md) | Achievement definitions, requirements, rewards, credit grant trigger chain |
| [references/invite-virality.md](references/invite-virality.md) | Simple + meta invite tiers, full virality chain, cross-entity examples |
| [references/triggers.md](references/triggers.md) | Internal trigger reference: tg_check_achievements, tg_achievement_reward, tg_invitee_achievement |
