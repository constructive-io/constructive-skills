# Day-2 — Evolving an Already-Built App

> **Consult when** the app is already built and provisioned, and the brief needs to **change** — add an entity,
> add a field, add a relation/FK, or flip a table's policy (e.g. make it publishable). This is the **additive
> evolve** loop. It is **verified, idempotent, and skill-only** for additive changes — no drop-and-rebuild.

This complements the first-build path (the S0–S9 speedrun). Everything here is **additive**: you grow the
brief and re-run the same scaffolders. Destructive changes (drop a column/table, change a column type, rename)
are **not** covered here and are not generically safe — for those, treat it as a fresh build on a new db name.

---

## TL;DR — the verified additive loop

```
edit build/<app-id>/app-brief.yaml          # add the entity / field / relation / policy
  ↓
node scripts/scaffold-provision.mjs <brief> <app>     # re-emit the 6 provision files from the (grown) brief
  ↓
cd packages/provision && pnpm run provision           # IDEMPOTENT — exit 0, no dup policies, rows preserved
  ↓
cd ../app && pnpm codegen                              # regenerate the SDK/types/_meta for the new shape
  ↓
node scripts/scaffold-frontend.mjs <brief> <app>      # re-stamp the runtime-generic CRUD pages/_meta
  ↓
# restart dev clean (see "Restart dev clean after mid-session codegen" below), then verify the round-trip
```

**Do NOT `pnpm run create-db` and do NOT drop the database** for an additive change. `create-db` is
first-build only. Re-running `provision` on the existing DB is the supported, verified path.

---

## Why re-provision is safe (the idempotency fact)

**Verified adversarially on the live hub (2026-06-18):** re-running `pnpm run provision` against an
**already-provisioned** DB is **idempotent for additive changes**:

- returns **exit 0** (it does **NOT** abort on a duplicate `CREATE POLICY` — the blueprint policy/object
  emission is guarded, not a bare `CREATE POLICY`);
- does **NOT** duplicate policies — verified `4 → 4` identical policy names on an owner-scoped table;
- **preserves every existing row** — verified `12 → 12`.

This **refutes** the old "constructBlueprint is not re-runnable / drop-and-rebuild" guidance (see gotchas
**PROVISION-RERUN-001**, now corrected, and the **falsified idempotency note** under `references/platform-gaps.md`
→ GAP-1). Add-column, add-table, and add-required-FK on a **fresh/empty or unaffected** table all land clean
and skill-only on a re-run.

> **Re-running with NO brief change** is a clean no-op (exit 0) — safe to re-run for confidence.

---

## How a new field/table reaches the UI — the `DynamicFormCard` nuance (important)

A day-2-added field/entity surfaces in the running app **ONLY** through the **runtime-generic** surface, not
through any hand-written page:

- **`pnpm codegen` regenerates** the SDK, the generated types, and the `_meta` introspection the runtime forms
  read. This is what makes the new field exist for the app at all.
- The **CRUD Stack + `DynamicFormCard` meta-forms** (stamped by `scaffold-frontend.mjs`) render fields
  **dynamically from the live `_meta`** — so a newly-provisioned column **appears in the runtime detail/CRUD
  form automatically** after codegen, with no per-field edit.
- **Bespoke / hand-edited page code is NEVER regenerated.** If you (or an earlier step) hard-coded a specific
  field into a quick-add form or a custom page, a day-2 field will **NOT** appear there — only in the
  runtime-generic `DynamicFormCard`-driven surface. **Lesson:** for evolving apps, lean on the generic CRUD
  Stack / `_meta` forms; do not hard-code per-field quick-adds you'll have to hand-maintain. (Authoring depth
  for the CRUD Stack + `_meta` forms is in the `constructive-frontend` skill.)

> **Known surface defect (escalated, consume-only):** the `_meta` **Edit** form can load **blank** (existing
> values not pre-filled) due to a `DynamicFormCard` record-load inflection mismatch — `references/platform-gaps.md`
> → **GAP-17** (`@constructive-io/ui`, not fixable here). The new field still appears (empty) in the form; it is
> the **existing-value hydration** that's broken. Verify Create works; flag Edit-hydration as the known gap.

---

## The ONE real day-2 caveat — a NOT-NULL column on a POPULATED table

This is the **only** thing that makes an additive re-provision fail — and it is **not** idempotency, it is an
upstream DDL-ordering defect.

**Symptom.** Adding a **required (`NOT NULL`) column with a default** to a table that **already holds rows**
aborts the whole (atomic) `constructBlueprint` with:

```
column "<col>" of relation "<t>" contains null values
```

…and **rolls back fully** (rows intact, the new column absent, existing policies unchanged). On a **fresh/empty**
table the same add is fine (created `NOT NULL` with no rows to violate).

**Root (upstream, consume-only).** The platform sequences the day-2 DDL as `ADD COLUMN` (nullable, **no inline
default**) → `SET NOT NULL` (because `is_required`) → `SET DEFAULT`. The `DEFAULT` lands **after** the NOT-NULL
check, so it never backfills the existing rows. The brief's `default:` cannot rescue this — the platform applies
a day-2 ADD-COLUMN default too late. Full root-cause (two platform files) + the proposed upstream fix are in
`references/platform-gaps.md` → **GAP-16**.

### The publishable case is auto-handled (the generator does it for you)

Turning a **populated** table publishable — `policy: public-read+owner-write` or `features: [publishable]` — is
the canonical trigger for this abort (the platform's `DataPublishable` generator creates `is_published` as
`is_required := true, default := false`). The skill **auto-handles** this one case generically:
`scripts/lib/brief-blueprint.mjs` `buildTableDefinition` **pre-materializes** the publish-state columns as
**NULLABLE** blueprint fields **before** the platform generator runs — `is_published { type:{name:boolean},
default:{value:false} }` (nullable) + `published_at { type:{name:timestamptz} }` (nullable), with names
**derived** from the emitted `AuthzPublishable` policy data (no app-specific literal). The platform's
`data_publishable.sql` is **idempotent** (`IF existing_field_id IS NULL` guard), so when the field already
exists it **SKIPS** `create_field` and with it the `SET-NOT-NULL` step → the column stays nullable, no
`SET-NOT-NULL` runs, and provision **succeeds on a populated OR fresh table**.

- **`NULL` is the safe unpublished state** (`AuthzPublishable`'s qual is `is_published = true AND …`, FALSE for
  NULL); `default:false` keeps NEW inserts at false.
- **Trade-off (documented):** the column is **nullable** rather than `NOT NULL` even on a fresh table — the only
  skill-side way to make day-2 publishable adds work. The durable `NOT-NULL-with-backfill` fix is upstream
  (GAP-16). **Proven:** the nullable+default shape landed on a 13-row populated `recipes` table (public-read
  enabled); the `check-scaffold` canary (incl. the blog public-read divergent) passes.

### A generic required column (not publishable) — author-level workarounds

For **any other** required column added day-2 to a populated table (the generator can't detect this from a node
type), there is **no auto-fix**. Two author-level workarounds (also documented in `references/brief-grammar.md`,
the 🚨 "Adding a `required: true` column DAY-2 to a table that already holds rows" note):

1. **Add it nullable first, then tighten.** Omit `required:` and give it a `default:` so NEW rows get a value
   and existing rows stay NULL → re-provision (lands clean) → **backfill** the existing rows → set `required:
   true` and re-provision once every row has a value.
2. **Add it on an empty table / pre-backfill.** Make the change before the table has rows, or pre-populate the
   would-be-non-null values before tightening to `required`.

---

## The verified policy flip — `public-read+owner-write` on a populated table

