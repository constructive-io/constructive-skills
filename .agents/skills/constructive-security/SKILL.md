---
name: constructive-security
description: "Authorization — Safegres protocol, 18 Authz* policy types, RLS, grants, permissions, read-only access, storage policies, and the secureTableProvision workflow. Use when asked to 'add security', 'RLS', 'grants', 'policies', 'Safegres', 'Authz*', 'AuthzEntityMembership', 'AuthzDirectOwner', 'AuthzMemberOwner', 'AuthzComposite', 'read-only mode', 'secure table provision', 'storage policies', 'bucket security', 'permission model', or when working with authorization in blueprints or the ORM."
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

## Core Vocabulary

### Actor, Entity, Membership

- **Actor** — the authenticated user (`current_user_id()`)
- **Entity** — the scope a membership belongs to (org, group, custom)
- **Membership types:** `1` = App, `2` = Org, `3` = Group, `3+` = custom

### Users ARE Organizations

Every user has an "org identity" — a personal org with org-level membership. This unifies "user owns it personally" and "org owns it and user is a member" under a single `AuthzEntityMembership` policy.

## The 18 Authz* Policy Types

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
| 18 | `AuthzComposite` | Boolean tree (AND/OR/NOT) of other policies | nested AST |

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

## Storage Policies

Configurable per-bucket RLS via `storage_config.policies[]` on entity_type_provision:
- `tables` key scopes to `"buckets"` or `"files"` (logical names)
- `is_public` controls S3 bucket ACL; `policies` controls RLS
- Default (no explicit policies): membership + AuthzPublishable + AuthzDirectOwner

See [storage-policies.md](./references/storage-policies.md) for typical combinations.

## References

| File | Content |
|------|---------|
| [authz-types.md](./references/authz-types.md) | All 18 Authz* types with config shapes and examples |
| [storage-policies.md](./references/storage-policies.md) | Per-bucket RLS policy combinations |

## Cross-References

- **Blueprint definition format:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Auth settings and sessions:** [`constructive-auth`](../constructive-auth/SKILL.md)
- **Entity types and memberships:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Data modeling (tables, fields):** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
