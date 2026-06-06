# Org Hierarchy

The hierarchy system provides organizational chart (org chart) capabilities — manager/subordinate relationships within an entity (org, team, etc.) that can drive access control via the `AuthzOrgHierarchy` policy. It's an optional module installed per entity type (typically at org scope via the `b2b` preset).

## Concepts

| Concept | Description |
|---------|-------------|
| **Hierarchy Module** | Per-entity-type module that provisions the chart edges, grants, and traversal functions |
| **Chart Edges** | Direct parent→child relationships in the org chart (one level) |
| **Chart Edge Grants** | Append-only audit log of hierarchy changes (who added/removed whom, and when) |
| **Closure Table** | Pre-computed transitive relationships — if A manages B and B manages C, the closure table stores A→C (enables $O(1)$ lookups for "all subordinates of X") |
| **Direction** | Access direction: `down` = managers see subordinate data; `up` = subordinates see manager data |
| **Rebuild** | After hierarchy changes, the closure table is rebuilt to reflect the new transitive paths |

## When to Use

- **Reporting structures** — managers can view direct reports' documents, timesheets, reviews
- **Cascading visibility** — directors see everything their entire sub-tree produces
- **Approval chains** — route approvals up the hierarchy
- **Scoped dashboards** — show aggregated metrics for the current user's sub-tree

## Enabling the Hierarchy

The hierarchy module is installed per entity type. It's included automatically in the **`b2b` preset**:

```typescript
// The b2b preset includes hierarchy at org scope
['hierarchy_module', { scope: 'org' }]
```

Or install it directly via the modules API:

```typescript
await db.query.installModule({
  input: {
    databaseId: dbId,
    moduleName: 'hierarchy_module',
    scope: 'org'
  }
}).execute();
```

## Building the Org Chart

Hierarchy relationships are managed through the **chart edge grants** table — an append-only audit log (same pattern as admin/owner grants). Each record places a user under a parent in the org chart.

### Adding a User to the Hierarchy

```typescript
// Place a user under a manager in an org
await db.orgChartEdgeGrant.create({
  data: {
    entityId: orgId,         // which org
    childId: employeeId,     // user being placed
    parentId: managerId,     // their manager (null = top of chart)
    grantorId: currentUserId, // who made this change
    isGrant: true            // true = add, false = remove
  },
  select: { id: true }
}).execute();
```

```bash
# CLI equivalent
constructive public:org-chart-edge-grant create \
  --data.entityId $ORG_ID \
  --data.childId $EMPLOYEE_ID \
  --data.parentId $MANAGER_ID \
  --data.grantorId $CURRENT_USER_ID \
  --data.isGrant true
```

### Top-Level Users (No Manager)

Users at the top of the hierarchy have `parentId: null`:

```typescript
// CEO / top-level — no parent
await db.orgChartEdgeGrant.create({
  data: {
    entityId: orgId,
    childId: ceoId,
    parentId: null,           // top of chart
    grantorId: currentUserId,
    isGrant: true
  },
  select: { id: true }
}).execute();
```

### Removing from Hierarchy

Insert a record with `isGrant: false` to remove a user from the chart:

```typescript
await db.orgChartEdgeGrant.create({
  data: {
    entityId: orgId,
    childId: employeeId,
    parentId: managerId,
    grantorId: currentUserId,
    isGrant: false  // revoke the edge
  },
  select: { id: true }
}).execute();
```

### Example: Building an Org Chart

```typescript
// Build a simple hierarchy:
//   CEO
//   ├── VP Engineering
//   │   ├── Team Lead
//   │   │   ├── Developer 1
//   │   │   └── Developer 2
//   │   └── Manager 2
//   └── VP Sales

const edges = [
  { child: ceoId,       parent: null },
  { child: vpEngId,     parent: ceoId },
  { child: vpSalesId,   parent: ceoId },
  { child: teamLeadId,  parent: vpEngId },
  { child: manager2Id,  parent: vpEngId },
  { child: dev1Id,      parent: teamLeadId },
  { child: dev2Id,      parent: teamLeadId },
];

for (const edge of edges) {
  await db.orgChartEdgeGrant.create({
    data: {
      entityId: orgId,
      childId: edge.child,
      parentId: edge.parent,
      grantorId: adminUserId,
      isGrant: true
    },
    select: { id: true }
  }).execute();
}
```

