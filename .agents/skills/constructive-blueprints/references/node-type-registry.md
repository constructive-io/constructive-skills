# Node Type Registry

All node types available in blueprint table `nodes[]`. Each node is either a string shorthand (`'DataId'`) or an object with `$type` and `data` (`{ $type: 'SearchUnified', data: {...} }`).

Source: `constructive-db/packages/node-type-registry/src/`

## Data Nodes — Field Generators

| Node | Description |
|------|-------------|
| `DataId` | UUID primary key with auto-generation |
| `DataTimestamps` | `created_at`, `updated_at` columns with auto-update trigger |
| `DataPeoplestamps` | `created_by`, `updated_by` user-tracking columns |
| `DataDirectOwner` | `owner_id` FK → users. Pairs with `AuthzDirectOwner` |
| `DataEntityMembership` | `entity_id` FK → entity table. Pairs with `AuthzEntityMembership` |
| `DataOwnershipInEntity` | `owner_id` + `entity_id`. Pairs with `AuthzEntityMembership` |
| `DataMemberOwner` | Compound `owner_id` + `entity_id`. Pairs with `AuthzMemberOwner` |
| `DataPublishable` | `is_published` boolean. Pairs with `AuthzPublishable` |
| `DataSoftDelete` | `deleted_at` timestamp + `is_deleted` boolean + partial index for active rows |
| `DataArchivable` | `is_archived` boolean + `archived_at` timestamp + partial index for active rows |
| `DataSlug` | Auto-generated URL-friendly slug via `inflection.slugify()` trigger |
| `DataTags` | `citext[]` tags column with GIN index for containment queries |
| `DataStatusField` | Status column with B-tree index, optional CHECK constraint for allowed values |
| `DataJsonb` | JSONB column with optional GIN index for containment queries |
| `DataCompositeField` | Derived text field concatenating multiple source fields via trigger (e.g. `embedding_text`) |
| `DataGenerated` | Native PostgreSQL `GENERATED ALWAYS AS (expr) STORED` column computed from a source expression |
| `DataI18n` | Creates `{table}_translations` table for multilingual content |
| `DataRealtime` | Per-table subscriber tables + statement-level triggers for realtime subscriptions |
| `DataBulk` | Enables bulk mutation smart tags (`+bulkInsert`, `+bulkUpsert`, `+bulkUpdate`, `+bulkDelete`) |
| `DataInflection` | Transforms field values via inflection ops (camel, pascal, slugify, plural, etc.) |
| `DataInheritFromParent` | BEFORE INSERT trigger copying fields from a parent table via FK lookup |
| `DataImmutableFields` | BEFORE UPDATE trigger preventing changes to specified fields after INSERT |
| `DataOwnedFields` | AFTER UPDATE trigger restricting which user can modify specific columns |
| `DataForceCurrentUser` | BEFORE INSERT trigger forcing a field to `current_user_id()` (anti-spoofing) |

## Check Nodes — Constraint Generators

| Node | Description |
|------|-------------|
| `CheckGreaterThan` | CHECK constraint: column > value, or column_a > column_b |
| `CheckLessThan` | CHECK constraint: column < value, or column_a < column_b |
| `CheckNotEqual` | CHECK constraint: column_a != column_b (prevents self-referencing) |
| `CheckOneOf` | CHECK constraint: column IN ('value1', 'value2', ...) |

## Relation Nodes

| Node | Description |
|------|-------------|
| `RelationBelongsTo` | FK field on source table → target table (e.g. `tasks.project_id`) |
| `RelationHasMany` | FK field on target table → source table (inverse of BelongsTo) |
| `RelationHasOne` | FK + unique constraint enforcing 1:1 cardinality |
| `RelationManyToMany` | Auto-creates junction table with FKs to both tables |
| `RelationSpatial` | Declares spatial predicate between geometry/geography columns (metadata-only) |

See `constructive-data-modeling` skill for relation configuration details.

## Search Nodes

| Node | Description |
|------|-------------|
| `SearchUnified` | Full search stack: embedding + BM25 + optional FTS + optional trigram |
| `SearchVector` | Standalone `vector(N)` column + HNSW index |
| `SearchFullText` | tsvector column + GIN index + populate trigger |
| `SearchBm25` | BM25 index on existing text column via pg_textsearch |
| `SearchTrgm` | GIN trigram indexes for fuzzy LIKE/ILIKE/similarity search |
| `SearchSpatial` | PostGIS geometry/geography column + spatial index (GiST/SP-GiST) |
| `SearchSpatialAggregate` | Materialized geometry field aggregating child geometries via triggers |

