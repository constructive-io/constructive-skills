# Day-2 change set — the recipe-box evolution (human companion to `turns.json`)

This is the **human-readable** companion to `turns.json` (the machine spec the runner
consumes). Each turn below is **one day-2 change** a fresh agent is handed AFTER the
baseline app (`turn0-recipebox-brief.yaml` — a one-table owner-scoped recipe box) is
already built and running. The turns are **cumulative**: turn _n_ applies on top of the
brief produced by turn _n-1_.

Every turn probes a different **day-2 layer** (a kind of change to an _already-provisioned_
app), and carries a **dual assertion**:

- **new-capability** — the change actually took effect, _and_
- **regression** — the `email-password` round-trip the baseline shipped still works.

The **skill-only path** is what a fresh agent gets running _today_ with only the
constructive-builder skill (no day-2 driver): it re-edits the brief and re-runs
`scaffold-provision` + `pnpm run provision`. Because `provision` does a **full**
re-provision of an _already-provisioned_ database, it replays `CREATE POLICY` for the
existing `recipes` policies and **aborts** (the `PROVISION-RERUN-001` duplicate-policy
abort) before the new change can land. So skill-only mode **demonstrates the gap**: the
day-2 change does NOT take effect. The **hybrid path** is the Stage-C `day2-driver` that
applies the _incremental_ change (a STUB this stage — the runner exits with a clear
"hybrid mode requires Stage C day2-driver" message when invoked in hybrid mode).

> The baseline (turn 0) is the same owner/email tier the golden canary uses, so it builds
> hands-free on a bare warm hub. Field types, policies, relation shape, the flow id, and
> its module set below were all validated against `scripts/lib/brief.mjs` via a DRY
> `scaffold-provision` (see `README.md`).

---

## Turn 1 — additive column (layer: `db-column`)

- **Change request handed to the agent:**
  > Add a prep time (in minutes) field to recipes so a cook can record how long a recipe
  > takes to prepare.
- **Exact brief edit:** in `data_model.tables[name=recipes].fields`, append
  `{ name: prep_minutes, type: { name: numeric } }` (optional — no `required`, no `default`).
- **Day-2 layer probed:** adding a **plain column** to an existing table.
- **Skill-only expected outcome:** `scaffold-provision` regenerates `schemas/core.ts` with
  the new field, but `pnpm run provision` **aborts** with the `PROVISION-RERUN-001`
  duplicate `CREATE POLICY` error (full re-provision of an already-provisioned DB). The
  column never lands; a recipe still has no `prep_minutes`.
- **Hybrid path:** `day2-driver add-column recipes.prep_minutes:numeric` → `pnpm codegen`
  → `scaffold-frontend --refresh-entity recipes` → `day2-verify` (an `ALTER TABLE … ADD
  COLUMN`, no policy replay).
- **Dual assertion:**
  - _new-capability_ — create a recipe with `prep_minutes=30`, reload, and the value
    **persists** (round-trips from the DB) **and renders** in the recipe list/detail.
  - _regression_ — the `email-password` flow still round-trips (signup → create recipe →
    reload → assert persisted + authed) on `/recipes` with the `recipe-*` testids.

## Turn 2 — new entity + relation (layer: `db-table-relation`)

- **Change request handed to the agent:**
  > Let a recipe have a list of ingredients. Add an ingredients entity where each
  > ingredient belongs to exactly one recipe (the recipe is required), and is private to
  > its owner like recipes.
- **Exact brief edit:** add an owner-scoped table `ingredients` with fields
  `{ name: text required }` + `{ quantity: text }`; add a `RelationBelongsTo` from
  `ingredients` → `recipes` via a **required** FK `recipe_id` (`delete_action: CASCADE`);
  add a CRUD route `{ path: /ingredients, label: Ingredients, kind: crud, entity: ingredient }`.
- **Day-2 layer probed:** adding a **new table + a required-FK relation** to a live app
  (the child-FK shape — the create must supply a non-null parent FK, so the child page
  emits an FK picker bound to the recipes list and spreads the camelCase `recipeId`).
- **Skill-only expected outcome:** `scaffold-provision` regenerates the blueprint with the
  new table + relation, but `pnpm run provision` **aborts** (`PROVISION-RERUN-001`) — it
  replays the existing `recipes` policies before it ever reaches the new `ingredients`
  table. The table + relation never land.
- **Hybrid path:** `day2-driver add-table ingredients (owner)` → `day2-driver add-relation
  ingredients.recipe_id->recipes required CASCADE` → `pnpm codegen` → `scaffold-frontend
  --add-entity ingredient` → `day2-verify`.
