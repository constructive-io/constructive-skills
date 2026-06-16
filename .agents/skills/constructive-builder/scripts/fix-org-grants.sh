#!/bin/bash
set -euo pipefail

# fix-org-grants.sh — the B2B (org) counterpart to fix-grants.sh. Idempotently reconcile
# the per-DB org/membership state a FRESH email-password signup needs before it can create
# an org-scoped row (e.g. createCompany with entity_id = the user's personal org id).
#
# WHY THIS EXISTS — upstream provisioner gap (PLATFORM-GAPS.md GAP-1b / GAP-1c):
#   On the b2b tier, a fresh signup gets a `users` row (type=1) and a personal-org
#   `org_memberships` row (actor_id = entity_id = user_id, is_owner=true), but:
#     • `app_memberships_sprt` is EMPTY for that actor, so the AFTER-INSERT trigger on
#       org_memberships (`org_memberships_insert_sprt_tg`, which only fires its sprt INSERT
#       when `has_active_parent` — i.e. an app_memberships_sprt row — exists) SKIPS creating
#       the personal-org row in the PRIVATE `org_memberships_sprt`; and
#     • every AuthzEntityMembership table's RLS (companies, contacts, …) checks membership by
#         entity_id IN (SELECT entity_id FROM <db>-memberships-private.org_memberships_sprt
#                       WHERE actor_id = jwt_public.current_user_id())
#       so with org_memberships_sprt empty, the INSERT is RLS-rejected
#       ("new row violates row-level security policy"); and
#     • org creation / member writes also gate on the `create_entity` app-permission bit
#       (bit 5 = 0x20 = decimal 32) which the default provision never grants.
#   This is the documented org analogue of RLS-USERS-UPDATE-001 — see gotchas
#   RLS-ORG-RECONCILE-001 and skill-supplements.md "Org-flow extension".
#
# WHAT IT APPLIES (idempotently), per actor:
#   (a) create_entity bit — set the create_entity permission bit on the actor's
#       org_memberships rows (public) so org-create / member writes are permitted.
#   (b) org-table grants — GRANT INSERT/UPDATE on org_memberships and SELECT on
#       org_member_profiles to `authenticated` (the dynamic provisioner ships SELECT/DELETE
#       on org_memberships but omits INSERT/UPDATE; org_member_profiles gets nothing). The
#       entity-membership RLS POLICIES on these tables already exist from provision; we only
#       backfill the missing GRANTs so members-list / role-change / profile reads round-trip.
#   (c) the personal-org SPRT row — the missing row the RLS reads: INSERT into the private
#       org_memberships_sprt (actor_id = entity_id = user_id, is_owner=true,
#       permissions = create_entity) AND into app_memberships_sprt (so the trigger's
#       has_active_parent check passes for any FUTURE org_memberships insert too). Both
#       SPRT tables have RLS disabled and a UNIQUE (actor_id, entity_id) / (actor_id) index,
#       so the inserts are ON CONFLICT … DO UPDATE (idempotent).
#
# This is a HARNESS-SIDE WORKAROUND for an upstream gap (the durable fix is the dynamic
# per-tenant provisioner emitting these grants/policies + seeding the personal-org sprt row
# itself — see PLATFORM-GAPS.md "The durable fix"). It is consume-only w.r.t.
# constructive/constructive-db; it writes ONLY this tenant's own module schemas in the hub db.
#
# Schema resolution — DETERMINISTIC by the LIVE tenant's DATABASE_ID, name-match only as
# a manual fallback. scaffold create-db mints a NEW hash-suffixed tenant schema EACH run
# (e.g. <db>-aaa6abf5-memberships-public, then <db>-7f3c…-… next run), so a SHARED hub can
# hold SEVERAL tenants with the SAME db-name. A pure name-sort first-match
# (ORDER BY length,name LIMIT 1) is NON-deterministic across those siblings and can grant a
# STALE tenant while the running app uses a newer one. So we resolve in two tiers:
#   (1) PREFERRED — by DATABASE_ID (the UUID the provisioner wrote to the app's .env, =
#       metaschema_public.database.id). When known, every per-DB schema is looked up via
#         SELECT schema_name FROM metaschema_public.schema
#          WHERE database_id = <DATABASE_ID> AND name = '<logical>'   -- e.g. memberships_public
#       which yields the EXACT physical schema of the LIVE tenant — never a sibling. The id is
#       taken from (highest precedence first): --database-id, then --app-dir's .env
#       (DATABASE_ID), then the $DATABASE_ID env var. We also assert the id's db NAME matches
#       <db-name> so we never silently reconcile a different-suffix tenant than the running app.
#   (2) FALLBACK — name-match (the legacy by-name manual path, unchanged) when NO id is
#       available. ANCHORED on this tenant's db-name prefix and tolerant of BOTH per-DB naming
#       conventions (the SAME resolution fix-grants.sh / verify-phase.sh use) so it can never
#       bleed onto a sibling whose name merely CONTAINS this db (gotchas SUBDOMAIN-001):
#         OLD dash+hash:  <db>-<hash>-memberships-public / -memberships-private  (fv4-*/cocrm era)
#         NEW underscore: <db>_memberships_public        / _memberships_private  (goldenapp_*/fv5_*+)
#         DB_LIKE = the db name with its own '-'/'_' turned into '%', anchored at the START.
#       (When MULTIPLE same-name siblings exist this tier is best-effort first-match — pass a
#        DATABASE_ID / --app-dir to make it deterministic.)
#
# It connects to the HUB db `constructive` (NOT $PGDATABASE — `pgpm env` sets
# PGDATABASE=postgres, where the app schemas do NOT live).
#
# Usage:
#   ./scripts/fix-org-grants.sh <db-name> [--database-id UUID] [--app-dir DIR] \
#       [--user UUID] [--state PATH] [--dry-run]
#     <db-name>     the app database name (e.g. cocrm). Required (positional).
#     --database-id UUID  the LIVE tenant's DATABASE_ID (metaschema_public.database.id, the
#                   UUID the provisioner wrote to the app's .env). When given, schemas are
#                   resolved DETERMINISTICALLY for THIS tenant (never a same-name sibling).
#                   Highest precedence; overrides --app-dir and $DATABASE_ID.
#     --app-dir DIR  the scaffolded app's root dir. Reads DATABASE_ID from <DIR>/.env
#                   (then <DIR>/packages/app/.env, then <DIR>/packages/provision/.env) to get
#                   the live tenant id — use this instead of --database-id to point at an app.
#     --user UUID   reconcile ONLY this actor (a freshly signed-up user id). Repeatable.
#                   Default (omitted): reconcile ALL users in the tenant `users` table
#                   (every authenticated actor), so the speedrun's signup actor is covered.
#     --state PATH  run-state.json to stamp (default: build/run-state.json if present)
#     --dry-run     resolve + report what it would apply; change nothing
#
# Env:
#   DATABASE_ID       the LIVE tenant's id (lowest-precedence source for the id path; an
#                     explicit --database-id / --app-dir wins over it).
#   PG_HUB_DATABASE   hub db to connect to (default: constructive)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD   standard libpq (run `eval "$(pgpm env)"` first)
#
# Exit: 0 = the personal-org sprt row + grants + create_entity bit are present (already, or
#           after a successful reconcile) for the targeted actor(s) ·
#       non-zero = could not resolve the schemas, or a reconcile failed.

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
DRY_RUN=0
USER_IDS=()
DATABASE_ID_ARG=""   # --database-id (highest precedence id source)
APP_DIR=""           # --app-dir (read DATABASE_ID from its .env)
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-id) DATABASE_ID_ARG="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --user) USER_IDS+=("$2"); shift 2 ;;
    --state) STATE_PATH="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '3,84p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fail "Unknown option: $1" "see ./scripts/fix-org-grants.sh --help" ;;
    *)
      if [ -z "$DB_NAME" ]; then DB_NAME="$1"; else fail "Unexpected argument: $1"; fi
      shift
      ;;
  esac
