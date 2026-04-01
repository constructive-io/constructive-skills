---
name: constructive-chatbot
description: "AI chatbot widget from the @constructive registry — install via shadcn, set up the API route, configure providers, add data-chat-* attributes for page context scraping, define server/client tools, and customize tool UI. Use when adding a chatbot to a Next.js app, building tool-calling flows, wiring up embeddings, or configuring page-aware AI chat."
compatibility: React 19, Next.js 15+, Vercel AI SDK, Tailwind CSS v4
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Chatbot

AI chat widget distributed via the @constructive shadcn registry. Includes page context scraping, tool calling (server + client), approval flows, and configurable LLM/embeddings providers.

## When to Apply

Use this skill when:
- Installing the chatbot widget in a Next.js app
- Setting up the chat API route and LLM provider
- Adding `data-chat-*` attributes to expose page context to the AI
- Defining tools (server-side or client-side) for the chatbot to call
- Customizing tool UI (labels, icons, approval badges)
- Configuring embeddings for RAG-powered chat
- Debugging tool lifecycle or approval flows

## Install

### 1. Registry config

Add the `@constructive` registry to `components.json`:

```json
{
  "registries": {
    "@constructive": "https://constructive-io.github.io/dashboard/r/{name}.json"
  }
}
```

### 2. Install the block

```bash
npx shadcn@latest add @constructive/chat
```

This installs:
- Components into `src/components/chat/`
- API route at `src/app/api/chat/route.ts`
- Test route at `src/app/api/chat/test/route.ts`

### 3. CSS setup

In `globals.css`:

```css
@plugin "@tailwindcss/typography";
@import "@constructive-io/ui/globals.css";
```

### 4. Layout setup

In your root `layout.tsx`:

```tsx
import { ChatProvider, ChatWidget } from '@/components/chat';
import { PortalRoot } from '@/components/ui/portal';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ChatProvider>
          {children}
          <ChatWidget />
        </ChatProvider>
        <PortalRoot />
      </body>
    </html>
  );
}
```

`ChatProvider` accepts an optional `config` prop — all fields have sensible defaults:

```tsx
<ChatProvider config={{
  api: '/api/chat',           // API endpoint (default)
  title: 'AI Chat',           // Header title
  subtitle: 'Ask anything.',  // Empty-state subtitle
  suggestions: ['What is this page about?', 'Summarize the main content'],
  scrape: true,               // Enable DOM scraping (default)
  storageKey: 'chat-widget-settings', // localStorage key
}} />
```

## API Route

The installed route at `src/app/api/chat/route.ts` handles:
- LLM provider creation (Anthropic or OpenAI-compatible)
- System prompt with scraped page context
- Tool registration from the tool registry
- Streaming response via Vercel AI SDK

The route receives `providerConfig` and `embeddingsConfig` from the client (stored in the Settings panel). No server-side env vars required — the user configures everything in the UI.

See [configuration.md](./references/configuration.md) for provider presets and API route details.

## Page Context Scraping

The chatbot automatically scrapes DOM elements with `data-chat-*` attributes and sends them as context to the LLM.

### Adding context to your page

Mark elements with `data-chat-component` and optional `data-chat-*` attributes:

```html
<!-- Basic: just identify the component -->
<div data-chat-component="product-card">...</div>

<!-- With attributes: give the AI structured data -->
<div
  data-chat-component="pricing-table"
  data-chat-plan="Pro"
  data-chat-price="$29/mo"
  data-chat-features="unlimited-projects,api-access,priority-support"
>...</div>

<!-- Navigation context -->
<nav data-chat-component="sidebar" data-chat-section="settings" data-chat-active-tab="billing">
  ...
</nav>

<!-- Data display -->
<table
  data-chat-component="user-table"
  data-chat-total-rows="142"
  data-chat-sort="created_at:desc"
  data-chat-filters="role:admin,status:active"
>...</table>
```

### How scraping works

1. On each message send, the scraper queries all `[data-chat-component]` elements
2. For each visible element, it collects the component name and all `data-chat-*` attributes
3. The scraped nodes are sent as `context` in the API request body
4. The API route injects them into the system prompt:
   ```
   Page context:
   - pricing-table: {"plan":"Pro","price":"$29/mo","features":"unlimited-projects,api-access,priority-support"}
   - user-table: {"total-rows":"142","sort":"created_at:desc","filters":"role:admin,status:active"}
   ```

**Rules:**
- Only visible elements are scraped (checked via `offsetParent`)
- Max 50 nodes per scrape
- The `data-chat-` prefix is stripped from attribute keys
- Set `scrape: false` in config to disable

See [scraping.md](./references/scraping.md) for advanced patterns and best practices.

## Tools

The chatbot supports tool calling via a registry pattern. Tools can run on the server (API route) or client (browser), with optional user approval.

### Defining tools

Edit `src/components/chat/tool-registry.ts`:

