---
name: constructive-sdk-fields
description: Create and manage fields (columns) in Constructive using the type-safe SDK. Use when asked to "add a field", "create a column", "define field types", "set field constraints", or when working with metaschema_public.field operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Field Management

Create and manage fields (columns) in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Adding fields to a table
- Configuring field types and constraints
- Setting default values
- Managing field validation (regexp, min, max)
- Working with the `metaschema_public.field` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Field Schema

The `metaschema_public.field` table stores field metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `tableId` | uuid | Parent table ID |
| `name` | text | Field name (unique per table) |
| `label` | text | Human-readable label |
| `description` | text | Field description |
| `type` | citext | PostgreSQL type (text, int, uuid, etc.) |
| `isRequired` | boolean | NOT NULL constraint |
| `defaultValue` | text | Default value expression |
| `defaultValueAst` | jsonb | Default value as AST |
| `isHidden` | boolean | Hide from GraphQL API |
| `smartTags` | jsonb | PostGraphile smart tags |
| `fieldOrder` | int | Display order |
| `regexp` | text | Regex validation pattern |
| `chk` | jsonb | Check constraint definition |
| `chkExpr` | jsonb | Check constraint AST |
| `min` | float | Minimum value |
| `max` | float | Maximum value |
| `category` | object_category | 'core', 'module', or 'app' |
| `module` | text | Module that created this field |
| `scope` | int | Membership scope (1=app, 2=org, 3=group) |
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

## Creating Fields

> **Field-shape contract — this is the `metaschema_public.field` API, not the blueprint.**
> On `db.field.create`/`db.field.update`, `type` is a **bare string** (`type: 'text'`, `type: 'numeric(10,2)'`) and `defaultValue` is a **SQL-expression string** (`defaultValue: "'draft'"`, `'uuid_generate_v4()'`). This matches the generated `CreateFieldInput` (`type: string`, `defaultValue?: string`) — do **not** wrap them in objects here.
>
> A **blueprint** field node (the `createBlueprint`/`constructBlueprint` GraphQL mutation in the provisioning APIs, `modules.localhost`) uses the **object** form instead — `type: { name: 'text' }` / `{ name: 'boolean' }` with `default: { value: false }` — and is **not** the same call as this SDK. Use the object shape only in a blueprint definition; use the bare-string shape (below) for the field SDK. The `secureTableProvision` `fields[]` array (see `constructive-sdk-security`) is a third shape again: bare-string `type` + snake_case keys (`{ name: 'title', type: 'text', is_required: true }`).

### Basic Field Creation

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'title',
    label: 'Title',
    type: 'text',
    isRequired: true,
  },
  select: {
    id: true,
    name: true,
    type: true,
    isRequired: true,
  },
}).execute();

if (result.ok) {
  const field = result.data.createField.field;
  console.log('Created field:', field.name);
  console.log('Type:', field.type);
} else {
  console.error('Failed to create field:', result.errors);
}
```

### Field with Default Value

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'status',
    label: 'Status',
    type: 'text',
    isRequired: true,
    defaultValue: "'draft'",  // SQL expression with quotes
  },
  select: {
    id: true,
    name: true,
    defaultValue: true,
  },
}).execute();
```

### UUID Field with Auto-Generation

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'id',
    label: 'ID',
    type: 'uuid',
    isRequired: true,
    defaultValue: 'uuid_generate_v4()',
  },
  select: {
    id: true,
    name: true,
    type: true,
    defaultValue: true,
  },
}).execute();
```

### Numeric Field with Validation

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'price',
    label: 'Price',
    type: 'numeric(10,2)',
    isRequired: true,
    min: 0,
    max: 999999.99,
  },
  select: {
    id: true,
    name: true,
    type: true,
    min: true,
    max: true,
  },
}).execute();
```

### Text Field with Regex Validation

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'email',
    label: 'Email Address',
    type: 'citext',
    isRequired: true,
    regexp: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
  },
  select: {
    id: true,
    name: true,
    regexp: true,
  },
}).execute();
```

### Foreign Key Field

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: ordersTableId,
    name: 'customer_id',
    label: 'Customer',
    type: 'uuid',
    isRequired: true,
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();

// Then create the foreign key constraint separately
// See constructive-sdk-constraints skill
```

### Hidden Field

Fields hidden from the GraphQL API:

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'internal_notes',
    label: 'Internal Notes',
    type: 'text',
    isHidden: true,
  },
  select: {
    id: true,
    name: true,
    isHidden: true,
  },
}).execute();
```

### Field with Smart Tags

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'password_hash',
    label: 'Password Hash',
    type: 'text',
    smartTags: {
      omit: true,  // Hide from all GraphQL operations
    },
  },
  select: {
    id: true,
    name: true,
    smartTags: true,
  },
}).execute();
```

