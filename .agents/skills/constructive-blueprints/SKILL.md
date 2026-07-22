---
name: constructive-blueprints
description: "Declarative schema definition — blueprints, node type registry, presets, and the blueprint definition format. Use when asked to 'create a blueprint', 'blueprint template', 'construct blueprint', 'copy template', 'blueprint definition', 'definition hash', 'table hashes', 'schema marketplace', 'blueprint provisioning', 'module presets', 'what modules should I install', 'auth:email preset', 'b2b preset', or when working with blueprint JSONB definitions."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Blueprints

Declarative schema provisioning — define complete domain schemas as portable JSONB documents that compile into PostgreSQL tables, relations, security policies, and modules.

## When to Apply

Use this skill when:
- Defining a blueprint (tables, fields, relations, policies, entity types)
- Working with blueprint templates and the template marketplace
- Choosing module presets (`minimal`, `auth:email`, `b2b`, `full`, etc.)
- Understanding Merkle-style definition hashing for deduplication and provenance
- Using `construct_blueprint()` or `copy_template_to_blueprint()`

## Core Concepts

### Two-Layer Model

- **`blueprint_template`** — shareable marketplace recipe. Immutable definition + metadata.
- **`blueprint`** — owned, executable instance scoped to a database. Created from a template via `copy_template_to_blueprint()` or authored directly.

### Blueprint Definition Format

The `definition` JSONB contains:
- `entity_types[]` — Phase 0 entity provisioning (channels, teams, data rooms)
- `storage` — Phase 0.5 app-level storage config
- `tables[]` with `nodes[]`, `fields[]`, `policies[]` (using `$type` discriminators)
- `relations[]` — inter-table relationships
- `achievements[]` — gamification levels and rewards
- `limit_caps_defaults` — per-scope default caps
- `membership_types[]` — scope configurations (app, org, custom)

See [blueprint-definition-format.md](./references/blueprint-definition-format.md) for the full spec.

### Construction Lifecycle

```
blueprint.definition (JSONB)
  → construct_blueprint()
    → Phase 0: entity_type_provision (entity_types[])
    → Phase 0.5: storage provisioning
    → Phase 1: secure_table_provision (tables[] with nodes/fields/policies)
    → Phase 2: relation_provision (relations[])
    → Phase 3: post-processing (achievements, limits, jobs)
```

### Merkle Hashing

- `definition_hash` — Merkle root of the entire blueprint definition
- `table_hashes` — per-table UUIDv5 hashes for structural comparison
- Backend-computed via trigger using `uuid_generate_v5(uuid_ns_url(), jsonb::text)`
- Enables deduplication, provenance tracking, and structural diffing

### Module Presets

Curated bundles of modules for common app shapes. Pass `preset.modules` into `db.databaseProvisionModule.create()` to install.

| Preset | Shape |
|--------|-------|
| `minimal` | No auth, bare tables |
| `auth:email` | Email + password |
| `auth:email+magic` | + magic links, email OTP |
| `auth:sso` | + OAuth/SSO providers |
| `auth:passkey` | + WebAuthn passkeys |
| `auth:hardened` | + rate limits, device approval |
| `b2b` | + orgs, invites, permissions, profiles, limits |
| `full` | Everything including devices, crypto, advanced limits |

Lives in `@constructive-io/node-type-registry` — exported as `allModulePresets` and `getModulePreset(name)`.

See [module-presets.md](./references/module-presets.md) for the full preset catalog.

### Node Type Registry

The node type registry defines all node types available in blueprint definitions:

- **Data nodes** — field generators: `DataId`, `DataTimestamps`, `DataDirectOwner`, `DataEntityMembership`, `DataOwnershipInEntity`, `DataMemberOwner`, `DataI18n`, `DataPublishable`, `DataGenerated` (stored or PG18 virtual generated columns via `generation_type`)
- **Search nodes** — `SearchUnified`, `SearchVector`, `SearchFullText`
- **Process nodes** — `ProcessFileEmbedding`, `ProcessImageEmbedding`, `ProcessChunks`
- **Job nodes** — `JobTrigger`
- **Event nodes** — `EventTracker`, `EventReferral`
- **Limit nodes** — `LimitCounter`, `LimitAggregate`, `LimitFeatureFlag`
- **Security nodes** — all 19 registry-selectable Authz* policy types, incl. `AuthzSystemOnly` (see `constructive-security`)

See [node-type-registry.md](./references/node-type-registry.md) for the full catalog.

## References

| File | Content |
|------|---------|
| [blueprint-definition-format.md](./references/blueprint-definition-format.md) | Full definition spec with examples |
| [blueprints.md](./references/blueprints.md) | System reference — templates, construction, hashing |
| [module-presets.md](./references/module-presets.md) | Preset catalog, shape, and per-module rationale |
| [node-type-registry.md](./references/node-type-registry.md) | All node type families and their config shapes |

## Cross-References

- **Security policies on tables:** [`constructive-security`](../constructive-security/SKILL.md)
- **Entity types in blueprints:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Data modeling (tables, fields, relations):** [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md)
- **Search nodes detail:** [`constructive-search`](../constructive-search/SKILL.md)
- **Job nodes detail:** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Event nodes detail:** [`constructive-events`](../constructive-events/SKILL.md)
