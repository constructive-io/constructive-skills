---
name: constructive-membership-types
description: "Membership types and dynamic entity provisioning — how to create custom entity types (channels, departments, teams) via the ORM, CLI, or blueprint definitions. Covers the entity hierarchy, permissions per entity type, and the provisioning lifecycle."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Membership Types & Dynamic Entity Provisioning

Constructive has a hierarchical entity type system. Every scope of membership — app, org, channel, department, team — is a **membership type** with its own entity table, permissions, memberships, and security policies.

Types 1 (app) and 2 (org) are built-in. Types 3+ are **dynamic** — you define them at runtime via the ORM, CLI, or blueprint definitions.

Related skills:
- **Blueprints:** `constructive` → [blueprints.md](../constructive/references/blueprints.md) — how `constructBlueprint()` works
- **Blueprint definition format:** `constructive` → [blueprint-definition-format.md](../constructive/references/blueprint-definition-format.md) — table/relation/policy JSONB spec
- **Safegres (security):** `constructive-safegres` — Authz* policy types for RLS
- **SQL-level provisioning:** `entity-types-and-provisioning` skill in `constructive-db`

---

## Core Concepts

### Entity Type Hierarchy

| Type ID | Name | Prefix | Entity Table | Created By |
|---------|------|--------|-------------|------------|
| 1 | App Member | `app` | `users` | Built-in |
| 2 | Organization Member | `org` | `users` (scoped) | Built-in |
| 3+ | Dynamic | varies | auto-created | You provision these |

Every entity type gets:
- An **entity table** (e.g. `channels`, `departments`)
- A **permissions module** with bitmask-based permissions
- A **memberships module** for tracking who belongs to what
- **RLS security policies** on all tables
- Optional modules: limits, profiles, levels, invites

### Permission Model

Each level has a standard set of permissions. The `create_entity` permission means **"create the next level down"**:

| Level | `create_entity` description | What it creates |
|-------|---------------------------|-----------------|
| App (type=1) | "Create organization entities." | Organizations |
| Org (type=2) | "Create child entities." | Channels, departments, etc. |
| Dynamic (type≥3) | "Create sub-entities." | Nested entity types |

Other standard permissions: `admin_members`, `create_invites`, `admin_invites`, `admin_limits`, `admin_permissions`, `admin_entity`.

### Parent-Child Relationships

Every dynamic entity type has a **parent type**. The parent defaults to `org` (type=2), but can be any previously-provisioned type:

```
app (1)
  └── org (2)
        ├── channel (3)    ← parent_entity = 'org'
        ├── department (4) ← parent_entity = 'org'
        │     └── team (5) ← parent_entity = 'department'
        └── ...
```

Nested types must be provisioned **after** their parent type.

---

## Three Ways to Provision Entity Types

### 1. Blueprint Definition (Recommended)

Add `membership_types` to the blueprint `definition` JSONB. These are processed in **Phase 0** — before tables and relations — so blueprint tables can reference the entity tables they create.

See [blueprint-membership-types.md](./references/blueprint-membership-types.md) for the full spec and examples.

### 2. ORM / GraphQL Mutation

Use the `entityTypeProvision` table for direct provisioning outside of blueprints.

See [orm-provisioning.md](./references/orm-provisioning.md) for ORM examples.

### 3. CLI

```bash
# Direct entity type provision (inserts into entity_type_provision trigger table)
constructive public:entity-type-provision create \
  --databaseId <UUID> \
  --name "Channel Member" \
  --prefix "channel" \
  --description "Membership to a channel." \
  --parentEntity "org" \
  --isVisible true \
  --hasLimits false \
  --hasProfiles false \
  --hasLevels false \
  --skipEntityPolicies false
```

---

## What Gets Created

When you provision a new entity type (e.g. prefix=`channel`), the system creates:

### Tables
- `channels` — Entity table (with `id`, `name`, `owner_id`, `created_at`, `updated_at`)
- `channel_permissions` — Permission bitmasks per member
- `channel_permission_defaults` — Default permission values
- `channel_limits` — Rate limits per member (if `has_limits`)
- `channel_limit_defaults` — Default limit values (if `has_limits`)
- `channel_members` — Member list (user_id + entity_id)
- `channel_memberships` — Membership state (active, suspended, etc.)
- `channel_membership_defaults` — Default membership values
- `channel_grants` / `channel_admin_grants` / `channel_owner_grants` — Computed grants
- `channel_acl` — Access control list

### Modules Registered
- `permissions_module:channel`
- `memberships_module:channel`
- `limits_module:channel` (if `has_limits`)
- `invites_module:channel` (auto-provisioned when `emails_module` exists)

### Optional Modules
- `profiles_module:channel` (if `has_profiles`) — Named permission roles
- `levels_module:channel` (if `has_levels`) — Gamification/achievements

---

## Querying Membership Types

### List all types

```typescript
const types = await db.membershipType.findMany({
  select: {
    id: true,
    name: true,
    prefix: true,
    description: true,
    parentMembershipType: true,
    hasLimits: true,
    hasProfiles: true,
    hasLevels: true,
  }
}).execute();
// Returns: [{ id: 1, name: 'App Member', prefix: 'app', ... }, ...]
```

### Find a specific type by prefix

```typescript
const channelType = await db.membershipType.findMany({
  where: { prefix: { equalTo: 'channel' } },
  select: { id: true, name: true }
}).execute();
```

### CLI

```bash
constructive public:membership-type list --select id,name,prefix,parentMembershipType
constructive public:membership-type find --where.prefix channel --select id,name
```

---

## Querying Membership Types Module

The `membershipTypesModule` tracks which databases have the membership types infrastructure installed:

```typescript
const modules = await db.membershipTypesModule.findMany({
  where: { databaseId: { equalTo: dbId } },
  select: { id: true, tableName: true }
}).execute();
```

---

## Cross-References

- **Blueprint definition format:** [blueprint-definition-format.md](../constructive/references/blueprint-definition-format.md) — `membership_types` is a top-level key alongside `tables`, `relations`, etc.
- **ORM provisioning examples:** [orm-provisioning.md](./references/orm-provisioning.md)
- **Blueprint membership_types spec:** [blueprint-membership-types.md](./references/blueprint-membership-types.md)
- **SQL-level detail:** `entity-types-and-provisioning` skill in `constructive-db` repo
