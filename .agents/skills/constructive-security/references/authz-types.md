# Safegres Authz* Policy Types — Detailed Reference

Complete documentation for all 19 leaf policy node types and the `AuthzComposite` meta-node.

> **Registry note:** 18 of these (including `AuthzSystemOnly`) are blueprint-selectable RLS nodes in the `node_type_registry`. `AuthzHumanOnly` is the exception — it is a platform-applied guard on credential/principal mutations rather than a user-selectable node, documented here for completeness.

Each policy is described as:
- **Intent**: what it's for
- **Config**: JSON shape (keys)
- **Semantics**: what it authorizes (in words)
- **Use when** / **Avoid when**

---

## 1) `AuthzDirectOwner`

**Intent:** Direct personal ownership.

**Config:**
```json
{ "entity_field": "owner_id" }
```

**Semantics:** Authorize when the row's `{entity_field}` equals the actor's user id.

**Use when:**
- The row is owned by exactly one user, and ownership is represented directly on the row.

**Avoid when:**
- Ownership can be an organization (or user-as-org) and you want "org members can access." Prefer `AuthzEntityMembership` (org scope) instead.

---

## 2) `AuthzDirectOwnerAny`

**Intent:** Multi-owner OR logic.

**Config:**
```json
{ "entity_fields": ["sender_id", "receiver_id"] }
```

**Semantics:** Authorize when the actor id matches **any** of the fields.

**Use when:**
- A record has multiple relevant user id columns and any of them confer access.

---

## 3) `AuthzAppMembership`

**Intent:** App-level membership gate (hardcoded to `membership_type=1`).

**Config (minimal):**
```json
{}
```

**Config (permissioned):**
```json
{ "permission": "admin_permissions" }
```

Optional keys:
- `permission` (string)
- `permissions` (string[])
- `is_admin` (boolean)
- `is_owner` (boolean)

> **Note:** `membership_type` is not configurable — it is always `1` (app-level). For entity-scoped membership checks, use `AuthzEntityMembership`.

**Semantics:** "The actor has app-level membership, optionally matching permission/admin flags."

**Use when:**
- App-level admin checks.
- Global feature gating.

