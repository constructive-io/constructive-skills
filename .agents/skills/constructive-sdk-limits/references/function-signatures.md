# Limits Module — Function Signatures Reference

All functions are created in the **private schema** as `SECURITY DEFINER` (bypasses RLS).

The `{prefix}` is derived from the entity type name (e.g., `org` for org-level entities, `app` for app-level).

---

## Core Enforcement (Per-User)

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 1 | `{prefix}_limits_check` | `(limitname citext, amount bigint DEFAULT 1, user_id uuid DEFAULT current_user_id())` | `boolean` | Returns `true` if allowed (`num + amount <= max` or `max < 0`). Resets window if expired. Lazy-inits from defaults. Row locked with `FOR UPDATE`. |
| 2 | `{prefix}_limits_inc` | `(limitname citext, actor_id uuid DEFAULT current_user_id(), amount bigint DEFAULT 1)` | `boolean` | Atomically `num += amount`. Returns `false` if would exceed `max`. Lazy-inits, resets window. |
| 3 | `{prefix}_limits_dec` | `(limitname citext, actor_id uuid DEFAULT current_user_id(), amount bigint DEFAULT 1)` | `boolean` | Atomically `num -= amount`. Floors at 0. |
| 4 | `{prefix}_limits_inc` (entity variant) | `(limitname citext, delta bigint, entity_id uuid, actor_id uuid)` | `boolean` | Same as #2 but keyed on `(name, actor_id, entity_id)` for per-entity tracking. |
| 5 | `{prefix}_limits_dec` (entity variant) | `(limitname citext, delta bigint, entity_id uuid, actor_id uuid)` | `boolean` | Same as #3 for per-entity. |
| 6 | `{prefix}_limits_check_soft` | `(limitname citext, actor_id uuid)` | `boolean` | Returns `true` if `num >= soft_max`. Non-blocking warning check. |

---

## Core Enforcement (Aggregate / Entity-Level)

These functions have **no actor_id** — they operate on the entity as a whole.

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 7 | `{prefix}_limit_aggregates_check` | `(limitname citext, entity_id uuid, amount bigint DEFAULT 1)` | `boolean` | Returns `true` if allowed. Lazy-inits from defaults. Row locked. |
| 8 | `{prefix}_limit_aggregates_inc` | `(limitname citext, entity_id uuid, amount bigint DEFAULT 1)` | `boolean` | Atomically `num += amount`. Returns `false` if would exceed `max`. |
| 9 | `{prefix}_limit_aggregates_dec` | `(limitname citext, entity_id uuid, amount bigint DEFAULT 1)` | `boolean` | Atomically `num -= amount`. Floors at 0. |
| 10 | `{prefix}_limit_aggregates_check_soft` | `(limitname citext, entity_id uuid)` | `boolean` | Returns `true` if `num >= soft_max`. |

---

## Credits

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 11 | `add_credits` | `(limitname citext, amount bigint, actor_id uuid, reason text)` | `void` | Bumps `max += amount` on per-user limits. Lazy-inits. |
| 12 | `add_credits_entity` | `(limitname citext, amount bigint, entity_id uuid, actor_id uuid, reason text)` | `void` | Same keyed on `(name, actor_id, entity_id)`. |
| 13 | `add_credits_aggregate` | `(limitname citext, amount bigint, entity_id uuid, reason text)` | `void` | Bumps `max += amount` on aggregate limits. |

---

## Cross-Module Hooks

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 14 | `{prefix}_limits_modify` | `(limitname citext, delta bigint, reason text, actor_id uuid)` | `void` | Universal entry point — any module can adjust `max`. Lazy-inits. |
| 15 | `{prefix}_limit_aggregates_modify` | `(limitname citext, delta bigint, reason text, entity_id uuid)` | `void` | Same for aggregate limits. |

---

## Plans & Hierarchy

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 16 | `apply_plan` | `(plan_name citext, entity_id uuid)` | `void` | Reads plan's `quotas` JSONB, sets `max` and `plan_max` for each limit. |
| 17 | `{prefix}_limit_aggregates_cascade_check` | `(limitname citext, entity_id uuid, amount bigint)` | `boolean` | Walks up `owner_id` hierarchy, checking aggregate limits at each level. |
| 18 | `{prefix}_limit_aggregates_transfer_quota` | `(limitname citext, from_entity uuid, to_entity uuid, amount bigint, actor_id uuid)` | `void` | Moves `amount` of `max` between entities. Pooled-mode guard. |

---

## Cap Tables (Feature Flags)

| # | Function | Signature | Returns | Description |
|---|----------|-----------|---------|-------------|
| 19 | `{prefix}_limits_resolve_cap` (org) | `(p_cap_name citext, p_entity_id uuid)` | `bigint` | COALESCE: per-entity override -> scope default -> 0 |
| 20 | `{prefix}_limits_resolve_cap` (app) | `(p_cap_name citext)` | `bigint` | COALESCE: scope default -> 0 |
| 21 | Cap check trigger (org) | Trigger function: `TG_ARGV[0] = cap_name, TG_ARGV[1] = entity_field` | `trigger` | Raises `FEATURE_DISABLED` if cap <= 0. |
| 22 | Cap check trigger (app) | Trigger function: `TG_ARGV[0] = cap_name` | `trigger` | Raises `FEATURE_DISABLED` if cap <= 0. |

---

## Triggers

| # | Function | Type | Description |
|---|----------|------|-------------|
| 23 | `tg_increment_limit` | AFTER INSERT | Calls increment using trigger args `(limit_name, actor_field)`. |
| 24 | `tg_decrement_limit` | AFTER DELETE | Calls decrement using trigger args. |
| 25 | `tg_update_limit` | AFTER UPDATE | Decrements old actor, increments new (ownership changes). |
| 26 | `limits_audit_tg_fn` | AFTER INSERT/UPDATE | Writes to `limit_events`: event_type, delta, num_before, num_after. |
| 27 | `aggregate_limits_audit_tg_fn` | AFTER INSERT/UPDATE | Same for aggregate_limits, includes entity_id. |
| 28 | `limit_credits_apply_tg_fn` | AFTER INSERT | On credit insert, updates limits table automatically. |

---

## Key Behaviors

### Lazy Initialization
All check/increment functions auto-create a limit row from `limit_defaults` if one doesn't exist yet. This means you don't need to pre-seed limits for every user/entity — just configure defaults.

### Window Reset
On check/increment, if `window_duration IS NOT NULL AND window_start + window_duration <= now()`:
- `num` resets to 0
- `period_credits` resets to 0
- `max` recalculates as `plan_max + purchased_credits`
- `window_start` updates to `now()`

### Concurrency
All enforcement functions use `FOR UPDATE` row locks to prevent race conditions. The pattern is:
1. INSERT ON CONFLICT DO NOTHING (atomic lazy-init)
2. UPDATE expired windows (if applicable)
3. SELECT ... FOR UPDATE (lock the row)
4. Check `num + amount <= max`
5. Return result

### Negative max = Unlimited
`max < 0` means "no limit" — the check always returns `true`. This is the convention for unlimited plans.
