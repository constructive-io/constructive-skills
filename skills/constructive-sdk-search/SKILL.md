---
name: constructive-sdk-search
description: Comprehensive search skill for Constructive SDK. Covers creating and querying ALL search strategies — tsvector, BM25, trigram (pg_trgm), pgvector, PostGIS spatial — plus the unified graphile-search system with composite searchScore and fullTextSearch fields. Includes mega query patterns for maximum-control and simplified multi-algorithm search. Use when adding any kind of search to tables, querying search-enabled tables via codegen SDK, or choosing a search strategy.
compatibility: Node.js 22+, @constructive-io/sdk, graphile-search
metadata:
  author: constructive-io
  version: "3.0.0"
---

# Constructive SDK Search

Add search capabilities to your Constructive application using the SDK. Create search columns and indexes via the SDK, then query your data through the generated codegen SDK client. All strategies are automatically exposed in GraphQL via the unified `graphile-search` plugin (`https://www.npmjs.com/package/graphile-search`).

## When to Apply

Use this skill when:
- Adding full-text search to a table (tsvector or BM25)
- Adding vector similarity search for embeddings (pgvector)
- Adding trigram fuzzy matching for typo tolerance (pg_trgm)
- Adding spatial/geospatial search (PostGIS)
- Querying search-enabled tables via the codegen SDK
- Using the composite `searchScore` or `fullTextSearch` fields
- Combining multiple search strategies in a single query (mega queries)
- Choosing between search strategies

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

All search extensions (`pg_textsearch`, `pg_trgm`, `btree_gin`, `vector`, `postgis`) are pre-enabled in the Constructive database stack via `.control` file dependencies. No manual extension setup is needed.

## SDK Client Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'https://api.constructive.io/graphql',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});
```

## Search Strategy Overview

| Strategy | What You Create via SDK | Best For | Score Direction |
|----------|------------------------|----------|-----------------|
| **TSVector** | `tsvector` field + GIN index + `fullTextSearch.create()` | Keyword search with stemming ("running" matches "run") | Higher = better |
| **BM25** | Text field + BM25 index | Best relevance ranking for document search | More negative = better (sort ASC) |
| **Trigram** | Text field + GIN `gin_trgm_ops` index | Fuzzy matching, typo tolerance, fast ILIKE | 0..1, higher = more similar |
| **pgvector** | `vector(N)` field + HNSW index | Semantic/embedding similarity, RAG | Lower distance = closer (sort ASC) |
| **PostGIS** | `geometry`/`geography` column + spatial index | Location-based queries, geofencing, proximity | Depends on operator |

## Decision Matrix

| Need | Use |
|------|-----|
| Keyword search with stemming ("running" matches "run") | TSVector |
| Best relevance ranking for document search | BM25 |
| Semantic similarity, embeddings, RAG | pgvector |
| Typo tolerance, fuzzy matching, "did you mean" | Trigram |
| Fast `ILIKE` / prefix autocomplete | Trigram (GIN index) |
| Location-based proximity ("within 5km") | PostGIS |
| Geofencing, containment, intersection | PostGIS |
| Multi-signal ranking (keyword + fuzzy + semantic) | Unified system (searchScore + fullTextSearch) |
| Simplified multi-algorithm search | Mega Query v2 (fullTextSearch + SEARCH_SCORE_DESC) |
| Maximum control over each algorithm | Mega Query v1 (per-algorithm filters + composite orderBy) |

## Unified Search System

The `graphile-search` plugin provides a unified architecture where multiple search adapters (tsvector, BM25, trgm, pgvector) all register on the same tables. Two composite fields tie them together:

### searchScore (Composite Relevance)

A normalized 0..1 relevance score that combines all active search signals. Returns `null` when no search filters are active.

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearchTsv: 'postgres tutorial',
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    id: true,
    title: true,
    searchTsvRank: true,       // per-adapter raw score
    searchScore: true,          // composite: normalized 0..1 across all active signals
  },
}).execute();
```

The composite score normalizes each adapter's raw score to 0..1 (bounded ranges use linear normalization, unbounded use sigmoid) and averages them.

### fullTextSearch (Composite Filter)

