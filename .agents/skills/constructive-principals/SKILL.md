---
name: constructive-principals
description: "Principals — scoped sub-identities for API keys and agents: short-lived access tokens with rotating refresh (mintAccessToken/refreshAccessToken), narrow-only child principals (createChildPrincipal), principal presets (createPrincipalFromPreset), API-key TTL caps, cascade revocation, the intent claim, trust-ladder unlocks and the agent ladder, graphql.error refusal events and limit_refusals. Use when asked to 'create an API key', 'issue an agent credential', 'mint an access token', 'refresh token', 'REFRESH_TOKEN_REUSED', 'delegate to a child principal', 'PRINCIPAL_CHILD_WIDENS', 'deploy-bot preset', 'read-only-analyst', 'agent trust ladder', 'unlock a capability', 'scope an agent to an org', 'entity-scoped API key', 'read-only API key', 'revoke an API key', 'revoke a session', 'create a principal', 'org API key', 'service account', 'machine identity', 'agent identity', 'bypass step-up for a bot', 'STEP_UP_REQUIRED', 'principalEntity', 'principalScopeOverride', 'limit_refusals', or when managing agent/API-key identities via the SDK ORM."
metadata:
  author: constructive-io
  version: "1.1.0"
---

# Constructive Principals

**Principals** are scoped sub-identities of a human user. They are how you give an **agent** or an **API key** its own identity that acts on a human's behalf while carrying only a *subset* of that human's capabilities. A principal never exceeds its owner's access, and everything it does still meters and audits back to the owning human.

This skill covers principals from the application layer — how to create them, hand them short-lived tokens, delegate narrower children, issue and revoke standing API keys, scope them to specific orgs, and gate their capabilities behind earned trust, all through the generated **SDK ORM**. It intentionally does not cover the SQL/trigger internals (see the `constructive-db-principals` skill in `constructive-db` for that).

The App access and Organizations feature packs provide host-facing principal and API-key management views when the tenant exposes compatible operations. Use [`constructive-blocks`](../constructive-blocks/SKILL.md) for those UI surfaces; use this skill for the identity and authority model.

## When to Apply

Use this skill when:
- Giving an **AI agent** a credential for a run — a short-lived access token with a rotating refresh token (`mintAccessToken` / `refreshAccessToken`)
- Letting an agent hand a sub-task to a **strictly narrower child** principal (`createChildPrincipal`)
- Creating a principal from a **preset** (`read-only-analyst`, `deploy-bot`) in one call
- Issuing a standing **API key** for a CI pipeline, script, webhook, or integration — and understanding the TTL caps that clamp it
- Creating a **read-only** credential that physically cannot write
- Scoping a credential to **specific orgs** (or leaving it unrestricted)
- **Revoking** a session, key, or principal and understanding what cascades
- Withholding capabilities from an agent until it has **earned trust** (`agent` ladder, `unlocks`, `revoked_by`) and reading the **refusals** it hit (`graphql.error`, `limit_refusals`)
- Understanding why a credential can see less than its owning human

## Principal vs Agent vs API Key

All principals are the same underlying identity (a `user` with `type = 3`). The distinction is how you use them:

| Term | What it is |
|------|-----------|
| **Principal** | The identity record — a scoped sub-identity owned by a human, with a capability subset. |
| **Access token** | A short-lived credential (`cnc_live_at_*`, ≤15 min by default) minted *for* a principal from a human or standing-key session, paired with a single-use **refresh token**. The default credential for agent runs. |
| **API key** | A standing credential (`cnc_live_sk_*`) for out-of-band holders — CI vaults, webhook receivers, the root of an exchange chain. The principal is *who*; the key is *how it authenticates*. |
| **Child principal** | A principal minted *by* a principal (or its owner) with a strict subset of the parent's authority, ephemeral by default. |
| **Agent** | A principal that also has an `agent_module` record (persona, threads). An agent is a principal + AI context. |

So: "create an API key", "mint an access token" and "create an agent credential" all attach a credential to a principal. See [`constructive-agents`](../constructive-agents/SKILL.md) for the AI/persona side.

## Core Model (application view)

- A principal is owned by a human (`ownerId`) and has its own identity user row (`userId`, `type = 3`).
- Its capabilities are `parent_capabilities & allowedMask` — capabilities can only **shrink**, never exceed the owner's. `allowedMask = null` means "inherit all of the owner's capabilities".
- When the owner gains/loses access (e.g. removed from an org), the principal's access follows automatically.
- **Identity vs authority:** billing, rate limits, ownership, and `created_by`/`updated_by` always meter to the **human**; only capability checks use the **principal's** own precomputed capabilities. For a normal (non-principal) session the two are identical — zero behavioral change.

