---
name: constructive-jobs
description: "Background job system — JobTrigger blueprint node for enqueuing jobs on row changes (with compound conditions support: AND/OR/NOT combinators, column-aware type resolution), ProcessFileEmbedding/ProcessImageEmbedding/ProcessChunks/ProcessImageVersions composition wrappers, payload strategies, the Knative worker pipeline, scheduled jobs, pg_cron maintenance scheduling, CursorTracker at-least-once delivery, notifications_module, and the app_jobs database extension. Use when asked to 'trigger a job', 'enqueue a background task', 'add a job trigger', 'run a function on row change', 'schedule a job', 'compound conditions', 'file embedding trigger', 'image embedding trigger', 'image versions', 'thumbnails', 'pg_cron', 'maintenance jobs', 'CursorTracker', 'realtime subscriptions', 'notifications module', or when working with JobTrigger/ProcessFileEmbedding/ProcessImageEmbedding/ProcessChunks/ProcessImageVersions in blueprints."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Jobs

Background job infrastructure for the Constructive platform. Declaratively attach triggers to tables that enqueue jobs when rows change, processed by the Knative worker stack.

## When to Apply

- Adding a background job that fires on row INSERT/UPDATE/DELETE
- Wiring a table to a Knative cloud function (e.g., send email on invite creation)
- Syncing data to external systems on change (e.g., Stripe sync on invoice update)
- Generating embeddings, sending notifications, auditing changes
- Scheduling recurring jobs (cron-style)
- Adding file/image embeddings to a storage table

## Architecture

```
Table row change (INSERT/UPDATE/DELETE)
  --> PostgreSQL AFTER trigger (created by JobTrigger node)
    --> app_jobs.add_job(task_identifier, payload)
      --> knative-job-worker polls app_jobs.jobs
        --> POST ${KNATIVE_SERVICE_URL}/${task_identifier}
          --> Knative function handles the job
```

The database extension `pgpm-database-jobs` provides:
- `app_jobs.jobs` — queued/running jobs table
- `app_jobs.scheduled_jobs` — cron-style scheduled jobs table
- `app_jobs.add_job()` — enqueue a one-off job
- `app_jobs.add_scheduled_job()` — register a recurring job

The `JobTrigger` blueprint node automatically creates the PostgreSQL triggers that call `app_jobs.add_job()`.

## JobTrigger Blueprint Node

Add to a table's `nodes[]` in a blueprint definition to auto-create triggers:

```typescript
{
  ref: 'invoices',
  table_name: 'invoices',
  nodes: [
    ...ORG_NODES,
    {
      $type: 'JobTrigger',
      data: {
        task_identifier: 'process_invoice',
      }
    },
  ],
  fields: [
    { name: 'amount', type: { name: 'numeric' }, is_required: true },
    { name: 'status', type: { name: 'text' }, default_value: { value: 'draft' } },
  ],
}
```

This creates INSERT and UPDATE triggers that enqueue a `process_invoice` job with `{ id: row.id }` as the payload.

### Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task_identifier` | string | **(required)** | Job name passed to `add_job` (e.g., `process_invoice`, `sync_to_stripe`) |
| `payload_strategy` | `"row"` \| `"row_id"` \| `"fields"` \| `"custom"` | `"row_id"` | How to build the job payload |
| `payload_fields` | string[] | — | Column names for `fields` strategy |
| `payload_custom` | object | — | Key-to-column mapping for `custom` strategy |
| `events` | `("INSERT" \| "UPDATE" \| "DELETE")[]` | `["INSERT", "UPDATE"]` | Which DML events fire the trigger |
| `watch_fields` | string[] | — | For UPDATE: only fire when these columns change |
| `condition_field` | string | — | Legacy: column for simple equality WHEN clause |
| `condition_value` | string | — | Legacy: value to match for `condition_field` |
| `conditions` | object \| array | — | Compound conditions for WHEN clause (see below) |
| `include_old` | boolean | `false` | Include OLD row in UPDATE payload |
| `include_meta` | boolean | `false` | Include table/schema metadata in payload |
| `job_key` | string | — | Static key for upsert semantics (deduplication) |
| `queue_name` | string | — | Route to a specific worker queue |
| `priority` | integer | `0` | Lower = higher priority |
| `run_at_delay` | string | — | PostgreSQL interval delay (e.g., `'30 seconds'`) |
| `max_attempts` | integer | `25` | Maximum retry attempts |
| `entity_field` | string (column-ref) | — | Column holding (or referencing) the entity_id. Forwarded to the job payload for entity context. For FK lookups, combine with `entity_lookup`. |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK. |

