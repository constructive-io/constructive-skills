# Named Permissions

Permissions are named access rights that control what actions a member can perform within a scope. Each module registers its own permissions when installed, and they compose into a unified permission model per entity type.

## How Permissions Work

1. **Modules register permissions** — when a module is installed (via blueprint or `entityTypeProvision`), it registers named permissions in the scope's permissions table
2. **Members receive permissions** — via defaults (automatic), profiles (bundled), or direct grants (individual)
3. **Enforcement** — RLS policies and application logic check whether the current user has the required permission before allowing an action

## Discovering Permissions

### List All Registered Permissions

```typescript
// App-scope permissions
const appPerms = await db.appPermission.findMany({
  select: { id: true, name: true, description: true }
}).execute();

// Org-scope permissions
const orgPerms = await db.orgPermission.findMany({
  where: { entityId: { equalTo: orgId } },
  select: { id: true, name: true, description: true }
}).execute();

// Custom entity scope (e.g., channel)
const channelPerms = await db.channelPermission.findMany({
  where: { entityId: { equalTo: channelId } },
  select: { id: true, name: true, description: true }
}).execute();
```

### Resolve Permission Names to Values

```typescript
// Get a permission value from names (for use in grants/defaults)
const result = await db.query.appPermissionsGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();
// result.permissions → the permission value to use in grants

// Org-scope equivalent
const result = await db.query.orgPermissionsGetMaskByNames({
  names: 'manage_agents,manage_storage'
}).execute();
```

### Resolve Values Back to Names

```typescript
// Get permission names from a value (for display)
const result = await db.query.appPermissionsGetByMask({
  mask: permissionValue
}).execute();
// result → array of permission name strings
```

## Module-Registered Permissions

Each module declares its named permissions. These are automatically registered when the module is installed:

| Module | Member Permissions | Admin Permissions |
|--------|-------------------|-------------------|
| **Agent** | `invoke_agents` | `manage_agents` |
| **Function** | `invoke_functions` | `manage_functions` |
| **Graph** | `execute_graphs` | `manage_graphs` |
| **Storage** | `write_files`, `delete_files` | `manage_storage` |
| **Events** | — | *(all admin-only)* |
| **Billing** | — | *(all admin-only)* |
| **Hierarchy** | — | *(all admin-only)* |
| **Namespace** | — | *(all admin-only)* |
| **Notifications** | — | *(all admin-only)* |
| **Rate Limits** | — | *(all admin-only)* |
| **Usage** | — | *(all admin-only)* |

**Member permissions** are granted to all members by default on join. **Admin permissions** require explicit grants or admin/owner role.

## Invite-Related Permissions

The invite system registers additional permissions when installed:

| Permission | Description |
|-----------|-------------|
| `create_invites` | Can create invites for other users |
| `admin_invites` | Can view and manage all invites in the scope |
| `send_approved_invites` | Invites from this user auto-approve the new membership |
| `assign_profiles` | Can attach a profile to email invites |

## Permission Categories

Permissions follow a naming convention:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `invoke_*` | Use a feature | `invoke_agents`, `invoke_functions` |
| `manage_*` | Administer a feature | `manage_agents`, `manage_storage` |
| `create_*` | Create new entities | `create_invites`, `create_entity` |
| `admin_*` | Administrative access | `admin_invites`, `admin_members` |
| `write_*` / `delete_*` | Data operations | `write_files`, `delete_files` |
| `execute_*` | Run operations | `execute_graphs` |

## Custom Permissions via Blueprint

You can register custom permissions through the blueprint `entity_types` definition:

```json
{
  "entity_types": [
    {
      "name": "Organization",
      "prefix": "org",
      "modules": [
        ["permissions_module", { "scope": "org" }]
      ]
    }
  ]
}
```

Custom permissions can then be created via the ORM:

```typescript
// Register a custom permission
await db.orgPermission.create({
  data: {
    name: 'approve_documents',
    description: 'Can approve documents for publication',
    entityId: orgId
  },
  select: { id: true }
}).execute();
```

## Permission Enforcement in RLS

When a policy requires a specific permission, it's declared in the blueprint:

```json
{
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": {
        "entity_field": "entity_id",
        "membership_type": 2,
        "permission": "manage_agents"
      },
      "privileges": ["update", "delete"]
    }
  ]
}
```

This creates an RLS policy that only allows UPDATE/DELETE for members who have the `manage_agents` permission.

## Key Behaviors

- **Additive model** — permissions are ORed together; having a permission from any source (profile, grant, default) is sufficient
- **Admin/owner bypass** — admins and owners implicitly have all permissions within their scope
- **Scope isolation** — permissions in one entity do not carry to another; each entity has its own permission space
- **Automatic registration** — modules register their permissions on install; no manual setup needed
- **Name-based API** — always work with permission names in application code; the underlying values are resolved automatically
