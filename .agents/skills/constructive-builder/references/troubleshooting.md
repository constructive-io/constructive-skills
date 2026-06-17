# Troubleshooting Guide

When you run into issues, read this document for known problems and solutions.

---

## Quick Index

> **Tip:** know the exact error string but not the phase? Use [`references/error-index.md`](./references/error-index.md) — a flat `symptom string → cause → fix pointer` lookup (gotcha CODE / this guide's section / `platform-gaps.md` GAP-N) that routes you straight to the authoritative entry.

- **General**
  - Docker Postgres issues
- **Phase 1**
  - GraphQL Server not responding
  - GraphQL Server returns HTML "Not Found"
  - Agent stuck on nohup + curl verification (hang)
- **Post-Provision** (Email Services)
  - Mailpit not running
  - Admin GraphQL Server (3002) hangs on startup
  - send-email-link not sending emails
  - "Missing site configuration for email" error
  - job-service not processing jobs
- **Phase 2.1**
  - `pgpm init` non-interactive mode fails
- **Phase 2.3**
  - `__dirname` undefined in ESM scripts
  - Workaround schema name has hash (query real schema name with psql first)
  - `constructBlueprint` fails `NOT_FOUND (memberships_module)` (AuthzEntityMembership on an org-less app — use AuthzDirectOwner/AuthzAllowAll)
- **Phase 2.4** (Optional - skip in most cases, boilerplate includes codegen)
  - SDK build missing dependencies
  - `makage` missing `tsconfig.esm.json` / `README.md`
  - `pgpm init` fails in non-packages directory
  - Recommend skipping CLI by default (generate schema + sdk only)
- **Phase 2.5** (Boilerplate only)
  - `pgpm init -w` hangs (waiting for input)
  - Next.js 500 after start (missing `@sdk/*` / generated output)
- **Phase 3** (Per-DB integration + business UI)
  - updateUser returns 200 but does not persist (users-table UPDATE-policy gap — apply the createSecureTableProvision self_update step)
  - Auth hook onSuccess cannot get password (mutationFn must return password)
  - configure-app-sdk `headers` type error (must pass Record<string, string>, not a function)
  - Route structure (don't assume (authenticated) etc.; check template app/ structure first)
  - Don't wrap page in AppShell again (layout already has AuthenticatedShell; see existing users/page.tsx)
  - ORM/client delete missing select (must pass select explicitly)
  - orderBy enum values missing (CREATED_AT_DESC / POSITION_ASC etc.; use generated schema values or add index first)
  - No QueryClient set (SDK hooks vs app react-query instance; prefer generating SDK inside app)
  - No redirect after login / no Sidebar entry (router.push in onSuccess, add links in sidebar)
  - UI component import wrong (`@constructive-io/ui/*` vs template `@/components/ui/*`)
  - Use Stack when template has it (do not create Dialog for CRUD — check `ls .../ui/stack` first; see constructive-frontend / CRUD Stack)
  - SDK query result fields nullable (type errors in form/handler — use `?? ''` or accept nullable type)
  - Invalid UUID error on create/update (relation field `isRequired: false` missing)
  - Used confirm() or alert() for delete (must use template AlertDialog from `@/components/ui/alert-dialog`)
  - Next.js cannot find `@<app>/sdk/dist/...` (workspace path resolution)
  - Hooks argument error (mutation no input wrapper, query pass id directly; check generated hook @example / select vs selection.fields)

---

## General: Docker Postgres issues

### Problem

Postgres container is not running or connection fails.

### Solution

```bash
# Check container status
docker ps | grep postgres

# If not running, start it
eval "$(pgpm env)"
pgpm docker start

# Verify connection
psql -h localhost -U postgres -c "SELECT 1;"
```

---

## Phase 1: GraphQL Server not responding

### Problem

`curl` returns `000` or hangs (connection failure / timeout).

### Solution

1. Ensure the database is deployed:
```bash
eval "$(pgpm env)"
psql -c "SELECT datname FROM pg_database WHERE datname = 'constructive';"
```

2. If the database does not exist, deploy it:
```bash
cd /path/to/constructive-db
pgpm deploy --database constructive --createdb --yes --package constructive-services
pgpm deploy --database constructive --yes --package constructive-local
```

3. Start the GraphQL server:
```bash
cd $CONSTRUCTIVE_PATH/graphql/server
PGDATABASE=constructive pnpm dev
```

4. Wait for the server to be ready (**first start may take 20–30 seconds**):
```bash
sleep 25
```

5. Health check with POST + Host header + JSON body (expect GraphQL data):
```bash
curl -s --connect-timeout 5 --max-time 10 \
  -H "Host: auth.localhost:3000" \
  -H "Content-Type: application/json" \
  -X POST \
  http://localhost:3000/graphql \
  -d '{"query":"{ __typename }"}'
# Expected: {"data":{"__typename":"Query"}}
```

---

## Phase 1: GraphQL Server returns HTML "Not Found"

### Problem

GraphQL server process is running (`lsof -i:3000` shows node) but the request returns an HTML page instead of a GraphQL response:

```bash
curl -H "Host: auth.localhost:3000" http://localhost:3000/graphql
# Returns HTML: <title>Not Found</title>
```

### Cause

The Constructive database (`constructive`) is not deployed. The GraphQL server needs to connect to a deployed database at startup to route requests correctly.

### Solution

1. Check if the database exists:
```bash
eval "$(pgpm env)"
psql -c "SELECT datname FROM pg_database WHERE datname = 'constructive';"
```

2. If the database does not exist or is empty, deploy it:
```bash
cd /path/to/constructive-db
eval "$(pgpm env)"

# Create and deploy database
dropdb --if-exists constructive
pgpm deploy --database constructive --createdb --yes --package constructive-services
pgpm deploy --database constructive --yes --package constructive-local
```

3. Restart the GraphQL server:
```bash
# Kill current process
lsof -ti:3000 | xargs kill -9

# Restart
screen -dmS graphql bash -c 'cd $CONSTRUCTIVE_PATH/graphql/server && eval "$(pgpm env)" && PGDATABASE=constructive pnpm dev'
sleep 15
```

4. Verify:
```bash
curl -s --connect-timeout 5 --max-time 10 -H "Host: auth.localhost:3000" -H "Content-Type: application/json" -X POST http://localhost:3000/graphql -d '{"query":"{ __typename }"}'
# Expected: {"data":{"__typename":"Query"}}
```

### Verification

```bash
# Check database tables
psql -d constructive -c "SELECT COUNT(*) FROM metaschema_public.database;"
# Expected: number greater than 0
```

---

## Phase 1: Agent stuck on nohup + curl verification (hang)

### Problem

After running the following commands the Agent hangs with no response:

```bash
cd $CONSTRUCTIVE_PATH/graphql/server && PGDATABASE=constructive nohup pnpm dev > server.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://api.localhost:3000/graphql
```

### Cause

1. **curl has no timeout:** When the server is not ready, curl waits indefinitely for a connection by default.
2. **sleep 3 is too short:** GraphQL first start (compile, connect to DB) usually needs 20–30 seconds.
3. **nohup missing pgpm env:** Without `eval "$(pgpm env)"`, the DB connection may fail.
4. **api.localhost resolution:** In some environments DNS resolution is slow or broken.

### Solution (using screen)

```bash
# Run the following in the workspace root that contains the `constructive/` repo
screen -dmS graphql bash -c 'cd $CONSTRUCTIVE_PATH/graphql/server && eval "$(pgpm env)" && PGDATABASE=constructive pnpm dev'
sleep 25

# Health check with localhost + Host header + POST + JSON
curl -s --connect-timeout 5 --max-time 10 \
  -H "Host: auth.localhost:3000" \
  -H "Content-Type: application/json" \
  -X POST \
  http://localhost:3000/graphql \
  -d '{"query":"{ __typename }"}'
```

**Key improvements:**

| Improvement | Description |
|-------------|-------------|
| `--connect-timeout 5` | Connection timeout 5s to avoid waiting forever |
| `--max-time 10` | Total request timeout 10s |
| `-H "Host: auth.localhost:3000"` + `http://localhost:3000` | Use localhost (bypass DNS) + correct Host header for routing |
| `sleep 25` | Give server enough time to start (first start usually 20–30s) |
| `eval "$(pgpm env)"` | Ensure DB connection env vars are set |

### Verification

```bash
# Check port
lsof -i:3000 | grep LISTEN

# View startup log
tail -20 $CONSTRUCTIVE_PATH/graphql/server/server.log

# Expected: curl returns 405
```

---

## Post-Provision: Mailpit not running

### Problem

Mailpit container is not running or ports 1025/8025 are not accessible.

### Solution

```bash
# Check if container exists
docker ps -a | grep mailpit

# If not created, create and start it
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit

# If created but stopped
docker start mailpit

# Verify
curl -s http://localhost:8025 | head -5
```

---

## Post-Provision: Admin GraphQL Server (3002) hangs on startup

### Problem

After Admin server starts, port 3002 is not listening, process appears hung. Screen session exists but service is not responding.

### Cause

`constructive server` without `--origin` parameter enters interactive mode, waiting for user input for CORS origin. In Agent/CI environments without TTY input, this causes infinite waiting.

### Solution

**Must** add `--origin "*"` parameter to the command:

```bash
# ❌ Wrong - will hang waiting for input
constructive server --port 3002

# ✅ Correct - skip interactive prompt
constructive server --port 3002 --origin "*"
```

Full startup command:

```bash
screen -dmS admin-server bash -c '
  eval "$(pgpm env)" && \
  PGDATABASE=constructive \
  API_ENABLE_SERVICES=true \
  API_IS_PUBLIC=false \
  API_ANON_ROLE=administrator \
  API_ROLE_NAME=administrator \
  API_EXPOSED_SCHEMAS=metaschema_public,services_public,constructive_auth_public \
  API_META_SCHEMAS=metaschema_public,services_public,metaschema_modules_public,constructive_auth_public \
  constructive server --port 3002 --origin "*"
'
```

### Verification

```bash
# Wait for startup
sleep 10

# Check port
lsof -i:3002 | grep LISTEN

# Test GraphQL endpoint
curl -s http://localhost:3002/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'
# Expected return: {"data":{"__typename":"Query"}}
```

---

## Post-Provision: send-email-link not sending emails

### Problem

Emails are not appearing in Mailpit UI after user signup or password reset.

### Cause

1. send-email-link is not running
2. Admin GraphQL Server (port 3002) is not running
3. job-service is not running
4. `SEND_EMAIL_LINK_DRY_RUN=true` (should be `false`)

### Solution

**Step 1: Check all services are running:**

```bash
# Check HTTP services
for port in 3002 8082; do
  if lsof -i:$port | grep -q LISTEN; then
    echo "✅ Port $port - Running"
  else
    echo "❌ Port $port - Not running"
  fi
done

# Check job-service (no HTTP port)
if pgrep -f "knative-job-service" > /dev/null; then
  echo "✅ job-service - Running"
else
  echo "❌ job-service - Not running"
fi
```

**Step 2: Check logs for errors:**

```bash
tail -50 /tmp/send-email-link.log
tail -50 /tmp/job-service.log
tail -50 /tmp/admin-server.log
```

**Step 3: Verify `SEND_EMAIL_LINK_DRY_RUN` is false:**

If `DRY_RUN` is true, emails are logged but not sent. Restart send-email-link with `SEND_EMAIL_LINK_DRY_RUN=false`.

---

## Post-Provision: "Missing site configuration for email" error

### Problem

send-email-link logs show:

```
"Missing site configuration for email"
```

### Cause

The database has no **site domain** configured. The provision flow creates API domains (e.g., `api-xxx.localhost`, the per-DB data host) but not site domains.

### Solution

Add a site domain after provisioning:

```sql
-- Replace <your-db-name> with your database name
INSERT INTO services_public.domains (database_id, site_id, subdomain, domain)
SELECT 
    db.id,
    s.id,
    '<your-db-name>',
    'localhost'
FROM metaschema_public.database db
JOIN services_public.sites s ON s.database_id = db.id
WHERE db.name = '<your-db-name>'
ON CONFLICT (subdomain, domain) DO NOTHING;
```

### Verification

```sql
SELECT d.subdomain, d.domain
FROM services_public.domains d
JOIN services_public.sites s ON d.site_id = s.id
JOIN metaschema_public.database db ON d.database_id = db.id
WHERE db.name = '<your-db-name>';
-- Should return a row
```

---

## Post-Provision: job-service not processing jobs

### Problem

Jobs are being added to the queue but not processed. send-email-link never receives requests.

### Solution

**Step 1: Check job-service is running:**

```bash
pgrep -f "knative-job-service" || echo "Not running!"
```

**Step 2: Check logs:**

```bash
tail -f /tmp/job-service.log
# Should see: "worker-0 connected and looking for jobs..."
```

**Step 3: Verify environment variables:**

The most important variable is `INTERNAL_GATEWAY_DEVELOPMENT_MAP`:

```bash
export INTERNAL_GATEWAY_DEVELOPMENT_MAP='{"send-email-link":"http://localhost:8082"}'
```

**Step 4: Restart job-service if needed:**

```bash
pkill -f "knative-job-service"
cd $CONSTRUCTIVE_PATH/jobs/knative-job-service
# Set all env vars...
nohup node dist/run.js > /tmp/job-service.log 2>&1 &
```

---

## Phase 2.1: pgpm init non-interactive mode fails

### Problem

Running `pgpm init` even with `--no-tty` or `CI=true` still throws error:

```
Error [ERR_USE_AFTER_CLOSE]: readline was closed
```

### Cause

pgpm's inquirer dependency has issues in non-TTY environments. **Must pass all required parameters** along with `--no-tty` for it to work properly.

### Solution

**Pass all required parameters (including `--repoName`)**

For workspace, must provide all parameters (**note: `--repoName` is required**):

```bash
pgpm init workspace --no-tty \
  --name my-workspace \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --license MIT \
  --repoName my-workspace
```

For module, must provide all parameters:

```bash
pgpm init --no-tty \
  --moduleName my-module \
  --moduleDesc "My module description" \
  --fullName "Your Name" \
  --email "you@example.com" \
  --username your-github-username \
  --repoName my-workspace \
  --license MIT \
  --access public \
  --extensions "plpgsql,uuid-ossp"
```

### Verification

```bash
ls my-workspace/
# Should see: pgpm.json, pnpm-workspace.yaml, package.json, packages/
```

---

## Phase 2.2/2.3: pnpm install fails

### Problem

`pnpm install` throws error: cannot find `@constructive-io/*` packages.

### Solution

Ensure `.npmrc` is configured correctly:

```bash
cat > .npmrc << 'EOF'
@constructive-io:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
EOF
```

Ensure `GITHUB_TOKEN` environment variable is set.

---

## General: Running services in background (recommended: screen)

### Problem

After running `pnpm dev` or other server startup commands, Agent gets stuck waiting for command to complete, or process terminates after command ends.

### Recommended: screen

Using `screen` allows the server to run persistently in the background, unaffected by terminal closure:

```bash
# Start GraphQL Server (port 3000)
screen -dmS graphql bash -c 'cd $CONSTRUCTIVE_PATH/graphql/server && eval "$(pgpm env)" && PGDATABASE=constructive pnpm dev'

# Start Next.js App (port 3081)
screen -dmS app bash -c 'cd /path/to/app && pnpm dev --port 3081'

# Wait for startup
sleep 10

# Verify
lsof -i:3000 | head -3  # GraphQL
lsof -i:3081 | head -3  # Next.js
```

### screen common commands

```bash
# List all screen sessions
screen -ls

# Attach to specified session (view logs)
screen -r graphql
screen -r app

# Detach (without stopping service): Press Ctrl+A then D

# Stop specified session
screen -S graphql -X quit
screen -S app -X quit

# Stop service (by port)
lsof -ti:3000 | xargs kill  # GraphQL
lsof -ti:3081 | xargs kill  # Next.js
```

### Quick start commands

```bash
# GraphQL Server
screen -dmS graphql bash -c 'cd $CONSTRUCTIVE_PATH/graphql/server && eval "$(pgpm env)" && PGDATABASE=constructive pnpm dev'

# Next.js App
screen -dmS app bash -c 'cd /path/to/app && pnpm dev --port 3081'

# Verify startup
sleep 10
# Add timeout to prevent hang; api endpoint needs Host header
curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" -H "Host: api.localhost:3000" http://127.0.0.1:3000/graphql  # Expected 405
curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" http://127.0.0.1:3081  # Expected 200
```

### Option comparison

| Method | Pros | Cons |
|--------|------|------|
| **`screen`** | ✅ Persistent, interactive log viewing | Requires screen installed |
| `&` + log | ✅ Simple, no dependencies | May stop when terminal closes |
| `nohup` | ✅ Won't stop when terminal closes | Inconvenient for real-time logs |

### Verification

```bash
# Check port
lsof -i:3000 | grep LISTEN  # GraphQL
lsof -i:3081 | grep LISTEN  # Next.js

# Test API (add timeout to prevent hang)
curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" -H "Host: api.localhost:3000" http://127.0.0.1:3000/graphql  # Expected 405
curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" http://127.0.0.1:3081  # Expected 200
```

---

## Phase 1: Postgres connection refused

### Problem

When running `psql` or other database commands, throws error:

```
psql: error: connection to server at "localhost" (::1), port 5432 failed: Connection refused
Is the server running on that host and accepting TCP/IP connections?
```

### Cause

pgpm docker needs to be run inside the `constructive-db` directory to start correctly.

### Solution

```bash
# Enter constructive-db directory
cd /path/to/constructive-db

# Start docker
eval "$(pgpm env)"
pgpm docker start

# Verify connection
psql -c "SELECT 1;"
```

### Verification

```bash
psql -c "SELECT 1;"
# Should return:
#  ?column?
# ----------
#        1
```

---

## Phase 1: role "administrator" does not exist

### Problem

When running `pgpm deploy`, throws error:

```
role "administrator" does not exist
```

### Cause

Database roles (such as `administrator`, `authenticated`, etc.) have not been created yet. Need to bootstrap these roles first.

### Solution

Before deploying the database, run bootstrap command to create necessary roles:

```bash
eval "$(pgpm env)"

# 1. Bootstrap roles
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes

# 2. Create database
createdb constructive

# 3. Deploy database
pgpm deploy --yes --database constructive --package constructive-local
```

### Verification

```bash
psql -d constructive -c "SELECT rolname FROM pg_roles WHERE rolname = 'administrator';"
# Should return administrator role
```

---

## Phase 2.3: SDK package not found or wrong imports

### Problem

`pnpm install` throws 404 errors for SDK packages, or imports fail.

### Solution

Use the correct SDK packages from the npm registry:

| Package | Use Case |
|---------|----------|
| `@constructive-io/sdk` | **Node.js and browser** (provision, CLI, React, Next.js) |
| `@constructive-io/graphql-codegen` | SDK code generation |

See the `constructive-data-modeling` skill for setup details and the `constructive-codegen` skill for codegen.

### Verification

```bash
pnpm install
pnpm build
# No 404 or import errors
```

---

## Phase 2.3: SignUp return type missing ok/errors fields

### Problem

Compilation error:

```
Object literal may only specify known properties, and 'ok' does not exist in type 'SignUpPayloadSelect'.
```

### Cause

SDK's `signUp` mutation returns `SignUpPayloadSelect`, which has structure `{ result: { select: SignUpRecordSelect } }`, without `ok` and `errors` fields.

### Solution

**Use the correct select structure:**

```typescript
// ❌ Wrong
const signUpResult = await authDb.mutation
  .signUp(
    { input: { email, password } },
    { select: { ok: true, errors: true } }  // These fields don't exist
  )
  .execute();

// ✅ Correct
const signUpResult = await authDb.mutation
  .signUp(
    { input: { email, password } },
    { select: { result: { select: { userId: true } } } }
  )
  .execute();

// Check result
if (!signUpResult.ok || !signUpResult.data?.signUp?.result) {
  console.log('Sign up failed or user already exists');
}
```

### Verification

```bash
pnpm build
# Should compile successfully
```

---

## Phase 2.3: setHeaders method does not exist

### Problem

Compilation error:

```
Property 'setHeaders' does not exist on type '{ orgGetManagersRecord: ...; database: ...; ... }'.
```

### Cause

The ORM object returned by `createClient` does not have `setHeaders` method. This method is on the **adapter**, not the client.

The `db.setHeaders()` example in Skill documentation is idealized, actual SDK structure is different.

### Solution

**Pass headers when creating the client:**

```typescript
// ❌ Wrong
const publicDb = createPublicClient({
  endpoint: 'http://api.localhost:3000/graphql',
});
publicDb.setHeaders({ Authorization: `Bearer ${accessToken}` });  // Does not exist

// ✅ Correct
const publicDb = createPublicClient({
  endpoint: 'http://api.localhost:3000/graphql',
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### Verification

```bash
pnpm build
# Should compile successfully
```

---

## Phase 2.3: secureTableProvision/field/relationProvision not in admin SDK

### Problem

Compilation error:

```
Property 'secureTableProvision' does not exist on type ...
Property 'field' does not exist on type ...
```

### Cause

Schema operations (`secureTableProvision`, `field`, `relationProvision`, `table`) are in the **public SDK**, not the **admin SDK**. The `admin-<db>.localhost` endpoint name refers to the GraphQL **endpoint**, not the admin SDK client.

### Solution

Use the public SDK client for all schema operations. See the `constructive-data-modeling` skill for client setup and table / field usage examples.

### Verification

```bash
pnpm build
# Should compile successfully
```

---

## Phase 2.3: constructBlueprint fails with `NOT_FOUND (memberships_module)`

### Problem

`constructBlueprint` returns `status: failed` with `errorDetails: "NOT_FOUND (memberships_module)"`, and the table is **never created** (not a silent 0-row — a hard abort).

### Cause

A table declared `policies: [{ $type: 'AuthzEntityMembership', data: { entity_field: 'entity_id', membership_type: 2 }, … }]`, but the app was provisioned with the `auth:email` preset, which has **no** org/b2b/memberships modules. The org-scoped membership SPRT that `AuthzEntityMembership` resolves does not exist, so the construct aborts.

### Solution

Default a basic (org-less) app to **owner-scoped** policies, not entity-membership ones:

```typescript
// ✅ Each user owns their rows (default for a basic app)
nodes: ['DataId', 'DataDirectOwner', { $type: 'DataTimestamps', data: { include_id: false } }],
use_rls: true,
policies: [{ $type: 'AuthzDirectOwner', privileges: ['select','insert','update','delete'], permissive: true, data: { entity_field: 'owner_id' } }],

// ✅ App-wide shared pool (no ownership)
nodes: ['DataId', { $type: 'DataTimestamps', data: { include_id: false } }],
use_rls: true,
policies: [{ $type: 'AuthzAllowAll', privileges: ['select','insert','update','delete'], permissive: true }],

// ❌ Aborts on auth:email — only valid once the `b2b` org modules are provisioned
policies: [{ $type: 'AuthzEntityMembership', data: { entity_field: 'entity_id', membership_type: 2 }, … }],
```

The `schemas/core.ts` template already ships the owner-scoped default. Remember the FK prereq: `owner_id` FKs to the per-tenant users table, so sign the authed user up via the TENANT endpoint (`auth-<sub>.localhost`), not base `auth.localhost`. See gotchas RLS-POLICY-001.

### Verification

```bash
# Re-run provision; the construct should report status: completed and create the table.
pnpm run provision
```

---

## Phase 3: updateUser returns 200 but does not persist (silent no-op)

### Problem

Calling `updateUser` (profile / account-settings) succeeds (HTTP 200, no error), but the username / display_name / profile_picture change is **not saved** — re-querying the user shows the old values.

### Cause

The dynamically-provisioned per-tenant `users` table has RLS enabled and a column UPDATE grant to `authenticated`. If the table's self-UPDATE policy is missing, RLS rejects the update and 0 rows change — silently. The policy is named `auth_upd_self_update` (`auth_<verb>_<policytype>`, no hash suffix; the SELECT counterpart is `auth_sel_self_update`). The platform now emits this UPDATE policy natively for an auth preset (PLATFORM-GAPS.md GAP-1a, CLOSED), so this is normally a non-issue; it can still occur on a deployment predating that fix, where — because `users` is module-owned — it can't be fixed in the blueprint and needs the control-plane step below.

### Solution

Apply the users-table self-update policy as a control-plane step (the `provision.ts` template already runs it) — `createSecureTableProvision` on `http://modules.localhost:3000/graphql` with the provisioning sudo token:

```typescript
await modulesClient.secureTableProvision.create({
  data: {
    databaseId,                                   // tenant db uuid
    schemaId,                                     // metaschema_public.schema WHERE name='users_public'
    tableId,                                      // metaschema_public.table  WHERE name='users'
    tableName: 'users',
    useRls: true,
    policies: [{ $type: 'AuthzDirectOwner', permissive: true, privileges: ['update'],
                 policy_name: 'self_update', data: { entity_field: 'id' } }] as unknown as Record<string, unknown>,
  },
  select: { id: true },
}).unwrap();
```

This emits `auth_upd_self_update` (`FOR UPDATE TO authenticated USING id = jwt_public.current_user_id()`) and updateUser persists. See gotchas RLS-USERS-UPDATE-001. (Platform gap, flagged upstream; control-plane step is the app-side reconciliation.)

### Verification

```bash
# Expect BOTH auth_sel_self_update and auth_upd_self_update on the users table:
psql "$PGDATABASE" -c "SELECT polname FROM pg_policy WHERE polrelid =
  (SELECT oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relname='users' AND n.nspname LIKE '%users-public' LIMIT 1);"
# Then call updateUser and re-query the user — the change should persist.
```

---

## Phase 2.3: table.findOne parameter error (where vs id)

### Problem

Compilation error:

```
Object literal may only specify known properties, and 'where' does not exist in type '{ id: string; select: TableSelect; }'.
```

### Cause

The `findOne` method accepts the `id` parameter directly, unlike `findMany` which uses a `where` parameter.

### Solution

**Use the correct findOne parameters:**

```typescript
// ❌ Wrong - findOne has no where parameter
const result = await db.table.findOne({
  where: { id: tableId },
  select: { id: true, name: true },
}).execute();

// ✅ Correct - pass id directly
const result = await db.table.findOne({
  id: tableId,
  select: { id: true, name: true },
}).execute();
```

### findOne vs findMany parameter comparison

| Method | Parameters |
|--------|------------|
| `findOne` | `{ id: string, select: {...} }` |
| `findMany` | `{ where: {...}, select: {...}, first?: number }` |
| `findFirst` | `{ where: {...}, select: {...} }` |

### Verification

```bash
pnpm build
# Should compile successfully
```

## Phase 2.4: SDK build missing dependencies

### Problem

Building the generated SDK throws an error:

```
Cannot find module '@tanstack/react-query' or its corresponding type declarations.
Cannot find module '@constructive-io/graphql-types' or its corresponding type declarations.
Cannot find module 'graphql' or its corresponding type declarations.
```

### Cause

The generated SDK code depends on these packages, but they are not declared in `package.json`.

### Solution

**Add the missing dependencies:**

```bash
cd sdk/sdk

# Add dependencies
cat package.json | jq '
  .dependencies = {
    "@tanstack/react-query": "^5.0.0",
    "@constructive-io/graphql-types": "link:$CONSTRUCTIVE_PATH/graphql/types/dist",
    "@0no-co/graphql.web": "^1.0.0",
    "gql-ast": "^3.0.0",
    "graphql": "^16.0.0"
  }
' > package.json.tmp && mv package.json.tmp package.json

pnpm install
```

### Verification

```bash
pnpm build
# Should build successfully
```

---

## Phase 2.4: makage build missing tsconfig.esm.json

### Problem

Running `makage build` throws an error:

```
error TS5058: The specified path does not exist: 'tsconfig.esm.json'.
```

### Cause

makage requires `tsconfig.esm.json` to build ESM output.

### Solution

**Create tsconfig.esm.json:**

```bash
cat > tsconfig.esm.json << 'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/esm",
    "module": "ES2022",
    "moduleResolution": "bundler"
  }
}
EOF
```

### Verification

```bash
pnpm build
# Should build successfully, generating dist/ and dist/esm/ directories
```

---

## Phase 2.4: makage build missing README.md

### Problem

Running `makage build` throws an error:

```
ENOENT: no such file or directory, stat 'README.md'
```

### Cause

makage tries to copy README.md to the dist directory, and throws an error if the file does not exist.

### Solution

**Create README.md:**

```bash
echo "# Package Name" > README.md
```

### Verification

```bash
pnpm build
# Should build successfully
```

---

## Phase 2.3/2.4: __dirname undefined in ESM scripts

### Problem

Running TypeScript scripts in ESM mode (`"type": "module"`) throws an error:

```
ReferenceError: __dirname is not defined
```

### Cause

`__dirname` and `__filename` are CommonJS global variables that do not exist in ESM mode.

### Solution

**Use `import.meta.url` instead:**

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Now you can use __dirname normally
const outputDir = path.resolve(__dirname, '../output');
```

### Verification

```bash
pnpm tsx script.ts
# Should run normally, no more __dirname error
```

---

## Phase 2.3: TypeScript select field does not exist (e.g. `schemaName` not in type)

### Problem

When writing provision scripts, TypeScript reports errors like:

- `Property 'schemaName' does not exist on type ...`
- `Object literal may only specify known properties ...`

### Cause

The SDK's select types are **strict**: you can only select fields that actually exist in the schema and are exposed by codegen. Many “seemingly reasonable” field names (e.g., `schemaName`) do not exist in that entity's select type.

### Solution

- **Start with minimal select** (only get `id`, `name`, and other fields you know exist), get the script working, then add fields incrementally
- **Let types be your guide**: Let your editor/TS suggestions drive field selection, rather than guessing field names
- If you just need to “confirm creation succeeded”, usually `id: true` is sufficient

### Verification

```bash
pnpm build
# TypeScript compiles successfully
```

---

## Phase 2.3: Workaround SQL schema name contains hash

### Problem

When applying workarounds (like `fix-membership-defaults`) an error is thrown:

```
ERROR:  schema "<db>-user-identifiers-public" does not exist
```

### Cause

In Per-DB mode, schema names include a hash suffix, like `<db>-a65661ed-user-identifiers-public`, not simply `<db>-user-identifiers-public` (`<db>` is your database name).

### Solution

**The `<db>-user-identifiers-public` in the documentation is a template format. Actual Per-DB schema names include a hash, so you must first run the psql query below to get the real schema name, then execute ALTER/UPDATE.**

**First query the correct schema name:**

```bash
eval "$(pgpm env)"

# Find schemas containing the database name
psql constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'emails' AND table_schema LIKE '%<dbName>%';"

# Example output: <db>-a65661ed-user-identifiers-public
```

**Then use the correct schema name to execute SQL:**

```bash
# Replace <schema> with the actual name from the query
psql constructive -c 'ALTER TABLE "<schema>".emails ALTER COLUMN is_verified SET DEFAULT true;'
psql constructive -c 'UPDATE "<schema>".emails SET is_verified = true;'
```

**Or use a wildcard query to get it automatically:**

```bash
# Automatically find and apply
SCHEMA=$(psql constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'emails' AND table_schema LIKE '%<db>%' LIMIT 1;" | tr -d ' ')
psql constructive -c "ALTER TABLE \"$SCHEMA\".emails ALTER COLUMN is_verified SET DEFAULT true;"
psql constructive -c "UPDATE \"$SCHEMA\".emails SET is_verified = true;"
```

### Verification

```bash
psql constructive -c "SELECT is_verified FROM \"$SCHEMA\".emails;"
# Should return true
```

---

## Phase 2.4: pgpm init fails in non-packages directory

### Problem

Running `pgpm init` in non-standard directories like `sdk/` throws an error:

```
Error: You must be inside the workspace root, a parent directory of modules (like 'packages/'), or inside one of the workspace packages
```

### Cause

`pgpm init` only recognizes `packages/` and `extensions/` as module directories. Custom directories (like `sdk/`) are not automatically recognized.

### Solution

**Option A: Manually create directories and files**

```bash
# 1. Create directory structure
mkdir -p sdk/my-package/src

# 2. Manually create package.json
cat > sdk/my-package/package.json << 'EOF'
{
  "name": "@myapp/my-package",
  "version": "0.0.1",
  "main": "index.js",
  "module": "esm/index.js",
  "types": "index.d.ts",
  "publishConfig": {
    "access": "public",
    "directory": "dist"
  },
  "scripts": {
    "clean": "makage clean",
    "build": "makage build"
  },
  "devDependencies": {
    "makage": "^0.1.10"
  }
}
EOF

# 3. Create tsconfig.json and tsconfig.esm.json
# 4. Create README.md
# 5. Update pnpm-workspace.yaml to add 'sdk/*'
```

**Option B: Create in packages/ first, then move**

```bash
# 1. Create in packages/
cd /path/to/workspace
pgpm init -t pnpm/module --no-tty --moduleName my-package ...

# 2. Move to target directory
mkdir -p sdk
mv packages/my-package sdk/

# 3. Update pnpm-workspace.yaml
```

### Verification

```bash
pnpm install
pnpm build
# Should install and build successfully
```

---

## Phase 2.5: `pgpm init -w` / template init hangs (waiting for input)

### Problem

When running Next.js template initialization, the command hangs (especially noticeable in non-interactive environments), appearing to wait indefinitely for input parameters (e.g., moduleName).

### Cause

`pgpm init` in non-TTY / agent environments may enter interactive prompts and cause “hung waiting for input” if required parameters are missing.

### Solution

- **Prefer using `--no-tty` and explicitly providing required parameters** (see the `pgpm init` non-interactive mode section under Phase 2.1 in this file)
- Or ensure you're running in a truly interactive terminal

### Verification

The initialization command finishes within a reasonable time and generates the app directory and `package.json`.

---

## Phase 2.5: Next.js 500 after start (missing `@sdk/*` / generated output)

### Problem

After starting `pnpm dev`, pages return 500 errors. Common log messages include:

- `Cannot find module '@sdk/auth'` (or similar `@sdk/*`)
- Cannot find the generated GraphQL SDK output directory/files

### Cause

This template typically depends on codegen-generated `@sdk/*` artifacts (located in the app's `src/graphql/...` or similar directory). If you run `pnpm dev` without first running `pnpm codegen`, the missing modules will cause 500 errors.

### Solution

Run in the app directory:

```bash
pnpm install
pnpm codegen
pnpm dev
```

### Verification

After `pnpm dev`, pages load normally; and `@sdk/*` imports no longer throw errors.

---

## Phase 3: Auth hook onSuccess cannot get password (Per-DB login needs mutationFn to return password)

### Problem

When calling `appSignIn(email, password)` in the boilerplate's login hook `onSuccess`, the `password` is not available (undefined or inaccessible), causing Per-DB login to fail.

### Cause

The `onSuccess` callback only receives the **mutation's return value**. If mutationFn only returns `{ token, email, rememberMe }` without `password`, you cannot access the user's just-entered password in `onSuccess` (it wasn't passed down via closure or parameters).

### Solution

Make **mutationFn's return value include `password`**, so `onSuccess` can destructure it:

- For example: `return { token, email, password, rememberMe }`
- In `onSuccess`: `const { token, email, password } = data; await appSignIn(email, password);`

Do not rely on “getting password from somewhere else in onSuccess” - if the mutation didn't return it, don't assume you can get it.

### Verification

After login, Per-DB's `appSignIn` executes correctly, and the app token is present in localStorage.

---

## Phase 3: configure-app-sdk `headers` type error (pass object, not function)

### Problem

Writing this in `src/lib/configure-app-sdk.ts`:

```ts
configure({
  endpoint: APP_ENDPOINT,
  headers: () => {
    const token = getAppToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});
```

Build or runtime error: type mismatch, or SDK requests at runtime don't include Authorization.

### Cause

The generated SDK's `createClient` / `configure` expects **`headers: Record<string, string>`** (a plain object), not a function. Passing a function causes type errors or unexpected behavior.

### Solution

Compute the headers object first, then pass it in:

```ts
function getHeaders(): Record<string, string> {
  const token = getAppToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

configure({
  endpoint: APP_ENDPOINT,
  headers: getHeaders(),
});
```

If the token changes after login, you need to call `configure({ endpoint, headers: getHeaders() })` again after successful login, or use an adapter that provides headers on each request.

### Verification

SDK requests correctly include `Authorization: Bearer <token>`, with no type errors.

---

## Phase 3: Route structure (don't assume route groups; check template app directory first)

### Problem

When creating new features, you placed pages under an assumed route group, for example:

- `src/app/(authenticated)/my-feature/page.tsx`

But you discover that other pages in the template are not under `(authenticated)`, or the template doesn't use that route group at all, causing routing anomalies or inconsistent page styles.

### Cause

Different Next.js templates organize routes differently. Some templates use route groups like `(authenticated)`, while others place pages directly under `app/` (e.g., `app/users/`, `app/account/`). **Do not assume based on experience** - you must first examine the current template's actual structure.

### Solution

1. **First examine the template's existing structure**: Check what directories are under `src/app/` and whether there are `(xxx)` route groups.
2. **Cross-reference `src/app-routes.ts`**: The route registry reflects the template's conventional structure (e.g., paths for `users`, `account`, etc.).
3. **Keep new features consistent with existing pages**: If the template uses a flat structure like `app/users/`, `app/account/`, new features should also go under `app/<feature>/` - don't create route groups that don't appear in the template.

### Verification

New page paths are consistent with other template pages, accessible normally through `app-routes.ts`, with no 404 or layout issues.

---

## Phase 3: Don't wrap page in AppShell again (layout already has AuthenticatedShell)

### Problem

Wrapping page content in `<AppShell>`, for example:

```tsx
export default function BoardsPage() {
  return (
    <AppShell navigation={...} topBar={...}>
      ...
    </AppShell>
  );
}
```

Runtime error about missing `navigation`, `topBar` props, or duplicate/broken layout.

### Cause

The template's **layout already wraps all child pages in `AuthenticatedShell`** (or an equivalent component), providing a unified shell (navigation, top bar, etc.). **Pages themselves do not need another AppShell wrapper**. SKILL.md may not explicitly state this, making it easy to assume “one shell per page”.

### Solution

1. **Do not wrap `<AppShell>` in new pages** - just write the page content directly.
2. **First look at existing template pages**: Open existing pages in the same project (e.g., `users/page.tsx`, `account/page.tsx`), see if they only return content without AppShell, and write new pages following the same structure.

Example (correct):

```tsx
// Correct: no AppShell wrapper, layout already provides shell
export default function BoardsPage() {
  const { data } = useBoardsQuery(...);
  return (
    <div>
      {/* Page content */}
    </div>
  );
}
```

### Verification

Page renders normally, no “missing navigation/topBar” errors, layout is consistent with other authenticated pages.

---

## Phase 3: ORM/client delete missing select argument

### Problem

When using the generated SDK for deletion, only passing `where`, for example:

```ts
await client.board.delete({ where: { id: boardId } }).execute();
```

Running `pnpm lint:types` throws an error:

```
error TS2345: Argument of type '{ where: { id: string; }; }' is not assignable to parameter of type '...'.
  Property 'select' is missing in type '{ where: { id: string; }; }' but required in type '{ select: ListSelect; }'.
