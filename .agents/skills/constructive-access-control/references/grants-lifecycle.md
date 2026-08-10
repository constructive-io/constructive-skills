# Grants Lifecycle

Grants are the mechanism for giving or removing capabilities from individual members. Every capability change is recorded as an append-only audit event — grants are never modified in place, only appended.

## Grant/Revoke Model

```
Grant event:  { capabilities: value, isGrant: true,  actorId, grantorId }
Revoke event: { capabilities: value, isGrant: false, actorId, grantorId }
```

- **Grant** (`isGrant: true`) — adds capabilities to the member's direct grants
- **Revoke** (`isGrant: false`) — removes capabilities from the member's direct grants
- The membership's `granted` field always reflects the current state after all events are applied

## Granting Capabilities

```typescript
// Grant capabilities to a member at app scope
await db.appGrant.create({
  data: {
    capabilities: capabilityValue,
    isGrant: true,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Grant capabilities at org scope
await db.orgGrant.create({
  data: {
    capabilities: capabilityValue,
    isGrant: true,
    actorId: memberId,
    entityId: orgId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();
```

### Building the Capability Value

```typescript
// Resolve capability names to a value
const result = await db.query.orgCapabilitiesGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();
const capabilityValue = result.capabilities;
```

## Revoking Capabilities

```typescript
// Revoke capabilities from a member
await db.orgGrant.create({
  data: {
    capabilities: capabilityValue,
    isGrant: false,
    actorId: memberId,
    entityId: orgId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();
```

Note: Revoking removes from direct grants only. If the member's profile also includes that capability, they still have it through their profile.

## Effective Capabilities

A member's **effective capabilities** is the union of all capability sources:

```
effective = granted (direct) ∪ profile.capabilities ∪ defaults
```

The membership exposes both:

| Field | Meaning |
|-------|---------|
| `capabilities` | Effective capabilities (the full resolved set) |
| `granted` | Direct grants only (what was explicitly given to this member) |

```typescript
const membership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: {
    capabilities: true,   // effective (all sources)
    granted: true,       // direct grants only
    profileId: true,     // which profile is assigned
    isAdmin: true,
    isOwner: true
  }
}).execute();
```

### Resolution Priority

1. **Admin/Owner bypass** — if `isAdmin` or `isOwner`, all capabilities are granted (no further resolution needed)
2. **Union of sources** — for regular members: `profile capabilities ∪ direct grants ∪ defaults`

There is no "deny" mechanism — capabilities are purely additive. To remove access, you must revoke the grant AND remove it from the profile.

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
    capabilities: true,
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
  { capabilities: "invoke_agents,write_files", isGrant: true,  grantorId: admin1, createdAt: "2024-01-01" },
  { capabilities: "manage_agents",            isGrant: true,  grantorId: admin1, createdAt: "2024-02-01" },
  { capabilities: "write_files",              isGrant: false, grantorId: admin2, createdAt: "2024-03-01" },
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
// Who granted this capability?
const grants = await db.orgGrant.findMany({
  where: {
    actorId: { equalTo: memberId },
    isGrant: { equalTo: true }
  },
  select: {
    grantorId: true,
    capabilities: true,
    createdAt: true
  }
}).execute();
```

## CLI Usage

```bash
# Grant capabilities
constructive public:org-grant create \
  --data.capabilities "$PERMISSION_VALUE" \
  --data.isGrant true \
  --data.actorId $MEMBER_ID \
  --data.entityId $ORG_ID \
  --data.grantorId $ADMIN_ID

# Revoke capabilities
constructive public:org-grant create \
  --data.capabilities "$PERMISSION_VALUE" \
  --data.isGrant false \
  --data.actorId $MEMBER_ID \
  --data.entityId $ORG_ID \
  --data.grantorId $ADMIN_ID
```

## Key Behaviors

- **Append-only** — grants are never modified or deleted; new events override previous state
- **Additive model** — no "deny"; capabilities can only be added (granted) or removed (revoked)
- **Profile-independent** — revoking a direct grant doesn't affect profile-inherited capabilities
- **Audit trail** — full history of who granted/revoked what and when
- **Entity-preserved** — grant records survive entity deletion for compliance
- **Grantor accountability** — every capability change traces back to the admin who made it
