# Creating and Querying Vector Similarity Search

Vector similarity search using the `pgvector` extension. Used for semantic search, RAG pipelines, and recommendation systems.

## Two Ways to Supply Vectors

Both modes use the same vector column, index and ORM fields. Pick per application:

| Mode | Client sends | Who embeds | Requires |
|------|--------------|------------|----------|
| **Raw vectors** | `number[]` (`vector:` / `embedding:`) | Your app, script or worker (any model) | Nothing extra — always available |
| **Server-side text** | Plain text (`text:`, `unifiedSearch`, `embeddingText:`) | The GraphQL server, via `graphile-llm` | `graphile-llm` enabled with an embedding provider |

Raw vectors are the right choice when you bring your own model (e.g. image embeddings) or run without the LLM plugin. Server-side text keeps provider keys and models off the client and guarantees queries are embedded with the same model the server uses. See [Server-Side Embedding (graphile-llm)](#server-side-embedding-graphile-llm).

---

## Creating Vector Search via SDK

### Step 1: Create a vector field with the embedding dimension

```typescript
const vecField = await db.field.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'embedding',
    type: 'vector(1536)',
  },
  select: { id: true, name: true },
}).execute();

if (vecField.ok) {
  console.log('Created vector field:', vecField.data.createField.field.id);
}
```

Common dimensions: 384 (MiniLM), 768 (BERT/Sentence Transformers), 1536 (OpenAI ada-002), 3072 (OpenAI text-embedding-3-large).

### Step 2: Create an HNSW index for fast similarity search

```typescript
const indexResult = await db.index.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'idx_documents_embedding_hnsw',
    fieldIds: [vecField.data.createField.field.id],
    accessMethod: 'hnsw',
    options: { m: 16, ef_construction: 64 },
    opClasses: ['vector_cosine_ops'],
  },
  select: { id: true, name: true },
}).execute();
```

### HNSW vs IVFFlat

| | HNSW | IVFFlat |
|---|---|---|
| **Query speed** | Faster | Slightly slower |
| **Recall** | Higher (better accuracy) | Lower |
| **Memory** | More | Less |
| **Build time** | Slower | Faster |
| **Training data** | Not needed | Needs data before creating index |

**Recommendation:** Use HNSW for most cases. Use IVFFlat only for very large datasets where memory is constrained.

### IVFFlat Alternative

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'idx_documents_embedding_ivfflat',
    fieldIds: [vecField.data.createField.field.id],
    accessMethod: 'ivfflat',
    options: { lists: 100 },
    opClasses: ['vector_cosine_ops'],
  },
  select: { id: true },
}).execute();
```

### Operator Classes by Metric

| Metric | Operator Class | Use When |
|--------|---------------|----------|
| Cosine | `vector_cosine_ops` | Normalized embeddings (most common) |
| L2 (Euclidean) | `vector_l2_ops` | When magnitude matters |
| Inner Product | `vector_ip_ops` | Maximum inner product search |

---

## Querying Vector Search via SDK

Once a vector column and index exist, the SDK exposes nearby condition fields, distance scores, and ordering.

### Basic Nearest Neighbor Search

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryVector,
      metric: 'COSINE',
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 10,
  select: {
    id: true,
    title: true,
    embeddingVectorDistance: true,
  },
}).execute();

if (result.ok) {
  const docs = result.data.documents.nodes;
  docs.forEach(d => {
    console.log(`${d.title} (distance: ${d.embeddingVectorDistance})`);
  });
}
```

### Search with Text (server-side embedding)

