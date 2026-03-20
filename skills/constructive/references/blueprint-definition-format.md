# Blueprint Definition Format (Hybrid A+C)

The blueprint `definition` is a JSONB document that declaratively describes a complete domain schema. It uses the "Hybrid A+C" format: structured table config with inline `$type` discriminators for nodes, policies, and relations.

## Top-Level Structure

```json
{
  "tables": [ ... ],
  "relations": [ ... ]
}
```

Both arrays are required at the top level. `relations` can be empty `[]` if there are no inter-table relationships.

## Table Entries

Each entry in `tables[]` defines one database table:

```json
{
  "ref": "products",
  "table_name": "products",
  "nodes": ["DataId", "DataTimestamps"],
  "fields": [
    { "name": "title", "type": "text" },
    { "name": "price", "type": "numeric" }
  ],
  "grant_roles": ["authenticated"],
  "grants": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]],
  "use_rls": true,
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": { "entity_field": "owner_id", "membership_type": 2 },
      "privileges": ["select", "insert", "update", "delete"],
      "permissive": true
    }
  ]
}
```

### Table entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ref` | string | Yes | Local reference name used in relations (e.g. `"products"`) |
| `table_name` | string | Yes | Actual database table name |
| `nodes` | array | No | Data behavior node types to apply (see below) |
| `fields` | array | No | Custom field definitions |
| `grant_roles` | string[] | No | Roles to grant access (default: `["authenticated"]`) |
| `grants` | array | No | Grant privilege tuples (e.g. `["select", "*"]`) |
| `use_rls` | boolean | No | Enable RLS (default: `true`) |
| `policies` | array | No | Safegres policy definitions (see below) |

### Nodes

`nodes[]` entries define data behaviors (column generators, indexes, etc.) from the `node_type_registry`. Each entry is either:

**String shorthand** — type name with default parameters:
```json
"DataTimestamps"
```

**Object with params** — type name + custom configuration:
```json
{
  "$type": "DataOwnershipInEntity",
  "data": { "entity_field": "owner_id" }
}
```

Common node types:

| Node Type | Purpose | Default behavior |
|-----------|---------|------------------|
| `DataId` | Adds `id uuid PRIMARY KEY DEFAULT uuidv7()` | Always use as first node |
| `DataTimestamps` | Adds `created_at` and `updated_at` timestamps | Auto-maintained |
| `DataOwnershipInEntity` | Adds `owner_id uuid NOT NULL` with FK | Entity-scoped ownership |
| `DataSearch` | Adds full-text search columns | tsvector + GIN index |
| `DataSoftDelete` | Adds `deleted_at` timestamp for soft deletes | Filtered in queries |

**Processing order matters:** The first node in `nodes[]` creates the table (via `secure_table_provision`). Remaining nodes augment the existing table.

### Fields

`fields[]` entries define custom columns beyond what nodes provide:

```json
{
  "name": "title",
  "type": "text"
}
```

Standard PostgreSQL types are supported: `text`, `integer`, `numeric`, `boolean`, `timestamptz`, `uuid`, `jsonb`, etc.

### Grants

`grants[]` is an array of privilege tuples:

```json
[
  ["select", "*"],
  ["insert", "*"],
  ["update", "title,price"],
  ["delete", "*"]
]
```

Each tuple is `[privilege, columns]` where `"*"` means all columns.

### Policies

`policies[]` entries define Safegres RLS policies using the `$type` discriminator:

```json
{
  "$type": "AuthzEntityMembership",
  "data": {
    "entity_field": "owner_id",
    "membership_type": 2
  },
  "privileges": ["select", "insert", "update", "delete"],
  "permissive": true,
  "policy_name": "custom_name",
  "policy_role": "authenticated"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$type` | string | Yes | Safegres policy type (e.g. `AuthzEntityMembership`, `AuthzDirectOwner`, `AuthzAllowAll`) |
| `data` | object | No | Policy-specific configuration (depends on `$type`) |
| `privileges` | string[] | No | Which privileges this policy covers |
| `permissive` | boolean | No | Permissive (OR) or restrictive (AND) policy (default: `true`) |
| `policy_name` | string | No | Custom policy name |
| `policy_role` | string | No | Role the policy applies to |

See the [constructive-safegres](../constructive-safegres/SKILL.md) skill for all 14 Authz* policy types and their config shapes.

**Processing order:** The first policy is created with the first node (table creation). Remaining policies are added as additional RLS policies on the existing table.

## Relation Entries

Each entry in `relations[]` defines a relationship between two tables:

```json
{
  "$type": "RelationBelongsTo",
  "source_ref": "products",
  "target_ref": "categories",
  "field_name": "category_id",
  "delete_action": "SET NULL",
  "is_required": false
}
```

### Relation entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$type` | string | Yes | Relation type (e.g. `RelationBelongsTo`, `RelationManyToMany`) |
| `source_ref` | string | Yes | Ref name of the source table (must match a `tables[].ref`) |
| `target_ref` | string | Yes | Ref name of the target table (must match a `tables[].ref`) |
| `field_name` | string | No | FK column name on the source table |
| `delete_action` | string | No | FK delete action (e.g. `CASCADE`, `SET NULL`, `RESTRICT`) |
| `is_required` | boolean | No | Whether the FK is NOT NULL (default: `true`) |
| `junction_table_name` | string | No | For ManyToMany: name of the junction table |
| `data` | object | No | Junction table config (see below) |

