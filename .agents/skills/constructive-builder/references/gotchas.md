# Critical Gotchas

Read this file before every phase. It contains only the invariants that repeatedly cause agent failures.

## CODEGEN-001

Never write raw GraphQL strings, schemas, or queries.

Constructive workflow:

1. Provision tables via TypeScript blueprints (`BlueprintDefinition` from `node-type-registry`) using `@constructive-io/sdk` (Phase 2.3).
2. Generate `.graphql` schema files and typed SDK code from the live endpoint via `@constructive-io/graphql-codegen`.
3. Use generated hooks and ORM only.

Do not hand-write `.graphql` files, inline SDL, or raw query strings.

## CODEGEN-002

Never modify generated SDK/ORM code. Files under `src/generated/` are outputs of `@constructive-io/graphql-codegen` and will be overwritten on the next codegen run.

If the generated code is missing functionality:

1. Check the codegen config — `orm: true` and `docs: { skills: true }` should be set.
2. Re-run codegen (`pnpm codegen` in the SDK package).
3. If the issue persists after regeneration, it is a codegen limitation — report it as blocking. Do NOT patch generated files.

Common mistake: adding JWT decoding, entityId inference, or custom wrapper logic directly into generated ORM models or client files. These changes will be lost on regeneration and indicate a misunderstanding of the SDK contract.

## ENTITY-ID-001

Tables provisioned with `AuthzEntityMembership` policy have a required `entity_id` column enforced by RLS. The platform does NOT auto-populate `entity_id` — the client must pass it explicitly on every create.

In Constructive, `user.id` IS the personal organization id. After per-database sign-in, use the `userId` from the sign-in response as the `entityId` for all create mutations:

```typescript
const signIn = await authClient.mutation.signIn(...).execute();
const entityId = signIn.signIn.result.userId;

// Every create on an AuthzEntityMembership table needs entityId
await db.project.create({
  data: { id: uuid(), name: 'My Project', entityId },
  select: { id: true },
}).unwrap();
```

If `entityId` is omitted, the RLS policy evaluates against NULL and the insert silently fails or is rejected.

## APP-BRIEF-001

If `build/app-brief.yaml` is present, all app-specific values must come from it.

That includes:

- database name
- package names
- endpoints
- routes
- data model
- acceptance flows

If the current task provides a different task-specific spec, use that file instead of inventing placeholders.

## BLUEPRINT-001

`schemas/core.ts` (the blueprint) is **GENERATED from the app brief** by `scripts/scaffold-provision.mjs` — it is not a static example to copy. Treat the brief grammar (`references/brief-grammar.md`) + the type catalogs in `skill-supplements.md` as the **structural references**; never hand-copy a table shape, derive it from your brief.

When building a non-benchmark app:

1. Do NOT copy the example and edit table names. Build the `BlueprintDefinition` from scratch using the app brief's `data_model` section.
2. Use `node-type-registry` types for autocomplete and validation.
3. Use the Policy Decision Tree to select the correct `Authz*` policy for each table.
4. Write all nodes, grants, and policies inline in each table definition — do not use shared constants.
5. Relations use `source_table` / `target_table`.

If you copy-edit the example verbatim, you will carry over generic tables into your domain — which is a critical error.

## RLS-POLICY-001

**Default a basic (org-less) app's tables to owner-scoped `AuthzDirectOwner`, NOT `AuthzEntityMembership`.** Picking the policy by tenancy model:

- **`AuthzDirectOwner` (default — each user owns their rows).** `nodes: ['DataId', 'DataDirectOwner', …]`, `use_rls: true`, `policies: [{ $type: 'AuthzDirectOwner', privileges: ['select','insert','update','delete'], permissive: true, data: { entity_field: 'owner_id' } }]`. Compiles to `owner_id = jwt_public.current_user_id()` (USING for s/u/d, WITH CHECK for insert). Proven 1/1/1/1 CRUD e2e. The client sets `ownerId` to the authed user's id on create — WITH CHECK rejects any other value (anti-spoof). Optionally force it server-side with the node `{ $type: 'DataForceCurrentUser', data: { field_name: 'owner_id' } }`.
  - **FK prereq:** `owner_id` FKs to the per-tenant users table, so the authed user must exist in-tenant — sign up via the TENANT endpoint (`auth-<sub>.localhost`), NOT base `auth.localhost`, or the insert FK-violates.
- **`AuthzAllowAll` (app-wide shared pool, no ownership).** `nodes: ['DataId', { $type: 'DataTimestamps', data: { include_id: false } }]`, `use_rls: true`, `policies: [{ $type: 'AuthzAllowAll', privileges: ['select','insert','update','delete'], permissive: true }]`.
- **`AuthzEntityMembership` + `membership_type: 2` (org/b2b tenancy) — ONLY with org modules.** On any app WITHOUT org/b2b/memberships modules (i.e. the `auth:email` preset) this does NOT silently 0-row: it **FAILS HARD** at `constructBlueprint` time with `status: failed, errorDetails: "NOT_FOUND (memberships_module)"` (the org-scoped SPRT does not exist), so the table is **never created**. Only use it when you provisioned the `b2b` module preset.
- **`AuthzAppMembership` (membership_type 1)** *constructs* but then **silently denies all CRUD** (0 rows, no error) until the actor's `app_membership` is approved+active (`is_approved`/`is_active`/`is_verified = TRUE`). If you must use it, add the post-provision approval UPDATE; otherwise prefer `AuthzDirectOwner`.

> `AuthzDirectOwner`'s config key is **`entity_field`** (value = the owner column, e.g. `'owner_id'`), NOT `owner_field` (that belongs to `AuthzMemberOwner` / `AuthzPeerOwnership` / `AuthzRelatedPeerOwnership` / `AuthzOrgHierarchy`). Using `owner_field` triggers `MISSING_REQUIRED_FIELD`.

## RLS-USERS-UPDATE-001

`updateUser` returns **200 but persists 0 rows** (silent no-op) on the dynamically-provisioned per-tenant `users` table when the table's self-UPDATE policy is absent. The policy the platform emits is named `auth_upd_self_update` (verb + policy-name, no hash suffix; the SELECT counterpart is `auth_sel_self_update`); without the UPDATE policy RLS rejects every update. The platform now emits this UPDATE policy natively for an auth preset (PLATFORM-GAPS.md GAP-1a), so this is normally a non-issue; it is documented here because `users` is module-owned and **not expressible in the blueprint**, so a deployment predating the fix needs the control-plane step below.

Fix = a CONTROL-PLANE step (the `provision.ts` template already runs it): AFTER `createDatabaseProvisionModule` + `constructBlueprint`, issue `createSecureTableProvision` on `http://modules.localhost:3000/graphql` with the SAME sudo/admin token used for provisioning:

```graphql
createSecureTableProvision(input: { secureTableProvision: {
  databaseId: <tenant db uuid from the provision result>,
  schemaId:   <id from metaschema_public.schema WHERE database_id=<db> AND name='users_public'>,
  tableId:    <id from metaschema_public.table  WHERE schema_id=<that> AND name='users'>,
  tableName:  "users",
  useRls:     true,
  policies: [{ "$type": "AuthzDirectOwner", "permissive": true, "privileges": ["update"],
               "policy_name": "self_update", "data": { "entity_field": "id" } }]
}})
```

This emits `auth_upd_self_update` (`FOR UPDATE TO authenticated USING id = jwt_public.current_user_id()`) and `updateUser` then persists end-to-end. **Required for any flow that writes the users table** (profile / updateUser / account-settings). (Platform gap, flagged upstream: the per-tenant provisioner should emit this policy itself — the static seed schema has `auth_upd`/`auth_upd_admin_updates`, the dynamic path omits them. The control-plane step is the app-side reconciliation until the platform fixes it.)

## RLS-ORG-RECONCILE-001

**B2B (org) flows need MORE than the basic recipe — the org counterpart to RLS-USERS-UPDATE-001.** Only
applies to the opt-in **b2b tier** (a flow whose `backend.modules` carry the org-scoped
`memberships`/`hierarchy` tuples — `organization` / `org-members` / `org-roles` / `org-invites` /
`app-memberships`). The users self-update step + `app_public` blueprint grants cover `auth:email`, but org
flows write **module-owned** org tables and gate org creation on the `create_entity` app-permission bit
(bit 5 = `0x20`) the basic recipe never sets — so org create / member writes are RLS-denied even with auth
in place. The full 3-step reconciliation (grant `create_entity`; `authenticated` INSERT/UPDATE on the
tenant `users` table; reconcile `org_memberships` INSERT/UPDATE + `org_member_profiles` SELECT, all via
`createSecureTableProvision`) + its `provision.ts` placement lives in **skill-supplements.md → "Org-flow
extension"**; **verify the exact mutations against the `constructive-security` skill** (do not invent a
snippet). This is an app-side workaround for a **platform provisioner gap** — see `platform-gaps.md` (the
durable fix is upstream).

## FIELD-TYPE-001

Text default values in blueprint fields must be wrapped in single quotes inside the JSON double quotes, because the `defaultValue` is a raw SQL expression:

```json
{ "name": "status", "type": "text", "defaultValue": "'pending'" }
```

Common mistakes:

- `"defaultValue": "pending"` — missing single quotes; PostgreSQL interprets `pending` as a column name and provisioning fails.
- `"defaultValue": "'true'"` for a boolean field — use `"defaultValue": "true"` (no single quotes) for `boolean` type.
- `"defaultValue": "'0'"` for an integer field — use `"defaultValue": "0"` (no single quotes) for `integer` type.

Rule: single-quote wrappers are only needed for `text` type defaults. Numeric, boolean, and function defaults (`now()`, `uuid_generate_v4()`) are bare SQL.

## SQL-001

Do not use ad hoc SQL to inspect, provision, or reverse-engineer the Constructive platform.

Allowed SQL is limited to:

- `auto-verify-email`
- `fix-membership-defaults`
- bounded verification queries already defined in the repo scripts

If the SDK surface does not match the live platform, use a documented compatibility shim if one exists. Do not replace Phase 2.2 with a direct SQL provisioning path.

## PLATFORM-001

Phase 1 is only complete when the local `constructive` database already contains the Constructive system baseline.

Minimum baseline:

- `metaschema_public.database` exists
- `http://auth.localhost:3000/graphql` passes GraphQL `POST` verification
- `http://api.localhost:3000/graphql` passes GraphQL `POST` verification

Phase 2.2 assumes that baseline and uses the live platform plus SDK as the source of truth. If the baseline is missing or those endpoints do not behave like Constructive GraphQL endpoints, stop and repair the local platform instead of probing with SQL.

## SERVER-001

`cnc server` is a background process that can die at any time (crash, OOM, shell exit). **Before starting any phase that calls the platform** (2.2, 2.3, 2.4, 2.5), verify the server is still healthy:

```bash
STATUS="$(curl -s -o /dev/null -w "%{http_code}" http://api.localhost:3000/graphql 2>/dev/null || echo "000")"
if [ "$STATUS" != "405" ]; then
  echo "cnc server is down (got HTTP $STATUS). Restarting..."
  lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1
  nohup bash -c 'eval "$(pgpm env)" && PGDATABASE=constructive cnc server --port=3000 --origin "*"' > /tmp/cnc-server.log 2>&1 &
  for i in $(seq 1 30); do
    S="$(curl -s -o /dev/null -w "%{http_code}" http://api.localhost:3000/graphql 2>/dev/null || echo "000")"
    [ "$S" = "405" ] && break
    sleep 1
  done
fi
```

The agent **can and should** restart the server itself. Do not ask the user to restart it. The server runs from any directory — it only needs `PGDATABASE=constructive`, `pgpm env` for Postgres connection variables, and `--origin "*"` to avoid an interactive CORS prompt.

If the server starts but GraphQL `POST` verification still fails, common causes are:

1. `cnc` is outdated — run `npm i -g @constructive-io/cli@latest`
2. another `cnc server` on a different port is conflicting with connection pools — kill it with `lsof -ti :5555 | xargs kill -9`
3. `/tmp/cnc-server.log` contains PostGraphile or pg-cache errors

## SDK-001

> Applies to post-provision app code (not the provisioning scripts themselves).

`findOne` is id-based, not `where`-based.

```ts
db.table.findOne({ id, select })
```

## SDK-002

> Applies to post-provision app code (not the provisioning scripts themselves).

`signIn` returns `accessToken`, not `jwtToken`.

## SDK-003

Per-database PostGraphile APIs expose plural connection queries only. Query the plural field and filter with `condition`.

## SDK-004

> The `provision.ts` template handles granteeName/roleName compatibility via `@constructive-io/sdk`. Refer to the SDK-004 history if you encounter issues in post-provision app code.

## SDK-005

> The `provision.ts` template handles UUID generation via `@constructive-io/sdk`.

Some live app schemas require explicit UUID `id` values on create mutations even when the generated TypeScript input types omit them.

If create mutations fail with an error like:

- `Field "id" of required type "UUID!" was not provided`

do not switch to raw GraphQL.

Use a narrow compatibility shim:

- generate a UUID client-side
- pass it through the generated SDK or hook create call
- if the generated TypeScript type rejects the extra `id` field, use a small local wrapper function that encapsulates the type narrowing — do not use `as any` in component code