### JSONB Field

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'metadata',
    label: 'Metadata',
    type: 'jsonb',
    defaultValue: "'{}'::jsonb",
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();
```

### Array Field

**Important**: Do NOT pass the SQL array syntax (e.g., `'text[]'`) as the `type` value. The `createField` mutation expects the base type combined with `isArray: true`. Passing `'text[]'` or `'citext[]'` as the type will fail with `Variable "$input" got invalid value` because the type validation (`pg_type_is_visible`) does not recognize the `[]` suffix.

```typescript
// CORRECT - use base type + isArray flag
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'tags',
    label: 'Tags',
    type: 'text',        // base type only, no []
    isArray: true,        // marks the column as an array type
    defaultValue: "'{}'::text[]",
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();

// WRONG - will fail with invalid value error
// type: 'text[]'   <-- do not use SQL array syntax
// type: 'citext[]' <-- do not use SQL array syntax
```

### Timestamp Field

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'published_at',
    label: 'Published At',
    type: 'timestamptz',
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();
```

## Common PostgreSQL Types

| Type | Description | Example |
|------|-------------|---------|
| `text` | Variable-length string | Names, descriptions |
| `citext` | Case-insensitive text | Emails, usernames |
| `int` / `integer` | 32-bit integer | Counts, quantities |
| `bigint` | 64-bit integer | Large IDs |
| `numeric(p,s)` | Exact decimal | Prices, amounts |
| `boolean` | True/false | Flags, toggles |
| `uuid` | UUID | Primary keys, references |
| `timestamptz` | Timestamp with timezone | Dates, times |
| `date` | Date only | Birthdays |
| `jsonb` | Binary JSON | Flexible data |
| `text` + `isArray: true` | Text array | Tags, lists |
| `citext` + `isArray: true` | CI text array | Case-insensitive tags |

## Querying Fields

### Find All Fields for a Table

```typescript
const result = await db.field.findMany({
  select: {
    id: true,
    name: true,
    label: true,
    type: true,
    isRequired: true,
    defaultValue: true,
    fieldOrder: true,
  },
  where: {
    tableId: { equalTo: tableId },
  },
  orderBy: ['FIELD_ORDER_ASC'],
}).execute();

if (result.ok) {
  const fields = result.data.fields.nodes;
  fields.forEach(f => {
    const required = f.isRequired ? 'NOT NULL' : 'NULL';
    const def = f.defaultValue ? ` DEFAULT ${f.defaultValue}` : '';
    console.log(`${f.name} ${f.type} ${required}${def}`);
  });
}
```

### Find Field by Name

```typescript
const result = await db.field.findFirst({
  select: {
    id: true,
    name: true,
    type: true,
    table: {
      id: true,
      name: true,
    },
  },
  where: {
    tableId: { equalTo: tableId },
    name: { equalTo: 'email' },
  },
}).execute();
```

### Find Fields with Validation

```typescript
const result = await db.field.findMany({
  select: {
    id: true,
    name: true,
    regexp: true,
    min: true,
    max: true,
    chk: true,
  },
  where: {
    tableId: { equalTo: tableId },
    or: [
      { regexp: { isNull: false } },
      { min: { isNull: false } },
      { max: { isNull: false } },
      { chk: { isNull: false } },
    ],
  },
}).execute();
```

## Updating a Field

```typescript
const result = await db.field.update({
  where: { id: fieldId },
  data: {
    label: 'Updated Label',
    description: 'Updated description',
    isRequired: true,
  },
  select: {
    id: true,
    label: true,
    isRequired: true,
  },
}).execute();

if (result.ok) {
  console.log('Updated field:', result.data.updateField.field);
}
```

### Add Validation to Existing Field

```typescript
const result = await db.field.update({
  where: { id: fieldId },
  data: {
    min: 0,
    max: 100,
  },
  select: {
    id: true,
    name: true,
    min: true,
    max: true,
  },
}).execute();
```

### Change Field Order

```typescript
const result = await db.field.update({
  where: { id: fieldId },
  data: {
    fieldOrder: 5,
  },
  select: {
    id: true,
    name: true,
    fieldOrder: true,
  },
}).execute();
```

## Deleting a Field

```typescript
const result = await db.field.delete({
  where: { id: fieldId },
}).execute();

if (result.ok) {
  console.log('Deleted field:', result.data.deleteField.field.id);
}
```

**Warning**: Deleting a field removes the column from the table and any associated constraints.

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available:

```json
{
  "operation": "mutation",
  "model": "field",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "tableId": "table-uuid",
    "name": "title",
    "label": "Title",
    "type": "text",
    "isRequired": true
  },
  "select": {
    "id": true,
    "name": true,
    "type": true
  }
}
```

