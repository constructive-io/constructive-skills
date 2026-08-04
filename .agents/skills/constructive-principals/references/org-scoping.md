---
name: constructive-principals-org-scoping
description: Scoping principals to orgs and other entity types — principalEntity, principalScopeOverride, the create-time entityIds variant and its probe, empty-means-unrestricted semantics, and how scoping follows the owner's membership changes.
---

# Scoping a Principal

By default a principal inherits access to **every** org its owning human belongs to. Scoping narrows that to specific entity rows — orgs, or rows of any entity type you provisioned ([`constructive-entities`](../../constructive-entities/SKILL.md)). All of this is done through the SDK ORM — no SQL required.

## Which scoping surface does this deployment expose?

Two surfaces exist, and a deployment may expose one or the other depending on how far its schema has drifted from the generated SDK. Introspect `CreatePrincipalInput` on the per-database auth endpoint before you build on either:

```graphql
{ __type(name: "CreatePrincipalInput") { inputFields { name } } }
```

| Probe result | Surface | Semantics |
|---|---|---|
| `entityIds` present | **Create-time scoping** — pass `entityIds` (entity **row** UUIDs, not entity-type ids) and `isReadOnly` to `createPrincipal` | Scope is **fixed at creation**; to change it, create a new principal and mint a new key |
| `entityIds` absent | **Post-hoc scoping** — the `principalEntity` / `principalScopeOverride` tables below | Scope is adjustable at any time |
| Neither | The deployment cannot scope this principal | Fail the scoped request with that reason; mint an unscoped key only after the user explicitly accepts one |

> Treat the create-time variant as **version skew between the SDK and the deployed auth schema** (observed 2026-08), not as two permanent products. Re-probe rather than assuming; prefer `principalEntity` when both are present.

## `principalEntity` — which orgs a principal may access

The `principalEntity` junction table maps a principal to the orgs it is allowed into.

| Field | Type | Notes |
|-------|------|-------|
| `principalId` | UUID | The principal |
| `entityId` | UUID | The org (a user row of `type = 2`) it may access |
| `ownerId` | UUID | The owning human (set for you) |

### Empty means unrestricted

- **No `principalEntity` rows** → the principal inherits access to *all* orgs its owner is in.
- **One or more rows** → the principal is restricted to *only* those orgs.

```typescript
// Restrict an existing principal to two specific orgs
await db.principalEntity.create({ data: { principalId, entityId: '<orgA-uuid>' } }).execute();
await db.principalEntity.create({ data: { principalId, entityId: '<orgB-uuid>' } }).execute();

// Widen again by removing a scope row
await db.principalEntity.delete({ where: { id: '<row-uuid>' } }).execute();
```

`createOrgPrincipal` sets this up for you for the single org you pass — reach for `principalEntity` directly only when a principal should span a specific *set* of orgs.

## `principalScopeOverride` — per-membership-type tuning

Sometimes you want a principal to have a different permission shape for a *type* of membership (e.g. broader in one scope, read-only in another). `principalScopeOverride` expresses that.

| Field | Type | Notes |
|-------|------|-------|
| `principalId` | UUID | The principal |
| `membershipType` | Int | Which membership type the override applies to |
| `allowedMask` | BitString | Permission subset for that membership type |
| `isAdmin` | Boolean | Grant admin within that scope |
| `isReadOnly` | Boolean | Force read-only within that scope |

```typescript
await db.principalScopeOverride
  .create({ data: { principalId, membershipType: 2, isReadOnly: true } })
  .execute();
```

Most agents/keys never need an override — plain `allowedMask` + `principalEntity` scoping is enough. Use overrides only when behavior must differ *by membership type*.

## Scoping follows the owner automatically

Scoping intent is preserved across the owner's membership changes:

```
Owner removed from Org A
  → principal loses access to Org A automatically
  → the principalEntity row for Org A is kept (intent preserved)

Owner re-added to Org A
  → principal regains access to Org A automatically
  → no need to recreate scoping
```

You never manually reconcile a principal's access when the owner's memberships change — the platform derives it from the owner's current access intersected with the principal's scope + mask.

## Reading a principal's scope

```typescript
const scopes = await db.principalEntity
  .findMany({ select: { id: true, principalId: true, entityId: true } })
  .execute()
  .unwrap();
```

RLS ensures you only see rows for principals you own.