- **Trust can only withhold.** A scope's trust ladder may name `unlocks` a principal does not get until it earns a level; it can never add bits the owner lacks. Effective authority is `authority & allowedMask & ~(locked & ~unlocked)`.

> Principal management is **human-only** (`AuthzHumanOnly`): a principal cannot create, widen, or issue standing keys for principals — `PRINCIPAL_CANNOT_CREATE_PRINCIPAL`. The **one carve-out** is `createChildPrincipal`: a principal may mint a *strictly narrower* child of itself, and `mintAccessToken` for a principal it already is. Anything wider fails with `PRINCIPAL_CHILD_WIDENS`.

## ORM Quick Reference

The generated auth ORM client (`db`) exposes principals as tables plus a set of custom mutations.

### Tables (CRUD: `findMany` / `findOne` / `create` / `update` / `delete`)

| Model | Purpose | Key fields |
|-------|---------|-----------|
| `db.principal` | The principal identity | `id`, `ownerId`, `userId`, `name`, `isReadOnly`, `bypassStepUp`, `useAdminOwner`, `parentPrincipalId`, `depth`, `expiresAt`, `createdBySessionId` — reads only in practice; create/widen through the mutations below (per-scope masks live on `principalScopeOverride`) |
| `db.principalEntity` | Org-scoping junction (which orgs a principal may access) | `principalId`, `entityId` |
| `db.principalScopeOverride` | Per-membership-type capability override | `principalId`, `membershipType`, `allowedMask`, `isAdmin`, `isReadOnly` |
| `db.orgApiKeyList` | Read model of an org's API keys | `keyId`, `name`, `principalId`, `orgId`, `expiresAt`, `revokedAt`, `lastUsedAt`, `mfaLevel`, `accessLevel` |

RLS: you only ever see principals you own (`AuthzDirectOwner` on `ownerId`).

### Custom mutations

| Mutation | Purpose | Returns |
|----------|---------|---------|
| `db.mutation.mintAccessToken` | Exchange the current session for a short-lived access + refresh pair bound to a principal you own (`principalId`, `intent`, `accessTtl`) | `{ result: { accessToken, refreshToken, sessionId, principalUserId, accessExpiresAt, refreshExpiresAt } }` |
| `db.mutation.refreshAccessToken` | Rotate: spend a refresh token for a new pair (`token`) | same record as above |
| `db.mutation.revokeSession` | Revoke a session and every descendant (`sessionId`) | `{ result }` (boolean) |
| `db.mutation.createChildPrincipal` | Mint a strictly narrower child of a principal (`parentPrincipalId`, `name`, `allowedMask`, `entityIds`, `expiresAt`, `isReadOnly`, `intent`) | `{ result }` (child principal id) |
| `db.mutation.createPrincipalFromPreset` | Instantiate a catalogued preset (`slug`, `name`, `entityIds`, `overrides`) | `{ result }` (new principal id) |
| `db.mutation.setPrincipalScope` | Human-only: set `allowedMask` / `isReadOnly` / `isActive` / `useAdminOwner` for one `membershipType` | `{ result }` |
| `db.mutation.setPrincipalEntities` | Human-only: replace the principal's `entityIds` | `{ result }` |
| `db.mutation.updatePrincipal` | Human-only: patch `name`, `bypassStepUp`, `isReadOnly`, `useAdminOwner` | `{ result }` |
| `db.mutation.createApiKey` | Mint a standing API key for the current human (optionally for an existing `principalId`); `expiresIn` is clamped by the TTL caps | `{ apiKey, keyId, expiresAt }` |
| `db.mutation.revokeApiKey` | Revoke a user-scoped API key by `keyId` — cascades to every session exchanged from it | `{ result }` |
| `db.mutation.createOrgPrincipal` | Create a principal scoped to one org (caller must be org admin) | `{ result }` (new principal id) |
| `db.mutation.deleteOrgPrincipal` | Delete an org-scoped principal | `{ result }` |
| `db.mutation.createOrgApiKey` | Mint an API key under an org (creates/uses an org principal) | `{ apiKey, keyId, expiresAt }` |
| `db.mutation.revokeOrgApiKey` | Revoke an org API key | `{ result }` |

> **Plaintext credentials are returned exactly once.** `apiKey`, `accessToken` and `refreshToken` are never retrievable again — store them immediately. Afterwards only metadata (`keyId`, `name`, `expiresAt`, `lastUsedAt`, `revokedAt`) is queryable.

Custom mutations take two arguments: the variables `{ input }`, then an options object with a `select`.

### Give an agent a short-lived credential (recommended)

