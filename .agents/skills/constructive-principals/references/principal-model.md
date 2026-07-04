---
name: constructive-principals-model
description: Principal identity model — dual-claim identity vs authority, user type 3, permission subsetting via allowedMask, isReadOnly, bypassStepUp, and what meters to the human vs the principal.
---

# Principal Identity Model

A principal is a **delegated identity**: a human (or org admin) creates it, and it acts on their behalf with a *subset* of their permissions. This document explains the model from the application layer — you never write SQL to use it.

## Identity vs Authority (dual-claim)

Every authenticated session carries two identities. For a normal human, both are the same value:

| Identity | Resolves to | Used for |
|----------|-------------|----------|
| **User** (owner) | Always the human | Billing, metering, rate limits, storage ownership, `created_by`/`updated_by`, ownership policies |
| **Principal** | The principal (or the human, if not a principal) | Permission checks only |

The consequence you care about: **when an agent/API-key does something, the money, quota, and audit trail all attach to the owning human**, but *what it is allowed to do* is governed by the principal's own (narrower) permissions.

For non-principal sessions the two are identical, so there is zero behavioral change for normal users.

## The identity row

A principal is backed by a real user row with `type = 3`:

| User type | Meaning |
|-----------|---------|
| `1` | Regular human |
| `2` | Organization |
| `3` | Principal (API key / agent) |

You rarely touch this directly — `createOrgPrincipal` / `createApiKey` manage it for you. But it's why a principal shows up as a `db.user` row with `type = 3`.

## Permission subsetting

```
principal_permissions = owner_permissions & allowedMask
```

- `allowedMask = null` → the principal inherits **all** of the owner's permissions.
- A narrower `allowedMask` → the principal gets only the overlap. It can **never** exceed the owner.
- If the owner later loses a permission (or is removed from an org), the principal loses it automatically. If the owner regains it, the principal regains it (the scoping intent is preserved).

You almost never need to hand-build a mask. Prefer:
- `isReadOnly` for "can read but not write" (see below), and
- `principalEntity` rows for "only these orgs" (see [org-scoping.md](./org-scoping.md)).

## Principal fields (`db.principal`)

| Field | Type | Meaning |
|-------|------|---------|
| `id` | UUID | Principal record id |
| `ownerId` | UUID | The owning human |
| `userId` | UUID | The principal's own identity row (`type = 3`) |
| `name` | String | Display name, e.g. `'billing-bot'` |
| `allowedMask` | BitString | Permission subset (null = all of owner's) |
| `isReadOnly` | Boolean | Entity-scoped read-only flag |
| `bypassStepUp` | Boolean | Skip MFA step-up (default `true` — principals can't perform MFA) |

`createdAt` / `updatedAt` are read-only.

### `isReadOnly`

Marks the principal as read-only at the membership/entity-scope level. Complementary to a **read-only API key** (`accessLevel: 'read_only'`), which enforces read-only at the PostgreSQL transaction level for that specific credential. Use the API-key access level when you want a credential that *physically* cannot write; see [`constructive-security` → read-only-access.md](../../constructive-security/references/read-only-access.md).

### `bypassStepUp`

Principals cannot complete an interactive MFA step-up (there's no human at the keyboard). `bypassStepUp` defaults to `true` so an agent isn't wedged by a `GuardStepUp` policy. Set it to `false` only if you have an out-of-band way to satisfy step-up.

## Human-only management

Creating, deleting, and issuing keys for principals is guarded by `AuthzHumanOnly`: a principal **cannot** manage other principals. If a principal-authenticated session calls `createOrgPrincipal`/`createApiKey`, it fails (`PRINCIPAL_CANNOT_CREATE_PRINCIPAL`). This prevents privilege-escalation chains. See [`constructive-security`](../../constructive-security/SKILL.md).

## What meters where

| System | Attributes to |
|--------|---------------|
| Peoplestamps (`created_by`/`updated_by`) | Human — audit survives principal deletion |
| Billing / metering | Human |
| Rate limits | Human |
| Storage ownership | Human |
| Ownership policies (`AuthzDirectOwner`) | Human |
| Permission checks (RLS) | Principal's own permissions |
