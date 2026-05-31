---
name: constructive-events
description: "EventTracker, achievements, referrals, invite virality — EventTracker blueprint node for recording events on row changes, achievements[] for levels with credit rewards, EventReferral for multi-level referral chains, period-aware counting. Use when asked to 'add analytics', 'track events', 'add achievements', 'gamification', 'EventTracker', 'level requirements', 'achievement rewards', 'invite virality', 'referral credits', 'EventReferral', 'max_depth', 'multi-level referral', or when working with events_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Events

Event tracking, gamification, and achievement-based credit rewards. Configured through blueprints (EventTracker nodes + `achievements[]`) and managed via the ORM.

## When to Apply

Use this skill when:
- Adding event tracking to tables (EventTracker node)
- Defining achievements with requirements and credit rewards
- Building invite virality chains (EventReferral with max_depth)
- Implementing period-aware recurring achievements
- Tracking analytics events on row changes

## Architecture

```
Table row change
  → EventTracker trigger (compound conditions evaluated)
    → record_event(event_name, actor_id)
      → app_events log (partitioned, time-based retention)
      → upsert_achievement() → event_aggregates updated
        → tg_check_achievements
          → level_achieved() → level_grants created
            → tg_achievement_reward → credits granted
            → tg_invitee_achievement → record_event for inviter
```

## Capabilities

| Capability | Node/Config | Purpose |
|------------|-------------|---------|
| **EventTracker** | Table `nodes[]` | Record events on row INSERT/UPDATE/DELETE |
| **achievements[]** | Top-level blueprint | Levels with requirements and rewards |
| **has_invite_achievements** | Entity type flag | Auto-wire invitee achievement chain |
| **EventReferral** | Table `nodes[]` | Attribute events to inviters (multi-level) |
| **period_interval** | Event type config | Auto-reset counts for recurring achievements |

## EventTracker

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
    ]
  }]
}
```

## EventReferral (Multi-Level Referral)

```json
{ "$type": "EventReferral", "data": {
  "event_name": "purchase_completed",
  "max_depth": 3
}}
```

`max_depth` (1–10) walks up the `claimed_invites` chain N levels, crediting each ancestor inviter.

## References

| File | Content |
|------|---------|
| [event-tracker.md](./references/event-tracker.md) | EventTracker configuration reference |
| [achievements.md](./references/achievements.md) | Achievement levels, requirements, rewards |
| [event-referral.md](./references/event-referral.md) | Referral attribution and multi-level chains |
| [invite-virality.md](./references/invite-virality.md) | Invite virality chain wiring |
| [triggers.md](./references/triggers.md) | Trigger internals and compound conditions |

## Cross-References

- **Limits and credits:** [`constructive-billing`](../constructive-billing/SKILL.md)
- **Entity types and invites:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Background jobs (shared conditions system):** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