done

[ -n "$DB_NAME" ] || fail "missing required <db-name>" \
  "usage: ./scripts/fix-org-grants.sh <db-name>   (e.g. ./scripts/fix-org-grants.sh cocrm)"

if [ -z "$STATE_PATH" ] && [ -f "$REPO_ROOT/build/run-state.json" ]; then
  STATE_PATH="$REPO_ROOT/build/run-state.json"
fi

HUBDB="${PG_HUB_DATABASE:-constructive}"

command -v psql >/dev/null 2>&1 || fail "psql not found on PATH" \
  "install the Postgres client and run: eval \"\$(pgpm env)\" (sets PGHOST/PGPORT/PGUSER/PGPASSWORD)"

# Single-value psql helper against the hub db (trimmed).
hub_q() { psql -d "$HUBDB" -t -A -c "$1" 2>/dev/null | head -n1 | tr -d '[:space:]'; }

echo
echo -e "${GREEN}fix-org-grants — reconcile the b2b personal-org sprt row + org grants + create_entity${NC}"
echo "------------------------------------------------------------"
info "db-name : $DB_NAME"
info "hub db  : $HUBDB  (app schemas live here, NOT in PGDATABASE)"
[ "$DRY_RUN" = "1" ] && warn "DRY-RUN: will resolve + report only; no changes will be applied"

