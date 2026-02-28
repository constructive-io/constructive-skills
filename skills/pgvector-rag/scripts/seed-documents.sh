#!/bin/bash
set -e

# Seed documents into the RAG database
# This script loads documents from a directory and generates embeddings using Ollama

echo "Seeding documents into RAG database..." >&2

# Configuration with defaults
RAG_DATABASE="${RAG_DATABASE:-rag_dev}"
RAG_SCHEMA="${RAG_SCHEMA:-intelligence}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
RAG_EMBEDDING_MODEL="${RAG_EMBEDDING_MODEL:-nomic-embed-text}"
DOCUMENTS_DIR="${1:-.}"

# Check if Ollama is running
if ! curl -s "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
    echo "Error: Ollama is not running at $OLLAMA_HOST" >&2
    echo "Please start Ollama: ollama serve" >&2
    exit 1
fi

# Check if the embedding model is available
if ! curl -s "$OLLAMA_HOST/api/tags" | grep -q "$RAG_EMBEDDING_MODEL"; then
    echo "Pulling embedding model $RAG_EMBEDDING_MODEL..." >&2
    curl -s -X POST "$OLLAMA_HOST/api/pull" -d "{\"name\": \"$RAG_EMBEDDING_MODEL\"}" > /dev/null
fi

# Load environment variables for database connection
eval "$(pgpm env)" 2>/dev/null || true

# Function to generate embedding
generate_embedding() {
    local text="$1"
    curl -s -X POST "$OLLAMA_HOST/api/embeddings" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$RAG_EMBEDDING_MODEL\", \"prompt\": $(echo "$text" | jq -Rs .)}" \
        | jq -r '.embedding | "[" + (map(tostring) | join(",")) + "]"'
}

# Function to add a document
add_document() {
    local title="$1"
    local content="$2"
    local metadata="${3:-{}}"

    echo "Adding document: $title" >&2

    # Generate embedding for the document
    local embedding
    embedding=$(generate_embedding "$content")

    # Insert document
    local doc_id
    doc_id=$(psql -d "$RAG_DATABASE" -t -A -c "
        INSERT INTO $RAG_SCHEMA.documents (title, content, metadata, embedding)
        VALUES ('$(echo "$title" | sed "s/'/''/g")', '$(echo "$content" | sed "s/'/''/g")', '$metadata'::jsonb, '$embedding'::vector)
        RETURNING id
    ")

    # Create chunks
    psql -d "$RAG_DATABASE" -c "SELECT $RAG_SCHEMA.create_document_chunks($doc_id)" > /dev/null

    # Generate embeddings for chunks
    local chunks
    chunks=$(psql -d "$RAG_DATABASE" -t -A -c "
        SELECT id, content FROM $RAG_SCHEMA.chunks WHERE document_id = $doc_id ORDER BY chunk_index
    ")

    while IFS='|' read -r chunk_id chunk_content; do
        if [ -n "$chunk_id" ]; then
            local chunk_embedding
            chunk_embedding=$(generate_embedding "$chunk_content")
            psql -d "$RAG_DATABASE" -c "
                UPDATE $RAG_SCHEMA.chunks SET embedding = '$chunk_embedding'::vector WHERE id = $chunk_id
            " > /dev/null
        fi
    done <<< "$chunks"

    echo "$doc_id"
}

# Process files from directory
documents_added=0

if [ -d "$DOCUMENTS_DIR" ]; then
    echo "Processing documents from: $DOCUMENTS_DIR" >&2
    
    for file in "$DOCUMENTS_DIR"/*.{txt,md,json}; do
        [ -f "$file" ] || continue
        
        filename=$(basename "$file")
        title="${filename%.*}"
        content=$(cat "$file")
        
        if [ -n "$content" ]; then
            add_document "$title" "$content" "{\"source\": \"$filename\"}"
            documents_added=$((documents_added + 1))
        fi
    done
else
    echo "Directory not found: $DOCUMENTS_DIR" >&2
    echo "Usage: $0 <documents_directory>" >&2
    exit 1
fi

echo "Seeding complete!" >&2

# Output summary as JSON
cat <<EOF
{
  "documents_added": $documents_added,
  "database": "$RAG_DATABASE",
  "schema": "$RAG_SCHEMA",
  "embedding_model": "$RAG_EMBEDDING_MODEL"
}
EOF
