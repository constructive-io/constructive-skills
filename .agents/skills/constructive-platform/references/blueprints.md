# Blueprints

Blueprints are Constructive's declarative schema provisioning system — a "schema.org for schemas." They let you define complete domain schemas (e.g. e-commerce, telemedicine, habit tracker) as portable JSONB documents, share them via a marketplace, and execute them to provision real database tables with full RLS security.

## Architecture

Two-layer model:

| Layer | Table | Purpose |
|-------|-------|---------|
| **Template** | `blueprint_template` | Shareable, versioned recipe. Never executed directly. |
| **Blueprint** | `blueprint` | Owned, executable instance scoped to a database. Created by copying a template or built from scratch. |

**Flow:**
```
1. Create template (or browse marketplace)
2. Copy template → blueprint (via copyTemplateToBlueprint)
3. Customize blueprint definition (optional)
4. Execute blueprint -> provisions tables, relations, indexes, FTS, unique constraints (via constructBlueprint)
5. Run introspection + codegen -> typed SDK with RLS
```

## How Blueprints Provision

When you call `constructBlueprint()`, the system handles everything declaratively:

1. **Tables** are created with their fields, nodes, grants, policies, and RLS
2. **Relations** (BelongsTo, HasOne, HasMany, ManyToMany) are created between tables
3. **Indexes**, **full-text search**, and **unique constraints** are applied

All operations are **idempotent** — calling `constructBlueprint()` twice with the same definition is safe (the second call is a no-op).

Authorization is enforced automatically — a user can only provision into databases they own.

## blueprint_template

A shareable, versioned schema recipe for the marketplace.

### Key columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated UUIDv7 primary key |
| `name` | text | Machine-readable name (unique per owner + version) |
| `version` | text | Semantic version string (default `1.0.0`) |
| `display_name` | text | Human-readable display name |
| `description` | text | Optional description |
| `owner_id` | uuid | The user who created/published this template |
| `visibility` | text | `private` (owner-only) or `public` (marketplace-visible) |
| `categories` | text[] | Domain categories for marketplace browsing |
| `tags` | text[] | Freeform tags for search and discovery |
| `definition` | jsonb | The blueprint definition (declarative JSONB format) |
| `definition_schema_version` | text | Definition format version (default `1`) |
| `source` | text | Provenance: `user`, `system`, or `agent` |
| `complexity` | text | `simple`, `moderate`, `complex`, or NULL |
| `copy_count` | integer | How many blueprints copied from this template (auto-incremented) |
| `fork_count` | integer | How many derivative templates forked from this |
| `forked_from_id` | uuid | Parent template ID if forked (NULL for originals) |
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by table_name (backend-computed) |

### Constraints

- `UNIQUE (owner_id, name, version)` — one version per name per owner
- `forked_from_id` → self-referencing FK to `blueprint_template(id)`

### Indexes

- `owner_id`, `visibility`, `forked_from_id`, `definition_hash` — B-tree
- `categories`, `tags` — GIN (array containment queries)

## blueprint

An owned, executable blueprint scoped to a specific database.

### Key columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated UUIDv7 primary key |
| `owner_id` | uuid | The user who owns this blueprint |
| `database_id` | uuid | Target database for provisioning |
| `name` | text | Machine-readable name (unique per database) |
| `display_name` | text | Human-readable display name |
| `description` | text | Optional description |
| `definition` | jsonb | Mutable blueprint definition (declarative JSONB format) |
| `template_id` | uuid | Source template ID if copied (NULL if built from scratch) |
| `status` | text | `draft`, `constructed`, or `failed` |
| `constructed_at` | timestamptz | When constructBlueprint() succeeded |
| `error_details` | text | Error message if status is `failed` |
| `constructed_definition` | jsonb | Immutable snapshot of definition at construct-time |
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by table_name (backend-computed) |

### Constraints

- `UNIQUE (database_id, name)` — one blueprint per name per database
- `database_id` → FK to `database(id)` ON DELETE CASCADE
- `template_id` → FK to `blueprint_template(id)`

## blueprint_construction

Tracks the state of each table during blueprint construction. One row per table in the blueprint.

### Key columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated primary key |
| `blueprint_id` | uuid | FK to `blueprint(id)` |
| `table_name` | text | The table_name from the definition |
| `table_id` | uuid | The provisioned table's UUID |
| `status` | text | `pending`, `constructed`, or `failed` |

## Functions

### constructBlueprint(blueprintId, schemaId)

Executes a draft blueprint, provisioning real database tables and relations across 5 phases.

```typescript
// ORM
const result = await db.mutation.constructBlueprint({
  input: { blueprintId: '<UUID>', schemaId: '<UUID>' }
}).execute();

// CLI
constructive public:construct-blueprint --input.blueprintId <UUID> --input.schemaId <UUID>
```

**Behavior:**
1. Validates blueprint exists and status is `draft`
2. **Phase 1 — Tables:** For each entry in `definition.tables[]`:
   - Resolves `schema_name` (per-table override or falls back to the `schema_id` parameter)
   - Creates the table with all fields and Data* nodes
   - Applies grants for each `grants[].roles[]` x `grants[].privileges[]` combination
   - Applies policies for each entry in `policies[]`
   - Enables RLS if `use_rls` is true (default) or if any policies are defined
   - Records table in `blueprint_construction` for state tracking
