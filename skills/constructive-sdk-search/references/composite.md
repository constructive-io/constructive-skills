# Unified Search System — Composite Fields & Adapter Architecture

The `graphile-search` plugin (`https://www.npmjs.com/package/graphile-search`) provides a unified search architecture where multiple search adapters register on the same tables and expose composite fields for cross-algorithm querying.

---

## Architecture Overview

```
graphile-search plugin
  ├── SearchAdapter interface (each algorithm implements this)
  │   ├── createTsvectorAdapter()    — tsvector full-text search
  │   ├── createBm25Adapter()        — BM25 ranked search
  │   ├── createTrgmAdapter()        — trigram fuzzy matching (supplementary)
  │   └── createPgvectorAdapter()    — vector similarity search
  ├── Composite Fields
  │   ├── searchScore                — normalized 0..1 blend of all active algorithms
  │   └── fullTextSearch             — fans text query to tsvector + BM25 + trgm
  └── Per-Adapter Fields
      ├── Filter fields (tsvTsv, bm25Body, trgmTitle, vectorEmbedding)
      ├── Score fields (tsvRank, bodyBm25Score, titleTrgmSimilarity, embeddingVectorDistance)
      └── OrderBy enums (TSV_RANK_DESC, BODY_BM25_SCORE_ASC, etc.)
```

## SearchAdapter Interface

Each adapter implements:
- **Column detection**: Which columns/indexes does this adapter operate on?
- **Type registration**: What GraphQL filter types and score fields to add?
- **SQL generation**: How to generate WHERE clauses and score expressions?
- **Score semantics**: Metric name, whether lower-is-better, and known range bounds

Key flags:
- `isIntentionalSearch`: Does this adapter represent intentional search infrastructure? (tsvector=yes, BM25=yes, pgvector=no, trgm=no)
- `isSupplementary`: Does this adapter only activate when intentional search exists? (trgm=yes, others=no)

---

## searchScore — Composite Relevance

A normalized 0..1 field that combines all active search signals into a single relevance number.

### How Normalization Works

Each adapter defines its score semantics:

| Adapter | Raw Score | Range | Lower Is Better? | Normalization |
|---------|-----------|-------|-------------------|---------------|
| TSVector | `ts_rank()` | 0..1+ | No | Linear clamp to 0..1 |
| BM25 | BM25 score | negative | Yes | Sigmoid (unbounded -> 0..1) |
| Trigram | `similarity()` | 0..1 | No | Already normalized |
| pgvector | distance | 0..2 (cosine) | Yes | Linear invert: `1 - (d / max)` |

The composite `searchScore` averages the normalized scores of all active adapters. Only adapters whose filters are active contribute.

### Selecting searchScore

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearch: 'machine learning',
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    title: true,
    searchScore: true,
  },
}).execute();

// searchScore is 0..1: higher = more relevant
// null when no search filters are active
```

### OrderBy

| Enum | Meaning |
|------|---------|
| `SEARCH_SCORE_ASC` | Least relevant first |
| `SEARCH_SCORE_DESC` | Most relevant first |

---

## fullTextSearch — Composite Filter

A `String` filter field that fans the same text query to all **text-compatible** adapters simultaneously, combining with OR logic.

### Which Adapters Participate?

| Adapter | Participates in fullTextSearch? | Why? |
|---------|-------------------------------|------|
| TSVector | Yes | Text-based query |
| BM25 | Yes | Text-based query |
| Trigram | Yes | Text-based query |
| pgvector | **No** | Requires vector array, not text |

### How It Works

When you write:
```graphql
where: { fullTextSearch: "machine learning" }
```

The plugin generates SQL equivalent to:
```sql
WHERE (tsv @@ plainto_tsquery('machine learning'))
   OR (body @@@ 'machine learning')
   OR (similarity(title, 'machine learning') >= threshold)
```

All matching rows from ANY algorithm are included. The `searchScore` then ranks them by a composite of whichever algorithms matched.

### Combining with Per-Algorithm Filters

`fullTextSearch` can coexist with algorithm-specific filters. The specific filter narrows further:

```graphql
where: {
  fullTextSearch: "learning"    # OR across tsvector/BM25/trgm
  tsvTsv: "machine"             # AND narrows within tsvector matches
}
```

### Disabling fullTextSearch

The feature can be disabled in the plugin configuration:

```typescript
const plugin = createUnifiedSearchPlugin({
  adapters: [createTsvectorAdapter(), createBm25Adapter(), createTrgmAdapter()],
  enableSearchScore: true,
  enableFullTextSearch: false,  // disable the composite filter
});
```

When disabled, per-algorithm filters still work normally.

---

## Plugin Configuration

```typescript
import {
  createUnifiedSearchPlugin,
  createTsvectorAdapter,
  createBm25Adapter,
  createTrgmAdapter,
  createPgvectorAdapter,
} from 'graphile-search';

const searchPlugin = createUnifiedSearchPlugin({
  adapters: [
    createTsvectorAdapter(),
    createBm25Adapter(),
    createTrgmAdapter({ defaultThreshold: 0.1 }),
    createPgvectorAdapter(),
  ],
  enableSearchScore: true,       // default: true
  enableFullTextSearch: true,     // default: true
});
```

The plugin is typically included via `graphile-settings` in the Constructive stack, so you don't need to configure it manually unless customizing adapter options.

---

## Score Field Lifecycle

Score fields are only populated when their corresponding filter is active:

| State | tsvRank | bodyBm25Score | titleTrgmSimilarity | embeddingVectorDistance | searchScore |
|-------|---------|---------------|---------------------|----------------------|-------------|
| No filters active | null | null | null | null | null |
| `tsvTsv: "foo"` only | number | null | null | null | number |
| `fullTextSearch: "foo"` | number | number | number | null | number |
| All 4 filters active | number | number | number | number | number |

This means you can safely select all score fields and they'll be `null` for algorithms that weren't queried.

---

## Schema Introspection

When the unified search plugin is active on a table, these are added:

### Object Type Fields (score outputs)
- `tsvRank: Float`
- `bodyBm25Score: Float`
- `titleTrgmSimilarity: Float`
- `bodyTrgmSimilarity: Float`
- `embeddingVectorDistance: Float`
- `searchScore: Float`

### Filter Input Fields
- `tsvTsv: String` — tsvector text query
- `bm25Body: Bm25BodyInput` — `{ query: String }`
- `trgmTitle: TrgmTitleInput` — `{ value: String, threshold: Float }`
- `vectorEmbedding: VectorEmbeddingInput` — `{ vector: [Float!]!, metric: VectorMetric, distance: Float }`
- `fullTextSearch: String` — composite filter

### OrderBy Enum Values
- `TSV_RANK_ASC` / `TSV_RANK_DESC`
- `BODY_BM25_SCORE_ASC` / `BODY_BM25_SCORE_DESC`
- `TITLE_TRGM_SIMILARITY_ASC` / `TITLE_TRGM_SIMILARITY_DESC`
- `BODY_TRGM_SIMILARITY_ASC` / `BODY_TRGM_SIMILARITY_DESC`
- `EMBEDDING_VECTOR_DISTANCE_ASC` / `EMBEDDING_VECTOR_DISTANCE_DESC`
- `SEARCH_SCORE_ASC` / `SEARCH_SCORE_DESC`

Exact field names depend on your column names — see the naming convention sections in each strategy's reference file.
