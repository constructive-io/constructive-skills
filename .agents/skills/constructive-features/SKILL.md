---
name: constructive-features
description: Feature catalog for Constructive apps — one scannable index of every capability (auth methods, authorization, multi-tenancy, data modeling, storage, search, AI, GraphQL, ops) with pointers to the authoritative skill or toggle that owns it. Use when asked "what can a Constructive app do", "what features are available", "which skill covers X", "is there built-in support for Y", "how do I enable read-only mode / magic links / passkeys / SSO / pgvector / search / uploads", or when orienting to the platform for the first time.
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Features

A feature-level index of what a Constructive app can do. Each row is a pointer — it names the feature, the module/toggle that gates it, and which skill owns the detail. **No prose here that lives elsewhere** — follow the links for specifics.

## How to Read This

- **Feature** — what a user / developer gets.
- **Gate** — the module, Authz* node type, or `app_settings_*` toggle that controls it.
- **Default in preset** — presets from `@constructive-io/node-type-registry` that include the gate out of the box (see [`constructive-platform`](../constructive-blueprints/references/module-presets.md)).
- **Skill** — where to go for the actual how-to.

When a feature is gated by a module, installing / omitting the module from a preset turns it on / off. When it's gated by a toggle, it's on all the time but can be flipped via a settings row.

## 1. Identity & Authentication

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Email + password sign-up/sign-in | `user_auth_module` + `emails_module` + `app_settings_auth.allow_password_sign_up` | `auth:email`, `auth:email+magic`, `auth:sso`, `auth:passkey`, `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Magic link sign-in | `session_secrets_module` + `emails_module` + `app_settings_auth.allow_magic_link_sign_in` | `auth:email+magic`, `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Email OTP | `session_secrets_module` + `emails_module` + toggle | `auth:email+magic`, `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Phone / SMS sign-in | `phone_numbers_module` + toggle | `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| OAuth / SSO (federated identity) | `identity_providers_module` + `connected_accounts_module` | `auth:sso`, `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Passkeys (WebAuthn) | `webauthn_credentials_module` + `webauthn_auth_module` + `session_secrets_module` | `auth:passkey`, `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Rate limits / throttling | `rate_limits_module` (optional — see `module-presets.md`) | `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-blueprints/references/module-presets.md) |
| Device tracking (passive) | `devices_module` + `app_settings_device.enable_device_tracking` | `full` | [`constructive-platform`](../constructive-auth/references/device-settings.md) |
| Trusted devices (MFA bypass) | `devices_module` + `app_settings_device.enable_trusted_devices` | `full` | [`constructive-platform`](../constructive-auth/references/device-settings.md) |
| Device approval gate (email) | `devices_module` + `app_settings_device.require_device_approval` | `full` | [`constructive-platform`](../constructive-auth/references/device-settings.md) |
| Force MFA on new devices | `devices_module` + `app_settings_device.require_mfa_new_device` | `full` | [`constructive-platform`](../constructive-auth/references/device-settings.md) |
| User settings (extensible 1:1 preferences) | `user_settings_module` | `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Sessions (server-side) | `sessions_module` | all presets except `minimal`-without-auth | [`constructive-platform`](../constructive-platform/SKILL.md) |
| API keys | `user_state_module` | all presets | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (per-user) | `config_secrets_user_module` | `auth:email`+, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (org-scoped) | `config_secrets_org_module` | standalone (not in presets yet) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (app-wide, admin-only) | `app_secrets` (part of `config_secrets_user_module`) | `auth:email`+, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Web3 wallet addresses | `crypto_addresses_module` | `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Password reset / forgot password | `emails_module` + auth procs | `auth:email`+ | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Email verification | `emails_module` + auth procs | `auth:email`+ | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Local email testing (dev only) | — | — | [`constructive-platform`](../constructive-platform/SKILL.md) |

## 2. Authorization (Safegres)

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Row-level security on every table | `rls_module` + `secure_table_provision` | all | [`constructive-security`](../constructive-security/SKILL.md) |
| 18 `Authz*` policy node types | Node Type Registry | — | [`constructive-security`](../constructive-security/SKILL.md) |
| Read-only API (API-level) | `api.read_only = true` | — (runtime toggle) | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Read-only members | `AuthzNotReadOnly` + membership field | — (policy-level) | [`constructive-security`](../constructive-security/SKILL.md) |
| Granular permissions | `permissions_module` | `b2b`, `full` | [`constructive-access-control`](../constructive-access-control/SKILL.md) |
| Named permissions (per-module) | `permissions_module` + module install | all (auto) | [`constructive-access-control`](../constructive-access-control/SKILL.md) |
| Permission defaults (module-level) | `permission_default_permissions` + module INSERT triggers | all (auto on module install) | [`constructive-access-control`](../constructive-access-control/SKILL.md) |
| Roles (admin/owner/member) | membership `isAdmin` / `isOwner` fields | all auth presets | [`constructive-access-control`](../constructive-access-control/references/admin-owner-member.md) |
| Admin/owner grants (role promotion audit trail) | `{prefix}AdminGrant` / `{prefix}OwnerGrant` tables | all auth presets | [`constructive-access-control`](../constructive-access-control/references/admin-owner-member.md) |
| Grants lifecycle (append-only audit) | `{prefix}_grants` table | `b2b`, `full` | [`constructive-access-control`](../constructive-access-control/references/grants-lifecycle.md) |
| Permission levels | `levels_module` | `b2b`, `full` | [`constructive-security`](../constructive-security/SKILL.md) |
| GuardStepUp (step-up auth before DML) | `GuardStepUp` node + `sessions_module` + compound conditions | AUTH_EMAIL | [`constructive-security`](../constructive-security/references/guard-nodes.md) |
| Permissive + restrictive policy composition | `AuthzComposite` | — | [`constructive-security`](../constructive-security/SKILL.md) |
| "Users are organizations" identity | `membership_types_module` | all auth presets | [`constructive-security`](../constructive-security/SKILL.md) |

## 3. Multi-tenancy & Membership

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| App-scope memberships (single tenant) | `["memberships_module", {"scope": "app"}]` | all auth presets | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Org-scope memberships (multi-tenant) | `["memberships_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Dynamic entity types (channels, teams, depts) | `entity_type_provision` + `provision_membership_table()` | — (runtime) | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Invites (email, blank, multiple) | `invites_module` | `b2b`, `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Profile assignment on email invites | `invites_module` + `profiles_module` | `b2b`, `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Email auto-verification on invite claim | `invites_module` + `emails_module` | `b2b`, `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Limits (metered quotas per scope) | `["limits_module", {"scope": "app"}]` / `["limits_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Cap tables (static config values) | `limits_module` → `limit_caps_defaults` + `limit_caps` | `b2b`, `full` | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Feature flags (cap-based gating) | `LimitFeatureFlag` node + `limit_caps_defaults(max=0\|1)` | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Credits (append-only ledger) | `limits_module` → `limit_credits` + `credit_codes` | `b2b`, `full` | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Profiles per scope (permission bundles) | `["profiles_module", {"scope": "app"}]` / `["profiles_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-access-control`](../constructive-access-control/SKILL.md) |
| Hierarchy (org chart, manager/subordinate) | `["hierarchy_module", {"scope": "org"}]` + `AuthzOrgHierarchy` | `b2b`, `full` | [`constructive-access-control`](../constructive-access-control/references/roles-hierarchy.md) |

