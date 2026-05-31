---
name: constructive-sdk-events
description: "Events, achievements, and gamification — EventTracker blueprint node for recording events on row changes, blueprint achievements[] for defining levels with requirements and credit rewards (limit_credit + meter_credit with expires_interval), invite-based achievements (has_invite_achievements), period-aware event_aggregates (lazy count reset), re-triggerable achievements (per-period re-qualification), EventReferral for attributing events to inviters (with multi-level max_depth for MLM referral chains), the full virality chain, event_types.is_milestone (partition pruning exemption), event_types.feeds_levels (achievement system toggle), and apply_events_security (automatic RLS for all 7 events tables). Use when asked to 'add analytics', 'track events', 'add achievements', 'gamification', 'record events', 'EventTracker', 'level requirements', 'achievement rewards', 'invite achievements', 'invite virality', 'credit grants for achievements', 'meter_credit', 'expires_interval', 'period_interval', 'recurring credits', 'referral credits', 'EventReferral', 'max_depth', 'multi-level referral', 'MLM', 'referral chain', 'is_milestone', 'feeds_levels', 'events security', 'apply_events_security', or when working with events_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Events & Achievements (SDK Guide)

The events system provides event tracking, gamification, and achievement-based credit rewards. Everything is configured through **blueprints** (EventTracker nodes + `achievements[]` section) and managed via the **ORM**.

Three capabilities compose together:
- **`EventTracker`** — table-level node. Attach to any table to declaratively record events when rows change. Same compound condition system as JobTrigger.
- **`achievements[]`** — top-level blueprint section. Define levels with requirements (event counts) and optional rewards (`limit_credit` or `meter_credit` grants, with optional `expires_interval`).
- **`has_invite_achievements`** — entity type flag. Auto-attaches EventTracker to `claimed_invites` and wires the invitee achievement virality chain.
- **`EventReferral`** — table-level node. Wires referral attribution so that when an invitee performs an action, the inviter gets an attributed event. Supports `max_depth` (1–10) for multi-level referral chains — walks up the `claimed_invites` chain N levels, crediting each ancestor.
- **Period-aware counting** — event types with `period_interval` auto-reset aggregate counts each period (lazy reset). Enables re-triggerable achievements for recurring credit grants.

Related skills:
- **`constructive-sdk-limits`**: Limits module, credit grants, cap tables
- **`constructive-sdk-billing`**: Billing meters, universal credits
- **`constructive-jobs`**: JobTrigger (shares the same compound conditions system)
- **`constructive-sdk-entities`**: Entity types, `has_invites`, membership types
- **`constructive-platform`**: Blueprint provisioning overview

---

## Architecture Overview

```
Table row change
  → EventTracker trigger fires (compound conditions evaluated)
    → record_event(event_name, actor_id)
      → app_events log entry (partitioned, time-based retention)
      → upsert_achievement() → event_aggregates updated (with lazy period reset)
        → tg_check_achievements fires
          → level_achieved() = true → level_grants created (period-scoped)
            → tg_achievement_reward → limit_credits or meter_credits granted
            → tg_invitee_achievement → record_event('invitee_achieved_*', inviter_id)
```

All triggers are SECURITY DEFINER — users don't need direct write access to events or credits tables.

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
      { "name": "display_name", "type": { "name": "text" } },
      { "name": "avatar_url", "type": { "name": "text" } }
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
| `entity_field` | string (column-ref) | — | Column containing the entity ID (org/group) for entity-scoped events. For FK lookups, combine with `entity_lookup`. Omit for user-only events. |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK (e.g., `channel_id → channels.entity_id`). |
| `auto_register_type` | boolean | `true` | Automatically register the `event_name` in the `event_types` catalog during provisioning |
| `watch_fields` | string[] | — | For UPDATE: only fire when these columns change |
| `condition_field` | string | — | Legacy: column for simple WHEN clause |
| `condition_value` | string | — | Legacy: value to match for `condition_field` |
| `conditions` | object \| array | — | Compound conditions for WHEN clause (same syntax as JobTrigger — see [references/event-tracker.md](references/event-tracker.md)) |

**Constraints:** `conditions`, `condition_field`, and `watch_fields` are mutually exclusive — only one can be specified per trigger.

See [references/event-tracker.md](references/event-tracker.md) for compound conditions syntax, toggle mode, entity-scoped examples, and common patterns.

---

## EventReferral Blueprint Node

