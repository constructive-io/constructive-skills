---
name: constructive-principals-api-keys
description: API key lifecycle via the SDK ORM — createApiKey/createOrgApiKey, access levels, MFA level, expiry, listing via orgApiKeyList, revocation, and plaintext-once handling.
---

# API Keys (via the SDK ORM)

An API key is the credential a principal authenticates with. Creating a key mints (or reuses) a principal under the hood, so "issue an API key" and "create an agent credential" are the same flow. Everything here uses the generated auth ORM client `db`.

## Create a key for the current human

Custom mutations take two arguments: the variables `{ input }`, then an options object carrying `select`. `.execute()` returns a Result union; chain `.unwrap()` to throw on error.

```typescript
const { createApiKey } = await db.mutation
  .createApiKey(
    {
      input: {
        keyName: 'ci-deploy',
        accessLevel: 'full_access', // 'full_access' | 'read_only'
        mfaLevel: 'none',           // required MFA level to use the key
        expiresIn: { days: 90 },    // IntervalInput; omit for no expiry
        // principalId: '<uuid>',   // optional: attach to an existing principal
      },
    },
    { select: { result: { apiKey: true, keyId: true, expiresAt: true } } },
  )
  .execute()
  .unwrap();

console.log(createApiKey.result.apiKey); // <-- shown ONCE. Store it now.
```

### Input fields (`CreateApiKeyInput`)

| Field | Type | Notes |
|-------|------|-------|
| `keyName` | String | Human-readable label |
| `accessLevel` | String | `'full_access'` (default) or `'read_only'` |
| `mfaLevel` | String | MFA level required to present this key |
| `expiresIn` | IntervalInput | e.g. `{ days: 90 }`, `{ hours: 12 }`; omit = no expiry |
| `principalId` | UUID | Optional — mint the key for an existing principal instead of creating a new one |

### Return (`CreateApiKeyRecord`)

`{ apiKey, keyId, expiresAt }`. **`apiKey` is the plaintext secret and is only returned here.** It is not stored in a form you can read back — capture it at creation time. Later you can only query metadata.

## Access levels

| Value | Behavior |
|-------|----------|
| `full_access` | Normal read + write, subject to RLS. |
| `read_only` | The credential runs every request in a PostgreSQL read-only transaction — **all writes are rejected by the engine**, independent of the owner's permissions. |

Read-only keys are the safest way to hand out an integration credential that can never mutate data. See [`constructive-security` → read-only-access.md](../../constructive-security/references/read-only-access.md).

## Org API keys

For a B2B app where the key belongs to an organization rather than a personal account, use the org variants. The caller must be an **admin** of the org.

```typescript
// Create an org-scoped principal (once), then mint keys for it.
const { createOrgPrincipal } = await db.mutation
  .createOrgPrincipal(
    { input: { name: 'reporting-bot', orgId: '<org-uuid>', isReadOnly: true, bypassStepUp: true } },
    { select: { result: true } },
  )
  .execute()
  .unwrap();

const principalId = createOrgPrincipal.result;

const { createOrgApiKey } = await db.mutation
  .createOrgApiKey(
    {
      input: {
        orgId: '<org-uuid>',
        principalId,              // optional; omit to create a fresh org principal
        keyName: 'reporting-bot',
        accessLevel: 'read_only',
        mfaLevel: 'none',
        expiresIn: { days: 30 },
      },
    },
    { select: { result: { apiKey: true, keyId: true, expiresAt: true } } },
  )
  .execute()
  .unwrap();
```

`CreateOrgApiKeyInput`: `{ orgId, principalId?, keyName, accessLevel, mfaLevel, expiresIn }`. Returns `{ apiKey, keyId, expiresAt }` — same plaintext-once rule.

## Listing keys

Query metadata (never the secret) via the `orgApiKeyList` read model:

```typescript
const items = await db.orgApiKeyList
  .findMany({
    select: {
      keyId: true, name: true, principalId: true, orgId: true,
      expiresAt: true, revokedAt: true, lastUsedAt: true,
      mfaLevel: true, accessLevel: true,
    },
  })
  .execute()
  .unwrap();
```

`revokedAt = null` and (`expiresAt = null` or in the future) means the key is active. `lastUsedAt` tracks usage.

## Revoking

```typescript
// user-scoped key
await db.mutation
  .revokeApiKey({ input: { keyId: '<key-uuid>' } }, { select: { result: true } })
  .execute()
  .unwrap();

// org-scoped key
await db.mutation
  .revokeOrgApiKey({ input: { keyId: '<key-uuid>' } }, { select: { result: true } })
  .execute()
  .unwrap();
```

Revoking is soft — the row stays with `revokedAt` set, so audit history is preserved and the same `keyId` can't be reused. To remove the identity entirely, delete the principal (`deleteOrgPrincipal`), which cascades to its keys.

## Using the key

Present the plaintext key as a bearer token to the GraphQL endpoint:

```typescript
const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: `Bearer ${apiKey}` },
});
```

The session then authenticates as the principal: permission checks use the principal's subset, while billing/audit still attribute to the owning human.
