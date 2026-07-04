---
name: constructive-principals
description: "Principals — scoped sub-identities for API keys and agents. A principal is a delegated identity owned by a human (or org) that authenticates via an API key and operates with a subset of its parent's permissions. Use when asked to 'create an API key', 'issue an agent credential', 'scope an agent to an org', 'read-only API key', 'revoke an API key', 'create a principal', 'org API key', 'service account', 'machine identity', 'agent identity', 'bypass step-up for a bot', 'principalEntity', 'principalScopeOverride', or when managing agent/API-key identities via the SDK ORM."
compatibility: "@constructive-io/sdk (generated auth ORM client)"
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Principals

**Principals** are scoped sub-identities of a human user. They are how you give an **agent** or an **API key** its own identity that acts on a human's behalf while carrying only a *subset* of that human's permissions. A principal never exceeds its owner's access, and everything it does still meters and audits back to the owning human.

This skill covers principals from the application layer — how to create them, issue and revoke their API keys, and scope them to specific orgs, all through the generated **SDK ORM**. It intentionally does not cover the SQL/trigger internals (see the `constructive-db-principals` skill in `constructive-db` for that).

## When to Apply

Use this skill when:
- Issuing an **API key** for a CI pipeline, script, webhook, or integration
- Giving an **AI agent** its own credential and identity
- Creating a **read-only** credential that physically cannot write
- Scoping a credential to **specific orgs** (or leaving it unrestricted)
- **Revoking** an API key or **deleting** a principal
- Understanding why a credential can see less than its owning human

## Principal vs Agent vs API Key

All principals are the same underlying identity (a `user` with `type = 3`). The distinction is how you use them:

| Term | What it is |
|------|-----------|
| **Principal** | The identity record — a scoped sub-identity owned by a human, with a permission subset. |
| **API key** | A credential minted *for* a principal. The principal is *who*; the API key is *how it authenticates*. |
| **Agent** | A principal that also has an `agent_module` record (persona, threads). An agent is a principal + AI context. |

So: "create an API key" and "create an agent credential" both create/attach a principal. See [`constructive-agents`](../constructive-agents/SKILL.md) for the AI/persona side.

## Core Model (application view)

- A principal is owned by a human (`ownerId`) and has its own identity user row (`userId`, `type = 3`).
- Its permissions are `parent_permissions & allowedMask` — permissions can only **shrink**, never exceed the owner's. `allowedMask = null` means "inherit all of the owner's permissions".
- When the owner gains/loses access (e.g. removed from an org), the principal's access follows automatically.
- **Identity vs authority:** billing, rate limits, ownership, and `created_by`/`updated_by` always meter to the **human**; only permission checks use the **principal's** own precomputed permissions. For a normal (non-principal) session the two are identical — zero behavioral change.

> All principal/API-key management is **human-only**: a principal cannot create or manage other principals. Attempting to do so fails with `PRINCIPAL_CANNOT_CREATE_PRINCIPAL`.

## ORM Quick Reference

The generated auth ORM client (`db`) exposes principals as tables plus a set of custom mutations.

### Tables (CRUD: `findMany` / `findOne` / `create` / `update` / `delete`)

| Model | Purpose | Key fields |
|-------|---------|-----------|
| `db.principal` | The principal identity | `id`, `ownerId`, `userId`, `name`, `allowedMask`, `isReadOnly`, `bypassStepUp` |
| `db.principalEntity` | Org-scoping junction (which orgs a principal may access) | `principalId`, `entityId` |
| `db.principalScopeOverride` | Per-membership-type permission override | `principalId`, `membershipType`, `allowedMask`, `isAdmin`, `isReadOnly` |
| `db.orgApiKeyList` | Read model of an org's API keys | `keyId`, `name`, `principalId`, `orgId`, `expiresAt`, `revokedAt`, `lastUsedAt`, `mfaLevel`, `accessLevel` |

RLS: you only ever see principals you own (`AuthzDirectOwner` on `ownerId`).

### Custom mutations

| Mutation | Purpose | Returns |
|----------|---------|---------|
| `db.mutation.createApiKey` | Mint an API key for the current human (optionally for an existing `principalId`) | `{ apiKey, keyId, expiresAt }` |
| `db.mutation.revokeApiKey` | Revoke a user-scoped API key by `keyId` | `{ result }` |
| `db.mutation.createOrgPrincipal` | Create a principal scoped to one org (caller must be org admin) | `{ result }` (new principal id) |
| `db.mutation.deleteOrgPrincipal` | Delete an org-scoped principal | `{ result }` |
| `db.mutation.createOrgApiKey` | Mint an API key under an org (creates/uses an org principal) | `{ apiKey, keyId, expiresAt }` |
| `db.mutation.revokeOrgApiKey` | Revoke an org API key | `{ result }` |

