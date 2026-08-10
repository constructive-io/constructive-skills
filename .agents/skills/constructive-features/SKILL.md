---
name: constructive-features
description: "Route Constructive application capabilities to the correct Blocks feature pack and authoritative domain skill. Use when asked what Constructive supports, which feature pack provides data, auth, users, organizations, storage, billing, or notifications, whether to use Console Kit or a standalone pack, or which skill owns an application capability."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Features

Use this skill to translate product intent into a frontend feature-pack choice and the domain skill that owns the underlying behavior. Do not use it as an installation catalog: [`constructive-blocks`](../constructive-blocks/SKILL.md) owns exact registry roots, dependency closure, runtime contracts, and verification.

## When to Apply

Use this skill when:

- A user asks what Constructive can do or which skill covers a capability.
- An application brief needs feature-pack intent before installation is planned.
- You need to distinguish a standalone view, a selected Console Kit composition, and a complete Console Kit.
- A capability spans frontend presentation and backend behavior, and ownership needs to be made explicit.

## Feature-Pack Router

| Product intent | Blocks pack | Domain skills |
|---|---|---|
| Explore application tables and perform dynamic CRUD | Data (`data`) | [`constructive-frontend`](../constructive-frontend/SKILL.md), [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md), [`constructive-security`](../constructive-security/SKILL.md) |
| Sign up, sign in, recover an account, or manage a personal session | Authentication (`auth`) | [`constructive-auth`](../constructive-auth/SKILL.md) |
| Govern application members, invitations, profiles, and capabilities | App access (`users`) | [`constructive-access-control`](../constructive-access-control/SKILL.md), [`constructive-principals`](../constructive-principals/SKILL.md) |
| Govern organizations, members, hierarchy, principals, and API keys | Organizations (`organizations`) | [`constructive-entities`](../constructive-entities/SKILL.md), [`constructive-access-control`](../constructive-access-control/SKILL.md), [`constructive-principals`](../constructive-principals/SKILL.md) |
| Browse buckets and objects or perform upload/download actions | Storage (`storage`) | [`constructive-storage`](../constructive-storage/SKILL.md), [`constructive-security`](../constructive-security/SKILL.md) |
| Manage plans, subscriptions, usage, entitlements, and credits | Billing (`billing`) | [`constructive-billing`](../constructive-billing/SKILL.md) |
| Read and manage an application notification inbox | Notifications (`notifications`) | [`constructive-notifications`](../constructive-notifications/SKILL.md), [`constructive-realtime`](../constructive-realtime/SKILL.md) |

After selecting the product capability, activate `constructive-blocks` to choose and install its supported surface. Do not infer a registry root from the display name or maintain a copied list of registry dependencies here.

## Surface Router

| User intent | Route |
|---|---|
| “Give me the complete tenant console” | `constructive-blocks` → Console Kit umbrella |
| “Match the console to an official backend preset” | `constructive-blocks` → official preset surface |
| “Put these selected capabilities in Console Kit” | `constructive-blocks` → core plus selected Console modules |
| “Embed this capability in my own screen” | `constructive-blocks` → standalone feature pack |
| “Build a bespoke domain page” | [`constructive-frontend`](../constructive-frontend/SKILL.md); follow its [current `_meta` guidance](../constructive-frontend/references/meta-forms.md), and use `constructive-codegen` only if a stable generated client is an explicit choice |
| “Assemble and acceptance-check this tenant frontend” | [`constructive-builder`](../constructive-builder/SKILL.md) with an existing app workspace and already-provisioned tenant |

## Rules

1. **Keep installation and backend behavior separate.** A feature pack installs a frontend surface; it does not provision modules, expose an endpoint, or grant authorization.
2. **Keep installation and acceptance separate.** Sign-up, sign-in, CRUD, membership, and RLS checks are acceptance scenarios inside a capability, not feature-pack identifiers.
3. **Treat runtime evidence as authoritative for Console availability.** An installed Console module may be `ready`, `partial`, or `unavailable` for the active tenant and identity. A non-Data standalone pack instead renders the resources, policy, actions, and state supplied by its host; standalone Data validates its configured endpoint internally.
4. **Do not derive routes.** Pass explicit semantic endpoints through the tenant descriptor; never construct sibling hosts or use private routing headers for application UI.
5. **Do not require generated clients for Blocks.** Console Kit performs capability discovery, standalone Data uses `_meta` plus introspection through Sheets, and the other standalone packs use host-injected resources and actions. Code generation remains opt-in for stable custom-domain UI.

## Domain Skills Beyond Feature Packs

| Capability | Skill |
|---|---|
| RLS, ownership, grants, and Constructive Authz policy behavior | [`constructive-security`](../constructive-security/SKILL.md) |
| Tables, fields, relations, constraints, indexes, enums, and views | [`constructive-data-modeling`](../constructive-data-modeling/SKILL.md) |
| Full-text, fuzzy, vector, spatial, and unified search | [`constructive-search`](../constructive-search/SKILL.md) |
| Agents, embeddings, LLM providers, and RAG | [`constructive-agents`](../constructive-agents/SKILL.md) |
| Events, achievements, referrals, and gamification | [`constructive-events`](../constructive-events/SKILL.md) |
| Subscriptions and change tracking | [`constructive-realtime`](../constructive-realtime/SKILL.md) |
| Background jobs and triggers | [`constructive-jobs`](../constructive-jobs/SKILL.md) |
| Internationalized data and multilingual search | [`constructive-i18n`](../constructive-i18n/SKILL.md) |
| Flow-based computation graphs | [`constructive-flow-graphs`](../constructive-flow-graphs/SKILL.md) |
| Services, public routing, deployment, and CNC | [`constructive-platform`](../constructive-platform/SKILL.md) |

See the repository-level [`features.md`](../../../features.md) for the compact capability index.
