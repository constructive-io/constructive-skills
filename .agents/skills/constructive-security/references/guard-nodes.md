# Guard Nodes — Session-Level Enforcement

Guards are a distinct category from Authz* policies:

| Concept | Authz* | Guard* |
|---------|--------|--------|
| Mechanism | RLS policies (row filtering) | BEFORE triggers (raising exceptions) |
| Question | "Can this **user** access this **row**?" | "Does this **session** meet the **requirements**?" |
| Failure mode | Silent filtering (no rows returned) | Explicit error (`STEP_UP_REQUIRED`) |
| Composition | Multiple policies are OR'd (permissive) | Guards run sequentially, any can block |

Execution order: **RLS (Authz) → Guard* → DML → LimitTrackUsage → EventTracker → JobTrigger**

## GuardStepUp

### How It Works

1. A BEFORE trigger is attached to the table for each specified event
2. On trigger fire, it reads `app_settings_auth.step_up_window` (default 30 minutes)
3. Looks up the current session via `jwt.claims.session_id`
4. Checks `sessions.last_password_verified` and/or `sessions.last_mfa_verified`
5. If neither timestamp is within the window → raises `STEP_UP_REQUIRED_PASSWORD_OR_MFA`
6. API keys with `mfa_level = 'verified'` bypass the check entirely

### Blueprint Examples

#### Basic — guard all mutations

```jsonc
{
  "tables": [{
    "table_name": "contracts",
    "fields": [
      { "name": "title", "type": { "name": "text" } },
      { "name": "status", "type": { "name": "text" } }
    ],
    "nodes": [
      "DataId", "DataTimestamps",
      { "$type": "GuardStepUp" }
    ],
    "policies": [{ "$type": "AuthzDirectOwner", "data": { "owner_field": "owner_id" } }]
  }]
}
```

Default behavior: requires `password_or_mfa` for UPDATE and DELETE.

#### Watch fields — only guard specific column changes

```jsonc
{ "$type": "GuardStepUp", "data": {
    "watch_fields": ["bitlen", "capabilities"],
    "step_up_type": "password"
}}
```

Generates `WHEN (NEW.bitlen IS DISTINCT FROM OLD.bitlen OR NEW.capabilities IS DISTINCT FROM OLD.capabilities)`.

#### Simple condition — single field match

```jsonc
{ "$type": "GuardStepUp", "data": {
    "events": ["UPDATE"],
    "condition_field": "role",
    "condition_value": "admin"
}}
```

Fires only when `NEW.role = 'admin'`.

#### Compound AND — multiple conditions must all match

```jsonc
{ "$type": "GuardStepUp", "data": {
    "events": ["UPDATE"],
    "conditions": { "AND": [
      { "field": "role", "op": "=", "value": "admin", "row": "NEW" },
      { "field": "status", "op": "=", "value": "active", "row": "NEW" }
    ]}
}}
```

Fires only when BOTH `NEW.role = 'admin'` AND `NEW.status = 'active'`.

#### NOT condition — fire when condition does NOT match

```jsonc
{ "$type": "GuardStepUp", "data": {
    "events": ["UPDATE"],
    "conditions": { "NOT": { "field": "role", "op": "=", "value": "viewer", "row": "NEW" } }
}}
```

Fires when `NEW.role` is anything OTHER than `'viewer'`.

#### min_age — only guard rows older than an interval

```jsonc
{ "$type": "GuardStepUp", "data": {
    "events": ["DELETE"],
    "step_up_type": "mfa",
    "min_age": "24 hours"
}}
```

Generates `WHEN (OLD.created_at < now() - interval '24 hours')` — freshly created rows can be mutated without step-up; anything older requires it. Rules:

- `UPDATE`/`DELETE` events only (new rows have no age)
- Requires a `created_at` column on the table (e.g. via `DataTimestamps`)
- Cannot be combined with `watch_fields`

### Declarative `step_up` field

For guards without conditions/watch_fields, prefer the `stepUp` field on the table row (see the `Declarative step_up field` section in SKILL.md). It accepts a verb → spec map where each spec is `true`, a type string, or `{ type?, min_age? }`, and the platform reconciles it into guard triggers automatically — including removing them when the field is cleared:

```typescript
await db.table.update({
  where: { id: tableId },
  data: { stepUp: { DELETE: { min_age: '6 hours' } } },
}).execute();
```

### Condition System

The conditions use the same compound condition system as `JobTrigger` and `EventTracker`:

```typescript
type Condition =
  | { field: string; op: '=' | '!=' | '>' | '<' | '>=' | '<='; value: string; row?: 'NEW' | 'OLD' }
  | { AND: Condition[] }
  | { OR: Condition[] }
  | { NOT: Condition };
```

**Operators:** `=`, `!=`, `>`, `<`, `>=`, `<=`
**Row reference:** `NEW` (default) or `OLD` — which trigger variable to read
**Validation:** The generator validates field names against the table's actual columns at provisioning time (raises exception for non-existent fields or SQL injection attempts)

### Error Codes

