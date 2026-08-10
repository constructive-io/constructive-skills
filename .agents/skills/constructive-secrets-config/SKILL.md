---
name: constructive-secrets-config
description: "Map of Constructive secrets and config plumbing: site-domain provisioning, email-services topology, secrets/KMS/API-key surface, realms (the nullable discriminator that lets one name hold many values and lets a consumer pick one), and the hub .env keys that matter. Load for email, secrets, realm, or env/config issues."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Secrets & Config — the one map for the scattered platform plumbing

> **Why this file exists.** Four kinds of "platform plumbing" — **site-domain provisioning**,
> the **email-services topology**, the **secrets / KMS / API-key surface**, and the **env vars / hub
> `.env` keys** an app actually needs — were each documented in *one* place buried in a much larger SoT.
> An agent that hits "Missing site configuration for email", or doesn't know which four ports email needs,
> or passes an `accessLevel` the `createApiKey` proc rejects, had to know exactly which file + line to
> open. This doc is the **single discoverable index**: it states the load-bearing fact inline and then
> **links back to the canonical SoT** for the full detail. It does **not** fork detail — when the SoT
> changes, this file points at it; it doesn't duplicate it.
>
> **Read this when:** you are wiring an app's `.env`, standing up email delivery, exercising any
> secret/API-key flow, or you hit one of the config errors named below. It is a **reference**, not a phase —
> nothing here is on the four-phase critical path for a basic no-email app.
>
> **This file is consume-only over the upstream runbooks it links.** The local-email-services Docker-Compose
> runbook lives in **`constructive-io/constructive`** (a different repo) — this file points at it, it does
> not re-host it.

---

## 0. Map (jump table)

| # | Area | One-line fact | Canonical SoT (full detail) |
|---|------|---------------|------------------------------|
| **1** | **Site-domain provisioning** | Email links resolve their site from `services_public.domains`; the per-DB provisioner makes API hosts but **no site-domain row** → `"Missing site configuration for email"`. The toolkit now backfills it hands-free. | `scripts/templates/provision/provision.ts` (the live backfill, §1 below) + `troubleshooting.md` → *"Post-Provision: Missing site configuration for email"* (by-hand fallback) |
| **2** | **Email-services topology** | Four services must all listen: **Mailpit 8025**, **Admin GraphQL 3002**, **send-email-link 8082**, **job-service** (no HTTP port). `SEND_EMAIL_LINK_DRY_RUN` must be `false`. | `SKILL.md` Optional-Extensions *"Email services"* row + `troubleshooting.md` → the four *Post-Provision (Email Services)* sections. Upstream runbook: **`constructive-io/constructive`** (Docker-Compose method). |
| **3** | **Secrets / KMS / API keys** | `config_secrets_module` backs API-key + secret storage. **`createApiKey` is step-up-gated server-side** and accepts only `accessLevel ∈ {read_only, full_access}` — other values raise `INVALID_ACCESS_LEVEL`. Reveal is one-time, step-up first. | `constructive-principals` (API-key lifecycle) + `constructive-auth` (step-up verification) |
| **4** | **Env vars / hub `.env` keys** | App `.env` points blocks at the per-DB endpoints (blocks read the **`_GRAPHQL_`** names). Query hostnames by `DATABASE_ID` (§4.3) — never string-build them. The shared hub server needs `API_IS_PUBLIC` / `API_ANON_ROLE` / `API_ROLE_NAME`. | `SKILL.md` S0/S3 (hub + app env) + `gotchas.md` BLOCKS-001 (the `_GRAPHQL_` name trap) + §4.3 below |
| **5** | **Realms** | Optional nullable `realm` field: one `name` holds many values (per region/tenant-app/user/channel), and an instance (`resource`/`functionDeployment`) selects a lane. `null` = the default lane; reads fall back exact→null. Never synthesize a realm (`realm ?? 'default'`). | `references/realms.md` (SDK/ORM view) + constructive-db `docs/architecture/realms.md` (internals) |

> **Known-defect status** for these areas is tracked internally; harness deployments layer a private
> known-gaps overlay on top of this skill with the current list. If a documented flow fails after the
> steps here are green, check that overlay (or ask the platform team) before assuming your wiring is wrong.

---

## 1. Site-domain provisioning (the `"Missing site configuration for email"` fix)

**The fact.** `send-email-link` resolves the outgoing link's *site* from
`services_public.domains JOIN services_public.sites`. The per-DB provisioner creates the **API** domains
(the `api-<sub>.localhost` data host) but **does not** create a `services_public` **site-domain** row.
With no row, every email send aborts with **`"Missing site configuration for email"`** — making the
email flows (magic-link / verify / reset / invite) un-exercisable.