- **Dual assertion:**
  - _new-capability_ — create a recipe, then create an ingredient that picks that recipe
    via the required `recipe_id` FK picker (camelCase `recipeId` spread into the create),
    reload, and the ingredient **persists bound to its parent recipe**; a create with **no
    recipe selected is rejected** (the FK is NOT NULL).
  - _regression_ — the `email-password` flow still round-trips on the original `recipes`
    entity (`recipe-*` testids), and recipes still CRUD-persist.

## Turn 3 — RLS policy flip (layer: `rls-policy`)

- **Change request handed to the agent:**
  > Make recipes shareable: a published recipe should be readable by any signed-in user,
  > but only its author may create, edit, or unpublish it. Ingredients stay private to
  > their owner.
- **Exact brief edit:** change `data_model.tables[name=recipes].policy` from `owner` to
  `public-read+owner-write`. This swaps the single `AuthzDirectOwner` policy for the
  two-policy stack (`AuthzDirectOwner` all-CRUD + `AuthzPublishable` select-only) and adds
  the `DataPublishable` node (`is_published` / `published_at`). `ingredients` stays
  `policy: owner`. **No preset change** — `public-read+owner-write` works on `auth:email`.
- **Day-2 layer probed:** **flipping the access model (RLS policy)** of an existing table —
  the hardest day-2 change, because it drops/replaces live policies and adds columns.
- **Skill-only expected outcome:** `scaffold-provision` regenerates the two-policy stack,
  but `pnpm run provision` **aborts** (`PROVISION-RERUN-001`) — re-provision replays the
  **existing** `recipes` `AuthzDirectOwner` `CREATE POLICY` and dies. The flip never lands,
  so a second user still cannot read another user's recipe.
- **Hybrid path:** `day2-driver set-policy recipes public-read+owner-write` (drops the
  owner-only SELECT policy, adds the `DataPublishable` columns `is_published` /
  `published_at`, applies `AuthzDirectOwner` all-CRUD + `AuthzPublishable` select-only) →
  `pnpm codegen` → `scaffold-frontend --refresh-entity recipes` → `day2-verify`.
- **Dual assertion:**
  - _new-capability_ — user A publishes a recipe (`is_published=true`); a **second user B
    can READ** user A's published recipe; user A (owner) can **still write/unpublish** it;
    user B (non-owner) **still CANNOT write** it; `ingredients` remain owner-private (B
    cannot read A's ingredients).
  - _regression_ — the `email-password` flow still round-trips for the **owner** on
    `/recipes` (owner can still create/read/edit their own recipes; `recipe-*` testids).

## Turn 4 — add a flow (layer: `flow-modules`)

- **Change request handed to the agent:**
  > Add a self-serve password reset: a user who forgot their password can request a reset
  > email and set a new password from the emailed link.
- **Exact brief edit:** append `password-reset` to the top-level `flows` list (alongside
  `email-password`). **Do NOT** add it to `acceptance.required_flows` (no live-QA driver
  for it yet — `email-password` stays the only acceptance flow).
- **Day-2 layer probed:** **adding an auth/account flow** to a live app (its modules + ops
  + Blocks). `password-reset` rides the same `auth:email` base — it adds **zero new
  modules** (its `backend.modules` are byte-identical to `email-password`'s auth:email
  13-module set) and contributes the `forgotPassword` / `resetPassword` ops + the
  forgot-password / reset-password Blocks. (`turns.json` records the exact module list,
  ops, and Blocks, verified equal to `references/flows.json`.)
- **Skill-only expected outcome:** `scaffold-provision` regenerates fine, but `pnpm run
  provision` **aborts** (`PROVISION-RERUN-001`) — it replays the existing
  `recipes`/`ingredients` policies before wiring the new flow's Blocks. Because the flow
  adds no modules, even an idempotent `create-db` is a no-op here; the real change is the
  frontend Blocks + ops surface, which the skill-only re-provision cannot wire onto an
  already-built app. The flow never lands.
- **Hybrid path:** `day2-driver add-flow password-reset` (union its modules into create-db
  — a no-op here since it adds none; wire the forgot-password / reset-password Blocks +
  routes) → `pnpm codegen` → `scaffold-frontend --add-flow password-reset` → `day2-verify`.
- **Dual assertion:**
  - _new-capability_ — the password-reset happy path **round-trips**: request a reset for
    the signed-up email (`forgotPassword`) → open the reset link from **Mailpit
    (`:8025`)** → set a new password (`resetPassword`) → sign in with the **new** password
    succeeds and the **old** password fails.
  - _regression_ — the `email-password` flow still round-trips (signup + sign-in + create
    recipe + reload) unchanged.
