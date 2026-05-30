---
name: constructive-sdk
description: Secure-by-default cookbook for @constructive-io/sdk — secureTableProvision, auth flow, database provisioning, enum types, api_required fields, and verification. Covers the full lifecycle from sign-up to per-DB usage.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "3.0.0"
---

# Constructive SDK

Full lifecycle: sign up → provision database → auth → create secure tables → use per-DB API.

Related skills:
- **Safegres (Authz* types + meaning):** `constructive-safegres`
- **Security details (RLS, grants, policies):** `constructive-sdk-security`
- **Relation provisioning:** `constructive-sdk-relations`

---

## Prerequisites

- A GraphQL endpoint (see `constructive-db-local-dev-setup`)

---

## Auth Flow

See `references/auth-flow.md` for full details (endpoints, JWT structure, bootstrap user).

```typescript
import { createClient as createAuthClient } from '@constructive-db/sdk/auth';

const authDb = createAuthClient({ endpoint: 'http://auth.localhost:3000/graphql' });

// Sign up
await authDb.mutation.signUp({ input: { email, password } }, { select: { ok: true, errors: true } }).execute();

// Sign in — returns accessToken (NOT jwtToken, see workarounds/known-issues SDK-002)
const result = await authDb.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();
const { accessToken, userId } = result.signIn.result;
```

---

## Database Provisioning

See `references/provisioning.md` for end-to-end flow with per-DB auth.

Always use `modules: ['all']` and `bootstrapUser: true`:

```typescript
import { createClient as createPublicClient } from '@constructive-db/sdk/public';

const publicDb = createPublicClient({
  endpoint: 'http://api.localhost:3000/graphql',
  headers: { Authorization: `Bearer ${accessToken}` },
});

const result = await publicDb.databaseProvisionModule.create({
  data: {
    databaseName: dbName, ownerId: userId, subdomain: dbName, domain: 'localhost',
    modules: ['all'], bootstrapUser: true,
  },
  select: { id: true, databaseId: true, databaseName: true, status: true }
}).execute();
```

After provisioning, apply workarounds: `workarounds/fix-membership-defaults` and `workarounds/auto-verify-email`.

---

## Secure Table Provisioning

### Decide your secure defaults

1. Use `AuthzEntityMembership` (entity-scoped, row-bound) for entity-scoped data. Use `AuthzAppMembership` for app-level gates.
2. Start with least-privilege grants: `select` for `authenticated`, only add `insert/update/delete` if needed.
3. Turn on RLS (`useRls: true`).

### Create secure table + fields + grants + policy

```ts
const grant_privileges = [
  ['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*'],
] as unknown as Record<string, unknown>;

const policy_data: Record<string, unknown> = {
  entity_field: 'entity_id',
  membership_type: 2,
};

const res = await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    // schemaId is optional -- defaults to the database's app_public schema
    tableName: 'projects',
    nodeType: 'DataEntityMembership',
    useRls: true,
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzEntityMembership',
    policyPermissive: true,
    policyData: policy_data,
  },
  select: { id: true, tableId: true, outFields: true, tableName: true },
}).execute();

const provision = res.createSecureTableProvision.secureTableProvision;
const table_id = provision.tableId;
```

What success looks like:
- `provision.outFields` is populated with created field IDs when `nodeType` is set
- `metaschema_public.table_grant` rows exist (for the requested privileges + roles)
- `metaschema_public.policy` rows exist (for the chosen Safegres policy)
- RLS is enabled on the table when `useRls=true`

### Data* modules (fields)

- `DataId` — adds `id`
- `DataTimestamps` — adds `created_at`, `updated_at`
- `DataEntityMembership` — adds `entity_id`
- `DataDirectOwner` — adds `owner_id`
- `DataOwnershipInEntity` — adds `owner_id` + `entity_id`

### Add more fields by composing

```ts
await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableId: table_id,
    nodeType: 'DataTimestamps',
    nodeData: { include_id: false },
  },
  select: { id: true, outFields: true },
}).execute();
```

---

## Verification

```ts
// Verify RLS
const table = await db.table.findOne({ where: { id: table_id }, select: { useRls: true } }).execute();
if (!table.table?.useRls) throw new Error('RLS not enabled');

// Verify grants
const grants = await db.tableGrant.findMany({
  where: { tableId: { equalTo: table_id } },
  select: { id: true, privilege: true, roleName: true, fieldIds: true },
}).execute();
if (grants.tableGrants.nodes.length === 0) throw new Error('No grants');

// Verify policies
const policies = await db.policy.findMany({
  where: { tableId: { equalTo: table_id } },
  select: { id: true, privilege: true, roleName: true, policyType: true, permissive: true },
}).execute();
if (policies.policies.nodes.length === 0) throw new Error('No policies');
```

