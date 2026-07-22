# Constraints

Constraints are declared through the SDK ORM against the metaschema; each `create` compiles to a PostgreSQL `ALTER TABLE ... ADD CONSTRAINT ...`.

| Constraint | ORM entity |
|------------|-----------|
| Primary key | `db.primaryKeyConstraint.create` |
| Unique | `db.uniqueConstraint.create` |
| Foreign key | `db.foreignKeyConstraint.create` |
| Check | `db.checkConstraint.create` |

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

> Not yet exposed: `EXCLUDE (... WITH ...)` constraints and `FOR PORTION OF` temporal UPDATE/DELETE have no SDK surface. Treat these as SDK gaps rather than dropping to raw SQL. (FK column-list referential actions are `ON DELETE`-only, matching PostgreSQL; there is intentionally no update-side variant.)
