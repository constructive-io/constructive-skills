# Constraints

Constraints are declared through the SDK ORM against the metaschema; each `create` compiles to a PostgreSQL `ALTER TABLE ... ADD CONSTRAINT ...`.

| Constraint | ORM entity |
|------------|-----------|
| Primary key | `db.primaryKeyConstraint.create` |
| Unique | `db.uniqueConstraint.create` |
| Foreign key | `db.foreignKeyConstraint.create` |
| Check | `db.checkConstraint.create` |
| Exclusion | `db.exclusionConstraint.create` |

For composite keys, `fieldIds` is an ordered array — the column order in the generated constraint matches the array order.

## Primary key

```typescript
await db.primaryKeyConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [idFieldId],
  },
  select: { id: true },
}).execute();
```

## Unique

```typescript
await db.uniqueConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [emailFieldId],
  },
  select: { id: true },
}).execute();
```

## Check

`db.checkConstraint.create` takes `expr` as the same **triggerCondition DSL** used by
partial-index/exclusion `whereClause` (leaf `{ field, op, value }`, field-to-field
`{ field, op, ref }`, or an `{ AND | OR | NOT }` combinator — see
[indexes.md](./indexes.md)). The predicate compiles to a validated AST server-side
with bare column references — no SQL text is written:

```typescript
// CHECK (reputation >= 0)
await db.checkConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [reputationFieldId],
    expr: { field: 'reputation', op: '>=', value: 0 },
  },
  select: { id: true },
}).execute();
```

> **Explicit raw-AST escape.** For a predicate the condition DSL can't represent,
> wrap a raw (server-sanitized) pgsql-parser AST node as
> `expr: { expression: <ast> }`. A bare AST object is **rejected** — the
> `expression` key is the only raw-AST entry point. Either form is validated
> against the database's allowed schemas and forbidden functions/tables before
> the constraint is built.

## Foreign key

```typescript
await db.foreignKeyConstraint.create({
  data: {
    databaseId,
    tableId,                       // referencing (child) table
    fieldIds: [authorIdFieldId],   // local columns
    refTableId: usersTableId,      // referenced (parent) table
    refFieldIds: [userIdFieldId],  // referenced columns
    deleteAction: 'a',             // a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
    updateAction: 'a',
  },
  select: { id: true },
}).execute();
```

## FK column-list referential actions (PostgreSQL 18)

PostgreSQL 18 lets `ON DELETE SET NULL` / `ON DELETE SET DEFAULT` name a **subset** of the FK columns to null-out / reset, instead of the whole column list. The SDK exposes this via the optional `deleteSetFieldIds` array on `db.foreignKeyConstraint.create`:

```typescript
// FOREIGN KEY (a, b) REFERENCES u (x, y) ON DELETE SET NULL (b)
await db.foreignKeyConstraint.create({
  data: {
    databaseId,
    tableId,                              // referencing (child) table
    fieldIds: [aFieldId, bFieldId],       // local columns
    refTableId: uTableId,                 // referenced (parent) table
    refFieldIds: [xFieldId, yFieldId],    // referenced columns
    deleteAction: 'n',                    // n=SET NULL (or d=SET DEFAULT)
    deleteSetFieldIds: [bFieldId],        // subset of fieldIds to null/reset
  },
  select: { id: true },
}).execute();
// → FOREIGN KEY (a, b) REFERENCES u (x, y) ON DELETE SET NULL (b)
```

For `SET DEFAULT`, use `deleteAction: 'd'` (renders `ON DELETE SET DEFAULT (b)`).

**Rules**
- `deleteSetFieldIds` defaults to `null`, which means the whole FK column list (plain `ON DELETE SET NULL` / `SET DEFAULT`, no column list) — existing constraints are unchanged.
- It is only valid when `deleteAction` is `'n'` (SET NULL) or `'d'` (SET DEFAULT); combining it with any other delete action is rejected.
- Every id must be a member of `fieldIds` (a subset); it does not need to preserve `fieldIds` order.
- Columns listed in `deleteSetFieldIds` must be nullable for `SET NULL`, and should have a column default for `SET DEFAULT`.
- This applies to `ON DELETE` only — PostgreSQL does not permit a column list on `ON UPDATE` referential actions, so there is no update-side equivalent.

