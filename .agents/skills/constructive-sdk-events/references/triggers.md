# Internal Trigger Reference

This reference describes the SECURITY DEFINER triggers that power the events + achievements system. These are automatically generated during provisioning — developers don't create them manually. Understanding them helps when debugging or extending the system.

## Trigger Chain

```
EventTracker trigger (per table)
  → record_event() / record_event_entity()
    → app_events INSERT
    → upsert_achievement()
      → event_aggregates UPSERT
        → tg_check_achievements (AFTER INSERT|UPDATE on event_aggregates)
          → level_achieved()
            → grant_achievement() → level_grants INSERT
              → tg_achievement_reward (AFTER INSERT on level_grants)
                → limit_credits INSERT (credit grant)
              → tg_invitee_achievement (AFTER INSERT on level_grants)
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
1. FOR loop over `SELECT DISTINCT lr.level FROM level_requirements WHERE lr.name = NEW.name`
2. For each level, calls `level_achieved(v_level_name, NEW.actor_id)` (or `level_achieved(v_level_name, NEW.entity_id, NEW.actor_id)`)
3. If achieved, INSERTs into `level_grants` with:
   - `actor_id = NEW.actor_id`
   - `level_name = v_level_name`
   - `period_start = COALESCE(NEW.period_start, '-infinity'::timestamptz)`
   - `entity_id = NEW.entity_id` (entity variant only)
4. `ON CONFLICT DO NOTHING` — unique constraint on `(actor_id, level_name, period_start)` prevents re-grants within the same period. For non-periodic events (`period_start = NULL`), COALESCE produces `-infinity` which is constant, preserving earn-once semantics.

## tg_achievement_reward

**Created by:** `events_module` provisioning (cross-module wiring with `limits_module` and/or `billing_module`)
**Fires:** AFTER INSERT on `{prefix}_level_grants`
**Security:** SECURITY DEFINER
**Condition:** Only generated when at least one of `limits_module` or `billing_module` exists for the same entity scope.
**Body:**
1. FOR loop over `achievement_rewards WHERE level_name = NEW.level_name`
2. For each reward row, branches on `reward_type`:

**`limit_credit` branch** (requires `limits_module`):
   - Resolves `default_limit_id` from `default_limits WHERE name = reward.target_name`
   - If found, INSERTs into `limit_credits`:
     - `actor_id = NEW.actor_id`
     - `default_limit_id = resolved id`
     - `amount = reward.amount`
     - `credit_type = reward.credit_type`
     - `entity_id = NEW.entity_id` (entity variant only)

**`meter_credit` branch** (requires `billing_module`):
   - Resolves `meter_id` from `meters WHERE slug = reward.target_name`
   - If found, INSERTs into `meter_credits`:
     - `meter_id = resolved id`
     - `entity_id = NEW.actor_id` (user variant) or `NEW.entity_id` (entity variant)
     - `amount = reward.amount`
     - `credit_type = reward.credit_type`
     - `expires_at = CASE WHEN reward.expires_interval IS NOT NULL THEN now() + reward.expires_interval ELSE NULL END`
     - `reason = 'achievement:' || NEW.level_name`

The trigger is generated with the correct branches based on which modules are provisioned (limits-only, billing-only, or both).

**Why SECURITY DEFINER:** Users don't have INSERT permission on `limit_credits`, `meter_credits`, or related tables. The trigger runs as the database owner to bypass RLS.

## tg_invitee_achievement

**Created by:** `insert_entity_type_provision` trigger (when `has_invite_achievements = true`)
**Fires:** AFTER INSERT on `{prefix}_level_grants`
**Security:** SECURITY DEFINER
**Condition:** Only generated when both `events_module` and `invites_module` exist for the entity type.
**Body:**
1. `SELECT sender_id INTO v_sender_id FROM {prefix}_claimed_invites WHERE receiver_id = NEW.actor_id LIMIT 1`
2. `IF v_sender_id IS NOT NULL THEN`
3. `PERFORM record_event(step := 'invitee_achieved_' || NEW.level_name, actor_id := v_sender_id)`
   (entity variant includes `entity_id := NEW.entity_id`)
4. `END IF`
5. `RETURN NEW`

**Event naming:** The event name is dynamically constructed as `invitee_achieved_` + the level name from the newly inserted `level_grants` row. For example, if `NEW.level_name = 'getting_started'`, the event recorded is `invitee_achieved_getting_started`.

## record_event

**Created by:** `events_module` provisioning
**Type:** Function (not a trigger)
**Signatures:**
- User variant: `record_event(step text, actor_id uuid)`
- Entity variant: `record_event(step text, actor_id uuid, entity_id uuid)`

**Body:**
1. INSERTs into `{prefix}_events` (the partitioned event log)
2. Calls `upsert_achievement(step, actor_id)` to update aggregates

## upsert_aggregate (period-aware)

**Created by:** `events_module` provisioning
**Type:** Function (called by `record_event()`)
**Body:** Performs an `INSERT ... ON CONFLICT` on `event_aggregates`. When the event type has a `period_interval`:
1. Fetches `aggregation`, `feeds_levels`, and `period_interval` from `event_types`
2. On INSERT: sets `period_start = CASE WHEN v_period_interval IS NOT NULL THEN now() ELSE NULL END`
3. On CONFLICT (existing row):
   - Checks `period_expired_cond`: `v_period_interval IS NOT NULL AND period_start IS NOT NULL AND period_start + v_period_interval <= now()`
   - If expired: resets `count` to incoming value (instead of accumulating) and refreshes `period_start = now()`
   - If not expired: accumulates `count` normally, keeps existing `period_start`
   - If `period_start IS NULL` but `v_period_interval IS NOT NULL`: initializes `period_start = now()`

This is the same lazy reset pattern used by the billing module's period-based credits.

## grant_achievement

**Created by:** `events_module` provisioning
**Type:** Function (callable directly)
**Signatures:**
- User variant: `grant_achievement(level_name citext, actor_id uuid)`
- Entity variant: `grant_achievement(level_name citext, actor_id uuid, entity_id uuid)`

**Body:**
1. `INSERT INTO level_grants (level_name, actor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
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
