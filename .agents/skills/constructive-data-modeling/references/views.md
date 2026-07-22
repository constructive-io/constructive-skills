# Views

Views are declared through the SDK ORM against the metaschema via `db.view.create`;
each row compiles to a PostgreSQL `CREATE VIEW`. The view body is chosen by
`viewType` (a `View*` node type — see
[`constructive-blueprints`](../../constructive-blueprints/references/node-type-registry.md)
for the catalog: `ViewTableProjection`, `ViewJoinedTables`, `ViewAggregated`,
`ViewFilteredTable`, `ViewComposite`).

```typescript
await db.view.create({
  data: {
    databaseId,
    schemaId,
    name: 'active_projects',
    viewType: 'ViewTableProjection',
    tableId: projectsTableId,
    data: { source_schema: 'app_public', source_table: 'projects' },
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
    data: { source_schema: 'app_public', source_table: 'owners' },
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
