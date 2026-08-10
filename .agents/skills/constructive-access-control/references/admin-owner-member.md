# Admin, Owner & Member

Every membership in a Constructive app has a **role** — a built-in access level that determines base access. Roles are orthogonal to capabilities: they control structural privileges (who can manage the entity) while capabilities control feature access (what actions are allowed).

## Built-in Roles

| Role | Field | Description |
|------|-------|-------------|
| **Owner** | `isOwner: true` | Creator of the entity. Full control, cannot be removed by admins. One owner per entity (transferable). |
| **Admin** | `isAdmin: true` | Elevated management access. Can manage members, capabilities, profiles. Multiple admins allowed. |
| **Member** | (default) | Standard access. Governed by capabilities (direct grants + profile). |

### Role Precedence

```
Owner > Admin > Member
```

- **Owners** bypass all capability checks — they always have full access to all features within their entity.
- **Admins** bypass all capability checks — they receive all named capabilities implicitly, regardless of grants or profile.
- **Members** are governed by the capability system — their effective access is determined by their profile + direct grants + defaults.

## Owner and Admin Hold Every Capability

This is a structural property of the platform, not a configuration default, and it is worth understanding before you design access around it.

When a membership is created or updated with `isAdmin: true` or `isOwner: true`, the membership's capability value is set to **every capability in the scope** — not to the defaults, not to the profile, and not to anything an operator chose. Demoting the member (both flags false) drops it back to their granted set; there is no way to leave the flag set and withhold a capability.

### The consequence: trust levels are included