Flipping a populated owner-scoped table to `public-read+owner-write` was **verified end-to-end on the live hub
(2026-06-18)** once the column landed (i.e. once GAP-16's publishable pre-materialize did its job):

- the two-policy stack **coexists correctly** — the 4 `AuthzDirectOwner` policies (writes stay owner-scoped)
  **plus** `AuthzPublishable` (select-only on publish);
- **owner write** ✅, **non-owner write denied** ✅ (200 / 0 rows / no hijack), **drafts hidden from the
  public** ✅.

**But the read semantic is ANONYMOUS-read, not authenticated-second-user read.** The platform binds
`AuthzPublishable`'s SELECT policy to the **`anonymous`** role only, not `authenticated`. So:

- a **logged-out** visitor reads published rows ✅ (`public read` = the unauthenticated public);
- a **second authenticated, non-owner** user does **NOT** see another user's published rows via this policy —
  their `authenticated` reads are still owner-scoped by `AuthzDirectOwner`.

This is the live-verified semantic — `references/brief-grammar.md` (the `public-read+owner-write` policy-intent
row + Tier-2 section) is already corrected to it, and it's recorded as `references/platform-gaps.md` →
**GAP-PUBLISHABLE-ROLE**. **The flip's only blocker was ever the column (GAP-16), not the policy.**

---

## Cumulative-brief land-or-revert rule

Treat each day-2 change as a **transaction against the brief**:

- **Keep the brief cumulative.** The brief is the source of truth and `scaffold-provision` re-emits the *whole*
  provision from it — so the brief must always describe the **full** intended schema (every prior entity/field
  **plus** the new one), never a diff/delta. Re-running provision from a cumulative brief is exactly the
  idempotent path above.
- **Land or revert as a unit — per change.** Make **one** schema change at a time, re-provision, and confirm it
  landed (`provision` exit 0 + the new shape is present, e.g. via codegen output / a `_meta` check / a live
  round-trip). If a change aborts (the GAP-16 NOT-NULL case is the realistic one), the platform **rolls back
  atomically** — so **revert that change in the brief** (or convert it to the nullable-then-tighten form) before
  moving on. Do not pile a second unverified change on top of an aborted one.
- **Checkpoint the green state.** After a change lands and verifies, follow the speedrun's checkpoint discipline
  — update the per-app run-state and `git commit`/tag the green state so you can roll back to the last passing
  schema if a later change misbehaves (see SKILL.md → "Checkpoint discipline").

---

## Restart dev clean after mid-session codegen

`pnpm codegen` rewrites the generated SDK/types/`_meta` that the **running** dev server has already imported.
Next's dev server and React Query caches do **not** always pick up the regenerated modules cleanly mid-session
(stale module instances, cached `_meta`, an HMR boundary that doesn't invalidate the generated tree). After a
day-2 `pnpm codegen`:

1. **Stop** the running dev server.
2. **Restart it clean** — `pnpm dev --port <port>` (a fresh process re-imports the regenerated SDK/`_meta`).
3. In the browser, do a **hard reload** of the app tab so the client picks up the new generated client and
   `_meta` (and, if you hit a wedged/blank form, clear `constructive-auth-token:admin` — see the cross-app note
   below).

This avoids chasing phantom "the new field isn't there" / "the form is blank" symptoms that are really just a
stale dev process serving pre-codegen modules.

> **Cross-app token collision (dev/QA footgun).** Two Constructive apps on `localhost` (even on different ports)
> **share** `localStorage` (origin = scheme+host, port is **not** part of it), so they collide on the single key
> `constructive-auth-token:admin` — signing into App B clobbers App A's token, and App A's `_meta` form then
> wedges (blank / 200-but-0-rows / `UNAUTHENTICATED`) for what looks like an RLS/codegen bug. **Verify one app
> at a time / use a separate browser profile or incognito per app / clear the key when switching.** Escalated as
> `references/platform-gaps.md` → **GAP-18** (consume-only; the durable fix is namespacing the storage key per
> app/db). Related: GAP-13 (the auth client bearering a stale token onto `signUp`/`signIn`).

---

## Verify the change (definition of done — same as a first build)

A day-2 change is done only when a **real round-trip** through the UI proves it, never on a green build alone:

- the new **field** is present in the runtime `DynamicFormCard` form and a create/edit persists it (mind GAP-17
  for Edit-hydration);
- a new **entity** round-trips signup → create a row → reload → row persists, mutation 2xx;
- a **policy flip** behaves per the verified matrix (e.g. publishable: owner writes, non-owner write denied,
  anonymous reads published, drafts hidden).

Then re-run the automated gates for the phases the change touched (`./scripts/verify-phase.sh 2.3` for the data
model, `3` for the live-QA round-trip) and, for a material change, the independent evaluator. See SKILL.md →
"Verification" and `references/evaluator-role.md`.

---

## Pointers

- **gotchas → PROVISION-RERUN-001** — the corrected re-run rule (idempotent for additive; the NOT-NULL caveat).
- **platform-gaps → GAP-16** — the populated-table NOT-NULL DDL-ordering defect (root cause + publishable
  auto-handling + the upstream fix).
- **platform-gaps → GAP-PUBLISHABLE-ROLE / GAP-17 / GAP-18** — the publishable read semantic, the Edit-form
  blank-load, and the cross-app token collision (all consume-only escalations).
- **platform-gaps → GAP-1 (falsified idempotency note)** — the verified evidence the old "not re-runnable"
  claim was wrong.
- **brief-grammar.md** — the `publishable` feature row, the `public-read+owner-write` policy-intent row, and the
  🚨 day-2 required-column note (the author-level nullable-then-tighten workarounds live here).
- **`constructive-frontend` skill** — the CRUD Stack + `_meta` meta-forms (the runtime-generic surface a day-2
  field flows into).
