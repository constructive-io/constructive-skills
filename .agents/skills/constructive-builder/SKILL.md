---
name: constructive-builder
description: "Build a Constructive app end-to-end from a brief. Use when asked to build/scaffold an app on Constructive, create a CRUD app, provision a data model with RLS, wire Blocks + auth flows, or verify an app with Chrome QA / agent-browser — keep time-to-app under 10 minutes on a warm hub. Drives the four mainline phases (1 Backend Up, 2 Data Model Provisioned, 3 Frontend + SDK, 4 UI / Blocks) and supports the three policy tiers: owner-scoped, public-read + owner-write, and b2b org-membership. Triggers: \"build a Constructive app\", \"scaffold an app on Constructive\", \"provision a data model with RLS\", \"wire Blocks and auth flows\", \"verify the app with agent-browser\". Builds ANY CRUD app generically from a brief — it is NOT for editing the Constructive platform itself (constructive / constructive-db)."
compatibility: "Node 18+, a warm constructive-hub, agent-browser, pnpm, pgpm"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
license: MIT
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Builder

Take an AI coding agent from a **brief** to a **verified** Constructive application — a Next.js frontend over a PostgreSQL data model with RLS, the auth/account Blocks the app needs, and a Chrome round-trip proving it works — in four phases, generically, under 10 minutes on a warm hub.

This is a **router**. The happy path is a linear checklist; every detail, gate, and pre-emptive fix lives one hop away in `references/`. Read a reference only when you reach the step that needs it — reading everything up front is itself a time sink.

## When to Apply

Use this skill when the request is to **build or extend an application on Constructive**:

- "Build / scaffold an app on Constructive", "create a CRUD app", "make me a \<domain\> app".
- "Provision a data model with RLS", "stand up the blueprint / tables / policies".
- "Wire Blocks + auth flows" (sign-in, password reset, MFA, org members) onto an app.
- "Verify the app end-to-end" / "Chrome QA it" / "drive it with agent-browser".
- Any time-boxed ask: "get a working app in under 10 minutes".

**Scope.** It builds **ANY** CRUD app generically from a brief — entities, testids, and flows are *derived from the brief*, never hard-coded. It assembles three surfaces (see `references/architecture-overview.md`): the **auth surface** (Blocks/flows — auth/account/org/shell only), the **data surface** (the blueprint), and the **domain UI surface** (entity CRUD). It is **NOT** for editing the Constructive platform itself — do not touch `constructive` or `constructive-db` from here; platform behavior gaps are documented as workarounds in `references/platform-gaps.md`.

> **Self-contained.** Every path resolves inside this skill or via `constructive.config.json` + `CONSTRUCTIVE_*` env. There are no sibling-repo assumptions. Read a resolved coordinate with `node scripts/lib/config.mjs get <dotted.key>` (e.g. `hub.port`, `registry.baseUrl`); override any value with its `CONSTRUCTIVE_*` env var (the maps live in `constructive.config.json`). Relocate the file with `CONSTRUCTIVE_CONFIG_PATH`.

## The 10-Minute Speedrun

The happy path: a warm hub → a verified basic CRUD app + one auth flow, zero branching, every known build-break pre-empted by a scripted one-liner. **Full step detail, exact commands, and the per-step inline fixes are in [`references/speedrun.md`](./references/speedrun.md)** — drop into the matching phase doc only when a step fails.