# ── 0. hub reachable + db exists ────────────────────────────────────────────
psql -d "$HUBDB" -c "SELECT 1" >/dev/null 2>&1 || fail "cannot connect to hub db '$HUBDB'" \
  "run \`eval \"\$(pgpm env)\"\` so PGHOST/PGPORT/PGUSER/PGPASSWORD are set, and ensure the hub Postgres is up"

DB_EXISTS="$(hub_q "SELECT 1 FROM metaschema_public.database WHERE name = '$DB_NAME' LIMIT 1;")"
[ "$DB_EXISTS" = "1" ] || fail "database '$DB_NAME' not found in metaschema_public.database" \
  "provision it first (SKILL.md S2: create-db + provision with the b2b preset); fix-org-grants reconciles an EXISTING org app, it does not create the db"

# ── 1. resolve the LIVE tenant DATABASE_ID (deterministic schema resolution) ───────────────
# scaffold create-db mints a NEW hash-suffixed tenant EACH run, so a shared hub can hold
# several same-name siblings. The DATABASE_ID (= metaschema_public.database.id) pins the EXACT
# live tenant. Precedence (highest first): --database-id > --app-dir's .env > $DATABASE_ID env.
# When none is available we fall back to the legacy anchored name-match (best-effort first
# match for the by-name manual path).
read_env_db_id() {  # $1 = .env path -> echoes the DATABASE_ID value (last wins), or nothing
  local f="$1" line val
  [ -f "$f" ] || return 0
  # tolerate `DATABASE_ID=...`, `export DATABASE_ID=...`, surrounding quotes, trailing CR.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      DATABASE_ID=*|export\ DATABASE_ID=*)
        val="${line#*DATABASE_ID=}"
        val="${val%$'\r'}"
        val="${val#\"}"; val="${val%\"}"
        val="${val#\'}"; val="${val%\'}"
        [ -n "$val" ] && printf '%s\n' "$val"
        ;;
    esac
  done < "$f"
}

# Capture the inherited env value BEFORE we (re)assign DATABASE_ID, so it stays usable as the
# lowest-precedence source (an explicit --database-id / --app-dir still wins over it).
DATABASE_ID_ENV="${DATABASE_ID:-}"
DATABASE_ID=""
DATABASE_ID_SRC=""
if [ -n "$DATABASE_ID_ARG" ]; then
  DATABASE_ID="$DATABASE_ID_ARG"; DATABASE_ID_SRC="--database-id"
elif [ -n "$APP_DIR" ]; then
  [ -d "$APP_DIR" ] || fail "--app-dir '$APP_DIR' is not a directory" \
    "pass the scaffolded app's ROOT dir (the one whose .env the provisioner wrote DATABASE_ID into)."
  for envf in "$APP_DIR/.env" "$APP_DIR/packages/app/.env" "$APP_DIR/packages/provision/.env"; do
    _id="$(read_env_db_id "$envf" | tail -n1)"
    if [ -n "$_id" ]; then DATABASE_ID="$_id"; DATABASE_ID_SRC="$envf"; break; fi
  done
  [ -n "$DATABASE_ID" ] || warn "no DATABASE_ID found under --app-dir '$APP_DIR' (.env / packages/app/.env / packages/provision/.env) — falling back to name-match (run create-db first to make this deterministic)"
elif [ -n "$DATABASE_ID_ENV" ]; then
  DATABASE_ID="$DATABASE_ID_ENV"; DATABASE_ID_SRC="\$DATABASE_ID env"
fi

if [ -n "$DATABASE_ID" ]; then
  # Assert the id maps to THIS db-name so we never reconcile a different-suffix tenant than the
  # running app names (a transposed id from another app fails LOUD instead of granting a stranger).
  ID_DB_NAME="$(hub_q "SELECT name FROM metaschema_public.database WHERE id = '$DATABASE_ID' LIMIT 1;")"
  [ -n "$ID_DB_NAME" ] || fail "DATABASE_ID '$DATABASE_ID' (from $DATABASE_ID_SRC) is not a database in metaschema_public.database" \
    "use the id the provisioner wrote to the app's .env, or drop --database-id/--app-dir to resolve by name."
  [ "$ID_DB_NAME" = "$DB_NAME" ] || fail "DATABASE_ID '$DATABASE_ID' (from $DATABASE_ID_SRC) belongs to db '$ID_DB_NAME', not '$DB_NAME'" \
    "the id and the <db-name> positional disagree — pass the matching pair (refusing to reconcile a different-suffix tenant than the running app)."
  info "DATABASE_ID : $DATABASE_ID  (from $DATABASE_ID_SRC) — DETERMINISTIC schema resolution"
