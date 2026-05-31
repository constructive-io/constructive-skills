---
name: constructive-platform
description: "Platform core — services/schemas, deployment, server config, cloud functions, environment configuration, and the cnc CLI execution engine. Use when asked to 'deploy constructive', 'start the server', 'cnc server', 'GraphQL API', 'configure domains', 'cloud functions', 'Knative', 'env config', 'cnc execute', 'docker compose', 'set up service', 'API routing', 'services_public', or when working with server deployment or environment configuration."
metadata:
  author: constructive-io
  version: "1.0.0"
  user-invocable: "false"
---

# Constructive Platform

Server configuration, services/schemas, deployment, cloud functions, environment configuration, and the cnc CLI execution engine.

## When to Apply

Use this skill when:
- Starting the Constructive GraphQL server or GraphiQL explorer
- Configuring services, APIs, domains, and schema grants
- Deploying with Docker Compose or building Docker images
- Writing Knative cloud functions
- Configuring environment variables and config files
- Using the cnc CLI for queries and context management

## Services & Schemas

- Create and configure API services, attach database schemas, set up domain/subdomain routing, and manage schema grants
- Entity hierarchy: Database > Schema > Api > ApiSchema, ApiModule, Domain, Site
- Full CRUD via ORM for Api, ApiSchema, ApiModule, Domain, SchemaGrant, and Site entities

See [services-schemas.md](./references/services-schemas.md) for details. See [services-schemas-entity-fields.md](./references/services-schemas-entity-fields.md) for the full field reference.

## Deployment

- Local development with Docker Compose (Postgres, MinIO, application servers)
- Database deployment with pgpm: bootstrap roles, deploy modules, verify, and revert
- Docker image build process: multi-stage build, CLI shims (`constructive`, `cnc`, `pgpm`)
- Makefile targets, environment variables, networking, and troubleshooting

See [deployment.md](./references/deployment.md) for details.

## Server Configuration

- Running the Constructive GraphQL server (`cnc server`), GraphiQL explorer (`cnc explorer`), and code generation (`cnc codegen`)
- API routing modes: public (domain-based) vs admin (header-based), Services API routing
- The schema-to-GraphQL pipeline: PostgreSQL schemas > PostGraphile introspection > GraphQL API > codegen > typed client

See [server-config.md](./references/server-config.md) for details.

## Cloud Functions

- Build and deploy Knative-style TypeScript HTTP cloud functions (email, webhooks, background jobs)
- Function handler pattern: `export default async (params, context) => { ... }` with GraphQL client access
- Direct database access via `pg-cache`, programmatic PGPM usage, Docker builds, and Kubernetes deployment

See [cloud-functions.md](./references/cloud-functions.md) for details.

## Environment Configuration

- Unified, type-safe environment configuration for all Constructive and PGPM projects
- Two packages: `@pgpmjs/env` (core) and `@constructive-io/graphql-env` (extends with GraphQL/API options)
- Merge hierarchy: defaults > config file > env vars > runtime overrides

See [env-config.md](./references/env-config.md) for details.

Sub-references:
- [env-defaults.md](./references/env-defaults.md) — Default values for all configuration options
- [env-vars.md](./references/env-vars.md) — Source file locations for env vars and types
- [env-config-file.md](./references/env-config-file.md) — Config file reference (`pgpm.json`)

## CNC CLI Execution Engine

- Execute raw GraphQL queries against Constructive APIs using the `cnc` CLI
- Context management (create, list, switch, delete) similar to kubectl contexts, stored in `~/.cnc/config/`
- Authentication: secure token storage, per-context credentials, expiration support

See [cnc-cli.md](./references/cnc-cli.md) for details.

## References

| File | Content |
|------|---------|
| [server-config.md](./references/server-config.md) | Server, explorer, API routing, schema pipeline |
| [services-schemas.md](./references/services-schemas.md) | Services, APIs, domains, schema grants |
| [services-schemas-entity-fields.md](./references/services-schemas-entity-fields.md) | Full field reference for services entities |
| [deployment.md](./references/deployment.md) | Docker Compose, pgpm deploy, image build |
| [cloud-functions.md](./references/cloud-functions.md) | Knative cloud functions |
| [env-config.md](./references/env-config.md) | Environment configuration overview |
| [env-config-file.md](./references/env-config-file.md) | Config file reference |
| [env-defaults.md](./references/env-defaults.md) | Default values |
| [env-vars.md](./references/env-vars.md) | Environment variable reference |
| [cnc-cli.md](./references/cnc-cli.md) | CNC CLI execution engine |

## Cross-References

- **Blueprints (definition format, presets, construction):** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Auth (MFA, sessions, devices, service settings):** [`constructive-auth`](../constructive-auth/SKILL.md)
- **Security (Safegres, Authz*, RLS, storage policies):** [`constructive-security`](../constructive-security/SKILL.md)
- **Background jobs:** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Code generation:** [`constructive-codegen`](../constructive-codegen/SKILL.md)
