---
name: constructive-access-control
description: "Access control — roles, permissions, profiles, grants, membership access, and entity-scoped authorization. Use when asked to 'assign permissions', 'create roles', 'set up profiles', 'grant access', 'permission defaults', 'admin vs owner', 'membership permissions', 'effective permissions', 'revoke access', 'role hierarchy', 'custom roles', 'profile bundles', 'default profile', 'entity-scoped permissions', 'org permissions', 'app permissions', 'permission resolution', or when working with the access control model in blueprints or the ORM."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Access Control

The access control model — how users get permissions, how roles and profiles organize them, and how access composes across scopes. This skill covers the semantic layer: what access means in a Constructive app, how to configure it via blueprints and the ORM, and how the different layers (roles, profiles, grants, defaults) compose into effective permissions.

## When to Apply

Use this skill when:
- Defining what permissions users should have in an app
- Creating custom roles via profiles (Editor, Viewer, Manager, etc.)
- Configuring which permissions new members receive automatically
- Understanding how admin/owner/member roles differ
- Granting or revoking permissions for individual members
- Setting up entity-scoped access (app vs org vs custom entity)
- Assigning profiles to memberships via invites or direct assignment
- Understanding effective permission resolution (grants + profiles)

## Relationship to Other Skills

| Skill | Focus | This skill covers |
|-------|-------|-------------------|
| [`constructive-security`](../constructive-security/SKILL.md) | **Enforcement** — Authz* policies, RLS, how access is enforced at the database level | **Model** — what access exists, who gets it, how it composes |
| [`constructive-entities`](../constructive-entities/SKILL.md) | **Structure** — entity types, multi-tenancy, provisioning | **Access within structure** — how permissions scope to entities |
| [`constructive-auth`](../constructive-auth/SKILL.md) | **Identity** — login, sessions, MFA, devices | **Authorization** — what authenticated users can do |

## Access Control Layers

A Constructive app has four composable access layers:

```
┌─────────────────────────────────────────────┐
│  1. Role (admin / owner / member)           │  ← built-in, highest precedence
├─────────────────────────────────────────────┤
│  2. Profile (named permission bundle)       │  ← reusable role definitions
├─────────────────────────────────────────────┤
│  3. Direct Grants (per-member overrides)    │  ← individual adjustments
├─────────────────────────────────────────────┤
│  4. Permission Defaults (module-level base) │  ← automatic on join
└─────────────────────────────────────────────┘
```

**Effective permissions** = Role bypass OR (Profile permissions ∪ Direct grants ∪ Defaults)

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

Every entity type automatically gets a `permissions_module` and `memberships_module`. Setting `hasProfiles: true` additionally provisions the profiles system for that scope.

### ORM Tables by Scope

| Scope | Permissions | Grants | Profiles | Memberships | Defaults |
|-------|-------------|--------|----------|-------------|----------|
| App | `appPermission` | `appGrant` | `appProfile` | `appMembership` | `appPermissionDefault` |
| Org | `orgPermission` | `orgGrant` | `orgProfile` | `orgMembership` | `orgPermissionDefault` |
| Custom | `{prefix}Permission` | `{prefix}Grant` | `{prefix}Profile` | `{prefix}Membership` | `{prefix}PermissionDefault` |

## References

| File | Content |
|------|---------|
| [roles-hierarchy.md](./references/roles-hierarchy.md) | Admin, owner, and member role semantics — capabilities, bypass rules, escalation |
| [named-permissions.md](./references/named-permissions.md) | Named permission slots, module registration, discovering available permissions |
| [profiles.md](./references/profiles.md) | Profile definitions, permission bundles, default profiles, system profiles |
| [permission-defaults.md](./references/permission-defaults.md) | Automatic permissions for new members, module defaults, overriding |
| [entity-scoped-access.md](./references/entity-scoped-access.md) | App vs org vs custom entity scope, permission isolation, cross-scope patterns |
| [grants-lifecycle.md](./references/grants-lifecycle.md) | Granting/revoking permissions, effective permission computation, audit trail |
| [membership-access.md](./references/membership-access.md) | Membership creation, invite-time assignment, state transitions, approval |

## Cross-References

- **Enforcement details:** [`constructive-security`](../constructive-security/SKILL.md) — how permissions translate into RLS policies
- **Entity provisioning:** [`constructive-entities`](../constructive-entities/SKILL.md) — creating entity types that carry permissions
- **Invite system:** [`constructive-entities` → invites.md](../constructive-entities/references/invites.md) — profile assignment on invite
- **Billing/limits:** [`constructive-billing`](../constructive-billing/SKILL.md) — quota enforcement (separate from permission enforcement)