## 4. Data Modeling

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Blueprints (declarative schema) | `blueprint` + `blueprint_template` | — (runtime) | [`constructive-platform`](../constructive-blueprints/references/blueprints.md) |
| Blueprint templates / marketplace | `copy_template_to_blueprint()` | — | [`constructive-platform`](../constructive-blueprints/references/blueprints.md) |
| Merkle definition_hash | backend trigger | — | [`constructive-platform`](../constructive-blueprints/references/blueprints.md) |
| Tables + fields | `secure_table_provision` | — | [`constructive-security`](../constructive-security/SKILL.md) |
| Relations (1:N, M:N junctions) | `relation_provision` | — | [`constructive-platform`](../constructive-blueprints/references/blueprints.md) |
| Node type generators (12 categories: Data*, Search*, Authz*, Guard*, Check*, Limit*, Billing*, Job*, Process*, Relation*, View*, Event*) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataDirectOwner / DataEntityMembership / DataOwnershipInEntity | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataPeoplestamps (created_by / updated_by) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataPublishable (is_published + published_at) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataCompositeField (derived text concatenation) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Behavior triggers (DataSlug, DataInflection, DataForceCurrentUser) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| LimitCounter (metered usage tracking) | Node Type Registry + `limits_module` | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| LimitFeatureFlag (cap-based feature gating) | Node Type Registry + `limits_module` | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Field protection (DataOwnedFields, DataImmutableFields) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataInheritFromParent (copy values from FK parent) | Node Type Registry | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| DataI18n (translation tables + multilingual search) | `DataI18n` node + `i18n_module` | — | [`constructive-i18n`](../constructive-i18n/SKILL.md) |
| Smart tags (GraphQL schema hints) | field-level | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |

## 5. Events & Achievements

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| EventTracker (record events on row changes) | `EventTracker` node + `events_module` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Blueprint achievements (levels + requirements) | `achievements[]` section + `has_levels` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Achievement reward credit grants | `tg_achievement_reward` + `limits_module` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Invite-based achievements (simple tier) | `has_invite_achievements` + `has_invites` + `has_levels` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Invitee achievement virality chain (meta tier) | `tg_invitee_achievement` + `invites_module` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| EventReferral (attribute events to inviters) | `EventReferral` node + `invites_module` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Multi-level referral chains (MLM) | `EventReferral` node + `max_depth` (2–10) | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Compound conditions (shared with JobTrigger) | `build_condition_ast()` + `conditions` param | — | [`constructive-events`](../constructive-events/SKILL.md) + [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Partitioned event log (time-based retention) | `events_module` + `pg_partman` | — | [`constructive-events`](../constructive-events/SKILL.md) |
| Event aggregates (running counts per user) | `events_module` | — | [`constructive-events`](../constructive-events/SKILL.md) |

## 6. Storage & Uploads

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| S3 / MinIO buckets per entity type | `storage_module` + `storage` on `entity_type_provision` | `full`, any app using uploads | [`constructive-uploads`](../constructive-storage/SKILL.md) + [`constructive-entities`](../constructive-entities/SKILL.md) |
| Org-scoped storage (per-org/user buckets) | Top-level `storage: [{ scope: "org", ... }]` | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Public vs private buckets | `is_public` on bucket entries | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| Presigned upload URLs | `requestUploadUrl` mutation | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| Per-bucket RLS policies | `storage_config.policies[]` (Authz* nodes) | — | [`constructive-uploads`](../constructive-storage/SKILL.md) + [`constructive-security`](../constructive-security/SKILL.md) |
| Multi-scope bucket resolution | `bucketKey` + `ownerId` | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| Entity-scoped storage (buckets per entity) | `has_storage` + `storage_config` | — | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Bucket provisioning | `provisionBucket` mutation + auto-provision | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| Content-hash deduplication | `requestUploadUrl` (deduplicated field) | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| Download URLs (presigned GET / CDN) | `downloadUrl` computed field | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |
| MIME type restrictions + file size limits | `allowed_mime_types` + `max_file_size` on bucket | — | [`constructive-uploads`](../constructive-storage/SKILL.md) |

## 7. Search

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| SearchUnified (orchestrated multi-algorithm) | `SearchUnified` blueprint node | — | [`constructive-agents`](../constructive-agents/SKILL.md) + [`constructive-search`](../constructive-search/SKILL.md) |
| SearchFullText (tsvector + GIN) | `SearchFullText` blueprint node | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| SearchBm25 (ParadeDB / pg_search) | `SearchBm25` blueprint node | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| SearchTrgm (trigram fuzzy) | `SearchTrgm` blueprint node | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| SearchVector (pgvector embeddings) | `SearchVector` blueprint node | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| SearchSpatial (PostGIS geometry) | `SearchSpatial` blueprint node | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| SearchSpatialAggregate (materialized aggregates) | `SearchSpatialAggregate` blueprint node | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Unified composite search (GraphQL) | `unifiedSearch` field | — | [`constructive-search`](../constructive-search/SKILL.md) |

## 8. AI

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| SearchVector (pgvector columns + HNSW/IVFFlat) | `SearchVector` blueprint node | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Embedding stale tracking + job enqueue | `SearchVector` `include_updated_at` + `enqueue_job` | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Chunk tables (long text splitting) | `SearchVector` `chunks_config` | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Embedding worker pipeline | Graphile Worker + `generate_embedding` task | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| agentic-kit LLM client (multi-provider) | `@agentic-kit/ollama`, `@agentic-kit/anthropic`, `@agentic-kit/openai` | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| RAG pipelines (blueprint → embed → retrieve → generate) | app code + ORM | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Agent threads + messages | `agent_module` | `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Agent multiplayer mode (shared threads) | `["agent_module", {"shared": true}]` | — | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Multi-agent attribution (agent_id on messages) | `["agent_module", {"has_agents": true}]` | `full` | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Agent plans + approval workflow | `["agent_module", {"has_plans": true}]` | — | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Agent resources (unified skills + knowledge) | `["agent_module", {"has_resources": true}]` | `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Agent registry + personas | `["agent_module", {"has_agents": true}]` | `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |
| Agent prompt templates | `agent_module` | `full` | [`constructive-entities`](../constructive-entities/SKILL.md) |

## 9. GraphQL & Codegen

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| PostGraphile v5 server | `cnc server` | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| GraphiQL explorer | `cnc explorer` | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| React Query hooks codegen | `--react-query` | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| Prisma-like ORM codegen | `--orm` | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| CLI codegen (`csdk` / `constructive`) | `--cli` | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| Multi-target codegen | config | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| Relay-spec pagination | Node Type Registry + PostGraphile | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| `_meta` introspection endpoint | built-in | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| Dynamic `_meta` forms (zero-config CRUD) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| CRUD Stack cards (iOS-style panels) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| 50+ UI components | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |

## 10. Services & Routing

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Multiple APIs per database | `api` + `api_schema` entities | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Domain / subdomain routing | `domain` + `site` entities | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Public vs admin API routing | `api.routing_mode` | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| Schema grants per API | `schema_grant` | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |

## 11. Realtime Subscriptions

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Per-table subscriber tables | `DataRealtime` node + `realtime_module` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| RLS-derived subscription security | `secure_table_provision.policies` SELECT policies | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Change log (partitioned event stream) | `realtime_module` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Statement-level emit triggers | `DataRealtime` → `emit_change()` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| GraphQL subscription fields (`onXxxChanged`) | `@realtime` smart tag + `enable_realtime` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Sparse-set row filtering (`ids: [UUID!]`) | `onXxxChanged(ids: [...])` argument | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Overflow detection (INVALIDATE) | >50 rows/statement or >50 events/sec/table | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Codegen subscription hooks (`useXxxSubscription`) | `cnc codegen` + `DataRealtime` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Connection state hook (`useConnectionState`) | `cnc codegen` + realtime config | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| ORM realtime (`client.subscribe()`) | `realtime` config on `createClient` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Runtime toggle (`enable_realtime`) | `database_settings` / `api_settings` | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |
| Policy-driven field generation | `column-ref` in `parameter_schema` | — | [`constructive-platform`](../constructive-blueprints/references/blueprint-definition-format.md) |
| Partition table support | Declarative `partitioned` flag + automatic lifecycle | — | [`constructive-platform`](../constructive-realtime/references/realtime-subscriptions.md) |

## 12. Background Work & Operations

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Background jobs (Knative) | `jobs` package | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Job triggers (JobTrigger) | `JobTrigger` node | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Cloud functions (Knative HTTP) | `functions/*` | — | [`constructive-platform`](../constructive-platform/references/cloud-functions.md) |
| Deterministic DB migrations | `pgpm deploy / verify / revert` | — | [`pgpm`](../pgpm/SKILL.md) |
| Module provisioning | `metaschema_generators.provision_database_modules` | — | [`constructive-platform`](../constructive-blueprints/references/module-presets.md) |
| DB introspection → SDK | `cnc codegen` | — | [`constructive-codegen`](../constructive-codegen/SKILL.md) |
| Notifications (email/push/webhook) | `notifications_module` | `b2b`, `full` | [`constructive-notifications`](../constructive-notifications/SKILL.md) |
| Internationalization (multilingual search + translations) | `i18n_module` + `DataI18n` + `lang_column` | `full` | [`constructive-i18n`](../constructive-i18n/SKILL.md) |

## 14. Module Presets (starting points, not features)

| Preset | Shape |
|---|---|
| `minimal` | users + sessions + rls + secrets — no server-side auth |
| `auth:email` | email/password, single tenant |
| `auth:email+magic` | `auth:email` + magic link / email OTP |
| `auth:sso` | `auth:email` + OAuth + connected accounts |
| `auth:passkey` | `auth:email` + WebAuthn |
| `auth:hardened` | rate limits + SSO + passkeys + SMS + magic links |
| `b2b` | `auth:hardened` + orgs + invites + permissions + levels + profiles + hierarchy + user_settings |
| `b2b:storage` | `b2b` + file upload infrastructure (buckets, files, RLS) + user_settings |
| `full` | everything — includes i18n_module, user_settings_module, storage, billing, notifications |

See [`constructive/references/module-presets.md`](../constructive-blueprints/references/module-presets.md) for the full catalog, shapes, and ORM usage.

## User Settings Extension Pattern

`user_settings_module` creates a skeleton 1:1 table (per-user, `AuthzDirectOwner` RLS) in `users_public`. Other modules extend it by adding columns via `metaschema.create_field()`:

| Module | Columns added to `user_settings` |
|---|---|
| `notifications_module` | `notifs_enabled`, `notifs_default_digest_frequency`, `notifs_quiet_hours_start`, `notifs_quiet_hours_end`, `notifs_quiet_hours_timezone`, `notifs_default_channels` |
| `i18n_module` | `preferred_language` |

## Flow-Based Programming

Graph module + merkle store for SDK-authorable computation graphs. See [`constructive-flow-graphs`](../constructive-flow-graphs/SKILL.md) for types, spec, evaluator, and graph editor.
