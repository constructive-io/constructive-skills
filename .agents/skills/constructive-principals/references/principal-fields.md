---
name: constructive-principals-fields
description: Field reference for the principal and principalEntity models and the createPrincipal / deletePrincipal mutations — fields, inputs, guards, side effects, and error codes.
---

# Principal Field Reference

## `db.principal`

| Field | Description |
|-------|-------------|
| `id` | Primary key of the principal row |
| `ownerId` | The human user who owns and manages the principal |
| `userId` | The principal's own identity user row (`type = 3`) |
| `name` | Label, e.g. `billing-bot`, `ci-deploy-key` |
| `isReadOnly` | Restricted to read-only operations |
| `bypassStepUp` | Bypasses MFA step-up requirements |
| `useAdminOwner` | Inherits admin/owner privileges from the owner |
| `parentPrincipalId` | For a child principal: the principal it derives from (NULL when it derives from `ownerId`) |
| `depth` | Depth below its owner-derived root (0 for standing principals), bounded by `auth_settings.max_principal_depth` |
| `expiresAt` | Expiry of an ephemeral child principal; NULL for standing principals |
| `createdBySessionId` | Session that minted a child principal |
| `apiKeyMaxDuration` | Upper bound on API-key lifetime for this principal (clamps below `auth_settings.api_key_max_duration`) |
| `createdAt`, `updatedAt` | Timestamps |

There is no mask on the principal row: per-membership-type capability masks live on `db.principalScopeOverride` (see [org-scoping.md](./org-scoping.md)).

## `db.principalEntity`

| Field | Description |
|-------|-------------|
| `id` | Primary key |
| `principalId` | The principal this scoping row belongs to |
| `entityId` | The org (entity) the principal may access |
| `ownerId` | Denormalized owner of the principal, used by RLS |
| `createdAt` | Timestamp |

No rows = unrestricted (the principal reaches every org its owner is in); one or more rows = only those orgs.

## `db.mutation.createPrincipal`

Input `CreatePrincipalInput`: `name`, `entityIds?`, `isReadOnly?`, `bypassStepUp?`, `useAdminOwner?`.

| Error | Cause |
|-------|-------|
| `NOT_AUTHENTICATED` | No session |
| `PRINCIPAL_CANNOT_CREATE_PRINCIPAL` | Called from a principal session (`AuthzHumanOnly`) — use `createChildPrincipal` to delegate |

## `db.mutation.deletePrincipal`

Input `DeletePrincipalInput`: `principalId`.

The owning human may delete any principal it owns; a principal session may delete only its own descendants. Deleting soft-revokes every session tree carrying the principal or any descendant (reason `principal_deleted`), then deletes their type-3 user rows, which cascades to the principal rows and their credentials.

| Error | Cause |
|-------|-------|
| `NOT_AUTHENTICATED` | No session |
| `PRINCIPAL_CANNOT_DELETE_PRINCIPAL` | A principal tried to delete itself |
| `PRINCIPAL_NOT_DESCENDANT` | A principal tried to delete one that is not strictly below it |
| `PRINCIPAL_NOT_FOUND` | No such principal |
| `NOT_OWNER` | The caller does not own the principal |
