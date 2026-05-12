---
name: constructive-sdk-relations
description: Customer-facing guide to provisioning table relations using the Constructive TypeScript GraphQL SDK. Covers all four relation types (BelongsTo, HasMany, HasOne, ManyToMany), field auto-derivation, delete actions, junction table strategies, security forwarding, and a deep dive on ManyToMany + security patterns (nodeType/policyType pairing, junction table RLS, parent-matching security). No SQL.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Relation Provision (TypeScript SDK)

Goal: give an agent/user **exact steps** to create **relations between tables** using the TypeScript SDK's `relationProvision.create` API.

Related skills:
- **Safegres (Authz* policy protocol):** `constructive-safegres`
- **Data* modules (field generators):** see `blueprint-definition-format.md` in `constructive-skills` for all nodeType values, what fields they create, and nodeData options
- **Secure table provisioning (SDK):** `constructive-sdk`
- **Security via SDK (grants, RLS, policies):** `constructive-sdk-security`

---

## Prerequisites

You must have:
- A GraphQL endpoint and a token with rights to provision schema objects
- `database_id` for the target database
- **Two existing tables** (source and target) created via `secureTableProvision` or equivalent
- Tables must belong to the same database

---

## SDK setup

```ts
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: 'Bearer <token>' },
});
```

---

## Core concepts

### The four relation types

| Relation type | Meaning | Where the FK field is created | Example |
|---|---|---|---|
| `RelationBelongsTo` | Child references parent | **Source** table | `tasks` belongs to `projects` -> `tasks.project_id` |
| `RelationHasMany` | Parent has many children | **Target** table | `projects` has many `tasks` -> `tasks.project_id` |
| `RelationHasOne` | One-to-one (FK + unique) | **Source** table | `settings` has one `author` -> `settings.author_id` (unique) |
| `RelationManyToMany` | Junction table | New **junction** table | `projects` <-> `tags` -> `project_tags` table |

> `RelationBelongsTo` and `RelationHasMany` are inverses of each other. They produce the same FK field, but from opposite perspectives. Choose whichever reads naturally for your domain.

### Field name auto-derivation

When you omit `fieldName` (or `sourceFieldName`/`targetFieldName` for ManyToMany), the system auto-derives names using inflection:
- Target table `projects` -> field name `project_id`
- Source table `authors` -> field name `author_id`
- Junction table from `projects` + `tags` -> table name `project_tags`

You can always override by providing explicit names.

### Output columns

Every `relationProvision.create` call returns **output columns** populated by the system:

| Output field | Populated for | Contains |
|---|---|---|
| `outFieldId` | BelongsTo, HasMany, HasOne | UUID of the FK field created/found |
| `outJunctionTableId` | ManyToMany | UUID of the junction table created/found |
| `outSourceFieldId` | ManyToMany | UUID of the source FK field on the junction table |
| `outTargetFieldId` | ManyToMany | UUID of the target FK field on the junction table |

### Idempotent (graceful) operations

All operations are **graceful**: if a field, FK constraint, or unique constraint already exists with the same name/shape, it is reused rather than duplicated. You can safely call the same provision multiple times.

---

## Relation type 1: `RelationBelongsTo`

**Intent:** "Source table has a FK column pointing at target table."

### Required fields

| Field | Required | Description |
|---|---|---|
| `databaseId` | Yes | Database UUID |
| `relationType` | Yes | `'RelationBelongsTo'` |
| `sourceTableId` | Yes | Table that gets the FK field |
| `targetTableId` | Yes | Table being referenced |
| `deleteAction` | Yes | FK delete behavior: `'r'` (RESTRICT), `'c'` (CASCADE), `'n'` (SET NULL), `'d'` (SET DEFAULT), `'a'` (NO ACTION) |

### Optional fields

| Field | Default | Description |
|---|---|---|
| `fieldName` | Auto-derived from target table name | Explicit FK field name |
| `isRequired` | `true` | Whether the FK field is NOT NULL |

### Example: tasks belongs to projects (auto-derived field name)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationBelongsTo',
    sourceTableId: '<tasks-table-id>',
    targetTableId: '<projects-table-id>',
    deleteAction: 'r',
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

