# EventReferral Reference

EventReferral is a table-level blueprint node that attributes events to the actor's inviter(s) when a row changes. It resolves the referrer via the invites module's `claimed_invites` table.

## Single-Level Referral (Default)

With `max_depth: 1` (or omitted), EventReferral credits only the direct inviter:

```json
{
  "tables": [{
    "table_name": "user_profiles",
    "nodes": [
      { "$type": "EventReferral", "data": {
        "event_name": "invitee_completed_profile",
        "events": ["UPDATE"],
        "actor_field": "owner_id"
      }}
    ]
  }]
}
```

When User B (invited by User A) updates their profile:
1. Trigger fires → resolves `NEW.owner_id` (User B)
2. Looks up `claimed_invites WHERE receiver_id = B` → finds User A
3. Calls `record_event('invitee_completed_profile', A)`

## Multi-Level Referral (max_depth > 1)

Set `max_depth` to walk up the invite chain multiple levels:

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

When User D (chain: A invited B invited C invited D) uploads a file:
1. Depth 1: `claimed_invites WHERE receiver_id = D` → C. Records event for C.
2. Depth 2: `claimed_invites WHERE receiver_id = C` → B. Records event for B.
3. Depth 3: `claimed_invites WHERE receiver_id = B` → A. Records event for A.
4. Depth 4: `claimed_invites WHERE receiver_id = A` → NULL. Loop exits.

All three ancestors (C, B, A) receive the same `invitee_uploaded` event. The loop stops early if the chain is shorter than `max_depth`.

## Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `event_name` | string | **(required)** | Event type name to record for each ancestor |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["INSERT"]` | Which DML events fire the trigger |
| `actor_field` | string (column-ref) | `"owner_id"` | Column containing the invitee (actor) ID |
| `entity_field` | string (column-ref) | — | Entity ID column for entity-scoped events. For FK lookups, combine with `entity_lookup`. **Cannot be combined with `max_depth > 1`.** |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK. |
| `max_depth` | integer | `1` | Levels to walk up the invite chain. Range: 1–10. |
| `auto_register_type` | boolean | `true` | Auto-register `event_name` in `event_types` during provisioning |
| `conditions` | object \| array | — | Compound conditions for WHEN clause |

## Constraints

- **`max_depth` range:** 1–10. The generator raises an exception for values outside this range.
- **App-level scope only:** When `max_depth > 1`, `entity_field` must be omitted. The chain walk uses `claimed_invites` which is scoped by membership_type at the app level. Entity-scoped actions still credit the chain — the trigger resolves the *user* who performed the action, not the entity.
- **Default behavior:** `max_depth: 1` (or omitted) produces a single-lookup trigger (direct inviter only).

## Toggles

| Toggle | Type | How |
|--------|------|-----|
| Build-time on/off | `max_depth` parameter | `1` = off (single hop), `2`–`10` = on (multi-level) |
| Runtime on/off | `event_types.is_active` | Set to `false` to pause referral event recording without redeploying |

## Multi-Level MLM Blueprint Example

A complete blueprint showing 5-level referral rewards with tiered achievements:

```json
{
  "entity_types": [
    {
      "name": "App Members",
      "prefix": "app",
      "has_invites": true,
      "has_levels": true,
      "has_limits": true
    }
  ],

  "tables": [
    {
      "table_name": "databases",
      "fields": [
        { "name": "name", "type": { "name": "text" }, "is_required": true },
        { "name": "owner_id", "type": { "name": "uuid" }, "is_required": true }
      ],
      "nodes": [
        { "$type": "EventReferral", "data": {
          "event_name": "invitee_created_db",
          "events": ["INSERT"],
          "actor_field": "owner_id",
          "max_depth": 5
        }},
        { "$type": "LimitCounter", "data": { "limit_name": "databases" } }
      ]
    }
  ],

  "achievements": [
    {
      "name": "referral_bronze",
      "description": "3 people in your network created a database",
      "priority": 10,
      "requirements": [
        { "event_name": "invitee_created_db", "count": 3 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "databases", "amount": 5 }
      ]
    },
    {
      "name": "referral_silver",
      "description": "10 people in your network created a database",
      "priority": 20,
      "requirements": [
        { "event_name": "invitee_created_db", "count": 10 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "databases", "amount": 3 }
      ]
    },
    {
      "name": "referral_gold",
      "description": "25 people in your network created a database",
      "priority": 30,
      "requirements": [
        { "event_name": "invitee_created_db", "count": 25 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "databases", "amount": 2 }
      ]
    }
  ]
}
```

## Attenuation Design

Multi-level referrals create natural attenuation without any per-depth tracking:

- **Direct inviters** (depth 1) see events frequently — their invitees' actions directly generate events. They hit achievement thresholds quickly.
- **2nd-degree ancestors** see events less often — only when their invitees' invitees act.
- **5th-degree ancestors** accumulate events very slowly.

The tiered achievement thresholds (3 → 10 → 25) create decreasing rewards at each tier. Combined with the natural event decay at deeper levels, this produces an MLM-style attenuation curve without any schema changes or depth-tracking infrastructure.

### Performance

Each depth level is one indexed lookup on `claimed_invites(receiver_id)`. With `max_depth=10`, that's at most 10 index scans per trigger fire — negligible overhead.

## Composing with Invite Virality

EventReferral composes with `has_invite_achievements`. They serve different purposes:

- **`has_invite_achievements`**: Credits the inviter when an invite is *claimed* (`invite_claimed` event) and when an invitee *earns an achievement* (`invitee_achieved_*` events). Always single-level.
- **`EventReferral`**: Credits the inviter(s) when an invitee performs a *table action*. Supports multi-level via `max_depth`.

Both can be used simultaneously. A common pattern is `has_invite_achievements` for the social/gamification loop and `EventReferral` with `max_depth > 1` for the MLM referral reward chain.
