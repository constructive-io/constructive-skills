# FBP Integration

The FBP (Flow-Based Programming) toolkit lives in the `constructive-io/fbp` repository. The graph_module in Constructive provides the persistence layer; FBP provides the type system and execution engine.

## FBP Repository Structure

| Package | Purpose |
|---------|---------|
| `fbp-types` | Type system for flow ports, connections, and components |
| `fbp-spec` | Specification language for defining flow graphs |
| `fbp-evaluator` | Execution engine that evaluates flow specifications |
| `fbp-graph-editor` | Visual graph editor React component |

## Integration Pattern

1. **Define flows** using `fbp-spec` types and the visual `fbp-graph-editor`
2. **Store flow definitions** in `{prefix}_graphs.config` via the graph_module
3. **Execute flows** via `fbp-evaluator`, recording results in `{prefix}_graph_executions`
4. **Track outputs** in `{prefix}_graph_outputs` for each execution

## When to Use FBP vs Graph Module Alone

- **Graph module alone** — sufficient for simple workflow tracking (status, input/output)
- **FBP integration** — adds typed ports, component composition, and visual editing for complex data pipelines

## References

For FBP spec details, types, and evaluator API, refer to the `constructive-io/fbp` repository directly. The FBP skill content has moved there.
