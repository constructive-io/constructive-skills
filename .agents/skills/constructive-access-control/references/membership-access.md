# Membership & Access

Memberships are the link between a user (actor) and an entity (app, org, custom). Each membership carries role flags, a profile reference, direct grants, and state flags that determine what the member can access and do.

## Membership Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Membership record ID |
| `actorId` | UUID | The user this membership belongs to |
| `entityId` | UUID | The entity (org, channel, etc.) — null for app-scope |
| `isAdmin` | boolean | Admin role flag |
| `isOwner` | boolean | Owner role flag |
| `profileId` | UUID? | Assigned profile (nullable) |
| `permissions` | string | Effective permissions (resolved from all sources) |
| `granted` | string | Direct grants only |
| `isReadOnly` | boolean | Read-only flag — blocks all mutations when `true` (see [read-only-access.md](../../constructive-security/references/read-only-access.md)) |
| `isApproved` | boolean | Whether the membership is active (waitlist gate) |
| `isVerified` | boolean | Whether the member's identity is verified |
| `createdAt` | timestamp | When the membership was created |

## Membership Creation

Members join through several paths, each resulting in different initial access:

### 1. Sign-Up (App Membership)

When a user signs up, they get an app membership:

```typescript
await db.query.signUp({
  input: {
    targetDatabaseId: dbId,
    password: 'user-password'
  }
}).execute();
// Creates app membership with:
// - isAdmin: false, isOwner: false
// - permissions: module defaults + permission defaults
// - profileId: default profile (if one exists)
// - isApproved: per app_membership_defaults setting
```

### 2. Invite Claim (Any Scope)

When a user claims an invite:

```typescript
await db.query.submitOrgInviteCode({
  inviteCode: inviteUUID
}).execute();
// Creates org membership with:
// - isAdmin: false, isOwner: false
// - profileId: invite's profileId (if email invite with profile)
// - isApproved: true if sender has send_approved_invites, else per defaults
// - permissions: defaults + profile permissions (if profile assigned)
```

### 3. Direct Creation (Admin Action)

Admins can create memberships directly:

```typescript
await db.orgMembership.create({
  data: {
    actorId: userId,
    entityId: orgId,
    isApproved: true,
    profileId: editorProfileId
  },
  select: { id: true }
}).execute();
```

## Membership States

### Approval Gate

`isApproved` controls whether the membership is active:

| `isApproved` | Effect |
|--------------|--------|
| `true` | Full access per permissions/role |
| `false` | Waitlisted — RLS denies access to entity resources |

Configure the default for new members:

```typescript
// Set membership defaults (new members auto-approved)
await db.orgMembershipDefault.create({
  data: {
    isApproved: true,
    entityId: orgId
  },
  select: { id: true }
}).execute();

// Waitlist mode (new members must be approved)
await db.appMembershipDefault.create({
  data: {
    isApproved: false
  },
  select: { id: true }
}).execute();
```

### Approving a Waitlisted Member

```typescript
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { isApproved: true }
}).execute();
```

### Verification Gate

`isVerified` tracks identity verification status:

| `isVerified` | Effect |
|--------------|--------|
| `true` | Full access per permissions/role |
| `false` | May have restricted access (depends on app's RLS configuration) |

Email invites auto-verify the user's email on claim. Other flows may require explicit verification.

## Reading Memberships

```typescript
// List all members of an org with their access state
const members = await db.orgMembership.findMany({
  where: { entityId: { equalTo: orgId } },
  select: {
    id: true,
    actorId: true,
    isAdmin: true,
    isOwner: true,
    profileId: true,
    permissions: true,
    granted: true,
    isApproved: true,
    isVerified: true,
    createdAt: true
  }
}).execute();
```

### Filter by Role

```typescript
// Find all admins in an org
const admins = await db.orgMembership.findMany({
  where: {
    entityId: { equalTo: orgId },
    isAdmin: { equalTo: true }
  },
  select: { actorId: true }
}).execute();

// Find all members with a specific profile
const editors = await db.orgMembership.findMany({
  where: {
    entityId: { equalTo: orgId },
    profileId: { equalTo: editorProfileId }
  },
  select: { actorId: true, permissions: true }
}).execute();
```

## Removing Members

```typescript
// Remove a member from an org
await db.orgMembership.delete({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } }
}).execute();
```

Grant history is preserved after removal — the audit trail remains intact.

## Member Profiles (Display Info)

Separate from permission profiles, **member profiles** store display information:

```typescript
// Create a member profile (display info)
await db.orgMemberProfile.create({
  data: {
    membershipId: orgMembershipId,
    entityId: orgId,
    actorId: userId,
    displayName: 'Jane Smith',
    email: 'jane@example.com',
    title: 'Engineering Lead',
    bio: 'Full-stack developer',
    profilePicture: avatarUrl
  },
  select: { id: true }
}).execute();
```

Note: "Member profiles" (display info) are distinct from "profiles" (permission bundles). They serve different purposes — one is for UI/directory, the other is for access control.

## Membership Settings

Per-entity configuration for membership behavior:

```typescript
// Configure org membership settings
await db.orgMembershipSetting.update({
  where: { entityId: { equalTo: orgId } },
  data: {
    inviteProfileAssignmentMode: 'strict'  // strict | permission_only | subset_only
  }
}).execute();
```

| Setting | Options | Description |
|---------|---------|-------------|
| `inviteProfileAssignmentMode` | `strict`, `permission_only`, `subset_only` | Controls who can assign profiles via invites |

## CLI Usage

```bash
# List members of an org
constructive public:org-membership find-many \
  --where.entityId $ORG_ID \
  --select id,actorId,isAdmin,permissions

# Approve a waitlisted member
constructive public:org-membership update \
  --where.actorId $USER_ID \
  --where.entityId $ORG_ID \
  --data.isApproved true

# Remove a member
constructive public:org-membership delete \
  --where.actorId $USER_ID \
  --where.entityId $ORG_ID
```

## Key Behaviors

- **One membership per user per entity** — a user can only have one membership in a given org/entity
- **Multiple memberships across entities** — a user can be a member of many orgs simultaneously
- **Approval required for access** — `isApproved: false` effectively blocks all access via RLS
- **Profile assignment at any time** — profiles can be assigned at creation (via invite) or changed later
- **State is mutable** — roles, profiles, and approval status can be changed after creation
- **Deletion preserves audit** — removing a member doesn't destroy grant history
- **Owner protection** — owners cannot be removed by admins; ownership must be transferred first
