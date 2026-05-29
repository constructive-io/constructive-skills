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
| `type` | jsonb (FieldType) | PostgreSQL type as a structured object: `{ name, schema?, args?, array_dimensions?, range? }` |
| `isRequired` | boolean | NOT NULL constraint |
| `defaultValue` | jsonb (FieldDefault) | Default value as a structured object: `{ value?, function?, schema?, args?, cast?, operator?, left?, right?, sql_keyword? }` |
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

### Basic Field Creation

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'title',
    label: 'Title',
    type: { name: 'text' },
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
  console.log('Type:', field.type); // { name: 'text' }
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
    type: { name: 'text' },
    isRequired: true,
    defaultValue: { value: 'draft' },  // FieldDefault object
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
    type: { name: 'uuid' },
    isRequired: true,
    defaultValue: { function: 'uuidv7' },
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
    type: { name: 'numeric', args: [10, 2] },
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
    type: { name: 'citext' },
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
    type: { name: 'uuid' },
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
    type: { name: 'text' },
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
    type: { name: 'text' },
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
    type: { name: 'jsonb' },
    defaultValue: { value: {}, cast: { name: 'jsonb' } },
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();
```

### Array Field

**Important**: Use the `array_dimensions` property in the FieldType object to declare array types. Do NOT pass SQL array syntax (e.g., `'text[]'`) as a string.

```typescript
// CORRECT - use array_dimensions in FieldType
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'tags',
    label: 'Tags',
    type: { name: 'text', array_dimensions: 1 },  // text[]
    defaultValue: { value: [], cast: { name: 'text', array_dimensions: 1 } },
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();

// 2D array: { name: 'integer', array_dimensions: 2 }  → integer[][]
```

### Timestamp Field

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'published_at',
    label: 'Published At',
    type: { name: 'timestamptz' },
  },
  select: {
    id: true,
    name: true,
    type: true,
  },
}).execute();
```

## Common FieldType Patterns

| FieldType Object | SQL Type | Use Case |
|------|-------------|---------|
| `{ name: 'text' }` | `text` | Names, descriptions |
| `{ name: 'citext' }` | `citext` | Emails, usernames |
| `{ name: 'integer' }` | `integer` | Counts, quantities |
| `{ name: 'bigint' }` | `bigint` | Large IDs |
| `{ name: 'numeric', args: [10, 2] }` | `numeric(10,2)` | Prices, amounts |
| `{ name: 'boolean' }` | `boolean` | Flags, toggles |
| `{ name: 'uuid' }` | `uuid` | Primary keys, references |
| `{ name: 'timestamptz' }` | `timestamptz` | Dates, times |
| `{ name: 'date' }` | `date` | Birthdays |
| `{ name: 'jsonb' }` | `jsonb` | Flexible data |
| `{ name: 'text', array_dimensions: 1 }` | `text[]` | Tags, lists |
| `{ name: 'citext', array_dimensions: 1 }` | `citext[]` | Case-insensitive tags |
| `{ name: 'geometry', args: ['Point', 4326] }` | `geometry(Point,4326)` | Geospatial |
| `{ name: 'vector', args: [768] }` | `vector(768)` | Embeddings |
| `{ name: 'interval' }` | `interval` | Durations |
| `{ name: 'bit', args: [8] }` | `bit(8)` | Bit fields |

## Common FieldDefault Patterns

| FieldDefault Object | SQL Default | Use Case |
|------|-------------|---------|
| `{ function: 'uuidv7' }` | `uuidv7()` | UUID primary keys |
| `{ function: 'now' }` | `now()` | Timestamps |
| `{ sql_keyword: 'CURRENT_TIMESTAMP' }` | `CURRENT_TIMESTAMP` | Timestamps (keyword) |
| `{ value: 'draft' }` | `'draft'` | String literals |
| `{ value: true }` | `true` | Boolean defaults |
| `{ value: 0 }` | `0` | Numeric defaults |
| `{ value: {}, cast: { name: 'jsonb' } }` | `'{}'::jsonb` | Empty JSON object |
| `{ value: [], cast: { name: 'jsonb' } }` | `'[]'::jsonb` | Empty JSON array |
| `{ value: [], cast: { name: 'text', array_dimensions: 1 } }` | `'{}'::text[]` | Empty text array |
| `{ function: 'encode', args: [{ function: 'gen_random_bytes', args: [16] }, 'hex'] }` | `encode(gen_random_bytes(16), 'hex')` | Random hex tokens |
| `{ operator: '+', left: { function: 'now' }, right: { value: '5 minutes', cast: { name: 'interval' } } }` | `now() + '5 minutes'::interval` | Future timestamps |

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
    console.log(f.name, f.type, f.defaultValue);
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
    "type": { "name": "text" },
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
  { name: 'id', type: { name: 'uuid' }, isRequired: true, defaultValue: { function: 'uuidv7' } },
  { name: 'name', type: { name: 'text' }, isRequired: true },
  { name: 'description', type: { name: 'text' }, isRequired: false },
  { name: 'price', type: { name: 'numeric', args: [10, 2] }, isRequired: true, min: 0 },
  { name: 'is_active', type: { name: 'boolean' }, isRequired: true, defaultValue: { value: true } },
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
8. **Never use SQL string syntax for type** - Always use FieldType objects (e.g., `{ name: 'text', array_dimensions: 1 }` not `'text[]'`)
9. **Change type before constraints** - When changing a field's type, update type first, then set new constraints in a separate update

## Error Handling

```typescript
const result = await db.field.create({
  data: {
    databaseId: databaseId,
    tableId: tableId,
    name: 'title',  // Already exists!
    type: { name: 'text' },
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
