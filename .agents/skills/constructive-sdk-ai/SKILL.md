---
name: constructive-sdk-ai
description: "AI and vector search on the Constructive platform — Search* blueprint nodes (SearchUnified, SearchVector), ProcessFileEmbedding/ProcessChunks for file tables, embedding worker pipeline, agentic-kit multi-provider LLM client, RAG patterns, graphile-llm plugin suite (LlmRagPlugin, MeteringPlugin, AgentDiscoveryPlugin, LlmModulePlugin, TextMutationPlugin, TextSearchPlugin), agentic-server REST API, llm_module per-database config, agent sub-agent hierarchy, and embedding_model/embedding_provider parameters. Use when adding AI search, building RAG pipelines, working with embeddings, adding file/image embeddings, chunking, integrating LLM providers (Ollama, Anthropic, OpenAI), 'graphile-llm', 'agentic-server', 'llm_module', 'ragQuery', 'embedText', 'agent hierarchy', 'sub-agents', 'is_ephemeral', or 'embedding worker'."
metadata:
  author: constructive-io
  version: "4.0.0"
---

# Constructive AI

Build AI-powered features on Constructive using Search* blueprint nodes, ProcessFileEmbedding for file tables, the embedding worker pipeline, and agentic-kit for LLM inference.

## When to Apply

Use this skill when:
- Adding vector search / embeddings to a Constructive table (SearchUnified, SearchVector nodes)
- Adding file/image embeddings to a storage table (ProcessFileEmbedding, ProcessImageEmbedding nodes)
- Adding standalone chunking to any table (ProcessChunks node)
- Building RAG (Retrieval-Augmented Generation) pipelines on Constructive
- Integrating LLM providers (Ollama, Anthropic, OpenAI) via agentic-kit
- Understanding the embedding worker pipeline (stale detection -> job enqueue -> embed -> store)

## Architecture

```
Blueprint Definition (SearchUnified / SearchVector / ProcessFileEmbedding / ProcessChunks nodes)
  |
  v
construct_blueprint() -- creates:
  * vector(N) column + HNSW index
  * embedding_text composite field + concat trigger (SearchUnified)
  * {field_name}_updated_at timestamp + stale-marking triggers
  * enqueue_embedding job trigger
  * BM25 index, FTS tsvector, trgm tags (SearchUnified only)
  * extraction fields + MIME-scoped job trigger (ProcessFileEmbedding)
  * chunks table with per-chunk embeddings (ProcessChunks / ProcessFileEmbedding extract mode)
  |
  v
Row INSERT/UPDATE fires stale trigger / job trigger
  |
  v
Job enqueued via app_jobs
  |
  v
Worker processes job:
  * embed_record: generates embedding via agentic-kit
  * process_file_embedding: extracts text from files, generates embeddings
  * generate_chunks: splits text into chunks, embeds each chunk
  |
  v
ORM queries with vectorEmbedding filter + distance ordering
  |
  v
RAG: retrieve context via ORM -> feed to LLM via agentic-kit
```

## Search* Blueprint Nodes

### SearchUnified (primary -- use for most tables)

The most powerful node. Orchestrates embedding + BM25 + optional FTS + optional trigram in one declaration.

**What it auto-creates:**
- `embedding_text` composite field + `concat_ws` trigger (from `source_fields`)
- `embedding vector(768)` column + HNSW index (via SearchVector)
- `{field_name}_updated_at timestamp` + stale-marking triggers
- `enqueue_embedding` job trigger
- BM25 index on `embedding_text`
- TSVector field + GIN index + populate trigger (if `full_text_search` configured)
- `@trgmSearch` smart tags (if `trgm_fields` configured)
- `@searchConfig` smart tag with unified weights

