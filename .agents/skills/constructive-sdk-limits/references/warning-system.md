# Warning System (End-to-End)

Limit warnings provide soft-limit notifications. When a counter or aggregate crosses a configurable threshold, a background job is enqueued (e.g. to send an email). Warnings fire once per threshold per actor — dedup prevents duplicates.

## Tables

When `has_limits: true` is set on a membership type, the limits module provisions two warning tables per scope:

### `{scope}_limit_warnings` — threshold configuration

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | citext | Limit name (must match a limit_defaults entry) |
| `warning_type` | citext | Warning classification (e.g. `'soft_max'`, `'approaching'`) |
| `threshold_value` | bigint | Usage count that triggers this warning |
| `task_identifier` | text | Job task name to enqueue (e.g. `'send_limit_warning_email'`) |
| `entity_id` | uuid | *(org-scope only)* Entity this config applies to |

Unique on `(name)` for app-scope, `(name, entity_id)` for entity-scoped.

### `{scope}_limit_warning_state` — one-time dedup

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `warning_id` | uuid | FK → limit_warnings |
| `actor_id` | uuid | The user who triggered this warning |
| `entity_id` | uuid | *(entity-scoped only)* |

Unique on `(warning_id, actor_id)` (or `(warning_id, actor_id, entity_id)` for entity-scoped).

When a warning fires, a row is inserted into `limit_warning_state`. The unique constraint prevents the same warning from firing twice for the same actor.

Warning state is auto-cleared on limit window reset, so warnings can re-fire in the next period.

## Trigger Pattern

Warning nodes create AFTER INSERT triggers:

```
Row INSERT fires
  ↓
AFTER INSERT trigger runs
  ↓
Look up current usage (from limits or aggregate table)
  ↓
Query limit_warnings WHERE name = :limit_name
  AND threshold_value <= current_usage
  ↓
For each matching threshold:
  TRY INSERT into limit_warning_state (warning_id, actor_id)
    ON CONFLICT DO NOTHING   ← dedup
  ↓
  IF row was inserted (first time):
    Enqueue job via app_jobs with:
      task_identifier = warning.task_identifier
      payload = { limit_name, actor_id, entity_id, threshold_value, current_usage }
```

## Setting Up Warnings via ORM

### 1. Configure warning thresholds

```typescript
// Warn at 80% of the projects limit
await db.appLimitWarning.create({
  data: {
    name: 'projects',
    warningType: 'soft_max',
    thresholdValue: '8',
    taskIdentifier: 'send_limit_warning_email',
  },
  select: { id: true },
}).execute();

// Warn at 90% (second threshold)
await db.appLimitWarning.create({
  data: {
    name: 'projects',
    warningType: 'approaching',
    thresholdValue: '9',
    taskIdentifier: 'send_limit_warning_email',
  },
  select: { id: true },
}).execute();
```

### 2. Add warning node to blueprint

Pair a warning node with the corresponding enforcement node:

```json
{
  "nodes": [
    "DataId",
    "DataTimestamps",
    {
      "$type": "LimitCounter",
      "data": { "limit_name": "projects", "scope": "app", "actor_field": "owner_id" }
    },
    {
      "$type": "LimitWarningCounter",
      "data": { "limit_name": "projects", "scope": "app", "actor_field": "owner_id" }
    }
  ]
}
```

### 3. Handle the job in your Knative worker

The enqueued job payload shape:

```typescript
interface LimitWarningPayload {
  limit_name: string;       // e.g. "projects"
  actor_id: string;         // user who crossed the threshold
  entity_id?: string;       // entity context (if entity-scoped)
  threshold_value: number;  // the threshold that was crossed
  current_usage: number;    // actual usage at time of trigger
}
```

## Pairing Guide

| Enforcement Node | Warning Node |
|---|---|
| `LimitCounter` | `LimitWarningCounter` |
| `LimitAggregate` | `LimitWarningAggregate` |
| `LimitEnforceRate` | `LimitWarningRate` |
| `LimitFeatureFlag` | *(no warning — boolean on/off)* |
