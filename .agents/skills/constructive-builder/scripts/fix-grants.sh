#!/bin/bash
set -euo pipefail

# fix-grants.sh — verify + idempotently reconcile the per-DB `authenticated` GRANTs
# and the users-table self_update policy for a Constructive app database.
#
# This is the executable form of SKILL.md S2 step 3 (the "VERIFY + reconcile the
# grant" command) and is EXACTLY what the Phase 2.2 gate asserts (verify-phase.sh):
#   • role `authenticated` holds all 4 privileges (SELECT/INSERT/UPDATE/DELETE) on
#     the app schema's tables, AND
#   • the users table has the self_update UPDATE policy (auth_upd_self_update), or
#     `updateUser` is a silent 200-but-0-rows no-op (gotchas RLS-USERS-UPDATE-001).
#
# The canonical grant path is the OBJECT-FORM blueprint grants that constructBlueprint
# applies server-side (gotchas F3) and the createSecureTableProvision self_update step
# provision.ts runs (RLS-USERS-UPDATE-001). The platform occasionally skips them on a
# shared hub. This script reconciles that gap IDEMPOTENTLY — it is a no-op when both
# already landed, and applies ONLY the missing piece otherwise. It does NOT replace the
# blueprint path; it backstops it.
#
# Schema resolution is ANCHORED on this tenant's db-name prefix and tolerant of BOTH per-DB
# naming conventions — the SAME resolution verify-phase.sh's Phase 2.2 gate uses — so it can
# never bleed onto a sibling tenant on the shared hub (gotchas SUBDOMAIN-001):
#   OLD dash+hash:  <db>-<hash>-memberships-public   (fv4-* era)
#   NEW underscore: <db>_memberships_public          (goldenapp_*/fv5_*/fv6_*)
#   DB_LIKE        = the db name with its own '-'/'_' turned into '%', anchored at the START
#   MEMBERSHIP/APP/USERS_SCHEMA = resolved DIRECTLY via '<DB_LIKE>%<token>%public' (no leading
#                       %, no prefix arithmetic — an underscore name can't yield a wrong app/users)
#
# It connects to the HUB db `constructive` (NOT $PGDATABASE — `pgpm env` sets
# PGDATABASE=postgres, where the app schemas do NOT live). It reads constructive_db
# READ-mostly and writes ONLY this agent's own app/users schema (USAGE + table privs to
# `authenticated`, and the self_update policy on its users table). On success it records
# `database.grant_source = manual-fallback` in build/run-state.json so the Phase 2.2
# provenance note reflects the reconcile (the gate reads that structured field, not prose).
#
# Usage:
#   ./scripts/fix-grants.sh <db-name> [--app-id ID] [--app-dir DIR] [--state PATH] [--dry-run]
#     <db-name>     the app database name (e.g. goldenapp). Required (positional).
#     --app-id ID   the per-app state token (build/<ID>/run-state.json). Default: <db-name>
#                   sanitized to [a-z0-9] — the SAME token the orchestrators derive from the
#                   brief's naming.db_name. Highest precedence; overrides --app-dir/$APP_ID.
#     --app-dir DIR the scaffolded app's root dir; reads APP_ID from <DIR>/.env (APP_ID=…)
#                   then falls back to the dir's basename. Overridden by --app-id.
#     --state PATH  explicit run-state.json to stamp. Highest precedence of all (wins over the
#                   per-app/legacy resolution). Default: build/<app-id>/run-state.json when an
#                   app-id is resolvable (else the LEGACY build/run-state.json singleton).
#     --dry-run     resolve + verify + PRINT what it would apply; change nothing
#
# STATE ISOLATION (why this matters): per-app run-state is READER-scoped downstream
# (verify-phase / live-qa resolve build/<app-id>/), but if THIS producer writes the legacy
# singleton build/run-state.json, a later auth:email app inherits a prior b2b app's
# org_reconcile + endpoints and false-FAILs. So we WRITE the per-app file (build/<app-id>/)
# whenever an app-id is resolvable, NEVER the legacy singleton — mirroring fix-org-grants.sh's
# DATABASE_ID scoping. Legacy is used ONLY when no app-id is resolvable (single-app golden path).
#
# Env:
#   PG_HUB_DATABASE   hub db to connect to (default: constructive)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD   standard libpq (run `eval "$(pgpm env)"` first)
#
# Exit: 0 = grants + policy present (already, or after a successful reconcile) ·
#       non-zero = could not resolve the schema, or a reconcile failed.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  PASS${NC}: $1"; }
fail() {
  echo -e "${RED}  FAIL${NC}: $1"
  [ -n "${2:-}" ] && echo -e "        FIX: $2"
  exit 1
}
warn() { echo -e "${YELLOW}  WARN${NC}: $1"; }
info() { echo "  INFO: $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── args ─────────────────────────────────────────────────────────────────────
DB_NAME=""
STATE_PATH=""
APP_ID_ARG=""        # --app-id (highest precedence app-id source)
APP_DIR=""           # --app-dir (read APP_ID from its .env / its basename)
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-id) APP_ID_ARG="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --state) STATE_PATH="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '3,57p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fail "Unknown option: $1" "see ./scripts/fix-grants.sh --help" ;;
    *)
      if [ -z "$DB_NAME" ]; then DB_NAME="$1"; else fail "Unexpected argument: $1"; fi
      shift
      ;;
  esac
