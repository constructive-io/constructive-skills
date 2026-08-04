# Harness Tool Guide

The Constructive harness registers typed tools that own the entire database/schema/codegen path of a Constructive build. **These tools are the ONLY supported path for database and schema work.** Never hand-write provisioning TypeScript, raw GraphQL mutations, blueprint definitions, or ad hoc SQL — and when another doc (`constructive-gotchas`, `constructive-skill-supplements`, …) describes a provisioning script, a `packages/provision` package, or raw GraphQL provisioning, that prose is superseded by the tools here (see the bridge table at the end).

## Tool index by purpose

| Purpose | Tool(s) |
|---|---|
| Backend reachability + host CLIs | `run_preflight` |
| Bootstrap a database for the project | `provision_database` |
| Inspect the live schema (read-only) | `describe_schema` |
| Create entity tables (+ grants, policies, standard columns) | `provision_blueprint` |
| Add a relation between **existing** tables | `add_relation` |
| Table templates | `list_templates`, `apply_template`, `create_template`, `update_template`, `delete_template` |
| Evolve fields / drop tables | `create_field`, `update_field`, `delete_field`, `delete_table` |
| Insert data | `add_records` |
| Row-level security policies | `add_policies` |
| Scaffold `packages/app` + generate the typed SDK | `run_codegen` |

Start read-only: call `describe_schema` before schema mutations when you need current state. Prefer `provision_blueprint` for anything new; reserve the field/relation tools for evolving what already exists.

## Confirmation semantics

Mutating tools prompt the user for confirmation through the host automatically. Never ask for permission in chat text before calling one — just call it. A declined or skipped confirmation is an explicit "no", the user's deliberate decision, not a failure: never re-issue the declined call in the same run (a repeat is auto-blocked without asking the user again); continue the task without it, or say in one sentence what you can't do without it. A genuinely different call — another tool, or changed arguments for a new reason — is fine and will prompt normally. Keep responses short — a one-sentence confirmation after a tool succeeds, not a play-by-play.

## Preflight — `run_preflight`

Call it with no arguments: it probes the backend (`${AIRPAGE_PLATFORM_GRAPHQL_URL:-http://localhost:3000/graphql}`, liveness = a POSTed `{ __typename }` GraphQL query returning data, never header sniffing) and checks host CLIs (`pnpm` required, `psql` optional). It retries transient blips internally before ever reporting `down`.

- **When:** first turn in a Constructive project; before any backend-dependent step (`db-setup`, `provision-db`, `blueprint-schemas`, `sdk-codegen`, `frontend-scaffold`); after any unexpected backend failure; after `command not found: pnpm`.
- **It is the ONLY reachability check you run.** Never hand-probe with `curl`/`wget`/`nc`/`ss`/`netstat`/`lsof`/`ping`, and never substitute a `psql` probe (`SQL-001`).
- **Backend `down`:** treat as an external outage. Mark the current backend-dependent feature `blocked` in `feature_list.json` (`evidence: "BACKEND UNREACHABLE: <URL> …"`), tell the user plainly, and continue with non-backend work (`SERVER-001`, `LIFECYCLE-001`, `BLOCKED-PROCEED-001`). Never start, restart, kill, or install backend processes, and never instruct the user to — surface the outage like the network being down. No retry timers (`THRASH-001`).
- **Missing required CLI:** surface the tool's install hint, stop, re-run `run_preflight` after the user confirms. Never `npm install -g` around it.

The `db-setup` feature is exactly this check: `run_preflight` reports up → `./.constructive/verify-feature.sh db-setup` → hand back to the orchestrator.

## Workspace shell (the `pgpm-workspace` feature — files, not a tool)

The project root needs `pgpm.json` + `pnpm-workspace.yaml`. **Hand-write them; never run `pgpm init`** (`PGPM-001` — its CLI hangs in the non-TTY shell, and nothing in the harness needs it):

```bash
SLUG="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".constructive/feature_list.json")).brief.name)')"
cat > pgpm.json <<EOF
{ "name": "$SLUG", "version": "0.0.1", "license": "UNLICENSED", "workspaces": ["packages/*"] }
EOF
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "packages/*"
EOF
pnpm install
```

Keep exactly `workspaces: ["packages/*"]` and the `packages/*` glob — downstream steps depend on those shapes. Do not add database modules or extra `packages/*` entries here. This feature is non-backend: it proceeds even during an outage (`BLOCKED-PROCEED-001`).

## Bootstrap — `provision_database`

