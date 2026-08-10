# Capability Defaults

When modules are installed (via blueprint or entity type provisioning), the platform automatically registers named capabilities and sets default access levels for new members. This removes the need to manually configure base capabilities for each module.

## What Happens Automatically

1. **Module installed** — e.g., `agent_module` added via blueprint or `entityTypeProvision`
2. **Named capabilities registered** — the module's capabilities appear in the capabilities table (e.g., `invoke_agents`, `manage_agents`)
3. **Defaults applied** — member-facing capabilities are enabled by default; admin capabilities require explicit grants

## Module Default Capabilities

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

### Capability Definitions

Each scope has a capabilities table listing all registered named capabilities:

```typescript
// List all registered capabilities at app scope
const perms = await db.appCapability.findMany({
  select: { id: true, name: true, description: true }
}).execute();

// List all registered capabilities at org scope
const perms = await db.orgCapability.findMany({
  select: { id: true, name: true, description: true }
}).execute();
```

### Capability Defaults

The defaults table stores the default capabilities applied to new members on join:

```typescript
// Read the current default capabilities at app scope
const defaults = await db.appCapabilityDefault.findMany({
  select: { id: true, capabilities: true }
}).execute();

// Read the current default capabilities for a specific org
const defaults = await db.orgCapabilityDefault.findMany({
  where: { entityId: orgId },
  select: { id: true, capabilities: true }
}).execute();
```

Admins can create or update default capabilities:

```typescript
// Set default capabilities for the app
await db.appCapabilityDefault.create({
  data: { capabilities: capabilityValue },
  select: { id: true }
}).execute();

// Set default capabilities for a specific org
await db.orgCapabilityDefault.create({
  data: { capabilities: capabilityValue, entityId: orgId },
  select: { id: true }
}).execute();

// Update existing defaults
await db.appCapabilityDefault.update({
  where: { id: defaultId },
  data: { capabilities: newCapabilityValue },
  select: { id: true }
}).execute();
```

### Grants (Audit Log)

Grants are append-only records of capability changes for individual members:

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

// Revoke capabilities
await db.appGrant.create({
  data: {
    capabilities: capabilityValue,
    isGrant: false,
    actorId: memberId,
    grantorId: adminId
  },
  select: { id: true }
}).execute();

// Org-scope grant (requires entityId)
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

### Helper Queries

Look up capabilities by name, or resolve a capability value back to names:

```typescript
// Get a capability value from names
const capabilities = await db.query.appCapabilitiesGetMaskByNames({
  names: 'invoke_agents,write_files'
}).execute();

// Get capability names from a value
const perms = await db.query.appCapabilitiesGetByMask({
  mask: '101'
}).execute();

// Org-scope equivalents
const capabilities = await db.query.orgCapabilitiesGetMaskByNames({
  names: 'invoke_agents'
}).execute();
```

## Key Behaviors

- **Automatic on module install** — no SDK calls needed to initialize default capabilities; they are set when the module is provisioned
- **Append-only grants** — capability changes are recorded as grant/revoke events, preserving full audit history
- **Audit preservation** — deleting an entity does not destroy its grant history (references are nullified, not cascaded)

See also: [profiles.md](./profiles.md) for role-based access control via named capability bundles.

## Named Capabilities Reference

| Capability | Module | Purpose |
|-----------|--------|---------|
| `manage_agents` | Agent | Admin access to agent infrastructure |
| `invoke_agents` | Agent | Use agent features (threads, messages, tasks) |
| `manage_storage` | Storage | Admin access to storage buckets/files |
| `write_files` | Storage | Upload files |
| `delete_files` | Storage | Delete files |
| `invoke_functions` | Function | Execute registered functions |
| `execute_graphs` | Graph | Run graph executions |
| `manage_secrets` | Config | Manage encrypted secrets |
