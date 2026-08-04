---
name: constructive-principals-entity-scoped-keys
description: Ordering recipe for entity-scoped API keys — which plane and token each step uses (entity type → scoped principal → step-up → createApiKey → use/revoke), the three constraints that make the order matter, and the flat createPrincipal SDK gap.
---

# Entity-Scoped API Keys (End-to-End)

This is the **ordering** recipe for a credential scoped to specific entity rows. Each step is owned by another reference; this file only says what order they go in, which plane each one talks to, and what breaks if you get it wrong.

For org-only scoping, prefer the simpler `createOrgPrincipal` + `createOrgApiKey` flow in [api-keys.md](./api-keys.md). Use this recipe when scoping to a non-org entity type, or when the org mutations are absent.

| # | Step | Plane | Endpoint / token | Owned by |
|---|------|-------|------------------|----------|
| 0 | Provision the entity type | Control | `modules.<host>` / platform account JWT | [`constructive-entities` → orm-provisioning.md](../../constructive-entities/references/orm-provisioning.md) |
| 1 | Probe the scoping surface | Data | `auth-<subdomain>.<host>` / per-database token | [org-scoping.md](./org-scoping.md) |
| 2 | Create the scoped principal | Data | `auth-<subdomain>.<host>` / per-database token | [org-scoping.md](./org-scoping.md), plus the SDK gap below |
| 3 | Step up, then mint the key | Data | `auth-<subdomain>.<host>` / per-database token | [api-keys.md](./api-keys.md) |
| 4 | Use and revoke | Data | `api-<subdomain>.<host>` / the minted key | [api-keys.md](./api-keys.md) |

The flow crosses planes, so it must hold **both** tokens and send each to its own plane — a platform token never authenticates a data-plane call and vice versa. See [`constructive-architecture` → Control Plane vs Data Plane](../../constructive-architecture/SKILL.md#control-plane-vs-data-plane).

## Three constraints that fix the order

1. **Keys are personal at mint.** `createApiKey` without a `principalId` mints a key that acts as the calling human with all of their access. Scope comes only from the principal, so step 2 must precede step 3.
2. **Scope may be fixed at principal creation.** On create-time-scoping deployments there is no update path for a principal's scope — probe (step 1) before you commit to a shape, and never fall back to a broader key without an explicit user decision.
3. **Step-up is per session.** The mint fails with `STEP_UP_REQUIRED` unless the *same* session has a recent password proof; `verifyPassword` and the retry both belong on the session that mints.

## Step 2 — creating the principal (SDK gap)

> **SDK gap (observed 2026-08).** The generated `db.principal.create` sends a nested `{ principal }` input, but the deployed `CreatePrincipalInput` is flat and its payload exposes only `result: UUID`. Until the SDK regenerates, send this one mutation as raw GraphQL against the per-database auth endpoint (same bearer token as the SDK client). Everything else in this recipe uses the ORM.

```graphql
mutation ($input: CreatePrincipalInput!) {
  createPrincipal(input: $input) { result }
}
```

```jsonc
// variables — entityIds only on create-time-scoping deployments (probe first)
{
  "input": {
    "name": "reporting-bot",
    "entityIds": ["<entity-row-uuid>"],
    "isReadOnly": true
  }
}
```

`result` is the principal's **identity user id** — the value `createApiKey.principalId` expects. The `principals` table row carries a different `id` (the one `principalEntity.principalId` references); passing that row id to the mint fails with `PRINCIPAL_NOT_OWNED`. The owner is session-derived — there is no `ownerId` field.
