# scripts/lib/schema-resolve.sh — per-DB schema-resolution idiom (sourced by verify-phase.sh).
#
# Constructive provisions each tenant DB into per-module Postgres schemas whose names embed the db
# name with EITHER separator (gotchas SUBDOMAIN-001):
#   OLD dash+hash:  <db>-<hash>-memberships-public   (fv4-* era)
#   NEW underscore: <db>_memberships_public          (goldenapp_*/fv5_*/fv6_*)
# A LIKE pinned to one separator 0-matches the other. The fix, used ~7× across verify-phase.sh's
# Phase-2.3 grant/RLS gates, is: turn the db name's own -/_ into '%' (schema_db_like), then resolve
# each schema DIRECTLY via '<DB_LIKE>%<token>%<suffix>', shortest match (no prefix arithmetic). These
# helpers factor that copied psql one-liner into ONE definition; each reconstructs the EXACT same SQL
# the inline call used (same projection, same separator-tolerant LIKE, same `ORDER BY length(...),
# ... LIMIT 1`, same `2>/dev/null | tr -d ' '`, same literal `-d constructive` hub connection), so
# behaviour is byte-identical. Callers pass the precomputed $DB_LIKE plus the literal interior LIKE
# suffix (e.g. '%memberships%public') so the resolved string matches what was inlined.

# schema_db_like <db-name> — the START-anchored, separator-tolerant LIKE seed: the db name with its
# own '-'/'_' replaced by '%'. Falls back to the raw db name if psql can't run (exactly like the
# inline `[ -n "$DB_LIKE" ] || DB_LIKE="$DB_NAME_RESOLVED"`). Anchored at the START (no leading %),
# so a sibling tenant whose name merely CONTAINS this db can't match.
schema_db_like() {
  local db="$1" like
  like="$(psql -d constructive -t -c "SELECT replace(replace('$db', '_', '%'), '-', '%');" 2>/dev/null | tr -d ' ')"
  if [ -n "$like" ]; then printf '%s' "$like"; else printf '%s' "$db"; fi
}

# resolve_schema_name <db_like> <like_suffix> — shortest information_schema.schemata.schema_name
# matching '<db_like><like_suffix>' (e.g. resolve_schema_name "$DB_LIKE" '%app%public'). Empty when
# none. Mirrors the inline schemata resolve exactly.
resolve_schema_name() {
  psql -d constructive -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${1}${2}' ORDER BY length(schema_name), schema_name LIMIT 1;" 2>/dev/null | tr -d ' '
}

# resolve_table_schema <db_like> <table> <like_suffix> — shortest information_schema.tables.table_schema
# that HOLDS <table> and matches '<db_like><like_suffix>' (e.g.
# resolve_table_schema "$DB_LIKE" 'org_memberships' '%memberships%public'). Empty when none. Mirrors
# the inline tables resolve exactly.
resolve_table_schema() {
  psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = '$2' AND table_schema LIKE '${1}${3}' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' '
}
