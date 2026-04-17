# Blueprint Definition Format

The blueprint `definition` is a JSONB document that declaratively describes a complete domain schema. It uses structured table config with inline `$type` discriminators for nodes, policies, and relations.

> **snake_case convention:** The definition uses **snake_case** keys (`table_name`, `grant_roles`, `delete_action`, etc.) because it is stored as opaque JSONB in PostgreSQL. PostGraphile/GraphQL does not transform keys inside JSONB fields — the JSON is passed through as-is. This is intentional and differs from the camelCase conventions used in the SDK's ORM types (e.g. `BlueprintTemplate`, `Blueprint`). When writing blueprint definitions, always use snake_case.

## Top-Level Structure

```json
{
  "membership_types": [ ... ],
  "tables": [ ... ],
  "relations": [ ... ],
  "indexes": [ ... ],
  "full_text_search": [ ... ],
  "unique_constraints": [ ... ]
}
```

`tables` is required. `membership_types`, `relations`, `indexes`, `full_text_search`, and `unique_constraints` are optional top-level arrays. Each of `indexes`, `full_text_search`, and `unique_constraints` can also be defined inline per-table (see below). `constructBlueprint()` collects from both locations.

## Membership Types (Phase 0)

`membership_types[]` provisions dynamic entity types **before** tables and relations. Each entry creates a full entity table with membership modules, permissions, and security policies via `entity_type_provision`.