const provision = res.createRelationProvision.relationProvision;
// provision.fieldName === 'project_id'  (auto-derived from "projects")
// provision.outFieldId === UUID of the created FK field on the tasks table
```

**What happens:**
- A `uuid` field named `project_id` is created on the `tasks` table (NOT NULL by default)
- A foreign key constraint is created: `tasks.project_id` -> `projects.id`
- Delete action is RESTRICT (`'r'`)

### Example: tasks belongs to projects (explicit field name, CASCADE)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationBelongsTo',
    sourceTableId: '<tasks-table-id>',
    targetTableId: '<projects-table-id>',
    fieldName: 'assigned_project_id',
    deleteAction: 'c',
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

// provision.fieldName === 'assigned_project_id'
```

### Example: optional FK (nullable)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationBelongsTo',
    sourceTableId: '<tasks-table-id>',
    targetTableId: '<projects-table-id>',
    deleteAction: 'n',
    isRequired: false,
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

// The field is nullable (SET NULL on delete)
```

### Error: missing deleteAction

`deleteAction` is **required** for BelongsTo. Omitting it raises:
```
RELATION_PROVISION: delete_action is required for RelationBelongsTo
```

---

## Relation type 2: `RelationHasMany`

**Intent:** "Source table is the parent; target table gets the FK column."

This is the **inverse** of BelongsTo. The FK field is created on the **target** table, but the field name is derived from the **source** table.

### Required fields

Same as BelongsTo: `databaseId`, `relationType`, `sourceTableId`, `targetTableId`, `deleteAction`.

### Optional fields

Same as BelongsTo: `fieldName` (auto-derived from **source** table), `isRequired`.

### Example: projects has many tasks (CASCADE delete)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationHasMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<tasks-table-id>',
    deleteAction: 'c',
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

const provision = res.createRelationProvision.relationProvision;
// provision.fieldName === 'project_id'  (derived from source table "projects")
// provision.outFieldId === UUID of the FK field on the TASKS table
```

**What happens:**
- A `uuid` field named `project_id` is created on the `tasks` table (the target)
- FK: `tasks.project_id` -> `projects.id` with CASCADE delete

### Example: optional child (nullable FK)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationHasMany',
    sourceTableId: '<authors-table-id>',
    targetTableId: '<tasks-table-id>',
    deleteAction: 'n',
    isRequired: false,
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

// provision.fieldName === 'author_id'
// The field is nullable on the tasks table
```

---

## Relation type 3: `RelationHasOne`

**Intent:** "Source table has a FK + unique constraint on the source table referencing the target."

Same as BelongsTo but additionally creates a **unique constraint** on the FK field, enforcing a 1:1 relationship.

### Required fields

Same as BelongsTo: `databaseId`, `relationType`, `sourceTableId`, `targetTableId`, `deleteAction`.

### Example: settings has one author

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationHasOne',
    sourceTableId: '<settings-table-id>',
    targetTableId: '<authors-table-id>',
    deleteAction: 'c',
  },
  select: {
    id: true,
    outFieldId: true,
    fieldName: true,
  },
}).execute();

const provision = res.createRelationProvision.relationProvision;
// provision.fieldName === 'author_id'  (auto-derived from target)
// provision.outFieldId === UUID of FK field on settings table
```

**What happens:**
- A `uuid` field named `author_id` is created on `settings`
- FK: `settings.author_id` -> `authors.id` with CASCADE
- Unique constraint on `settings.author_id` (ensures one setting per author)

---

## Relation type 4: `RelationManyToMany`

**Intent:** "Create a junction table linking two tables."

This is the most powerful relation type. It creates (or reuses) a junction table and configures FK fields, primary keys, and security.

### Required fields

| Field | Required | Description |
|---|---|---|
| `databaseId` | Yes | Database UUID |
| `relationType` | Yes | `'RelationManyToMany'` |
| `sourceTableId` | Yes | First table in the relation |
| `targetTableId` | Yes | Second table in the relation |

> Note: `deleteAction` is **not used** for ManyToMany. Junction table FKs always use CASCADE.

### Junction table identity options

