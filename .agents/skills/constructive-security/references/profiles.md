# Profiles

Role-based access control via named permission bundles. Profiles let admins define roles (e.g., Editor, Viewer, Manager) as reusable permission sets that can be assigned to memberships.

## How Profiles Work

- Each profile has a `permissions` bitmask that bundles multiple named permissions
- When a profile is assigned to a membership, its permissions are ORed with the member's direct grants
- **Effective permissions** = `granted` (direct) | `profile.permissions` (from assigned profile)
- Admins and owners always get all permissions regardless of profile

## Enabling Profiles

Profiles are enabled per entity type via `hasProfiles: true` on `entityTypeProvision`. This works at any scope — app-level, org-level, or any custom entity type.

### App-Level Profiles

```typescript
// Enable profiles for the app (all app members can be assigned profiles)
await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'App',
    prefix: 'app',
    hasProfiles: true
  },
  select: { id: true }
}).execute();
```

### Org-Level Profiles

```typescript
// Enable profiles for organizations (org members get org-scoped profiles)
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

### Blueprint Definition

Profiles can also be enabled via the blueprint `entity_types` definition:

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

## Profile Tables (per scope)

When profiles are enabled on an entity type, the following scoped tables are created. Table names are prefixed by scope (e.g., `app_profiles`, `org_profiles`):

| Table | Purpose |
|-------|---------|
| `profiles` | Named permission bundles (`name`, `slug`, `permissions`, `isDefault`, `isSystem`) |
| `profilePermissions` | Join table linking profiles to individual named permissions |
| `profileGrants` | Audit log of profile assignments/unassignments to memberships |
| `profileDefinitionGrants` | Audit log of permission additions/removals from profile definitions |

The `profilesModule` metaschema entry tracks all generated table IDs and names:

```typescript
// Inspect the profiles module for a given scope
const profilesModules = await db.profilesModule.findMany({
  select: {
    id: true,
    tableName: true,
    profilePermissionsTableName: true,
    profileGrantsTableName: true,
    profileDefinitionGrantsTableName: true,
    profileTemplatesTableName: true,
    scope: true,
    prefix: true
  }
}).execute();
```

## Memberships and Permissions

Memberships carry both direct grants and a profile reference:

```typescript
// Read an app membership with its permission state
const membership = await db.appMembership.findOne({
  id: membershipId,
  select: {
    id: true,
    permissions: true,   // effective permissions (granted | profile.permissions)
    granted: true,        // direct grants only
    profileId: true,      // assigned profile (nullable)
    isAdmin: true,
    isOwner: true
  }
}).execute();

// Read an org membership with its permission state
const orgMembership = await db.orgMembership.findOne({
  id: orgMembershipId,
  select: {
    id: true,
    permissions: true,
    granted: true,
    profileId: true,
    isAdmin: true,
    isOwner: true
  }
}).execute();
```

### Org Member Profiles

When profiles are enabled on orgs, each org member can also have a member profile with display information:

```typescript
// Create a member profile for an org member
await db.orgMemberProfile.create({
  data: {
    membershipId: orgMembershipId,
    entityId: orgId,
    actorId: userId,
    displayName: 'Jane Smith',
    email: 'jane@example.com',
    title: 'Engineering Lead',
    bio: 'Full-stack developer',
    profilePicture: avatarUrl
  },
  select: { id: true }
}).execute();
```

## Membership Defaults

Control the initial state of new members (approval, verification) independent of permissions:

```typescript
// Set membership defaults at app scope
await db.appMembershipDefault.create({
  data: {
    isApproved: true,
    isVerified: false
  },
  select: { id: true }
}).execute();

// Set membership defaults for a specific org
await db.orgMembershipDefault.create({
  data: {
    isApproved: true,
    entityId: orgId
  },
  select: { id: true }
}).execute();
```

## Key Behaviors

- **Profile + direct grants** — effective permissions are the union of profile permissions and direct grants; revoking a profile does not remove direct grants
- **Default profiles** — when `isDefault: true` is set on a profile, new memberships are automatically assigned that profile
- **System profiles** — `isSystem: true` profiles are platform-managed and cannot be deleted by users
- **Audit trail** — profile assignments (`profileGrants`) and definition changes (`profileDefinitionGrants`) are append-only logs with `isGrant` boolean for grant/revoke tracking
- **Scoped per entity type** — each entity type with `hasProfiles: true` gets its own independent set of profile tables; org profiles are separate from app profiles