```typescript
// From a human (or standing-key) session, for a principal you own
const { mintAccessToken } = await db.mutation
  .mintAccessToken(
    { input: { principalId: '<principal-user-uuid>', intent: 'nightly-report', accessTtl: { minutes: 10 } } },
    { select: { result: { accessToken: true, refreshToken: true, sessionId: true, accessExpiresAt: true } } },
  )
  .execute()
  .unwrap();

// Later, before accessExpiresAt: rotate (the old refresh token dies)
const { refreshAccessToken } = await db.mutation
  .refreshAccessToken(
    { input: { token: mintAccessToken.result.refreshToken } },
    { select: { result: { accessToken: true, refreshToken: true, accessExpiresAt: true } } },
  )
  .execute()
  .unwrap();
```

Access TTL is capped by the tenant (`auth_settings.access_token_duration`, default 15 min); refresh defaults to 30 days and the chain never outlives `max_session_chain_age` (90 days). Presenting a spent refresh token revokes the whole session tree and fails with `REFRESH_TOKEN_REUSED`. Full rules, claims (`jwt.claims.intent`, lineage) and revocation cascades: [access-tokens.md](./references/access-tokens.md).

### Delegate a narrower child

```typescript
const { createChildPrincipal } = await db.mutation
  .createChildPrincipal(
    {
      input: {
        parentPrincipalId: '<parent-principal-user-uuid>',
        name: 'deploy-job-4821',
        entityIds: ['<org-uuid>'],              // ⊆ parent's entities
        expiresAt: '2026-09-06T00:00:00Z',      // ≤ parent / chain expiry
        isReadOnly: true,
      },
    },
    { select: { result: true } },
  )
  .execute()
  .unwrap();
// then mintAccessToken({ principalId: createChildPrincipal.result, ... })
```

A child can only be narrower: a wider `allowedMask`, an entity outside the parent's list, or a later expiry fails (`PRINCIPAL_CHILD_WIDENS`, `PRINCIPAL_CHILD_TTL_EXCEEDS_PARENT`). See [delegation.md](./references/delegation.md).

### Create a principal from a preset

```typescript
const { createPrincipalFromPreset } = await db.mutation
  .createPrincipalFromPreset(
    { input: { slug: 'deploy-bot', name: 'release-bot', entityIds: ['<org-uuid>'] } },
    { select: { result: true } },
  )
  .execute()
  .unwrap();
```

