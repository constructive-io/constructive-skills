---
name: constructive-principals-access-tokens
description: Short-lived access tokens and rotating refresh tokens for principals via the auth ORM — mintAccessToken, refreshAccessToken, the intent claim, TTL ceilings, cascade revocation (revokeSession / signOut / revokeApiKey), and the API-key TTL caps.
---

# Access Tokens & Refresh Rotation

A standing API key (`cnc_live_sk_*`) is the **bootstrap** credential, not what an agent should carry on every request. The recommended shape is a human (or standing-key) session **exchanged** for a short-lived pair bound to a principal the caller owns:

```
human / standing-key session
  -> mintAccessToken({ principalId, intent, accessTtl })
       accessToken   (cnc_live_at_*, ≤ auth_settings.access_token_duration, default 15 minutes)
       refreshToken  (cnc_live_rt_*, = child session expiry, default refresh_token_duration 30 days)
  -> agent authenticates with accessToken
  -> refreshAccessToken({ token: refreshToken })   // single use, rotates BOTH tokens
```

All examples use the generated **auth** ORM client (`db`). Custom mutations take `{ input }` then an options object with `select`.

## Mint a token pair

```typescript
const { mintAccessToken } = await db.mutation
  .mintAccessToken(
    {
      input: {
        principalId: '<principal-user-uuid>',   // a principal you own; omitted = the caller's current principal
        intent: 'nightly-report',               // free text, surfaces as jwt.claims.intent
        accessTtl: { minutes: 5 },              // IntervalInput; may only SHORTEN the ceiling
      },
    },
    {
      select: {
        result: {
          accessToken: true,
          refreshToken: true,
          sessionId: true,
          principalUserId: true,
          accessExpiresAt: true,
          refreshExpiresAt: true,
        },
      },
    },
  )
  .execute()
  .unwrap();

const { accessToken, refreshToken, sessionId } = mintAccessToken.result;
```

Generated shapes (`MintAccessTokenInput` / `MintAccessTokenRecord`):

| Input | Type | Notes |
|-------|------|-------|
| `principalId` | UUID | `principals.userId` of a principal owned by the caller |
| `intent` | String | Stored on the credential; exposed to SQL as `jwt.claims.intent`. Audit context, **not** an authorization grant |
| `accessTtl` | IntervalInput | Ceiling is `auth_settings.access_token_duration` (default `15 minutes`); longer values are clamped |

| Result field | Meaning |
|--------------|---------|
| `accessToken` | Bearer token for requests (`cnc_live_at_*`) |
| `refreshToken` | Single-use rotation token (`cnc_live_rt_*`) |
| `sessionId` | The child session — pass to `revokeSession` |
| `principalUserId` | Identity the tokens act as |
| `accessExpiresAt` / `refreshExpiresAt` | Timestamps |

Both tokens are returned **once**. Store the refresh token server-side; never log either.

### Lifetime rules (enforced by the platform, not by you)

| Rule | Setting / error |
|------|-----------------|
| Access TTL cannot exceed the tenant ceiling | `auth_settings.access_token_duration` (default 15 min) |
| Refresh TTL | `auth_settings.refresh_token_duration` (default 30 days), also bounded by the parent session's expiry |
| A chain never outlives its root | `auth_settings.max_session_chain_age` (default 90 days) |
| Nesting depth | `auth_settings.max_session_depth` → `SESSION_DEPTH_EXCEEDED` |
| Exchange switched off per tenant | `auth_settings.allow_token_exchange = false` → `TOKEN_EXCHANGE_DISABLED` |
| Caller credential must itself be exchangeable | `CREDENTIAL_NOT_EXCHANGEABLE` |

These `auth_settings` columns live on the tenant's `app_settings_auth` row, set at provisioning by `sessions_module`. **SDK gap:** `app_settings_auth` is not a generated ORM model in any target, so there is no supported SDK path to change them afterwards — see [`constructive-auth` → auth-settings.md](../../constructive-auth/references/auth-settings.md). Do not write SQL against it.