else
  info "DATABASE_ID : (none) — falling back to name-match (pass --database-id/--app-dir to pin the live tenant)"
fi

# ── 1b. resolve this tenant's per-DB schemas ───────────────────────────────────────────────
# id path: SELECT schema_name FROM metaschema_public.schema WHERE database_id=<id> AND name=<logical>
#   — the EXACT physical schema of the live tenant, never a same-name sibling.
# name path (fallback): anchored, separator-tolerant LIKE (gate-identical; SUBDOMAIN-001 safe).
#   DB_LIKE = the db-name prefix with its own '-'/'_' turned into '%' (anchored at the START,
#   no leading %, so a sibling tenant whose name merely CONTAINS this db can never match).
DB_LIKE="$(hub_q "SELECT replace(replace('$DB_NAME', '_', '%'), '-', '%');")"
[ -n "$DB_LIKE" ] || DB_LIKE="$DB_NAME"

# Resolve one logical schema for the live tenant. $1 = logical name (metaschema_public.schema.name).
# Deterministic via DATABASE_ID when known; empty if unresolved (caller fails with context).
resolve_schema() {  # $1 = logical schema name (e.g. memberships_public)
  local logical="$1"
  if [ -n "$DATABASE_ID" ]; then
    hub_q "SELECT schema_name FROM metaschema_public.schema WHERE database_id = '$DATABASE_ID' AND name = '$logical' LIMIT 1;"
  fi
}

# memberships-PUBLIC (org_memberships / org_member_profiles live here).
MEMBERSHIP_SCHEMA="$(resolve_schema 'memberships_public')"
[ -n "$MEMBERSHIP_SCHEMA" ] || MEMBERSHIP_SCHEMA="$(hub_q "SELECT table_schema FROM information_schema.tables WHERE table_name = 'org_memberships' AND table_schema LIKE '${DB_LIKE}%memberships%public' ORDER BY length(table_schema), table_schema LIMIT 1;")"
[ -n "$MEMBERSHIP_SCHEMA" ] || fail "could not resolve the memberships-PUBLIC schema for '$DB_NAME' (id '${DATABASE_ID:-none}' / anchored '${DB_LIKE}%memberships%public', table org_memberships)" \
  "this is a b2b/org app reconcile — the db must be provisioned with the b2b (org) preset so org_memberships exists. If you only have auth:email (no org modules), use fix-grants.sh instead (gotchas RLS-ORG-RECONCILE-001 / RLS-POLICY-001)."

# memberships-PRIVATE (the SPRT tables the RLS actually reads).
MEMBERSHIP_PRIV_SCHEMA="$(resolve_schema 'memberships_private')"
[ -n "$MEMBERSHIP_PRIV_SCHEMA" ] || MEMBERSHIP_PRIV_SCHEMA="$(hub_q "SELECT table_schema FROM information_schema.tables WHERE table_name = 'org_memberships_sprt' AND table_schema LIKE '${DB_LIKE}%memberships%private' ORDER BY length(table_schema), table_schema LIMIT 1;")"
[ -n "$MEMBERSHIP_PRIV_SCHEMA" ] || fail "could not resolve the memberships-PRIVATE schema for '$DB_NAME' (id '${DATABASE_ID:-none}' / anchored '${DB_LIKE}%memberships%private', table org_memberships_sprt)" \
  "the org SPRT tables aren't provisioned — re-run create-db + provision with the b2b preset (SKILL.md S2)."

# users-PUBLIC (the actor source) and permissions-PUBLIC (create_entity bit lookup).
USERS_SCHEMA="$(resolve_schema 'users_public')"
[ -n "$USERS_SCHEMA" ] || USERS_SCHEMA="$(hub_q "SELECT table_schema FROM information_schema.tables WHERE table_name = 'users' AND table_schema LIKE '${DB_LIKE}%users%public' ORDER BY length(table_schema), table_schema LIMIT 1;")"
[ -n "$USERS_SCHEMA" ] || fail "could not resolve the users-PUBLIC schema for '$DB_NAME' (id '${DATABASE_ID:-none}' / anchored '${DB_LIKE}%users%public')" \
  "provision didn't create the users schema — re-run create-db + provision (SKILL.md S2)."

