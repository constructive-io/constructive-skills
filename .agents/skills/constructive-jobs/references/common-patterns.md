# Common Job Trigger Patterns

Full blueprint examples for common job trigger scenarios.

## 1. Email on Invite Creation

Send an email when a new invite is inserted:

```typescript
{
  ref: 'invites',
  table_name: 'invites',
  nodes: [
    ...ORG_NODES,
    {
      $type: 'DataJobTrigger',
      data: {
        task_identifier: 'send_invite_email',
        payload_strategy: 'fields',
        payload_fields: ['id', 'email', 'role'],
        events: ['INSERT'],
      },
    },
  ],
  fields: [
    { name: 'email', type: 'citext', is_required: true },
    { name: 'role', type: 'text', default_value: "'member'" },
    { name: 'accepted_at', type: 'timestamptz' },
  ],
}
```

The `send_invite_email` Knative function receives:
```json
{ "id": "abc-123", "email": "user@example.com", "role": "member" }
```

## 2. External System Sync (Stripe)

Sync data whenever specific fields change:

```typescript
{
  ref: 'invoices',
  table_name: 'invoices',
  nodes: [
    ...ORG_NODES,
    {
      $type: 'DataJobTrigger',
      data: {
        task_identifier: 'sync_to_stripe',
        payload_strategy: 'fields',
        payload_fields: ['id', 'amount', 'currency', 'status'],
        events: ['INSERT', 'UPDATE'],
        watch_fields: ['amount', 'status'],
        queue_name: 'stripe',
        max_attempts: 5,
      },
    },
  ],
  fields: [
    { name: 'amount', type: 'numeric', is_required: true },
    { name: 'currency', type: 'text', default_value: "'USD'" },
    { name: 'status', type: 'text', default_value: "'draft'" },
    { name: 'stripe_id', type: 'text' },
  ],
}
```

`watch_fields` means the UPDATE trigger only fires when `amount` or `status` actually change.

## 3. Conditional Trigger (Fire on Status Value)

Only fire when a specific field has a specific value:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'publish_to_cdn',
    events: ['UPDATE'],
    condition_field: 'status',
    condition_value: 'published',
  },
}
```

Creates a WHEN clause: `WHEN (NEW.status = 'published')`. The trigger only fires on UPDATE when status equals `'published'`.

**Note:** `condition_field` and `watch_fields` cannot both be specified.

## 3b. Compound Conditions (Status Transition)

Fire only when a row transitions from one status to another:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'process_published',
    events: ['UPDATE'],
    payload_strategy: 'custom',
    payload_custom: { doc_id: 'id', title: 'title' },
    conditions: [
      { field: 'status', op: '=', value: 'published' },
      { field: 'status', op: '=', value: 'draft', row: 'OLD' },
    ],
  },
}
```

Creates a WHEN clause: `WHEN (NEW.status = 'published' AND OLD.status = 'draft')`. The trigger only fires when `status` changes from `'draft'` to `'published'`.

## 3c. Compound Conditions with OR (MIME Type Filtering)

Fire when status transitions AND the row matches one of several MIME patterns:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'process_media',
    events: ['UPDATE'],
    payload_strategy: 'custom',
    payload_custom: { file_id: 'id', key: 'key', mime_type: 'mime_type' },
    include_meta: true,
    conditions: {
      AND: [
        { field: 'status', op: '=', value: 'ready' },
        { field: 'status', op: '=', value: 'pending', row: 'OLD' },
        { OR: [
          { field: 'mime_type', op: 'LIKE', value: 'image/%' },
          { field: 'mime_type', op: 'LIKE', value: 'video/%' },
        ]},
      ]
    },
  },
}
```

## 3d. DataImageEmbedding (Composition Shorthand)

For the common pattern of embedding image files on status transition, use `DataImageEmbedding` instead of manually wiring SearchVector + DataJobTrigger:

```typescript
nodes: [
  ...STORAGE_NODES,
  { $type: 'DataImageEmbedding' },
]
```

Equivalent to manually configuring SearchVector (512-dim, HNSW, cosine) + DataJobTrigger (UPDATE, `status: pending→ready`, `mime_type LIKE 'image/%'`). Override defaults as needed:

```typescript
{
  $type: 'DataImageEmbedding',
  data: {
    dimensions: 1024,
    metric: 'l2',
    mime_patterns: ['image/%', 'video/%'],
    task_identifier: 'custom_embedding_worker',
  },
}
```

## 4. Audit Trail on Delete

Capture full row data before deletion:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'audit_document_delete',
    payload_strategy: 'row',
    events: ['DELETE'],
    include_meta: true,
  },
}
```

## 5. Debounced Batch Processing

Use `job_key` + `run_at_delay` to debounce rapid changes into a single job:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'aggregate_analytics',
    events: ['INSERT'],
    job_key: 'aggregate_analytics_batch',
    run_at_delay: '5 minutes',
    queue_name: 'analytics',
    priority: 10,
  },
}
```

`job_key` gives the job upsert semantics — subsequent inserts reset the `run_at` timer instead of creating duplicate jobs.

## 6. Webhook Dispatch with Custom Payload

Reshape column names for an external webhook:

```typescript
{
  $type: 'DataJobTrigger',
  data: {
    task_identifier: 'dispatch_webhook',
    payload_strategy: 'custom',
    payload_custom: {
      order_id: 'id',
      total_amount: 'total',
      customer: 'customer_id',
      event_type: 'status',
    },
    events: ['INSERT', 'UPDATE'],
    watch_fields: ['status', 'total'],
  },
}
```

## 7. Multiple Triggers on One Table

A single table can have several `DataJobTrigger` nodes for independent workflows:

```typescript
nodes: [
  ...ORG_NODES,
  {
    $type: 'DataJobTrigger',
    data: {
      task_identifier: 'sync_to_hubspot',
      events: ['INSERT', 'UPDATE'],
      watch_fields: ['email', 'first_name', 'last_name'],
      queue_name: 'crm_sync',
    },
  },
  {
    $type: 'DataJobTrigger',
    data: {
      task_identifier: 'send_welcome_email',
      events: ['INSERT'],
    },
  },
  {
    $type: 'DataJobTrigger',
    data: {
      task_identifier: 'audit_contact_delete',
      payload_strategy: 'row',
      events: ['DELETE'],
    },
  },
],
```

## 8. Embedding Generation Note

`SearchVector` and `SearchUnified` nodes already auto-create embedding job triggers when `enqueue_job: true` (the default). Use `DataJobTrigger` only for custom processing beyond embedding generation:

```typescript
nodes: [
  ...ORG_NODES,
  { $type: 'SearchUnified', data: {
    embedding: { source_fields: ['title', 'content'] },
    bm25: { field_name: 'embedding_text' },
  }},
  // Separate trigger for a different pipeline
  { $type: 'DataJobTrigger', data: {
    task_identifier: 'classify_document',
    events: ['INSERT'],
    payload_strategy: 'fields',
    payload_fields: ['id', 'title', 'content'],
  }},
],
```
