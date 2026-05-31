# Graph Module

SDK-authorable computation graphs provisioned via blueprints with entity scoping.

## Provisioning

Set `has_graphs: true` on an entity type in the blueprint definition:

```json
{
  "entity_types": [{
    "name": "Organization Member",
    "prefix": "org",
    "parent_entity": "app",
    "has_graphs": true
  }]
}
```

## Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| `{prefix}_graphs` | `id`, `entity_id`, `name`, `config` (jsonb), `created_at`, `updated_at` | Graph definitions |
| `{prefix}_graph_executions` | `id`, `graph_id`, `status`, `input` (jsonb), `started_at`, `completed_at` | Execution records |
| `{prefix}_graph_outputs` | `id`, `execution_id`, `name`, `data` (jsonb), `created_at` | Output artifacts |

## Security

All tables are secured with `AuthzEntityMembership` — only members of the entity can access its graphs. RLS is enabled by default.

## ORM Operations

```typescript
// List graphs for an entity
const graphs = await db.orgGraph.findMany({
  where: { entityId: { equalTo: orgId } },
  select: { id: true, name: true, config: true },
}).execute();

// Create execution
const exec = await db.orgGraphExecution.create({
  data: { graphId, status: 'pending', input: { ... } },
  select: { id: true, status: true },
}).execute();

// Record output
await db.orgGraphOutput.create({
  data: { executionId: exec.id, name: 'result', data: { ... } },
  select: { id: true },
}).execute();
```
