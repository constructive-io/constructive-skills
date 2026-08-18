---
name: constructive-security
description: "Authorization with Constructive Authz, 25 registry Authz nodes plus platform-applied AuthzHumanOnly, RLS, grants, capabilities, GuardStepUp, read-only access, storage policies, secureTableProvision, and owning the security of a module-generated table. Use for RLS, grants, policies, AuthzAppMemberOwner, AuthzRelatedMemberOwner, AuthzColumnSecurity, AuthzComposite, system-only or human-only operations, column write guards, storage security, capability defaults, step-up auth, replacing a module's default grants or policies (registries, images, repositories, machines), blueprint provisions overrides, or authorization in blueprints and the ORM."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Security

The Constructive Authz authorization protocol and its SDK integration — expressing authorization as Authz* policy nodes and applying them via RLS, grants, and the `secureTableProvision` workflow.

## When to Apply

Use this skill when:
- Securing tables with RLS policies (Authz* types)
- Creating grants (select/insert/update/delete per role)
- Using `secureTableProvision` to provision fields + grants + policies + RLS in one call
- Understanding permissive vs restrictive policy composition
- Configuring storage bucket security policies
- Working with read-only access (`AuthzNotReadOnly`)
- Understanding capability defaults, capability kinds, and module-level capabilities
- Deciding where to gate access that an owner or admin must not bypass
- Adding session-level guards (GuardStepUp) that require MFA/password before DML
- Protecting individual infrastructure rows from accidental deletion or edits (DataLock)
- Replacing the grants or policies a module installed on a table it generated (registries, images, repositories, machines, functions)

## Core Vocabulary

### Actor, Entity, Membership

- **Actor** — the authenticated user (`current_user_id()`)
- **Entity** — the scope a membership belongs to (org, group, custom)
- **Membership types:** `1` = App, `2` = Org, `3` = Group, `3+` = custom

### Users ARE Organizations

Every user has an "org identity" — a personal org with org-level membership. This unifies "user owns it personally" and "org owns it and user is a member" under a single `AuthzEntityMembership` policy.

## Authz mechanisms

The canonical Constructive DB registry exports 25 Authz nodes. `AuthzComposite` composes other nodes, while `AuthzColumnSecurity` generates a column-level write guard instead of a stored RLS policy. The platform also applies `AuthzHumanOnly` outside the registry, so this skill documents 26 distinct authorization mechanisms without pretending they share one execution model.

| # | Type | Intent | Key Config |
|---|------|--------|------------|
| 1 | `AuthzDirectOwner` | Direct personal ownership | `entity_field` |
| 2 | `AuthzDirectOwnerAny` | Multi-owner OR logic | `entity_fields` (array) |
| 3 | `AuthzAppMembership` | App-level membership (hardcoded type=1) | optional `capabilities`/`levels`/`is_admin` |
| 4 | `AuthzAppMemberOwner` | Ownership AND current app membership | `owner_field`, optional capabilities/levels/admin/owner checks |
| 5 | `AuthzEntityMembership` | Bound membership-to-row | `entity_field`, `membership_type` |
| 6 | `AuthzMemberOwner` | Ownership AND entity membership | `owner_field`, `entity_field`, `membership_type` |
| 7 | `AuthzRelatedEntityMembership` | Entity membership via join | `entity_field`, `obj_schema`/`obj_table`/`obj_field` |
| 8 | `AuthzRelatedMemberOwner` | Ownership AND related-entity membership | `owner_field`, `entity_field`, `obj_*` |
| 9 | `AuthzPeerOwnership` | Peer visibility (direct) | `owner_field`, `membership_type` |
| 10 | `AuthzRelatedPeerOwnership` | Peer visibility via join | `entity_field`, `obj_*` |
| 11 | `AuthzOrgHierarchy` | Hierarchy (manager/subordinate) | `direction`, `anchor_field`; optional `entity_field`, `max_depth` |
| 12 | `AuthzTemporal` | Time-window constraints | `valid_from_field`, `valid_until_field` |
| 13 | `AuthzPublishable` | Draft/published gating (READ-only) | `is_published_field` |
| 14 | `AuthzMemberList` | Actor in UUID array | `array_field` |
| 15 | `AuthzRelatedMemberList` | Actor in related UUID array | related table ref, `owned_table_key`, `owned_table_ref_key`, `this_object_key` |
| 16 | `AuthzAllowAll` | Unconditional allow | `{}` |
| 17 | `AuthzDenyAll` | Generates `FALSE`; use a restrictive policy for a hard deny alongside other policies | `{}` |
| 18 | `AuthzFilePath` | Path-scoped file sharing (ltree) | path-shares table ref, `capability_field`; optional files table ref |
| 19 | `AuthzNotReadOnly` | Restricts mutations for read-only members | `entity_field`, optional `membership_type` |
| 20 | `AuthzComposite` | Boolean tree (AND/OR/NOT) of other policies | `AND`/`OR`/`NOT` keywords (or a raw `BoolExpr` AST) |
| 21 | `AuthzSystemOnly` | Restrict writes to system sessions (triggers/jobs) — `role_type='system'` | `{}` |
| 22 | `AuthzValueAllowed` | Check local column against allowed values | `column`, `allowed`, `operator` |
| 23 | `AuthzValueExists` | `EXISTS` in a related table joined to the protected row | referenced table ref, `join`; optional `conditions` |
| 24 | `AuthzValueMatch` | `EXISTS` in a related table with a value match on the ref row | referenced table ref, `join`, `match`; optional `conditions` |
| 25 | `AuthzColumnSecurity` | Guard selected INSERT/UPDATE column writes with a nested Authz node or immutability rule | `columns`, `rule`, `authz`/`values`/`allowed` |
| — | `AuthzHumanOnly` | Platform-applied guard that blocks principals from sensitive mutations | Not registry-selectable |

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