---

## AuthzAppMembership vs AuthzEntityMembership

| | `AuthzAppMembership` | `AuthzEntityMembership` |
|---|---|---|
| **Scope** | App-level only (hardcoded `membership_type=1`) | Any scope (org, group, custom) |
| **Row binding** | None — checks global app membership | Bound to `entity_field` on the row |
| **Use for** | App-wide admin gates, global feature access | Entity-scoped resources (org-owned, group-owned, etc.) |

If the table is entity-scoped (has `entity_id`, `organization_id`, `owner_id`, etc.), use `AuthzEntityMembership`. Use `AuthzAppMembership` only for app-level gates with no entity binding.

---

## Enum Types

The `metaschema_public.enum` table tracks PostgreSQL ENUM types. When you insert, update, or delete rows, compilation triggers automatically generate the corresponding `CREATE TYPE ... AS ENUM` DDL.

### Creating an Enum

```typescript
const enumResult = await db.enum.create({
  data: {
    databaseId,
    schemaName: 'app_public',
    name: 'project_status',
    values: ['draft', 'active', 'archived'],
  },
  select: { id: true, name: true, values: true },
}).execute();
```

This inserts a row into `metaschema_public.enum` and the compilation trigger generates:

```sql
CREATE TYPE app_public.project_status AS ENUM ('draft', 'active', 'archived');
```

### Updating an Enum

Updating the `values` array regenerates the ENUM type:

```typescript
await db.enum.update({
  where: { id: enumId },
  data: {
    values: ['draft', 'active', 'archived', 'completed'],
  },
  select: { id: true },
}).execute();
```

### Using an Enum on a Field

After creating the enum, reference it as the `type` when creating a field:

```typescript
await db.field.create({
  data: {
    databaseId,
    tableId,
    name: 'status',
    type: { name: 'project_status' },
    defaultValue: { value: 'draft' },
  },
  select: { id: true },
}).execute();
```

---

## Required API Fields (`api_required`)

Some foreign key columns are nullable at the database level (to allow `SET NULL` cascades on FK deletion) but should be required at the API level. The `api_required` flag handles this.

### How It Works

1. Set `api_required: true` on a field via the SDK
2. A trigger (`tg_sync_api_required_smart_tag`) injects `@requiredInput` into the column's smart tags
3. The `RequiredInputPlugin` in `graphile-settings` reads this tag and wraps the GraphQL input field type with `NonNull`
4. Result: the field is **required** in mutation inputs (create, update) but remains **nullable** in output types

### Setting api_required on a Field

```typescript
await db.field.update({
  where: { id: fieldId },
  data: {
    apiRequired: true,
  },
  select: { id: true, apiRequired: true },
}).execute();
```

### Setting api_required on a Relation

When creating relations via `relationProvision`, you can set `apiRequired` on the FK field:

```typescript
await db.relationProvision.create({
  data: {
    databaseId,
    fromTableId: projectsTableId,
    toTableId: organizationsTableId,
    fromFieldName: 'organization_id',
    apiRequired: true,          // FK is nullable in DB but required in API
    cascadeDelete: 'no_action', // default is now NO ACTION (not CASCADE)
  },
  select: { id: true },
}).execute();
```

### FK Cascade Defaults

Foreign key cascade behavior defaults to `NO ACTION`. Always specify the cascade behavior explicitly:

| Cascade | When to Use |
|---------|-------------|
| `no_action` | Default. FK deletion raises an error if references exist |
| `set_null` | FK deletion sets the column to NULL (use with nullable FKs) |
| `cascade` | FK deletion cascades to delete referencing rows (use carefully) |

---

## Appendix: Manual mode (only if you can't use secureTableProvision)

1. Enable RLS: `db.table.update({ data: { useRls: true } })`
2. Create grants: `db.tableGrant.create`
3. Create policies: `db.policy.create` with Safegres `policyType` + `data`

In almost all situations, prefer `secureTableProvision`.

---

## Related

- `references/auth-flow.md` — auth endpoints, JWT, bootstrap user
- `references/provisioning.md` — full provisioning flow with per-DB auth
- `constructive-db-built-in-schemas` — what `modules: ['all']` creates
- `constructive-safegres` — Authz* type reference
- `constructive-sdk-security` — RLS, grants, policies