> **The plaintext `apiKey` is returned exactly once, at creation.** It is never retrievable again — store it immediately. Afterwards only metadata (`keyId`, `name`, `expiresAt`, `lastUsedAt`, `revokedAt`) is queryable.

### Create an API key (owner-scoped)

Custom mutations take two arguments: the variables `{ input }`, then an options object with a `select`.

```typescript
const { createApiKey } = await db.mutation
  .createApiKey(
    {
      input: {
        keyName: 'ci-deploy',
        accessLevel: 'full_access',    // or 'read_only'
        mfaLevel: 'none',
        expiresIn: { days: 90 },       // IntervalInput; omit for no expiry
      },
    },
    { select: { result: { apiKey: true, keyId: true, expiresAt: true } } },
  )
  .execute()
  .unwrap();

// createApiKey.result.apiKey — show/store now; you cannot read it again.
```

### Create a read-only key

Set `accessLevel: 'read_only'`. The credential runs every request in a PostgreSQL read-only transaction — it physically cannot write, regardless of the owner's permissions. See [`constructive-security` → read-only-access.md](../constructive-security/references/read-only-access.md).

### Scope an agent/key to a specific org

```typescript
// 1. Create an org-scoped principal (caller must be an admin of orgId)
const { createOrgPrincipal } = await db.mutation
  .createOrgPrincipal(
    {
      input: {
        name: 'reporting-bot',
        orgId: '<org-uuid>',
        isReadOnly: true,
        bypassStepUp: true,   // principals can't do MFA; true skips step-up
      },
    },
    { select: { result: true } },
  )
  .execute()
  .unwrap();

const principalId = createOrgPrincipal.result; // new principal id

// 2. Mint a key for it
const { createOrgApiKey } = await db.mutation
  .createOrgApiKey(
    {
      input: { orgId: '<org-uuid>', principalId, keyName: 'reporting-bot', accessLevel: 'read_only' },
    },
    { select: { result: { apiKey: true, keyId: true } } },
  )
  .execute()
  .unwrap();
```

**Org scoping via absence:** a principal with **no** `principalEntity` rows inherits access to *all* orgs its owner belongs to. Adding rows restricts it to only those orgs. See [org-scoping.md](./references/org-scoping.md).

### Revoke

```typescript
await db.mutation
  .revokeApiKey({ input: { keyId: '<key-uuid>' } }, { select: { result: true } })
  .execute()
  .unwrap();
```

Revoking disables the credential but keeps the row (with `revokedAt` set) for audit. Deleting a principal cascades — its keys, org scoping, and identity row all go, while `created_by`/`updated_by` on data it touched still point to the human (no orphans).

## References

| File | Content |
|------|---------|
| [principal-model.md](./references/principal-model.md) | Identity model — dual-claim (identity vs authority), user type 3, permission subsetting, `allowedMask`, `isReadOnly`, `bypassStepUp`, what meters to human vs principal |
| [api-keys.md](./references/api-keys.md) | API key lifecycle via the ORM — `createApiKey`/`createOrgApiKey`, access levels, MFA level, expiry, listing via `orgApiKeyList`, revocation, plaintext-once handling |
| [org-scoping.md](./references/org-scoping.md) | Org scoping via `principalEntity`, `principalScopeOverride`, empty-means-unrestricted semantics, and how scoping follows the owner's membership changes |

## Cross-References

- **Identity & sessions:** [`constructive-auth`](../constructive-auth/SKILL.md) — how humans authenticate; principals authenticate via API keys instead of passwords/magic links.
- **Permissions:** [`constructive-access-control`](../constructive-access-control/SKILL.md) — the permission model whose subset a principal carries (`allowedMask`).
- **Enforcement:** [`constructive-security`](../constructive-security/SKILL.md) — `AuthzHumanOnly` (blocks principals from managing principals), read-only access, RLS.
- **Agents:** [`constructive-agents`](../constructive-agents/SKILL.md) — attaching an `agent_module` (persona, threads) to a principal.
- **SQL internals:** `constructive-db-principals` skill (in `constructive-db`) — dual-claim JWT, `principal_auth_module`, SPRT sync triggers. Not needed for app development.
