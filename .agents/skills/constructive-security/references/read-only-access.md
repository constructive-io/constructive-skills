# Read-Only Access

Two complementary mechanisms for restricting writes. They serve different personas and can be stacked for defense in depth.

## 1. Read-Only Memberships (`isReadOnly`)

Mark an entity-scoped membership as read-only to block all mutations (INSERT, UPDATE, DELETE) for that member within that entity's tables, while allowing full SELECT access.

### How It Works

- Every entity-scoped membership (orgs, groups, data rooms, channels, etc.) has an `isReadOnly` boolean field.
- When `isReadOnly` is `true`, the `AuthzNotReadOnly` restrictive policy blocks all mutation privileges. The member's normal permissions still grant SELECT but all writes are denied.
- Owners and admins cannot be set to read-only — trigger guards prevent `isReadOnly = true` when `isOwner = true` or `isAdmin = true`.
- One restrictive policy per table — automatically injected during table provisioning.

### ORM Usage

The invite system does not currently support setting `isReadOnly` at invite time. New members join with `isReadOnly = false` by default. To make a member read-only, update their membership after they join:

```typescript
// Update an existing member to read-only (admin/owner only)
await db.orgMembership.update({
  where: { id: { equalTo: membershipId } },
  data: { isReadOnly: true },
  select: { id: true, isReadOnly: true }
}).execute();

// Remove read-only restriction
await db.orgMembership.update({
  where: { id: { equalTo: membershipId } },
  data: { isReadOnly: false },
  select: { id: true, isReadOnly: true }
}).execute();
```

Direct membership creation (admin/owner only, bypasses invite flow):

```typescript
await db.orgMembership.create({
  data: {
    actorId: userId,
    entityId: orgId,
    isReadOnly: true
  },
  select: { id: true, isReadOnly: true }
}).execute();
```

### CLI Usage

```bash
# Update an existing member to read-only
constructive public:org-membership update \
  --where.id $MEMBERSHIP_ID \
  --data.isReadOnly true

# Remove read-only restriction
constructive public:org-membership update \
  --where.id $MEMBERSHIP_ID \
  --data.isReadOnly false

# Direct creation with read-only
constructive public:org-membership create \
  --data.actorId $USER_ID \
  --data.entityId $ORG_ID \
  --data.isReadOnly true
```

### Behavior

| Action | Read-Only Member | Normal Member |
|--------|-----------------|---------------|
| SELECT (read data) | Allowed | Allowed |
| INSERT (create records) | Blocked by RLS (`AuthzNotReadOnly`) | Allowed (if permitted) |
| UPDATE (modify records) | Blocked by RLS (`AuthzNotReadOnly`) | Allowed (if permitted) |
| DELETE (remove records) | Blocked by RLS (`AuthzNotReadOnly`) | Allowed (if permitted) |

### Scope

- Applies to **all entity-scoped tables** for that entity
- If a table has mixed-scope policies, read-only still blocks all mutations for the entity scope

## 2. Read-Only API Keys (`accessLevel`)

Create an API key with `accessLevel: 'read_only'` to make the entire transaction read-only at the PostgreSQL level. The key physically cannot perform any writes, regardless of the user's permissions.

### How It Works

- API keys have an `accessLevel` field (default: `'full_access'`).
- When a request authenticates with a credential where `accessLevel = 'read_only'`, the server enforces a read-only transaction. PostgreSQL rejects any write operation with: `ERROR: cannot execute INSERT in a read-only transaction`.
- Enforced at the PostgreSQL engine level — no policy, trigger, or function can bypass it.

### ORM Usage

```typescript
// Create a read-only API key
await db.query.createApiKey({
  input: {
    keyName: 'my-readonly-key',
    accessLevel: 'read_only'
  }
}).execute();

// Create a normal (full access) API key
await db.query.createApiKey({
  input: {
    keyName: 'my-key',
    accessLevel: 'full_access'
  }
}).execute();
```

### CLI Usage

```bash
# Create a read-only API key
constructive auth:create-api-key \
  --input.keyName "my-readonly-key" \
  --input.accessLevel "read_only"

# Create a normal (full access) API key
constructive auth:create-api-key \
  --input.keyName "my-key" \
  --input.accessLevel "full_access"
```

### Access Level Values

| Value | Description |
|-------|-------------|
| `full_access` | Default. Normal read + write access (subject to RLS policies). |
| `read_only` | Transaction-level read-only. All writes rejected by PostgreSQL. |

## How They Complement Each Other

| Scenario | Read-Only Membership | Read-Only API Key |
|----------|---------------------|-------------------|
| Org admin invites a viewer | Member can read but not mutate in that org | N/A |
| Developer creates a safe integration key | N/A | Key cannot write anything, period |
| Contractor with read-only org access | Can't mutate in that org, can still write in other orgs | Personal keys still work normally elsewhere |
| Read-only dashboard service | N/A | App-wide read-only key reads everything, writes nothing |
| Defense in depth | Read-only member + read-only API key | Both layers enforced independently |