This keeps the run on the generated SDK path while acknowledging schema/codegen drift.

## SDK-006

If `secureTableProvision` fails with `UNKNOWN_POLICY_TYPE`:

1. The policy type string does not exist on the live platform. This is a config error, not a platform bug.
2. Read the `constructive-security` skill for the full list of valid Authz* policy types (14 leaf types).
3. Read the `constructive-db-data-modules` skill for the Data* → Authz* pairing table.
4. Replace the invalid policy type with the correct pairing.

Common case: `DataOwnershipInEntity` uses `AuthzEntityMembership` (with `entity_field: 'entity_id'`, `membership_type: 2`) and/or `AuthzDirectOwner` (with `entity_field: 'owner_id'`). There is no `AuthzOwnershipInEntity` type.

Do not stop. Do not switch to SQL. The fix is always a different valid policy type from the safegres skill.

## SDK-007

`revokeSession` returns `SESSION_NOT_FOUND` when you pass the id from a `signUp`/`signIn` result. That id is a **UUIDv5 identity/credential id**, NOT the `sessions` row id (a **UUIDv7**), and no field on the auth result exposes the real session id — so `revokeSession` is effectively **uncallable from the auth result alone**. Treat sessions-revoke as a known platform/SDK gap (auth result shape). Document it and move on — do not fight it, do not hand-craft a session id, and do not switch to SQL.

## SDK-008

**The template's `app` SDK snapshots headers at MODULE LOAD — so it runs ANONYMOUS after login, and a
200-but-0-rows on YOUR OWN `app_public` table is almost always THIS, not an RLS gap.** The template's
`AppProvider` calls `configureApp()` at **module load** (before any login), and the generated
`FetchAdapter` **snapshots the headers at construction**. So the `app` namespace never carries the
post-login `Authorization: Bearer` — every `@sdk/app` CRUD op runs as the anonymous role and hits
`permission denied for table <t>`, which the API returns as **HTTP 200 with 0 rows**. This is
**indistinguishable from an RLS/grant gap** and burns cycles re-checking policies that are actually fine.

`BlocksRuntime` avoids this for `auth`/`admin` because it attaches the token **per request** via a
host-supplied `getToken` (`TokenManager.getToken('admin').token?.accessToken`). The template's `app`
namespace has **no equivalent**, and the Blocks on-ramp's Step 5a removes `configureAuth`/`configureAdmin`
while **leaving `configureApp` intact** — so the stale-anonymous `app` adapter survives the on-ramp
untouched.

**Fix (one of two):**

1. **Re-configure `app` after login with the live token** — call `configureApp({ adapter: createSdkAdapter('app') })` again *after* sign-in completes (in the auth-success callback / a session effect), so the adapter is rebuilt with the post-login `Authorization` header; **or**
2. **Wire the `app` namespace to read the token per request** — give its adapter the **same per-request seam** `BlocksRuntime` uses for auth/admin (`() => TokenManager.getToken(...).token?.accessToken`), so each request picks up the current token and never goes stale across login/refresh/logout.

> 🚨 **Before suspecting RLS on a 200-but-0-rows from your own `app_public` table, CHECK THE REQUEST'S
> `Authorization` HEADER.** If it is missing/anonymous, this is the stale-anonymous-header bug (re-configure
> `app` post-login or wire it per-request) — **not** an RLS policy gap. Only chase RLS once you have
> confirmed the request actually carried the user's bearer token. See `references/blocks-onramp.md` Step 5a
> and SKILL.md S5.

## HOOKS-001

Generated React Query hook mutations follow PostGraphile conventions:

1. All `.mutate()` calls take an object, never a bare value. `deleteProject.mutate({ id })`, not `deleteProject.mutate(id)`.
2. Update mutations use a table-prefixed patch field: `<tableName>Patch`, not `patch`. Example: `updateProject.mutate({ id, projectPatch: { name: 'New Name' } })`.
3. Delete mutations take `{ id }`. Example: `deleteProject.mutate({ id })`.

If unsure about the exact shape, read the generated SDK docs:

- `sdk/sdk/src/generated/orm/AGENTS.md` — best single-file ORM reference
- `sdk/sdk/src/generated/hooks/README.md` — best hooks reference
- Per-table cheat sheets: `skills/orm-default/references/<table>.md` and `skills/hooks-default/references/<table>.md`

The ORM (`db.project.update(...)`) uses a different Prisma-like interface with `data`/`where` keys. Do not conflate hook variables with ORM arguments.

## FRONTEND-001

When building a Next.js frontend from the Constructive sandbox template:

- preserve the template's root provider stack (`AppProvider`, `RouteGuard`, `AuthenticatedShell`)
- preserve the template's app shell and auth routes; add app-specific routes alongside them
- run the template's `pnpm codegen`
- register new app routes in the template route configuration
- configure app-specific generated SDK clients in shared integration code before hooks render
- do not call `configure()` for a generated SDK inside a route-local `useEffect`
- app-specific routes must load after auth without runtime page errors

If the current task defines UI selectors or `data-testid` hooks, implement them where practical. They enable optional browser verification but are not required for the SDK/API acceptance gate.

## FRONTEND-002

The Constructive sandbox template only manages platform (`schema-builder`) auth out of the box.

That means:

- the boilerplate token from `NEXT_PUBLIC_SCHEMA_BUILDER_GRAPHQL_ENDPOINT` does not authenticate requests to the per-database data endpoint `api-<sub>`
- per-database `auth-<sub>` and `api-<sub>` (data) endpoints need their own shared app-session integration
- a browser signup/login flow is incomplete unless it also establishes the app-specific session needed by the app data CRUD route

> The per-database data endpoint is `api-<sub>`, **not** `app-public-<sub>` (that host is dead). Routing is by `Host` header — see SUBDOMAIN-001. The still-true lesson here is about **authentication, not the host name**: even with the right `api-<sub>` host, a platform/`schema-builder` token does not authenticate per-database data calls. You must establish a separate per-database app session via `auth-<sub>` and send *that* token.

If the frontend uses both:

- `NEXT_PUBLIC_AUTH_ENDPOINT`
- `NEXT_PUBLIC_GRAPHQL_ENDPOINT`

then implement a shared app-auth bridge:

- signup/login must also sign up/sign in against `auth-<sub>`
- logout must clear the app-specific token too
- app CRUD must use a shared client or adapter that sends the app-specific token to `api-<sub>`
- do not configure the app-specific generated SDK in a page-local `useEffect`
- do not assume the boilerplate's `TokenManager`, `AuthProvider`, or `schema-builder` context automatically cover the per-database app endpoint