```typescript
// Blueprint definition -- contacts table with full search stack
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
    { name: 'first_name', type: { name: 'text' }, is_required: true },
    { name: 'last_name', type: { name: 'text' } },
    { name: 'headline', type: { name: 'text' } },
    { name: 'bio', type: { name: 'text' } },
    { name: 'embedding_text', type: { name: 'text' } },
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
    { name: 'url', type: { name: 'text' }, is_required: true },
    { name: 'meta', type: { name: 'jsonb' } },
  ],
}
```

**Secondary embedding on a table that already has SearchUnified:**

```typescript
// rules table -- primary search + secondary trigger_concept embedding
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
| `include_updated_at` | `true` | Create `{field_name}_updated_at` timestamp + stale-marking triggers |
| `enqueue_job` | `true` | Create job trigger to auto-enqueue embedding generation |
| `job_task_name` | `'generate_embedding'` | Graphile Worker task name for the embedding job |
| `source_fields` | (optional) | Fields to watch for stale-marking triggers |
| `chunks_config` | (optional) | Enable chunk table for long text. Sub-options: `content_field_name` (default `'content'`), `chunk_size` (default `1000`), `chunk_overlap` (default `200`), `chunk_strategy` (default `'fixed'`), `enqueue_chunking_job` (default `true`), `chunking_task_name` (default `'generate_chunks'`) |

## File Embedding Nodes

### ProcessFileEmbedding (generic, MIME-scoped)

The primary node for adding embeddings to file/storage tables. Composes SearchVector + JobTrigger + ProcessChunks internally. Two modes:

- **Direct mode** (default): whole-file to single vector (e.g., CLIP for images). Omit `extraction`.
- **Extract mode**: file to text to chunks to per-chunk vectors. Provide `extraction` config.

Multiple instances coexist on the same table with different MIME scopes.

**Direct mode (image embeddings):**

```typescript
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessFileEmbedding', data: {
      mime_patterns: ['image/%'],
      dimensions: 512,
      task_identifier: 'process_image_embedding',
    }},
  ],
}
```

**Extract mode (document embeddings with chunking):**

```typescript
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessFileEmbedding', data: {
      mime_patterns: ['application/pdf', 'text/%', 'application/vnd.openxmlformats-officedocument.*'],
      dimensions: 768,
      task_identifier: 'process_document_extraction',
      extraction: {
        text_field: 'extracted_text',
        metadata_field: 'extracted_metadata',
      },
      chunks: {
        chunk_size: 1000,
        chunk_overlap: 200,
        chunk_strategy: 'paragraph',
      },
    }},
  ],
}
```

Chunks are enabled by default in extract mode (`include_chunks: true`). Set `include_chunks: false` to disable.

**Multi-modal -- three pipelines on one files table:**

```typescript
nodes: [
  ...STORAGE_NODES,
  // CLIP visual embeddings for images
  { $type: 'ProcessFileEmbedding', data: {
    field_name: 'image_embedding',
    mime_patterns: ['image/%'],
    dimensions: 512,
    task_identifier: 'process_image_embedding',
  }},
  // Text extraction + chunked embeddings for documents
  { $type: 'ProcessFileEmbedding', data: {
    field_name: 'document_embedding',
    mime_patterns: ['application/pdf', 'text/%'],
    dimensions: 768,
    task_identifier: 'process_document_extraction',
    extraction: {},
  }},
  // Transcription + chunked embeddings for audio/video
  { $type: 'ProcessFileEmbedding', data: {
    field_name: 'media_embedding',
    mime_patterns: ['audio/%', 'video/%'],
    dimensions: 768,
    task_identifier: 'process_media_transcription',
    extraction: {},
  }},
],
```

For the full parameter reference, see the `constructive-jobs` skill.

### ProcessImageEmbedding (image preset)

Thin preset of ProcessFileEmbedding with image-oriented defaults (`dimensions: 512`, `mime_patterns: ['image/%']`, `task_identifier: 'process_image_embedding'`). All ProcessFileEmbedding parameters are accepted.

```typescript
// Equivalent to ProcessFileEmbedding with image defaults
{ $type: 'ProcessImageEmbedding' }
```

### ProcessChunks (standalone chunking)

Standalone node that creates a child chunks table for any parent table. Each chunk gets its own embedding vector. Composed automatically by ProcessFileEmbedding in extract mode, but can be used independently.

```typescript
// Add chunking to a table with text content
{
  ref: 'articles',
  table_name: 'articles',
  nodes: [
    'DataId',
    'DataTimestamps',
    { $type: 'ProcessChunks', data: {
      chunk_size: 1000,
      chunk_overlap: 200,
      chunk_strategy: 'paragraph',
      dimensions: 768,
    }},
  ],
  fields: [
    { name: 'title', type: { name: 'text' }, is_required: true },
    { name: 'body', type: { name: 'text' } },
  ],
}
```

The chunks table inherits RLS from the parent and includes: `content` (text), `chunk_index` (integer), `embedding` (vector), `metadata` (jsonb), plus an HNSW index.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `content_field_name` | `'content'` | Text column in chunks table |
| `chunk_size` | `1000` | Max characters per chunk |
| `chunk_overlap` | `200` | Overlap between chunks |
| `chunk_strategy` | `'paragraph'` | `'fixed'`, `'sentence'`, `'paragraph'`, `'semantic'` |
| `dimensions` | `768` | Per-chunk embedding dimensions |
| `metric` | `'cosine'` | HNSW index metric |
| `chunks_table_name` | `'{parent}_chunks'` | Override table name |
| `metadata_fields` | — | Parent fields to copy into chunk metadata |
| `enqueue_chunking_job` | `true` | Auto-enqueue chunking job |
| `chunking_task_name` | `'generate_chunks'` | Job task name |

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

With ProcessChunks (standalone or via ProcessFileEmbedding extract mode), the chunks table is created automatically -- no need for manual `chunkTable()` / `hasManyChunks()` wiring.

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

## SearchVector `embedding_model` / `embedding_provider` Parameters

All Search* and Process* blueprint nodes accept optional `embedding_model` and `embedding_provider` parameters. These flow into the job payload so the embedding worker knows which model/provider to use:

```typescript
{ $type: 'SearchVector', data: {
  field_name: 'embedding',
  embedding_model: 'nomic-embed-text',
  embedding_provider: 'ollama',
}}
```

When omitted, the worker falls back to runtime config (llm_module → env vars).

Supported on: `SearchVector`, `SearchUnified` (inside `embedding`), `ProcessFileEmbedding`, `ProcessImageEmbedding`, `ProcessChunks`.

---

## graphile-llm Plugin Suite

The `graphile-llm` package provides server-side LLM integration for PostGraphile v5. Entry point: `GraphileLlmPreset({ defaultEmbedder, defaultChatCompleter, enableRag })`.

| Plugin | Purpose |
|---|---|
| **LlmModulePlugin** | Resolves per-database LLM provider configuration from `api_modules.llm_module`. Makes `build.llmEmbedder` and `build.llmChatCompleter` available to other plugins. Resolution order: llm_module → preset defaults → env vars → null (disabled). |
| **LlmRagPlugin** | Adds `ragQuery` root GraphQL field (embed prompt → pgvector chunk search → context assembly → LLM generation) and `embedText` for standalone text-to-vector conversion. |
| **LlmMeteringPlugin** | Billing-aware wrappers for embedder and chat functions. Checks `check_billing_quota` before calls, calls `record_usage` after. Uses real token counting. When quota is exceeded, embedder returns null (search falls back to text-only). |
| **AgentDiscoveryPlugin** | Discovers agent tables by querying `agent_chat_module` config table at runtime. Results cached per-database with 60s TTL. Returns `{ thread, message, task }` table info. |
| **LlmTextMutationPlugin** | Text companion fields for pgvector columns — write text, server embeds automatically. |
| **LlmTextSearchPlugin** | Text-based search fields that embed the query server-side before pgvector lookup. |

### llm_module

Per-database LLM provider configuration stored in `services_public.api_modules`. The `LlmModulePlugin` reads this at schema build time to resolve which embedder/chat provider to use per database.

This enables multi-tenant deployments where each database can use a different LLM provider (e.g. database A uses OpenAI, database B uses Ollama).

---

## agentic-server

Standalone Express REST service for agent conversations. Lives in `packages/agentic-server`.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| POST | `/v1/threads` | Create a new conversation thread |
| POST | `/v1/threads/:thread_id/messages` | Send message + stream LLM response |
| POST | `/v1/orgs/:entity_id/threads` | Create thread (entity-scoped) |
| POST | `/v1/orgs/:entity_id/threads/:thread_id/messages` | Send message (entity-scoped) |
| POST | `/v1/embed` | Generate embedding for text |

**Features:**
- Streaming responses (SSE)
- Automatic billing metering (`check_billing_quota` + `record_usage`)
- Inference logging for audit/debugging
- RLS-enforced thread/message access
- Requires `agent_module` provisioned on the database

---

## Agent Sub-Agent Hierarchy

The `agent` table (provisioned by `agent_module`) has a self-referential `parent_id` FK for delegation hierarchies:

| Column | Type | Description |
|---|---|---|
| `parent_id` | uuid | FK → self (agent table). Creates parent/child delegation tree. |
| `is_ephemeral` | boolean | If true, agent is destroyed when its spawning thread ends. |

This enables patterns like:
- A coordinator agent spawning specialist sub-agents
- Thread-scoped ephemeral agents that auto-terminate
- Multi-level delegation chains

---

## agentic-kit (LLM Client)

Multi-provider LLM abstraction for embedding generation and inference. See [agentic-kit.md](./references/agentic-kit.md) for the full API reference.

> **Note:** `@agentic-kit/ollama` is the built-in provider. `@agentic-kit/anthropic` and `@agentic-kit/openai` are optional external packages — install them separately if needed.

```typescript
import OllamaClient from '@agentic-kit/ollama';

