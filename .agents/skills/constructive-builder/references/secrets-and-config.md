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
| **3** | **Secrets / KMS / API keys** | `config_secrets_module` backs API-key + secret storage. **`createApiKey` is step-up-gated server-side** and accepts only `accessLevel ∈ {read_only, full_access}` — other values raise `INVALID_ACCESS_LEVEL`. Reveal is one-time, step-up first. | `references/flow-catalog.md` → *API keys* + *Step-up verification* (the deployed contract) + `platform-gaps.md` GAP-3 (revoke is a no-op) |
| **4** | **Env vars / hub `.env` keys** | App `.env` points blocks at the per-DB `auth-/admin-/api-<sub>` endpoints (blocks read the **`_GRAPHQL_`** names). The shared hub server needs `API_IS_PUBLIC` / `API_ANON_ROLE` / `API_ROLE_NAME`. | `SKILL.md` S0/S3 (hub + app env) + `gotchas.md` BLOCKS-001 (the `_GRAPHQL_` name trap) |

> **Cross-reference for confirmed-live defects** in any of these areas: `platform-gaps.md` (the build-flow gap log)
> and `planning/upstream-gaps-stress-test-2026-06-05.md` (G1–G10 escalations). The email/account surface in
> particular has live upstream gaps (GAP-9 send raises, GAP-10 deletion-email no-op) — see §2.4 and §3.3.

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

### 2.4 Live upstream email defects (don't chase these as your bug)

The site-domain prerequisite (§1) is fixed, but the email **send** path still has confirmed upstream gaps
the build flow cannot work around — see `platform-gaps.md` GAP-9/GAP-10 and
`planning/upstream-gaps-stress-test-2026-06-05.md` G7–G10:

- **GAP-9 (HIGH):** `sendVerificationEmail` **raises before enqueue** —
  `…store-private.user_secrets_del(uuid, text[]) does not exist` (signature mismatch). Email-verification
  is unreachable; **not** an app/build-flow bug.
- **GAP-10 (MEDIUM):** `sendAccountDeletionEmail` returns **HTTP 200 with nothing delivered** (silent
  no-op) even with a verified email. The client + step-up path are correct; the backend doesn't send.
- **GAP-12 (LOW):** reset email link carries `?reset_token=` but the reset block reads `?token=`, and
  reset-success redirects to `/auth/sign-in` (a generated app mounts `/sign-in`). The QA driver bridges the
  param for tests; the generated app's link/redirect still mismatch.

If email "doesn't work" after §1+§2 are green, check these before assuming your wiring is wrong.

---

## 3. Secrets / KMS / API-key surface (`config_secrets_module`)

**Where it comes from.** Every auth preset (`auth:email` and up) provisions **`config_secrets_module`**
(visible in every flow's module list in `references/flow-catalog.md` / `references/flows.json`). It backs
the encrypted-at-rest secret storage that user **API keys** and secret **reveal** ride on. There is **no
extra module to add** for the API-key surface beyond `auth:email`.

### 3.1 The `createApiKey` contract (get this wrong → runtime rejection)

Source of truth: **`references/flow-catalog.md` → "API keys" (`api-keys`)** + the `usage`/`wire` notes in
`references/flows.json` (the `api-keys` flow entry). The deployed proc enforces:

- **`accessLevel ∈ { 'read_only', 'full_access' }` — ONLY.** Any other value (e.g. `read` / `write` /
  `admin` / `required`) fails at runtime with **`INVALID_ACCESS_LEVEL`**.
  - ⚠️ **Block↔backend mismatch:** the shipped `auth-api-key-create-dialog` block presents an
    `accessLevelOptions` list of **`read`/`write`/`admin`**, which does **not** match the proc. **Constrain
    the UI to the two valid values** (`read_only`, `full_access`), or every create rejects.
- **`mfaLevel ∈ { 'none', 'verified' }`.**
- **`STEP_UP_REQUIRED` server-side.** A `verifyPassword` on the **same session** must precede the create
  (defense-in-depth *beyond* the client gate). The `auth-api-key-create-dialog` runs that step-up first; if
  you call `createApiKey` **directly**, complete `verifyPassword` before the mutation or it rejects.

### 3.2 Reveal is one-time + step-up-gated

The API-key / secret value is shown via a **one-time reveal modal** (`auth-api-key-created-modal`), and the
sensitive read is **step-up-gated** — the same `requireStepUp` / `verifyPassword` / `verifyTotp` surface the
**`step-up`** flow exposes (`references/flow-catalog.md` → "Step-up verification"). Mount the `StepUpProvider`
once at the app root (the `api-keys` flow's `wire` snippet shows this). Treat the revealed value as
show-once; there is no second reveal.

### 3.3 Known backend limitation (don't surface "revoked" as terminal)

**`revokeApiKey` is a no-op on the key itself** — it returns `true` and writes an audit-log entry but
**never sets `revoked_at`**, so the key keeps working (`platform-gaps.md` **GAP-3** /
`references/flow-catalog.md` "Known backend limitation"). Treat its `true` as *"audit recorded"*, **not**
proof of revocation; do not present "revoked" as a terminal, enforced state in the UI.

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
- If `:3000` OOMs under multi-DB load, relaunch with `NODE_OPTIONS=--max-old-space-size=8192` (S0). The
  unbounded per-DB handler cache is the root cause — `platform-gaps.md` GAP-7 /
  `planning/upstream-gaps-stress-test-2026-06-05.md` G3 (upstream; the heap bump is mitigation, not a fix).

### 4.2 The generated app's `.env` / `.env.local` — per-DB endpoints

Source of truth: **`SKILL.md` S3** (and `scripts/wire-app.mjs`, which writes both files). Write env to
**BOTH** `<app>/.env` (codegen reads it) **and** `<app>/.env.local` (`pnpm dev` reads it), kept identical.
Replace `<sub>` with your subdomain:

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

> **Auth is per-DB, not the platform token.** A `schema-builder` / platform token does **not** authenticate
> per-DB data calls. Sign up / sign in against the **tenant** `auth-<sub>.localhost` endpoint (not base
> `auth.localhost`) and send *that* session token to `api-<sub>`. (`gotchas.md` ≈L314–329; FK prereq for
> owner-scoped tables: the authed user must exist in-tenant — RLS-POLICY-001.)

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
- **`platform-gaps.md`** + **`planning/upstream-gaps-stress-test-2026-06-05.md`** — confirmed-live upstream
  defects touching these areas: GAP-3 (revoke no-op), GAP-7/G3 (`:3000` OOM), GAP-9/G7 (verify send raises),
  GAP-10/G8 (deletion-email no-op), GAP-12/G10 (reset param/redirect).
- **Upstream (different repo):** `constructive-io/constructive` — the local-email-services Docker-Compose
  runbook (§2.3). Not re-hosted here.