## THRASH-001

If a verification step fails:

1. Read the EXACT error message.
2. Identify the ROOT CAUSE (not a symptom).
3. Fix the root cause with ONE targeted change.
4. Re-run verification ONCE.

Do NOT:

- Retry the same failing command without changing anything.
- Send SIGUSR2 to any process (restart it with SERVER-001 instead).
- ALTER TABLE to add column defaults (fix provision config instead).
- Regenerate SDK if the fix was in CLI code (regeneration clobbers manual fixes).
- Exceed the retry budget. **The limit is 3 retries for the same issue** (one initial attempt + up to 3
  fix retries), matching `self-improvement.md` "Retry Limits" ("Maximum 3 retries"). After the 3rd failed
  retry, STOP and report the exact error. Each retry must be a *different, root-cause* change — re-running
  an unchanged command does not count as progress and is forbidden.

> **Single source of truth for the retry limit:** `self-improvement.md` → "Retry Limits" (max 3 retries
> for the same issue). This THRASH-001 rule and that section describe the **same** budget in the **same
> unit** (retries, not attempts); do not treat them as two separate allowances.

One restart per phase maximum. If the server needs restarting, use SERVER-001 exactly once and continue.

## MISSING-001

If a template or file referenced by a phase doc does not exist:

1. Verify `git submodule update --init` was run (templates may be missing).
2. If the file still does not exist after submodule init, STOP.
3. Report the exact missing path as a blocking issue.

Do NOT:

- Search GitHub or external repos for the missing file.
- Read random skills looking for a replacement.
- Improvise a hand-written version from scratch.
- Use WebFetch or WebSearch to find the file online.

The templates in this repository are the only authoritative source. If they are missing, the setup is incomplete.

## TS-001

ABSOLUTE PROHIBITION: `as any`, `as unknown as T`, `// @ts-ignore`, and `// @ts-expect-error` are FORBIDDEN in all agent-written code. There are ZERO exceptions for app code.

If you write `as any` anywhere outside of `templates/`, the build is a FAILURE regardless of whether it compiles.

**Note:** Use `@constructive-io/sdk` for all SDK access. It supports both Node.js and browser environments with clean subpath exports (`auth`, `public_`). If you find yourself needing `// @ts-ignore` for SDK imports, re-check your imports and package version.

If TypeScript types do not match in app code:

1. Re-run codegen (stale types) — ONCE.
2. Check if the provision script has a bug — fix the script, not app code.
3. Use a narrow local wrapper function that encapsulates the type issue.
4. If none of the above work, report as blocking issue — do NOT mask with casts.

This is not a style preference. `as any` defeats the type safety that Constructive's generated SDK provides. Any occurrence of `as any` in agent code means the agent bypassed the SDK contract, which is a critical failure.

## TS-002

Generated query fields are typed `T | null | undefined`. Use nullish coalescing for defaults:

```typescript
const name = project?.name ?? '';
const count = project?.taskCount ?? 0;
const items = data?.allProjects?.nodes ?? [];
```

Do not use `as string` or `as any` to strip nullability — that violates TS-001.

## PROVISION-001

**Never provision with `modules: ['all']`. Pass an explicit list of module names.**

`modules: ['all']` is the single most damaging mistake in the whole flow, because it fails *silently*. `databaseProvisionModule` feeds `modules` straight into `metaschema_generators.provision_database_modules(v_modules => ...)`. The proc parses each array element (a plain string `"users_module"`, or a tuple `["memberships_module", {"scope": "app"}]`) into a `{name, options}` entry, then installs each module with a `IF 'users_module' = ANY(v_module_names) THEN ...` (unscoped) or a jsonb-containment `IF v_module_entries @> '[{"name":"memberships_module","options":{"scope":"app"}}]' THEN ...` (scoped) branch. There is **no `'all'` sentinel** — not in the SQL proc, not in the BEFORE-INSERT trigger, not in the SDK, not in the CLI. So `['all']` matches *zero* branches and installs **zero optional modules**. You get only the ~4 base schemas. Then:

- `bootstrapUser: true` fails with `TARGET_USERS_NOT_FOUND` (no `users_module`).
- Per-DB auth is empty — `signIn` / `signUp` / `currentUser` against `auth-<db>.localhost` return nothing.
- Every app-public query hits an RLS denial because no `rls_module` / `memberships_module` rows exist to authorize the caller.

The fix is an explicit module list — **and the authority for which modules is `references/flows.json`, not a number you carry in your head.** Pick the flow(s) the app needs (Step 4.0 of `references/blocks-onramp.md`) and provision exactly that flow's `backend.modules`. `flows.json` is generated from the module presets and is **machine-checked** by the bundled `scripts/check-flows.mjs` (`node scripts/check-flows.mjs`), so the module list a flow declares is guaranteed to be the real, resolvable preset — this closes the same silent-drift class as the `['all']` bug itself (a hand-maintained list rots; a generated, checked one cannot).

Read the list straight off the chosen flow instead of retyping it:

```bash
# The exact modules to provision for a flow (here: the basic email+password app):
node -e 'const f=require("./references/flows.json");const fl=f.flows.find(x=>x.id==="email-password");console.log(fl.backend.preset);console.log(JSON.stringify(fl.backend.modules,null,2))'
```

