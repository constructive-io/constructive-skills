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
- **Default in preset** — presets from `@constructive-io/node-type-registry` that include the gate out of the box (see [`constructive`](../constructive/references/module-presets.md)).
- **Skill** — where to go for the actual how-to.

When a feature is gated by a module, installing / omitting the module from a preset turns it on / off. When it's gated by a toggle, it's on all the time but can be flipped via a settings row.

## 1. Identity & Authentication

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Email + password sign-up/sign-in | `user_auth_module` + `emails_module` + `app_settings_auth.allow_password_sign_up` | `auth:email`, `auth:email+magic`, `auth:sso`, `auth:passkey`, `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| Magic link sign-in | `session_secrets_module` + `emails_module` + `app_settings_auth.allow_magic_link_sign_in` | `auth:email+magic`, `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| Email OTP | `session_secrets_module` + `emails_module` + toggle | `auth:email+magic`, `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| Phone / SMS sign-in | `phone_numbers_module` + toggle | `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| OAuth / SSO (federated identity) | `identity_providers_module` + `connected_accounts_module` | `auth:sso`, `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| Passkeys (WebAuthn) | `webauthn_credentials_module` + `webauthn_auth_module` + `session_secrets_module` | `auth:passkey`, `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/SKILL.md) |
| Rate limits / throttling | `rate_limits_module` (optional — see `module-presets.md`) | `auth:hardened`, `b2b`, `full` | [`constructive`](../constructive/references/module-presets.md) |
| Device tracking / trusted devices | `devices_module` + `has_device_support` | `full` (not yet fully wired; see `module-presets.md`) | [`constructive`](../constructive/references/module-presets.md) |
| Sessions (server-side) | `sessions_module` | all presets except `minimal`-without-auth | [`constructive`](../constructive/SKILL.md) |
| API keys | `secrets_module` | all presets | [`constructive`](../constructive/SKILL.md) |
| Password reset / forgot password | `emails_module` + auth procs | `auth:email`+ | [`constructive`](../constructive/SKILL.md) |
| Email verification | `emails_module` + auth procs | `auth:email`+ | [`constructive`](../constructive/SKILL.md) |
| Local email testing (dev only) | — | — | [`constructive-local-email-services`](../constructive-local-email-services/SKILL.md) |

## 2. Authorization (Safegres)

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Row-level security on every table | `rls_module` + `secure_table_provision` | all | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| 14 `Authz*` policy node types | Node Type Registry | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Read-only API (API-level) | `api.read_only = true` | — (runtime toggle) | [`constructive`](../constructive/references/services-schemas.md) |
| Read-only members | `AuthzNotReadOnly` + membership field | — (policy-level) | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Bitmask permissions | `permissions_module` | `b2b`, `full` | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Permission levels | `levels_module` | `b2b`, `full` | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Permissive + restrictive policy composition | `AuthzComposite` | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| "Users are organizations" identity | `membership_types_module` | all auth presets | [`constructive-safegres`](../constructive-safegres/SKILL.md) |

## 3. Multi-tenancy & Membership

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| App-scope memberships (single tenant) | `memberships_module:app` | all auth presets | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Org-scope memberships (multi-tenant) | `memberships_module:org` | `b2b`, `full` | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Dynamic entity types (channels, teams, depts) | `entity_type_provision` + `provision_membership_table()` | — (runtime) | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Invites | `invites_module` | `b2b`, `full` | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Limits (quotas per scope) | `limits_module:app` / `limits_module:org` | `b2b`, `full` | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Profiles per scope | `profiles_module:app` / `profiles_module:org` | `b2b`, `full` | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Hierarchy (entity_type tree) | `entity_type_hierarchy_module` | `b2b`, `full` | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |

## 4. Data Modeling

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Blueprints (declarative schema) | `blueprint` + `blueprint_template` | — (runtime) | [`constructive`](../constructive/references/blueprints.md) |
| Blueprint templates / marketplace | `copy_template_to_blueprint()` | — | [`constructive`](../constructive/references/blueprints.md) |
| Merkle definition_hash | backend trigger | — | [`constructive`](../constructive/references/blueprints.md) |
| Tables + fields | `secure_table_provision` | — | [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Relations (1:N, M:N junctions) | `relation_provision` | — | [`constructive`](../constructive/references/blueprints.md) |
| `Data*` generators (DataId, DataDirectOwner, DataPublishable, DataTimestamps, …) | Node Type Registry | — | [`constructive`](../constructive/references/blueprints.md) |
| Smart tags (GraphQL schema hints) | field-level | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |

## 5. Storage & Uploads

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| S3 / MinIO buckets per entity type | `storage_module` + `storage_config` on `entity_type_provision` | `full`, any app using uploads | [`constructive-uploads`](../constructive-uploads/SKILL.md) + [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Public vs private buckets | `storage_config.is_public` | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| Presigned upload URLs | `requestUploadUrl` mutation | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| Per-bucket RLS policies | `storage_config.policies[]` (Authz* nodes) | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) + [`constructive-safegres`](../constructive-safegres/SKILL.md) |
| Multi-scope bucket resolution | `bucketKey` + `ownerId` | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| Entity-scoped storage (buckets per entity) | `has_storage` + `storage_config` | — | [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) |
| Bucket provisioning | `provisionBucket` mutation + auto-provision | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| Content-hash deduplication | `requestUploadUrl` (deduplicated field) | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| Download URLs (presigned GET / CDN) | `downloadUrl` computed field | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |
| MIME type restrictions + file size limits | `allowed_mime_types` + `max_file_size` on bucket | — | [`constructive-uploads`](../constructive-uploads/SKILL.md) |

## 6. Search

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| tsvector (Postgres full-text) | `provisionFullTextSearch` + tsvector adapter | — | [`graphile-search`](../graphile-search/SKILL.md) |
| BM25 (ParadeDB / pg_search) | BM25 adapter | — | [`graphile-search`](../graphile-search/SKILL.md) |
| Trigram (pg_trgm fuzzy) | trigram adapter | — | [`graphile-search`](../graphile-search/SKILL.md) |
| Vector similarity (pgvector) | pgvector adapter + `provisionIndex` | — | [`constructive-ai`](../constructive-ai/SKILL.md) |
| PostGIS spatial search / distance | `provisionSpatialRelation` + spatial adapter | — | [`graphile-search`](../graphile-search/SKILL.md) |
| Unified composite search | `unifiedSearch` field | — | [`graphile-search`](../graphile-search/SKILL.md) |

## 7. AI

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| `pgvector` columns + indexes | `provisionIndex` (SDK) | — | [`constructive-ai`](../constructive-ai/SKILL.md) |
| Embedding pipelines | app code | — | [`constructive-ai`](../constructive-ai/SKILL.md) |
| Ollama in CI / GitHub Actions | workflow | — | [`constructive-ai`](../constructive-ai/SKILL.md) |
| RAG patterns | app code + ORM | — | [`constructive-ai`](../constructive-ai/SKILL.md) |

## 8. GraphQL & Codegen

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| PostGraphile v5 server | `cnc server` | — | [`constructive`](../constructive/references/server-config.md) |
| GraphiQL explorer | `cnc explorer` | — | [`constructive`](../constructive/references/server-config.md) |
| React Query hooks codegen | `--react-query` | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| Prisma-like ORM codegen | `--orm` | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| CLI codegen (`csdk` / `constructive`) | `--cli` | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| Multi-target codegen | config | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| Relay-spec pagination | Node Type Registry + PostGraphile | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| `_meta` introspection endpoint | built-in | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| Dynamic `_meta` forms (zero-config CRUD) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| CRUD Stack cards (iOS-style panels) | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |
| 50+ UI components | `@constructive-io/ui` | — | [`constructive-frontend`](../constructive-frontend/SKILL.md) |

## 9. Services & Routing

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Multiple APIs per database | `api` + `api_schema` entities | — | [`constructive`](../constructive/references/services-schemas.md) |
| Domain / subdomain routing | `domain` + `site` entities | — | [`constructive`](../constructive/references/services-schemas.md) |
| Public vs admin API routing | `api.routing_mode` | — | [`constructive`](../constructive/references/server-config.md) |
| Schema grants per API | `schema_grant` | — | [`constructive`](../constructive/references/services-schemas.md) |

## 10. Background Work & Operations

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Background jobs (Knative) | `jobs` package | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Job triggers (DataJobTrigger) | `DataJobTrigger` node | — | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Cloud functions (Knative HTTP) | `functions/*` | — | [`constructive`](../constructive/references/cloud-functions.md) |
| Deterministic DB migrations | `pgpm deploy / verify / revert` | — | [`pgpm`](../pgpm/SKILL.md) |
| Module provisioning | `metaschema_generators.provision_database_modules` | — | [`constructive`](../constructive/references/module-presets.md) |
| DB introspection → SDK | `cnc codegen` | — | [`constructive-graphql`](../constructive-graphql/SKILL.md) |
| Ephemeral test DBs | `pgsql-test` + friends | — | [`constructive-testing`](../constructive-testing/SKILL.md) |
| RLS / policy testing | `pgsql-test` + JWT context | — | [`constructive-testing`](../constructive-testing/SKILL.md) |

## 11. Project Setup & Scaffolding

| Feature | Gate | In preset | Skill |
|---|---|---|---|
| Local dev environment | `pgpm docker start` + pgpm env | — | [`constructive-setup`](../constructive-setup/SKILL.md) |
| Workspace / module scaffolding | `pgpm init` | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| Next.js app boilerplate | template | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| Custom starter templates | template authoring | — | [`constructive-starter-kits`](../constructive-starter-kits/SKILL.md) |
| pnpm workspace / publishing | — | — | [`constructive-tooling`](../constructive-tooling/SKILL.md) |
| Interactive CLIs (`inquirerer`) | `inquirerer` package | — | [`constructive-tooling`](../constructive-tooling/SKILL.md) |

## 12. Module Presets (starting points, not features)

| Preset | Shape |
|---|---|
| `minimal` | users + sessions + rls + secrets — no server-side auth |
| `auth:email` | email/password, single tenant |
| `auth:email+magic` | `auth:email` + magic link / email OTP |
| `auth:sso` | `auth:email` + OAuth + connected accounts |
| `auth:passkey` | `auth:email` + WebAuthn |
| `auth:hardened` | rate limits + SSO + passkeys + SMS + magic links |
| `b2b` | `auth:hardened` + orgs + invites + permissions + levels + profiles + hierarchy |
| `full` | `['all']` — everything |

See [`constructive/references/module-presets.md`](../constructive/references/module-presets.md) for the full catalog, shapes, and ORM usage.

## Things Not (Yet) a Feature

Listed for honesty — these are discussed in the modularity docs but aren't usable today:

- **Device tracking end-to-end** — module exists, trigger doesn't wire it through (`has_device_support` is `false` in production). See [`constructive/references/module-presets.md`](../constructive/references/module-presets.md).
- **MFA / user_settings_security** — template hooks exist, module doesn't.
- **`emails_module` opt-out** — email is required by the `user_auth_module` trigger today; `auth:sso` / `auth:passkey` presets still install it.

## Flow-Based Programming (separate toolkit)

FBP is a standalone toolkit, not part of the Constructive app feature set. See [`fbp`](../fbp/SKILL.md) for types, spec, evaluator, and graph editor.
