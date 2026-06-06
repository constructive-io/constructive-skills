# Roles & Hierarchy

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

Only owners (or existing admins at app scope) can promote a member to admin:

```typescript
// Promote a member to admin
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { isAdmin: true }
}).execute();
```

```bash
# CLI equivalent
constructive public:org-membership update \
  --where.actorId $USER_ID \
  --where.entityId $ORG_ID \
  --data.isAdmin true
```

### Demotion

```typescript
// Demote an admin back to member
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { isAdmin: false }
}).execute();
```

## Transferring Ownership

Ownership transfer is a two-step operation — the current owner relinquishes and assigns:

```typescript
// Transfer ownership (current user must be owner)
await db.orgMembership.update({
  where: { actorId: { equalTo: currentOwnerId }, entityId: { equalTo: orgId } },
  data: { isOwner: false }
}).execute();

await db.orgMembership.update({
  where: { actorId: { equalTo: newOwnerId }, entityId: { equalTo: orgId } },
  data: { isOwner: true }
}).execute();
```

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

Subsequent users join as regular members (via sign-up or invite) and are promoted as needed.

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
