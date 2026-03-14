---
name: constructive
description: "Constructive platform architecture and core concepts — security model (Safegres authorization protocol), service/schema configuration, Docker deployment, PostGraphile server, Knative cloud functions, and the cnc CLI execution engine. Use when working with Constructive platform setup, configuration, or understanding the overall architecture."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Platform

Consolidated reference for the Constructive platform's core architecture: authorization, services, deployment, server configuration, cloud functions, and the CLI execution engine.

## Security Model (Safegres)

- Defines the Safegres authorization protocol: 14 Authz* policy node types expressed as JSON config, compiled to PostgreSQL RLS
- Covers the critical distinction between unbound (`AuthzMembership`) and bound (`AuthzEntityMembership`) policies
- Explains permissive vs restrictive policy composition and `AuthzComposite` boolean expression trees
- Core vocabulary: actors, entities, membership types (App/Org/Group), and the "users are organizations" identity model

**Triggers:** "Safegres policy", "authorization protocol", "Authz* node types", "RLS policy composition", "security model"

See [security-model.md](./references/security-model.md) for details.

## Services & Schemas

- Create and configure API services, attach database schemas, set up domain/subdomain routing, and manage schema grants via the `@constructive-io/sdk`
- Entity hierarchy: Database > Schema > Api > ApiSchema, ApiModule, Domain, Site
- Full CRUD examples for Api, ApiSchema, ApiModule, Domain, SchemaGrant, and Site entities
- Includes an end-to-end example setting up multiple APIs with different roles

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
- Project structure, build workflow (makage), testing, publishing, and error handling

**Triggers:** "create a cloud function", "build serverless function", "Knative function", "deploy function to Kubernetes", "run PGPM in a function"

See [cloud-functions.md](./references/cloud-functions.md) for details.

## CNC CLI Execution Engine

- Execute raw GraphQL queries against Constructive APIs using the `cnc` CLI
- Context management (create, list, switch, delete) similar to kubectl contexts, stored in `~/.cnc/config/`
- Authentication: secure token storage, per-context credentials, expiration support
- Query execution: inline queries, file-based queries, variables, and multi-environment workflows

**Triggers:** "run a query", "execute GraphQL", "set up API context", "configure API token", "manage API endpoints", "cnc execute"

See [cnc-cli.md](./references/cnc-cli.md) for details.
