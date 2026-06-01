# FieldType & FieldDefault Reference

Structured JSONB representations of PostgreSQL types and default value expressions. Stored in `metaschema_public.field.type` and `metaschema_public.field.default_value`.

TypeScript interfaces: `FieldType`, `FieldDefault` from `@constructive-io/node-type-registry`.

---

## FieldType

```typescript
interface FieldType {
  name: string;               // SQL type name (required)
  schema?: string;            // schema qualifier
  args?: (string | number | boolean)[];  // type arguments
  array_dimensions?: number;  // 1 = text[], 2 = text[][]
  range?: string[];           // interval field range
}
```

### Examples

| FieldType | SQL |
|-----------|-----|
| `{ name: 'text' }` | `text` |
| `{ name: 'uuid' }` | `uuid` |
| `{ name: 'boolean' }` | `boolean` |
| `{ name: 'integer' }` | `integer` |
| `{ name: 'bigint' }` | `bigint` |
| `{ name: 'citext' }` | `citext` |
| `{ name: 'jsonb' }` | `jsonb` |
| `{ name: 'timestamptz' }` | `timestamptz` |
| `{ name: 'date' }` | `date` |
| `{ name: 'interval' }` | `interval` |
| `{ name: 'numeric', args: [10, 2] }` | `numeric(10,2)` |
| `{ name: 'varchar', args: [255] }` | `varchar(255)` |
| `{ name: 'character', args: [1] }` | `character(1)` |
| `{ name: 'bit', args: [8] }` | `bit(8)` |
| `{ name: 'vector', args: [768] }` | `vector(768)` |
| `{ name: 'vector', args: [1536] }` | `vector(1536)` |
| `{ name: 'geometry', args: ['Point', 4326] }` | `geometry(Point,4326)` |
| `{ name: 'geometry', args: ['Polygon', 4326] }` | `geometry(Polygon,4326)` |
| `{ name: 'text', array_dimensions: 1 }` | `text[]` |
| `{ name: 'citext', array_dimensions: 1 }` | `citext[]` |
| `{ name: 'integer', array_dimensions: 1 }` | `integer[]` |
| `{ name: 'integer', array_dimensions: 2 }` | `integer[][]` |
| `{ name: 'jsonb', array_dimensions: 1 }` | `jsonb[]` |
| `{ name: 'interval', range: ['day', 'second'] }` | `interval day to second` |
| `{ name: 'interval', range: ['year', 'month'] }` | `interval year to month` |
| `{ name: 'my_type', schema: 'my_schema' }` | `my_schema.my_type` |

---

## FieldDefault

```typescript
type FieldDefaultArg = string | number | boolean | null | FieldDefault;

interface FieldDefault {
  value?: string | number | boolean | null | unknown[] | Record<string, unknown>;
  function?: string;
  schema?: string;
  args?: FieldDefaultArg[];
  cast?: FieldType;         // reuses FieldType shape
  operator?: string;
  left?: FieldDefault;
  right?: FieldDefault;
  sql_keyword?: string;
}
```

### Literal values

| FieldDefault | SQL |
|-------------|-----|
| `{ value: 'draft' }` | `'draft'` |
| `{ value: '' }` | `''` |
| `{ value: true }` | `true` |
| `{ value: false }` | `false` |
| `{ value: 0 }` | `0` |
| `{ value: 100 }` | `100` |

### Cast expressions

| FieldDefault | SQL |
|-------------|-----|
| `{ value: {}, cast: { name: 'jsonb' } }` | `'{}'::jsonb` |
| `{ value: [], cast: { name: 'jsonb' } }` | `'[]'::jsonb` |
| `{ value: [], cast: { name: 'text', array_dimensions: 1 } }` | `'{}'::text[]` |
| `{ value: '30 minutes', cast: { name: 'interval' } }` | `'30 minutes'::interval` |
| `{ value: '15 minutes', cast: { name: 'interval' } }` | `'15 minutes'::interval` |

### Function calls

| FieldDefault | SQL |
|-------------|-----|
| `{ function: 'now' }` | `now()` |
| `{ function: 'uuidv7' }` | `uuidv7()` |
| `{ function: 'gen_random_uuid' }` | `gen_random_uuid()` |
| `{ function: 'current_user_id', schema: 'jwt_public' }` | `jwt_public.current_user_id()` |

### Function calls with arguments

| FieldDefault | SQL |
|-------------|-----|
| `{ function: 'encode', args: [{ function: 'gen_random_bytes', args: [16] }, 'hex'] }` | `encode(gen_random_bytes(16), 'hex')` |
| `{ function: 'lpad', args: ['', 32, '0'], cast: { name: 'bit', args: [32] } }` | `lpad('', 32, '0')::bit(32)` |

### Operator expressions

| FieldDefault | SQL |
|-------------|-----|
| `{ operator: '+', left: { function: 'now' }, right: { value: '5 minutes', cast: { name: 'interval' } } }` | `now() + '5 minutes'::interval` |
| `{ operator: '+', left: { function: 'now' }, right: { value: '30 minutes', cast: { name: 'interval' } } }` | `now() + '30 minutes'::interval` |

### SQL keywords

| FieldDefault | SQL |
|-------------|-----|
| `{ sql_keyword: 'CURRENT_TIMESTAMP' }` | `CURRENT_TIMESTAMP` |
| `{ sql_keyword: 'CURRENT_USER' }` | `CURRENT_USER` |

---

## Blueprint usage

```json
{
  "fields": [
    { "name": "title", "type": { "name": "text" }, "is_required": true },
    { "name": "status", "type": { "name": "text" }, "default": { "value": "draft" } },
    { "name": "metadata", "type": { "name": "jsonb" }, "default": { "value": {}, "cast": { "name": "jsonb" } } },
    { "name": "tags", "type": { "name": "citext", "array_dimensions": 1 }, "default": { "value": [], "cast": { "name": "citext", "array_dimensions": 1 } } },
    { "name": "expires_at", "type": { "name": "timestamptz" }, "default": { "operator": "+", "left": { "function": "now" }, "right": { "value": "5 minutes", "cast": { "name": "interval" } } } }
  ]
}
```

## SDK usage

```typescript
await db.field.create({
  data: {
    databaseId,
    tableId,
    name: 'tags',
    type: { name: 'citext', array_dimensions: 1 },
    defaultValue: { value: [], cast: { name: 'citext', array_dimensions: 1 } },
    isRequired: true,
  },
  select: { id: true, name: true, type: true },
}).execute();
```

## Validation

The `validate_field_type` and `validate_field_default` triggers on `metaschema_public.field` reject non-object inputs. Passing `"type": "text"` (a JSON string) returns:

```
FieldType must be an object, got string
```

Always use the object format: `"type": { "name": "text" }`.