PERMISSIONS_SCHEMA="$(resolve_schema 'permissions_public')"
[ -n "$PERMISSIONS_SCHEMA" ] || PERMISSIONS_SCHEMA="$(hub_q "SELECT table_schema FROM information_schema.tables WHERE table_name = 'app_permissions' AND table_schema LIKE '${DB_LIKE}%permissions%public' ORDER BY length(table_schema), table_schema LIMIT 1;")"
[ -n "$PERMISSIONS_SCHEMA" ] || fail "could not resolve the permissions-PUBLIC schema for '$DB_NAME' (id '${DATABASE_ID:-none}' / anchored '${DB_LIKE}%permissions%public')" \
  "provision didn't create the permissions schema — re-run create-db + provision with the b2b preset (SKILL.md S2)."

# Resolve the create_entity bit(64) literal from app_permissions (by NAME, never hard-coded —
# the bit position is platform-owned). bit 5 = 0x20 = decimal 32 (gotchas RLS-ORG-RECONCILE-001).
CREATE_ENTITY_BIT="$(hub_q "SELECT bitstr::text FROM \"$PERMISSIONS_SCHEMA\".app_permissions WHERE name = 'create_entity' LIMIT 1;")"
[ -n "$CREATE_ENTITY_BIT" ] || fail "could not resolve the create_entity permission bit in $PERMISSIONS_SCHEMA.app_permissions" \
  "this app's permissions don't define create_entity — confirm it was provisioned with the b2b preset (gotchas RLS-ORG-RECONCILE-001)."

if [ -n "$DATABASE_ID" ]; then
  pass "resolved memberships-public  : $MEMBERSHIP_SCHEMA  (by DATABASE_ID — deterministic, live tenant)"
else
  pass "resolved memberships-public  : $MEMBERSHIP_SCHEMA  (by name-match — pass --database-id/--app-dir to pin)"
fi
info "memberships-private : $MEMBERSHIP_PRIV_SCHEMA"
info "users-public        : $USERS_SCHEMA"
info "permissions-public  : $PERMISSIONS_SCHEMA"
info "create_entity bit   : ...${CREATE_ENTITY_BIT: -8} (bit 5 / 0x20)"
echo "------------------------------------------------------------"

# Track whether we changed anything (drives stamping + final summary).
CHANGED=0

# ── 2. step (b): org-table GRANTs to `authenticated` (idempotent, USER-INDEPENDENT) ───────────
# CRITICAL ORDERING (GAP-1): these are ROLE-level grants on the tenant's OWN org tables — they do
# NOT depend on any user existing. They MUST run UNCONDITIONALLY for ANY b2b db, INCLUDING at
# Phase 2 right after provision when the tenant `users` table is still EMPTY (no app signup yet).
# The per-actor personal-org sprt seeding below IS user-dependent and is skipped (not failed) when
# there are no users — but the grants are the part verify-phase 2.3 asserts even with zero actors
# ("Org tier with no signed-up actor yet — grants + create_entity bit asserted"). So we apply the
# grants FIRST, before resolving actors, and never gate them behind "has users".
# org_memberships: dynamic provisioner ships SELECT/DELETE but omits INSERT/UPDATE.
# org_member_profiles: gets no grants at all. The entity-membership RLS policies already
# exist; we only backfill the missing GRANTs (the policy is what scopes the rows).
GM_PRIVS="$(hub_q "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_SCHEMA' AND table_name = 'org_memberships' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');")"
OMP_SEL="$(hub_q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_SCHEMA' AND table_name = 'org_member_profiles' AND grantee = 'authenticated' AND privilege_type = 'SELECT';")"
if [ "${GM_PRIVS:-0}" -ge 4 ] 2>/dev/null && [ "${OMP_SEL:-0}" -ge 1 ] 2>/dev/null; then
  pass "org-table grants already present (org_memberships ${GM_PRIVS}/4, org_member_profiles SELECT ✓) — no GRANT needed"
