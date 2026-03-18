# Combined Multi-Algorithm Search Queries

Complete patterns for combining tsvector, BM25, trigram, and pgvector in a single query. These are real tested patterns from the `graphile-search` test suite.

---

## Per-Algorithm Filters (Maximum Control)

Each algorithm's filter is specified individually, with a composite orderBy array mixing different algorithm scores. This gives maximum control over which algorithms are active and how results are ranked.

### GraphQL

```graphql
query PerAlgorithmFilters {
  allDocuments(
    where: {
      # tsvector: full-text search on the tsv column
      tsvTsv: "learning"

      # BM25: ranked text search on the body column (requires BM25 index)
      bm25Body: { query: "learning" }

      # pg_trgm: fuzzy trigram match on the title column (typo-tolerant)
      trgmTitle: { value: "Learning", threshold: 0.05 }

      # pgvector: cosine similarity on the embedding column
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    # Composite orderBy: BM25 relevance first (ASC because lower = more relevant),
    # then trgm similarity as tiebreaker (DESC because higher = more similar),
    # then vector distance (ASC because lower = closer)
    orderBy: [BODY_BM25_SCORE_ASC, TITLE_TRGM_SIMILARITY_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      rowId
      title
      body

      # Per-adapter scores — each populated only when its filter is active
      tsvRank                    # ts_rank(tsv, query) — higher = more relevant
      bodyBm25Score              # BM25 score — more negative = more relevant
      titleTrgmSimilarity        # similarity(title, value) — 0..1, higher = closer
      embeddingVectorDistance     # cosine distance — lower = closer

      # Composite normalized score — weighted blend of all active algorithms
      searchScore
    }
  }
}
```

### Codegen SDK

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
    body: true,
    tsvRank: true,
    bodyBm25Score: true,
    titleTrgmSimilarity: true,
    embeddingVectorDistance: true,
    searchScore: true,
  },
}).execute();
```

### When to Use Per-Algorithm Filters

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

### GraphQL

```graphql
query UnifiedSearch {
  allDocuments(
    where: {
      # fullTextSearch: single string fans out to tsvector + BM25 + trgm
      # automatically — no need to specify each algorithm separately
      fullTextSearch: "machine learning"

      # pgvector still needs its own filter (vectors aren't text)
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    # Order by composite searchScore (higher = more relevant across all algorithms),
    # then by vector distance as tiebreaker (lower = semantically closer)
    orderBy: [SEARCH_SCORE_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      rowId
      title
      body

      # Per-adapter scores — populated by fullTextSearch for text algorithms
      tsvRank
      bodyBm25Score
      titleTrgmSimilarity
      embeddingVectorDistance

      # Composite normalized score — the single number that blends everything
      searchScore
    }
  }
}
```

### Codegen SDK

```typescript
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'machine learning',
    vectorEmbedding: { vector: [1, 0, 0], metric: 'COSINE' },
  },
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

### When to Use Unified fullTextSearch

- You want the simplest possible multi-algorithm search
- The same search string applies to all text-based algorithms
- You trust the composite `searchScore` normalization for ranking
- You're building a general-purpose search box

---

## Unified fullTextSearch — Text Only (No Vector)

The simplest multi-algorithm search when pgvector is not available:

### GraphQL

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

### Codegen SDK

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
  // Results ordered by descending searchScore
  articles.forEach(a => {
    console.log(`${a.title} (score: ${a.searchScore})`);
  });
}
```

---

## Integration Test: Per-Algorithm Combined Search (Server-Level)

From `constructive/graphql/server-test/__tests__/search.integration.test.ts`:

```graphql
# Combines tsvector + trgm + pgvector in a real integration test
{
  articles(
    where: {
      tsvTsv: "search"
      trgmTitle: { value: "PostgreSQL", threshold: 0.05 }
      vectorEmbedding: { vector: [0.8, 0.2, 0.5] }
    }
    orderBy: [TSV_RANK_DESC, TITLE_TRGM_SIMILARITY_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      title
      tsvRank
      titleTrgmSimilarity
      bodyTrgmSimilarity
      embeddingVectorDistance
      searchScore
    }
  }
}
```

All score fields resolve to `number` types. The intersection of all filters determines the result set — results must match ALL active filters simultaneously.

---

## Integration Test: Unified fullTextSearch with Vector (Server-Level)

From `constructive/graphql/server-test/__tests__/search.integration.test.ts`:

```graphql
# fullTextSearch + pgvector + mixed orderBy
{
  articles(
    where: {
      fullTextSearch: "machine learning"
      vectorEmbedding: { vector: [0.1, 0.9, 0.3] }
    }
    orderBy: [SEARCH_SCORE_DESC, EMBEDDING_VECTOR_DISTANCE_ASC]
  ) {
    nodes {
      title
      tsvRank
      titleTrgmSimilarity
      bodyTrgmSimilarity
      embeddingVectorDistance
      searchScore
    }
  }
}
```

The `searchScore` is a composite 0..1 value combining all active text algorithms. Results are sorted by composite relevance first, then vector distance as tiebreaker.

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

### fullTextSearch + Additional Filters (non-search)

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

## fullTextSearch Can Coexist with Per-Algorithm Filters

You can use `fullTextSearch` AND algorithm-specific filters in the same query. The algorithm-specific filter narrows further within the fullTextSearch results:

```graphql
{
  allDocuments(where: {
    fullTextSearch: "learning"
    tsvTsv: "machine"
  }) {
    nodes {
      title
      tsvRank
    }
  }
}
```