```

### Cause

The generated SDK's **delete method requires an explicit `select` argument** to declare the shape of fields returned after deletion. This is the codegen API design - like findOne/findMany, it requires an explicit select.

### Solution

Add the `select` parameter to delete, selecting at least one field (usually `id` is sufficient):

```ts
await client.board.delete({ where: { id: boardId }, select: { id: true } }).execute();
await client.list.delete({ where: { id: listId }, select: { id: true } }).execute();
await client.card.delete({ where: { id: cardId }, select: { id: true } }).execute();
```

The specific fields available are determined by the generated types (consistent with the entity's ListSelect).

### Verification

`pnpm lint:types` passes, delete operations execute correctly at runtime.

---

## Phase 3: orderBy enum values do not exist (CREATED_AT_DESC / POSITION_ASC etc.)

### Problem

When using ORM or hooks with `orderBy`, passing `CREATED_AT_DESC`, `POSITION_ASC`, etc., GraphQL returns an error:

```json
{
  "errors": [{
    "message": "Variable \"$orderBy\" got invalid value \"CREATED_AT_DESC\" at \"orderBy[0]\"; Value \"CREATED_AT_DESC\" does not exist in \"BoardOrderBy\" enum."
  }]
}
```

### Cause

In the generated GraphQL schema, each table's `XxxOrderBy` enum **only contains fields that currently have indexes and are sortable**. The default typically only includes:

- `NATURAL`
- `PRIMARY_KEY_ASC` / `PRIMARY_KEY_DESC`
- `ID_ASC` / `ID_DESC`

`CREATED_AT_DESC`, `POSITION_ASC`, etc. are **not included** unless you created the corresponding sort index for that table/field in provision (PostGraphile generates these enum values based on indexes).

### Solution

**Short term:** Use enum values already in the schema, for example:

- For “newest first”, use `ID_DESC` first (UUIDs are roughly time-ordered)
- For list/card ordering, use `ID_ASC` first, then switch to `POSITION_ASC` after adding a position index

**Long term (need to sort by created_at / position etc.):** Add an index for that table in the provision script, referencing the `constructive-data-modeling` skill, for example:

```ts
await publicDb.index.create({
  data: {
    tableId: boardsTableId,
    fieldIds: [createdAtFieldId],
    name: 'boards_created_at_idx',
  },
  select: { id: true },
}).execute();
```

Then run codegen again, and the new orderBy options will appear in the generated `schema-types.ts` (e.g., `BoardOrderBy`).

### Verification

- View generated types: `grep -A 2 "export type BoardOrderBy" sdk/sdk/src/app-public/schema-types.ts`
- Only use strings listed in that type as `orderBy` values; GraphQL requests no longer report enum errors.

---

## Phase 3: `@constructive-io/ui/*` not found (template uses local UI components)

### Problem

Writing according to UI skill documentation:

```ts
import { Button } from '@constructive-io/ui/button';
```

But build fails: `Cannot find module '@constructive-io/ui/...'.`

### Cause

The `nextjs/constructive-app` template typically has UI components **built-in** (e.g., `@/components/ui/*`), and may not have the published `@constructive-io/ui` package installed.

### Solution

Prefer using the template's built-in components:

```ts
import { Button } from '@/components/ui/button';
```

### Verification

Next.js compiles successfully, pages render normally.

---

## Phase 3: Used confirm() or alert() for delete (must use template AlertDialog)

### Problem

Delete flow uses native browser APIs:

```tsx
const handleDelete = async (id: string) => {
  if (!confirm('Are you sure you want to delete this item?')) return;
  await deleteMutation.mutateAsync({ id });
};
```

This violates the template-first rule: UI should use the template's components from `@/components/ui/*`, not `confirm()` or `alert()`.

### Cause

Using `confirm()` or `alert()` is quick to write but breaks consistency (browser default look, no template styling) and is explicitly forbidden in Phase 3.

### Solution

Use the template's AlertDialog from `@/components/ui/alert-dialog`:

1. **Check the template** has the component:
   ```bash
   ls packages/app/src/components/ui/alert-dialog.tsx
   ```

2. **Import and use AlertDialog** (controlled by open state, or use AlertDialogTrigger):

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Option A: Trigger wraps the Delete button
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete contact?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => deleteMutation.mutateAsync({ id })}
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

If the trigger is not the row’s delete button (e.g. you need the row `id`), use controlled open state:

```tsx
const [deleteId, setDeleteId] = useState<string | null>(null);
// ...
<AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
  <AlertDialogTrigger asChild>
    <Button variant="ghost" size="icon" onClick={() => setDeleteId(row.id)}>...</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    ...
    <AlertDialogAction onClick={() => deleteId && deleteMutation.mutateAsync({ id: deleteId }).then(() => setDeleteId(null))}>
      Delete
    </AlertDialogAction>
  </AlertDialogContent>
</AlertDialog>
```

3. **Remove all `confirm()` and `alert()`** from the app before reporting Phase 3 complete.

### Verification

- Run: `grep -rE 'confirm\\(|alert\\(' packages/app/src` (or your app path). There should be no matches.
- Delete flow shows the template-styled dialog, not the browser’s native confirm box.

---

## Phase 3: Next.js cannot find `@<app>/sdk/dist/...` (pnpm workspace path resolution)

> **Note:** If you skipped Phase 2.4 (recommended approach), using the boilerplate's built-in `@sdk/app` path alias, you will not encounter this issue.

### Problem

Similar import failures:

- `Cannot find module '@<app>/sdk/dist/hooks'` (`<app>` is your app package name)
- Or Next.js cannot resolve deep paths like `dist/*` inside workspace packages

### Cause

Next.js + pnpm workspace in monorepo scenarios is sensitive to deep path imports “pointing to another package's dist subdirectory” (build/resolution strategy differs from running Node directly).

### Solution (Recommended)

**Generate the business SDK output inside the app**, avoiding cross-package deep paths:

- codegen output points to `packages/app/src/graphql/<db>/...`
- Import hooks/orm in the app using `@/graphql/<db>/...`

(Alternative: configure tsconfig paths / adjust exports, but maintenance cost is higher)

### Verification

Next.js can resolve SDK imports, `pnpm dev` no longer reports module not found.

---

## Phase 3: No QueryClient set (useXxxQuery error)

### Prevention (Recommended at the start of Phase 3)

In Phase 2.5 or 2.6, **directly generate the per-DB SDK inside the app** (e.g., `packages/app/src/graphql/<db>-sdk/`), and in the app, only import `configure` and hooks from `@/graphql/<db>-sdk/app-public`. Do not import hooks from the workspace package `@<app>/sdk` to avoid this error.

### Problem

When using generated SDK hooks (e.g., `useXxxQuery`, `useXxxMutation`), a runtime error occurs:

```
Runtime Error
No QueryClient set, use QueryClientProvider to set one
.../sdk/sdk/src/app-public/hooks/queries/useXxxQuery.ts (78:18) @ useXxxQuery
```

The app already wraps the layout with `QueryClientProvider`, but hooks still cannot access the QueryClient.

### Cause

1. **SDK and app have different react-query instances**  
   If the SDK is referenced as an independent workspace package (e.g., `@<app>/sdk`, where `<app>` is your app package name) by the app, Next.js/Turbopack's module resolution may cause **app** and **SDK** to each get different `@tanstack/react-query` module instances. React Context is isolated by module instance: the app's `QueryClientProvider` provides context for "the app's react-query", while the SDK's `useQuery` comes from "the SDK's react-query", so they cannot access the same QueryClient.

2. **peerDependencies may not be enough**  
   Moving `@tanstack/react-query` from SDK's dependencies to peerDependencies can prevent pnpm from installing a separate copy for the SDK, but in Next's ESM/bundling environment, cross-package references may still resolve to different instances, and the problem persists.

### Solution (Recommended)

**Generate the business SDK inside the app**, so hooks and app use the same react-query code, sharing the same QueryClient context:

1. Create a directory inside the app, e.g., `packages/app/src/graphql/<db>-sdk/`.
2. Use codegen to generate the SDK into that directory (endpoint / headers consistent with per-DB).
3. In the app, import hooks and `configure` from `@/graphql/<db>-sdk/app-public`, no longer from `@<app>/sdk`.

This way, hooks and `QueryClientProvider` come from the same module graph, and context works normally.

### Verification

- Pages using `useXxxQuery` / `useXxxMutation` no longer report "No QueryClient set".
- If still generating from workspace's `sdk/sdk` but copying or linking to `src/graphql/...` via in-app codegen, ensure the app only imports from `@/graphql/...` at runtime, avoiding mixing with `@<app>/sdk`.

---

## Phase 3: No redirect after login / no Sidebar entry for app routes

### Problem

- After successful login, still staying on the generic dashboard, not entering the business home page (e.g., board list).
- Sidebar only has template default entries like Users / Account, no entry for business pages (e.g., Boards).

### Cause

The boilerplate's login `onSuccess` only handles platform token and appSignIn, without `router.push` to your main business route; sidebar navigation items need to be manually added according to template conventions.

### Solution

1. **Redirect after login:** In `src/lib/gql/hooks/auth/schema-builder/use-login-sb.ts`'s `onSuccess`, add `router.push('/<your-main-route>')` (e.g., `/boards`) after `appSignIn`, ensuring entry to the business home page after login.
2. **Sidebar entry:** Find the template's sidebar configuration (e.g., in `src/components/...` or `src/app-routes.ts` nav config), add your business routes (path + label) following the existing entry format, so the sidebar shows the corresponding links.

### Verification

After login, automatically enter the business home page; sidebar shows and allows clicking into business pages.

---

## Phase 3: Hooks argument error (`select` vs `selection.fields`; mutation no input, query pass id directly)

### Problem

When calling generated SDK hooks, type errors or runtime exceptions occur, for example:

- **Mutation**: Following common GraphQL patterns, wrote `input: { board: { name: '...' } }`, but got type errors or unexpected runtime behavior.
- **Query**: Wrote `variables: { id }` or `variables: { id: boardId }`, but the hook actually expects `id` directly (or other flat parameters).
- **Select/selection**: Wrote `select: { id: true, name: true }`, but the type requires `selection: { fields: { ... } }` or another structure.

### Cause

**The generated code's API differs from common GraphQL / documentation examples.** The generated SDK is flattened: mutations don't need an `input` wrapper, just pass fields directly; queries like `useBoardQuery` accept `id` directly rather than `variables: { id }`. Skill documentation examples are mostly conceptual, **not 100% reflecting the generated API**. Only by looking at the JSDoc `@example` in generated files or running `pnpm lint:types` can you discover the differences.

### Solution

**Look at generated code before writing, use generated code as the source of truth:**

```bash
# See the correct query hook parameters
head -50 src/graphql/<db>/hooks/queries/useBoardQuery.ts

# See the correct mutation hook parameters
head -50 src/graphql/<db>/hooks/mutations/useCreateBoardMutation.ts
```

Use the `@example` and function parameter types there as your guide. Common correct patterns:

**Mutation (no input wrapper):**

```ts
// ❌ Wrong - do not use input wrapper
await createBoardMutation.mutateAsync({
  input: { board: { name: 'My Board' } },
});

// ✅ Correct - pass fields directly
await createBoardMutation.mutateAsync({
  name: 'My Board',
});
```

**Query (pass id etc. directly):**

```ts
// ❌ Wrong - do not use variables wrapper
useBoardQuery({ variables: { id: boardId } });

// ✅ Correct - pass id directly
useBoardQuery({ id: boardId });
```

**List query (selection.fields etc.):**

```ts
useXxxQuery({
  selection: {
    fields: { id: true, name: true },
    where: { ... },
    orderBy: ['ID_DESC'],   // Use enum values from generated types
    first: 10,
  },
});
```

Do not use `select: { ... }` or parameter shapes not present in the generated code.

### Verification

TypeScript compiles (`pnpm lint:types`), hooks have no type errors, and requests reach GraphQL successfully.

---

## Phase 3: Update mutation patch arg name mismatch (`patch` vs `${entity}Patch`)

### Problem

You call an update mutation like this:

```ts
await updateXxxMutation.mutateAsync({ id, patch: { name: 'New' } });
```

TypeScript complains that `patch` does not exist, or the update doesn't behave as expected.

### Cause

Generated hooks commonly use an **entity-specific** patch argument name: `${entity}Patch` (e.g. `contactPatch`, `companyPatch`, `dealPatch`). This differs per schema and per operation.

### Solution

Open the generated update hook and copy the signature / `@example`:

```bash
head -60 src/graphql/<db>-sdk/app-public/hooks/mutations/useUpdate*Mutation.ts
```

Then pass the correct patch arg name exactly as generated (e.g. `contactPatch`).

### Verification

TypeScript compiles and the update mutation succeeds at runtime.

---

## Phase 3: Use Stack when template has it (do not create Dialog for CRUD panels)

### Problem

You added or imported a generic Dialog (e.g. `@/components/ui/dialog`) for create/edit panels, and the template already has `@/components/ui/stack`. UI works but does not match the template’s intended pattern (slide-in Stack cards).

### Cause

SKILL.md Phase 3.5 requires: **before any CRUD UI**, check whether the template has Stack (`ls packages/app/src/components/ui/stack`). If it exists, you must use **Stack Cards** (constructive-frontend / CRUD Stack), not a generic Dialog.

### Solution

1. Run `ls packages/app/src/components/ui/stack` (or your app path). If the directory exists:
2. Read the **constructive-frontend** skill (CRUD Stack section).
3. Implement create/edit/delete with `useCardStack()`, `card.push()`, and `CardComponent`. Use stacked confirm-delete for delete, not a separate Dialog.
4. Do not create or import `@/components/ui/dialog` for CRUD when Stack exists.

If the template has **no** Stack, then use the template’s Dialog/AlertDialog from `@/components/ui/*`.

### Verification

Create/edit/delete use slide-in panels (Stack) when the template has `ui/stack`; no generic Dialog is used for CRUD.

---

## Phase 3: Invalid UUID error on create/update (relation field missing `isRequired: false`)

### Problem

GraphQL returns an error like:

```json
{
  "errors": [{
    "message": "Variable \"$input\" got invalid value \"\" at \"input.contact.companyId\"; Invalid UUID, expected 32 hexadecimal characters, optionally with hyphens"
  }]
}
```

This happens when the user leaves a relation field (like Company) unselected, and the code passes an empty string `""` as the foreign key.

### Cause

In the provision script, you set `deleteAction: 'n'` (SET NULL) but **forgot `isRequired: false`**.

```typescript
// ❌ Wrong - missing isRequired: false
await publicDb.relationProvision.create({
  data: {
    ...
    deleteAction: 'n',  // SET NULL
    // isRequired defaults to true!
  },
  ...
})
```

When `isRequired` defaults to `true`:
- The foreign key column is created as `NOT NULL`
- SDK codegen generates the field as required `string` (not `string | null`)
- UI code tries to bypass TypeScript with empty string `''`
- GraphQL validation rejects `""` because it's not a valid UUID

### Solution

**Step 1: Fix the provision script**

```typescript
// ✅ Correct - set both deleteAction: 'n' and isRequired: false
await publicDb.relationProvision.create({
  data: {
    databaseId,
    relationType: 'RelationBelongsTo',
    sourceTableId: contactsTableId,
    targetTableId: companiesTableId,
    deleteAction: 'n',      // SET NULL on delete
    isRequired: false,      // ��� Must add this! Foreign key allows NULL
  },
  select: { id: true, outFieldId: true },
}).execute();
```

**Step 2: Re-deploy the provision**

```bash
cd packages/provision
pnpm build && node dist/index.js
```

**Step 3: Regenerate SDK** (if using codegen)

```bash
cd packages/app
pnpm codegen
```

**Step 4: Fix UI code** — now you can pass `null` or `undefined` instead of empty string:

```typescript
// ✅ Correct - pass undefined or null (not empty string)
companyId: companyId || undefined
```

### Quick Reference

| `deleteAction` | `isRequired` | Description |
|----------------|--------------|-------------|
| `'n'` (SET NULL) | **Must be** `false` | Otherwise SDK generates required field, passing empty value throws Invalid UUID |
| `'c'` (CASCADE) | `true` or `false` | Based on business requirements |
| `'r'` (RESTRICT) | Usually `true` | Must remove association before deletion |

### Verification

```bash
# 1. Check the column is nullable in database
psql constructive -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'company_id';"
# Expected: is_nullable = YES

# 2. Check SDK generated type allows null
grep -A 5 'companyId' packages/app/src/graphql/*/app-public/schema-types.ts
# Expected: companyId?: string | null | undefined
```

---

## Phase 3: SDK query result fields nullable (type errors in form or handler)

### Problem

TypeScript reports:

```
Type 'string | null | undefined' is not assignable to type 'string'.
```

when you pass query result fields (e.g. `board.name`, `list.name`, `card.title`, `createdAt`) into form state or a handler that expects `string`.

### Cause

Generated SDK types often expose fields as `string | null | undefined`. If you type form state or handler args as `string`, assignments from query data fail.

### Solution

- **Option A (recommended):** When setting form state from a loaded entity, coerce nullable to string with `?? ''`:

```ts
setEditBoard({ id: board.id, name: board.name ?? '' });
setEditList({ id: list.id, name: list.name ?? '' });
```

- **Option B:** Type the handler to accept nullable:

```ts
const handleEdit = (board: { id: string; name: string | null | undefined }) => {
  setEditBoard({ id: board.id, name: board.name ?? '' });
};
```

Use the same pattern for any field used in controlled inputs (title, description, etc.).

### Verification

`pnpm lint:types` passes; no "not assignable to type 'string'" errors when passing query results to forms or handlers.

---

## Phase 3: Optional fields `null` vs `undefined`

### Problem

You set optional form fields to `null`:

```ts
description: value.trim() ? value : null
```

TypeScript errors, or runtime schema rejects the value.

### Cause

Many generated input types treat optional fields as “omitted” rather than nullable. In TypeScript this means `string | undefined`, not `string | null`.

### Solution

Use `undefined` (or omit the field) when the user leaves it blank:

```ts
description: value.trim() ? value : undefined
```

### Verification

TypeScript compiles; mutation executes without input validation errors.

---

## Phase 3: orderBy enum value missing (e.g. `POSITION_ASC`)

### Problem

GraphQL rejects your orderBy:

```json
Value "POSITION_ASC" does not exist in "XxxOrderBy" enum.
```

### Cause

`XxxOrderBy` enums only contain values generated from available indexes / sortable fields.

### Solution

- Use a value that exists in the generated types (often `ID_ASC`, `ID_DESC`, `PRIMARY_KEY_ASC`, `NATURAL`).
- If you need position/created_at ordering, add the required index in provision, then regenerate schema/SDK.

### Verification

The query succeeds and results are ordered as expected.

---

## Phase 2.3: Blueprint delete_action format error (full string vs single char)

### Problem

When executing Blueprint provision, an error is thrown:

```
invalid input value for enum metaschema_modules_public.relation_delete_action: "CASCADE"
```

Or relation definitions are ignored.

### Cause

Blueprint JSON's `delete_action` field expects **single character abbreviations**, not full strings:

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `"CASCADE"` | `"c"` |
| `"SET NULL"` | `"n"` |
| `"RESTRICT"` | `"r"` |

### Solution

Modify `delete_action` for all relations in the `BlueprintDefinition`:

```typescript
const definition: BlueprintDefinition = {
  // ...
  relations: [
    {
      $type: 'RelationBelongsTo',
      source_table: 'items',
      target_table: 'categories',
      delete_action: 'c',
      is_required: true,
    },
  ],
};
```

Relations reference tables by name using `source_table` / `target_table`.

### Verification

Re-execute provision, relations are created correctly.

---

## Phase 2.3: Wrong SDK package

### Problem

Provision script throws `Cannot find module` errors or imports require `// @ts-ignore`.

