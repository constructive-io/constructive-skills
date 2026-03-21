# RAG Pipeline on Constructive

Build Retrieval-Augmented Generation pipelines using the Constructive platform: provision vector storage via SDK, query via codegen'd ORM, and generate responses with Ollama.

---

## Architecture

```
Document -> Chunking -> Embedding (Ollama) -> Store via ORM
                                                   |
Query -> Embedding -> ORM Vector Search -> Context Retrieval -> LLM Response
```

### Components

1. **Provision**: SDK creates vector columns + HNSW indexes on your tables
2. **Codegen**: `@constructive-io/graphql-codegen` generates typed ORM with vector query support (see `constructive-graphql` skill — [codegen.md](../../constructive-graphql/references/codegen.md))
3. **Ingestion**: Embed documents with Ollama, store via ORM
4. **Retrieval**: ORM `vectorEmbedding` filter + distance ordering
5. **Generation**: Feed retrieved context to LLM for response

---

## Step 1: Provision Vector Storage via SDK

Create tables with vector columns using the Constructive SDK:

```typescript
// Create documents table
const docsTable = await db.table.create({
  data: { databaseId, name: 'document', schemaName: 'app_public' },
  select: { id: true },
}).execute();

// Add fields
await db.field.create({
  data: { databaseId, tableId: docsTable.data.createTable.table.id, name: 'title', type: 'text' },
  select: { id: true },
}).execute();

await db.field.create({
  data: { databaseId, tableId: docsTable.data.createTable.table.id, name: 'content', type: 'text' },
  select: { id: true },
}).execute();

const vecField = await db.field.create({
  data: { databaseId, tableId: docsTable.data.createTable.table.id, name: 'embedding', type: 'vector(768)' },
  select: { id: true },
}).execute();

// Create HNSW index for fast similarity search
await db.index.create({
  data: {
    databaseId,
    tableId: docsTable.data.createTable.table.id,
    name: 'idx_document_embedding_hnsw',
    fieldIds: [vecField.data.createField.field.id],
    accessMethod: 'hnsw',
    options: { m: 16, ef_construction: 64 },
    opClasses: ['vector_cosine_ops'],
  },
  select: { id: true },
}).execute();
```

> For raw SQL table/index creation (e.g., pgpm migrations), see [pgvector-sql.md](./pgvector-sql.md).

---

## Step 2: Generate ORM

Use `@constructive-io/graphql-codegen` to generate a typed ORM client with vector search support (ORM and React Query hooks are both available). See the `constructive-graphql` skill ([codegen.md](../../constructive-graphql/references/codegen.md)) for full setup and options.

---

## Step 3: Ingest Documents

Generate embeddings with Ollama and store via ORM:

```typescript
import { OllamaClient } from './utils/ollama';
import { createClient } from '@/generated/orm';

const ollama = new OllamaClient();
const db = createClient({
  endpoint: process.env.GRAPHQL_URL!,
  headers: { Authorization: `Bearer ${token}` },
});

async function ingestDocument(title: string, content: string) {
  // Generate embedding
  const embedding = await ollama.generateEmbedding(content);

  // Store via ORM
  const result = await db.document.create({
    input: {
      title,
      content,
      embedding: `[${embedding.join(',')}]`,
    },
  }).execute();

  return result;
}
```

### Chunking Strategy

For large documents, chunk before embedding for better retrieval granularity:

```typescript
function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const chunks: string[] = [];
  let position = 0;

  while (position < text.length) {
    chunks.push(text.slice(position, position + chunkSize));
    position += chunkSize - overlap;
  }

  return chunks;
}

async function ingestWithChunks(title: string, content: string) {
  const chunks = chunkText(content);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await ollama.generateEmbedding(chunks[i]);
    await db.document.create({
      input: {
        title: `${title} [chunk ${i + 1}/${chunks.length}]`,
        content: chunks[i],
        embedding: `[${embedding.join(',')}]`,
      },
    }).execute();
  }
}
```

| Document Type | Chunk Size | Overlap |
|---------------|------------|---------|
| Technical docs | 500-800 | 100-150 |
| Conversational | 300-500 | 50-100 |
| Legal/formal | 800-1200 | 200-300 |

---

## Step 4: Retrieve Context via ORM

Use the codegen'd ORM to find similar documents:

```typescript
async function retrieveContext(question: string, limit = 5): Promise<string> {
  const queryEmbedding = await ollama.generateEmbedding(question);

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

Combine pgvector with fullTextSearch for both semantic and keyword matching:

```typescript
const result = await db.document.findMany({
  where: {
    fullTextSearch: 'machine learning',
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

> See `constructive-graphql` ([search-composite.md](../../constructive-graphql/references/search-composite.md)) for full combined search patterns.

---

## Step 5: Generate Response with LLM

```typescript
async function ragQuery(question: string): Promise<string> {
  // 1. Retrieve context
  const context = await retrieveContext(question);

  if (!context) {
    return await ollama.generateResponse(question);
  }

  // 2. Generate response with context
  return await ollama.generateResponse(question, context);
}
```

### Streaming Variant

```typescript
async function ragQueryStreaming(
  question: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  const context = await retrieveContext(question);

  await ollama.generateStreamingResponse(
    question,
    onChunk,
    context
  );
}
```

### Prompt Engineering

Structure prompts for better RAG responses:

```typescript
function buildRAGPrompt(context: string, question: string): string {
  return [
    'You are a helpful assistant. Answer the question based only on the provided context.',
    'If the context does not contain enough information, say so.',
    '',
    'Context:',
    context,
    '',
    `Question: ${question}`,
    '',
    'Answer:',
  ].join('\n');
}
```

---

## Complete RAG Service

```typescript
import { OllamaClient } from './utils/ollama';
import { createClient } from '@/generated/orm';

export class RAGService {
  private ollama: OllamaClient;
  private db: ReturnType<typeof createClient>;

  constructor(endpoint: string, token: string, ollamaHost?: string) {
    this.ollama = new OllamaClient(ollamaHost);
    this.db = createClient({
      endpoint,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async ingest(title: string, content: string): Promise<void> {
    const embedding = await this.ollama.generateEmbedding(content);

    await this.db.document.create({
      input: {
        title,
        content,
        embedding: `[${embedding.join(',')}]`,
      },
    }).execute();
  }

  async query(question: string, contextLimit = 5): Promise<string> {
    const queryEmbedding = await this.ollama.generateEmbedding(question);

    const result = await this.db.document.findMany({
      where: {
        vectorEmbedding: {
          vector: queryEmbedding,
          metric: 'COSINE',
          distance: 0.5,
        },
      },
      orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
      first: contextLimit,
      select: { content: true },
    }).execute();

    const context = result.ok
      ? result.data.documents.nodes.map(d => d.content).join('\n\n')
      : '';

    return await this.ollama.generateResponse(question, context);
  }
}
```

### Usage

```typescript
const rag = new RAGService(
  process.env.GRAPHQL_URL!,
  authToken,
);

// Ingest documents
await rag.ingest('Company Policies', 'Our company offers 20 days of PTO...');

// Query
const answer = await rag.query('How many PTO days do employees get?');
// "Based on the company policies, employees receive 20 days of PTO per year."
```

---

## Embedding Models

| Model | Dimensions | Speed | Quality | Provider |
|-------|------------|-------|---------|----------|
| `nomic-embed-text` | 768 | Fast | Good | Ollama (local) |
| `mxbai-embed-large` | 1024 | Medium | Better | Ollama (local) |
| `all-minilm` | 384 | Very Fast | Acceptable | Ollama (local) |
| `text-embedding-ada-002` | 1536 | Fast | High | OpenAI |

See [ollama.md](./ollama.md) for Ollama setup and model management.

---

## Context Window Management

Limit context to avoid exceeding the LLM context window:

```typescript
const MAX_CONTEXT_CHARS = 4000;

async function getContext(question: string): Promise<string> {
  const queryEmbedding = await ollama.generateEmbedding(question);

  const result = await db.document.findMany({
    where: {
      vectorEmbedding: { vector: queryEmbedding, metric: 'COSINE' },
    },
    orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
    first: 10,
    select: { content: true },
  }).execute();

  if (!result.ok) return '';

  let context = '';
  for (const doc of result.data.documents.nodes) {
    if (context.length + doc.content.length > MAX_CONTEXT_CHARS) break;
    context += doc.content + '\n\n';
  }

  return context.trim();
}
```

---

## Best Practices

- **Generate embeddings in application code**, not in database triggers (HTTP calls in triggers cause transaction timeouts)
- **Use job queues** for async embedding generation on large document sets
- **Match VECTOR(N) dimensions** to your chosen embedding model
- **Add HNSW indexes** for production workloads (create via SDK)
- **Chunk large documents** (500-1000 chars) with overlap for better retrieval
- **Use `distance` threshold** in ORM queries to filter low-quality matches

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "type vector does not exist" | Use pgvector-enabled image (`docker.io/constructiveio/postgres-plus:18`) |
| Irrelevant RAG responses | Lower similarity threshold, improve chunking |
| Hallucinations | Add "only use provided context" to prompt |
| Slow responses | Use streaming, reduce context chunk count |
| Dimension mismatch | Ensure `VECTOR(N)` matches embedding model output |

## Cross-References

- `constructive-graphql` — [search-pgvector.md](../../constructive-graphql/references/search-pgvector.md): Full ORM query reference for pgvector
- `constructive-graphql` — [search-composite.md](../../constructive-graphql/references/search-composite.md): Hybrid search (vector + text)
- [ollama.md](./ollama.md): OllamaClient implementation and model selection
- [pgvector-sql.md](./pgvector-sql.md): Raw SQL reference for pgvector (SQL-level)