**Avoid when:**
- Entity-scoped resources (anything that should be constrained by a row's field). Use `AuthzEntityMembership` instead.

---

## 4) `AuthzEntityMembership`

**Intent:** **Bound** membership-to-row.

**Config (minimal):**
```json
{ "entity_field": "entity_id", "membership_type": 2 }
```

Optional keys:
- `permission` / `permissions`
- `is_admin` / `is_owner`

**Semantics:** "The actor is a member of the entity referenced by this row's `{entity_field}`."

**Use when:**
- Org-owned or group-owned resources.
- `owner_id` that may refer to either a user or an org (because users are orgs via personal orgs).

---

## 5) `AuthzMemberOwner`

**Intent:** Compound policy requiring BOTH ownership AND entity membership. The actor must own the row (owner_field = current_user_id) AND be a member of the entity referenced by entity_field.

**Config (typical):**
```json
{
  "owner_field": "owner_id",
  "entity_field": "entity_id",
  "membership_type": 3
}
```

Optional keys:
- `sel_field` — SPRT column to select for entity match (default: `entity_id`)
- `permission` / `permissions`
- `entity_type` — string name resolved to membership_type via membership types module

**Semantics:** "The actor owns this row (owner_field = current_user_id) AND the actor is a member of the entity referenced by entity_field."

**Use when:**
- Private data within an entity scope — e.g., personal chat threads that belong to a team/dataroom but only the author can see.
- Personal notes, draft documents, or preferences scoped to an entity.
- Any table where rows are both user-owned AND entity-scoped.

**Do NOT use when:**
- You want all entity members to see all rows (use `AuthzEntityMembership` instead).
- You want just ownership without entity scoping (use `AuthzDirectOwner` instead).

**Paired data node:** `DataMemberOwner` — creates both `owner_id` + `entity_id` columns with FKs, indexes, and applies this policy automatically.

---

## 6) `AuthzRelatedEntityMembership`

**Intent:** Entity membership where the entity isn't directly on the protected row, but reachable via a join.

**Config (typical):**
```json
{
  "entity_field": "post_id",
  "membership_type": 2,
  "obj_schema": "public",
  "obj_table": "posts",
  "obj_field": "organization_id"
}
```

**Semantics:** "Look up the related row and authorize based on membership in the entity referenced there."

**Use when:**
- Protected rows reference another table (FK), and that related table carries `entity_id` / org id.

---

## 7) `AuthzPeerOwnership`

**Intent:** Peer visibility via shared entity membership (direct owner field on protected row).

**Config (typical):**
```json
{ "owner_field": "owner_id", "membership_type": 2 }
```

Optional keys:
- `permission` / `permissions`
- `is_admin` / `is_owner`

**Semantics (in words):**
- Find the entities (orgs/groups) the actor belongs to.
- Find **other users** who belong to those same entities.
- Allow access when the row's `{owner_field}` is one of those peer user ids.

**Use when:**
- "People in the same org can see each other's user-owned objects."

**Avoid when:**
- The owner is not directly on the protected row (then use `AuthzRelatedPeerOwnership`).

---

## 8) `AuthzRelatedPeerOwnership`

**Intent:** Peer visibility via shared entity membership **through a related table**.

**Config (typical):**
```json
{
  "entity_field": "message_id",
  "membership_type": 2,
  "obj_schema": "public",
  "obj_table": "messages",
  "obj_field": "sender_id"
}
```

Optional keys:
- `obj_ref_field` (defaults to `id`)
- `permission` / `permissions`
- `is_admin` / `is_owner`

**Semantics (in words):**
- Find peers of the actor (as in `AuthzPeerOwnership`).
- Join the related table where each peer is the related row's owner (`obj_field`).
- Allow access when the protected row's `{entity_field}` matches those related rows.

**Use when:**
- Protected row points at another object, and that object's owner is what should be peer-visible.

---

## 9) `AuthzOrgHierarchy`

**Intent:** Visibility via org hierarchy (manager/subordinate relationships).

**Config (typical):**
```json
{ "direction": "down", "anchor_field": "owner_id", "entity_field": "entity_id" }
```

**Semantics:** Authorize based on hierarchy closure relationships anchored at a user field (often `owner_id`).

**Use when:**
- Manager sees subordinate-owned records.
- Subordinate sees manager-owned records.

---

## 10) `AuthzTemporal`

**Intent:** Time-window constraints.

**Config (typical):**
```json
{ "valid_from_field": "valid_from", "valid_until_field": "valid_until" }
```

Either field can be omitted (at least one is required):
- `valid_from_field` only -> "accessible from this time onward" (open-ended future)
- `valid_until_field` only -> "accessible until this time" (open-ended past)
- Both -> classic time window

Additionally, a NULL column value in `valid_until` is treated as "no expiry" (`valid_until IS NULL OR valid_until > now()`), making the window dynamic per row.

Optional keys:
- `valid_from_inclusive` (default `true`)
- `valid_until_inclusive` (default `false`)

**Semantics:** Authorize only when "now" is within the configured time window. Omitting a field removes that boundary.

**Use when:**
- Scheduled content.
- Expiring invites.
- Open-ended "accessible after publish date" (use `valid_from_field` only).

> **Combination guidance:** `AuthzTemporal` answers *when* access is valid, not *who* has access. On its own it means "anyone can access within the time window." In practice, always combine it with an identity-based policy — either as a **restrictive** top-level policy (ANDed with a permissive identity policy) or inside an `AuthzComposite` `BoolExpr`.

> **Overlap with `AuthzPublishable`:** You could approximate published-content gating with `AuthzTemporal` (e.g. `valid_from_field: "published_at"` with no `valid_until_field`). However, `AuthzPublishable` additionally provides the `is_published` boolean toggle, which lets authors unpublish content independently of time. Use `AuthzPublishable` when you need an explicit on/off switch; use `AuthzTemporal` when access is purely time-driven.

---

## 11) `AuthzPublishable`

> **READ-only policy.** `AuthzPublishable` should only be applied to the `select` privilege. It controls who can *read* published content — it should **never** be used for `insert`, `update`, or `delete`. For write operations (authorship, editing, deletion), use an identity-based policy like `AuthzEntityMembership` or `AuthzDirectOwner`. A typical blog pattern is: `AuthzEntityMembership` for all CRUD privileges, plus a second `AuthzPublishable` policy **only for `select`** to open reads to the public.

**Intent:** Draft/published gating.

**Config (default fields):**
```json
{}
```

Optional keys:
- `is_published_field` (default `"is_published"`)
- `published_at_field` (default `"published_at"`)
- `require_published_at` (default `true`)

**Semantics:** Authorize when a record is published (and, if `require_published_at=true`, when `published_at <= now`).

**Use when:**
- Public content that is only visible after publishing.
- **Only for `select`** — never for `insert`, `update`, or `delete`.

> **Combination guidance:** `AuthzPublishable` answers *whether content is published*, not *who* can see it. On its own it means "anyone can see published content." In practice, always combine it with an identity-based policy — either as a **restrictive** top-level policy (ANDed with a permissive identity policy like `AuthzEntityMembership`) or inside an `AuthzComposite` `BoolExpr`. See the "Permissive vs Restrictive policies in RLS" section for examples.

> **Typical pattern (e.g., blog posts):**
> 1. `AuthzEntityMembership` (permissive) for `select`, `insert`, `update`, `delete` — locks down all CRUD to org/entity members (authors).
> 2. `AuthzPublishable` (permissive) for `select` only — opens published content for reads to anyone authenticated.
>
> This way, authorship is protected by membership, but published content is publicly readable.

> **Overlap with `AuthzTemporal`:** The time component of `AuthzPublishable` (`published_at <= now`) is a subset of what `AuthzTemporal` can express. The key difference is the `is_published` boolean -- a deliberate on/off toggle that `AuthzTemporal` does not provide. If you only need time-window access with no manual toggle, `AuthzTemporal` is sufficient.

---

## 12) `AuthzMemberList`

> **Not recommended.** This policy relies on a UUID array column rather than a proper foreign-key relationship. It does not scale well and bypasses normal relational integrity. Prefer `AuthzEntityMembership` or `AuthzPeerOwnership` with proper FK-based membership tables when possible.

**Intent:** Actor is present in a UUID array column on the same row.

**Config:**
```json
{ "array_field": "member_ids" }
```

**Semantics:** Authorize when the actor id appears in `{array_field}`.

**Use when:**
- Legacy share lists stored as arrays (supported but not recommended for new designs).

---

## 13) `AuthzRelatedMemberList`

> **Not recommended.** Same concern as `AuthzMemberList` -- relies on a UUID array column in a related table rather than proper FK-based membership. Prefer FK-based policies when possible.

**Intent:** Actor is present in a UUID array column in a related table.

**Config (conceptual):**
```json
{
  "owned_schema": "public",
  "owned_table": "documents",
  "owned_table_key": "member_ids",
  "owned_table_ref_key": "document_id",
  "this_object_key": "id"
}
```

**Semantics:** "Follow a reference to a related row that contains an array of member ids."

**Use when:**
- Legacy membership lists stored as arrays in a related table (supported but not recommended for new designs).

---

## 14) `AuthzAllowAll`

> **WARNING: `AuthzAllowAll` is almost never what you want.** It grants unconditional access to every authenticated user for the specified privilege. Before using it, ask yourself: "Should literally every authenticated user be able to read/write this data?" If the answer is no (and it usually is), use a scoped policy like `AuthzDirectOwner` or `AuthzEntityMembership` instead.
>
> **Especially avoid `AuthzAllowAll` on junction tables.** When creating ManyToMany relations with security, match the junction table's policy to the parent tables' policies. If parents use `AuthzDirectOwner`, the junction should too. Using `AuthzAllowAll` on a junction table means any authenticated user can create/delete links between rows they don't own. See the `constructive-relations` skill for junction table security patterns.

**Intent:** Unconditional allow.

**Config:**
```json
{}
```

**Semantics:** Always authorizes.

**Legitimate use cases (rare):**
- Truly public reference data (e.g., a `countries` lookup table that any user should read)
- Public read-only access (combine with restrictive write policies)

**Common misuses:**
- Using `AuthzAllowAll` as a "just make it work" default -- this bypasses all access control
- Using `AuthzAllowAll` on junction tables when parent tables have scoped policies -- the junction should match the parents
- Using `AuthzAllowAll` for both read AND write on any table with user-generated content

---

## 15) `AuthzDenyAll`

**Intent:** Unconditional deny.

**Config:**
```json
{}
```

**Semantics:** Never authorizes.

**Use when:**
- Explicitly blocking a privilege.

---

## 16) `AuthzFilePath`

**Intent:** Path-scoped file sharing via ltree containment. Grants access when a `path_shares` row matches the current user, bucket, and an ancestor path with the required permission.

**Config (typical):**
```json
{
  "shares_schema": "public",
  "shares_table": "path_shares",
  "files_table": "files",
  "permission_field": "can_read"
}
```

Required keys:
- `shares_schema` — schema of the path_shares table
- `shares_table` — name of the path_shares table
- `files_table` — name of the files table (qualifies column refs in EXISTS subquery)
- `permission_field` — boolean column on path_shares granting the required permission (e.g. `can_read`, `can_write`)

Optional keys:
- `files_schema` — schema of the files table (defaults to same as shares_schema)
- `bucket_field` — column on the files table referencing the bucket (default `"bucket_id"`)
- `path_field` — ltree column on the files table representing the file path (default `"path"`)

**Semantics:** EXISTS subquery checks for a `path_shares` row where the actor matches, the bucket matches, the share's path is an ancestor of (or equal to) the file's path via ltree containment (`@>`), and the `permission_field` is true.

**Use when:**
- File-level access control using ltree path hierarchy (e.g. shared folders, virtual filesystem ACLs).
- You have a `path_shares` table mapping users to path prefixes with per-permission booleans.

**Tags:** `storage`, `authz`

---

## 17) `AuthzNotReadOnly`

> **Restrictive policy.** `AuthzNotReadOnly` should be used as a restrictive counterpart to a permissive identity policy (e.g. `AuthzEntityMembership`). It blocks write operations for members whose `is_read_only` flag is true on the SPRT.

**Intent:** Restrict mutations for read-only members.

**Config (typical):**
```json
{ "entity_field": "entity_id" }
```

Required keys:
- `entity_field` — column referencing the entity (e.g. `entity_id`, `org_id`)

Optional keys:
- `membership_type` — scope: `2` = org, `3`+ = dynamic entity types. Must be >= 2 (entity-scoped).

**Semantics:** Checks `actor_id` + `is_read_only IS NOT TRUE` on the SPRT. Members with `is_read_only = true` on their membership are denied writes.

**Use when:**
- You want entity members to read data but selectively restrict mutations based on the `is_read_only` membership flag.
- Combine with a permissive `AuthzEntityMembership` policy: the permissive policy grants access, then `AuthzNotReadOnly` (restrictive) blocks writes for read-only members.

**Typical pattern:**
```
Policy 1 (permissive):  AuthzEntityMembership { entity_field: "org_id", membership_type: 2 }
Policy 2 (restrictive): AuthzNotReadOnly { entity_field: "org_id" }

Effective: org members can read; org members with is_read_only=true cannot insert/update/delete
```

**Tags:** `membership`, `authz`, `restrictive`

---

## 18) `AuthzSystemOnly`

> **Restrictive, machine-only.** Restricts a privilege to system-initiated sessions (database triggers, background jobs). Normal API requests — even the owning human or an admin — are denied.

**Intent:** Only the platform itself may write the row.

**Config:**
```json
{}
```

**Semantics:** Authorize only when the session's `role_type` claim equals `'system'`. Generates `jwt_public.current_role_type() = 'system'`. Ordinary `authenticate`/`authenticate_strict` sessions default to `role_type = 'user'`, so they never pass; `role_type` is set to `'system'` only inside trigger/worker execution contexts.

**Use when:**
- `INSERT`/`UPDATE` policies on append-only event, audit, and usage tables that must only be written by triggers or workers (e.g. event-tracker rows, `*_log` tables, usage rollups, billing meters).
- A table where humans may `SELECT` (via a separate permissive policy) but only the platform may write.

**Avoid when:**
- The write should be performed by a user or an agent — use SPRT-based policies (`AuthzEntityMembership`, `AuthzDirectOwner`, …) instead.
- You want to block only agents/API keys while still allowing humans — that is `AuthzHumanOnly` (below), not `AuthzSystemOnly`.

**Pairing:** Apply as a restrictive write policy alongside a permissive read policy:

```
Policy 1 (permissive, SELECT): AuthzEntityMembership { entity_field: "org_id", membership_type: 2 }
Policy 2 (restrictive, INSERT/UPDATE): AuthzSystemOnly {}
Effective: org members can read; only system sessions (triggers/jobs) can write
```

**Tags:** `authz`, `system`, `restrictive`

---

## 19) `AuthzHumanOnly`

> **Guard-style, human-only.** Blocks principals (agents / API keys) from a sensitive mutation so that only the owning human can perform it. This is the counterpart to `AuthzSystemOnly`: `AuthzHumanOnly` blocks non-human principals, `AuthzSystemOnly` blocks everyone who is not the platform.
>
> **Note:** Unlike the other entries, `AuthzHumanOnly` is not a blueprint-selectable RLS node in the `node_type_registry`; it is applied by the platform as an inline guard inside SECURITY DEFINER credential/principal mutations. It is documented here for completeness. For the SQL-level details see the `constructive-db-principals` and `constructive-db-security` skills.

**Intent:** Only a human session (not a delegated principal) may call the operation.

**Config:**
```json
{}
```

**Semantics:** Authorize only when `current_principal_id() = current_user_id()`. For human sessions the two ids are identical; for principal (agent / API-key) sessions they differ, so the check fails and the mutation is blocked.

**Use when:**
- Credential and principal lifecycle mutations that a bot must never invoke on its owner's behalf — `createApiKey`/`revokeApiKey`, `createOrgPrincipal`/`deleteOrgPrincipal`, `createOrgApiKey`/`revokeOrgApiKey`.

**Avoid when:**
- Regular data access — SPRT-based policies already resolve `current_principal_id()` correctly, so principals get exactly their subset of permissions without an extra guard.

**Tags:** `authz`, `principal`, `human-only`

---

## `AuthzComposite` (meta-node, not a leaf type)

`AuthzComposite` lets you build a boolean expression tree (AND/OR/NOT) over Safegres nodes.

The `data` for an `AuthzComposite` is itself an AST node that the system recursively evaluates. It can be either a single Authz* leaf node or a `BoolExpr` combining multiple nodes.

**Single leaf node wrap** — delegates to one Authz* node:
```json
{
  "AuthzEntityMembership": {
    "entity_field": "owner_id",
    "membership_type": "Organization Member"
  }
}
```

**`BoolExpr` AND** — all conditions must pass:
```json
{
  "BoolExpr": {
    "boolop": "AND_EXPR",
    "args": [
      { "AuthzTemporal": { "valid_from_field": "publish_at" } },
      { "AuthzDirectOwner": { "entity_field": "owner_id" } }
    ]
  }
}
```

**`BoolExpr` OR** — any condition grants access:
```json
{
  "BoolExpr": {
    "boolop": "OR_EXPR",
    "args": [
      {
        "AuthzEntityMembership": {
          "entity_field": "owner_id",
          "membership_type": "Organization Member"
        }
      },
      {
        "AuthzAppMembership": {
          "permission": "create_invites"
        }
      }
    ]
  }
}
```

**When to use `AuthzComposite`:**
- Genuinely nested boolean logic that cannot be expressed with separate top-level policies.
- Mixing AND/OR at different levels (e.g., `(A OR B) AND (C OR D)`).
- NOT expressions.
- Non-authz conditions in the same expression tree (e.g., column value checks combined with auth checks).

---

## Permissive vs Restrictive policies in RLS

When Safegres policies compile to PostgreSQL RLS, their interaction depends on whether they are **permissive** or **restrictive**:

- **Permissive** (default): Multiple permissive policies on the same table and privilege are **ORed** together. If **any** permissive policy passes, the row is accessible.
- **Restrictive** (`permissive := false`): Restrictive policies are **ANDed** with the result of permissive policies. **All** restrictive policies must pass *in addition to* at least one permissive policy.

**OR composition (permissive + permissive):**
"Owner OR org admin can see" — add two separate permissive policies. PostgreSQL automatically ORs them:

```
Policy 1 (permissive): AuthzDirectOwner { entity_field: "owner_id" }
Policy 2 (permissive): AuthzEntityMembership { entity_field: "organization_id", membership_type: 2, is_admin: true }

Effective rule: row.owner_id = actor OR actor is admin of row.organization_id
```

**AND composition (permissive + restrictive):**
"Org members can access, but only while the row's time window is active" — add membership as permissive and the time constraint as restrictive:

```
Policy 1 (permissive):  AuthzEntityMembership { entity_field: "entity_id", membership_type: 2 }
Policy 2 (restrictive): AuthzTemporal { valid_from_field: "starts_at", valid_until_field: "ends_at" }

Effective rule: actor is member of row.entity_id AND now() is within [starts_at, ends_at)
```

**3 policies (2 permissive + 1 restrictive):**
"Owner OR org member can access, but only if the row is published":

```
Policy 1 (permissive):  AuthzDirectOwner { entity_field: "owner_id" }
Policy 2 (permissive):  AuthzEntityMembership { entity_field: "organization_id", membership_type: 2 }
Policy 3 (restrictive): AuthzPublishable {}

Effective rule: (row.owner_id = actor OR actor is member of row.organization_id) AND row.is_published = true
```

**4 policies (2 permissive + 2 restrictive):**
"Owner OR org member can access, but only if published AND within the time window":

```
Policy 1 (permissive):  AuthzDirectOwner { entity_field: "owner_id" }
Policy 2 (permissive):  AuthzEntityMembership { entity_field: "organization_id", membership_type: 2 }
Policy 3 (restrictive): AuthzPublishable {}
Policy 4 (restrictive): AuthzTemporal { valid_from_field: "available_from", valid_until_field: "available_until" }

Effective rule: (P1 OR P2) AND R3 AND R4
             = (owner OR org member) AND is_published AND now() in time window
```

Notice the pattern: permissive/restrictive composition always produces `(P1 OR P2 OR ... Pn) AND R1 AND R2 AND ... Rm`. This is powerful but **limited to a single grouping shape**.

### When `AuthzComposite` is necessary

Permissive/restrictive composition cannot express arbitrary boolean groupings. Consider:

"Access is allowed if (org member AND published) OR (direct owner AND within time window)":

```
Desired: (AuthzEntityMembership AND AuthzPublishable) OR (AuthzDirectOwner AND AuthzTemporal)
```

This requires OR-ing two AND-groups — impossible with flat permissive/restrictive policies (which always produce a single `(any P) AND (all R)` shape). Use `AuthzComposite`:

```json
{
  "BoolExpr": {
    "boolop": "OR_EXPR",
    "args": [
      {
        "BoolExpr": {
          "boolop": "AND_EXPR",
          "args": [
            { "AuthzEntityMembership": { "entity_field": "organization_id", "membership_type": 2 } },
            { "AuthzPublishable": {} }
          ]
        }
      },
      {
        "BoolExpr": {
          "boolop": "AND_EXPR",
          "args": [
            { "AuthzDirectOwner": { "entity_field": "owner_id" } },
            { "AuthzTemporal": { "valid_from_field": "starts_at", "valid_until_field": "ends_at" } }
          ]
        }
      }
    ]
  }
}
```

**Prefer multiple top-level policies over `AuthzComposite` whenever possible.** They are simpler, easier to read, and easier to maintain. Reserve `AuthzComposite` for cases that genuinely require nested boolean trees like the one above.
