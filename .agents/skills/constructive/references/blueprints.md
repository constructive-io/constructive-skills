# Blueprints

Blueprints are Constructive's declarative schema provisioning system — a "schema.org for schemas." They let you define complete domain schemas (e.g. e-commerce, telemedicine, habit tracker) as portable JSONB documents, share them via a marketplace, and execute them to provision real database tables with full RLS security.

## Architecture

Two-layer model:

| Layer | Table | Purpose |
|-------|-------|---------|
| **Template** | `metaschema_modules_public.blueprint_template` | Shareable, versioned recipe. Never executed directly. |
| **Blueprint** | `metaschema_modules_public.blueprint` | Owned, executable instance scoped to a database. Created by copying a template or built from scratch. |

**Flow:**
```
1. Create template (or browse marketplace)
2. Copy template → blueprint (via copy_template_to_blueprint)
3. Customize blueprint definition (optional)
4. Execute blueprint -> provisions tables, relations, indexes, FTS, unique constraints (via construct_blueprint)
5. Run introspection + codegen -> typed SDK with RLS
```

## Provision System

Blueprints sit on top of a composable provision system. Understanding the layers helps when debugging or customizing:

| Layer | Functions | Purpose |
|-------|-----------|---------|
| **Blueprint** | `construct_blueprint()` | Orchestrates all 5 phases from a JSONB definition |
| **Provision procedures** | `provision_table()`, `provision_relation()`, `provision_index()`, `provision_full_text_search()`, `provision_unique_constraint()` | Mid-level composable building blocks (in `metaschema_modules_public`, callable via GraphQL) |
| **Orchestrator table** | `secure_table_provision` | High-level single-INSERT that creates a table with fields + nodes + grants + policies + RLS in one shot |
| **Internal helpers** | `find_or_create_*`, `ensure_*`, `*_exists()` | Low-level idempotent helpers (in `metaschema` schema, not exposed via API) |

All provision functions use `SECURITY INVOKER` — authorization is handled by RLS policies on `metaschema_public` tables, not by manual checks in the functions.

### Provision procedures (public API)

These are in `metaschema_modules_public` and exposed over GraphQL:

| Function | Purpose |
|----------|---------|
| `provision_table(database_id, schema_name, table_name, fields, nodes)` | Creates a table + fields + Data* nodes. No policies/grants/RLS. |
| `provision_relation(database_id, relation_type, source_table_id, target_table_id, ...)` | Creates FK relations or ManyToMany junction tables |
| `provision_index(database_id, table_name, columns, access_method, is_unique)` | Creates indexes on existing tables |
| `provision_full_text_search(database_id, table_name, field_names, language)` | Creates tsvector + GIN index for full-text search |
| `provision_unique_constraint(database_id, table_name, columns)` | Creates unique constraints |

### Internal helpers (not exposed)

These are in the `metaschema` schema and used internally by the provision procedures:

**`find_or_create_*` (returns the found/created ID):**
- `find_or_create_schema(database_id, name)` — finds or creates a schema
- `find_or_create_field(table_id, name, type, ...)` — finds or creates a field
- `find_or_create_table(database_id, schema_id, name)` — finds or creates a table
- `find_or_create_fts(table_id, field_ids, language)` — finds or creates a full-text search config

**`ensure_*` (void, fire-and-forget idempotency):**
- `ensure_fk(source_field_id, target_table_id, delete_action)` — ensures a FK constraint exists
- `ensure_index(table_id, field_ids, access_method, is_unique)` — ensures an index exists
- `ensure_uniq(table_id, field_ids)` — ensures a unique constraint exists
- `ensure_grant(table_id, role, privilege, columns)` — ensures a grant exists
- `ensure_policy(table_id, policy_type, data, ...)` — ensures a policy set exists

**`*_exists()` predicates (structural checks, not name-based):**
- `field_exists(table_id, name)`, `fk_exists(field_id, target_table_id)`, `index_exists(table_id, field_ids, access_method)`, `uniq_exists(table_id, field_ids)`, `grant_exists(table_id, role, privilege)`, `policy_exists(table_id, policy_type, data)`, `table_exists(database_id, schema_id, name)`, `schema_exists(database_id, name)`

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
| `constructed_at` | timestamptz | When construct_blueprint() succeeded |
| `error_details` | text | Error message if status is `failed` |
| `constructed_definition` | jsonb | Immutable snapshot of definition at construct-time |
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by table_name (backend-computed) |

### Constraints

- `UNIQUE (database_id, name)` — one blueprint per name per database
- `database_id` → FK to `metaschema_public.database(id)` ON DELETE CASCADE
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

### construct_blueprint(blueprint_id, schema_id)

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
   - Calls `provision_table(database_id, schema_name, table_name, fields, nodes)` to create the table with all fields and Data* nodes
   - Creates grants via `ensure_grant()` for each `grant_roles` x `grants` combination
   - Creates policies via `ensure_policy()` for each entry in `policies[]`
   - Enables RLS if `use_rls` is true (default) or if any policies are defined
   - Records table in `blueprint_construction` for state tracking
