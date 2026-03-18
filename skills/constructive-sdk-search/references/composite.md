# Unified Search System — Composite Fields, Combined Queries & Architecture

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
- **Type registration**: What filter types and score fields to add?
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

When you filter with `fullTextSearch: "machine learning"`, the plugin generates SQL equivalent to:

```sql
WHERE (tsv @@ plainto_tsquery('machine learning'))
   OR (body @@@ 'machine learning')
   OR (similarity(title, 'machine learning') >= threshold)
```

All matching rows from ANY algorithm are included. The `searchScore` then ranks them by a composite of whichever algorithms matched.

### Combining fullTextSearch with Per-Algorithm Filters

`fullTextSearch` can coexist with algorithm-specific filters. The specific filter narrows further:

```typescript
// fullTextSearch fans to tsvector/BM25/trgm via OR,
// then tsvTsv narrows further within tsvector matches via AND
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'learning',
    tsvTsv: 'machine',
  },
  select: {
    title: true,
    tsvRank: true,
  },
}).execute();
```

### Disabling fullTextSearch

```typescript
const plugin = createUnifiedSearchPlugin({
  adapters: [createTsvectorAdapter(), createBm25Adapter(), createTrgmAdapter()],
  enableSearchScore: true,
  enableFullTextSearch: false,  // disable the composite filter
});
```

When disabled, per-algorithm filters still work normally.

---

## Combined Multi-Algorithm Search

Two canonical patterns for combining ALL search algorithms in a single query. Both are real tested patterns from the `graphile-search` test suite.

### Per-Algorithm Filters (Maximum Control)

Each algorithm's filter specified individually with a composite orderBy array mixing different algorithm scores:

```typescript
// Per-algorithm: each filter specified individually, composite orderBy
const result = await db.document.findMany({
  where: {
    // tsvector: full-text search on the tsv column
    tsvTsv: 'learning',
    // BM25: ranked text search on the body column
    bm25Body: { query: 'learning' },
    // pg_trgm: fuzzy trigram match on the title column
    trgmTitle: { value: 'Learning', threshold: 0.05 },
    // pgvector: cosine similarity on the embedding column
    vectorEmbedding: { vector: [1, 0, 0], metric: 'COSINE' },
  },
  // BM25 first (ASC = more relevant), trgm tiebreaker (DESC = more similar),
  // then vector distance (ASC = closer)
  orderBy: ['BODY_BM25_SCORE_ASC', 'TITLE_TRGM_SIMILARITY_DESC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: {
    rowId: true,
    title: true,
    body: true,
    tsvRank: true,                 // ts_rank(tsv, query) — higher = more relevant
    bodyBm25Score: true,           // BM25 score — more negative = more relevant
    titleTrgmSimilarity: true,     // similarity(title, value) — 0..1, higher = closer
    embeddingVectorDistance: true,  // cosine distance — lower = closer
    searchScore: true,             // composite normalized 0..1 blend
  },
}).execute();
```

<details>
<summary>Equivalent GraphQL (verified from test suite)</summary>

```graphql
{
  allDocuments(
    where: {
      tsvTsv: "learning"
      bm25Body: { query: "learning" }
      trgmTitle: { value: "Learning", threshold: 0.05 }
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    orderBy: [BODY_BM25_SCORE_ASC, TITLE_TRGM_SIMILARITY_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      rowId
      title
      body
      tsvRank
      bodyBm25Score
      titleTrgmSimilarity
      embeddingVectorDistance
      searchScore
    }
  }
}
```

</details>

#### When to Use Per-Algorithm Filters

- You need fine-grained control over each algorithm's parameters
- You want to weight algorithms differently in the orderBy
- You need different query strings for different algorithms
- You want to exclude specific algorithms from the search

### Score Directions Cheat Sheet

| Algorithm | Score Field | Best Match | Sort Direction |
|-----------|------------|------------|----------------|
| TSVector | `tsvRank` | Higher = better | DESC |
| BM25 | `bodyBm25Score` | More negative = better | ASC |
| Trigram | `titleTrgmSimilarity` | Higher = closer (0..1) | DESC |
| pgvector | `embeddingVectorDistance` | Lower = closer | ASC |
| Composite | `searchScore` | Higher = more relevant (0..1) | DESC |