done

[ -n "$DB_NAME" ] || fail "missing required <db-name>" \
  "usage: ./scripts/fix-grants.sh <db-name>   (e.g. ./scripts/fix-grants.sh goldenapp)"

# ── resolve the per-app state token (APP_ID) — mirrors fix-org-grants.sh's id discipline ─
# This is the STATE-ISOLATION pivot: it decides whether we write the PER-APP run-state
# (build/<app-id>/run-state.json) or the legacy singleton. We NEVER write the legacy file
# when an app-id is resolvable, so a polluted legacy run-state can't bleed onto a sibling
# tenant. Sanitize to [a-z0-9] so the token matches the one the orchestrators derive from
# the brief's naming.db_name (awk gsub(/[^a-z0-9]/,"") on db_name). Precedence (highest
# first): --app-id → --app-dir's .env APP_ID (then its basename) → $APP_ID env → <db-name>.
sanitize_app_id() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'; }

# Read APP_ID=… from a .env (last wins; tolerates `export `, quotes, trailing CR). Echoes raw.
read_env_app_id() {
  local f="$1" line val out=""
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      APP_ID=*|export\ APP_ID=*)
        val="${line#*APP_ID=}"; val="${val%$'\r'}"; val="${val#\"}"; val="${val%\"}"
        val="${val#\'}"; val="${val%\'}"; out="$val" ;;
    esac
  done < "$f"
  printf '%s' "$out"
}

# Capture the inherited $APP_ID env BEFORE we (re)assign APP_ID, so it stays usable as a
# mid-precedence source (an explicit --app-id / --app-dir still wins over it).
APP_ID_ENV="${APP_ID:-}"
APP_ID=""
APP_ID_SRC=""
if [ -n "$APP_ID_ARG" ]; then
  APP_ID="$(sanitize_app_id "$APP_ID_ARG")"; APP_ID_SRC="--app-id"
elif [ -n "$APP_DIR" ]; then
  [ -d "$APP_DIR" ] || fail "--app-dir '$APP_DIR' is not a directory" \
    "pass the scaffolded app's ROOT dir (the one whose .env carries APP_ID), or use --app-id."
  _id=""
  for envf in "$APP_DIR/.env" "$APP_DIR/packages/app/.env" "$APP_DIR/packages/provision/.env"; do
    _id="$(read_env_app_id "$envf")"; [ -n "$_id" ] && { APP_ID_SRC="$envf"; break; }
  done
  [ -z "$_id" ] && { _id="$(basename "$APP_DIR")"; APP_ID_SRC="--app-dir basename"; }
  APP_ID="$(sanitize_app_id "$_id")"
elif [ -n "$APP_ID_ENV" ]; then
  APP_ID="$(sanitize_app_id "$APP_ID_ENV")"; APP_ID_SRC="\$APP_ID env"
fi
if [ -z "$APP_ID" ]; then
  # Final fallback: the db-name itself (the brief validator makes db_name plain-lowercase, so
  # the sanitized db-name IS the orchestrators' app-id token for an app provisioned from a brief).
  APP_ID="$(sanitize_app_id "$DB_NAME")"; APP_ID_SRC="<db-name>"