### Solution

See [Phase 2.3: SDK package not found or wrong imports](#phase-23-sdk-package-not-found-or-wrong-imports) above. Use `@constructive-io/sdk` for all environments (Node.js and browser). See the `constructive-data-modeling` skill for full setup.

---

## Phase 3: SDK numeric fields are strings (not numbers)

### Problem

TypeScript reports:

```
Type 'string' is not assignable to type 'number'.
```

When using `parseFloat()` on SDK-returned numeric fields or expecting `number` type.

### Cause

The SDK's generated types define all numeric fields (`int4`, `float8`, `numeric`, etc.) as **`string`**, not `number`. This is to avoid JavaScript floating point precision issues.

### Solution

**Do not use `parseFloat()` or `parseInt()`**. Use strings directly:

```typescript
// ❌ Wrong
const dose = parseFloat(record.dosage);

// ✅ Correct
const dose = record.dosage;  // Type is string

// If you need to format for display
const display = `${record.dosage} mg`;

// If you need to calculate, convert when displaying
const total = Number(record.dosage) * Number(record.quantity);
```

### Verification

`pnpm lint:types` passes, numeric fields are handled as `string` type.

---

## Phase 3: Relation field names in selection (check generated code, don't guess)

### Problem

GraphQL queries return `undefined` for relation objects, even though relations are correctly created.

### Cause

Wrong field names used when selecting relation fields. Relation field names **vary by schema** and cannot be guessed.

Common error patterns:
- Assuming field names follow `xxxByXxxId` format
- Assuming field names are simplified singular forms
- Copying field names from other projects

### Solution

**Always find the correct field name from generated code:**

```bash
# Method 1: View type definitions in schema-types.ts
grep -B 2 -A 10 'export type YourTable' packages/app/src/graphql/*/app-public/schema-types.ts

# Method 2: View specific table fields
grep -E '^\s+\w+\??\s*:' packages/app/src/graphql/*/app-public/schema-types.ts | grep -i 'yourtable'

# Method 3: Use TypeScript autocomplete in IDE
# Type fields: { then wait for IntelliSense suggestions
```

**Example:** If you have an `items` table related to a `categories` table, the field name could be:
- `category` (simplified name)
- `categoryByCategoryId` (full name)
- `parentCategory` (custom name)

**Only generated code is the authoritative source.**

### Verification

Query returns relation object data, not `undefined`. TypeScript type checking passes.

---

## Adding a new issue

When you run into a new issue, add it using this format:

```markdown
## Phase X.X: Issue title

### Problem

Describe the issue and error messages in detail.

### Cause

Analyze the cause (if known).

### Solution

Provide one or more solutions with concrete commands.

### Verification

How to verify the issue is resolved.
```

---

## SDK codegen: "Unknown argument filter on field Query.xxx" error

### Problem

Runtime error in application:

```json
{
  "errors": [
    {
      "message": "Unknown argument \"filter\" on field \"Query.emails\". Did you mean \"after\"?"
    }
  ]
}
```

### Cause

`@constructive-io/graphql-codegen` **version 4.9.0 and earlier** has a bug where the generated SDK code incorrectly converts the `where` parameter to `filter`.

### Solution ✅ (Recommended)

**Upgrade `@constructive-io/graphql-codegen` to 4.21.2 or newer:**

```bash
cd packages/app
pnpm add -D @constructive-io/graphql-codegen@latest
pnpm codegen
```

### Solution (Temporary - older version workaround)

If you cannot upgrade, manually fix after codegen:

```bash
# Fix all SDK query-builder.ts files
sed -i '' "s/argName: 'filter'/argName: 'where'/g" packages/app/src/graphql/sdk/*/orm/query-builder.ts
```

Or add an auto-fix script in `package.json`:

```json
{
  "scripts": {
    "codegen": "... && npm run codegen:fix",
    "codegen:fix": "sed -i '' \"s/argName: 'filter'/argName: 'where'/g\" ./src/graphql/sdk/*/orm/query-builder.ts"
  }
}
```

### Verification

```bash
# Check version
grep "@constructive-io/graphql-codegen" packages/app/package.json
# Should be 4.21.2 or higher
```

Queries using the `where` parameter in the application no longer report "Unknown argument filter" errors.

---

## Phase 4 (live-QA): the QA driver false-PASSes/FAILs against the WRONG app (cross-run contamination)

### Problem

`scripts/live-qa.mjs` reports a verdict that doesn't match the app you brought up — a flow "passes" or "fails" but the screenshots/logs are clearly for a *different* app. Happens when another dogfood dev-server (a different app on a different port) is running at the same time, or one was left running from a prior run.

### Cause

`live-qa.mjs` drives a **persistent** `agent-browser` daemon. The daemon survives across runs, so it can hand the driver a **stale tab** belonging to another run's dev-server. The driver then interacts with that tab and reports a verdict for the wrong app.

### Solution

The driver now isolates the session itself — no action needed in the normal case:

1. **Session close at start.** `main()` runs `agent-browser close --all` before driving anything, dropping every stale/concurrent session. The first navigate opens a fresh session on the app under test.
2. **Origin guard.** `main()` pins the app-under-test origin (from `ctx.baseUrl`). `navigate()` then **refuses** to interact with a tab whose origin is a *different* http(s) app — it throws with both origins named — so a stale tab can never be silently driven. A blank/opaque tab (the daemon's pre-nav state, origin `null`) is allowed (it isn't a competing app).

Escape hatch for a deliberate multi-origin run:

```bash
LIVE_QA_ASSERT_ORIGIN=0 node scripts/live-qa.mjs   # disable the origin guard
```

### Verification

The driver's banner prints the isolation line:

```
isolate  closed prior agent-browser sessions; pinned app origin http://localhost:<port>
```

A grabbed-foreign-tab now fails LOUDLY instead of false-reporting:

```
live-QA refusing to navigate: the active browser tab is on origin http://localhost:3086,
  not the app under test (http://localhost:3084). A stale/concurrent agent-browser tab … was grabbed.
```

---

## Phase 4 (live-QA): a b2b/org app's first create is RLS-denied right after signup

### Problem

On the **b2b / org-membership tier**, the `email-password` flow signs up a fresh user and then immediately creates an org-scoped row (e.g. `createCompany` with `entity_id` = the user's personal org). That first create is RLS-denied ("new row violates row-level security policy"), so live-QA fails.

### Cause

This was an upstream gap: a fresh b2b signup got a `users` row and a public `org_memberships` row, but **not** the private `org_memberships_sprt` row the `AuthzEntityMembership` RLS reads, nor the `create_entity` bit (PLATFORM-GAPS GAP-1b/1c). **The platform now self-seeds the personal-org sprt row + grants the org tables and `create_entity` bit on signup (CLOSED 2026-06-15)**, so a fresh signup's first org-scoped create persists immediately with no reconcile step.

### Solution

Pull the current platform (constructive-db with GAP-1b/1c closed) and re-provision with the b2b preset. There is **no harness-side reconcile** anymore — the former post-signup org-reconcile hook was removed. A first-create RLS denial here is now a **real regression** (or a deployment predating the platform fix), not an expected gap: check that the platform self-seed landed.

```bash
# Confirm the platform seeded the signup actor's personal-org sprt row (actor_id = entity_id) with create_entity:
eval "$(pgpm env)"
psql -d constructive -c "SELECT count(*) FROM \"<db>-memberships-private\".org_memberships_sprt WHERE actor_id = entity_id;"
# Expect >= 1 per signed-up actor; createCompany(entityId = their user id) then persists end-to-end.
```

Minting a brand-NEW org via `createUser(type=2)` is still operator-only (PLATFORM-GAPS GAP-6, OPEN) — that is distinct from writing under your personal org.

---

## Phase 4 (live-QA): UPDATE/DELETE acts on the WRONG row on a non-empty table

### Problem

The `email-password` CRUD lifecycle edits or deletes a row that **isn't the one it just created**. Shows up when the entity's table already holds other rows (other tenants', or rows from a prior run) — the create + persist legs pass (they match by the created title), but UPDATE/DELETE mutate someone else's row.

### Cause

The edit/delete legs used a bare `clickTestid('<entity>-edit'/'-delete')`, which resolves `document.querySelector(...)` = the **FIRST** matching affordance. That equals the just-created row **only on a clean table**; on a populated table the first affordance belongs to a pre-existing row.

### Solution

The edit/delete clicks are now **scoped to the row whose label == the title the driver just created** (`clickRowAffordanceVerify`), generic for any entity:

- It finds the affordance whose **per-row container** (`data-testid="<entity>-row"`) carries the created title; that container is authoritative (it does NOT climb to a shared list/page wrapper, which would contain the title for every row and mis-match the first one).
- For list shapes with no per-row testid, it falls back to the smallest ancestor that contains the title **and** wraps exactly one such affordance.
- On a clean/single-row table (title not separately matched) it falls back to the first (= only) row — so the **frozen canary is unchanged**.

No configuration needed; it derives the row testid + title from the same values the create leg used.

### Verification

If multiple affordances exist but none scope to the created row, the driver logs a note (then falls back):

```
· note: 3 <entity>-edit affordances present but none scoped to our row "<title>" — fell back to the first row (row-text match missed)
```

A passing UPDATE/DELETE leg now provably mutated the created row (the post-reload assertion is title-scoped: the updated title appears / the deleted title is gone).
