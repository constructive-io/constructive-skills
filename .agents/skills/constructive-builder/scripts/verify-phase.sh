#!/bin/bash
set -euo pipefail

# verify-phase.sh — the GATE ORCHESTRATOR. It parses args, resolves the brief/run-state/workspace,
# remaps the public phase numbers to internal ones, hydrates PG*, and DISPATCHES the per-phase
# assertion gates (the big `case "$PHASE"` below). The reusable machinery lives in sourced libs beside
# this script under lib/; bootstrap their dir relative to THIS file, then source them in dependency
# order:
#   sh-common.sh      RED/GREEN/YELLOW/NC + pass/fail/warn/info(/hr) + SCRIPT_DIR (=scripts/) + REPO_ROOT
#                     (computed from the lib's own location, so identical to the value this script
#                     computed inline before the split).
#   schema-resolve.sh per-DB schema-resolution helpers (schema_db_like / resolve_schema_name /
#                     resolve_table_schema) used by the Phase-2.3 grant/RLS gates.
#   verify-resolve.sh spec/state/workspace/app RESOLVER functions (cfg, cfg_endpoint, endpoint_host,
#                     resolve_app_id/subdomain_id, state_dir, spec_value, spec_table_names,
#                     resolve_app_package/sdk_package/app_source_dir/workspace_root, workspace_path,
#                     app_rel, state_field_ok/value/notes_contain, resolve_db_name/subdomain).
#   verify-gates.sh   the gate-assertion HELPER functions the dispatch calls (check_state_fields,
#                     skill_checker_path, check_blocks_coverage, check_app_compiles, app_build_id_file,
#                     build_app, verify_or_build_app, check_flows_drift, check_harness_drift,
#                     check_design, check_fail_hints, spec_has_required_flows, run_live_qa).
# These libs hold ONLY function definitions (bash binds them at source time, before any executable line
# below runs), so this decomposition is purely structural — the resolution precedence, the phase remap,
# and every gate's PASS/FAIL output (and each fail() FIX hint) are byte-identical to the pre-split file.
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/sh-common.sh
. "$_LIB_DIR/sh-common.sh"
# shellcheck source=lib/schema-resolve.sh
. "$_LIB_DIR/schema-resolve.sh"
# shellcheck source=lib/verify-resolve.sh
. "$_LIB_DIR/verify-resolve.sh"
# shellcheck source=lib/verify-gates.sh
. "$_LIB_DIR/verify-gates.sh"

# ── infra coordinate read once, now that cfg() is sourced (single source-of-truth). ──
PG_HUB_DATABASE="$(cfg db.hubDatabase constructive)"

# Per-app build-state id seed (RECON-3). APP_ID defaults empty (legacy singleton build/); state_dir()
# (in verify-resolve.sh) turns it into build/<app-id> when set. The fallbacks below honor it.
: "${APP_ID:=}"

PHASE=""
POSITIONAL_DB_NAME=""
SPEC_PATH=""
STATE_PATH=""
WORKSPACE_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --spec)
      SPEC_PATH="$2"
      shift 2
      ;;
    --state)
      STATE_PATH="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE_OVERRIDE="$2"
      shift 2
      ;;
    -*)
      fail "Unknown option: $1" "Usage: ./scripts/verify-phase.sh <phase> [db-name] [--spec PATH] [--state PATH] [--workspace PATH]. Valid options are --spec/--state/--workspace; the phase + db-name are positional."
      ;;
    *)
      if [ -z "$PHASE" ]; then
        PHASE="$1"
      elif [ -z "$POSITIONAL_DB_NAME" ]; then
        POSITIONAL_DB_NAME="$1"
      else
        fail "Unexpected argument: $1" "Only two positionals are accepted: <phase> then [db-name]. Pass paths via --spec/--state/--workspace flags, not as bare arguments."
      fi
      shift
      ;;
  esac
done

if [ -z "$PHASE" ]; then
  echo "Usage: ./scripts/verify-phase.sh <phase> [db-name] [--spec PATH] [--state PATH] [--workspace PATH]"
  exit 1
fi

# BRIEF/SPEC fallback (RECON-3 A3). Precedence: explicit --spec (already won above) → per-app
# build/<app-id>/app-brief.yaml when $APP_ID is set → LEGACY build/app-brief.yaml → test/app-spec.yaml.
# The per-app step inserts ONLY before the legacy fallback and only when $APP_ID is set AND the
# per-app file exists, so the legacy chain is unchanged when APP_ID is unset.
if [ -z "$SPEC_PATH" ] && [ -n "${APP_ID:-}" ] && [ -f "$(state_dir)/app-brief.yaml" ]; then
  SPEC_PATH="$(state_dir)/app-brief.yaml"
fi

if [ -z "$SPEC_PATH" ] && [ -f "$REPO_ROOT/build/app-brief.yaml" ]; then
  SPEC_PATH="$REPO_ROOT/build/app-brief.yaml"
fi

if [ -z "$SPEC_PATH" ] && [ -f "$REPO_ROOT/test/app-spec.yaml" ]; then
  SPEC_PATH="$REPO_ROOT/test/app-spec.yaml"
fi

# RUN-STATE fallback (RECON-3 A3/A4). If APP_ID is unset but a SPEC is now resolved, derive
# APP_ID from the spec's db_name so the per-app run-state is found (never overrides an explicit
# --state, which already won above). Then: per-app build/<app-id>/run-state.json → LEGACY
# build/run-state.json → test/run-state.json. Same backward-compat guarantee as the brief block.
if [ -z "${APP_ID:-}" ] && [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
  APP_ID="$(resolve_app_id "$SPEC_PATH")"
fi

if [ -z "$STATE_PATH" ] && [ -n "${APP_ID:-}" ] && [ -f "$(state_dir)/run-state.json" ]; then
  STATE_PATH="$(state_dir)/run-state.json"
fi

if [ -z "$STATE_PATH" ] && [ -f "$REPO_ROOT/build/run-state.json" ]; then
  STATE_PATH="$REPO_ROOT/build/run-state.json"
fi

if [[ -z "$STATE_PATH" && -f "$REPO_ROOT/test/run-state.json" ]]; then
  STATE_PATH="$REPO_ROOT/test/run-state.json"
fi

# Resolve the workspace root once (resolve_workspace_root is sourced from verify-resolve.sh).
WORKSPACE_ROOT="$(resolve_workspace_root)"

# Phase number normalization
# SKILL.md exposes externally-visible step numbers that differ from this script's
# internal check names. This block maps the public numbers to the internal ones so
# agents can run e.g. ./scripts/verify-phase.sh 2.3 (the public Blueprint/Provision
# step) and have it run the correct checks (internally numbered 2.2). The public
# numbers are STABLE CONTRACT — SKILL.md, README.md, AGENTS.md, and instruction.md
# all tell agents to pass exactly these. Do not change them; this is cosmetic only.
#
# The four mainline phases (consolidated) and the public step numbers they accept:
#   Phase 1 — Backend Up              → public 1          → internal 1
#   Phase 2 — Data Model Provisioned  → public 2.1 + 2.3  → internal 2.1 + 2.2
#     (2.1 = Workspace; 2.2 = Create Provision Package, lightweight/no gate;
#      2.3 = Blueprint Provision = DB + tables + policies, folds in the old 2.3.2)
#   Phase 3 — Frontend + SDK          → public 2.6        → internal 2.4
#     (public 2.5 = the optional standalone-SDK extension → internal 2.3, off the
#      mainline path; kept so a built standalone SDK can still be verified)
#   Phase 4 — UI / Blocks             → public 3          → internal 2.5
#     (+ additive Blocks coverage gate, which runs under public 2.6)
#
# Mapping (public → internal):
#   1      → 1       Backend Up
#   2.1    → 2.1     Workspace
#   2.2    → (none)  Create Provision Package (lightweight, no infra to verify)
#   2.3    → 2.2     Blueprint Provision (DB + tables + policies)
#   2.5    → 2.3     Standalone SDK codegen (Optional Extension)
#   2.6    → 2.4     Frontend + SDK
#   3      → 2.5     UI / Blocks (Build App)
case "$PHASE" in
  # SKILL.md public step numbers → remap to internal phase names
  2.3)  PHASE="2.2" ;; # public 2.3 (Blueprint Provision) → internal 2.2
  2.5)  PHASE="2.3" ;; # public 2.5 (standalone-SDK Optional Extension) → internal 2.3
  2.6)  PHASE="2.4" ;; # public 2.6 (Frontend + SDK) → internal 2.4
  3|3.0) PHASE="2.5" ;; # public 3 (UI / Blocks) → internal 2.5
