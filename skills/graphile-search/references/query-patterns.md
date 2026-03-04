# GraphQL Search Query Patterns

Quick reference for all search-related GraphQL queries available when using the ConstructivePreset.

---

## TSVector (Full-Text Search)

### Prerequisites
- Table must have a `tsvector` column (e.g., `search_tsv`)
- GIN index on that column

### Search + Rank

```graphql
query SearchArticles($query: String!) {
  allArticles(
    condition: { fullTextSearchTsv: $query }
    orderBy: SEARCH_TSV_RANK_DESC
  ) {
    nodes {
      id
      title
      body
      searchTsvRank    # Float: ts_rank score, null if no search active
    }
    totalCount
  }
}
```

### Connection Filter (matches operator)

```graphql
query FilterArticles {
  allArticles(
    filter: {
      searchTsv: { matches: "postgres" }
      isPublished: { equalTo: true }
    }
  ) {
    nodes { id title }
  }
}
```

### Naming Convention

With `pgSearchPrefix: 'fullText'` (the Constructive default):
- Column `search_tsv` → condition field `fullTextSearchTsv`
- Rank field: `searchTsvRank`
- OrderBy: `SEARCH_TSV_RANK_ASC`, `SEARCH_TSV_RANK_DESC`

---

## BM25 Search

### Prerequisites
- Table must have a text column with a BM25 index (`USING bm25`)
- `pg_textsearch` extension enabled

### Search + Score

```graphql
query Bm25SearchDocs($query: String!, $threshold: Float) {
  allDocuments(
    condition: {
      bm25Content: {
        query: $query
        threshold: $threshold   # e.g., -0.5 (optional)
      }
    }
    orderBy: BM25_CONTENT_SCORE_ASC   # best matches first (most negative)
  ) {
    nodes {
      id
      title
      content
      bm25ContentScore   # Float: negative BM25 score, more negative = better
    }
  }
}
```

### Bm25SearchInput Type

```graphql
input Bm25SearchInput {
  # The search query text. Uses pg_textsearch BM25 ranking.
  query: String!
  # Maximum BM25 score threshold (negative values).
  # More negative = more relevant. Only rows with score <= threshold returned.
  threshold: Float
}
```

### Score Interpretation

BM25 scores are **negative** in pg_textsearch. More negative = more relevant:
- `-5.2` is more relevant than `-1.3`
- Use `BM25_*_SCORE_ASC` (ascending) to get best matches first
- The `threshold` filters: only rows with `score < threshold` are returned

### Naming Convention

With `conditionPrefix: 'bm25'` (the default):
- Column `content` → condition field `bm25Content`
- Score field: `bm25ContentScore`
- OrderBy: `BM25_CONTENT_SCORE_ASC`, `BM25_CONTENT_SCORE_DESC`

---

## Vector Similarity Search

### Prerequisites
- Table must have a `vector(N)` column (e.g., `embedding vector(1536)`)
- HNSW or IVFFlat index on that column

### Nearest Neighbor Search

```graphql
query SimilarDocs($queryVector: [Float!]!) {
  allDocuments(
    condition: {
      vectorEmbedding: {
        vector: $queryVector
        metric: COSINE
      }
    }
    orderBy: EMBEDDING_DISTANCE_ASC   # closest first
    first: 10
  ) {
    nodes {
      id
      title
      embeddingDistance   # Float: cosine distance, 0 = identical
    }
  }
}
```

### With Distance Threshold

```graphql
query NearbyDocs($queryVector: [Float!]!) {
  allDocuments(
    condition: {
      vectorEmbedding: {
        vector: $queryVector
        metric: COSINE
        distance: 0.5    # only docs within cosine distance 0.5
      }
    }
    orderBy: EMBEDDING_DISTANCE_ASC
  ) {
    nodes {
      id
      title
      embeddingDistance
    }
  }
}
```

### VectorNearbyInput Type

```graphql
input VectorNearbyInput {
  # Query vector for similarity search
  vector: [Float!]!
  # Similarity metric (default: COSINE)
  metric: VectorMetric
  # Maximum distance threshold (optional)
  distance: Float
}

enum VectorMetric {
  COSINE  # 0 = identical, 2 = opposite
  L2      # 0 = identical, higher = farther
  IP      # More negative = more similar
}
```

### Naming Convention

With `conditionPrefix: 'vector'` (the default):
- Column `embedding` → condition field `vectorEmbedding`
- Distance field: `embeddingDistance`
- OrderBy: `EMBEDDING_DISTANCE_ASC`, `EMBEDDING_DISTANCE_DESC`

---

## Combining Search with Other Filters

All search condition fields work alongside standard PostGraphile conditions:

```graphql
query {
  allArticles(
    condition: {
      fullTextSearchTsv: "postgres"   # FTS search
      isPublished: true                # scalar filter
      category: "tech"                 # scalar filter
    }
    orderBy: SEARCH_TSV_RANK_DESC
  ) {
    nodes {
      id
      title
      searchTsvRank
    }
  }
}
```

---

## Pagination with Search

Search results work with standard cursor-based pagination. **Important**: rank/score/distance ordering is only applied when explicitly requested via the orderBy enum values. Without explicit rank ordering, cursor pagination digests remain stable across pages.

```graphql
query PaginatedSearch($cursor: Cursor) {
  allArticles(
    condition: { fullTextSearchTsv: "postgres" }
    orderBy: SEARCH_TSV_RANK_DESC
    first: 20
    after: $cursor
  ) {
    nodes {
      id
      title
      searchTsvRank
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
