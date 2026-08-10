# Named Capabilities

Capabilities are named access rights that control what actions a member can perform within a scope. Each module registers its own capabilities when installed, and they compose into a unified capability model per entity type.

> **Naming:** a capability is the single named unit of access, and every table, column, ORM model, and blueprint argument uses that spelling. The word *permission* appears in exactly one place — as a value of the `kind` column (see below).

## Two Kinds of Capability

Every capability row carries a `kind`:

| `kind` | Meaning | Granted by |
|--------|---------|------------|
| `permission` *(default)* | A named access right — "can do X" | Defaults, profiles, direct grants, admin/owner role |
| `level` | A trust-ladder rung — "has reached X" | Earned through recorded events (see [`constructive-events` → trust-ladders.md](../../constructive-events/references/trust-ladders.md)) |

Both kinds live in the same table and the same underlying bit space, so a policy can require a permission, a level, or both, and one check answers all of it. The distinction matters when you build UI: a levels picker must filter to `kind = 'level'` and a capabilities picker to `kind = 'permission'`, or a level becomes grantable as though it were a capability — which would let an operator hand out trust that is supposed to be earned.

## How Capabilities Work

1. **Modules register capabilities** — when a module is installed (via blueprint or `entityTypeProvision`), it registers named capabilities in the scope's capabilities table
2. **Members receive capabilities** — via defaults (automatic), profiles (bundled), or direct grants (individual); `kind = 'level'` capabilities are instead earned through events
3. **Enforcement** — RLS policies and application logic check whether the current user holds the required capability before allowing an action

## Discovering Capabilities

### List All Registered Capabilities

```typescript
// App-scope capabilities
const appCaps = await db.appCapability.findMany({
  select: { id: true, name: true, description: true, kind: true }
}).execute();

// Org-scope capabilities
const orgCaps = await db.orgCapability.findMany({
  where: { entityId: { equalTo: orgId } },
  select: { id: true, name: true, description: true, kind: true }
}).execute();

// Only the grantable ones (exclude earned trust levels)
const grantable = await db.appCapability.findMany({
  where: { kind: { equalTo: 'permission' } },
  select: { id: true, name: true, description: true }
}).execute();
```

Always select `kind` when the result feeds a picker or a grant flow.

### Resolve Capability Names to a Value

```typescript
// Get a capability value from names (for use in grants/defaults)
const appMask = await db.query.appCapabilitiesGetMaskByNames({
  names: ['invoke_agents', 'write_files']
}).execute();

// Org-scope equivalent
const orgMask = await db.query.orgCapabilitiesGetMaskByNames({
  names: ['manage_agents', 'manage_storage']
}).execute();
```

`names` is an array, and unknown names are ignored rather than rejected — a typo silently narrows the result, so validate names against the catalog before relying on the value.

> **Gotcha:** an empty `names` array currently resolves to null rather than to an empty capability value, and a caller that stores the result hits `capabilities bitstring DNE`. Send the field only when at least one name is selected.

### Resolve a Value Back to Names

```typescript
// Get the capability rows contained in a value (for display)
const held = await db.query.appCapabilitiesGetByMask({
  mask: capabilityValue
}).execute();
// held → capability rows (id, name, description, kind, …), one per bit set
```

It returns full rows, not names, so a picker can group or filter the result by `kind` without a second lookup.

Use this whenever you display a stored capability requirement. A saved policy persists the compiled value, not the names it was authored with, so a UI that does not resolve it back will show an empty selection — and re-saving that empty selection would silently drop the requirement.

## Module-Registered Capabilities

Each module declares its named capabilities. These are automatically registered when the module is installed:

| Module | Member Capabilities | Admin Capabilities |
|--------|--------------------|--------------------|
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

**Member capabilities** are granted to all members by default on join. **Admin capabilities** require explicit grants or the admin/owner role.

## Invite-Related Capabilities

The invite system registers additional capabilities when installed:

| Capability | Description |
|-----------|-------------|
| `create_invites` | Can create invites for other users |
| `admin_invites` | Can view and manage all invites in the scope |
| `send_approved_invites` | Invites from this user auto-approve the new membership |
| `assign_profiles` | Can attach a profile to email invites |

## Capability Categories

Capabilities follow a naming convention:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `invoke_*` | Use a feature | `invoke_agents`, `invoke_functions` |
| `manage_*` | Administer a feature | `manage_agents`, `manage_storage` |
| `create_*` | Create new entities | `create_invites`, `create_entity` |
| `admin_*` | Administrative access | `admin_invites`, `admin_members` |
| `write_*` / `delete_*` | Data operations | `write_files`, `delete_files` |
| `execute_*` | Run operations | `execute_graphs` |
| `level.*` | A trust-ladder rung (`kind = 'level'`) | `level.reachable`, `level.accountable` |

The `level.*` rows come from the trust ladder a database was provisioned with — a database that asked for none has no `kind = 'level'` rows at all, and a policy requiring one can never be satisfied. See [`constructive-events` → trust-ladders.md](../../constructive-events/references/trust-ladders.md).

## Custom Capabilities via Blueprint

You can register custom capabilities through the blueprint `entity_types` definition:

```json
{
  "entity_types": [
    {
      "name": "Organization",
      "prefix": "org",
      "modules": [
        ["capabilities_module", { "scope": "org" }]
      ]
    }
  ]
}
```

Custom capabilities can then be created via the ORM:

```typescript
// Register a custom capability
await db.orgCapability.create({
  data: {
    name: 'approve_documents',
    description: 'Can approve documents for publication',
    kind: 'permission',
    entityId: orgId
  },
  select: { id: true }
}).execute();
```

## Capability Enforcement in RLS

When a policy requires specific capabilities, they are declared in the blueprint. Both arguments are arrays, and a policy may use either or both:

```json
{
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": {
        "entity_field": "entity_id",
        "membership_type": 2,
        "capabilities": ["manage_agents"],
        "levels": ["level.reachable"]
      },
      "privileges": ["update", "delete"]
    }
  ]
}
```

This creates an RLS policy that allows UPDATE/DELETE only for members who hold `manage_agents` **and** have reached `level.reachable`. Omitting both arguments means "any member of the entity" — membership itself is still required.

## Key Behaviors

- **Additive model** — capabilities are combined; holding one from any source (profile, grant, default, earned level) is sufficient
- **Admin/owner bypass** — admins and owners implicitly hold *every* capability in their scope, including `kind = 'level'` ones. See [admin-owner-member.md](./admin-owner-member.md#owner-and-admin-hold-every-capability) — this is permanent and cannot be narrowed within the entity
- **Scope isolation** — capabilities in one entity do not carry to another; each entity has its own capability space, and the same name may occupy different underlying positions in different entities
- **Automatic registration** — modules register their capabilities on install; no manual setup needed
- **Name-based API** — always work with capability names in application code; the underlying values are resolved automatically
- **Levels are earned, not granted** — do not offer `kind = 'level'` rows in a grant or profile picker
