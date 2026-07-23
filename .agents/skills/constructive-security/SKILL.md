---
name: constructive-security
description: "Authorization — Safegres protocol, 23 Authz* policy types, RLS, grants, permissions, permission defaults, GuardStepUp, read-only access, storage policies, and the secureTableProvision workflow. Use when asked to 'add security', 'RLS', 'grants', 'policies', 'Safegres', 'Authz*', 'AuthzEntityMembership', 'AuthzDirectOwner', 'AuthzMemberOwner', 'AuthzComposite', 'AuthzSystemOnly', 'AuthzHumanOnly', 'AuthzValueAllowed', 'AuthzValueExists', 'AuthzValueMatch', 'system-only policy', 'system-only writes', 'human-only mutation', 'block agents from writing', 'read-only mode', 'secure table provision', 'storage policies', 'bucket security', 'permission model', 'permission defaults', 'default_permissions', 'GuardStepUp', 'step-up auth', 'guard step-up', 'require step-up', 'MFA guard', 'named permissions', or when working with authorization in blueprints or the ORM."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Security

The Safegres authorization protocol and its SDK integration — expressing authorization as Authz* policy nodes and applying them via RLS, grants, and the `secureTableProvision` workflow.

## When to Apply

Use this skill when:
- Securing tables with RLS policies (Authz* types)
- Creating grants (select/insert/update/delete per role)
- Using `secureTableProvision` to provision fields + grants + policies + RLS in one call
- Understanding permissive vs restrictive policy composition
- Configuring storage bucket security policies
- Working with read-only access (`AuthzNotReadOnly`)
- Understanding permission defaults and module-level permissions
- Adding session-level guards (GuardStepUp) that require MFA/password before DML

## Core Vocabulary

### Actor, Entity, Membership

- **Actor** — the authenticated user (`current_user_id()`)
- **Entity** — the scope a membership belongs to (org, group, custom)
- **Membership types:** `1` = App, `2` = Org, `3` = Group, `3+` = custom

### Users ARE Organizations

Every user has an "org identity" — a personal org with org-level membership. This unifies "user owns it personally" and "org owns it and user is a member" under a single `AuthzEntityMembership` policy.

## The 23 Authz* Policy Types

| # | Type | Intent | Key Config |
|---|------|--------|------------|
| 1 | `AuthzDirectOwner` | Direct personal ownership | `entity_field` |
| 2 | `AuthzDirectOwnerAny` | Multi-owner OR logic | `entity_fields` (array) |
| 3 | `AuthzAppMembership` | App-level membership (hardcoded type=1) | optional `permission`/`is_admin` |
| 4 | `AuthzEntityMembership` | Bound membership-to-row | `entity_field`, `membership_type` |
| 5 | `AuthzMemberOwner` | Ownership AND entity membership | `owner_field`, `entity_field`, `membership_type` |
| 6 | `AuthzRelatedEntityMembership` | Entity membership via join | `entity_field`, `obj_schema`/`obj_table`/`obj_field` |
| 7 | `AuthzPeerOwnership` | Peer visibility (direct) | `owner_field`, `membership_type` |
| 8 | `AuthzRelatedPeerOwnership` | Peer visibility via join | `entity_field`, `obj_*` |
| 9 | `AuthzOrgHierarchy` | Hierarchy (manager/subordinate) | `direction`, `anchor_field`, `entity_field` |
| 10 | `AuthzTemporal` | Time-window constraints | `valid_from_field`, `valid_until_field` |
| 11 | `AuthzPublishable` | Draft/published gating (READ-only) | `is_published_field` |
| 12 | `AuthzMemberList` | Actor in UUID array | `array_field` |
| 13 | `AuthzRelatedMemberList` | Actor in related UUID array | `owned_schema`/`owned_table`/`owned_table_key` |
| 14 | `AuthzAllowAll` | Unconditional allow | `{}` |
| 15 | `AuthzDenyAll` | Unconditional deny | `{}` |
| 16 | `AuthzFilePath` | Path-scoped file sharing (ltree) | `shares_schema`, `shares_table`, `files_table` |
| 17 | `AuthzNotReadOnly` | Restricts mutations for read-only members | `entity_field`, optional `membership_type` |
| 18 | `AuthzComposite` | Boolean tree (AND/OR/NOT) of other policies | `AND`/`OR`/`NOT` keywords (or legacy `BoolExpr` AST) |
| 19 | `AuthzSystemOnly` | Restrict writes to system sessions (triggers/jobs) — `role_type='system'` | `{}` |
| 20 | `AuthzHumanOnly` | Block principals (agents/API keys) from a mutation — human sessions only (guard, not a registry node) | `{}` |
| 21 | `AuthzValueAllowed` | Check local column against allowed values | `column`, `allowed`, `operator` |
| 22 | `AuthzValueExists` | `EXISTS` in a related table joined to the protected row | `ref_schema`/`ref_table`, `join`, `conditions` |
| 23 | `AuthzValueMatch` | `EXISTS` in a related table with a value match on the ref row | `ref_schema`/`ref_table`, `join`, `match`, `conditions` |

