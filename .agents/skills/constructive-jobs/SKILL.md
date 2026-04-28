---
name: constructive-jobs
description: "Background job system — DataJobTrigger blueprint node for enqueuing jobs on row changes, payload strategies, the Knative worker pipeline, scheduled jobs, and the app_jobs database extension. Use when asked to 'trigger a job', 'enqueue a background task', 'add a job trigger', 'run a function on row change', 'schedule a job', or when working with DataJobTrigger in blueprints."
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
| `condition_field` | string | — | Column for conditional WHEN clause |
| `condition_value` | string | — | Value to match in WHEN clause |
| `include_old` | boolean | `false` | Include OLD row in UPDATE payload |
| `include_meta` | boolean | `false` | Include table/schema metadata in payload |
| `job_key` | string | — | Static key for upsert semantics (deduplication) |
| `queue_name` | string | — | Route to a specific worker queue |
| `priority` | integer | `0` | Lower = higher priority |
| `run_at_delay` | string | — | PostgreSQL interval delay (e.g., `'30 seconds'`) |
| `max_attempts` | integer | `25` | Maximum retry attempts |

**Constraint:** `condition_field` and `watch_fields` cannot both be specified on the same trigger.

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
- Conditional triggers (`watch_fields`, `condition_field`)
- Delayed/debounced jobs (`run_at_delay` + `job_key`)
- Multiple triggers per table
- Email on invite, Stripe sync, audit trail, webhook dispatch

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
- `X-Database-Id` — database context

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
SELECT app_jobs.add_scheduled_job(
  'daily_report',           -- task_identifier
  '0 9 * * *',             -- cron expression (9 AM daily)
  '{"report_type": "daily"}'::json  -- payload
);
```

The scheduler component in `knative-job-service` evaluates cron expressions and enqueues jobs at the appropriate times.

## Related Skills

- **[`constructive`](../constructive/references/cloud-functions.md)** — Cloud functions: building the Knative function that handles a job
- **[`constructive-safegres`](../constructive-safegres/SKILL.md)** — Security policies for tables with job triggers
- **Blueprint definition format** — [blueprints.md](../constructive/references/blueprint-definition-format.md) for the full node types table

For SQL-level internals (generator functions, AST helpers, trigger function source), see the `constructive-job-triggers` skill in `constructive-private-skills`.