- **S0 — Smoke the warm backend first** (~10s). `curl` the shared `:3000` hub (`Host: api.localhost`, `{ __typename }`). 200 → continue. 000/OOM → restart once with an 8 GB heap, re-curl. A warm hub means **skip Phase 1**. → `references/speedrun.md`, `references/infra-setup.md`.
- **S1 — Scaffold workspace + provision package.** `pgpm init` is non-interactive-hostile: pass `--no-tty` AND every template var as a flag (`--yes` alone hangs, PGPM-001). → `references/phase-2-data-model.md`.
- **S2 — Provision the DB from the brief.** `node scripts/scaffold-provision.mjs <brief> <app>` emits the 6 provision files (object-form grants, owner-scoped `AuthzDirectOwner` default, explicit module list — never `['all']`), then `cd packages/provision && pnpm run create-db && pnpm run provision`. The platform grants `authenticated` its privileges + the users `self_update` policy, and (on the b2b tier) the org grants + `create_entity` bit + the personal-org membership row, natively (PLATFORM-GAPS.md GAP-1b/1c, CLOSED) — no reconcile step. → `references/phase-2-data-model.md`.
- **S3 — Scaffold the frontend + wire endpoints.** `pgpm init … --repo constructive-io/sandbox-templates --template nextjs/constructive-app` (tiering is on **main**; no branch pin needed — see fix below), then `node scripts/wire-app.mjs --app <app> --sub <sub>` for single-workspace normalize + env + codegen-host + provider wiring in one idempotent shot. The template ships its **own** `pnpm-workspace.yaml` + `pnpm-lock.yaml` at the app-package root, which `pgpm init` unpacks under `packages/app` — a **nested** workspace whose lockfile pins a **second** Next, so the dev server intermittently dies with a `global-error.js` module-instantiation error; `wire-app.mjs` (step 0) strips any nested `packages/*/pnpm-workspace.yaml` + `pnpm-lock.yaml` so ONE root workspace + ONE Next resolve. → `references/phase-3-frontend-sdk.md`.
- **S4 — Pre-patch the template, then ONE install + codegen.** Pin ONE `graphql` (workspace `pnpm.overrides`), keep the **root** `pnpm-workspace.yaml` (the single workspace — `wire-app.mjs` already stripped the nested boilerplate one under `packages/app`, S3), gate app TS with a scoped `tsconfig.appcheck.json` (`next build` type-checks the whole monorepo). `wire-app.mjs` (S3) already DECLARED the extra app deps in `<app>/package.json` (`@constructive-io/graphql-codegen@latest` dev; for a blocks app `@constructive-io/ui` + `@simplewebauthn/browser`), so run a **single** `pnpm install` (NOT separate `pnpm add` rounds — each re-resolves the heavy tree, the warm-time sink) then `pnpm codegen`. → `references/phase-3-frontend-sdk.md`.
- **S5 — Blocks on-ramp** (only if the brief needs auth/account/org UI; else skip to S7). Pick the flow id from `references/flow-catalog.md` / `references/flows.json`; install its blocks from the **GitHub-Pages registry** (fix #3 below); the provider wiring is already done by `wire-app.mjs` — including the **per-request `app`-token seam (GAP-A / SDK-008)**: wire-app injects a custom `fetch` into the `app` SDK config that re-reads the live token on every request, so the FIRST create in a fresh session (right after sign-up/sign-in, before any reload) is authed instead of silently failing as anonymous (HTTP 200 + permission-denied + 0 rows). No longer a manual step. → `references/phase-4-blocks.md`, `references/blocks-onramp.md`.
- **S6 — Confirm the SDK preflight** (`node scripts/check-sdk.mjs --project <app>` exits 0) when S5 ran. → `references/phase-4-blocks.md`.
- **S6.5 — Apply the design theme** (after the Blocks `@import`, before the CRUD body). `node scripts/wire-design.mjs --app <app>` derives/compiles the app's `design.md` → writes a contrast-repaired token-override block into `globals.css` (+ optional `next/font` / `defaultTheme` swap), restyling the template **and** every installed Block at once. **Default = auto-propose** a domain-fitting theme; `design: { preset: constructive }` (or a compile failure) ⇒ **no-op**, today's look preserved. Idempotent + `--dry-run`-able. → `references/design-system.md`.
- **S7 — Build the domain CRUD body** (always). `node scripts/scaffold-frontend.mjs <brief> <app>` stamps the runtime-generic CRUD Stack + `_meta` meta-forms and emits a page per `ui.routes[].kind:crud` (loading/empty/error states + a DENSITY-keyed `data-density` root, dial-driven). → `references/phase-4-blocks.md`, plus the `constructive-frontend` skill.
- **S8 — Build + the two TS gates.** `pnpm exec tsc -p tsconfig.appcheck.json --noEmit` (real app-TS gate), then `pnpm build`, then `pnpm dev --port <port>` and curl 200. → `references/phase-3-frontend-sdk.md`.
- **S9 — Verify end-to-end through the UI.** Done = a real round-trip (signup → login → create a row → reload → row persists, mutation 2xx), not a green build. Then the automated gates `./scripts/verify-phase.sh 2.1 2.3 2.6 3`, and the independent evaluator. → "Verification" below + `references/speedrun.md`.

> **Checkpoint discipline.** After every green `verify-phase.sh` gate: update the per-app run-state (start from `fixtures/run-state.template.json`; the verifier **reads** it, never writes) and `git commit`/tag the green state so you can roll back to the last passing phase. With `APP_ID=<app-id>` exported (app-id = the brief's `naming.db_name`) the gates read `build/<app-id>/run-state.json` + `build/<app-id>/app-brief.yaml`; unset = the legacy singleton `build/run-state.json`. Roll back with `git reset --hard green-phase-<N>`, then re-run that phase. See `references/troubleshooting.md`.

### Correctness fixes baked into the happy path

1. **Frontend scaffold defaults to `main`** — the sandbox-templates auth:email tiering is merged to **main** (PR #25), so the `nextjs/constructive-app` template no longer needs a branch pin. Run `pgpm init … --repo constructive-io/sandbox-templates --template nextjs/constructive-app …` against the default branch. Keep `--from-branch <branch>` only as an **explicit optional pin** when you deliberately want a non-main snapshot.
2. **Hub Postgres image is `postgres-plus:18`** (cold Phase 1 only). → `references/infra-setup.md`, `references/phase-1-backend.md`.
3. **Registry is GitHub-Pages-FIRST.** The `@constructive` registry is live at `https://constructive-io.github.io/dashboard/r/{name}.json` (apps/blocks merged to dashboard main, PR #232; CI deploys to Pages). Install blocks directly from it — verify reachability with `curl -fsS https://constructive-io.github.io/dashboard/r/auth-sign-in-card.json >/dev/null`. The local `scripts/serve-registry.sh` on `:4081` is the **fallback only** (offline / Pages outage). → `references/phase-4-blocks.md`, `references/blocks-onramp.md`.

## The Four Phases

| Phase | Goal | Speedrun | Gate | Reference |
|---|---|---|---|---|
| **1 — Backend Up** | Docker (`postgres-plus:18`) + `pgpm deploy` + GraphQL server. **Warm hub → skip.** | S0 | `verify-phase.sh 1` | [`phase-1-backend.md`](./references/phase-1-backend.md) |
| **2 — Data Model Provisioned** | Workspace + provision package + blueprint (tables, RLS, grants). | S1–S2 | `verify-phase.sh 2.1`, `2.3` | [`phase-2-data-model.md`](./references/phase-2-data-model.md) |
| **3 — Frontend + SDK** | Scaffold Next.js app + `pnpm codegen` (admin + auth + app SDK). | S3–S4, S8 | `verify-phase.sh 2.6` | [`phase-3-frontend-sdk.md`](./references/phase-3-frontend-sdk.md) |
| **4 — UI / Blocks** | Blocks on-ramp (conditional) + domain CRUD body. | S5–S7 | `verify-phase.sh 3` | [`phase-4-blocks.md`](./references/phase-4-blocks.md) |

Side-quests — search, email, standalone SDK, seed data — are **not** mainline; add one only when the brief calls for it (each phase doc points to the matching extension). Authoring depth for the data/security surfaces is in the cross-referenced skills below.

## Briefs & Policy Tiers

A build is **brief-driven**: you author a declarative brief (entities + policy intents + flows + acceptance), and the scaffolders generate everything from it. The brief grammar — every field, the policy **intents**, and the `nodes_raw`/`policies_raw` escape hatches — is in [`references/brief-grammar.md`](./references/brief-grammar.md). Start from `fixtures/app-brief.template.yaml`.

Each table declares a **policy intent**, which maps to one of three tiers:

| Tier | Intent | RLS shape | Fixture (frozen example) |
|---|---|---|---|
| **owner-scoped** | each user owns their rows (default) | `DataId + DataDirectOwner` + `AuthzDirectOwner` (`entity_field: owner_id`) | [`fixtures/golden-app-brief.yaml`](./fixtures/golden-app-brief.yaml) (`todos`) |
| **public-read + owner-write** | anyone reads, owner writes | public read policy + owner-scoped write | [`fixtures/test-blog-brief.yaml`](./fixtures/test-blog-brief.yaml) (`posts`) |
| **b2b org-membership** | org tenancy via membership | `DataEntityMembership` + `AuthzEntityMembership` (needs the **b2b** org modules) | [`fixtures/test-crm-brief.yaml`](./fixtures/test-crm-brief.yaml) (`companies` ← `contacts`) |

> Picking flows is part of authoring the brief: map each capability ("sign in", "reset password", "manage org members") to a **flow id** in `references/flows.json`, and provision the **union** of those flows' `backend.modules[]` — never `['all']`. The b2b tier's org membership is provisioned natively by the platform (`references/platform-gaps.md` GAP-1b/1c, CLOSED) — no extra reconcile step. See `references/brief-grammar.md` and `references/flow-catalog.md`.

## Day-2 / evolving a built app

**Additive evolution IS supported and IDEMPOTENT** — once an app is built, you can add an entity/field/relation or flip a table's policy without a drop-and-rebuild. The loop is: **edit the brief → `scaffold-provision` → `pnpm run provision` → `pnpm codegen` → `scaffold-frontend` → verify**. Re-running `provision` against the existing DB is verified idempotent (exit 0, no duplicate policies, rows preserved — do **not** `create-db` again). The new field reaches the UI via the runtime-generic `DynamicFormCard`/`_meta` forms after codegen, **not** hand-edited page code (which is never regenerated), so restart the dev server clean after a mid-session codegen.

> **The ONE caveat:** adding a **`NOT NULL` (required) column to a table that already holds rows** aborts atomically (`contains null values`) — the platform applies the day-2 ADD-COLUMN default too late to backfill. Add it **nullable first → backfill → tighten**, or change it on an empty table. The **publishable** case (`policy: public-read+owner-write` / `features: [publishable]`) is **auto-handled** (columns pre-materialized nullable). Upstream defect = `references/platform-gaps.md` GAP-16. **Full workflow → [`references/day2-evolve.md`](./references/day2-evolve.md).**

## Verification

**Verification is the definition of done — never self-grade a green build.**

- **Live-QA (automated floor).** `scripts/live-qa.mjs` (invoked by `verify-phase.sh 3` when `LIVE_QA=1` or the brief sets `acceptance.required_flows`) iterates **every** entry in `acceptance.required_flows[]` and drives each flow's happy path in **Chrome via agent-browser**, selecting by **data-testid / role only** (so block restyles can't break it). For `email-password`: signup → create a row → reload → assert the row persisted AND auth is still correct. A required flow with no QA script fails **loudly** (coverage gap) — never a silent skip. See `references/troubleshooting.md`.
- **Independent evaluator (final judgment).** After the gate is green, spawn a **fresh** evaluator sub-agent given **only** the brief's `acceptance.required_flows` + the running app's URL (never your transcript, diff, or run-state). It drives the app and returns pass/fail per flow; the build is done only on **OVERALL: pass**. Follow the exact spawn prompt in [`references/evaluator-role.md`](./references/evaluator-role.md).
- **Time-to-app KPI + rot canaries.** `scripts/golden-path.sh` smokes `:3000` → runs the real phase gates against the frozen golden brief → Chrome live-QA → prints `OVERALL` + start→pass elapsed (the <10-min KPI). `scripts/genericity-check.sh --canary <todos|blog|b2b>` runs the same span pre-wired to each policy tier. **Run `golden-path.sh` after any toolkit edit** — it catches rot before a real build hits it.

## Reference Guide

| Reference | Topic | Consult when |
|---|---|---|
| [speedrun.md](./references/speedrun.md) | The full S0–S9 happy-path checklist with every command + inline pre-emptive fix | Running the build — this is the path; read it first |
| [phase-1-backend.md](./references/phase-1-backend.md) | Cold-infra: Docker (`postgres-plus:18`), `pgpm deploy`, GraphQL server, gate `1` | Standing up a backend from cold (skip on a warm hub) |
| [phase-2-data-model.md](./references/phase-2-data-model.md) | Workspace + provision pkg + blueprint; object-form grants, policy intents, module list, grant outcomes | Provisioning the data model / RLS, or a 2.1/2.3 gate fails |
| [phase-3-frontend-sdk.md](./references/phase-3-frontend-sdk.md) | Scaffold the Next.js app, env + `api-<sub>` endpoints, `graphql` override, codegen, the TS gates | Scaffolding the frontend / running codegen, or a 2.6 gate fails |
| [phase-4-blocks.md](./references/phase-4-blocks.md) | Blocks on-ramp branch + the domain CRUD body; gate `3` | Wiring auth/account/org UI or building entity CRUD |
| [brief-grammar.md](./references/brief-grammar.md) | The brief schema: entities, policy intents, flows, acceptance, escape hatches, the optional `design:` block | Authoring or editing a brief |
| [design-system.md](./references/design-system.md) | Authoring a `design.md` theme: the 3 dials + words→dials table, color invariants, preset catalog, the compile/override contract (role→var, override surface, font/contrast/tint gotchas), keep-default hatch, layout/state patterns | Shaping an app's look-and-feel (S6.5) — auto-propose a theme or honor a `design:` brief block |
| [infra-setup.md](./references/infra-setup.md) | Hub coordinates, `constructive.config.json`, `CONSTRUCTIVE_*` env, smoke/restart | Pointing a build at a different backend/ports, or the hub is down |
| [blocks-onramp.md](./references/blocks-onramp.md) | The six-step Blocks bridge (binding, deps, env, install, providers, preflight) for this template | Deep Blocks install/wiring, or a BLOCKS-NNN issue |
| [flow-catalog.md](./references/flow-catalog.md) | Human-readable GA auth-flow catalog (preset, modules, exposed ops, blocks) | Choosing which auth flow(s) to install |
| [flows.json](./references/flows.json) | Machine-readable flow catalog — drive provisioning + install programmatically | Resolving a flow's exact `backend.modules[]` / `blocks[]` |
| [gotchas.md](./references/gotchas.md) | Non-negotiable invariants (PGPM-001, PROVISION-001, BLOCKS-001…011, RLS rules) | Once up front; then keep in mind across all phases |
| [troubleshooting.md](./references/troubleshooting.md) | Known problems → solutions, keyed by phase | Only on a failure — grep your phase / symptom |
| [error-index.md](./references/error-index.md) | Flat `symptom → cause → fix pointer` lookup | Ctrl-F the literal error string you got |
| [platform-gaps.md](./references/platform-gaps.md) | Confirmed upstream platform gaps + the build-side workarounds (GAP-N) | A flow fails for a reason that smells upstream (org reconcile, sessions, email) |
| [day2-evolve.md](./references/day2-evolve.md) | The verified additive day-2 evolve loop: re-provision is idempotent; the one NOT-NULL caveat; how a new field reaches the UI | Evolving an already-built app — add an entity/field/relation or flip a policy |
| [benchmark-findings.md](./references/benchmark-findings.md) | The maximal-app benchmark result: what PASSED, the generic primitives DISTILLED (SG-*), what's DEFERRED, what was ESCALATED | Understanding the generator's proven coverage + the known scoped deferrals (SG-3/4/5/7/8/9) |
| [evaluator-role.md](./references/evaluator-role.md) | Independent acceptance evaluator: rationale + exact fresh-sub-agent spawn prompt | The Phase 4 final acceptance gate |
| [secrets-and-config.md](./references/secrets-and-config.md) | Index of platform plumbing — site-domain, email ports, secrets/KMS, app env keys | Wiring `.env`, standing up email, a secret/API-key flow, a config error |
| [architecture-overview.md](./references/architecture-overview.md) | The three build surfaces, the two SDKs, the two auth tokens | Building a mental model of what you're assembling |
| [skill-supplements.md](./references/skill-supplements.md) | Per-phase fallback: pointers to the real template files (`scripts/templates/*`) + the genuine fallback (type catalogs, relation-UI principles, data-modeling gotchas, the imperative provision path, the org-flow recipe) | A scaffolder can't express a shape and you hand-edit |

> **Known block↔backend gaps (kept intact).** `createApiKey` accepts `accessLevel ∈ {read_only, full_access}` only (the dialog's `read/write/admin` → live `INVALID_ACCESS_LEVEL`); and four capabilities are **backend-pending / blocked** — list sessions, list API keys (no Connection type), self-service org create on b2b (GAP-6), and sessions-revoke id mismatch (GAP-2). `scripts/check-sdk.mjs` surfaces these as contract advisories. Full detail in `references/platform-gaps.md` + `references/flow-catalog.md`.

## Cross-References

- **`constructive-blocks`** — the authoritative Blocks playbook: the SDK binding contract, `requires.json` manifests, `blocks-runtime` wiring, and authoring new auth/account/org blocks. Reach for it for Blocks depth (S5 / phase 4).
- **`constructive-frontend`** — the `@constructive-io/ui` component library **and** the home of domain-entity CRUD UI (CRUD Stack cards + `_meta` meta-forms). Reach for it for business-table UI (S7) and to extend the generated CRUD pages.
- **`constructive-data-modeling`** + **`constructive-blueprints`** — the blueprint shape, the node-type registry (which `Data*` node adds `id`/`owner_id`/`entity_id`), and database provisioning. Reach for them when shaping the data surface (S2).
- **`constructive-security`** — the Authz policy protocol (the 18 `Authz*` types) + per-policy config keys (e.g. `AuthzDirectOwner` → `entity_field`), RLS, and grants. Reach for it when shaping policy intents (S2).
- **`constructive-codegen`** (+ `constructive-orm` / `constructive-hooks`) — the codegen CLI/config and the generated SDK output shapes the app consumes (S4).
- **`constructive-platform`** — `cnc` CLI, server config, and endpoint/API deployment (what determines which ops a namespace exposes). Reach for it for backend/server questions (S0 / phase 1).
