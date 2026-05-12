---
name: constructive-sdk-constraints
description: Create and manage constraints in Constructive using the type-safe SDK. Use when asked to "add a constraint", "create a foreign key", "add a check constraint", "define relationships", or when working with metaschema_public.check_constraint and foreign_key_constraint operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Constraint Management

Create and manage constraints (check constraints and foreign keys) in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Adding check constraints to validate data
- Creating foreign key relationships between tables
- Defining referential integrity rules
- Working with the `metaschema_public.check_constraint` and `metaschema_public.foreign_key_constraint` tables

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Check Constraint Schema

The `metaschema_public.check_constraint` table stores check constraint metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `tableId` | uuid | Parent table ID |
| `name` | text | Constraint name (unique per table) |
| `type` | text | Constraint type |
| `fieldIds` | uuid[] | Fields involved in constraint |
| `expr` | jsonb | Check expression as AST |
| `smartTags` | jsonb | PostGraphile smart tags |
| `category` | object_category | 'core', 'module', or 'app' |
| `module` | text | Module that created this constraint |
| `scope` | int | Membership scope |
| `tags` | citext[] | Searchable tags |

## Foreign Key Constraint Schema

The `metaschema_public.foreign_key_constraint` table stores foreign key metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `tableId` | uuid | Source table ID |
| `name` | text | Constraint name (unique per table) |
| `description` | text | Constraint description |
| `type` | text | Constraint type |
| `fieldIds` | uuid[] | Source field IDs |
| `refTableId` | uuid | Referenced table ID |
| `refFieldIds` | uuid[] | Referenced field IDs |
| `deleteAction` | char(1) | ON DELETE action |
| `updateAction` | char(1) | ON UPDATE action |
| `smartTags` | jsonb | PostGraphile smart tags |
| `category` | object_category | 'core', 'module', or 'app' |
| `module` | text | Module that created this constraint |
| `scope` | int | Membership scope |
| `tags` | citext[] | Searchable tags |

