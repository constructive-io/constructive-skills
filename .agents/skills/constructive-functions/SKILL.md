---
name: constructive-functions
description: "Customer-authored database functions and trigger attachments through the SDK ORM — `db.function` rows (kind `sql` | `plpgsql` | `trigger`) with a validated AST body, `apiExposed` opt-in to the generated GraphQL API, and `db.trigger` rows (kind `attachment`) that fire a customer trigger function AFTER INSERT/UPDATE/DELETE FOR EACH ROW with an optional `whenAst`. Use when asked to 'add a database function', 'write a PL/pgSQL function', 'custom SQL function', 'expose a function in the API', 'add a trigger', 'attach a trigger function', 'run code when a row changes', 'bodyAst', 'whenAst', 'apiExposed', 'FUNCTION_NAME_CONFLICT', 'FUNCTION_SCHEMA_NOT_EXPOSABLE', 'TRIGGER_ATTACHMENT_FUNCTION_NOT_A_TRIGGER', or 'FUNCTION_ENVELOPE_VIOLATION'."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Functions

Customer-authored functions and triggers are **metaschema rows**, not DDL you run. You insert a `function` row carrying a signature and a validated AST body; provisioning validates it against an allowlist, transpiles logical schema names (`app_public`) to physical ones, emits the function, and keeps it in sync on every update. A `trigger` row of kind `attachment` wires a `kind: 'trigger'` function to a table.

Generated models (default `constructive-sdk` target): `db.function`, `db.trigger`. Verified fields are listed in [references/function-model.md](./references/function-model.md) and [references/trigger-attachments.md](./references/trigger-attachments.md).

## When to Apply

Use this skill when:

- Adding a SQL or PL/pgSQL function to a tenant schema and (optionally) publishing it as a GraphQL query/mutation field.
- Attaching a trigger that runs customer logic on row changes, with or without a `WHEN` condition.
- Deciding between a customer function and a blueprint generator (`JobTrigger`, `DataHistory`, `EventTracker`, …) — prefer the generator when one exists; see `constructive-jobs`, `constructive-history`, `constructive-events`.
- Debugging `FUNCTION_*` / `TRIGGER_*` error codes from a `db.function` / `db.trigger` write.

Do **not** use this skill for platform-generated functions (`kind: 'reservation'` rows — name reservations owned by generators), for `db.triggerFunction` (legacy generated trigger-function code, not a customer surface), or for background work — that is `constructive-jobs`.

## Model in one screen

```ts
// A PL/pgSQL function callable from the API
await db.function
  .create({
    data: {
      databaseId,
      schemaId: appPublicSchemaId,
      name: 'order_total',
      kind: 'plpgsql',
      arguments: [{ name: 'customer_id', type: { name: 'uuid' } }],
      returns: { type: { name: 'numeric' } },
      volatility: 'STABLE',
      bodyAst: orderTotalAst,   // full PLpgSQL_function AST — see function-model.md
      apiExposed: true,
    },
    select: { id: true, name: true, kind: true, apiExposed: true },
  })
  .unwrap();

// A trigger function + its attachment
const { createFunction } = await db.function
  .create({
    data: {
      databaseId,
      schemaId: appPublicSchemaId,
      name: 'stamp_order',
      kind: 'trigger',
      arguments: [],
      returns: { type: { name: 'trigger' } },
      volatility: 'VOLATILE',
      bodyAst: stampAst,
    },
    select: { id: true },
  })
  .unwrap();

await db.trigger
  .create({
    data: {
      databaseId,
      tableId: ordersTableId,
      name: 'orders_stamp_tg',
      kind: 'attachment',
      functionId: createFunction.function.id,
      timing: 'AFTER',
      events: ['INSERT', 'UPDATE'],
      forEachRow: true,
      whenAst: { field: 'total', op: '>', value: '10' },
    },
    select: { id: true, timing: true, events: true, whenAst: true },
  })
  .unwrap();
```

## Rules that the row constraints enforce

