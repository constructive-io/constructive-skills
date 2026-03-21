# Combined Multi-Algorithm Search Patterns

Combine multiple search algorithms in a single query using composite fields (`searchScore`, `fullTextSearch`) or per-algorithm filters.

---

## searchScore — Composite Relevance

A normalized 0..1 field that combines all active search signals into a single relevance number. Returns `null` when no search filters are active.

```typescript
const result = await db.article.findMany({
  where: { fullTextSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    title: true,
    searchScore: true,
  },
}).execute();
```

**`searchScore` does not require selecting individual score fields** (`tsvRank`, `bodyBm25Score`, etc.). All score expressions are computed server-side when filters are applied, regardless of what fields you select. Individual score fields are only needed if you want to display per-algorithm scores to the user.

| Enum | Meaning |
|------|---------|
| `SEARCH_SCORE_DESC` | Most relevant first |
| `SEARCH_SCORE_ASC` | Least relevant first |

---

## fullTextSearch — Composite Filter

A `String` filter field that fans the same text query to all **text-compatible** algorithms simultaneously, combining with OR logic.

| Algorithm | Participates in fullTextSearch? | Why? |
|---------|-------------------------------|------|
| TSVector | Yes | Text-based query |
| BM25 | Yes | Text-based query |
| Trigram | Yes | Text-based query |
| pgvector | **No** | Requires vector array, not text |

When you filter with `fullTextSearch: "machine learning"`, all matching rows from ANY text algorithm are included. The `searchScore` then ranks them by a composite of whichever algorithms matched.

### Combining fullTextSearch with Per-Algorithm Filters

`fullTextSearch` can coexist with algorithm-specific filters. The specific filter narrows further:

```typescript
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'learning',
    tsvTsv: 'machine',
  },
  select: {
    title: true,
    searchScore: true,
  },
}).execute();
```

---

## Per-Algorithm Filters (Maximum Control)

Each algorithm's filter specified individually with a composite orderBy array mixing different algorithm scores:

```typescript
const result = await db.document.findMany({
  where: {
    tsvTsv: 'learning',
    bm25Body: { query: 'learning' },
    trgmTitle: { value: 'Learning', threshold: 0.05 },
    vectorEmbedding: { vector: [1, 0, 0], metric: 'COSINE' },
  },
  orderBy: ['BODY_BM25_SCORE_ASC', 'TITLE_TRGM_SIMILARITY_DESC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: {
    rowId: true,
    title: true,
    searchScore: true,
  },
}).execute();
```

To see individual scores, add them to the select:

```typescript
select: {
  rowId: true,
  title: true,
  tsvRank: true,                 // ts_rank(tsv, query) — higher = more relevant
  bodyBm25Score: true,           // BM25 score — more negative = more relevant
  titleTrgmSimilarity: true,     // similarity(title, value) — 0..1, higher = closer
  embeddingVectorDistance: true,  // cosine distance — lower = closer
  searchScore: true,             // composite normalized 0..1 blend
},
```

<details>
<summary>Equivalent GraphQL</summary>

```graphql
{
  documents(
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

## Unified fullTextSearch (Simplified)

Uses the `fullTextSearch` composite filter that fans out to all text-compatible algorithms (tsvector, BM25, trgm) automatically with a single string. pgvector still needs its own filter because it requires a vector array, not text.

```typescript
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'machine learning',
    vectorEmbedding: { vector: [1, 0, 0], metric: 'COSINE' },
  },
  orderBy: ['SEARCH_SCORE_DESC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: {
    title: true,
    searchScore: true,
  },
}).execute();
```

<details>
<summary>Equivalent GraphQL</summary>

```graphql
{
  documents(
    where: {
      fullTextSearch: "machine learning"
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    orderBy: [SEARCH_SCORE_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      title
      searchScore
    }
  }
}
```

</details>

#### When to Use Unified fullTextSearch

- You want the simplest possible multi-algorithm search
- The same search string applies to all text-based algorithms
- You're building a general-purpose search box

---

## Unified fullTextSearch — Text Only (No Vector)

The simplest multi-algorithm search when pgvector is not available:

```typescript
const result = await db.article.findMany({
  where: { fullTextSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    title: true,
    searchScore: true,
  },
}).execute();
```

<details>
<summary>Equivalent GraphQL</summary>

```graphql
{
  articles(
    where: { fullTextSearch: "machine learning" }
    orderBy: SEARCH_SCORE_DESC
  ) {
    nodes {
      title
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
  select: { title: true, searchScore: true },
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
  select: { title: true, searchScore: true },
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
  select: { title: true, category: true, searchScore: true },
}).execute();
```

---

## Score Field Lifecycle

Score fields are only populated when their corresponding filter is active:

| State | tsvRank | bodyBm25Score | titleTrgmSimilarity | embeddingVectorDistance | searchScore |
|-------|---------|---------------|---------------------|----------------------|-------------|
| No filters active | null | null | null | null | null |
| `tsvTsv: "foo"` only | number | null | null | null | number |
| `fullTextSearch: "foo"` | number | number | number | null | number |
| All 4 filters active | number | number | number | number | number |

You can safely select all score fields — inactive ones return `null`.
