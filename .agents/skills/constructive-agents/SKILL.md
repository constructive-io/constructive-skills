---
name: constructive-agents
description: "AI — agent module, LLM providers, RAG pipelines, embeddings, agentic-kit multi-provider client, Search* blueprint nodes (SearchUnified, SearchVector), ProcessFileEmbedding/ProcessImageEmbedding/ProcessChunks. Use when asked to 'add AI search', 'build RAG pipeline', 'embedding worker', 'agentic-kit', 'LLM integration', 'Ollama', 'Anthropic', 'OpenAI', 'file embedding', 'image embedding', 'chunking', 'SearchUnified', 'SearchVector', 'multiplayer agents', 'shared agents', 'multi-agent', 'agent_id', or when working with AI features in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Agents

AI-powered features on the Constructive platform — vector search, embedding pipelines, LLM integration, and RAG patterns.

## When to Apply

Use this skill when:
- Adding vector search / embeddings to a table (SearchUnified, SearchVector)
- Adding file/image embeddings (ProcessFileEmbedding, ProcessImageEmbedding)
- Adding standalone chunking (ProcessChunks)
- Building RAG pipelines
- Integrating LLM providers via agentic-kit (Ollama, Anthropic, OpenAI)
- Understanding the embedding worker pipeline
- Configuring multiplayer (shared) agent modules
- Working with multi-agent attribution

## Architecture

```
Blueprint (SearchUnified / SearchVector / ProcessFileEmbedding / ProcessChunks)
  → construct_blueprint() creates:
    * vector(N) column + HNSW index
    * embedding_text composite + concat trigger (SearchUnified)
    * stale-marking triggers + enqueue_embedding job trigger
    * extraction fields + MIME-scoped trigger (ProcessFileEmbedding)
    * chunks table with per-chunk embeddings (ProcessChunks)
  → Row INSERT/UPDATE fires stale trigger
    → Job enqueued via app_jobs
      → Worker: embed_record / process_file_embedding / generate_chunks
        → ORM queries with vectorEmbedding filter
          → RAG: retrieve context → feed to LLM via agentic-kit
```

## Search* Blueprint Nodes

### SearchUnified (primary — use for most tables)

Orchestrates embedding + BM25 + optional FTS + optional trigram in one declaration:

```json
{ "$type": "SearchUnified", "data": {
  "embedding": {
    "source_fields": ["first_name", "last_name", "bio"],
    "chunks": {}
  },
  "bm25": { "field_name": "embedding_text" },
  "full_text_search": {
    "field_name": "search_tsv",
    "source_fields": [
      { "field": "first_name", "weight": "A" },
      { "field": "bio", "weight": "C" }
    ]
  }
}}
```

### SearchVector (standalone vector columns)

For tables needing only embeddings (no BM25/FTS/trigram):

```json
{ "$type": "SearchVector", "data": { "field_name": "embedding", "enqueue_job": false } }
```

### ProcessFileEmbedding / ProcessImageEmbedding

For storage tables — extract text from files, generate embeddings:

```json
{ "$type": "ProcessFileEmbedding", "data": {
  "source_field": "file_url",
  "mime_types": ["application/pdf", "text/plain"]
}}
```

### ProcessChunks

Split text into chunks and embed each chunk:

```json
{ "$type": "ProcessChunks", "data": {
  "source_field": "content",
  "chunk_size": 512,
  "chunk_overlap": 50
}}
```

## agentic-kit (LLM Client)

Multi-provider LLM client for inference:

```typescript
import { createAgent } from '@constructive-io/agentic-kit';

const agent = createAgent({
  provider: 'anthropic',  // or 'ollama', 'openai'
  model: 'claude-sonnet-4-20250514',
});

const response = await agent.generate({ prompt: 'Summarize this document...' });
```

## RAG Pattern

```typescript
// 1. Retrieve context via ORM
const docs = await db.document.findMany({
  where: { vectorEmbedding: { similarTo: queryEmbedding, first: 5 } },
  select: { content: true, title: true },
}).execute();

// 2. Feed to LLM
const answer = await agent.generate({
  prompt: `Based on: ${docs.map(d => d.content).join('\n')}\n\nQuestion: ${query}`,
});
```

See [rag-pipeline.md](./references/rag-pipeline.md) for the full RAG reference.

## Agent Module Access Modes

The `agent_module` supports two access modes configured at provision time via the `shared` flag:

| `shared` | Security Policy | Behavior |
|----------|----------------|----------|
| `false` (default) | `AuthzMemberOwner` | Private — only the thread creator sees their own threads/messages within the entity |
| `true` | `AuthzEntityMembership` | Multiplayer — all entity members can see and contribute to all threads |

### Multi-Agent Attribution

When `has_agents` is enabled, `agent_messages` includes an `agent_id` FK. This allows multiple AI agents (each with their own persona) to participate in a single thread:

- Messages are attributed via `actor_id` (the human user) and optionally `agent_id` (the AI agent)
- Tasks are attributed via `actor_id`
- Agent personas define system prompts, model config, and linked resources

### Module Permissions

The agent module auto-registers these permissions on install:

| Permission | Default | Purpose |
|-----------|---------|---------|
| `invoke_agents` | Granted to all members | Use agent features (threads, messages, tasks) |
| `manage_agents` | Admin-only | Administer agent infrastructure |

## References

| File | Content |
|------|---------|
| [agentic-kit.md](./references/agentic-kit.md) | Multi-provider LLM client reference |
| [rag-pipeline.md](./references/rag-pipeline.md) | RAG pipeline patterns and examples |

## Cross-References

- **Search strategies (all algorithms):** [`constructive-search`](../constructive-search/SKILL.md)
- **File uploads (storage tables):** [`constructive-storage`](../constructive-storage/SKILL.md)
- **Background jobs (embedding worker):** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
