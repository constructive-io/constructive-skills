# Internal Trigger Reference

This reference describes the SECURITY DEFINER triggers that power the events + achievements system. These are automatically generated during provisioning — developers don't create them manually. Understanding them helps when debugging or extending the system.

## Trigger Chain

```
EventTracker trigger (per table)
  → record_event()
    → app_events log entry
    → upsert_achievement()
      → event_aggregates updated
        → tg_check_achievements fires
          → level_achieved()
            → grant_achievement() → level_grants created
              → tg_achievement_reward fires
                → limit_credits or meter_credits granted
              → tg_invitee_achievement fires
                → record_event('invitee_achieved_*', inviter_id)
```

## EventTracker Trigger

**Created by:** `event_tracker` generator in `table_module`
**Fires:** AFTER INSERT, UPDATE, or DELETE (configurable via `events` parameter)
**On:** The table the EventTracker node is attached to
**Security:** SECURITY DEFINER (runs as database owner)
**Body:** Calls `record_event(step, actor_id)` or `record_event(step, actor_id, entity_id)` with the configured `event_name` and resolved actor/entity fields.

Compound conditions are compiled into the trigger's WHEN clause at generation time via `build_condition_ast()`.

## tg_check_achievements

**Created by:** `events_module` provisioning
**Fires:** AFTER INSERT or UPDATE on `{prefix}_event_aggregates`
**Security:** SECURITY DEFINER
**Body:**
1. Loops over all distinct levels whose requirements reference the updated event name
2. For each level, calls `level_achieved()` to check whether all requirements are met for the actor (and entity, if entity-scoped)
3. If achieved, inserts into `level_grants` with the actor, level name, and the aggregate's `period_start` (defaulting to a sentinel value for non-periodic events)
4. On conflict (duplicate grant for the same actor + level + period), does nothing — this prevents re-grants within the same period while allowing new grants in new periods

## tg_achievement_reward

**Created by:** `events_module` provisioning (cross-module wiring with `limits_module` and/or `billing_module`)
**Fires:** AFTER INSERT on `{prefix}_level_grants`
**Security:** SECURITY DEFINER
**Condition:** Only generated when at least one of `limits_module` or `billing_module` exists for the same entity scope.
**Body:**
1. Loops over all `achievement_rewards` matching the granted level name
2. For each reward, branches on `reward_type`:

**`limit_credit` branch** (requires `limits_module`):
   - Looks up the default limit by `target_name`
   - Grants credits to the actor's `limit_credits` (amount, credit_type from the reward definition)

**`meter_credit` branch** (requires `billing_module`):
   - Looks up the meter by `target_name` (slug)
   - Grants credits to the entity's `meter_credits` with the configured amount and credit_type
   - If `expires_interval` is set on the reward, computes an expiration timestamp (`now() + expires_interval`)
   - Sets a reason tag like `"achievement:level_name"` for audit

The trigger is generated with the correct branches based on which modules are provisioned (limits-only, billing-only, or both).

**Why SECURITY DEFINER:** Users don't have direct write access to `limit_credits`, `meter_credits`, or related tables. The trigger runs as the database owner to bypass RLS.

## tg_invitee_achievement

**Created by:** `insert_entity_type_provision` trigger (when `has_invite_achievements = true`)
**Fires:** AFTER INSERT on `{prefix}_level_grants`
**Security:** SECURITY DEFINER
**Condition:** Only generated when both `events_module` and `invites_module` exist for the entity type.
**Body:**
1. Looks up who invited the actor by querying `claimed_invites` for the actor's `receiver_id`
2. If an inviter (sender) is found, records an event named `invitee_achieved_{level_name}` attributed to the inviter
   (entity variant also passes the entity_id)
3. If no inviter exists (user wasn't invited), does nothing

**Event naming:** The event name is dynamically constructed as `invitee_achieved_` + the level name from the newly inserted `level_grants` row. For example, if `NEW.level_name = 'getting_started'`, the event recorded is `invitee_achieved_getting_started`.

## record_event

**Created by:** `events_module` provisioning
**Type:** Function (not a trigger)
**Signatures:**
- User variant: `record_event(step text, actor_id uuid)`
- Entity variant: `record_event(step text, actor_id uuid, entity_id uuid)`

**Body:**
1. Writes to `{prefix}_events` (the partitioned event log)
2. Calls `upsert_achievement(step, actor_id)` to update aggregates

## upsert_aggregate (period-aware)

**Created by:** `events_module` provisioning
**Type:** Function (called by `record_event()`)
**Body:** Upserts into `event_aggregates`. When the event type has a `period_interval`:
1. Fetches the event type's aggregation mode, whether it feeds achievements, and its `period_interval`
2. On first event: initializes `period_start` to now (if periodic) or leaves it null (if lifetime)
3. On subsequent events (existing aggregate row):
   - If the period has elapsed (`period_start + period_interval ≤ now`): resets count to the incoming value and refreshes `period_start`
   - If the period is still active: accumulates count normally
   - If `period_start` was null but the event type now has a `period_interval`: initializes `period_start`

This is the same lazy reset pattern used by the billing module's period-based credits.

## grant_achievement

**Created by:** `events_module` provisioning
**Type:** Function (callable directly)
**Signatures:**
- User variant: `grant_achievement(level_name citext, actor_id uuid)`
- Entity variant: `grant_achievement(level_name citext, actor_id uuid, entity_id uuid)`

**Body:**
1. Inserts a `level_grants` row for the given level and actor. If the grant already exists (duplicate key), does nothing.
2. Returns void — idempotent by design

This function can be called directly (outside of the trigger chain) for manual achievement grants (e.g., from admin tooling or migration scripts).

## Tables Created by events_module

| Table | Purpose |
|-------|---------|
| `{prefix}_steps` | Step definitions (event types within the events module) |
| `{prefix}_event_aggregates` | Running counts per user per event type, with optional `period_start` for periodic reset |
| `{prefix}_events` | Partitioned event log (time-based partitions via pg_partman) |
| `{prefix}_event_types` | Event type catalog with optional `period_interval` for periodic counting |
| `{prefix}_levels` | Level definitions (achievement names, descriptions, priorities) |
| `{prefix}_level_requirements` | Requirements per level (event_name + count) |
| `{prefix}_level_grants` | Records of which users have earned which levels (UNIQUE includes `period_start` for per-period re-grants) |
| `{prefix}_achievement_rewards` | Reward definitions per level (credit type, target, amount) |