Add `EventReferral` to a table's `nodes[]` to credit the actor's inviter (and optionally their inviter's inviter, etc.) when a row changes:

```json
{
  "tables": [{
    "table_name": "user_uploads",
    "nodes": [
      { "$type": "EventReferral", "data": {
        "event_name": "invitee_uploaded",
        "events": ["INSERT"],
        "actor_field": "owner_id",
        "max_depth": 5
      }}
    ]
  }]
}
```

### Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `event_name` | string | **(required)** | Event type name to record for each ancestor in the invite chain |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["INSERT"]` | Which DML events fire the trigger |
| `actor_field` | string (column-ref) | `"owner_id"` | Column containing the invitee (actor) ID — used to look up the referrer via `claimed_invites.receiver_id` |
| `entity_field` | string (column-ref) | — | Column containing the entity ID for entity-scoped referral events. For FK lookups, combine with `entity_lookup`. **Cannot be combined with `max_depth > 1`.** |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK. |
| `max_depth` | integer | `1` | How many levels up the invite chain to walk. `1` = direct inviter only (default). `2`–`10` = multi-level referral chain. Hard cap at 10. |
| `auto_register_type` | boolean | `true` | Automatically register the `event_name` in the `event_types` catalog during provisioning |
| `conditions` | object \| array | — | Compound conditions for WHEN clause (same syntax as EventTracker) |

### Toggles & Controls

- **Build-time:** `max_depth` is the toggle. Default `1` = single-hop behavior. Set `2`–`10` to opt in to multi-level.
- **Runtime:** `event_types.is_active` — flip to `false` to pause referral rewards without redeploying.
- **Scope constraint:** `max_depth > 1` requires app-level scope only (`entity_field` must be omitted). The generator raises an exception if both are set.

### How Multi-Level Works

When `max_depth > 1`, the trigger builds a FOR loop that walks `claimed_invites`:

```
User action (INSERT on user_uploads)
  → trigger resolves NEW.owner_id
  → FOR depth IN 1..max_depth:
      SELECT sender_id FROM claimed_invites WHERE receiver_id = current
      EXIT WHEN no sender found
      record_event(event_name, sender_id)
      current := sender_id
```

Each ancestor in the chain receives the same event. Combined with tiered achievement thresholds, this creates natural attenuation — direct inviters accumulate events quickly (low threshold, high reward), while deeper ancestors accumulate slowly (high threshold, low reward).

See [references/event-referral.md](references/event-referral.md) for multi-level blueprint examples, the viral loop pattern, and attenuation design.

---

## Event Type Configuration Fields

The `event_types` table is auto-populated when `auto_register_type: true` (default) during provisioning. Each event type row has runtime-configurable fields beyond the basic `name`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `is_active` | boolean | `true` | Kill switch — set to `false` to pause recording without redeploying |
| `is_milestone` | boolean | `false` | Exempts this event type from partition pruning/retention. Milestone events are **never deleted** regardless of the module's `retention` interval. Use for irreversible achievements or compliance-critical events. |
| `feeds_levels` | boolean | `true` | Controls whether this event type participates in the achievement system. When `true`, recording an event updates `event_aggregates` and triggers `tg_check_achievements`. Set to `false` for telemetry-only events that should not drive level progression. |
| `retention_days` | integer | `NULL` | Per-type retention override in days. `NULL` uses the module default; `0` means keep forever. |
| `period_interval` | interval | `NULL` | Period for aggregate count reset. `NULL` means lifetime counting. |

### Example: Milestone + non-level event types

```typescript
// Via ORM: mark 'account_created' as a milestone (never pruned)
await db.appEventType.update({
  where: { name: { equalTo: 'account_created' } },
  data: { isMilestone: true },
}).execute();

// 'page_view' is telemetry only — don't feed achievements
await db.appEventType.update({
  where: { name: { equalTo: 'page_view' } },
  data: { feedsLevels: false },
}).execute();
```

---

## Events Security

Events security is **automatically provisioned** when the events module is installed — no manual RLS setup required. The `apply_events_security()` generator creates RLS policies for all 7 events tables:

| Table | SELECT | Mutations | Admin |
|-------|--------|-----------|-------|
| `events` | Own rows (`AuthzDirectOwner` on `actor_id`) | System triggers only | `admin_levels` permission |
| `event_aggregates` | All authenticated (`AuthzAllowAll` — leaderboards) | System triggers only | `admin_levels` |
| `event_types` | All authenticated | — | `admin_levels` (INSERT/UPDATE/DELETE) |
| `levels` | All authenticated | — | `admin_levels` (INSERT/UPDATE/DELETE) |
| `level_requirements` | All authenticated | — | `admin_levels` (INSERT/UPDATE/DELETE) |
| `level_grants` | Own rows | System triggers only | `admin_levels` |
| `achievement_rewards` | All authenticated | — | `admin_levels` (INSERT/UPDATE/DELETE) |

For entity-scoped events, policies use `AuthzEntityMembership` instead of `AuthzAppMembership`, with the same permission structure scoped to the entity.

For platform-scoped events, all tables use `apply_module_security` with `AuthzRelatedEntityMembership` through the database record.

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
        { "name": "display_name", "type": { "name": "text" } },
        { "name": "avatar_url", "type": { "name": "text" } }
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
| `target_name` | string | **Yes** | — | Limit name (for `limit_credit`) or meter slug (for `meter_credit`) |
| `amount` | integer | **Yes** | — | Number of credits to grant |
| `credit_type` | string | No | `"permanent"` | `"permanent"`, `"expiring"`, `"period"`, etc. |
| `expires_interval` | interval string | No | `null` | Credits expire after this duration (e.g., `"30 days"`). `meter_credit` only. |

`meter_credit` rewards require both `events_module` and `billing_module` to be provisioned for the same database.

See [references/achievements.md](references/achievements.md) for reward type details, period-aware aggregates, re-triggerable achievements, cross-table achievements, and the reward trigger chain.

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
| [references/event-referral.md](references/event-referral.md) | EventReferral parameter reference, multi-level `max_depth` chain walk, MLM blueprint examples, attenuation design |
| [references/achievements.md](references/achievements.md) | Achievement definitions, requirements, rewards (limit_credit + meter_credit), expires_interval, period-aware aggregates, re-triggerable achievements |
| [references/invite-virality.md](references/invite-virality.md) | Simple + meta invite tiers, full virality chain, cross-entity examples |
| [references/triggers.md](references/triggers.md) | Internal trigger reference: tg_check_achievements, tg_achievement_reward, tg_invitee_achievement |