```ts
import { z } from 'zod';
import type { ToolEntry } from './tool-registry';

// Server tool — executes in the API route
toolRegistry.search_docs = {
  description: 'Search the knowledge base for relevant documents',
  inputSchema: z.object({ query: z.string() }),
  type: 'server',
  needsApproval: false,
  execute: async ({ query }) => {
    const results = await searchVectorStore(query);
    return JSON.stringify({ results });
  },
};

// Client tool — executes in the browser, requires approval
toolRegistry.send_email = {
  description: 'Send an email to a recipient',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  type: 'client',
  needsApproval: true,
  execute: async ({ to, subject, body }) => {
    await fetch('/api/email', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body }),
    });
    return `Email sent to ${to}`;
  },
};
```

### Server vs Client tools

| | Server | Client |
|---|---|---|
| **Where** | API route (Node.js) | Browser |
| **Use for** | DB queries, API calls, embeddings search | UI actions, user-facing side effects |
| **`needsApproval`** | Usually `false` | Usually `true` |
| **`execute`** | Runs in `route.ts` | Runs in `ToolMessage` component |

### Tool lifecycle

```
input-streaming → input-available → [approval-requested → approval-responded] → output-available
                                                                               → output-denied
                                                                               → output-error
```

Tools with `needsApproval: true` show an approval card. After approval, client tools execute in the browser; server tools execute in the API route.

See [tool-system.md](./references/tool-system.md) for lifecycle details, approval flow, auto-continuation, and UI customization.

### Customizing tool UI

Edit `src/components/chat/tool-ui-config.ts` to override labels, icons, and approval badges per tool:

```ts
import { CloudSun, Mail } from 'lucide-react';

const toolUIRegistry = {
  search_docs: {
    labels: { streaming: 'Searching...', done: 'Found results' },
    icon: Search,
  },
  send_email: {
    labels: { streaming: 'Preparing email...', executing: 'Sending...', done: 'Email sent', error: 'Send failed' },
    icon: Mail,
    approval: {
      badge: { label: 'Send Email', icon: Mail, variant: 'create' },
    },
  },
};
```

## Embeddings Setup

The chatbot includes embeddings provider configuration for RAG workflows. The Settings panel has a dedicated "Embeddings Model" section.

### How to wire embeddings into tools

1. User configures embeddings provider in Settings (OpenAI or OpenAI-compatible)
2. The `embeddingsConfig` is sent with every API request
3. In your API route or server tool, use the config to generate/query embeddings:

```ts
// In a server tool's execute function or custom API route logic:
toolRegistry.search_docs = {
  description: 'Search documents using semantic similarity',
  inputSchema: z.object({ query: z.string() }),
  type: 'server',
  needsApproval: false,
  execute: async ({ query }) => {
    // Access embeddingsConfig from the request body
    // (extend the API route to pass it through)
    const embedding = await generateEmbedding(query, embeddingsConfig);
    const results = await vectorStore.similaritySearch(embedding);
    return JSON.stringify({ results });
  },
};
```

### Supported providers

| Provider | Preset model | Dimensions |
|----------|-------------|------------|
| OpenAI | `text-embedding-3-small` | 1536 |
| OpenAI Compatible (Ollama, etc.) | `nomic-embed-text` | 768 |

See [configuration.md](./references/configuration.md) for the full provider presets and settings shape.

## Architecture

```
ChatProvider (context + state)
├── ChatWidget (positioning shell)
│   ├── ChatPanel (main view)
│   │   ├── ChatMessages (message list + tool rendering)
│   │   │   ├── ChatMessageContent (markdown rendering)
│   │   │   └── ToolMessage (tool lifecycle + approval)
│   │   │       ├── ToolStatus (spinner/check/error + shimmer)
│   │   │       └── ToolApprovalCard (approve/reject UI)
│   │   ├── ChatInput (message input)
│   │   └── ChatSettings (provider config panel)
│   └── ChatFab (floating trigger button)
```

### Key files after install

| File | Purpose |
|------|---------|
| `src/components/chat/index.ts` | Public exports |
| `src/components/chat/chat.types.ts` | Types, defaults, provider presets |
| `src/components/chat/chat-context.tsx` | React context, state, Vercel AI SDK integration |
| `src/components/chat/tool-registry.ts` | Tool definitions (consumer edits this) |
| `src/components/chat/tool-ui-config.ts` | Per-tool UI overrides (consumer edits this) |
| `src/components/chat/tool-message.tsx` | Tool rendering, approval cards, client execution |
| `src/components/chat/dom-scraper.ts` | Page context scraping logic |
| `src/app/api/chat/route.ts` | API route (LLM + tools) |
| `src/app/api/chat/test/route.ts` | Connection test endpoint |

## Reference Guide

- [tool-system.md](./references/tool-system.md) — Tool registry, lifecycle states, approval flow, auto-continuation, client execution
- [configuration.md](./references/configuration.md) — Provider presets, ChatConfig, API route internals, embeddings config
- [scraping.md](./references/scraping.md) — data-chat-* attributes, scraper behavior, context patterns
