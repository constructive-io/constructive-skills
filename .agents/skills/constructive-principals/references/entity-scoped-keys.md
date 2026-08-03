---
name: constructive-principals-entity-scoped-keys
description: End-to-end recipe for entity-scoped API keys — provision an entity type, create a scoped principal, satisfy step-up, mint with createApiKey, and use or revoke the key. Includes the create-time-scoping feature probe.
---

# Entity-Scoped API Keys (End-to-End)

This recipe takes you from nothing to a working credential that is scoped to specific entity rows: entity type → principal → step-up → `createApiKey` → use/revoke.

The flow crosses both planes (see [`constructive-architecture`](../../constructive-architecture/SKILL.md)):

| Step | Plane | Endpoint | Token |
|------|-------|----------|-------|
| Provision the entity type | Control | Platform API (`api.<host>`) | Platform account JWT |
| Principal, step-up, key mint | Data | Per-database auth (`auth-<subdomain>.<host>`) | Per-database app token |
| Use the key | Data | Per-database API (`api-<subdomain>.<host>`) | The minted key as bearer |

## Three hard constraints

1. **Keys are personal at mint.** `createApiKey` without a `principalId` mints a key that acts as the calling human, with all of their access. Scope comes only from the principal that the key is minted for — create the scoped principal first, then pass its id.
2. **Scope is fixed at principal creation.** On deployments with create-time scoping, `CreatePrincipalInput` carries `entityIds` (entity-row UUIDs) and `isReadOnly`. There is no update path for a principal's scope on these deployments — to change scope, create a new principal and mint a new key. Deployments that instead expose the `principalEntity` / `principalScopeOverride` tables allow post-hoc adjustment (see [org-scoping.md](./org-scoping.md)). Probe before you rely on either surface (below), and never fall back to a broader key without an explicit user decision.
3. **`STEP_UP_REQUIRED` demands `verifyPassword` on the same session.** Minting a key is a step-up-guarded operation. If the session's last password proof is older than the step-up window (default 30 minutes), the mint fails with a step-up error. Call `verifyPassword` with the same session token, then retry the mint. A fresh password sign-in satisfies the window with no extra call.

## Step 0 — Provision the entity type (control plane)

An entity type (organization, team, project, …) provisions its own entity table plus membership wiring, and is the unit that keys can be scoped to. Use the platform `modules` client with the platform account JWT:

```typescript
const { createEntityTypeProvision } = await modules.entityTypeProvision
  .create({
    data: { databaseId, name: 'Team', prefix: 'team' },
    select: { id: true, name: true, outEntityTableName: true, outInstalledModules: true },
  })
  .unwrap();
// outEntityTableName: "team" — the entity table now in the per-database API schema.
```

Registrations are immutable: there is no update. To change one, delete it and create a new one. Deleting removes the registration only — **the provisioned entity table and its data stay in the API schema.**

## Step 1 — Probe for create-time scoping (data plane)

Deployments differ in where scope is expressed. Introspect `CreatePrincipalInput` on the per-database auth endpoint:

```graphql
{ __type(name: "CreatePrincipalInput") { inputFields { name } } }
```

- `entityIds` present → scope at create time (this recipe).
- `entityIds` absent → check for the `principalEntity` / `principalScopeOverride` tables (post-hoc scoping, [org-scoping.md](./org-scoping.md)).
- Neither → the deployment cannot scope this principal. Fail the scoped request with that reason. Mint an unscoped key only after the user explicitly accepts one.

## Step 2 — Create the scoped principal (data plane)

> **SDK gap:** the generated `db.principal.create` sends a nested `{ principal }` input, but the live `CreatePrincipalInput` is flat and its payload exposes only `result: UUID`. Until the SDK regenerates, send the mutation as raw GraphQL against the per-database auth endpoint (same bearer token as the SDK client).

```graphql
mutation ($input: CreatePrincipalInput!) {
  createPrincipal(input: $input) { result }
}
```

```jsonc
// variables
{
  "input": {
    "name": "reporting-bot",
    "entityIds": ["<entity-row-uuid>"],  // rows of the entity table from step 0
    "isReadOnly": true
  }
}
```

`result` is the new principal id. The owner is session-derived — there is no `ownerId` field. `entityIds` takes entity **row** UUIDs (rows of the provisioned entity table), not entity-type ids.

## Step 3 — Mint the key, satisfy step-up (data plane)

Mint with the SDK on the per-database auth client, passing the principal id:

```typescript
const mint = () =>
  db.mutation
    .createApiKey(
      {
        input: {
          principalId,
          keyName: 'reporting-bot',
          accessLevel: 'read_only',
          expiresIn: { days: 90 },
        },
      },
      { select: { result: { select: { apiKey: true, keyId: true, expiresAt: true } } } },
    )
    .execute();

let minted = await mint();
if (!minted.ok && minted.errors.some((e) => /step[\s_-]?up/i.test(e.message))) {
  const verified = await db.mutation
    .verifyPassword({ input: { password } }, { select: { result: true } })
    .execute();
  if (verified.data?.verifyPassword?.result !== true) throw new Error('Password verification failed.');
  minted = await mint();
}
```

`verifyPassword` semantics, proven against a live deployment:

- Correct password → `{ result: true }`.
- Wrong password → `{ result: null }` — **not** `false` and **not** a GraphQL error. Treat anything other than `result === true` as a failed verify.
- The verify must run on the **same session** (same bearer token) as the mint. A verify on a different session does not open the step-up window for this one.

The returned `apiKey` plaintext appears exactly once — store it immediately (see [api-keys.md](./api-keys.md) for the full lifecycle).

## Step 4 — Use and revoke

Present the plaintext as a bearer token to the **per-database API endpoint** (`api-<subdomain>`). The session authenticates as the principal: reads are limited to the scoped entity rows, writes are rejected when `isReadOnly` or `accessLevel: 'read_only'` is set.

```typescript
await db.mutation
  .revokeApiKey({ input: { keyId } }, { select: { result: true } })
  .execute()
  .unwrap();
```

After revocation the key fails with `UNAUTHENTICATED`. Revocation is soft (audit row stays). Delete the principal to remove the identity entirely — its keys cascade.