## Refresh (rotate)

```typescript
const { refreshAccessToken } = await db.mutation
  .refreshAccessToken(
    { input: { token: refreshToken } },
    {
      select: {
        result: {
          accessToken: true,
          refreshToken: true,        // NEW refresh token — the old one is now dead
          sessionId: true,
          accessExpiresAt: true,
          refreshExpiresAt: true,
        },
      },
    },
  )
  .execute()
  .unwrap();
```

`RefreshAccessTokenRecord` has the same fields as `MintAccessTokenRecord`.

**Replay detection.** A refresh token is single-use. Presenting an already-rotated token revokes the **entire session tree** (that session and every child minted beneath it), records a `token.refresh_reused` event, and fails with `REFRESH_TOKEN_REUSED`. Treat that error as "this credential leaked — re-mint from a human session", never as a retryable condition.

**Access/refresh tokens cannot be extended.** `extendTokenExpires({ amount })` is for ordinary sessions; the only way to get more time on an exchanged pair is `refreshAccessToken`. (The refusal raises a database error; it is not yet in the app-level error registry, so do not branch on a specific code for it.)

## Revoke — cascades

| Mutation | Input | Cascades to |
|----------|-------|-------------|
| `db.mutation.revokeSession` | `{ sessionId }` (from `mintAccessToken`) | that session, its tokens, and every descendant session |
| `db.mutation.signOut` | — | the current session and its descendants |
| `db.mutation.revokeApiKey` | `{ keyId }` | the key's session and every session/token exchanged from it |

```typescript
await db.mutation
  .revokeSession({ input: { sessionId } }, { select: { result: true } })   // result: boolean
  .execute()
  .unwrap();
```

Revoking a standing key therefore also kills every agent run that was bootstrapped from it. One event per revoked session (`session.revoked`) is recorded.

## Claims an exchanged token carries

| Claim | Meaning |
|-------|---------|
| `jwt.claims.user_id` | The **human** — billing, ownership, `created_by` |
| `jwt.claims.principal_id` | The **authority** — whose capabilities apply |
| `jwt.claims.intent` | The `intent` string passed at mint (NULL if omitted) |
| `jwt.claims.root_session_id` / `parent_session_id` | Session lineage for audit |

There is **no** permission claim and **no** `session_depth` claim. Authority is derived live from the principal's SPRT rows and RLS on every request; tokens never carry capability bits, so narrowing a principal takes effect immediately without re-minting.

## Standing API keys: TTL caps

`createApiKey` / `createOrgApiKey` still exist for out-of-band holders (CI secrets, webhook receivers, the root of an exchange chain). Their `expiresIn` is clamped at mint time to the **strictest** of:

| Cap | Where it lives |
|-----|----------------|
| App-wide default / max | `auth_settings.api_key_default_duration` (default 90 days) / `auth_settings.api_key_max_duration` (default 365 days; NULL disables) |
| Per-principal ceiling | `principals.api_key_max_duration` — set by the owner |
| Per-org ceiling | org `membership_settings.api_key_max_duration` — set by an org admin; applies to `createOrgApiKey` |

The clamp is final: the key's own session is created with the same `expiresAt`, and changing a knob later never moves an already-issued key.

> **SDK gap:** `principals.api_key_max_duration` is not yet a field on the generated `Principal` model / `PrincipalPatch`, so it cannot currently be set through the auth ORM. Configure it at the tenant level (`auth_settings`) or org level (`membership_settings`) until the model regenerates.

## Choosing a credential

| Need | Use |
|------|-----|
| An agent run, a job, anything automated that runs *now* | `mintAccessToken` from a human session (short access, rotating refresh) |
| A per-task worker with even less authority than the agent | `createChildPrincipal` then `mintAccessToken` for the child — see [delegation.md](./delegation.md) |
| A secret that lives in a CI vault / webhook config | `createApiKey` / `createOrgApiKey` with an explicit `expiresIn` |
| Human-in-the-loop widening of a principal | `setPrincipalScope` from a stepped-up human session (never from the principal itself) |
