---
name: constructive-search
description: "All search strategies — tsvector full-text, BM25, trigram, pgvector semantic, PostGIS spatial, unified composite search, and RAG patterns. Use when asked to 'add search', 'full-text search', 'tsvector', 'BM25', 'trigram', 'pgvector', 'PostGIS', 'unified search', 'searchScore', 'unifiedSearch', 'semantic search', 'vector search', 'spatial search', 'RAG search', or when working with Search* blueprint nodes or graphile-search adapters."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Search

All search strategies available on the Constructive platform — from keyword search to semantic vector similarity, unified into a single composable system.

## When to Apply

Use this skill when:
- Adding any kind of search to a table (text, semantic, spatial)
- Choosing between search strategies for a use case
- Using the unified `unifiedSearch` / `searchScore` system
- Configuring Search* blueprint nodes (SearchUnified, SearchVector, SearchFullText)
- Working with the graphile-search plugin and its adapters
- Building RAG (retrieval-augmented generation) pipelines

## Search Strategy Overview

| Strategy | Best For | Technology | Score |
|----------|----------|------------|-------|
| **TSVector** | Keyword search with stemming | PostgreSQL `tsvector` + GIN | Higher = better |
| **BM25** | Relevance-ranked text search | ParadeDB `pg_search` | Higher = better |
| **Trigram** | Fuzzy / typo-tolerant matching | `pg_trgm` extension | Lower = better (distance) |
| **pgvector** | Semantic / embedding similarity | `pgvector` HNSW | Lower = better (distance) |
| **PostGIS** | Spatial / geographic search | `postgis` extension | Lower = better (distance) |
| **Unified** | Fan-out across all strategies | Composite `searchScore` | Normalized 0–1 |

## Quick Start: Unified Search

The simplest way — `unifiedSearch` fans a single string to all text-compatible algorithms:

```typescript
const results = await db.article.findMany({
  where: { unifiedSearch: 'machine learning' },
  orderBy: 'SEARCH_SCORE_DESC',
  select: { title: true, searchScore: true },
}).execute();
```

## Blueprint Nodes

### SearchUnified (full stack — recommended for most tables)

Orchestrates embedding + BM25 + optional FTS + optional trigram:

```json
{ "$type": "SearchUnified", "data": {
  "embedding": { "source_fields": ["name", "description"] },
  "bm25": { "field_name": "embedding_text" },
  "full_text_search": {
    "field_name": "search_tsv",
    "source_fields": [
      { "field": "name", "weight": "A" },
      { "field": "description", "weight": "B" }
    ]
  },
  "trgm_fields": ["name"]
}}
```

### SearchVector (standalone embeddings)

For tables needing only vector search (no BM25/FTS/trigram):

```json
{ "$type": "SearchVector", "data": { "field_name": "embedding" } }
```

### SearchFullText (standalone tsvector)

For tables needing only full-text search:

```json
{ "$type": "SearchFullText", "data": {
  "field_name": "search_tsv",
  "source_fields": [{ "field": "title", "weight": "A" }]
}}
```

## graphile-search Plugin

Unified PostGraphile v5 search plugin that consolidates all strategies into a single adapter-based architecture. Each strategy is a `SearchAdapter`:

- `TsvectorAdapter` — PostgreSQL full-text search
- `Bm25Adapter` — ParadeDB BM25 ranking
- `TrgmAdapter` — pg_trgm fuzzy matching
- `PgvectorAdapter` — HNSW vector similarity
- `PostgisAdapter` — spatial distance queries

## References

| File | Content |
|------|---------|
| [search-tsvector.md](./references/search-tsvector.md) | TSVector full-text search patterns |
| [search-bm25.md](./references/search-bm25.md) | BM25 relevance ranking |
| [search-trigram.md](./references/search-trigram.md) | Trigram fuzzy matching |
| [search-pgvector.md](./references/search-pgvector.md) | Vector similarity search |
| [search-postgis.md](./references/search-postgis.md) | Spatial / geographic search |
| [search-composite.md](./references/search-composite.md) | Unified composite search patterns |
| [search-rag.md](./references/search-rag.md) | RAG retrieval patterns |

## Cross-References

- **AI and embedding pipeline:** [`constructive-agents`](../constructive-agents/SKILL.md)
- **Blueprint nodes:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **ORM query patterns:** [`constructive-orm`](../constructive-orm/SKILL.md)
- **i18n multilingual search:** [`constructive-i18n`](../constructive-i18n/SKILL.md)
