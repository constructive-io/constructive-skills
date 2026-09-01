---
name: constructive-features
description: "Route Constructive application briefs to App Kit composition, optional Blocks platform-capability packs, and authoritative domain skills. Use when asked how to build an internal app from records, forms, dashboards, boards, calendars, or workflows; what Constructive supports; which feature pack provides auth, users, organizations, storage, billing, or notifications; or which skill owns a capability."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Features

Translate product intent into an application-composition lane, optional
platform-capability surfaces, and the domain skill that owns backend behavior.
Do not use this as an installation catalog: [`constructive-blocks`](../constructive-blocks/SKILL.md)
owns exact roots, dependency closure, runtime contracts, and verification.

## Route application composition first

1. Rewrite the brief as user intents, record/relationship shapes,
   presentation geometry, and workflow behavior. Do not start from a
   department name.
2. Activate `constructive-blocks` and query its validated App Kit catalog.
   Match the returned metadata and inspect dependency closure instead of
   maintaining a root map here.
3. Compare the selection with the deterministic fixtures in
   [`constructive-blocks/references/brief-to-roots.v1.json`](../constructive-blocks/references/brief-to-roots.v1.json)
   when auditing selection.
4. Activate [`constructive-frontend`](../constructive-frontend/SKILL.md) after
   selection when the application needs custom visual composition.

Use the branch-aware App Kit documentation authority returned by the validated
Blocks catalog for exact contracts. Do not default to Sheets, Console Kit, a
dashboard, board, or review queue merely because the domain contains records or
statuses.

## Route optional platform capabilities

| Product intent | Blocks pack | Domain skills |
|---|---|---|
| Explore application tables and perform dynamic CRUD | Data (`data`) | [`constructive-frontend`](../constructive-frontend/SKILL.md), [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md), [`constructive-security`](../constructive-security/SKILL.md) |
| Sign up, sign in, recover an account, or manage a personal session | Authentication (`auth`) | [`constructive-auth`](../constructive-auth/SKILL.md) |
| Govern application members, invitations, profiles, and capabilities | App access (`users`) | [`constructive-access-control`](../constructive-access-control/SKILL.md), [`constructive-principals`](../constructive-principals/SKILL.md) |
| Govern organizations, members, hierarchy, principals, and API keys | Organizations (`organizations`) | [`constructive-entities`](../constructive-entities/SKILL.md), [`constructive-access-control`](../constructive-access-control/SKILL.md), [`constructive-principals`](../constructive-principals/SKILL.md) |
| Browse buckets and objects or perform upload/download actions | Storage (`storage`) | [`constructive-storage`](../constructive-storage/SKILL.md), [`constructive-security`](../constructive-security/SKILL.md) |
| Manage plans, subscriptions, usage, entitlements, and credits | Billing (`billing`) | [`constructive-billing`](../constructive-billing/SKILL.md) |
| Read and manage an application notification inbox | Notifications (`notifications`) | [`constructive-notifications`](../constructive-notifications/SKILL.md), [`constructive-realtime`](../constructive-realtime/SKILL.md) |

After selecting a platform capability, activate `constructive-blocks` to choose
and install its supported surface. Keep it orthogonal to the App Kit application
composition and do not infer a registry root from a display name.

## Surface Router

| User intent | Route |
|---|---|
| “Give me the complete tenant console” | `constructive-blocks` → Console Kit umbrella |
| “Match the console to an official backend preset” | `constructive-blocks` → official preset surface |
| “Put these selected capabilities in Console Kit” | `constructive-blocks` → core plus selected Console modules |
| “Embed this capability in my own screen” | `constructive-blocks` → standalone feature pack |
| “Build an application around my domain schema” | `constructive-blocks` → App Kit composition, then [`constructive-frontend`](../constructive-frontend/SKILL.md) for visual customization |
| “Build one bespoke domain page with no App Kit view fit” | [`constructive-frontend`](../constructive-frontend/SKILL.md); follow its [current `_meta` guidance](../constructive-frontend/references/meta-forms.md) |
| “Assemble and acceptance-check this tenant frontend” | [`constructive-builder`](../constructive-builder/SKILL.md) with an existing app workspace and already-provisioned tenant |

## Rules

1. **Keep installation and backend behavior separate.** A feature pack installs a frontend surface; it does not provision modules, expose an endpoint, or grant authorization.
2. **Keep installation and acceptance separate.** Sign-up, sign-in, CRUD, membership, and RLS checks are acceptance scenarios inside a capability, not feature-pack identifiers.
3. **Treat runtime evidence as authoritative for Console availability.** An installed Console module may be `ready`, `partial`, or `unavailable` for the active tenant and identity. A non-Data standalone pack instead renders the resources, policy, actions, and state supplied by its host; standalone Data validates its configured endpoint internally.
4. **Do not derive routes.** Pass explicit semantic endpoints through the tenant descriptor; never construct sibling hosts or use private routing headers for application UI.
5. **Ground App Kit at build time.** Reconcile `_meta` with final executable GraphQL introspection, then emit explicit typed definitions through the selected SDK/ORM or GraphQL transport. Keep Console discovery and feature-pack host contracts separate from this application lane.

## Domain Skills Beyond Feature Packs

| Capability | Skill |
|---|---|
| RLS, ownership, grants, and Constructive Authz policy behavior | [`constructive-security`](../constructive-security/SKILL.md) |
| Tables, fields, relations, constraints, indexes, enums, and views | [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md) |
| Full-text, fuzzy, vector, spatial, and unified search | [`constructive-search`](../constructive-search/SKILL.md) |
| Agents, embeddings, LLM providers, and RAG | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Events, achievements, referrals, gamification, and progressive trust | [`constructive-events`](../constructive-events/SKILL.md) |
| Subscriptions and change tracking | [`constructive-realtime`](../constructive-realtime/SKILL.md) |
| Background jobs and triggers | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Internationalized data and multilingual search | [`constructive-i18n`](../constructive-i18n/SKILL.md) |
| Flow-based computation graphs | [`constructive-flow-graphs`](../constructive-flow-graphs/SKILL.md) |
| Services, public routing, deployment, and CNC | [`constructive-platform`](../constructive-platform/SKILL.md) |

See the repository-level [`features.md`](../../../features.md) for the compact capability index.