```json
{
  "membership_types": [
    {
      "name": "Channel Member",
      "prefix": "channel",
      "description": "Membership to a channel.",
      "parent_entity": "org"
    }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Human-readable name (e.g. `"Channel Member"`) |
| `prefix` | string | **Yes** | — | SQL prefix for generated objects (e.g. `"channel"` → `channels` table) |
| `description` | string | No | `null` | Description of the entity type |
| `parent_entity` | string | No | `"org"` | Parent type prefix. Must be already provisioned |
| `table_name` | string | No | `prefix + 's'` | Override entity table name |
| `is_visible` | boolean | No | `true` | Gates the default `parent_member` SELECT policy. No-op when `table_provision` is supplied |
| `has_limits` | boolean | No | `false` | Provision a limits module |
| `has_profiles` | boolean | No | `false` | Provision a profiles module (named permission roles) |
| `has_levels` | boolean | No | `false` | Provision a levels module (gamification) |
| `skip_entity_policies` | boolean | No | `false` | Escape hatch: apply zero default RLS policies on the entity table |
| `table_provision` | object | No | `null` | Override object for the entity table (shape mirrors `tables[]`: `nodes`, `fields`, `grant_privileges`, `grant_roles`, `use_rls`, `policies`). When supplied, `policies[]` **replaces** the 5 default entity-table policies; `is_visible` becomes a no-op |

**Processing order:** Entries are processed in array order. Parent types must appear before child types.

**Table map integration:** Entity tables created by Phase 0 are added to the internal `table_map`, so subsequent `tables` and `relations` can reference them by name (e.g. `"target_table": "channels"`).

See the [`constructive-membership-types`](../constructive-membership-types/SKILL.md) skill for the full membership types reference.

## Table Entries

Each entry in `tables[]` defines one database table:

```json
{
  "table_name": "products",
  "schema_name": "app_public",
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
| `table_name` | string | Yes | Database table name — also used as the identifier in relations |
| `schema_name` | string | No | Per-table schema override (e.g. `"app_public"`). Falls back to the `schemaId` param of `constructBlueprint()` |
| `nodes` | array | Yes | Data behavior node types to apply. **Must start with `DataId`** unless the table intentionally has no primary key |
| `fields` | array | No | Custom field definitions |
| `grant_roles` | string[] | No | Roles to grant access (default: `["authenticated"]`) |
| `grants` | array | No | Grant privilege tuples (e.g. `["select", "*"]`) |
| `use_rls` | boolean | No | Enable RLS (default: `true`) |
| `policies` | array | No | Safegres policy definitions (see below) |
| `indexes` | array | No | Per-table index definitions (see Indexes section) |
| `full_text_search` | array | No | Per-table FTS definitions (see Full-Text Search section) |
| `unique_constraints` | array | No | Per-table unique constraint definitions (see Unique Constraints section) |

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
| `DataId` | Adds `id uuid PRIMARY KEY DEFAULT uuidv7()` | **Must be explicitly listed** — no longer auto-created |
| `DataTimestamps` | Adds `created_at` and `updated_at` timestamps | Auto-maintained |
| `DataOwnershipInEntity` | Adds `owner_id uuid NOT NULL` with FK | Entity-scoped ownership |
| `SearchUnified` | Adds full-text search columns | tsvector + GIN index |
| `DataSoftDelete` | Adds `deleted_at` timestamp for soft deletes | Filtered in queries |
| `SearchVector` | Adds vector embedding field + HNSW/IVFFlat index | Configurable dimensions, metric, stale tracking, job enqueue |
| `DataTags` | Adds `citext[]` tags field + GIN index | For array containment/overlap queries |
| `DataStatusField` | Adds status field + B-tree index + optional CHECK | Configurable allowed values |
| `DataJsonb` | Adds JSONB field + optional GIN index | For containment queries |
| `SearchTrgm` | Adds GIN trigram indexes on existing fields | For fuzzy/LIKE queries, sets `@trgmSearch` smart tag |

**`DataId` is explicit:** There is no implicit ID creation. If a table needs a primary key (most do), `DataId` must be the first entry in `nodes[]`. This was a deliberate design choice — explicit is better than implicit.

**Processing:** All nodes are processed together when the table is created. The table and all its Data* fields are provisioned in one step.

### Fields

`fields[]` entries define custom columns beyond what nodes provide:

```json
{
  "name": "title",
  "type": "text"
}
```

Standard PostgreSQL types are supported: `text`, `integer`, `numeric`, `boolean`, `timestamptz`, `uuid`, `jsonb`, etc.

Optional field properties:

| Property | Type | Description |
|----------|------|-------------|
| `is_required` | boolean | Whether the field is NOT NULL (default: `false`) |
| `default` | string | SQL default expression |
| `min` | float | Minimum value constraint |
| `max` | float | Maximum value constraint |
| `regexp` | string | Regex validation pattern |
| `index` | string | Access method for automatic index creation: `"btree"`, `"gin"`, `"gist"`, `"brin"`, `"hash"` |

Example with index:
```json
{ "name": "email", "type": "citext", "index": "btree" }
{ "name": "tags", "type": "citext[]", "index": "gin" }
{ "name": "location", "type": "geometry", "index": "gist" }
```

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

**`entity_type` resolution:** For membership-based policies (`AuthzMembership`, `AuthzEntityMembership`, `AuthzRelatedEntityMembership`, `AuthzPeerOwnership`, `AuthzRelatedPeerOwnership`), you can use `"entity_type": "channel"` (the prefix string) instead of `"membership_type": 3` (a hardcoded integer). The RLS parser resolves the prefix to the correct `membership_type` integer via `memberships_module` lookup. This is recommended for dynamic types (3+) where the int depends on provisioning order. Both forms continue to work.

**Processing:** All policies are applied after the table is created. Multiple permissive policies on the same privilege are ORed by PostgreSQL. Adding a restrictive policy (`"permissive": false`) creates an AND constraint.

## Relation Entries

Each entry in `relations[]` defines a relationship between two tables:

```json
{
  "$type": "RelationBelongsTo",
  "source_table": "products",
  "target_table": "categories",
  "field_name": "category_id",
  "delete_action": "SET NULL",
  "is_required": false
}
```

### Relation entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$type` | string | Yes | Relation type (e.g. `RelationBelongsTo`, `RelationManyToMany`) |
| `source_table` | string | Yes | Name of the source table (must match a `tables[].table_name`) |
| `target_table` | string | Yes | Name of the target table (must match a `tables[].table_name`) |
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
  "source_table": "posts",
  "target_table": "tags",
  "junction_table_name": "post_tags",
  "data": {
    "nodes": [{"$type": "DataId", "data": {}}],
    "policy_type": "AuthzAllowAll",
    "policy_data": {},
    "grant_privileges": [["select", "*"], ["insert", "*"], ["delete", "*"]]
  }
}
```

The `data.nodes` array uses the same `{"$type": ..., "data": {...}}` object format as the table-level `nodes`.

## Indexes

Index definitions can appear at the top level (`definition.indexes[]`) or inline per-table (`tables[].indexes[]`). `constructBlueprint()` collects from both locations.

```json
{
  "table_name": "products",
  "columns": ["category_id"],
  "access_method": "btree",
  "is_unique": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table_name` | string | Yes (top-level only) | Table to create the index on |
| `columns` | string[] | Yes | Column names to include in the index |
| `access_method` | string | No | `"btree"` (default), `"gin"`, `"gist"`, `"brin"`, `"hash"` |
| `is_unique` | boolean | No | Create a unique index (default: `false`) |

## Full-Text Search

FTS definitions can appear at the top level (`definition.full_text_search[]`) or inline per-table (`tables[].full_text_search[]`).

```json
{
  "table_name": "documents",
  "field_names": ["title", "body"],
  "language": "english"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table_name` | string | Yes (top-level only) | Table to add FTS to |
| `field_names` | string[] | Yes | Fields to include in the tsvector |
| `language` | string | No | PostgreSQL text search config (default: `"english"`) |

This creates a `tsvector` column with a GIN index and an auto-update trigger.

## Unique Constraints

Unique constraint definitions can appear at the top level (`definition.unique_constraints[]`) or inline per-table (`tables[].unique_constraints[]`).

```json
{
  "table_name": "products",
  "columns": ["slug", "owner_id"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table_name` | string | Yes (top-level only) | Table to add the constraint to |
| `columns` | string[] | Yes | Column names for the unique constraint |
```

## Complete Example: E-Commerce Blueprint

```json
{
  "tables": [
    {
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
      "source_table": "products",
      "target_table": "categories",
      "field_name": "category_id",
      "delete_action": "SET NULL",
      "is_required": false
    },
    {
      "$type": "RelationBelongsTo",
      "source_table": "orders",
      "target_table": "products",
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
    templateId: template.id,
    databaseId: dbId,
    ownerId: userId,
  },
}).execute();

// Execute the blueprint
const refMap = await db.mutation.constructBlueprint({
  input: {
    blueprintId: blueprintId,
    schemaId: schemaId,
  },
}).execute();
// result = { "categories": "uuid", "products": "uuid", "orders": "uuid" }
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
  --input.templateId <UUID> \
  --input.databaseId <UUID> \
  --input.ownerId <UUID>

# Execute
constructive public:construct-blueprint \
  --input.blueprintId <UUID> \
  --input.schemaId <UUID>
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