Shipped slugs: `read-only-analyst` (all of the owner's bits, read-only, no delegation) and `deploy-bot` (`manage_services` / `manage_sites` / `manage_domains` at org scope, entity list required, one level of delegation). `overrides` may only tighten. See [delegation.md](./references/delegation.md#presets-one-call-a-known-good-principal).

### Create a standing API key (owner-scoped)

```typescript
const { createApiKey } = await db.mutation
  .createApiKey(
    {
      input: {
        keyName: 'ci-deploy',
        accessLevel: 'full_access',    // or 'read_only'
        mfaLevel: 'none',
        expiresIn: { days: 90 },       // IntervalInput; clamped to the strictest tenant/principal/org cap
      },
    },
    { select: { result: { apiKey: true, keyId: true, expiresAt: true } } },
  )
  .execute()
  .unwrap();

// createApiKey.result.apiKey — show/store now; you cannot read it again.
```

### Create a read-only key

Set `accessLevel: 'read_only'`. The credential runs every request in a PostgreSQL read-only transaction — it physically cannot write, regardless of the owner's capabilities. See [`constructive-security` → read-only-access.md](../constructive-security/references/read-only-access.md).

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

**Scoping to non-org entity types:** the same `principalEntity` mechanism covers rows of any provisioned entity type, and some deployments instead take `entityIds` at principal creation. Probe first — [org-scoping.md](./references/org-scoping.md) has the check and both surfaces.

### Entity-scoped keys, end to end

[entity-scoped-keys.md](./references/entity-scoped-keys.md) is the ordering recipe for the cross-plane flow (entity type → scoped principal → step-up → mint → use/revoke) and the three constraints that fix that order: keys are personal at mint, scope may be fixed at principal creation, and step-up is per session. For org-only scoping, prefer the `createOrgPrincipal` flow above.

### Revoke

```typescript
await db.mutation
  .revokeApiKey({ input: { keyId: '<key-uuid>' } }, { select: { result: true } })
  .execute()
  .unwrap();
```

Revoking disables the credential but keeps the row (with `revokedAt` set) for audit, and revokes every session and token that was exchanged from the key. `revokeSession({ sessionId })` does the same for a minted token pair and its descendants. Deleting a principal cascades — its children, keys, org scoping, and identity row all go, while `created_by`/`updated_by` on data it touched still point to the human (no orphans).

## Trust & Refusals

A scope's trust ladder can **withhold** capabilities from principals until they earn a level. The shipped `agent` preset (`["events_module", { "scope": "org", "trust_ladder": "agent" }]`) grants `agent_proven` after 3 and `agent_trusted` after 10 `agent.run.completed` events in 30 days; `agent_trusted` lapses after 30 days and is revoked (with progress reset) by `token.refresh_reused` or `graphql.error:PRINCIPAL_CHILD_WIDENS`. Which bits are withheld is yours to name via `unlocks` — the preset ships none.

Refused mutations are recorded as `graphql.error` events (`payload.code`, `payload.operation`) by `ErrorEventsPlugin` (graphql-server ≥ 5.23) after rollback, and the quota family is exposed through the tenant's `limit_refusals` view. See [trust-and-refusals.md](./references/trust-and-refusals.md).

## References

| File | Content |
|------|---------|
| [access-tokens.md](./references/access-tokens.md) | `mintAccessToken` / `refreshAccessToken` inputs and records, TTL ceilings (`access_token_duration`, `refresh_token_duration`, `max_session_chain_age`), the `intent` and lineage claims, replay detection (`REFRESH_TOKEN_REUSED`), cascade revocation (`revokeSession` / `signOut` / `revokeApiKey`), API-key TTL caps |
| [delegation.md](./references/delegation.md) | `createChildPrincipal` narrow-only rules and errors, the settings that gate delegation, `createPrincipalFromPreset`, the `read-only-analyst` / `deploy-bot` presets, human-only widening (`setPrincipalScope`, `setPrincipalEntities`, `updatePrincipal`) |
| [trust-and-refusals.md](./references/trust-and-refusals.md) | Trust-gated authority (`unlocks`, `expires_interval`, `revoked_by`, `period_interval`), the `agent` ladder preset, `graphql.error` via `ErrorEventsPlugin`, the `limit_refusals` view |
| [principal-model.md](./references/principal-model.md) | Identity model — dual-claim (identity vs authority), user type 3, capability subsetting, `allowedMask`, `isReadOnly`, `bypassStepUp`, what meters to human vs principal |
| [api-keys.md](./references/api-keys.md) | API key lifecycle via the ORM — `createApiKey`/`createOrgApiKey`, access levels, MFA level, expiry, the `STEP_UP_REQUIRED` + `verifyPassword` retry, listing via `orgApiKeyList`, revocation, plaintext-once handling |
| [org-scoping.md](./references/org-scoping.md) | Scoping via `principalEntity`, `principalScopeOverride`, the create-time `entityIds` variant and its probe, empty-means-unrestricted semantics, and how scoping follows the owner's membership changes |
| [entity-scoped-keys.md](./references/entity-scoped-keys.md) | Ordering recipe for the cross-plane flow — which plane/token each step uses, the three constraints, and the flat `createPrincipal` SDK gap |

## Cross-References

- **Identity & sessions:** [`constructive-auth`](../constructive-auth/SKILL.md) — how humans authenticate; principals authenticate via API keys instead of passwords/magic links.
- **Capabilities:** [`constructive-access-control`](../constructive-access-control/SKILL.md) — the capability model whose subset a principal carries (`allowedMask`).
- **Enforcement:** [`constructive-security`](../constructive-security/SKILL.md) — `AuthzHumanOnly` (blocks principals from managing principals), read-only access, RLS.
- **Trust ladders & events:** [`constructive-events`](../constructive-events/SKILL.md) — `humanity` / `metered` ladders, base rung fields, EventTracker; the `agent` ladder and `unlocks` are covered here.
- **Auth settings:** [`constructive-auth` → auth-settings.md](../constructive-auth/references/auth-settings.md) — where the tenant-level token/delegation ceilings (`auth_settings.*`) are edited.
- **Agents:** [`constructive-agents`](../constructive-agents/SKILL.md) — attaching an `agent_module` (persona, threads) to a principal.
- **Entity types:** [`constructive-entities`](../constructive-entities/SKILL.md) — the multi-tenancy model behind the entity rows that scoped principals are limited to.
- **Planes:** [`constructive-architecture`](../constructive-architecture/SKILL.md) — control plane vs data plane: entity types provision with the platform token; principals and keys mint with the per-database token.
- **App access and Organizations UI:** [`constructive-blocks`](../constructive-blocks/SKILL.md) — standalone host contracts plus Console module discovery and adapters.
- **SQL internals:** `constructive-db-principals` skill (in `constructive-db`) — dual-claim JWT, `principal_auth_module`, SPRT sync triggers. Not needed for app development.