See [authz-types.md](./references/authz-types.md) for full config shapes, semantics, and examples.

## `AuthzAppMembership` vs `AuthzEntityMembership`

| | `AuthzAppMembership` | `AuthzEntityMembership` |
|---|---|---|
| **Scope** | App-level only (hardcoded type=1) | Any scope (org/group/custom) |
| **Row binding** | None — checks global app membership | Bound to `entity_field` on the row |
| **Use for** | App-wide admin gates | Entity-scoped resources |

**Rule:** If the row has `entity_id`/`organization_id`/`owner_id`, use `AuthzEntityMembership`. Use `AuthzAppMembership` only for app-level gates.

## Permissive vs Restrictive Composition

- **Permissive** (default): ORed — any passing policy grants access
- **Restrictive** (`permissive: false`): ANDed with permissive — all must pass

Pattern: `(P1 OR P2 OR ... Pn) AND R1 AND R2 AND ... Rm`

Use `AuthzComposite` only when flat composition is insufficient (e.g., `(A AND B) OR (C AND D)`).

## SDK: `secureTableProvision` (Recommended)

One call to create fields, grants, policies, and enable RLS. The input is the **Blueprint shape**: four independent, optional arrays —
- `nodes[]` — Data* field modules, each `{ $type: 'Data…' }` (optional `data`)
- `fields[]` — explicit columns (`{ name, type, is_required }`, **snake_case**; `type` accepts a `FieldType` object or a legacy bare string)
- `grants[]` — per-role privilege targeting (`{ roles, privileges }`, privileges are `[privilege, columns]` tuples)
- `policies[]` — Authz* RLS policies (`{ $type, permissive, privileges, data }`)
- `useRls: true` — enable RLS

> **The flat `nodeType` / `grantRoles` / `grantPrivileges` / `policyType` / `policyData` / `policyPermissive` shape is stale** and no longer matches the live platform. The generated `CreateSecureTableProvisionInput` exposes only `nodes` / `fields` / `grants` / `policies` / `useRls`. Use the arrays below.

```typescript
await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableName: 'projects',
    useRls: true,
    // nodes[]: one entry per Data* field module (compose several in one call)
    nodes: [
      { $type: 'DataEntityMembership' },
    ] as unknown as Record<string, unknown>,
    // grants[]: each entry = roles + a privilege list of [privilege, columns] tuples.
    // '*' = all columns; an array restricts the columns that privilege applies to.
    grants: [
      { roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] },
    ] as unknown as Record<string, unknown>,
    // policies[]: one entry per Authz* policy, discriminated by $type
    policies: [
      {
        $type: 'AuthzEntityMembership',
        permissive: true,
        privileges: ['select', 'insert', 'update', 'delete'],
        data: { entity_field: 'entity_id', membership_type: 2 },
      },
    ] as unknown as Record<string, unknown>,
  },
  select: { id: true, tableId: true, outFields: true },
}).execute();
```

> **Casting note:** `fields[]` is typed `Record<string, unknown>[]` (an array), so a field literal assigns directly with no cast. `nodes` / `grants` / `policies` are typed as a single `Record<string, unknown>`, so each array literal needs `as unknown as Record<string, unknown>` (as shown).

### Paired Data Nodes

| Policy Type | Data Node | Creates |
|-------------|-----------|---------|
| `AuthzMemberOwner` | `DataMemberOwner` | `owner_id` + `entity_id` + policy |
| `AuthzDirectOwner` | `DataDirectOwner` | `owner_id` + policy |
| `AuthzEntityMembership` | `DataEntityMembership` | `entity_id` + policy |

## Permission Defaults

Modules auto-register named permissions when installed via blueprint or `entityTypeProvision`. Default access levels are applied automatically.

