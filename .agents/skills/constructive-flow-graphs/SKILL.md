---
name: constructive-flow-graphs
description: "Graph module and merkle store — SDK-authorable graph infrastructure (graphs, executions, outputs) with entity scoping, content-addressed merkle state tracking (objects, stores, commits, refs), and FBP integration. Use when asked to 'create a graph', 'graph module', 'merkle store', 'content-addressed storage', 'flow-based programming', 'graph executions', 'FBP', or when working with graph_module or merkle_store_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Flow Graphs

Graph module for SDK-authorable computation graphs and merkle store for content-addressed state tracking. Both are provisioned via blueprints with entity scoping.

## When to Apply

Use this skill when:
- Creating computation graphs with executions and outputs (graph_module)
- Tracking content-addressed state with merkle trees (merkle_store_module)
- Building flow-based programming pipelines
- Linking to the FBP (Flow-Based Programming) toolkit

## Graph Module

Set `has_graphs: true` on an entity type to provision graph infrastructure:

### Tables Created

| Table | Purpose |
|-------|---------|
| `{prefix}_graphs` | Graph definitions (name, config, entity-scoped) |
| `{prefix}_graph_executions` | Execution records (status, input, timing) |
| `{prefix}_graph_outputs` | Output artifacts per execution |

### Entity Scoping

Graphs are entity-scoped — each entity (org, team, channel) has its own set of graphs, executions, and outputs. Security is enforced via `AuthzEntityMembership`.

### ORM Usage

```typescript
// Create a graph
await db.orgGraph.create({
  data: { entityId: orgId, name: 'data-pipeline', config: { ... } },
  select: { id: true },
}).execute();

// Create an execution
await db.orgGraphExecution.create({
  data: { graphId, status: 'running', input: { ... } },
  select: { id: true },
}).execute();
```

See [graph-module.md](./references/graph-module.md) for the full reference.

## Merkle Store

Set `has_merkle_store: true` to provision content-addressed state tracking:

### Tables Created

| Table | Purpose |
|-------|---------|
| `{prefix}_objects` | Content-addressed blobs (hash → data) |
| `{prefix}_stores` | Named stores (like git repositories) |
| `{prefix}_commits` | Commit records (parent, tree, message) |
| `{prefix}_refs` | Named references (branches/tags → commits) |

### Content Addressing

Objects are stored by hash — `object_hash_uuid()` computes `uuid_generate_v5(uuid_ns_url(), jsonb::text)`. Duplicate content is stored once.

See [merkle-store.md](./references/merkle-store.md) for the full reference.

## FBP Integration

The FBP (Flow-Based Programming) toolkit lives in the `constructive-io/fbp` repo:
- **fbp-types** — type system for flow ports and connections
- **fbp-spec** — specification language for flow definitions
- **fbp-evaluator** — execution engine for flow specs
- **fbp-graph-editor** — visual graph editor component

The graph_module provides the persistence layer; FBP provides the type system and execution engine.

See [fbp-integration.md](./references/fbp-integration.md) for linking patterns.

## References

| File | Content |
|------|---------|
| [graph-module.md](./references/graph-module.md) | Graphs, executions, outputs, entity-scoping |
| [merkle-store.md](./references/merkle-store.md) | Objects, stores, commits, refs |
| [fbp-integration.md](./references/fbp-integration.md) | Links to fbp repo for spec details |

## Cross-References

- **Entity types (entity scoping):** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Background jobs (graph execution):** [`constructive-jobs`](../constructive-jobs/SKILL.md)
