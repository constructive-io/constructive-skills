---
name: constructive
description: "Constructive platform architecture and core concepts — blueprints (declarative schema provisioning with Merkle hashing), security model (Safegres authorization protocol), service/schema configuration, Docker deployment, PostGraphile server, Knative cloud functions, environment configuration, and the cnc CLI execution engine."
metadata:
  author: constructive-io
  version: "1.0.0"
  user-invocable: "false"
---

# Constructive Platform

Consolidated reference for the Constructive platform's core architecture: blueprints, authorization, services, deployment, server configuration, cloud functions, environment configuration, and the CLI execution engine.

## Blueprints

- Declarative schema provisioning system — define complete domain schemas as portable JSONB documents
- Two-layer model: `blueprint_template` (shareable marketplace recipe) and `blueprint` (owned, executable instance scoped to a database)
- Definition format: `membership_types[]` (Phase 0 entity provisioning), `tables[]` with `nodes[]`, `fields[]`, `policies[]` (using `$type` discriminators), and `relations[]`
- `construct_blueprint()` executes a draft blueprint, provisioning real tables and relations via `secure_table_provision` + `relation_provision`
- `copy_template_to_blueprint()` copies a template to a new blueprint with visibility checks and copy_count tracking
- Merkle-style content-addressable hashing: `definition_hash` (Merkle root) and `table_hashes` (per-table UUIDv5 hashes) for deduplication, provenance tracking, and structural comparison
- Hashes are backend-computed via trigger using `uuid_generate_v5(uuid_ns_url(), jsonb::text)` — same pattern as `object_store.object_hash_uuid()`

**Triggers:** "create a blueprint", "blueprint template", "construct blueprint", "copy template", "blueprint definition", "definition hash", "table hashes", "schema marketplace", "blueprint provisioning"

See [blueprints.md](./references/blueprints.md) for the full system reference.

Sub-references:
- [blueprint-definition-format.md](./references/blueprint-definition-format.md) — The blueprint definition format spec with complete examples

## Storage Security Policies

- Configurable per-bucket RLS policies via `storage_config.policies[]` on `entity_type_provision`
- Compose specific `Authz*` node types per entity type's storage tables (buckets, files, upload_requests)
- Two layers: `is_public` controls S3 bucket ACL (transport), `policies` controls RLS (data)
- When `policies` is omitted, defaults apply (membership + AuthzPublishable + AuthzDirectOwner)

**Triggers:** "storage policies", "bucket security", "storage_config", "file access control", "upload permissions", "is_public vs policies"

See [storage-policies.md](./references/storage-policies.md) for typical policy combinations and the full provisioning pipeline.

## Security Model (Safegres)

The Safegres authorization protocol is now its own top-level skill: **[`constructive-safegres`](../constructive-safegres/SKILL.md)**.

It covers: 14 Authz* policy node types, permissive vs restrictive composition, `AuthzComposite` boolean trees, and the "users are organizations" identity model.

**Triggers:** "Safegres policy", "authorization protocol", "Authz* node types", "RLS policy composition", "security model" → see [`constructive-safegres`](../constructive-safegres/SKILL.md)

## Services & Schemas

- Create and configure API services, attach database schemas, set up domain/subdomain routing, and manage schema grants via the `@constructive-io/sdk`
- Entity hierarchy: Database > Schema > Api > ApiSchema, ApiModule, Domain, Site
- Full CRUD examples for Api, ApiSchema, ApiModule, Domain, SchemaGrant, and Site entities

**Triggers:** "create an API", "set up a service", "attach schema to API", "configure domains", "add API module", "grant schema access", "set up service routing"

See [services-schemas.md](./references/services-schemas.md) for details. See [services-schemas-entity-fields.md](./references/services-schemas-entity-fields.md) for the full field reference.

## Deployment

- Local development with Docker Compose (Postgres, MinIO, application servers)
- Database deployment with pgpm: bootstrap roles, deploy modules, verify, and revert
- Docker image build process: multi-stage build, CLI shims (`constructive`, `cnc`, `pgpm`)
- Makefile targets, environment variables, networking, and troubleshooting

**Triggers:** "deploy constructive", "set up docker compose", "run constructive locally", "deploy to production", "build Docker image"

See [deployment.md](./references/deployment.md) for details.

## Server Configuration

- Running the Constructive GraphQL server (`cnc server`), GraphiQL explorer (`cnc explorer`), and code generation (`cnc codegen`)
- API routing modes: public (domain-based) vs admin (header-based), Services API routing
- The schema-to-GraphQL pipeline: PostgreSQL schemas > PostGraphile introspection > GraphQL API > codegen > typed client
- Environment variables, exposed schemas, CI integration, and troubleshooting

**Triggers:** "start the server", "run cnc server", "start GraphQL API", "run GraphiQL", "configure API routing", "generate types"

See [server-config.md](./references/server-config.md) for details.

## Cloud Functions

- Build and deploy Knative-style TypeScript HTTP cloud functions (email, webhooks, background jobs)
- Function handler pattern: `export default async (params, context) => { ... }` with GraphQL client access
- Direct database access via `pg-cache`, programmatic PGPM usage, Docker builds, and Kubernetes deployment

**Triggers:** "create a cloud function", "build serverless function", "Knative function", "deploy function to Kubernetes", "run PGPM in a function"

See [cloud-functions.md](./references/cloud-functions.md) for details.

## Environment Configuration

- Unified, type-safe environment configuration for all Constructive and PGPM projects
- Two packages: `@pgpmjs/env` (core) and `@constructive-io/graphql-env` (extends with GraphQL/API options)
- Merge hierarchy: defaults > config file > env vars > runtime overrides
- Utility functions: `parseEnvBoolean`, `parseEnvNumber`, `getNodeEnv`

**Triggers:** "configure environment", "set env vars", "use getEnvOptions", "configure database connection", "configuration hierarchy"

See [env-config.md](./references/env-config.md) for details.

Sub-references:
- [env-defaults.md](./references/env-defaults.md) — Default values for all configuration options
- [env-vars.md](./references/env-vars.md) — Source file locations for env vars and types
- [env-config-file.md](./references/env-config-file.md) — Config file reference (`pgpm.json`)

## CNC CLI Execution Engine

- Execute raw GraphQL queries against Constructive APIs using the `cnc` CLI
- Context management (create, list, switch, delete) similar to kubectl contexts, stored in `~/.cnc/config/`
- Authentication: secure token storage, per-context credentials, expiration support

**Triggers:** "run a query", "execute GraphQL", "set up API context", "configure API token", "manage API endpoints", "cnc execute"

See [cnc-cli.md](./references/cnc-cli.md) for details.