| Module | Granted to All Members | Admin-Only |
|--------|----------------------|------------|
| Agent | `invoke_agents` | `manage_agents` |
| Function | `invoke_functions` | `manage_functions` |
| Graph | `execute_graphs` | `manage_graphs` |
| Storage | `write_files`, `delete_files` | `manage_storage` |

ORM access:
- **Permissions registry** — `db.appPermission` / `db.orgPermission` (list registered named permissions)
- **Defaults** — `db.appPermissionDefault` / `db.orgPermissionDefault` (current default permissions for new members)
- **Grants** — `db.appGrant` / `db.orgGrant` (append-only grant/revoke log per member)
- **Helpers** — `appPermissionsGetMaskByNames` (names → permission value) / `appPermissionsGetByMask` (permission value → names)

See [permission-defaults.md](./references/permission-defaults.md) for the full ORM reference with code examples.

## Profiles

Role-based access control via named permission bundles. Enable via `hasProfiles: true` on `entityTypeProvision`.

- **Effective permissions** = `granted` (direct) + `profile.permissions` (from assigned profile)
- **Default profile** — set `isDefault: true` on a profile; new memberships are automatically assigned it
- **ORM tables** (created per scope): `profiles`, `profilePermissions`, `profileGrants`, `profileDefinitionGrants`
- **Membership** — each membership carries a `profileId` (nullable); read via `db.appMembership` / `db.orgMembership`
- **Membership defaults** — `db.appMembershipDefault` / `db.orgMembershipDefault` control initial approval/verification state

See [profiles.md](./references/profiles.md) for the full reference with code examples.

## GuardStepUp

Blueprint node (guard category) that enforces step-up authentication. Attaches a BEFORE trigger that calls `requireStepUp()` to verify recent password or MFA verification before allowing mutations.

**Blueprint usage:**

```json
{ "$type": "GuardStepUp", "data": { "step_up_type": "password_or_mfa", "events": ["UPDATE", "DELETE"] } }
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `step_up_type` | `"password"` \| `"mfa"` \| `"password_or_mfa"` | `"password_or_mfa"` | Which verification method satisfies the requirement |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["UPDATE", "DELETE"]` | Which DML events require step-up |

**SDK query** — check whether the current session needs step-up before attempting a protected mutation:

```typescript
const result = await db.query.requireStepUp({ stepUpType: 'password' }).execute();
```

The `step_up_window` is configured in `appSettingsAuth` (default 30 minutes). After a successful `verifyPassword()` or `verifyTotp()`, mutations on guarded tables are allowed for the duration of the window.

### Declarative `step_up` field (simple front door)

For simple cases, skip the blueprint node and set the `stepUp` field on the table row itself — a map of DML verb → step-up spec. The platform reconciles the field into guard triggers automatically (create, change, and remove are all declarative):

```typescript
// Require the default (password_or_mfa) step-up on DELETE
await db.table.update({
  where: { id: tableId },
  data: { stepUp: { DELETE: true } },
}).execute();

// Per-verb types
await db.table.update({
  where: { id: tableId },
  data: { stepUp: { DELETE: 'mfa', UPDATE: 'password_or_mfa' } },
}).execute();

// min_age: guard only fires for rows older than the interval —
// freshly created rows can be deleted/updated without step-up
await db.table.update({
  where: { id: tableId },
  data: { stepUp: { DELETE: { type: 'mfa', min_age: '24 hours' } } },
}).execute();

// Remove all guards
await db.table.update({
  where: { id: tableId },
  data: { stepUp: null },
}).execute();
```

**Value shapes** (validated at write time — invalid shapes are rejected):

| Value | Meaning |
|-------|---------|
| `true` | Default `password_or_mfa` step-up |
| `'password'` \| `'mfa'` \| `'password_or_mfa'` | Specific verification type |
| `{ type?, min_age? }` | Object form — `type` defaults to `password_or_mfa`; `min_age` is an interval string (e.g. `'6 hours'`) gating the guard to rows older than that age |

**`min_age` rules:** `UPDATE`/`DELETE` only (new rows have no age); requires the table to have a `created_at` column (e.g. via `DataTimestamps`); cannot be combined with `watch_fields`. Use it to keep fresh scratch rows friction-free while protecting anything long-lived (the platform itself uses 6 hours for namespaces and 24 hours for database/table deletion).

**Ordering-safe:** if the auth module isn't provisioned yet, the intent stays pending in the field and is applied automatically when auth installs — modules provisioned before auth can still declare guards.

**Policy:** the field is sugar over the same GuardStepUp engine (one-way, no sync). Use the field unless you need `conditions`/`watch_fields` — then use the `GuardStepUp` blueprint node.