fi

# ── resolve STATE_PATH (the file we stamp). Precedence:
#   1) explicit --state (highest — an operator pointing at an exact file always wins), else
#   2) per-app build/<app-id>/run-state.json when an app-id is resolvable (the isolation path —
#      used even if absent right now: a later phase creates it, and we never pollute legacy), else
#   3) the LEGACY build/run-state.json singleton ONLY when no app-id (single-app golden path).
if [ -z "$STATE_PATH" ]; then
  if [ -n "$APP_ID" ]; then
    STATE_PATH="$REPO_ROOT/build/$APP_ID/run-state.json"
  elif [ -f "$REPO_ROOT/build/run-state.json" ]; then
    STATE_PATH="$REPO_ROOT/build/run-state.json"
  fi
fi

HUBDB="${PG_HUB_DATABASE:-constructive}"

command -v psql >/dev/null 2>&1 || fail "psql not found on PATH" \
  "install the Postgres client and run: eval \"\$(pgpm env)\" (sets PGHOST/PGPORT/PGUSER/PGPASSWORD)"

# Single-value psql helper against the hub db (trimmed).
hub_q() { psql -d "$HUBDB" -t -A -c "$1" 2>/dev/null | head -n1 | tr -d '[:space:]'; }

echo
echo -e "${GREEN}fix-grants — reconcile per-DB authenticated GRANTs + users self_update${NC}"
echo "------------------------------------------------------------"
info "db-name : $DB_NAME"
info "hub db  : $HUBDB  (app schemas live here, NOT in PGDATABASE)"
info "app-id  : $APP_ID  (from $APP_ID_SRC) — per-app run-state isolation"
info "state   : ${STATE_PATH:-<none>}"
[ "$DRY_RUN" = "1" ] && warn "DRY-RUN: will resolve + verify only; no changes will be applied"

# ── 0. hub reachable + db exists ────────────────────────────────────────────
psql -d "$HUBDB" -c "SELECT 1" >/dev/null 2>&1 || fail "cannot connect to hub db '$HUBDB'" \
  "run \`eval \"\$(pgpm env)\"\` so PGHOST/PGPORT/PGUSER/PGPASSWORD are set, and ensure the hub Postgres is up"

DB_EXISTS="$(hub_q "SELECT 1 FROM metaschema_public.database WHERE name = '$DB_NAME' LIMIT 1;")"
[ "$DB_EXISTS" = "1" ] || fail "database '$DB_NAME' not found in metaschema_public.database" \
  "provision it first (SKILL.md S2: create-db + provision); fix-grants reconciles an EXISTING app's grants, it does not create the db"

# ── 1. resolve the tenant's per-DB schemas (anchored; separator-tolerant; gate-identical) ─
# The platform emits per-DB schema names in TWO conventions, and which one a tenant gets
# depends on when it was provisioned (gotchas SUBDOMAIN-001):
#   • OLD dash-collapsed + hash:  <db>-<hash>-memberships-public   (fv4-* era tenants)
#   • NEW underscore, no hash:    <db>_memberships_public          (goldenapp_*/fv5_*/fv6_*)
# A LIKE hardcoded to one separator silently 0-matches the other (the false-fail this fixes).
# We anchor on the db-name prefix (no leading %, so a sibling tenant whose name merely
# CONTAINS this db can never match) and tolerate EITHER separator by turning the db name's
# own separators into '%' and matching a '%<token>%public' suffix. Resolve each of the three
# schemas DIRECTLY by its own distinctive token instead of string-stripping a prefix — that
# way an underscore name (which the old `${x%-memberships-public}` strip left untouched)
# can't produce a wrong app/users schema. Mirrors verify-phase.sh's Phase 2.2 resolution so
# fix-grants and the gate always agree.
#   DB_LIKE = the db-name prefix with its own '-'/'_' turned into '%' (anchored at the START).
DB_LIKE="$(hub_q "SELECT replace(replace('$DB_NAME', '_', '%'), '-', '%');")"
[ -n "$DB_LIKE" ] || DB_LIKE="$DB_NAME"