## Application-time temporal constraints (PostgreSQL 18)

PostgreSQL 18 adds application-time temporal tables. A temporal key pairs an ordinary scalar key with a **period column** (a range type such as `tstzrange`) so that the scalar part must be unique *only for non-overlapping periods*. Three optional flags expose this through the SDK:

| Flag | ORM entity | Generates |
|------|-----------|-----------|
| `withoutOverlaps: true` | `db.primaryKeyConstraint.create` | `PRIMARY KEY (..., period WITHOUT OVERLAPS)` |
| `withoutOverlaps: true` | `db.uniqueConstraint.create` | `UNIQUE (..., period WITHOUT OVERLAPS)` |
| `withPeriod: true` | `db.foreignKeyConstraint.create` | `FOREIGN KEY (..., PERIOD period) REFERENCES parent (..., PERIOD period)` |

All three default to `false`, so existing constraints are unchanged.

**Rules**
- The **period column** is modeled as an ordinary range-type field (e.g. `type: { name: 'tstzrange' }`) — there is no separate period entity.
- The period column must be the **last** entry in `fieldIds` (and, for a temporal FK, last in both `fieldIds` and `refFieldIds`). `withoutOverlaps` / `withPeriod` mark that trailing field.
- Temporal PK/UNIQUE build a GiST-backed exclusion index, which requires the `btree_gist` extension for the scalar equality part of the key.
- A temporal FK must reference a temporal key (a PK or UNIQUE declared `withoutOverlaps`) on the parent table.

### Temporal primary key (`WITHOUT OVERLAPS`)

```typescript
// room_id + a validity period; a room can only be booked once per overlapping period.
const roomIdField = await db.field.create({
  data: { databaseId, tableId, name: 'room_id', type: { name: 'uuid' }, isRequired: true },
  select: { id: true },
}).execute();

const periodField = await db.field.create({
  data: { databaseId, tableId, name: 'valid_period', type: { name: 'tstzrange' }, isRequired: true },
  select: { id: true },
}).execute();

await db.primaryKeyConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [roomIdField.id, periodField.id], // period column LAST
    withoutOverlaps: true,
  },
  select: { id: true },
}).execute();
// → PRIMARY KEY (room_id, valid_period WITHOUT OVERLAPS)
```

### Temporal unique constraint (`WITHOUT OVERLAPS`)

```typescript
await db.uniqueConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [roomIdField.id, periodField.id], // period column LAST
    withoutOverlaps: true,
  },
  select: { id: true },
}).execute();
// → UNIQUE (room_id, valid_period WITHOUT OVERLAPS)
```

### Temporal foreign key (`WITH PERIOD`)

```typescript
// Parent (room) has a temporal primary key: PRIMARY KEY (id, valid_period WITHOUT OVERLAPS)
await db.foreignKeyConstraint.create({
  data: {
    databaseId,
    tableId: bookingTableId,                          // child
    fieldIds: [bookingRoomIdField.id, bookingPeriodField.id], // period LAST
    refTableId: roomTableId,                          // parent
    refFieldIds: [roomIdField.id, roomPeriodField.id],        // period LAST
    withPeriod: true,
  },
  select: { id: true },
}).execute();
// → FOREIGN KEY (room_id, PERIOD valid_period)
//     REFERENCES room (id, PERIOD valid_period)
```

`withPeriod` marks the trailing local and referenced columns as `PERIOD` on both sides of the FK.

> A temporal `WITHOUT OVERLAPS` key is really a specialized exclusion constraint the
> platform builds for you. For the general form — arbitrary columns compared with
> arbitrary operators — use `db.exclusionConstraint.create` (below).

## Exclusion constraints (`EXCLUDE USING ...`)

An exclusion constraint guarantees that for any two rows, the listed operators do
**not** all evaluate true simultaneously — the generalization of `UNIQUE` to
non-equality operators. The classic use is "no two bookings for the same room
overlap in time": `room_id` compared with `=` and a `tstzrange` period compared with
`&&` (overlaps). It is declared through `db.exclusionConstraint.create`; each `create`
compiles to `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE USING ...`.

