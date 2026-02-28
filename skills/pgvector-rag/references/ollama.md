---
name: ollama-integration
description: Integrate Ollama for local LLM inference in TypeScript applications. Use when asked to "use Ollama", "run local LLM", "generate text with AI", "set up Ollama client", or when building applications that need local AI inference.
compatibility: Node.js 18+, Ollama installed and running
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Ollama Integration

Integrate Ollama for local LLM inference in TypeScript applications. Ollama provides a simple API for running language models locally.

## When to Apply

Use this skill when:
- Running LLMs locally without cloud APIs
- Generating text or embeddings with Ollama
- Building AI features that need to work offline
- Implementing RAG pipelines with local models
- Testing AI applications without API costs

## Prerequisites

### Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start the server
ollama serve
```

### Pull Required Models

```bash
# Embedding model (768 dimensions)
ollama pull nomic-embed-text

# Chat/generation model
ollama pull mistral

# Alternative models
ollama pull llama2
ollama pull codellama
```

## OllamaClient Implementation

Complete TypeScript client for Ollama API:

```typescript
// src/utils/ollama.ts
import fetch from 'cross-fetch';

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
}

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
  }

  // Generate embeddings for text
  async generateEmbedding(
    text: string,
    model: string = 'nomic-embed-text'
  ): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate embedding: ${response.statusText}`);
    }

    const data: OllamaEmbeddingResponse = await response.json();
    return data.embedding;
  }

  // Generate text response (non-streaming)
  async generateResponse(
    prompt: string,
    context?: string,
    model: string = 'mistral'
  ): Promise<string> {
    const fullPrompt = context
      ? `Context: ${context}\n\nQuestion: ${prompt}\n\nAnswer:`
      : prompt;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate response: ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response;
  }

  // Generate text response (streaming)
  async generateStreamingResponse(
    prompt: string,
    onChunk: (chunk: string) => void,
    context?: string,
    model: string = 'mistral'
  ): Promise<void> {
    const fullPrompt = context
      ? `Context: ${context}\n\nQuestion: ${prompt}\n\nAnswer:`
      : prompt;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate streaming response: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data: OllamaResponse = JSON.parse(line);
          if (data.response) {
            onChunk(data.response);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  }

  // Chat completion API
  async chat(
    messages: OllamaChatMessage[],
    model: string = 'mistral'
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to chat: ${response.statusText}`);
    }

    const data: OllamaChatResponse = await response.json();
    return data.message.content;
  }

  // List available models
  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.statusText}`);
    }

    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  }

  // Check if Ollama is running
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/embeddings` | POST | Generate embeddings |
| `/api/generate` | POST | Generate text completion |
| `/api/chat` | POST | Chat completion |
| `/api/tags` | GET | List available models |
| `/api/pull` | POST | Pull a model |

## Usage Examples

### Basic Text Generation

```typescript
const ollama = new OllamaClient();

const response = await ollama.generateResponse(
  'Explain machine learning in simple terms'
);
console.log(response);
```

### With Context (RAG)

```typescript
const context = 'Our company was founded in 2020 and has 50 employees.';
const question = 'When was the company founded?';

const response = await ollama.generateResponse(question, context);
// "Based on the context, the company was founded in 2020."
```

### Streaming Response

```typescript
await ollama.generateStreamingResponse(
  'Write a short poem about coding',
  (chunk) => process.stdout.write(chunk)
);
```

### Chat Conversation

```typescript
const messages = [
  { role: 'system', content: 'You are a helpful coding assistant.' },
  { role: 'user', content: 'How do I reverse a string in JavaScript?' },
];

const response = await ollama.chat(messages);
console.log(response);
```

### Generate Embeddings

```typescript
const text = 'Machine learning is a subset of artificial intelligence.';
const embedding = await ollama.generateEmbedding(text);

console.log(`Embedding dimensions: ${embedding.length}`); // 768 for nomic-embed-text
```

## Model Selection

### Embedding Models

| Model | Dimensions | Speed | Quality |
|-------|------------|-------|---------|
| `nomic-embed-text` | 768 | Fast | Good |
| `mxbai-embed-large` | 1024 | Medium | Better |
| `all-minilm` | 384 | Very Fast | Acceptable |

### Generation Models

| Model | Size | Speed | Use Case |
|-------|------|-------|----------|
| `mistral` | 7B | Fast | General purpose |
| `llama2` | 7B | Fast | General purpose |
| `codellama` | 7B | Fast | Code generation |
| `mixtral` | 8x7B | Slow | High quality |

## Environment Configuration

```bash
# Default Ollama host
export OLLAMA_HOST=http://localhost:11434

# For Docker/CI environments
export OLLAMA_HOST=http://ollama:11434
```

## Testing with Ollama

```typescript
import { OllamaClient } from '../src/utils/ollama';

let ollama: OllamaClient;

beforeAll(() => {
  ollama = new OllamaClient();
});

test('should generate embedding', async () => {
  const embedding = await ollama.generateEmbedding('test text');
  expect(embedding).toHaveLength(768);
  expect(embedding.every(n => typeof n === 'number')).toBe(true);
});

test('should generate response', async () => {
  const response = await ollama.generateResponse('Say hello');
  expect(response).toBeTruthy();
  expect(typeof response).toBe('string');
});
```

## CI/CD Integration

In GitHub Actions, use the Ollama service container:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - 11434:11434

env:
  OLLAMA_HOST: http://ollama:11434

steps:
  - name: Pull models
    run: |
      wget -q -O - --post-data='{"name": "nomic-embed-text"}' \
        --header='Content-Type: application/json' \
        http://ollama:11434/api/pull
      wget -q -O - --post-data='{"name": "mistral"}' \
        --header='Content-Type: application/json' \
        http://ollama:11434/api/pull
```

## Error Handling

```typescript
async function safeGenerate(prompt: string): Promise<string | null> {
  const ollama = new OllamaClient();

  // Check if Ollama is running
  if (!await ollama.isHealthy()) {
    console.error('Ollama is not running');
    return null;
  }

  try {
    return await ollama.generateResponse(prompt);
  } catch (error) {
    console.error('Generation failed:', error);
    return null;
  }
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Connection refused" | Start Ollama: `ollama serve` |
| "Model not found" | Pull model: `ollama pull <model>` |
| Slow responses | Use smaller model or reduce prompt length |
| Out of memory | Use quantized model or smaller context |
| Timeout errors | Increase timeout or use streaming |

## Package Dependencies

```json
{
  "dependencies": {
    "cross-fetch": "^4.1.0"
  }
}
```

## References

- Related skill: `rag-pipeline` for complete RAG implementation
- Related skill: `pgvector-embeddings` for storing embeddings
- Related skill: `github-workflows-ollama` for CI/CD setup
- [Ollama documentation](https://ollama.com/docs)
- [Ollama API reference](https://github.com/ollama/ollama/blob/main/docs/api.md)
