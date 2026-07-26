---
name: constructive-codegen
description: "Generate optional typed TypeScript clients, ORM models, React Query hooks, CLIs, and schema artifacts from a stable GraphQL schema. Use when compile-time domain types justify a regeneration workflow or when configuring @constructive-io/graphql-codegen. Do not use codegen as a prerequisite for Constructive feature packs or Console Kit."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Codegen

Generate typed artifacts from a known GraphQL schema for custom domain code. Codegen is an opt-in compile-time tool. Console Kit discovers tenant capabilities at runtime, standalone Data introspects through Sheets, and the other standalone feature packs consume host-injected contracts; none require generated SDK aliases or sidecars.

## When to Apply

Use this skill when:

- A stable custom-domain schema benefits from compile-time model and operation types.
- Generating a server-side ORM client or a fixed-endpoint React Query layer.
- Exporting deterministic GraphQL SDL for builds or distribution.
- Generating a CLI or documentation from a known schema.
- Configuring `@constructive-io/graphql-codegen` or `cnc codegen` directly.

Do not activate codegen merely because an app uses Constructive Blocks. For feature packs, Console Kit, generic tenant exploration, and `_meta`-driven CRUD, use [`constructive-blocks`](../constructive-blocks/SKILL.md) and [`constructive-frontend`](../constructive-frontend/SKILL.md).

## Decision Rule

| Situation | Data layer |
|---|---|
| Tenant schema and endpoints vary at runtime | Blocks runtime and `@constructive-io/data` |
| Generic application table explorer | Data feature pack |
| Stable domain schema with bespoke UI | Optional generated ORM or hooks |
| Server workflow against one explicit endpoint per request | Generated ORM client created for that scope |
| Operator/platform schema | Platform-specific client, kept outside the tenant Console runtime |

## Pipeline

```text
schema file or explicit endpoint
  → GraphQL introspection and AST normalization
  → selected generators
  → typed artifacts committed or rebuilt by the application
```

Prefer a checked-in schema file for deterministic builds. When introspecting a live endpoint, pass the exact URL and temporary introspection credentials explicitly; never derive a sibling route from another tenant endpoint.

## Generation Targets

| Target | Intended use |
|---|---|
| ORM | Per-request or per-tenant typed custom-domain queries |
| React Query hooks | Fixed-endpoint custom-domain React applications |
| CLI | Interactive or automated domain operations |
| Schema export | Reproducible SDL input for subsequent generation |

Only generate the targets the consumer owns. Do not generate auth/admin SDKs as a hidden prerequisite for a registry install.

## Runtime Isolation

- Create endpoint-scoped clients or request functions from an explicit tenant descriptor.
- Keep bearer tokens in the host session boundary and out of generated source, props, global stores, and committed config.
- Avoid module-global mutable client configuration when tenants, endpoints, or identities can change.
- Regenerate only for schema changes, not for a runtime tenant or session switch.
- Keep operator clients separate from application-database clients so an RLS-empty result cannot fall through to privileged access.

## References

| File | Content |
|---|---|
| [codegen.md](./references/codegen.md) | Workflow overview and target selection |
| [codegen-config-reference.md](./references/codegen-config-reference.md) | Configuration options |
| [codegen-generate-schemas.md](./references/codegen-generate-schemas.md) | Schema export |
| [codegen-generate-sdk.md](./references/codegen-generate-sdk.md) | Optional ORM and hook generation |
| [codegen-generate-cli.md](./references/codegen-generate-cli.md) | CLI generation |
| [codegen-cli-reference.md](./references/codegen-cli-reference.md) | CLI flags |
| [codegen-relations.md](./references/codegen-relations.md) | Generated relation handling |
| [codegen-error-handling.md](./references/codegen-error-handling.md) | Generated-client error handling |

## Cross-References

- [`constructive-blocks`](../constructive-blocks/SKILL.md) — standalone feature-pack contracts and runtime-discovered Console modules.
- [`constructive-frontend`](../constructive-frontend/SKILL.md) — choosing runtime data versus generated custom-domain UI.
- [`constructive-orm`](../constructive-orm/SKILL.md) — per-scope generated ORM usage.
- [`constructive-hooks`](../constructive-hooks/SKILL.md) — generated hook constraints and cache patterns.
