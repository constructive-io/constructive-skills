# Tool System

The chatbot's tool system lets the LLM call functions during a conversation. Tools are defined in a shared registry and can execute on the server (API route) or client (browser).

## Tool Registry

All tools live in `src/components/chat/tool-registry.ts`:

```ts
import { z } from 'zod';

export interface ToolEntry<TInput = unknown> {
  description: string;
  inputSchema: z.ZodType<TInput>;
  type: 'server' | 'client';
  needsApproval: boolean;
  execute: (input: TInput) => Promise<string>;
}

export const toolRegistry: Record<string, ToolEntry<any>> = {};
```

Add tools by assigning to `toolRegistry`:

```ts
toolRegistry.get_weather = {
  description: 'Get current weather for a city',
  inputSchema: z.object({ city: z.string() }),
  type: 'server',
  needsApproval: false,
  execute: async ({ city }) =>
    JSON.stringify({ city, temp: '22C', condition: 'Sunny' }),
};
```

The registry is imported by both the API route (for server tools) and the client (for client tool execution and UI rendering).

## Server vs Client Tools

### Server tools (`type: 'server'`)

- `execute` runs inside the API route's `streamText` call
- The LLM receives the result and can use it in its response
- Ideal for: database queries, vector search, external API calls
- Usually set `needsApproval: false` (transparent to the user)

```ts
toolRegistry.search_products = {
  description: 'Search product catalog',
  inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
  type: 'server',
  needsApproval: false,
  execute: async ({ query, limit = 5 }) => {
    const results = await db.products.search(query, limit);
    return JSON.stringify(results);
  },
};
```

### Client tools (`type: 'client'`)

- `execute` runs in the browser after user approval
- The API route registers them without an `execute` function (input only)
- Ideal for: sending emails, creating records, triggering UI actions
- Usually set `needsApproval: true`

```ts
toolRegistry.create_ticket = {
  description: 'Create a support ticket',
  inputSchema: z.object({
    title: z.string(),
    description: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  type: 'client',
  needsApproval: true,
  execute: async (input) => {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const ticket = await res.json();
    return JSON.stringify({ success: true, ticketId: ticket.id });
  },
};
```

## How Tools Are Registered in the API Route

The API route's `buildTools()` function reads the registry and creates Vercel AI SDK tool definitions:

```ts
function buildTools() {
  const entries = Object.entries(toolRegistry);
  if (entries.length === 0) return undefined;

  return Object.fromEntries(
    entries.map(([name, entry]) => [
      name,
      entry.type === 'server'
        ? tool({
            description: entry.description,
            inputSchema: entry.inputSchema,
            needsApproval: entry.needsApproval || undefined,
            execute: async (input) => entry.execute(input),
          })
        : tool({
            description: entry.description,
            inputSchema: entry.inputSchema,
            needsApproval: entry.needsApproval,
            // No execute — client handles it
          }),
    ]),
  );
}
```

## Tool Lifecycle States

Each tool invocation progresses through states:

```
input-streaming     LLM is generating the tool's input arguments
    |
input-available     Input is fully received
    |
    +-- needsApproval: false --> execute immediately
    |
    +-- needsApproval: true
            |
        approval-requested    Approval card shown to user
            |
            +-- Approve --> approval-responded (approved: true)
            |                   |
            |                   +-- server tool: API route executes
            |                   +-- client tool: browser executes via useEffect
            |                   |
            |               output-available    Success
            |               output-error        Execute threw an error
            |
            +-- Reject --> output-denied (via addToolOutput with {rejected: true})
```

## Approval Flow

When a tool has `needsApproval: true`:

1. **Approval card appears** — shows the tool name, badge, and input preview
2. **User clicks Approve or Reject**
   - **Approve**: calls `addToolApprovalResponse({ id, approved: true })`
   - **Reject**: calls `addToolOutput(toolCallId, JSON.stringify({ rejected: true }))`
