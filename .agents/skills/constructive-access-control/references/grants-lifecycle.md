# Grants Lifecycle

Grants are the mechanism for giving or removing permissions from individual members. Every permission change is recorded as an append-only audit event — grants are never modified in place, only appended.

## Grant/Revoke Model

```
Grant event:  { permissions: value, isGrant: true,  actorId, grantorId }
Revoke event: { permissions: value, isGrant: false, actorId, grantorId }
```

- **Grant** (`isGrant: true`) — adds permissions to the member's direct grants
- **Revoke** (`isGrant: false`) — removes permissions from the member's direct grants
- The membership's `granted` field always reflects the current state after all events are applied

## Granting Permissions

```typescript
// Grant permissions to a member at app scope
await db.appGrant.create({
  data: {
    permissions: permissionValue,
    isGrant: true,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Grant permissions at org scope
await db.orgGrant.create({
  data: {
    permissions: permissionValue,
    isGrant: true,
    actorId: memberId,
    entityId: orgId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();
```

### Building the Permission Value

```typescript
// Resolve permission names to a value
const result = await db.query.orgPermissionsGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();
const permissionValue = result.permissions;
```

## Revoking Permissions

```typescript
// Revoke permissions from a member
await db.orgGrant.create({
  data: {
    permissions: permissionValue,
    isGrant: false,
    actorId: memberId,
    entityId: orgId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();
```

Note: Revoking removes from direct grants only. If the member's profile also includes that permission, they still have it through their profile.

## Effective Permissions

A member's **effective permissions** is the union of all permission sources:

```
effective = granted (direct) ∪ profile.permissions ∪ defaults
```

The membership exposes both:

| Field | Meaning |
|-------|---------|
| `permissions` | Effective permissions (the full resolved set) |
| `granted` | Direct grants only (what was explicitly given to this member) |

```typescript
const membership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: {
    permissions: true,   // effective (all sources)
    granted: true,       // direct grants only
    profileId: true,     // which profile is assigned
    isAdmin: true,
    isOwner: true
  }
}).execute();
```

### Resolution Priority

1. **Admin/Owner bypass** — if `isAdmin` or `isOwner`, all permissions are granted (no further resolution needed)
2. **Union of sources** — for regular members: `profile permissions ∪ direct grants ∪ defaults`

There is no "deny" mechanism — permissions are purely additive. To remove access, you must revoke the grant AND remove it from the profile.

## Viewing Grant History

The grants table is an append-only audit log:

```typescript
// View all grant/revoke events for a member
const history = await db.orgGrant.findMany({
  where: {
    actorId: { equalTo: memberId },
    entityId: { equalTo: orgId }
  },
  select: {
    id: true,
    permissions: true,
    isGrant: true,
    grantorId: true,
    createdAt: true
  },
  orderBy: { createdAt: 'DESC' }
}).execute();
```

### Interpreting History

```
[
  { permissions: "invoke_agents,write_files", isGrant: true,  grantorId: admin1, createdAt: "2024-01-01" },
  { permissions: "manage_agents",            isGrant: true,  grantorId: admin1, createdAt: "2024-02-01" },
  { permissions: "write_files",              isGrant: false, grantorId: admin2, createdAt: "2024-03-01" },
]
// Current direct grants: invoke_agents + manage_agents (write_files was revoked)
```

## Audit Preservation

Grant records are preserved even when entities are deleted:

- If an organization is deleted, its grant records remain (entity reference is nullified)
- If a member is removed, their grant history is preserved
- This ensures compliance and audit trail integrity

## Grantor Tracking

Every grant/revoke event records who made the change:

```typescript
// Who granted this permission?
const grants = await db.orgGrant.findMany({
  where: {
    actorId: { equalTo: memberId },
    isGrant: { equalTo: true }
  },
  select: {
    grantorId: true,
    permissions: true,
    createdAt: true
  }
}).execute();
```

## CLI Usage

```bash
# Grant permissions
constructive public:org-grant create \
  --data.permissions "$PERMISSION_VALUE" \
  --data.isGrant true \
  --data.actorId $MEMBER_ID \
  --data.entityId $ORG_ID \
  --data.grantorId $ADMIN_ID

# Revoke permissions
constructive public:org-grant create \
  --data.permissions "$PERMISSION_VALUE" \
  --data.isGrant false \
  --data.actorId $MEMBER_ID \
  --data.entityId $ORG_ID \
  --data.grantorId $ADMIN_ID
```

## Key Behaviors

- **Append-only** — grants are never modified or deleted; new events override previous state
- **Additive model** — no "deny"; permissions can only be added (granted) or removed (revoked)
- **Profile-independent** — revoking a direct grant doesn't affect profile-inherited permissions
- **Audit trail** — full history of who granted/revoked what and when
- **Entity-preserved** — grant records survive entity deletion for compliance
- **Grantor accountability** — every permission change traces back to the admin who made it
