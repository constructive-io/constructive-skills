---
name: constructive-access-control
description: "Access control — roles, capabilities (formerly capabilities), profiles, grants, membership access, and entity-scoped authorization. Use when asked to 'assign capabilities', 'assign capabilities', 'create roles', 'set up profiles', 'grant access', 'capability defaults', 'capability defaults', 'admin vs owner', 'membership capabilities', 'effective capabilities', 'revoke access', 'role hierarchy', 'custom roles', 'profile bundles', 'default profile', 'entity-scoped capabilities', 'org capabilities', 'app capabilities', 'capability resolution', 'trust levels', 'do owners get everything', or when working with the access control model in blueprints or the ORM."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Access Control

The access control model — how users get capabilities, how roles and profiles organize them, and how access composes across scopes. This skill covers the semantic layer: what access means in a Constructive app, how to configure it via blueprints and the ORM, and how the different layers (roles, profiles, grants, defaults) compose into effective access.

> **Naming:** the platform concept formerly called a *permission* is now a **capability**. Every table, column, ORM model, blueprint argument, and module name uses the capability spelling (`appCapability`, `capabilities_module`, `capabilities: […]`). *Permission* remains only as a value of a capability's `kind` column, distinguishing a granted access right from an earned trust `level`.

For application UI, the App access and Organizations feature packs expose the corresponding membership, invitation, profile, capability, and default-management surfaces. Use [`constructive-blocks`](../constructive-blocks/SKILL.md) for installation, standalone host contracts, and Console module discovery and adapters; this skill remains the authority for access semantics.

## When to Apply

Use this skill when:
- Defining what capabilities users should have in an app
- Creating custom roles via profiles (Editor, Viewer, Manager, etc.)
- Configuring which capabilities new members receive automatically
- Understanding how admin/owner/member roles differ, and why they hold every capability
- Granting or revoking capabilities for individual members
- Setting up entity-scoped access (app vs org vs custom entity)
- Assigning profiles to memberships via invites or direct assignment
- Understanding effective capability resolution (grants + profiles)
- Deciding where to gate something an org owner must not bypass

## Relationship to Other Skills

| Skill | Focus | This skill covers |
|-------|-------|-------------------|
| [`constructive-security`](../constructive-security/SKILL.md) | **Enforcement** — Authz* policies, RLS, how access is enforced at the database level | **Model** — what access exists, who gets it, how it composes |
| [`constructive-entities`](../constructive-entities/SKILL.md) | **Structure** — entity types, multi-tenancy, provisioning | **Access within structure** — how capabilities scope to entities |
| [`constructive-events`](../constructive-events/SKILL.md) | **Earning** — events, achievements, trust ladders that produce `kind = 'level'` capabilities | **Holding** — what a level means once held |
| [`constructive-auth`](../constructive-auth/SKILL.md) | **Identity** — login, sessions, MFA, devices | **Authorization** — what authenticated users can do |

## Access Control Layers

A Constructive app has four composable access layers:

```
┌─────────────────────────────────────────────┐
│  1. Role (admin / owner / member)           │  ← built-in, highest precedence
├─────────────────────────────────────────────┤
│  2. Profile (named capability bundle)       │  ← reusable role definitions
├─────────────────────────────────────────────┤
│  3. Direct Grants (per-member overrides)    │  ← individual adjustments
├─────────────────────────────────────────────┤
│  4. Capability Defaults (module-level base) │  ← automatic on join
└─────────────────────────────────────────────┘
```

**Effective capabilities** = Role bypass OR (Profile capabilities ∪ Direct grants ∪ Defaults ∪ Earned levels)

Layer 1 is not a tiebreaker but a replacement: an admin or owner holds **every** capability in the scope, earned trust levels included. See [admin-owner-member.md](./references/admin-owner-member.md#owner-and-admin-hold-every-capability) before designing anything that must constrain an owner.

## Quick Reference

### Enabling Access Control in Blueprints

```json
{
  "entity_types": [
    {
      "name": "Organization",
      "prefix": "org",
      "hasProfiles": true
    }
  ]
}
```

Every entity type automatically gets a `capabilities_module` and `memberships_module`. Setting `hasProfiles: true` additionally provisions the profiles system for that scope.

### ORM Tables by Scope

| Scope | Capabilities | Grants | Profiles | Memberships | Defaults |
|-------|--------------|--------|----------|-------------|----------|
| App | `appCapability` | `appGrant` | `appProfile` | `appMembership` | `appCapabilityDefault` |
| Org | `orgCapability` | `orgGrant` | `orgProfile` | `orgMembership` | `orgCapabilityDefault` |
| Custom | `{prefix}Capability` | `{prefix}Grant` | `{prefix}Profile` | `{prefix}Membership` | `{prefix}CapabilityDefault` |

### Membership Fields

| Field | Meaning |
|-------|---------|
| `granted` | What the member was given — defaults ∪ profile ∪ direct grants |
| `capabilities` | What the member effectively holds — equals `granted`, except for admins and owners, who hold everything |

## References

| File | Content |
|------|---------|
| [admin-owner-member.md](./references/admin-owner-member.md) | Admin, owner, and member role semantics — **owners/admins hold every capability including trust levels**, grant tables, promotion/demotion, audit trail |
| [roles-hierarchy.md](./references/roles-hierarchy.md) | Org hierarchy — chart edges, closure table traversal, AuthzOrgHierarchy policy, direction/depth |
| [named-capabilities.md](./references/named-capabilities.md) | Named capability slots, the `capability`/`level` kinds, module registration, discovery |
| [profiles.md](./references/profiles.md) | Profile definitions, capability bundles, default profiles, system profiles |
| [capability-defaults.md](./references/capability-defaults.md) | Automatic capabilities for new members, module defaults, overriding |
| [entity-scoped-access.md](./references/entity-scoped-access.md) | App vs org vs custom entity scope, capability isolation, cross-scope patterns |
| [grants-lifecycle.md](./references/grants-lifecycle.md) | Granting/revoking capabilities, effective capability computation, audit trail |
| [membership-access.md](./references/membership-access.md) | Membership creation, invite-time assignment, state transitions, approval |

## Cross-References

- **Enforcement details:** [`constructive-security`](../constructive-security/SKILL.md) — how capabilities translate into RLS policies
- **Entity provisioning:** [`constructive-entities`](../constructive-entities/SKILL.md) — creating entity types that carry capabilities
- **Earning levels:** [`constructive-events`](../constructive-events/SKILL.md) — trust ladders that produce `kind = 'level'` capabilities
- **Invite system:** [`constructive-entities` → invites.md](../constructive-entities/references/invites.md) — profile assignment on invite
- **Read-only access:** [`constructive-security` → read-only-access.md](../constructive-security/references/read-only-access.md) — `isReadOnly` membership field and read-only API keys
- **Billing/limits:** [`constructive-billing`](../constructive-billing/SKILL.md) — quota enforcement (separate from capability enforcement, and the right place for a limit an owner must not bypass)
- **App access and Organizations UI:** [`constructive-blocks`](../constructive-blocks/SKILL.md) — standalone host contracts plus Console module discovery and adapters
