# `db.function` — customer-authored function rows

Generated model in the default `constructive-sdk` target: `db.function` with `findMany` / `findOne` / `create` / `update` / `delete`. The `create` result is `{ createFunction: { function: <selected> } }`; `update` and `delete` follow the same `{ updateFunction: { function } }` / `{ deleteFunction: { function } }` envelope the rest of the ORM uses.

## Fields (`FunctionPatch` / `CreateFunctionInput['function']`)

| Field | Type | Required on create | Notes |
|---|---|---|---|
| `databaseId` | uuid | yes | |
| `schemaId` | uuid | yes | Schema the function is emitted into; names are unique per schema |
| `name` | string | yes | `query`, `mutation`, `subscription`, `node` are rejected |
| `kind` | `'reservation'` \| `'sql'` \| `'plpgsql'` \| `'trigger'` | no (default `reservation`) | For customer code always set one of the last three; it is the LANGUAGE |
| `arguments` | JSON array | for definitions | `[{ name, type: { name, schema? } }, …]` — `[]` for a trigger function |
| `returns` | JSON object | for definitions | `{ type: { name, schema? }, setof?: boolean }`; `{ type: { name: 'trigger' } }` for a trigger function |
| `volatility` | `'IMMUTABLE'` \| `'STABLE'` \| `'VOLATILE'` | for definitions | Trigger functions must be `VOLATILE` |
| `isStrict` | boolean | no (default `false`) | `RETURNS NULL ON NULL INPUT` |
| `securityInvoker` | boolean | no (default `true`) | Must stay `true`; a CHECK rejects `false` |
| `bodyAst` | JSON object | Tier B | Complete parsed body — see below |
| `functionType` | string | Tier A | Registered `Function*` node type name; none registered yet |
| `data` | JSON object | Tier A | Node-type parameters for `functionType` |
| `apiExposed` | boolean | no (default `false`) | Opt-in to the tenant GraphQL API |
| `category` | `ObjectCategory` | no | Same object category enum used by tables/views |
| `tags`, `smartTags` | string[] / JSON | no | PostGraphile smart tags applied on emission |

Selectable relations: `database`, `schema`, `triggers` (attachments pointing at this function).

## `arguments` / `returns` shapes

Verified from the provisioning tests:

```ts
arguments: [{ name: 'customer_id', type: { name: 'uuid' } }]
arguments: [{ name: 'status', type: { name: 'order_status', schema: 'app_public' } }]   // enum in a tenant schema
returns:   { type: { name: 'numeric' } }
returns:   { setof: true, type: { name: 'uuid' } }
returns:   { type: { name: 'trigger' } }
```

The generated TypeScript types `arguments`, `returns`, `bodyAst` as `Record<string, unknown>` (JSON); pass the array/object shown and cast if your compiler settings require it.

`schema` inside a type is the **logical** schema name (`app_public`); provisioning rewrites it to the physical name. Pseudo-types other than `trigger` (`internal`, `cstring`, `record`, `any*`, language handlers) are rejected.

## `bodyAst` — what goes in

`bodyAst` is not SQL text and not a body fragment. It is the parser output for the whole function:

- `kind: 'plpgsql'` / `'trigger'` — the hydrated `PLpgSQL_function` node, i.e. `parse(source).items[0].plpgsql.hydrated.plpgsql_funcs[0]` from the `plpgsql-parser` package when `source` is a full `CREATE FUNCTION … LANGUAGE plpgsql AS $$ … $$` statement.
- `kind: 'sql'` — `{ version, stmts: [{ stmt }] }` where `stmt` is the parsed statement (a `SELECT`/`INSERT`/`UPDATE`/`DELETE`) from the same parser.

Relation references inside the body use logical schema names (`app_public.orders`) and are rewritten on emission. Whatever produced the AST, provisioning validates it against a strict allowlist (`ast_validate`):

