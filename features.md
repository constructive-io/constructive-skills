# Constructive — Feature Overview

Constructive is an open-source application platform that turns PostgreSQL into a complete backend. Define your schema declaratively, get a type-safe GraphQL API with authentication, authorization, real-time subscriptions, file storage, search, billing, and AI — all provisioned from a single blueprint.

---

## Authentication

Multiple authentication methods, composable via module presets. Every app gets server-side sessions, JWT-based access tokens, and API key support out of the box.

### Sign-In Methods

- **Email + password** — standard sign-up/sign-in with email verification and password reset
- **Magic links** — passwordless sign-in via one-time email links
- **Email OTP** — one-time passcodes delivered via email
- **Phone / SMS** — sign-in via phone number with SMS verification
- **OAuth / SSO** — federated identity via external providers (Google, GitHub, etc.)
- **Passkeys (WebAuthn)** — FIDO2 hardware key and biometric sign-in
- **Crypto wallets** — cryptocurrency address storage with network-specific validation (BTC, ETH)

### Multi-Factor Authentication

- TOTP authenticator apps (Google Authenticator, Authy, etc.)
- Email-based MFA challenges
- SMS-based MFA challenges
- Backup codes
- Configurable MFA challenge expiry and step-up windows
- Option to require MFA globally or only on new/untrusted devices

### Device Security

Three independent toggles that compose freely:

| Feature | Effect |
|---------|--------|
| Device tracking | Passive fingerprinting of sign-in devices |
| Trusted devices | Recognized devices bypass MFA |
| Device approval gate | Sign-in blocked on unrecognized devices until email confirmation |
| Force MFA on new devices | Unrecognized devices always require a second factor |

### Session Management

- Server-side sessions with configurable expiry
- Cookie-based authentication for browser apps
- Cross-origin token support for multi-domain setups
- Anonymous sessions for pre-auth flows (CSRF tokens, shopping carts)
- CAPTCHA integration (configurable site key)
- Rate limiting and throttling on auth endpoints

### API Keys

- Per-user API key generation for programmatic access
- Configurable access levels (full, read-only)
- Encrypted secret storage (per-user, per-org, and app-wide scopes)

---

## Authorization

Row-level security on every table, powered by the Safegres authorization protocol. Security policies are expressed as composable Authz* nodes — no hand-written SQL policies required.

### 19 Policy Types

| Policy | Purpose |
|--------|---------|
| `AuthzDirectOwner` | Personal ownership (`owner_id = current_user`) |
| `AuthzDirectOwnerAny` | Ownership by any of multiple FK fields (OR logic) |
| `AuthzAppMembership` | App-level membership gate |
| `AuthzEntityMembership` | Entity-scoped row access (org, team, channel) |
| `AuthzMemberOwner` | Compound: ownership AND entity membership |
| `AuthzRelatedEntityMembership` | Entity membership verified via join to related table |
| `AuthzPeerOwnership` | Peer visibility within the same entity |
| `AuthzRelatedPeerOwnership` | Peer visibility via join |
| `AuthzOrgHierarchy` | Manager/subordinate hierarchy traversal |
| `AuthzTemporal` | Time-window constraints (valid_from / valid_until) |
| `AuthzPublishable` | Draft/published gating (published content visible to all) |
| `AuthzMemberList` | Actor present in a UUID array column |
| `AuthzRelatedMemberList` | Actor in a related table's UUID array |
| `AuthzFilePath` | Path-scoped file sharing via ltree |
| `AuthzNotReadOnly` | Blocks mutations for read-only members |
| `AuthzComposite` | Boolean tree (AND / OR / NOT) of other policies |
| `AuthzAllowAll` | Unconditional allow |
| `AuthzDenyAll` | Unconditional deny |
| `AuthzSystemOnly` | Restrict writes to system sessions (triggers/jobs) — `role_type = 'system'` |

### Policy Composition