For a **basic auth app** (email + password sign-up/sign-in, app-level RLS — no orgs/SSO/MFA) the `email-password` flow rides the `auth:email` preset. The concrete list below is what templates embed where reading a file at provision time is impractical — **but its authority is `flows.json` (the `email-password` flow's `backend.modules`), and `check-flows` is what keeps it honest.** Keep it byte-for-byte in sync with `flows.json`; if you change one, regenerate and re-check the other.

> **Scoped modules are TUPLES, not colon strings.** The proc takes `["name", { "scope": ".." }]` tuples for scope-aware modules — a `name:scope` colon string (e.g. `'memberships_module:app'`) is read as a bare module name and throws `NOT_FOUND (memberships_module)`, installing the scoped module *not at all*. `flows.json` already carries these as native tuples; pass them verbatim.

```typescript
// auth:email — the verified default for a basic auth app.
// AUTHORITY: references/flows.json → flows[id="email-password"].backend.modules
//   (the bundled, generated catalog; machine-checked by `node scripts/check-flows.mjs`).
//   Do not edit this list by hand without regenerating flows.json — check-flows will flag the drift.
// Scoped entries are ['name', { scope }] tuples — colon strings ('name:scope')
// throw NOT_FOUND in the provision proc.
const MODULES_AUTH_EMAIL = [
  'users_module',
  'membership_types_module',
  ['permissions_module', { scope: 'app' }],
  ['limits_module', { scope: 'app' }],
  ['levels_module', { scope: 'app' }],
  ['memberships_module', { scope: 'app' }],
  'sessions_module',
  'user_state_module',
  'user_credentials_module',
  'config_secrets_module',
  'emails_module',
  'rls_module',
  'user_auth_module'
];
```

Re-provisioning with this exact list yields 18 schemas with working `signIn` / `signUp` / `currentUser` and a live RLS-governed `createNote` / query — versus the broken ~4-schema result from `['all']`.

For a **fuller app**, provision the richer flow's module list — again read from `flows.json`, not invented:

- Any `social-oauth` / `connected-accounts` flow → `auth:sso` (adds `connected_accounts_module` + `identity_providers_module`).
- Any `org-*` flow (`organization`, `org-members`, `org-roles`, `org-invites`, `app-memberships`) → `b2b` (org-scoped memberships, invites, fine-grained permissions, levels, profiles, hierarchy, rate limits, SSO, passkeys, SMS). There is **no preset smaller than `b2b`** for org flows. Use when the app has workspaces / teams / tenants.
- `full` — installs every standard module (everything in `b2b` plus storage, billing/plans, notifications, crypto addresses, events). Use for reference/demo DBs and open-ended greenfield apps. (Not flow-keyed; pull from the preset directly.)

The flow's `backend.modules` IS the exact set to pass to `databaseProvisionModule`; `backend.preset` is only the smallest covering shipped preset (advisory). If you need a preset not represented by a flow, resolve its `modules` array at runtime via `getModulePreset('<preset>').modules` from `@constructive-io/node-type-registry` (the `ModulePreset.modules` field) — but for anything a flow covers, prefer the bundled `flows.json` so `check-flows` guards it. Presets are metadata only — what actually installs the modules is passing that flat `string[]` to `databaseProvisionModule`. Order does not matter; provisioning resolves dependencies.

## NAMING-001

Never name an app table `users`. Every auth preset provisions a built-in `users` table (`users_module`).

## BLOCKS-001

**Blocks read `_GRAPHQL_`-named env vars, not the template's endpoint vars.** `blocks-runtime.tsx` reads
`process.env.NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT` and `process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT`
(literal references so Next can inline them). The sandbox template instead uses `NEXT_PUBLIC_AUTH_ENDPOINT`
/ `NEXT_PUBLIC_ADMIN_ENDPOINT` (or derives everything from `NEXT_PUBLIC_DB_NAME`). These are **different
names**. If you set only the template names, every block request no-ops and the console logs
`Missing NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT`. In `.env.local`, set the `_GRAPHQL_` names too (additive — keep
`NEXT_PUBLIC_DB_NAME`). See `references/blocks-onramp.md` Step 3.

## BLOCKS-002

**One `configure()` per namespace — resolve the AppProvider × BlocksRuntime collision.** The template's
`AppProvider` (`src/components/app-provider.tsx`) calls `configureAuth` + `configureAdmin` + `configureApp`
at module load. `BlocksRuntime` **also** configures `auth` + `admin`. Two configurers for the same
namespace is last-writer-wins: block requests can silently go through the template's adapter (no
`Authorization: Bearer`), so authenticated block calls fail. Fix: remove `configureAuth` and
`configureAdmin` from `AppProvider`, **keep `configureApp`**; let `BlocksRuntime` own `auth` + `admin`. See
`references/blocks-onramp.md` Step 5a.

## BLOCKS-003

**`@simplewebauthn/browser` is a host dependency, not a block registry dependency.** Passkey blocks
(`passkey-sign-in`, `passkey-enroll`) dynamic-import `@simplewebauthn/browser`, but it is **not** listed in
any block's registry `dependencies` — so `shadcn add` will not install it. If you install a passkey block
without adding it, the dynamic import fails at runtime. Run `pnpm add @simplewebauthn/browser` in the app
(Step 2). (Confirmed: the dashboard blocks app declares `@simplewebauthn/browser` as a top-level dep.)

## BLOCKS-004

**The Tailwind v4 `@source` trap — modals render unstyled without it.** `@constructive-io/ui/globals.css`
declares its own `@source "../components"`, but Tailwind v4 resolves an `@source` inside an `@import`-ed
sheet **relative to that sheet**, not your entry CSS — so the UI components are never scanned from your
app. The utilities that live *only* inside UI components (Dialog/DropdownMenu/Popover centering, backdrops,
enter/leave animations) are then never generated, and every block modal/menu renders unstyled (popup not
centered, no backdrop) **even though the build passes**. Fix: in `globals.css`, add a `@source` pointing at
the **installed** UI component source (e.g. `@source "../../node_modules/@constructive-io/ui/dist";` from
`src/app/`). The exact path depends on pnpm hoisting — **verify it resolves to a real directory** before
trusting it. See `references/blocks-onramp.md` Step 2b.

## BLOCKS-005