MEMBERSHIP_SCHEMA="$(hub_q "SELECT table_schema FROM information_schema.tables WHERE table_name = 'app_membership_defaults' AND table_schema LIKE '${DB_LIKE}%memberships%public' ORDER BY length(table_schema), table_schema LIMIT 1;")"
[ -n "$MEMBERSHIP_SCHEMA" ] || fail "could not resolve the membership schema for '$DB_NAME' (anchored '${DB_LIKE}%memberships%public')" \
  "the app schemas aren't provisioned, or the db name differs from the schema prefix. Re-run create-db + provision (SKILL.md S2). If provision aborted with NOT_FOUND (memberships_module) you used AuthzEntityMembership on an auth:email app — switch to AuthzDirectOwner (gotchas RLS-POLICY-001)."

# Strip the trailing 'memberships'-segment (either separator) to get the human-readable prefix
# (display + final summary only; app/users are resolved directly below, not from this).
SCHEMA_PREFIX="${MEMBERSHIP_SCHEMA%[-_]memberships[-_]public}"

# Resolve app + users schemas DIRECTLY (anchored + separator-tolerant), the same way — no
# prefix arithmetic, so a dash OR underscore tenant both resolve correctly.
APP_SCHEMA="$(hub_q "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${DB_LIKE}%app%public' ORDER BY length(schema_name), schema_name LIMIT 1;")"
[ -n "$APP_SCHEMA" ] || fail "app schema for '$DB_NAME' does not exist (anchored '${DB_LIKE}%app%public')" \
  "provision didn't create the app schema — re-run create-db + provision (SKILL.md S2)"
APP_SCHEMA_EXISTS=1

USERS_SCHEMA="$(hub_q "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${DB_LIKE}%users%public' ORDER BY length(schema_name), schema_name LIMIT 1;")"
if [ -n "$USERS_SCHEMA" ]; then
  USERS_SCHEMA_EXISTS=1
else
  USERS_SCHEMA_EXISTS=0
  warn "users schema for '$DB_NAME' does not exist (anchored '${DB_LIKE}%users%public') — the self_update policy step will be skipped (an auth:email app should have it; re-run provision if updateUser is needed)"
fi

pass "resolved schema prefix : $SCHEMA_PREFIX"
info "app schema   : $APP_SCHEMA"
info "users schema : $USERS_SCHEMA"
echo "------------------------------------------------------------"

# Track whether we changed anything (drives grant_source stamping + final summary).
CHANGED=0

# ── 2. GRANTs: app schema, role 'authenticated', all 4 privileges ───────────
# Count DISTINCT privileges exactly as the Phase 2.2 gate does.
GRANT_PRIVS="$(hub_q "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$APP_SCHEMA' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');")"
GRANT_PRIVS="${GRANT_PRIVS:-0}"
if [ "$GRANT_PRIVS" -ge 4 ] 2>/dev/null; then
  pass "'authenticated' already holds all 4 privileges on $APP_SCHEMA tables — no GRANT needed"
else
  warn "'authenticated' has ${GRANT_PRIVS}/4 privileges on $APP_SCHEMA — applying the object-form grants"
  if [ "$DRY_RUN" = "1" ]; then
    info "DRY-RUN would run: GRANT USAGE ON SCHEMA \"$APP_SCHEMA\" TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA \"$APP_SCHEMA\" TO authenticated;"
  else
    # GRANTs are inherently idempotent; we only run them because the outcome check
    # above showed they are missing. USAGE on the schema is required for any access.
    if psql -d "$HUBDB" -v ON_ERROR_STOP=1 \
        -c "GRANT USAGE ON SCHEMA \"$APP_SCHEMA\" TO authenticated;" \
        -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA \"$APP_SCHEMA\" TO authenticated;" \
        >/dev/null 2>&1; then
      # Re-verify the OUTCOME (the gate's assertion), not just the command's exit.
      GRANT_PRIVS="$(hub_q "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$APP_SCHEMA' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');")"
      if [ "${GRANT_PRIVS:-0}" -ge 4 ] 2>/dev/null; then
        CHANGED=1
        pass "granted SELECT/INSERT/UPDATE/DELETE on $APP_SCHEMA to 'authenticated' (now ${GRANT_PRIVS}/4)"
      else
        fail "GRANT ran but 'authenticated' still has only ${GRANT_PRIVS:-0}/4 privileges on $APP_SCHEMA" \
          "the app schema may have no tables yet (provision incomplete), or a default-privileges/ownership issue blocks the grant. Re-run provision (SKILL.md S2) and check the tables exist."
      fi
    else
      fail "GRANT to 'authenticated' on $APP_SCHEMA failed" \
        "you may lack privileges on the hub, or the schema is empty. See SKILL.md S2 step 3 for the manual GRANT, and confirm \`eval \"\$(pgpm env)\"\` set a superuser/owner role."
    fi
  fi