- **Permissive** (default) — policies are ORed: any passing policy grants access
- **Restrictive** — ANDed with permissive: all restrictive policies must pass
- **Composite** — arbitrary boolean trees when flat composition isn't enough
- Pattern: `(P₁ OR P₂ OR … Pₙ) AND R₁ AND R₂ AND … Rₘ`

### Grants & RLS

- Per-role grants (select, insert, update, delete) on any table
- RLS enabled per table with automatic policy generation
- `secureTableProvision` — single SDK call to create fields + grants + policies + enable RLS
- Read-only access mode (API-level toggle or per-member restriction)
- Granular permission levels per entity type

### Permission Defaults

When modules are installed, the platform automatically registers named permissions and sets default access levels for new members. No manual permission setup is needed — modules declare what permissions they require.

| Module | Granted to All Members | Admin-Only |
|--------|----------------------|------------|
| Agent | `invoke_agents` | `manage_agents` |
| Function | `invoke_functions` | `manage_functions` |
| Graph | `execute_graphs` | `manage_graphs` |
| Storage | `write_files`, `delete_files` | `manage_storage` |
| Events, Billing, Hierarchy, Namespace, Notifications, Rate Limits, Usage | — | *(all admin-only)* |

Key properties:

- **Automatic on module install** — permissions are registered and defaults applied when the module is provisioned via blueprint or `entityTypeProvision`
- **Admin management** — create/update defaults via `db.appPermissionDefault` / `db.orgPermissionDefault`, grant/revoke individual permissions via `db.appGrant` / `db.orgGrant`
- **Membership defaults** — `db.appMembershipDefault` / `db.orgMembershipDefault` control initial approval and verification state for new members
- **Helper queries** — look up permissions by name with `appPermissionsGetMaskByNames`, or resolve back to names with `appPermissionsGetByMask`

### Profiles

Role-based access control via named permission bundles. Profiles let admins define roles (e.g., Editor, Viewer, Manager) as reusable permission sets that can be assigned to memberships.

- **Enable** — `hasProfiles: true` on `entityTypeProvision`
- **Effective permissions** — `granted` (direct) + `profile.permissions` (from assigned profile). Admins and owners always get all permissions regardless of profile
- **Default profile** — set `isDefault: true` on a profile; new memberships are automatically assigned it
- **ORM tables** (created per scope when profiles are enabled):

| Table | Purpose |
|-------|---------|
| `profiles` | Named permission bundles (`name`, `slug`, `permissions`, `isDefault`, `isSystem`) |
| `profilePermissions` | Join table linking profiles to individual named permissions |
| `profileGrants` | Audit log of profile assignments/unassignments to memberships |
| `profileDefinitionGrants` | Audit log of permission additions/removals from profile definitions |

- **Membership integration** — each membership carries a `profileId` (nullable). Read with `db.appMembership` / `db.orgMembership` which expose `permissions` (effective), `granted` (direct), and `profileId`

### GuardStepUp

Blueprint node (guard category) that enforces step-up authentication before sensitive mutations. Attaches a BEFORE trigger that calls `requireStepUp()` to verify recent password or MFA verification.

- **`step_up_type`** — `"password"`, `"mfa"`, or `"password_or_mfa"` (default)
- **`events`** — which DML events require step-up: `["UPDATE", "DELETE"]` (default)
- **`step_up_window`** — configured in `appSettingsAuth` (default 30 minutes)
- **SDK** — `db.query.requireStepUp({ stepUpType: 'password' })` checks whether the current session needs step-up before a protected mutation

---

## Multi-Tenancy & Memberships

Hierarchical entity type system. Every scope of access — app, org, channel, department, team, data room — is a first-class entity with its own memberships, permissions, and security policies.

### Built-In Scopes

| Type ID | Name | Description |
|---------|------|-------------|
| 1 | App | Single-tenant app-level membership |
| 2 | Organization | Multi-tenant org-level membership |
| 3+ | Dynamic | Custom entity types you define (channels, teams, departments, data rooms) |

> **Internal scopes:** `platform` and `database` scopes also exist but are reserved for the Constructive platform itself. Application developers do not provision these directly.

### Entity Features

Every entity type automatically gets:

- Entity table with RLS
- Memberships module with role-based permissions
- Permission levels (admin, member, custom)
- Invite system (email invites, blank invites, batch invites)
- Profile assignment on invite acceptance
- Email auto-verification on invite claim

### Optional Per-Entity Modules

| Module | What It Provisions |
|--------|-------------------|
| Storage | Per-entity S3 buckets and file tables with scoped RLS |
| Agent | Threads, messages, tasks, prompts (core). Optional: plans (approval workflow), resources (unified skills + knowledge with vector search + chunking), agent registry with personas (all `AuthzMemberOwner` secured) |
| Namespace | Partitioned events log for K8s-style namespace metrics |
| Graphs | Computation graphs with executions and outputs |
| Merkle store | Content-addressed state tracking (objects, stores, commits, refs) |
| Limits | Per-entity metered quotas and feature flags |
| Levels | Achievement tiers and progression |

### Hierarchy

Nested entity types with parent-child relationships:

```
app (1)
  └── org (2)
        ├── channel (3)
        ├── department (4)
        │     └── team (5)
        └── data_room (6)
```

---

## Data Modeling

Declarative schema-as-code via blueprints. Define your entire data model — tables, fields, relations, constraints, indexes, security, and behavior triggers — in a single JSONB document.

### Blueprints

- Portable, shareable JSONB schema definitions
- Blueprint templates for marketplace distribution
- Merkle-style definition hashing (UUIDv5) for deduplication and provenance
- Per-table structural hashes for diffing
- Multi-phase construction lifecycle (entity types → storage → tables → relations → post-processing)

### Field Types

`text`, `integer`, `bigint`, `boolean`, `uuid`, `jsonb`, `timestamptz`, `date`, `numeric`, `citext`, `ltree`, `vector(N)`, and custom enums.

### Relations

| Type | Description |
|------|-------------|
| BelongsTo | FK on source → target PK |
| HasMany | FK on target → source PK |
| HasOne | FK + unique constraint (1:1) |
| ManyToMany | Auto-created junction table with security forwarding |

### Indexes

B-tree, GIN, GiST, BRIN, and hash access methods. Partial indexes, unique indexes, and expression indexes supported.

### Behavior Triggers (Node Types)

79 declarative node types across 12 categories — add behavior to any table without writing SQL:

| Category | Nodes | Examples |
|----------|-------|---------|
| **Data** (23) | Field generators and triggers | Auto-timestamps, people-stamps, slugs, tags, soft delete, archivable, status fields, JSONB columns, composite fields, publish state, i18n translations, bulk mutations, field protection, value inheritance, entity ownership |
| **Search** (7) | Search indexes | Full-text (tsvector + GIN), BM25 ranking, trigram fuzzy match, vector embeddings (HNSW/IVFFlat), PostGIS spatial, spatial aggregates, unified multi-algorithm |
| **Security** (19) | RLS policy types | All 19 Authz* types listed above |
| **Relation** (5) | Relation types | BelongsTo, HasMany, HasOne, ManyToMany, Spatial |
| **View** (5) | Materialized views | Table projections, joined tables, aggregated views, filtered views, composite CTEs |
| **Process** (5) | File/media processing | File embedding, image embedding, image versions, text chunking, structured extraction |
| **Job** (1) | Background jobs | Row-change triggers with compound conditions |
| **Event** (2) | Analytics | Event tracking, referral attribution |
| **Limit** (8) | Usage enforcement | Per-user counters, per-entity aggregates, feature flags, rate limits, usage tracking, threshold warnings |
| **Guard** (1) | Auth enforcement | Step-up re-authentication gate |
| **Check** (4) | Constraints | Greater-than, less-than, not-equal, one-of |

### Module Presets

Pre-configured module bundles for common app shapes:

| Preset | What You Get |
|--------|-------------|
| `minimal` | Users, sessions, RLS, secrets — no server-side auth |
| `auth:email` | Email + password, single-tenant |
| `auth:email+magic` | + magic links, email OTP |
| `auth:sso` | + OAuth/SSO providers, connected accounts |
| `auth:passkey` | + WebAuthn passkeys |
| `auth:hardened` | + rate limits, device approval, SMS, all auth methods |
| `b2b` | + orgs, invites, permissions, levels, profiles, hierarchy |
| `b2b:storage` | + file upload infrastructure (buckets, files, RLS) |
| `full` | Everything — i18n, storage, billing, notifications, devices, crypto |

---

## Search

Six search strategies, from keyword matching to semantic vector similarity, unified into a single composable system. Add search to any table with a blueprint node — no application code required.

### Strategies

| Strategy | Technology | Best For |
|----------|------------|----------|
| **Full-text (tsvector)** | PostgreSQL `tsvector` + GIN index | Keyword search with language-aware stemming |
| **BM25** | `pg_textsearch` extension (BM25 scoring via `<@>` operator) | Relevance-ranked full-text retrieval |
| **Trigram** | `pg_trgm` extension + GIN index | Fuzzy matching, typo tolerance, autocomplete |
| **Vector (pgvector)** | `pgvector` extension + HNSW index | Semantic similarity, embeddings, RAG |
| **Spatial (PostGIS)** | `postgis` extension + GiST index | Geographic proximity, geofencing, spatial containment |
| **Unified** | Composite of all above | Fan-out a single query across multiple algorithms with RRF (Reciprocal Rank Fusion) scoring |

### Vector Search Details

- Index types: **HNSW** (default) and **IVFFlat**
- Distance metrics: **cosine** (default), **L2** (Euclidean), **inner product**
- Configurable vector dimensions (default: 768)
- Stale-marking triggers for automatic re-embedding on data changes
- Chunk tables for long documents (configurable chunk size, overlap, and strategy)
- Chunking strategies: fixed, sentence, paragraph, semantic

### Spatial Search Details

13 relationship operators (`contains`, `within`, `intersects`, `crosses`, `touches`, `overlaps`, `disjoint`, `equals`, `covers`, `coveredBy`, `containsProperly`, `orderingEquals`, `intersects3D`), distance queries (`withinDistance` via ST_DWithin), and 10 bounding box operators. Works on both `geometry` and `geography` column types with GeoJSON input/output.

### Multilingual Search

Full-text search with per-row language stemming. 30 built-in PostgreSQL text search configurations:

`simple`, `arabic`, `armenian`, `basque`, `catalan`, `danish`, `dutch`, `english`, `finnish`, `french`, `german`, `greek`, `hindi`, `hungarian`, `indonesian`, `irish`, `italian`, `lithuanian`, `nepali`, `norwegian`, `portuguese`, `romanian`, `russian`, `serbian`, `spanish`, `swedish`, `tamil`, `turkish`, `yiddish`

Custom PostgreSQL text search configurations are also supported.

### Unified Search

`SearchUnified` orchestrates multiple algorithms in a single declaration — embedding + BM25 + optional full-text + optional trigram. Results are fused via Reciprocal Rank Fusion (RRF) — rank-based scoring that handles incompatible score scales (e.g. BM25 unbounded negatives vs tsvector [0,1]) by comparing rank positions, not raw scores. The composite `searchScore` (0–1) and `unifiedSearch` filter provide a single API for cross-algorithm search.

---

## AI & Embeddings

Built-in embedding pipeline and multi-provider LLM integration. Vector columns, stale-tracking triggers, background workers, and RAG patterns — all declarative.

### Embedding Pipeline

```
Blueprint node (SearchUnified / SearchVector / ProcessFileEmbedding)
  → Row change triggers stale-marking
    → Job enqueued via app_jobs
      → Worker generates embedding via configured provider
        → Vector stored in HNSW-indexed column
```

### Process Nodes

