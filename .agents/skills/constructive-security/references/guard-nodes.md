# Guard Nodes — Session-Level Enforcement

Guards are a distinct category from Authz* policies:

| Concept | Authz* | Guard* |
|---------|--------|--------|
| Mechanism | RLS policies (row filtering) | BEFORE triggers (raising exceptions) |
| Question | "Can this **user** access this **row**?" | "Does this **session** meet the **requirements**?" |
| Failure mode | Silent filtering (no rows returned) | Explicit error (`STEP_UP_REQUIRED`) |
| Composition | Multiple policies are OR'd (permissive) | Guards run sequentially, any can block |

Execution order: **RLS (Authz) → Guard* → DML → LimitTrack → EventTracker → JobTrigger**

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
    "watch_fields": ["bitlen", "permissions"],
    "step_up_type": "password"
}}
```

Generates `WHEN (NEW.bitlen IS DISTINCT FROM OLD.bitlen OR NEW.permissions IS DISTINCT FROM OLD.permissions)`.

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
- The `AUTH_EMAIL` blueprint preset includes all of these automatically