See `constructive-search` skill for configuration details.

## View Nodes

| Node | Description |
|------|-------------|
| `ViewTableProjection` | Simple column selection from a single source table |
| `ViewJoinedTables` | Multi-table join view (INNER, LEFT, RIGHT, FULL) |
| `ViewAggregated` | GROUP BY + aggregate functions for summary/reporting |
| `ViewFilteredTable` | Table projection with Authz* filter baked into the view |
| `ViewComposite` | Advanced view using composite AST (CTEs, UNIONs, complex subqueries) |

## Process Nodes

| Node | Description |
|------|-------------|
| `ProcessFileEmbedding` | Extract text from files (PDF, DOCX, etc.), generate embeddings |
| `ProcessImageEmbedding` | Generate embeddings from images (multi-modal) |
| `ProcessImageVersions` | Generate image variants (thumbnails, resized versions) |
| `ProcessChunks` | Split text into chunks, embed each chunk separately |
| `ProcessExtraction` | Extract structured data from files |

See `constructive-agents` skill for embedding pipeline details.

## Job Nodes

| Node | Description |
|------|-------------|
| `JobTrigger` | Enqueue background job on row INSERT/UPDATE/DELETE with compound conditions |

See `constructive-jobs` skill for payload strategies and compound conditions.

## Event Nodes

| Node | Description |
|------|-------------|
| `EventTracker` | Record events on row changes for analytics/gamification |
| `EventReferral` | Attribute events to inviters for referral chains |

See `constructive-events` skill for achievement wiring.

## Limit & Billing Nodes

| Node | Description |
|------|-------------|
| `LimitEnforceCounter` | Per-user metered limits — increment on INSERT, decrement on DELETE |
| `LimitEnforceAggregate` | Per-entity aggregate limits (org-level) — increment/decrement triggers |
| `LimitEnforceFeature` | Boolean feature gate — BEFORE INSERT check against cap tables |
| `LimitEnforceRate` | Sliding-window rate limits — BEFORE trigger calling `check_rate_limit()` |
| `LimitTrackUsage` | Billing usage recording — `record_usage` triggers on INSERT/DELETE/UPDATE |
| `LimitWarningCounter` | AFTER INSERT warning trigger when per-user usage crosses thresholds |
| `LimitWarningAggregate` | AFTER INSERT warning trigger when per-entity aggregate crosses thresholds |
| `LimitWarningRate` | AFTER INSERT warning trigger when rate-limit window crosses thresholds |

See `constructive-billing` skill for limits, billing, and plan cascade details.

## Security Nodes (Authz*)

19 registry-selectable policy types — see `constructive-security` skill for the full reference (it additionally documents the platform-applied `AuthzHumanOnly` guard).

| Node | Description |
|------|-------------|
| `AuthzDirectOwner` | Direct personal ownership (`owner_id = current_user`) |
| `AuthzDirectOwnerAny` | Ownership by any of multiple FK fields |
| `AuthzEntityMembership` | Membership-to-row binding (default for entity-scoped data) |
| `AuthzAppMembership` | App-level gate (hardcoded membership_type=1) |
| `AuthzOrgHierarchy` | Org hierarchy traversal for nested entity access |
| `AuthzMemberOwner` | Compound: ownership AND entity membership |
| `AuthzMemberList` | Named list of members with granted access |
| `AuthzPeerOwnership` | Ownership via peer relationship (e.g. collaborators) |
| `AuthzPublishable` | Published content visible to all (read-only) |
| `AuthzTemporal` | Time-bounded access (valid_from/valid_until) |
| `AuthzFilePath` | Ltree path-based access control |
| `AuthzComposite` | Boolean tree (AND/OR/NOT) of other policies |
| `AuthzRelatedEntityMembership` | Membership check via related table's entity |
| `AuthzRelatedMemberList` | Member list check via related table |
| `AuthzRelatedPeerOwnership` | Peer ownership via related table |
| `AuthzNotReadOnly` | Blocks mutations for read-only members |
| `AuthzAllowAll` | Permissive: grants access to all authenticated users |
| `AuthzDenyAll` | Restrictive: denies all access (explicit block) |
| `AuthzSystemOnly` | Restrictive: writes allowed only from system sessions (triggers/jobs), `role_type = 'system'` |

## Module Presets

Preconfigured module bundles — see `constructive-platform` skill for preset details.
