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
4. Execute blueprint → provisions tables + relations (via construct_blueprint)
5. Run introspection + codegen → typed SDK with RLS
```

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
| `definition` | jsonb | The blueprint definition (Hybrid A+C format) |
| `definition_schema_version` | text | Definition format version (default `1`) |
| `source` | text | Provenance: `user`, `system`, or `agent` |
| `complexity` | text | `simple`, `moderate`, `complex`, or NULL |
| `copy_count` | integer | How many blueprints copied from this template (auto-incremented) |
| `fork_count` | integer | How many derivative templates forked from this |
| `forked_from_id` | uuid | Parent template ID if forked (NULL for originals) |
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by ref (backend-computed) |

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
| `definition` | jsonb | Mutable blueprint definition (Hybrid A+C format) |
| `template_id` | uuid | Source template ID if copied (NULL if built from scratch) |
| `status` | text | `draft`, `constructed`, or `failed` |
| `constructed_at` | timestamptz | When construct_blueprint() succeeded |
| `error_details` | text | Error message if status is `failed` |
| `ref_map` | jsonb | Mapping of ref names to created table UUIDs (populated after construct) |
| `constructed_definition` | jsonb | Immutable snapshot of definition at construct-time |
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by ref (backend-computed) |

### Constraints

- `UNIQUE (database_id, name)` — one blueprint per name per database
- `database_id` → FK to `metaschema_public.database(id)` ON DELETE CASCADE
- `template_id` → FK to `blueprint_template(id)`

## Functions

### construct_blueprint(p_blueprint_id, p_schema_id)

Executes a draft blueprint, provisioning real database tables and relations.

```typescript
// ORM
const result = await db.mutation.constructBlueprint({
  input: { pBlueprintId: '<UUID>', pSchemaId: '<UUID>' }
}).execute();

// CLI
constructive public:construct-blueprint --input.pBlueprintId <UUID> --input.pSchemaId <UUID>
```

**Behavior:**
1. Validates blueprint exists and status is `draft`
2. **Phase 1 — Tables:** For each entry in `definition.tables[]`:
   - First `nodes[]` entry + first `policies[]` entry → creates the table via `secure_table_provision`
   - Remaining nodes → augment existing table (add columns/behaviors)
   - Remaining policies → add RLS policies to existing table
3. **Phase 2 — Relations:** For each entry in `definition.relations[]`:
   - Resolves `source_ref` and `target_ref` to table IDs via the ref_map built in Phase 1
   - Creates relation via `relation_provision`
4. **On success:** Sets `status = 'constructed'`, saves `ref_map` and `constructed_definition`
5. **On failure:** Sets `status = 'failed'`, saves `error_details`. Returns NULL.

**Returns:** `jsonb` ref_map (e.g. `{"products": "uuid", "categories": "uuid"}`) or NULL on failure.

### copy_template_to_blueprint(p_template_id, p_database_id, p_owner_id, p_name_override, p_display_name_override)

Creates a new blueprint by copying a template's definition.

```typescript
// ORM
const result = await db.mutation.copyTemplateToBlueprint({
  input: {
    pTemplateId: '<UUID>',
    pDatabaseId: '<UUID>',
    pOwnerId: '<UUID>',
    pNameOverride: 'my_store',           // optional
    pDisplayNameOverride: 'My Store'     // optional
  }
}).execute();

// CLI
constructive public:copy-template-to-blueprint \
  --input.pTemplateId <UUID> \
  --input.pDatabaseId <UUID> \
  --input.pOwnerId <UUID>
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

Stored in `table_hashes` as `{"products": "uuid-hash", "categories": "uuid-hash"}`.

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

## RLS and Introspection

Blueprint-provisioned tables automatically flow through the existing introspection pipeline:

1. `construct_blueprint()` provisions tables via `secure_table_provision` + `relation_provision`
2. These are standard Constructive tables — they appear in introspection like any other table
3. Running `cnc codegen` against the database generates typed SDK with full RLS support
4. The RLS policies specified in `definition.policies[]` are compiled via the Safegres protocol

No special handling is needed — blueprints compose the existing primitives.

## Cross-References

- **Definition format:** See [blueprint-definition-format.md](./blueprint-definition-format.md) for the Hybrid A+C definition spec
- **Safegres policies:** See [constructive-safegres](../constructive-safegres/SKILL.md) for Authz* policy types used in `policies[]`
- **Codegen:** See [constructive-graphql](../constructive-graphql/SKILL.md) for generating typed SDK from provisioned tables
- **Server config:** See [server-config.md](./server-config.md) for running introspection and codegen