**Constraints:** `conditions`, `condition_field`, and `watch_fields` are mutually exclusive — only one can be specified per trigger.

### Compound Conditions

The `conditions` parameter accepts a structured JSON syntax for complex WHEN clauses. Column types are resolved automatically from the PostgreSQL schema — values in JSON are cast to the correct type at generation time. This system is shared with `EventTracker` (see [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md)) — both use the same `build_condition_ast()` function and `conditionProperties` schema.

**Leaf condition:**
```typescript
{ field: 'status', op: '=', value: 'ready', row: 'NEW' }
```

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `field` | yes | — | Column name (validated against the table) |
| `op` | yes | — | `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM` |
| `value` | conditional | — | Comparison value (omit for `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM`) |
| `row` | no | `'NEW'` | Row reference: `'NEW'` or `'OLD'` |
| `ref` | no | — | Column reference for field-to-field comparison: `{ field: '...', row: '...' }` |

**Array shorthand (implicit AND):**
```typescript
conditions: [
  { field: 'status', op: '=', value: 'ready' },
  { field: 'status', op: '=', value: 'pending', row: 'OLD' },
  { field: 'mime_type', op: 'LIKE', value: 'image/%' },
]
```

**Nested combinators (AND/OR/NOT):**
```typescript
conditions: {
  AND: [
    { field: 'status', op: '=', value: 'ready' },
    { OR: [
      { field: 'mime_type', op: 'LIKE', value: 'image/%' },
      { field: 'mime_type', op: 'LIKE', value: 'video/%' },
    ]},
    { NOT: { field: 'is_draft', op: '=', value: true } },
  ]
}
```

See [references/common-patterns.md](references/common-patterns.md) for full blueprint examples.

### Payload Strategies

See [references/payload-strategies.md](references/payload-strategies.md) for detailed examples of each strategy.

| Strategy | Payload shape | Use case |
|----------|--------------|----------|
| `row_id` (default) | `{ "id": "<uuid>" }` | Lightweight; function fetches full data |
| `row` | Full `NEW`/`OLD` row as JSON | Audit trail, full-context processing |
| `fields` | Selected columns only | Minimize payload; send only what's needed |
| `custom` | Mapped key names | Reshape column names for external APIs |

### Common Patterns

See [references/common-patterns.md](references/common-patterns.md) for full blueprint examples of:
- Conditional triggers (`watch_fields`, `condition_field`, `conditions`)
- Compound conditions (status transitions, MIME type filtering)
- Delayed/debounced jobs (`run_at_delay` + `job_key`)
- Multiple triggers per table
- Email on invite, Stripe sync, audit trail, webhook dispatch

## ProcessFileEmbedding Blueprint Node

Generic, MIME-scoped embedding node for file/storage tables. Composes SearchVector + JobTrigger + ProcessChunks internally. Supports two modes:

- **Direct mode** (default): whole-file to single vector (e.g., CLIP for images). No `extraction` config.
- **Extract mode**: file to text to chunks to per-chunk vectors. Enabled by providing `extraction` config.

Multiple instances can coexist on the same table with different MIME scopes, field names, and embedding strategies.

### Direct Mode (single vector per file)

```typescript
// Image embeddings via CLIP — one vector per image file
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessFileEmbedding', data: {
      mime_patterns: ['image/%'],
      dimensions: 512,
      task_identifier: 'process_image_embedding',
    }},
  ],
}
```

### Extract Mode (file to text to chunks to vectors)

```typescript
// Document embeddings — extract text, chunk, embed each chunk
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessFileEmbedding', data: {
      mime_patterns: ['application/pdf', 'text/%', 'application/vnd.openxmlformats-officedocument.*'],
      dimensions: 768,
      task_identifier: 'process_document_extraction',
      extraction: {
        text_field: 'extracted_text',
        metadata_field: 'extracted_metadata',
      },
      // chunks are enabled by default in extract mode
      chunks: {
        chunk_size: 1000,
        chunk_overlap: 200,
        chunk_strategy: 'paragraph',
      },
    }},
  ],
}
```