**Use the LIVE published `@constructive` registry (GitHub Pages); local serve is the fallback only.** The
published shadcn registry (`https://constructive-io.github.io/dashboard/r/<name>.json`, declared in the
template's `components.json` → `registries.@constructive`) is **live** — `apps/blocks` is merged to
`dashboard` main (PR #232) and CI deploys the built registry (UI primitives **and** the auth/account/org
**flow** blocks) to Pages. The working path:

1. **Verify the published registry resolves** a flow block (no build, no server):
   `curl -sf https://constructive-io.github.io/dashboard/r/auth-sign-in-card.json >/dev/null && echo OK`.
2. **Point** `packages/app/components.json` → `registries.@constructive` at the published URL
   `https://constructive-io.github.io/dashboard/r/{name}.json` (the scaffold default).
3. `cd packages/app && npx shadcn@latest add @constructive/<block>` — transitive deps
   (`blocks-runtime`, `cn`, UI primitives) resolve against the same published registry.

A raw local-file install does NOT work (`npx shadcn add /abs/path/.../<block>.json` 404s on the transitive
`@constructive/*` deps) — always install by NAME against a registry URL.

**Fallback (off-network, or pinning an as-yet-unpublished block):** serve the registry locally on the
canonical port 4081 with `scripts/serve-registry.sh 4081` (bundled in this skill's `scripts/`; it resolves
the registry SOURCE from `constructive.config.json` — default `sibling`, or a PATH / git source — so it
works without a co-located checkout), repoint `components.json` → `http://localhost:4081/r/{name}.json`,
`add`, then `scripts/stop-registry.sh`. This is a config/availability case, **not** MISSING-001 — do not
improvise block source. See `references/blocks-onramp.md` Step 4.

## BLOCKS-006

**`StepUpProvider` is a required root provider for account/MFA/passkey blocks.** Blocks that perform a
step-up (re-auth) — connected-accounts, danger-zone, TOTP-disable, backup-codes-regenerate, org settings,
etc. — call `useStepUp()`, which **throws** (`useStepUp() must be called inside <StepUpProvider>`) if
`<StepUpProvider>` is not mounted at the app root. Mount it inside `BlocksRuntime` (Step 5b). If you install
only the sign-in card you may not hit this, but install it as soon as any account/MFA block is added.

## BLOCKS-007

**The `cn` registry dep writes a NEW `src/lib/utils.ts` file that SILENTLY SHADOWS the template's
`src/lib/utils/` directory — delete the stray file, do not "overwrite".** The sandbox template does **not**
ship a single `src/lib/utils.ts`; it ships a **`src/lib/utils/` directory** whose barrel
(`src/lib/utils/index.ts`) re-exports `common.utils` (which exports `cn`, `clamp`, …) and `file.utils`
(`getImageUrl`, …). (The directory also contains `use-controllable-state.ts`, available by subpath.)
**57 files import `@/lib/utils`** and rely on that barrel's full surface. The `cn` registry item, however,
writes a sibling **file** `src/lib/utils.ts` (its registry file resolves to `@/lib/utils`). Because the
template's `tsconfig.json` maps `@/*` → `./src/*`, TS/Node resolves `@/lib/utils` to **`src/lib/utils.ts`
(the file) before `src/lib/utils/index.ts` (the directory index)** — file wins over dir-index. So the
freshly-written `cn` file **silently shadows the whole barrel**, dropping `file.utils` (and any
`common.utils` export beyond `cn`, e.g. `clamp`) from `@/lib/utils` and breaking those 57 importers
app-wide.

**There is no overwrite prompt** — the new file and the directory's files are *different paths*, so `shadcn
add` writes `src/lib/utils.ts` additively without ever asking. The shadow is silent; the build may even
still pass for blocks while the rest of the app loses exports. **Remediation: delete the stray file** —
`rm src/lib/utils.ts` — to un-shadow the template's `src/lib/utils/` directory (the directory and its files
are git-tracked; the stray `src/lib/utils.ts` is **not** tracked, so `git checkout -- src/lib/utils.ts`
does nothing here). The template's `cn` is compatible, so no block loses functionality. After deleting,
confirm `@/lib/utils` again resolves to the barrel and still exports everything its 57 importers use. See
`references/blocks-onramp.md` Step 4d.

## BLOCKS-008

**Add a `graphql` pnpm override pinned to ONE version — `@constructive-io/ui` drags graphile deps that
split `graphql`.** Installing `@constructive-io/ui` pulls transitive graphile/postgraphile packages that
depend on `graphql`; they can resolve to a **different `graphql` version** than the template's generated
SDK, putting two copies of `graphql` in the tree. That throws the classic *"Cannot use GraphQLObjectType
… from another module or realm"* (dual-`graphql`) error. Prevent it with a workspace pnpm override pinned
to a single version, e.g. in the workspace root `package.json`:
`{"pnpm":{"overrides":{"graphql":"^16.9.0"}}}` (match whatever the template's SDK already uses), then
re-run `pnpm install`. Verify with `pnpm why graphql` → exactly one resolved copy. If the template
already declares a `graphql` override, reuse that exact version. See `references/blocks-onramp.md`
Step 2a-pre.

## BLOCKS-009

**Mount `<BlocksRuntime>` via a `'use client'` wrapper — never directly in the server `layout.tsx`.**
`BlocksRuntime` is a Client Component that takes a **function** prop (`getToken`). The sandbox template's
`src/app/layout.tsx` is a Server Component, and passing `getToken={() => …}` from a server file triggers
the Next build error *"Functions cannot be passed directly to Client Components … mark it with 'use
client'"* (`getToken={function getToken}`). Fix: create a small `'use client'` `BlocksProviders` wrapper
that mounts `BlocksRuntime` + `StepUpProvider` and owns the `getToken` closure, then import that wrapper
into `layout.tsx` (only a component crosses the boundary, not a function). See
`references/blocks-onramp.md` Step 5b.

## BLOCKS-010

**Registry block names are PREFIXED — discover real names before `add`; guessing 404s.** There is no
`auth-sign-out` (it is **`auth-sign-out-button`**), no `account-profile` (it is
**`auth-account-profile-card`**), etc. A wrong name produces a 404/"not found" that looks like a registry
outage but is just a bad name. **`flows.json` is the authoritative answer to "which blocks?"** — each
flow's `blocks` array is the exact prefixed install set (e.g. `org-create-card`, `org-members-list`,
`org-roles-editor`, `org-settings-form` for the org flows). To confirm a name resolves, curl the published
registry index (`https://constructive-io.github.io/dashboard/r/index.json`) — or, on the fallback local
serve, `ls .registry-cache/r/*.json` — and match it (see BLOCKS-005 for the registry source). See
`references/blocks-onramp.md` Step 4a.

## BLOCKS-011

**The `@/generated/auth` alias must point at a NON-EMPTY SDK that exports `useSignInMutation` — `test -d`
is not enough.** The real failure mode is a per-DB `auth-<subdomain>` endpoint that is **schema-empty**
(no auth procedures wired): codegen still writes `src/graphql/sdk/auth/`, so the directory exists and
`test -d` passes, but it emits **no `useSignInMutation`** and every auth block no-ops. Verify the
*content*: both `src/graphql/sdk/{auth,admin}` must be non-empty AND
`grep -rq 'useSignInMutation' src/graphql/sdk/auth` must succeed. **Fallback if it is schema-empty:**
confirm the endpoint really lacks `signIn` (introspect it), and if so fix the backend provisioning
(Phase 1/2) — do **not** hand-write hooks (CODEGEN-001). If a schema-bearing auth endpoint exists for the
DB, point the template's codegen config at it and re-run `pnpm codegen` to regenerate
`src/graphql/sdk/auth` **in place** (never a second SDK under `src/generated`). A schema-empty auth SDK
passes `check-sdk.mjs`'s directory check but fails its `signIn → useSignInMutation` manifest assertion.
See `references/blocks-onramp.md` Step 1.

## BLOCKS-012

**`references/flows.json`'s `howto.wire` snippets use `tokenManager.getAccessToken()` — that method does
NOT exist on the template's `TokenManager`.** The template ships a **static** `TokenManager` (no
`tokenManager` instance, no `getAccessToken()`). The correct `getToken` for `<BlocksRuntime>` is:
`getToken={() => TokenManager.getToken('admin').token?.accessToken}` (the same seam Step 5b uses) — NOT
`tokenManager.getAccessToken()`. The `flows.json` `wire` strings are illustrative and come from the catalog
generator (a separate SoT — do not edit the generated `flows.json` here); when you wire a flow, use the
`TokenManager.getToken(...).token?.accessToken` form from `references/blocks-onramp.md` Step 5b, not the
flows.json snippet verbatim.

