# Constructive application composition and capabilities

Constructive domain applications are composed with App Kit resources, queries,
actions, and view families. Feature packs remain frontend surfaces for optional
platform capabilities; they do not provision backend modules or grant access.

Use [`constructive-blocks`](./.agents/skills/constructive-blocks/SKILL.md) for
App Kit selection, exact registry roots, installation, Console Kit composition,
tenant scope, capability discovery, and verification. Use the domain skills
below when changing underlying application behavior.

## App Kit

Select App Kit from the brief's data geometry and user tasks: core contracts
for every domain application, data views for records and relations, board for
semantic stage movement, dashboard for explicit analytical loaders, calendar
for range-based temporal views, and workflow for semantic actions and guided
steps. Do not default to Sheets, Console Kit, or a review queue.

## Feature packs

| Pack | User-facing capability | Domain guidance |
|---|---|---|
| Data (`data`) | `_meta`-driven application table exploration and spreadsheet CRUD | [`constructive-frontend`](./.agents/skills/constructive-frontend/SKILL.md), [`constructive-data-modeling`](./.agents/skills/constructive-data-modeling/SKILL.md), [`constructive-security`](./.agents/skills/constructive-security/SKILL.md) |
| Authentication (`auth`) | Sign-up, sign-in, recovery, personal account, and session controls | [`constructive-auth`](./.agents/skills/constructive-auth/SKILL.md) |
| App access (`users`) | Application members, invitations, profiles, capabilities, and defaults | [`constructive-access-control`](./.agents/skills/constructive-access-control/SKILL.md), [`constructive-principals`](./.agents/skills/constructive-principals/SKILL.md) |
| Organizations (`organizations`) | Organization selection, membership governance, invitations, hierarchy, principals, and API keys | [`constructive-entities`](./.agents/skills/constructive-entities/SKILL.md), [`constructive-access-control`](./.agents/skills/constructive-access-control/SKILL.md), [`constructive-principals`](./.agents/skills/constructive-principals/SKILL.md) |
| Storage (`storage`) | Buckets, folders, objects, upload, download, and deletion | [`constructive-storage`](./.agents/skills/constructive-storage/SKILL.md), [`constructive-security`](./.agents/skills/constructive-security/SKILL.md) |
| Billing (`billing`) | Plans, subscriptions, usage, entitlements, credits, and activity | [`constructive-billing`](./.agents/skills/constructive-billing/SKILL.md) |
| Notifications (`notifications`) | Notification inbox with read, open, and delete actions | [`constructive-notifications`](./.agents/skills/constructive-notifications/SKILL.md), [`constructive-realtime`](./.agents/skills/constructive-realtime/SKILL.md) |

Installed and available are different states. Console Kit discovers each installed module from an explicit tenant endpoint map, the current `_meta` contract where applicable, standard GraphQL introspection, and authenticated runtime behavior. PostgreSQL privileges and RLS remain authoritative, so a Console module can correctly resolve to `ready`, `partial`, or `unavailable` for a particular tenant and identity. Standalone packs use the separate host contracts described below.

## Assembly surfaces

Choose the smallest Blocks surface that owns the intended experience:

| Goal | Surface |
|---|---|
| A complete tenant console | Console Kit umbrella |
| A backend-aligned application console | Official preset root |
| A focused tenant console | Console Kit core plus selected console modules |
| A host-controlled screen | Standalone feature pack |
| An application around domain records and actions | App Kit capability roots |
| A custom visual component | Constructive UI primitive or block |

The six non-Data standalone packs are provider-neutral views driven by host-injected resources, policy, actions, and state. Standalone Data is adapter-driven: the host configures its endpoint and adapter boundary, while the pack performs its own `_meta` and GraphQL introspection.

The canonical names, dependency closure, shadcn command, runtime requirements, and verification steps come from the Blocks install contract. Do not reproduce those lists in an application brief or derive them from backend module names.

## Capability routing

