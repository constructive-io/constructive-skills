# Generators API Reference

Complete reference for all query and mutation generators in `@constructive-io/graphql-query`.

## Core Concept

Every generator follows the same pattern:

```ts
const typedDocument = buildXxx(table, allTables?, options?);

// Use the result:
typedDocument.toString();         // → GraphQL query string
print(typedDocument.__document);  // → same, via graphql's print()
```

All generators return a `TypedDocumentString` — a wrapper that carries both the query string and TypeScript type information for variables and result.

---

## `buildSelect(table, allTables, options?)`

Generates a paginated SELECT query with Connection pattern (totalCount, pageInfo, nodes).

### Parameters

| Param | Type | Description |
|---|---|---|
| `table` | `CleanTable` | The table to query |
| `allTables` | `CleanTable[]` | All tables (needed for relation resolution) |
| `options?` | `QueryOptions` | Pagination, filters, field selection, relation mapping |

### QueryOptions

```ts
interface QueryOptions {
  fieldSelection?: FieldSelection;
  relationFieldMap?: Record<string, string | null>;
}
```

### FieldSelection

```ts
// Presets
type FieldSelectionPreset = 'minimal' | 'all' | 'full';

// Custom
interface SimpleFieldSelection {
  select?: string[];                           // specific fields to include
  exclude?: string[];                          // fields to exclude
  include?: Record<string, string[] | true>;   // relations to include
}

type FieldSelection = FieldSelectionPreset | SimpleFieldSelection;
```

| Preset | Behavior |
|---|---|
| `'minimal'` | Primary key + a few display-worthy fields |
| `'all'` | All scalar fields, no relations |
| `'full'` | All scalar fields + all relations |

### Example: Custom field selection with relations

```ts
const query = buildSelect(actionTable, tables, {
  fieldSelection: {
    select: ['id', 'name', 'photo', 'title'],
    include: {
      actionResults: ['id', 'actionId'],  // hasMany
      category: true,                      // belongsTo
    },
  },
});
```

**Generated:**

```graphql
query actionsQuery {
  actions {
    totalCount
    nodes {
      id
      name
      photo
      title
      actionResults(first: 20) {
        nodes {
          id
          actionId
        }
      }
      category {
        id
        name
      }
    }
  }
}
```

---

## `buildFindOne(table, pkField?)`

Generates a single-row query by primary key.

### Parameters

| Param | Type | Description |
|---|---|---|
| `table` | `CleanTable` | The table to query |
| `pkField?` | `string` | Primary key field name (default: `'id'`) |

### Example

```ts
const query = buildFindOne(userTable);
```

**Generated:**

```graphql
query getUserQuery($id: UUID!) {
  user(id: $id) {
    id
    name
    email
    createdAt
  }
}
```

---

## `buildCount(table)`

Generates a count query with optional condition/filter variables.

### Parameters

| Param | Type | Description |
|---|---|---|
| `table` | `CleanTable` | The table to count |

### Example

```ts
const query = buildCount(userTable);
```

**Generated:**

```graphql
query getUsersCountQuery(
  $condition: UserCondition
  $filter: UserFilter
) {
  users(condition: $condition, filter: $filter) {
    totalCount
  }
}
```

---

## `buildPostGraphileCreate(table, allTables, options?)`

Generates a CREATE mutation. The mutation payload returns the created entity with all its fields.

### Parameters

| Param | Type | Description |
|---|---|---|
| `table` | `CleanTable` | The table to create a record in |
| `allTables` | `CleanTable[]` | All tables (for relation resolution in payload) |
| `options?` | `MutationOptions` | Field selection for the returned entity |

### Example

```ts
const query = buildPostGraphileCreate(userTable, tables);
```

**Generated:**

```graphql
mutation createUserMutation($input: CreateUserInput!) {
  createUser(input: $input) {
    user {
      id
      name
      email
      createdAt
    }
  }
}
```

### Usage

```ts
const result = await client.execute(query, {
  input: {
    user: {
      name: 'Alice',
      email: 'alice@example.com',
    },
  },
});
```

---

## `buildPostGraphileUpdate(table, allTables, options?)`

Generates an UPDATE mutation. Uses entity-specific patch field names (e.g., `userPatch` not generic `patch`).

### Parameters

Same as `buildPostGraphileCreate`.

### Example

```ts
const query = buildPostGraphileUpdate(userTable, tables);
```

**Generated:**

```graphql
mutation updateUserMutation($input: UpdateUserInput!) {
  updateUser(input: $input) {
    user {
      id
      name
      email
      createdAt
    }
  }
}
```

### Usage

```ts
const result = await client.execute(query, {
  input: {
    id: 'uuid-here',
    userPatch: {         // entity-specific patch field
      name: 'Alice Updated',
    },
  },
});
```

---

## `buildPostGraphileDelete(table, allTables, options?)`

Generates a DELETE mutation.

### Parameters

Same as `buildPostGraphileCreate`.

### Example

```ts
const query = buildPostGraphileDelete(userTable, tables);
```

**Generated:**