| Field | Default | Description |
|---|---|---|
| `junctionTableName` | Auto-derived (e.g., `project_tags`) | Name for the new junction table |
| `junctionTableId` | Creates new table | UUID of an existing table to use as junction |
| `junctionSchemaId` | Source table's schema | Schema for the junction table |
| `sourceFieldName` | Auto-derived from source table | FK field name on junction referencing source |
| `targetFieldName` | Auto-derived from target table | FK field name on junction referencing target |

### Primary key strategy

| Field | Default | Description |
|---|---|---|
| `useCompositeKey` | `false` | `true`: composite PK from both FK fields. `false`: no PK created by default |

When `useCompositeKey` is `false`, you have two options:
1. Set `nodeType: 'DataId'` to create a UUID `id` primary key on the junction table
2. Leave both unset for a bare junction table with no PK

> `useCompositeKey: true` and `nodeType: 'DataId'` are **mutually exclusive** (both create a PK).

### Security forwarding (to `secureTableProvision`)

ManyToMany forwards all security config to `secureTableProvision` for the junction table:

| Field | Default | Description |
|---|---|---|
| `nodeType` | `null` | Data module for field creation (e.g., `'DataId'`, `'DataEntityMembership'`) |
| `nodeData` | `{}` | Config for the data module |
| `grantRoles` | `['authenticated']` | Roles to grant privileges to |
| `grantPrivileges` | `[["select","*"],["insert","*"],["delete","*"]]` | Privilege grants |
| `policyType` | `null` | Safegres policy type (e.g., `'AuthzEntityMembership'`, `'AuthzAllowAll'`) |
| `policyData` | `{}` | Policy configuration |
| `policyPermissive` | `true` | Whether the policy is PERMISSIVE or RESTRICTIVE |
| `policyPrivileges` | `null` | Privileges the policy applies to |
| `policyRole` | `null` | Role the policy targets |

### Example 4A: Composite key junction table (simplest)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: true,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    outSourceFieldId: true,
    outTargetFieldId: true,
    junctionTableName: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

const provision = res.createRelationProvision.relationProvision;
// provision.junctionTableName === 'project_tags'
// provision.sourceFieldName === 'project_id'
// provision.targetFieldName === 'tag_id'
// provision.outJunctionTableId === UUID of the new junction table
```

**What happens:**
- New table `project_tags` is created
- Fields: `project_id` (FK -> projects), `tag_id` (FK -> tags)
- Composite PK: `(project_id, tag_id)` -- each pair is unique
- Default grants: select/insert/delete for `authenticated`

### Example 4B: DataId primary key junction table

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<authors-table-id>',
    useCompositeKey: false,
    nodeType: 'DataId',
  },
  select: {
    id: true,
    outJunctionTableId: true,
    outSourceFieldId: true,
    outTargetFieldId: true,
    junctionTableName: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

// provision.junctionTableName === 'project_authors'
// Junction table has: id (uuid PK), project_id (FK), author_id (FK)
```

**What happens:**
- New table `project_authors` with a UUID `id` primary key
- Fields: `id` (PK), `project_id` (FK -> projects), `author_id` (FK -> authors)
- Allows duplicate source/target pairs (no uniqueness constraint on the pair)

### Example 4C: Bare junction table (no PK)

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<tags-table-id>',
    targetTableId: '<authors-table-id>',
    useCompositeKey: false,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    junctionTableName: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

// provision.junctionTableName === 'tag_authors'
// Junction table has: tag_id (FK), author_id (FK) -- no primary key
```

### Example 4D: Explicit junction table name

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<settings-table-id>',
    junctionTableName: 'project_setting_links',
    useCompositeKey: true,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    junctionTableName: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

// provision.junctionTableName === 'project_setting_links'
// provision.sourceFieldName === 'project_id'
// provision.targetFieldName === 'setting_id'
```

### Example 4E: Junction table with full security (grants + Safegres policy)

```ts
const grant_privileges = [
  ['select', '*'],
  ['insert', '*'],
  ['delete', '*'],
] as unknown as Record<string, unknown>;

const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<tasks-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: true,
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzAllowAll',
    policyPermissive: true,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    junctionTableName: true,
  },
}).execute();

// Junction table 'task_tags' with:
// - Composite PK on (task_id, tag_id)
// - Grants: select/insert/delete for authenticated
// - Policy: AuthzAllowAll (public read/write)
```