fi

# ── 3. users self_update UPDATE policy (auth_upd_self_update) ────────────────
if [ "$USERS_SCHEMA_EXISTS" = "1" ]; then
  POLICY_CNT="$(hub_q "SELECT count(*) FROM pg_policies WHERE schemaname = '$USERS_SCHEMA' AND tablename = 'users' AND cmd = 'UPDATE';")"
  POLICY_CNT="${POLICY_CNT:-0}"
  if [ "$POLICY_CNT" -ge 1 ] 2>/dev/null; then
    pass "users-table self_update UPDATE policy already present in $USERS_SCHEMA — no change"
  else
    warn "users-table has no UPDATE policy in $USERS_SCHEMA — applying auth_upd_self_update (scoped to self)"
    if [ "$DRY_RUN" = "1" ]; then
      info "DRY-RUN would run: GRANT UPDATE ON \"$USERS_SCHEMA\".users TO authenticated; CREATE POLICY auth_upd_self_update ON \"$USERS_SCHEMA\".users FOR UPDATE TO authenticated USING (id = jwt_public.current_user_id());"
    else
      # Guarded create (Postgres has no CREATE POLICY IF NOT EXISTS): only create the
      # named policy if absent. Scope to SELF (id = current_user_id()), NEVER USING(true).
      # The schema name is stashed in a session GUC (as a SQL string literal — schema
      # names resolved from pg_namespace carry no quotes, the same interpolation model
      # verify-phase.sh uses) and read back with current_setting() in the DO block; the
      # CREATE POLICY identifier is then built with format('%I', …), so the DDL is never
      # built by raw concatenation. Also ensure the table-level UPDATE grant the policy
      # depends on.
      if psql -d "$HUBDB" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
SET fixgrants.users_schema = '$USERS_SCHEMA';
GRANT UPDATE ON TABLE "$USERS_SCHEMA".users TO authenticated;
DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_setting('fixgrants.users_schema')
      AND tablename  = 'users'
      AND policyname = 'auth_upd_self_update'
  ) THEN
    EXECUTE format(
      'CREATE POLICY auth_upd_self_update ON %I.users FOR UPDATE TO authenticated USING (id = jwt_public.current_user_id())',
      current_setting('fixgrants.users_schema')
    );
  END IF;
END
\$\$;
SQL
      then
        POLICY_CNT="$(hub_q "SELECT count(*) FROM pg_policies WHERE schemaname = '$USERS_SCHEMA' AND tablename = 'users' AND cmd = 'UPDATE';")"
        if [ "${POLICY_CNT:-0}" -ge 1 ] 2>/dev/null; then
          CHANGED=1
          pass "applied users self_update UPDATE policy (auth_upd_self_update) in $USERS_SCHEMA — updateUser will persist"
        else
          fail "self_update policy step ran but no UPDATE policy is present in $USERS_SCHEMA.users" \
            "the canonical fix is provision.ts's createSecureTableProvision self_update step (SKILL.md S2 step 1). Re-run provision, or check jwt_public.current_user_id() exists on this hub."
        fi
      else
        fail "could not apply the users self_update policy in $USERS_SCHEMA" \
          "apply it via provision.ts's createSecureTableProvision self_update step (SKILL.md S2 step 1), or the manual fallback in SKILL.md S2 step 3. Confirm you have privileges on the users schema."
      fi
    fi
  fi
else
  info "skipping the users self_update policy (no users schema resolved for '$DB_NAME')"
fi

echo "------------------------------------------------------------"

