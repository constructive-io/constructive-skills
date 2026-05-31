---
name: constructive-data-modeling
description: "Tables, fields, relations, constraints, indexes, enums, and database provisioning via the type-safe SDK. Use when asked to 'create a table', 'add a field', 'add a column', 'create a relation', 'add a constraint', 'add an index', 'create a foreign key', 'define field types', 'provision a database', 'create an enum', 'api_required', or when working with metaschema_public operations."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Data Modeling

Tables, fields, relations, constraints, and indexes — the full schema lifecycle via the type-safe SDK. Everything compiles to PostgreSQL DDL through Constructive's metaschema layer.

## When to Apply

Use this skill when:
- Creating tables, fields, relations, constraints, or indexes via the SDK
- Provisioning databases with module selection
- Defining enum types
- Configuring field validation (regexp, min, max)
- Setting `api_required` on nullable FK columns
- Understanding the composition: table → fields → constraints → indexes → relations → security

## The Composition Flow

```
1. Provision database  → db.databaseProvisionModule.create({ modules: ['all'] })
2. Create table        → db.secureTableProvision.create({ tableName, nodeType, ... })
3. Add fields          → db.field.create({ tableId, name, type, ... })
4. Add constraints     → db.checkConstraint.create / db.foreignKeyConstraint.create
5. Add indexes         → db.index.create({ tableId, fieldIds, ... })
6. Add relations       → db.relationProvision.create({ fromTableId, toTableId, ... })
7. Apply security      → see constructive-security skill
```

## Database Provisioning

```typescript
const result = await db.databaseProvisionModule.create({
  data: {
    databaseName: 'my-app',
    ownerId: userId,
    subdomain: 'my-app',
    domain: 'localhost',
    modules: ['all'],
    bootstrapUser: true,
  },
  select: { id: true, databaseId: true, status: true },
}).execute();
```

See [provisioning.md](./references/provisioning.md) for the full provisioning flow.

## Tables

Create tables via `secureTableProvision` (recommended) or `db.table.create`:

```typescript
await db.secureTableProvision.create({
  data: {
    databaseId,
    tableName: 'projects',
    nodeType: 'DataEntityMembership',
    useRls: true,
    grantRoles: ['authenticated'],
    grantPrivileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] as unknown as Record<string, unknown>,
    policyType: 'AuthzEntityMembership',
    policyPermissive: true,
    policyData: { entity_field: 'entity_id', membership_type: 2 },
  },
  select: { id: true, tableId: true, outFields: true },
}).execute();
```

For full table management operations, see the generated `orm-*` skills in `constructive-db`.

## Fields

```typescript
await db.field.create({
  data: {
    databaseId,
    tableId,
    name: 'status',
    type: { name: 'project_status' },  // enum type
    defaultValue: { value: 'draft' },
    isRequired: true,
  },
  select: { id: true },
}).execute();
```

Field types include: `text`, `integer`, `bigint`, `boolean`, `uuid`, `jsonb`, `timestamptz`, `date`, `numeric`, `citext`, `ltree`, `vector(N)`, and custom enums.

See [field-types.md](./references/field-types.md) for the complete type reference.

## Enum Types

```typescript
await db.enum.create({
  data: {
    databaseId,
    schemaName: 'app_public',
    name: 'project_status',
    values: ['draft', 'active', 'archived'],
  },
  select: { id: true, name: true, values: true },
}).execute();
```

## Relations

Four relation types via `db.relationProvision.create`:

| Type | Description |
|------|-------------|
| `BelongsTo` | FK on source → target PK (default) |
| `HasMany` | FK on target → source PK |
| `HasOne` | FK on target → source PK (unique) |
| `ManyToMany` | Junction table auto-created |

```typescript
await db.relationProvision.create({
  data: {
    databaseId,
    fromTableId: projectsTableId,
    toTableId: organizationsTableId,
    fromFieldName: 'organization_id',
    apiRequired: true,
    cascadeDelete: 'no_action',
  },
  select: { id: true },
}).execute();
```

## Constraints

Check constraints and foreign keys via `db.checkConstraint.create` and `db.foreignKeyConstraint.create`.

## Indexes

```typescript
await db.index.create({
  data: {
    databaseId,
    tableId,
    fieldIds: [fieldId],
    isUnique: true,
    accessMethod: 'btree',  // or 'gin', 'gist', 'hash'
  },
  select: { id: true },
}).execute();
```

## `api_required` (Required API Fields)

For nullable FK columns that should be required at the GraphQL API level:

```typescript
await db.field.update({
  where: { id: fieldId },
  data: { apiRequired: true },
  select: { id: true },
}).execute();
```

## References

| File | Content |
|------|---------|
| [field-types.md](./references/field-types.md) | Complete field type reference |
| [provisioning.md](./references/provisioning.md) | Full database provisioning flow |

## Cross-References

- **Security (RLS, grants, policies):** [`constructive-security`](../constructive-security/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Generated ORM API:** [`constructive-orm`](../constructive-orm/SKILL.md)
- **Code generation pipeline:** [`constructive-codegen`](../constructive-codegen/SKILL.md)
