---
name: constructive-ai
description: "AI and vector search capabilities — pgvector RAG pipelines (embeddings, similarity search, agentic kits), and Ollama CI/CD workflows for running LLM models in GitHub Actions. Use when building RAG pipelines, working with embeddings, running Ollama in CI, or implementing AI-powered search."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive AI

Build AI-powered features with pgvector RAG pipelines and Ollama CI/CD workflows.

## When to Apply

Use this skill when:
- Building RAG (Retrieval-Augmented Generation) pipelines
- Working with vector embeddings and similarity search
- Setting up Ollama LLM models in CI/CD
- Implementing AI-powered search or agentic workflows

## pgvector RAG

Build end-to-end RAG pipelines: embed documents → store in pgvector → similarity search → feed to LLM.

See [pgvector-rag.md](./references/pgvector-rag.md) for the full RAG pipeline guide.

## Ollama CI/CD

Run Ollama LLM models in GitHub Actions for testing and validation.

See [ollama-ci.md](./references/ollama-ci.md) for CI workflow configuration.

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [pgvector-rag.md](./references/pgvector-rag.md) | RAG pipeline overview | Building end-to-end RAG systems |
| [rag-embeddings.md](./references/rag-embeddings.md) | Embedding generation | Creating and storing vector embeddings |
| [rag-similarity-search.md](./references/rag-similarity-search.md) | Similarity search | Querying vectors, distance metrics |
| [rag-rag-pipeline.md](./references/rag-rag-pipeline.md) | Full RAG pipeline | Document ingestion → retrieval → generation |
| [rag-setup.md](./references/rag-setup.md) | pgvector setup | Installing pgvector, creating indexes |
| [rag-ollama.md](./references/rag-ollama.md) | Ollama integration | Using Ollama for local LLM inference |
| [rag-agentic-kit.md](./references/rag-agentic-kit.md) | Agentic kit patterns | Building AI agents with RAG |
| [ollama-ci.md](./references/ollama-ci.md) | Ollama GitHub Actions | Running LLM models in CI/CD |

## Cross-References

- `graphile-search` — Unified search plugin (includes pgvector adapter)
- `constructive-graphql` — Search via codegen SDK (pgvector queries)
- `pgpm` — Database migrations for vector tables
