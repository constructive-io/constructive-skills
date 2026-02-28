#!/bin/bash
set -e

# Setup RAG database with pgvector using PGPM
# This script creates a local PostgreSQL database with the intelligence schema
# for storing documents and embeddings for RAG applications.

echo "Setting up RAG database..." >&2

# Configuration with defaults
RAG_DATABASE="${RAG_DATABASE:-rag_dev}"
RAG_SCHEMA="${RAG_SCHEMA:-intelligence}"
PGPM_IMAGE="${PGPM_IMAGE:-pyramation/postgres:17}"

# Check if pgpm is available
if ! command -v pgpm &> /dev/null; then
    echo "Error: pgpm is not installed. Please install pgpm first." >&2
    echo "See: https://github.com/constructive-io/constructive" >&2
    exit 1
fi

# Check if Docker is running (needed for pgpm docker)
if ! docker info &> /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker first." >&2
    exit 1
fi

# Start PostgreSQL with pgvector if not already running
echo "Starting PostgreSQL with pgvector..." >&2
pgpm docker start --image "$PGPM_IMAGE" 2>/dev/null || true

# Load environment variables
eval "$(pgpm env)"

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..." >&2
for i in {1..30}; do
    if psql -c "SELECT 1" &> /dev/null; then
        break
    fi
    sleep 1
done

# Create the database if it doesn't exist
echo "Creating database '$RAG_DATABASE'..." >&2
psql -c "CREATE DATABASE $RAG_DATABASE" 2>/dev/null || echo "Database already exists" >&2

# Connect to the RAG database and set up the schema
echo "Setting up schema and tables..." >&2
psql -d "$RAG_DATABASE" <<EOF
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create intelligence schema
CREATE SCHEMA IF NOT EXISTS $RAG_SCHEMA;

-- Documents table for storing full documents
CREATE TABLE IF NOT EXISTS $RAG_SCHEMA.documents (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chunks table for storing document chunks with embeddings
CREATE TABLE IF NOT EXISTS $RAG_SCHEMA.chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES $RAG_SCHEMA.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    chunk_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON $RAG_SCHEMA.chunks(document_id);

-- Chat history table for tracking conversations
CREATE TABLE IF NOT EXISTS $RAG_SCHEMA.chat_history (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_session ON $RAG_SCHEMA.chat_history(session_id);

-- Function to create document chunks
CREATE OR REPLACE FUNCTION $RAG_SCHEMA.create_document_chunks(
    p_document_id INTEGER,
    p_chunk_size INTEGER DEFAULT 1000,
    p_chunk_overlap INTEGER DEFAULT 200
)
RETURNS VOID AS \$\$
DECLARE
    v_content TEXT;
    v_position INTEGER := 1;
    v_chunk_index INTEGER := 0;
    v_chunk TEXT;
    v_len INTEGER;
BEGIN
    SELECT content INTO v_content
    FROM $RAG_SCHEMA.documents
    WHERE id = p_document_id;

    IF v_content IS NULL THEN
        RAISE NOTICE 'No content found for document_id %', p_document_id;
        RETURN;
    END IF;

    v_len := LENGTH(v_content);

    WHILE v_position <= v_len LOOP
        v_chunk := SUBSTRING(v_content FROM v_position FOR p_chunk_size);

        INSERT INTO $RAG_SCHEMA.chunks (document_id, content, chunk_index)
        VALUES (p_document_id, v_chunk, v_chunk_index);

        v_position := v_position + (p_chunk_size - p_chunk_overlap);
        v_chunk_index := v_chunk_index + 1;
    END LOOP;
END;
\$\$ LANGUAGE plpgsql;

-- Function to find similar chunks using vector similarity
CREATE OR REPLACE FUNCTION $RAG_SCHEMA.find_similar_chunks(
    p_embedding VECTOR(768),
    p_limit INTEGER DEFAULT 5,
    p_similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
    id INTEGER,
    content TEXT,
    similarity FLOAT
) AS \$\$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.content,
        (1 - (c.embedding <=> p_embedding))::FLOAT AS similarity
    FROM $RAG_SCHEMA.chunks c
    WHERE c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> p_embedding) > p_similarity_threshold
    ORDER BY c.embedding <=> p_embedding
    LIMIT p_limit;
END;
\$\$ LANGUAGE plpgsql;

EOF

echo "RAG database setup complete!" >&2

# Output connection info as JSON
cat <<EOF
{
  "database": "$RAG_DATABASE",
  "schema": "$RAG_SCHEMA",
  "connection_string": "postgres://postgres:postgres@localhost:5432/$RAG_DATABASE",
  "tables": ["documents", "chunks", "chat_history"],
  "functions": ["create_document_chunks", "find_similar_chunks"]
}
EOF