| Error | Meaning |
|-------|---------|
| `STEP_UP_REQUIRED_PASSWORD_OR_MFA` | Need recent password OR MFA verification |
| `STEP_UP_REQUIRED_PASSWORD` | Need recent password verification specifically |
| `STEP_UP_REQUIRED_MFA` | Need recent MFA verification specifically |

### Prerequisites

- `sessions_module` must be provisioned (provides session lookup)
- `user_auth_module` must be provisioned (provides `require_step_up()` in auth_public schema)
- `app_settings_auth` singleton must exist (provides `step_up_window` config)
- Resolve required auth modules from the current backend preset registry; do not depend on the removed `AUTH_EMAIL` preset alias

## DataLock

`GuardStepUp` guards a table — *every* row on it. `DataLock` guards a **row**: it adds a boolean lock column and only guards rows where that column is `true`. Use it for infrastructure rows other things depend on (the bucket a cloud function needs, a production route, a billing plan) so they cannot be deleted or edited by accident, while the rest of the table stays freely mutable.

Registry category is `data` (not `guard`), because it owns a column; behaviorally it belongs to this family.

### Two enforcement modes

| `enforcement` | Guarded verb on a locked row | Needs auth module |
|---|---|---|
| `step_up` (default) | allowed after recent verification — raises `STEP_UP_REQUIRED_*` otherwise | yes |
| `block` | always refused with `ROW_LOCKED`; you must unlock first | no |

So `block` is a true two-step: unlock, then delete. `step_up` is one step for someone who can re-authenticate.

### Options

| Option | Default | Meaning |
|---|---|---|
| `lock_field` | `"locked"` | Boolean column holding the lock state (created if absent) |
| `events` | `["DELETE"]` | Which verbs to guard — `UPDATE`, `DELETE`, or both. `INSERT` is rejected |
| `enforcement` | `"step_up"` | `step_up` or `block` |
| `step_up_type` | `"fresh_auth"` | `fresh_auth`, `mfa`, or `password` |
| `guard_unlock` | `true` | Require step-up to change the lock column itself |
| `protect_fields` | `[]` | Narrow a guarded UPDATE to changes touching these columns |
| `default_locked` | `false` | Initial value of the lock column |
| `min_age` | *(none)* | Only guard rows older than this interval |

### Blueprint examples

```jsonc
// A bucket a cloud function depends on: locked buckets cannot be deleted at all
{ "$type": "DataLock", "data": { "enforcement": "block" } }
```

```jsonc
// Locked production routes are read-only AND undeletable, MFA to override
{ "$type": "DataLock", "data": {
    "events": ["UPDATE", "DELETE"],
    "step_up_type": "mfa"
}}
```

```jsonc
// Locked rows stay editable except for the fields that actually matter
{ "$type": "DataLock", "data": {
    "events": ["UPDATE"],
    "enforcement": "block",
    "protect_fields": ["region", "endpoint"]
}}
```

`events` is a list, so DELETE and UPDATE protection are independent: `["DELETE"]` leaves locked rows editable, `["UPDATE"]` leaves them deletable. `enforcement` currently applies to the whole node — you cannot yet block DELETE while only stepping up UPDATE.

### Locking and unlocking through the SDK

The lock is an ordinary boolean column, so it is set like any other field:

```typescript
await db.bucket.update({ where: { id: bucketId }, data: { locked: true } }).execute();
```

Unlocking is guarded, so verify first (as with any step-up mutation):

```typescript
await db.query.requireStepUp({ stepUpType: 'mfa' }).execute();
await db.bucket.update({ where: { id: bucketId }, data: { locked: false } }).execute();
await db.bucket.delete({ where: { id: bucketId } }).execute();
```

### Why the unlock cannot lock itself out

The obvious implementation guards `locked` and bricks the row: the unlock is itself an UPDATE, so it gets caught by the guard it is trying to escape. The generated conditions therefore differ per verb and mode:

- `DELETE` → guards `OLD.locked`.
- `UPDATE` + `block` → guards `OLD.locked AND NEW.locked`, which refuses edits but deliberately lets the unlock through.
- `UPDATE` + `step_up` → guards `OLD.locked OR NEW.locked`, catching the unlock as well, since re-authentication covers it.

`guard_unlock` adds a standalone `NEW.locked IS DISTINCT FROM OLD.locked` guard only when the above does not already cover the transition — under `step_up` with UPDATE guarded, it is skipped as redundant. The unlock guard is always `step_up`: blocking the lock column outright would make the lock permanent.

### Known gaps

- **Cascading deletes bypass the lock.** A locked row deleted via `ON DELETE CASCADE` from a parent is removed without the guard firing. Lock (or restrict) the parent as well if the row must survive.
- `min_age` requires a `created_at` column (e.g. via `DataTimestamps`) and applies to `UPDATE`/`DELETE` only.

### Error codes

| Error | Meaning |
|-------|---------|
| `ROW_LOCKED` | `block` enforcement refused the verb; unlock the row first. Context carries `table`, `operation`, `lock_field` |
| `STEP_UP_REQUIRED_*` | `step_up` enforcement — verify, then retry (see the table above) |

### Prerequisites

- `enforcement: "block"` needs nothing beyond the table itself.
- `enforcement: "step_up"` (and any `guard_unlock`) needs `user_auth_module`, same as `GuardStepUp`.
