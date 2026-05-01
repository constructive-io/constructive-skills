# Payload Strategies

Detailed examples of each `DataJobTrigger` payload strategy.

## `row_id` (default) — Just the Row ID

The lightest payload. The function fetches full data via GraphQL as needed.

```typescript
{
  $type: 'DataJobTrigger',
  data: { task_identifier: 'process_invoice' }
}
// payload: { "id": "abc-123" }
```

Best for: most use cases where the function needs fresh data anyway.

## `row` — Full Row as JSON

Sends the entire `NEW` (or `OLD` for DELETE) row.

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'audit_change',
    payload_strategy: 'row',
    events: ['INSERT', 'UPDATE', 'DELETE'],
  }
}
// INSERT payload: { "id": "...", "amount": 100, "status": "paid", "created_at": "..." }
// DELETE payload: { "id": "...", "amount": 100, "status": "paid", ... } (OLD row)
```

Add `include_old: true` to also get the previous row on UPDATE:
```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'diff_audit',
    payload_strategy: 'row',
    events: ['UPDATE'],
    include_old: true,
  }
}
// payload: { "new": { ... }, "old": { ... } }
```

Best for: audit trails, full-context processing, diffing old vs new values.

## `fields` — Selected Columns Only

Sends only the columns you specify. Reduces payload size.

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'sync_to_stripe',
    payload_strategy: 'fields',
    payload_fields: ['id', 'amount', 'currency', 'status'],
    events: ['INSERT'],
  }
}
// payload: { "id": "...", "amount": 100, "currency": "USD", "status": "draft" }
```

Best for: external API sync where only specific fields matter.

## `custom` — Mapped Key Names

Renames columns in the payload. Useful when the external system expects different field names.

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'webhook_fire',
    payload_strategy: 'custom',
    payload_custom: {
      invoice_id: 'id',
      total: 'amount',
      state: 'status',
    },
    events: ['INSERT'],
  }
}
// payload: { "invoice_id": "...", "total": 100, "state": "draft" }
```

Best for: webhook dispatch, external API integration with specific payload shapes.

## Adding Metadata

Any strategy can include table/schema metadata with `include_meta: true`:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'generic_audit',
    payload_strategy: 'row_id',
    include_meta: true,
    events: ['INSERT', 'UPDATE', 'DELETE'],
  }
}
// payload: { "id": "...", "_meta": { "schema": "app_public", "table": "invoices", "event": "INSERT" } }
```

Best for: generic handlers that process events from multiple tables.
