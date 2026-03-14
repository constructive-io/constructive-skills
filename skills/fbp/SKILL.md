---
name: fbp
description: "Flow-Based Programming toolkit — TypeScript type definitions and GraphSchemata specification (merkle-friendly, Houdini-inspired), storage specification and immutable graph manipulation API, lazy dataflow graph evaluator, and a React-based Houdini-inspired visual graph editor with SVG canvas. Use when working with FBP type definitions, graph schemata, graph storage, dataflow evaluation, or building visual graph editors."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

## Types (`@fbp/types`)

- TypeScript type definitions for a Houdini-inspired, merkle-friendly graph specification
- Core interfaces: `Graph`, `Node`, `Edge`, `NodeDefinition`, `PortDef`, `PropDef`
- Covers boundary nodes, channels, ports, props-vs-dataflow separation, and validation rules

**Triggers:** "FBP type definitions", "graph schemata", "@fbp/types"

See [types.md](./references/types.md) for details.

## Spec (`@fbp/spec`)

- Two-layer type system (storage and renderer) with a pure, immutable graph manipulation API
- Path-based node identity and per-scope edge storage designed for content-addressable (merkle) persistence
- API for node CRUD, edge operations, property management, metadata, and query helpers

**Triggers:** "FBP graph storage", "manipulating graph data structures", "@fbp/spec"

See [spec.md](./references/spec.md) for details.

## Evaluator (`@fbp/evaluator`)

- Lazy evaluation engine that only computes nodes needed for the requested output
- Supports multi-input ports, boundary nodes (`graphInput`, `graphOutput`, `graphProp`), and external inputs/props
- Node implementations are pure functions receiving inputs and props, returning named outputs

**Triggers:** "evaluating FBP graphs", "running dataflow computations", "@fbp/evaluator"

See [evaluator.md](./references/evaluator.md) for details.

## Graph Editor (`@fbp/graph-editor`)

- React component for visual editing of FBP graphs with an SVG-based canvas (pan, zoom, Bezier edges)
- Selection system, auto-generated properties panel, subgraph navigation, and keyboard shortcuts
- Accepts `graph`, `onChange`, `definitions`, and `readOnly` props; requires Tailwind CSS and React 18+

**Triggers:** "visual graph editor", "building or customizing a graph editor", "@fbp/graph-editor"

See [graph-editor.md](./references/graph-editor.md) for details.