---

### Unified fullTextSearch (Simplified)

Uses the `fullTextSearch` composite filter that fans out to all text-compatible algorithms (tsvector, BM25, trgm) automatically with a single string. pgvector still needs its own filter because it requires a vector array, not text.

```typescript
// Unified: fullTextSearch fans to tsvector + BM25 + trgm automatically
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'machine learning',
    // pgvector still needs its own filter (vectors aren't text)
    vectorEmbedding: { vector: [1, 0, 0], metric: 'COSINE' },
  },
  // searchScore combines all algorithms, vector distance as tiebreaker
  orderBy: ['SEARCH_SCORE_DESC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: {
    rowId: true,
    title: true,
    body: true,
    tsvRank: true,
    bodyBm25Score: true,
    titleTrgmSimilarity: true,
    embeddingVectorDistance: true,
    searchScore: true,
  },
}).execute();
```

<details>
<summary>Equivalent GraphQL (verified from test suite)</summary>

```graphql
{
  allDocuments(
    where: {
      fullTextSearch: "machine learning"
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    orderBy: [SEARCH_SCORE_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      rowId
      title
      body
      tsvRank
      bodyBm25Score
      titleTrgmSimilarity
      embeddingVectorDistance
      searchScore
    }
  }
}
```

</details>

#### When to Use Unified fullTextSearch

- You want the simplest possible multi-algorithm search
- The same search string applies to all text-based algorithms
- You trust the composite `searchScore` normalization for ranking
- You're building a general-purpose search box

---

### Unified fullTextSearch — Text Only (No Vector)

The simplest multi-algorithm search when pgvector is not available:

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearch: 'machine learning',
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    title: true,
    tsvRank: true,
    titleTrgmSimilarity: true,
    bodyTrgmSimilarity: true,
    searchScore: true,
  },
}).execute();

if (result.ok) {
  const articles = result.data.articles.nodes;
  // searchScore is normalized 0..1, higher = more relevant
  articles.forEach(a => {
    console.log(`${a.title} (score: ${a.searchScore})`);
  });
}
```

<details>
<summary>Equivalent GraphQL (verified from test suite)</summary>

```graphql
{
  articles(
    where: { fullTextSearch: "machine learning" }
    orderBy: SEARCH_SCORE_DESC
  ) {
    nodes {
      title
      tsvRank
      titleTrgmSimilarity
      bodyTrgmSimilarity
      searchScore
    }
  }
}
```

</details>

---

## Partial Combinations

You don't have to use all algorithms. Mix and match as needed:

### TSVector + Trigram (no vector)

```typescript
const result = await db.article.findMany({
  where: {
    tsvTsv: 'search',
    trgmTitle: { value: 'PostgreSQL', threshold: 0.05 },
  },
  orderBy: ['TSV_RANK_DESC', 'TITLE_TRGM_SIMILARITY_DESC'],
  select: {
    title: true,
    tsvRank: true,
    titleTrgmSimilarity: true,
    searchScore: true,
  },
}).execute();
```

### BM25 + Vector (semantic + keyword)

```typescript
const result = await db.document.findMany({
  where: {
    bm25Body: { query: 'machine learning' },
    vectorEmbedding: { vector: queryVector, metric: 'COSINE' },
  },
  orderBy: ['BODY_BM25_SCORE_ASC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: {
    title: true,
    bodyBm25Score: true,
    embeddingVectorDistance: true,
    searchScore: true,
  },
}).execute();
```

### fullTextSearch + Non-Search Filters

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearch: 'postgres tutorial',
    isPublished: { equalTo: true },
    category: { equalTo: 'database' },
  },
  orderBy: 'SEARCH_SCORE_DESC',
  first: 20,
  select: {
    title: true,
    category: true,
    searchScore: true,
  },
}).execute();
```

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
- `trgmBody: TrgmBodyInput` — `{ value: String, threshold: Float }`
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
