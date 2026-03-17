# pgvector Adapter

Semantic similarity search using the `pgvector` extension. Supports cosine, L2, and inner product distance metrics for embedding-based search and RAG.

## How It Works

The pgvector adapter:
1. **Detects** `vector(N)` columns on tables (via `VectorCodecPlugin` codec registration)
2. **Registers** `VectorSearchInput` type (`{ query: [Float!]!, metric: VectorMetric }`)
3. **Generates** distance score as a computed field and orderBy enum

## Adapter Configuration

```typescript
import { createPgvectorAdapter } from 'graphile-search';

createPgvectorAdapter({
  filterPrefix: 'vector',        // default: 'vector'
  defaultMetric: 'COSINE',       // default: 'COSINE' (COSINE | L2 | IP)
})
```

## Generated GraphQL

Given a table with an `embedding vector(768)` column:

### Filter

```graphql
query {
  allDocuments(filter: {
    vectorEmbedding: { query: [0.1, 0.2, ...], metric: COSINE }
  }) {
    nodes {
      title
      embeddingVectorDistance
    }
  }
}
```

### Score Field

```graphql
type Document {
  embeddingVectorDistance: Float  # distance score, lower = more similar
}
```

### OrderBy

```graphql
enum DocumentsOrderBy {
  EMBEDDING_VECTOR_DISTANCE_ASC   # most similar first
  EMBEDDING_VECTOR_DISTANCE_DESC  # least similar first
}
```

## Distance Metrics

| Metric | Operator | Range | Notes |
|--------|----------|-------|-------|
| `COSINE` | `<=>` | 0-2 | 0 = identical; best for normalized embeddings |
| `L2` | `<->` | 0-inf | Euclidean distance |
| `IP` | `<#>` | -inf to 0 | Negative inner product; less negative = more similar |

## Score Semantics

| Property | Value |
|----------|-------|
| Metric | `distance` |
| Lower is better | Yes (closer = more similar) |
| Range | Unbounded (uses sigmoid normalization in searchScore) |

## Adapter Flags

| Flag | Value |
|------|-------|
| `isSupplementary` | `false` (primary adapter) |
| `isIntentionalSearch` | `false` (embeddings do NOT trigger trgm) |
| `supportsTextSearch` | `false` (not included in fullTextSearch composite) |

pgvector is the only primary adapter that sets `isIntentionalSearch: false`. This is because vector embeddings operate on a different domain than text search — a table with only pgvector columns shouldn't get trgm similarity fields on its text columns.

## VectorCodecPlugin

The `VectorCodecPlugin` (included in `UnifiedSearchPreset`) teaches PostGraphile about the `vector` PostgreSQL type:

- **Wire format:** PostgreSQL sends vectors as text `[0.1,0.2,...,0.768]`
- **JavaScript:** `number[]`
- **GraphQL scalar:** `Vector` (serialized as `[Float]`)

Without this plugin, PostGraphile silently ignores `vector(N)` columns.

## Codegen — Vector Scalar Mapping

When generating typed SDK code, the `Vector` scalar maps to `number[]`:

```typescript
// graphql-codegen.config.ts
scalars: {
  Vector: 'number[]',
}
```

With `@constructive-io/graphql-codegen >= 4.6.0`, this mapping is built-in.

## Prerequisites

- `pgvector` extension enabled (pre-enabled in Constructive stack)
- A `vector(N)` column on the table
- An HNSW or IVFFlat index for performance (`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`)
- `VectorCodecPlugin` loaded (included automatically by `UnifiedSearchPreset`)