| Field | Type | Generates |
|-------|------|-----------|
| `fieldIds` | `uuid[]` | Constrained columns, in array order |
| `operators` | `string[]` | Per-column operator, positionally aligned with `fieldIds` (`=`, `&&`, ...) |
| `accessMethod` | `string` | `USING <method>` — defaults to `gist` |
| `whereClause` | `json` | `WHERE <predicate>` — **partial** exclusion (triggerCondition DSL) |
| `elementExpr` | `json` | Expression elements — array of `{ expr, operator }` (`expr` = FieldGeneration DSL; raw AST only via `{ expression: <ast> }`) |
| `name` | `string` | Constraint name (auto-generated when omitted) |

`fieldIds` and `operators` must have equal length — entry *i* becomes
`field_i WITH operator_i`, in array order.

### No-overlap exclusion

```typescript
// room_id + a tstzrange period; a room can't be double-booked for overlapping periods.
const roomIdField = await db.field.create({
  data: { databaseId, tableId, name: 'room_id', type: { name: 'uuid' }, isRequired: true },
  select: { id: true },
}).execute();

const duringField = await db.field.create({
  data: { databaseId, tableId, name: 'during', type: { name: 'tstzrange' }, isRequired: true },
  select: { id: true },
}).execute();

await db.exclusionConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [roomIdField.id, duringField.id],
    operators: ['=', '&&'],       // room_id WITH =, during WITH &&
    accessMethod: 'gist',
  },
  select: { id: true },
}).execute();
// → EXCLUDE USING gist (room_id WITH =, during WITH &&)
```

### Partial exclusion (`whereClause`)

`whereClause` accepts the same **triggerCondition DSL** as partial indexes and check
predicates (leaf `{ field, op, value }`, field-to-field `{ field, op, ref }`, or an
`{ AND | OR | NOT }` combinator — see [indexes.md](./indexes.md)), so the exclusion
applies only to matching rows and no SQL text is written:

```typescript
// EXCLUDE USING gist (room_id WITH =, during WITH &&) WHERE (status = 'active')
await db.exclusionConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [roomIdField.id, duringField.id],
    operators: ['=', '&&'],
    whereClause: { field: 'status', op: '=', value: 'active' },
  },
  select: { id: true },
}).execute();
```

The predicate compiles to a validated AST server-side (bare, unqualified column
references), the same path used by partial indexes and check-constraint expressions.

### Expression elements (`elementExpr`)

