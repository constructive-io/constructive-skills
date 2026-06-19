# Constructive Platform Architecture Overview

Concise reference for agents that need platform details beyond the phase instructions.

## Core Model

- Constructive is a PostgreSQL-first app platform with generated GraphQL APIs.
- Users are organizations. A user's personal org is created at sign-up, and `user.id` is the org id used by entity-scoped tables.
- App developers should work through SDK-level APIs, not raw SQL internals.

## Platform Baseline

Before app provisioning begins, the local `constructive` database must already be a real Constructive platform deployment.

Minimum proof:

- `metaschema_public.database` exists
- `http://auth.localhost:3000/graphql` responds as the platform auth endpoint
- `http://api.localhost:3000/graphql` responds as the platform API endpoint

If that baseline is missing, Phase 1 is incomplete. Do not inspect internals with SQL to compensate.

## Endpoint Map

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `http://auth.localhost:3000/graphql` | Platform auth (sign-up, sign-in) | None |
| `http://api.localhost:3000/graphql` | Platform API (database creation) | Platform JWT |
| `http://auth-<subdomain>.localhost:3000/graphql` | Per-database auth | None |
| `http://api-<subdomain>.localhost:3000/graphql` | Per-database app (data) API | Per-database JWT |
| `http://admin-<subdomain>.localhost:3000/graphql` | Per-database admin API | Per-database JWT |

The `<subdomain>` is a platform-assigned random identifier (e.g., `b16-fatal-rose-mosquito`), **not** the database name. After provisioning, parse the actual endpoints from the `create-db.ts` output or query `metaschema_modules_public.database_provision_module` for the `subdomain` column.

The per-database data endpoint is `api-<subdomain>` — the server routes to the correct database off the `Host` header (the path is always `/graphql`). The legacy `app-public-<subdomain>` host is dead; do not use it.

Node.js caveat: `*.localhost` does not resolve reliably in Node.js. The SDK handles Host header routing automatically for both Node.js and browser environments.

Frontend caveat: the sandbox template only manages the platform (`schema-builder`) token. A platform token does not authenticate `api-<subdomain>` (per-database data) calls. If your frontend uses per-database app endpoints, it must establish and store a separate per-database app session via `auth-<subdomain>`.

## Provisioning Flow

Phase 2.3 uses **TypeScript Blueprints** (`BlueprintDefinition` from `node-type-registry`) with `@constructive-io/sdk` for programmatic provisioning. Agents write typed schema modules, then run two scripts.

1. Run `pnpm run create-db` — signs up via auth API, provisions database with an **explicit module list** (the `auth:email` list — never `modules: ['all']`, which silently installs nothing; see gotchas.md PROVISION-001), writes credentials to `.env`.
2. Run `pnpm run provision`:
   - *(SQL only)* Configure database-level settings (`deterministic_ids`, `simple_schema_names`, `schema_use_underscores`) via `ALTER DATABASE`
   - Run schema modules (each defines a `BlueprintDefinition` and calls `provisionBlueprint()`)
   - *(SQL only)* Apply post-provisioning workarounds (`auto-verify-email`, `fix-membership-defaults`) via direct SQL
   - *(SQL only)* Reset provision-only settings (deterministic IDs)
3. Generate schema, SDK, and CLI from the live app endpoint (Phase 2.4).
4. Build the frontend against the generated SDK (Phase 2.5+).

> Steps marked *(SQL only)* require a direct PostgreSQL connection and are included in the `provision.ts` template behind a `pgAvailable` guard. If the agent only has GraphQL API access, they are skipped automatically.

The resulting app tables must live in the Constructive-managed schema family for the database, not in a custom side schema.

In local runs this commonly looks like:

- app tables in `<prefix>-app-public`
- membership defaults in `<prefix>-memberships-public`

These are different schemas, but they share the same Constructive-managed prefix.

## Data Module and Policy Pairing

| Data Module (`nodeType`) | Preferred Policy (`policyType`) | Fields Created |
|--------------------------|----------------------------------|----------------|
| `DataId` | Any | `id` |
| `DataDirectOwner` | `AuthzDirectOwner` | `id`, `owner_id` |
| `DataEntityMembership` | `AuthzEntityMembership` | `id`, `entity_id` |
| `DataOwnershipInEntity` | `AuthzEntityMembership` (and/or `AuthzDirectOwner`) | `id`, `owner_id`, `entity_id` |
| `DataTimestamps` | Any | `id`, `created_at`, `updated_at` |
| `DataPeoplestamps` | Any | `id`, `created_by`, `updated_by` |
| `DataPublishable` | `AuthzPublishable` | `id`, `is_published`, `published_at` |
| `DataSoftDelete` | Any | `id`, `deleted_at`, `is_deleted` |

Notes:

- Every Data module creates `id` by default.
- When composing modules on one table, use `nodeData: { include_id: false }` on the second and later calls.
- `DataPeoplestamps` only adds user FKs when `include_user_fk: true`.

## Authz Policy Types

Read the `constructive-security` skill for the full list of 14 valid Authz* policy types, their configs, and semantics. Read the `constructive-db-data-modules` skill for the Data* → Authz* pairing table.

There is no `AuthzOwnershipInEntity` type. `DataOwnershipInEntity` pairs with `AuthzEntityMembership` and/or `AuthzDirectOwner`.

Prefer `AuthzEntityMembership` over `AuthzMembership` for entity-scoped app data (it emits the `auth_sel_entity_membership` policy — `auth_<verb>_<policytype>`, no hash suffix).

### Common Policy Configurations (Quick Reference)

For the full 14-type reference including `AuthzComposite`, read the `constructive-security` skill. Below are the 6 types most likely needed in typical apps.

| policyType | policyData | Use Case |
|---|---|---|
| `AuthzEntityMembership` | `{ "entity_field": "entity_id", "membership_type": 2 }` | Org-scoped data: all org members can access. Default choice for most app tables |
| `AuthzDirectOwner` | `{ "entity_field": "owner_id" }` | Personal data: only the row creator can access |
| `AuthzDirectOwnerAny` | `{ "entity_fields": ["sender_id", "receiver_id"] }` | Multi-owner: any of the listed user fields grants access |
| `AuthzAllowAll` | `{}` | Public reference data. WARNING: any authenticated user can read AND write |
| `AuthzPublishable` | `{}` | Draft/published gating. Combine with an identity policy |
| `AuthzDenyAll` | `{}` | Explicitly block a privilege |

#### Membership Type Values

- `1` = App scope (global membership)
- `2` = Org scope (entity-bound membership) — use this for most app data
- `3` = Group scope

## App Brief Mapping

When `build/app-brief.yaml` is present:

- `naming.db_name` drives the database name. Per-database endpoints are platform-assigned (discovered from `create-db.ts` output).
- `naming.*_package` values drive package names used in examples and generated code.
- `app.workspace_root` defines where the app is built.
- `data_model.tables` and `data_model.relations` define the schema to provision.
- `acceptance.required_flows` defines what the app-specific UI must satisfy.
