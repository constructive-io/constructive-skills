# Views

Views are declared through the SDK ORM against the metaschema via `db.view.create`;
each row compiles to a PostgreSQL `CREATE VIEW`. The view body is chosen by
`viewType` (a `View*` node type — see
[`constructive-blueprints`](../../constructive-blueprints/references/node-type-registry.md)
for the catalog: `ViewTableProjection`, `ViewJoinedTables`, `ViewAggregated`,
`ViewFilteredTable`, `ViewComposite`).

The view body lives in the `data` object and is **referenced by ID, never by raw
schema/table name**. Depending on `viewType`, `data` carries `source_table_id` /
`primary_table_id` / per-join `table_id` (all catalog table UUIDs) and optional
`field_ids`. The server resolves each ID to the physical schema/table name for you
and validates it (see [Referential integrity & ownership](#referential-integrity--ownership)),
so you never hand-write a schema name into a view.

```typescript
await db.view.create({
  data: {
    databaseId,
    schemaId,
    name: 'active_projects',
    viewType: 'ViewTableProjection',
    tableId: projectsTableId,
    // ID-based body: names are resolved from the catalog server-side.
    // field_ids is optional — omit it to SELECT * from the source table.
    data: { source_table_id: projectsTableId },
    isReadOnly: true,
  },
  select: { id: true },
}).execute();
```

## View options

Three editable options control the view's PostgreSQL storage attributes and
update semantics. All are optional and default to the values below, so existing
views are unchanged.

| Option | Type | Default | Generates |
|--------|------|---------|-----------|
| `securityInvoker` | Boolean | `true` | `WITH (security_invoker = true)` — RLS/permission checks run as the querying user (PG15+) |
| `securityBarrier` | Boolean | `false` | `WITH (security_barrier = true)` — prevents leaky operators/functions from seeing rows the view filters out |
| `checkOption` | String | `null` | `WITH [LOCAL\|CASCADED] CHECK OPTION` — rejects inserts/updates through the view that would produce rows the view can't see |

`checkOption` accepts only `null`, `'local'`, or `'cascaded'`; any other value is
rejected. `'local'` checks the current view's predicate only; `'cascaded'` also
checks the predicates of every underlying view.

When both flags and a check option are set, they combine into a single
statement:

```typescript
await db.view.create({
  data: {
    databaseId,
    schemaId,
    name: 'owners_view',
    viewType: 'ViewTableProjection',
    tableId: ownersTableId,
    data: { source_table_id: ownersTableId },
    securityInvoker: true,
    securityBarrier: true,
    checkOption: 'cascaded',
    isReadOnly: false,
  },
  select: { id: true },
}).execute();
// → CREATE VIEW app_public.owners_view
//     WITH (security_invoker = true, security_barrier = true) AS
//     SELECT ... WITH CASCADED CHECK OPTION
```

`securityInvoker` / `securityBarrier` become `pg_class.reloptions`
(`security_invoker=true`, `security_barrier=true`); `checkOption` maps to
`reloptions` `check_option=local` / `check_option=cascaded`.

## Updating options

The options are editable on an existing view:

```typescript
await db.view.update({
  where: { id: viewId },
  data: { securityBarrier: true, checkOption: 'local' },
  select: { id: true },
}).execute();
```

Set `checkOption: null` to drop the check option again.

> Only `null | 'local' | 'cascaded'` are valid for `checkOption`. A check option
> is meaningful only on updatable views (`isReadOnly: false`).

## Referential integrity & ownership

View bodies reference their source objects by **catalog ID** (`source_table_id`,
`primary_table_id`, per-join `table_id`, `field_ids`) — never by a raw
schema/table name you supply. This is what keeps views safe and tenant-scoped:

- **Ownership is enforced.** Every referenced table ID is checked to belong to the
  same `databaseId` as the view; a table from another database is rejected
  (generates a `CROSS_DATABASE_REF` error). `field_ids` are likewise scoped to the
  view's database. You cannot point a view at another tenant's table by ID or by
  guessing its physical schema name.
- **Names are derived, not trusted.** The physical `source_schema` / `source_table`
  that end up in the generated `CREATE VIEW` are looked up from the ID server-side,
  so a caller can't inject an arbitrary schema name.
- **The query AST is validated.** Before the view is created/altered, the compiled
  query is run through the same AST validator used by check constraints, indexes,
  and functions — it restricts every referenced schema to the view's own database
  schemas (plus framework schemas). This also covers the `ViewComposite` escape
  hatch (`data.query_ast`): an out-of-scope schema reference there fails validation
  rather than reaching PostgreSQL.

So `db.view.create` gives the same ownership and AST-validation guarantees as the
other declarative DDL surfaces — referencing by ID is the mechanism that provides
them, which is why the name-based shortcut isn't accepted.
