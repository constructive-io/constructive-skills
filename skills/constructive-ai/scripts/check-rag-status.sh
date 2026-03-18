#!/bin/bash
set -e

# Check the status of RAG infrastructure
# This script verifies that all components are running and configured correctly

echo "Checking RAG infrastructure status..." >&2

# Configuration with defaults
RAG_DATABASE="${RAG_DATABASE:-rag_dev}"
RAG_SCHEMA="${RAG_SCHEMA:-intelligence}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
RAG_EMBEDDING_MODEL="${RAG_EMBEDDING_MODEL:-nomic-embed-text}"
RAG_CHAT_MODEL="${RAG_CHAT_MODEL:-llama3.2}"

# Status tracking
status_ok=true
errors=()

# Check PostgreSQL
echo "Checking PostgreSQL..." >&2
if psql -c "SELECT 1" &> /dev/null 2>&1; then
    pg_status="running"
else
    pg_status="not running"
    status_ok=false
    errors+=("PostgreSQL is not running. Run: pgpm docker start")
fi

# Check database exists
echo "Checking database '$RAG_DATABASE'..." >&2
if psql -d "$RAG_DATABASE" -c "SELECT 1" &> /dev/null 2>&1; then
    db_status="exists"
else
    db_status="not found"
    status_ok=false
    errors+=("Database '$RAG_DATABASE' not found. Run: setup-rag-database.sh")
fi

# Check pgvector extension
echo "Checking pgvector extension..." >&2
if [ "$db_status" = "exists" ]; then
    if psql -d "$RAG_DATABASE" -t -c "SELECT 1 FROM pg_extension WHERE extname = 'vector'" 2>/dev/null | grep -q 1; then
        pgvector_status="installed"
    else
        pgvector_status="not installed"
        status_ok=false
        errors+=("pgvector extension not installed. Run: setup-rag-database.sh")
    fi
else
    pgvector_status="unknown"
fi

# Check schema and tables
echo "Checking schema and tables..." >&2
if [ "$db_status" = "exists" ]; then
    if psql -d "$RAG_DATABASE" -t -c "SELECT 1 FROM information_schema.schemata WHERE schema_name = '$RAG_SCHEMA'" 2>/dev/null | grep -q 1; then
        schema_status="exists"
    else
        schema_status="not found"
        status_ok=false
        errors+=("Schema '$RAG_SCHEMA' not found. Run: setup-rag-database.sh")
    fi
else
    schema_status="unknown"
fi

# Count documents and chunks
if [ "$schema_status" = "exists" ]; then
    doc_count=$(psql -d "$RAG_DATABASE" -t -A -c "SELECT COUNT(*) FROM $RAG_SCHEMA.documents" 2>/dev/null || echo "0")
    chunk_count=$(psql -d "$RAG_DATABASE" -t -A -c "SELECT COUNT(*) FROM $RAG_SCHEMA.chunks" 2>/dev/null || echo "0")
    embedded_chunks=$(psql -d "$RAG_DATABASE" -t -A -c "SELECT COUNT(*) FROM $RAG_SCHEMA.chunks WHERE embedding IS NOT NULL" 2>/dev/null || echo "0")
else
    doc_count=0
    chunk_count=0
    embedded_chunks=0
fi

# Check Ollama
echo "Checking Ollama..." >&2
if curl -s "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
    ollama_status="running"
else
    ollama_status="not running"
    status_ok=false
    errors+=("Ollama is not running at $OLLAMA_HOST. Run: ollama serve")
fi

# Check models
echo "Checking models..." >&2
if [ "$ollama_status" = "running" ]; then
    available_models=$(curl -s "$OLLAMA_HOST/api/tags" | jq -r '.models[].name' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
    
    if curl -s "$OLLAMA_HOST/api/tags" | jq -r '.models[].name' 2>/dev/null | grep -q "$RAG_EMBEDDING_MODEL"; then
        embedding_model_status="available"
    else
        embedding_model_status="not found"
        status_ok=false
        errors+=("Embedding model '$RAG_EMBEDDING_MODEL' not found. Run: ollama pull $RAG_EMBEDDING_MODEL")
    fi
    
    if curl -s "$OLLAMA_HOST/api/tags" | jq -r '.models[].name' 2>/dev/null | grep -q "$RAG_CHAT_MODEL"; then
        chat_model_status="available"
    else
        chat_model_status="not found"
        status_ok=false
        errors+=("Chat model '$RAG_CHAT_MODEL' not found. Run: ollama pull $RAG_CHAT_MODEL")
    fi
else
    available_models=""
    embedding_model_status="unknown"
    chat_model_status="unknown"
fi

# Output status as JSON
if [ "$status_ok" = true ]; then
    overall_status="ready"
else
    overall_status="not ready"
fi

cat <<EOF
{
  "status": "$overall_status",
  "postgresql": {
    "status": "$pg_status",
    "database": "$RAG_DATABASE",
    "database_status": "$db_status",
    "pgvector": "$pgvector_status",
    "schema": "$RAG_SCHEMA",
    "schema_status": "$schema_status"
  },
  "data": {
    "documents": $doc_count,
    "chunks": $chunk_count,
    "embedded_chunks": $embedded_chunks
  },
  "ollama": {
    "host": "$OLLAMA_HOST",
    "status": "$ollama_status",
    "embedding_model": "$RAG_EMBEDDING_MODEL",
    "embedding_model_status": "$embedding_model_status",
    "chat_model": "$RAG_CHAT_MODEL",
    "chat_model_status": "$chat_model_status",
    "available_models": "$available_models"
  },
  "errors": $(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)
}
EOF

if [ "$status_ok" = true ]; then
    echo "RAG infrastructure is ready!" >&2
else
    echo "RAG infrastructure has issues. See errors above." >&2
    exit 1
fi
