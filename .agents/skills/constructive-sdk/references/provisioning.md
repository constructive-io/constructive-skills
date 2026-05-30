# Database Provisioning (End-to-End)

## Client Setup

```typescript
import { createClient as createAuthClient }   from '@constructive-io/sdk/auth';
import { createClient as createPublicClient } from '@constructive-io/sdk/public';

const authDb   = createAuthClient({ endpoint: 'http://auth.localhost:3000/graphql' });
const publicDb = createPublicClient({ endpoint: 'http://api.localhost:3000/graphql' });
```

## Step 1: Sign Up + Sign In

```typescript
await authDb.mutation.signUp({ input: { email, password } }, { select: { result: { select: { id: true } } } }).execute();

const signIn = await authDb.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();
const { accessToken, userId } = signIn.signIn.result;
```

## Step 2: Provision Database

Always use `modules: ['all']` and `bootstrapUser: true`:

```typescript
publicDb.setHeaders({ Authorization: `Bearer ${accessToken}` });

const result = await publicDb.databaseProvisionModule.create({
  data: {
    databaseName: dbName,
    ownerId: userId,
    subdomain: dbName,
    domain: 'localhost',
    modules: ['all'],
    bootstrapUser: true,
  },
  select: { id: true, databaseId: true, databaseName: true, status: true }
}).execute();

const dbId = result.createDatabaseProvisionModule?.databaseProvisionModule?.databaseId;
```

## Step 3: Apply Workarounds

See `workarounds/fix-membership-defaults` and `workarounds/auto-verify-email`.

## Step 4: Per-DB Sign In

```typescript
const dbAuth = createAuthClient({
  endpoint: `http://auth-${dbName}.localhost:3000/graphql`
});
const dbSignIn = await dbAuth.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();
const dbAccessToken = dbSignIn.signIn.result.accessToken;
```

## Step 5: Use Per-DB App API

```typescript
import { createClient } from './generated/<db-name>/sdk/orm';

const db = createClient({
  endpoint: `http://app-public-${dbName}.localhost:3000/graphql`,
  headers: { Authorization: `Bearer ${dbAccessToken}` },
});

await db.notes.create({ data: { content: 'Hello' }, select: { id: true } }).execute();
```

## Module Reference

| Modules | What it installs |
|---|---|
| `['all']` | Everything — always use this for demos and real apps |
| `['uuid_module', 'users_module']` | Minimal — breaks app API auth |
