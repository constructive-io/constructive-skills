---
name: constructive-history
description: "Row history / temporal versioning — the DataHistory blueprint node (append-only <table>_history companion recorded by AFTER triggers), optional pg_partman range partitioning with a retention window, and the graphile-history plugin that adds history, versionAt, versionsBetween, and restore<Table>Version to the GraphQL API. Use when asked to 'add row history', 'audit log', 'track changes to a table', 'version history', 'point-in-time query', 'time-travel', 'as-of query', 'restore a previous version', 'roll back a row', 'DataHistory', 'versionAt', 'versionsBetween', 'restoreVersion', 'history retention', or when working with history/versioning in blueprints or the SDK."
compatibility: "Constructive platform; graphile-history enabled via createConstructivePreset({ enableHistory: true })."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive History

Per-row version history at every layer — database trigger, GraphQL API, and SDK. Two pieces compose:

- **`DataHistory`** — a blueprint node that creates an append-only `<table>_history` companion. Every INSERT/UPDATE/DELETE on the source row appends a version row via an `AFTER` trigger (NEW-append: INSERT/UPDATE store the new row, DELETE stores a tombstone). The history table copies the source columns as plain nullable columns with **no keys or constraints**, plus a `recorded_at` timestamp and a `history_op` marker. Optionally range-partitioned by `recorded_at` (pg_partman) with a retention window so history is kept for a while — not forever.
- **`graphile-history`** — the PostGraphile v5 plugin that discovers `@history`-tagged tables and adds version reads (`history`, `versionAt`, `versionsBetween`) and a `restore<Table>Version` mutation, all enforced under the caller's RLS.

## When to Apply

Use this skill when:
- Adding an audit/version log to a table (who-changed-what-when)
- Querying a row as it looked at a past instant (point-in-time / as-of reads)
- Listing every version of a row within a time window
- Rolling a row back to a previous version (restore/revert)
- Configuring history retention / partitioning so old versions age out

## DataHistory Blueprint Node

```json
{
  "tables": [{
    "table_name": "posts",
    "nodes": [
      "DataId", "DataTimestamps",
      { "$type": "DataHistory", "data": {
        "exclude_fields": ["large_body_html"]
      }}
    ],
    "fields": [
      { "name": "title", "type": { "name": "text" }, "is_required": true },
      { "name": "body", "type": { "name": "text" } }
    ]
  }]
}
```

Creates `posts_history` — a nullable copy of every source column (minus `exclude_fields`), plus `recorded_at timestamptz` and `history_op text`. A composite index `(pk…, recorded_at)` backs per-row lookups. The source table is stamped with an `@history` smart tag; the history table is read-only in GraphQL (`@behavior -insert -update -delete`).

**Requires a primary key.** Per-row `versionAt` / `versionsBetween` / restore key on the source primary key, so a table with no PK is rejected (`DATA_HISTORY_REQUIRES_PK`). Composite primary keys are fully supported. A history table cannot itself have a history table (`DATA_HISTORY_ON_HISTORY_TABLE`).

### `data` parameters

| Param | Default | Purpose |
|-------|---------|---------|
| `table_suffix` | `"_history"` | Suffix for the companion table name |
| `recorded_at_field` | `"recorded_at"` | Version-timestamp column (also the partition key) |
| `operation_field` | `"history_op"` | `INSERT` \| `UPDATE` \| `DELETE` marker |
| `exclude_fields` | `[]` | Source columns to omit (e.g. large jsonb/vector) |
| `copy_mutation_policies` | `false` | Also clone INSERT/UPDATE/DELETE RLS (default clones SELECT only) |
| `partitioned` | `false` | Range-partition the history table by `recorded_at` (pg_partman) |
| `partition_interval` | `"1 month"` | pg_partman partition interval |
| `retention` | `"12 months"` | Drop partitions older than this via `run_maintenance` (empty = keep forever) |
| `premake` | `2` | Future partitions pg_partman pre-creates |

SELECT policies are cloned from the source table's secure provision, so history rows are visible under the same RLS as the source.

## Enabling the GraphQL Plugin

`graphile-history` is off by default. Enable it in the Constructive preset:

```ts
import { createConstructivePreset } from 'graphile-settings';

const preset = createConstructivePreset({ enableHistory: true });
```

## GraphQL Surface

Each history-enabled row type gains three read fields; a `restore<Table>Version` root mutation is added per table. `<TableVersion>` exposes the source columns plus `recordedAt` and `historyOp`.

```graphql
query {
  postByRowId(rowId: 1) {
    title
    # full version stream, newest first (recorded_at DESC)
    history { title historyOp recordedAt }
    # the version current at a given instant (latest at-or-before)
    versionAt(at: "2024-02-15T00:00:00Z") { title }
    # every version within an inclusive window, newest first
    versionsBetween(from: "2024-01-01T00:00:00Z", to: "2024-03-01T00:00:00Z") {
      title
      recordedAt
    }
  }
}

mutation {
  # rewrite the live row from a historical version; reinsert restores a deleted row.
  # The restore writes through the source table, so the trigger records it as a NEW version.
  restorePostVersion(input: { id: 1, recordedAt: "2024-02-15T00:00:00Z" }) {
    version { title }
    restored { title body }
  }
}
```

The restore `input` carries the source primary key (all columns for a composite PK), the `recordedAt` of the target version, and optional `reinsert`. All reads/writes run through the request's `withPgClient` + `pgSettings`, so RLS and mutation policies are enforced exactly as for any other operation.

## SDK / ORM

`history`, `versionAt`, and `versionsBetween` are computed fields on the row type; `restore<Table>Version` is a root mutation. Select and call them through the generated ORM like any other field/mutation:

```ts
// version stream + point-in-time read
const res = await db.post.findOne({
  where: { rowId: 1 },
  select: {
    title: true,
    history: { select: { title: true, historyOp: true, recordedAt: true } },
    versionAt: { args: { at: '2024-02-15T00:00:00Z' }, select: { title: true } }
  }
}).unwrap();

// roll a row back to a prior version
await db.query.restorePostVersion({
  input: { id: 1, recordedAt: '2024-02-15T00:00:00Z' },
  select: { restored: { select: { title: true, body: true } } }
}).unwrap();
```

Never bypass this surface with raw SQL against `posts_history` — the history table is written only by the trigger and read through RLS-enforced GraphQL.

## Cross-References

- **SQL internals** (generator, trigger, index, partitions): `constructive-db-history` in the constructive-db repo (`.agents/skills/`)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **ORM query patterns:** [`constructive-orm`](../constructive-orm/SKILL.md)
- **RLS / effective authorization:** [`constructive-security`](../constructive-security/SKILL.md)
- **Partitioned retention (billing/limits share the mechanism):** [`constructive-billing`](../constructive-billing/SKILL.md)
- **i18n + history compose** (declare `DataHistory` on the `_translations` table too): [`constructive-i18n`](../constructive-i18n/SKILL.md)
