---
name: constructive-sdk-tables
description: Create and manage tables in Constructive using the type-safe SDK. Use when asked to "create a table", "define a table schema", "configure table settings", or when working with metaschema_public.table operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Table Management

Create and manage tables in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Creating a new table in a schema
- Configuring table settings (RLS, timestamps, peoplestamps)
- Setting table metadata (labels, descriptions, smart tags)
- Managing table categories (core, module, app)
- Working with the `metaschema_public.table` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Table Schema

The `metaschema_public.table` table stores table metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `schemaId` | uuid | Parent schema ID |
| `name` | text | Table name (unique per database) |
| `label` | text | Human-readable label |
| `description` | text | Table description |
| `smartTags` | jsonb | PostGraphile smart tags |
| `category` | object_category | 'core', 'module', or 'app' |
| `module` | text | Module that created this table |
| `scope` | int | Membership scope (1=app, 2=org, 3=group) |
| `useRls` | boolean | Enable Row-Level Security |
| `timestamps` | boolean | Add created_at/updated_at |
| `peoplestamps` | boolean | Add created_by/updated_by |
| `pluralName` | text | Custom plural inflection |
| `singularName` | text | Custom singular inflection |
| `tags` | citext[] | Searchable tags |
| `inheritsId` | uuid | Parent table for inheritance |

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

## Creating a Table

### Basic Table Creation

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'products',
    label: 'Products',
    description: 'Product catalog',
  },
  select: {
    id: true,
    name: true,
    label: true,
  },
}).execute();

if (result.ok) {
  const table = result.data.createTable.table;
  console.log('Created table:', table.id);
  console.log('Name:', table.name);
} else {
  console.error('Failed to create table:', result.errors);
}
```

### Table with RLS and Timestamps

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'orders',
    label: 'Orders',
    description: 'Customer orders',
    useRls: true,
    timestamps: true,
    peoplestamps: true,
  },
  select: {
    id: true,
    name: true,
    useRls: true,
    timestamps: true,
    peoplestamps: true,
  },
}).execute();

if (result.ok) {
  const table = result.data.createTable.table;
  console.log('Created table with RLS:', table.useRls);
  // Triggers will auto-add: created_at, updated_at, created_by, updated_by
}
```

### Table with Smart Tags

Smart tags control PostGraphile behavior:

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'audit_logs',
    label: 'Audit Logs',
    smartTags: {
      omit: 'create,update,delete',  // Read-only via GraphQL
      behavior: '+connection -list',  // Connection only, no list
    },
  },
  select: {
    id: true,
    name: true,
    smartTags: true,
  },
}).execute();
```

### Common Smart Tags

| Tag | Description |
|-----|-------------|
| `@omit` | Hide from GraphQL (create, update, delete, all) |
| `@behavior` | Control query types (+connection, -list, etc.) |
| `@name` | Override GraphQL type name |
| `@foreignKey` | Configure foreign key behavior |
| `@unique` | Mark as unique constraint |

### Table with Custom Inflection

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'person',
    label: 'Person',
    pluralName: 'people',
    singularName: 'person',
  },
  select: {
    id: true,
    name: true,
    pluralName: true,
    singularName: true,
  },
}).execute();
```

### Module Table

Tables created by modules have category and module set:

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'user_settings',
    label: 'User Settings',
    category: 'module',
    module: 'user_settings_module',
    scope: 1,  // App-level
  },
  select: {
    id: true,
    name: true,
    category: true,
    module: true,
  },
}).execute();
```

### Table Inheritance

Create a table that inherits from another:

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'premium_products',
    label: 'Premium Products',
    inheritsId: productsTableId,  // Inherits from products table
  },
  select: {
    id: true,
    name: true,
    inheritsId: true,
  },
}).execute();
```

## Querying Tables

### Find All Tables in a Schema

```typescript
const result = await db.table.findMany({
  select: {
    id: true,
    name: true,
    label: true,
    useRls: true,
    timestamps: true,
    category: true,
  },
  where: {
    schemaId: { equalTo: schemaId },
  },
  orderBy: ['NAME_ASC'],
}).execute();

if (result.ok) {
  const tables = result.data.tables.nodes;
  tables.forEach(t => {
    console.log(`${t.name}: RLS=${t.useRls}, category=${t.category}`);
  });
}
```

### Find Table with Fields

