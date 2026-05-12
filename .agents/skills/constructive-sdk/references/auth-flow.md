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

## Bearer Token

```typescript
const db = createClient({
  endpoint: 'http://api.localhost:3000/graphql',
  headers: { Authorization: `Bearer ${token}` },
});
// or dynamically:
db.setHeaders({ Authorization: `Bearer ${newToken}` });
```
