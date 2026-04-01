# Page Context Scraping

The chatbot scrapes DOM elements marked with `data-chat-*` attributes to give the LLM awareness of what's on the page.

## How It Works

1. User sends a message
2. `ChatProvider` calls `scrapePageContext()` before sending the API request
3. The scraper queries all elements with `[data-chat-component]`
4. For each visible element, it collects the component name and all `data-chat-*` attributes
5. The results are sent as `context` in the request body
6. The API route injects them into the system prompt

## The `data-chat-*` Attribute Convention

### Required: `data-chat-component`

Every element you want the chatbot to see must have `data-chat-component`:

```html
<div data-chat-component="product-card">...</div>
```

This identifies the element type. The value should be a descriptive name the LLM can understand.

### Optional: `data-chat-*` attributes

Add any `data-chat-*` attribute to provide structured data:

```html
<div
  data-chat-component="order-summary"
  data-chat-total="$142.50"
  data-chat-items="3"
  data-chat-status="pending"
>...</div>
```

The `data-chat-` prefix is stripped, so the LLM sees:

```json
{"total": "$142.50", "items": "3", "status": "pending"}
```

## Scraper Rules

- **Visibility**: only elements with a truthy `offsetParent` are scraped (hidden elements are skipped). Exception: `position: fixed` elements are always included.
- **Max nodes**: capped at 50 elements per scrape to keep the context window manageable.
- **Prefix stripping**: `data-chat-` is removed from attribute keys. `data-chat-component` is used as the node name, not included in attributes.
- **Values are strings**: all attribute values are strings. The LLM interprets them in context.

## Patterns

### Static page content

Annotate key sections so the chatbot can answer "what's on this page":

```html
<header data-chat-component="page-header" data-chat-title="Pricing Plans">
  <h1>Pricing Plans</h1>
</header>

<section data-chat-component="plan" data-chat-name="Starter" data-chat-price="Free" data-chat-limits="1 project, 100 API calls/day">
  ...
</section>

<section data-chat-component="plan" data-chat-name="Pro" data-chat-price="$29/mo" data-chat-limits="Unlimited projects, 10k API calls/day">
  ...
</section>
```

The LLM receives:

```
Page context:
- page-header: {"title":"Pricing Plans"}
- plan: {"name":"Starter","price":"Free","limits":"1 project, 100 API calls/day"}
- plan: {"name":"Pro","price":"$29/mo","limits":"Unlimited projects, 10k API calls/day"}
```

### Dynamic data views

Annotate data grids and tables with summary metadata:

```tsx
<div
  data-chat-component="data-table"
  data-chat-entity="users"
  data-chat-total-rows={String(totalCount)}
  data-chat-visible-columns={visibleColumns.join(',')}
  data-chat-sort={`${sortField}:${sortDir}`}
  data-chat-active-filters={JSON.stringify(filters)}
>
  <DataGrid ... />
</div>
```

### Navigation state

Let the chatbot know where the user is:

```tsx
<nav
  data-chat-component="sidebar"
  data-chat-section={currentSection}
  data-chat-active-item={activeItem}
>
  ...
</nav>

<main data-chat-component="page" data-chat-route={pathname}>
  ...
</main>
```

### Forms

Annotate forms so the chatbot can help with them:

```tsx
<form
  data-chat-component="settings-form"
  data-chat-section="notifications"
  data-chat-has-unsaved-changes={String(isDirty)}
>
  ...
</form>
```

### Conditional context

Only add attributes when relevant:

```tsx
<div
  data-chat-component="dashboard"
  data-chat-view={currentView}
  {...(selectedItem && { 'data-chat-selected-item': selectedItem.name })}
  {...(error && { 'data-chat-error': error.message })}
>
  ...
</div>
```

## Best Practices

1. **Be descriptive with component names** — use `user-profile-card` not `card1`
2. **Include actionable data** — the LLM can reference specific values in its responses
3. **Keep values concise** — long paragraphs of text as attribute values waste context
4. **Use commas for lists** — `data-chat-tags="react,typescript,next"` is cleaner than JSON arrays
5. **Stringify objects sparingly** — flat key-value attributes are easier for the LLM to parse
6. **Don't over-annotate** — mark the 5-10 most important elements, not every div. The 50-node cap exists for a reason.
7. **Use dynamic values** — bind React state to attributes so context updates automatically:

```tsx
<div
  data-chat-component="search-results"
  data-chat-query={searchQuery}
  data-chat-result-count={String(results.length)}
  data-chat-page={String(currentPage)}
/>
```

## Disabling Scraping

Pass `scrape: false` to `ChatProvider`:

```tsx
<ChatProvider config={{ scrape: false }}>
```

When disabled, no `context` is sent in the API request, and the system prompt omits the "Page context" section.

## How Context Reaches the LLM

```
DOM elements with data-chat-*
        |
    scrapePageContext()  →  ScrapedNode[]
        |
    ChatProvider transport  →  { context: ScrapedNode[], ... }
        |
    API route POST body  →  body.context
        |
    buildSystemPrompt(context)  →  system prompt string
        |
    streamText({ system: ... })  →  LLM sees page context
```

The `ScrapedNode` type:

```ts
interface ScrapedNode {
  component: string;                  // from data-chat-component
  attributes: Record<string, string>; // from other data-chat-* attrs
}
```