| Intent | Skill |
|---|---|
| Compose App Kit or install feature packs, Console Kit, app shell, billing blocks, or UI primitives | [`constructive-blocks`](./.agents/skills/constructive-blocks/SKILL.md) |
| Assemble and acceptance-check a tenant frontend against an already-provisioned tenant | [`constructive-builder`](./.agents/skills/constructive-builder/SKILL.md) |
| Style or compose custom application UI | [`constructive-frontend`](./.agents/skills/constructive-frontend/SKILL.md) |
| Configure identity, sessions, MFA, devices, or account linking | [`constructive-auth`](./.agents/skills/constructive-auth/SKILL.md) |
| Define RLS, grants, ownership, or Constructive Authz policy behavior | [`constructive-security`](./.agents/skills/constructive-security/SKILL.md) |
| Define roles, profiles, capabilities, grants, or hierarchy | [`constructive-access-control`](./.agents/skills/constructive-access-control/SKILL.md) |
| Issue, scope, or revoke API keys, principals, or machine identities | [`constructive-principals`](./.agents/skills/constructive-principals/SKILL.md) |
| Model organizations, memberships, and invitations | [`constructive-entities`](./.agents/skills/constructive-entities/SKILL.md) |
| Create tables, fields, relations, constraints, indexes, enums, or views | [`constructive-data-modeling`](./.agents/skills/constructive-data-modeling/SKILL.md) |
| Work with plans, limits, credits, entitlements, and metering | [`constructive-billing`](./.agents/skills/constructive-billing/SKILL.md) |
| Configure object storage and upload behavior | [`constructive-storage`](./.agents/skills/constructive-storage/SKILL.md) |
| Configure notification delivery and preferences | [`constructive-notifications`](./.agents/skills/constructive-notifications/SKILL.md) |
| Add full-text, fuzzy, vector, spatial, or unified search | [`constructive-search`](./.agents/skills/constructive-search/SKILL.md) |
| Add agents, embeddings, or RAG | [`constructive-agents`](./.agents/skills/constructive-agents/SKILL.md) |
| Add events, achievements, referrals, gamification, or a progressive trust ladder | [`constructive-events`](./.agents/skills/constructive-events/SKILL.md) |
| Add subscriptions or change tracking | [`constructive-realtime`](./.agents/skills/constructive-realtime/SKILL.md) |
| Add background jobs or triggers | [`constructive-jobs`](./.agents/skills/constructive-jobs/SKILL.md) |
| Add multilingual data and search | [`constructive-i18n`](./.agents/skills/constructive-i18n/SKILL.md) |
| Add row history, audit logs, point-in-time reads, or restore/rollback | [`constructive-history`](./.agents/skills/constructive-history/SKILL.md) |
| Build flow-based computation graphs | [`constructive-flow-graphs`](./.agents/skills/constructive-flow-graphs/SKILL.md) |
| Generate a typed client for a stable custom-domain schema | [`constructive-codegen`](./.agents/skills/constructive-codegen/SKILL.md) |
| Use an optional generated ORM or hook layer for custom-domain code | [`constructive-orm`](./.agents/skills/constructive-orm/SKILL.md), [`constructive-hooks`](./.agents/skills/constructive-hooks/SKILL.md) |
| Build a runtime `_meta`-driven custom-domain route | [`constructive-frontend` current metadata guidance](./.agents/skills/constructive-frontend/references/meta-forms.md) |
| Configure services, public API routing, deployment, or the CNC CLI | [`constructive-platform`](./.agents/skills/constructive-platform/SKILL.md) |

## Runtime boundaries

- Treat feature-pack installation, backend provisioning, and acceptance scenarios as separate decisions. Authentication scenarios such as password sign-in or recovery are tests within the Authentication pack, not install units.
- Pass a secret-free database identity and explicit semantic endpoints. Never derive related endpoint hostnames or send tenant credentials to an inferred route.
- For App Kit or another custom-domain route, use `_meta` for Constructive
  schema facts and final GraphQL introspection for exact executable names. Run
  App Kit resource validation at generation/build time; neither schema source
  proves the current user's write authority.
- Let runtime reads and mutations establish effective grants and RLS behavior. Do not replace an empty RLS result with an operator endpoint or private routing header.
- Generate or refresh typed App Kit definitions from the final schema. Console
  Kit capability discovery and feature-pack host contracts remain separate and
  do not require an application-wide process-global client.