| Node | Purpose |
|------|---------|
| `ProcessFileEmbedding` | Extract text from files (PDF, DOCX, etc.), generate embeddings. Supports direct mode (whole-file, e.g. CLIP for images) and extract mode (file → text → chunks → vectors) |
| `ProcessImageEmbedding` | Image-specific preset with CLIP defaults (512 dimensions) |
| `ProcessChunks` | Split text into chunks with per-chunk embeddings. Configurable chunk size, overlap, and strategy |
| `ProcessExtraction` | Extract structured data from files |
| `ProcessImageVersions` | Generate image variants (thumbnails, resized versions) |

### LLM Integration (agentic-kit)

Multi-provider LLM client supporting:

- **Ollama** — local/self-hosted models
- **Anthropic** — Claude models
- **OpenAI** — GPT models

### Agent Module

Per-entity AI infrastructure provisioned via the `agent_module`. Core tables (always created):

| Table | Purpose |
|-------|---------|
| `agent_threads` | Conversation threads |
| `agent_messages` | Messages within threads (attributed via `actor_id`) |
| `agent_tasks` | Actionable tasks (attributed via `actor_id`) |
| `agent_prompts` | Prompt templates |

Optional extensions via flags:

| Flag | Tables Added | Purpose |
|------|-------------|----------|
| `has_plans` | `agent_plans` | Plans with approval workflow (linked to threads) |
| `has_resources` | `agent_resources` + `agent_resource_chunks` | Unified skills + knowledge with full-text search, vector embeddings (HNSW), and automatic text chunking for RAG retrieval |
| `has_agents` | `agent_personas` + `agents` | Agent registry with persona templates (system prompts, linked resources, model config) and agent instances (with sub-agent hierarchy via `parent_id`) |

`has_agents` implies `has_resources` (agents need resources to reference).

#### Access Modes

| `shared` Flag | Security Policy | Behavior |
|---------------|----------------|----------|
| `false` (default) | `AuthzMemberOwner` | Private — only the thread creator sees their threads/messages within the entity |
| `true` | `AuthzEntityMembership` | Multiplayer — all entity members can see and contribute to all threads |

#### Multi-Agent Attribution

When `has_agents` is enabled, `agent_messages` includes an `agent_id` FK for attributing messages to specific AI agents. This allows multiple agents to participate in a single thread, each identified by their persona.

### RAG Patterns

End-to-end retrieval-augmented generation: embed documents → vector similarity search via ORM → feed retrieved context to LLM via agentic-kit.

---

## File Storage & Uploads

S3-compatible file upload pipeline. Files are uploaded directly to S3/MinIO via presigned URLs — no file bytes ever route through the GraphQL server.

### Upload Flow

```
Client → requestUploadUrl() → GraphQL server returns { uploadUrl, key }
Client → PUT file to uploadUrl → S3/MinIO
Client → downloadUrl query → GraphQL server returns presigned GET URL
```

### Bucket Types

| Type | Visibility | RLS | Use Case |
|------|-----------|-----|----------|
| Public | Publicly accessible | Minimal | Marketing assets, public images |
| Private | Authenticated only | Full | User documents, sensitive files |
| Entity-scoped | Per-org/team | Entity membership | Team file storage, data rooms |

### Storage Features

- Presigned upload and download URLs (configurable expiry)
- Content-hash deduplication (identical files stored once)
- MIME type restrictions per bucket
- File size limits per bucket
- Per-bucket RLS policies (any Authz* type)
- Multi-scope bucket resolution (`bucketKey` + `ownerId`)
- Auto-provisioning of S3 buckets on row creation
- File events audit log
- Versioning support

---

## Billing & Limits

Two composable systems: **limits** for blueprint-level usage enforcement, and **billing** for meter-based usage tracking with credits.

### Limits

Three blueprint nodes for declarative enforcement:

| Node | What It Does |
|------|-------------|
| `LimitCounter` | Per-user metered limits — rejects INSERT when `count >= max` |
| `LimitAggregate` | Per-entity aggregate limits (e.g., "50 seats per org") |
| `LimitFeatureFlag` | Boolean feature gates — enables/disables features via cap tables |

Plus rate limiting (`LimitEnforceRate` — sliding-window checks), usage tracking (`LimitTrackUsage`), and threshold warnings (`LimitWarningCounter`, `LimitWarningAggregate`, `LimitWarningRate`).

