# Blueprint Definition Format

The blueprint `definition` is a JSONB document that declaratively describes a complete domain schema. It uses structured table config with inline `$type` discriminators for nodes, policies, and relations.

> **snake_case convention:** The definition uses **snake_case** keys (`table_name`, `grants`, `delete_action`, etc.) because it is stored as opaque JSONB in PostgreSQL. PostGraphile/GraphQL does not transform keys inside JSONB fields — the JSON is passed through as-is. This is intentional and differs from the camelCase conventions used in the SDK's ORM types (e.g. `BlueprintTemplate`, `Blueprint`). When writing blueprint definitions, always use snake_case.

## Top-Level Structure

```json
{
  "storage": [ ... ],
  "entity_types": [ ... ],
  "tables": [ ... ],
  "relations": [ ... ],
  "indexes": [ ... ],
  "full_text_search": [ ... ],
  "unique_constraints": [ ... ],
  "achievements": [ ... ]
}
```

`tables` is required. `storage`, `entity_types`, `relations`, `indexes`, `full_text_search`, `unique_constraints`, and `achievements` are optional top-level keys. Each of `indexes`, `full_text_search`, and `unique_constraints` can also be defined inline per-table (see below). `constructBlueprint()` collects from both locations.


## Top-Level Storage (Phase 0.5)

The optional top-level `storage` key is an **array** of storage entries. Each entry has an optional `scope` field that controls where the storage tables are created. It runs after entity types (Phase 0) but before tables (Phase 1).

- `scope: "app"` (default) — app-level storage (`app_buckets` / `app_files`), no `owner_id`, buckets seeded at migration time.
- `scope: "org"` — per-org/user storage (`org_buckets` / `org_files`), with `owner_id` column, buckets seeded per-entity via an AFTER INSERT trigger on the users table.

Only `"app"` and `"org"` are allowed. Child entity types get storage via `entity_types[].storage` instead.

When infra is installed (`infra_public` schema exists), a private `functions` bucket is auto-injected into any `scope: "org"` entry that doesn't already have one.

**App-scoped example** (default — equivalent to omitting `scope`):
```json
{
  "storage": [
    {
      "buckets": [
        { "name": "avatars", "is_public": true, "allowed_mime_types": ["image/png", "image/jpeg"] },
        { "name": "documents", "is_public": false, "max_file_size": 52428800 }
      ],
      "upload_url_expiry_seconds": 1800,
      "download_url_expiry_seconds": 3600,
      "default_max_file_size": 104857600,
      "allowed_origins": ["https://app.example.com"]
    }
  ]
}
```

**Org-scoped example** (per-org/user storage):
```json
{
  "storage": [
    {
      "scope": "org",
      "buckets": [
        { "name": "documents" },
        { "name": "media", "is_public": true }
      ]
    }
  ]
}
```

**Both scopes in one blueprint:**
```json
{
  "storage": [
    { "buckets": [{ "name": "avatars", "is_public": true }] },
    { "scope": "org", "buckets": [{ "name": "documents" }] }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `scope` | string | No | `"app"` | `"app"` for app-level storage, `"org"` for per-org/user storage |
| `storage_key` | string | No | `"default"` | Multi-module discriminator. Non-default keys create infix tables: `{prefix}_{key}_buckets` |
| `buckets` | array | No | `[]` | Bucket definitions to seed at deploy time |
| `policies` | jsonb[] | No | sensible defaults | Policy objects. If provided, fully replaces defaults |
| `upload_url_expiry_seconds` | integer | No | module default | Override presigned upload URL TTL |
| `download_url_expiry_seconds` | integer | No | module default | Override presigned download URL TTL |
| `default_max_file_size` | integer | No | module default | Override default max file size (bytes) |
| `allowed_origins` | text[] | No | `null` | CORS allowed origins |

Each bucket entry in `buckets[]`:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Bucket key (e.g. `"avatars"`, `"documents"`) |
| `description` | string | No | `null` | Human-readable description |
| `is_public` | boolean | No | `false` | Whether the bucket is publicly accessible |
| `allowed_mime_types` | text[] | No | `null` | MIME type whitelist (supports wildcards) |
| `max_file_size` | integer | No | `null` | Max file size in bytes (overrides module default) |
| `allowed_origins` | text[] | No | `null` | Per-bucket CORS override |

For default storage policies and the full policy format, see [storage-policies.md](./storage-policies.md).

## Entity Types (Phase 0)

`entity_types[]` provisions dynamic entity types **before** tables and relations. Each entry either **creates** a new entity type or **extends** an existing one:

- **Create** (has `name`): provisions a full entity table with membership modules, permissions, and security policies via `entity_type_provision`.
- **Extend** (no `name`, only `prefix`): looks up an existing entity type by prefix (e.g., `"org"`) and adds capabilities like storage without creating a new entity type.

This provides two equivalent paths for org storage — matching the pattern where constraints/indexes have both inline and top-level paths:

```json
// Path 1: top-level scope (Phase 0.5)
{ "storage": [{ "scope": "org", "buckets": [{"name": "documents"}] }] }

