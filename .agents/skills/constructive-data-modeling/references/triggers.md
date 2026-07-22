# Triggers

Custom database triggers are declared through the SDK ORM against the metaschema
`trigger` catalog. A trigger row references a **trigger function** (created via
`db.triggerFunction.create`) and a target table; on insert it compiles to a
PostgreSQL `CREATE TRIGGER ...` that runs the function.

| Entity | ORM entity | Generates |
|--------|-----------|-----------|
| Trigger function | `db.triggerFunction.create` | `CREATE FUNCTION <app_private>.<name>() RETURNS TRIGGER ...` |
| Trigger | `db.trigger.create` | `CREATE TRIGGER <name> <timing> <events> ON <table> ...` |

## Two-step flow

A declarative trigger is provisioned only when its `functionName` resolves to an
existing trigger function. So always create the function first, then the trigger:

```typescript
// 1. Trigger function — lives in the database's private (app_private) schema.
await db.triggerFunction.create({
  data: {
    databaseId,
    name: 'audit_fn',
    code: 'BEGIN INSERT INTO app_private.audit_log(t, at) VALUES (TG_OP, now()); RETURN NULL; END',
  },
  select: { id: true, name: true },
}).execute();

// 2. Declarative trigger referencing that function by name.
await db.trigger.create({
  data: {
    databaseId,
    tableId,                       // target table (metaschema table id)
    name: 'audit',
    functionName: 'audit_fn',      // resolved in the private schema
    timing: 'after',               // before | after | instead_of
    events: ['update'],            // any of insert | update | delete | truncate
    forEach: 'statement',          // row | statement
    transitionOldName: 'o',        // REFERENCING OLD TABLE AS o
    transitionNewName: 'n',        // REFERENCING NEW TABLE AS n
  },
  select: { id: true },
}).execute();
```

This generates:

```sql
CREATE TRIGGER audit AFTER UPDATE ON t
  REFERENCING OLD TABLE AS o NEW TABLE AS n
  FOR EACH STATEMENT EXECUTE FUNCTION audit_fn();
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tableId` | UUID | — | Target table (required) |
| `name` | string | — | Trigger name (required) |
| `functionName` | string | — | Trigger function name, resolved in the database's private schema. **Omit to register a catalog row without provisioning a physical trigger** |
| `timing` | string | `after` | `before`, `after`, or `instead_of` |
| `events` | string[] | — | One or more of `insert`, `update`, `delete`, `truncate` |
| `forEach` | string | `row` | `row` (FOR EACH ROW) or `statement` (FOR EACH STATEMENT) |
| `transitionOldName` | string | — | `REFERENCING OLD TABLE AS <name>` — the OLD transition relation |
| `transitionNewName` | string | — | `REFERENCING NEW TABLE AS <name>` — the NEW transition relation |
| `whenClause` | JSON | — | Optional `WHEN (...)` predicate, expressed with the condition DSL (below) |

All of `timing` / `forEach` / `events` / `transition*` / `whenClause` are optional
and nullable. A row created with only `tableId` + `name` (no `functionName`) is a
registration-only entry — it is **not** compiled into a physical trigger, so
existing catalog rows and generators are unaffected.

## Transition tables (statement-level, PostgreSQL)

`transitionOldName` / `transitionNewName` expose `REFERENCING OLD/NEW TABLE AS`,
which give the trigger function set-oriented `OLD TABLE` / `NEW TABLE` relations
covering every row touched by the statement. They pair naturally with
`forEach: 'statement'` for efficient audit / sync triggers that process the whole
change set once per statement instead of once per row.

```typescript
await db.trigger.create({
  data: {
    databaseId, tableId,
    name: 'audit',
    functionName: 'audit_fn',
    timing: 'after',
    events: ['update'],
    forEach: 'statement',
    transitionNewName: 'n',   // only NEW TABLE — OLD TABLE omitted
  },
  select: { id: true },
}).execute();
// → CREATE TRIGGER audit AFTER UPDATE ON t
//     REFERENCING NEW TABLE AS n
//     FOR EACH STATEMENT EXECUTE FUNCTION audit_fn();
```

Either transition name may be given independently; provide both for
`OLD TABLE AS ... NEW TABLE AS ...`.

## `whenClause` (conditional firing)

`whenClause` accepts the same structured condition DSL used by `JobTrigger`
`conditions` and `EventTracker` — it is compiled to the trigger's `WHEN (...)`
clause and validated against the table's columns at provisioning time. No raw SQL.

**Leaf condition:**
```typescript
{ field: 'status', op: 'IS DISTINCT FROM', row: 'OLD' }
```

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `field` | yes | — | Column name (validated against the table) |
| `op` | yes | — | `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `NOT LIKE`, `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM` |
| `value` | conditional | — | Comparison value (omit for `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM`) |
| `row` | no | `NEW` | Row reference: `NEW` or `OLD` |
| `ref` | no | — | Field-to-field comparison: `{ field, row }` |

Arrays are an implicit AND; `{ AND: [...] }`, `{ OR: [...] }`, and `{ NOT: {...} }`
combinators nest arbitrarily.

```typescript
await db.trigger.create({
  data: {
    databaseId, tableId,
    name: 'audit_status_change',
    functionName: 'audit_fn',
    timing: 'after',
    events: ['update'],
    forEach: 'row',
    whenClause: { field: 'status', op: 'IS DISTINCT FROM', row: 'OLD' },
  },
  select: { id: true },
}).execute();
// → CREATE TRIGGER ... FOR EACH ROW
//     WHEN (NEW.status IS DISTINCT FROM OLD.status)
//     EXECUTE FUNCTION audit_fn();
```

> `IS DISTINCT FROM` always compares the `NEW` and `OLD` value of `field`
> regardless of the `row` given, matching PostgreSQL's change-detection idiom.

See the shared condition grammar in
[`constructive-jobs`](../../constructive-jobs/SKILL.md) and
[`constructive-events`](../../constructive-events/SKILL.md).

## Notes & gaps

- Trigger functions are created in the database's **private** (`app_private`)
  schema; `functionName` is resolved there.
- For the common declarative behaviors (timestamps, slugs, soft-delete, job
  enqueue on row change, event tracking) prefer the corresponding Node Type
  generators rather than authoring a raw trigger — see
  [`constructive-jobs`](../../constructive-jobs/SKILL.md) (`JobTrigger`) and
  [`constructive-events`](../../constructive-events/SKILL.md) (`EventTracker`).
  Use `db.trigger.create` for custom logic those generators don't cover.
- Constraint triggers (`CREATE CONSTRAINT TRIGGER`, `DEFERRABLE`) and per-trigger
  `WHEN` referencing other tables have no SDK surface yet — treat these as SDK
  gaps rather than dropping to raw SQL.