3. **Phase 2 — Relations:** For each entry in `definition.relations[]`:
   - Resolves `source_table` and `target_table` to table IDs by looking up `table_name` in the database
   - Creates relation via `provision_relation()`
4. **Phase 3 — Indexes:** For each entry in `definition.indexes[]` (or per-table `indexes[]`):
   - Resolves table and column names to IDs
   - Creates index via `provision_index()`
5. **Phase 4 — Full-Text Search:** For each entry in `definition.full_text_search[]` (or per-table `full_text_search[]`):
   - Creates FTS config via `provision_full_text_search()`
6. **Phase 5 — Unique Constraints:** For each entry in `definition.unique_constraints[]` (or per-table `unique_constraints[]`):
   - Creates unique constraint via `provision_unique_constraint()`
7. **On success:** Sets `status = 'constructed'`, saves `constructed_definition`
8. **On failure:** Sets `status = 'failed'`, saves `error_details`. Returns NULL.

**Idempotency:** All phases use `find_or_create_*` and `ensure_*` helpers, so calling `construct_blueprint()` twice with the same definition is safe — the second call is a no-op.

**Returns:** `jsonb` table_name_map (e.g. `{"products": "uuid", "categories": "uuid"}`) or NULL on failure.

### resolve_blueprint_table(database_id, table_name, schema_name)

Resolves a table name to a table ID within a database. If `schema_name` is provided, looks up in that specific schema. If omitted, resolves unambiguously (throws an error if multiple schemas contain a table with that name).

```typescript
// ORM
const result = await db.mutation.resolveBlueprintTable({
  input: { databaseId: '<UUID>', tableName: 'products', schemaName: 'app_public' }
}).execute();
```

### copy_template_to_blueprint(template_id, database_id, owner_id, name_override, display_name_override)

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

Two-level Merkle tree, computed automatically via the `_200_compute_blueprint_hash` trigger on INSERT/UPDATE of `definition`:

**Level 1 — Table hashes:**
```
For each entry in definition.tables[]:
  table_hash = uuid_generate_v5(uuid_ns_url(), table_entry::text)
```

Stored in `table_hashes` as `{"products": "uuid-hash", "categories": "uuid-hash"}` (keyed by `table_name`).

**Level 2 — Merkle root:**
```
concatenated = table_hash_1 || table_hash_2 || ... || relations_hash
definition_hash = uuid_generate_v5(uuid_ns_url(), concatenated)
```

If `definition.relations[]` exists and is non-empty, its hash is appended to the concatenation.

### Determinism

- `jsonb::text` provides canonical serialization — PostgreSQL stores JSONB keys in lexically sorted order internally
- Same definition content always produces the same hash, regardless of insertion order
- Uses the same `uuid_generate_v5(uuid_ns_url(), ...)` pattern as `object_store.object_hash_uuid()`

### Use cases

| Use Case | How |
|----------|-----|
| **Deduplication** | Two templates with identical definitions have the same `definition_hash` |
| **Provenance tracking** | After copying a template → blueprint, compare `definition_hash` to detect if the user modified the definition |
| **Structural comparison** | Compare individual `table_hashes` entries across different blueprints to find shared table structures |
| **Change detection** | `definition_hash` changes when any table or relation is modified; unchanged tables keep the same hash in `table_hashes` |

### Important notes

- Hash columns are **nullable** and **backend-computed** — clients should never set them directly
- The trigger fires `BEFORE INSERT OR UPDATE OF definition` (only when `definition` changes)
- Updating non-definition columns (e.g. `display_name`) does **not** recompute hashes
- When a template is copied to a blueprint, the hashes are inherited (same definition → same hash)

## Security Model

All provision functions (`provision_table`, `provision_relation`, etc.) and blueprint functions (`construct_blueprint`, `resolve_blueprint_table`) use explicit `SECURITY INVOKER`. Authorization is enforced by RLS policies on every `metaschema_public` table — each table has a `database_id` ownership check via `constructive_memberships_private.org_memberships_sprt`. This means:

- A user can only provision into databases they own
- Cross-tenant access is blocked at the RLS level — no function-level auth checks needed
- Trigger functions (`tg_insert_secure_table_provision`, `tg_insert_relation_provision`) also use `SECURITY INVOKER`

## RLS and Introspection

Blueprint-provisioned tables automatically flow through the existing introspection pipeline:

1. `construct_blueprint()` provisions tables via `provision_table()` and other provision procedures
2. These are standard Constructive tables — they appear in introspection like any other table
3. Running `cnc codegen` against the database generates typed SDK with full RLS support
4. The RLS policies specified in `definition.policies[]` are compiled via the Safegres protocol

No special handling is needed — blueprints compose the existing primitives.

## Cross-References

- **Definition format:** See [blueprint-definition-format.md](./blueprint-definition-format.md) for the blueprint definition format spec
- **Safegres policies:** See [constructive-safegres](../constructive-safegres/SKILL.md) for Authz* policy types used in `policies[]`
- **Codegen:** See [constructive-graphql](../constructive-graphql/SKILL.md) for generating typed SDK from provisioned tables
- **Server config:** See [server-config.md](./server-config.md) for running introspection and codegen
