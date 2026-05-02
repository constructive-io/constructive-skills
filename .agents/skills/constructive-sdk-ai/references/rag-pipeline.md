# RAG Pipeline on Constructive

Build Retrieval-Augmented Generation pipelines using Search* blueprint nodes, the embedding worker, and agentic-kit for LLM inference.

---

## Architecture

```
Blueprint (SearchUnified node)
  → construct_blueprint() creates vector column, HNSW index, stale triggers, job triggers
  → Row changes fire stale trigger → embed_record job enqueued
  → Graphile Worker embeds via @agentic-kit/ollama → writes back via ORM
  → ORM queries with vectorEmbedding filter → context → LLM generation
```

### Components

1. **Blueprint**: SearchUnified / SearchVector nodes declare vector columns + indexes + stale tracking
2. **Codegen**: `@constructive-io/graphql-codegen` generates typed ORM with vector query support (see `constructive-sdk-graphql` skill — [codegen.md](../../constructive-sdk-graphql/references/codegen.md))
3. **Worker**: Graphile Worker `embed_record` task handles embedding generation + chunking
4. **Query**: ORM `vectorEmbedding` filter + distance ordering
5. **Generation**: agentic-kit feeds retrieved context to LLM

---

## Step 1: Define Blueprint with SearchUnified

```typescript
const definition: BlueprintDefinition = {
  tables: [
    {
      ref: 'documents',
      table_name: 'documents',
      nodes: [
        'DataId',
        'DataTimestamps',
        { $type: 'SearchUnified', data: {
          embedding: { source_fields: ['title', 'content'], chunks: {} },
          bm25: { field_name: 'embedding_text' },
        }},
      ],
      fields: [
        { name: 'title', type: 'text', is_required: true },
        { name: 'content', type: 'text', is_required: true },
        { name: 'category', type: 'text' },
        { name: 'embedding_text', type: 'text' },
      ],
    },
    chunkTable('documents'),
  ],
  relations: [
    hasManyChunks('documents'),
  ],
};

await provisionBlueprint(definition, 'Documents Schema');
```

After provisioning, run codegen to generate the typed ORM.

---

## Step 2: Embedding Worker

The `embed_record` Graphile Worker task handles embedding automatically when `enqueue_job: true` (the default for SearchUnified/SearchVector):

1. Row INSERT/UPDATE → stale trigger marks `embedding_stale = true`
2. Job trigger enqueues `embed_record` with `{ schema, table, id }`
3. Worker fetches record via ORM, concatenates text fields
4. If text > 6000 chars: splits into ~3200-char overlapping chunks, embeds each into the chunk table
5. Embeds summary into parent record
6. Sets `embedding_stale = false`

```typescript
// Worker task (simplified from agentic-db/packages/worker)
import OllamaClient from '@agentic-kit/ollama';

const ollamaClient = new OllamaClient(process.env.OLLAMA_URL || 'http://localhost:11434');
const embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

// Generate 768-dim embedding
const embedding = await ollamaClient.generateEmbedding(text, embeddingModel);

// Write back via ORM
await db.document.update({
  where: { id },
  data: { embedding, embeddingText: text },
  select: { id: true },
}).execute();
```

---

## Step 3: Retrieve Context via ORM

```typescript
import OllamaClient from '@agentic-kit/ollama';

const ollamaClient = new OllamaClient();

async function retrieveContext(question: string, limit = 5): Promise<string> {
  const queryEmbedding = await ollamaClient.generateEmbedding(question, 'nomic-embed-text');

  const result = await db.document.findMany({
    where: {
      vectorEmbedding: {
        vector: queryEmbedding,
        metric: 'COSINE',
        distance: 0.5,
      },
    },
    orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
    first: limit,
    select: {
      content: true,
      embeddingVectorDistance: true,
    },
  }).execute();

  if (!result.ok) return '';

  return result.data.documents.nodes
    .map(d => d.content)
    .join('\n\n');
}
```

