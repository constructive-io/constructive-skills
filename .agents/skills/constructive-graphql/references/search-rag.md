# RAG Patterns with Codegen'd ORM

Use the codegen'd ORM to build Retrieval-Augmented Generation (RAG) pipelines. This reference covers vector search via the ORM, context retrieval, and integration with LLM providers via [agentic-kit](../../constructive-ai/references/agentic-kit.md).

## Prerequisites

1. **Vector column** provisioned on your table (via `@constructive-io/sdk` — see `constructive-ai` skill)
2. **HNSW index** created on the embedding column
3. **Codegen'd SDK** generated via `@constructive-io/graphql-codegen` (see `constructive-graphql` skill — [codegen.md](./codegen.md))
4. **Ollama** (or another provider) running for embeddings and chat

## Vector Search via ORM

The codegen'd ORM exposes `vectorEmbedding` as a `where` filter and `embeddingVectorDistance` as a selectable score field:

```typescript
import { createClient } from '@your-project/sdk';

const db = createClient({ adapter });

// Basic vector search — find similar documents
const results = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryEmbedding,   // number[] from embedding model
      metric: 'COSINE',         // COSINE | L2 | IP
      distance: 2.0,            // max distance threshold
    },
  },
  first: 5,
  select: {
    id: true,
    title: true,
    content: true,
    embeddingVectorDistance: true,  // cosine distance (lower = more similar)
  },
}).execute();
```

### Distance Metrics

| Metric | ORM Value | Operator | Sort | Use Case |
|--------|-----------|----------|------|----------|
| Cosine | `'COSINE'` | `<=>` | ASC (lower = closer) | Normalized embeddings (recommended) |
| Euclidean | `'L2'` | `<->` | ASC | Absolute distance |
| Inner Product | `'IP'` | `<#>` | ASC (more negative = closer) | Un-normalized embeddings |

### Converting Distance to Similarity Score

```typescript
// Cosine distance → similarity (0..1, higher = more similar)
const similarity = Math.max(0, 1 - (node.embeddingVectorDistance / 2.0));
```

## Single-Table RAG

The simplest RAG pattern: embed question → vector search → format context → LLM answer.

```typescript
import OllamaClient from '@agentic-kit/ollama';
import { createOllamaKit } from 'agentic-kit';

const ollamaClient = new OllamaClient('http://localhost:11434');
const kit = createOllamaKit('http://localhost:11434');

async function ragQuery(question: string): Promise<string> {
  // 1. Embed the question
  const queryEmbedding = await ollamaClient.generateEmbedding(question);

  // 2. Vector search via ORM
  const results = await db.document.findMany({
    where: {
      vectorEmbedding: {
        vector: queryEmbedding,
        metric: 'COSINE',
        distance: 2.0,
      },
    },
    first: 5,
    select: {
      id: true,
      title: true,
      content: true,
      embeddingVectorDistance: true,
    },
  }).execute();

  const nodes = results.data?.documents?.nodes || [];

  // 3. Format context
  const context = nodes
    .map((n, i) => `[${i + 1}] ${n.title}: ${n.content}`)
    .join('\n\n');

  // 4. Generate answer
  return kit.generate({
    model: 'llama3.2',
    system: 'Answer based on the provided context. If the answer is not in the context, say so.',
    messages: [
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  }) as Promise<string>;
}
```

## Multi-Table RAG

Search across multiple entity types in parallel, merge results by distance:

```typescript
const VECTOR_WHERE = (embedding: number[]) => ({
  vectorEmbedding: { vector: embedding, metric: 'COSINE' as const, distance: 2.0 },
});

interface RAGResult {
  table: string;
  id: string;
  label: string;
  distance: number;
  data: Record<string, any>;
}

async function multiTableRAG(question: string): Promise<RAGResult[]> {
  const embedding = await ollamaClient.generateEmbedding(question);
  const where = VECTOR_WHERE(embedding);

  const [contacts, documents, notes] = await Promise.all([
    db.contact.findMany({
      where, first: 5,
      select: { id: true, firstName: true, lastName: true, bio: true, embeddingVectorDistance: true },
    }).execute(),
    db.document.findMany({
      where, first: 5,
      select: { id: true, title: true, content: true, embeddingVectorDistance: true },
    }).execute(),
    db.note.findMany({
      where, first: 5,
      select: { id: true, content: true, embeddingVectorDistance: true },
    }).execute(),
  ]);

  const results: RAGResult[] = [
    ...(contacts.data?.contacts?.nodes || []).map(n => ({
      table: 'contacts', id: n.id,
      label: `${n.firstName} ${n.lastName}`,
      distance: n.embeddingVectorDistance ?? 2,
      data: n,
    })),
    ...(documents.data?.documents?.nodes || []).map(n => ({
      table: 'documents', id: n.id,
      label: n.title || 'Untitled',
      distance: n.embeddingVectorDistance ?? 2,
      data: n,
    })),
    ...(notes.data?.notes?.nodes || []).map(n => ({
      table: 'notes', id: n.id,
      label: (n.content || '').slice(0, 80),
      distance: n.embeddingVectorDistance ?? 2,
      data: n,
    })),
  ];

  return results.sort((a, b) => a.distance - b.distance);
}
```