3. **Phase 2 — Relations:** For each entry in `definition.relations[]`:
   - Resolves `source_table` and `target_table` to table IDs
   - Creates the relation (FK or junction table)
4. **Phase 3 — Indexes:** For each entry in `definition.indexes[]` (or per-table `indexes[]`):
   - Creates indexes on the resolved table/columns
5. **Phase 4 — Full-Text Search:** For each entry in `definition.full_text_search[]` (or per-table `full_text_search[]`):
   - Creates tsvector column + GIN index + auto-update trigger
6. **Phase 5 — Unique Constraints:** For each entry in `definition.unique_constraints[]` (or per-table `unique_constraints[]`):
   - Creates unique constraints on the resolved columns
7. **On success:** Sets `status = 'constructed'`, saves `constructed_definition`
8. **On failure:** Sets `status = 'failed'`, saves `error_details`. Returns NULL.

**Idempotency:** All phases are idempotent — calling `constructBlueprint()` twice with the same definition is safe. The second call is a no-op.

**Returns:** `jsonb` table_name_map (e.g. `{"products": "uuid", "categories": "uuid"}`) or NULL on failure.

### resolveBlueprintTable(databaseId, tableName, schemaName)

Resolves a table name to a table ID within a database. If `schemaName` is provided, looks up in that specific schema. If omitted, resolves unambiguously (throws an error if multiple schemas contain a table with that name).

```typescript
// ORM
const result = await db.mutation.resolveBlueprintTable({
  input: { databaseId: '<UUID>', tableName: 'products', schemaName: 'app_public' }
}).execute();
```

### copyTemplateToBlueprint(templateId, databaseId, ownerId, nameOverride, displayNameOverride)

Creates a new blueprint by copying a template's definition.

```typescript
// ORM
const result = await db.mutation.copyTemplateToBlueprint({
  input: {
    templateId: '<UUID>',
    databaseId: '<UUID>',
    ownerId: '<UUID>',
    nameOverride: 'my_store',           // optional
    displayNameOverride: 'My Store'     // optional
  }
}).execute();

// CLI
constructive public:copy-template-to-blueprint \
  --input.templateId <UUID> \
  --input.databaseId <UUID> \
  --input.ownerId <UUID>
```

**Behavior:**
1. Checks visibility: owners can always copy their own templates; others require `public` visibility
2. Creates a new `blueprint` with `status = 'draft'`, copying the template's definition
3. Increments the template's `copy_count`
4. Returns the new blueprint ID

## Content-Addressable Hashing (Merkle Tree)

Both `blueprint_template` and `blueprint` have backend-computed hash columns for provenance tracking, deduplication, and structural comparison.

### How it works

Two-level Merkle tree, computed automatically when the `definition` is saved:

**Level 1 — Table hashes:** Each table entry is hashed individually. Stored in `tableHashes` as `{"products": "uuid-hash", "categories": "uuid-hash"}` (keyed by `table_name`).

**Level 2 — Merkle root:** All table hashes are concatenated (plus the relations hash if present) and hashed to produce `definitionHash`.

### Determinism

- Same definition content always produces the same hash, regardless of insertion order
- JSONB keys are canonically sorted, ensuring consistent serialization

### Use cases

| Use Case | How |
|----------|-----|
| **Deduplication** | Two templates with identical definitions have the same `definition_hash` |
| **Provenance tracking** | After copying a template → blueprint, compare `definition_hash` to detect if the user modified the definition |
| **Structural comparison** | Compare individual `table_hashes` entries across different blueprints to find shared table structures |
| **Change detection** | `definition_hash` changes when any table or relation is modified; unchanged tables keep the same hash in `table_hashes` |

### Important notes

- Hash columns are **nullable** and **backend-computed** — clients should never set them directly
- Hashes are recomputed only when `definition` changes
- Updating non-definition columns (e.g. `displayName`) does **not** recompute hashes
- When a template is copied to a blueprint, the hashes are inherited (same definition → same hash)

## Security Model

Authorization is enforced by RLS policies on every metaschema table — each table has a `database_id` ownership check. This means:

- A user can only provision into databases they own
- Cross-tenant access is blocked at the database level automatically
- No manual auth checks are needed in application code

## RLS and Introspection

Blueprint-provisioned tables automatically flow through the existing introspection pipeline:

1. `constructBlueprint()` provisions tables with all configured security
2. These are standard Constructive tables — they appear in introspection like any other table
3. Running `cnc codegen` against the database generates typed SDK with full RLS support
4. The RLS policies specified in `definition.policies[]` are compiled via the Safegres protocol

No special handling is needed — blueprints compose the existing primitives.

## Cross-References

- **Definition format:** See [blueprint-definition-format.md](./blueprint-definition-format.md) for the blueprint definition format spec
- **Safegres policies:** See [constructive-safegres](../../constructive-safegres/SKILL.md) for Authz* policy types used in `policies[]`
- **Codegen:** See [constructive-sdk-graphql](../../constructive-sdk-graphql/SKILL.md) for generating typed SDK from provisioned tables
- **Server config:** See [server-config.md](./server-config.md) for running introspection and codegen
