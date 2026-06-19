# Day-2 fixture set — incremental change to an already-built app

This directory is the **fixture** for the day-2 (post-build) change story: how an agent
evolves an app that is **already provisioned and running**, vs. the day-1 "build it from a
brief" flow the rest of the harness covers. It is **data, not logic** — the day-2 runner
(author B's `scripts/day2-runner.*`) is **generic** and driven entirely by these files;
nothing about "recipes" is hard-coded in the runner, scorecard, or verify helper.

## Files

| File | Role |
|------|------|
| `turn0-recipebox-brief.yaml` | The **baseline** app the runner builds first (turn 0): a minimal owner-scoped recipe box (one `recipes` table, `auth:email`, `email-password`). Valid per `scripts/lib/brief.mjs`. |
| `turns.json` | The **machine-readable** 4-turn spec — the ONLY source of turn semantics. The runner reads this; do not duplicate its semantics in code. |
| `changes.md` | The **human** companion: the plain-English change request, the exact brief edit, the layer probed, the skill-only vs. hybrid path, and the dual assertion, per turn. |
| `README.md` | This file. |

## How the runner consumes `turns.json`

1. Read `app`: build the **turn-0 app** from `app.turn0_brief`, under a per-run-tagged
   `db_name` (see below). `app.owner_entity` / `owner_entity_singular` / `turn0_flows` give
   the runner the baseline entity + flow without hard-coding them.
2. For each entry in `turns[]` (cumulative, in `id` order) apply the **one** change:
   - read `change_request` (what a fresh agent is handed) + `brief_patch` (the precise
     edit). `brief_patch_ops[]` is the same edit in a structured, machine-parseable form
     (`add_field` / `add_table` / `add_relation` / `add_ui_route` / `set_table_policy` /
     `add_flow`) the runner applies to the per-run brief.
   - **skill-only mode:** run `skill_only_path` (edit brief → `scaffold-provision` →
     `pnpm run provision`). Every turn's `skill_only_path` documents the EXPECTED abort
     (`PROVISION-RERUN-001` duplicate `CREATE POLICY`) — skill-only mode demonstrates the
     day-2 GAP, it does not land the change.
   - **hybrid mode:** `hybrid_path` names the Stage-C `day2-driver` steps. **This stage
     the runner's hybrid mode is a STUB** — invoking it exits with a clear "hybrid mode
     requires Stage C day2-driver" message. (This fixture stage is capability-neutral: no
     new day-2 build/provision/migrate capability is added to the skill.)
   - assert `new_capability_assert` **and** re-run every flow in `regression_flows[]`
     (the `dual_assertion` block restates both halves). `expected_modules_count` /
     `expected_tables` / `expected_relations` give the runner cheap structural checks it
     can make from a DRY `scaffold-provision` without touching the hub.
3. Turn 4 carries the real flow contract under `flow` (id `password-reset`, its
   `exposed_ops`, `blocks`, `needs_email`, `mailpit_url`) and `backend_modules` (the exact
   module set it needs — verified byte-equal to `references/flows.json`).

## Per-run `db_name` tagging rule (alphanumeric only)

`naming.db_name` in `turn0-recipebox-brief.yaml` is the **base** `recipebox`. The runner
MUST substitute a **per-run tag** so concurrent/repeat runs never collide on a database:

```
db_name = db_name_base + <run-tag>          # e.g. recipebox + a1b2c3  ->  recipeboxa1b2c3
```

The combined `db_name` MUST satisfy `^[a-z][a-z0-9]*$` — **plain lowercase, alphanumeric
only, no hyphens/underscores** (`validateBrief` rejects anything else, and per-DB schema
names dash-collapse from it). So the run-tag is lowercase `[a-z0-9]` only (e.g. a short
hex/timestamp suffix); strip any other character. The build-state id (`APP_ID`) the gates
use is derived from this `db_name` by the same `[^a-z0-9]` sanitization
(`resolveAppId` in `scripts/lib/brief.mjs`), so a clean alphanumeric tag keeps the
per-app `build/<app-id>/` state isolated per run.

## Validation

All field types, policies, the relation shape, the flow id, and its module set were
validated against `scripts/lib/brief.mjs` via a **DRY** `scaffold-provision` (file-emitting
only — it does not touch the hub):

```bash
node scripts/scaffold-provision.mjs fixtures/day2/turn0-recipebox-brief.yaml /tmp/scratch --dry-run
# -> 7 files, modules: 13 (preset auth:email, flows [email-password]), tables: recipes
```