// Embeddings
const client = new OllamaClient('http://localhost:11434');
const embedding = await client.generateEmbedding('document text', 'nomic-embed-text');

// Generation
const answer = await client.generate({ model: 'llama3.2', prompt: 'What is pgvector?' });
```

---

## Embedding Worker Pipeline

The embedding pipeline uses job triggers to enqueue work:

1. Row INSERT/UPDATE fires stale trigger
2. Job trigger enqueues `generate_embedding` / `process_file_embedding` / `generate_chunks`
3. Knative worker picks up the job and processes it

> **Note:** The SQL triggers for enqueuing these jobs are fully provisioned by the blueprint nodes. The Knative worker handlers for `generate_embedding`, `process_file_embedding`, and `generate_chunks` consume job payloads from the queue. See `constructive-jobs` for the worker pipeline architecture.

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|---------------|
| [rag-pipeline.md](./references/rag-pipeline.md) | RAG pipeline patterns | Building end-to-end RAG (embed → store → retrieve → generate) |
| [agentic-kit.md](./references/agentic-kit.md) | agentic-kit multi-provider LLM | Embedding generation, LLM inference, streaming, multi-provider setup |

## Cross-References

- `constructive-jobs` — ProcessFileEmbedding/ProcessChunks full parameter reference, JobTrigger, Knative worker pipeline
- `constructive-sdk-graphql` — [search-pgvector.md](../constructive-sdk-graphql/references/search-pgvector.md): ORM query patterns for vector search
- `constructive-sdk-graphql` — [search-rag.md](../constructive-sdk-graphql/references/search-rag.md): RAG patterns with codegen'd ORM
- `constructive-sdk-graphql` — [search-composite.md](../constructive-sdk-graphql/references/search-composite.md): Combining pgvector with tsvector/BM25/trgm
- `graphile-search` — Plugin internals for the unified search system (team-level)
- `constructive-db-data-modules` — SQL-level reference for Search* generators