**The fix is now baked in (hands-free).** `scripts/templates/provision/provision.ts` backfills the app's
own site-domain (`subdomain = <db-name>`, `domain = 'localhost'`), idempotently, **gated on
`SITE_DOMAIN_NEEDED`** (set by `scripts/scaffold-provision.mjs` `needsSiteDomain()` — true for any
non-minimal auth preset or any brief listing an email-sending flow). It then verifies the join returns a
row and warns loudly if it can't. So for any email-capable app the row provisions automatically — you should
**not** normally need the manual INSERT.

> **Gotcha baked into the template (don't regress it):** the `$1` param **must** carry explicit `::text`
> casts on **both** occurrences (the `SELECT`-list `subdomain` value *and* the `WHERE db.name` comparison).
> The `pg` driver sends the param untyped; Postgres deduces `$1`'s type independently at each position and
> aborts with *"inconsistent types deduced for parameter $1"* if they disagree. This is the `mail2`
> FLOW-QA fix — see the comment at `scripts/templates/provision/provision.ts` (≈L148–158).

**By-hand fallback** (only if the backfill warns/fails, or for a DB provisioned outside the toolkit) — the
canonical SQL lives in **`troubleshooting.md` → "Post-Provision: Missing site configuration for email"**:

```sql
-- Replace <your-db-name> with your database name. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO services_public.domains (database_id, site_id, subdomain, domain)
SELECT db.id, s.id, '<your-db-name>'::text, 'localhost'
FROM metaschema_public.database db
JOIN services_public.sites s ON s.database_id = db.id
WHERE db.name = '<your-db-name>'::text
ON CONFLICT (subdomain, domain) DO NOTHING;
```

Verify it landed (the join the email service relies on must return a row):

```sql
SELECT d.subdomain, d.domain
FROM services_public.domains d
JOIN services_public.sites s ON d.site_id = s.id
JOIN metaschema_public.database db ON d.database_id = db.id
WHERE db.name = '<your-db-name>';  -- should return a row
```

> If the verify returns **zero rows even after the INSERT**, the app DB has **no `services_public.sites`
> row** (the provisioner didn't create one) — email sends will still fail. That's a provisioning problem,
> not a missing-domain problem; confirm the DB was provisioned with a site.

---

## 2. Email-services topology (which processes must be listening)

Email delivery is an **Optional Extension** (was "Phase 2.4"), not a mainline phase — add it only when the
brief exercises email (verification, password reset, invitations). The canonical pointer is the
**`SKILL.md` Optional-Extensions "Email services" row**; the failure-mode detail is in `troubleshooting.md`
under the **Post-Provision (Email Services)** sections.

### 2.1 The four moving parts (all must be up)

| Service | Port | Check it's up | Role |
|---|---|---|---|
| **Mailpit** | **8025** (UI) / 1025 (SMTP) | `curl -s http://localhost:8025 \| head -5` | Local SMTP sink + web inbox — where delivered mail lands |
| **Admin GraphQL** | **3002** | `lsof -i:3002 \| grep LISTEN` | The private admin endpoint the email path calls (see start-command caveat below) |
| **send-email-link** | **8082** | `lsof -i:8082 \| grep LISTEN` | Renders + sends the actual email link |
| **job-service** | *(no HTTP port)* | `pgrep -f "knative-job-service"` | Drains the queue and calls send-email-link |

> **All four must be listening.** A missing piece is a *silent* failure — mail just never appears in
> Mailpit. The diagnostic ladder (which one is down, log paths, env) is in `troubleshooting.md` →
> *"Post-Provision: send-email-link not sending emails"* and *"…job-service not processing jobs"*.

### 2.2 The three settings people forget

- **`SEND_EMAIL_LINK_DRY_RUN=false`** — if `true`, emails are *logged but not sent*. (`troubleshooting.md`
  step 3 of the send-email-link section.)
- **`INTERNAL_GATEWAY_DEVELOPMENT_MAP`** — job-service must know where send-email-link lives:
  `export INTERNAL_GATEWAY_DEVELOPMENT_MAP='{"send-email-link":"http://localhost:8082"}'`
  (`troubleshooting.md`, job-service section).
- **Admin GraphQL `--origin "*"`** — `constructive server --port 3002` **without** `--origin` hangs waiting
  for an interactive CORS prompt (no TTY in agent/CI). Always pass `--origin "*"`. Full env-laden start
  command is in `troubleshooting.md` → *"Admin GraphQL Server (3002) hangs on startup"*.

> Note the Admin server's env differs from the public hub: it runs `API_IS_PUBLIC=false`,
> `API_ANON_ROLE=administrator`, `API_ROLE_NAME=administrator`, plus `API_ENABLE_SERVICES=true` and the
> `API_EXPOSED_SCHEMAS` / `API_META_SCHEMAS` admin schema lists (see §4 and `troubleshooting.md`).

### 2.3 Don't re-host the upstream runbook

The full **local-email-services** standup (Docker-Compose method, image set, wiring) lives in the
**`constructive-io/constructive`** repo — a *different* repo the build flow is consume-only over. Point at it;
do not copy it here. The `SKILL.md` "Email services" row already names it as the source.

### 2.4 Email defects that aren't yours

The site-domain prerequisite (§1) is deterministic; the email **send** path can additionally be affected
by platform-side issues outside the app's control. If email "doesn't work" after §1+§2 are green, check
the private known-gaps overlay (internal harness deployments) or ask the platform team before treating it
as an app/build-flow bug.

---

## 3. Secrets / KMS / API-key surface (`config_secrets_module`)

**Where it comes from.** Every auth-carrying preset (`auth:hardened` and up) provisions **`config_secrets_module`**
(visible in every flow's module list in `references/flow-catalog.md` / `references/flows.json`). It backs
the encrypted-at-rest secret storage that user **API keys** and secret **reveal** ride on. There is **no
extra module to add** for the API-key surface beyond a basic auth module list.

### 3.1 The `createApiKey` contract (get this wrong → runtime rejection)

Source of truth: **`references/flow-catalog.md` → "API keys" (`api-keys`)** + the `usage`/`wire` notes in
`references/flows.json` (the `api-keys` flow entry). The deployed proc enforces:

- **`accessLevel ∈ { 'read_only', 'full_access' }` — ONLY.** Any other value (e.g. `read` / `write` /
  `admin` / `required`) fails at runtime with **`INVALID_ACCESS_LEVEL`**.
  - ⚠️ **Block↔backend mismatch:** the shipped `auth-api-key-create-dialog` block presents an
    `accessLevelOptions` list of **`read`/`write`/`admin`**, which does **not** match the proc. **Constrain
    the UI to the two valid values** (`read_only`, `full_access`), or every create rejects.
- **`mfaLevel ∈ { 'none', 'verified' }`.**
- **`STEP_UP_REQUIRED` server-side** (defense-in-depth *beyond* the client gate). The
  `auth-api-key-create-dialog` runs the step-up first; if you call `createApiKey` **directly**, use the
  verify-and-retry pattern in
  [`constructive-principals` → api-keys.md § Step-up](../constructive-principals/references/api-keys.md#step-up-step_up_required),
  which also owns the `verifyPassword` result semantics.

### 3.2 Reveal is one-time + step-up-gated

The API-key / secret value is shown via a **one-time reveal modal** (`auth-api-key-created-modal`), and the
sensitive read is **step-up-gated** — the same `requireStepUp` / `verifyPassword` / `verifyTotp` surface the
**`step-up`** flow exposes (`references/flow-catalog.md` → "Step-up verification"). Mount the `StepUpProvider`
once at the app root (the `api-keys` flow's `wire` snippet shows this). Treat the revealed value as
show-once; there is no second reveal.

### 3.3 Verify revocation, don't just trust the return value

After `revokeApiKey`, verify the key is actually rejected before presenting "revoked" as a terminal,
enforced state in the UI — treat the mutation's `true` as "request recorded" and confirm enforcement
with a follow-up call using the key.

---

## 4. Env vars / hub `.env` keys that matter

Two distinct env scopes. Don't conflate them.

### 4.1 The shared hub server (`:3000`) — `API_*` knobs

The warm public server (api/auth/modules on `:3000`) is launched with (`SKILL.md` **S0**):

```
API_IS_PUBLIC=true   API_ANON_ROLE=anonymous   API_ROLE_NAME=authenticated   + the hub .env
```

- **`API_IS_PUBLIC`** — `true` for the public hub; `false` for the private **Admin** server (§2.2).
- **`API_ANON_ROLE`** — the Postgres role for unauthenticated requests (`anonymous` on the hub;
  `administrator` on the admin server).
- **`API_ROLE_NAME`** — the authenticated role (`authenticated` on the hub; `administrator` on admin).
- If `:3000` OOMs under multi-DB load, relaunch with `NODE_OPTIONS=--max-old-space-size=8192` (S0) —
  a mitigation for per-DB handler-cache memory growth, not a fix.

### 4.2 The generated app's `.env` / `.env.local` — per-DB endpoints

Source of truth: **`SKILL.md` S3** (and `scripts/wire-app.mjs`, which writes both files). Write env to
**BOTH** `<app>/.env` (codegen reads it) **and** `<app>/.env.local` (`pnpm dev` reads it), kept identical.
The **key names** are the contract; the **hostname values** come from §4.3 — `<sub>` is whatever the
platform assigned, never the app slug by assumption:

```bash
NEXT_PUBLIC_DB_NAME=<sub>
NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT=http://auth-<sub>.localhost:3000/graphql   # users / auth
NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT=http://admin-<sub>.localhost:3000/graphql # orgs / members
NEXT_PUBLIC_APP_ENDPOINT=http://api-<sub>.localhost:3000/graphql             # runtime app DATA = api-<sub>
CODEGEN_APP_ENDPOINT=http://api-<sub>.localhost:3000/graphql                 # codegen app DATA URL
CODEGEN_APP_HOST=api-<sub>.localhost                                         # codegen Host header
```

> 🚨 **Two traps that silently no-op the whole app:**
> - **`api-<sub>`, NOT `app-public-<sub>`.** App data reads/writes route on **`api-<sub>`**; the
>   `app-public-<sub>` host is **dead**. Routing is by the request's **`Host`** header — the URL alone is
>   necessary but not sufficient. (`SKILL.md` ≈L264–273, `gotchas.md` SUBDOMAIN-001 / F2.)
> - **Blocks read the `_GRAPHQL_`-infix names.** `blocks-runtime.tsx` reads
>   `NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT` / `NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT` — **different names** from the
>   template's `NEXT_PUBLIC_AUTH_ENDPOINT` / `NEXT_PUBLIC_ADMIN_ENDPOINT`. Set the `_GRAPHQL_` names too, or
>   every block request no-ops with `Missing NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT`. (`gotchas.md` **BLOCKS-001**.)

### 4.3 Query your endpoints — never derive hostnames

Databases may have **random pool-assigned names** (e.g. `b16-fatal-rose-mosquito`), so never string-build
hostnames from the app name. Query them by the `.env` `DATABASE_ID` instead:

```typescript
// Registered hostnames for this database
const domains = await db.domain.findMany({
  where: { databaseId: process.env.DATABASE_ID },
  select: { hostname: true, isPublished: true }
}).execute();

// The API surfaces they bind to
const apis = await db.api.findMany({
  where: { databaseId: process.env.DATABASE_ID },
  select: { id: true, name: true, isPublished: true }
}).execute();

// Verify a hostname resolves the way the server will
const route = await db.query.resolveRoute({
  requestHost: hostname, requestPath: '/', requestMethod: null
}).execute();
```

Then write the returned hostnames into the §4.2 `.env` keys.

> **Auth is per-DB, not the platform token.** A `schema-builder` / platform token does **not** authenticate
> per-DB data calls. Sign up / sign in against the **tenant** `auth-<sub>.localhost` endpoint (not base
> `auth.localhost`) and send *that* session token to `api-<sub>`. (`gotchas.md` ≈L314–329; FK prereq for
> owner-scoped tables: the authed user must exist in-tenant — RLS-POLICY-001.)

---

## Realms (the `realm` discriminator)

A **realm** is an optional nullable field that lets one logical `name` hold many
values (storage discriminator) and lets an instance choose which value it consumes
(consumption selector). `null` is the *default lane*, not "missing" — reads resolve
an exact realm match first, then fall back to the `null`-realm value. There is no
default realm string; omit it for the ordinary single-value case, and never
synthesize one (`realm ?? 'default'`). Two consumption modes: **projection**
(set `realm` on a `resource`/`functionDeployment`, values baked in at deploy) and
**runtime query** (leave it `null`, fetch the realm of each entity on demand — the
push worker). Full SDK/ORM detail in `references/realms.md`; the DB-level mechanics
(uniqueness with `NULLS NOT DISTINCT`, getter fallback, requirements gate,
`register_push_channel`, cloud-function runtime lookup) live in constructive-db
`docs/architecture/realms.md`.

---

## See also (canonical SoTs — full detail lives in these, not here)

- **`scripts/templates/provision/provision.ts`** — the live site-domain backfill (§1) + the `$1::text` cast.
- **`troubleshooting.md`** — Post-Provision (Email Services): Mailpit / Admin-3002 / send-email-link /
  "Missing site configuration for email" / job-service (§1 fallback + §2).
- **`SKILL.md`** — S0/S3 env (§4) + the Optional-Extensions "Email services" row (§2).
- **`references/flow-catalog.md`** + **`references/flows.json`** — the `api-keys` + `step-up` flow contracts
  (§3): exact ops, blocks, `accessLevel`/`mfaLevel`/step-up rules.
- **`gotchas.md`** — BLOCKS-001 (`_GRAPHQL_` names), SUBDOMAIN-001 / F2 (`api-<sub>` not `app-public-`),
  RLS-POLICY-001 (tenant-endpoint FK prereq).
- **Upstream (different repo):** `constructive-io/constructive` — the local-email-services Docker-Compose
  runbook (§2.3). Not re-hosted here.
- **`references/realms.md`** — the SDK/ORM view of realms (§5); DB-level internals in constructive-db
  `docs/architecture/realms.md`.