### Multi-Modal: Multiple Pipelines on One Table

```typescript
// Knowledge base — three embedding pipelines on one files table
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,

    // Pipeline 1: CLIP visual embeddings for images
    { $type: 'ProcessFileEmbedding', data: {
      field_name: 'image_embedding',
      mime_patterns: ['image/%'],
      dimensions: 512,
      task_identifier: 'process_image_embedding',
    }},

    // Pipeline 2: Text extraction + chunked embeddings for documents
    { $type: 'ProcessFileEmbedding', data: {
      field_name: 'document_embedding',
      mime_patterns: ['application/pdf', 'text/%', 'application/vnd.openxmlformats-officedocument.*'],
      dimensions: 768,
      task_identifier: 'process_document_extraction',
      extraction: {
        text_field: 'extracted_text',
        metadata_field: 'extracted_metadata',
      },
    }},

    // Pipeline 3: Audio/video transcription + chunked embeddings
    { $type: 'ProcessFileEmbedding', data: {
      field_name: 'media_embedding',
      mime_patterns: ['audio/%', 'video/%'],
      dimensions: 768,
      task_identifier: 'process_media_transcription',
      extraction: {
        text_field: 'transcription_text',
        metadata_field: 'transcription_metadata',
      },
    }},
  ],
}
```

### Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `field_name` | string | `'embedding'` | Vector column name |
| `dimensions` | integer | `768` | Vector dimensions (512 for CLIP, 768 for nomic, 1536 for ada-002) |
| `index_method` | `'hnsw'` \| `'ivfflat'` | `'hnsw'` | Index type |
| `metric` | `'cosine'` \| `'l2'` \| `'ip'` | `'cosine'` | Distance metric |
| `index_options` | object | `{}` | Index tuning params (e.g. `{m: 16, ef_construction: 64}`) |
| `mime_patterns` | string[] | `['image/%']` | MIME LIKE patterns (OR'd together) |
| `task_identifier` | string | `'process_file_embedding'` | Job task name |
| `events` | string[] | `['INSERT']` | Trigger events |
| `payload_custom` | object | `{file_id: 'id', key: 'key', mime_type: 'mime_type', bucket_id: 'bucket_id'}` | Payload mapping |
| `trigger_conditions` | object \| array | — | Additional compound conditions (AND'd with MIME filter) |
| `extraction` | object | — | Enables extract mode. Sub-keys: `text_field`, `metadata_field` |
| `include_chunks` | boolean | `true` in extract mode, `false` in direct | Whether to create a chunks table via ProcessChunks |
| `chunks` | object | — | Chunking config: `chunk_size`, `chunk_overlap`, `chunk_strategy`, `metadata_fields`, etc. |


## ProcessImageEmbedding Blueprint Node

Image-specific preset of ProcessFileEmbedding. Delegates entirely to ProcessFileEmbedding with image-oriented defaults.

```typescript
// Minimal — uses all defaults (512d CLIP, image/%, process_image_embedding)
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessImageEmbedding' },
  ],
}
```

**Default overrides vs ProcessFileEmbedding:**

| Parameter | ProcessImageEmbedding default | ProcessFileEmbedding default |
|-----------|---------------------------|---------------------------|
| `dimensions` | `512` | `768` |
| `task_identifier` | `'process_image_embedding'` | `'process_file_embedding'` |
| `mime_patterns` | `['image/%']` | `['image/%']` |

All ProcessFileEmbedding parameters are accepted and forwarded through. You can use ProcessImageEmbedding with `extraction` to enable OCR-based text extraction from images.

## ProcessChunks Blueprint Node

Standalone chunking node that creates a child chunks table for any parent table. Composed internally by ProcessFileEmbedding (enabled by default in extract mode), but can also be used standalone.

The chunks table gets:
- FK to parent (CASCADE delete)
- `content` text field
- `chunk_index` integer
- `embedding vector(N)` with HNSW index
- `metadata` jsonb
- RLS policies inherited from parent
- Optional job trigger for automatic chunking

### Standalone Usage

```typescript
// Add chunking to any table with text content
{
  ref: 'articles',
  table_name: 'articles',
  nodes: [
    'DataId',
    'DataTimestamps',
    { $type: 'ProcessChunks', data: {
      chunk_size: 1000,
      chunk_overlap: 200,
      chunk_strategy: 'paragraph',
      dimensions: 768,
    }},
  ],
  fields: [
    { name: 'title', type: { name: 'text' }, is_required: true },
    { name: 'body', type: { name: 'text' } },
  ],
}
```

### Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `content_field_name` | string | `'content'` | Text column in chunks table |
| `chunk_size` | integer | `1000` | Max characters per chunk |
| `chunk_overlap` | integer | `200` | Overlapping characters between chunks |
| `chunk_strategy` | `'fixed'` \| `'sentence'` \| `'paragraph'` \| `'semantic'` | `'paragraph'` | Splitting strategy |
| `dimensions` | integer | `768` | Per-chunk embedding dimensions |
| `metric` | `'cosine'` \| `'l2'` \| `'ip'` | `'cosine'` | HNSW index metric |
| `chunks_table_name` | string | `'{parent}_chunks'` | Override table name |
| `metadata_fields` | string[] | — | Parent fields to copy into chunk metadata |
| `enqueue_chunking_job` | boolean | `true` | Auto-enqueue chunking job |
| `chunking_task_name` | string | `'generate_chunks'` | Job task name |

## Knative Worker Stack

The runtime consists of three packages:

| Package | Role |
|---------|------|
| `@constructive-io/knative-job-service` | Orchestrator — starts worker + callback server + scheduler |
| `@constructive-io/knative-job-worker` | Polls `app_jobs.jobs`, POSTs to function URL |
| `@constructive-io/knative-job-fn` | Express app factory for function handlers |

### Job Flow

1. **Trigger fires** -> inserts row into `app_jobs.jobs`
2. **Worker polls** -> picks up job by `task_identifier`
3. **Worker POSTs** -> `${KNATIVE_SERVICE_URL}/${task_identifier}` with JSON payload
4. **Function executes** -> returns success/failure
5. **Worker updates** -> marks job as complete or failed (retries up to `max_attempts`)

Headers sent to the function:
- `X-Worker-Id` — worker instance identifier
- `X-Job-Id` — job row ID
- `X-Database-Id` — database context (nullable)
- `X-Actor-Id` — user who triggered the job (nullable)

### Key Environment Variables

| Variable | Description |
|----------|-------------|
| `KNATIVE_SERVICE_URL` | Base URL for Knative functions |
| `JOBS_SCHEMA` | Schema name (default: `app_jobs`) |
| `JOBS_SUPPORT_ANY` | Accept all task types (`true`/`false`) |
| `JOBS_SUPPORTED` | Comma-separated task list (when `JOBS_SUPPORT_ANY=false`) |

## Scheduled Jobs

For recurring jobs, use `app_jobs.add_scheduled_job()` (identifier + payload + cron rule) or the `runtime_schedules` table (in agentic-db). The scheduler component in `knative-job-service` evaluates cron expressions and enqueues jobs at the appropriate times.

## ProcessImageVersions Blueprint Node

Image variant generation node. Composes a JobTrigger that fires on image upload, enqueuing a Knative worker that generates resized/reformatted variants. Source: `node-type-registry/src/process/image-versions.ts`.

```typescript
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'ProcessImageVersions', data: {
      versions: [
        { name: 'thumb', width: 150, height: 150, fit: 'cover', format: 'webp', quality: 80 },
        { name: 'preview', width: 800, height: 600, fit: 'inside', format: 'webp' },
        { name: 'hero', width: 1920, height: 1080, fit: 'cover', format: 'jpeg', quality: 90 },
      ],
      mime_patterns: ['image/%'],            // default
      task_identifier: 'process_image_versions',  // default
    }},
  ],
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `versions` | array | **(required)** | Version definitions: `name`, `width`, `height`, `fit`, `format`, `quality` |
| `mime_patterns` | string[] | `['image/%']` | MIME LIKE patterns |
| `task_identifier` | string | `'process_image_versions'` | Job task name |
| `events` | string[] | `['INSERT']` | Trigger events |
| `queue_name` | string | `'image_processing'` | Worker queue |
| `entity_field` / `entity_lookup` | — | — | Entity billing scope (same as JobTrigger) |

The external Knative worker generates the variants and writes them back as new file records linked to the source image.

## pg_cron Maintenance Scheduling

Seven SQL-only scheduled tasks run entirely inside PostgreSQL via `pg_cron` — they do **not** flow through `app_jobs` or the Knative worker. Registered by `register_maintenance_jobs()` when `pg_cron` is available.

| Job Identifier | Schedule | Description |
|----------------|----------|-------------|
| `usage:collect` | Daily 01:00 UTC | Capture pg_stat telemetry into typed usage_log tables |
| `usage:rollup-daily` | Daily 02:00 UTC | Aggregate usage logs into daily summary tables |
| `usage:reconcile` | 1st of month 03:00 UTC | Bridge daily summaries into billing meters |
| `maintenance:partman` | Daily 03:00 UTC | pg_partman: create new partitions, enforce retention |
| `maintenance:prune-events` | Daily 04:00 UTC | Delete events past per-type retention_days |
| `billing:monthly-rollup` | 1st of month 02:00 UTC | Compress balances into usage_summary |
| `billing:subscription-sweep` | Daily 07:00 UTC | Deactivate expired subscriptions, log to ledger |

All are pure SQL `SECURITY DEFINER` functions — no Node.js or HTTP involved.

## CursorTracker / At-Least-Once Delivery

The realtime subscription system uses a cursor-based polling model for at-least-once event delivery, complementing PostgreSQL `NOTIFY` (which is best-effort). Source: `graphile-realtime-subscriptions/src/`.

### Lifecycle

1. **`start()`** → calls `touch_listener()` to register/heartbeat the listener node
2. **Periodic `drain_changes()` polling** — fetches new `change_log` entries (default batch: 500, default interval: 5s)
3. **Periodic `touch_listener()` heartbeat** — keeps the node alive (default: 30s)
4. **`stop()`** → calls `cleanup_ephemeral()` to remove ephemeral subscriptions and delete the listener node

### RealtimeManager Bridge

`RealtimeManager` converts `ChangeLogEntry` objects from `drain_changes()` into NOTIFY-format payloads (`"OPERATION:rowId"`) and emits them on PgSubscriber's internal EventEmitter. This means cursor-tracked events flow through the same subscription plans as real NOTIFY events — clients receive them identically.

```
CursorTracker (polls change_log)
  → RealtimeManager (converts to NOTIFY format)
    → PgSubscriber.eventEmitter.emit(channel, payload)
      → PostGraphile subscription plans deliver to clients
```

Duplicates are expected — clients should be idempotent. NOTIFY provides instant delivery; cursor polling catches up on anything missed during disconnects or restarts.

## Notifications Module

A 1215-line generator (`notifications_module`) with 5 gated sub-features. Produces a complete notification inbox system with per-user state, delivery tracking, and preference management.

### Sub-Features (Toggle Flags)

| Flag | Default | Tables/Features Generated |
|------|---------|--------------------------|
| *(core — always on)* | — | `notifications` (inbox with category, kind, priority, topic, deep links, grouping, expiry) + `notification_read_state` (per-user sparse read/seen state) |
| `has_channels` | `true` | `notification_channels` (device/push endpoints with type, token, expiry) + `notification_delivery_log` (per-attempt delivery audit trail) |
| `has_preferences` | `true` | `notification_preferences` (per-user per-category channel preferences with mute/snooze) |
| `has_digest_metadata` | `false` | Adds `digest_bucket`, `deliver_after` fields to notifications for batched digest delivery |
| `has_subscriptions` | `false` | Topic-based follow/unfollow subscriptions |

### Enabling in a Blueprint

```typescript
{
  modules: {
    notifications_module: {
      has_channels: true,
      has_preferences: true,
      has_digest_metadata: true,
      has_subscriptions: false,
    }
  }
}
```

## Related Skills

- **[`constructive-platform`](../constructive-platform/references/cloud-functions.md)** — Cloud functions: building the Knative function that handles a job
- **[`constructive-safegres`](../constructive-safegres/SKILL.md)** — Security policies for tables with job triggers
- **[`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md)** — AI search nodes (SearchUnified, SearchVector), RAG patterns, and agentic-kit LLM client
- **[`constructive-sdk-events`](../constructive-sdk-events/SKILL.md)** — EventTracker node (shares compound conditions), achievements, invite virality, credit rewards
- **Blueprint definition format** — [blueprints.md](../constructive-platform/references/blueprint-definition-format.md) for the full node types table

For SQL-level internals (generator functions, AST helpers, trigger function source), see the `constructive-db-compound-conditions` and `constructive-db-data-modules` skills in `constructive-io/constructive-db`.
