# scripts/lib/phase-runner.sh — the S0-smoke / PG-hydration / app-URL / phase-loop boilerplate
# shared by golden-path.sh (the rot canary) and genericity-check.sh (the genericity gate).
#
# Both scripts drive verify-phase.sh across a set of phases against a warm :3000 hub, after smoking
# (and restarting once if needed) that hub and hydrating PG*. That machinery was copy-pasted between
# them byte-for-byte except for a handful of log/message strings; this lib holds the single copy and
# the consumers pass those strings as arguments. The two entry points stay SEPARATE — this only
# removes the duplication, it does not merge them. Sourced AFTER lib/sh-common.sh (it uses
# pass/fail/warn/info/hr + SCRIPT_DIR/REPO_ROOT) — never executed.
#
# Globals the consumers already define and this lib reads/writes (same names, same meaning as before):
#   SCRIPT_DIR REPO_ROOT          (from sh-common.sh)
#   HUB_PORT HUB_PLATFORM_API HUB_PLATFORM_API_HOST   (set by pr_hub_coords)
#   APP_ID                        (per-app build-state id; honored if already set, else derived)
#   BRIEF                         (resolved brief path — read by pr_resolve_app_url / pr_run_phases)
#   LIVE_QA_BASE_URL              (set by pr_resolve_app_url if the caller didn't)
#   STATE_ARGS                    (array; the consumer builds it, pr_run_phases forwards it)
#   FAILED_PHASE                  (set by pr_run_phases — "" on full success)

# ── infra coordinates from constructive.config.json (single source-of-truth) ────
# cfg reads one resolved value; falls back to the literal $2 if the loader can't run (so the script
# still works standalone). Defaults equal today's values. (Defined here so both consumers share the
# one copy; identical to the inline definition each used.)
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }

# resolve_app_id <brief-file> — the per-app build-state id (plain lowercase [a-z0-9]) derived from
# the brief's db_name via the SHARED lib/brief.mjs resolveAppId() (one definition, not copy-pasted
# awks). Tolerant: a missing/unreadable brief prints nothing and exits 0.
resolve_app_id() {
  node -e 'import(process.argv[1]).then(m=>{try{process.stdout.write(m.resolveAppId(require("fs").readFileSync(process.argv[2],"utf8")))}catch(e){}}).catch(()=>{})' \
    "$SCRIPT_DIR/lib/brief.mjs" "$1" 2>/dev/null || true
}

# state_dir — echoes build/<app-id> when APP_ID is set, else the legacy singleton build/.
: "${APP_ID:=}"
state_dir() {
  if [ -n "${APP_ID:-}" ]; then echo "$REPO_ROOT/build/$APP_ID"; else echo "$REPO_ROOT/build"; fi
}

# pr_hub_coords — set HUB_PORT + the platform api endpoint + its Host header. Call once after sourcing.
pr_hub_coords() {
  HUB_PORT="$(cfg hub.port 3000)"
  HUB_PLATFORM_API="$(node "$SCRIPT_DIR/lib/config.mjs" endpoint api 2>/dev/null || printf 'http://api.localhost:%s/graphql' "$HUB_PORT")"
  HUB_PLATFORM_API_HOST="$(printf '%s' "$HUB_PLATFORM_API" | sed -e 's#^[a-z]*://##' -e 's#:[0-9]*/graphql$##' -e 's#/graphql$##')"
}