else
  warn "org-table grants incomplete (org_memberships ${GM_PRIVS:-0}/4, org_member_profiles SELECT=${OMP_SEL:-0}) — applying"
  if [ "$DRY_RUN" = "1" ]; then
    info "DRY-RUN would run: GRANT USAGE ON SCHEMA \"$MEMBERSHIP_SCHEMA\" TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON \"$MEMBERSHIP_SCHEMA\".org_memberships TO authenticated; GRANT SELECT ON \"$MEMBERSHIP_SCHEMA\".org_member_profiles TO authenticated;"
  else
    if psql -d "$HUBDB" -v ON_ERROR_STOP=1 \
        -c "GRANT USAGE ON SCHEMA \"$MEMBERSHIP_SCHEMA\" TO authenticated;" \
        -c "GRANT SELECT, INSERT, UPDATE, DELETE ON \"$MEMBERSHIP_SCHEMA\".org_memberships TO authenticated;" \
        -c "GRANT SELECT ON \"$MEMBERSHIP_SCHEMA\".org_member_profiles TO authenticated;" \
        >/dev/null 2>&1; then
      GM_PRIVS="$(hub_q "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_SCHEMA' AND table_name = 'org_memberships' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');")"
      OMP_SEL="$(hub_q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_SCHEMA' AND table_name = 'org_member_profiles' AND grantee = 'authenticated' AND privilege_type = 'SELECT';")"
      if [ "${GM_PRIVS:-0}" -ge 4 ] 2>/dev/null && [ "${OMP_SEL:-0}" -ge 1 ] 2>/dev/null; then
        CHANGED=1
        pass "granted org_memberships SELECT/INSERT/UPDATE/DELETE + org_member_profiles SELECT to 'authenticated'"
      else
        fail "GRANT ran but org grants still incomplete (org_memberships ${GM_PRIVS:-0}/4, org_member_profiles SELECT=${OMP_SEL:-0})" \
          "check the schema has these tables (provision incomplete?) or a default-privileges/ownership issue. Re-run provision (SKILL.md S2)."
      fi
    else
      fail "GRANT on org tables in $MEMBERSHIP_SCHEMA failed" \
        "you may lack privileges on the hub. Confirm \`eval \"\$(pgpm env)\"\` set a superuser/owner role."
    fi
  fi
fi
echo "------------------------------------------------------------"

# ── 3. resolve the target actor id(s) — USER-DEPENDENT (skips cleanly when empty) ─────────────
# --user UUID (repeatable) restricts to specific actors; default = ALL users in the tenant.
# GAP-1: zero users is the NORMAL Phase-2 state (fresh b2b db, no app signup yet). The role-level
# grants above already landed unconditionally; the per-actor personal-org sprt seeding below is the
# only user-dependent piece, so an empty `users` table is NOT a failure here — we record it and skip
# the loop (verify-phase 2.3 tolerates the no-actor case identically: it asserts the grants + the
# create_entity bit and defers the sprt seed to first signup). An EXPLICIT --user whose id matches
# nobody stays a hard fail (operator passed a wrong id) — that is operator error, not the hands-free
# Phase-2 path.
TARGET_ACTORS=()
NO_ACTORS_OK=0   # 1 = default path found zero users (skip per-actor seeding, exit 0 on grants alone)
if [ "${#USER_IDS[@]}" -gt 0 ]; then
  for u in "${USER_IDS[@]}"; do
    EXISTS="$(hub_q "SELECT 1 FROM \"$USERS_SCHEMA\".users WHERE id = '$u' LIMIT 1;")"
    if [ "$EXISTS" = "1" ]; then
      TARGET_ACTORS+=("$u")
    else
      warn "--user $u is not a user in $USERS_SCHEMA.users — skipping (sign that user up via auth-<sub> first)"
    fi
  done
  [ "${#TARGET_ACTORS[@]}" -gt 0 ] || fail "none of the passed --user ids exist in $USERS_SCHEMA.users" \
    "sign the actor up via the tenant auth endpoint (auth-<sub>.localhost) before reconciling its org membership."
  info "target actors: ${#TARGET_ACTORS[@]} (explicit --user)"
else
  # All authenticated users (the personal-org owner is the user themselves: actor=entity=id).
  while IFS= read -r line; do
    [ -n "$line" ] && TARGET_ACTORS+=("$line")
  done < <(psql -d "$HUBDB" -t -A -c "SELECT id FROM \"$USERS_SCHEMA\".users ORDER BY created_at;" 2>/dev/null)
  if [ "${#TARGET_ACTORS[@]}" -gt 0 ]; then
    info "target actors: ${#TARGET_ACTORS[@]} (all users in $USERS_SCHEMA.users)"
  else
    NO_ACTORS_OK=1
    info "no users in $USERS_SCHEMA.users yet — org GRANTs applied above; per-actor personal-org sprt seed deferred to first signup (re-run after signup, or it runs inline in provision.ts on the next signup). verify-phase 2.3 tolerates this no-actor case."
  fi
