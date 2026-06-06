# Profiles

Profiles are reusable permission bundles — named roles like "Editor", "Viewer", or "Manager" that package a set of permissions together. When assigned to a membership, the profile's permissions are added to that member's effective access.

## How Profiles Work

```
Profile "Editor"
  └── includes: invoke_agents, write_files, execute_graphs

Member assigned "Editor" profile
  └── effective permissions = profile permissions ∪ direct grants ∪ defaults
```

- Each profile contains a set of named permissions
- Assigning a profile to a membership adds those permissions to the member's effective access
- A member can have at most **one profile** per scope (but can also have direct grants on top)
- Admins and owners always have full permissions regardless of profile

## Enabling Profiles

Profiles are enabled per entity type. You must explicitly opt in.

### Via Blueprint

```json
{
  "entity_types": [
    {
      "name": "Organization",
      "prefix": "org",
      "hasProfiles": true
    }
  ]
}
```

### Via ORM

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Organization',
    prefix: 'org',
    hasProfiles: true
  },
  select: { id: true }
}).execute();
```

When enabled, the following tables are created (prefixed by scope):

| Table | Purpose |
|-------|---------|
| `{prefix}Profile` | Profile definitions (name, slug, permissions, isDefault, isSystem) |
| `{prefix}ProfilePermission` | Join table linking profiles to named permissions |
| `{prefix}ProfileGrant` | Audit log of profile assignments/unassignments |
| `{prefix}ProfileDefinitionGrant` | Audit log of permission additions/removals from profiles |

## Creating Profiles

```typescript
// Create an "Editor" profile at org scope
await db.orgProfile.create({
  data: {
    name: 'Editor',
    slug: 'editor',
    entityId: orgId,
    permissions: editorPermissionValue  // from permissionsGetMaskByNames
  },
  select: { id: true }
}).execute();

// Create a "Viewer" profile (read-only, fewer permissions)
await db.orgProfile.create({
  data: {
    name: 'Viewer',
    slug: 'viewer',
    entityId: orgId,
    permissions: viewerPermissionValue
  },
  select: { id: true }
}).execute();
```

### Building the Permission Value

```typescript
// Resolve permission names to a value for the profile
const result = await db.query.orgPermissionsGetMaskByNames({
  names: 'invoke_agents,write_files,execute_graphs'
}).execute();
const editorPermissionValue = result.permissions;
```

## Default Profiles

A profile with `isDefault: true` is automatically assigned to new members when they join:

```typescript
await db.orgProfile.create({
  data: {
    name: 'Member',
    slug: 'member',
    entityId: orgId,
    permissions: memberPermissionValue,
    isDefault: true
  },
  select: { id: true }
}).execute();
```

**Constraint:** Only one profile per scope can be the default. Setting a new default requires unsetting the previous one.

```typescript
// Change the default profile
await db.orgProfile.update({
  where: { id: oldDefaultId },
  data: { isDefault: false }
}).execute();

await db.orgProfile.update({
  where: { id: newDefaultId },
  data: { isDefault: true }
}).execute();
```

## System Profiles

Profiles with `isSystem: true` are platform-managed and cannot be deleted or renamed by users:

```typescript
await db.orgProfile.create({
  data: {
    name: 'Admin',
    slug: 'admin',
    entityId: orgId,
    permissions: allPermissionsValue,
    isSystem: true
  },
  select: { id: true }
}).execute();
```

## Assigning Profiles to Members

### Direct Assignment

```typescript
// Assign a profile to a member
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { profileId: editorProfileId }
}).execute();
```

### Via Invite

Email invites can carry a `profileId` that pre-assigns the profile when the invite is claimed:

```typescript
await db.orgInvite.create({
  data: {
    email: 'newuser@example.com',
    senderId: currentUserId,
    entityId: orgId,
    profileId: editorProfileId
  }
}).execute();
```

See [`constructive-entities` → invites.md](../../constructive-entities/references/invites.md) for invite profile assignment modes and permission checks.

### Removing a Profile

```typescript
// Remove profile from a member (they keep only direct grants + defaults)
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { profileId: null }
}).execute();
```

## Listing Profiles

```typescript
// List all profiles for an org
const profiles = await db.orgProfile.findMany({
  where: { entityId: { equalTo: orgId } },
  select: {
    id: true,
    name: true,
    slug: true,
    isDefault: true,
    isSystem: true,
    permissions: true
  }
}).execute();
```

## Profile Permissions (Join Table)

For granular management of which permissions a profile includes:

```typescript
// Add a permission to a profile
await db.orgProfilePermission.create({
  data: {
    profileId: editorProfileId,
    permissionId: writeFilesPermId
  },
  select: { id: true }
}).execute();

// List permissions in a profile
const profilePerms = await db.orgProfilePermission.findMany({
  where: { profileId: { equalTo: editorProfileId } },
  select: { id: true, permissionId: true }
}).execute();
```

## Audit Trail

Profile changes are tracked via append-only audit logs:

### Profile Assignments (ProfileGrants)

```typescript
// View profile assignment history for a member
const history = await db.orgProfileGrant.findMany({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: {
    id: true,
    profileId: true,
    isGrant: true,       // true = assigned, false = unassigned
    grantorId: true,
    createdAt: true
  },
  orderBy: { createdAt: 'DESC' }
}).execute();
```

### Profile Definition Changes (ProfileDefinitionGrants)

```typescript
// View permission changes to a profile definition
const defHistory = await db.orgProfileDefinitionGrant.findMany({
  where: { profileId: { equalTo: editorProfileId } },
  select: {
    id: true,
    permissions: true,
    isGrant: true,       // true = permissions added, false = permissions removed
    grantorId: true,
    createdAt: true
  },
  orderBy: { createdAt: 'DESC' }
}).execute();
```

## Key Behaviors

- **One profile per membership** — a member can only have one profile at a time per scope; switching profiles replaces the previous one
- **Additive with grants** — profile permissions are unioned with direct grants; revoking a profile does not remove direct grants
- **Admin bypass** — admins and owners have all permissions regardless of profile assignment
- **Profile ≠ Role** — profiles are configurable bundles; roles (`isAdmin`, `isOwner`) are structural and not profile-dependent
- **Scope isolation** — profiles in one org don't affect another org; each entity has its own profile set
