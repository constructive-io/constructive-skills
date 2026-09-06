# `db.trigger` — attaching a customer trigger function to a table

`db.trigger` holds two kinds of row. `kind: 'reservation'` rows are written by blueprint generators for the triggers they emit themselves (name-holders; no definition). `kind: 'attachment'` rows are the customer surface: the row **is** the definition, and provisioning re-derives the physical `CREATE TRIGGER` from it on every write through a fixed envelope.

## Fields (`TriggerPatch`)

| Field | Type | Attachment | Notes |
|---|---|---|---|
| `databaseId` | uuid | required | Must equal the function's `databaseId` |
| `tableId` | uuid | required | Table the trigger fires on |
| `name` | string | required | Trigger name, unique per table |
| `kind` | `'reservation'` \| `'attachment'` | `'attachment'` | Default is `reservation` — set it explicitly |
| `functionId` | uuid | required | A `db.function` row with `kind: 'trigger'` |
| `timing` | string | `'AFTER'` | Only `AFTER` is accepted; normalized to upper-case |
| `events` | string[] | required | Non-empty subset of `INSERT`, `UPDATE`, `DELETE`; upper-cased, de-duplicated and sorted on write |
| `forEachRow` | boolean | `true` | Statement-level triggers are not expressible |
| `whenAst` | JSON | optional | `WHEN (…)` condition — see below |
| `event`, `functionName` | string | must be null | Legacy single-event / name columns used by reservations; a CHECK rejects them on attachments |
| `category`, `tags`, `smartTags` | | optional | As on other metaschema objects |

Selectable relations: `database`, `function`, `table`.

## Create / update / delete

```ts
const { createTrigger } = await db.trigger
  .create({
    data: {
      databaseId,
      tableId: ordersTableId,
      name: 'orders_stamp_tg',
      kind: 'attachment',
      functionId: stampFunctionId,
      timing: 'AFTER',
      events: ['insert', 'update', 'update'],   // stored as ['INSERT', 'UPDATE']
      forEachRow: true,
    },
    select: { id: true, events: true, timing: true },
  })
  .unwrap();

await db.trigger
  .update({
    where: { id: createTrigger.trigger.id },
    data: { events: ['INSERT'], whenAst: { field: 'total', op: '>', value: '10' } },
    select: { id: true, events: true, whenAst: true },
  })
  .unwrap();

await db.trigger.delete({ where: { id: createTrigger.trigger.id }, select: { id: true } }).unwrap();
```

Changing `name`, `tableId`, `functionId`, `timing`, `events`, `forEachRow` or `whenAst` drops and re-emits the physical trigger; deleting the row drops it. Delete attachments before deleting the function they reference.

## `whenAst`

Three accepted input shapes; the stored value is always the normalized bare expression AST with physical schema names, so a row round-trips through seed export unchanged.

1. **Condition DSL** — the same leaf/combinator language `JobTrigger` uses for `trigger_conditions` (see `constructive-jobs`), compiled against the table's fields with `NEW` as the default row:

   ```ts
   whenAst: { field: 'total', op: '>', value: '10' }
   whenAst: { AND: [{ field: 'status', op: '=', value: 'paid' }, { field: 'total', op: '>', value: '10' }] }
   ```

   A leaf naming a field the table does not have is rejected at write time.

2. **`{ expression: <ast> }`** — explicit raw-AST escape. Stored as the bare `<ast>`.

3. **Bare expression node** — what shape 2 stores; accepted so exported rows re-import.

A raw AST is a PostgreSQL expression node (e.g. `A_Expr` with `ColumnRef` fields `[{ String: { sval: 'new' } }, { String: { sval: 'total' } }]`) and is run through the same column-level AST validator as CHECK constraints. Anything that is not an object/array in one of these shapes raises `TRIGGER_WHEN_AST_INVALID`; a non-expression node is rejected by the validator.

Row availability is checked against `events`: a condition reading `NEW` on a `DELETE` trigger, or `OLD` on an `INSERT` trigger, raises `TRIGGER_WHEN_AST_ROW_UNAVAILABLE` naming the row and event instead of failing later at emission.

## Error codes

| Code | Cause | Fix |
|---|---|---|
| `TRIGGER_ATTACHMENT_FUNCTION_NOT_FOUND` | `functionId` does not resolve | Create the function first; check the id |
| `TRIGGER_ATTACHMENT_FUNCTION_NOT_A_TRIGGER` | Function `kind` is not `'trigger'` | Author the function with `kind: 'trigger'`, `arguments: []`, `returns: { type: { name: 'trigger' } }` |
| `TRIGGER_ATTACHMENT_FUNCTION_CROSS_DATABASE` | Function belongs to another `databaseId` | Use a function from the same database |
| `TRIGGER_WHEN_AST_INVALID` | `whenAst` is not an accepted shape | Use the DSL, `{ expression }`, or a bare expression node |
| `TRIGGER_WHEN_AST_ROW_UNAVAILABLE` | Condition reads `NEW` on DELETE or `OLD` on INSERT | Change `events` or the condition |
| `TRIGGER_NOT_EMITTED` | Emitted trigger does not match the envelope (not AFTER / not ROW / different function / extra args) | Should not happen from a valid row — report it |
| `OBJECT_NOT_FOUND` (`entity: 'table'`) | `tableId` does not resolve | Check the id belongs to `databaseId` |
| CHECK `trigger_customer_attachment_shape` / `trigger_kind_matches_attachment` / `trigger_reservation_has_no_definition` / `trigger_attachment_has_no_legacy_definition` | Attachment missing `timing`/`events`/`forEachRow`/`functionId`, `timing` ≠ `AFTER`, `event`/`functionName` set on an attachment, or a reservation carrying a definition | Fix the row shape |

Inside the trigger function, `NEW`/`OLD` and `TG_*` behave as in PostgreSQL; the body runs as the row's writer under RLS. To do asynchronous work from a row change, prefer `JobTrigger` (`constructive-jobs`) over calling out from a trigger body.