## AuthzOrgHierarchy Policy

The `AuthzOrgHierarchy` RLS policy enforces visibility based on hierarchy position. Attach it to any table to restrict row access based on manager/subordinate relationships.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `direction` | `'up' \| 'down'` | Yes | `down` = managers see subordinate rows; `up` = subordinates see manager rows |
| `anchor_field` | column ref | Yes | Field on the table that identifies the row's owner (e.g., `owner_id`) |
| `entity_field` | column ref | No | Field referencing the entity (defaults to `entity_id`) |
| `max_depth` | integer | No | Limit visibility to N levels deep in the hierarchy |

### Direction: `down` (Most Common)

Managers can see rows created by their subordinates (at any depth in their sub-tree):

```jsonc
// Blueprint node: managers see subordinate projects
{
  "$type": "AuthzOrgHierarchy",
  "data": {
    "direction": "down",
    "anchor_field": "owner_id",
    "entity_field": "entity_id"
  }
}
```

**Access pattern:**
- CEO sees all projects in the org
- VP sees projects from their managers and developers
- Team Lead sees projects from their direct reports
- Developer sees only their own projects (no subordinates)

### Direction: `up`

Subordinates can see rows owned by their managers (useful for published guidance, announcements):

```jsonc
{
  "$type": "AuthzOrgHierarchy",
  "data": {
    "direction": "up",
    "anchor_field": "owner_id",
    "entity_field": "entity_id"
  }
}
```

### Max Depth

Limit visibility to a fixed number of levels:

```jsonc
// Only direct manager can see (1 level up)
{
  "$type": "AuthzOrgHierarchy",
  "data": {
    "direction": "down",
    "anchor_field": "owner_id",
    "max_depth": 1
  }
}
```

### Composing with Other Policies

`AuthzOrgHierarchy` is typically combined with `AuthzDirectOwner` (so users always see their own rows) and scoped to an entity:

```jsonc
// Full pattern: own rows + hierarchy visibility
{
  "nodes": [
    {
      "$type": "AuthzOrgHierarchy",
      "operations": ["select"],
      "data": {
        "direction": "down",
        "anchor_field": "owner_id",
        "entity_field": "entity_id"
      }
    },
    {
      "$type": "AuthzDirectOwner",
      "operations": ["select", "update", "delete"],
      "data": { "entity_field": "owner_id" }
    },
    {
      "$type": "AuthzAllowAll",
      "operations": ["insert"]
    }
  ]
}
```

## Entity Isolation

The hierarchy is **entity-scoped** — each org has its own independent hierarchy. Users in Org A cannot see data from Org B through hierarchy traversal, even if they share the same hierarchy structure.

```
Org A:                          Org B:
  CEO-A                           CEO-B
  └── Manager-A                   └── Manager-B
      └── Dev-A                       └── Dev-B

Dev-A's data is invisible to CEO-B (different entity_id)
```

## Membership Lifecycle Integration

The hierarchy integrates with membership lifecycle:

- **Adding to hierarchy** — a user must be an active member of the entity before they can be placed in its hierarchy
- **Removing from hierarchy** — removing a user's hierarchy edge immediately revokes any hierarchy-derived visibility
- **Deactivating membership** — removing a member from the org also removes their hierarchy-derived access (the closure table reflects active relationships only)

## Hierarchy Module Resources

When provisioned, the hierarchy module creates these resources per entity type:

| Resource | Purpose |
|----------|---------|
| Chart Edges Table | Stores direct parent→child relationships |
| Chart Edge Grants Table | Append-only audit log of hierarchy changes |
| Closure Table | Pre-computed transitive ancestor/descendant paths |
| `rebuildHierarchy()` | Rebuilds the closure table after edge changes |
| `getSubordinates(entityId, userId)` | Returns all subordinate user IDs |
| `getManagers(entityId, userId)` | Returns all manager user IDs (up the chain) |
| `isManagerOf(entityId, managerId, subordinateId)` | Boolean check for a specific relationship |

## Presets That Include Hierarchy

| Preset | Hierarchy Scope | Description |
|--------|----------------|-------------|
| `b2b` | org | Full B2B SaaS with nested org structures |

Other presets (`auth:email`, `auth:hardened`) do not include hierarchy — it's an opt-in module for apps that need organizational chart capabilities.
