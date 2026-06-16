# Error Index — symptom string → fix pointer

A flat lookup from the **literal error string / symptom an agent sees** to a one-line cause and a
**pointer to the authoritative fix** (a gotcha CODE, a `troubleshooting.md` section, or a
`platform-gaps.md` GAP-N). It is a **router, not a second copy of the fix** — follow the pointer to the
source-of-truth entry; the full recipe lives there and only there.

**How to use:** Ctrl-F the exact string you got back (error code, `errorDetails`, webpack message, or the
one-line symptom). Match the row → open the cited SoT entry → apply it. If nothing matches, fall back to the
normal failure protocol (AGENTS.md → Error Handling: `grep "Phase X" troubleshooting.md`, then report).

> **Where the SoT entries live** (all paths relative to the toolkit root):
> `gotchas.md` (CODE anchors like `RLS-POLICY-001`), `troubleshooting.md` (per-phase `## Phase X: …`
> sections), `platform-gaps.md` (`## GAP-N …` — confirmed-live upstream gaps), `SKILL.md` (the `S0…S7`
> setup steps). "→" in the **Fix pointer** column means "go read this; do not re-paste it here."

---

## Backend / blueprint / RLS

| You see (literal string / symptom) | One-line cause | Fix pointer (authoritative SoT) |
|---|---|---|
| `constructBlueprint` → `status: failed`, `errorDetails: "NOT_FOUND (memberships_module)"` (table **never created**, hard abort — not a 0-row) | A table used `AuthzEntityMembership` (org-scoped SPRT) on an **org-less** `auth:email` app where that module doesn't exist | → gotchas **`RLS-POLICY-001`** (default org-less tables to **`AuthzDirectOwner`**, not entity-membership) · full repro+fix in troubleshooting **`## Phase 2.3: constructBlueprint fails with NOT_FOUND (memberships_module)`** |
| `NOT_FOUND (memberships_module)` while **installing a scoped module** (the module installs *not at all*) | A scope-aware module was passed as a `name:scope` **colon string** instead of a `["name", { scope }]` **tuple** | → gotchas note "**Scoped modules are TUPLES, not colon strings**" (pass `flows.json`'s native tuples verbatim) |
| `MISSING_REQUIRED_FIELD` on an `AuthzDirectOwner` table | Used `owner_field` as the config key — `AuthzDirectOwner`'s key is **`entity_field`** | → gotchas **`RLS-POLICY-001`** (`entity_field` is the owner column; `owner_field` belongs to other authz types) |
| `updateUser` returns **HTTP 200 but does not persist** (silent no-op; 200-but-0-rows on the `users` table) | The per-tenant `users` table lacks the `authenticated` **UPDATE** self-policy the basic provision skips | → gotchas **`RLS-USERS-UPDATE-001`** · troubleshooting **`## Phase 3: updateUser returns 200 but does not persist`** · executable reconcile: `scripts/fix-grants.sh <db>` (SKILL.md S2 step 3) |
| **Org-scoped INSERT / member write RLS-rejected** for a fresh signup on a **b2b** tenant (200-but-0-rows on an org/`AuthzEntityMembership` table; can't create org / add member) | The per-tenant provisioner omits the org-table `authenticated` grants/policies, the `create_entity` perm bit, and the personal-org seed row | → gotchas **`RLS-ORG-RECONCILE-001`** (org counterpart of the users recipe) · `platform-gaps.md` **GAP-1b / GAP-1c** · executable stopgap: `scripts/fix-org-grants.sh <db>` |
| Table **constructs but silently denies all CRUD** (0 rows, no error) on an `AuthzAppMembership` table | The actor's `app_membership` is not yet `is_approved`/`is_active`/`is_verified = TRUE` | → gotchas **`RLS-POLICY-001`** (`AuthzAppMembership` note — prefer `AuthzDirectOwner`, or add the post-provision approval UPDATE) |
| M:N junction rows are **unexpectedly world-readable / writable** (nested security didn't apply) | `RelationManyToMany` drops the junction's nested `data.{nodes,policy_type,grants}` — the join table isn't secured | → `platform-gaps.md` **GAP-1d** (M:N junction security not forwarded) |
| Text `defaultValue` rejected / treated as a column ref (e.g. `pending` not quoted) | Blueprint `defaultValue` is raw SQL — a text literal must be single-quoted **inside** the JSON | → gotchas **`FIELD-TYPE-001`** |
| `createUser(type=2 Organization)` is **RLS-denied** for an authenticated session (no org can be minted) | Authenticated sessions can't mint an org row at all (distinct from the entity-write gaps) | → `platform-gaps.md` **GAP-6** |

## Auth / sessions / API keys / step-up

| You see (literal string / symptom) | One-line cause | Fix pointer (authoritative SoT) |
|---|---|---|
| `INVALID_ACCESS_LEVEL` from `createApiKey` (e.g. when the block sends `read`/`write`/`admin`) | **Block↔backend contract gap:** `auth-api-key-create-dialog` ships `accessLevelOptions` `read`/`write`/`admin`, but the **live `createApiKey` only accepts `read_only` / `full_access`** | Map the dialog value to the live domain: send **`read_only`** or **`full_access`** only. NEW/uncatalogued upstream — confirmed live in the FV4 step-up verification (block `accessLevelOptions` ≠ server domain). No SoT recipe yet; this row is the pointer. |
| `STEP_UP_REQUIRED` from `createApiKey` (or another sensitive mutation) even though the UI looked authed | The mutation is **step-up-gated server-side** (defense-in-depth, beyond the client gate) — a recent re-auth is required | Satisfy the step-up first: drive the **`auth-step-up-dialog`** → `verifyPassword` → retry the gated mutation (this is exactly what the step-up flow does). Server-enforced; client gating alone is not enough. Confirmed live in the FV4 step-up verification. |
| `verifyPassword` returns `null` on the **correct** password (step-up never clears) | Historically a `verifyPassword` `sess.user_agent` defect (D1) — **confirmed FIXED** upstream (correct→`{result:true}` HTTP 200, wrong→`null`) | If reproduced on a current hub: re-verify the hub is up to date; the canonical write-up is the FV4 step-up verification (D1) + the step-up flow in `references/flow-catalog.md`. |
| `revokeSession(id)` → **`SESSION_NOT_FOUND`** when passed the id from a `signUp`/`signIn` result | UUIDv5 (auth-result id) vs UUIDv7 (session row id) mismatch — the result id doesn't target the live session row | → `platform-gaps.md` **GAP-2** (`revokeSession` uncallable from the auth result) |
| `revokeApiKey` returns **`true`** but the key **keeps working** (`revoked_at` never set) | Silent partial write — the proc audit-logs + returns success but doesn't set `revoked_at` | → `platform-gaps.md` **GAP-3** (`revokeApiKey` silent partial write) |
| `useSignOutMutation` fails to **parse/validate** at request time (invalid GraphQL document) | Codegen emits `signOut` with **no subfield selection** on a composite return type (or a scalar selected with subfields) | → `platform-gaps.md` **GAP-4** (`useSignOutMutation` invalid GraphQL) |
| `forgot-password-card` / `sign-out-button` block submits an **empty GraphQL selection** | The published **dashboard-blocks** ship an empty selection (different upstream repo; consume-only) | → `platform-gaps.md` **GAP-11** (empty GraphQL selection in dashboard-blocks) |

## Email / account surface

| You see (literal string / symptom) | One-line cause | Fix pointer (authoritative SoT) |
|---|---|---|
| On a fresh signup, `sendVerificationEmail` raises `function …store-private.user_secrets_del(uuid, text[]) does not exist` (Mailpit stays empty; the whole mutation aborts) | Signature/overload mismatch — proc deployed as `(uuid, text)` but the verify-send path calls it with `(uuid, text[])` | → `platform-gaps.md` **GAP-9** (the real email-verify blocker). **No build-flow workaround** — server-side proc; escalation in `planning/upstream-gaps-stress-test-2026-06-05.md` → G7 |
| `"Missing site configuration for email"` on email send | The per-tenant site-domain row wasn't provisioned/cast | **FIXED** upstream (`provision.ts` casts `$1::text`; the row provisions hands-free). If it still appears, see the GAP-9 note (this error is now superseded by GAP-9) + troubleshooting **Post-Provision (Email Services)** |
| `sendAccountDeletionEmail` returns **HTTP 200 but nothing is delivered** | Silent no-op — no message ever enqueues | → `platform-gaps.md` **GAP-10** (`sendAccountDeletionEmail` silent no-op) |
| Reset link rejected / reset-success redirect lands wrong | Reset-link param name + success-redirect target mismatch (minor) | → `platform-gaps.md` **GAP-12** (reset link param + redirect mismatch) |

## Frontend / scaffold / codegen

| You see (literal string / symptom) | One-line cause | Fix pointer (authoritative SoT) |
|---|---|---|
| `Export X doesn't exist` webpack export-resolution errors at `next build` (e.g. ~24 org symbols: `useCreateOrgInviteMutation`, `fetchOrgMembershipsQuery`, … — **NOT** suppressible by `next.config`) | **Tier mismatch:** the app carries the **b2b org UI** (those `@sdk/admin` org symbols) but codegen ran against an `auth:email` schema that never emits them. The default sandbox-templates `main` template is now **`auth:email`-tiered** (tiering merged via sandbox-templates PR #25), so a base app no longer emits these; you hit this only when the b2b tier and the provisioned modules disagree. | → SKILL.md **S3** — make tier match: for a base app scaffold the default (`pgpm init --repo constructive-io/sandbox-templates --template nextjs/constructive-app`, **no `--from-branch`**); for a b2b app **provision the `b2b` org modules** so the org symbols exist. `--from-branch <branch>` is only an OPTIONAL pin to a specific template revision. |
| Next.js **500** after `start` / can't find `@<app>/sdk/dist/...` (`@sdk/*` unresolved) | Generated SDK output missing or workspace path not resolved (codegen not run / not wired) | → troubleshooting **Phase 2.5** ("Next.js 500 after start") + **Phase 3** ("Next.js cannot find `@<app>/sdk/dist/...`") · prefer generating the SDK **inside** the app |
| `__dirname` is `undefined` in an ESM script | ESM has no `__dirname` | → troubleshooting **Phase 2.3** (`__dirname` undefined in ESM scripts) |
| Hooks/codegen type errors: SDK result fields nullable, `orderBy` enum value missing, "No QueryClient set", hook input-wrapper / `select` vs `selection.fields` | Generated-SDK usage mismatches (nullable fields, enum names, react-query instance, hook arg shape) | → troubleshooting **Phase 3** (the corresponding bullet under the Phase-3 Quick Index) |

## Infra / build-flow operability

| You see (literal string / symptom) | One-line cause | Fix pointer (authoritative SoT) |
|---|---|---|
| cnc server **OOM**: `FATAL ERROR: Reached heap limit Allocation failed` (V8 bottoms out in **`Runtime_MapGrow`**); a build loses SDK gen / dies mid-codegen under multi-tenant load | Unbounded per-DB PostGraphile handler-cache `Map` — a leak with no ceiling; the more distinct tenant DBs served, the closer to OOM | → `platform-gaps.md` **GAP-7** (durable fix = LRU/TTL eviction, upstream). **Build-flow mitigation:** restart `:3000` **once** with `--max-old-space-size=8192` per SKILL.md **S0** (`golden-path.sh`/`genericity-check.sh` self-heal this) |
| Shared `:3000` returns **`000`** / non-200 / hangs even when "told it's running" (prior runs lost 240–300s here) | The warm hub is down or heap-fragile (often the GAP-7 OOM) | → SKILL.md **S0** (smoke `:3000` first; restart-once with the 8 GB heap, then re-curl) |
| `curl` to the GraphQL server returns `000` or hangs (connection failure / timeout), DB-side | Backend not deployed / Postgres container down | → troubleshooting **Phase 1: GraphQL Server not responding** + **General: Docker Postgres issues** |
| GraphQL server returns HTML **"Not Found"** | Wrong endpoint/Host — the live DATA env must target `api-<sub>` | → troubleshooting **Phase 1: GraphQL Server returns HTML "Not Found"** (and SKILL.md S3 api-`<sub>` endpoints) |
| `pnpm dev` server intermittently 500s with a **`global-error.js`** module-instantiation error (works on a fresh `pnpm install`, then breaks) | **Dual Next from a nested workspace:** the `nextjs/constructive-app` template ships its own `pnpm-workspace.yaml` + `pnpm-lock.yaml` that `pgpm init` unpacks under `packages/app`; the nested lockfile pins a **second** Next, so two Next copies get instantiated | → SKILL.md **S3** — `wire-app.mjs` (step 0) strips any nested `packages/*/pnpm-workspace.yaml` + `pnpm-lock.yaml` so ONE root workspace + ONE Next resolve. Re-run `node scripts/wire-app.mjs --app <app> --sub <sub>`, then a single root `pnpm install`. Full note: `references/phase-3-frontend-sdk.md` step 2 (Workspace registration). |

---

> **Maintenance:** this index is a **pointer table** — when you fix a defect or add a gotcha, update the SoT
> entry (`gotchas.md` / `troubleshooting.md` / `platform-gaps.md`) **first**, then add/repoint a one-line row
> here. Never let a fix live **only** in this file; the row must always cite a CODE / Phase section / GAP-N.
> The `INVALID_ACCESS_LEVEL` and `STEP_UP_REQUIRED` rows are the current exceptions (no SoT recipe yet,
> sourced from the FV4 step-up verification) — when they earn a gotcha/GAP entry, repoint those rows to it.