A single filter that fans the same text query to all text-compatible adapters (tsvector, BM25, trgm) simultaneously, combining with OR:

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearch: 'postgres tutorial',  // searches across tsvector, BM25, and trgm
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    id: true,
    title: true,
    searchScore: true,          // combined relevance
  },
}).execute();
```

pgvector is excluded from `fullTextSearch` because it requires a vector array input, not text.

## Mega Queries — Multi-Algorithm Search

These are the two canonical patterns for combining ALL search algorithms in a single query. Both are real tested patterns from the `graphile-search` test suite.

### Mega Query v1: Per-Algorithm Filters (Maximum Control)

Each algorithm's filter specified individually with a composite orderBy array mixing different algorithm scores:

```graphql
query MegaQueryV1_PerAlgorithmFilters {
  allDocuments(
    where: {
      # tsvector: full-text search on the tsv column
      tsvTsv: "learning"

      # BM25: ranked text search on the body column
      bm25Body: { query: "learning" }

      # pg_trgm: fuzzy trigram match on the title column
      trgmTitle: { value: "Learning", threshold: 0.05 }

      # pgvector: cosine similarity on the embedding column
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    # Composite orderBy: BM25 first (ASC = more relevant),
    # then trgm tiebreaker (DESC = more similar),
    # then vector distance (ASC = closer)
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

**Via codegen SDK:**

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

### Mega Query v2: Unified fullTextSearch (Simplified)

Uses the `fullTextSearch` composite filter that fans out to all text-compatible algorithms automatically, plus a manual pgvector filter:

```graphql
query MegaQueryV2_UnifiedSearch {
  allDocuments(
    where: {
      # fullTextSearch: single string fans out to tsvector + BM25 + trgm
      # automatically — no need to specify each algorithm separately
      fullTextSearch: "machine learning"

      # pgvector still needs its own filter (vectors aren't text)
      vectorEmbedding: { vector: [1, 0, 0], metric: COSINE }
    }
    # Order by composite searchScore (higher = more relevant),
    # then by vector distance as tiebreaker (lower = closer)
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

**Via codegen SDK:**

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

### Mega Query v2 — Text Only (No Vector)

When you don't have pgvector, the simplest possible multi-algorithm search:

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
```

## Trigram — Supplementary Adapter

Trigram search is fully integrated via the trgm adapter in `graphile-search`. It provides:

- **`similarTo` / `wordSimilarTo` operators** on string columns (via `StringTrgmFilter`)
- **Similarity score fields** (e.g. `titleTrgmSimilarity: Float`, 0..1)
- **OrderBy enum values** (e.g. `TITLE_TRGM_SIMILARITY_ASC/DESC`)

### Trgm Scoping

Trgm is a **supplementary** adapter — it only activates on tables with "intentional search" infrastructure (tsvector or BM25). pgvector alone does NOT trigger trgm. To opt in without intentional search, use the `@trgmSearch` smart tag:

```sql
COMMENT ON TABLE app_public.contacts IS E'@trgmSearch';
```

### Quick Trgm Query

```typescript
const result = await db.article.findMany({
  where: {
    title: { similarTo: { value: 'postgre', threshold: 0.2 } },
  },
  orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
  select: {
    id: true,
    title: true,
    titleTrgmSimilarity: true,
  },
}).execute();
```

## Schema Introspection Reference

When the unified search plugin is active, these fields/filters/enums appear on qualifying tables:

### Score Fields on Object Types

| Field | Type | Populated When |
|-------|------|----------------|
| `tsvRank` | `Float` | tsvector filter active |
| `bodyBm25Score` | `Float` | BM25 filter active |
| `titleTrgmSimilarity` | `Float` | trgm filter active |
| `embeddingVectorDistance` | `Float` | pgvector filter active |
| `searchScore` | `Float` | Any search filter active |

### Filter Fields on Input Types

| Filter | Type | Description |
|--------|------|-------------|
| `tsvTsv` | `String` | TSVector full-text query |
| `bm25Body` | `Bm25Input` | BM25 ranked search `{ query }` |
| `trgmTitle` | `TrgmInput` | Trigram similarity `{ value, threshold? }` |
| `vectorEmbedding` | `VectorInput` | Vector similarity `{ vector, metric?, distance? }` |
| `fullTextSearch` | `String` | Composite: fans to tsvector + BM25 + trgm |

### OrderBy Enum Values

| Enum | Sort Direction | Meaning |
|------|---------------|---------|
| `TSV_RANK_ASC/DESC` | DESC = best first | Higher rank = more relevant |
| `BODY_BM25_SCORE_ASC/DESC` | ASC = best first | More negative = more relevant |
| `TITLE_TRGM_SIMILARITY_ASC/DESC` | DESC = best first | Higher similarity = closer match |
| `EMBEDDING_VECTOR_DISTANCE_ASC/DESC` | ASC = best first | Lower distance = closer |
| `SEARCH_SCORE_ASC/DESC` | DESC = best first | Higher composite = more relevant |

## Reference Files

Each reference covers both **creating** the search setup via SDK and **querying** your data via the codegen SDK:

- `references/tsvector.md` -- Creating and querying with full-text search (tsvector + GIN)
- `references/bm25.md` -- Creating and querying with BM25 ranked search (pg_textsearch)
- `references/pgvector.md` -- Creating and querying with vector similarity search (pgvector + HNSW)
- `references/trigram.md` -- Creating and querying with fuzzy text matching (pg_trgm + GIN)
- `references/postgis.md` -- Creating and querying with spatial/geospatial search (PostGIS)
- `references/mega-queries.md` -- Complete mega query patterns with real test examples
- `references/composite.md` -- Unified system: searchScore normalization, fullTextSearch fan-out, adapter architecture

## Related Skills

- `graphile-search` (constructive-skills) -- Unified search plugin architecture, adapter interface, GraphQL API, preset configuration
- `constructive-graphql-codegen` (constructive-skills) -- Code generation from GraphQL schema, including search field categorization