### Example 4F: Junction table with DataEntityMembership and AuthzEntityMembership

For org-scoped junction tables where access is controlled by entity membership:

```ts
const grant_privileges = [
  ['select', '*'],
  ['insert', '*'],
  ['delete', '*'],
] as unknown as Record<string, unknown>;

const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<tasks-table-id>',
    useCompositeKey: false,
    nodeType: 'DataEntityMembership',
    nodeData: {
      entity_field_name: 'entity_id',
      include_id: false,
      include_user_fk: true,
    },
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzEntityMembership',
    policyData: {
      entity_field: 'entity_id',
      membership_type: 2,
    },
    policyPermissive: true,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    outSourceFieldId: true,
    outTargetFieldId: true,
    junctionTableName: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

const provision = res.createRelationProvision.relationProvision;
// provision.junctionTableName === 'project_tasks'
// Junction table has: entity_id, user_id (from DataEntityMembership),
//   project_id (FK), task_id (FK)
// RLS policy: AuthzEntityMembership bound to entity_id with org-level membership
```

### Example 4G: Use an existing table as the junction

If you already have a table and want to add FK fields to it:

```ts
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<tags-table-id>',
    junctionTableId: '<existing-table-id>',
    useCompositeKey: false,
  },
  select: {
    id: true,
    outJunctionTableId: true,
    outSourceFieldId: true,
    outTargetFieldId: true,
    sourceFieldName: true,
    targetFieldName: true,
  },
}).execute();

// provision.outJunctionTableId === '<existing-table-id>'  (same as input)
// FK fields project_id and tag_id are added to the existing table
```

---

## Verification via SDK

After provisioning a relation, you can verify the results using SDK queries.

### Verify the FK field was created (BelongsTo/HasMany/HasOne)

```ts
const field_res = await db.field.findOne({
  id: provision.outFieldId,
  select: { id: true, name: true, type: true, isRequired: true, tableId: true },
}).execute();

const field = field_res.field;
// field.name === 'project_id'
// field.type === 'uuid'
// field.isRequired === true
```

### Verify FK constraint exists

```ts
const fk_res = await db.foreignKeyConstraint.findMany({
  where: {
    tableId: { equalTo: '<source-or-junction-table-id>' },
    refTableId: { equalTo: '<target-table-id>' },
  },
  select: { id: true, deleteAction: true, fieldIds: true },
}).execute();

const fks = fk_res.foreignKeyConstraints.nodes;
// fks.length >= 1
```

### Verify junction table (ManyToMany)

```ts
const table_res = await db.table.findOne({
  id: provision.outJunctionTableId,
  select: { id: true, name: true },
}).execute();

// table_res.table.name === 'project_tags'
```

### Verify unique constraint (HasOne)

```ts
const uniq_res = await db.uniqueConstraint.findMany({
  where: {
    tableId: { equalTo: '<source-table-id>' },
  },
  select: { id: true, fieldIds: true },
}).execute();

// At least one unique constraint containing the FK field
```

### Verify grants on junction table (ManyToMany)

```ts
const grants_res = await db.tableGrant.findMany({
  where: { tableId: { equalTo: provision.outJunctionTableId } },
  select: { id: true, privilege: true, roleName: true },
}).execute();

const grants = grants_res.tableGrants.nodes;
// Verify expected privileges (select, insert, delete) for 'authenticated'
```

### Verify policies on junction table (ManyToMany)

```ts
const policies_res = await db.policy.findMany({
  where: { tableId: { equalTo: provision.outJunctionTableId } },
  select: { id: true, policyType: true, permissive: true, data: true },
}).execute();

const policies = policies_res.policies.nodes;
// policies[0].policyType === 'AuthzEntityMembership' (or whatever you set)
```

---

## ManyToMany + Security: deep dive

This section answers the most common questions about how `RelationManyToMany` integrates with security. If you are creating a junction table with RLS policies, read this carefully.

### How the trigger works internally (two-pass secure_table_provision)

When you call `relationProvision.create` with `relationType: 'RelationManyToMany'`, the trigger performs these steps **in order**:

1. **Pass 1 — bare table creation:** Inserts into `secureTableProvision` with **only** `databaseId`, `schemaId`, and `tableName`. This creates (or finds) a bare table with no fields, no grants, no policies.
2. **FK fields:** Creates `source_field` and `target_field` on the junction table (e.g., `project_id`, `tag_id`), each with a CASCADE FK.
3. **Composite PK** (if `useCompositeKey: true`): Creates a composite primary key from the two FK fields.
4. **Pass 2 — security forwarding:** Inserts into `secureTableProvision` again, this time forwarding **all** security config as-is: `nodeType`, `nodeData`, `grantRoles`, `grantPrivileges`, `policyType`, `policyData`, `policyPermissive`, `policyPrivileges`, `policyRole`.

**Key insight:** The trigger **never injects** values you did not provide. If you omit `nodeType`, no Data\* module runs. If you omit `policyType`, no RLS policy is created. The only implicit defaults are `grantRoles: ['authenticated']` and `grantPrivileges: [select/insert/delete for *]`.

### Does nodeType auto-create fields on the junction table?

**Yes.** When you pass `nodeType` (e.g., `'DataDirectOwner'`, `'DataEntityMembership'`), the second `secureTableProvision` insert runs the generator, which creates the corresponding fields on the junction table automatically. You do **not** need a separate `secureTableProvision` call.

The most common Data\* modules used on junction tables:

| nodeType | Key fields added | Typical pairing |
|---|---|---|
| `'DataId'` | `id` (UUID PK) | Any |
| `'DataDirectOwner'` | `id`, `owner_id` | `AuthzDirectOwner` |
| `'DataEntityMembership'` | `id`, `entity_id` | `AuthzEntityMembership` |
| `null` (omitted) | No extra fields | Any (junction only has FK fields) |

For the **full reference** of all Data\* modules, their fields, `nodeData` options, and Authz\* compatibility, see the `blueprint-definition-format.md` reference in the `constructive-platform` skill.

> **Important:** Most Data\* modules create an `id` field by default. If you set `useCompositeKey: true`, do **not** also pass a `nodeType` that creates an `id` PK (like `DataId`, `DataDirectOwner`, etc.) -- that would create two conflicting primary keys. To suppress the `id` from a Data\* module, pass `nodeData: { include_id: false }`.

### Where does policyType go in the API call?

`policyType` is a **top-level field** on `relationProvision.create`, at the same level as `sourceTableId`, `targetTableId`, `useCompositeKey`, etc. It is **not** nested inside `nodeData` or any sub-object.

All security fields are top-level:

```ts
await db.relationProvision.create({
  data: {
    databaseId: '...',
    relationType: 'RelationManyToMany',
    sourceTableId: '...',       // top-level
    targetTableId: '...',       // top-level
    useCompositeKey: true,      // top-level
    grantRoles: ['authenticated'],     // top-level
    grantPrivileges: grant_privileges, // top-level
    policyType: 'AuthzAllowAll',       // top-level ← here
    policyPermissive: true,            // top-level
    policyData: {},                    // top-level
    nodeType: 'DataId',                // top-level
    nodeData: {},                      // top-level
  },
  // ...
});
```

### Does RelationManyToMany auto-enable RLS?

**Yes, conditionally.** The `secureTableProvision` trigger auto-enables RLS when `policyType` is provided. If you omit `policyType`, RLS is **not** enabled automatically. This means:
- If you pass `policyType: 'AuthzAllowAll'` → RLS is enabled, policy is created
- If you omit `policyType` → RLS is **not** enabled, no policy is created (grants still apply)

### How to choose junction table security based on parent table policies

The junction table's security should be **consistent** with (or more permissive than) the parent tables' policies. Here are the common patterns:

#### Pattern A: Both parents use `AuthzAllowAll` (public tables)

> **WARNING: `AuthzAllowAll` is almost never what you want** -- even for "public" tables. See the `constructive-safegres` skill for details. If you genuinely need a public junction (rare), this pattern applies. In most cases, prefer `AuthzDirectOwner` so you know who created each link.

Junction should also be `AuthzAllowAll`:

```ts
await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<posts-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: true,
    policyType: 'AuthzAllowAll',
    policyPermissive: true,
  },
  // ...
});
```

