---
name: constructive-ai
description: "AI and vector search on the Constructive platform — provision pgvector columns and indexes via SDK, query embeddings via codegen'd ORM, build RAG pipelines with Ollama, and run LLM models in GitHub Actions CI/CD. Use when building RAG pipelines, working with embeddings, running Ollama in CI, or implementing AI-powered search within a Constructive application."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive AI

Build AI-powered features on the Constructive platform: provision vector storage via SDK, query via codegen'd ORM, and integrate Ollama for embeddings and generation.

## When to Apply

Use this skill when:
- Adding pgvector columns and indexes to a Constructive database
- Querying vector embeddings via the generated TypeScript ORM
- Building RAG (Retrieval-Augmented Generation) pipelines on Constructive
- Running Ollama LLM models in CI/CD
- Implementing AI-powered search alongside other search strategies (tsvector, BM25, trgm)

## The Constructive AI Flow

```
1. Provision  →  SDK creates vector(N) column + HNSW index on your table
2. Codegen    →  cnc codegen --orm generates typed ORM with vector query support
3. Embed      →  Application code generates embeddings (Ollama, OpenAI, etc.)
4. Store      →  ORM or SDK inserts embeddings into the vector column
5. Query      →  ORM queries with vectorEmbedding filter + distance ordering
6. RAG        →  Retrieve context via ORM → feed to LLM for generation
```

> **Important:** For vector *querying* via ORM, see the `constructive-graphql` skill ([search-pgvector.md](../constructive-graphql/references/search-pgvector.md)). This skill covers the AI/RAG layer on top.

## Quick Start: Provision + Query

### 1. Create a vector field via SDK

```typescript
const vecField = await db.field.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'embedding',
    type: 'vector(768)',
  },
  select: { id: true, name: true },
}).execute();
```

### 2. Create an HNSW index

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'idx_documents_embedding_hnsw',
    fieldIds: [vecField.data.createField.field.id],
    accessMethod: 'hnsw',
    options: { m: 16, ef_construction: 64 },
    opClasses: ['vector_cosine_ops'],
  },
  select: { id: true },
}).execute();
```

### 3. Query via codegen'd ORM

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryVector,
      metric: 'COSINE',
      distance: 0.5,
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 5,
  select: {
    id: true,
    title: true,
    content: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

### 4. Feed to LLM for RAG

```typescript
const context = result.data.documents.nodes
  .map(d => d.content)
  .join('\n\n');

const answer = await ollama.generateResponse(question, context);
```

## Ollama Integration

Use Ollama for local embedding generation and LLM inference. See [ollama.md](./references/ollama.md) for the full OllamaClient implementation, model selection, and API reference.

```typescript
const ollama = new OllamaClient();
const embedding = await ollama.generateEmbedding('document text');
const response = await ollama.generateResponse(question, context);
```

## Ollama CI/CD

Run Ollama in GitHub Actions for testing RAG pipelines. See [ollama-ci.md](./references/ollama-ci.md) for workflow templates.

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [rag-pipeline.md](./references/rag-pipeline.md) | RAG pipeline on Constructive | Building end-to-end RAG (embed → store → retrieve → generate) |
| [ollama.md](./references/ollama.md) | Ollama client & models | Generating embeddings, LLM inference, streaming, model selection |
| [ollama-ci.md](./references/ollama-ci.md) | Ollama GitHub Actions | Running LLM models in CI/CD |
| [pgvector-sql.md](./references/pgvector-sql.md) | pgvector SQL reference | Raw SQL for vector tables, indexes, similarity functions (SQL-level) |
| [agentic-kit.md](./references/agentic-kit.md) | Agentic kit RAG patterns | Building AI agents with RAG providers |

## Cross-References

- `constructive-graphql` — [search-pgvector.md](../constructive-graphql/references/search-pgvector.md): ORM query patterns for vector search (distance filters, metrics, ordering)
- `constructive-graphql` — [search-composite.md](../constructive-graphql/references/search-composite.md): Combining pgvector with tsvector/BM25/trgm in unified `searchScore`
- `graphile-search` — Plugin internals for the unified search system (team-level)
- `pgpm` — Database migrations for vector-enabled modules