Because `kind = 'level'` capabilities share the same space as `kind = 'permission'` ones (see [named-capabilities.md](./named-capabilities.md#two-kinds-of-capability)), **an owner or admin satisfies every trust level automatically**, including levels nobody has earned. A policy gated on `level.reachable` will admit an owner who never verified an email, passed a CAPTCHA, or recorded any event at all.

So a trust ladder cannot gate an owner inside their own entity. Do not model "even the owner must verify their email before doing X" as a level requirement on an org-scoped policy — it will not hold.

### Why this is still safe

The reach is **intra-realm**: the capability value lives on a single membership row, which names one actor and one entity. It authorizes that actor inside that org or app only, and confers nothing anywhere else. An org owner is absolute within their org and ordinary everywhere outside it.

### Where to gate instead

When you need a limit that an owner cannot escape, place it at a scope the owner does not own:

| Goal | Wrong place | Right place |
|------|-------------|-------------|
| Require verified humanity before an org can send mail | Org-scoped level requirement | App-scoped policy — the org owner is not the app owner |
| Cap what any tenant can consume | Org capability | Limits/quotas — see [`constructive-billing`](../../constructive-billing/SKILL.md) |
| Restrict a delegated agent below its owner | Membership role | A principal with a reduced scope — see below |

The general rule: **role-based access is bounded by the entity, so cross-entity limits belong to the enclosing scope.**

### A principal of an admin is not an admin

Delegated identities are the one case where an admin's access can be narrowed without leaving the entity. A principal's membership derives from its owner's but is deliberately weaker:

- `isOwner` is always `false` on the principal's membership, whatever the owner is.
- `isAdmin` is inherited **only** if the principal (or its per-scope override) opts in; by default an admin's principal is a plain member.
- Its capabilities are the owner's intersected with `allowedMask`, so they can only shrink.

So "this agent acts for me but cannot do everything I can" is expressible, while "this human is an admin but cannot do everything an admin can" is not. See [`constructive-principals`](../../constructive-principals/SKILL.md).

### Key Difference: Owner vs Admin

| Capability | Owner | Admin |
|-----------|-------|-------|
| All named capabilities | Yes | Yes |
| All trust levels (`kind = 'level'`) | Yes | Yes |
| Manage other admins | Yes | No |
| Transfer ownership | Yes | No |
| Remove other admins | Yes | No |
| Be removed by another admin | No | Yes |
| Multiple per entity | No | Yes |

## Reading Roles (ORM)

```typescript
// Check a member's role
const membership = await db.appMembership.findOne({
  where: { actorId: { equalTo: userId } },
  select: {
    id: true,
    isAdmin: true,
    isOwner: true,
    capabilities: true,
    granted: true,
    profileId: true
  }
}).execute();

// Org-scope equivalent
const orgMembership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: {
    id: true,
    isAdmin: true,
    isOwner: true,
    capabilities: true,
    granted: true,
    profileId: true
  }
}).execute();
```

`granted` is what the member was actually given (defaults + profile + direct grants); `capabilities` is what they effectively hold. For a plain member the two match. For an admin or owner, `capabilities` is the full set while `granted` still reflects only what was granted — so **read `granted`, not `capabilities`, when you want to show what an operator chose** rather than what the role confers.

## Promoting to Admin

Admin promotion uses the **admin grants table** — an append-only audit log. Inserting a record with `isGrant: true` triggers an automatic update to the membership's `isAdmin` field. Direct column updates to `isAdmin` are blocked by column grants.

Promoting a member to admin therefore does more than mark a flag — it replaces their capability set with the complete one, as described above. Only existing admins (at entity scope) or owners can create admin grants:

```typescript
// Promote a member to admin (org scope)
await db.orgAdminGrant.create({
  data: {
    isGrant: true,
    actorId: userId,
    entityId: orgId,
    grantorId: currentUserId
  },
  select: { id: true }
}).execute();

// App scope (no entityId needed)
await db.appAdminGrant.create({
  data: {
    isGrant: true,
    actorId: userId,
    grantorId: currentUserId
  },
  select: { id: true }
}).execute();
```

```bash
# CLI equivalent
constructive admin:org-admin-grant create \
  --data.isGrant true \
  --data.actorId $USER_ID \
  --data.entityId $ORG_ID \
  --data.grantorId $CURRENT_USER_ID
```

### Demotion

Revoking admin is the same table — insert with `isGrant: false`:

```typescript
// Revoke admin role (org scope)
await db.orgAdminGrant.create({
  data: {
    isGrant: false,
    actorId: userId,
    entityId: orgId,
    grantorId: currentUserId
  },
  select: { id: true }
}).execute();
```

The trigger automatically sets `isAdmin = false` on the membership (unless the user is also an owner).

### Audit Trail

Every admin grant/revoke is a permanent record — the table is append-only with timestamps and the `grantorId` of who made the change. You can query the full history:

```typescript
const history = await db.orgAdminGrant.findMany({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: { id: true, isGrant: true, grantorId: true, createdAt: true },
  orderBy: ['CREATED_AT_ASC']
}).execute();
```

## Transferring Ownership

Ownership transfer uses the **owner grants table** — same pattern as admin grants. Only the current owner can create owner grants:

```typescript
// Transfer ownership (org scope)
// Step 1: Revoke current owner
await db.orgOwnerGrant.create({
  data: {
    isGrant: false,
    actorId: currentOwnerId,
    entityId: orgId,
    grantorId: currentOwnerId
  },
  select: { id: true }
}).execute();

// Step 2: Grant ownership to new user
await db.orgOwnerGrant.create({
  data: {
    isGrant: true,
    actorId: newOwnerId,
    entityId: orgId,
    grantorId: currentOwnerId
  },
  select: { id: true }
}).execute();
```

## Grant Tables by Scope

| Scope | Admin Grants | Owner Grants | RLS Policy |
|-------|-------------|--------------|------------|
| **App** | `db.appAdminGrant` | `db.appOwnerGrant` | `AuthzAppMembership { is_admin: true }` / `{ is_owner: true }` |
| **Org** | `db.orgAdminGrant` | `db.orgOwnerGrant` | `AuthzEntityMembership { is_admin: true }` / `{ is_owner: true }` |
| **Custom** | `db.{prefix}AdminGrant` | `db.{prefix}OwnerGrant` | Same pattern, scoped to membership type |

### Who Can Create Grants

| Grant Type | Who Can Insert | RLS Rule |
|-----------|----------------|----------|
| App admin grant | App admins or owners | `AuthzAppMembership { is_admin: true }` |
| App owner grant | App owners only | `AuthzAppMembership { is_owner: true }` |
| Org admin grant | Entity admins within that org | `AuthzEntityMembership { is_admin: true }` |
| Org owner grant | Entity owners within that org | `AuthzEntityMembership { is_owner: true }` |

## Role Semantics by Scope

| Scope | Owner | Admin | Member |
|-------|-------|-------|--------|
| **App** | App creator (bootstrap user) | App-wide administrators | Regular app users |
| **Org** | Organization creator | Organization administrators | Organization members |
| **Custom** (channel, team, etc.) | Entity creator | Entity managers | Entity participants |

## Blueprint: Initial Roles

When bootstrapping a database, the first user is created as both owner and admin:

```typescript
// Bootstrap the first user (from constructive-auth)
await db.query.signUp({
  input: {
    targetDatabaseId: dbId,
    password: 'initial-password',
    isAdmin: true,
    isOwner: true
  }
}).execute();
```

Subsequent users join as regular members (via sign-up or invite) and are promoted via the admin grants table as needed.

## Admin-Only Actions

Actions restricted to admins (and owners) include:
- Managing other members' capabilities (granting/revoking)
- Assigning profiles to members
- Creating and editing profile definitions
- Viewing all members and their capability state
- Managing entity settings (membership defaults, invite modes)
- Accessing admin-only capabilities (e.g., `manage_agents`, `manage_storage`)

## When Roles Don't Apply

Roles apply to **memberships** (actor ↔ entity relationships). For tables secured with non-membership policies (e.g., `AuthzDirectOwner` for personal data), there's no role hierarchy — just ownership of the row.

This is also the escape hatch from the all-capabilities property above: a table secured by row ownership rather than membership does not consult the membership capability value at all, so being an org admin grants nothing on it.