### Junction table config (for ManyToMany)

For `RelationManyToMany`, the `data` object configures the junction table:

```json
{
  "$type": "RelationManyToMany",
  "source_ref": "posts",
  "target_ref": "tags",
  "junction_table_name": "post_tags",
  "data": {
    "node_type": "DataId",
    "policy_type": "AuthzAllowAll",
    "policy_data": {},
    "grant_privileges": [["select", "*"], ["insert", "*"], ["delete", "*"]]
  }
}
```

## Complete Example: E-Commerce Blueprint

```json
{
  "tables": [
    {
      "ref": "categories",
      "table_name": "categories",
      "nodes": ["DataId", "DataTimestamps"],
      "fields": [
        { "name": "name", "type": "text" },
        { "name": "slug", "type": "text" },
        { "name": "description", "type": "text" }
      ],
      "grant_roles": ["authenticated"],
      "grants": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]],
      "policies": [
        {
          "$type": "AuthzEntityMembership",
          "data": { "entity_field": "owner_id", "membership_type": 2 },
          "privileges": ["select", "insert", "update", "delete"],
          "permissive": true
        }
      ]
    },
    {
      "ref": "products",
      "table_name": "products",
      "nodes": [
        "DataId",
        "DataTimestamps",
        { "$type": "DataOwnershipInEntity", "data": { "entity_field": "owner_id" } }
      ],
      "fields": [
        { "name": "title", "type": "text" },
        { "name": "price", "type": "numeric" },
        { "name": "description", "type": "text" },
        { "name": "is_published", "type": "boolean" }
      ],
      "grant_roles": ["authenticated"],
      "grants": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]],
      "policies": [
        {
          "$type": "AuthzEntityMembership",
          "data": { "entity_field": "owner_id", "membership_type": 2 },
          "privileges": ["select", "insert", "update", "delete"],
          "permissive": true
        },
        {
          "$type": "AuthzPublishable",
          "data": {},
          "privileges": ["select"],
          "permissive": true
        }
      ]
    },
    {
      "ref": "orders",
      "table_name": "orders",
      "nodes": ["DataId", "DataTimestamps"],
      "fields": [
        { "name": "total", "type": "numeric" },
        { "name": "status", "type": "text" }
      ],
      "grant_roles": ["authenticated"],
      "grants": [["select", "*"], ["insert", "*"], ["update", "*"]],
      "policies": [
        {
          "$type": "AuthzEntityMembership",
          "data": { "entity_field": "owner_id", "membership_type": 2 },
          "privileges": ["select", "insert", "update"],
          "permissive": true
        }
      ]
    }
  ],
  "relations": [
    {
      "$type": "RelationBelongsTo",
      "source_ref": "products",
      "target_ref": "categories",
      "field_name": "category_id",
      "delete_action": "SET NULL",
      "is_required": false
    },
    {
      "$type": "RelationBelongsTo",
      "source_ref": "orders",
      "target_ref": "products",
      "field_name": "product_id",
      "delete_action": "RESTRICT",
      "is_required": true
    }
  ]
}
```

## SDK Usage

### ORM (TypeScript)

```typescript
import { createClient } from '@/generated/orm';

const db = createClient({ endpoint, headers });

// Create a template
const template = await db.blueprintTemplate.create({
  data: {
    name: 'e_commerce_basic',
    displayName: 'E-Commerce Basic',
    ownerId: userId,
    visibility: 'public',
    categories: ['e-commerce'],
    tags: ['products', 'orders', 'categories'],
    definition: eCommerceDefinition,
  },
  select: { id: true, definitionHash: true, tableHashes: true },
}).execute();

// Copy template to blueprint
const { blueprintId } = await db.mutation.copyTemplateToBlueprint({
  input: {
    pTemplateId: template.id,
    pDatabaseId: dbId,
    pOwnerId: userId,
  },
}).execute();

// Execute the blueprint
const refMap = await db.mutation.constructBlueprint({
  input: {
    pBlueprintId: blueprintId,
    pSchemaId: schemaId,
  },
}).execute();
// refMap = { "categories": "uuid", "products": "uuid", "orders": "uuid" }
```

### CLI

```bash
# Create a template
constructive public:blueprint-template create \
  --name e_commerce_basic \
  --displayName "E-Commerce Basic" \
  --ownerId <UUID> \
  --definition '{"tables": [...], "relations": [...]}'

# Copy to blueprint
constructive public:copy-template-to-blueprint \
  --input.pTemplateId <UUID> \
  --input.pDatabaseId <UUID> \
  --input.pOwnerId <UUID>

# Execute
constructive public:construct-blueprint \
  --input.pBlueprintId <UUID> \
  --input.pSchemaId <UUID>
```

### Querying hashes for comparison

```typescript
// Find all templates with the same definition
const duplicates = await db.blueprintTemplate.findMany({
  where: { definitionHash: { equalTo: knownHash } },
  select: { id: true, name: true, ownerId: true },
}).execute();

// Compare table-level structure across blueprints
const bp1 = await db.blueprint.findOne({
  id: id1,
  select: { tableHashes: true },
}).execute();

const bp2 = await db.blueprint.findOne({
  id: id2,
  select: { tableHashes: true },
}).execute();

// Check if specific tables are structurally identical
const productsMatch = bp1.tableHashes.products === bp2.tableHashes.products;
```
