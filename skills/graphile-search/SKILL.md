---
name: graphile-search
description: How to query search-enabled tables via GraphQL in Constructive applications. Covers full-text search (tsvector), BM25 ranked search, and vector similarity search. Use this when you have set up search columns/indexes via constructive-sdk and need to query them through the GraphQL API.
compatibility: PostGraphile v5, Constructive GraphQL server
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Querying Search via GraphQL

When you create search-enabled tables using the Constructive SDK (tsvector columns, BM25 indexes, or vector columns), the GraphQL API automatically exposes search fields. No plugin configuration is needed — the search fields appear as soon as the database has the right columns or indexes.

## What You Get

| Search Type | What You Create in the DB | What Appears in GraphQL |
|-------------|--------------------------|------------------------|
| **Full-text (TSVector)** | `tsvector` column + GIN index | Condition field, rank field, rank ordering |
| **BM25** | Text column + BM25 index | Condition field, score field, score ordering |
| **Vector similarity** | `vector(N)` column + HNSW index | Condition field, distance field, distance ordering |

## Quick Examples

### Full-Text Search (TSVector)

If your table has a `search_tsv` tsvector column:

```graphql
query SearchArticles($query: String!) {
  allArticles(
    condition: { fullTextSearchTsv: $query }
    orderBy: SEARCH_TSV_RANK_DESC
  ) {
    nodes {
      id
      title
      searchTsvRank    # relevance score (higher = better match)
    }
  }
}
```

### BM25 Ranked Search

If your table has a text column `content` with a BM25 index:

```graphql
query SearchDocs($query: String!) {
  allDocuments(
    condition: {
      bm25Content: { query: $query }
    }
    orderBy: BM25_CONTENT_SCORE_ASC   # most negative = best match
  ) {
    nodes {
      id
      title
      bm25ContentScore   # BM25 score (negative, more negative = better)
    }
  }
}
```

### Vector Similarity Search

If your table has an `embedding vector(1536)` column with an HNSW index:

```graphql
query SimilarDocs($queryVector: [Float!]!) {
  allDocuments(
    condition: {
      vectorEmbedding: {
        vector: $queryVector
        metric: COSINE
      }
    }
    orderBy: EMBEDDING_DISTANCE_ASC
    first: 10
  ) {
    nodes {
      id
      title
      embeddingDistance   # cosine distance (0 = identical)
    }
  }
}
```

## Field Naming Conventions

The GraphQL field names are derived from your database column names:

| DB Column | Condition Field | Score/Distance Field | OrderBy |
|-----------|----------------|---------------------|---------|
| `search_tsv` (tsvector) | `fullTextSearchTsv` | `searchTsvRank` | `SEARCH_TSV_RANK_ASC/DESC` |
| `content` (BM25 index) | `bm25Content` | `bm25ContentScore` | `BM25_CONTENT_SCORE_ASC/DESC` |
| `embedding` (vector) | `vectorEmbedding` | `embeddingDistance` | `EMBEDDING_DISTANCE_ASC/DESC` |

**Pattern:**
- TSVector condition: `fullText` + camelCase column name
- BM25 condition: `bm25` + camelCase column name
- Vector condition: `vector` + camelCase column name

## Reference Files

- `references/query-patterns.md` — Detailed query examples, input types, combining search with filters, pagination

## Related Skills

- `constructive-db-search` (constructive-private-skills) — SQL-level search strategies, decision matrix, how to set up the database side
- `graphile-pgvector` (constructive-skills) — Additional pgvector details, VectorCodecPlugin, codegen scalar mapping