### Combining Vector Search with Other Filters

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryEmbedding,
      metric: 'COSINE',
    },
    category: { equalTo: 'technical' },
    isPublished: { equalTo: true },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 5,
  select: {
    title: true,
    content: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

### Hybrid Search: Vector + Text

```typescript
const result = await db.document.findMany({
  where: {
    unifiedSearch: 'machine learning',
    vectorEmbedding: {
      vector: queryEmbedding,
      metric: 'COSINE',
    },
  },
  orderBy: ['SEARCH_SCORE_DESC', 'EMBEDDING_VECTOR_DISTANCE_ASC'],
  first: 5,
  select: {
    title: true,
    content: true,
    searchScore: true,
  },
}).execute();
```

> See `constructive-sdk-graphql` ([search-composite.md](../../constructive-sdk-graphql/references/search-composite.md)) for full combined search patterns.

---

## Step 4: Multi-Collection RAG

Search across multiple entity types using the codegen'd ORM:

```typescript
const VECTOR_CONDITION = (queryEmbedding: number[]) => ({
  vectorEmbedding: { vector: queryEmbedding, metric: 'COSINE' as const, distance: 2.0 },
});

async function multiTableSearch(query: string) {
  const queryEmbedding = await ollamaClient.generateEmbedding(query, 'nomic-embed-text');
  const where = VECTOR_CONDITION(queryEmbedding);

  const [contacts, documents, notes] = await Promise.all([
    db.contact.findMany({
      where, first: 5,
      select: { id: true, firstName: true, lastName: true, embeddingVectorDistance: true },
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

  return [
    ...(contacts.data?.contacts?.nodes || []).map(n => ({ ...n, table: 'contacts' })),
    ...(documents.data?.documents?.nodes || []).map(n => ({ ...n, table: 'documents' })),
    ...(notes.data?.notes?.nodes || []).map(n => ({ ...n, table: 'notes' })),
  ].sort((a, b) => (a.embeddingVectorDistance ?? 2) - (b.embeddingVectorDistance ?? 2));
}
```

---

## Step 5: Generate Response with agentic-kit

```typescript
import { createOllamaKit } from 'agentic-kit';

const kit = createOllamaKit('http://localhost:11434');

async function ragQuery(question: string): Promise<string> {
  const context = await retrieveContext(question);

  return kit.generate({
    model: 'llama3.2',
    system: 'Answer based on the provided context. If the context lacks info, say so.',
    messages: [
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  }) as Promise<string>;
}
```

### Streaming

```typescript
await kit.generate(
  {
    model: 'llama3.2',
    system: 'Answer based on the provided context.',
    messages: [{ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` }],
  },
  {
    onChunk: (chunk) => process.stdout.write(chunk),
    onComplete: () => console.log('\nDone'),
  }
);
```

---

## Embedding Models

| Model | Dimensions | Speed | Quality | Provider |
|-------|------------|-------|---------|----------|
| `nomic-embed-text` | 768 | Fast | Good | Ollama (local, recommended) |
| `mxbai-embed-large` | 1024 | Medium | Better | Ollama (local) |
| `all-minilm` | 384 | Very Fast | Acceptable | Ollama (local) |

---

## Chunking Strategy

The embedding worker uses these defaults (from agentic-db):

| Parameter | Value | Notes |
|-----------|-------|-------|
| Chunk threshold | 6000 chars | Text below this is embedded directly |
| Chunk size | 3200 chars | ~800 tokens per chunk |
| Chunk overlap | 400 chars | ~100 tokens overlap for context continuity |
| Summary prefix | 4000 chars | First N chars used for parent record embedding |

Chunk tables are auto-created via `chunkTable()` in the blueprint definition.

---

## Best Practices

- **Use SearchUnified** for tables that need the full search stack (embedding + BM25 + FTS + trigram)
- **Use SearchVector** for standalone embedding columns or secondary embeddings
- **Set `enqueue_job: false`** on SearchVector if you handle embedding externally (e.g. image embeddings)
- **Match dimensions** to your embedding model (768 for nomic-embed-text)
- **Use `distance` threshold** in ORM queries to filter low-quality matches

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "type vector does not exist" | Use pgvector-enabled image (`docker.io/constructiveio/postgres-plus:18`) |
| Embeddings not generated | Check worker is running + `enqueue_job: true` in SearchVector config |
| `embedding_stale` stays true | Worker not processing jobs; check graphile-worker logs |
| Dimension mismatch | Ensure SearchVector `dimensions` matches embedding model output (768 for nomic-embed-text) |
| Irrelevant RAG responses | Lower similarity threshold, improve chunking, check source_fields |

## Cross-References

- `constructive-sdk-graphql` — [search-pgvector.md](../../constructive-sdk-graphql/references/search-pgvector.md): Full ORM query reference for pgvector
- `constructive-sdk-graphql` — [search-composite.md](../../constructive-sdk-graphql/references/search-composite.md): Hybrid search (vector + text)
- [agentic-kit.md](./agentic-kit.md): Multi-provider LLM client API reference