esac

# Guarded PG* hydration. The 2.x grant/RLS gates (and Phase 1) shell out to psql, which needs
# PGHOST/PGPORT/PGUSER/PGPASSWORD. Agents (and golden-path/genericity runs) frequently forget the
# `eval "$(pgpm env)"` step, so those gates would WARN/fail on "PGHOST not set" against the wrong
# default socket. If pgpm is on PATH and PGHOST is unset, hydrate PG* from it here — once, before
# any dispatch. Guarded so it is a no-op when PG* are already exported (respect the caller's env)
# or when pgpm is unavailable; the existing per-check WARNs remain the fallback.
if [ -z "${PGHOST:-}" ] && command -v pgpm >/dev/null 2>&1; then
  if PGPM_ENV="$(pgpm env 2>/dev/null)" && [ -n "$PGPM_ENV" ]; then
    eval "$PGPM_ENV"
    info "Hydrated PG* from 'pgpm env' (PGHOST was unset; PGHOST=${PGHOST:-?})"
  else
    warn "PGHOST unset and 'pgpm env' produced nothing — psql-using gates may fail (run eval \"\$(pgpm env)\" with the hub up; SKILL.md Phase 1)"
  fi
  unset PGPM_ENV
fi

case "$PHASE" in
  1)
    echo "Verifying Phase 1: SQL Setup"
    echo "----------------------------"

    docker info >/dev/null 2>&1 && pass "Docker is running" || fail "Docker is not running" "Start Docker Desktop, then bring up the hub (constructive-hub: pnpm start) so Postgres + the GraphQL server are up (SKILL.md Phase 1 / S0)."
    pg_isready -q 2>/dev/null && pass "Postgres is accepting connections" || fail "Postgres is not responding" "Postgres isn't up — start the hub (constructive-hub: pnpm start) and run eval \"\$(pgpm env)\" so PG* point at it (SKILL.md Phase 1)."
    [ -n "${PGUSER:-}" ] && pass "PGUSER is set" || warn "PGUSER not set (run eval \"\$(pgpm env)\")"
    [ -n "${PGHOST:-}" ] && pass "PGHOST is set" || warn "PGHOST not set"
    psql -d "$PG_HUB_DATABASE" -c "SELECT 1" >/dev/null 2>&1 && pass "Database '$PG_HUB_DATABASE' exists" || fail "Database '$PG_HUB_DATABASE' not found" "The hub db isn't deployed — run the constructive-db bootstrap/deploy (constructive-hub: pnpm bootstrap then pnpm start) so the '$PG_HUB_DATABASE' control-plane db exists (SKILL.md Phase 1)."
    BASELINE_RESULT="$(psql -d "$PG_HUB_DATABASE" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'metaschema_public' AND table_name = 'database' LIMIT 1;" 2>/dev/null | tr -d ' ')"
    [ "$BASELINE_RESULT" = "1" ] && pass "Constructive system baseline exists (metaschema_public.database)" || fail "Constructive system baseline is missing (expected metaschema_public.database)" "The control-plane schema (metaschema_public) isn't deployed — re-run the constructive-db deploy/bootstrap (SKILL.md Phase 1); a partially-started hub is the usual cause."

    PLATFORM_API_ENDPOINT="$(cfg_endpoint api)"; [ -n "$PLATFORM_API_ENDPOINT" ] || PLATFORM_API_ENDPOINT="http://api.localhost:3000/graphql"
    PLATFORM_AUTH_ENDPOINT="$(cfg_endpoint auth)"; [ -n "$PLATFORM_AUTH_ENDPOINT" ] || PLATFORM_AUTH_ENDPOINT="http://auth.localhost:3000/graphql"
    if node "$REPO_ROOT/scripts/verify-graphql-contract.mjs" platform \
      --platform-api "$PLATFORM_API_ENDPOINT" \
      --platform-auth "$PLATFORM_AUTH_ENDPOINT"; then
      pass "Platform auth and API endpoints pass GraphQL POST contract verification"
    else
      fail "Platform auth/API GraphQL POST contract verification failed" "The PostGraphile server isn't serving the PLATFORM endpoints (api.localhost:3000 / auth.localhost:3000) — start it (constructive-hub: pnpm start) and confirm cnc server is up on :3000 (SKILL.md Phase 1 / gotchas SERVER-001)."
    fi

    # Additive: only fires if this harness ships scripts/check-harness-drift.mjs.
    check_harness_drift

    # Additive: design subsystem rot-canary (the Blocks token-contract validator test) — app-independent,
    # runs early. The functional --app globals.css check inside check_design no-ops here (no app yet).
    check_design

    # Additive self-lint: assert every fail() call-site carries a 2nd-arg FIX hint (no regress).
    check_fail_hints

    check_state_fields
    ;;

  2.1)
    echo "Verifying Phase 2.1: Workspace"
    echo "-------------------------------"

    [ -f "$(workspace_path "pgpm.json")" ] && pass "pgpm.json exists" || fail "pgpm.json not found in $WORKSPACE_ROOT" "Scaffold the workspace — run 'pgpm init --no-tty' at the workspace root (SKILL.md S1 / Phase 2.1); pgpm.json is the workspace manifest."
    [ -f "$(workspace_path "pnpm-workspace.yaml")" ] && pass "pnpm-workspace.yaml exists" || fail "pnpm-workspace.yaml not found in $WORKSPACE_ROOT" "Add pnpm-workspace.yaml registering packages/provision (single-package layout keeps it at the root — don't delete it; SKILL.md S1/S4b)."
    if (cd "$WORKSPACE_ROOT" && pnpm install --frozen-lockfile >/dev/null 2>&1); then
      pass "pnpm install succeeds"
    else
      warn "pnpm install had issues"
    fi

    check_state_fields
    ;;

  2.2)
    echo "Verifying Phase 2.2: Provision"
    echo "------------------------------"

    [ -d "$(workspace_path "packages/provision")" ] && pass "packages/provision exists" || fail "packages/provision not found in $WORKSPACE_ROOT" "Create packages/provision with blueprint.json"

    # Check for TypeScript blueprint provision files (preferred approach)
    PROVISION_PKG="$(workspace_path "packages/provision")"
    if [ -f "$PROVISION_PKG/src/create-db.ts" ] || [ -f "$PROVISION_PKG/create-db.ts" ]; then
      pass "create-db.ts exists in packages/provision"
    else
      warn "create-db.ts not found in packages/provision — expected for TypeScript blueprint approach"
    fi

    if [ -f "$PROVISION_PKG/src/provision.ts" ] || [ -f "$PROVISION_PKG/provision.ts" ]; then
      pass "provision.ts exists in packages/provision"
    else
      warn "provision.ts not found in packages/provision — expected for TypeScript blueprint approach"
    fi

    # Check for @constructive-io/node (preferred) or @constructive-io/sdk (legacy)
    if grep -q '@constructive-io/node' "$(workspace_path "packages/provision/package.json")" 2>/dev/null; then
      pass "@constructive-io/node dependency present in provision package"
    elif grep -q '@constructive-io/sdk' "$(workspace_path "packages/provision/package.json")" 2>/dev/null; then
      warn "@constructive-io/sdk found — prefer @constructive-io/node for clean imports"
    else
      warn "Neither @constructive-io/node nor @constructive-io/sdk found in provision package.json"
    fi

    # Legacy: check for blueprint.json (still supported but TypeScript BlueprintDefinition preferred)
    BLUEPRINT_FILE="$(workspace_path "packages/provision/blueprint.json")"
    if [ -f "$BLUEPRINT_FILE" ]; then
      pass "blueprint.json exists (legacy JSON approach)"
      if node -e "const b=JSON.parse(require('fs').readFileSync('$BLUEPRINT_FILE','utf8')); if(!b.name||!b.schema||!b.schema.tables) process.exit(1);" 2>/dev/null; then
        pass "blueprint.json is valid JSON with name and schema.tables"
      else
        fail "blueprint.json is missing required fields (name, schema.tables)" "Ensure blueprint.json has name and schema.tables"
      fi
    fi

    DB_NAME_RESOLVED="$(resolve_db_name)"
    info "Using database name: $DB_NAME_RESOLVED"

    RESULT="$(psql -d constructive -t -c "SELECT name FROM metaschema_public.database WHERE name = '$DB_NAME_RESOLVED';" 2>/dev/null | tr -d ' ')"
    [ "$RESULT" = "$DB_NAME_RESOLVED" ] && pass "Database '$DB_NAME_RESOLVED' exists" || fail "Database '$DB_NAME_RESOLVED' not found" "Re-run create-db (SKILL.md S2 step 2): cd packages/provision && pnpm run create-db && pnpm run provision."

    # Per-DB schema resolution tolerant of BOTH naming conventions (gotchas SUBDOMAIN-001):
    #   OLD dash+hash:  <db>-<hash>-memberships-public   (fv4-* era)
    #   NEW underscore: <db>_memberships_public          (goldenapp_*/fv5_*/fv6_*)
    # A LIKE pinned to one separator 0-matches the other (the false-fail this fixes). DB_LIKE is
    # the db name with its own '-'/'_' turned into '%', anchored at the START (no leading %, so a
    # sibling tenant whose name merely CONTAINS this db can't match). Resolve each schema DIRECTLY
    # via '<DB_LIKE>%<token>%public' — no prefix arithmetic — so an underscore name (which the old
    # '${x%-memberships-public}' strip left untouched) can't yield a wrong app/users schema.
    DB_LIKE="$(schema_db_like "$DB_NAME_RESOLVED")"

    MEMBERSHIP_SCHEMA="$(resolve_table_schema "$DB_LIKE" 'app_membership_defaults' '%memberships%public')"
    [ -n "$MEMBERSHIP_SCHEMA" ] && pass "Resolved platform membership schema: $MEMBERSHIP_SCHEMA" || fail "Could not resolve Constructive membership schema for '$DB_NAME_RESOLVED'" "DB exists but app schemas aren't provisioned — re-run create-db + provision (SKILL.md S2); if provision aborted with NOT_FOUND (memberships_module) you used AuthzEntityMembership on an auth:email app — switch to AuthzDirectOwner (gotchas RLS-POLICY-001)."

    # Human-readable prefix (display only; app/users resolved directly below). Strip the
    # 'memberships' segment with EITHER separator via a [-_] bracket glob.
    SCHEMA_PREFIX="${MEMBERSHIP_SCHEMA%[-_]memberships[-_]public}"
    [ -n "$SCHEMA_PREFIX" ] && pass "Resolved platform schema prefix: $SCHEMA_PREFIX" || fail "Could not resolve Constructive schema prefix for '$DB_NAME_RESOLVED'" "Membership schema didn't match the expected '<db>…memberships…public' shape — re-run provision (SKILL.md S2); the provision.ts membership SQL must use the separator-tolerant match (gotchas SUBDOMAIN-001)."

    APP_SCHEMA="$(resolve_schema_name "$DB_LIKE" '%app%public')"
    [ -n "$APP_SCHEMA" ] && pass "Resolved platform app schema: $APP_SCHEMA" || fail "Could not resolve Constructive app schema for '$DB_NAME_RESOLVED'" "The '<db>…app…public' schema is missing — provision didn't create the app schema; re-run create-db + provision (SKILL.md S2)."

    # ── Grant OUTCOME assertion (replaces the old notes-substring tripwire) ────────────────────
    # The grant is harness-teachable, NOT a platform escalation, and may arrive via EITHER the
    # object-form blueprint grants OR the documented manual fallback (gotchas F3 / SKILL.md S2 step 3).
    # We assert the OUTCOME on the already-resolved $APP_SCHEMA, not the source: the 4 expected
    # privileges (SELECT/INSERT/UPDATE/DELETE) for role 'authenticated' must exist on app-schema
    # tables, AND the users-table self_update UPDATE policy (RLS-USERS-UPDATE-001) must exist.
    GRANT_PRIVS="$(psql -d constructive -t -c "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$APP_SCHEMA' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');" 2>/dev/null | tr -d ' ')"
    if [ "${GRANT_PRIVS:-0}" -ge 4 ] 2>/dev/null; then
      pass "'authenticated' holds all 4 privileges (SELECT/INSERT/UPDATE/DELETE) on $APP_SCHEMA tables"
    else
      fail "'authenticated' is missing required privileges on $APP_SCHEMA (found ${GRANT_PRIVS:-0}/4)" "Grant didn't land — every authenticated write 403s. Use object-form grants (grants:[{roles:['authenticated'],privileges:[['select','*'],['insert','*'],['update','*'],['delete','*']]}]) in the blueprint (gotchas F3 / SKILL.md S2 step 1), then re-run create-db + provision; or apply the one-time psql GRANT fallback in SKILL.md S2 step 3."
    fi

    # Resolve the users schema DIRECTLY (anchored + separator-tolerant), same as app/memberships
    # above — tolerates BOTH '<db>-…-users-public' and '<db>_users_public' (SUBDOMAIN-001).
    USERS_SCHEMA="$(resolve_schema_name "$DB_LIKE" '%users%public')"
    [ -n "$USERS_SCHEMA" ] || USERS_SCHEMA="${SCHEMA_PREFIX}-users-public"
    USERS_SELF_UPDATE_POLICY="$(psql -d constructive -t -c "SELECT count(*) FROM pg_policies WHERE schemaname = '$USERS_SCHEMA' AND tablename = 'users' AND cmd = 'UPDATE';" 2>/dev/null | tr -d ' ')"
    if [ "${USERS_SELF_UPDATE_POLICY:-0}" -ge 1 ] 2>/dev/null; then
      pass "users-table self_update UPDATE policy present in $USERS_SCHEMA (updateUser will persist)"
    else
      fail "users-table self_update UPDATE policy missing in $USERS_SCHEMA" "updateUser is a silent 200-but-0-rows no-op without it (gotchas RLS-USERS-UPDATE-001). The platform grants this policy natively for an auth preset; if it is missing, re-run create-db + provision (SKILL.md S2 step 1), or apply the one-time fallback policy in SKILL.md S2 step 3."
    fi

    # ── ORG-TIER grant OUTCOME assertion (b2b only; owner-only apps are untouched) ─────────────
    # The b2b counterpart of the owner-tier gate above. It asserts the platform's NATIVE org
    # provisioning OUTCOME — the org analogue of the users self_update check (RLS-USERS-UPDATE-001):
    # the org-table grants to 'authenticated', the create_entity permission bit, and the personal-org
    # org_memberships_sprt seed row the AuthzEntityMembership RLS reads. The platform now grants these
    # and self-seeds the personal-org row on signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15);
    # this gate verifies that.
    # It is GATED on the app being b2b/org so it NEVER fires for owner-only apps (the frozen canary is
    # owner-tier → this whole block is skipped there). Org tier is detected from the BRIEF (the
    # authoritative, pre-build structured signal — mirrors brief.mjs's b2b gate, NOT prose):
    #   the brief declares an org tier when modules.preset ∈ {b2b, b2b:storage, full}, OR a table carries
    #   an org-scoped policy intent (policy: org-membership | member-owner). brief.mjs requires a b2b
    #   preset for those policies, so either is a sound org-tier signal.
    # $SPEC_PATH is YAML and spec_value() is a FLAT-key reader (can't see nested modules.preset), so we
    # scan the brief directly with a scoped awk (preset under the `modules:` block) + a grep for the
    # policy intents — bounded reads of the brief the agent wrote, no platform SQL.
    ORG_TIER=0
    ORG_TIER_REASON=""
    if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
      # modules.preset (scoped to the top-level `modules:` block so a stray 'preset:' elsewhere can't trip it).
      BRIEF_PRESET="$(awk '
        /^[[:space:]]*modules:[[:space:]]*$/ { in_mod = 1; next }
        in_mod && /^[^[:space:]#]/ { in_mod = 0 }
        in_mod && /^[[:space:]]+preset:/ {
          line = $0; sub(/.*preset:[[:space:]]*/, "", line)
          gsub(/^[[:space:]]+|[[:space:]"'\''#].*$/, "", line); print line; exit
        }
      ' "$SPEC_PATH" 2>/dev/null | tr -d '[:space:]')"
      case "$BRIEF_PRESET" in
        b2b|b2b:storage|full) ORG_TIER=1; ORG_TIER_REASON="brief modules.preset='$BRIEF_PRESET'" ;;
      esac
      # OR a table uses an org-scoped policy intent (brief.mjs forces a b2b preset for these).
      if [ "$ORG_TIER" = "0" ] && grep -Eq '^[[:space:]]*policy:[[:space:]]*(org-membership|member-owner)([[:space:]#].*)?$' "$SPEC_PATH" 2>/dev/null; then
        ORG_TIER=1; ORG_TIER_REASON="brief table policy intent (org-membership / member-owner)"
      fi
    fi

    if [ "$ORG_TIER" = "1" ]; then
      info "Org tier detected ($ORG_TIER_REASON) — asserting the platform's b2b provisioning OUTCOME (gotchas RLS-ORG-RECONCILE-001)"

      # Resolve the org/membership schemas with the SAME anchored, separator-tolerant DB_LIKE machinery
      # already used above (SUBDOMAIN-001).
      MEMBERSHIP_PUB_SCHEMA="$(resolve_table_schema "$DB_LIKE" 'org_memberships' '%memberships%public')"
      [ -n "$MEMBERSHIP_PUB_SCHEMA" ] && pass "Resolved org memberships-public schema: $MEMBERSHIP_PUB_SCHEMA" || fail "Could not resolve the org memberships-public schema (table org_memberships) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%memberships%public')" "This app reads as b2b/org ($ORG_TIER_REASON) but org_memberships isn't provisioned — provision with the b2b preset (modules.preset: b2b; SKILL.md S2), or if it's actually owner-only clear the org signal (don't set modules.preset b2b). gotchas RLS-ORG-RECONCILE-001."

      MEMBERSHIP_PRIV_SCHEMA="$(resolve_table_schema "$DB_LIKE" 'org_memberships_sprt' '%memberships%private')"
      [ -n "$MEMBERSHIP_PRIV_SCHEMA" ] && pass "Resolved org memberships-private schema: $MEMBERSHIP_PRIV_SCHEMA" || fail "Could not resolve the org memberships-private schema (table org_memberships_sprt) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%memberships%private')" "The org SPRT tables aren't provisioned — re-run create-db + provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."

      PERMISSIONS_PUB_SCHEMA="$(resolve_table_schema "$DB_LIKE" 'app_permissions' '%permissions%public')"
      [ -n "$PERMISSIONS_PUB_SCHEMA" ] && pass "Resolved org permissions-public schema: $PERMISSIONS_PUB_SCHEMA" || fail "Could not resolve the org permissions-public schema (table app_permissions) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%permissions%public')" "The permissions module isn't provisioned — re-run create-db + provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."

      # (a) org-table GRANTs to 'authenticated': assert the 4 privileges on org_memberships AND SELECT
      #     on org_member_profiles (the RLS policies are provisioned; these GRANTs are what let
      #     members-list / role-change / profile reads round-trip). The platform grants these natively.
      ORG_GM_PRIVS="$(psql -d constructive -t -c "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_PUB_SCHEMA' AND table_name = 'org_memberships' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');" 2>/dev/null | tr -d ' ')"
      ORG_OMP_SEL="$(psql -d constructive -t -c "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_PUB_SCHEMA' AND table_name = 'org_member_profiles' AND grantee = 'authenticated' AND privilege_type = 'SELECT';" 2>/dev/null | tr -d ' ')"
      if [ "${ORG_GM_PRIVS:-0}" -ge 4 ] 2>/dev/null && [ "${ORG_OMP_SEL:-0}" -ge 1 ] 2>/dev/null; then
        pass "'authenticated' holds org_memberships SELECT/INSERT/UPDATE/DELETE + org_member_profiles SELECT in $MEMBERSHIP_PUB_SCHEMA"
      else
        fail "org-table grants incomplete in $MEMBERSHIP_PUB_SCHEMA (org_memberships ${ORG_GM_PRIVS:-0}/4, org_member_profiles SELECT=${ORG_OMP_SEL:-0})" "Without these grants member-list / role-change / org writes 403. Re-run create-db + provision with the b2b preset (SKILL.md S2); the platform grants the org tables natively. gotchas RLS-ORG-RECONCILE-001."
      fi

      # (b) the create_entity app-permission bit must be DEFINED (org create / member writes gate on it;
      #     bit 5 = 0x20 = 32, but we resolve it BY NAME — never hard-coded). If it's not defined the b2b
      #     permissions weren't provisioned (fail); the seed-row assertion (c) needs this literal, so it
      #     runs ONLY in the defined branch.
      ORG_CREATE_ENTITY_BIT="$(psql -d constructive -t -c "SELECT bitstr::text FROM \"$PERMISSIONS_PUB_SCHEMA\".app_permissions WHERE name = 'create_entity' LIMIT 1;" 2>/dev/null | tr -d ' ')"
      if [ -z "$ORG_CREATE_ENTITY_BIT" ]; then
        fail "create_entity app-permission bit is NOT defined in $PERMISSIONS_PUB_SCHEMA.app_permissions" "Org create / member writes gate on the create_entity bit (PLATFORM-GAPS.md GAP-1c) — its absence means the b2b permissions weren't provisioned. Re-run create-db + provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."
      fi
      pass "create_entity app-permission bit is defined in $PERMISSIONS_PUB_SCHEMA.app_permissions (...${ORG_CREATE_ENTITY_BIT: -8})"

      # (c) the personal-org seed row the AuthzEntityMembership RLS actually reads:
      #     org_memberships_sprt(actor_id = entity_id). The platform self-seeds this per-ACTOR on
      #     signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15), so we branch only on whether an
      #     actor exists yet (this gate may run at provision time, which is BEFORE the first signup):
      #       • An actor exists → assert the OUTCOME: a personal-org row exists AND carries the
      #         create_entity bit. Missing / bit-less → FAIL (the platform's self-seed didn't land).
      #       • Pre-signup (no actor) → the per-actor seed can't exist yet; grants (a) + bit (b) above
      #         are the assertable provision-time outcome (keeps a fresh b2b provision-time gate green,
      #         like the owner canary).
      USERS_SCHEMA_ORG="$(resolve_table_schema "$DB_LIKE" 'users' '%users%public')"
      [ -n "$USERS_SCHEMA_ORG" ] || USERS_SCHEMA_ORG="$USERS_SCHEMA"
      ORG_USER_COUNT="$(psql -d constructive -t -c "SELECT count(*) FROM \"$USERS_SCHEMA_ORG\".users;" 2>/dev/null | tr -d ' ')"
      # Personal-org seed rows present (actor = entity), and of those, how many carry the create_entity bit.
      ORG_SEED_ROWS="$(psql -d constructive -t -c "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = entity_id;" 2>/dev/null | tr -d ' ')"
      ORG_SEED_WITH_BIT="$(psql -d constructive -t -c "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = entity_id AND (permissions & '${ORG_CREATE_ENTITY_BIT}'::bit(64)) = '${ORG_CREATE_ENTITY_BIT}'::bit(64);" 2>/dev/null | tr -d ' ')"

      if [ "${ORG_USER_COUNT:-0}" -ge 1 ] 2>/dev/null; then
        # An actor exists — assert the platform self-seeded the personal-org row + create_entity bit.
        if [ "${ORG_SEED_WITH_BIT:-0}" -ge 1 ] 2>/dev/null; then
          pass "personal-org seed row present in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt (actor=entity) carrying create_entity (${ORG_SEED_WITH_BIT} of ${ORG_SEED_ROWS:-0}) — createCompany etc. will pass RLS"
        elif [ "${ORG_SEED_ROWS:-0}" -ge 1 ] 2>/dev/null; then
          fail "personal-org seed row(s) exist in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt but NONE carry the create_entity bit (0 of ${ORG_SEED_ROWS})" "The seeded row is missing create_entity, so AuthzEntityMembership writes (createCompany) stay RLS-denied. The platform self-seeds this on signup with the bit set (PLATFORM-GAPS.md GAP-1b/1c, CLOSED) — pull the current platform and re-provision with the b2b preset. gotchas RLS-ORG-RECONCILE-001."
        else
          fail "NO personal-org seed row exists in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt (actor=entity) for ${ORG_USER_COUNT} actor(s)" "The platform self-seeds the personal-org row the AuthzEntityMembership RLS reads on signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15). Its absence means the deployed platform predates that fix — pull the current platform and re-provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."
        fi
      else
        # Pre-signup (no actor yet): the per-actor seed can't exist; the platform seeds it on the first
        # signup. Grants (a) + the bit (b) above are the assertable provision-time outcome.
        info "Org tier with no signed-up actor yet — grants + create_entity bit asserted; the personal-org sprt seed is self-seeded by the platform per-actor on first signup (PLATFORM-GAPS.md GAP-1b/1c; gotchas RLS-ORG-RECONCILE-001)"
      fi
    fi

    REQUIRED_QUERY_FIELDS="_meta"
    if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
      while IFS= read -r table_name; do
        [ -n "$table_name" ] || continue
        REQUIRED_QUERY_FIELDS="${REQUIRED_QUERY_FIELDS},${table_name}"
      done < <(spec_table_names || true)
    fi

    SUBDOMAIN_RESOLVED="$(resolve_subdomain "$DB_NAME_RESOLVED")"
    info "Using subdomain: $SUBDOMAIN_RESOLVED"

    # The per-DB GraphQL DATA endpoint is api-<sub> (Host header routes; app-public-<sub> is DEAD).
    # We feed the api-<sub> URL through the existing --app-public flag so consumers of that flag
    # name in verify-graphql-contract.mjs stay unchanged (minimal blast radius).
    PER_DB_AUTH_ENDPOINT="$(cfg_endpoint auth "$SUBDOMAIN_RESOLVED")"; [ -n "$PER_DB_AUTH_ENDPOINT" ] || PER_DB_AUTH_ENDPOINT="http://auth-$SUBDOMAIN_RESOLVED.localhost:3000/graphql"
    PER_DB_DATA_ENDPOINT="$(cfg_endpoint api "$SUBDOMAIN_RESOLVED")"; [ -n "$PER_DB_DATA_ENDPOINT" ] || PER_DB_DATA_ENDPOINT="http://api-$SUBDOMAIN_RESOLVED.localhost:3000/graphql"
    if node "$REPO_ROOT/scripts/verify-graphql-contract.mjs" database \
      --app-auth "$PER_DB_AUTH_ENDPOINT" \
      --app-public "$PER_DB_DATA_ENDPOINT" \
      --required-auth-mutations signIn \
      --required-query-fields "$REQUIRED_QUERY_FIELDS"; then
      pass "Per-database auth and app endpoints pass GraphQL POST contract verification"
    else
      fail "Per-database GraphQL POST contract verification failed" "The per-DB data endpoint is api-<sub> (http://api-$SUBDOMAIN_RESOLVED.localhost:3000/graphql) — the Host header routes to the right DB; app-public-<sub> is DEAD. See SKILL.md 'data endpoint = api-<sub>'."
    fi

    if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
      while IFS= read -r table_name; do
        [ -n "$table_name" ] || continue
        EXISTS="$(psql -d constructive -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = '$APP_SCHEMA' AND table_name = '$table_name' LIMIT 1;" 2>/dev/null | tr -d ' ')"
        [ "$EXISTS" = "1" ] && pass "Benchmark table '$table_name' exists in $APP_SCHEMA" || fail "Benchmark table '$table_name' is not in the Constructive app schema $APP_SCHEMA" "Table never got created — re-run provision (SKILL.md S2). If it used AuthzEntityMembership/membership_type:2 on an auth:email app, constructBlueprint aborted with NOT_FOUND (memberships_module) and skipped the table — switch that table to AuthzDirectOwner (gotchas RLS-POLICY-001)."

        POLICY_COUNT="$(psql -d constructive -t -c "SELECT count(*) FROM metaschema_public.policy p JOIN metaschema_public.table t ON t.id = p.table_id JOIN metaschema_public.database d ON d.id = t.database_id WHERE d.name = '$DB_NAME_RESOLVED' AND t.name = '$table_name';" 2>/dev/null | tr -d ' ')"
        [ "${POLICY_COUNT:-0}" -gt 0 ] 2>/dev/null && pass "Benchmark table '$table_name' has $POLICY_COUNT policy record(s)" || fail "Benchmark table '$table_name' has no policy records in metaschema_public.policy" "Re-run provision with correct policy config"
      done < <(spec_table_names || true)
    fi

    # Separator-tolerant (SUBDOMAIN-001): matches '<db>-…-user-identifiers-…' AND '<db>_user_identifiers_…'.
    SCHEMA="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'emails' AND table_schema LIKE '${DB_LIKE}%user%identifiers%';" 2>/dev/null | tr -d ' ')"
    if [ -n "$SCHEMA" ]; then
      DEFAULT_VAL="$(psql -d constructive -t -c "SELECT column_default FROM information_schema.columns WHERE table_schema = '$SCHEMA' AND table_name = 'emails' AND column_name = 'is_verified';" 2>/dev/null | tr -d ' ')"
      [ "$DEFAULT_VAL" = "true" ] && pass "auto-verify-email workaround applied" || warn "auto-verify-email may be missing"
    else
      warn "Could not find emails schema for '$DB_NAME_RESOLVED'"
    fi

    MEM_SCHEMA="$MEMBERSHIP_SCHEMA"
    if [ -n "$MEM_SCHEMA" ]; then
      APPROVED="$(psql -d constructive -t -c "SELECT is_approved FROM \"$MEM_SCHEMA\".app_membership_defaults LIMIT 1;" 2>/dev/null | tr -d ' ')"
      [ "$APPROVED" = "t" ] && pass "fix-membership-defaults workaround applied" || warn "fix-membership-defaults may be missing"
    else
      warn "Could not find app_membership_defaults schema for '$DB_NAME_RESOLVED'"
    fi

    check_state_fields
    ;;

  2.3)
    echo "Verifying Phase 2.3: Codegen"
    echo "-----------------------------"

    # Two supported codegen layouts. The MAINLINE is the in-app per-DB SDK; the standalone
    # sdk/* packages are an OPTIONAL extension (F8). Branch on which one the agent produced so
    # the standalone hard-fails NEVER block the mainline:
    #   (A) Standalone SDK packages:  sdk/schema + sdk/sdk + sdk/cli  (SKILL public 2.5 — optional)
    #   (B) Template per-DB SDK:       <app>/src/graphql/sdk/{admin,auth,app}  (SKILL Phase 3 — the
    #        sandbox `nextjs/constructive-app` boilerplate's `pnpm codegen` output; the mainline)
    # The in-app SDK takes precedence: if <app>/src/graphql/sdk has generated files we run the
    # template checks and exit 0, so a stray/empty standalone `sdk/schema` cannot trip the
    # optional standalone hard-fails on a mainline build. The standalone block below only runs
    # when there is NO in-app SDK (i.e. the agent explicitly chose the standalone extension).
    # If neither exists, fail with guidance. app_rel derives the app package from the
    # WORKSPACE ROOT: the root itself (single-package template, `.`), else packages/app, else app.
    APP_ROOT="$(app_rel)"
    TEMPLATE_SDK_DIR="$(workspace_path "$APP_ROOT/src/graphql/sdk")"
    TEMPLATE_SDK_FILES=0
    [ -d "$TEMPLATE_SDK_DIR" ] && TEMPLATE_SDK_FILES="$(find "$TEMPLATE_SDK_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$TEMPLATE_SDK_FILES" -gt 0 ]; then
      echo "  INFO: Detected mainline in-app SDK ($APP_ROOT/src/graphql/sdk, $TEMPLATE_SDK_FILES file(s)); standalone sdk/* checks are optional and skipped."
      for ns in admin auth app; do
        if [ -d "$TEMPLATE_SDK_DIR/$ns" ]; then
          pass "Template SDK namespace exists: $APP_ROOT/src/graphql/sdk/$ns"
        else
          warn "Template SDK namespace not found: $APP_ROOT/src/graphql/sdk/$ns (run 'pnpm codegen' in the app)"
        fi
      done
      pass "Template SDK contains $TEMPLATE_SDK_FILES generated file(s)"
      check_state_fields
      echo ""
      echo -e "${GREEN}Phase $PHASE: CHECKS COMPLETE${NC}"
      exit 0
    fi

    [ -d "$(workspace_path "sdk/schema")" ] && pass "sdk/schema exists" || fail "sdk/schema not found" "Use the standalone sdk/* layout (SKILL Phase 2.5) or the template per-DB layout app/src/graphql/sdk (SKILL Phase 2.6)"
    [ -d "$(workspace_path "sdk/sdk")" ] && pass "sdk/sdk exists" || fail "sdk/sdk not found" "Off-mainline (optional standalone SDK, SKILL public 2.5) — the mainline is the in-app SDK at <app>/src/graphql/sdk via 'pnpm codegen'. If you DID choose the standalone extension, scaffold sdk/sdk; otherwise ignore."
    [ -d "$(workspace_path "sdk/cli")" ] && pass "sdk/cli exists" || fail "sdk/cli not found" "Off-mainline (optional standalone SDK, SKILL public 2.5); the mainline in-app SDK has no separate sdk/cli. Scaffold it only if you chose the standalone extension; otherwise ignore."

    if [ -f "$(workspace_path "sdk/schema/codegen.config.ts")" ]; then
      pass "codegen.config.ts exists in sdk/schema"
      if grep -q "defineConfig" "$(workspace_path "sdk/schema/codegen.config.ts")"; then
        pass "codegen.config.ts contains defineConfig"
      else
        fail "codegen.config.ts does not contain defineConfig" "Use defineConfig from the codegen template"
      fi
    else
      fail "codegen.config.ts not found in sdk/schema" "Copy codegen template and fill in config"
    fi

    SCHEMA_COUNT="$(find "$(workspace_path "sdk/schema")" -name '*.graphql' 2>/dev/null | wc -l | tr -d ' ')"
    [ "$SCHEMA_COUNT" -gt 0 ] && pass "Found $SCHEMA_COUNT schema file(s)" || fail "No .graphql files found in sdk/schema" "Codegen introspection produced no schema — ensure CODEGEN_APP_HOST=api-<sub> + CODEGEN_APP_ENDPOINT are honored before re-running codegen (SKILL.md S3/S4); the template hardcodes the dead app-public-<sub> host."

    SCHEMA_FILE="$(workspace_path "sdk/schema/schemas/app-public.graphql")"
    [ -f "$SCHEMA_FILE" ] && pass "Primary schema file exists" || fail "Primary schema file not found at $SCHEMA_FILE" "The app-public.graphql introspection target is missing — re-run codegen against the api-<sub> endpoint with Host: api-<sub>.localhost (CODEGEN_APP_HOST/ENDPOINT honored; SKILL.md S3/S4)."

    if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
      TABLE_MATCHES=0
      while IFS= read -r table_name; do
        [ -n "$table_name" ] || continue
        if grep -q "$table_name" "$SCHEMA_FILE"; then
          pass "Schema mentions benchmark table '$table_name'"
          TABLE_MATCHES=$((TABLE_MATCHES + 1))
        else
          fail "Schema does not mention benchmark table '$table_name'" "Re-run codegen with correct endpoint"
        fi
      done < <(spec_table_names || true)
      [ "$TABLE_MATCHES" -gt 0 ] || fail "No benchmark tables were checked against the schema" "None of the brief's tables appeared in the generated schema — codegen hit the wrong endpoint; point it at api-<sub> (CODEGEN_APP_HOST=api-<sub> honored) and regenerate (SKILL.md S3/S4)."
    fi

    [ -d "$(workspace_path "sdk/sdk/src/generated/hooks")" ] && pass "Generated hooks exist" || fail "Generated hooks not found" "Codegen didn't emit hooks — re-run 'pnpm codegen' with CODEGEN_APP_HOST=api-<sub> honored (SKILL.md S3/S4); don't hand-write hooks (gotchas CODEGEN-001)."
    [ -d "$(workspace_path "sdk/sdk/src/generated/orm")" ] && pass "Generated ORM exists" || fail "Generated ORM not found" "Codegen didn't emit the ORM — re-run 'pnpm codegen' against the api-<sub> endpoint (CODEGEN_APP_HOST honored; SKILL.md S3/S4)."
    [ -d "$(workspace_path "sdk/cli/src/generated")" ] && pass "Generated CLI exists" || fail "Generated CLI not found" "Off-mainline standalone-SDK CLI codegen — re-run codegen for the sdk/cli package (SKILL public 2.5); ignore if you're on the mainline in-app SDK."
    [ -d "$(workspace_path "sdk/sdk/src/generated/hooks/skills")" ] && pass "Generated hook skills exist" || fail "Generated hook skills not found" "Codegen skills output missing — re-run 'pnpm codegen' with the api-<sub> endpoint honored (SKILL.md S3/S4)."
    [ -d "$(workspace_path "sdk/sdk/src/generated/orm/skills")" ] && pass "Generated ORM skills exist" || fail "Generated ORM skills not found" "Codegen skills output missing — re-run 'pnpm codegen' with CODEGEN_APP_HOST=api-<sub> honored (SKILL.md S3/S4)."

    [ -f "$(workspace_path "sdk/sdk/src/generated/hooks/index.ts")" ] || fail "Generated hooks index missing" "Codegen produced no hooks index — re-run 'pnpm codegen' against api-<sub> (CODEGEN_APP_HOST honored; SKILL.md S3/S4)."
    [ -f "$(workspace_path "sdk/sdk/src/generated/orm/index.ts")" ] || fail "Generated ORM index missing" "Codegen produced no ORM index — re-run 'pnpm codegen' against api-<sub> (CODEGEN_APP_HOST honored; SKILL.md S3/S4)."

    if grep -qx 'export {};' "$(workspace_path "sdk/sdk/src/generated/hooks/index.ts")"; then
      fail "Generated hooks index is empty" "Empty index = codegen introspected an empty/wrong schema — ensure CODEGEN_APP_HOST=api-<sub> + CODEGEN_APP_ENDPOINT are honored (the template hardcodes the dead app-public-<sub> host), then re-run 'pnpm codegen' (SKILL.md S3/S4)."
    else
      pass "Generated hooks index is non-empty"
    fi

    if grep -qx 'export {};' "$(workspace_path "sdk/sdk/src/generated/orm/index.ts")"; then
      fail "Generated ORM index is empty" "Empty index = codegen introspected an empty/wrong schema — ensure CODEGEN_APP_HOST=api-<sub> is honored (not the dead app-public-<sub> host), then re-run 'pnpm codegen' (SKILL.md S3/S4)."
    else
      pass "Generated ORM index is non-empty"
    fi

    grep -qE "sdk(/|\*|')" "$(workspace_path "pnpm-workspace.yaml")" && pass "sdk registered in pnpm-workspace.yaml" || fail "sdk missing from pnpm-workspace.yaml" "Off-mainline standalone-SDK packaging — add the 'sdk/*' glob to pnpm-workspace.yaml so pnpm sees sdk/schema|sdk|cli (SKILL public 2.5); ignore on the mainline in-app SDK."

    SDK_BUILD_LOG="$(mktemp)"
    if (cd "$WORKSPACE_ROOT" && pnpm --filter './sdk/*' build >"$SDK_BUILD_LOG" 2>&1); then
      pass "SDK packages build successfully"
    else
      warn "SDK package build had issues (see $SDK_BUILD_LOG)"
    fi

    check_state_fields
    ;;

  2.4)
    echo "Verifying Phase 2.4: Frontend"
    echo "------------------------------"

    # app_rel derives the app package from the WORKSPACE ROOT — the root itself
    # (single-package template, `.`), else packages/app (nested), else app (legacy). Detect once.
    APP_ROOT="$(app_rel)"

    ENV_FILE_REL="$(spec_value env_file || true)"
    if [ -z "$ENV_FILE_REL" ]; then
      ENV_FILE_REL="$APP_ROOT/.env.local"
    fi

    PLATFORM_ENDPOINT="$(cfg_endpoint api)"; [ -n "$PLATFORM_ENDPOINT" ] || PLATFORM_ENDPOINT="http://api.localhost:3000/graphql"
    PHASE_SUBDOMAIN="$(resolve_subdomain "$(resolve_db_name)")"
    # Per-DB GraphQL DATA endpoint = api-<sub> (Host header routes to the DB; app-public-<sub> is DEAD).
    GRAPHQL_ENDPOINT="$(cfg_endpoint api "$PHASE_SUBDOMAIN")"; [ -n "$GRAPHQL_ENDPOINT" ] || GRAPHQL_ENDPOINT="http://api-${PHASE_SUBDOMAIN}.localhost:3000/graphql"
    AUTH_ENDPOINT="$(cfg_endpoint auth "$PHASE_SUBDOMAIN")"; [ -n "$AUTH_ENDPOINT" ] || AUTH_ENDPOINT="http://auth-${PHASE_SUBDOMAIN}.localhost:3000/graphql"

    [ -d "$(workspace_path "$APP_ROOT")" ] && pass "$APP_ROOT/ exists" || fail "$APP_ROOT/ not found" "Scaffold the Next.js app — 'pgpm init … --template nextjs/constructive-app' at the app root (single-package layout = repo root; SKILL.md S3)."
    [ -f "$(workspace_path "$APP_ROOT/package.json")" ] && pass "$APP_ROOT/package.json exists" || fail "$APP_ROOT/package.json not found" "The app scaffold is incomplete — re-run 'pgpm init … --template nextjs/constructive-app' at the app root (SKILL.md S3)."
    # Accept a root-level `app` glob OR the `packages/*` glob that covers packages/app.
    if grep -qE "app(/|'|\"|$)" "$(workspace_path "pnpm-workspace.yaml")" || grep -qE "packages/\*" "$(workspace_path "pnpm-workspace.yaml")"; then
      pass "app registered in pnpm-workspace.yaml"
    else
      fail "app missing from pnpm-workspace.yaml" "Register the app in pnpm-workspace.yaml — in the single-package-at-root layout add the root '.' (or its package path) alongside packages/provision (SKILL.md S1/S4b)."
    fi
    grep -q "workspace:" "$(workspace_path "$APP_ROOT/package.json")" && pass "workspace dependency present" || warn "No workspace dependency detected"

    APP_SOURCE_DIR="$(resolve_app_source_dir || true)"
    [ -n "$APP_SOURCE_DIR" ] && pass "Frontend source directory exists at $APP_SOURCE_DIR" || fail "No frontend source directory found (expected $APP_ROOT/app, $APP_ROOT/pages, or $APP_ROOT/src)" "The app scaffold has no src tree — re-run the nextjs/constructive-app template (SKILL.md S3); don't strip the boilerplate src/."
    APP_SOURCE_PATH="$(workspace_path "$APP_SOURCE_DIR")"

    [ -d "$(workspace_path "$APP_ROOT/src/app")" ] && pass "Boilerplate app directory exists ($APP_ROOT/src/app/)" || warn "Boilerplate app directory not found (expected $APP_ROOT/src/app/)"
    [ -d "$(workspace_path "$APP_ROOT/src/components")" ] && pass "Boilerplate components directory exists ($APP_ROOT/src/components/)" || warn "Boilerplate components directory not found (expected $APP_ROOT/src/components/)"
    [ -f "$(workspace_path "$APP_ROOT/src/config/branding.ts")" ] && pass "Boilerplate branding config exists" || warn "Boilerplate branding config not found (expected $APP_ROOT/src/config/branding.ts)"
    [ -f "$(workspace_path "$APP_ROOT/graphql-codegen.config.ts")" ] && pass "Boilerplate codegen config exists" || warn "Boilerplate codegen config not found"
    [ -d "$(workspace_path "$APP_ROOT/src/graphql/schema-builder-sdk/api")" ] && pass "Boilerplate platform SDK exists" || warn "Boilerplate platform SDK not found (expected $APP_ROOT/src/graphql/schema-builder-sdk/api)"
    if grep -q "AppProvider" "$(workspace_path "$APP_ROOT/src/app/layout.tsx")" && grep -q "RouteGuard" "$(workspace_path "$APP_ROOT/src/app/layout.tsx")" && grep -q "AuthenticatedShell" "$(workspace_path "$APP_ROOT/src/app/layout.tsx")"; then
      pass "Root layout preserves template provider and shell wiring"
    else
      fail "Root layout is missing AppProvider, RouteGuard, or AuthenticatedShell" "Restore the template shell in src/app/layout.tsx — keep <AppProvider>, <RouteGuard>, and <AuthenticatedShell> wrapping the app; don't strip the shell when adding your routes (SKILL.md S3/S7)."
    fi
    if grep -q "QueryClientProvider" "$(workspace_path "$APP_ROOT/src/components/app-provider.tsx")"; then
      pass "AppProvider preserves QueryClientProvider"
    else
      fail "AppProvider is missing QueryClientProvider" "Restore <QueryClientProvider> inside AppProvider (src/components/app-provider.tsx) — the generated TanStack hooks need it; don't remove the template's query client (SKILL.md S3)."
    fi

    ENV_FILE_ABS="$(workspace_path "$ENV_FILE_REL")"
    if [ -f "$ENV_FILE_ABS" ]; then
      grep -q "NEXT_PUBLIC_SCHEMA_BUILDER_GRAPHQL_ENDPOINT=$PLATFORM_ENDPOINT" "$ENV_FILE_ABS" && pass "Platform endpoint present in env file" || warn "NEXT_PUBLIC_SCHEMA_BUILDER_GRAPHQL_ENDPOINT missing from env file"
      grep -q "$GRAPHQL_ENDPOINT" "$ENV_FILE_ABS" && pass "GraphQL endpoint present in env file" || warn "GraphQL endpoint missing from env file"
      grep -q "$AUTH_ENDPOINT" "$ENV_FILE_ABS" && pass "Auth endpoint present in env file" || warn "Auth endpoint missing from env file"
    else
      warn "$ENV_FILE_REL not found in $WORKSPACE_ROOT"
    fi

    if [ -f "$ENV_FILE_ABS" ] && grep -q "NEXT_PUBLIC_GRAPHQL_ENDPOINT=" "$ENV_FILE_ABS"; then
      if command -v rg >/dev/null 2>&1 && rg -n "NEXT_PUBLIC_GRAPHQL_ENDPOINT" "$APP_SOURCE_PATH" -g '*.ts' -g '*.tsx' >/dev/null 2>&1; then
        pass "Frontend source references the per-database app endpoint"
      else
        fail "Frontend source does not reference NEXT_PUBLIC_GRAPHQL_ENDPOINT despite the app endpoint being configured" "Wire the app DATA endpoint in source — read NEXT_PUBLIC_GRAPHQL_ENDPOINT (the api-<sub> URL, NOT the dead app-public-<sub>) where you configure the SDK transport (SKILL.md S3)."
      fi
    fi

    if [ -f "$ENV_FILE_ABS" ] && grep -q "NEXT_PUBLIC_AUTH_ENDPOINT=" "$ENV_FILE_ABS"; then
      if command -v rg >/dev/null 2>&1 && rg -n "NEXT_PUBLIC_AUTH_ENDPOINT" "$APP_SOURCE_PATH" -g '*.ts' -g '*.tsx' >/dev/null 2>&1; then
        pass "Frontend source references the per-database auth endpoint"
      else
        fail "Frontend source does not reference NEXT_PUBLIC_AUTH_ENDPOINT despite the app auth endpoint being configured" "Wire the per-DB auth endpoint in source — read NEXT_PUBLIC_AUTH_ENDPOINT (the auth-<sub> URL) where you configure the auth transport; per-DB signup/login must hit auth-<sub>, not base auth.localhost (SKILL.md S3 / gotchas RLS-POLICY-001 FK prereq)."
      fi
    fi

    APP_PACKAGE="$(resolve_app_package || true)"
    [ -n "$APP_PACKAGE" ] || fail "Could not resolve app package name" "Set a \"name\" in the app's package.json (it's what 'pnpm --filter <name> build' targets) — the nextjs/constructive-app template ships one; restore it if you cleared it (SKILL.md S3)."
    # Phase 2.4 is the BUILD PRODUCER: it runs the full build and, on success, leaves <app>/.next/BUILD_ID
    # which Phase 2.5 verifies against instead of rebuilding (build-once; see verify_or_build_app).
    build_app "Frontend build succeeds" "Frontend build failed (see build log above)"

    # The build above runs with ignoreBuildErrors, so it does NOT prove the app's own source
    # type-checks — gate that explicitly with a no-emit TypeScript check on the app (src/**).
    check_app_compiles

    # Additive: only fires if Constructive Blocks were installed (Phase 2.7).
    check_blocks_coverage

    # Additive: only fires if this harness ships a generated references/flows.json.
    check_flows_drift

    # Additive: validate the BUILT app's globals.css against the Blocks token + Tailwind-v4 contract
    # (no built globals.css → no-op). The frontend exists by this phase, so the functional check fires.
    check_design

    check_state_fields
    ;;

  2.5)
    echo "Verifying Phase 2.5: UI"
    echo "------------------------"

    # app_rel derives the app package from the WORKSPACE ROOT — the root itself
    # (single-package template, `.`), else packages/app (nested), else app (legacy). Detect once.
    APP_ROOT="$(app_rel)"

    [ -f "$(workspace_path "$APP_ROOT/package.json")" ] || fail "$APP_ROOT/package.json not found" "The app scaffold is missing — re-run 'pgpm init … --template nextjs/constructive-app' at the app root (SKILL.md S3)."

    grep -q "@constructive-io/ui" "$(workspace_path "$APP_ROOT/package.json")" && pass "@constructive-io/ui dependency present" || warn "@constructive-io/ui dependency not found"

    APP_SOURCE_DIR="$(resolve_app_source_dir || true)"
    [ -n "$APP_SOURCE_DIR" ] && pass "Frontend source directory exists at $APP_SOURCE_DIR" || fail "No frontend source directory found" "The app has no src tree — re-run the nextjs/constructive-app template (SKILL.md S3); don't strip the boilerplate src/."

    APP_SOURCE_PATH="$(workspace_path "$APP_SOURCE_DIR")"
    SOURCE_COUNT="$(find "$APP_SOURCE_PATH" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) 2>/dev/null | wc -l | tr -d ' ')"
    [ "$SOURCE_COUNT" -gt 0 ] && pass "Found $SOURCE_COUNT frontend source file(s)" || fail "No frontend source files found" "Source dir exists but is empty — build the app CRUD body (routes/components) in src/ (SKILL.md S7); a scaffold with zero source files means nothing was built."

    if command -v rg >/dev/null 2>&1 && rg -n "framer-motion" "$(workspace_path "$APP_ROOT")" -g '*.ts' -g '*.tsx' >/dev/null 2>&1; then
      fail "Found framer-motion import" "Remove framer-motion — it's banned in this stack; use @constructive-io/ui primitives (or CSS/Tailwind) for animation (SKILL.md S7 / UI conventions)."
    else
      pass "No framer-motion import found"
    fi

    if command -v rg >/dev/null 2>&1 && rg -n "from '@constructive-io/ui'" "$(workspace_path "$APP_ROOT")" -g '*.ts' -g '*.tsx' >/dev/null 2>&1; then
      warn "Found barrel import from @constructive-io/ui"
    else
      pass "No barrel imports from @constructive-io/ui"
    fi

    # Two SDK layouts (F8): standalone `sdk/sdk` package, OR the mainline in-app SDK at
    # <app>/src/graphql/sdk imported via `@sdk/*`. resolve_sdk_package returns the `@sdk/`
    # marker for the in-app case; for that case we also accept a relative src/graphql/sdk
    # import. Only hard-fail if NEITHER form is present.
    SDK_PACKAGE="$(resolve_sdk_package || true)"
    [ -n "$SDK_PACKAGE" ] || fail "Could not resolve the SDK the frontend imports" "Run 'pnpm codegen' so the in-app SDK exists at $APP_ROOT/src/graphql/sdk (SKILL Phase 3), or scaffold the optional standalone sdk/sdk package (SKILL public 2.5)"
    # Accept ANY of the three import forms the mainline + standalone layouts use:
    #   1. the resolved $SDK_PACKAGE (a standalone package name, OR the `@sdk/` in-app marker)
    #   2. the `@sdk/` alias literal — the DOCUMENTED in-app import (`@sdk/{admin,auth,app}`,
    #      tsconfig-aliased to src/graphql/sdk). Always probed, even when resolve_sdk_package
    #      returned a standalone name (a stray sdk/sdk must not mask a real @sdk/app import).
    #   3. a relative `graphql/sdk` path import.
    if command -v rg >/dev/null 2>&1 && { rg -nF "$SDK_PACKAGE" "$APP_SOURCE_PATH" -g '*.ts' -g '*.tsx' -g '*.js' -g '*.jsx' >/dev/null 2>&1 \
         || rg -nF "@sdk/" "$APP_SOURCE_PATH" -g '*.ts' -g '*.tsx' -g '*.js' -g '*.jsx' >/dev/null 2>&1 \
         || rg -n "graphql/sdk" "$APP_SOURCE_PATH" -g '*.ts' -g '*.tsx' -g '*.js' -g '*.jsx' >/dev/null 2>&1; }; then
      pass "Frontend source imports generated SDK ($SDK_PACKAGE / @sdk/* / graphql/sdk)"
    else
      fail "Frontend source does not import the generated SDK" "Import the generated SDK via '@sdk/{admin,auth,app}' (mainline in-app, tsconfig-aliased to src/graphql/sdk) or your standalone sdk/sdk package name"
    fi

    if command -v rg >/dev/null 2>&1 && rg -n "configure\\(" "$(workspace_path "$APP_ROOT/src/app")" -g '*.ts' -g '*.tsx' >/dev/null 2>&1; then
      warn "App route source calls configure() directly; consider moving app-specific SDK configuration into shared integration code"
    else
      pass "No route-local configure() call found under $APP_ROOT/src/app"
    fi

    APP_ROUTE_SPEC="$(spec_value app_route || true)"
    if [ -n "$APP_ROUTE_SPEC" ] && [ -f "$(workspace_path "$APP_ROOT/src/app-routes.ts")" ]; then
      if grep -q "$APP_ROUTE_SPEC" "$(workspace_path "$APP_ROOT/src/app-routes.ts")"; then
        pass "App route '$APP_ROUTE_SPEC' is registered in app route config"
      else
        fail "App route '$APP_ROUTE_SPEC' is missing from app route config" "Register the brief's route in src/app-routes.ts (path + label + crud) so it's reachable and guarded by the shell (SKILL.md S7)."
      fi
    fi

    APP_PACKAGE="$(resolve_app_package || true)"
    [ -n "$APP_PACKAGE" ] || fail "Could not resolve app package name" "Set a \"name\" in the app's package.json (it's what 'pnpm --filter <name> build' targets) — the nextjs/constructive-app template ships one; restore it if you cleared it (SKILL.md S3)."
    # Build-once: Phase 2.4 (gate 2.6) already ran the full build this session and left
    # <app>/.next/BUILD_ID. Verify against that artifact instead of paying for a second full build;
    # GUARD — if it's missing (this phase run standalone, or .next cleaned) build ONCE so the
    # assertion is preserved (a broken build still fails here).
    verify_or_build_app "Final frontend build succeeds" "Final frontend build failed (see build log above)"

    # The build above runs with ignoreBuildErrors, so it does NOT prove the app's own source
    # type-checks — gate that explicitly with a no-emit TypeScript check on the app (src/**).
    check_app_compiles

    # Opt-in live running-app acceptance gate (signup → login → CRUD round-trip).
    # Hard-fails when enabled and the drive fails; degrades gracefully (skip) otherwise.
    run_live_qa "$APP_ROOT" "$APP_PACKAGE"

    check_state_fields
    ;;

  *)
    fail "Unknown phase: $PHASE" "Valid phases are 1, 2.1, 2.3, 2.5, 2.6, 3 (public labels; AGENTS.md phase map). Pass one of those, e.g. './scripts/verify-phase.sh 2.3'."
    ;;
esac

echo ""
echo -e "${GREEN}Phase $PHASE: CHECKS COMPLETE${NC}"
