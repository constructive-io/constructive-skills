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
- **Default in preset** — presets from `@constructive-io/node-type-registry` that include the gate out of the box (see [`constructive-platform`](../constructive-platform/references/module-presets.md)).
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
| User credentials (bcrypt credential store) | `user_credentials_module` | all auth presets | [`constructive-platform`](../constructive-platform/SKILL.md) |
| MFA / 2FA (TOTP, email, SMS, backup codes) | `app_settings_auth.require_mfa` + `allow_totp_mfa` + `allow_email_mfa` + `allow_sms_mfa` + `allow_backup_codes` | `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Anonymous sessions | `app_settings_auth.allow_anonymous_sessions` | — (toggle) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| CAPTCHA / reCAPTCHA gate | `app_settings_auth.enable_captcha` | — (toggle) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Cookie-based authentication | `app_settings_auth.enable_cookie_auth` + cookie config fields | — (toggle) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Session management (idle timeout, max sessions) | `app_settings_auth.session_idle_timeout` + `max_sessions_per_user` + `allow_multiple_sessions` | — (toggle) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Cross-origin token support | `app_settings_auth.allow_cross_origin_token` | — (toggle) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Rate limits / throttling | `rate_limits_module` (optional — see `module-presets.md`) | `auth:hardened`, `b2b`, `full` | [`constructive-platform`](../constructive-platform/references/module-presets.md) |
| Billing-aware rate limit meters | `rate_limit_meters_module` | `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Device tracking (passive) | `devices_module` + `app_settings_device.enable_device_tracking` | `full` | [`constructive-platform`](../constructive-platform/references/device-settings.md) |
| Trusted devices (MFA bypass) | `devices_module` + `app_settings_device.enable_trusted_devices` | `full` | [`constructive-platform`](../constructive-platform/references/device-settings.md) |
| Device approval gate (email) | `devices_module` + `app_settings_device.require_device_approval` | `full` | [`constructive-platform`](../constructive-platform/references/device-settings.md) |
| Force MFA on new devices | `devices_module` + `app_settings_device.require_mfa_new_device` | `full` | [`constructive-platform`](../constructive-platform/references/device-settings.md) |
| User settings (extensible 1:1 preferences) | `user_settings_module` | `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Sessions (server-side) | `sessions_module` | all presets except `minimal`-without-auth | [`constructive-platform`](../constructive-platform/SKILL.md) |
| API keys | `user_state_module` | all presets | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (per-user) | `["config_secrets_module", {"scope": "app"}]` | `auth:email`+, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (org-scoped) | `["config_secrets_module", {"scope": "org"}]` | standalone (not in presets yet) | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Encrypted secrets (app-wide, admin-only) | `app_secrets` (part of `config_secrets_module`) | `auth:email`+, `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Web3 wallet addresses | `crypto_addresses_module` | `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Password reset / forgot password | `emails_module` + auth procs | `auth:email`+ | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Email verification | `emails_module` + auth procs | `auth:email`+ | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Local email testing (dev only) | — | — | [`constructive-setup`](../constructive-setup/SKILL.md) |

## 2. Authorization (Safegres)

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Row-level security on every table | `rls_module` + `secure_table_provision` | all | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| 18 `Authz*` policy node types (17 leaf + AuthzComposite) | Node Type Registry | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Read-only API (API-level) | `api.read_only = true` | — (runtime toggle) | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Read-only members | `AuthzNotReadOnly` + membership field | — (policy-level) | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Granular permissions | `permissions_module` | `b2b`, `full` | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Permission levels | `levels_module` | `b2b`, `full` | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Permissive + restrictive policy composition | `AuthzComposite` | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| "Users are organizations" identity | `membership_types_module` | all auth presets | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| AuthzFilePath (path-scoped file sharing via ltree) | `AuthzFilePath` node | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |

## 3. Multi-tenancy & Membership

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| App-scope memberships (single tenant) | `["memberships_module", {"scope": "app"}]` | all auth presets | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Org-scope memberships (multi-tenant) | `["memberships_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Dynamic entity types (channels, teams, depts) | `entity_type_provision` + `provision_membership_table()` | — (runtime) | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Invites (email, blank, multiple) | `invites_module` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Profile assignment on email invites | `invites_module` + `profiles_module` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Email auto-verification on invite claim | `invites_module` + `emails_module` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Limits (metered quotas per scope) | `["limits_module", {"scope": "app"}]` / `["limits_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Cap tables (static config values) | `limits_module` → `limit_caps_defaults` + `limit_caps` | `b2b`, `full` | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Feature flags (cap-based gating) | `LimitEnforceFeature` node + `limit_caps_defaults(max=0\|1)` | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Credits (append-only ledger) | `limits_module` → `limit_credits` + `credit_codes` | `b2b`, `full` | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Profiles per scope | `["profiles_module", {"scope": "app"}]` / `["profiles_module", {"scope": "org"}]` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Hierarchy (entity_type tree) | `hierarchy_module` | `b2b`, `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Entity-scoped function module | `entity_type_provision.functions[]` | — (runtime) | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Entity-scoped graph module | `entity_type_provision.graphs[]` | — (runtime) | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Entity-scoped namespace module | `entity_type_provision.namespaces[]` | — (runtime) | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Entity-scoped agent module | `entity_type_provision.agents[]` | — (runtime) | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |

## 4. Data Modeling

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Blueprints (declarative schema) | `blueprint` + `blueprint_template` | — (runtime) | [`constructive-platform`](../constructive-platform/references/blueprints.md) |
| Blueprint templates / marketplace | `copy_template_to_blueprint()` | — | [`constructive-platform`](../constructive-platform/references/blueprints.md) |
| Merkle definition_hash | backend trigger | — | [`constructive-platform`](../constructive-platform/references/blueprints.md) |
| Tables + fields | `secure_table_provision` | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Relations (1:1, 1:N, M:N, Spatial) | `relation_provision` | — | [`constructive-platform`](../constructive-platform/references/blueprints.md) |
| Node type generators (12 categories: Data\*, Search\*, Authz\*, Check\*, Limit\*, Billing\*, Job\*, Process\*, Relation\*, View\*, Event\*, Table\*) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataDirectOwner / DataEntityMembership / DataOwnershipInEntity | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataPeoplestamps (created_by / updated_by) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataPublishable (is_published + published_at) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataCompositeField (derived text concatenation) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Behavior triggers (DataSlug, DataInflection, DataForceCurrentUser) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| LimitEnforceCounter (metered usage enforcement) | `LimitEnforceCounter` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| LimitEnforceFeature (cap-based feature gating) | `LimitEnforceFeature` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| Field protection (DataOwnedFields, DataImmutableFields) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataInheritFromParent (copy values from FK parent) | Node Type Registry | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataI18n (translation tables + multilingual search) | `DataI18n` node + `i18n_module` | — | [`constructive-sdk-i18n`](../constructive-sdk-i18n/SKILL.md) |
| Smart tags (GraphQL schema hints) | field-level | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| DataId (UUID PK generation) | `DataId` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataTimestamps (created_at / updated_at) | `DataTimestamps` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataSoftDelete (is_deleted + deleted_at) | `DataSoftDelete` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataArchivable (is_archived + archived_at) | `DataArchivable` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataRealtime (per-table subscriber table) | `DataRealtime` node + `realtime_module` | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataBulk (bulk mutation smart tags) | `DataBulk` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataJsonb (JSONB field) | `DataJsonb` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataMemberOwner (compound ownership) | `DataMemberOwner` node | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| DataStatusField (status field generation) | `DataStatusField` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| DataTags (citext\[\] tags + GIN index) | `DataTags` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| LimitEnforceAggregate (aggregate limit checks) | `LimitEnforceAggregate` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| LimitEnforceRate (rate limiting) | `LimitEnforceRate` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| LimitTrackUsage (billing usage tracking) | `LimitTrackUsage` node + `billing_module` | — | [`constructive-sdk-billing`](../constructive-sdk-billing/SKILL.md) |
| LimitWarningCounter (soft limit warnings) | `LimitWarningCounter` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| LimitWarningAggregate (aggregate warnings) | `LimitWarningAggregate` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| LimitWarningRate (rate limit warnings) | `LimitWarningRate` node + `limits_module` | — | [`constructive-sdk-limits`](../constructive-sdk-limits/SKILL.md) |
| TableOrganizationSettings (org settings skeleton) | `TableOrganizationSettings` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| TableUserProfiles (user profile skeleton) | `TableUserProfiles` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| TableUserSettings (user settings skeleton) | `TableUserSettings` node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |

## 5. Events & Achievements

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| EventTracker (record events on row changes) | `EventTracker` node + `events_module` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Blueprint achievements (levels + requirements) | `achievements[]` section + `has_levels` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Achievement reward credit grants | `tg_achievement_reward` + `limits_module` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Invite-based achievements (simple tier) | `has_invite_achievements` + `has_invites` + `has_levels` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Invitee achievement virality chain (meta tier) | `tg_invitee_achievement` + `invites_module` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| EventReferral (attribute events to inviters) | `EventReferral` node + `invites_module` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Multi-level referral chains (MLM) | `EventReferral` node + `max_depth` (2–10) | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Compound conditions (shared with JobTrigger) | `build_condition_ast()` + `conditions` param | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) + [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Partitioned event log (time-based retention) | `events_module` + `pg_partman` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Event aggregates (running counts per user) | `events_module` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Event type runtime controls (is_milestone, feeds_levels) | `event_types` fields | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |
| Events security provisioning | `apply_events_security()` | — | [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) |

## 6. Storage & Uploads

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| S3 / MinIO buckets per entity type | `storage_module` + `storage` on `entity_type_provision` | `full`, any app using uploads | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) + [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Org-scoped storage (per-org/user buckets) | Top-level `storage: [{ scope: "org", ... }]` | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Public vs private buckets | `is_public` on bucket entries | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Presigned upload URLs | `requestUploadUrl` mutation | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Per-bucket RLS policies | `storage_config.policies[]` (Authz* nodes) | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) + [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Multi-scope bucket resolution | `bucketKey` + `ownerId` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Entity-scoped storage (buckets per entity) | `has_storage` + `storage_config` | — | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Bucket provisioning | `provisionBucket` mutation + auto-provision | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Content-hash deduplication | `requestUploadUrl` (deduplicated field) | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Download URLs (presigned GET / CDN) | `downloadUrl` computed field | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| MIME type restrictions + file size limits | `allowed_mime_types` + `max_file_size` on bucket | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| File versioning (version chains) | `has_versioning` on `storage_module` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| File events audit log | `has_audit_log` on `storage_module` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Virtual filesystem (path shares) | `has_path_shares` on `storage_module` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Custom S3 keys | `has_custom_keys` on `storage_module` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Upload confirmation (deferred verification) | `has_confirm_upload` on `storage_module` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Multi-module storage (separate tables per use case) | `storage_key` on `storage[]` entries | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| File deletion GC (async S3 cleanup) | AFTER DELETE trigger → `storage_gc` queue | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |
| Stream-based file uploads (Upload scalar) | `graphile-upload-plugin` | — | [`constructive-sdk-uploads`](../constructive-sdk-uploads/SKILL.md) |

## 7. Search

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| SearchUnified (orchestrated multi-algorithm) | `SearchUnified` blueprint node | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) + [`graphile-search`](../graphile-search/SKILL.md) |
| SearchFullText (tsvector + GIN) | `SearchFullText` blueprint node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| SearchBm25 (ParadeDB / pg_search) | `SearchBm25` blueprint node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| SearchTrgm (trigram fuzzy) | `SearchTrgm` blueprint node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| SearchVector (pgvector embeddings) | `SearchVector` blueprint node | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| SearchSpatial (PostGIS geometry) | `SearchSpatial` blueprint node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| SearchSpatialAggregate (materialized aggregates) | `SearchSpatialAggregate` blueprint node | — | [`constructive-platform`](../constructive-platform/references/blueprint-definition-format.md) |
| Unified composite search (GraphQL) | `unifiedSearch` field | — | [`graphile-search`](../graphile-search/SKILL.md) |
| RelationSpatial (cross-table PostGIS predicates) | `RelationSpatial` node + `graphile-postgis` | — | [`graphile-search`](../graphile-search/SKILL.md) |
| Chunk-aware search (parent+chunk embeddings) | `@hasChunks` smart tag | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) + [`graphile-search`](../graphile-search/SKILL.md) |
| Recency boost (timestamp-based score decay) | `@searchConfig.boost_recent` | — | [`graphile-search`](../graphile-search/SKILL.md) |
| SearchFullText lang_column (per-row language stemming) | `SearchFullText` + `lang_column` param | — | [`constructive-sdk-i18n`](../constructive-sdk-i18n/SKILL.md) |

## 8. AI

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| SearchVector (pgvector columns + HNSW/IVFFlat) | `SearchVector` blueprint node | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Embedding stale tracking + job enqueue | `SearchVector` `include_updated_at` + `enqueue_job` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Chunk tables (long text splitting) | `SearchVector` `chunks_config` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Embedding worker pipeline | Graphile Worker + `generate_embedding` task (SQL triggers exist; Knative handlers not yet implemented) | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| agentic-kit LLM client (multi-provider) | `@agentic-kit/ollama` (shipped); `@agentic-kit/anthropic`, `@agentic-kit/openai` (optional) | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| RAG pipelines (blueprint → embed → retrieve → generate) | app code + ORM | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Agent threads + messages | `agent_module` | `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Agent plans + approval workflow | `["agent_module", {"has_plans": true}]` | — | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Agent resources (unified skills + knowledge) | `["agent_module", {"has_resources": true}]` | `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Agent registry + personas | `["agent_module", {"has_agents": true}]` | `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| Agent prompt templates | `agent_module` | `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |
| graphile-llm RAG plugin (ragQuery field) | `LlmRagPlugin` + `graphile-llm` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| graphile-llm metering (billing-aware LLM calls) | `MeteringPlugin` + `graphile-llm` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| graphile-llm agent discovery | `AgentDiscoveryPlugin` + `graphile-llm` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| agentic-server REST API (threads, messages, embed) | `agentic-server` package | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| LLM module (per-database provider config) | `llm_module` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Embedding model/provider params | `SearchVector` + `embedding_model` / `embedding_provider` | — | [`constructive-sdk-ai`](../constructive-sdk-ai/SKILL.md) |
| Agent sub-agent hierarchy | agent table `parent_id` FK + `is_ephemeral` | `full` | [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) |

## 9. GraphQL & Codegen

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| PostGraphile v5 server | `cnc server` | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| GraphiQL explorer | `cnc explorer` | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| React Query hooks codegen | `--react-query` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Prisma-like ORM codegen | `--orm` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| CLI codegen (`csdk` / `constructive`) | `--cli` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Multi-target codegen | config | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Relay-spec pagination | Node Type Registry + PostGraphile | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| `_meta` introspection endpoint | built-in | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| Dynamic `_meta` forms (zero-config CRUD) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| CRUD Stack cards (iOS-style panels) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| 50+ UI components | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| Subscription hooks codegen | `--react-query` + `DataRealtime` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Codegen watch mode (live-reload) | `cnc codegen --watch` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Query key factory generator | `cnc codegen` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Docs/skills auto-generation from codegen | `cnc codegen` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |

## 10. Services & Routing

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Multiple APIs per database | `api` + `api_schema` entities | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Domain / subdomain routing | `domain` + `site` entities | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Public vs admin API routing | `apis.is_public` + `API_IS_PUBLIC` env | — | [`constructive-platform`](../constructive-platform/references/server-config.md) |
| Schema grants per API | `schema_grant` | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| CORS settings (per-database, per-API) | `cors_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Database feature flags (12 toggles) | `database_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Per-API feature flag overrides | `api_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| RLS runtime config | `rls_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| WebAuthn runtime config | `webauthn_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Public-key crypto auth config | `pubkey_settings` table | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |
| Application definitions | `apps` table in `services_public` | — | [`constructive-platform`](../constructive-platform/references/services-schemas.md) |

## 11. Realtime Subscriptions

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Per-table subscriber tables | `DataRealtime` node + `realtime_module` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| RLS-derived subscription security | `secure_table_provision.policies` SELECT policies | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Change log (partitioned event stream) | `realtime_module` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Statement-level emit triggers | `DataRealtime` → `emit_change()` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| GraphQL subscription fields (`onXxxChanged`) | `@realtime` smart tag + `enable_realtime` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Sparse-set row filtering (`ids: [UUID!]`) | `onXxxChanged(ids: [...])` argument | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Overflow detection (INVALIDATE) | >50 rows/statement or >50 events/sec/table | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Codegen subscription hooks (`useXxxSubscription`) | `cnc codegen` + `DataRealtime` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Connection state hook (`useConnectionState`) | `cnc codegen` + realtime config | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| ORM realtime (`client.subscribe()`) | `realtime` config on `createClient` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Runtime toggle (`enable_realtime`) | `database_settings` / `api_settings` | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |
| Partition table support | Declarative `partitioned` flag + automatic lifecycle | — | [`constructive-platform`](../constructive-platform/references/realtime-subscriptions.md) |

## 12. Background Work & Operations

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Background jobs (Knative) | `jobs` package | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Job triggers (JobTrigger) | `JobTrigger` node | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| ProcessImageVersions (image variant generation) | `ProcessImageVersions` node | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Cloud functions (Knative HTTP) | `functions/*` | — | [`constructive-platform`](../constructive-platform/references/cloud-functions.md) |
| Deterministic DB migrations | `pgpm deploy / verify / revert` | — | [`pgpm`](../pgpm/SKILL.md) |
| Module provisioning | `metaschema_generators.provision_database_modules` | — | [`constructive-platform`](../constructive-platform/references/module-presets.md) |
| DB introspection → SDK | `cnc codegen` | — | [`constructive-sdk-graphql`](../constructive-sdk-graphql/SKILL.md) |
| Ephemeral test DBs | `pgsql-test` + friends | — | [`constructive-testing`](../constructive-testing/SKILL.md) |
| RLS / policy testing | `pgsql-test` + JWT context | — | [`constructive-testing`](../constructive-testing/SKILL.md) |
| Notifications (email/push/webhook — channels, preferences, digest, delivery_log, subscriptions) | `notifications_module` | `b2b`, `full` | [`constructive-platform`](../constructive-platform/SKILL.md) |
| Internationalization (multilingual search + translations) | `i18n_module` + `DataI18n` + `lang_column` | `full` | [`constructive-sdk-i18n`](../constructive-sdk-i18n/SKILL.md) |
| pg_cron SQL scheduling (7 maintenance tasks) | `register_maintenance_jobs` | — | [`constructive-platform`](../constructive-platform/SKILL.md) |
| CursorTracker at-least-once delivery | `listener_node` + `drain_changes()` + `touch_listener()` | — | [`constructive-platform`](../constructive-platform/SKILL.md) |

## 13. Project Setup & Scaffolding

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Local dev environment | `pgpm docker start` + pgpm env | — | [`constructive-setup`](../constructive-setup/SKILL.md) |
| Workspace / module scaffolding | `pgpm init` | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| Next.js app boilerplate | template | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| Custom starter templates | template authoring | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| pnpm workspace / publishing | — | — | [`inquirerer-cli`](../inquirerer-cli/SKILL.md) |
| Interactive CLIs (`inquirerer`) | `inquirerer` package | — | [`inquirerer-cli`](../inquirerer-cli/SKILL.md) |

## 14. Module Presets (starting points, not features)

| Preset | Shape |
|---|---|
| `minimal` | users + sessions + rls + API keys — no server-side auth |
| `auth:email` | email/password, single tenant |
| `auth:email+magic` | `auth:email` + magic link / email OTP |
| `auth:sso` | `auth:email` + OAuth + connected accounts |
| `auth:passkey` | `auth:email` + WebAuthn |
| `auth:hardened` | rate limits + SSO + passkeys + SMS + magic links |
| `b2b` | `auth:hardened` + orgs + invites + permissions + levels + profiles + hierarchy + devices |
| `b2b:storage` | `b2b` + file upload infrastructure (buckets, files, RLS) + devices |
| `full` | everything — includes i18n_module, user_settings_module, storage, billing, notifications |

See [`constructive/references/module-presets.md`](../constructive-platform/references/module-presets.md) for the full catalog, shapes, and ORM usage.

## User Settings Extension Pattern

`user_settings_module` creates a skeleton 1:1 table (per-user, `AuthzDirectOwner` RLS) in `users_public`. Other modules extend it by adding columns via `metaschema.create_field()`:

| Module | Columns added to `user_settings` |
|---|---|
| `notifications_module` | `notifs_enabled`, `notifs_default_digest_frequency`, `notifs_quiet_hours_start`, `notifs_quiet_hours_end`, `notifs_quiet_hours_timezone`, `notifs_default_channels` |
| `i18n_module` | `preferred_language` |

## Things Not (Yet) a Feature

- **`emails_module` opt-out** — email is required by the `user_auth_module` trigger today; `auth:sso` / `auth:passkey` presets still install it.
- **`organization_settings_module`** — will follow the same pattern as `user_settings_module` for org-level settings.
- **Embedding worker Knative handlers** — SQL triggers for embedding enqueue exist, but Knative worker handlers are not yet wired.

## Flow-Based Programming (separate toolkit)

FBP is a standalone toolkit, not part of the Constructive app feature set. See [`fbp`](../fbp/SKILL.md) for types, spec, evaluator, and graph editor.