#### Pattern B: Both parents use `AuthzDirectOwner` (owner-scoped)

Junction should use `AuthzDirectOwner` with `nodeType: 'DataDirectOwner'` to add an `owner_id` field:

```ts
const grant_privileges = [
  ['select', '*'],
  ['insert', '*'],
  ['delete', '*'],
] as unknown as Record<string, unknown>;

await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<posts-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: false,
    nodeType: 'DataDirectOwner',
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzDirectOwner',
    policyData: { entity_field: 'owner_id' },
    policyPermissive: true,
  },
  // ...
});
// Junction table gets: id (PK), owner_id, post_id (FK), tag_id (FK)
// RLS policy: owner_id = current_user_id()
```

#### Pattern C: Both parents use `AuthzEntityMembership` (org-scoped)

Junction should use `AuthzEntityMembership` with `nodeType: 'DataEntityMembership'` to add an `entity_id` field:

```ts
const grant_privileges = [
  ['select', '*'],
  ['insert', '*'],
  ['delete', '*'],
] as unknown as Record<string, unknown>;

await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<projects-table-id>',
    targetTableId: '<tasks-table-id>',
    useCompositeKey: false,
    nodeType: 'DataEntityMembership',
    nodeData: {
      entity_field_name: 'entity_id',
      include_id: false,
      include_user_fk: true,
    },
    grantRoles: ['authenticated'],
    grantPrivileges: grant_privileges,
    policyType: 'AuthzEntityMembership',
    policyData: {
      entity_field: 'entity_id',
      membership_type: 2,
    },
    policyPermissive: true,
  },
  // ...
});
// Junction table gets: entity_id, user_id, project_id (FK), task_id (FK)
// RLS policy: entity-scoped org membership
```

#### Pattern D: Mixed parent policies (one public, one owner-scoped)

Use the **more restrictive** parent's policy on the junction. If posts use `AuthzDirectOwner` and tags use `AuthzAllowAll`, the junction should use `AuthzDirectOwner` (the person creating the link must own it).

> **Do not default to `AuthzAllowAll` on the junction just because one parent is public.** The junction controls who can create/delete links. If any parent has scoped security, the junction should be at least as restrictive.

```ts
await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<posts-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: false,
    nodeType: 'DataDirectOwner',
    policyType: 'AuthzDirectOwner',
    policyData: { entity_field: 'owner_id' },
    policyPermissive: true,
  },
  // ...
});
```

### Layering additional security after creation

`RelationManyToMany` forwards security in a single `secureTableProvision` INSERT, which means **one** policy. If you need multiple policies (e.g., owner can write + published content is public), use a follow-up `secureTableProvision` call on the junction table:

```ts
// Step 1: Create junction with owner policy
const res = await db.relationProvision.create({
  data: {
    databaseId: '<database-id>',
    relationType: 'RelationManyToMany',
    sourceTableId: '<posts-table-id>',
    targetTableId: '<tags-table-id>',
    useCompositeKey: false,
    nodeType: 'DataDirectOwner',
    policyType: 'AuthzDirectOwner',
    policyData: { entity_field: 'owner_id' },
  },
  select: { outJunctionTableId: true },
}).execute();

const junction_table_id = res.createRelationProvision.relationProvision.outJunctionTableId;

// Step 2: Add a second permissive policy (public read via AuthzAllowAll for select only)
await db.secureTableProvision.create({
  data: {
    databaseId: '<database-id>',
    tableId: junction_table_id,
    policyType: 'AuthzAllowAll',
    policyPermissive: true,
    policyPrivileges: ['select'],
    grantPrivileges: [] as unknown as Record<string, unknown>,
  },
  select: { id: true },
}).execute();
```

---

## FAQ: RelationManyToMany + Security

**Q: Do I need a separate `secureTableProvision` call before `relationProvision.create` to set up the junction table?**
A: **No.** `RelationManyToMany` handles everything internally. It creates the table AND forwards security config to `secureTableProvision` in the same trigger. One `relationProvision.create` call is sufficient for table creation + fields + grants + policy.