To exclude on a computed expression such as `lower(label) WITH =` rather than a bare
column, supply `elementExpr` as an array of `{ expr, operator }` entries. Each `expr`
accepts the same **FieldGeneration DSL** as `field.generationExpression` and
`field.defaultValue` (`{ function, args }`, `{ column }`, `{ operator, left, right }`,
`{ cast }`, ... — see [field-types.md](./field-types.md)), so no hand-shaped AST is
needed. The expression is validated server-side (`'column'` level — enforcing the
database's own allowed schemas and forbidden functions/tables) before the constraint
is built; expression elements are appended after the `fieldIds` column elements.

```typescript
// EXCLUDE USING gist (room_id WITH =, lower(label) WITH =)
await db.exclusionConstraint.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [roomIdField.id],
    operators: ['='],
    elementExpr: [
      { expr: { function: 'lower', args: [{ column: 'label' }] }, operator: '=' },
    ],
  },
  select: { id: true },
}).execute();
```

> **Explicit raw-AST escape.** For an expression the DSL can't represent, wrap a raw
> (server-sanitized) pgsql-parser AST node as `{ expr: { expression: <ast> }, operator }`.
> A bare AST object with no DSL keys is **rejected** — the `expression` key is the only
> raw-AST entry point. Prefer the DSL; reach for the escape only when necessary rather
> than dropping to raw SQL.

**Rules**
- The target column types and operators must be supported by the access method. `gist`
  with a scalar equality part (`room_id WITH =`) needs the `btree_gist` extension; the
  range `&&` part is served by the built-in GiST range operator class.
- `fieldIds` / `operators` cardinality must match; each `elementExpr` entry requires
  both `expr` and `operator`.
- `accessMethod` defaults to `gist` — the method that supports non-equality exclusion
  operators such as `&&`.
- Exclusion constraints are **create-or-delete**: there is no in-place update (the SDK
  rejects an update with `DELETE_FIRST`). To change one, delete the row with
  `db.exclusionConstraint.delete(...)` (which drops the physical constraint) and
  create a new one.

## Deferrable constraints (`DEFERRABLE` / `INITIALLY DEFERRED`)

A deferrable constraint can have its check postponed until the end of the transaction (`COMMIT`) instead of being enforced immediately after each statement — useful for cyclic foreign keys, swapping unique values, or bulk loads where intermediate states temporarily violate the constraint. Two optional flags expose this through the SDK:

| Flag | ORM entity | Generates |
|------|-----------|-----------|
| `isDeferrable: true` | `db.primaryKeyConstraint.create` | `PRIMARY KEY (...) DEFERRABLE` |
| `isDeferrable: true` | `db.uniqueConstraint.create` | `UNIQUE (...) DEFERRABLE` |
| `isDeferrable: true` | `db.foreignKeyConstraint.create` | `FOREIGN KEY (...) REFERENCES ... DEFERRABLE` |
| `initiallyDeferred: true` | (same three entities) | adds `INITIALLY DEFERRED` |

Both default to `false`, so existing constraints are unchanged (`NOT DEFERRABLE INITIALLY IMMEDIATE`, the PostgreSQL default).

**Rules**
- `isDeferrable: true` marks the constraint deferrable but still checked at the end of each statement by default (`INITIALLY IMMEDIATE`). It can be deferred at runtime with `SET CONSTRAINTS ... DEFERRED`.
- `initiallyDeferred: true` additionally defers the check to transaction commit by default. `INITIALLY DEFERRED` implies `DEFERRABLE`, so set `isDeferrable: true` alongside it to keep the intent explicit.
- These flags apply to **primary key, unique, and foreign key** constraints. PostgreSQL does **not** allow `CHECK` constraints to be deferrable — passing `isDeferrable` / `initiallyDeferred` to `db.checkConstraint.create` is not supported and PostgreSQL rejects it (`CHECK constraints cannot be marked DEFERRABLE`).

### Deferrable foreign key

```typescript
// FOREIGN KEY (author_id) REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED
await db.foreignKeyConstraint.create({
  data: {
    databaseId,
    tableId,                        // referencing (child) table
    fieldIds: [authorIdFieldId],    // local columns
    refTableId: usersTableId,       // referenced (parent) table
    refFieldIds: [userIdFieldId],   // referenced columns
    isDeferrable: true,
    initiallyDeferred: true,
  },
  select: { id: true },
}).execute();
// → FOREIGN KEY (author_id) REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED
```

### Deferrable primary key / unique constraint

```typescript
// PRIMARY KEY (id) DEFERRABLE INITIALLY DEFERRED
await db.primaryKeyConstraint.create({
  data: { databaseId, tableId, fieldIds: [idFieldId], isDeferrable: true, initiallyDeferred: true },
  select: { id: true },
}).execute();

// UNIQUE (email) DEFERRABLE  (deferrable but checked per-statement unless SET CONSTRAINTS ... DEFERRED)
await db.uniqueConstraint.create({
  data: { databaseId, tableId, fieldIds: [emailFieldId], isDeferrable: true },
  select: { id: true },
}).execute();
// → UNIQUE (email) DEFERRABLE
```

### Deferring at runtime

`isDeferrable` / `initiallyDeferred` are schema-authoring flags — they only decide *whether* and *how* a constraint may be deferred. Choosing to defer a merely-`DEFERRABLE` constraint inside a specific transaction is done with the standard `SET CONSTRAINTS ... DEFERRED` transaction command, which belongs to your app's query/transaction layer, not the schema-authoring SDK documented here. A constraint created with `initiallyDeferred: true` is deferred by default and needs no such command.

> Not yet exposed: `FOR PORTION OF` temporal UPDATE/DELETE has no SDK surface. Treat it as an SDK gap rather than dropping to raw SQL. (FK column-list referential actions are `ON DELETE`-only, matching PostgreSQL; there is intentionally no update-side variant.)
