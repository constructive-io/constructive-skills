---
name: graphile-search
description: PostGraphile v5 search plugins for the Constructive GraphQL API. Covers graphile-search-plugin (tsvector FTS), graphile-pg-textsearch-plugin (BM25), and graphile-pgvector-plugin (vector similarity). Use when querying search via GraphQL, configuring search plugins, or building new search plugins.
compatibility: PostGraphile v5, Constructive GraphQL server
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Graphile Search Plugins

Three PostGraphile v5 search plugins expose database search capabilities through the GraphQL API. All are included in `ConstructivePreset` and work automatically — they discover columns/indexes at startup and add the appropriate GraphQL fields.

## Plugin Overview

| Plugin | Package | Discovers | Condition Field | Score/Distance Field | OrderBy |
|--------|---------|-----------|-----------------|---------------------|---------|
| **PgSearchPlugin** | `graphile-search-plugin` | `tsvector` columns | `fullText<Column>: String` | `<column>Rank: Float` | `<COLUMN>_RANK_ASC/DESC` |
| **Bm25SearchPlugin** | `graphile-pg-textsearch-plugin` | Text columns with BM25 indexes | `bm25<Column>: Bm25SearchInput` | `bm25<Column>Score: Float` | `BM25_<COLUMN>_SCORE_ASC/DESC` |
| **VectorSearchPlugin** | `graphile-pgvector-plugin` | `vector` columns | `vector<Column>: VectorNearbyInput` | `<column>Distance: Float` | `<COLUMN>_DISTANCE_ASC/DESC` |

All three follow the same architectural pattern and provide the same three extension points: condition fields on connection inputs, computed score/distance fields on output types, and orderBy enum values.

## ConstructivePreset Integration

All search plugins are bundled into the `ConstructivePreset` (`graphile/graphile-settings/src/presets/constructive-preset.ts`):

```typescript
import { PgSearchPreset } from 'graphile-search-plugin';
import { VectorCodecPreset, createVectorSearchPlugin } from 'graphile-pgvector-plugin';
import { Bm25SearchPreset } from 'graphile-pg-textsearch-plugin';

export const ConstructivePreset: GraphileConfig.Preset = {
  extends: [
    // ... other presets ...
    PgSearchPreset({ pgSearchPrefix: 'fullText' }),  // tsvector FTS
    VectorCodecPreset,                                // vector type codec
    { plugins: [createVectorSearchPlugin()] },        // vector search
    Bm25SearchPreset(),                               // BM25 search
    // ... other presets ...
  ],
};
```

**Zero configuration**: If the database has tsvector columns, BM25-indexed text columns, or vector columns, the corresponding GraphQL fields appear automatically.

## Plugin Configuration

### TSVector (PgSearchPreset)

```typescript
PgSearchPreset({
  pgSearchPrefix: 'fullText',    // Condition field prefix (default: 'tsv')
  fullTextScalarName: 'FullText', // Scalar name for filter operator
  tsConfig: 'english',           // PostgreSQL text search config
})
```

### BM25 (Bm25SearchPreset)

```typescript
Bm25SearchPreset({
  conditionPrefix: 'bm25',  // Condition field prefix (default: 'bm25')
})
```

### pgvector (createVectorSearchPlugin)

```typescript
createVectorSearchPlugin({
  defaultMetric: 'COSINE',    // Default: COSINE. Options: COSINE, L2, IP
  maxLimit: 100,               // Max results per query
  conditionPrefix: 'vector',   // Condition field prefix
})
```

## Reference Files

Detailed query patterns and architecture:

- `references/query-patterns.md` — GraphQL query examples for all three plugins
- `references/architecture.md` — WeakMap bridge pattern, plugin hooks, how to build a new search plugin

## Source File Locations

| Package | Directory |
|---------|----------|
| graphile-search-plugin | `graphile/graphile-search-plugin/src/` |
| graphile-pg-textsearch-plugin | `graphile/graphile-pg-textsearch-plugin/src/` |
| graphile-pgvector-plugin | `graphile/graphile-pgvector-plugin/src/` |
| graphile-settings (preset) | `graphile/graphile-settings/src/presets/constructive-preset.ts` |

## Related Skills

- `constructive-db-search` (constructive-private-skills) — SQL-level search strategies and metaschema integration
- `graphile-pgvector` (constructive-skills) — VectorCodecPlugin, postgraphile-plugin-pgvector (root-level search fields), codegen scalar mapping, integration tests
- `pgvector-rag` (constructive-skills) — Full RAG pipeline with embeddings
- `constructive-graphql-codegen` (constructive-skills) — SDK generation from GraphQL schema