With `graphile-llm` enabled, pass `text` instead of `vector`. The server embeds it with the configured embedder and runs the same pgvector search:

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      text: 'how do I reset my password?',
      metric: 'COSINE',
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 10,
  select: {
    id: true,
    title: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

`text` and `vector` are mutually exclusive — provide one or the other.

### Search with Distance Threshold

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
  select: {
    id: true,
    title: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

The `distance` parameter filters out results beyond the threshold. For cosine distance: 0 = identical, up to 2 = opposite.

### Combining Vector Search with Other Filters

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryVector,
      metric: 'COSINE',
    },
    isPublished: { equalTo: true },
    category: { equalTo: 'tech' },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 10,
  select: {
    id: true,
    title: true,
    category: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

### Pagination

```typescript
const result = await db.document.findMany({
  where: {
    vectorEmbedding: {
      vector: queryVector,
      metric: 'COSINE',
    },
  },
  orderBy: 'EMBEDDING_VECTOR_DISTANCE_ASC',
  first: 10,
  after: cursor,
  select: {
    id: true,
    title: true,
    embeddingVectorDistance: true,
  },
}).execute();
```

---

## Distance Metrics

| Metric | Range | Meaning | Sort Direction |
|--------|-------|---------|----------------|
| `COSINE` | 0 to 2 | 0 = identical, 2 = opposite | ASC = most similar first |
| `L2` | 0 to infinity | 0 = identical | ASC = most similar first |
| `IP` | -infinity to 0 | More negative = more similar | ASC = most similar first |

---

## Field Naming Convention

| DB Column | Condition Field | Distance Field | OrderBy |
|-----------|----------------|----------------|---------|
| `embedding` | `vectorEmbedding` | `embeddingVectorDistance` | `EMBEDDING_VECTOR_DISTANCE_ASC/DESC` |
| `content_vec` | `vectorContentVec` | `contentVecDistance` | `CONTENT_VEC_DISTANCE_ASC/DESC` |

**Pattern:**
- Condition: `vector` + camelCase(column name) — accepts `{ vector, metric?, distance? }` input, or `{ text, metric?, distance? }` when `graphile-llm` is enabled
- Text input (with `graphile-llm`): camelCase(column name) + `Text` on create/update inputs (e.g. `embeddingText`)
- Distance: camelCase(column name) + `VectorDistance`
- OrderBy: SCREAMING_SNAKE(column name) + `_VECTOR_DISTANCE_ASC` / `_VECTOR_DISTANCE_DESC`

The distance is a `Float`. It is `null` when no vector condition is active.

---

## Embedding Generation

pgvector stores and searches vectors. Where the vectors come from depends on the mode you use.

### Raw vectors (bring your own model)

Generate the vector anywhere and write it through the SDK. This always works, with or without `graphile-llm`:

```typescript
const embedding: number[] = await myEmbedder('Intro to vector search'); // any model, matching the column dimensions

await db.document.create({
  data: { title: 'Intro to vector search', embedding },
  select: { id: true },
}).execute();
```

Common models: OpenAI `text-embedding-3-small` (1536d) / `text-embedding-3-large` (3072d), Ollama `nomic-embed-text` (768d), Sentence Transformers `all-MiniLM-L6-v2` (384d), Cohere `embed-english-v3.0` (1024d). For a client library, see [agentic-kit](../../constructive-agents/references/agentic-kit.md).

### Server-side on write (`{column}Text`)

With `graphile-llm` enabled, every vector column gets a `{column}Text` companion on create/update inputs. The server embeds the text and stores the vector:

```typescript
await db.document.create({
  data: {
    title: 'Intro to vector search',
    embeddingText: 'Intro to vector search. Vectors capture meaning…',
  },
  select: { id: true },
}).execute();
```

`embeddingText` and `embedding` are mutually exclusive on the same input.

### Background embedding (Search* blueprint nodes)

`SearchUnified` / `SearchVector` (with `enqueue_job`, the default) mark rows stale on insert/update and enqueue an embedding job; the platform worker embeds the source fields and writes the vector back. Clients only write ordinary text columns. See [`constructive-agents`](../../constructive-agents/SKILL.md) for the pipeline and `enqueue_job: false` for tables you embed yourself.

---

## Server-Side Embedding (graphile-llm)

`graphile-llm` is a PostGraphile v5 plugin (included in the Constructive preset) that embeds text on the server at request time. Fields only appear in the schema when the plugin is loaded and the capability is enabled:

| Capability | Adds | Toggle (default) |
|------------|------|------------------|
| Text search | `text: String` on `VectorNearbyInput`; `unifiedSearch` strings are also embedded so pgvector joins the fan-out | `enableTextSearch` (`true`) |
| Text mutations | `{column}Text: String` on create/update inputs | `enableTextMutations` (`true`) |
| RAG | `ragQuery` and `embedText` root queries (for `@hasChunks` tables) | `enableRag` (`false`) |

```typescript
import { GraphileLlmPreset } from 'graphile-llm';

const preset = {
  extends: [
    GraphileLlmPreset({
      defaultEmbedder: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },
      defaultChatCompleter: { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434' }, // RAG only
      enableTextSearch: true,
      enableTextMutations: true,
      enableRag: false,
    }),
  ],
};
```

Providers can also be set with environment variables: `EMBEDDER_PROVIDER`, `EMBEDDER_MODEL`, `EMBEDDER_BASE_URL`, `CHAT_PROVIDER`, `CHAT_MODEL`, `CHAT_BASE_URL`.

**Match dimensions:** the server embedder's output size must match the column (e.g. `vector(768)` for `nomic-embed-text`). If you mix modes on one column, use the same model for raw vectors and the server embedder — distances between vectors from different models are meaningless.

`embedText(text:)` returns `{ vector, dimensions }` — use it only when you explicitly need the raw vector back on the client; `text:` and `unifiedSearch` never send a vector over the wire. For `ragQuery`, see [search-rag.md](./search-rag.md#server-side-rag-ragquery).

---

## When to Use pgvector

- Semantic search ("find documents about this concept" even without exact keyword matches)
- RAG pipelines (retrieval-augmented generation)
- Recommendation systems (find similar items)
- When you have an embedding source: raw vectors from your own model, or `graphile-llm` / Search* background jobs
- When keyword search isn't sufficient (user asks questions in natural language)