```graphql
mutation deleteUserMutation($input: DeleteUserInput!) {
  deleteUser(input: $input) {
    clientMutationId
  }
}
```

### Usage

```ts
const result = await client.execute(query, {
  input: { id: 'uuid-here' },
});
```

---

## Naming Helpers

All generators use these internally, but they're also exported for direct use:

```ts
import {
  toCamelCaseSingular,
  toCamelCasePlural,
  toCreateMutationName,
  toUpdateMutationName,
  toDeleteMutationName,
  toPatchFieldName,
  toFilterTypeName,
  toOrderByTypeName,
  toCreateInputTypeName,
  toUpdateInputTypeName,
  toDeleteInputTypeName,
  toOrderByEnumValue,
  normalizeInflectionValue,
} from '@constructive-io/graphql-query/generators';
```

Each function accepts `(name: string, table?: CleanTable)`. When `table` is provided, it checks `table.query` and `table.inflection` first (server-inferred names), falling back to local inflection conventions.

| Function | Server Source | Fallback |
|---|---|---|
| `toCamelCaseSingular` | `table.inflection.tableFieldName` | `camelize(name)` |
| `toCamelCasePlural` | `table.query.all` | `pluralize(camelize(name))` |
| `toCreateMutationName` | `table.query.create` | `` `create${name}` `` |
| `toUpdateMutationName` | `table.query.update` | `` `update${name}` `` |
| `toDeleteMutationName` | `table.query.delete` | `` `delete${name}` `` |
| `toPatchFieldName` | `table.query.patchFieldName` | `` `${camelSingular}Patch` `` |
| `toFilterTypeName` | `table.inflection.filterType` | `` `${name}Filter` `` |
| `toOrderByTypeName` | `table.inflection.orderByType` | `` `${plural}OrderBy` `` |
| `toCreateInputTypeName` | `table.inflection.createInputType` | `` `Create${name}Input` `` |
| `toUpdateInputTypeName` | Derived from inflection | `` `Update${name}Input` `` |
| `toDeleteInputTypeName` | Derived from inflection | `` `Delete${name}Input` `` |

---

## Field Selection Utilities

```ts
import {
  convertToSelectionOptions,
  isRelationalField,
  getAvailableRelations,
  validateFieldSelection,
} from '@constructive-io/graphql-query/generators';
```

| Function | Description |
|---|---|
| `convertToSelectionOptions(selection, table, allTables)` | Convert `FieldSelection` to internal `SelectionOptions` |
| `isRelationalField(fieldName, table)` | Check if a field is a relation (belongsTo, hasMany, etc.) |
| `getAvailableRelations(table)` | Get all available relation names for a table |
| `validateFieldSelection(selection, table)` | Validate field names exist on the table |

---

## AST Builders (Low-Level)

For advanced use cases, the low-level AST builders are available:

```ts
import {
  getAll,
  getMany,
  getOne,
  getCount,
  createOne,
  patchOne,
  deleteOne,
  getSelections,
} from '@constructive-io/graphql-query/ast';
```

These produce raw GraphQL AST `DocumentNode` objects. The higher-level generators (`buildSelect`, etc.) use these internally and are preferred for most use cases.

---

## Custom AST Builders

For PostgreSQL types that require subfield selection (geometry, interval, etc.):

```ts
import {
  requiresSubfieldSelection,
  getCustomAstForCleanField,
  geometryPointAst,
  geometryAst,
  intervalAst,
  isIntervalType,
} from '@constructive-io/graphql-query/custom-ast';
```

| Function | Description |
|---|---|
| `requiresSubfieldSelection(field)` | Check if a field's type needs nested selection (geometry, interval) |
| `getCustomAstForCleanField(field)` | Get the appropriate nested AST for a complex type |
| `geometryPointAst()` | AST for `{ x y }` point fields |
| `geometryAst()` | AST for full geometry objects |
| `intervalAst()` | AST for PostgreSQL interval fields |

---

## Client Utilities

```ts
import {
  TypedDocumentString,
  createGraphQLClient,
  execute,
  DataError,
  parseGraphQLError,
  DataErrorType,
} from '@constructive-io/graphql-query/client';
```

### `createGraphQLClient(options)`

```ts
const client = createGraphQLClient({
  url: '/graphql',
  headers: { Authorization: `Bearer ${token}` },
});

const { data, errors } = await client.execute(query, variables);
```

### `DataError` and Error Classification

```ts
const result = await client.execute(createQuery, { input: { ... } });
if (result.errors) {
  const error = parseGraphQLError(result.errors[0]);
  switch (error.type) {
    case DataErrorType.UNIQUE_VIOLATION:
      console.log('Duplicate:', error.constraintName);
      break;
    case DataErrorType.FOREIGN_KEY_VIOLATION:
      console.log('Invalid reference:', error.columnName);
      break;
    case DataErrorType.NOT_NULL_VIOLATION:
      console.log('Required field:', error.columnName);
      break;
  }
}
```

Error types: `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`, `CHECK_VIOLATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `NETWORK_ERROR`, `UNKNOWN`.
