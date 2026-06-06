# Admin, Owner & Member

Every membership in a Constructive app has a **role** — a built-in access level that determines base capabilities. Roles are orthogonal to permissions: they control structural privileges (who can manage the entity) while permissions control feature access (what actions are allowed).

## Built-in Roles

| Role | Field | Description |
|------|-------|-------------|
| **Owner** | `isOwner: true` | Creator of the entity. Full control, cannot be removed by admins. One owner per entity (transferable). |
| **Admin** | `isAdmin: true` | Elevated management access. Can manage members, permissions, profiles. Multiple admins allowed. |
| **Member** | (default) | Standard access. Governed by permissions (direct grants + profile). |

### Role Precedence

```
Owner > Admin > Member
```

- **Owners** bypass all permission checks — they always have full access to all features within their entity.
- **Admins** bypass all permission checks — they receive all named permissions implicitly, regardless of grants or profile.
- **Members** are governed by the permission system — their effective access is determined by their profile + direct grants + defaults.

### Key Difference: Owner vs Admin

| Capability | Owner | Admin |
|-----------|-------|-------|
| All named permissions | Yes | Yes |
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
    permissions: true,
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
    permissions: true,
    granted: true,
    profileId: true
  }
}).execute();
```

## Promoting to Admin

Admin promotion uses the **admin grants table** — an append-only audit log. Inserting a record with `isGrant: true` triggers an automatic update to the membership's `isAdmin` field. Direct column updates to `isAdmin` are blocked by column grants.

Only existing admins (at entity scope) or owners can create admin grants:

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
- Managing other members' permissions (granting/revoking)
- Assigning profiles to members
- Creating and editing profile definitions
- Viewing all members and their permission state
- Managing entity settings (membership defaults, invite modes)
- Accessing admin-only permissions (e.g., `manage_agents`, `manage_storage`)

## When Roles Don't Apply

Roles apply to **memberships** (actor ↔ entity relationships). For tables secured with non-membership policies (e.g., `AuthzDirectOwner` for personal data), there's no role hierarchy — just ownership of the row.
