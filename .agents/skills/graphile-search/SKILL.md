---
name: graphile-search
description: Unified PostGraphile v5 search plugin (graphile-search). Consolidates tsvector, BM25, pg_trgm, and pgvector into a single adapter-based architecture with composite searchScore and unifiedSearch fields. Includes codegen SDK query patterns, chunk-aware search (@hasChunks), recency boost (@searchConfig), cross-table PostGIS spatial relations (@spatialRelation), and DataCompositeField embedding text concatenation. Use when asked to "add search to GraphQL", "expose search in PostGraphile", "configure search adapters", "query search via SDK/codegen", "chunk-aware search", "recency boost", "spatial relations", or when building search features on a Constructive or PostGraphile v5 stack.
compatibility: PostGraphile v5, graphile-search, graphile-build-pg, graphile-connection-filter
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Graphile Search — Unified Search Plugin

A single PostGraphile v5 plugin that consolidates tsvector full-text search, BM25 ranked search, pg_trgm fuzzy matching, and pgvector similarity search behind a pluggable adapter architecture.

**Package:** `graphile-search` ([npm](https://www.npmjs.com/package/graphile-search))

## When to Apply

Use this skill when:
- Adding search capabilities to a PostGraphile v5 / Constructive GraphQL API
- Configuring which search adapters are active
- Understanding how search fields, filters, and scores appear in the GraphQL schema
- Querying search-enabled tables via the generated SDK (after codegen)
- Debugging missing search fields or unexpected trgm behavior
- Building hybrid search combining multiple algorithms

## Architecture Overview

Instead of separate plugins per algorithm, `graphile-search` uses a single `UnifiedSearchPlugin` with pluggable **adapters**:

```
UnifiedSearchPlugin
  ├── TsvectorAdapter     (keyword search with stemming)
  ├── Bm25Adapter         (relevance-ranked document search)
  ├── TrgmAdapter         (fuzzy matching, typo tolerance)
  └── PgvectorAdapter     (semantic/embedding similarity + chunk-aware RAG)
```

The pgvector adapter also supports **chunk-aware search** via the `@hasChunks` smart tag — transparently querying across parent and chunk embeddings and returning the minimum distance. See `references/pgvector-adapter.md` for details.

Each adapter implements the `SearchAdapter` interface:
- **`detectColumns()`** — finds searchable columns on a table (e.g. tsvector columns, columns with BM25 indexes)
- **`registerTypes()`** — registers any custom GraphQL types (e.g. filter input types)
- **`applyFilter()`** — generates the SQL WHERE clause when a filter is used
- **`scoreSemantics`** — declares metric name, direction, and range bounds for score normalization

The plugin also ships codec plugins that teach PostGraphile about custom types: `TsvectorCodecPlugin`, `Bm25CodecPlugin`, `VectorCodecPlugin`.

## Quick Start

```typescript
import { UnifiedSearchPreset } from 'graphile-search';

const preset: GraphileConfig.Preset = {
  extends: [
    // ... your other presets
    UnifiedSearchPreset(),  // all 4 adapters enabled by default
  ],
};
```

This single preset includes:
- All 4 adapter plugins (tsvector, BM25, trgm, pgvector)
- Codec plugins (TsvectorCodecPlugin, Bm25CodecPlugin, VectorCodecPlugin)
- Connection filter operator factories (matches, similarTo, wordSimilarTo)
- Composite `searchScore` and `unifiedSearch` fields

## Preset Options

```typescript
UnifiedSearchPreset({
  // Enable/disable individual adapters (all default to true)
  tsvector: true,                    // or { filterPrefix: 'fullText', tsConfig: 'english' }
  bm25: true,                       // or { filterPrefix: 'bm25' }
  trgm: true,                       // or { defaultThreshold: 0.2, filterPrefix: 'trgm' }
  pgvector: true,                   // or { defaultMetric: 'L2', filterPrefix: 'vector' }

  // Composite fields
  enableSearchScore: true,           // expose searchScore (0..1) on search-enabled tables
  enableUnifiedSearch: true,          // expose unifiedSearch composite filter

  // Weights for composite searchScore
  searchScoreWeights: {
    tsv: 0.3,
    bm25: 0.4,
    trgm: 0.2,
    vector: 0.1,
  },

  // Scalar naming
  fullTextScalarName: 'FullText',    // GraphQL scalar name for tsvector columns
  tsConfig: 'english',              // PostgreSQL text search configuration
})
```

## What Gets Generated in GraphQL

When the plugin detects search infrastructure on a table, it adds:

### Per-Adapter Score Fields (on row types)

| Adapter | Example Field | Type | Description |
|---------|--------------|------|-------------|
| tsvector | `searchTsvRank` | `Float` | ts_rank score (0..1, higher = better) |
| BM25 | `bodyBm25Score` | `Float` | BM25 relevance score (negative, more negative = better) |
| trgm | `titleTrgmSimilarity` | `Float` | Trigram similarity (0..1, higher = better) |
| pgvector | `embeddingVectorDistance` | `Float` | Vector distance (0..inf, lower = closer) |

**Naming pattern:** `{camelCase(column)}{Algorithm}{Metric}`

### Composite searchScore Field

```graphql
type Article {
  # ... regular fields
  searchScore: Float  # Normalized 0..1, higher = more relevant
}
```

Computed by normalizing all active search signals to 0..1 and averaging them. Returns `null` when no search filters are active.

### Per-Adapter Filter Fields (on connection filters)

| Adapter | Filter Field | Input Type |
|---------|-------------|------------|
| tsvector | `fullTextSearchTsv` | `String` (search query) |
| BM25 | `bm25Body` | `Bm25SearchInput` (`{ query, indexName }`) |
| trgm | `trgmTitle` | `TrgmSearchInput` (`{ value, threshold? }`) |
| pgvector | `vectorEmbedding` | `VectorSearchInput` (`{ query: [Float!]!, metric? }`) |

**Naming pattern:** `{filterPrefix}{CamelCase(column)}`

### unifiedSearch Composite Filter

Fans out a single text query to all text-compatible adapters (tsvector, BM25, trgm) simultaneously, combining with OR:

```graphql
query {
  allArticles(where: { unifiedSearch: "postgres tutorial" }) {
    nodes {
      title
      searchScore  # composite relevance across all text search signals
    }
  }
}
```

### OrderBy Enum Values

Each adapter adds ASC/DESC ordering for its score metric:

```graphql
enum ArticlesOrderBy {
  SEARCH_TSV_RANK_ASC
  SEARCH_TSV_RANK_DESC
  BODY_BM25_SCORE_ASC
  BODY_BM25_SCORE_DESC
  # ... etc
}
```

### StringTrgmFilter Type

For tables that qualify for trgm (see "Trgm Scoping" below), string columns get a `StringTrgmFilter` type instead of the regular `StringFilter`. This adds two operators:

```graphql
input StringTrgmFilter {
  # ... all standard StringFilter operators (equalTo, includes, etc.)
  similarTo: TrgmSearchInput       # pg_trgm similarity()
  wordSimilarTo: TrgmSearchInput   # pg_trgm word_similarity()
}

input TrgmSearchInput {
  value: String!
  threshold: Float  # default 0.3
}
```

## Trgm Scoping — Supplementary Adapter Pattern

Trgm doesn't activate on every table with text columns. It uses a **supplementary adapter** pattern:

1. **Primary adapters** (tsvector, BM25, pgvector) run first and detect columns on each table
2. **Supplementary adapters** (trgm) only run if at least one adapter with `isIntentionalSearch: true` found columns on that table
3. pgvector sets `isIntentionalSearch: false` — embeddings alone don't trigger trgm
4. Only tsvector and BM25 count as "intentional search" and trigger trgm activation

This means:
- Table with tsvector column → trgm activates on its text columns
- Table with BM25 index → trgm activates on its text columns
- Table with only pgvector → trgm does NOT activate
- Table with no search infrastructure → trgm does NOT activate

### Opt-in via @trgmSearch Smart Tag

To force trgm on a table that has no intentional search (or only pgvector), use the `@trgmSearch` smart tag:

```sql
-- Table-level: enable trgm on all text columns
COMMENT ON TABLE app_public.contacts IS E'@trgmSearch';

-- Column-level: enable trgm on specific columns
COMMENT ON COLUMN app_public.contacts.name IS E'@trgmSearch';
```

## Adapter Details

Each adapter is documented in its own reference file:

- `references/tsvector-adapter.md` — tsvector full-text search adapter
- `references/bm25-adapter.md` — BM25 ranked search adapter
- `references/trgm-adapter.md` — pg_trgm fuzzy matching adapter
- `references/pgvector-adapter.md` — pgvector similarity search adapter
- `references/search-adapter-interface.md` — SearchAdapter interface specification

## Querying Search via Codegen SDK

After running `cnc codegen`, the generated SDK client exposes search filters, score fields, and orderBy enums. See `references/codegen-sdk-queries.md` for complete query patterns covering:

- **Composite fields** — `unifiedSearch` (multi-strategy filter) and `searchScore` (0..1 relevance)
- **TSVector queries** — `fullTextSearchTsv`, `searchTsvRank`, pagination, combined filters
- **BM25 queries** — `bm25Content`, `bm25ContentScore` (negative, sort ASC)
- **Trigram queries** — `similarTo`/`wordSimilarTo` via `StringTrgmFilter`, adapter-level `trgmTitle`, ILIKE
- **pgvector queries** — `vectorEmbedding`, `embeddingDistance`, distance metrics (COSINE/L2/IP)
- **Chunk-aware search** — `includeChunks` toggle for RAG tables with `@hasChunks`, transparent parent + chunk distance
- **Multi-strategy patterns** — fuzzy fallback, autocomplete pipeline, semantic + keyword hybrid

## Score Semantics

Each adapter declares how its scores behave for normalization in `searchScore`:

| Adapter | Metric | Lower is Better? | Range |
|---------|--------|-------------------|-------|
| tsvector | `rank` | No (higher = better) | [0, 1] |
| BM25 | `score` | Yes (more negative = better) | Unbounded |
| trgm | `similarity` | No (higher = better) | [0, 1] |
| pgvector | `distance` | Yes (closer = better) | Unbounded |

Bounded ranges use linear normalization. Unbounded ranges use sigmoid normalization (`1 / (1 + |score|)`).

## Common Pitfalls

| Issue | Cause | Fix |
|---|---|---|
| No search fields on table | No search infrastructure detected | Add tsvector column, BM25 index, or vector column |
| trgm operators missing | Table has no intentional search | Add tsvector/BM25, or use `@trgmSearch` smart tag |
| `searchScore` is null | No search filters active in query | Add a search filter (unifiedSearch, bm25Body, etc.) |
| `includeChunks` field missing | No `@hasChunks` tables in schema | Add `@hasChunks` smart tag to parent table codec |
| `Unknown type "FullText"` | TsvectorCodecPlugin not loaded | Use `UnifiedSearchPreset()` which includes all codecs |
| `Unknown type "Vector"` | VectorCodecPlugin not loaded | Use `UnifiedSearchPreset()` which includes all codecs |
| Duplicate type errors | Multiple search presets | Use only `UnifiedSearchPreset()`, not individual presets |

## RelationSpatial — Cross-Table PostGIS Predicates

Not part of graphile-search itself, but a related spatial search capability exposed via `graphile-postgis`'s `PostgisSpatialRelationsPlugin`.

Uses the `@spatialRelation` smart tag on geometry/geography columns to create virtual spatial relations that emit `EXISTS` subqueries joined by PostGIS predicates (e.g., `ST_Contains`, `ST_DWithin`).

### Smart Tag Grammar

```
@spatialRelation <relation_name> <target_ref> <operator> [<param_name>]
```

- `target_ref` — `schema.table.col` or `table.col` (same schema as owner)
- `operator` — `st_contains`, `st_within`, `st_intersects`, `st_dwithin`, `st_covers`, `st_coveredby`, `st_crosses`, `st_overlaps`
- `param_name` — required for parametric operators (e.g., `st_dwithin` needs a distance)

### ORM Query Pattern

```typescript
// Find clinics within 5km of a point
const clinics = await db.telemedicineClinic.findMany({
  where: {
    nearbyClinic: {
      location: { distance: 5000 },
    },
  },
  select: { id: true, name: true },
}).execute().unwrap();
```

For full details, see the `graphile-postgis` skill in `constructive-io/constructive`.

## Chunk-Aware Search

The `@hasChunks` smart tag enables transparent parent + chunk embedding search via lateral subqueries. All 4 adapters (pgvector, tsvector, BM25, trgm) support chunk-aware querying.

When a parent table has `@hasChunks`, each adapter:
1. Detects the chunk table and its search infrastructure
2. Adds an `includeChunks` boolean argument to the filter field
3. Emits a `LATERAL` subquery that finds the best-matching chunk and returns its score/distance alongside the parent row

### How It Works

```
Parent table (e.g., documents)
  @hasChunks → "document_chunks"
    └── chunks table with embedding/tsvector/BM25 columns

Query:
  SELECT parent.*, best_chunk.distance
  FROM documents parent
  LEFT JOIN LATERAL (
    SELECT MIN(distance) FROM document_chunks
    WHERE parent_id = parent.id AND <search_predicate>
  ) best_chunk ON true
```

### ORM Query Pattern

```typescript
const results = await db.document.findMany({
  where: {
    vectorEmbedding: {
      query: embeddingVector,
      includeChunks: true,   // default true for @hasChunks tables
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  select: { id: true, title: true, embeddingVectorDistance: true },
}).execute().unwrap();
```

Each adapter checks for chunk support independently — a table can have chunked pgvector search but non-chunked tsvector search if the chunks table only has embedding columns.

## Recency Boost

The `@searchConfig` smart tag supports timestamp-based score decay for the composite `searchScore` field. This biases search results toward more recently updated rows.

### Configuration via Smart Tag

```
@searchConfig {"boost_recent": true, "boost_recency_field": "updated_at", "boost_recency_decay": 0.95}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `boost_recent` | boolean | `false` | Enable recency boost for this table |
| `boost_recency_field` | string | `'updated_at'` | Timestamp column to use for decay |
| `boost_recency_decay` | number | `0.95` | Decay factor (0..1); lower = more aggressive recency bias |

The boost is applied during `searchScore` computation — it multiplies the normalized score by a decay function based on the age of the row. If the specified `boost_recency_field` doesn't exist on the table, recency boost is disabled gracefully with a console warning.

## DataCompositeField — Embedding Text Concatenation

The `DataCompositeField` blueprint node creates a derived text field (default: `embedding_text`) that auto-concatenates multiple source columns via a BEFORE INSERT/UPDATE trigger. Used internally by `SearchUnified` to produce unified text for embedding, but independently usable on any table.

```typescript
{
  ref: 'articles',
  table_name: 'articles',
  nodes: [
    'DataId', 'DataTimestamps',
    { $type: 'DataCompositeField', data: {
      target: 'embedding_text',          // derived field name (default)
      source_fields: ['title', 'body'],  // columns to concatenate
      format: 'labeled',                 // 'labeled' = "title: value\nbody: value", 'plain' = values only
    }},
    { $type: 'SearchUnified', data: { /* uses embedding_text */ } },
  ],
}
```

The trigger fires with `_000` prefix to run before `Search*` triggers alphabetically, ensuring the derived field is populated before search indexes are updated.

## Related Skills

- `constructive-db-search` (private) — SQL-level search strategies and metaschema integration
- `constructive-graphql-codegen` — code generation from search-enabled schemas
