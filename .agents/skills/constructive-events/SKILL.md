---
name: constructive-events
description: "EventTracker, achievements, trust ladders, referrals, invite virality — EventTracker blueprint node for recording events on row changes, achievements[] for levels with credit rewards, the humanity and metered trust ladders that turn evidence into capability bits, EventReferral for multi-level referral chains, period-aware counting. Use when asked to 'add analytics', 'track events', 'add achievements', 'gamification', 'progressive trust', 'trust ladder', 'humanity', 'verify a human', 'levels', 'EventTracker', 'level requirements', 'achievement rewards', 'invite virality', 'referral credits', 'EventReferral', 'max_depth', 'multi-level referral', or when working with events_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Events

Event tracking, gamification, progressive trust, and achievement-based rewards. Configured through blueprints (EventTracker nodes + `achievements[]`) and module options (`trust_ladder`), and managed via the ORM.

## When to Apply

Use this skill when:
- Adding event tracking to tables (EventTracker node)
- Defining achievements with requirements and credit rewards
- Building invite virality chains (EventReferral with max_depth)
- Implementing period-aware recurring achievements
- Tracking analytics events on row changes
- Turning evidence into access — trust ladders, earned levels, capability rewards

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

## Features

| Feature | Node/Config | Purpose |
|---------|-------------|---------|
| **EventTracker** | Table `nodes[]` | Record events on row INSERT/UPDATE/DELETE |
| **achievements[]** | Top-level blueprint | Levels with requirements and rewards |
| **has_invite_achievements** | Entity type flag | Auto-wire invitee achievement chain |
| **EventReferral** | Table `nodes[]` | Attribute events to inviters (multi-level) |
| **period_interval** | Event type config | Auto-reset counts for recurring achievements |
| **trust_ladder** | `events_module` option | Seed a ladder of rungs that earn capability bits and capacity |

## Trust Ladders

A **trust ladder** is a set of rungs that turn recorded evidence into access — the same levels/requirements/rewards machinery as `achievements[]`, with rungs that reward a *capability* rather than a credit. Request one by slug when the events module is provisioned:

```json
["events_module", { "scope": "app", "trust_ladder": "humanity" }]
```

| Slug | Question it answers | Rungs |
|---|---|---|
| `humanity` | Does this account belong to someone? | `reachable` (email **or** phone **or** captcha) → `profile_complete` badge |
| `metered` | How much may this account consume? | `reachable` → `accountable` → `established` → `trusted` → `vouched`, each buying limit capacity |

Humans, bots and agents climb identically — nothing in a ladder asserts humanity, it accumulates evidence that costs something to fake. **No shipped module preset requests a ladder yet**, so it must be named explicitly today. Full rung tables, rung fields, and the `metered` limit baseline: [trust-ladders.md](./references/trust-ladders.md).

## Levels and Capabilities

A level reached through events can project into the access-control system: the reward attached to a rung sets a capability with `kind = 'level'` on the member's row, so an RLS policy can require it exactly like a granted capability (`levels: ["level.reachable"]`). This is how earned trust becomes enforceable access rather than a display badge — a rung with no capability reward is a badge and grants nothing.

Two things to know before designing around it:

- **Owners and admins hold every level automatically.** Their membership is given the complete capability set, so a level requirement never constrains them inside their own entity. See [`constructive-access-control` → admin-owner-member.md](../constructive-access-control/references/admin-owner-member.md#owner-and-admin-hold-every-capability).
- **Levels are earned, never granted.** Do not expose `kind = 'level'` rows in a grant or profile picker; filter capability lists by `kind`.

See [`constructive-access-control` → named-capabilities.md](../constructive-access-control/references/named-capabilities.md#two-kinds-of-capability) for the capability model itself.

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
| [trust-ladders.md](./references/trust-ladders.md) | Progressive trust — the `humanity` and `metered` ladders, rung fields, capability rewards |
| [event-referral.md](./references/event-referral.md) | Referral attribution and multi-level chains |
| [invite-virality.md](./references/invite-virality.md) | Invite virality chain wiring |
| [triggers.md](./references/triggers.md) | Trigger internals and compound conditions |

## Cross-References

- **Limits and credits:** [`constructive-billing`](../constructive-billing/SKILL.md)
- **Entity types and invites:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Background jobs (shared conditions system):** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
