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
4. Request construction (via constructBlueprint) -> a construction id, returned at once
5. Wait for the blueprint_construction row to reach `constructed` -> tables, relations, indexes, FTS, unique constraints exist
6. Run introspection + codegen -> typed SDK with RLS
```

## How Blueprints Provision

`constructBlueprint()` records a construction request and returns its id at once; a background job then builds the definition declaratively:

1. **Tables** are created with their fields, nodes, grants, policies, and RLS
2. **Relations** (BelongsTo, HasOne, HasMany, ManyToMany) are created between tables
3. **Indexes**, **full-text search**, and **unique constraints** are applied

The build takes 15–40 s for the curated blueprints — longer than a GraphQL request may run — so the mutation never waits for it. Poll the `blueprint_construction` row (see below) until `status` is `constructed` or `failed` before running introspection or codegen.

All build steps are **idempotent** — a second construction of the same definition is safe (it changes nothing).

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
| `definition_hash` | uuid | Merkle root hash of definition (backend-computed) |
| `table_hashes` | jsonb | Per-table content hashes keyed by table_name (backend-computed) |

### Constraints

- `UNIQUE (database_id, name)` — one blueprint per name per database
- `database_id` → FK to `database(id)` ON DELETE CASCADE
- `template_id` → FK to `blueprint_template(id)`

## blueprint_construction

One row per construction request: what `constructBlueprint()` creates and returns the id of, and where the build's outcome lands. A blueprint can be constructed more than once (into different schemas, or again after a failure); each request is its own row.

### Key columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | The construction id `constructBlueprint()` returns |
| `blueprint_id` | uuid | FK to `blueprint(id)` |
| `database_id` | uuid | Database the tables are provisioned into |
| `schema_id` | uuid | Schema the tables land in (the `schemaId` argument) |
| `status` | text | `pending` → `constructing` → `constructed` or `failed` |
| `constructed_definition` | jsonb | Snapshot of `blueprint.definition` taken when the request was recorded; the build runs from this, so later edits to the blueprint do not reach a request already queued |
| `table_map` | jsonb | `{ "<table_name>": "<table uuid>" }` for every table the build created; `{}` until `constructed` |
| `error` | jsonb | The coded error the build raised, when `failed`; `null` otherwise |
| `constructed_at` | timestamptz | When the build finished successfully |

Read it through the ORM as `db.blueprintConstruction` (owners see their own database's rows).

## Functions

### constructBlueprint(blueprintId, schemaId)

Requests a build of a blueprint and returns the construction id at once. The build itself — provisioning real database tables and relations across the phases below — runs in the background as the `blueprint:construct` job, under the requesting user's identity, and takes 15–40 s for the curated blueprints.

```typescript
// ORM — the mutation returns the construction id, not the tables
const { result: constructionId } = await db.mutation.constructBlueprint({
  input: { blueprintId: '<UUID>', schemaId: '<UUID>' }
}).execute();

// Wait for the build: poll the construction row until it settles
let construction;
do {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  construction = await db.blueprintConstruction.findOne({
    id: constructionId,
    select: { status: true, tableMap: true, error: true }
  }).execute();
} while (construction.status === 'pending' || construction.status === 'constructing');

if (construction.status === 'failed') throw new Error(JSON.stringify(construction.error));
const tableIds = construction.tableMap; // { "products": "<uuid>", "categories": "<uuid>" }

// CLI
constructive public:construct-blueprint --input.blueprintId <UUID> --input.schemaId <UUID>
# prints the construction id; then
constructive public:blueprint-construction get <construction-id>
```

**Behavior of the mutation (synchronous part):**
1. Validates the blueprint exists and the caller may provision into its database
2. Snapshots `blueprint.definition` into a new `blueprint_construction` row with `status = 'pending'` and `constructed_definition` set
3. Enqueues one `blueprint:construct` job for that row (job key `blueprint:construct:<construction id>`, a single attempt) attributed to the requester
4. Returns the construction id

**Behavior of the build (the job):** moves the row to `constructing`, then:
1. **Phase 0 — Entity Types:** For each entry in `definition.entity_types[]`:
   - Creates dynamic entity types (channels, teams, data rooms) via `entity_type_provision`
   - Provisions membership tables, capabilities, and entity-scoped storage
3. **Phase 0.5 — Storage:** For each entry in `definition.storage[]`:
   - `scope: "app"` (default): provisions app-level storage (`app_buckets`/`app_files`)
   - `scope: "org"`: provisions per-org/user storage (`org_buckets`/`org_files` with `owner_id`), creates AFTER INSERT seed trigger on entity table
   - Auto-injects a private `functions` bucket for `scope: "org"` when infra is installed
   - Applies RLS: `AuthzAppMembership` for app scope, `AuthzEntityMembership` for org scope
4. **Phase 1 — Tables:** For each entry in `definition.tables[]`:
   - Resolves `schema_name` (per-table override or falls back to the `schema_id` parameter)
   - Creates the table with all fields and Data* nodes
   - Applies grants for each `grants[].roles[]` x `grants[].privileges[]` combination
   - Applies policies for each entry in `policies[]`
   - Enables RLS if `use_rls` is true (default) or if any policies are defined
   - Records table in `blueprint_construction` for state tracking
5. **Phase 2 — Relations:** For each entry in `definition.relations[]`:
   - Resolves `source_table` and `target_table` to table IDs
   - Creates the relation (FK or junction table)
6. **Phase 3 — Indexes:** For each entry in `definition.indexes[]` (or per-table `indexes[]`):
   - Creates indexes on the resolved table/columns
7. **Phase 4 — Full-Text Search:** For each entry in `definition.full_text_search[]` (or per-table `full_text_search[]`):
   - Creates tsvector column + GIN index + auto-update trigger
8. **Phase 5 — Unique Constraints:** For each entry in `definition.unique_constraints[]` (or per-table `unique_constraints[]`):
   - Creates unique constraints on the resolved columns
9. **On success:** Sets the construction row's `status = 'constructed'`, fills `table_map` and `constructed_at`
10. **On failure:** Rolls the build back (no half-built tables), sets `status = 'failed'` and stores the coded error in `error`. The job is not retried; fix the definition and call `constructBlueprint()` again for a new construction row.

**Idempotency:** The build steps are idempotent — constructing the same definition twice is safe; the second build changes nothing.

**Returns:** `uuid` — the construction id. The table map lives on the construction row (`table_map`, e.g. `{"products": "uuid", "categories": "uuid"}`) once `status` is `constructed`.

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
4. The RLS policies specified in `definition.policies[]` are compiled via the Constructive Authz protocol

No special handling is needed — blueprints compose the existing primitives.

## Cross-References

- **Definition format:** See [blueprint-definition-format.md](./blueprint-definition-format.md) for the blueprint definition format spec
- **Constructive Authz policies:** See [constructive-security](../../constructive-security/SKILL.md) for Authz* policy types used in `policies[]`
- **Codegen:** See [constructive-codegen](../../constructive-codegen/SKILL.md) for generating typed SDK from provisioned tables
- **Server config:** See [server-config.md](../../constructive-platform/references/server-config.md) for running introspection and optional codegen