## Storage Policies

Configurable per-bucket RLS via `storage_config.policies[]` on entity_type_provision:
- `tables` key scopes to `"buckets"` or `"files"` (logical names)
- `is_public` controls S3 bucket ACL; `policies` controls RLS
- Default (no explicit policies): membership + AuthzPublishable + AuthzDirectOwner

See [storage-policies.md](./references/storage-policies.md) for typical combinations.

## Read-Only Access

Two complementary mechanisms for restricting writes:

| Mechanism | Scope | Enforced By | Use Case |
|-----------|-------|-------------|----------|
| `isReadOnly` membership field | Per-entity (org, group, etc.) | `AuthzNotReadOnly` restrictive RLS policy | Viewers, read-only contractors |
| `accessLevel: 'read_only'` API key | Entire transaction | PostgreSQL read-only transaction | Safe integration keys, dashboards |

- **Membership read-only:** update via `db.orgMembership.update({ where: { id: ... }, data: { isReadOnly: true } })`. Owners/admins cannot be set read-only (trigger guard).
- **API key read-only:** create via `db.query.createApiKey({ input: { keyName: '...', accessLevel: 'read_only' } })`. PostgreSQL rejects all writes at the engine level.
- Both layers enforce independently and can be stacked for defense in depth.

See [read-only-access.md](./references/read-only-access.md) for full ORM/CLI usage, behavior tables, and composition patterns.

## Guard Nodes (Session-Level Enforcement)

Guards are BEFORE triggers that check **session state** before allowing DML — distinct from Authz* (which checks row-level access via RLS). Guards compose with Authz policies: RLS → Guard → DML.

### `GuardStepUp`

Requires recent password/MFA verification before allowing mutations. Blueprint usage:

```jsonc
// Require step-up for all UPDATE/DELETE (default events)
{ "$type": "GuardStepUp" }

// Only for INSERT + DELETE with password-only verification
{ "$type": "GuardStepUp", "data": { "events": ["INSERT", "DELETE"], "step_up_type": "password" } }

// With watch_fields — only fires when specific columns change
{ "$type": "GuardStepUp", "data": { "watch_fields": ["bitlen", "permissions"] } }

// Compound conditions — require step-up only when role escalates to admin
{ "$type": "GuardStepUp", "data": {
    "events": ["UPDATE"],
    "conditions": { "AND": [
      { "field": "role", "op": "=", "value": "admin", "row": "NEW" },
      { "field": "role", "op": "!=", "value": "admin", "row": "OLD" }
    ]}
}}
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `step_up_type` | `'password' \| 'mfa' \| 'password_or_mfa'` | `'password_or_mfa'` | Which verification satisfies the requirement |
| `events` | `('INSERT' \| 'UPDATE' \| 'DELETE')[]` | `['UPDATE', 'DELETE']` | DML events that require step-up |
| `watch_fields` | `string[]` | — | Only fire when these fields change (DISTINCT FROM) |
| `conditions` | `Condition` | — | Compound AND/OR/NOT conditions for WHEN clause |
| `condition_field` | `string` | — | Simple leaf: fire only when field equals value |
| `condition_value` | `string` | — | Value for `condition_field` comparison |

**Requirements:** The target database must have `sessions_module` + `user_auth_module` provisioned (provides `require_step_up()` function). The `step_up_window` is read from `app_settings_auth` at runtime (default 30 minutes).

See [guard-nodes.md](./references/guard-nodes.md) for detailed examples and the condition system.

## References

| File | Content |
|------|---------|
| [authz-types.md](./references/authz-types.md) | All 20 Authz* types with config shapes and examples |
| [permission-defaults.md](./references/permission-defaults.md) | Module permission defaults — ORM tables, helper queries, grant/revoke examples |
| [profiles.md](./references/profiles.md) | Profiles (RBAC) — permission bundles, profile tables, membership integration |
| [storage-policies.md](./references/storage-policies.md) | Per-bucket RLS policy combinations |
| [guard-nodes.md](./references/guard-nodes.md) | Guard* node family — session-level enforcement triggers |
|| [read-only-access.md](./references/read-only-access.md) | Read-only memberships (`isReadOnly`) and read-only API keys (`accessLevel`) |

## Cross-References

- **Blueprint definition format:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Auth settings and sessions:** [`constructive-auth`](../constructive-auth/SKILL.md)
- **Entity types and memberships:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Data modeling (tables, fields):** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