```typescript
const result = await db.table.findFirst({
  select: {
    id: true,
    name: true,
    label: true,
    fields: {
      nodes: {
        id: true,
        name: true,
        type: true,
        isRequired: true,
      },
    },
  },
  where: {
    name: { equalTo: 'products' },
    databaseId: { equalTo: databaseId },
  },
}).execute();

if (result.ok && result.data.tables.nodes.length > 0) {
  const table = result.data.tables.nodes[0];
  console.log(`Table ${table.name} has ${table.fields.nodes.length} fields`);
  table.fields.nodes.forEach(f => {
    console.log(`  - ${f.name}: ${f.type}${f.isRequired ? ' NOT NULL' : ''}`);
  });
}
```

### Find Table with Constraints

```typescript
const result = await db.table.findFirst({
  select: {
    id: true,
    name: true,
    checkConstraints: {
      nodes: {
        id: true,
        name: true,
        expr: true,
      },
    },
    foreignKeyConstraints: {
      nodes: {
        id: true,
        name: true,
        refTable: {
          name: true,
        },
      },
    },
  },
  where: {
    id: { equalTo: tableId },
  },
}).execute();
```

### Find Tables by Category

```typescript
const result = await db.table.findMany({
  select: {
    id: true,
    name: true,
    module: true,
  },
  where: {
    databaseId: { equalTo: databaseId },
    category: { equalTo: 'module' },
  },
}).execute();

if (result.ok) {
  const moduleTables = result.data.tables.nodes;
  console.log('Module tables:', moduleTables.map(t => t.name));
}
```

## Updating a Table

```typescript
const result = await db.table.update({
  where: { id: tableId },
  data: {
    label: 'Updated Label',
    description: 'Updated description',
    useRls: true,
  },
  select: {
    id: true,
    label: true,
    useRls: true,
  },
}).execute();

if (result.ok) {
  console.log('Updated table:', result.data.updateTable.table);
}
```

### Enable Timestamps on Existing Table

```typescript
const result = await db.table.update({
  where: { id: tableId },
  data: {
    timestamps: true,
    peoplestamps: true,
  },
  select: {
    id: true,
    timestamps: true,
    peoplestamps: true,
  },
}).execute();
```

## Deleting a Table

```typescript
const result = await db.table.delete({
  where: { id: tableId },
}).execute();

if (result.ok) {
  console.log('Deleted table:', result.data.deleteTable.table.id);
}
```

**Warning**: Deleting a table cascades to all fields, constraints, policies, and indexes.

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available:

```json
{
  "operation": "mutation",
  "model": "table",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "schemaId": "schema-uuid",
    "name": "products",
    "label": "Products",
    "useRls": true,
    "timestamps": true
  },
  "select": {
    "id": true,
    "name": true,
    "useRls": true
  }
}
```

## Table Categories

| Category | Description | Example |
|----------|-------------|---------|
| `core` | System tables | users, memberships |
| `module` | Module-generated tables | user_auth, permissions |
| `app` | User-defined tables | products, orders |

## Table Triggers

When tables are created/updated, triggers automatically:
- Create the physical PostgreSQL table
- Add timestamp columns if `timestamps: true`
- Add peoplestamp columns if `peoplestamps: true`
- Enable RLS if `useRls: true`
- Apply smart tags to PostGraphile

## Best Practices

1. **Use meaningful names** - Table names should be snake_case and descriptive
2. **Enable RLS for user data** - Always use RLS for tables with user-specific data
3. **Use timestamps** - Enable timestamps for audit trails
4. **Set categories correctly** - Use 'app' for user tables, 'module' for generated
5. **Document with labels** - Add labels and descriptions for clarity
6. **Use smart tags sparingly** - Only when needed for GraphQL customization

## Error Handling

```typescript
const result = await db.table.create({
  data: {
    databaseId: databaseId,
    schemaId: schemaId,
    name: 'products',  // Already exists!
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

- Related skill: [`constructive-sdk-fields`](../constructive-sdk-fields) for field management
- Related skill: [`constructive-sdk-indexes`](../constructive-sdk-indexes) for adding indexes to table columns
- Related skill: [`constructive-sdk-search`](../constructive-sdk-search) for adding search capabilities to tables (full-text, BM25, vector, trigram)
- Related skill: [`constructive-sdk-constraints`](../constructive-sdk-constraints) for constraint management
- Related skill: [`constructive-sdk-security`](../constructive-sdk-security) for RLS policies and grants
- Related skill: [`constructive-db-policies`](../constructive-db-policies) for RLS policy management (SQL-level)
- Related skill: [`constructive-sdk-database`](../constructive-sdk-database) for database management
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