### Billing Meters

A meter defines a billable dimension:

- Configurable period intervals (monthly, yearly, or never-reset)
- Rollover caps for unused quota
- `record_usage` and `check_billing_quota` mutations
- Universal credits — a shared fallback pool that any meter can draw from (configurable `credit_cost` per unit)

### Credits

Three credit types:

| Type | On Period Reset | Example |
|------|-----------------|---------|
| Permanent | Survives indefinitely | One-time purchase |
| Period | Zeroed on reset | "1,000 calls/month with Pro" |
| Rollover | Unused carries forward (capped) | "Unused credits roll over, max 500" |

Credits support `expires_at` for lazy expiration enforcement.

### Plans & Cap Tables

- `limit_caps_defaults` — per-scope default values for all limits
- `limit_caps` — per-entity overrides
- Plans are cap table presets applied to entities via the `apply_plan` cascade
- Transfer quota between entities

### Billing Provider Bridge

Integration scaffolding for external billing providers:

- `billing_customers` — linked to Stripe, Paddle, etc.
- `billing_products` — product/plan catalog
- `billing_subscriptions` — subscription state
- `billing_events` — webhook deduplication via `process_billing_event()`

---

## Events & Gamification

Event tracking, achievements, and referral attribution — all configured through blueprints.

### Event Tracking

`EventTracker` blueprint node records events on row INSERT/UPDATE/DELETE:

- Compound conditions (AND/OR/NOT combinators with column-aware type resolution)
- Watch fields — only fire on specific column changes
- Partitioned event log with time-based retention
- Running event aggregates per user

### Achievements

Define levels with requirements and rewards:

- Level-based progression (Bronze → Silver → Gold)
- Per-level requirements (event count thresholds)
- Automatic credit grants on achievement (limit credits and meter credits)
- Period-aware recurring achievements (re-qualify each period)
- Invite-based achievements (tier based on invitee count)

### Referral System

`EventReferral` node attributes events to the user's inviter chain:

- Multi-level referral chains (`max_depth` 1–10) — walks up the `claimed_invites` chain N levels
- Each ancestor inviter gets credit for the event
- Composable with achievements for viral growth loops

---

## Real-Time Subscriptions

GraphQL subscriptions with automatic RLS enforcement. Tables opt in with a single `DataRealtime` node — the platform handles everything else.

### How It Works

1. Add `DataRealtime` to a table's blueprint nodes
2. Platform creates a subscriber table in `subscriptions_public`
3. SELECT policies on the source table are analyzed and replicated as subscriber RLS
4. Statement-level triggers fire `emit_change()` on INSERT/UPDATE/DELETE
5. Changes stream to clients via WebSocket (graphql-ws protocol)

### Subscription Features

- Auto-generated `onXxxChanged` subscription fields
- Sparse-set row filtering (`ids: [UUID!]` — subscribe to specific rows)
- Overflow detection (>50 rows/statement or >50 events/sec/table triggers INVALIDATE)
- Partitioned change log for durable event storage
- Codegen'd subscription hooks (`useXxxSubscription`) and connection state hooks
- ORM realtime (`client.subscribe()`)
- Runtime toggle (`enable_realtime` in database/API settings)

### Notifications Module

Built-in notification infrastructure (included in `b2b` and `full` presets):

- Notifications table with recipient lists, categories, topics, and priority
- Per-user read state tracking (read/unread per notification)
- Notification preferences (per-user enabled flag, digest frequency, quiet hours, timezone, default channels)
- Notification channels (device/push endpoints for delivery routing)
- Delivery log (audit trail of sent notifications)
- Optional: topic subscriptions, digest metadata, organization-level settings

---

## Internationalization

Multilingual content and search at every layer — database, GraphQL API, and client.

### Translation Tables

`DataI18n` blueprint node creates `{table}_translations` with per-locale copies of translatable fields. Define which fields to translate and which languages to support.

### Multilingual Full-Text Search

