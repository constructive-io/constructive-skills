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
  select: { id: true, name: true, description: true }
}).execute();

// List all registered permissions at org scope
const perms = await db.orgPermission.findMany({
  select: { id: true, name: true, description: true }
}).execute();
```

### Permission Defaults

The defaults table stores the default permissions applied to new members on join:

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
  data: { permissions: permissionValue },
  select: { id: true }
}).execute();

// Set default permissions for a specific org
await db.orgPermissionDefault.create({
  data: { permissions: permissionValue, entityId: orgId },
  select: { id: true }
}).execute();

// Update existing defaults
await db.appPermissionDefault.update({
  where: { id: defaultId },
  data: { permissions: newPermissionValue },
  select: { id: true }
}).execute();
```

### Grants (Audit Log)

Grants are append-only records of permission changes for individual members:

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

// Revoke permissions
await db.appGrant.create({
  data: {
    permissions: permissionValue,
    isGrant: false,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Org-scope grant (requires entityId)
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

### Helper Queries

Look up permissions by name, or resolve a permission value back to names:

```typescript
// Get a permission value from names
const permissions = await db.query.appPermissionsGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();

// Get permission names from a value
const perms = await db.query.appPermissionsGetByMask({
  mask: '101'
}).execute();

// Org-scope equivalents
const permissions = await db.query.orgPermissionsGetMaskByNames({
  names: 'invoke_agents'
}).execute();
```

## Key Behaviors

- **Automatic on module install** — no SDK calls needed to initialize default permissions; they are set when the module is provisioned
- **Append-only grants** — permission changes are recorded as grant/revoke events, preserving full audit history
- **Audit preservation** — deleting an entity does not destroy its grant history (references are nullified, not cascaded)

See also: [profiles.md](./profiles.md) for role-based access control via named permission bundles.

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
