# Platform Gaps — escalation for the constructive-db / constructive team

> **Scope:** this is the upstream-gap **ledger** for the builder. The live-QA layer's
> "documented-partial" taxonomy depends on it — a flow whose failure maps to a GAP-N here is reported as a
> *known upstream partial*, not a build defect, so live-QA stays green on documented gaps. Keep every
> `GAP-N` entry, the `createApiKey` `accessLevel` note, and the four backend-blocked flows intact; they are
> the canonical list the evaluator and `live-qa.mjs` reconcile against.

> **Audience:** the constructive-db (PostgreSQL framework) + constructive (cnc/PostGraphile/codegen) teams.
> **Why this exists:** the agentic-flow harness builds Constructive apps end-to-end against a live hub. The
> items below are a class of defect the **harness cannot fix** — they live in the per-tenant provisioner,
> the deployed auth procs, or codegen, and every harness "workaround" for them is a band-aid the next app
> author has to re-discover. They share one nasty property: **they fail SILENTLY** (HTTP 200, `true`, or a
> green build) while doing nothing, so they read as "my app is wrong" instead of "the platform no-opped".
>
> The harness is **consume-only** w.r.t. constructive-db/constructive (it never edits them), so these can
> only be closed upstream. For each gap below: **symptom**, **root** (proc/path where known), and the
> **current harness workaround** (so the cost of leaving it unfixed is visible).
>
> Scope note: this is **not** a list of harness bugs. Tiering (base `auth:email` vs opt-in b2b) and the
> blueprint/grant/policy guidance are all reconciled in the harness already. What remains here is upstream.
>
> **2026-06-05 stress-test escalation:** the generic-brief stress run (`.scratch-stress/{townboard,orgdesk,
> devvault,mailflow}`) added **GAP-1d** (M:N junction security not forwarded), **GAP-6** (`createUser(type=2)`
> org-create RLS), **GAP-7** (OOM handler-cache leak), a **`constructBlueprint` idempotency** note under
> GAP-1, a **GAP-2** re-confirm (missing `userSessions` list + session table split), and **GAP-8** (read-only/
> soft-delete semantics). Their full owner/severity/close-out write-up lives in the upstream-escalation
> doc **`planning/upstream-gaps-stress-test-2026-06-05.md`** (an upstream-team artifact, not part of this
> skill); the entries below are the standard-channel pointers into it.
>
> **2026-06-05 Wave-2 fix-validation escalation:** two FRESH builds against the FIXED harness — **`mail2`**
> (`auth:email`, the EMAIL flows) and **`desk2`** (b2b / M:N) — cleared the site-domain prerequisite (now
> hands-free via the `provision.ts` `$1::text` cast) and surfaced **four NEW upstream defects** on the EMAIL/
> account surface: **GAP-9** (`sendVerificationEmail` aborts on `user_secrets_del(uuid, text[])` — the *real*
> email-verify blocker), **GAP-10** (`sendAccountDeletionEmail` silent no-op), **GAP-11** (dashboard-blocks
> `forgot-password-card` + `sign-out-button` ship an empty GraphQL selection — *different repo*), and **GAP-12**
> (reset link `reset_token` vs block `token` + reset-success `/auth/sign-in` 404, minor). Wave-2 also **CONFIRMED
> LIVE** `GAP-1d` (and the harness now ships a FUNCTIONAL `AuthzAllowAll` junction stopgap — see GAP-1d below)
> and `GAP-6` (create-org RLS-denied via BOTH the block and the direct API). Evidence: `build/mail2/run-state.json`
> + `build/desk2/run-state.json`. Full write-up: same planning doc → **G7–G10** (new) + **G1 / G2** (Wave-2
> confirmations).

---

## GAP-1 — Per-tenant module-table provisioner omits `authenticated` DML grants + RLS policies (the silent-no-op engine)

**This is the big one and the parent of several "D2"-class findings.** When a database is provisioned with
a module set, the dynamic per-tenant provisioner stands up the module-owned tables (`users`,
`org_memberships`, `org_member_profiles`, `app_memberships`, …) with **RLS enabled** but **without the
`authenticated`-role DML grants and the matching write policies** that the *static seed schema* has. The
result is a table that exists, accepts a query, and returns **200 / 0 rows** (or silently drops a write)
for every authenticated caller — no error, no log line that points at the cause.

Three concrete faces of the same gap:

### 1a. `users` table — missing UPDATE policy (`updateUser` is a silent no-op)
- **Symptom:** `updateUser` (profile edit, display name, avatar) returns **HTTP 200 but persists 0 rows**.
- **Root (historical):** the dynamic provisioner used to enable RLS + a *column* UPDATE grant to
  `authenticated` (username/display_name/profile_picture) on the per-tenant `users` table but emit **only
  the `auth_sel_self_update` SELECT policy and no UPDATE policy** (`auth_<verb>_<policytype>`, no hash
  suffix). RLS then rejected every UPDATE. The **static** seed schema had `auth_upd_self_update` /
  `auth_upd_admin_updates`; the **dynamic** path omitted them.
- **Status — CLOSED (2026-06-15):** the platform now emits the `users` self-UPDATE policy
  (`auth_upd_self_update`, `USING id = jwt_public.current_user_id()`) natively for an auth preset, so
  `updateUser` persists end-to-end with no extra step. Documented as gotchas **RLS-USERS-UPDATE-001**. On a
  deployment predating the fix, the control-plane `createSecureTableProvision` step (an `AuthzDirectOwner`
  UPDATE policy, `policy_name: self_update`, `entity_field: id`) in the `provision.ts` template / SKILL.md
  S2 step 3 re-adds it.

### 1b. Org module tables — missing INSERT/UPDATE/SELECT grants + policies AND no personal-org seed row (org create + member writes RLS-denied for a fresh email-password signup)
- **Symptom:** with the `b2b` preset provisioned, a **fresh email-password signup** that then tries to
  `createUser(type=2)` / `OrgCreateCard` is RLS-denied, and org member writes (`org_memberships`) / profile
  reads (`org_member_profiles`) come back empty — even though auth works and the user is an approved app
  member. The deepest face: an `AuthzEntityMembership(membership_type:2)` INSERT on an org-scoped business
  table (e.g. a CRM `companies`/`contacts` row keyed by `entity_id = <org>`) is **RLS-rejected** because the
  signup has **no personal-org membership row to scope against** — the new user is a member of no org, so the
  membership policy's `USING`/`WITH CHECK` matches nothing and the write is denied.
- **Root:** *two* upstream omissions, both on the dynamic provision / `sign_up` path:
  1. **Grants/policies (same class as 1a).** The org rows live in the unified user model (`users` with
     `type=2`); the per-tenant provisioner does not grant `authenticated` INSERT/UPDATE on the tenant
     `users` table for org rows, nor INSERT/UPDATE on `org_memberships`, nor SELECT on
     `org_member_profiles` — and it omits the matching write **policies**. The **static** seed schema ships
     these; the **dynamic** path omits them.
  2. **No personal-org seed row.** `sign_up` / the per-tenant provisioner do **not** create the new user's
     **personal-org** membership row in `<db>-memberships-private.org_memberships_sprt`
     (`actor_id = entity_id = user_id`). A fresh email-password signup therefore belongs to **zero** orgs, so
     every `AuthzEntityMembership(membership_type:2)` write (the b2b business-table INSERT path) has no
     membership to satisfy and is RLS-denied. This is the root cause that makes the whole b2b tier
     unreachable from a clean signup — distinct from, and on top of, the grant/policy gap in (1).
- **Status — CLOSED (2026-06-15):** the platform now, on the b2b/org tier, **(a)** grants the `create_entity`
  app-permission bit to the actor, **(b)** provisions the `org_memberships` / `org_member_profiles` grants +
  write policies, and **(c)** self-seeds the per-user personal-org row in
  `<db>-memberships-private.org_memberships_sprt` (`actor_id = entity_id = user_id`) on `sign_up` — so a fresh
  email-password signup is a member of its personal org and `AuthzEntityMembership(membership_type:2)` writes
  persist immediately. Documented as gotchas **RLS-ORG-RECONCILE-001** + the recipe in skill-supplements.md
  "Org-flow extension" (kept as the historical control-plane form). The former harness-side stopgap (an
  org-reconcile script auto-applied by the build, plus the after-signup live-QA hook) is therefore **removed** —
  org-scoped writes work natively after signup, and a real RLS denial now surfaces directly at the create
  assertion.