One call creates the project's database and writes `DATABASE_ID`, `OWNER_ID`, `ACCESS_TOKEN`, `DATABASE_NAME` to the root `.env` — every downstream schema/codegen tool reads that `.env`.

- Call with `database_name` = the app slug from the brief (lowercase, URL-safe; it doubles as the subdomain — `SUBDOMAIN-001`). Ownership comes from the signed-in account; there is no owner email/password parameter.
- The tool owns the whole path (`PROVISION-API-001`): the modules [control-plane](../../constructive-architecture/SKILL.md#control-plane-vs-data-plane) endpoint, the explicit `DEFAULT_PROVISION_MODULES` list (never `['all']`, which the backend silently drops), owner bootstrap, and the membership/email SQL fixups against the physical `constructive` control-plane DB (`MEMBERSHIP-DB-001` — provisioned "databases" are schema families inside `constructive`; a `database "<app>" does not exist` message is expected, not a bug). Without the fixups, users stay pending and CRUD inserts are silently RLS-rejected (`BLUEPRINT-PENDING-001`).
- **Idempotency (`PROVISION-RERUN-001`):** with `.env` already bound, a live account-owned binding no-ops with a skip note; a dead binding or one owned by a different account errors and points at reprovision; an unreachable backend means retry later, never reprovision. Never delete `.env` keys by hand to force re-provisioning, and never re-run "to make sure".
- **Reprovision flow** (dead/foreign binding, or an explicit clean-rebuild ask — warn that records do not carry over): `provision_database` with the same `database_name` + `reprovision: true` (old keys archived as comments; the old database is never deleted server-side) → `provision_blueprint` (the new database is empty) → `run_codegen`.

Never scaffold a `packages/provision` package, write a `create-db.ts`, or run membership/email SQL by hand — that procedural path is gone.

## Schema — `provision_blueprint`

Goal shape: every entity from the BRIEF gets a table granted to `authenticated` and protected by an `AuthzEntityMembership` policy.

- Collect entities from `feature_list.json` (`*-crud-ui` features carry an `entity` field), normalize to lowercase plural, cross-reference the BRIEF for fields and relations.
- **All related tables in a SINGLE call** so relations construct together — for a small app that is one call for the whole schema.
- Pass the plain shape only: `table_name`, `fields` (bare-string types like `'text'` are fine — the tool normalizes), required/default markers, and a `belongs_to` from child to parent for each relation (`many_to_many` creates the junction). Do **not** specify grants, `DataId`/`DataEntityMembership`/`DataTimestamps` nodes, or policy `$type` plumbing — the tool injects all of it and runs the async construction poll.
- Never name a table `users` (built-in). For what each Data\*/Search\*/etc node module generates, load `constructive-blueprints` (see its `references/node-type-registry.md`).
- An `already exists` error means the table is constructed — verify (`verify-feature.sh blueprint-schemas` reads the construction `tableMap` from the modules endpoint, never psql — `SQL-001`) instead of re-running (`THRASH-001`).
- A relation that surfaces **after** tables exist: use `add_relation` (adds the FK column or junction table without recreating anything).

## Policies — `add_policies`

Supported types: **AuthzDirectOwner, AuthzEntityMembership, AuthzOrgHierarchy, AuthzPublishable** — the tool auto-creates the companion Data\* columns each needs. NOT supported by the tool (route the user to the policies UI instead): AuthzDirectOwnerAny, AuthzMemberList, AuthzTemporal, AuthzComposite.

For choosing the right type, config shapes, and permissive/restrictive composition, load `constructive-security` (Authz\* semantics, RLS, grants) and `constructive-access-control`. Rule of thumb: entity-scoped rows want `AuthzEntityMembership` (bound to the row's entity field), not an app-level gate.

## Data — `add_records`

Bulk-insert rows through the tool. Omit server-defaulted columns (`id`, timestamps, entity columns the policies derive). Never insert via SQL or hand-rolled GraphQL.

## Codegen + app scaffold — `run_codegen`

One call, fully deterministic, idempotent (re-run after schema changes to regenerate). It owns, in order:

1. **Scaffolds `packages/app`** from the `constructive-app` template if missing (replaces `pgpm init` — `PGPM-001`). Never rename it away from `packages/app` — downstream paths and verify scripts hard-code it.
2. Writes the root `pnpm-workspace.yaml` with the hoisted `overrides: { graphql: … }` so a single `graphql`/`grafast` resolves (`PNPM-GRAPHQL-OVERRIDE-001` — otherwise codegen dies with `Cannot find module 'graphile-connection-filter'`).
3. Pins `@constructive-io/graphql-codegen` to `latest` (`TS-001` — never downgrade; `filter` needs 4.21.2+) and runs one clean `pnpm install`, tolerating exactly the `ERR_PNPM_IGNORED_BUILDS` non-zero exit (`PNPM-BUILDS-001`).
4. Runs codegen with `NEXT_PUBLIC_DB_NAME` plus `CODEGEN_*_ENDPOINT`/`CODEGEN_*_HOST` in the child env — the per-DB vhosts (`admin-<db>`, `auth-<db>`, `api-<db>`) are derived from the backend that owns the binding (`.env API_ENDPOINT` pin), so they are correct on remote backends too, never localhost-only (`SUBDOMAIN-001`). It also writes the matching `NEXT_PUBLIC_*_ENDPOINT` overrides into `packages/app/.env.local` for the dev server. Never hand-edit these to "fix" an endpoint — re-run the tool. Transient `Connection reset` during introspection is retried internally (`CODEGEN-RETRY-001`).
5. Normalizes SDK directory barrels (`./hooks` → `./hooks/index`) for Turbopack (`TURBOPACK-BARREL-001`). Never hand-patch barrels or disable Turbopack — re-run the tool.

On failure, read the message and fix the root cause — never hand-run install/codegen commands. "No `hooks/orm/types` generated" means the database has no entity tables: fix `blueprint-schemas`, then re-run.

**Outage protocol (`CODEGEN-OUTAGE-001`):** a connection-reset that survives the tool's internal retries returns a `BACKEND OUTAGE` failure — external, not a code problem. Call `run_preflight` **once**; if down, mark `sdk-codegen` `blocked` and hand back (`SERVER-001`, `BLOCKED-PROCEED-001`). Never loop `run_codegen` against a down backend (`THRASH-001` — one recorded meltdown logged 86 futile calls in 12 minutes).

## After codegen — frontend bring-up (the `frontend-scaffold` feature)

`run_codegen` already materialized `packages/app`, wrote `packages/app/.env.local`, and generated `packages/app/src/graphql/sdk/{admin,auth,app}/`. Treat those as inputs — never delete them to "regenerate cleanly" (`PROVISION-RERUN-001`). This feature only wires and launches:

1. **Preflight:** `packages/app`, `packages/app/.env.local`, and `packages/app/src/graphql/sdk/app` must exist; if not, re-run `sdk-codegen` — don't patch here (`THRASH-001`).
2. **Workspace:** the `packages/*` glob in `pnpm-workspace.yaml` already covers `packages/app`; only append an explicit entry if the glob is missing.
3. **Install:** `pnpm install`. `ERR_PNPM_IGNORED_BUILDS` / `"pnpm" field … no longer read` warnings are benign (`PNPM-BUILDS-001`); on genuine peer-dep errors regenerate the lockfile (`rm pnpm-lock.yaml && pnpm install`), never add `--strict-peer-dependencies=false`.
4. **Dev server on :3011** (the port is baked into the boilerplate and verify script — if taken, `lsof -ti :3011 | xargs kill -9`, never change the port):

```bash
nohup bash -c 'cd packages/app && pnpm dev' > /tmp/next-dev.log 2>&1 &
for i in $(seq 1 60); do
  S="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3011 2>/dev/null || echo 000)"
  [ "$S" = "200" ] && break; sleep 1
done
curl -fsS http://localhost:3011 | grep -q '<title' || echo "FAIL: no HTML — check /tmp/next-dev.log"
```

The `nohup … &` + log-redirect pattern applies to every long-running per-build process you launch (the host terminates orphaned children when the session ends otherwise). It never applies to the backend (`LIFECYCLE-001`). A `Can't resolve './hooks'` compile error is `TURBOPACK-BARREL-001` → re-run `run_codegen`; any other missing export means codegen output is incomplete → back to `sdk-codegen`. Keep the template's auth/org components — CRUD work assumes those routes exist (`UI-001`).

## Generated SDK usage notes (CRUD features)

- Read the `@example` block at the top of each generated `useX*Query`/`useX*Mutation` file — never guess `select`/`data`/`patch` shapes. The update patch parameter is `${entity}Patch`, not `patch`.
- Delete mutations require an explicit `select`: `{ where: { id }, select: { id: true } }` (`CODEGEN-001`).
- `orderBy` only offers `ID_ASC`/`ID_DESC`/`PRIMARY_KEY_*`/`NATURAL` unless you provisioned an index; `DataEntityMembership` UUIDs are time-ordered, so `ID_ASC` is oldest-first.
- Nullable text fields come back `string | null | undefined` — coerce with `?? ''` for form state; don't widen column types.
- No `confirm()`/`alert()`/`prompt()` in renderer code (`UI-001`) — use the template's Stack cards or `AlertDialog`, and the template's `@/components/ui/*` primitives, never `@constructive-io/ui/*`.

## Harness rule IDs

These IDs are cited by tool block messages and the sections above; platform-wide IDs (TS-001, CODEGEN-001, SERVER-001, PGPM-001, THRASH-001, SQL-001, …) live in `constructive-gotchas`.

| ID | Rule |
|---|---|
| `UI-001` | No browser `confirm()`/`alert()`/`prompt()` in renderer code; use the template's Stack/AlertDialog primitives, not `@constructive-io/ui/*`. |
| `LIFECYCLE-001` | Backend processes are a remote dependency — never start/restart/kill/install them; per-build artifacts (app DB, dev server, generated code) are yours. |
| `BLOCKED-PROCEED-001` | `BACKEND UNREACHABLE` blocks only backend-dependent features (`db-setup`, `provision-db`, `blueprint-schemas`, `sdk-codegen`, `frontend-scaffold`); keep working everything else. |
| `SCHEMA-001` | No raw `CREATE SCHEMA`/`ALTER TABLE` DDL outside deploy SQL — the schema tools own DDL. |
| `PROVISION-API-001` | Provisioning runs on the modules control-plane endpoint with the explicit module list; the provision tools own that path end to end. |
| `SUBDOMAIN-001` | `subdomain = database_name` keeps per-DB endpoints (`auth-<db>`, `api-<db>`, `app-<db>`) deterministic; `run_codegen` derives them from `NEXT_PUBLIC_DB_NAME` + the binding's `API_ENDPOINT`, on any backend. |
| `MEMBERSHIP-DB-001` | One physical `constructive` DB holds every provisioned app as schema families; `database "<app>" does not exist` is expected. |
| `BLUEPRINT-PENDING-001` | Without the membership fixups (owned by `provision_database`), users stay pending and inserts are silently RLS-rejected. |
| `PROVISION-RERUN-001` | `provision_database` is idempotent on binding liveness + account ownership; `reprovision: true` is the only sanctioned rebuild path. |
| `CODEGEN-RETRY-001` | Transient introspection connection-resets are retried inside `run_codegen`; not yours to handle. |
| `CODEGEN-OUTAGE-001` | A reset surviving internal retries = backend outage: one `run_preflight`, mark blocked, stop — never loop the tool. |
| `PNPM-GRAPHQL-OVERRIDE-001` | The root-workspace `graphql` override (written by `run_codegen`) is what keeps a single `grafast`; don't remove it. |
| `PNPM-BUILDS-001` | `ERR_PNPM_IGNORED_BUILDS` exits non-zero but the install succeeded; don't chase it. |
| `TURBOPACK-BARREL-001` | Turbopack can't resolve directory barrels; `run_codegen`'s normalization pass fixes the SDK tree — re-run it, never hand-patch. |

## Bridge: script-era docs → harness tools

Some `constructive-*` docs were written for a script-driven repo. Wherever they say the left column, do the right column:

| Script-era prose says | Under the Constructive harness, do |
|---|---|
| Run `scaffold-provision.mjs` / provision script templates / `packages/provision` | `provision_database`, then `provision_blueprint` |
| Hand-write a `BlueprintDefinition` / raw GraphQL provisioning mutations | `provision_blueprint` (plain table shapes only) |
| Run `pgpm init` / pgpm scaffolding | Hand-write the two workspace-shell files; `run_codegen` scaffolds `packages/app` |
| Run codegen scripts / `pnpm codegen` by hand / edit codegen config | `run_codegen` |
| Inspect or fix via `psql` / ad hoc SQL | `describe_schema`, the schema tools, `verify-feature.sh` |
| Probe the backend with `curl`/`nc` | `run_preflight` |
| Apply RLS/policies via SQL or scripts | `add_policies` (supported types) or the policies UI |
| Seed data via SQL/scripts | `add_records` |
| Load the `safegres` harness skill (the old Authz protocol doc — not the safegres scanner) | `constructive-security` (Authz\* policy semantics) |
| Load the `db-data-modules` skill | `constructive-blueprints` (node type registry) |