fi
echo "------------------------------------------------------------"

# ── 4. steps (a)+(c) per actor: create_entity bit + the personal-org SPRT rows ──
# This is the core fix. For each actor we ensure, idempotently:
#   • app_memberships_sprt(actor_id)                       — so the org_memberships AFTER-INSERT
#       trigger's has_active_parent check passes for any FUTURE insert (and app-level RLS works).
#   • org_memberships_sprt(actor_id=entity_id, is_owner=true, permissions=create_entity)
#       — the personal-org row the AuthzEntityMembership RLS on companies/contacts/… reads.
#   • org_memberships(public).permissions |= create_entity for the personal-org row (visibility +
#       consistency with the sprt; the membership-write policies read the sprt copy).
# Both SPRT tables have a UNIQUE index, so we ON CONFLICT … DO UPDATE (idempotent re-runs).
# Skipped wholesale when there are no actors yet (NO_ACTORS_OK): the loop simply doesn't run.
# NB: expand the array with a `+`-default so an EMPTY TARGET_ACTORS is safe under `set -u`
# (a bare "${TARGET_ACTORS[@]}" on an empty array is an "unbound variable" error in strict mode).
RECONCILED=0
ALREADY=0
for ACTOR in ${TARGET_ACTORS[@]+"${TARGET_ACTORS[@]}"}; do
  HAS_ORG_SPRT="$(hub_q "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = '$ACTOR' AND entity_id = '$ACTOR';")"
  HAS_BIT="$(hub_q "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = '$ACTOR' AND entity_id = '$ACTOR' AND (permissions & '${CREATE_ENTITY_BIT}'::bit(64)) = '${CREATE_ENTITY_BIT}'::bit(64);")"
  if [ "${HAS_ORG_SPRT:-0}" -ge 1 ] 2>/dev/null && [ "${HAS_BIT:-0}" -ge 1 ] 2>/dev/null; then
    ALREADY=$((ALREADY + 1))
    continue
  fi
  if [ "$DRY_RUN" = "1" ]; then
    info "DRY-RUN would reconcile actor $ACTOR: upsert app_memberships_sprt + org_memberships_sprt (is_owner, create_entity bit) and set org_memberships.permissions"
    continue
  fi
  # All three upserts in one statement-stream; ON_ERROR_STOP so a partial failure is loud.
  if psql -d "$HUBDB" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
