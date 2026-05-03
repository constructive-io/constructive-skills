---
name: constructive-sdk-ai
description: "AI and vector search on the Constructive platform — Search* blueprint nodes (SearchUnified, SearchVector), embedding worker pipeline, agentic-kit multi-provider LLM client, and RAG patterns with the codegen'd ORM. Use when adding AI search to a table, building RAG pipelines, working with embeddings, or integrating LLM providers (Ollama, Anthropic, OpenAI)."
metadata:
  author: constructive-io
  version: "3.0.0"
---

# Constructive AI

Build AI-powered features on Constructive using Search* blueprint nodes, the embedding worker pipeline, and agentic-kit for LLM inference.

## When to Apply

Use this skill when:
- Adding vector search / embeddings to a Constructive table (SearchUnified, SearchVector nodes)
- Building RAG (Retrieval-Augmented Generation) pipelines on Constructive
- Integrating LLM providers (Ollama, Anthropic, OpenAI) via agentic-kit
- Understanding the embedding worker pipeline (stale detection → job enqueue → embed → store)

## Architecture

```
Blueprint Definition (SearchUnified / SearchVector nodes)
  │
  ▼
construct_blueprint() — creates:
  • vector(768) column + HNSW index
  • embedding_text composite field + concat trigger
  • embedding_stale boolean + stale-marking triggers
  • enqueue_embedding job trigger
  • BM25 index, FTS tsvector, trgm tags (SearchUnified only)
  │
  ▼
Row INSERT/UPDATE fires stale trigger → marks embedding_stale = true
  │
  ▼
Job trigger enqueues embed_record task via app_jobs
  │
  ▼
Graphile Worker (embed_record task):
  • Fetches record via ORM
  • Generates embedding via @agentic-kit/ollama (nomic-embed-text, 768-dim)
  • If text > 6000 chars: chunks into chunk table, embeds each chunk
  • Writes embedding back via ORM, sets embedding_stale = false
  │
  ▼
ORM queries with vectorEmbedding filter + distance ordering
  │
  ▼
RAG: retrieve context via ORM → feed to LLM via agentic-kit
```

## Search* Blueprint Nodes

### SearchUnified (primary — use for most tables)

The most powerful node. Orchestrates embedding + BM25 + optional FTS + optional trigram in one declaration.

**What it auto-creates:**
- `embedding_text` composite field + `concat_ws` trigger (from `source_fields`)
- `embedding vector(768)` column + HNSW index (via SearchVector)
- `embedding_stale bool` field + stale-marking triggers
- `enqueue_embedding` job trigger
- BM25 index on `embedding_text`
- TSVector field + GIN index + populate trigger (if `full_text_search` configured)
- `@trgmSearch` smart tags (if `trgm_fields` configured)
- `@searchConfig` smart tag with unified weights

```typescript
// Blueprint definition — contacts table with full search stack
{
  ref: 'contacts',
  table_name: 'contacts',
  nodes: [
    'DataId',
    'DataTimestamps',
    { $type: 'SearchUnified', data: {
      embedding: { source_fields: ['first_name', 'last_name', 'headline', 'bio'], chunks: {} },
      bm25: { field_name: 'embedding_text' },
      full_text_search: {
        field_name: 'search_tsv',
        source_fields: [
          { field: 'first_name', weight: 'A' },
          { field: 'last_name', weight: 'A' },
          { field: 'headline', weight: 'B' },
          { field: 'bio', weight: 'C' },
        ],
      },
      trgm_fields: ['first_name', 'last_name'],
    }},
  ],
  fields: [
    { name: 'first_name', type: 'text', is_required: true },
    { name: 'last_name', type: 'text' },
    { name: 'headline', type: 'text' },
    { name: 'bio', type: 'text' },
    { name: 'embedding_text', type: 'text' },
  ],
}
```

**Minimal SearchUnified (embedding + BM25 only):**

```typescript
{ $type: 'SearchUnified', data: {
  embedding: { source_fields: ['name', 'description'] },
  bm25: { field_name: 'embedding_text' },
}}
```

### SearchVector (standalone vector columns)

Use for tables that need vector embeddings but NOT the full search stack (no BM25/FTS/trigram). Example: images (visual embeddings), or secondary embedding columns.

```typescript
// Standalone embedding (no BM25, no FTS)
{
  ref: 'images',
  table_name: 'images',
  nodes: [
    'DataId',
    'DataTimestamps',
    { $type: 'SearchVector', data: { field_name: 'embedding', enqueue_job: false } },
  ],
  fields: [
    { name: 'url', type: 'text', is_required: true },
    { name: 'meta', type: 'jsonb' },
  ],
}
```

