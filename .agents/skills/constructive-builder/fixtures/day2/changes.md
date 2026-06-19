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
`scaffold-provision` + `pnpm run provision`. The runner then **PROBES the live tenant
schema** to see whether the change actually landed (DID-IT-LAND) and scores the turn from
that ground truth — **not** from any prediction in the fixture.

> **Verified reality (Stage-B baseline, warm hub).** An earlier draft of this fixture
> claimed every turn aborts skill-only with a duplicate-`CREATE POLICY`
> (`PROVISION-RERUN-001`). That premise was **FALSIFIED** and has been removed. What a
> Stage-B run actually observed, and what the live tenant confirms:
>
> - **Additive re-provision is idempotent.** Adding an optional column (Turn 1) or a new
>   table + required-FK relation (Turn 2) **lands clean skill-only** — `provision` exits 0,
>   the new column/table/FK appear in `information_schema`, the existing policies are **not**
>   duplicated, and no data is lost.
> - **The real wall is a NOT-NULL column on an _already-populated_ table** (Turn 3's
>   `is_published`): you cannot add a `NOT NULL` column to a table that already has rows
>   unless it is added nullable or with a default and backfilled. (This may be _fixed_ by
>   the column-emit work — if `is_published` is emitted nullable / `DEFAULT false`, the
>   probe reports `landed=yes` and the turn is clean.)
> - **A no-module flow add is _partial_** (Turn 4): `password-reset` adds **zero** modules,
>   so the re-provision leg is a no-op; the change is purely the frontend Blocks + ops, which
>   install but are not wired/codegen'd onto the live app hands-free.

The **hybrid path** is the Stage-C `day2-driver` that applies the _incremental_ change (a
STUB this stage — the runner exits with a clear "hybrid mode requires Stage C day2-driver"
message when invoked in hybrid mode).

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
- **Skill-only outcome — VERIFIED `clean`:** `scaffold-provision` regenerates
  `schemas/core.ts` with the new field and `pnpm run provision` **lands the column** — an
  additive, optional column is idempotent on an already-provisioned DB. Confirmed in the
  live tenant: `information_schema.columns` shows `recipes.prep_minutes` (nullable);
  `provision` exits 0 with no duplicate-policy abort and no data loss. (The earlier
  `PROVISION-RERUN-001` abort prediction was false for this turn.) The runner's did-it-land
  probe reports `landed=yes`; with the frontend refreshed the new value round-trips.
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
- **Skill-only outcome — VERIFIED `clean`:** `scaffold-provision` regenerates the blueprint
  with the new table + relation and `pnpm run provision` **lands them** — a new
  owner-scoped table and a required-FK relation are additive, so re-provisioning the
  existing `recipes` table is idempotent (no duplicate-policy abort). Confirmed in the live
  tenant: the `ingredients` table exists (`information_schema.tables`) and its `recipe_id`
  FK column exists (`information_schema.columns`). The runner's did-it-land probe reports
  `landed=yes`. (The earlier `PROVISION-RERUN-001` abort prediction was false for this turn.)
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
  the hardest day-2 change, because it adds the `AuthzPublishable` policy + the
  `DataPublishable` columns to a table that **already holds rows**.
- **Skill-only outcome — VERIFIED `impossible` on a DIFFERENT cause than once claimed:**
  the policy stack itself re-provisions idempotently — the `AuthzPublishable` SELECT policy
  and the additive `published_at` column **can** land (the live tenant shows
  `auth_sel_publishable` on `recipes` and the publishable columns present). The actual day-2
  wall is the **NOT-NULL backfill**: making an already-populated table public-readable wants
  `is_published NOT NULL`, and `ALTER TABLE … ADD COLUMN is_published … NOT NULL` on a table
  with existing rows fails (`column "is_published" contains null values`) **unless** the
  column is added nullable / `DEFAULT false` and backfilled.
  - **May be fixed by the column-emit work:** if `is_published` is emitted nullable or
    `DEFAULT false` (and backfilled), the probe reports `landed=yes` and this turn becomes
    `clean`. The runner **measures** whichever is true — it does not assume. (The earlier
    duplicate-`CREATE POLICY` `PROVISION-RERUN-001` prediction was false and is removed.)
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
- **Skill-only outcome — VERIFIED `partial`:** `scaffold-provision` regenerates fine and
  `pnpm run provision` has **nothing to do at the schema layer** — `password-reset` adds
  **zero** modules (its `backend.modules` are byte-identical to `email-password`'s
  `auth:email` set), so the re-provision leg is a **no-op** and the did-it-land probe
  reports `landed=n/a` (no DB-checkable op). The real change is purely the **frontend**
  surface: the forgot-password / reset-password Blocks install + the
  `forgotPassword`/`resetPassword` ops. The Blocks install fine; what the skill-only path
  does **not** do hands-free is wire + codegen them onto the already-built app so the new
  capability round-trips end-to-end. So the backing + regression stay intact while the new
  capability is not driven skill-only → **partial** (not a clean landing, not a hard abort).
  (The earlier "aborts before wiring Blocks" `PROVISION-RERUN-001` prediction was false —
  there are no new policies to replay; the re-provision simply has nothing to do.)
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
