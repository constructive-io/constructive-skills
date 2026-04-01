# Configuration

## ChatConfig

Passed to `<ChatProvider config={...}>`. All fields are optional with sensible defaults.

```ts
interface ChatConfig {
  api?: string;           // API endpoint (default: "/api/chat")
  scrape?: boolean;       // Enable DOM scraping (default: true)
  title?: string;         // Chat header title (default: "AI Chat")
  subtitle?: string;      // Empty-state subtitle (default: "Ask anything about this page.")
  suggestions?: string[]; // Quick-start prompts
  storageKey?: string;    // localStorage key (default: "chat-widget-settings")
}
```

## LLM Provider Settings

Configured by the user via the Settings panel in the chat UI. Stored in localStorage.

```ts
interface LLMSettings {
  provider: 'anthropic' | 'openai-compat';
  apiKey: string;
  baseUrl: string;
  model: string;
}
```

### Provider presets

| Provider | Label | Default Base URL | Default Model |
|----------|-------|-----------------|---------------|
| `anthropic` | Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-20250514` |
| `openai-compat` | OpenAI Compatible | `http://localhost:11434/v1` | `gpt-4o` |

The "OpenAI Compatible" provider works with OpenAI, Ollama, vLLM, or any API that implements the OpenAI chat completions format.

### How settings flow

1. User configures in Settings panel → saved to localStorage
2. On each message send, `ChatProvider` reads from `settingsRef.current`
3. Sent as `providerConfig` in the API request body
4. API route calls `createModel(providerConfig)` to instantiate the provider

## Embeddings Provider Settings

Configured in the Settings panel under "Embeddings Model". Stored separately in localStorage (`${storageKey}-embeddings`).

```ts
interface EmbeddingsSettings {
  provider: 'openai' | 'openai-compat';
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}
```

### Embeddings presets

| Provider | Label | Default Base URL | Default Model | Dimensions |
|----------|-------|-----------------|---------------|------------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | 1536 |
| `openai-compat` | OpenAI Compatible | `http://localhost:11434/v1` | `nomic-embed-text` | 768 |

### Using embeddings in tools

The `embeddingsConfig` is sent with every API request alongside `providerConfig`. To use it in a server tool:

1. Extend the API route to extract `embeddingsConfig` from the request body (it's already sent)
2. Pass it to your tool's execute function or use it in a custom route handler

```ts
// In your API route, embeddingsConfig is available:
const embeddingsConfig = body.embeddingsConfig;

// Use it to generate embeddings for RAG:
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const embeddingModel = createOpenAI({
  apiKey: embeddingsConfig.apiKey,
  baseURL: embeddingsConfig.baseUrl,
}).embedding(embeddingsConfig.model);

const { embedding } = await embed({
  model: embeddingModel,
  value: query,
});
```

### RAG tool example

A complete server tool that uses embeddings for document search:

```ts
toolRegistry.search_docs = {
  description: 'Search knowledge base using semantic similarity',
  inputSchema: z.object({ query: z.string() }),
  type: 'server',
  needsApproval: false,
  execute: async ({ query }) => {
    // 1. Generate embedding for the query
    const embedding = await generateEmbedding(query);
    // 2. Query vector store (pgvector, Pinecone, etc.)
    const results = await vectorStore.similaritySearch(embedding, { limit: 5 });
    // 3. Return results for the LLM to use
    return JSON.stringify({ results: results.map(r => ({ title: r.title, content: r.content })) });
  },
};
```

## API Route

### Request body

The API route receives:

```ts
{
  messages: UIMessage[];         // Chat history
  providerConfig: {              // LLM settings from UI
    provider: 'anthropic' | 'openai-compat';
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  embeddingsConfig: {            // Embeddings settings from UI
    provider: 'openai' | 'openai-compat';
    apiKey: string;
    baseUrl: string;
    model: string;
    dimensions: number;
  };
  context: ScrapedNode[];        // Scraped page context
}
```

### Model creation

```ts
function createModel(config: ProviderConfig) {
  if (config.provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: config.apiKey });
    return anthropic(config.model || 'claude-sonnet-4-20250514');
  }
  // OpenAI-compatible
  const provider = createOpenAICompatible({
    name: 'openai-compat',
    baseURL: config.baseUrl.replace(/\/$/, ''),
    apiKey: config.apiKey || undefined,
  });
  return provider.chatModel(config.model || 'gpt-4o');
}
```

### System prompt

The system prompt includes scraped page context:

```ts
function buildSystemPrompt(context: ScrapedNode[]) {
  let prompt = 'You are a helpful AI assistant embedded in a web page. Be concise and helpful.';
  if (context.length > 0) {
    prompt += '\n\nPage context:\n';
    prompt += context.map(n => `- ${n.component}: ${JSON.stringify(n.attributes)}`).join('\n');
  }
  return prompt;
}
```

### streamText configuration

```ts
const result = streamText({
  model,
  system: buildSystemPrompt(context),
  messages,
  tools: buildTools(),
  maxOutputTokens: 4096,
  stopWhen: stepCountIs(2),  // Max 2 tool-use rounds
  temperature: 0.7,
});
```

`stopWhen: stepCountIs(2)` prevents infinite tool-calling loops — the LLM gets at most 2 rounds of tool use before it must respond with text.

### Test route

The test route at `src/app/api/chat/test/route.ts` validates the provider config by making a minimal LLM call. Used by the "Test Connection" button in Settings.

## Settings Persistence

- LLM settings: `localStorage.getItem('chat-widget-settings')`
- Embeddings settings: `localStorage.getItem('chat-widget-settings-embeddings')`
- Custom key: set `storageKey` in `ChatConfig` to change the prefix

Settings are loaded on mount and saved on every change. The `settingsRef` pattern ensures the transport always uses the latest settings without recreating the transport object.

## Local Development with Ollama

For local development without API keys:

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2`
3. Pull an embeddings model: `ollama pull nomic-embed-text`
4. In chat Settings:
   - Provider: "OpenAI Compatible"
   - Base URL: `http://localhost:11434/v1`
   - Model: `llama3.2`
   - API Key: (leave empty)
5. For embeddings:
   - Provider: "OpenAI Compatible"
   - Base URL: `http://localhost:11434/v1`
   - Model: `nomic-embed-text`
   - Dimensions: `768`
