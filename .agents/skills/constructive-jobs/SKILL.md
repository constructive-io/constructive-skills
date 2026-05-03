---
name: constructive-jobs
description: "Background job system — DataJobTrigger blueprint node for enqueuing jobs on row changes (with compound conditions support: AND/OR/NOT combinators, column-aware type resolution), DataImageEmbedding composition wrapper, payload strategies, the Knative worker pipeline, scheduled jobs, and the app_jobs database extension. Use when asked to 'trigger a job', 'enqueue a background task', 'add a job trigger', 'run a function on row change', 'schedule a job', 'compound conditions', 'image embedding trigger', or when working with DataJobTrigger/DataImageEmbedding in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Jobs

Background job infrastructure for the Constructive platform. Declaratively attach triggers to tables that enqueue jobs when rows change, processed by the Knative worker stack.

## When to Apply

- Adding a background job that fires on row INSERT/UPDATE/DELETE
- Wiring a table to a Knative cloud function (e.g., send email on invite creation)
- Syncing data to external systems on change (e.g., Stripe sync on invoice update)
- Generating embeddings, sending notifications, auditing changes
- Scheduling recurring jobs (cron-style)

## Architecture

```
Table row change (INSERT/UPDATE/DELETE)
  --> PostgreSQL AFTER trigger (created by DataJobTrigger node)
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

The `DataJobTrigger` blueprint node automatically creates the PostgreSQL triggers that call `app_jobs.add_job()`.

## DataJobTrigger Blueprint Node

Add to a table's `nodes[]` in a blueprint definition to auto-create triggers:

```typescript
{
  ref: 'invoices',
  table_name: 'invoices',
  nodes: [
    ...ORG_NODES,
    {
      $type: 'DataJobTrigger',
      data: {
        task_identifier: 'process_invoice',
      }
    },
  ],
  fields: [
    { name: 'amount', type: 'numeric', is_required: true },
    { name: 'status', type: 'text', default_value: "'draft'" },
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

**Constraints:** `conditions`, `condition_field`, and `watch_fields` are mutually exclusive — only one can be specified per trigger.

### Compound Conditions

The `conditions` parameter accepts a structured JSON syntax for complex WHEN clauses. Column types are resolved automatically from the PostgreSQL schema — values in JSON are cast to the correct type at generation time.

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

## DataImageEmbedding Blueprint Node

Composition wrapper that combines SearchVector + DataJobTrigger with image-specific defaults. Creates a vector embedding field with HNSW index and a job trigger that fires when image files transition to ready status.

```typescript
{
  ref: 'files',
  table_name: 'files',
  nodes: [
    ...STORAGE_NODES,
    { $type: 'DataImageEmbedding' },
  ],
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `field_name` | string | `'embedding'` | Vector column name |
| `dimensions` | integer | `512` | Vector dimensions |
| `index_method` | `'hnsw'` \| `'ivfflat'` | `'hnsw'` | Index type |
| `metric` | `'cosine'` \| `'l2'` \| `'ip'` | `'cosine'` | Distance metric |
| `task_identifier` | string | `'process_image_embedding'` | Job task name |
| `status_field` | string | `'status'` | Upload lifecycle status column |
| `status_ready_value` | string | `'ready'` | Value indicating file is ready |
| `status_pending_value` | string | `'pending'` | Value indicating file is pending |
| `mime_patterns` | string[] | `['image/%']` | MIME type LIKE patterns (OR'd together) |
| `payload_custom` | object | `{file_id: 'id', key: 'key', ...}` | Custom job payload mapping |

The generated WHEN clause:
```sql
NEW.status = 'ready' AND OLD.status = 'pending' AND NEW.mime_type LIKE 'image/%'
```

## Knative Worker Stack

The runtime consists of three packages:

| Package | Role |
|---------|------|
| `@constructive-io/knative-job-service` | Orchestrator — starts worker + callback server + scheduler |
| `@constructive-io/knative-job-worker` | Polls `app_jobs.jobs`, POSTs to function URL |
| `@constructive-io/knative-job-fn` | Express app factory for function handlers |

### Job Flow

1. **Trigger fires** → inserts row into `app_jobs.jobs`
2. **Worker polls** → picks up job by `task_identifier`
3. **Worker POSTs** → `${KNATIVE_SERVICE_URL}/${task_identifier}` with JSON payload
4. **Function executes** → returns success/failure
5. **Worker updates** → marks job as complete or failed (retries up to `max_attempts`)

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

For recurring jobs, use `app_jobs.add_scheduled_job()` or the `runtime_schedules` table (in agentic-db):

```sql
-- database_id and actor_id are read from JWT claims automatically
SELECT app_jobs.add_scheduled_job(
  identifier := 'daily_report',
  payload := '{"report_type": "daily"}'::json,
  schedule_info := json_build_object(
    'rule', '0 9 * * *'  -- 9 AM daily
  )
);
```

The scheduler component in `knative-job-service` evaluates cron expressions and enqueues jobs at the appropriate times.

## Related Skills

- **[`constructive-platform`](../constructive-platform/references/cloud-functions.md)** — Cloud functions: building the Knative function that handles a job
- **[`constructive-safegres`](../constructive-safegres/SKILL.md)** — Security policies for tables with job triggers
- **Blueprint definition format** — [blueprints.md](../constructive-platform/references/blueprint-definition-format.md) for the full node types table

For SQL-level internals (generator functions, AST helpers, trigger function source), see the `constructive-db-compound-conditions` and `constructive-db-data-modules` skills in `constructive-io/constructive-db`.
