# Owning the security of a module-generated table

A module install ships its tables *and* their security: the grants and RLS policies its generators consider correct. That default is usually right for internal plumbing (jobs, history, i18n, catalogs) and usually *not* right for infrastructure a tenant runs its own access model over — who may push to a registry, which role reads images, which service role writes machines.

Two blueprint mechanisms address that table, and they mean different things:

| Blueprint shape | Meaning |
|---|---|
| A table entry with `module` + its own `policies[]` / `grants[]` | **Layer.** The declared policies/grants are *added* to what the module installed. |
| A table entry with `module` + `provisions` | **Own.** For each concern declared under a table key, the declared list becomes that table's *whole* set — the module's defaults for that concern are removed. |

Layering is the older behavior and keeps its meaning; nothing already written changes. Ownership is the new one and is expressed with the vocabulary the blueprint already uses for module-scoped security overrides (`provisions`, the same key the `storage[]`, `namespaces[]`, `functions[]` and `agents[]` entries take).

## Blueprint shape

`provisions` is keyed by the module's own **table keys** — the role a table plays inside the module, not the name the install gave it. The `module` reference therefore names the *install* and leaves `table` out, because the keys of `provisions` name the tables:

```json
{
  "tables": [
    {
      "module": { "type": "image", "scope": "org" },
      "provisions": {
        "registries": {
          "policies": [
            {
              "$type": "AuthzEntityMembership",
              "privileges": ["select", "insert", "update", "delete"],
              "permissive": true,
              "data": { "entity_field": "entity_id", "membership_type": 2, "capabilities": ["manage_registries"] }
            }
          ],
          "grants": [
            { "roles": ["authenticated"], "privileges": [["select", "*"]] },
            { "roles": ["administrator"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
          ]
        },
        "images": {
          "policies": [
            {
              "$type": "AuthzEntityMembership",
              "privileges": ["select"],
              "permissive": true,
              "data": { "entity_field": "entity_id", "membership_type": 2 }
            }
          ]
        }
      }
    }
  ]
}
```

Read that as: *this org-scoped image install's `registries` table has exactly these policies and exactly these grants; its `images` table has exactly these policies (and keeps the grants the module installed).*

### Which concern is owned is inferred, never flagged

There is no `replace`, `mode` or `strategy` key. Declaring a non-empty array under a table key **is** the ownership claim, per concern:

| Declared under a table key | Effect on that table |
|---|---|
| `policies` (non-empty) | Existing policies are dropped, the declared ones installed |
| `grants` (non-empty) | Existing grants are revoked, the declared ones installed |
| `nodes` / `fields` | Additive as always — fields are created, never removed |
| a concern left out | Untouched; the module's default stands |

So `{"registries": {"policies": [...]}}` swaps the policies and leaves the grants alone, and adding `grants` to the same entry takes over both.

### Rules the validator enforces

A malformed entry is rejected when the blueprint is written, not at provisioning time:

| Rule | Error code |
|---|---|
| `provisions` must be an object keyed by table keys | `VALIDATE_BLUEPRINT_EXPECTED_OBJECT` |
| `provisions` requires a `module` reference | `VALIDATE_BLUEPRINT_MISSING_REQUIRED_KEY` |
| `module.table` may not be set alongside `provisions` (the keys are the tables) | `VALIDATE_BLUEPRINT_INVALID` |
| The entry may not also carry `table_name`, `schema_name`, `policies`, `grants`, `nodes` or `fields` at its own level | `VALIDATE_BLUEPRINT_INVALID` |
| `provisions` may not be empty | `VALIDATE_BLUEPRINT_EMPTY_NOT_ALLOWED` |
| Each entry must declare at least one of `policies`, `grants`, `nodes`, `fields` | `VALIDATE_BLUEPRINT_MISSING_REQUIRED_KEY` |
| `policies` / `grants` / `nodes` / `fields` must be arrays; `use_rls` a boolean | `VALIDATE_BLUEPRINT_EXPECTED_ARRAY` / `VALIDATE_BLUEPRINT_EXPECTED_BOOLEAN` |
| A key naming no table of that module, or a reference ambiguous across installs, fails to resolve | `BLUEPRINT_MODULE_REF_INVALID`, `BLUEPRINT_MODULE_NOT_INSTALLED`, `BLUEPRINT_MODULE_REF_AMBIGUOUS`, `BLUEPRINT_MODULE_TABLE_UNKNOWN` |

