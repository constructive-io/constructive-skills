# Node Type Registry

All node types available in blueprint table `nodes[]`. Each node is either a string shorthand (`'DataId'`) or an object with `$type` and `data` (`{ $type: 'SearchUnified', data: {...} }`).

## Data Nodes (Field Generators)

| Node | Fields Created | Paired Authz |
|------|---------------|--------------|
| `DataId` | `id` (UUID, PK) | — |
| `DataTimestamps` | `created_at`, `updated_at` | — |
| `DataDirectOwner` | `owner_id` (FK → users) | `AuthzDirectOwner` |
| `DataEntityMembership` | `entity_id` (FK → entity table) | `AuthzEntityMembership` |
| `DataOwnershipInEntity` | `owner_id` + `entity_id` | `AuthzEntityMembership` |
| `DataMemberOwner` | `owner_id` + `entity_id` (compound) | `AuthzMemberOwner` |
| `DataPublishable` | `is_published` (boolean) | `AuthzPublishable` |
| `DataI18n` | Creates `{table}_translations` table | — |

### nodeData options

- `DataTimestamps`: `{ include_id: false }` to skip adding `id`
- `DataMemberOwner`: `{ membership_type: 2 }` (required — specifies which SPRT)
- `DataI18n`: `{ fields: ['title', 'description'], languages: ['en', 'es'] }`

## Search Nodes

| Node | What It Creates |
|------|----------------|
| `SearchUnified` | embedding + BM25 + optional FTS + optional trigram (full search stack) |
| `SearchVector` | standalone vector(N) column + HNSW index |
| `SearchFullText` | tsvector column + GIN index + populate trigger |

See `constructive-search` skill for detailed configuration.

## Process Nodes

| Node | Purpose |
|------|---------|
| `ProcessFileEmbedding` | Extract text from files (PDF, DOCX, etc.), generate embeddings |
| `ProcessImageEmbedding` | Generate embeddings from images (multi-modal) |
| `ProcessChunks` | Split text into chunks, embed each chunk separately |

See `constructive-agents` skill for detailed configuration.

## Job Nodes

| Node | Purpose |
|------|---------|
| `JobTrigger` | Enqueue background job on row INSERT/UPDATE/DELETE |

See `constructive-jobs` skill for compound conditions and payload strategies.

## Event Nodes

| Node | Purpose |
|------|---------|
| `EventTracker` | Record events on row changes for analytics/gamification |
| `EventReferral` | Attribute events to inviters for referral chains |

See `constructive-events` skill for achievement wiring.

## Limit Nodes

| Node | Purpose |
|------|---------|
| `LimitCounter` | Per-user metered limits (e.g. "10 projects per user") |
| `LimitAggregate` | Per-entity aggregate limits (e.g. "50 seats per org") |
| `LimitFeatureFlag` | Boolean feature gates (e.g. "analytics enabled") |

See `constructive-billing` skill for full limits and billing reference.

## Security Nodes (Authz*)

18 policy types — see `constructive-security` skill for the full reference. Key types:

| Node | Intent |
|------|--------|
| `AuthzDirectOwner` | Direct personal ownership |
| `AuthzEntityMembership` | Bound membership-to-row (default for entity-scoped data) |
| `AuthzAppMembership` | App-level gate (hardcoded type=1) |
| `AuthzMemberOwner` | Compound: ownership AND entity membership |
| `AuthzPublishable` | Read-only: published content visible to all |
| `AuthzComposite` | Boolean tree (AND/OR/NOT) of other policies |