- statement nodes and object keys outside the allowlist are rejected, including anything a newer PostgreSQL adds until it is reviewed;
- **rejected outright**: dynamic SQL (`EXECUTE`, `FOR … IN EXECUTE`, `RETURN QUERY EXECUTE`), `SET`/`RESET`/`set_config`/`current_setting`, `COMMIT`/`ROLLBACK`, cursors, `CALL`, every DDL tag;
- embedded SQL is limited to `SELECT`/`INSERT`/`UPDATE`/`DELETE` over schema-qualified relations in the tenant's allowed schemas — `pg_catalog`, `information_schema`, `metaschema_*`, `jwt_*`, `errors`, `actions_public`, `routing_public`, `object_store_public`, `infra_public`, `compute_public`, `remote_public` and other platform schemas are never allowed;
- expressions must be hydrated AST nodes; raw string expressions fail;
- byte size, node count, nesting depth and loop-nesting limits apply.

A rejected body fails the `db.function.create` / `update` call with the validator's description; nothing is emitted.

## Update semantics

Provisioning runs on every insert/update of a definition row. Changing `name`, `schemaId`, `arguments`, `returns`, `volatility`, `isStrict` or `kind` drops the previously emitted function and emits the new identity; changing only `bodyAst` replaces the body in place. Deleting the row drops the function (and any attachment rows referencing it must go first — `trigger.functionId` is a FK).

```ts
await db.function
  .update({
    where: { id: functionId },
    data: { bodyAst: newAst, volatility: 'STABLE' },
    select: { id: true, volatility: true },
  })
  .unwrap();

await db.function.delete({ where: { id: functionId }, select: { id: true } }).unwrap();
```

## `apiExposed`

- Default `false`: the function exists in the database but has no EXECUTE grant to `anonymous`/`authenticated` and every PostGraphile behavior is denied, so it is invisible in the API.
- `true`: requires the target schema to be `isPublic: true` with `apiExposure: 'exposable'` (see `constructive-data-modeling` for `db.schema`), else `FUNCTION_SCHEMA_NOT_EXPOSABLE`. The function then appears in the **tenant's** GraphQL schema following PostGraphile's rules — a query field for `STABLE`/`IMMUTABLE`, a mutation for `VOLATILE`, with the argument names camel-cased.
- A `kind: 'trigger'` function can never be exposed (`function_trigger_not_api_exposed`).
- Exposed functions still run as the invoker; RLS on any table the body touches applies to the caller.

Calling the exposed function from TypeScript is a tenant-schema concern: regenerate that project's client (`constructive-codegen`) or issue the GraphQL operation directly — `constructive-sdk` (the platform ORM) does not contain customer functions.

## Reading back

```ts
const { functions } = await db.function
  .findMany({
    where: {
      databaseId: { equalTo: databaseId },
      kind: { in: ['sql', 'plpgsql', 'trigger'] },
    },
    select: {
      id: true,
      name: true,
      kind: true,
      apiExposed: true,
      volatility: true,
      schema: { select: { name: true } },
      triggers: { select: { id: true, tableId: true, events: true } },
    },
  })
  .unwrap();
```

Rows with `kind: 'reservation'` are names held by blueprint generators (job triggers, history, search, …). They are read-only in practice: they carry no body, and inserting a customer definition with the same name in the same schema raises `FUNCTION_NAME_RESERVED`.

## Error codes

| Code | Cause | Fix |
|---|---|---|
| `DATABASE_FUNCTION_RESERVED_WORD` | `name` is `query`/`mutation`/`subscription`/`node` | Rename |
| `FUNCTION_NAME_RESERVED` | A generator holds the name in this schema | Rename; do not delete the reservation |
| `FUNCTION_NAME_CONFLICT` | Another definition (any kind) already uses the name in the schema | Rename or update the existing row |
| `FUNCTION_SCHEMA_NOT_EXPOSABLE` | `apiExposed: true` on a schema that is not public/exposable | Fix the schema's `isPublic`/`apiExposure` or keep the function internal |
| `FUNCTION_ENVELOPE_VIOLATION` | Emitted function is not the envelope (security definer, `SET`, leakproof, other language) | Should not happen from a validated body — report it |
| `NOT_FOUND` / `OBJECT_NOT_FOUND` | `schemaId` / `tableId` does not resolve | Check the id belongs to `databaseId` |
| CHECK violations `function_kind_valid`, `function_definition_complete`, `function_trigger_signature`, `function_security_invoker_only`, `function_trigger_not_api_exposed`, `function_volatility_valid`, `function_reservation_not_api_exposed`, `function_reservation_has_no_definition` | Row shape breaks a rule in SKILL.md's table | Adjust the row |

See `constructive-troubleshooting` for the general error-handling recipe.