// Path 2: entity_types[] extend (Phase 0)
{ "entity_types": [{ "prefix": "org", "storage": [{ "buckets": [{"name": "documents"}] }] }] }
```

**Create example:**
```json
{
  "entity_types": [
    {
      "name": "Channel Member",
      "prefix": "channel",
      "description": "Membership to a channel.",
      "parent_entity": "org"
    }
  ]
}
```

**Extend example** (adds storage to the built-in org):
```json
{
  "entity_types": [
    {
      "prefix": "org",
      "storage": [{ "buckets": [{"name": "documents"}, {"name": "media"}] }]
    }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | No | — | Human-readable name. **Required** for creating new entity types. **Omit** to extend an existing type |
| `prefix` | string | **Yes** | — | SQL prefix for generated objects (e.g. `"channel"` → `channels` table). For extend entries, must match an existing entity type prefix (e.g. `"org"`) |
| `description` | string | No | `null` | Description of the entity type |
| `parent_entity` | string | No | `"org"` | Parent type prefix. Must be already provisioned |
| `table_name` | string | No | `prefix + 's'` | Override entity table name |
| `is_visible` | boolean | No | `true` | Gates the default `parent_member` SELECT policy. No-op when `table_provision` is supplied |
| `has_limits` | boolean | No | `false` | Provision a limits module |
| `has_profiles` | boolean | No | `false` | Provision a profiles module (named permission roles) |
| `has_levels` | boolean | No | `false` | Provision an events module (event tracking, achievements, gamification). See [`constructive-events`](../../constructive-events/SKILL.md) |
| `has_invites` | boolean | No | `false` | Provision entity-scoped invite tables (`{prefix}_invites`, `{prefix}_claimed_invites`) |
| `has_invite_achievements` | boolean | No | `false` | Auto-attach EventTracker to `claimed_invites` for invite-based achievements + invitee virality trigger. Requires `has_invites` AND `has_levels`. See [`constructive-events`](../../constructive-events/SKILL.md) |
| `has_storage` | boolean | No | `false` | Provision a storage module (buckets and files tables) |
| `storage_config` | object | No | `null` | Storage configuration when `has_storage` is true. Supports `is_public` (boolean) and `policies` (array of policy objects: `{ "$type", "privileges", "data", "tables" }`). See [storage-policies.md](./storage-policies.md) |
| `skip_entity_policies` | boolean | No | `false` | Escape hatch: apply zero default RLS policies on the entity table |
| `table_provision` | object | No | `null` | Override object for the entity table (shape mirrors `tables[]`: `nodes`, `fields`, `grants`, `use_rls`, `policies`). When supplied, `policies[]` **replaces** the 5 default entity-table policies; `is_visible` becomes a no-op |

**Processing order:** Entries are processed in array order. Parent types must appear before child types.

**Table map integration:** Entity tables created by Phase 0 are added to the internal `table_map`, so subsequent `tables` and `relations` can reference them by name (e.g. `"target_table": "channels"`).

See the [`constructive-entities`](../../constructive-entities/SKILL.md) skill for the full entity types reference.

## Table Entries

Each entry in `tables[]` defines one database table:

```json
{
  "table_name": "products",
  "description": "Product catalog entries available for purchase",
  "schema_name": "app_public",
  "nodes": ["DataId", "DataTimestamps"],
  "fields": [
    { "name": "title", "type": { "name": "text" }, "description": "Display name of the product" },
    { "name": "price", "type": { "name": "numeric" }, "description": "Unit price in the default currency" }
  ],
  "grants": [
    { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
  ],
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
| `description` | string | No | Table description. Emitted as `COMMENT ON TABLE` in PostgreSQL. Visible in database tools and introspection. |
| `schema_name` | string | No | Per-table schema override (e.g. `"app_public"`). Falls back to the `schemaId` param of `constructBlueprint()` |
| `nodes` | array | Yes | Data behavior node types to apply. **Must start with `DataId`** unless the table intentionally has no primary key |
| `fields` | array | No | Custom field definitions |
| `grants` | array | No | Unified grant objects: `[{ "roles": [...], "privileges": [[priv, cols], ...] }]`. Enables per-role targeting. Default: `[]` |
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

All 28 node types from the `node_type_registry`:

#### Core Identity & Ownership

| Node Type | Creates | `data` options | Paired Authz* |
|-----------|---------|----------------|---------------|
| `DataId` | `id uuid PRIMARY KEY DEFAULT uuidv7()` | `field_name` (default `'id'`) | — |
| `DataDirectOwner` | `owner_id uuid NOT NULL` + FK to users + index | `owner_field_name` (default `'owner_id'`), `include_user_fk` (default `true`), `create_index` (default `true`) | `AuthzDirectOwner` |
| `DataEntityMembership` | `entity_id uuid NOT NULL` + FK to users + index | `entity_field_name` (default `'entity_id'`), `include_user_fk` (default `true`), `create_index` (default `true`) | `AuthzEntityMembership` |
| `DataOwnershipInEntity` | Both `owner_id` and `entity_id` + FKs | `include_user_fk` (default `true`) | `AuthzDirectOwner` + `AuthzEntityMembership` |

**`DataId` is explicit:** There is no implicit ID creation. If a table needs a primary key (most do), `DataId` must be the first entry in `nodes[]`. This was a deliberate design choice — explicit is better than implicit.

#### Timestamps & Audit

| Node Type | Creates | `data` options |
|-----------|---------|----------------|
| `DataTimestamps` | `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` | (none) |
| `DataPeoplestamps` | `created_by uuid` (nullable), `updated_by uuid` (nullable) | `include_user_fk` (default `false`) |

#### Publishing & Lifecycle

| Node Type | Creates | `data` options | Paired Authz* |
|-----------|---------|----------------|---------------|
| `DataPublishable` | `is_published boolean NOT NULL DEFAULT false`, `published_at timestamptz` | (none) | `AuthzPublishable` |
| `DataSoftDelete` | `deleted_at timestamptz`, `is_deleted boolean NOT NULL DEFAULT false` | (none) | — |
| `DataStatusField` | Status `text NOT NULL` field + B-tree index | `field_name` (default `'status'`), `default_value` (default `'draft'`) | — |

#### Data Fields

| Node Type | Creates | `data` options |
|-----------|---------|----------------|
| `DataTags` | `text[]` tags field + GIN index | `field_name` (default `'tags'`) |
| `DataJsonb` | `jsonb` field with default `'{}'` | `field_name` (default `'data'`) |
| `DataCompositeField` | Derived `text` field that concatenates source columns + auto-update trigger | `field_name` (default `'embedding_text'`), `source_fields` (required, array of `{"field": "name", "weight": "A"\|"B"\|"C"\|"D"}`), `separator` (default `' '`) |
| `DataGenerated` | Native PostgreSQL generated column computed from source fields. Emits `GENERATED ALWAYS AS (expr) STORED` (persisted) or, on PostgreSQL 18+, `GENERATED ALWAYS AS (expr) VIRTUAL` (computed on read) depending on `generation_type`. `data` also supports `type` (`FieldType`, default `{ name: 'text' }`), `format` (`'labeled'|'plain'`, for `concat`), and `is_required` (default `false`) | `target` (required — field name), `kind` (`'expression'`, `'concat'`, `'slug'`, `'object_name'`, `'hash'`), `generation_type` (`'stored'` \| `'virtual'`, default `'stored'`), `source_field`/`source_fields`, `expression`, `separator` (default `' '`), `prefix`/`suffix` (for `object_name`), `algorithm` (default `'sha256'`) |

**`generation_type` — stored vs. virtual generated columns**

`DataGenerated` chooses how the computed value is materialized:

- **`'stored'` (default)** — `GENERATED ALWAYS AS (expr) STORED`. The value is computed on write and persisted on disk. Stored columns can be indexed, used as a primary key, and are included in logical replication. This is the right choice for `slug`, `hash`, and `object_name` columns that back unique indexes or lookups.
- **`'virtual'`** — `GENERATED ALWAYS AS (expr) VIRTUAL` (PostgreSQL 18+). The value is computed on read and never persisted, so it costs no storage and always reflects the current source fields. Virtual columns carry PostgreSQL restrictions: they **cannot be indexed, cannot be a primary key, and are not included in logical replication**. Prefer virtual for lightweight display-only derivations (e.g. a concatenated label) that you never filter, join, or index on.

**Example — stored slug (default), backs a unique index:**
```json
{
  "$type": "DataGenerated",
  "data": {
    "target": "slug",
    "kind": "slug",
    "source_field": "title"
  }
}
```

**Example — virtual display label (PostgreSQL 18+), never indexed:**
```json
{
  "$type": "DataGenerated",
  "data": {
    "target": "full_name",
    "kind": "concat",
    "source_fields": ["first_name", "last_name"],
    "separator": " ",
    "generation_type": "virtual"
  }
}
```

> **PG18 note:** `generation_type: 'virtual'` requires PostgreSQL 18. If a virtual column needs to be indexed, used as a primary key, or replicated, switch it back to `'stored'`.


#### Behavior Triggers (trigger-only — attach to existing fields)

| Node Type | Purpose | `data` options |
|-----------|---------|----------------|
| `DataSlug` | Auto-generates URL slugs from a source field | `field_name` (default `'slug'` — must already exist), `source_field_name` (defaults to `field_name`) |
| `DataInflection` | Applies chained text transformations via trigger | `field_name` (required — must already exist), `ops` (required, array of `'slugify'`\|`'lower'`\|`'upper'`\|`'trim'`\|`'unaccent'`) |
| `DataOwnedFields` | Prevents non-owners from modifying protected fields | `role_key_field_name` (required — identifies row owner), `protected_field_names` (required, array of field names) |
| `DataInheritFromParent` | Copies field values from parent row (via FK) on insert/update | `parent_fk_field` (required — FK field pointing to parent), `fields` (required, array of field names to copy) |
| `DataForceCurrentUser` | Forces a field to `current_user_id()` on insert/update | `field_name` (default `'actor_id'` — must already exist) |
| `DataImmutableFields` | Prevents fields from being modified after initial insert | `fields` (required, array of field names to protect) |
| `JobTrigger` | Creates triggers that enqueue background jobs via `app_jobs.add_job()` | `task_identifier` (required), `payload_strategy` (default `'row_id'`), `events` (default `['INSERT','UPDATE']`), `conditions` (compound WHEN clause — leaf conditions, AND/OR/NOT combinators, column-aware type resolution), `condition_field`/`condition_value` (legacy simple equality), `watch_fields` (optional array), `payload_fields` (optional array), `payload_custom` (object), `include_old` (default `false`), `include_meta` (default `false`), `job_key`, `queue_name`, `priority`, `run_at_delay`, `max_attempts` — see [`constructive-jobs`](../../constructive-jobs/SKILL.md) |
| `EventTracker` | Creates triggers that record events via the events module when rows change. Uses the same compound conditions system as `JobTrigger`. | `event_name` (required), `events` (default `['INSERT']`), `count` (default `1`), `toggle` (default `false`), `actor_field` (default `'owner_id'`, column-ref), `entity_field` (optional column-ref for entity-scoped events), `auto_register_type` (default `true`), `watch_fields` (optional array), `conditions` (compound WHEN clause — same syntax as JobTrigger), `condition_field`/`condition_value` (legacy) — see [`constructive-events`](../../constructive-events/SKILL.md) |

#### Limits & Feature Flags (trigger-only — requires `limits_module`)

| Node Type | Purpose | `data` options |
|-----------|---------|----------------|
| `LimitCounter` | Attaches increment/decrement triggers to track metered usage against configurable maximums. On INSERT the named limit is incremented; on DELETE it is decremented. | `limit_name` (required — must match a `limit_defaults` entry, e.g. `'projects'`, `'members'`), `scope` (default `'app'` — `'app'` for membership_type=1 or `'org'` for membership_type=2), `actor_field` (default `'owner_id'` — column-ref, field on target table holding the actor/entity ID), `events` (default `['INSERT','DELETE']` — which DML events to attach triggers for) |
| `LimitFeatureFlag` | Gates a table behind a feature flag backed by cap tables. Attaches a BEFORE INSERT trigger that checks `resolve_cap(feature_name) > 0`. Features are modeled as caps with `max=0` (disabled) or `max=1` (enabled) in `limit_caps_defaults`. | `feature_name` (required — cap name, must match a `limit_caps_defaults` entry), `scope` (default `'app'` — `'app'` or `'org'`), `entity_field` (default `'entity_id'` — column-ref, used for org-scope only to resolve per-entity cap overrides) |

**Prerequisites:** Both require `limits_module` to be provisioned for the target scope. Add `'limits_module:app'` (and/or `'limits_module:org'`) to your explicit module list — it ships in the `auth:email`, `b2b`, and `full` preset lists — or set `has_limits: true` on entity types. (Do not use `modules:['all']`; it is not a sentinel and installs nothing.)

**Example — limit projects per org:**
```json
{
  "table_name": "projects",
  "nodes": [
    "DataId", "DataTimestamps",
    { "$type": "DataEntityMembership", "data": { "entity_field_name": "org_id" } },
    { "$type": "LimitCounter", "data": { "limit_name": "projects", "scope": "org", "actor_field": "org_id" } }
  ],
  "fields": [ { "name": "title", "type": { "name": "text" } } ]
}
```

**Example — gate a table behind a feature flag:**
```json
{
  "table_name": "advanced_reports",
  "nodes": [
    "DataId", "DataTimestamps", "DataDirectOwner",
    { "$type": "LimitFeatureFlag", "data": { "feature_name": "advanced_reporting" } }
  ],
  "fields": [ { "name": "title", "type": { "name": "text" } } ]
}
```
Seed `limit_caps_defaults` with `{ name: 'advanced_reporting', max: 1 }` to enable, or `max: 0` to disable. Per-entity overrides go in `limit_caps`.

#### Composition

| Node Type | Purpose | `data` options |
|-----------|---------|----------------|
| `ProcessImageEmbedding` | Combines SearchVector + JobTrigger for image embedding pipelines | `field_name` (default `'embedding'`), `dimensions` (default `512`), `index_method` (`'hnsw'`\|`'ivfflat'`), `metric` (`'cosine'`\|`'l2'`\|`'ip'`), `task_identifier` (default `'process_image_embedding'`), `mime_patterns` (default `['image/%']`), `payload_custom` — see [`constructive-jobs`](../../constructive-jobs/SKILL.md) |

#### Internationalization

| Node Type | Creates | `data` options |
|-----------|---------|----------------|
| `DataI18n` | Creates a `{table}_translations` table with FK, `lang_code`, and copies of translatable fields. Unique constraint on `(parent_fk, lang_code)`. When `search` is provided, creates a SearchFullText tsvector on the translations table with dynamic per-row language stemming (30+ languages out of the box). | `fields` (required — array of field names to make translatable), `search` (optional — SearchFullText config, auto-sets `lang_column: 'lang_code'` for dynamic stemming) |

**Prerequisites:** Requires `i18n_module` to be provisioned. Add `'i18n_module'` to your explicit module list — it ships in the `full` preset list. (Do not use `modules:['all']`; it is not a sentinel and installs nothing.)

For full documentation including ORM queries, GraphQL localeStrings, and SQL search patterns, see [`constructive-i18n`](../constructive-i18n/SKILL.md).

**Example — make name and description translatable:**
```json
{
  "table_name": "products",
  "nodes": [
    "DataId", "DataTimestamps",
    { "$type": "DataI18n", "data": { "fields": ["name", "description"] } }
  ],
  "fields": [
    { "name": "name", "type": { "name": "text" } },
    { "name": "description", "type": { "name": "text" } },
    { "name": "price", "type": { "name": "numeric" } }
  ]
}
```

**Example — with multilingual full-text search (recommended):**
```json
{
  "$type": "DataI18n",
  "data": {
    "fields": ["name", "description"],
    "search": {
      "field_name": "search",
      "source_fields": [
        { "field": "name", "weight": "A" },
        { "field": "description", "weight": "B" }
      ]
    }
  }
}
```

Each translation row is stemmed in its own language — insert with `lang_code = 'spanish'` and "corriendo" stems to "corr". Insert with `lang_code = 'french'` and "courant" stems properly. No per-language configuration needed.

#### Realtime

| Node Type | Purpose | `data` options |
|-----------|---------|----------------|
| `DataRealtime` | Creates a per-table subscriber table in `subscriptions_public` with RLS policies derived from source table SELECT policies. Attaches statement-level `emit_change()` triggers to track changes. Requires `realtime_module`. | `operations` (default `['INSERT', 'UPDATE', 'DELETE']` — which DML operations to track), `subscriber_table_name` (default `'{source_table}_subscriber'`) |

**Prerequisites:** Requires `realtime_module` to be provisioned. Add `'realtime_module'` to your explicit module list. (No shipped preset includes it by default, and there is no `modules:['all']` sentinel — it installs nothing.)

**Example — enable realtime on a messages table:**
```json
{
  "table_name": "messages",
  "nodes": [
    "DataId", "DataTimestamps",
    { "$type": "DataEntityMembership", "data": { "entity_field_name": "channel_id" } },
    "DataRealtime"
  ],
  "fields": [ { "name": "body", "type": { "name": "text" } } ]
}
```

**Example — track inserts only:**
```json
{
  "$type": "DataRealtime",
  "data": { "operations": ["INSERT"] }
}
```

See [realtime-subscriptions.md](./realtime-subscriptions.md) for the full guide on subscription security, change delivery, and partitions.

#### Search & AI

| Node Type | Creates | `data` options |
|-----------|---------|----------------|
| `SearchUnified` | Orchestrates BM25 + trigram + FTS + composite field in one declaration | `source_fields` (optional, creates DataCompositeField first), `bm25` (sub-config), `trgm` (sub-config), `fts` (sub-config), `boost_recency` (optional `{"field": "updated_at"}`) |
| `SearchVector` | `vector(N)` column + HNSW/IVFFlat index + stale tracking + job enqueue | `field_name` (default `'embedding'`), `dimensions` (default `768`), `index_method` (`'hnsw'`\|`'ivfflat'`), `metric` (`'cosine'`\|`'l2'`\|`'ip'`), `include_updated_at` (default `true`), `enqueue_job` (default `true`), `job_task_name` (default `'generate_embedding'`), `source_fields` (optional), `index_options` (optional), `chunks_config` (optional: `content_field_name`, `chunk_size`, `chunk_overlap`, `chunk_strategy`, `enqueue_chunking_job`, `chunking_task_name`) — see [`constructive-agents`](../../constructive-agents/SKILL.md) |
| `SearchFullText` | `tsvector` column + GIN index + auto-update trigger | `field_name` (default `'search'`), `source_fields` (array of `{"field", "weight", "lang"}`), `lang_column` (optional — column name containing a `regconfig` value for dynamic per-row language stemming, e.g. `'lang_code'`), `search_score_weight` (default `1.0`) |
| `SearchBm25` | BM25 (pg_textsearch) index on existing text field | `field_name` (required — must already exist), `text_config` (default `'english'`), `search_score_weight` (default `1.0`), `k1` (optional BM25 tuning), `b` (optional BM25 tuning) |
| `SearchTrgm` | GIN trigram indexes on existing fields | `fields` (required, array of field names — must already exist). Sets `@trgmSearch` smart tag |
| `SearchSpatial` | PostGIS `geometry`/`geography` column + GiST index | `field_name` (default `'geom'`), `geometry_type` (default `'Point'`), `srid` (default `4326`), `dimension` (default `2`), `use_geography` (default `false`), `index_method` (`'gist'`\|`'spgist'`) |
| `SearchSpatialAggregate` | Materialized aggregate geometry on parent table + auto-update triggers | `field_name` (default `'geom_aggregate'`), `source_table_id` (required), `source_geom_field` (default `'geom'`), `source_fk_field` (optional), `aggregate_function` (default `'union'` — also `'collect'`, `'convex_hull'`, `'concave_hull'`), `geometry_type` (default `'MultiPolygon'`), `srid`, `dimension`, `use_geography`, `index_method` |

**Processing:** All nodes are processed together when the table is created. The table and all its fields are provisioned in one step.

### Fields

`fields[]` entries define custom columns beyond what nodes provide:

```json
{
  "name": "title",
  "type": { "name": "text" }
}
```

The `type` property is a **FieldType object** with the following shape:

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **(required)** PostgreSQL type name (e.g., `"text"`, `"integer"`, `"timestamptz"`, `"uuid"`, `"jsonb"`) |
| `schema` | string | Schema qualifier (e.g., `"public"`) |
| `args` | array | Type arguments (e.g., `[10, 2]` for `numeric(10,2)`, `["Point", 4326]` for `geometry(Point,4326)`) |
| `array_dimensions` | integer | Number of array dimensions. `1` = `text[]`, `2` = `text[][]` |
| `range` | string[] | Interval field range. 1-2 elements: `["day"]` or `["day", "second"]` |

The `default` property is a **FieldDefault object** — see [FieldDefault reference](#fielddefault-reference) below.

Optional field properties:

| Property | Type | Description |
|----------|------|-------------|
| `description` | string | Field description. Emitted as `COMMENT ON COLUMN` in PostgreSQL. Visible in database tools and introspection. |
| `is_required` | boolean | Whether the field is NOT NULL (default: `false`) |
| `default` | FieldDefault | Default value expression as a FieldDefault object |
| `min` | float | Minimum value constraint |
| `max` | float | Maximum value constraint |
| `regexp` | string | Regex validation pattern |
| `index` | string | Access method for automatic index creation: `"btree"`, `"gin"`, `"gist"`, `"brin"`, `"hash"` |

Example with index:
```json
{ "name": "email", "type": { "name": "citext" }, "index": "btree" }
{ "name": "tags", "type": { "name": "citext", "array_dimensions": 1 }, "index": "gin" }
{ "name": "location", "type": { "name": "geometry" }, "index": "gist" }
```

### FieldDefault Reference

The `default` property on fields uses a **FieldDefault object** representing a structured PostgreSQL default value expression:

| Property | Type | Description |
|----------|------|-------------|
| `value` | string \| number \| boolean \| null \| array \| object | Literal value |
| `function` | string | Function name (e.g., `"now"`, `"uuidv7"`, `"gen_random_bytes"`) |
| `schema` | string | Schema qualifier for function |
| `args` | array | Function arguments (recursive \u2014 each can be a FieldDefault) |
| `cast` | FieldType | Output type cast |
| `operator` | string | Binary operator (e.g., `"+"`, `"-"`, `"\\|\\|"`) |
| `left` | FieldDefault | Left operand for operator expression |
| `right` | FieldDefault | Right operand for operator expression |
| `sql_keyword` | string | SQL keyword (e.g., `"CURRENT_TIMESTAMP"`, `"CURRENT_USER"`) |

**Common patterns:**
```json
{ "function": "now" }
{ "function": "uuidv7" }
{ "value": true }
{ "value": "draft" }
{ "value": {}, "cast": { "name": "jsonb" } }
{ "value": [], "cast": { "name": "citext", "array_dimensions": 1 } }
{ "sql_keyword": "CURRENT_TIMESTAMP" }
{ "operator": "+", "left": { "function": "now" }, "right": { "value": "5 minutes", "cast": { "name": "interval" } } }
```

### Grants

`grants[]` is an array of grant objects, each with `roles` and `privileges`:

```json
[
  {
    "roles": ["authenticated"],
    "privileges": [
      ["select", "*"],
      ["insert", "*"],
      ["update", "title,price"],
      ["delete", "*"]
    ]
  }
]
```

Each entry grants every role in `roles[]` the cross-product of all `privileges[]` tuples. Each privilege tuple is `[privilege, columns]` where `"*"` means all columns.

**Per-role targeting:** Use multiple entries to assign different privileges to different roles:

```json
[
  { "roles": ["authenticated"], "privileges": [["select", "*"]] },
  { "roles": ["admin"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
]
```

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

See the [constructive-security](../../constructive-security/SKILL.md) skill for all 23 Authz* policy types and their config shapes.

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
    "grants": [
      { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["delete", "*"]] }
    ]
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

## Achievements (Phase 7)

The optional top-level `achievements[]` section defines gamification levels with requirements and optional credit rewards. Processed in **Phase 7** of `constructBlueprint()` — after all tables, relations, and other provisioning.

Requires `events_module` to be provisioned on the target entity scope (e.g., via `entity_types[].has_levels = true`). For credit rewards, also requires `limits_module` (e.g., `has_limits = true`).

```json
{
  "achievements": [
    {
      "name": "getting_started",
      "description": "Complete your profile",
      "priority": 10,
      "entity_prefix": "app",
      "requirements": [
        { "event_name": "avatar_uploaded", "count": 1 },
        { "event_name": "profile_completed", "count": 1 }
      ],
      "rewards": [
        { "reward_type": "limit_credit", "target_name": "projects", "amount": 5 }
      ]
    }
  ]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Unique level name (citext) |
| `description` | string | No | `null` | Human-readable description |
| `priority` | integer | No | `100` | Display ordering; lower = first |
| `entity_prefix` | string | No | `"app"` | Entity scope to resolve the correct events_module |
| `requirements` | array | **Yes** | — | Event requirements (see below) |
| `rewards` | array | No | `[]` | Credit rewards (see below) |

Each `requirements[]` entry:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_name` | string | **Yes** | Event type name (must match an EventTracker `event_name` or auto-generated event like `invite_claimed`) |
| `count` | integer | **Yes** | Number of events needed |
| `description` | string | No | Human-readable description |

Each `rewards[]` entry:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reward_type` | `"limit_credit"` \| `"meter_credit"` | **Yes** | — | Credit system to grant to |
| `target_name` | string | **Yes** | — | Limit name or meter slug |
| `amount` | integer | **Yes** | — | Credits to grant |
| `credit_type` | string | No | `"permanent"` | `"permanent"`, `"expiring"`, etc. |

For full examples including invite virality and cross-table achievements, see [`constructive-events`](../../constructive-events/SKILL.md).

## Complete Example: E-Commerce Blueprint

```json
{
  "tables": [
    {
      "table_name": "categories",
      "nodes": ["DataId", "DataTimestamps"],
      "fields": [
        { "name": "name", "type": { "name": "text" } },
        { "name": "slug", "type": { "name": "text" } },
        { "name": "description", "type": { "name": "text" } }
      ],
      "grants": [
        { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
      ],
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
        { "name": "title", "type": { "name": "text" } },
        { "name": "price", "type": { "name": "numeric" } },
        { "name": "description", "type": { "name": "text" } },
        { "name": "is_published", "type": { "name": "boolean" } }
      ],
      "grants": [
        { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"], ["delete", "*"]] }
      ],
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
        { "name": "total", "type": { "name": "numeric" } },
        { "name": "status", "type": { "name": "text" } }
      ],
      "grants": [
        { "roles": ["authenticated"], "privileges": [["select", "*"], ["insert", "*"], ["update", "*"]] }
      ],
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
