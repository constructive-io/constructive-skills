# Limits Module — Tables & Fields Reference

All tables are created in the **public schema** with RLS enabled. The `{prefix}` is derived from the entity type name (e.g., `org` for org-level, `app` for app-level).

---

## Per-User Limits Table: `{prefix}_limits`

Tracks per-actor usage counts against configurable maximum limits.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `name` | `citext` | yes | Name identifier of the limit |
| `actor_id` | `uuid` | yes | User whose usage is being tracked (FK to users) |
| `entity_id` | `uuid` | yes* | Entity scope (FK to entity table). *Only present when entity_table_id is set. |
| `num` | `bigint` | no | Current usage count (default 0) |
| `max` | `bigint` | no | Maximum allowed usage; negative = unlimited |
| `soft_max` | `bigint` | no | Warning threshold; NULL = no soft limit |
| `window_start` | `timestamptz` | no | Start of current metering window; NULL = no window |
| `window_duration` | `interval` | no | Window length (e.g., '1 day', '1 month'); NULL = no window |
| `plan_max` | `bigint` | no | Ceiling set by `apply_plan()`. Survives window reset. (default 0) |
| `purchased_credits` | `bigint` | no | Permanent credits. Survives window reset. (default 0) |
| `period_credits` | `bigint` | no | Temporary credits for current window. Resets to 0 on expiry. (default 0) |

**Unique constraint:** `(name, actor_id)` or `(name, actor_id, entity_id)` if entity exists.

---

## Limit Defaults Table: `{prefix}_limit_defaults`

Default maximum values for each named limit, applied when no per-actor row exists (lazy initialization).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `name` | `citext` | yes | Name identifier (unique) |
| `max` | `bigint` | no | Default maximum usage |
| `soft_max` | `bigint` | no | Default soft limit threshold |

**Unique constraint:** `(name)`

---

## Aggregate Limits Table: `{prefix}_limit_aggregates`

Entity-level aggregate counters (org-wide caps). Only created when `entity_table_id IS NOT NULL` (membership_type > 1).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `name` | `citext` | yes | Name identifier |
| `entity_id` | `uuid` | yes | Entity whose aggregate usage is tracked (FK) |
| `num` | `bigint` | no | Current aggregate usage count |
| `max` | `bigint` | no | Maximum allowed; negative = unlimited |
| `soft_max` | `bigint` | no | Warning threshold |
| `window_start` | `timestamptz` | no | Metering window start |
| `window_duration` | `interval` | no | Window length |
| `plan_max` | `bigint` | no | Plan ceiling (default 0) |
| `purchased_credits` | `bigint` | no | Permanent credits (default 0) |
| `period_credits` | `bigint` | no | Temporary credits (default 0) |
| `reserved` | `bigint` | no | Capacity reserved by children in budgeted mode (default 0) |

**Unique constraint:** `(name, entity_id)`

---

## Limit Credits Table: `{prefix}_limit_credits`

Append-only ledger of credit grants. AFTER INSERT trigger automatically updates the limits table.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `default_limit_id` | `uuid` | yes | FK to limit_defaults — which limit this credit applies to |
| `actor_id` | `uuid` | no | User this credit is for; NULL for aggregate credits |
| `entity_id` | `uuid` | no | Entity scope; NULL for actor-only credits |
| `amount` | `bigint` | yes | Credits to grant (positive to add, negative to revoke) |
| `credit_type` | `text` | yes | `'permanent'` or `'period'` (default: 'permanent') |
| `reason` | `text` | no | Audit reason (promo code, admin grant, etc.) |

**RLS:** SELECT on own rows (actor_id match). INSERT requires `add_credits` permission.

---

## Limit Events Table: `{prefix}_limit_events`

Append-only audit log of all limit changes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `citext` | no | Limit name |
| `actor_id` | `uuid` | no | User who triggered; NULL for system/aggregate events |
| `entity_id` | `uuid` | no | Entity; NULL for app-level events |
| `event_type` | `text` | no | `inc`, `dec`, `check`, `modify`, `transfer`, `apply_plan`, `reset` |
| `delta` | `bigint` | no | Change amount (+/-) |
| `num_before` | `bigint` | no | Usage count before |
| `num_after` | `bigint` | no | Usage count after |
| `max_at_event` | `bigint` | no | Max ceiling at time of event |
| `reason` | `text` | no | Optional reason/source |

**RLS:** SELECT on own rows (actor_id match). Written by audit triggers (SECURITY DEFINER).

---

## Cap Defaults Table: `{prefix}_caps_defaults`

Scope-level default cap values for feature flags and static configuration limits.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `name` | `citext` | yes | Cap name (e.g., `enable_aggregates`, `max_file_upload_size`) |
| `max` | `bigint` | yes | Default value: 0=disabled, 1=enabled, N=numeric cap (default 0) |

**Unique constraint:** `(name)`

---

## Limit Caps Table: `{prefix}_limit_caps`

Per-entity cap overrides. Specific entities get different values than the scope default.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `name` | `citext` | yes | Cap name |
| `entity_id` | `uuid` | yes | Entity this override applies to |
| `max` | `bigint` | yes | Override value (default 0) |

**Unique constraint:** `(name, entity_id)`

---

## Credit Codes Table: `{prefix}_limit_credit_codes` (app-level only)

Admin-managed redeemable credit codes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `code` | `citext` | yes | Human-readable code (unique, case-insensitive) |
| `max_redemptions` | `int` | no | Max total redemptions; NULL = unlimited |
| `current_redemptions` | `int` | yes | Current count (incremented by trigger, default 0) |
| `expires_at` | `timestamptz` | no | Expiration; NULL = never |

---

## Credit Code Items Table: `{prefix}_limit_credit_code_items` (app-level only)

What each code grants — one-to-many relationship with credit_codes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `credit_code_id` | `uuid` | yes | FK to credit_codes |
| `default_limit_id` | `uuid` | yes | FK to limit_defaults — which limit this grants |
| `amount` | `bigint` | yes | Credits per redemption |
| `credit_type` | `text` | yes | `'permanent'` or `'period'` (default: 'permanent') |

**Unique constraint:** `(credit_code_id, default_limit_id)`

---

## Credit Redemptions Table: `{prefix}_limit_credit_redemptions` (app-level only)

User-facing redemption ledger. AFTER INSERT trigger validates and cascades.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `uuid` | yes | Primary key |
| `credit_code_id` | `uuid` | yes | FK to credit_codes |
| `entity_id` | `uuid` | yes | Entity receiving credits |

**Unique constraint:** `(credit_code_id, entity_id)` — one redemption per entity per code.

---

## Membership Settings Extension

When the entity type has a memberships module, the limits module adds:

| Field | Table | Type | Default | Description |
|-------|-------|------|---------|-------------|
| `limit_allocation_mode` | `{prefix}_membership_settings` | `text` | `'pooled'` | `pooled` = shared parent cap, `budgeted` = explicit per-entity allocations |