Compose `DataI18n` with `SearchFullText` using `lang_column` for dynamic per-row stemming. Each row is stemmed in its own language — a Spanish article is stemmed with Spanish rules, a French article with French rules.

**30 languages** supported via PostgreSQL built-in text search configurations:

`simple`, `arabic`, `armenian`, `basque`, `catalan`, `danish`, `dutch`, `english`, `finnish`, `french`, `german`, `greek`, `hindi`, `hungarian`, `indonesian`, `irish`, `italian`, `lithuanian`, `nepali`, `norwegian`, `portuguese`, `romanian`, `russian`, `serbian`, `spanish`, `swedish`, `tamil`, `turkish`, `yiddish`

### App-Level Language Config

`i18n_module` provisions app settings with default language, supported languages array, and fallback chain for missing translations.

### GraphQL Content Negotiation

`graphile-i18n` plugin adds `localeStrings` computed fields with `Accept-Language` header negotiation and automatic fallback.

---

## Background Jobs

Declarative background job system with compound conditions, powered by a Knative worker pipeline.

### Job Triggers

`JobTrigger` blueprint node creates PostgreSQL AFTER triggers that enqueue jobs to `app_jobs.add_job()` on row changes:

- Trigger on INSERT, UPDATE, DELETE (configurable)
- Watch fields — only fire when specific columns change
- Compound conditions — AND/OR/NOT combinators for complex WHEN clauses
- Four payload strategies: `row_id` (default), `row` (full row), `fields` (selected columns), `custom` (key-to-column mapping)
- Job deduplication via `job_key`
- Queue routing, priority levels, delayed execution, max retry attempts (default: 25)
- Entity context forwarding for scoped processing

### Scheduled Jobs

Cron-style recurring jobs via `app_jobs.add_scheduled_job()`.

### Cloud Functions

Knative-style TypeScript HTTP cloud functions for handling jobs:

- Email sending, webhook processing, billing sync, embedding generation
- Direct GraphQL client and database access from function handlers
- Docker build and Kubernetes deployment support

---

## GraphQL API & Code Generation

PostgreSQL schemas are automatically exposed as a fully-typed GraphQL API via PostGraphile v5, with code-generated TypeScript clients.

### GraphQL Server

- PostGraphile v5 with schema introspection
- GraphiQL explorer for development
- Relay-spec cursor and offset pagination
- Smart tags for GraphQL schema customization
- Multiple APIs per database with independent schema grants
- Public (domain-based) and admin (header-based) routing modes

### Code Generation Pipeline

Generate typed TypeScript clients from any GraphQL schema:

| Target | Output | Use |
|--------|--------|-----|
| ORM | Prisma-like typed client | Server-side queries with `findMany`, `findOne`, `create`, `update`, `delete` |
| React Query hooks | `useXxxQuery` / `useXxxMutation` hooks | Client-side data fetching with cache management |
| CLI | Interactive command-line client | Admin scripting and automation |
| Schemas | GraphQL SDL export | Schema distribution |

Schema sources: GraphQL SDL files, running endpoints, database connections, or pgpm modules.

### Generated ORM

- Prisma-style query API (`db.user.findMany()`, `db.user.create()`, etc.)
- Discriminated union error handling (`.execute()` returns `{ data, errors }`, `.execute().unwrap()` throws)
- Cursor-based and offset pagination with `__pageInfo` and `__totalCount`
- `_meta` introspection endpoint for runtime table metadata (field names, types, constraints, relations)
- Runtime query builder (`@constructive-io/graphql-query`) for programmatic query construction

### Generated React Query Hooks

- Auto-generated query and mutation hooks per table
- Query key management for cache invalidation
- Optimistic update support
- Subscription hooks for real-time data

---

## Frontend Components

50+ React components built on Base UI and Tailwind CSS v4, with a shadcn-compatible registry.

### Component Categories