# ── 4. PUBLIC-READ (anonymous) reconcile for AuthzPublishable tables (idempotent) ───────────
# A `public-read+owner-write` brief intent emits an AuthzPublishable SELECT policy so "published
# rows are readable by anyone". The platform lands that policy as `auth_sel_publishable` scoped
# to the `authenticated` role ONLY, and grants the `anonymous` role NOTHING on the table — so a
# logged-OUT visitor querying the public data API gets "permission denied for table <t>" and
# AuthzPublishable is effectively authenticated-only, never truly public. This step makes
# public-read MEAN public, GENERICALLY (no table/column literal):
#   (1) GRANT USAGE on $APP_SCHEMA + SELECT on each publishable table to `anonymous`, and
#   (2) extend the publishable SELECT policy's role list to ALSO include `anonymous`
#       (RLS still filters to is_published — anon sees ONLY published rows; the owner-write
#       policies stay authenticated-only, so writes remain owner-scoped).
# The publishable table set is DISCOVERED from pg_policies (a SELECT policy whose name ends in
# `_publishable` = the platform's AuthzPublishable derivation) within THIS tenant's app schema.
# A non-public app has zero such policies → clean no-op. The durable fix is upstream
# (AuthzPublishable should grant the anonymous role itself).
if [ "$APP_SCHEMA_EXISTS" = "1" ]; then
  PUB_TABLE_CNT="$(hub_q "SELECT count(*) FROM pg_policies WHERE schemaname = '$APP_SCHEMA' AND cmd = 'SELECT' AND policyname ~ '_publishable\$';")"
  PUB_TABLE_CNT="${PUB_TABLE_CNT:-0}"
  if [ "$PUB_TABLE_CNT" -ge 1 ] 2>/dev/null; then
    # Count tables that are NOT yet anon-readable (missing the anon SELECT grant OR the policy
    # role) — drives whether we apply + whether this counts as a CHANGE.
    PUB_TODO="$(hub_q "SELECT count(*) FROM pg_policies p WHERE p.schemaname = '$APP_SCHEMA' AND p.cmd = 'SELECT' AND p.policyname ~ '_publishable\$' AND ( NOT ('anonymous' = ANY (p.roles)) OR NOT EXISTS ( SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema = p.schemaname AND g.table_name = p.tablename AND g.grantee = 'anonymous' AND g.privilege_type = 'SELECT' ) );")"
    PUB_TODO="${PUB_TODO:-0}"
    if [ "$PUB_TODO" -lt 1 ] 2>/dev/null; then
      pass "public-read already enabled: ${PUB_TABLE_CNT} AuthzPublishable table(s) in $APP_SCHEMA readable by anonymous — no change"
    else
      warn "public-read incomplete: ${PUB_TODO} of ${PUB_TABLE_CNT} AuthzPublishable table(s) in $APP_SCHEMA not yet anon-readable — applying anonymous SELECT + policy role"
      if [ "$DRY_RUN" = "1" ]; then
        info "DRY-RUN would: GRANT USAGE ON SCHEMA \"$APP_SCHEMA\" TO anonymous; for each publishable table GRANT SELECT TO anonymous + ALTER POLICY <name> ... TO authenticated, anonymous (published rows only)"
      else
        # GUC carries the schema into the DO block (same interpolation model as the self_update
        # step). The loop discovers each publishable table + extends grant/policy idempotently.
        if psql -d "$HUBDB" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
SET fixgrants.app_schema = '$APP_SCHEMA';
DO \$\$
DECLARE
  v_schema text := current_setting('fixgrants.app_schema');
  r record;
  v_roles text;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anonymous', v_schema);
  FOR r IN
    SELECT p.tablename, p.policyname, p.roles
    FROM pg_policies p
    WHERE p.schemaname = v_schema AND p.cmd = 'SELECT' AND p.policyname ~ '_publishable\$'
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO anonymous', v_schema, r.tablename);
    IF NOT ('anonymous' = ANY (r.roles)) THEN
      v_roles := array_to_string(
        (SELECT array_agg(quote_ident(x)) FROM unnest(r.roles || ARRAY['anonymous']) AS x),
        ', '
      );
      EXECUTE format('ALTER POLICY %I ON %I.%I TO %s', r.policyname, v_schema, r.tablename, v_roles);
    END IF;
  END LOOP;
