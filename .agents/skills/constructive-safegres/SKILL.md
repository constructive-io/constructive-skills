---
name: constructive-safegres
description: Safegres is Constructive's security protocol for expressing authorization as Authz* policy nodes (types + JSON configs). This skill defines each Authz* type, its config shape, semantics, and when to use it. No SQL and no SDK/grant/RLS steps.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Safegres (Authz* Security Protocol)

Safegres is the **protocol layer** behind Constructive authorization.

- Safegres is expressed as a **policy type** (e.g. `AuthzEntityMembership`) plus a **JSON config** (policy `data`).
- The system compiles these policy nodes into enforcement mechanisms (most notably **PostgreSQL RLS**), but Safegres itself is **not SQL**.

If you are writing automation that provisions security, treat Safegres as the **vocabulary of "what access means"**.

Related skills:
- **TypeScript SDK secure provisioning:** `constructive-security`
- **Relation provisioning:** `constructive-relations`
- **Data* modules (field generators):** `constructive-data-modules` -- defines each Data* nodeType, what fields it creates, and which Authz* policy it pairs with

---

## Core vocabulary (used in every Safegres policy)

### Actor
The **actor** is the authenticated user performing the query.

- `current_user_id()` (conceptually) = the actor's user id.
- In membership resolution tables you'll see this represented as `actor_id`.

### Entity
An **entity** is the scope a membership belongs to.

- For org/group memberships: `entity_id` identifies the org/group.
- For app memberships: membership is global, so there is typically **no per-row entity_id binding**.

### Membership types (scopes)
Safegres policies commonly take `membership_type`:

- `1` = App
- `2` = Org
- `3` = Group

This can be provided as an integer or a string name (resolved via the membership types module).

### Users ARE Organizations (personal orgs)
A key identity property:

- Every user also has an "org identity".
- Each user automatically has an org-level membership to themselves ("personal org").

This matters because an org-level membership check against a field like `owner_id` can often unify:
- "user owns it personally" and
- "org owns it and user is a member"

...under a single `AuthzEntityMembership` policy.

---

## The critical distinction: `AuthzAppMembership` vs `AuthzEntityMembership`

### `AuthzAppMembership` (APP-LEVEL, HARDCODED type=1)
**Meaning:** "Is the actor a member of the app, optionally with a permission/admin flag?"

- Hardcoded to `membership_type=1` — do **not** pass `membership_type`.
- Does **not** bind to any field on the row being accessed.
- Checks the app-level SPRT table only.

Correct uses:
- "Is the actor a super app admin?"
- "Can the actor access a global administrative table that is not entity-scoped?"
- App-wide feature gating.

### `AuthzEntityMembership` (BOUND)
**Meaning:** "Does the actor have membership in the specific entity referenced by *this row's field*?"

- Binds membership evaluation to an `entity_field` on the protected row.
- `membership_type` specifies which SPRT table to check (2=org, 3=group, etc.).
- The default choice for entity-scoped resources.

Rule of thumb:
- If your row has an `entity_id`, `organization_id`, or `owner_id` that should scope access, use `AuthzEntityMembership`.
- If you need an app-level gate with no entity binding, use `AuthzAppMembership`.

| | `AuthzAppMembership` | `AuthzEntityMembership` |
|---|---|---|
| **Scope** | App-level only (hardcoded `membership_type=1`) | Any scope (app/org/group/custom) |
| **Row binding** | None — checks global app membership | Bound to `entity_field` on the row |
| **`membership_type`** | Not configurable (always 1) | Required — specifies which SPRT table |

---

## Safegres policy node types — Quick reference

There are **14 leaf policy node types** plus `AuthzComposite` (a meta-node for boolean trees).

| # | Type | Intent | Key config |
|---|------|--------|------------|
| 1 | `AuthzDirectOwner` | Direct personal ownership | `entity_field` |
| 2 | `AuthzDirectOwnerAny` | Multi-owner OR logic | `entity_fields` (array) |
| 3 | `AuthzAppMembership` | App-level membership (hardcoded type=1) | optional `permission`/`is_admin` |
| 4 | `AuthzEntityMembership` | Bound membership-to-row | `entity_field`, `membership_type` |
| 5 | `AuthzRelatedEntityMembership` | Entity membership via join | `entity_field`, `obj_schema`/`obj_table`/`obj_field` |
| 6 | `AuthzPeerOwnership` | Peer visibility (direct) | `owner_field`, `membership_type` |
| 7 | `AuthzRelatedPeerOwnership` | Peer visibility via join | `entity_field`, `obj_schema`/`obj_table`/`obj_field` |
| 8 | `AuthzOrgHierarchy` | Hierarchy (manager/subordinate) | `direction`, `anchor_field`, `entity_field` |
| 9 | `AuthzTemporal` | Time-window constraints | `valid_from_field`, `valid_until_field` |
| 10 | `AuthzPublishable` | Draft/published gating (READ-only) | `is_published_field`, `published_at_field` |
| 11 | `AuthzMemberList` | Actor in UUID array (not recommended) | `array_field` |
| 12 | `AuthzRelatedMemberList` | Actor in related UUID array (not recommended) | `owned_schema`/`owned_table`/`owned_table_key` |
| 13 | `AuthzAllowAll` | Unconditional allow (use sparingly) | `{}` |
| 14 | `AuthzDenyAll` | Unconditional deny | `{}` |

See [authz-types.md](references/authz-types.md) for full documentation of each type including config shapes, semantics, use/avoid guidance, and code examples.

---

## `AuthzComposite` (meta-node)

`AuthzComposite` lets you build a boolean expression tree (AND/OR/NOT) over Safegres nodes. The `data` is an AST node that the system recursively evaluates — either a single Authz* leaf or a `BoolExpr`.

**When to use:**
- Genuinely nested boolean logic that cannot be expressed with separate top-level policies.
- Mixing AND/OR at different levels (e.g., `(A OR B) AND (C OR D)`).
- NOT expressions.

**Prefer multiple top-level policies over `AuthzComposite` whenever possible.** Reserve it for cases that genuinely require nested boolean trees.

See [authz-types.md](references/authz-types.md#authzcomposite-meta-node-not-a-leaf-type) for BoolExpr examples.

---

## Permissive vs Restrictive policies in RLS

When Safegres policies compile to PostgreSQL RLS:

- **Permissive** (default): Multiple permissive policies are **ORed** — if **any** passes, the row is accessible.
- **Restrictive** (`permissive := false`): **ANDed** with permissive results — **all** restrictive policies must pass *in addition to* at least one permissive.

The pattern: `(P1 OR P2 OR ... Pn) AND R1 AND R2 AND ... Rm`.

| Composition | Example |
|-------------|---------|
| OR (permissive + permissive) | Owner OR org admin can see |
| AND (permissive + restrictive) | Org members, but only within time window |
| Mixed (2P + 1R) | Owner OR org member, but only if published |
| Mixed (2P + 2R) | Owner OR org member, but only if published AND within time window |

When this flat shape is insufficient (e.g., `(A AND B) OR (C AND D)`), use `AuthzComposite`.

See [authz-types.md](references/authz-types.md#permissive-vs-restrictive-policies-in-rls) for detailed composition examples.
