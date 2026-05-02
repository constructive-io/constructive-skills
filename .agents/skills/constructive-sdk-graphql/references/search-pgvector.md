# Creating and Querying Vector Similarity Search

Vector similarity search using the `pgvector` extension. Used for semantic search, RAG pipelines, and recommendation systems.

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
- Condition: `vector` + camelCase(column name) — accepts `{ vector, metric?, distance? }` input
- Distance: camelCase(column name) + `VectorDistance`
- OrderBy: SCREAMING_SNAKE(column name) + `_VECTOR_DISTANCE_ASC` / `_VECTOR_DISTANCE_DESC`

The distance is a `Float`. It is `null` when no vector condition is active.

---

## Embedding Generation

pgvector stores and searches embeddings but does not generate them. Generation is done externally:

1. **OpenAI** — `text-embedding-3-small` (1536d), `text-embedding-3-large` (3072d)
2. **Sentence Transformers** — `all-MiniLM-L6-v2` (384d), local/self-hosted
3. **Ollama** — Local embedding models
4. **Cohere** — `embed-english-v3.0` (1024d)

Typical workflow: text -> external API -> embedding vector -> insert/update via SDK.

---

## When to Use pgvector

- Semantic search ("find documents about this concept" even without exact keyword matches)
- RAG pipelines (retrieval-augmented generation)
- Recommendation systems (find similar items)
- When you have an embedding pipeline set up
- When keyword search isn't sufficient (user asks questions in natural language)