END
\$\$;
SQL
        then
          PUB_TODO="$(hub_q "SELECT count(*) FROM pg_policies p WHERE p.schemaname = '$APP_SCHEMA' AND p.cmd = 'SELECT' AND p.policyname ~ '_publishable\$' AND ( NOT ('anonymous' = ANY (p.roles)) OR NOT EXISTS ( SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema = p.schemaname AND g.table_name = p.tablename AND g.grantee = 'anonymous' AND g.privilege_type = 'SELECT' ) );")"
          if [ "${PUB_TODO:-0}" -lt 1 ] 2>/dev/null; then
            CHANGED=1
            pass "public-read enabled: ${PUB_TABLE_CNT} AuthzPublishable table(s) in $APP_SCHEMA now readable by anonymous (published rows only)"
          else
            fail "public-read step ran but ${PUB_TODO} table(s) still not anon-readable in $APP_SCHEMA" \
              "check the anonymous role exists and you have privileges to GRANT/ALTER POLICY on $APP_SCHEMA (re-run provision; the durable fix is upstream — AuthzPublishable should grant anonymous)."
          fi
        else
          fail "could not enable public-read (anonymous SELECT) on $APP_SCHEMA publishable tables" \
            "confirm the 'anonymous' role exists and you have privileges to GRANT + ALTER POLICY on $APP_SCHEMA."
        fi
      fi
    fi
  else
    info "no AuthzPublishable (public-read) tables in $APP_SCHEMA — anonymous read step is a no-op (not a public-read app)"
  fi
fi

echo "------------------------------------------------------------"

# ── 5. stamp run-state database.grant_source = manual-fallback (only if we changed) ─
# The Phase 2.2 gate reads this STRUCTURED field (not prose). 'manual-fallback' is the
# documented value for the S2-step-3 reconcile; 'sdk' is the default blueprint path. We
# only set it when this script actually applied something (a pure verify is still 'sdk').
#
# We stamp the PER-APP file (STATE_PATH resolved to build/<app-id>/run-state.json when an
# app-id is resolvable — NEVER the legacy singleton; that is the STATE-ISOLATION guarantee).
# If that per-app file doesn't exist yet (fix-grants backstops grants right after provision,
# before the run-state checkpoint is written), we CREATE its dir + a minimal state carrying
# the db name — so the producer persists isolated state instead of either no-op'ing to a
# "set it by hand" warning or, worse, polluting the legacy singleton. The downstream gate /
# live-qa then read THIS app's grant_source, not a sibling's.
if [ "$CHANGED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
  if [ -n "$STATE_PATH" ]; then
    # Ensure the parent dir exists (per-app build/<app-id>/ may be new).
    mkdir -p "$(dirname "$STATE_PATH")" 2>/dev/null || true
    if node - "$STATE_PATH" "$DB_NAME" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
const dbName = process.argv[3] || '';
try {
  // Read the existing per-app state, or start a minimal one (file may not exist yet).
  let s = {};
  try { s = JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { s = {}; }
  s.database = s.database || {};
  // Seed the db name on a fresh file so the stamp is self-describing (matches the gate's shape).
  if (!s.database.name && dbName) s.database.name = dbName;
  s.database.grant_source = 'manual-fallback';
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
NODE
    then
      info "run-state: set database.grant_source = manual-fallback ($STATE_PATH)"
    else
      warn "could not update $STATE_PATH — set database.grant_source = 'manual-fallback' by hand (the Phase 2.2 gate reads that field)"
    fi
  else
    warn "no run-state path resolved — when you have one, set database.grant_source = 'manual-fallback' (the documented value for this S2-step-3 reconcile)"
  fi
elif [ "$CHANGED" != "1" ]; then
  info "nothing to reconcile (grants + policy already present) — leaving grant_source unchanged (default 'sdk')"
fi

echo "------------------------------------------------------------"
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY-RUN complete — no changes applied. Re-run without --dry-run to reconcile."
  exit 0
fi
pass "grants + users self_update reconciled for '$DB_NAME' — matches the Phase 2.2 gate's assertions"
exit 0