-- (c1) app-membership sprt parent (lets the org trigger's has_active_parent pass; app RLS).
INSERT INTO "$MEMBERSHIP_PRIV_SCHEMA".app_memberships_sprt (is_owner, is_admin, permissions, actor_id)
VALUES (true, true, '${CREATE_ENTITY_BIT}'::bit(64), '$ACTOR')
ON CONFLICT (actor_id) DO UPDATE
  SET permissions = "$MEMBERSHIP_PRIV_SCHEMA".app_memberships_sprt.permissions | '${CREATE_ENTITY_BIT}'::bit(64),
      is_owner = true, is_admin = true;

-- (c2) the personal-org sprt row the AuthzEntityMembership RLS reads (actor = entity = self).
INSERT INTO "$MEMBERSHIP_PRIV_SCHEMA".org_memberships_sprt (is_owner, is_admin, permissions, actor_id, entity_id, is_read_only)
VALUES (true, true, '${CREATE_ENTITY_BIT}'::bit(64), '$ACTOR', '$ACTOR', false)
ON CONFLICT (actor_id, entity_id) DO UPDATE
  SET permissions = "$MEMBERSHIP_PRIV_SCHEMA".org_memberships_sprt.permissions | '${CREATE_ENTITY_BIT}'::bit(64),
      is_owner = true, is_admin = true, is_read_only = false;

-- (a) mirror the create_entity bit onto the PUBLIC personal-org membership row (visibility +
--     consistency). granted tracks which bits are conferred; permissions is the effective set.
UPDATE "$MEMBERSHIP_SCHEMA".org_memberships
  SET permissions = permissions | '${CREATE_ENTITY_BIT}'::bit(64),
      granted     = granted     | '${CREATE_ENTITY_BIT}'::bit(64)
  WHERE actor_id = '$ACTOR' AND entity_id = '$ACTOR';
SQL
  then
    # Re-verify the OUTCOME the RLS depends on.
    HAS_ORG_SPRT="$(hub_q "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = '$ACTOR' AND entity_id = '$ACTOR' AND (permissions & '${CREATE_ENTITY_BIT}'::bit(64)) = '${CREATE_ENTITY_BIT}'::bit(64);")"
    if [ "${HAS_ORG_SPRT:-0}" -ge 1 ] 2>/dev/null; then
      RECONCILED=$((RECONCILED + 1))
      CHANGED=1
    else
      fail "reconcile ran for actor $ACTOR but no matching org_memberships_sprt row is present" \
        "check the SPRT table structure / that jwt_public.current_user_id() and the create_entity bit resolved (gotchas RLS-ORG-RECONCILE-001)."
    fi
  else
    fail "could not reconcile the personal-org sprt row for actor $ACTOR" \
      "confirm you have privileges on $MEMBERSHIP_PRIV_SCHEMA and that the SPRT tables exist (re-run provision; gotchas RLS-ORG-RECONCILE-001)."
  fi
done

if [ "$DRY_RUN" != "1" ]; then
  if [ "$NO_ACTORS_OK" = "1" ]; then
    pass "personal-org sprt seeding deferred: 0 actors yet (org GRANTs applied; seed runs per-actor on first signup)"
  else
    pass "personal-org sprt rows reconciled: ${RECONCILED} new, ${ALREADY} already present (of ${#TARGET_ACTORS[@]} actors)"
  fi
fi
echo "------------------------------------------------------------"

# ── 5. stamp run-state database.org_reconcile = manual-fallback (only if we changed) ─
# Mirrors fix-grants.sh's grant_source convention: the Phase 2.2 gate / provenance note reads
# a STRUCTURED field, not prose. We only set it when this script actually applied something.
if [ "$CHANGED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
  if [ -n "$STATE_PATH" ] && [ -f "$STATE_PATH" ]; then
    if node - "$STATE_PATH" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
try {
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s.database = s.database || {};
  s.database.org_reconcile = 'manual-fallback';
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
NODE
    then
      info "run-state: set database.org_reconcile = manual-fallback ($STATE_PATH)"
    else
      warn "could not update $STATE_PATH — set database.org_reconcile = 'manual-fallback' by hand"
    fi
  else
    warn "no run-state.json found — when you have one, set database.org_reconcile = 'manual-fallback'"
  fi
elif [ "$CHANGED" != "1" ]; then
  if [ "$NO_ACTORS_OK" = "1" ]; then
    info "org grants already present + no actors yet — nothing changed (personal-org sprt seed runs per-actor on first signup)"
  else
    info "nothing to reconcile (org grants + create_entity bit + personal-org sprt rows already present)"
  fi
fi

# (5b) ALSO stamp a POSITIVE org_reconcile='sdk' when the org grants were ALREADY present (the
# inline-provision path: section 5 above changed nothing, so it did not stamp). Without this the
# run-state has no org_reconcile → live-qa's b2b post-signup reconcile hook stays OFF → a fresh
# signup's first org-scoped create is RLS-denied at QA. Idempotent: never overwrites an existing stamp.
if [ "$CHANGED" != "1" ] && [ "$DRY_RUN" != "1" ] && [ -n "$STATE_PATH" ] && [ -f "$STATE_PATH" ]; then
  if node - "$STATE_PATH" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
try {
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s.database = s.database || {};
  if (!s.database.org_reconcile) s.database.org_reconcile = 'sdk';
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  process.exit(0);
} catch (e) { console.error(e.message); process.exit(1); }
NODE
  then
    info "run-state: stamped database.org_reconcile = sdk (org grants already present) — live-qa b2b reconcile hook enabled"
  else
    warn "could not stamp org_reconcile in $STATE_PATH — set database.org_reconcile = 'sdk' by hand"
  fi
fi

echo "------------------------------------------------------------"
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY-RUN complete — no changes applied. Re-run without --dry-run to reconcile."
  exit 0
fi
if [ "$NO_ACTORS_OK" = "1" ]; then
  pass "b2b org GRANTs reconciled for '$DB_NAME' — verify-phase 2.3's role-level org grants now pass; the personal-org sprt seed lands per-actor on first signup (createCompany works once a user exists)"
else
  pass "b2b org reconcile complete for '$DB_NAME' — a fresh signup can now create org-scoped rows (createCompany etc.)"
fi
echo "       (workaround for PLATFORM-GAPS.md GAP-1b/1c — durable fix is upstream in the per-tenant provisioner)"
exit 0
