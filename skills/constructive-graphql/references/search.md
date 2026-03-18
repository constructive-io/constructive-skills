# Search Overview

Create search columns and indexes via the SDK, run codegen, then query your data through the generated TypeScript SDK client.

## Prerequisites

```bash
pnpm add @constructive-io/sdk
```

All search extensions (`pg_textsearch`, `pg_trgm`, `btree_gin`, `vector`, `postgis`) are pre-enabled in the Constructive database stack. No manual extension setup is needed.

After creating search fields/indexes, run codegen to generate the typed SDK:

```bash
cnc codegen --orm
```

## Strategy Overview

| Strategy | Best For | Score Direction |
|----------|----------|-----------------|
| **TSVector** | Keyword search with stemming ("running" matches "run") | Higher = better |
| **BM25** | Best relevance ranking for document search | More negative = better (sort ASC) |
| **Trigram** | Fuzzy matching, typo tolerance, fast ILIKE | 0..1, higher = more similar |
| **pgvector** | Semantic/embedding similarity, RAG | Lower distance = closer (sort ASC) |
| **PostGIS** | Location-based queries, geofencing, proximity | Depends on operator |

## Decision Matrix

| Need | Use |
|------|-----|
| Keyword search with stemming | TSVector |
| Best relevance ranking for documents | BM25 |
| Semantic similarity, embeddings, RAG | pgvector |
| Typo tolerance, fuzzy matching | Trigram |
| Fast `ILIKE` / prefix autocomplete | Trigram (GIN index) |
| Location-based proximity ("within 5km") | PostGIS |
| Geofencing, containment, intersection | PostGIS |
| Multi-signal ranking (keyword + fuzzy + semantic) | Unified `searchScore` + `fullTextSearch` |
| Simplified multi-algorithm search | `fullTextSearch` + `SEARCH_SCORE_DESC` |
| Maximum control over each algorithm | Per-algorithm filters + composite orderBy |

---

## Querying via Codegen SDK

After creating search infrastructure and running codegen, you get typed filters, score fields, and orderBy enums on your SDK client.

### Simple fullTextSearch (Recommended Starting Point)

The simplest way to search -- `fullTextSearch` fans a single string to all text-compatible algorithms (tsvector, BM25, trgm) automatically:

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

`searchScore` is computed server-side -- you do NOT need to select individual score fields (`tsvRank`, `bodyBm25Score`, etc.) for it to work. Those are only needed if you want to display per-algorithm scores to the user.

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

### Per-Algorithm Filters (Maximum Control)

When you need fine-grained control -- each algorithm specified individually with a composite orderBy:

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

You can also select individual scores if you want to display them:

```typescript
select: {
  rowId: true,
  title: true,
  tsvRank: true,                 // higher = more relevant
  bodyBm25Score: true,           // more negative = more relevant
  titleTrgmSimilarity: true,     // 0..1, higher = closer
  embeddingVectorDistance: true,  // lower = closer
  searchScore: true,             // composite 0..1 blend
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

### Unified fullTextSearch + Vector

`fullTextSearch` handles text algorithms; pgvector still needs its own filter (vectors aren't text):

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

### Partial Combinations

Mix and match as needed:

```typescript
// TSVector + Trigram (no vector)
const result = await db.article.findMany({
  where: {
    tsvTsv: 'search',
    trgmTitle: { value: 'PostgreSQL', threshold: 0.05 },
  },
  orderBy: ['TSV_RANK_DESC', 'TITLE_TRGM_SIMILARITY_DESC'],
  select: { title: true, searchScore: true },
}).execute();
```

```typescript
// BM25 + Vector (semantic + keyword)
const result = await db.document.findMany({
  where: {
    bm25Body: { query: 'machine learning' },
    vectorEmbedding: { vector: queryVector, metric: 'COSINE' },
  },
  orderBy: ['BODY_BM25_SCORE_ASC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  select: { title: true, searchScore: true },
}).execute();
```

```typescript
// fullTextSearch + non-search filters
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

### Trigram Queries

Trigram provides fuzzy matching via `similarTo` / `wordSimilarTo` operators on string columns:

```typescript
const result = await db.article.findMany({
  where: {
    title: { similarTo: { value: 'postgre', threshold: 0.2 } },
  },
  orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
  select: { title: true, titleTrgmSimilarity: true },
}).execute();
```

Trigram only activates on tables with intentional search infrastructure (tsvector or BM25). To opt in without those, use the `@trgmSearch` smart tag:

```sql
COMMENT ON TABLE app_public.contacts IS E'@trgmSearch';
```

### PostGIS Spatial Queries

Spatial filters live inside `where:` alongside text search:

```typescript
// Find locations within a polygon
const result = await db.location.findMany({
  where: {
    geom: {
      coveredBy: {
        type: 'Polygon',
        coordinates: [boundingBox],
      },
    },
  },
  select: { id: true, name: true, geom: { x: true, y: true } },
}).execute();
```

```typescript
// Combine text search + spatial
const result = await db.restaurant.findMany({
  where: {
    fullTextSearch: 'italian pizza',
    location: {
      coveredBy: {
        type: 'Polygon',
        coordinates: [boundingBox],
      },
    },
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: { name: true, searchScore: true, location: { x: true, y: true } },
}).execute();
```

---

## Score Fields Reference

| Field | Type | Populated When | Direction |
|-------|------|----------------|-----------|
| `tsvRank` | `Float` | tsvector filter active | Higher = better |
| `bodyBm25Score` | `Float` | BM25 filter active | More negative = better |
| `titleTrgmSimilarity` | `Float` | trgm filter active | Higher = closer (0..1) |
| `embeddingVectorDistance` | `Float` | pgvector filter active | Lower = closer |
| `searchScore` | `Float` | Any search filter active | Higher = more relevant (0..1) |

**`searchScore` does not require selecting individual score fields.** It is computed server-side from the active filters. Individual score fields return `null` when their corresponding filter is not active.

## Filter Fields Reference

| Filter | Input | Description |
|--------|-------|-------------|
| `tsvTsv` | `String` | TSVector full-text query |
| `bm25Body` | `{ query }` | BM25 ranked search |
| `trgmTitle` | `{ value, threshold? }` | Trigram similarity |
| `vectorEmbedding` | `{ vector, metric?, distance? }` | Vector similarity |
| `fullTextSearch` | `String` | Composite: fans to tsvector + BM25 + trgm |

Field names follow the pattern `{filterPrefix}{ColumnName}` -- exact names depend on your columns.

## OrderBy Reference

| Enum | Sort Direction | Meaning |
|------|---------------|---------|
| `TSV_RANK_DESC` | Best first | Higher rank = more relevant |
| `BODY_BM25_SCORE_ASC` | Best first | More negative = more relevant |
| `TITLE_TRGM_SIMILARITY_DESC` | Best first | Higher similarity = closer match |
| `EMBEDDING_VECTOR_DISTANCE_ASC` | Best first | Lower distance = closer |
| `SEARCH_SCORE_DESC` | Best first | Higher composite = more relevant |

---

## Per-Algorithm Reference Files

Each reference covers both **creating** the search setup via SDK and **querying** via the codegen SDK:

- `search-tsvector.md` -- Creating and querying with full-text search (tsvector + GIN)
- `search-bm25.md` -- Creating and querying with BM25 ranked search
- `search-pgvector.md` -- Creating and querying with vector similarity search (pgvector + HNSW)
- `search-trgm.md` -- Creating and querying with fuzzy text matching (pg_trgm + GIN)
- `search-postgis.md` -- Creating and querying with spatial/geospatial search (PostGIS)
- `search-composite.md` -- Combined multi-algorithm search patterns and score field reference
