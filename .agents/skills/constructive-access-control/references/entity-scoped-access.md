# Entity-Scoped Access

Permissions are **scoped to entities** — each membership scope (app, org, custom) has its own independent permission space. A user's permissions in one organization don't carry to another, and app-level permissions don't imply org-level permissions.

## Scope Hierarchy

```
App (global scope)
  └── Org (per-organization scope)
        ├── Channel (per-channel scope)
        ├── Team (per-team scope)
        └── Department (per-department scope)
```

Each level is an independent permission space with its own:
- Named permissions registry
- Grants log
- Permission defaults
- Profiles (if enabled)
- Memberships

## How Scoping Works

| Scope | ORM Tables | Membership | Permissions | Grants |
|-------|-----------|------------|-------------|--------|
| **App** | `appMembership`, `appPermission`, `appGrant`, `appProfile` | One per user | App-wide features | App-wide |
| **Org** | `orgMembership`, `orgPermission`, `orgGrant`, `orgProfile` | One per user per org | Org-specific features | Per-org |
| **Custom** | `{prefix}Membership`, `{prefix}Permission`, `{prefix}Grant`, `{prefix}Profile` | One per user per entity | Entity-specific features | Per-entity |

### Example: User in Multiple Orgs

```typescript
// User has different permissions in different orgs
const orgAMembership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgAId } },
  select: { permissions: true, isAdmin: true, profileId: true }
}).execute();
// → { permissions: 'invoke_agents,write_files', isAdmin: false, profileId: editorProfileId }

const orgBMembership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgBId } },
  select: { permissions: true, isAdmin: true, profileId: true }
}).execute();
// → { permissions: 'manage_agents,manage_storage', isAdmin: true, profileId: null }
```

## Permission Isolation

Permissions do NOT inherit across scopes:

| Scenario | Result |
|----------|--------|
| User is app admin | Does NOT automatically have org admin |
| User has `manage_agents` in Org A | Does NOT have it in Org B |
| User is org admin | Does NOT automatically have channel admin |
| User has a profile in one org | That profile doesn't exist in another org |

Each scope is a fully independent permission system. Cross-scope access requires separate memberships.

## Blueprint: Multi-Scope Entity Types

```json
{
  "entity_types": [
    {
      "name": "App",
      "prefix": "app",
      "hasProfiles": true
    },
    {
      "name": "Organization",
      "prefix": "org",
      "hasProfiles": true
    },
    {
      "name": "Channel",
      "prefix": "channel",
      "parentEntity": "org",
      "hasProfiles": false
    }
  ]
}
```

### What Gets Created Per Scope

When an entity type is provisioned with access control:

1. **Permissions module** — automatically installed; registers scope's permission table
2. **Memberships module** — tracks who belongs to each entity instance
3. **Profiles module** (optional) — enabled via `hasProfiles: true`
4. **Invites module** (optional) — enabled via `hasInvites: true`

## Cross-Scope Patterns

### Pattern: App-Level Gates for Global Features

Use app-scope permissions to gate features that span all organizations:

```typescript
// App-level permission for platform admin features
const appMembership = await db.appMembership.findOne({
  where: { actorId: { equalTo: userId } },
  select: { isAdmin: true, permissions: true }
}).execute();
```

### Pattern: Org-Level Gates for Org Features

Use org-scope permissions to gate features within an organization:

```typescript
// Org-level permission check before allowing an action
const orgMembership = await db.orgMembership.findOne({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  select: { permissions: true }
}).execute();
```

### Pattern: Nested Entity Access

For child entities (channels under orgs), the parent entity's membership is typically required for access:

```json
{
  "policies": [
    {
      "$type": "AuthzEntityMembership",
      "data": {
        "entity_field": "entity_id",
        "membership_type": 3,
        "permission": "invoke_agents"
      }
    }
  ]
}
```

## The "Users Are Organizations" Pattern

Every user has a personal org identity — their own org with a single-member membership (themselves as owner). This means:

- Personal data can use `AuthzEntityMembership` with the user's personal org
- The same RLS policies work for both personal and shared data
- Transitioning personal data to shared (org-owned) data doesn't require policy changes

```
User "Alice"
  ├── App membership (type=1)        → app-level permissions
  ├── Personal org membership (type=2, entity=alice_org) → personal data
  ├── Company org membership (type=2, entity=company_org) → company data
  └── Project channel membership (type=3, entity=project_channel) → channel data
```

## Managing Entity-Specific Defaults

Each entity can customize its own permission defaults independently:

```typescript
// Org A: new members get invoke_agents + write_files
await db.orgPermissionDefault.create({
  data: {
    entityId: orgAId,
    permissions: orgADefaultValue
  },
  select: { id: true }
}).execute();

// Org B: new members get only invoke_agents (more restrictive)
await db.orgPermissionDefault.create({
  data: {
    entityId: orgBId,
    permissions: orgBDefaultValue
  },
  select: { id: true }
}).execute();
```

## Key Behaviors

- **Complete isolation** — permissions in one entity are invisible to another
- **Independent configuration** — each entity configures its own defaults, profiles, and grants
- **Parent doesn't imply child** — being an org admin doesn't make you a channel admin
- **Same permission names, different scopes** — `invoke_agents` in Org A and Org B are separate grants
- **Users are orgs** — personal ownership uses the same entity membership model as shared access