## Field Categories

| Category | Description | Example |
|----------|-------------|---------|
| `core` | System fields | id, entity_id, actor_id |
| `module` | Module-generated fields | created_at, owner_id |
| `app` | User-defined fields | title, price, status |

## Creating Multiple Fields

```typescript
const fieldConfigs = [
  { name: 'id', type: 'uuid', isRequired: true, defaultValue: 'uuid_generate_v4()' },
  { name: 'name', type: 'text', isRequired: true },
  { name: 'description', type: 'text', isRequired: false },
  { name: 'price', type: 'numeric(10,2)', isRequired: true, min: 0 },
  { name: 'is_active', type: 'boolean', isRequired: true, defaultValue: 'true' },
];

for (const config of fieldConfigs) {
  const result = await db.field.create({
    data: {
      databaseId: databaseId,
      tableId: tableId,
      ...config,
    },
    select: { id: true, name: true },
  }).execute();

  if (result.ok) {
    console.log(`Created field: ${config.name}`);
  }
}
```

## Type Constraints & Gotchas

### Type Validation

- Types are validated by `metaschema_private.is_valid_type()` using PostgreSQL's `pg_type_is_visible(type::regtype)`
- Any valid PostgreSQL type visible in the search path is accepted (e.g., `text`, `citext`, `uuid`, `jsonb`, `numeric(10,2)`)
- `serial`, `bigserial`, and `smallserial` are special-cased as always valid (they bypass the regtype check)
- Invalid or misspelled types raise `NONEXISTENT_TYPE`

### Array Types

- Do NOT pass SQL array syntax like `'text[]'` or `'citext[]'` as the `type` value
- Use the base type (e.g., `'text'`) combined with `isArray: true`
- The trigger code that would have stripped `[]` and set `is_array` automatically is **disabled** (commented out in `before_insert_field_trigger.sql`)

### Reserved Field Names

- `order_by` and `primary_key` are reserved (PostGraphile keywords) and will be rejected

### Name Inflection

- Field names are auto-converted to `snake_case` via `inflection_db.get_field_name()`

### Default Values

- Default values are SQL expressions stored as text (e.g., `"'draft'"`, `'uuid_generate_v4()'`, `'now()'`)
- `uuid_generate_v4()` defaults are auto-scoped to the database's private schema
- Default values cannot contain semicolons (SQL injection protection)

### Validation Constraints (min, max, regexp)

- `min`/`max` on `text`/`citext` types: applies to `character_length` (min/max string length)
- `min`/`max` on `integer`/`int`/`smallint`/`bigint`: applies as direct numeric comparison
- `min`/`max` on `float`/`real`: applies as numeric comparison
- `min`/`max` on other types: **silently ignored** (no check constraint generated)
- `regexp` validation only works on `text`/`citext` types; silently ignored on other types
- Custom `chk` constraints are included as-is in the generated check expression

### Constraint Immutability on Update

- If you change a field's `type`, all constraints (`chk`, `regexp`, `min`, `max`) are automatically cleared
- You cannot change constraints and type in the same update -- raises `CONST_TYPE_FIELDS_IMMUTABLE`
- To change type and re-add constraints: first update the type (constraints are cleared), then update again with new constraints

### Auto-Set Properties

- `fieldOrder` is automatically set on insert to the count of existing fields for that table
- `databaseId` is automatically populated from the parent table's `database_id`

## Best Practices

1. **Use appropriate types** - Choose the most specific type for your data
2. **Set isRequired carefully** - Only require fields that are truly mandatory
3. **Use defaults wisely** - Provide sensible defaults to simplify inserts
4. **Add validation** - Use regexp, min, max for data integrity
5. **Order fields logically** - Use fieldOrder for consistent display
6. **Document fields** - Add labels and descriptions
7. **Hide sensitive data** - Use isHidden or smart tags for internal fields
8. **Never use SQL array syntax in type** - Always use the base type with `isArray: true`
9. **Change type before constraints** - When changing a field's type, update type first, then set new constraints in a separate update

## Error Handling

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'title',  // Already exists!
    type: 'text',
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
- Related skill: [`constructive-sdk-indexes`](../constructive-sdk-indexes) for adding indexes to fields (btree, unique, partial, covering)
- Related skill: [`constructive-sdk-search`](../constructive-sdk-search) for search-related fields (`tsvector`, `vector(N)`) and search indexes
- Related skill: [`constructive-sdk-constraints`](../constructive-sdk-constraints) for constraint management
- Related skill: [`constructive-db-policies`](../constructive-db-policies) for RLS policy management
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
- [PostgreSQL Data Types](https://www.postgresql.org/docs/current/datatype.html)