## Provisioning Workarounds (SQL Access Required)

Apply both workarounds after every provision run (`pnpm run provision`). These require a direct PostgreSQL connection — if the agent only has GraphQL API access, skip these.

### auto-verify-email

Email verification defaults to `false`, which blocks sign-in. Set `emails.is_verified` default to `true` and backfill existing rows. (Same **dash-collapse trap** as `fix-membership-defaults` below: rewrite each `_` in the db name to `%` — `LIKE '%my%app%a%'` — or the match no-ops on a shared hub.)

```sql
-- Find the user-identifiers schema for your database (rewrite _ -> % in <db-name>)
SELECT schema_name FROM information_schema.schemata
WHERE schema_name LIKE '%user-identifiers-public'
      AND schema_name LIKE '%<db-name-with-_-as-%>%'
ORDER BY schema_name DESC LIMIT 1;

-- Then run (replace <schema> with the result above):
ALTER TABLE "<schema>".emails ALTER COLUMN is_verified SET DEFAULT true;
UPDATE "<schema>".emails SET is_verified = true WHERE is_verified = false;
```

Replace `<db-name>` with your database name and `<schema>` with the schema found by the first query.

### fix-membership-defaults

Membership defaults can block per-database sign-in. Update `app_membership_defaults` so `is_approved = TRUE` and `is_verified = TRUE`.

```sql
-- Find the memberships schema for your database
SELECT schema_name FROM information_schema.schemata
WHERE (schema_name LIKE '%memberships-public' OR schema_name LIKE '%memberships_public')
      AND schema_name LIKE '%<db-name>%'
ORDER BY schema_name DESC LIMIT 1;

-- Then run (replace <schema> with the result above):
UPDATE "<schema>".app_membership_defaults SET is_approved = TRUE, is_verified = TRUE;
```

Replace `<db-name>` with your database name and `<schema>` with the schema found by the first query.

