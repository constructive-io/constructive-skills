# Auth Flow

## Endpoints

| Endpoint | Purpose |
|---|---|
| `http://auth.localhost:3000/graphql` | Main platform auth (sign up, first sign in) |
| `http://auth-<db>.localhost:3000/graphql` | Per-database auth |

## Sign Up (platform-wide)

```typescript
const authDb = createAuthClient({ endpoint: 'http://auth.localhost:3000/graphql' });

await authDb.mutation.signUp(
  { input: { email, password } },
  { select: { ok: true, errors: true } }
).execute();
```

## Sign In (main platform)

```typescript
const result = await authDb.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true, accessTokenExpiresAt: true } } } }
).execute();

const { accessToken, userId } = result.signIn.result;
```

> `accessToken` — NOT `jwtToken`. See `workarounds/known-issues` SDK-002.

## Sign In (per-database)

After provisioning and applying membership defaults fix:

```typescript
const dbAuth = createAuthClient({
  endpoint: `http://auth-${dbName}.localhost:3000/graphql`
});

const dbResult = await dbAuth.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();

const dbToken = dbResult.signIn.result.accessToken;
```

The per-DB JWT carries `database_id` — needed for `bootstrapUser` and RLS-aware operations.

## Bootstrap User

If FK violations on `owner_id` after insert, the user isn't in the per-DB `users_public.users`. Fix:

- **Option A:** `bootstrapUser: true` in provision input (recommended)
- **Option B:** Call manually:

```typescript
await publicDb.mutation.bootstrapUser(
  { input: { targetDatabaseId: dbId, password, isAdmin: true, isOwner: true } },
  { select: { result: { select: { outUserId: true, outIsOwner: true } } } }
).execute();
```

## Device Token Handling

When `devices_module` is installed, sign-in and sign-up accept an optional `deviceToken` and return `outDeviceToken`. The client should persist the device token and send it on every sign-in.

### Sign in with device tracking

```typescript
const result = await authDb.mutation.signIn(
  { input: { email, password, deviceToken: storedDeviceToken } },
  {
    select: {
      result: {
        select: {
          accessToken: true,
          userId: true,
          mfaRequired: true,
          mfaChallengeToken: true,
          deviceApprovalRequired: true,
          outDeviceToken: true,
        }
      }
    }
  }
).execute();

const r = result.signIn.result;

// 1. MFA gate (if require_mfa_new_device is on and device is new)
if (r.mfaRequired) {
  // complete MFA challenge, then retry or call complete_mfa_challenge
}

// 2. Device approval gate (if require_device_approval is on and device is unapproved)
if (r.deviceApprovalRequired) {
  // Show "check your email to approve this device" screen
  // User clicks approval link → calls approve_device
  // User retries sign-in from same device
}

// 3. Success — persist token for future logins
localStorage.setItem('device_token', r.outDeviceToken);
```

### Sign up (first device auto-approved)

```typescript
const result = await authDb.mutation.signUp(
  { input: { email, password, deviceToken: '<new-opaque-token>' } },
  { select: { outDeviceToken: true, accessToken: true } }
).execute();

// First device is auto-approved even when require_device_approval is on
localStorage.setItem('device_token', result.signUp.outDeviceToken);
```

See [`constructive-platform/references/device-settings.md`](../../constructive-platform/references/device-settings.md) for the full composition matrix of device settings.

## Bearer Token

```typescript
const db = createClient({
  endpoint: 'http://api.localhost:3000/graphql',
  headers: { Authorization: `Bearer ${token}` },
});
// or dynamically:
db.setHeaders({ Authorization: `Bearer ${newToken}` });
```