3. **Client tool execution**: a `useEffect` in `ToolMessage` watches for `approval-responded` state with `approved: true`, then calls `entry.execute(input)`
4. **Result reporting**: the execute result is sent via `addToolOutput(toolCallId, result)`

### One-shot guard

The `executedRef` in `ToolMessage` prevents double-execution:

```ts
const executedRef = useRef(false);
useEffect(() => {
  if (state !== 'approval-responded' || !approval?.approved || executedRef.current) return;
  executedRef.current = true;
  // ... execute
}, [state, approval?.approved]);
```

## Auto-Continuation

After a tool completes (approved or auto-executed), the chat needs to send the result back to the LLM so it can continue responding. This is handled by `sendAutomaticallyWhen` in `chat-context.tsx`:

```ts
sendAutomaticallyWhen: ({ messages }) => {
  // Check if all approval-required tools are resolved
  // Use one-shot guard (autoSentRef) to prevent infinite loops
  // Skip if any tool was rejected
  // Return true to auto-send once all tools are done
}
```

Key behaviors:
- Waits until ALL tool parts in the last assistant message are resolved
- Fires only once per approval cycle (one-shot `autoSentRef`)
- Resets the guard when new approval parts appear
- Skips auto-send if any tool was rejected (the rejection message is the final response)

## Tool UI Customization

Each tool's visual appearance is customizable via `src/components/chat/tool-ui-config.ts`:

```ts
export interface ToolUIConfig {
  /** Status text at each lifecycle stage */
  labels: {
    streaming: string;   // While LLM streams tool input
    executing: string;   // While execute() runs
    done: string;        // On success
    error: string;       // On failure
  };
  /** Icon in the approval card header */
  icon: LucideIcon;
  /** Colored badge in the approval card */
  approval?: {
    badge: {
      label: string;                        // e.g. "Send Email"
      icon: LucideIcon;                     // Small icon in badge
      variant: 'create' | 'update' | 'delete'; // green / blue / red
    };
  };
  /** Custom renderer for tool input preview */
  renderPreview?: (input: any) => React.ReactNode;
}
```

### Default UI

If no override is set, tools use:
- Labels: "Working..." / "Executing..." / "Done" / "Failed"
- Icon: `Wrench`
- No approval badge
- Key-value `DefaultPreview` for input display

### Per-tool overrides

Add entries to `toolUIRegistry`:

```ts
const toolUIRegistry = {
  search_docs: {
    labels: { streaming: 'Searching...', done: 'Found results' },
    icon: Search,
  },
  delete_record: {
    labels: { executing: 'Deleting...', done: 'Deleted', error: 'Delete failed' },
    icon: Trash2,
    approval: {
      badge: { label: 'Delete Record', icon: Trash2, variant: 'delete' },
    },
  },
};
```

Only the fields you provide are overridden; the rest fall back to defaults.

### Custom preview

For tools where the default key-value preview isn't ideal:

```ts
toolUIRegistry.create_chart = {
  icon: BarChart,
  renderPreview: (input) => (
    <div className="mt-2 text-xs">
      <p className="font-medium">{input.title}</p>
      <p className="text-muted-foreground">{input.type} chart with {input.data?.length} data points</p>
    </div>
  ),
};
```

## ToolMessage Component

`ToolMessage` renders the full tool lifecycle:

1. **Streaming** — `ToolStatus` with shimmer text
2. **Approval pending** — `ToolApprovalCard` with badge + preview + Approve/Reject buttons
3. **Executing** — `ToolStatus` spinner with "Executing..." label
4. **Done** — `ToolStatus` green check with done label
5. **Error** — `ExpandableError` with clickable details
6. **Rejected** — `ToolStatus` error with "Rejected" label

### ToolStatus component

Renders a compact status line with icon + text:
- `loading`: spinning Loader2 icon (via `motion/react`) + shimmer text
- `done`: green Check icon
- `error`: red CircleAlert icon
