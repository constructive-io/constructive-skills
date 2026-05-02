---
name: agentic-kit
description: "Build AI agents with agentic-kit: multi-provider LLM abstraction (Ollama, Anthropic, OpenAI) with streaming, embeddings, and RAG integration via codegen'd ORM. Use when building AI chat, RAG pipelines, multi-provider agents, or embedding generation."
compatibility: Node.js 18+, agentic-kit ^1.0.3
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Agentic Kit

Build AI agents with [agentic-kit](https://github.com/constructive-io/agentic-kit): a unified, streaming-capable interface for multiple LLM providers. Integrates with the Constructive platform via the codegen'd ORM for RAG and vector search.

## When to Apply

Use this skill when:
- Building AI chat or assistant features
- Integrating LLM providers (Ollama, Anthropic/Claude, OpenAI)
- Generating embeddings for vector search
- Building RAG pipelines that combine vector retrieval (via ORM) with LLM generation
- Implementing multi-provider agent architectures

## Packages

| Package | Purpose |
|---------|---------|
| `agentic-kit` | Core library: `AgentKit` manager, `AgentProvider` interface, factory helpers |
| `@agentic-kit/ollama` | `OllamaClient` — local inference, embeddings, model management |
| `@agentic-kit/anthropic` | `AnthropicAdapter` — Claude models via Anthropic API |
| `@agentic-kit/openai` | `OpenAIAdapter` — GPT models and OpenAI-compatible APIs (LM Studio, vLLM, Together) |

## Quick Start

### Single Provider (Ollama)

```typescript
import { createOllamaKit } from 'agentic-kit';

const kit = createOllamaKit('http://localhost:11434');

// Single-shot generation
const answer = await kit.generate({
  model: 'llama3.2',
  prompt: 'What is PostgreSQL?',
});

// Chat with messages
const chatAnswer = await kit.generate({
  model: 'llama3.2',
  system: 'You are a helpful database assistant.',
  messages: [
    { role: 'user', content: 'What is a GIN index?' },
  ],
});
```

### Multi-Provider

```typescript
import { AgentKit, OllamaAdapter, AnthropicAdapter, OpenAIAdapter } from 'agentic-kit';

const kit = new AgentKit();

// Add providers
kit.addProvider(new OllamaAdapter('http://localhost:11434'));

if (process.env.ANTHROPIC_API_KEY) {
  kit.addProvider(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

if (process.env.OPENAI_API_KEY) {
  kit.addProvider(new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }));
}

// Switch providers at runtime
kit.setProvider('anthropic');
const answer = await kit.generate({
  model: 'claude-3-5-sonnet-latest',
  prompt: 'Explain vector search.',
});
```

### Factory Helpers

```typescript
import { createOllamaKit, createAnthropicKit, createOpenAIKit, createMultiProviderKit } from 'agentic-kit';

const ollama = createOllamaKit('http://localhost:11434');
const claude = createAnthropicKit({ apiKey: process.env.ANTHROPIC_API_KEY! });
const gpt = createOpenAIKit({ apiKey: process.env.OPENAI_API_KEY! });
const multi = createMultiProviderKit(); // empty kit, add providers manually
```

## Streaming

```typescript
const kit = createOllamaKit();

// Stream tokens as they arrive
await kit.generate(
  { model: 'llama3.2', prompt: 'Tell me about PostgreSQL' },
  {
    onChunk: (chunk) => process.stdout.write(chunk),
    onComplete: () => console.log('\nDone'),
    onError: (err) => console.error('Error:', err),
  }
);
```

## Embeddings

Use `OllamaClient` directly for embedding generation:

```typescript
import OllamaClient from '@agentic-kit/ollama';

const client = new OllamaClient('http://localhost:11434');

// Generate a single embedding (768-dim with nomic-embed-text)
const embedding = await client.generateEmbedding('PostgreSQL expert', 'nomic-embed-text');
// => number[] (768 values)

// Batch embeddings
async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(t => client.generateEmbedding(t)));
}
```

### Embedding Models

| Model | Dimensions | Speed | Use Case |
|-------|------------|-------|----------|
| `nomic-embed-text` | 768 | Fast | General-purpose (recommended) |
| `mxbai-embed-large` | 1024 | Medium | Higher quality |
| `all-minilm` | 384 | Very Fast | Lightweight/mobile |

## RAG with Codegen'd ORM

The recommended RAG pattern on Constructive: embed with agentic-kit, search with the codegen'd ORM, generate with AgentKit.

### 3-Pass RAG Architecture

```
Pass 1: Query Router    — LLM decides which tables to search
Pass 2: Vector Search   — ORM queries selected tables with vectorEmbedding filter
Pass 3: LLM Synthesis   — LLM generates answer from retrieved context
```

### Complete RAG Example

```typescript
import { AgentKit, OllamaAdapter, AnthropicAdapter } from 'agentic-kit';
import OllamaClient from '@agentic-kit/ollama';
import { createClient } from '@your-project/sdk';

// Setup
const ollamaClient = new OllamaClient('http://localhost:11434');
const kit = new AgentKit();
kit.addProvider(new OllamaAdapter('http://localhost:11434'));

if (process.env.ANTHROPIC_API_KEY) {
  kit.addProvider(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

// Create authenticated ORM client
const db = createClient({
  endpoint: graphqlUrl,
  headers: { Authorization: `Bearer ${token}` },
});

// ── Pass 1: Query Router ────────────────────────────────────────────
async function routeQuery(question: string, tables: string[]): Promise<string[]> {
  const response = await kit.generate({
    model: 'llama3.2',
    prompt: `You are a query router. Available tables: ${tables.join(', ')}
Given the question, reply with a JSON array of table names to search.
Question: ${question}
JSON array only:`,
  }) as string;

  const match = response.match(/\[.*\]/s);
  return match ? JSON.parse(match[0]).filter((t: string) => tables.includes(t)) : tables;
}

// ── Pass 2: Vector Search via ORM ───────────────────────────────────
async function searchTable(queryEmbedding: number[], limit = 5) {
  return db.document.findMany({
    where: {
      vectorEmbedding: {
        vector: queryEmbedding,
        metric: 'COSINE',
        distance: 2.0,
      },
    },
    first: limit,
    select: {
      id: true,
      title: true,
      content: true,
      embeddingVectorDistance: true,
    },
  }).execute();
}

// ── Pass 3: Synthesize Answer ───────────────────────────────────────
async function ask(question: string): Promise<string> {
  // Embed the question
  const queryEmbedding = await ollamaClient.generateEmbedding(question);

  // Search via ORM
  const results = await searchTable(queryEmbedding);
  const nodes = results.data?.documents?.nodes || [];

  // Format context
  const context = nodes
    .map((n, i) => `[Source ${i + 1}] ${n.title}\n${n.content}`)
    .join('\n\n');

  // Generate answer
  return kit.generate({
    model: 'llama3.2',
    system: 'Answer based on the provided context. If the context lacks info, say so.',
    messages: [
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  }) as Promise<string>;
}
```

### Multi-Table Vector Search

Search across multiple entity types using the codegen'd ORM (pattern from agentic-db):

```typescript
const VECTOR_CONDITION = (queryEmbedding: number[]) => ({
  vectorEmbedding: { vector: queryEmbedding, metric: 'COSINE' as const, distance: 2.0 },
});

async function multiTableSearch(query: string) {
  const queryEmbedding = await ollamaClient.generateEmbedding(query);
  const where = VECTOR_CONDITION(queryEmbedding);

  const [contacts, documents, notes] = await Promise.all([
    db.contact.findMany({
      where, first: 5,
      select: { id: true, firstName: true, lastName: true, embeddingVectorDistance: true },
    }).execute(),
    db.document.findMany({
      where, first: 5,
      select: { id: true, title: true, content: true, embeddingVectorDistance: true },
    }).execute(),
    db.note.findMany({
      where, first: 5,
      select: { id: true, content: true, embeddingVectorDistance: true },
    }).execute(),
  ]);

  // Merge and sort by distance (lower = more similar)
  return [
    ...(contacts.data?.contacts?.nodes || []).map(n => ({ ...n, table: 'contacts' })),
    ...(documents.data?.documents?.nodes || []).map(n => ({ ...n, table: 'documents' })),
    ...(notes.data?.notes?.nodes || []).map(n => ({ ...n, table: 'notes' })),
  ].sort((a, b) => (a.embeddingVectorDistance ?? 2) - (b.embeddingVectorDistance ?? 2));
}
```

### Embedding Ingestion via ORM

Generate embeddings and store them via ORM (not raw SQL):

```typescript
async function embedAndStore(records: Array<{ id: string; text: string }>) {
  for (const record of records) {
    const embedding = await ollamaClient.generateEmbedding(record.text);

    await db.document.update({
      where: { id: record.id },
      data: { embedding },
    }).execute();
  }
}
```

## OllamaClient API Reference

```typescript
import OllamaClient from '@agentic-kit/ollama';

const client = new OllamaClient('http://localhost:11434');

// Models
await client.listModels();           // string[]
await client.pullModel('llama3.2');   // void
await client.deleteModel('old');      // void

// Generate (single-shot)
const text = await client.generate({ model: 'llama3.2', prompt: 'Hello' });

// Generate (chat)
const chat = await client.generate({
  model: 'llama3.2',
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hi' }],
});

// Generate (streaming)
await client.generate(
  { model: 'llama3.2', prompt: 'Hello' },
  (chunk) => process.stdout.write(chunk)
);

// Embeddings
const vec = await client.generateEmbedding('text', 'nomic-embed-text');
```

### GenerateInput Options

| Option | Type | Description |
|--------|------|-------------|
| `model` | `string` | Model name (required) |
| `prompt` | `string` | Single-shot prompt (routes to `/api/generate`) |
| `messages` | `ChatMessage[]` | Multi-turn messages (routes to `/api/chat`, takes precedence over prompt) |
| `system` | `string` | System prompt |
| `temperature` | `number` | Sampling temperature |
| `maxTokens` | `number` | Maximum tokens to generate |

## AgentProvider Interface

Implement custom providers by conforming to `AgentProvider`:

```typescript
import type { AgentProvider, GenerateInput } from 'agentic-kit';

class MyProvider implements AgentProvider {
  readonly name = 'my-provider';

  async generate(input: GenerateInput): Promise<string> {
    // Your implementation
  }

  async generateStreaming(input: GenerateInput, onChunk: (chunk: string) => void): Promise<void> {
    // Your streaming implementation
  }

  async listModels(): Promise<string[]> {
    return ['model-a', 'model-b'];
  }
}

const kit = new AgentKit();
kit.addProvider(new MyProvider());
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Model for embeddings |
| `CHAT_MODEL` | `llama3.2` | Model for chat/generation |
| `ANTHROPIC_API_KEY` | - | Anthropic API key (for Claude) |
| `OPENAI_API_KEY` | - | OpenAI API key (for GPT) |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No provider set" | Call `kit.addProvider()` before `kit.generate()` |
| "Provider not found" | Check provider name in `kit.setProvider()` matches `provider.name` |
| Ollama connection refused | Ensure Ollama is running: `ollama serve` |
| Embedding model not found | Pull model first: `ollama pull nomic-embed-text` |
| Anthropic 401 | Check `ANTHROPIC_API_KEY` is set |
| Streaming not working | Pass `onChunk` callback in options (second arg to `kit.generate()`) |

## Cross-References

- `constructive-sdk-graphql` — [search-pgvector.md](../../constructive-sdk-graphql/references/search-pgvector.md): ORM vector query patterns
- `constructive-sdk-graphql` — [search-rag.md](../../constructive-sdk-graphql/references/search-rag.md): RAG patterns with codegen'd ORM
- [rag-pipeline.md](./rag-pipeline.md): End-to-end RAG pipeline on Constructive