# discover_constructive_cli — locate the constructive CLI dist/index.js (only needed if :3000 must be
# restarted). Honors $CONSTRUCTIVE_CLI; else probes one level of parent-dir siblings (never a literal
# path), preferring a plain `constructive` checkout. Echoes the path, returns non-zero if none.
discover_constructive_cli() {
  if [ -n "${CONSTRUCTIVE_CLI:-}" ]; then
    [ -f "$CONSTRUCTIVE_CLI" ] && { echo "$CONSTRUCTIVE_CLI"; return 0; }
    return 1
  fi
  local parent child cand
  parent="$(cd "$REPO_ROOT/.." && pwd)"
  for child in "$parent"/constructive "$parent"/constructive*/ "$parent"/*/; do
    cand="${child%/}/packages/cli/dist/index.js"
    [ -f "$cand" ] && { echo "$cand"; return 0; }
  done
  return 1
}

# smoke_backend — echo the HTTP status of a __typename query against the platform api on :3000 (or
# "000" when unreachable). Reads HUB_PORT + HUB_PLATFORM_API_HOST.
smoke_backend() {
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:$HUB_PORT/graphql" \
    -H "Host: $HUB_PLATFORM_API_HOST" -H 'content-type: application/json' \
    -d '{"query":"{ __typename }"}' 2>/dev/null || echo "000"
}

# pr_s0_smoke_and_restart — S0: smoke the warm backend; if down/non-200/OOM, restart it ONCE with an
# 8GB heap (the per-DB handler cache is heap-fragile under multi-DB load; 8192 is the documented fix).
# Args:
#   $1 no_restart      "1" → never restart (smoke only; fail if down)
#   $2 log_file        where the restarted server logs (e.g. /tmp/cnc-3000.golden.log)
#   $3 warm_tail       trailing clause of the warm-hub PASS (e.g. "Phase 1 is a no-op")
#   $4 norestart_env   the env var name shown in the --no-restart fail (e.g. GOLDEN_NO_RESTART)
#   $5 norestart_actor the actor phrase in that fail's FIX (e.g. "golden-path" / "this")
pr_s0_smoke_and_restart() {
  local no_restart="$1" log_file="$2" warm_tail="$3" norestart_env="$4" norestart_actor="$5"
  local code up
  # Unmanaged-hub mode (hub.managed=false / CONSTRUCTIVE_HUB_MANAGED=false): a non-operator runner that
  # never owns the backend's lifecycle. VERIFY reachability (smoke) but NEVER boot/kill/restart the hub —
  # force no_restart so the existing down-fail branch is taken and the restart spawn is never reached.
  # Default 'true' preserves today's restart-on-OOM operator behavior (degrades to true if node can't run).
  local hub_managed; hub_managed="$(cfg hub.managed true)"
  [ "$hub_managed" = "false" ] && no_restart="1"
  echo "S0: smoke the shared warm backend (:3000)"
  code="$(smoke_backend)"
  if [ "$code" = "200" ]; then
    pass "backend :3000 answers (HTTP 200) — warm hub, $warm_tail"
    return 0
  fi
  warn "backend :3000 returned HTTP $code (down / non-200 / OOM)"
  if [ "$no_restart" = "1" ]; then
    if [ "$hub_managed" = "false" ]; then
      fail "backend :3000 is not healthy and the hub is configured unmanaged (hub.managed=false)" \
        "treat a down hub as an external outage — bring it up out-of-band, this run will not start it"
    fi
    fail "backend :3000 is not healthy and --no-restart/$norestart_env is set" \
      "start it yourself (SKILL.md S0) or drop --no-restart to let $norestart_actor restart it once with an 8GB heap"
  fi
  local cli
  cli="$(discover_constructive_cli || true)"
  [ -n "$cli" ] || fail "could not locate the constructive CLI to restart :3000" \
    "set CONSTRUCTIVE_CLI=/abs/.../constructive/packages/cli/dist/index.js (the sibling constructive checkout), or start the server yourself per SKILL.md S0"
  info "restarting :3000 ONCE with an 8GB heap via $cli (SKILL.md S0)"
  API_IS_PUBLIC=true API_ANON_ROLE=anonymous API_ROLE_NAME=authenticated \
  NODE_OPTIONS=--max-old-space-size=8192 \
    node "$cli" server --port "$HUB_PORT" --host 0.0.0.0 --origin '*' \
    >"$log_file" 2>&1 &
  info "waiting for :3000 to come up (up to ~60s; log: $log_file)"
  up=""
  for _ in $(seq 1 30); do
    code="$(smoke_backend)"
    [ "$code" = "200" ] && { up=1; break; }
    sleep 2
  done
  [ -n "$up" ] || { tail -n 40 "$log_file" 2>/dev/null || true; \
    fail "backend :3000 did not come up after restart" \
      "inspect $log_file; if it OOMs again the 8192 heap above is already the documented fix (SKILL.md S0)"; }
  pass "backend :3000 healthy after one 8GB-heap restart"
}

# pr_pg_hydrate — S0b: hydrate + export PG* from `pgpm env` (guarded) so the psql-using grant/RLS
# gates don't silently degrade. No-op when PG* are already set (respect the caller) or pgpm is absent.
# Arg: $1 = the gates label in the not-found warn ("2.x" for golden-path, "2.3" for genericity-check).
pr_pg_hydrate() {
  local gates_label="$1"
  if [ -z "${PGHOST:-}" ] && command -v pgpm >/dev/null 2>&1; then
    if PGPM_ENV="$(pgpm env 2>/dev/null)" && [ -n "$PGPM_ENV" ]; then
      eval "$PGPM_ENV"
      export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE 2>/dev/null || true
      info "S0b: hydrated + exported PG* from 'pgpm env' (PGHOST was unset; PGHOST=${PGHOST:-?})"
    else
      warn "S0b: PGHOST unset and 'pgpm env' produced nothing — the $gates_label grant/RLS gates may degrade (run eval \"\$(pgpm env)\" with the hub up; SKILL.md Phase 1)"
    fi
    unset PGPM_ENV
  elif [ -n "${PGHOST:-}" ]; then
    info "S0b: PGHOST already set (${PGHOST}) — leaving caller PG* as-is"
  fi
}

# state_app_field <key> — echo a scalar under .frontend in this app's run-state.json (per-app
# build/<app-id>/run-state.json when APP_ID is set + present, else the legacy build/run-state.json).
# key ∈ frontend_port|base_url|port|url. Empty when absent. Reads REPO_ROOT + APP_ID.
state_app_field() {
  local sf="$REPO_ROOT/build/run-state.json"
  [ -n "${APP_ID:-}" ] && [ -f "$REPO_ROOT/build/$APP_ID/run-state.json" ] && sf="$REPO_ROOT/build/$APP_ID/run-state.json"
  [ -f "$sf" ] || return 0
  node -e "try{const s=JSON.parse(require('fs').readFileSync('$sf','utf8'));const f=(s&&s.frontend)||{};process.stdout.write(String(f['$1']!=null?f['$1']:''))}catch(e){}" 2>/dev/null || true
}

# pr_resolve_app_url — set LIVE_QA_BASE_URL for the live-QA app start. Precedence (unchanged): an
# explicit LIVE_QA_BASE_URL → the per-app run-state frontend port/url wire-app PERSISTED (the
# ALLOCATED free dev port, so two concurrent apps each hit their OWN port) → the brief's
# frontend_port (a BASE) → the config default (app.portBase). Reads BRIEF; honors a preset
# LIVE_QA_BASE_URL. Exports LIVE_QA_BASE_URL (and sets APP_PORT as a byproduct, as before).
pr_resolve_app_url() {
  local state_app_url state_app_port
  state_app_url="$(state_app_field base_url)"; [ -n "$state_app_url" ] || state_app_url="$(state_app_field url)"
  state_app_port="$(state_app_field frontend_port)"; [ -n "$state_app_port" ] || state_app_port="$(state_app_field port)"
  APP_PORT="$state_app_port"
  [ -n "$APP_PORT" ] || APP_PORT="$(awk -F': ' '$1 ~ /^[[:space:]]*frontend_port$/ { v=$2; gsub(/[^0-9]/,"",v); print v; exit }' "$BRIEF" 2>/dev/null || true)"
  [ -n "$APP_PORT" ] || APP_PORT="$(cfg app.portBase 3081)"
  if [ -n "${LIVE_QA_BASE_URL:-}" ]; then :; elif [ -n "$state_app_url" ]; then LIVE_QA_BASE_URL="$state_app_url"; else LIVE_QA_BASE_URL="http://localhost:$APP_PORT"; fi
}

# pr_run_phases — run verify-phase.sh across $1 (space-separated phases) against the brief + workspace,
# with LIVE_QA=1 + an absolute LIVE_QA_SPEC so the Phase-3 gate drives live-qa.mjs across every
# acceptance flow. Forwards the consumer's STATE_ARGS array set-u-safely. Sets the global FAILED_PHASE
# ("" on full success) and stops at the first red phase. Args:
#   $1 phases        e.g. "1 2.1 2.3 2.6 3"
#   $2 verify        abs path to verify-phase.sh
#   $3 brief         the (absolute) brief path
#   $4 workspace     the app workspace root passed as --workspace
#   $5 stopping_noun the run's name in the per-phase fail line (e.g. "golden path" / "genericity check")
#   $6 header_suffix the trailing text of the per-phase echo AFTER "./scripts/verify-phase.sh $ph "
#                    (e.g. "--spec <golden-brief>" / "--spec <brief> --workspace <app-dir>")
# Any LIVE_QA_* the caller exported (CRUD path / entity testids) is inherited by the child gate.
pr_run_phases() {
  local phases="$1" verify="$2" brief="$3" workspace="$4" stopping_noun="$5" header_suffix="$6"
  local ph
  FAILED_PHASE=""
  for ph in $phases; do
    # Echo the literal command form (./scripts/verify-phase.sh …) the consumers always printed, so
    # the on-screen line is byte-identical regardless of the absolute $verify path actually invoked.
    echo "PHASE $ph: ./scripts/verify-phase.sh $ph $header_suffix"
    # "${arr[@]+${arr[@]}}" expands to nothing when STATE_ARGS is empty (no run-state yet) and to the
    # elements otherwise — set-u-safe on bash 3.2 (the macOS default).
    if LIVE_QA=1 \
       LIVE_QA_SPEC="$brief" \
       LIVE_QA_BASE_URL="$LIVE_QA_BASE_URL" \
       "$verify" "$ph" --spec "$brief" --workspace "$workspace" "${STATE_ARGS[@]+${STATE_ARGS[@]}}"; then
      pass "phase $ph green"
    else
      FAILED_PHASE="$ph"
      warn "phase $ph FAILED — stopping the $stopping_noun here"
      break
    fi
    hr
  done
}