> 🚨 **Dash-collapse trap (the `LIKE '%<db-name>%'` above no-ops on a shared hub).** Per-DB schema names
> are NOT the underscore db name — they are dash-collapsed (db `my_app_a` → `my-appa-<hash>-…`). A literal
> `LIKE '%my_app_a%'` matches ZERO rows (and `_` is itself a SQL single-char wildcard). **Turn each `_`
> into a `%`** for a collapse-tolerant match.
>
> 🚨 **But ANCHOR it — a FLOATING `'%my%app%a%'` causes CROSS-TENANT BLEED.** A leading-`%` pattern whose
> db name is a substring of another schema family matches SIBLING tenants too (e.g. a db containing
> `members` floats into another tenant's `…memberships-public`, since 'memberships' contains 'members') —
> during a concurrent run you'd approve the WRONG tenant. Anchor the db-name portion at the **start**
> (`LIKE 'my%app%a%…'`, no leading `%`) and pin a unique suffix, OR resolve the exact tenant schema prefix
> from `pg_namespace` and match `LIKE '<sub>-<hash>-%'`. The `provision.ts` template now does exactly this
> (anchors on the captured `<sub>+<hash>`, not a floating `%…%`); use the same anchored approach if you run
> it by hand — never a bare `LIKE '%<db-name>%'`.

> **Tip:** The `provision.ts` template file (`scripts/templates/provision/provision.ts`, which `scaffold-provision.mjs` stamps) already includes both workarounds in its post-provisioning auth appendix (membership defaults + email-verify + users self-update).

### authenticated grants + RLS for per-DB CRUD (F3 — grant half)

**The `authenticated` GRANT is toolkit-teachable, NOT a platform escalation.** A correctly-shaped
`secureTableProvision` (or the equivalent blueprint table definition) that carries
`grants: [{ roles: ['authenticated'], privileges: [['select','*'],['insert','*'],['update','*'],['delete','*']] }]`
applies all four GRANTs to `authenticated` **and** creates the role-scoped RLS policies server-side —
with **no manual `psql` GRANT**. Authenticated per-DB CRUD then round-trips end-to-end. So you get the
grants for free as long as the provision shape includes `grants[]` (the [[privilege, columns]] tuple
form) — see [`constructive-security` → SKILL.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-security) (`secureTableProvision`). This is the canonical grant path; do **not** hand-write a `GRANT … TO authenticated` and do **not** rely on a separate `constructBlueprint`-only grant step.

The grant is one of **two** independent requirements for working per-DB writes — keep them separate:

1. **Grant** — guaranteed by including `grants[{ roles: ['authenticated'], … }]` in the provision/blueprint shape (above). Toolkit-teachable.
2. **Membership approval** — the new per-DB signup user must be approved/verified, or RLS denies writes even though the grants are present. This is the `fix-membership-defaults` SQL workaround (above; set `app_membership_defaults.is_approved = TRUE, is_verified = TRUE`). Only the *membership-defaulting-to-unapproved* behavior is a platform-side root cause; the durable fix lands in the platform.

**Verify both landed:** as a signed-in `authenticated` user, insert a row AND read it back. A `permission denied` means the grant did not land (check `grants[]` is in the provision shape); a 2xx that returns no row means the membership is not approved (run `fix-membership-defaults`).

## PROVISION-RERUN-001

**Re-running `pnpm run provision` against an already-provisioned DB is SAFE and IDEMPOTENT for ADDITIVE
changes — this is the foundation of the day-2 evolve workflow (`references/day2-evolve.md`).** The earlier
guidance here ("do NOT re-run / drop-and-rebuild because `constructBlueprint` aborts on the first duplicate
`CREATE POLICY`") was **adversarially DISPROVEN on the live hub (2026-06-18)** and has been removed.

**Verified truth:** a re-run of provision against an already-provisioned DB returns **exit 0**, does **NOT**
duplicate policies (verified `4 → 4` identical policy names on an owner-scoped table — the emission is
guarded, not a bare `CREATE POLICY`), and **preserves every row** (`12 → 12`). Add-column, add-table, and
add-required-FK all land **clean, skill-only** on a re-run and re-sync to the UI via `pnpm codegen` + the
runtime-generic `DynamicFormCard` (NOT bespoke page code, which is never regenerated). So the day-2 loop is:
**edit the brief → `scaffold-provision` → `pnpm run provision` (idempotent) → `pnpm codegen` →
`scaffold-frontend` → verify** — no drop-and-rebuild. See `references/day2-evolve.md` for the full workflow.

**The ONE real caveat — NOT idempotency:** adding a **`NOT NULL` (required) column to a table that already
holds rows** aborts atomically with `column "<col>" of relation "<t>" contains null values`, because the
platform sequences the day-2 DDL as `ADD COLUMN` (nullable, no default) → `SET NOT NULL` → `SET DEFAULT` — the
`DEFAULT` lands **after** the NOT-NULL check, so it never backfills the existing rows. A brief `default:`
cannot rescue this. **Workarounds:** (1) add the column **nullable** first (omit `required`) with a `default:`
so new rows get a value and existing rows stay NULL, backfill, then tighten to `required`; or (2) make the
change on an **empty** table / pre-backfill before tightening. The generator **auto-handles the one case it
can detect generically** — the **publishable** columns (`is_published`/`published_at`): it pre-materializes
them as nullable+default so `policy: public-read+owner-write` / `features: [publishable]` can be added to a
populated table day-2 (the column stays nullable — a documented trade-off). This caveat is the upstream defect
**`references/platform-gaps.md` → GAP-16** (and the author-level workarounds + the publishable auto-handling
are in `references/brief-grammar.md`).

**If you genuinely see an `already exists` error** (rare; not the additive re-run path — e.g. a hand-edited
provision that re-declares an extension/function outside the guarded blueprint emission): the DB was already
provisioned. Verify the previous provision succeeded (tables exist, endpoints work) and continue from the
post-provision workarounds; only drop-and-rebuild if you truly need a clean slate (`pnpm run create-db &&
pnpm run provision` on a fresh db name). Do **not** reach for drop-and-rebuild as the *default* day-2 path —
the additive re-run is the supported path.

## SUBDOMAIN-001

Per-database endpoints are addressed by a **subdomain that equals the database name with underscores**
(db `my_app` → subdomain `my_app`). The endpoints are then:

- `auth-<sub>.localhost:3000/graphql` — users / authentication
- `admin-<sub>.localhost:3000/graphql` — orgs / members / permissions
- **`api-<sub>.localhost:3000/graphql` — your business DATA (NOT `app-public-<sub>`; F2)**

Do **not** invent the subdomain. **Capture it, then verify it from the source of truth:**

1. **Capture from the `create-db` GraphQL result.** The `databaseProvisionModule` mutation returns the
   provisioned `databaseId` (and, when selected, the subdomain/domain); `create-db.ts` persists
   `DATABASE_ID` / `DATABASE_NAME` to `.env`. The subdomain is the db name with underscores.
2. **Discover/confirm endpoints from `services_public.domains`** (the source of truth for per-DB
   routing) — do **not** use the stale `metaschema_modules_public.database_provision_module` lookup:

   ```sql
   -- list the per-DB domains the platform actually routes (subdomain + full hostname):
   SELECT subdomain, domain FROM services_public.domains WHERE subdomain LIKE '%<db_name>%';
   ```

> 🚨 **The HTTP `Host` header drives routing — a URL alone still 404s.** The server selects the per-DB
> schema from the request's `Host`, so the `Host` must be `api-<sub>.localhost` (codegen + runtime),
> not just the URL. Confirm a candidate before trusting it:
> ```bash
> curl -s http://localhost:3000/graphql -H 'Host: api-<sub>.localhost' \
>   -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
> ```

Store the discovered values in `build/run-state.json` → `database`:

- **`database.subdomain`** — the subdomain (db name with underscores). **This is the field
  `verify-phase.sh` actually reads** (`resolve_subdomain` checks `database.subdomain` first, before
  falling back to a live lookup). Set it so the Phase 2.3 / Frontend gates resolve the right per-DB
  endpoints offline.
- **`database.app_data_endpoint`** (the `api-<sub>` DATA endpoint) and **`database.app_auth_endpoint`**
  — the full URLs, for your own reference and for the live-QA gate.

(These match `build/run-state.template.json`. The verifier keys off `database.subdomain`; the two endpoint
fields are informational. Keep `notes[]` free of any non-SDK-provisioning vocabulary — the 2.3 gate scans
it.)

## PGPM-001

`pgpm init` uses `inquirerer` (readline-based interactive prompts). AI agents cannot respond to readline prompts.

All `pgpm init` calls **must** include:

1. The positional argument (`workspace` or nothing for modules with `-t pnpm/module`).
2. `--no-tty` flag (supported in code but not shown in `--help`).
3. **Every** template variable as a CLI flag (`--name`, `--fullName`, `--email`, `--repoName`, `--username`, `--license`, etc.). If any value is missing, the prompter falls through to readline which crashes with `ERR_USE_AFTER_CLOSE` in non-TTY shells.

The `--no-tty` flag alone is not enough — it only prevents prompts for variables that already have values in argv.

The same pattern applies to `cnc server`: it prompts for CORS origin if `--origin` is not passed. Always include `--origin "*"` (or a specific URL) in non-interactive contexts.

## Architecture Shortcuts

- Users are organizations. `user.id` is the personal organization id.
- Provision with an **explicit module list**, never `modules: ['all']` — see PROVISION-001 below. Which modules comes from the chosen flow's `backend.modules` in `references/flows.json` (machine-checked by `node scripts/check-flows.mjs`); the default for a basic auth app is the `email-password` flow's `auth:email` list.
- The `create-db.ts` script passes `bootstrapUser: true`. Always include it when provisioning manually.
- Prefer `AuthzEntityMembership` over `AuthzMembership` for entity-scoped tables (it emits the `auth_sel_entity_membership` policy — `auth_<verb>_<policytype>`, no hash suffix). Read the `constructive-security` skill for the full list of valid Authz* types. There is no `AuthzOwnershipInEntity` — use the `constructive-db-data-modules` skill for correct pairings.
- Most `id`-bearing Data modules add `id` by default, so when composing several on one table set `include_id: false` on the *follow-up* nodes via `nodes: [{ $type: 'DataTimestamps', data: { include_id: false } }]` (Blueprint shape — NOT a separate flat `nodeData` call). But not every Data module adds `id`: `DataDirectOwner` adds **only `owner_id`** (no PK), so an owner-scoped table that needs full CRUD must **prepend `DataId`** (`nodes: ['DataId', 'DataDirectOwner', …]`). See `constructive-blueprints` → references/node-type-registry.md.
- App tables belong in the platform-managed schema family for the database. In local runs this typically means app tables land in `<prefix>-app-public`, while built-in membership tables live in `<prefix>-memberships-public`.
- If platform schemas are missing or the SDK no longer matches the live platform, Phase 1 is incomplete or the platform is incompatible. Fix that first; do not improvise a SQL replacement.

## Reference Files

See `guides/architecture-overview.md` for:

- endpoint map
- Data module and Authz policy pairing
- app brief field mapping