**Q: If I pass `nodeType: 'DataDirectOwner'`, does the junction automatically get an `owner_id` field?**
A: **Yes.** The `nodeType` is forwarded to `secureTableProvision`, which runs the generator. `DataDirectOwner` creates both `id` (PK) and `owner_id` fields on the junction table. No separate call needed.

**Q: Is `policyType` at the same level as `sourceTableId`/`targetTableId`?**
A: **Yes.** All security fields (`policyType`, `policyData`, `policyPermissive`, `policyPrivileges`, `policyRole`, `nodeType`, `nodeData`, `grantRoles`, `grantPrivileges`) are **top-level** fields on `relationProvision.create`, at the same nesting level as `sourceTableId` and `targetTableId`.

**Q: What happens if I omit `policyType`?**
A: No RLS policy is created and RLS is **not** auto-enabled. The junction table still gets default grants (`select/insert/delete` for `authenticated`) but has no row-level security. This is fine for simple junction tables where the parent tables handle access control and the junction just needs basic CRUD.

**Q: What happens if I omit `nodeType`?**
A: No Data\* module runs. The junction table only gets the FK fields (and optionally a composite PK). No `id`, no `owner_id`, no `entity_id` — just the bare FK columns.

**Q: Can I use `useCompositeKey: true` with `nodeType: 'DataDirectOwner'`?**
A: **Not recommended.** `DataDirectOwner` creates an `id` PK, and `useCompositeKey` creates a composite PK from the FK fields. Two PKs conflict. If you need owner tracking with a composite key, use `useCompositeKey: true` and add the `owner_id` field manually via a separate `secureTableProvision` call with `nodeData: { include_id: false }`.

**Q: How do I know which `policyType` to use for my junction table?**
A: Match the parent tables' security pattern. See the "How to choose junction table security" section above. Rule of thumb: use the **same or more restrictive** policy as the parent tables.

**Q: Can I add more policies to the junction table later?**
A: **Yes.** Use `secureTableProvision.create` with the junction table's `tableId` (from `outJunctionTableId`) to layer additional policies, grants, or fields after the initial `relationProvision.create`.

---

## Quick reference: delete action codes

| Code | Behavior | When to use |
|---|---|---|
| `'r'` | RESTRICT | Prevent deletion of parent if children exist |
| `'c'` | CASCADE | Delete children when parent is deleted |
| `'n'` | SET NULL | Set FK to NULL when parent is deleted (requires `isRequired: false`) |
| `'d'` | SET DEFAULT | Set FK to default when parent is deleted |
| `'a'` | NO ACTION | Similar to RESTRICT (checked at end of transaction) |

---

## Decision guide: which relation type to use

1. **"Table A references Table B (many A to one B)"** -> `RelationBelongsTo` (FK on A) or `RelationHasMany` (same FK, declared from B's perspective)
2. **"Table A has exactly one related row in Table B"** -> `RelationHasOne` (FK + unique on A)
3. **"Table A and Table B have a many-to-many relationship"** -> `RelationManyToMany` (creates junction table)

### ManyToMany PK strategy decision

1. **Simple link table, no extra data** -> `useCompositeKey: true` (enforces unique pairs, no extra columns)
2. **Junction rows need their own identity** (e.g., for audit trails, soft delete, or additional fields) -> `useCompositeKey: false` + `nodeType: 'DataId'`
3. **Junction rows need entity-scoped security** -> `useCompositeKey: false` + `nodeType: 'DataEntityMembership'` + `policyType: 'AuthzEntityMembership'`

---

## Common mistakes

1. **Omitting `deleteAction` for BelongsTo/HasOne/HasMany** -> raises an error. There is no default; you must explicitly choose.
2. **Combining `useCompositeKey: true` with `nodeType: 'DataId'`** -> creates two conflicting primary keys. Choose one.
3. **Setting `deleteAction` for ManyToMany** -> ignored. Junction FKs always CASCADE.
4. **Using `fieldName` for ManyToMany** -> ignored. Use `sourceFieldName` and `targetFieldName` instead.
5. **Forgetting `isRequired: false` with `deleteAction: 'n'`** -> SET NULL requires a nullable field.
6. **Setting security fields (grantRoles, policyType, etc.) for BelongsTo/HasOne/HasMany** -> ignored. Security config only applies to ManyToMany junction tables.
