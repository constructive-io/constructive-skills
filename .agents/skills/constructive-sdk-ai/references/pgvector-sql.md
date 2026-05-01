# pgvector SQL Reference

> **This is a SQL-level reference.** For the recommended Constructive platform approach, use the SDK to provision vector columns/indexes and the codegen'd ORM to query. See the parent [SKILL.md](../SKILL.md) and `constructive-sdk-graphql` skill ([search-pgvector.md](../../constructive-sdk-graphql/references/search-pgvector.md)) for the SDK/ORM approach.

Use this reference when you need raw SQL for pgvector — e.g., custom migrations, database functions, or direct PostgreSQL access outside the ORM.

---

## SQL: Enable pgvector Extension

pgvector is pre-enabled in the Constructive database stack (`docker.io/constructiveio/postgres-plus:18`). If using a standalone PostgreSQL instance:

```sql
-- SQL
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## SQL: Create Vector Tables

### Documents Table

```sql
-- SQL
CREATE TABLE intelligence.documents (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Chunks Table

```sql
-- SQL
CREATE TABLE intelligence.chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES intelligence.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    chunk_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_document_id ON intelligence.chunks(document_id);
```

### Chat History Table

```sql
-- SQL
CREATE TABLE intelligence.chat_history (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_history_session ON intelligence.chat_history(session_id);
```

---

## SQL: Vector Indexes

### HNSW Index (Recommended)

```sql
-- SQL: Better recall, no training data needed
CREATE INDEX idx_chunks_embedding_hnsw ON intelligence.chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### IVFFlat Index (Alternative)

```sql
-- SQL: Lower memory, requires data before creating index
CREATE INDEX idx_chunks_embedding_ivfflat ON intelligence.chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Operator Classes

| Metric | Operator Class | SQL Operator | Use When |
|--------|---------------|--------------|----------|
| Cosine | `vector_cosine_ops` | `<=>` | Normalized embeddings (most common) |
| L2 (Euclidean) | `vector_l2_ops` | `<->` | When magnitude matters |
| Inner Product | `vector_ip_ops` | `<#>` | Dot product similarity |

### Tuning Index Parameters

```sql
-- SQL: IVFFlat — increase probes for better recall
SET ivfflat.probes = 10;

-- SQL: HNSW — increase ef_search for better recall
SET hnsw.ef_search = 100;
```

---

## SQL: Similarity Search Function

```sql
-- SQL
CREATE FUNCTION intelligence.find_similar_chunks(
    p_embedding VECTOR(768),
    p_limit INTEGER DEFAULT 5,
    p_similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id INTEGER,
    content TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.content,
        1 - (c.embedding <=> p_embedding) AS similarity
    FROM intelligence.chunks c
    WHERE c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> p_embedding) > p_similarity_threshold
    ORDER BY c.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

### Revert Script

```sql
-- SQL
DROP FUNCTION IF EXISTS intelligence.find_similar_chunks(VECTOR(768), INTEGER, FLOAT);
```

---

## SQL: Document Chunking Function

```sql
-- SQL
CREATE FUNCTION intelligence.create_document_chunks(
    p_document_id INTEGER,
    p_chunk_size INTEGER DEFAULT 1000,
    p_chunk_overlap INTEGER DEFAULT 200
)
RETURNS VOID AS $$
DECLARE
    v_content TEXT;
    v_position INTEGER := 1;
    v_chunk_index INTEGER := 0;
    v_chunk TEXT;
    v_len INTEGER;
BEGIN
    SELECT content INTO v_content
    FROM intelligence.documents
    WHERE id = p_document_id;

    IF v_content IS NULL THEN
        RAISE NOTICE 'No content found for document_id %', p_document_id;
        RETURN;
    END IF;

    v_len := LENGTH(v_content);

    WHILE v_position <= v_len LOOP
        v_chunk := SUBSTRING(v_content FROM v_position FOR p_chunk_size);

        INSERT INTO intelligence.chunks (document_id, content, chunk_index)
        VALUES (p_document_id, v_chunk, v_chunk_index);

        v_position := v_position + (p_chunk_size - p_chunk_overlap);
        v_chunk_index := v_chunk_index + 1;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### Chunking Parameters

| Parameter | Recommended | Description |
|-----------|-------------|-------------|
| `chunk_size` | 500-1000 | Characters per chunk |
| `chunk_overlap` | 100-200 | Overlap between chunks for context continuity |

---

## SQL: Direct Similarity Queries

### Basic Nearest Neighbor

```sql
-- SQL
SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
FROM intelligence.chunks
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

### With Threshold

```sql
-- SQL
SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
FROM intelligence.chunks
WHERE embedding IS NOT NULL
  AND 1 - (embedding <=> $1::vector) > 0.7
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

### With Metadata Filter

```sql
-- SQL
SELECT c.id, c.content, 1 - (c.embedding <=> $1::vector) AS similarity
FROM intelligence.chunks c
JOIN intelligence.documents d ON c.document_id = d.id
WHERE c.embedding IS NOT NULL
  AND d.metadata->>'category' = 'technical'
  AND 1 - (c.embedding <=> $1::vector) > 0.7
ORDER BY c.embedding <=> $1::vector
LIMIT 5;
```

### Aggregate Context for RAG

```sql
-- SQL
SELECT string_agg(content, E'\n\n') as context
FROM intelligence.find_similar_chunks($1::vector, $2, $3);
```

---

## SQL: Verify Scripts (pgpm)

```sql
-- SQL: verify/schemas/intelligence/tables/documents.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_tables
  WHERE schemaname = 'intelligence' AND tablename = 'documents';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table intelligence.documents does not exist';
  END IF;
END $$;
```

---

## SQL: Revert Scripts (pgpm)

```sql
-- SQL
DROP TABLE IF EXISTS intelligence.chunks;
DROP TABLE IF EXISTS intelligence.documents;
```

---

## Vector Dimensions by Model

| Model | Dimensions | Provider |
|-------|------------|----------|
| `nomic-embed-text` | 768 | Ollama (local) |
| `mxbai-embed-large` | 1024 | Ollama (local) |
| `all-minilm` | 384 | Ollama (local) |
| `text-embedding-ada-002` | 1536 | OpenAI |
| `text-embedding-3-small` | 1536 | OpenAI |
| `text-embedding-3-large` | 3072 | OpenAI |

Match your `VECTOR(N)` dimension to your chosen model.

---

## Similarity Thresholds

| Use Case | Threshold | Notes |
|----------|-----------|-------|
| Strict matching | 0.8+ | High precision, may miss relevant results |
| General search | 0.6-0.7 | Good balance |
| Exploratory | 0.4-0.5 | High recall, more noise |
| RAG context | 0.5-0.7 | Depends on document quality |

---

## pgpm Module Structure

```text
my-vectors/
├── deploy/
│   └── schemas/
│       └── intelligence/
│           ├── schema.sql
│           ├── tables/
│           │   ├── documents.sql
│           │   ├── chunks.sql
│           │   └── chat_history.sql
│           └── procedures/
│               ├── find_similar_chunks.sql
│               └── create_document_chunks.sql
├── revert/
│   └── schemas/intelligence/...
├── verify/
│   └── schemas/intelligence/...
├── pgpm.plan
└── package.json
```

---

## Troubleshooting

| Issue | Quick Fix |
|-------|-----------|
| "type vector does not exist" | pgvector extension not installed; use `docker.io/constructiveio/postgres-plus:18` image |
| Dimension mismatch | Ensure `VECTOR(N)` matches model output dimensions |
| No results returned | Lower similarity threshold |
| Slow queries | Add HNSW or IVFFlat index |
| Out of memory | Reduce HNSW parameters or use IVFFlat |