## Embedding Ingestion

Store embeddings via ORM update (not raw SQL):

```typescript
async function embedRecords(
  model: { findMany: Function; update: Function },
  textFields: string[],
  selectFields: Record<string, boolean>
) {
  const result = await model.findMany({
    select: { id: true, embedding: true, ...selectFields },
  }).execute();

  const dataKey = Object.keys(result.data || {})[0];
  const records = (result.data as any)[dataKey]?.nodes || [];
  const needsEmbedding = records.filter((n: any) => !n.embedding);

  for (const record of needsEmbedding) {
    const text = textFields.map(f => record[f]).filter(Boolean).join('. ');
    if (!text.trim()) continue;

    const embedding = await ollamaClient.generateEmbedding(text);
    await model.update({
      where: { id: record.id },
      data: { embedding },
    }).execute();
  }
}

// Usage
await embedRecords(
  db.contact,
  ['firstName', 'lastName', 'headline', 'bio'],
  { firstName: true, lastName: true, headline: true, bio: true }
);
```

## Combining Vector Search with Text Search

Use pgvector alongside `unifiedSearch` for hybrid retrieval:

```typescript
// Hybrid: vector similarity + keyword matching
const results = await db.document.findMany({
  where: {
    unifiedSearch: 'machine learning',
    vectorEmbedding: {
      vector: queryEmbedding,
      metric: 'COSINE',
      distance: 1.5,
    },
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    id: true,
    title: true,
    searchScore: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

## 3-Pass RAG with Query Routing

For applications with many tables, use an LLM to route which tables to search before doing vector retrieval:

```typescript
async function routedRAG(question: string) {
  const allTables = ['contacts', 'documents', 'notes', 'tasks', 'events'];

  // Pass 1: Route — LLM decides which tables to search
  const routerResponse = await kit.generate({
    model: 'llama3.2',
    prompt: `You are a query router. Available tables: ${allTables.join(', ')}
Reply with a JSON array of table names to search.
Question: ${question}
JSON array only:`,
  }) as string;

  let tables = allTables;
  const match = routerResponse.match(/\[.*\]/s);
  if (match) {
    tables = JSON.parse(match[0]).filter((t: string) => allTables.includes(t));
  }

  // Pass 2: Search — vector search selected tables
  const embedding = await ollamaClient.generateEmbedding(question);
  const results = await multiTableRAG(question); // from above
  const topResults = results.filter(r => tables.includes(r.table)).slice(0, 10);

  // Pass 3: Synthesize — LLM generates answer from context
  const context = topResults.map((r, i) =>
    `[Source ${i + 1}] (${r.table}) ${r.label}\n${JSON.stringify(r.data)}`
  ).join('\n\n');

  return kit.generate({
    model: 'llama3.2',
    system: 'Answer based on the provided CRM context. Be concise and specific.',
    messages: [
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  }) as Promise<string>;
}
```

## Cross-References

- [search-pgvector.md](./search-pgvector.md): Creating vector columns, HNSW indexes, distance metrics
- [search-composite.md](./search-composite.md): Unified `unifiedSearch` + `searchScore` for hybrid search
- `constructive-ai` — [agentic-kit.md](../../constructive-ai/references/agentic-kit.md): Multi-provider LLM abstraction (Ollama, Anthropic, OpenAI)
- `constructive-ai` — [rag-pipeline.md](../../constructive-ai/references/rag-pipeline.md): End-to-end RAG pipeline architecture
