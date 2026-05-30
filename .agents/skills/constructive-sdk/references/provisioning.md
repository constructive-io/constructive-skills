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

Pass an **explicit module list** and `bootstrapUser: true`. **Never use `modules: ['all']`** — `'all'` is not a sentinel. `databaseProvisionModule` feeds `modules` straight into `metaschema_generators.provision_database_modules`, whose body is ~58 branches of `IF '<module_name>' = ANY(v_modules) THEN ...` with **no `'all'` expansion** anywhere (not in the SQL, the trigger, the SDK, or the CLI). So `['all']` matches nothing, installs zero optional modules, and you get only the ~4 base schemas. The damage is silent: `bootstrapUser` fails with `TARGET_USERS_NOT_FOUND`, per-DB `signIn`/`signUp`/`currentUser` are empty, and every app-public query hits an RLS denial.

For a basic auth app (email/password + app-level RLS, no orgs/SSO/MFA), use the `auth:email` module list — the verified default:

```typescript
publicDb.setHeaders({ Authorization: `Bearer ${accessToken}` });

// auth:email — verified default for a basic auth app.
// Source of truth: constructive/packages/node-type-registry/src/module-presets/auth-email.ts
// (or: getModulePreset('auth:email').modules from @constructive-io/node-type-registry)
const modules = [
  'users_module',
  'membership_types_module',
  'permissions_module:app',
  'limits_module:app',
  'levels_module:app',
  'memberships_module:app',
  'sessions_module',
  'user_state_module',
  'config_secrets_user_module',
  'emails_module',
  'rls_module',
  'user_auth_module',
];

const result = await publicDb.databaseProvisionModule.create({
  data: {
    databaseName: dbName,
    ownerId: userId,
    subdomain: dbName,
    domain: 'localhost',
    modules,
    bootstrapUser: true,
  },
  select: { id: true, databaseId: true, databaseName: true, status: true }
}).execute();

const dbId = result.createDatabaseProvisionModule?.databaseProvisionModule?.databaseId;
```

For a fuller app, swap in the `b2b` module list (orgs/teams/invites/permissions) or `full` (every standard module). Pull the exact array from the matching `module-presets/<preset>.ts` file. See the `constructive-platform` skill's `module-presets.md` for the full catalog.

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

Always pass an explicit module list — the array is what `provision_database_modules` matches against. There is **no `['all']` sentinel**; passing it installs nothing (see Step 2).

| Modules | What it installs |
|---|---|
| `auth:email` list (above) | Verified default — email/password auth + app-level RLS. Use for a basic auth app. |
| `b2b` list | `auth:email` + orgs/teams/invites/fine-grained permissions/levels/profiles/hierarchy. Multi-tenant SaaS. |
| `full` list | Every standard module (`b2b` + storage, billing/plans, notifications, ...). Reference/demo DBs. |
| `['users_module']` only | Minimal — breaks app API auth (no RLS/memberships/auth procedures). |
| `['all']` | **WRONG / anti-pattern** — not a sentinel; matches zero branches, installs nothing, silently breaks auth + RLS. |

Source of truth for every list: `constructive/packages/node-type-registry/src/module-presets/<preset>.ts` (the `ModulePreset.modules` field), or `getModulePreset(name).modules` from `@constructive-io/node-type-registry`.
