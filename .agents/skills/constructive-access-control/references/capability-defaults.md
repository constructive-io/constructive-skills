# Capability Defaults

When modules are installed, the platform automatically registers named capabilities and sets default access levels. New members receive these defaults on join — no manual configuration needed for base-level access.

## How Defaults Work

```
Module Installed (e.g., agent_module)
  ├── 1. Registers named capabilities (invoke_agents, manage_agents)
  ├── 2. Sets default capabilities (invoke_agents → all members)
  └── 3. New members automatically receive the default on join
```

This three-step process is fully automatic. You only need to intervene when you want to override the defaults for your specific app or entity.

## What Members Get Automatically

When a user joins (via sign-up, invite, or direct membership creation), they receive:

1. **Module defaults** — base capabilities from all installed modules
2. **Capability defaults** — any custom defaults configured by an admin
3. **Default profile** — if a profile with `isDefault: true` exists, it's assigned automatically

These are additive — the effective initial access is the union of all three sources.

## Module Default Capabilities

Each module declares what capabilities members should get out of the box:

| Module | Granted to All Members | Admin-Only |
|--------|----------------------|------------|
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

"Granted to All Members" means these capabilities are included in the default capability value automatically. "Admin-Only" means only admin/owner roles have these — they're registered but not included in defaults.

## Reading Current Defaults

```typescript
// Read app-level defaults
const defaults = await db.appCapabilityDefault.findMany({
  select: { id: true, capabilities: true }
}).execute();

// Read org-level defaults (per entity)
const orgDefaults = await db.orgCapabilityDefault.findMany({
  where: { entityId: { equalTo: orgId } },
  select: { id: true, capabilities: true }
}).execute();
```

## Overriding Defaults

Admins can customize what capabilities new members receive. This overrides the module-level defaults:

### Setting Custom Defaults

```typescript
// Set custom defaults for the app (all new app members get these)
await db.appCapabilityDefault.create({
  data: { capabilities: customCapabilityValue },
  select: { id: true }
}).execute();

// Set custom defaults for a specific org
await db.orgCapabilityDefault.create({
  data: {
    capabilities: customCapabilityValue,
    entityId: orgId
  },
  select: { id: true }
}).execute();
```

### Updating Existing Defaults

```typescript
await db.appCapabilityDefault.update({
  where: { id: defaultId },
  data: { capabilities: newCapabilityValue },
  select: { id: true }
}).execute();
```

### Building the Capability Value

```typescript
// Resolve desired capability names to a value
const result = await db.query.appCapabilitiesGetMaskByNames({
  names: 'invoke_agents,write_files,execute_graphs'
}).execute();
const customCapabilityValue = result.capabilities;
```

## Default Grants (Audit Trail)

Changes to capability defaults are tracked:

```typescript
// View history of default capability changes
const defaultGrants = await db.appCapabilityDefaultGrant.findMany({
  select: {
    id: true,
    capabilities: true,
    isGrant: true,       // true = capabilities added to default, false = removed
    grantorId: true,
    createdAt: true
  },
  orderBy: { createdAt: 'DESC' }
}).execute();
```

## Interaction with Profiles

Capability defaults and profiles are independent but additive:

| Source | When Applied | Scope |
|--------|-------------|-------|
| Module defaults | On module install | Automatic for all new members |
| Capability defaults | On member join | Per-entity (app/org/custom) |
| Default profile | On member join (if `isDefault: true` profile exists) | Per-entity |

If all three exist, the new member's initial capabilities = `module defaults ∪ capability defaults ∪ default profile capabilities`.

## Entity-Level vs App-Level

- **App-level defaults** apply to all new app members regardless of organization
- **Org-level defaults** apply only to new members of that specific organization
- **Custom entity defaults** apply only to new members of that specific entity

Org-level defaults override app-level defaults for org memberships — they don't add on top. Each scope manages its own defaults independently.

## Key Behaviors

- **Automatic on module install** — module defaults are applied without any SDK calls
- **Applied at join time** — defaults are resolved when the membership is created, not retroactively
- **Independent of profiles** — defaults and profiles are separate systems that compose additively
- **Per-entity customization** — each organization (or custom entity) can have its own defaults
- **Audit preserved** — all changes to defaults are tracked in the grants audit log
