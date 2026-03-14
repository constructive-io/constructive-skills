---
name: constructive-ai
description: "AI, embeddings, and RAG pipelines for Constructive — pgvector setup with Ollama for local embeddings, similarity search, full RAG pipeline construction, PostGraphile pgvector integration for GraphQL similarity search, and GitHub Actions CI/CD for AI testing. Use when asked to set up vector database, generate embeddings, semantic search, build RAG, use Ollama, run local LLM, configure RAG, create AI search, embed documents, expose vector search in GraphQL, or set up CI for AI testing."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive AI

Consolidated skill covering AI, embeddings, and RAG pipelines for the Constructive ecosystem.

## pgvector & RAG Pipelines

- Set up pgvector schema (documents, chunks, indexes) and build complete RAG pipelines with Ollama for local embedding and generation
- OllamaClient TypeScript implementation for embedding generation, text completion, streaming, and chat APIs
- Similarity search with cosine, L2, and inner product distance operators, plus agentic-kit RAG integration
- Document chunking, ingestion pipelines, batch processing, and environment configuration for RAG applications

**Triggers:** "set up vector database", "generate embeddings", "semantic search", "build RAG", "use Ollama", "run local LLM", "configure RAG", "create AI search", "embed documents"

See [rag-pipelines.md](./references/rag-pipelines.md) for details.

## PostGraphile pgvector Integration

- VectorCodecPlugin to register the `vector` PG type as a `Vector` GraphQL scalar, making embedding columns visible in the PostGraphile schema
- PgVectorPlugin / PgVectorPreset to add `vectorSearch<Table>` root query fields with query, limit, offset, and metric arguments
- Codegen configuration for mapping the `Vector` scalar to `number[]` in generated TypeScript types
- Integration testing patterns using `graphile-test` with real database connections

**Triggers:** "expose vector search in GraphQL", "add embedding column to schema", "surface pgvector types in PostGraphile", "register vector codec"

See [pgvector-graphql.md](./references/pgvector-graphql.md) for details.

## GitHub Actions CI/CD for AI Testing

- Complete GitHub Actions workflow templates for testing RAG pipelines with Ollama and pgvector service containers
- Ollama service container configuration, model pulling strategies, and wait-for-ready patterns
- Caching strategies for pnpm dependencies and pgpm CLI, plus matrix testing for multiple packages
- Debugging patterns for failed CI runs, test timeout configuration for LLM operations, and minimal embedding-only workflows

**Triggers:** "set up CI for RAG", "configure Ollama in CI", "test embeddings in GitHub Actions", "set up CI for AI testing"

See [ci-cd-ollama.md](./references/ci-cd-ollama.md) for details.