### 1c. `app_permission_defaults` ships all-zeros → no self-service org creation
- **Symptom:** a freshly provisioned tenant has **no actor who can create an org**. Org creation requires
  the `create_entity` app-permission bit (**bit 5 = `0x20` = decimal `32`**), but the default app-permission
  row grants **none** of the bits, so a normal signed-up user cannot self-serve an org — `OrgCreateCard`
  RLS-denies with nothing in the UI explaining why.
- **Root:** `app_permission_defaults` (the row that seeds a new member's permission bitmask) is provisioned
  all-zeros. There is no default path that yields a member who holds `create_entity`.
- **Status — CLOSED (2026-06-15):** the platform now seeds the actor's app membership with the `create_entity`
  bit (**bit 5 = `0x20`**) on the b2b/org tier, so a normal signed-up user can self-serve an org out of the box.
  Folded into the same platform fix as 1b; no post-provision patch is needed.

### 1d. Non-determinism across tenants
- **Symptom:** the *same* provision input applied to two tenants does **not** reliably yield the same
  grant/policy state on the module-owned tables — a write that round-trips on tenant A silently 0-rows on
  tenant B. This is what makes 1a–1c so expensive to diagnose: "it worked last run" is not evidence.
- **Root:** the per-tenant provisioner's grant/policy emission for module-owned tables is not deterministic
  across runs/tenants (the SELECT-only `users` policy is the reproducible floor; the rest varies).
- **Harness workaround:** the harness **verifies** post-provision (read `information_schema.role_table_grants`
  + `pg_policies`) and applies the 1a/1b/1c control-plane fallbacks when the expected grant/policy is
  absent, rather than trusting the provision succeeded. **Cost:** every build pays a verify-and-reconcile
  pass that should be unnecessary.

> **Re-confirmed STILL-OPEN 2026-06-17 (org-table grants are NON-deterministic post-2026-06-15-fix) — this
> is the root cause of the b2b Gate-2.3 `org-table grants incomplete` PARTIAL.** The 2026-06-15 platform fix
> (GAP-1b/1c, below) closed the grant *emission* and the personal-org *seed*, but did **not** make the org-table
> grant emission *deterministic* — exactly the §1d symptom. Live evidence on the shared hub:
> **6 of 7** provisioned `b2b` tenants are missing the org-table grants the static seed schema has —
> `org_memberships` is granted only `SELECT,DELETE` (INSERT/UPDATE omitted) and `org_member_profiles` is
> granted **nothing** — while the same `modules.preset: b2b` input on tenant `testcrm` got the full
> `SELECT,INSERT,UPDATE,DELETE` + `org_member_profiles SELECT`. All 6 partial tenants were provisioned
> **after** the 2026-06-15 fix (so this is *not* a stale pre-fix tenant), and on a partial tenant the RLS
> **policies are complete** (`auth_ins_ent_mem` / `auth_upd_ent_mem` / `auth_sel_ent_mem` all present) — only
> the table-level `GRANT`s are missing, the classic GAP-1 "RLS-on, policies present, DML grants omitted"
> silent-deny shape. Net: member-list / role-change / `org_member_profiles` reads (the org member-management
> surface) 403 on ~6/7 b2b builds. **This is upstream-only — the harness is consume-only over constructive-db
> and cannot durably fix non-deterministic provisioner emission.** The harness DID ship the consume-only
> backfill for exactly this (`scripts/fix-org-grants.sh`: idempotent `GRANT INSERT,UPDATE ON org_memberships`
> + `GRANT SELECT ON org_member_profiles TO authenticated`), but it was **retired in 09ca043** on the
> assumption the 2026-06-15 fix made grants deterministic; this re-confirmation shows that assumption does
> **not** hold for the org tables. **Re-verify by ~2026-09-17:** provision K≥5 fresh `b2b` tenants and assert
> *all* show `org_memberships` SELECT/INSERT/UPDATE/DELETE + `org_member_profiles` SELECT to `authenticated`
> (today only ~1/7 do). When the org-table grant emission is deterministic, this re-confirmation closes.
> Reconciles against the Phase-2.3 gate `org-table grants incomplete` (verify-phase.sh, block (a)).

> **The durable fix (owned by constructive-db + constructive):** make the dynamic per-tenant provisioner
> emit the **same** `authenticated` DML grants + write policies the static seed schema has (self-update on
> `users`, INSERT/UPDATE on the org tables, SELECT on `org_member_profiles`), **deterministically**; have
> **`sign_up` / `provision` create the new user's personal-org row** in
> `<db>-memberships-private.org_memberships_sprt` (`actor_id = entity_id = user_id`) deterministically, so a
> fresh email-password signup is a member of an org and `AuthzEntityMembership(membership_type:2)` writes
> succeed; and seed `app_permission_defaults` so a normal member can create an org (or expose a first-class
> "make me an org owner" path). **This upstream change LANDED 2026-06-15** — retiring the harness-side
> org-reconcile stopgap and the 1a/1c reconciliation; RLS-USERS-UPDATE-001 + RLS-ORG-RECONCILE-001 remain
> documented as the historical control-plane recipe for deployments that predate the fix.

> **Idempotency note (same family — `constructBlueprint` is not re-runnable).** A re-run of `provision.ts`
> against an **already-provisioned** DB **aborts** on the first duplicate `CREATE POLICY` (the 2026-06-05
> stress test hit `policy "auth_sel_temporal" already exists`) — there is no `IF NOT EXISTS` / drop-first, so
> provisioning is run-once and any partial-failure retry means dropping the whole DB. Owner: **constructive-db**
> (guard blueprint policy/object emission so a re-run converges as a no-op). This is the re-run-safety half of
> GAP-1's determinism ask. Close-out: re-run `provision.ts` unchanged → clean no-op (exit 0, no `already
> exists`). Full escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G4**.

> **Owner / status / re-verify (GAP-1b + GAP-1c).**
> - **Owner:** constructive-db (per-tenant provisioner grant/policy + `org_memberships_sprt` seed on
>   `sign_up`/`provision`) + constructive (auth proc surface).
> - **Status:** **CLOSED (2026-06-15)** — the upstream fix landed (constructive-db 5b1128fa68): the provisioner
>   grants the org tables + `create_entity` bit and self-seeds the personal-org `org_memberships_sprt` row on
>   signup. The harness-side org-reconcile stopgap + the after-signup live-QA hook were **deleted** as redundant
>   no-ops, and RLS-ORG-RECONCILE-001 is retained only as the historical control-plane recipe.
> - **Re-verify (regression check):** against a **freshly provisioned `b2b` tenant**, perform a clean
>   email-password signup and then a single `AuthzEntityMembership(membership_type:2)` INSERT on an org-scoped
>   business table (the `build/test-crm-brief.yaml` `companies`/`contacts` path is the canonical reproduction).
>   It now **persists end-to-end unaided** (row visible on reload, owner/org scoping correct). The standing
>   automated form is the **b2b rot-canary** (`scripts/genericity-check.sh --canary b2b`, see AGENTS.md → Rot
>   Check) — an org-scoped create that RLS-rejects there is now a real regression, not an expected gap.

---

## GAP-1d — M:N junction security NOT forwarded (`RelationManyToMany` drops nested `data.{nodes,policy_type,grants}`)

> **Naming note:** this top-level **GAP-1d** is the *M:N junction-security* escalation (new, from the
> 2026-06-05 stress test). It is **distinct from** the `§1d. Non-determinism` sub-bullet inside GAP-1 above —
> same GAP-1 family (a dynamic-provision path omitting the grants/policies the static path has), surfaced here
> as its own entry because it has **no harness workaround** and is the highest-leverage new finding.

- **Symptom:** a brief with an org-scoped many-to-many relation (the `orgdesk` stress fixture:
  `projects ↔ labels` via `project_labels`, `data.policy_type = AuthzEntityMembership`) provisions the
  junction table **RLS-enabled with 0 policies + 0 `authenticated` grants** → every authenticated **attach**
  (`INSERT INTO project_labels`), **detach** (`DELETE`), and **list** (`SELECT … JOIN`) **denies**. The M:N
  feature is structurally present (FKs + table) but functionally dead — the silent-deny class of GAP-1.
- **Root (two upstream surfaces):** (1) **constructive** — `constructBlueprint`'s `RelationManyToMany`
  handler maps the relation onto the SDK `relation_provision` row's **flat** security columns
  (`policy_type`/`policy_data`/`grant_*`/`nodes`) and **does not read** the blueprint's **nested**
  `relation.data.{nodes, policy_type, policy_data, grants}` — so the junction's security payload is **dropped
  on the floor** between the blueprint shape and the SDK relation row. (2) **constructive-db** —
  `relation_provision` only secures the junction from those flat columns (defaults: `grant_privileges='{}'`,
  `policy_type=NULL`), so when they arrive empty the junction comes up with RLS on but no grants/policy.
- **Harness workaround:** **NONE.** Confirmed-upstream on **both** surfaces. The harness brief grammar
  forwards the junction security **correctly** — `scripts/lib/brief.mjs` `buildRelation()` is
  `const out = { ...r }`, forwarding `relation.data.*` **verbatim** into the `BlueprintDefinition`; the brief
  is **not** the lossy layer. There is **no** junction/`project_labels` handling in any `scaffold-provision`
  path (unlike the historical GAP-1a/1b `createSecureTableProvision` reconciles). **Cost:** any app modeling a
  many-to-many (tags / labels / multi-select / membership joins)
  ships a junction that denies all access, with **no in-harness mitigation** — it stays dead until the
  upstream fix lands.
- **Owner:** **constructive-db** (have `relation_provision` materialize the junction with the named
  `policy_type` + `authenticated` grants) **+ constructive** (have `constructBlueprint` forward the nested
  `relation.data.*` onto the SDK `relation_provision` flat columns instead of dropping it). Both are required:
  the SDK must forward, the SQL must consume.
- **Severity:** **HIGH** — a security/correctness gap with **no workaround**.
- **Close-out probe:** provision `orgdesk`; as an `authenticated` org member,
  `INSERT INTO project_labels(project_id,label_id,entity_id)` → succeeds, `SELECT` returns it, `DELETE`
  removes it (today all RLS-deny); and `SELECT count(*) FROM pg_policies WHERE tablename='project_labels'` is
  `> 0` with `authenticated` holding INSERT/SELECT/DELETE in `role_table_grants`. Full escalation +
  reproduction: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G1**.
- **Wave-2 live confirmation (2026-06-05, `desk2`) — SHARPENED + a FUNCTIONAL stopgap now SHIPS (updates the
  "NONE" above for the M:N *feature*):** Wave-2 confirmed at the proc level that
  `metaschema_modules_public.construct_blueprint` reads each relation's `nodes`/`grants`/`policies` only at the
  **top level** and **IGNORES a nested `data:` block** (the *constructive* half), and that emitting the literal
  `AuthzEntityMembership(entity_field=entity_id)` onto a **`DataId`-only junction aborts the ENTIRE provision**
  with `column "entity_id" does not exist` (0 tables on `desk2`). The harness now ships a **column-safe
  coercion** (`scripts/lib/brief.mjs` `junctionPolicy()`): a junction policy that needs a column its nodes don't
  materialize is coerced to **`AuthzAllowAll`** (all-CRUD, permissive), so the junction provisions **GRANTed +
  SECURED for `authenticated`** and `createProjectLabel`/`projectLabels`/`deleteProjectLabel` all round-trip
  (DB-confirmed; org isolation holds on the parents transitively via FK). **M:N is now FUNCTIONAL** — but the
  **literal per-org junction policy is still NOT honored**. Durable fix unchanged: `constructBlueprint` forward
  the nested `data.*`, OR carry `DataEntityMembership` on the junction nodes (then the coercion is a no-op). Full
  detail: **planning doc → G1 (Wave-2 confirmation)**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (Owner + the close-out probe are above). Re-verify
> by **~2026-09-05** (one quarter): either the upstream fix lands (then drop the `junctionPolicy()`
> `AuthzAllowAll` coercion in `scripts/lib/brief.mjs`), or this entry is re-confirmed still-needed with a fresh
> date. **Close-out:** the **sharpened `desk2` probe above** — a `pg_policies` row on `project_labels` is an
> **`AuthzEntityMembership`** (not the stopgap `AuthzAllowAll`) AND a non-member is denied attach/list on
> another org's junction rows. When the junction enforces *per-org* membership (not just authenticated),
> GAP-1d is fully closed.

---

## GAP-2 — `revokeSession` is uncallable from the auth result (UUIDv5 vs UUIDv7 id mismatch)

- **Symptom:** `revokeSession(id)` returns **`SESSION_NOT_FOUND`** when passed the id from a
  `signUp`/`signIn` result, so the Sessions flow (revoke this session / revoke-all-others) cannot target the
  current session.
- **Root:** the id on the auth result is a **UUIDv5 identity/credential id**, *not* the `sessions` row id (a
  **UUIDv7**). No field on the auth result exposes the real `sessions.id`, so there is no value the client
  can pass that `revokeSession` will match. (Deployed auth proc + auth result shape.)
- **Harness workaround:** documented as gotchas **SDK-007** and as a known-gap note on the `sessions` flow —
  treat sessions-revoke as backend-pending; do **not** hand-craft a session id or fall back to SQL.
  **Cost:** the Sessions block ships degraded (it lists sessions but cannot reliably revoke the current one
  from the auth result alone).
- **Fix:** expose the real `sessions.id` (UUIDv7) on the `signIn`/`signUp` result (or accept the
  identity/credential id in `revokeSession` and resolve it server-side).
- **Re-confirmed 2026-06-05 (+ compounding causes):** the stress test re-confirmed this and surfaced **two
  more** reasons the Sessions flow can't complete: (a) there is **no `userSessions` list query** to enumerate
  sessions to revoke, and (b) `revokeSession` reads `auth-private.user_sessions` while `signIn` **writes**
  `auth-private.sessions` (a **read/write table split**). Closing GAP-2 means fixing all three (id mismatch +
  missing list + table split). Full escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G5**.

> **Owner / expiry / re-verify.**
> - **Owner:** **constructive-db** (auth procs / session tables: expose a `userSessions` list query, reconcile
>   `revokeSession` to read the same table `signIn` writes — `auth-private.sessions` — and expose the real
>   `sessions.id` UUIDv7 on the auth result, or resolve the identity/credential id server-side). Harness is
>   consume-only here (documented backend-pending via gotchas SDK-007; no safe SQL fallback).
> - **Status / expiry:** OPEN as of **2026-06-05** (re-confirmed by the stress test). Re-verify by
>   **~2026-09-05** (one quarter): either the upstream fix lands and the `sessions` flow is un-degraded, or
>   this entry is re-confirmed still-needed with a fresh date.
> - **Re-verify (close-out):** the **G5 close-out probe** in the planning doc — as an `authenticated`
>   session, `userSessions` returns the current session, and `revokeSession(<that id>)` succeeds and the
>   session disappears from a subsequent `userSessions`. Today: query absent + `SESSION_NOT_FOUND`/wrong-table
>   miss. When list-then-revoke round-trips, GAP-2 is closed.

---

## GAP-3 — `revokeApiKey` reports success but never sets `revoked_at` (silent partial write)

- **Symptom:** `revokeApiKey` returns **`true`** and writes an **audit-log** entry, but the key's
  **`revoked_at` is never set** — the key keeps working. UI shows "revoked"; the key is still live.
- **Root:** the deployed `revoke_api_key` proc performs the audit-log side effect and returns success but
  **omits the `UPDATE … SET revoked_at = now()`** on the key row (or its RLS/grant denies that UPDATE
  silently — same family as GAP-1). Net: a security-relevant op that lies about completing.
- **Harness workaround:** none that is safe — the harness flags this as a backend defect on the `api-keys`
  flow and does not pretend the key is revoked. **Cost:** the API-keys block's revoke is non-functional;
  treating its `true` as truth is a security footgun.
- **Fix:** make `revoke_api_key` actually set `revoked_at` (and ensure the proc's role can perform that
  UPDATE under RLS), and only return success after the row is updated.

> **Owner / expiry / re-verify.**
> - **Owner:** **constructive-db** (the deployed `revoke_api_key` proc + its RLS/grant on the key row). The
>   harness is consume-only and has **no safe workaround** — it flags the defect on the `api-keys` flow and
>   does **not** treat the `true` as truth.
> - **Status / expiry:** OPEN as of **2026-06-05**. Re-verify by **~2026-09-05** (one quarter): either
>   `revoke_api_key` sets `revoked_at`, or this entry is re-confirmed with a fresh date.
> - **Re-verify (close-out):** call `revokeApiKey(<id>)` → it returns success **and** a subsequent use of
>   that key is rejected (`revoked_at` is set, DB-confirmed). Today the key keeps working after a `true`
>   response. When the key is actually dead post-revoke, GAP-3 is closed.

---

## GAP-4 — `useSignOutMutation` codegen emits invalid GraphQL (no subfield selection)

- **Symptom:** the generated `useSignOutMutation` hook produces an **invalid GraphQL document** — the
  `signOut` field is selected with **no subfield selection** on a composite return type (or a scalar
  selected with subfields), so the operation fails to parse/validate at request time.
- **Root:** **codegen** (constructive graphql-codegen) for the `signOut` mutation does not emit a valid
  selection set for `signOut`'s return type. This is a code-generation bug, not an app bug — every app that
  codegens the auth SDK gets the same broken hook.
- **Harness workaround:** the sign-out path is driven via the block/runtime seam rather than the broken
  generated hook; the harness notes `useSignOutMutation` as codegen-broken so agents don't burn time
  "fixing" their call site. **Cost:** a core auth op's generated hook is unusable as-emitted.
- **Fix:** correct the codegen selection-set emission for `signOut` (emit the valid subfield selection for
  its return type, or treat a scalar return as scalar) so the generated hook validates.

> **Owner / expiry / re-verify.**
> - **Owner:** **constructive** (graphql-codegen — the `signOut` selection-set emission). The harness is
>   consume-only and works around it by driving sign-out through the block/runtime seam rather than the
>   broken generated hook.
> - **Status / expiry:** OPEN as of **2026-06-05**. Re-verify by **~2026-09-05** (one quarter): either
>   codegen emits a valid `signOut` selection, or this entry is re-confirmed with a fresh date.
> - **Re-verify (close-out):** regenerate the auth SDK and inspect the `useSignOutMutation` document — it
>   must carry a valid subfield selection (e.g. `signOut { clientMutationId }`) and validate at request time.
>   Today the generated hook is invalid GraphQL. When the emitted hook validates, GAP-4 is closed.

---

## GAP-5 — Pending org admin seams: `delete_org`, `removeOrgMember`, `transferOrgOwnership`

- **Symptom:** the org blocks reference these ops, but they are **not deployed in the provisioned admin
  schema** — calling them errors / no-ops. (`org-members-list` already routes member-remove through the
  GA `deleteOrgMembership` instead, and the org settings danger-zone has no working `delete_org`.)
- **Root:** these procedures are **pending** in the org/admin module surface — declared/expected by the
  blocks but absent from the deployed schema.
- **Harness workaround:** the harness marks them backend-pending on the relevant org flows and steers the
  blocks to the GA equivalents where one exists (`deleteOrgMembership` for remove); ownership transfer and
  whole-org deletion have no GA path and are documented as not-yet-available. **Cost:** the org tier ships
  with delete-org / transfer-ownership / first-class member-remove missing.
- **Fix:** deploy `delete_org`, `removeOrgMember`, and `transferOrgOwnership` (with the matching grants +
  RLS per GAP-1) so the org blocks have their full admin surface.

> **Owner / expiry / re-verify.**
> - **Owner:** **constructive-db** (deploy the pending `delete_org` / `removeOrgMember` /
>   `transferOrgOwnership` procs with the matching grants + RLS per GAP-1). The harness is consume-only and
>   steers the org blocks to GA equivalents where one exists (`deleteOrgMembership` for member-remove);
>   delete-org and transfer-ownership have no GA path.
> - **Status / expiry:** OPEN as of **2026-06-05**. Re-verify by **~2026-09-05** (one quarter): either the
>   three procs are deployed, or this entry is re-confirmed with a fresh date.
> - **Re-verify (close-out):** against a provisioned org tenant, each of `delete_org`, `removeOrgMember`,
>   `transferOrgOwnership` exists in the admin schema and completes its action (org gone / member removed /
>   ownership moved), DB-confirmed. Today they error / no-op. When all three round-trip, GAP-5 is closed.

---

## GAP-6 — `createUser(type=2 Organization)` is RLS-denied for an authenticated session (no org can be minted)

- **Symptom:** with the `b2b` preset provisioned, an `authenticated` `app_user` session that calls
  `createUser(type=2)` (the `OrgCreateCard` "create an org" path) is **RLS-denied** — **no non-personal org
  can be minted** from a normal signed-in user. The org tier's first action is unreachable.
- **Distinct from GAP-1b/1c:** GAP-1b/1c (now platform-native, CLOSED) cover entity-writes **under an
  existing personal org** — the platform grants `create_entity`, provisions the org-table grants/policies, and
  seeds the user's **personal-org** `org_memberships_sprt` row so `AuthzEntityMembership(membership_type:2)`
  business INSERTs scope. They do **not** make `createUser(type=2)` succeed — **minting a NEW org** is a
  `type=2` INSERT into the tenant `users` table that has **no `authenticated` policy** permitting it, so even
  with the personal-org seed in place, org creation still RLS-denies.
- **Root:** the per-tenant provisioner emits **no `authenticated` INSERT policy** admitting self-service
  `type=2` org-creation rows on the tenant `users` table (same omission-class as GAP-1, specific to the
  org-creation INSERT, which the band-aid reconcile does not synthesize).
- **Harness workaround:** **none** — the platform-native personal-org seed (GAP-1b/1c) makes entity-writes
  under an existing org work, but **minting a NEW org** via `createUser(type=2)` is operator/sudo-only today.
  **Cost:** the b2b tier has **no self-service org creation** at all; every org must be minted out-of-band,
  which the consume-only harness cannot do for an app's end users.
- **Owner:** **constructive-db** — emit the `authenticated` INSERT policy admitting self-service `type=2` org
  creation on the tenant `users` table, or expose a first-class "create-organization" proc that runs the
  INSERT under the right authority and seeds the creator's owner `org_memberships_sprt` row in the same txn.
- **Severity:** **HIGH** — couples with GAP-1b/1c; without it the b2b tier cannot stand up its first org.
- **Close-out probe:** on a fresh `b2b` tenant, clean email-password signup → authenticated
  `createUser(type=2, name:'Acme')` must persist an org row (creator scoped as owner). Today RLS-denied. Full
  escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G2**.
- **Live confirmation (`desk2`):** CONFIRMED LIVE via **both** paths — `OrgCreateCard.onSuccess`
  (`createUser(type=2)`) **and** a direct `createUser(type=2, name:…)` API call both return
  `new row violates row-level security policy for table "users"`. This also **isolated** the gap: a fresh signup
  **gets its personal-org `org_memberships_sprt` row** (DB: `4 users == 4 sprt`, `is_owner=t`) and
  `createProject(entityId = own org)` succeeds natively — **GAP-1b/1c is CLOSED upstream (2026-06-15)** — leaving
  GAP-6 (minting a NEW org) as the **last** b2b self-service blocker. A `desk2`-style build is `partial` for
  exactly this reason — create-org is GAP-6-blocked upstream, not a harness bug. Full detail: **planning doc → G2**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (CONFIRMED LIVE Wave-2; Owner + close-out probe
> are above). Re-verify by **~2026-09-05** (one quarter): either the per-tenant `users` table admits
> self-service `type=2` org creation (provisioner INSERT policy or a first-class create-org proc), or this
> entry is re-confirmed still-needed with a fresh date. **Close-out:** the probe above — on a fresh `b2b`
> tenant, a clean signup's `createUser(type=2, name:'Acme')` persists an org row (creator scoped as owner).
> Today it RLS-denies via both the block and the direct API.

---

## GAP-7 — OOM cache-leak: unbounded per-DB PostGraphile handler-cache `Map` (`Runtime_MapGrow`)

- **Symptom:** under concurrent multi-tenant load (the 2026-06-05 stress run had ~4 agents each building a
  distinct tenant DB against the shared `:3000` hub), the cnc server **OOMs** —
  `FATAL ERROR: Reached heap limit Allocation failed` (crashed mid-codegen at 15:38:49; `mailflow` lost its
  SDK generation, `townboard` OOM'd post-build). The crash correlates with the **number of distinct tenant
  DBs served**, not any single request's size.
- **Root:** the PostGraphile layer keeps a **per-DB handler/runtime cache as an unbounded `Map`** (the V8 OOM
  bottoms out in `Runtime_MapGrow`). Each newly-served tenant DB adds entries and **nothing evicts**, so N
  concurrent tenants grow the `Map` monotonically until the heap is exhausted — a **leak with no ceiling**,
  not a per-request spike.
- **Harness workaround:** mitigation only — launch the hub with `--max-old-space-size=8192` (SKILL.md S0 /
  `scripts/genericity-check.sh`) + harness self-heal restart-once. Raises the OOM ceiling; **cannot bound the
  leak**. **Cost:** a single OOM takes down the hub for **every** concurrent agent/tenant.
- **Owner:** **constructive** (cnc CLI / PostGraphile server) — (1) **bound the cache**: give the per-DB
  handler-cache `Map` an **LRU/max-size eviction (or TTL)** so the served-tenant working set is bounded and
  idle tenants evict (the durable fix); (2) **ship/document the server launched with `--max-old-space-size`**
  so a spike degrades gracefully (mitigation, not the fix).
- **Severity:** **HIGH** for shared-infra availability.
- **Close-out probe:** drive K ≫ working-set (e.g. 50) distinct tenant DBs through the server while sampling
  RSS / handler-cache `Map.size`; with the fix both **plateau**, today both **grow to OOM**. When RSS
  stabilizes under sustained many-tenant load, the S0 restart-once mitigation can relax. Full escalation:
  **`planning/upstream-gaps-stress-test-2026-06-05.md` → G3**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (Owner + close-out probe are above). Re-verify
> by **~2026-09-05** (one quarter): either the per-DB handler-cache `Map` gets an LRU/TTL eviction bound (then
> the S0 `--max-old-space-size=8192` restart-once mitigation can relax), or this entry is re-confirmed
> still-needed with a fresh date. **Close-out:** the probe above — under K ≫ working-set distinct tenant DBs,
> RSS / handler-cache `Map.size` **plateau** instead of growing to `Reached heap limit`.

---

## GAP-8 (semantics, LOW) — `AuthzNotReadOnly` ≠ append-only; `DataSoftDelete` has no `deleted_at` trigger

> **Intent/semantics clarification, NOT a security hole.** Recorded so app authors don't over-trust
> `read-only` as an append-only guarantee. Re-confirmed by the 2026-06-05 stress test (`orgdesk` audit_log,
> `devvault` soft-delete).

- **`AuthzNotReadOnly` is a per-member `is_read_only` gate, not an org append-only lock:** it blocks writes
  for members whose `is_read_only = true`, but a **non-read-only** member can still **DELETE** rows. The
  "append-only audit log" reading is **not** enforced by `read-only` alone — an app needing a true
  append-only log must add its own DELETE-deny. This is intended behavior; the ask is **docs** that call it
  out.
- **`DataSoftDelete` has no auto-stamp trigger:** the `deleted_at` column materializes, but nothing stamps
  it on delete — apps must drive `deleted_at` themselves (or upstream ships a soft-delete trigger).
- **Owner:** **constructive-db** — (a) docs clarifying the `AuthzNotReadOnly` semantics, (b) decide whether
  `DataSoftDelete` ships a `deleted_at`-stamping trigger and document current behavior either way.
- **Close-out probe / full escalation:** **`planning/upstream-gaps-stress-test-2026-06-05.md` → G6**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (semantics/docs clarification, LOW; Owner above).
> Re-verify by **~2026-09-05** (one quarter): either the upstream docs clarify `AuthzNotReadOnly` ≠ append-only
> and state the `DataSoftDelete` `deleted_at` behavior (and, if chosen, ship the auto-stamp trigger), or this
> entry is re-confirmed with a fresh date. **Close-out:** the **G6 probe** in the planning doc — docs landed
> (and, if the soft-delete trigger ships, a DELETE on a `DataSoftDelete` table leaves the row with `deleted_at`
> stamped).

---

## GAP-9 — `sendVerificationEmail` aborts on `user_secrets_del(uuid, text[])` (the real email-verify blocker)

> New from the **2026-06-05 Wave-2** validation (`mail2`, `auth:email` tier). The earlier site-domain
> prerequisite is now **fixed** (`provision.ts` casts `$1::text`, the row provisions hands-free, the *"Missing
> site configuration for email"* error is GONE) — **this** is what remains.

- **Symptom:** on a fresh signup, `sendVerificationEmail` **raises before any email enqueues**:
  `function …store-private.user_secrets_del(uuid, text[]) does not exist`. The function is deployed as
  `(uuid, text)`, but the verification-send path **calls it with a `text[]`** → no overload → the whole
  mutation aborts and Mailpit stays empty. Email-verification is **completely unreachable** on `auth:email`.
- **Root:** a **signature/overload mismatch** — deployed `user_secrets_del(uuid, text)` vs. a caller passing
  `(uuid, text[])` in the `sendVerificationEmail` path. (Client is correct: the verify-email landing page
  mounts + reads the `token` param; the failure is server-side in the auth/email proc.)
- **Harness workaround:** **NONE** — the harness cannot patch a deployed proc; the send raises server-side.
- **Owner:** **constructive-db** (auth/email modules) — reconcile `user_secrets_del`'s deployed signature with
  the `sendVerificationEmail` call site (accept `text[]`, or pass a scalar `text`).
- **Severity:** **HIGH** — no app can verify an email via the platform until this lands.
- **Close-out probe:** on a fresh `auth:email` tenant (site-domain present), `sendVerificationEmail` must
  enqueue a Mailpit message (then the verify-link flips `is_verified`); today it raises
  `user_secrets_del(uuid, text[]) does not exist`. Full escalation:
  **`planning/upstream-gaps-stress-test-2026-06-05.md` → G7**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (Wave-2; Owner + close-out probe are above).
> Re-verify by **~2026-09-05** (one quarter): either `user_secrets_del`'s deployed signature and the
> `sendVerificationEmail` call site are reconciled, or this entry is re-confirmed still-needed with a fresh
> date. **Close-out:** the probe above — `sendVerificationEmail` on a fresh signup enqueues a Mailpit message
> (and the verify-link flips `is_verified`). Today the send raises `user_secrets_del(uuid, text[]) does not
> exist` before any enqueue.

---

## GAP-10 — `sendAccountDeletionEmail` is a silent no-op (HTTP 200, nothing delivered)

> New from the **2026-06-05 Wave-2** validation (`mail2`).

- **Symptom:** `sendAccountDeletionEmail` returns **HTTP 200 in ~23 ms** with **no email-related logging** and
  **nothing delivered to Mailpit** — a **silent no-op** (the GAP-1 "200 but nothing happened" class). The full
  client flow is **correct**: danger card mounts at `/account`, `account-danger-confirm` fires the **step-up
  gate**, and the UI shows *"A confirmation email has been sent"* — but no email is sent. **Not** a verification
  dependency: the account's email is **verified** (`is_verified=t`).
- **Root:** the deployed `sendAccountDeletionEmail` proc returns success but **does not enqueue** the deletion
  email (missing enqueue, RLS/grant-denied for the proc's role, or a silently-failed gate — net: 200, nothing
  delivered).
- **Harness workaround:** **NONE** (do not hand-roll the deletion email).
- **Owner:** **constructive-db** (auth/email modules) — make `sendAccountDeletionEmail` actually enqueue the
  email and only return success after it is queued (or surface an error/log instead of a green 200).
- **Severity:** **MEDIUM** — account-deletion ships degraded; the UI claims success while the confirmation email
  never arrives, so deletion can never be confirmed. The *silence* is the dangerous part.
- **Close-out probe:** with a verified email, complete account-danger step-up → fire
  `sendAccountDeletionEmail` → a deletion email must land in Mailpit (today: 200/~23 ms, nothing delivered).
  Full escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G8**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (Wave-2; Owner + close-out probe are above).
> Re-verify by **~2026-09-05** (one quarter): either `sendAccountDeletionEmail` actually enqueues the deletion
> email (and only returns success after it queues), or this entry is re-confirmed still-needed with a fresh
> date. **Close-out:** the probe above — with a verified email, post-step-up `sendAccountDeletionEmail` lands a
> deletion email in Mailpit. Today: HTTP 200 (~23 ms), nothing delivered.

---

## GAP-11 — dashboard-blocks ship an empty GraphQL selection (`forgot-password-card` + `sign-out-button`)

> New from the **2026-06-05 Wave-2** validation (`mail2`). **Owner is `dashboard-blocks` — a DIFFERENT upstream
> repo** (the published `@constructive` blocks source), not constructive-db. The harness is consume-only over it
> the same way it is over constructive-db.

- **Symptom:** `forgot-password-card` and `sign-out-button` author their mutation with an **empty selection set**
  (`selection:{ fields:{} }`), which codegen / GraphQL validation **rejects**
  (`forgotPassword must have a selection of subfields`). The block **cannot issue its mutation** until the
  selection includes at least `{ clientMutationId: true }` — e.g. `forgot-password-card` sends **no reset email
  from the UI** until then.
- **Root:** the block's GraphQL document is authored with an empty `selection.fields`. A **block-source defect
  in dashboard-blocks** — every app installing these blocks inherits it.
- **Harness workaround:** an **app-local block patch only** (NOT a harness-script change): the `mail2` run fixed
  password-reset by editing the **app's copy** of `forgot-password-card`
  (`selection:{fields:{}}` → `{ clientMutationId: true }`). `sign-out-button` has the same shape + needs the same
  fix. Re-applied per app until the block source is fixed.
- **Owner:** **dashboard-blocks** — give both blocks a non-empty selection (`{ clientMutationId: true }`
  minimum); audit the other auth blocks for the same `selection:{fields:{}}` shape.
- **Severity:** **MEDIUM** — two core auth blocks are non-functional as-shipped (forgot-password sends nothing;
  sign-out can't validate); undiscoverable ("my app is wrong" vs "the block ships invalid GraphQL").
- **Close-out probe:** render `forgot-password-card` / `sign-out-button` from a **clean `@constructive` install**
  (no app-local edit) → the mutation must validate + fire. Today both raise *"… must have a selection of
  subfields"*. Full escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G9**.

> **Status / expiry / re-verify.** OPEN as of **2026-06-05** (Wave-2; Owner is **dashboard-blocks** — a
> *different* upstream repo, consume-only — see above). Re-verify by **~2026-09-05** (one quarter): either both
> blocks ship a non-empty selection (`{ clientMutationId: true }` minimum), or this entry is re-confirmed
> still-needed with a fresh date. **Close-out:** the probe above — `forgot-password-card` / `sign-out-button`
> from a clean `@constructive` install validate + fire (no app-local edit). Today both raise *"… must have a
> selection of subfields"*.

---

## GAP-12 — reset link param + reset-success redirect mismatch (minor)

> New from the **2026-06-05 Wave-2** validation (`mail2`). Owner straddles **constructive-db email templates**
> and **dashboard-blocks** (reset block param + redirect).

- **Symptom (two small mismatches):** (1) the **reset email link** carries `?reset_token=…` but the **reset
  block** reads `?token=…` — the emailed link's token is under a param the block doesn't read; (2) reset-success
  **redirects to `/auth/sign-in`**, but a generated app **mounts `/sign-in`** (no `/auth/` prefix) → reset-success
  **404s** on the generated app.
- **Root:** a **param-name + route-path mismatch** between the email template (emits `reset_token`, points at
  `/auth/sign-in`) and the reset block / generated app routes (expect `token`, mount `/sign-in`).
- **Harness workaround:** QA-only — the driver's `pollMailpit` aliases `reset_token`/`verification_token`/
  `deletion_token` → `token` (and HTML-decodes `&amp;`) so the test extracts a token; the **generated app's**
  emailed link + reset-success redirect remain mismatched (not fixed in the shipped app).
- **Owner:** **constructive-db** (email templates — emit the token under `token`, point reset-success at a route
  the app mounts) **and/or dashboard-blocks** (have the reset block accept `reset_token` and/or make the
  post-reset redirect target configurable).
- **Severity:** **LOW** — a real reset-path papercut (link param mismatch + possible 404), cosmetic vs G9/G10 and
  trivially worked around per app.
- **Close-out probe:** on a generated `auth:email` app, click the emailed reset link → block reads the token
  (param names match) → new password set → reset-success lands on a **mounted** route (no 404). Today the link is
  `reset_token` (block reads `token`) and reset-success targets `/auth/sign-in` (app mounts `/sign-in`). Full
  escalation: **`planning/upstream-gaps-stress-test-2026-06-05.md` → G10**.

---

## GAP-13 — auth client bearers the UNAUTHENTICATED `signUp`/`signIn` (a stale token in storage → `UNAUTHENTICATED`)

> New from the **2026-06-15** owner-tier dogfood (independent evaluator). Owner is the
> **SDK / dashboard-blocks auth client** — a *different* upstream repo (the published `@constructive` blocks /
> SDK auth transport), not constructive-db. The harness is consume-only over it the same way it is over
> constructive-db.

- **Symptom:** when a leftover/expired token is present in storage (`constructive-auth-token:admin`), a fresh
  **`signUp`** (and equally **`signIn`**) returns **`UNAUTHENTICATED`** — a clean credential signup/signin fails
  for the *unrelated* reason that a previous session's token is still sitting in storage. The evaluator proved a
  stale `constructive-auth-token:admin` makes `signUp` return `UNAUTHENTICATED`.
- **Root:** the SDK / blocks auth client attaches **whatever token is in storage** as
  `Authorization: Bearer <token>` on **every** GraphQL request — *including the inherently UNAUTHENTICATED
  `signUp` / `signIn` mutations*. A stale/expired bearer on those requests is rejected server-side
  (`UNAUTHENTICATED`) **before** the credentials are even evaluated. The auth-entry mutations should be sent
  **bearer-less**; sending a bearer there is never correct (the caller is, by definition, not yet authenticated).
- **Harness workaround:** an **in-skill, app-local guard** (NOT a harness-script change): the generated
  sign-in / sign-up bridge pages (`scripts/templates/frontend/auth-page.tsx`) **clear the stored token on mount**
  (`useEffect(() => TokenManager.clearToken('admin'), [])`) BEFORE the auth block renders/submits, so the
  `signUp`/`signIn` request goes out with no stale bearer. This is safe precisely because those pages are
  **unauthenticated entry points** — the RouteGuard already keeps genuinely-authed users out, so any token
  present there is necessarily leftover. **Cost:** every generated app re-pays this client-side guard until the
  upstream client stops bearering the auth-entry mutations.
- **Owner:** **SDK / dashboard-blocks** (the auth client transport) — do **not** attach an `Authorization`
  bearer to the `signUp` / `signIn` operations (send them anonymously regardless of any token in storage), or
  drop an expired/invalid token before issuing an auth-entry mutation. The durable fix belongs here, not in the
  app: the auth client must not send a bearer to `signUp`/`signIn`.
- **Severity:** **MEDIUM** — a correctness footgun that makes a clean signup/signin fail with a misleading
  `UNAUTHENTICATED` whenever a stale token lingers; undiscoverable ("my credentials are wrong" vs "the client
  bearered the auth-entry request").
- **Close-out probe:** with a stale/expired `constructive-auth-token:admin` seeded in storage and **no**
  app-local mount-clear, issue `signUp` (or `signIn`) with valid credentials from a clean `@constructive`
  install → it must succeed (the client sends the auth-entry mutation bearer-less). Today it returns
  `UNAUTHENTICATED` until the stale token is cleared.

> **Status / expiry / re-verify.** OPEN as of **2026-06-15** (owner-tier dogfood; Owner is the **SDK /
> dashboard-blocks auth client** — a *different* upstream repo, consume-only — see above). Re-verify by
> **~2026-09-15** (one quarter): either the auth client stops bearering `signUp`/`signIn` (then drop the
> `auth-page.tsx` mount-clear guard), or this entry is re-confirmed still-needed with a fresh date.
> **Close-out:** the probe above — `signUp`/`signIn` from a clean `@constructive` install succeed with valid
> credentials even when a stale token is in storage (no app-local mount-clear). Today a stale
> `constructive-auth-token:admin` yields `UNAUTHENTICATED`.

---

## GAP-14 — `construct_blueprint` mangles a column name: strips the `_` before a trailing SINGLE char (`elevation_m` → `elevationm`)

> New from the **2026-06-15** Cleome benchmark build (the deliberately-maximal still-buildable app). Owner is
> **constructive-db** (`metaschema_modules_public.construct_blueprint` — the deployed column-materialization
> path). The harness is consume-only over it: the brief and the provision generator both emit the column name
> **correctly** (with the underscore); the mangling happens **inside** the blueprint→deployed-schema step, so
> there is **no** brief-grammar / scaffolder change that prevents it.

- **Symptom:** a field whose name ends in `_<single-char>` (e.g. `elevation_m`, `temperature_c`) is provisioned
  with the underscore-before-the-last-char **stripped**, so the deployed column — and therefore *all* codegen
  output — is named `elevationm` / `temperaturec`. Codegen then emits the mangled identifier in
  `schema-types.ts`, `types.ts`, and `orm/input-types.ts`, while any hand-written selection/insert that uses the
  brief's `elevation_m` is **TS not-assignable** against the generated type (the generated field is `elevationm`).
  The app author has to chase the **mangled** name to make the page compile — undiscoverable ("my column name is
  wrong" vs "the platform renamed my column"). **Multi-char trailing segments survive** intact: `area_sqm`,
  `observer_count`, `count_seen`, `habitat_note`, `catalog_number`, `established_on`, `surveyed_on` etc. all keep
  their full names — only the `_<single-char>` suffix is eaten.
- **Root:** the column-name normalization on the `construct_blueprint` materialization path treats a trailing
  single-character segment as a separator artifact and drops the preceding `_` (a snake→? heuristic mis-firing on
  one-letter tails — `m`, `c`, `s`, …). The brief carries `{ name: 'elevation_m' }` verbatim into
  `schemas/core.ts` (`{ name: 'elevation_m', … }`); the deployed column comes back `elevationm`. The rename is
  **entirely inside the proc** — neither `scripts/lib/brief.mjs` nor `scaffold-provision.mjs` rewrites it.
- **Harness workaround:** **NONE that preserves the intended name.** The only in-app mitigation is to *accept the
  mangled name* (write `elevationm` in the page's selection/insert to match codegen) or **avoid `_<single-char>`
  suffixes in the brief** (e.g. spell it `elevation_meters` / `temperature_celsius`, which survive). The Cleome
  build took the first path — its `observations`/`plots` pages select `elevationm`/`temperaturec` to compile.
  **Cost:** any app with a units-suffixed column (`*_m`, `*_c`, `*_s`, `*_g`, `*_l`, …) silently gets a different
  column name than the brief declared, breaking the clean brief→codegen→page name identity and forcing a manual
  re-spell on every such field.
- **Owner:** **constructive-db** — `construct_blueprint` (and any shared column-name normalizer it calls) must
  preserve a `_<single-char>` suffix verbatim (do not strip the `_` before a one-letter tail). The deployed
  column must equal the brief's `name`.
- **Severity:** **MEDIUM** — a correctness/ergonomics footgun: it breaks the brief↔codegen name contract and
  yields TS not-assignable errors on a perfectly valid column name, with no in-harness fix that keeps the name.
- **Close-out probe:** provision a table with `{ name: 'elevation_m' }` (and `temperature_c`); after
  `constructBlueprint` + codegen, `schema-types.ts` / `types.ts` expose **`elevation_m`** (not `elevationm`), and
  `SELECT column_name FROM information_schema.columns WHERE table_name=<t>` returns `elevation_m`. Today both come
  back `elevationm` / `temperaturec`. When the deployed column equals the brief name, GAP-14 is closed.

> **Status / expiry / re-verify.** OPEN as of **2026-06-15** (Cleome benchmark; Owner is **constructive-db** —
> `construct_blueprint` column materialization, consume-only — see above). Re-verify by **~2026-09-15** (one
> quarter): either the proc preserves the `_<single-char>` suffix (then the brief→codegen name identity holds and
> units-suffixed columns need no re-spell), or this entry is re-confirmed still-needed with a fresh date.
> **Close-out:** the probe above — a provisioned `elevation_m` / `temperature_c` survives to codegen + the
> deployed schema un-mangled. Today they come back `elevationm` / `temperaturec`.

---

## GAP-RELMEMBERSHIP-PROJ (GAP-15) — `AuthzRelatedEntityMembership` default projection (`sel_field='entity_id'`) is broken-CLOSED for the canonical child-FK→parent-PK shape

> New from the **2026-06-17** related-membership intent build (`fixtures/test-relatedmembership-brief.yaml`),
> confirmed by the prior run against the **deployed** platform. Owner is **constructive-db**
> (`packages/node-type-registry/src/authz/authz-related-entity-membership.ts` registry default +
> `packages/ast/.../policy_ast_builders.sql` `cpt_membership_by_join`). The harness is **consume-only**: it now
> sets the correct projection params **explicitly** (`sel_obj:true` + `sel_field:'id'`) on every emitted
> `related-membership` policy, so the gap is worked around in-skill — but the *platform default* is still wrong.

- **Symptom:** a `related-membership` policy on the canonical shape — a CHILD row carries an FK
  (`entity_field`, e.g. `cards.board_id`) to a PARENT's PRIMARY KEY (`boards.id`), and access derives from
  membership in the org that owns the parent — denies **everyone** (broken-CLOSED) when the policy relies on the
  registry default. `cpt_membership_by_join` compiles the predicate to
  `<entity_field> = ANY ( SELECT <projection> FROM <sprt> JOIN <parent> obj ON sprt.entity_id = obj.<obj_field> WHERE sprt.actor_id = me )`.
  The registry default projects the SPRT's `entity_id` (`sel_field='entity_id'`, `sel_obj` unset) — an **ORG id** —
  so the outer compare is `board_PK = ANY(org_ids)`, which is **always FALSE** (a board's PK is never one of the
  org UUIDs). Net: a structurally-correct policy that silently denies all reads/writes (the silent-deny class of
  GAP-1, but rooted in a wrong *default projection* rather than a missing grant).
- **Root:** the registry default `sel_field: 'entity_id'` (`authz-related-entity-membership.ts` parameter_schema)
  is correct only for a child that stores the **same org id** the SPRT carries (a flat entity_id-on-child shape).
  For the FK→parent-PK shape — the case this policy *exists to express* — the projected column must be the
  **parent PK the FK references**: `sel_obj: true` (project from the joined `obj` table, not the SPRT) +
  `sel_field: 'id'`. The platform's OWN canonical usage proves this is the intended shape: every framework
  `AuthzRelatedEntityMembership` row in `services/constructive-services/deploy/migrate/policy.sql` carries
  `{"sel_obj":true,"sel_field":"id", …}` (joining `org_memberships_sprt` → `metaschema_public.database` on
  `entity_id = database.owner_id`, projecting `database.id`). The registry default does not match its own
  first-party usage.
- **Hand-proof matrix** (child `cards.board_id` → parent `boards.id`; `boards` org-scoped via `entity_id`; actor
  A∈orgX owns board b1∈orgX, board b2∈orgX owned by A2∈orgX; actor B∈orgY; actor N in no org):

  | actor | board | with **default** `sel_field='entity_id'` | with **fix** `sel_obj:true sel_field:'id'` |
  |-------|-------|------------------------------------------|--------------------------------------------|
  | A  (member of orgX) | card on b1 | **deny** (board_PK ∉ {orgX}) ❌ should see | **see** (b1 ∈ ids of boards in orgX) ✅ |
  | A2 (member of orgX) | card on b1 | **deny** ❌ should see | **see** (org-mate's board, same orgX) ✅ |
  | B  (member of orgY) | card on b1 | **deny** (correct, but for the wrong reason) | **deny** (b1 ∉ ids of boards in orgY) ✅ |
  | N  (no org)          | card on b1 | **deny** | **deny** (empty membership set) ✅ |

  The default column is a strict **deny-all** (A and A2 wrongly denied; B/N denied only incidentally). The fix
  yields the intended matrix: A=see, A2=see, B=deny, N=deny.
- **Second, coupled blocker (`obj_schema`):** omitting `obj_schema` does **not** auto-resolve. `rls_parser.parse`
  → `parse_policy_sprt_join_table` fills `obj_schema` only when an `obj_table_id` UUID is supplied; with just a
  bare `obj_table` name it keeps `obj_schema` absent, the generated `range_var` references an unqualified relation,
  and `constructBlueprint` aborts the whole (atomic) provision with `relation "<parent>" does not exist`. There is
  no sibling-table name→schema resolution in `construct_blueprint`/`provision_table` for policy `obj_table` refs
  (the `v_table_map` it builds is used for relations/indexes/FTS, never for policy obj refs, and is populated
  AFTER each `provision_table` call so a forward-reference wouldn't resolve anyway). The PHYSICAL domain schema
  carries a runtime hash unknowable at blueprint-emit time, so the skill emits the logical `app_public` sentinel
  and its generic blueprint engine (`templates/provision/blueprint.ts`) rewrites it to the resolved physical
  schema immediately before construct. Durable fix: let `construct_blueprint` resolve a bare `obj_table` that
  names a SIBLING blueprint table to that table's `obj_table_id` / physical schema (so a blueprint can reference a
  sibling parent by name without the author or the harness knowing the hashed schema).
- **Harness workaround (consume-only, IN PLACE):** `scripts/lib/brief.mjs` `POLICY_INTENTS['related-membership']`
  now emits `sel_obj:true` + `sel_field:'id'` explicitly (deny-all fix) AND `obj_schema:'app_public'` (sentinel);
  `templates/provision/blueprint.ts` rewrites the sentinel to the physical domain schema before construct. Both
  are skill-side; the platform default is unchanged upstream.
- **Owner:** **constructive-db** — (1) default `AuthzRelatedEntityMembership` to the FK→parent-PK projection
  (`sel_obj:true`, `sel_field:'id'`) for the bare-`obj_field`/no-`sel_*` case (or document that the flat default
  requires an explicit `sel_field`), to match the platform's own first-party usage; and (2) resolve a bare
  sibling `obj_table` name to its schema/UUID in `construct_blueprint` so `obj_schema` is not required.
- **Severity:** **HIGH** — a `related-membership` policy authored against the documented (and only) FK→parent-PK
  shape is broken-CLOSED by default (silent total denial of a security-relevant access path), and is additionally
  un-provisionable without an externally-resolved physical `obj_schema`.
- **Close-out probe:** provision the `test-relatedmembership` fixture with the policy `data` reduced to
  `{ entity_field, obj_table, obj_field, membership_type }` (NO `sel_obj`/`sel_field`, NO `obj_schema`): (a)
  `constructBlueprint` succeeds (sibling `obj_table` auto-resolves its schema), and (b) actor A (member of the
  board's org) can SELECT/INSERT the child row (per the matrix). Today (a) aborts `relation does not exist` and,
  once `obj_schema` is supplied by hand, (b) is deny-all. When both hold by default, GAP-15 is closed.

> **Status / expiry / re-verify.** **OPEN / escalated** as of **2026-06-17** (related-membership build; Owner is
> **constructive-db** — registry default + `cpt_membership_by_join` / `construct_blueprint`, consume-only — see
> above). The skill ships the explicit-params + sentinel-rewrite workaround so `related-membership` builds
> correctly today. Re-verify by **~2026-09-17** (one quarter): either the platform default matches its own
> first-party `sel_obj:true sel_field:'id'` usage AND `construct_blueprint` resolves a bare sibling `obj_table`
> (then the skill can drop the explicit projection params + the `obj_schema` sentinel rewrite), or this entry is
> re-confirmed still-needed with a fresh date.

---

## GAP-14b (cross-reference) — payload-carrying N:M junction security NOT forwarded → **see GAP-1d**

> The **2026-06-15** Cleome benchmark RE-CONFIRMED the M:N junction-security gap on **two** payload-carrying
> N:M junctions (a citations join + a co-occurrence join, both org-scoped). This is the **same defect already
> documented as GAP-1d above** (`construct_blueprint` reads only the top-level relation security and ignores the
> nested `relation.data.{nodes,policy_type,grants}`; the harness `junctionPolicy()` `AuthzAllowAll` coercion in
> `scripts/lib/brief.mjs` keeps the M:N *feature* functional but the literal per-org junction policy is still not
> honored). **No new entry** — this is a pointer so the benchmark re-confirmation is traceable. Owner, severity,
> harness stopgap, and the close-out probe are all under **GAP-1d**; the durable fix (forward the nested `data.*`,
> or carry `DataEntityMembership` on the junction nodes) is unchanged. The Cleome run additionally wants
> **junction PAYLOAD columns** (extra scalar columns on the join row), which the brief grammar can't yet express —
> that is a **skill-side** deferral (tracked in `references/benchmark-findings.md`, SG-3), **not** a platform gap.

---

## Priority for the platform team

1. **GAP-1** (per-tenant provisioner grants/policies + the `org_memberships_sprt` personal-org seed on
   `sign_up`/`provision` + `app_permission_defaults` + determinism) — **LANDED 2026-06-15.** This was the
   highest-leverage gap: the root of the silent-no-op class and the b2b unreachable-from-clean-signup class.
   Landing it retired the two largest harness workarounds (RLS-USERS-UPDATE-001, RLS-ORG-RECONCILE-001), the
   b2b-tier permission patch, and the org-reconcile stopgap (now deleted). A fresh b2b signup can now write
   org-scoped rows under its personal org natively. See the GAP-1b/1c owner/status/re-verify note above.
   (Re-run-safety determinism, G4, may remain — see the idempotency note.)
2. **GAP-9** (`sendVerificationEmail` aborts on `user_secrets_del(uuid, text[])`) — new from the 2026-06-05
   Wave-2 validation, **HIGH** with **no workaround**: the *real* email-verify blocker — the SEND raises
   server-side, so the entire email-verification flow is unreachable on `auth:email`. Headline EMAIL fix.
3. **GAP-1d** (M:N junction security NOT forwarded) and **GAP-6** (`createUser(type=2)` org-create RLS) — from
   the 2026-06-05 stress test, both **HIGH**. **GAP-1d update (Wave-2):** the harness now ships a FUNCTIONAL
   `AuthzAllowAll` junction stopgap, so the M:N *feature* works (attach/list/detach round-trip) — but the
   **literal per-org junction policy is still not honored** (the durable fix is upstream). **GAP-6** (Wave-2
   CONFIRMED LIVE via both the block and the direct API) leaves the b2b tier unable to mint its first org from a
   clean signup (now isolated: GAP-1b/1c is CLOSED upstream). Fix these to make the b2b + M:N tier *fully* correct.
4. **GAP-7** (OOM cache-leak) — new, **HIGH** for shared-infra availability: a single hub OOM takes down
   every concurrent tenant. Bound the per-DB handler-cache `Map` (LRU/TTL).
   - **GAP-15 / GAP-RELMEMBERSHIP-PROJ** (`AuthzRelatedEntityMembership` default projection broken-CLOSED for
     the FK→parent-PK shape, + `obj_schema` not auto-resolved from a bare sibling `obj_table`) — new from the
     2026-06-17 related-membership build, **HIGH**: a `related-membership` policy authored against the documented
     FK→parent-PK shape is a silent deny-all by default (the registry default projects the SPRT `entity_id`, not
     the parent PK the FK references — contradicting the platform's own first-party `sel_obj:true sel_field:'id'`
     usage) and is un-provisionable without an externally-resolved physical `obj_schema`. The harness works around
     BOTH consume-only (explicit projection params + an `app_public`→physical schema rewrite before construct).
     Durable fix: default the projection to the FK→parent-PK shape AND resolve a bare sibling `obj_table` to its
     schema/UUID in `construct_blueprint`.
5. **GAP-10** (`sendAccountDeletionEmail` silent no-op) and **GAP-11** (dashboard-blocks empty selection,
   *different repo*) — new from Wave-2, both **MEDIUM**: GAP-10 leaves account-deletion claiming success while
   no email is sent; GAP-11 leaves `forgot-password-card` + `sign-out-button` non-functional as-shipped. Fix
   alongside GAP-9 to make the full EMAIL + account surface work on `auth:email`.
6. **GAP-13** (auth client bearers the unauthenticated `signUp`/`signIn`, *SDK/dashboard-blocks repo*) — new
   from the 2026-06-15 owner-tier dogfood, **MEDIUM**: a stale token in storage makes a clean signup/signin fail
   with a misleading `UNAUTHENTICATED`. In-skill guard (`auth-page.tsx` mount-clear) papers over it; durable fix
   is the auth client not bearering the auth-entry mutations.
7. **GAP-14** (`construct_blueprint` strips the `_` before a trailing single char — `elevation_m` → `elevationm`)
   — new from the 2026-06-15 Cleome benchmark, **MEDIUM**: breaks the brief↔codegen column-name identity (TS
   not-assignable on a valid units-suffixed column) with **no in-harness fix that keeps the name** (only re-spell
   to a multi-char suffix or accept the mangled name). GAP-14b (payload N:M security) is a cross-reference to GAP-1d.
8. **GAP-3** (`revokeApiKey` no-op) and **GAP-2** (`revokeSession` id + the missing `userSessions` list /
   table split, re-confirmed 2026-06-05) — security-relevant: ops that lie about completing.
9. **GAP-4** (`useSignOutMutation` codegen) — one codegen fix unblocks a core auth op everywhere.
10. **GAP-5** (pending org procs) — completes the b2b admin surface.
11. **`constructBlueprint` idempotency** (note under GAP-1) — re-run safety; **GAP-8** (`AuthzNotReadOnly` /
   soft-delete semantics, LOW) and **GAP-12** (reset link param + reset-success redirect, LOW) — docs /
   convention clarification.

> **Full escalation for the 2026-06-05 stress-test findings (GAP-1d, GAP-6, GAP-7, idempotency, GAP-8, and
> the GAP-2 re-confirm) AND the Wave-2 fix-validation findings (GAP-9, GAP-10, GAP-11, GAP-12 + the GAP-1d /
> GAP-6 live confirmations):** see **`planning/upstream-gaps-stress-test-2026-06-05.md`** — symptom, root cause,
> owner (constructive / constructive-db / dashboard-blocks), severity, and a close-out re-verify probe per gap,
> with an index/priority table at the top.
