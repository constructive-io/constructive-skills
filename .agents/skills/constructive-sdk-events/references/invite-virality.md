# Invite Virality Achievements

The invite virality system composes EventTracker with the invites module to create viral growth loops. Two tiers of invite-based achievements are available.

## Prerequisites

All three flags must be set on the entity type:

```json
{
  "entity_types": [
    {
      "name": "App User",
      "prefix": "app",
      "has_invites": true,
      "has_levels": true,
      "has_invite_achievements": true
    }
  ]
}
```

| Flag | Required | Purpose |
|------|----------|---------|
| `has_invites` | **Yes** | Provisions invite tables (`{prefix}_invites`, `{prefix}_claimed_invites`) |
| `has_levels` | **Yes** | Provisions events module (events, aggregates, levels, achievements) |
| `has_invite_achievements` | **Yes** | Attaches EventTracker to `claimed_invites` + wires invitee achievement trigger |

## Tier 1: Simple Invite Tracking

When `has_invite_achievements: true`, the system auto-attaches an `EventTracker` to the `{prefix}_claimed_invites` table:

- **event_name:** `"invite_claimed"`
- **events:** `["INSERT"]`
- **actor_field:** `"sender_id"` (credits the SENDER, not the receiver)
- **auto_register_type:** `true`

This means every time someone claims an invite, the **inviter** (sender) gets an `invite_claimed` event. No manual EventTracker configuration needed.

### Example: "Invite 5 friends" achievement

```json
{
  "achievements": [
    {
      "name": "social_butterfly",
      "description": "Successfully invite 5 people",
      "requirements": [
        { "event_name": "invite_claimed", "count": 5 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 10 }
      ]
    }
  ]
}
```

### Tiered invite achievements

```json
{
  "achievements": [
    {
      "name": "recruiter_bronze",
      "priority": 10,
      "requirements": [{ "event_name": "invite_claimed", "count": 3 }],
      "rewards": [{ "reward_type": "limit_credit", "target_name": "storage_gb", "amount": 1 }]
    },
    {
      "name": "recruiter_silver",
      "priority": 20,
      "requirements": [{ "event_name": "invite_claimed", "count": 10 }],
      "rewards": [{ "reward_type": "limit_credit", "target_name": "storage_gb", "amount": 5 }]
    },
    {
      "name": "recruiter_gold",
      "priority": 30,
      "requirements": [{ "event_name": "invite_claimed", "count": 25 }],
      "rewards": [{ "reward_type": "limit_credit", "target_name": "storage_gb", "amount": 20 }]
    }
  ]
}
```

## Tier 2: Meta — Invitee Achievements

The meta tier rewards inviters when their invitees earn achievements. This is the viral loop.

When `has_invite_achievements: true`, a SECURITY DEFINER trigger (`tg_invitee_achievement`) fires AFTER INSERT on `level_grants`. It:

1. Looks up the inviter: `SELECT sender_id FROM claimed_invites WHERE receiver_id = NEW.actor_id LIMIT 1`
2. If the achiever was invited by someone, records: `record_event('invitee_achieved_{level_name}', inviter_id)`

The event name is auto-generated: `invitee_achieved_` + the level name that was just earned.

### Example: "Mentor" achievement

```json
{
  "achievements": [
    {
      "name": "getting_started",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 },
        { "event_name": "profile_completed", "count": 1 }
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

When User B (invited by User A) earns `getting_started`:
1. `level_grants` row inserted for User B
2. `tg_invitee_achievement` fires → finds User A as inviter
3. `record_event('invitee_achieved_getting_started', user_a_id)` called
4. User A's aggregate for `invitee_achieved_getting_started` increments
5. When User A accumulates 3 such events → `mentor` achievement → 50 credits

## Full Virality Chain

```
User A invites User B
  → B claims invite → A gets 'invite_claimed' event (tier 1)
  → B uploads avatar → B gets 'avatar_uploaded' event
  → B completes profile → B gets 'profile_completed' event
  → B earns 'getting_started' achievement
    → A gets 'invitee_achieved_getting_started' event (tier 2)
  → A has 3 invitees who earned 'getting_started'
    → A earns 'mentor' achievement → A gets 50 credits
    → A invites more people (viral loop)
```

## Entity-Scoped Invites

Each entity type gets its own independent invite achievement tracking. If both `app` and `org` have `has_invite_achievements: true`:

- `app_claimed_invites` → EventTracker with `invite_claimed` events for app scope
- `org_claimed_invites` → EventTracker with `invite_claimed` events for org scope
- `app_level_grants` → invitee achievement trigger for app scope
- `org_level_grants` → invitee achievement trigger for org scope

Achievements reference their entity scope via `entity_prefix`:

```json
{
  "entity_types": [
    { "prefix": "app", "has_invites": true, "has_levels": true, "has_invite_achievements": true },
    { "prefix": "org", "parent_entity": "app", "has_invites": true, "has_levels": true, "has_invite_achievements": true }
  ],
  "achievements": [
    {
      "name": "app_recruiter",
      "entity_prefix": "app",
      "requirements": [{ "event_name": "invite_claimed", "count": 5 }]
    },
    {
      "name": "org_recruiter",
      "entity_prefix": "org",
      "requirements": [{ "event_name": "invite_claimed", "count": 3 }]
    }
  ]
}
```

## Composing with Other Events

Invite achievements compose naturally with regular EventTracker events. A single achievement can require both invite events and table-driven events:

```json
{
  "achievements": [
    {
      "name": "community_builder",
      "description": "Invite 3 people AND create 5 projects",
      "requirements": [
        { "event_name": "invite_claimed", "count": 3 },
        { "event_name": "project_created", "count": 5 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 25 }
      ]
    }
  ]
}
```