## SDK Client Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'https://api.constructive.io/graphql',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});
```

## Creating Check Constraints

### Basic Check Constraint

```typescript
const result = await db.checkConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'price_positive',
    fieldIds: [priceFieldId],
    expr: {
      A_Expr: {
        kind: 'AEXPR_OP',
        name: [{ String: { sval: '>' } }],
        lexpr: { ColumnRef: { fields: [{ String: { sval: 'price' } }] } },
        rexpr: { A_Const: { ival: { ival: 0 } } },
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();

if (result.ok) {
  const constraint = result.data.createCheckConstraint.checkConstraint;
  console.log('Created check constraint:', constraint.name);
} else {
  console.error('Failed to create constraint:', result.errors);
}
```

This creates: `CHECK (price > 0)`

### String Length Constraint

```typescript
const result = await db.checkConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'title_length',
    fieldIds: [titleFieldId],
    expr: {
      A_Expr: {
        kind: 'AEXPR_OP',
        name: [{ String: { sval: '<=' } }],
        lexpr: {
          FuncCall: {
            funcname: [{ String: { sval: 'character_length' } }],
            args: [{ ColumnRef: { fields: [{ String: { sval: 'title' } }] } }],
          },
        },
        rexpr: { A_Const: { ival: { ival: 255 } } },
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

This creates: `CHECK (character_length(title) <= 255)`

### Range Constraint

```typescript
const result = await db.checkConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'quantity_range',
    fieldIds: [quantityFieldId],
    expr: {
      BoolExpr: {
        boolop: 'AND_EXPR',
        args: [
          {
            A_Expr: {
              kind: 'AEXPR_OP',
              name: [{ String: { sval: '>=' } }],
              lexpr: { ColumnRef: { fields: [{ String: { sval: 'quantity' } }] } },
              rexpr: { A_Const: { ival: { ival: 0 } } },
            },
          },
          {
            A_Expr: {
              kind: 'AEXPR_OP',
              name: [{ String: { sval: '<=' } }],
              lexpr: { ColumnRef: { fields: [{ String: { sval: 'quantity' } }] } },
              rexpr: { A_Const: { ival: { ival: 1000 } } },
            },
          },
        ],
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

This creates: `CHECK (quantity >= 0 AND quantity <= 1000)`

### Enum-like Constraint

```typescript
const result = await db.checkConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'status_values',
    fieldIds: [statusFieldId],
    expr: {
      A_Expr: {
        kind: 'AEXPR_IN',
        name: [{ String: { sval: '=' } }],
        lexpr: { ColumnRef: { fields: [{ String: { sval: 'status' } }] } },
        rexpr: {
          List: {
            items: [
              { A_Const: { sval: { sval: 'draft' } } },
              { A_Const: { sval: { sval: 'published' } } },
              { A_Const: { sval: { sval: 'archived' } } },
            ],
          },
        },
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

This creates: `CHECK (status IN ('draft', 'published', 'archived'))`

## Creating Foreign Key Constraints

### Basic Foreign Key

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: ordersTableId,
    name: 'orders_customer_fkey',
    fieldIds: [customerIdFieldId],
    refTableId: customersTableId,
    refFieldIds: [customersIdFieldId],
    deleteAction: 'c',  // CASCADE
    updateAction: 'a',  // NO ACTION
  },
  select: {
    id: true,
    name: true,
    deleteAction: true,
  },
}).execute();

if (result.ok) {
  const fk = result.data.createForeignKeyConstraint.foreignKeyConstraint;
  console.log('Created foreign key:', fk.name);
} else {
  console.error('Failed to create foreign key:', result.errors);
}
```

### Foreign Key Actions

| Code | Action | Description |
|------|--------|-------------|
| `a` | NO ACTION | Raise error if referenced row exists |
| `r` | RESTRICT | Same as NO ACTION (checked immediately) |
| `c` | CASCADE | Delete/update referencing rows |
| `n` | SET NULL | Set referencing columns to NULL |
| `d` | SET DEFAULT | Set referencing columns to default |

### Foreign Key with SET NULL

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: postsTableId,
    name: 'posts_author_fkey',
    fieldIds: [authorIdFieldId],
    refTableId: usersTableId,
    refFieldIds: [usersIdFieldId],
    deleteAction: 'n',  // SET NULL - keep posts when user deleted
    updateAction: 'c',  // CASCADE - update if user ID changes
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Composite Foreign Key

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: orderItemsTableId,
    name: 'order_items_product_variant_fkey',
    fieldIds: [productIdFieldId, variantIdFieldId],
    refTableId: productVariantsTableId,
    refFieldIds: [pvProductIdFieldId, pvVariantIdFieldId],
    deleteAction: 'r',  // RESTRICT
    updateAction: 'c',  // CASCADE
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Foreign Key with Smart Tags

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: ordersTableId,
    name: 'orders_customer_fkey',
    fieldIds: [customerIdFieldId],
    refTableId: customersTableId,
    refFieldIds: [customersIdFieldId],
    deleteAction: 'c',
    updateAction: 'a',
    smartTags: {
      foreignFieldName: 'customer',
      foreignSimpleFieldName: 'customerId',
    },
  },
  select: {
    id: true,
    name: true,
    smartTags: true,
  },
}).execute();
```

## Querying Constraints

### Find Check Constraints for a Table

```typescript
const result = await db.checkConstraint.findMany({
  select: {
    id: true,
    name: true,
    expr: true,
    fieldIds: true,
  },
  where: {
    tableId: { equalTo: tableId },
  },
}).execute();

if (result.ok) {
  const constraints = result.data.checkConstraints.nodes;
  constraints.forEach(c => {
    console.log(`${c.name}: ${JSON.stringify(c.expr)}`);
  });
}
```

### Find Foreign Keys for a Table

```typescript
const result = await db.foreignKeyConstraint.findMany({
  select: {
    id: true,
    name: true,
    deleteAction: true,
    updateAction: true,
    refTable: {
      id: true,
      name: true,
    },
  },
  where: {
    tableId: { equalTo: tableId },
  },
}).execute();

if (result.ok) {
  const fks = result.data.foreignKeyConstraints.nodes;
  fks.forEach(fk => {
    console.log(`${fk.name} -> ${fk.refTable.name}`);
  });
}
```

### Find All Constraints Referencing a Table

```typescript
const result = await db.foreignKeyConstraint.findMany({
  select: {
    id: true,
    name: true,
    table: {
      name: true,
    },
  },
  where: {
    refTableId: { equalTo: tableId },
  },
}).execute();

if (result.ok) {
  const refs = result.data.foreignKeyConstraints.nodes;
  console.log(`Tables referencing this table:`);
  refs.forEach(fk => {
    console.log(`  - ${fk.table.name} via ${fk.name}`);
  });
}
```

## Updating Constraints

### Update Check Constraint

```typescript
const result = await db.checkConstraint.update({
  where: { id: constraintId },
  data: {
    name: 'updated_constraint_name',
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Update Foreign Key Actions

```typescript
const result = await db.foreignKeyConstraint.update({
  where: { id: fkId },
  data: {
    deleteAction: 'n',  // Change to SET NULL
  },
  select: {
    id: true,
    name: true,
    deleteAction: true,
  },
}).execute();
```

## Deleting Constraints

### Delete Check Constraint

```typescript
const result = await db.checkConstraint.delete({
  where: { id: constraintId },
}).execute();

if (result.ok) {
  console.log('Deleted constraint:', result.data.deleteCheckConstraint.checkConstraint.id);
}
```

### Delete Foreign Key

```typescript
const result = await db.foreignKeyConstraint.delete({
  where: { id: fkId },
}).execute();

if (result.ok) {
  console.log('Deleted foreign key:', result.data.deleteForeignKeyConstraint.foreignKeyConstraint.id);
}
```

## JSON Dialect (Select JSON)

### Create Check Constraint

```json
{
  "operation": "mutation",
  "model": "checkConstraint",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "tableId": "table-uuid",
    "name": "price_positive",
    "fieldIds": ["field-uuid"],
    "expr": {
      "A_Expr": {
        "kind": "AEXPR_OP",
        "name": [{"String": {"sval": ">"}}],
        "lexpr": {"ColumnRef": {"fields": [{"String": {"sval": "price"}}]}},
        "rexpr": {"A_Const": {"ival": {"ival": 0}}}
      }
    }
  },
  "select": {
    "id": true,
    "name": true
  }
}
```

### Create Foreign Key

```json
{
  "operation": "mutation",
  "model": "foreignKeyConstraint",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "tableId": "orders-table-uuid",
    "name": "orders_customer_fkey",
    "fieldIds": ["customer-id-field-uuid"],
    "refTableId": "customers-table-uuid",
    "refFieldIds": ["customers-id-field-uuid"],
    "deleteAction": "c",
    "updateAction": "a"
  },
  "select": {
    "id": true,
    "name": true
  }
}
```

## Common Constraint Patterns

### Self-Referencing Foreign Key

For hierarchical data (e.g., categories with parent):

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: categoriesTableId,
    name: 'categories_parent_fkey',
    fieldIds: [parentIdFieldId],
    refTableId: categoriesTableId,  // Same table
    refFieldIds: [categoriesIdFieldId],
    deleteAction: 'n',  // SET NULL when parent deleted
    updateAction: 'c',
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Mutual Exclusion Constraint

Ensure only one of two fields is set:

```typescript
const result = await db.checkConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'one_reference_only',
    fieldIds: [apiIdFieldId, siteIdFieldId],
    expr: {
      BoolExpr: {
        boolop: 'OR_EXPR',
        args: [
          {
            BoolExpr: {
              boolop: 'AND_EXPR',
              args: [
                { NullTest: { arg: { ColumnRef: { fields: [{ String: { sval: 'api_id' } }] } }, nulltesttype: 'IS_NULL' } },
                { NullTest: { arg: { ColumnRef: { fields: [{ String: { sval: 'site_id' } }] } }, nulltesttype: 'IS_NOT_NULL' } },
              ],
            },
          },
          {
            BoolExpr: {
              boolop: 'AND_EXPR',
              args: [
                { NullTest: { arg: { ColumnRef: { fields: [{ String: { sval: 'api_id' } }] } }, nulltesttype: 'IS_NOT_NULL' } },
                { NullTest: { arg: { ColumnRef: { fields: [{ String: { sval: 'site_id' } }] } }, nulltesttype: 'IS_NULL' } },
              ],
            },
          },
        ],
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

## Best Practices

1. **Name constraints descriptively** - Use `{table}_{field}_chk` or `{table}_{field}_fkey`
2. **Use CASCADE carefully** - Understand the implications of cascading deletes
3. **Prefer RESTRICT for critical data** - Prevent accidental deletions
4. **Document constraints** - Add descriptions for complex constraints
5. **Test constraint violations** - Verify constraints work as expected
6. **Consider performance** - Complex check constraints can slow inserts/updates

## Error Handling

```typescript
const result = await db.foreignKeyConstraint.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'existing_fkey',  // Already exists!
    fieldIds: [fieldId],
    refTableId: refTableId,
    refFieldIds: [refFieldId],
    deleteAction: 'c',
    updateAction: 'a',
  },
  select: { id: true },
}).execute();

if (!result.ok) {
  result.errors.forEach(error => {
    console.error(`Error: ${error.message}`);
    // "duplicate key value violates unique constraint"
  });
}
```

## References

- Related skill: [`constructive-sdk-tables`](../constructive-sdk-tables) for table management
- Related skill: [`constructive-sdk-fields`](../constructive-sdk-fields) for field management and type-level validation (`min`/`max`/`regexp`)
- Related skill: [`constructive-sdk-indexes`](../constructive-sdk-indexes) for unique indexes (an alternative to unique constraints)
- Related skill: [`constructive-db-policies`](../constructive-db-policies) for RLS policy management
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