| Category | Components |
|----------|-----------|
| Forms | Input, Select, Checkbox, Radio, Switch, DatePicker, Textarea |
| Overlays | Dialog, Sheet (with stacking), Popover, Tooltip, Dropdown Menu |
| Layout | Sidebar (collapsible), Tabs, Accordion, Separator, Stack Navigation |
| Data Display | Table, Card, Badge, Avatar |
| Advanced Inputs | Combobox (async loading), Command Palette, Multi-Select |
| Motion | Enter/exit animations, transitions |

### CRUD Stack Cards

iOS-style slide-in panels for create/edit/delete workflows:

- Sticky Cancel/Save/Delete footers
- Natural card stacking (confirm-delete on top of edit)
- Card push/pop navigation

### Dynamic Meta Forms

Zero-config CRUD forms for any Constructive-provisioned table:

- `_meta` query introspects field names, types, required status, FK relationships, and mutation names at runtime
- No static field configuration needed
- Locked FK pre-fill for related records
- One-to-many and many-to-many relationship patterns

### Theming

- OKLCH color tokens with CSS custom properties
- Dark mode support
- Theme switching
- cva variant architecture with `data-slot` composition

---

## Flow-Based Programming

Graph module and merkle store for SDK-authorable computation graphs.

### Graph Module

Entity-scoped computation graphs with execution tracking:

| Table | Purpose |
|-------|---------|
| `{prefix}_graphs` | Graph definitions (name, config) |
| `{prefix}_graph_executions` | Execution records (status, input, timing) |
| `{prefix}_graph_outputs` | Output artifacts per execution |

### Merkle Store

Content-addressed state tracking (like a git object store):

| Table | Purpose |
|-------|---------|
| `{prefix}_objects` | Content-addressed blobs (hash → data) |
| `{prefix}_stores` | Named stores |
| `{prefix}_commits` | Commit records (parent, tree, message) |
| `{prefix}_refs` | Named references (branches/tags → commits) |

Objects are deduplicated via `uuid_generate_v5(uuid_ns_url(), jsonb::text)`.

### FBP Toolkit

Companion packages for flow-based programming:

- **fbp-types** — type system for flow ports and connections
- **fbp-spec** — specification language for flow definitions
- **fbp-evaluator** — execution engine for flow specs
- **fbp-graph-editor** — visual graph editor component

---

## Platform & Operations

### Database Migrations

Deterministic, plan-driven migrations via pgpm (PostgreSQL Package Manager):

- Dependency-managed module system
- Deploy, verify, and revert commands
- Tagged releases for version control
- Workspace and module scaffolding templates

### Deployment

- Docker Compose for local development (PostgreSQL, MinIO, application servers)
- Multi-stage Docker image builds
- CLI shims (`constructive`, `cnc`, `pgpm`)
- Makefile targets for common operations

### Environment Configuration

- Unified, type-safe configuration (`@pgpmjs/env` + `@constructive-io/graphql-env`)
- Merge hierarchy: defaults → config file → env vars → runtime overrides
- Config file reference (`pgpm.json`)

### CNC CLI

Command-line interface for Constructive platform operations:

- Raw GraphQL query execution against any API
- Context management (like kubectl) — create, list, switch, delete
- Secure per-context token storage with expiration
- Code generation orchestration

### Services & Routing

- Multiple APIs per database with independent schema grants
- Domain and subdomain routing
- Public vs admin API routing modes
- Site entity for frontend configuration

---

## Developer Experience

### Type Safety End-to-End

PostgreSQL schema → PostGraphile introspection → GraphQL SDL → TypeScript codegen → fully typed ORM, hooks, and CLI. Schema changes propagate automatically.

### Declarative Everything

Define authentication, authorization, data model, search, billing, events, real-time, and AI in a single blueprint JSONB. Run `construct_blueprint()` and the platform provisions all underlying PostgreSQL objects.

### Generated Clients Always In Sync

ORM, React Query hooks, and CLI are regenerated from the live schema. No drift between database and application code.

### `_meta` Introspection

Runtime table metadata enables dynamic form generation — build CRUD UIs for any table without knowing the schema at compile time.

### PNPM Workspace Support

First-class monorepo support with pnpm workspaces, dist-folder publishing via makage/lerna, and workspace protocol linking.
