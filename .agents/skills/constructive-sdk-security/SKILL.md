---
name: constructive-sdk-security
description: Customer-facing guide to securely provisioning tables using the Constructive TypeScript GraphQL SDK. Covers RLS enable/disable, grants, policies (Safegres Authz* types), and the recommended secureTableProvision workflow. No SQL.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Security (TypeScript SDK)

This skill is for **SDK users** (no SQL access) to provision security correctly.

- **Safegres** = the Authz* policy protocol (types + JSON config): see the `constructive-safegres` skill
- This skill = how to apply those Safegres policies via the **TypeScript GraphQL SDK**: RLS, grants, and provisioning.

---

## 0) SDK setup

```ts
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});
```

---

## 1) Key ideas (secure-by-default)

1. **RLS is the enforcement layer**. Without RLS, policies do nothing.
2. **Grants are the "SQL verbs" allowed** (select/insert/update/delete). RLS filters *rows*, grants allow the operation at all.
3. **Policies are the "who can do it"** and are expressed in **Safegres** (Authz* types).
4. Prefer **`secureTableProvision`** as the primary API: it can create fields, grants, policies, and enable RLS in one step.

---

## 2) Enable / disable RLS

`useRls` is a property of the table.

```ts
await db.table.update({
  where: { id: '<table-id>' },
  data: { useRls: true },
  select: { id: true, useRls: true },
}).execute();
```

To disable RLS:

```ts
await db.table.update({
  where: { id: '<table-id>' },
  data: { useRls: false },
  select: { id: true, useRls: true },
}).execute();
```

If your environment requires it, you may also need to run the RLS apply mutation:

```ts
await db.mutation.applyRls({
  input: {
    tableId: '<table-id>',
    // optional: grants, policyType, vars, fieldIds, permissive, name
  },
}).execute();
```

---

## 3) Create grants (principle of least privilege)

Grants are created per (table, role, privilege). Optionally scope to specific columns via `fieldIds`.

Grant `select` to authenticated users for all columns:

```ts
await db.tableGrant.create({
  data: {
    tableId: '<table-id>',
    roleName: 'authenticated',
    privilege: 'select',
  },
  select: { id: true },
}).execute();
```

Grant `update` only on a subset of fields:

```ts
await db.tableGrant.create({
  data: {
    tableId: '<table-id>',
    roleName: 'authenticated',
    privilege: 'update',
    fieldIds: ['<field-id-1>', '<field-id-2>'],
  },
  select: { id: true },
}).execute();
```

---

## 4) Create policies (Safegres)

Policies attach Safegres to a table. Your main choices come from the `constructive-safegres` skill.

Example: entity-scoped access (org members can read/write rows by `entity_id`):

```ts
const policy_data: Record<string, unknown> = {
  entity_field: 'entity_id',
  membership_type: 2,
};

await db.policy.create({
  data: {
    tableId: '<table-id>',
    roleName: 'authenticated',
    privilege: 'select',
    permissive: true,
    policyType: 'AuthzEntityMembership',
    data: policy_data,
  },
  select: { id: true },
}).execute();
```

Important reminder:
- `AuthzAppMembership` is hardcoded to `membership_type=1` (app-level gating). For entity-scoped data, use `AuthzEntityMembership`.

---

## 5) Primary method: `secureTableProvision` (recommended)

`secureTableProvision` can:
- add fields via `nodeType` (Data* modules)
- create grants (`grantRoles`, `grantPrivileges`)
- create policies (`policyType`, `policyData`, `policyPermissive`, `policyPrivileges`)
- enable RLS (`useRls`)

### Example: Create an org-scoped table securely (fields + grants + policy + RLS)

```ts
// Wildcard grants (all columns):
const grant_privileges = [
  ['select', '*'],
  ['insert', '*'],
  ['update', '*'],
  ['delete', '*'],
] as unknown as Record<string, unknown>;

// Field-level grants (restrict which columns each privilege applies to):
// const grant_privileges = [
//   ['select', '*'],                      // read all columns
//   ['insert', ['name', 'bio', 'email']], // can only insert these columns
//   ['update', ['name', 'bio']],          // can only update these columns
// ] as unknown as Record<string, unknown>;

const policy_data: Record<string, unknown> = {
  entity_field: 'entity_id',
  membership_type: 2,
};

const provision = await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    // schemaId is optional -- defaults to the database's app_public schema
    tableName: 'projects',

    // Fields:
    nodeType: 'DataEntityMembership',

    // Security:
    useRls: true,
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,

    policyType: 'AuthzEntityMembership',
    policyPermissive: true,
    policyData: policy_data,
  },
  select: { id: true, tableId: true, outFields: true },
}).execute();

const table_id = provision.createSecureTableProvision.secureTableProvision.tableId;
```

### Compose multiple provisions on the same table

Add timestamps after the fact (fields only):

```ts
await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableId: '<table-id>',
    nodeType: 'DataTimestamps',
    nodeData: { include_id: false },
  },
  select: { id: true },
}).execute();
```

Add a second permissive policy for **reads only** (PostgreSQL ORs permissive policies):

> **`AuthzPublishable` is a READ-only policy.** It must only be applied to `select`. For write privileges (insert, update, delete), use an identity-based policy like `AuthzEntityMembership`. A typical blog pattern: `AuthzEntityMembership` for all CRUD, plus `AuthzPublishable` for `select` only to open published content to readers.

```ts
await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableId: '<table-id>',
    policyType: 'AuthzPublishable',
    policyPermissive: true,
    policyData: {},
    policyPrivileges: ['select'],  // READ-only — never insert/update/delete

    // No grants in this row:
    grantPrivileges: [] as unknown as Record<string, unknown>,
  },
  select: { id: true },
}).execute();
```

---

## 6) Common mistakes

1. **Using `AuthzAppMembership` for entity-scoped tables** (it is app-level only and does not bind to any entity field).
2. **Forgetting RLS** (policies don't enforce without `useRls: true`).
3. **Over-granting** (start with minimal grants; add column-scoped `fieldIds` for update).
4. **Using `AuthzComposite` by default** (prefer multiple top-level permissive/restrictive policies).