| Rule | Where it bites |
|------|----------------|
| `kind` ∈ `reservation` \| `sql` \| `plpgsql` \| `trigger`; the kind **is** the LANGUAGE | `function_kind_valid` |
| `securityInvoker` is always `true` — SECURITY DEFINER is not expressible; customer code runs as the caller under RLS | `function_security_invoker_only` |
| `volatility` ∈ `IMMUTABLE` \| `STABLE` \| `VOLATILE`; a definition row needs `returns`, `volatility` and a body (`bodyAst` or `functionType`) | `function_definition_complete` |
| `kind: 'trigger'` ⇒ `arguments: []`, `returns: { type: { name: 'trigger' } }`, `volatility: 'VOLATILE'`, `bodyAst` set, `apiExposed: false` | `function_trigger_signature`, `function_trigger_not_api_exposed` |
| `apiExposed` defaults to **false**. Emitted functions get no EXECUTE grant and every PostGraphile behavior denied until it is turned on; turning it on requires the schema to be `isPublic` with `apiExposure: 'exposable'` | `enforce_api_exposure` → `FUNCTION_SCHEMA_NOT_EXPOSABLE` |
| Names `query`, `mutation`, `subscription`, `node` are rejected; a name already reserved by a generator or defined by another kind raises | `DATABASE_FUNCTION_RESERVED_WORD`, `FUNCTION_NAME_RESERVED`, `FUNCTION_NAME_CONFLICT` |
| Body AST is **allowlisted**: no dynamic SQL/`EXECUTE`, no `SET`/`set_config`/`current_setting`, no COMMIT/ROLLBACK, no cursors, no `CALL`, no DDL; embedded SQL is SELECT/INSERT/UPDATE/DELETE over schema-qualified relations in the tenant's allowed schemas; raw string expressions are rejected; size/node-count/depth limits apply | `ast_validate` → provisioning error |
| Signature may not name `trigger`, `internal`, `cstring`, `record`, `any*`, handler pseudo-types | transpile step |
| An attachment is always `timing: 'AFTER'`, `forEachRow: true`, `events` a non-empty subset of `INSERT`/`UPDATE`/`DELETE`; BEFORE / statement-level / INSTEAD OF are not expressible | `trigger_customer_attachment_shape`, `TRIGGER_NOT_EMITTED` |

An emitted function is re-checked after emission: SECURITY DEFINER, `SET search_path`, LEAKPROOF or a non-`sql`/`plpgsql` language raise `FUNCTION_ENVELOPE_VIOLATION`.

## SDK gaps (do not invent)

- There is **no generated `createCustomerFunction` / `createCustomerTrigger` mutation** in the ORM. The `actions_public` procedures of those names are internal; the supported path is the `db.function` / `db.trigger` row CRUD shown above.
- The ORM does not build the AST for you. `bodyAst` for `plpgsql`/`trigger` is the hydrated `PLpgSQL_function` node (the `plpgsql_funcs[0]` item that `plpgsql-parser`'s `parse()` returns for a `CREATE FUNCTION … LANGUAGE plpgsql` source); for `sql` it is `{ version, stmts: [{ stmt }] }` from the same parser. Whether that dependency is available in your project is a project decision — check `package.json` before importing it.
- **Tier A** `functionType` + `data` (typed `Function*` node types, analogous to `View*` types) is a reserved shape: no `Function*` node types are registered yet, so use `bodyAst`.
- Calling an `apiExposed` function goes through the **tenant's** generated GraphQL schema (it appears as a query for `STABLE`/`IMMUTABLE`, a mutation for `VOLATILE`) — regenerate that project's codegen (`constructive-codegen`) to get a typed call; `constructive-sdk` does not carry customer functions.

## References

| File | Content |
|---|---|
| [function-model.md](./references/function-model.md) | `db.function` fields, `arguments`/`returns` JSON shapes, `bodyAst` construction, update semantics, `apiExposed` |
| [trigger-attachments.md](./references/trigger-attachments.md) | `db.trigger` attachment fields, `whenAst` DSL vs raw AST, normalization, error codes |

## Cross-References

- [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md) — schemas/tables the function targets (`schemaId`, `tableId`).
- [`constructive-security`](../constructive-security/SKILL.md) — customer functions run as the invoker under RLS; grants on the tables they touch still apply.
- [`constructive-jobs`](../constructive-jobs/SKILL.md) — `JobTrigger` for asynchronous work instead of an in-transaction trigger.
- [`constructive-troubleshooting`](../constructive-troubleshooting/SKILL.md) — error-code recipes.
