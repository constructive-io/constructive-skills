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
- By default a member holds **one profile** per scope (plus direct grants on top)
- With `hasMultipleProfiles: true` a member holds **any number of profiles** at once, and their masks are OR-ed together — see [Multiple Profiles per Member](#multiple-profiles-per-member)
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
      "has_profiles": true
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
| `{prefix}MembershipProfile` | Every profile a membership holds — only when `hasMultipleProfiles: true` |

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

Single-profile scopes assign by writing the pointer; multi-profile scopes go
through `{prefix}ProfileGrant` instead (see
[Multiple Profiles per Member](#multiple-profiles-per-member)).

```typescript
// Assign a profile to a member
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { profileId: editorProfileId }
}).execute();
```

### Via Invite

Email invites can carry a single `profileId` that pre-assigns the profile when the invite is claimed — including on multi-profile scopes, where the claimed profile becomes the first member of the held set and further profiles are granted afterwards:

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
// Single-profile scope: clear the pointer (they keep only direct grants + defaults)
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { profileId: null }
}).execute();
```

## Multiple Profiles per Member

One person often wears two hats in the same scope — the data-room investor who is
also an advisor. Set `hasMultipleProfiles: true` alongside `hasProfiles` on the
entity type and a membership may hold several profiles at once:

```json
{
  "entity_types": [
    {
      "name": "Data Room",
      "prefix": "room",
      "parent_entity": "org",
      "has_profiles": true,
      "has_multiple_profiles": true
    }
  ]
}
```

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room',
    prefix: 'room',
    parentEntity: 'org',
    hasProfiles: true,
    hasMultipleProfiles: true
  },
  select: { id: true }
}).execute();
```

The flag is **opt-in per entity type** and independent of every other scope: org
memberships can stay single-profile while room memberships hold many. It only
takes effect together with `hasProfiles` — on its own it provisions nothing.

### What changes

| | `hasMultipleProfiles: false` (default) | `hasMultipleProfiles: true` |
|---|---|---|
| Assignment | `membership.profileId` **is** the assignment | `{prefix}MembershipProfile` holds every held profile |
| `membership.profileId` | the assignment | a **pointer** at one held profile (display/compatibility) |
| Effective permissions | direct grants ∪ the one profile's mask | direct grants ∪ the **union of every held profile's mask** |
| Granting a second profile | replaces the first | adds to the set |

The held set always contains the pointed-at profile too, so there is one source of
truth: reading `{prefix}MembershipProfile` tells you everything the member holds,
and `profileId` is only the one to show in a UI.

### Assigning and revoking

Assignments go through the same `{prefix}ProfileGrant` audit table as before — it
is the write surface, and the platform applies each row:

```typescript
// Add the Advisor profile to a membership that already holds Investor
await db.roomProfileGrant.create({
  data: { membershipId, profileId: advisorProfileId, isGrant: true },
  select: { id: true }
}).execute();

// Revoke just the Advisor profile; Investor and its permissions remain
await db.roomProfileGrant.create({
  data: { membershipId, profileId: advisorProfileId, isGrant: false },
  select: { id: true }
}).execute();

// Revoke every profile: omit profileId
await db.roomProfileGrant.create({
  data: { membershipId, isGrant: false },
  select: { id: true }
}).execute();
```

Writing `membership.profileId` directly still works and seeds the set with that
profile, so existing single-profile code keeps working after the flag is turned
on.

### Reading what a member holds

```typescript
const held = await db.roomMembershipProfile.findMany({
  where: { membershipId: { equalTo: membershipId } },
  select: { profileId: true, createdAt: true }
}).execute();
```

The assignment set is **read-only to clients** — RLS grants `SELECT` only, and
only to admins of the scope, the same visibility as `{prefix}ProfileGrant`. A
member cannot list their own held profiles; what they *can* always read is their
own effective permissions. Write through `{prefix}ProfileGrant`.

### Composition rules

- **Masks OR together** — holding Investor (`read_financials`) and Advisor
  (`read_legal`) yields both; permissions never conflict, they accumulate
- **Revoking one profile keeps the others** — the mask is recomputed from the
  remaining held profiles plus direct grants
- **The pointer follows the set** — revoking the pointed-at profile repoints
  `profileId` at a remaining one; revoking the last one nulls it
- **Profile edits cascade** — adding a permission to a profile updates every
  membership holding it, whether through the pointer or only through the set
- **Non-permission attributes do not union** — anything a bitmask cannot express
  (a redaction level, a tier) needs its own most-restrictive-wins rule in tenant
  data; the platform composes permissions only

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

- **One profile per membership by default** — switching profiles replaces the previous one, unless the entity type sets `hasMultipleProfiles: true`, where a membership holds a set and the masks union
- **Additive with grants** — profile permissions are unioned with direct grants; revoking a profile does not remove direct grants
- **Admin bypass** — admins and owners have all permissions regardless of profile assignment
- **Profile ≠ Role** — profiles are configurable bundles; roles (`isAdmin`, `isOwner`) are structural and not profile-dependent
- **Scope isolation** — profiles in one org don't affect another org; each entity has its own profile set
