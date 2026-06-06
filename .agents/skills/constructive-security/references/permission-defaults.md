# Permission Defaults

When modules are installed (via blueprint or entity type provisioning), the platform automatically registers named permissions and sets default access levels for new members. This removes the need to manually configure base permissions for each module.

## What Happens Automatically

1. **Module installed** — e.g., `agent_module` added via blueprint or `entityTypeProvision`
2. **Named permissions registered** — the module's permissions appear in the permissions table (e.g., `invoke_agents`, `manage_agents`)
3. **Defaults applied** — member-facing permissions are enabled by default; admin permissions require explicit grants

## Module Default Permissions

| Module | Granted to All Members | Admin-Only |
|--------|----------------------|------------|
| Agent | `invoke_agents` | `manage_agents` |
| Function | `invoke_functions` | `manage_functions` |
| Graph | `execute_graphs` | `manage_graphs` |
| Storage | `write_files`, `delete_files` | `manage_storage` |
| Events | — | *(all admin-only)* |
| Billing | — | *(all admin-only)* |
| Hierarchy | — | *(all admin-only)* |
| Namespace | — | *(all admin-only)* |
| Notifications | — | *(all admin-only)* |
| Rate Limits | — | *(all admin-only)* |
| Usage | — | *(all admin-only)* |

## ORM Tables

### Permission Definitions

Each scope has a permissions table listing all registered named permissions:

```typescript
// List all registered permissions at app scope
const perms = await db.appPermission.findMany({
  select: { id: true, name: true, bitnum: true, description: true }
}).execute();

// List all registered permissions at org scope
const perms = await db.orgPermission.findMany({
  select: { id: true, name: true, bitnum: true, description: true }
}).execute();
```

### Permission Defaults

The defaults table stores the bitmask applied to new members on join:

```typescript
// Read the current default permissions at app scope
const defaults = await db.appPermissionDefault.findMany({
  select: { id: true, permissions: true }
}).execute();

// Read the current default permissions for a specific org
const defaults = await db.orgPermissionDefault.findMany({
  where: { entityId: orgId },
  select: { id: true, permissions: true }
}).execute();
```

Admins can create or update default permissions:

```typescript
// Set default permissions for the app
await db.appPermissionDefault.create({
  data: { permissions: mask },
  select: { id: true }
}).execute();

// Set default permissions for a specific org
await db.orgPermissionDefault.create({
  data: { permissions: mask, entityId: orgId },
  select: { id: true }
}).execute();

// Update existing defaults
await db.appPermissionDefault.update({
  where: { id: defaultId },
  data: { permissions: newMask },
  select: { id: true }
}).execute();
```

### Grants (Audit Log)

Grants are append-only records of permission changes for individual members:

```typescript
// Grant permissions to a member at app scope
await db.appGrant.create({
  data: {
    permissions: mask,
    isGrant: true,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Revoke permissions
await db.appGrant.create({
  data: {
    permissions: mask,
    isGrant: false,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Org-scope grant (requires entityId)
await db.orgGrant.create({
  data: {
    permissions: mask,
    isGrant: true,
    actorId: memberId,
    entityId: orgId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();
```

### Helper Queries

Convert between permission names and bitmasks:

```typescript
// Get bitmask from permission names
const mask = await db.query.appPermissionsGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();

// Get permission names from bitmask
const perms = await db.query.appPermissionsGetByMask({
  mask: '101'
}).execute();

// Org-scope equivalents
const mask = await db.query.orgPermissionsGetMaskByNames({
  names: 'invoke_agents'
}).execute();
```

## Profiles (Permission Bundles)

Profiles are named permission bundles that can be assigned to memberships as a form of role-based access control. Instead of granting individual permissions, admins create profiles like "Editor", "Viewer", or "Manager" and assign them to members.

### How Profiles Work

- Each profile has a `permissions` bitmask that bundles multiple named permissions
- When a profile is assigned to a membership, its permissions are ORed with the member's direct grants
- **Effective permissions** = `granted` (direct) | `profile.permissions` (from assigned profile)
- Admins and owners always get all permissions regardless of profile

### Profile Tables (per scope)

Profiles are enabled per entity type via `hasProfiles: true` on `entityTypeProvision`. When enabled, the following tables are created:

| Table | Purpose |
|-------|---------|
| `profiles` | Named permission bundles (`name`, `slug`, `permissions`, `isDefault`, `isSystem`) |
| `profilePermissions` | Join table linking profiles to individual named permissions |
| `profileGrants` | Audit log of profile assignments/unassignments to memberships |
| `profileDefinitionGrants` | Audit log of permission additions/removals from profile definitions |

### Membership Defaults

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

### Memberships and Permissions

Memberships carry both direct grants and a profile reference:

```typescript
// Read a membership with its permission state
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
```

## Key Behaviors

- **Automatic on module install** — no SDK calls needed to initialize default permissions; they are set when the module is provisioned
- **Append-only grants** — permission changes are recorded as grant/revoke events, preserving full audit history
- **Profile + direct grants** — effective permissions are the union of profile permissions and direct grants; revoking a profile does not remove direct grants
- **Default profiles** — when `isDefault: true` is set on a profile, new memberships are automatically assigned that profile
- **Audit preservation** — deleting an entity does not destroy its grant history (references are nullified, not cascaded)

## Named Permissions Reference

| Permission | Module | Purpose |
|-----------|--------|---------|
| `manage_agents` | Agent | Admin access to agent infrastructure |
| `invoke_agents` | Agent | Use agent features (threads, messages, tasks) |
| `manage_storage` | Storage | Admin access to storage buckets/files |
| `write_files` | Storage | Upload files |
| `delete_files` | Storage | Delete files |
| `invoke_functions` | Function | Execute registered functions |
| `execute_graphs` | Graph | Run graph executions |
| `manage_secrets` | Config | Manage encrypted secrets |
