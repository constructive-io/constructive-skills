---
name: constructive-build-orchestrator
description: State-machine router for Constructive app builds under the Constructive harness. Read first every session — it maps the next feature in .constructive/feature_list.json to the skill (and section) that builds it. Use when a project contains a .constructive/ directory or when starting/continuing a harness-driven Constructive app build.
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Build Orchestrator (router)

You're in a Constructive app project driven by the Constructive harness (the host that registers the typed database tools and lays down `.constructive/`). The harness tracks build progress in `.constructive/feature_list.json`. Your job here is **routing**, not building — load the right next skill based on current state.

## Decision tree

Run this on every session start and after completing each feature:

1. **`.constructive/` missing?** → load `constructive-harness-init` skill. It copies the harness templates into the project and runs `./.constructive/init.sh`.
2. **`.constructive/BRIEF.md` empty or unfilled?** → load `constructive-brief-intake` skill. It walks the brief Q&A, writes `BRIEF.md`, appends one `<entity>-crud-ui` feature row per entity.
3. **Otherwise:** read `.constructive/feature_list.json`. Find the first feature where:
   - `status !== "done"` AND
   - every id in `dependencies` is the id of a feature whose `status === "done"`.
   Route the feature by its **id** using the routing table below. The row's `skill` field should agree with the table; if it names a skill that doesn't exist (projects created before the skill consolidation carry retired names like `db-setup`, `provision-db`, `crud-ui`, `airpage-tools`), ignore the field and follow the table — backend features load `constructive-harness-tools`, `<entity>-crud-ui` loads the CRUD-UI guidance (`constructive-skill-supplements` where present, otherwise `constructive-frontend`).

If no such feature exists, the build is complete — report a one-line summary to the user.

## Feature routing

| Feature id | Skill to load | Work |
|---|---|---|
| `db-setup` | `constructive-harness-tools` | §Preflight — `run_preflight`, then verify |
| `pgpm-workspace` | `constructive-harness-tools` | §Workspace shell — hand-write the two files |
| `provision-db` | `constructive-harness-tools` | §Bootstrap — one `provision_database` call |
| `blueprint-schemas` | `constructive-harness-tools` | §Schema — one `provision_blueprint` call for all related tables |
| `sdk-codegen` | `constructive-harness-tools` | §Codegen — one `run_codegen` call |
| `frontend-scaffold` | `constructive-harness-tools` | §After codegen — wire workspace, install, dev server on :3011 |
| `<entity>-crud-ui` | `constructive-skill-supplements` (or `constructive-frontend`) | The CRUD supplement, plus `constructive-harness-tools` §Generated SDK usage notes |

Load `constructive-harness-tools` once and keep it — every backend feature is a section of it, and its rules (confirmation semantics, outage protocol, rule IDs) apply across features.

**Per-entity CRUD verify contract** (what `verify-feature.sh <entity>-crud-ui` needs): `packages/app/src/app/<entity>s/` exists with list/create/edit/delete wired to the generated hooks, and no `confirm()`/`alert()`/`prompt()` anywhere in it (`UI-001`).

## State machine rules

- **One feature at a time.** Do not jump ahead, even if a later feature looks independent. Context accumulates across the build.
- **Re-read `constructive-gotchas`** before each new feature. Stable-ID invariants apply at every step.
- **Verify before marking done.** After completing the work, run `./.constructive/verify-feature.sh <feature-id>`. The script writes `status: "done"` and an `evidence` string to `feature_list.json` automatically. Do not hand-edit status.
- **Commit after each verified feature.** Right after a verify passes, read `git status` and `git diff --stat` and commit what the feature actually produced (include the `feature_list.json` / `progress.md` updates). Message rules:
  - Conventional commit format, imperative, lowercase, subject ≤72 chars: `feat(provision-db): provision database and pin backend endpoints`.
  - Describe the **diff**, not the plan — if unplanned work rode along (a config fix, a workaround), commit it separately first when it's separable, otherwise name it in the body as its own bullet.
  - Body only when the subject can't carry it; wrap at ~72 chars; say why, not just what.
  - No co-author or tool trailers. Never `git add -f` ignored files (`.env*` stays out). Never amend or rebase published history.
  - No commit on a failed verify or a `blocked` feature — a dirty tree signals work in flight.
- **On verify failure:** flip the feature's status to `in-progress`, write a short note in `evidence`, then triage (below). Load `constructive-troubleshooting` for failure recipes, `constructive-error-index` to look up a specific error string.
- **On backend outage:** see "Backend outage protocol" below. Mark the feature `blocked` and continue with non-backend work if any is eligible.
- **≤3 attempts** on a single failing step (`THRASH-001`): the original try plus at most two re-tries, each with a changed root-cause fix. Re-running an unchanged command is not a new attempt — it's forbidden. If the third attempt still fails, stop and report the exact error — do not thrash, and do not pivot to a structural workaround (`--force`, `as any`, wrapper scripts) on your own.
- **Update `.constructive/progress.md`** before ending a session, and commit any remaining uncommitted work with an honest message (`wip(<feature-id>): …` if the feature is unfinished) so no session ends with a silent dirty tree.