The last row is the reason to prefer this over addressing the table by name: a reference **resolves or raises, never creates**.

## What replacement actually removes

- Policies the module installed on that table are dropped, including composed (`AuthzComposite`) ones.
- Companion policies *derived* from a policy — the ones `@history` and i18n companion tables carry — are not deleted directly; they are re-derived from the new policy set, so companions follow the tables they mirror.
- Grants are revoked per table, so a table whose grants you own no longer carries the module's default role grants. **Grant ownership is the sharpest edge here:** if the declared grants omit a role the platform's own workers use, that path stops working. Declare the full set, not the delta.
- Fields are never removed. `nodes`/`fields` under a provision entry remain additive.

## ORM: doing it after the install

The same capability is reachable on an already-provisioned database through `secureTableProvision`, which now accepts the module reference itself instead of only a `tableId`/`tableName`:

```typescript
const stp = await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    module: { type: 'image', scope: 'org', table: 'registries' },
    owns: ['policies', 'grants'],
    useRls: true,
    policies: [
      {
        $type: 'AuthzEntityMembership',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'entity_id', membership_type: 2 },
      },
    ],
    grants: [{ roles: ['authenticated'], privileges: [['select', '*']] }],
  },
  select: { id: true, tableId: true },
}).execute();
```

- `module` here **does** carry `table`, because one row provisions one table. The blueprint's install-shaped reference exists only because `provisions` supplies several table keys at once.
- `module` is mutually exclusive with `tableId`/`tableName`; supplying both raises `SECURE_TABLE_PROVISION_TARGET_AMBIGUOUS`.
- `owns` is the explicit form of what the blueprint infers — an array holding `'policies'`, `'grants'`, or both. Omit it and the row behaves as it always has: additive. Owning a concern the row supplies no array for is refused, since it would leave a table with RLS on and no policy.
- Everything else about the row is unchanged (`nodes`, `fields`, `useRls`, `outFields`), so ownership composes with field provisioning in one call.

Prefer the blueprint form when the blueprint is the source of truth for the database; use the ORM form to re-secure an install that already exists, or from an operational script.

## SDK availability

| Surface | State |
|---|---|
| Blueprint JSON (`provisions` on a table entry) | Available |
| Blueprint TypeScript types (`BlueprintTable.provisions`, `BlueprintModuleInstallRef`) | Generated from the node type registry — a checkout whose `node-type-registry` predates this feature will type `provisions` as unknown |
| `secureTableProvision.module` / `.owns` in generated ORM, CLI and hooks | Present once the client is regenerated against a schema carrying the columns |

If a generated client in hand does not show `module`/`owns` on `secureTableProvision`, that is a codegen-vintage gap, not a missing capability — regenerate against the current schema rather than reaching around the ORM.

## Where it applies

Any module-generated table a `module` reference can resolve — the addressable surface is every table that records what generated it, a few hundred across ~60 module types on a fully provisioned tenant. The infrastructure modules are the motivating case (`repository`, `image` and its `registries`/`registry_grants` tables, `machine`, `resource`, `function`), because their access model is a tenant decision rather than ours.

## Cross-references

- **Module references, table keys, scope/prefix disambiguation:** [`constructive-blueprints` → blueprint-definition-format.md](../constructive-blueprints/references/blueprint-definition-format.md)
- **Policy node shapes for the declared `policies[]`:** [authz-types.md](./authz-types.md) (`$type`, `data`, `privileges`, `permissive`, `policy_role`)
- **Composition of permissive and restrictive policies:** [`constructive-security`](../SKILL.md)
- **Capability names usable in a declared policy:** [capability-defaults.md](./capability-defaults.md)
