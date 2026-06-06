---
name: constructive-entities
description: "Multi-tenancy, memberships, invites, entity types, entity-scoped storage, agent modules, and namespace modules. Use when asked to 'create entity types', 'add channels/teams/data rooms', 'provision entity storage', 'entity-scoped buckets', 'agent_module', 'namespace_module', 'invite users', 'profile assignment', 'memberships', 'multi-tenancy', 'org-scope', 'app-scope', or when working with entity_types in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Entities

Hierarchical entity type system for multi-tenancy. Every scope of membership — app, org, channel, department, team, data room — is a membership type with its own entity table, permissions, memberships, and security policies.

## When to Apply

Use this skill when:
- Creating custom entity types (channels, teams, departments, data rooms)
- Provisioning entity-scoped storage (buckets + file uploads per entity)
- Configuring agent modules (threads, messages, tasks, prompts, knowledge)
- Setting up namespace modules (namespace_events partitioned metrics log)
- Managing invites, profile assignment, and membership permissions
- Understanding the entity hierarchy and parent-child relationships

## Core Concepts

### Entity Type Hierarchy

| Type ID | Name | Prefix | Created By |
|---------|------|--------|------------|
| 1 | App Member | `app` | Built-in |
| 2 | Organization Member | `org` | Built-in |
| 3+ | Dynamic | varies | You provision these |

Every entity type gets: entity table, permissions module, memberships module, RLS policies. Optional: limits, profiles, levels, invites, storage, agent_module, namespace_module.

### Parent-Child Relationships

```
app (1)
  └── org (2)
        ├── channel (3)    ← parent_entity = 'org'
        ├── department (4) ← parent_entity = 'org'
        │     └── team (5) ← parent_entity = 'department'
        └── data_room (6)  ← parent_entity = 'org', has_storage = true
```

Nested types must be provisioned after their parent type.

### Permission Model

Each level has standard permissions. `create_entity` means "create the next level down":

| Level | `create_entity` | Other Permissions |
|-------|-----------------|-------------------|
| App (1) | Creates organizations | `admin_members`, `admin_invites`, `admin_limits` |
| Org (2) | Creates child entities | `admin_members`, `create_invites`, `admin_permissions` |
| Dynamic (3+) | Creates sub-entities | `admin_members`, `create_invites`, `admin_entity` |

## Three Ways to Provision

### 1. Blueprint Definition (Recommended)

Add `entity_types` to the blueprint definition. Processed in Phase 0 — before tables.

See [blueprint-entity-types.md](./references/blueprint-entity-types.md) for the full spec.

### 2. ORM / GraphQL Mutation

Use `entityTypeProvision` for direct provisioning. See [orm-provisioning.md](./references/orm-provisioning.md).

### 3. CLI

```bash
constructive public:entity-type-provision create \
  --databaseId <UUID> \
  --name "Channel Member" --prefix channel \
  --parentEntity org --hasStorage true
```

## Entity-Scoped Storage

Set `has_storage: true` on entity type provisioning to create per-entity buckets and files tables with RLS scoped to entity membership.

## Agent Module

Set `has_agents: true` to provision agent infrastructure per entity:
- `{prefix}_agent_threads` — conversation threads
- `{prefix}_agent_messages` — messages within threads (attributed via `actor_id`, optional `agent_id` for multi-agent)
- `{prefix}_agent_tasks` — actionable tasks (attributed via `actor_id`)
- `{prefix}_agent_prompts` — prompt templates
- `{prefix}_agent_knowledge` — knowledge base entries

### Access Modes

| `shared` Flag | Security | Behavior |
|---------------|----------|----------|
| `false` (default) | `AuthzMemberOwner` | Private — only the thread creator sees their threads within the entity |
| `true` | `AuthzEntityMembership` | Multiplayer — all entity members see and contribute to all threads |

Auto-registers permissions: `invoke_agents` (default for all members), `manage_agents` (admin-only).

## Namespace Module

Set `has_namespaces: true` to provision `{prefix}_namespace_events` — a partitioned metrics/events log for K8s-style namespace tracking.

## Invite System

The invite system supports email invites, blank invites, and multiple invites with optional profile assignment and permission setting.

See [invites.md](./references/invites.md) for invite types, claim flow, and error codes.

## References

| File | Content |
|------|---------|
| [blueprint-entity-types.md](./references/blueprint-entity-types.md) | Blueprint entity_types spec and examples |
| [invites.md](./references/invites.md) | Invite types, claim flow, profile assignment |
| [orm-provisioning.md](./references/orm-provisioning.md) | ORM/GraphQL provisioning examples |

## Cross-References

- **Security policies:** [`constructive-security`](../constructive-security/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **File uploads:** [`constructive-storage`](../constructive-storage/SKILL.md)
- **Limits per entity:** [`constructive-billing`](../constructive-billing/SKILL.md)