**Secondary embedding on a table that already has SearchUnified:**

```typescript
// rules table — primary search + secondary trigger_concept embedding
nodes: [
  'DataId',
  'DataTimestamps',
  { $type: 'SearchUnified', data: {
    embedding: { source_fields: ['name', 'description', 'trigger_concept'] },
    bm25: { field_name: 'embedding_text' },
  }},
  { $type: 'SearchVector', data: {
    field_name: 'trigger_concept_embedding',
    source_fields: ['trigger_concept'],
    enqueue_job: false,
  }},
],
```

### SearchVector `data` Options

| Key | Default | Description |
|-----|---------|-------------|
| `field_name` | `'embedding'` | Name of the vector column |
| `dimensions` | `768` | Vector dimensionality (768 for nomic-embed-text) |
| `index_method` | `'hnsw'` | Index method: `hnsw` or `ivfflat` |
| `metric` | `'cosine'` | Distance: `cosine`, `l2`, or `ip` (inner product) |
| `index_options` | `{}` | HNSW/IVFFlat tuning params (e.g. `{"m": 16, "ef_construction": 64}`) |
| `include_stale_field` | `true` | Create `embedding_stale` boolean + stale-marking triggers |
| `enqueue_job` | `true` | Create job trigger to auto-enqueue embedding generation |
| `job_task_name` | `'generate_embedding'` | Graphile Worker task name for the embedding job |
| `source_fields` | (optional) | Fields to watch for stale-marking triggers |
| `stale_strategy` | `'column'` | `'column'` (bool flag) or other strategies |
| `chunks_config` | (optional) | Enable chunk table for long text. Sub-options: `content_field_name` (default `'content'`), `chunk_size` (default `1000`), `chunk_overlap` (default `200`), `chunk_strategy` (default `'fixed'`), `enqueue_chunking_job` (default `true`), `chunking_task_name` (default `'generate_chunks'`) |

## Chunk Tables

Every table with embeddings can have a corresponding chunk table for long text:

```typescript
tables: [
  orgTable('contacts', [...], { data_nodes: [dataSearch({ ... })] }),
  chunkTable('contacts'),  // creates "contact_chunks" with auto SearchUnified
],
relations: [
  hasManyChunks('contacts'),  // contacts -> contact_chunks (CASCADE delete)
],
```

The embedding worker handles chunking automatically: text > 6000 chars gets split into ~3200-char overlapping chunks, each embedded separately.

## Querying via ORM

After provisioning and codegen, query embeddings via the typed ORM:

```typescript
const queryEmbedding = await ollamaClient.generateEmbedding(question);

const result = await db.contact.findMany({
  where: {
    vectorEmbedding: {
      vector: queryEmbedding,
      metric: 'COSINE',
      distance: 0.5,
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 5,
  select: {
    id: true,
    firstName: true,
    lastName: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

> For full ORM query patterns, see the `constructive-sdk-graphql` skill ([search-pgvector.md](../constructive-sdk-graphql/references/search-pgvector.md)).

## agentic-kit (LLM Client)

Multi-provider LLM abstraction for embedding generation and inference. See [agentic-kit.md](./references/agentic-kit.md) for the full API reference.

```typescript
import { createOllamaKit } from 'agentic-kit';
import OllamaClient from '@agentic-kit/ollama';

// Embeddings
const client = new OllamaClient('http://localhost:11434');
const embedding = await client.generateEmbedding('document text', 'nomic-embed-text');

// Generation (single or multi-provider)
const kit = createOllamaKit('http://localhost:11434');
const answer = await kit.generate({ model: 'llama3.2', prompt: 'What is pgvector?' });
```

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [rag-pipeline.md](./references/rag-pipeline.md) | RAG pipeline patterns | Building end-to-end RAG (embed → store → retrieve → generate) |
| [agentic-kit.md](./references/agentic-kit.md) | agentic-kit multi-provider LLM | Embedding generation, LLM inference, streaming, multi-provider setup |

## Cross-References

- `constructive-sdk-graphql` — [search-pgvector.md](../constructive-sdk-graphql/references/search-pgvector.md): ORM query patterns for vector search
- `constructive-sdk-graphql` — [search-rag.md](../constructive-sdk-graphql/references/search-rag.md): RAG patterns with codegen'd ORM
- `constructive-sdk-graphql` — [search-composite.md](../constructive-sdk-graphql/references/search-composite.md): Combining pgvector with tsvector/BM25/trgm
- `graphile-search` — Plugin internals for the unified search system (team-level)
- `constructive-db-data-modules` — SQL-level reference for Search* generators