One call to create fields, grants, policies, and enable RLS:

```typescript
const grant_privileges = [
  ['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*'],
] as unknown as Record<string, unknown>;

const policy_data: Record<string, unknown> = {
  entity_field: 'entity_id',
  membership_type: 2,
};

await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableName: 'projects',
    nodeType: 'DataEntityMembership',
    useRls: true,
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzEntityMembership',
    policyPermissive: true,
    policyData: policy_data,
  },
  select: { id: true, tableId: true, outFields: true },
}).execute();
```

### Paired Data Nodes

| Policy Type | Data Node | Creates |
|-------------|-----------|---------|
| `AuthzMemberOwner` | `DataMemberOwner` | `owner_id` + `entity_id` + policy |
| `AuthzDirectOwner` | `DataDirectOwner` | `owner_id` + policy |
| `AuthzEntityMembership` | `DataEntityMembership` | `entity_id` + policy |

## Owning a Module-Generated Table's Security

A module install ships its tables *and* their default grants and policies. A blueprint can either **layer** onto that or **own** it:

| Blueprint shape | Meaning |
|---|---|
| Table entry with `module` + its own `policies[]`/`grants[]` | Additive — declared security is added to the module's defaults |
| Table entry with `module` + `provisions` (keyed by the module's table keys) | Authoritative — for each concern declared under a key, the declared list becomes that table's whole set |

```json
{
  "module": { "type": "image", "scope": "org" },
  "provisions": {
    "registries": { "policies": [ "…" ], "grants": [ "…" ] },
    "images": { "policies": [ "…" ] }
  }
}
```

There is no flag: a non-empty `policies` array under a table key owns that table's policies, a non-empty `grants` array owns its grants, and a concern left out keeps the module's default. The `module` reference names the *install* and omits `table`, because the `provisions` keys are the table keys.

The same thing after provisioning goes through `secureTableProvision`, which accepts the module reference directly (`module` + `owns: ['policies', 'grants']`) instead of a `tableId`/`tableName`.

See [module-table-security.md](./references/module-table-security.md) for the full shape, validation rules, what replacement removes, and the ORM form.

## Capability Defaults

Modules auto-register named capabilities when installed via blueprint or `entityTypeProvision`. Default access levels are applied automatically.

| Module | Granted to All Members | Admin-Only |
|--------|----------------------|------------|
| Agent | `invoke_agents` | `manage_agents` |
| Function | `invoke_functions` | `manage_functions` |
| Graph | `execute_graphs` | `manage_graphs` |
| Storage | `write_files`, `delete_files` | `manage_storage` |

ORM access:
- **Capabilities registry** — `db.appCapability` / `db.orgCapability` (list registered named capabilities)
- **Defaults** — `db.appCapabilityDefault` / `db.orgCapabilityDefault` (current default capabilities for new members)
- **Grants** — `db.appGrant` / `db.orgGrant` (append-only grant/revoke log per member)
- **Helpers** — `appCapabilitiesGetMaskByNames` (names → capability value) / `appCapabilitiesGetByMask` (capability value → names)

See [capability-defaults.md](./references/capability-defaults.md) for the full ORM reference with code examples.

### Capability kinds

A capability row carries a `kind`: `permission` (a granted access right, the default) or `level` (a trust-ladder rung earned through recorded events — see [`constructive-events`](../constructive-events/SKILL.md)). Both compile into the same mask, so `capabilities` and `levels` on a policy are two spellings of one requirement and may be combined freely. Filter by `kind` in any UI that grants access — a `level` must never be offered as something an operator can hand out.

### Owners and admins satisfy every capability check

A membership created or updated with `isAdmin: true` or `isOwner: true` receives **every** capability in its scope — trust levels included — regardless of defaults, profile, or grants. Consequences for policy design:

- Adding a capability or level requirement to a membership-based policy **never** restricts an owner or admin of that entity.
- Being intra-realm, this cannot cross an entity boundary: the capability set lives on one membership row naming one actor and one entity.
- To bind an owner, gate at the enclosing scope (an app-level policy over an org owner), or use a non-membership policy such as `AuthzDirectOwner`, which does not consult the membership capability set at all.

Full semantics: [`constructive-access-control` → admin-owner-member.md](../constructive-access-control/references/admin-owner-member.md#owner-and-admin-hold-every-capability).

## Profiles

Role-based access control via named capability bundles. Enable via `hasProfiles: true` on `entityTypeProvision`.

- **Effective capabilities** = `granted` (direct) + `profile.capabilities` (from assigned profile)
- **Default profile** — set `isDefault: true` on a profile; new memberships are automatically assigned it
- **ORM tables** (created per scope): `profiles`, `profileCapabilities`, `profileGrants`, `profileDefinitionGrants`
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
{ "$type": "GuardStepUp", "data": { "watch_fields": ["bitlen", "capabilities"] } }

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

### `DataLock`

Where `GuardStepUp` guards a whole table, `DataLock` guards a **single row**: it adds a boolean lock column and guards only the rows where it is `true`. Use it to protect infrastructure rows other things depend on — the bucket a cloud function needs, a production route — from accidental deletion or edits, while the rest of the table stays freely mutable.

```jsonc
// Locked buckets cannot be deleted at all — unlock first (needs no auth module)
{ "$type": "DataLock", "data": { "enforcement": "block" } }

// Locked rows are read-only and undeletable; MFA overrides either
{ "$type": "DataLock", "data": { "events": ["UPDATE", "DELETE"], "step_up_type": "mfa" } }
```

`enforcement: 'block'` refuses the verb outright with `ROW_LOCKED` (a genuine two-step: unlock, then delete); `enforcement: 'step_up'` (default) allows it after recent verification. `events` picks DELETE and UPDATE protection independently, and clearing the lock is itself step-up guarded so unlocking is deliberate rather than a silent prelude to deletion. Note that a locked row is still removed by an `ON DELETE CASCADE` from its parent.

See [guard-nodes.md](./references/guard-nodes.md) for all options, the SDK lock/unlock flow, and why the unlock cannot lock itself out.

## References

| File | Content |
|------|---------|
| [authz-types.md](./references/authz-types.md) | All 25 registry Authz nodes plus platform-applied `AuthzHumanOnly`, with config shapes and examples |
| [capability-defaults.md](./references/capability-defaults.md) | Module capability defaults — ORM tables, helper queries, grant/revoke examples |
| [profiles.md](./references/profiles.md) | Profiles (RBAC) — capability bundles, profile tables, membership integration |
| [storage-policies.md](./references/storage-policies.md) | Per-bucket RLS policy combinations |
| [guard-nodes.md](./references/guard-nodes.md) | Guard* node family — session-level enforcement triggers — plus `DataLock` row-level locking |
| [read-only-access.md](./references/read-only-access.md) | Read-only memberships (`isReadOnly`) and read-only API keys (`accessLevel`) |
| [module-table-security.md](./references/module-table-security.md) | Owning a module-generated table's grants/policies — blueprint `provisions`, `secureTableProvision` with `module`/`owns` |

## Cross-References

- **Blueprint definition format:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Auth settings and sessions:** [`constructive-auth`](../constructive-auth/SKILL.md)
- **Entity types and memberships:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Data modeling (tables, fields):** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