## Failure triage (Q1/Q2/Q3)

When a step or verify fails, get an actual root-cause fix in mind (not "rerun and hope"), then classify it:

```
Q1. Will this failure happen again on the next clean run?
    No  → one-off (flaky network, transient port collision). Fix locally, move on.
    Yes → Q2.
Q2. Would a future agent hit the same root cause?
    No  → environment-specific. One-line note in .constructive/progress.md, move on.
    Yes → Q3.
Q3. Is a bundled doc wrong or missing the case?
    → Record it: note in .constructive/progress.md AND tell the user which doc
      needs what fix. Never edit the docs yourself — the `constructive-*` skills
      are distributed from the constructive-skills repo (any local edit is
      clobbered by the next skills update); they are fixed at their source,
      not in your project.
```

A step is done only when the fix is applied and the originally failing command succeeds. A feature is done only when `verify-feature.sh` writes `status: "done"`.

## Backend outage protocol (`BLOCKED-PROCEED-001`)

The Constructive backend is a remote dependency. If `run_preflight` (see `constructive-harness-tools` §Preflight) reports `backend: 'down'`, or any backend-dependent verify exits with `BACKEND UNREACHABLE`:

1. Set the current feature's `status` to `blocked` in `feature_list.json` with `evidence: "BACKEND UNREACHABLE: <URL> returned <status>"`. Do not mark `done`. Do not retry on a timer.
2. Tell the user in plain language: "I can't reach the Constructive backend at `<URL>`. It's treated as an external dependency — please try again later when it's back up. I can keep working on anything that doesn't need it in the meantime."
3. Re-run the decision tree. Backend-dependent features in the default list are: `db-setup`, `provision-db`, `blueprint-schemas`, `sdk-codegen`, `frontend-scaffold`. Skip any feature whose `status` is `blocked`. Find the first feature where `status` is `not-started` or `in-progress`, all `dependencies` are `done`, and that is **not** backend-dependent.
4. If one exists, work it. Acceptable non-backend work includes: `pgpm-workspace` (project scaffolding), edits to docs, isolated styling that does not depend on generated hooks, planning future work, responding to the user.
5. If no eligible non-backend feature remains, report the blocker to the user and stop. Do not auto-retry the backend probe — wait for the user to confirm the backend is back, then call `run_preflight` again.

Never start, restart, kill, or instruct the user to run lifecycle commands against `cnc server`, Postgres, or any other backend process (`SERVER-001`, `LIFECYCLE-001`).

## Worked example

`feature_list.json` shows:

```
db-setup            done
pgpm-workspace      done
provision-db        in-progress
blueprint-schemas   not-started   (depends on provision-db)
sdk-codegen         not-started   (depends on blueprint-schemas)
frontend-scaffold   not-started   (depends on sdk-codegen)
note-crud-ui        not-started   (depends on frontend-scaffold)
```

→ The first row where `status != "done"` and all `dependencies` are done is `provision-db`.
→ Load `constructive-harness-tools`, work its §Bootstrap section (`provision_database`).
→ After work: `./.constructive/verify-feature.sh provision-db`. On PASS, commit the feature, then re-run this decision tree.

Outage variant: if `run_preflight` returns `backend: 'down'` while `provision-db` is in progress, mark it `blocked` with the BACKEND UNREACHABLE evidence and re-run the decision tree. Every other not-started feature here is backend-dependent (deps chain back to `db-setup` or `provision-db`), so the orchestrator reports the blocker and stops. If a custom brief later introduces a non-backend feature (e.g. a static landing page), the orchestrator picks that up instead of stopping.

## Reference skills (load on demand)

- `constructive-harness-tools` — the harness tool guide: every database/schema/codegen tool by purpose, harness rule IDs, and the bridge that overrides script-based instructions. Load before the first db action.
- `constructive-gotchas` — stable-ID invariants (`CODEGEN-001`, `TS-001`, `THRASH-001`, `SERVER-001`, `SQL-001`, …). Required before each new feature.
- `constructive-troubleshooting` — failure recipes. Load when a verify fails.
- `constructive-error-index` — exact-error-string lookup table. Load when an error message doesn't match what the current skill described.
- `constructive-architecture` / `constructive-secrets-config` — platform internals and env/secrets reference, for when you need to understand *why* rather than *what next*.
