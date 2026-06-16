#!/bin/bash
set -euo pipefail

# golden-path.sh — the operator's post-edit HARNESS-ROT check (time-to-app KPI).
#
# After anyone edits the harness (SKILL.md, verify-phase.sh, templates, the *.mjs
# gates, the references generators), run THIS once. It builds the frozen golden app
# (fixtures/golden-app-brief.yaml — one owner-scoped `todos` table, auth:email only)
# end-to-end through the real phase gates and ends with a Chrome live-QA pass over
# EVERY acceptance flow. A harness drift that breaks the happy path shows up here as
# a RED run — this is the canary the harness-improvement plan calls the "rot canary".
#
# What it does:
#   S0. Smokes the shared warm backend on :3000 (api/auth/modules). If it is DOWN /
#       non-200 / OOM, restarts it ONCE with an 8GB heap (SKILL.md S0 recipe), using
#       the constructive CLI auto-discovered via the AGENTS.md sibling pattern (never
#       a hardcoded /Users/... path). A warm hub means Phase 1 is effectively a no-op.
#   1→3. Runs verify-phase.sh for the public step numbers 1 → 2.1 → 2.3 → 2.6 → 3
#       against the golden brief, with LIVE_QA=1 so the Phase 3 gate's live-browser
#       QA (scripts/live-qa.mjs) drives ALL of acceptance.required_flows[] in Chrome
#       (signup → create → reload → assert persisted + auth) — not a single
#       round-trip. That live-QA gate IS the user's standing "QA all flows" check.
#   Report. Prints OVERALL: PASS/FAIL and the start→pass elapsed (the time-to-app KPI).
#
# This is an OPERATOR entry point, not a builder phase: it assumes a warm hub and a
# built/buildable golden app workspace. It does NOT provision infra (Docker/pgpm
# deploy). It is deliberately read-mostly about the harness — it only WRITES if the
# :3000 restart fires (a backgrounded server) and whatever the phase gates write.
#
# Usage:
#   ./scripts/golden-path.sh [--workspace DIR] [--no-restart] [--phases "1 2.1 …"]
#
# Env:
#   GOLDEN_BRIEF       brief to drive          (default: fixtures/golden-app-brief.yaml)
#   GOLDEN_WORKSPACE   built golden app root   (default: brief workspace_root, else $PWD)
#   CONSTRUCTIVE_CLI   abs path to constructive CLI dist/index.js for the S0 restart
#                      (default: auto-discovered sibling; only needed if :3000 is down)
#   LIVE_QA_BASE_URL   app URL for live-QA     (default: the per-app run-state frontend port —
#                      the allocated free dev port — else the brief frontend_port, else app.portBase)
#   GOLDEN_NO_RESTART  =1 → never restart :3000 (smoke only; fail if down)
#
# Exit: 0 = OVERALL PASS (every phase + the live-QA gate green) · non-zero otherwise.

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
hr() { echo "------------------------------------------------------------"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── infra coordinates from constructive.config.json (single source-of-truth) ────
# cfg reads one resolved value; falls back to the literal $2 if the loader can't run
# (so this script still works standalone). Defaults equal today's values.
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }
# resolve_app_id <brief-file> — the per-app build-state id (plain lowercase [a-z0-9])
# derived from the brief's db_name, via the SHARED lib/brief.mjs resolveAppId() helper
# (one definition, not three copy-pasted awks). Tolerant: a missing/unreadable brief
# prints nothing and exits 0, exactly like the old `awk … 2>/dev/null || true`.
resolve_app_id() {
  node -e 'import(process.argv[1]).then(m=>{try{process.stdout.write(m.resolveAppId(require("fs").readFileSync(process.argv[2],"utf8")))}catch(e){}}).catch(()=>{})' \
    "$SCRIPT_DIR/lib/brief.mjs" "$1" 2>/dev/null || true
}
HUB_PORT="$(cfg hub.port 3000)"
HUB_PLATFORM_API="$(node "$SCRIPT_DIR/lib/config.mjs" endpoint api 2>/dev/null || printf 'http://api.localhost:%s/graphql' "$HUB_PORT")"
# Platform Host header (api.localhost) — strip scheme + /graphql from the endpoint.
HUB_PLATFORM_API_HOST="$(printf '%s' "$HUB_PLATFORM_API" | sed -e 's#^[a-z]*://##' -e 's#:[0-9]*/graphql$##' -e 's#/graphql$##')"

# ── per-app build-state dir (RECON-3 convention) ─────────────────────────────
# APP_ID (or, in genericity-check, the brief's db_name) selects build/<app-id>/ for
# the per-app app-brief.yaml + run-state.json. UNSET = legacy singleton build/ — so a
# no-app-id run (golden-path's frozen canary, whose db_name=goldenapp has no
# build/goldenapp/) collapses to the EXACT legacy build/run-state.json fallback.
: "${APP_ID:=}"
state_dir() {                       # echoes build/<app-id> when APP_ID set, else build
  if [ -n "${APP_ID:-}" ]; then echo "$REPO_ROOT/build/$APP_ID"; else echo "$REPO_ROOT/build"; fi
}

# ── args ─────────────────────────────────────────────────────────────────────
WORKSPACE_OVERRIDE=""
NO_RESTART="${GOLDEN_NO_RESTART:-0}"
PHASES_OVERRIDE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workspace) WORKSPACE_OVERRIDE="$2"; shift 2 ;;
    --no-restart) NO_RESTART=1; shift ;;
    --phases) PHASES_OVERRIDE="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "Unknown argument: $1" "see ./scripts/golden-path.sh --help" ;;
  esac
done

BRIEF="${GOLDEN_BRIEF:-$REPO_ROOT/fixtures/golden-app-brief.yaml}"
[ -f "$BRIEF" ] || fail "golden brief not found: $BRIEF" \
  "expected the frozen canary at fixtures/golden-app-brief.yaml (set GOLDEN_BRIEF to override)"

VERIFY="$REPO_ROOT/scripts/verify-phase.sh"
[ -x "$VERIFY" ] || fail "verify-phase.sh not found/executable at $VERIFY" \
  "the golden path drives the real phase gates — ensure scripts/verify-phase.sh is present"

# Public step numbers the four consolidated phases accept (see verify-phase.sh's
# public→internal remap header). Default: Backend, Workspace, Blueprint, Frontend+SDK, UI.
PHASES="${PHASES_OVERRIDE:-1 2.1 2.3 2.6 3}"

# ── resolve the golden app workspace (for live-QA app start + phase --workspace) ─
resolve_workspace() {
  if [ -n "$WORKSPACE_OVERRIDE" ]; then echo "$WORKSPACE_OVERRIDE"; return; fi
  if [ -n "${GOLDEN_WORKSPACE:-}" ]; then echo "$GOLDEN_WORKSPACE"; return; fi
  # brief workspace_root, relative to the repo root unless absolute.
  local wr
  wr="$(awk -F': ' '$1 ~ /^[[:space:]]*workspace_root$/ { v=$2; gsub(/^[[:space:]]+|[[:space:]]+$/,"",v); gsub(/^"/,"",v); gsub(/"$/,"",v); print v; exit }' "$BRIEF" 2>/dev/null || true)"
  if [ -n "$wr" ]; then
    case "$wr" in
      /*) echo "$wr" ;;
      .) echo "$PWD" ;;
      *) echo "$REPO_ROOT/$wr" ;;
    esac
    return
  fi
  echo "$PWD"
}
WORKSPACE="$(resolve_workspace)"

# ── app port / base URL ──────────────────────────────────────────────────────
# Precedence: an explicit LIVE_QA_BASE_URL → the per-app run-state frontend port/url that
# wire-app PERSISTED (the ALLOCATED free dev port — authoritative, so two concurrent apps each
# hit their OWN port) → the brief's frontend_port (only a BASE) → config default (app.portBase).
# Read the same run-state file the phase gates will (per-app build/<app-id>/, else legacy build/).
state_app_field() {  # $1 = json key under .frontend (frontend_port|base_url|port|url) → scalar
  local sf="$REPO_ROOT/build/run-state.json"
  [ -n "${APP_ID:-}" ] && [ -f "$REPO_ROOT/build/$APP_ID/run-state.json" ] && sf="$REPO_ROOT/build/$APP_ID/run-state.json"
  [ -f "$sf" ] || return 0
  node -e "try{const s=JSON.parse(require('fs').readFileSync('$sf','utf8'));const f=(s&&s.frontend)||{};process.stdout.write(String(f['$1']!=null?f['$1']:''))}catch(e){}" 2>/dev/null || true
}
STATE_APP_URL="$(state_app_field base_url)"; [ -n "$STATE_APP_URL" ] || STATE_APP_URL="$(state_app_field url)"
STATE_APP_PORT="$(state_app_field frontend_port)"; [ -n "$STATE_APP_PORT" ] || STATE_APP_PORT="$(state_app_field port)"
APP_PORT="$STATE_APP_PORT"
# Else the brief's frontend_port (BASE), else the config default.
[ -n "$APP_PORT" ] || APP_PORT="$(awk -F': ' '$1 ~ /^[[:space:]]*frontend_port$/ { v=$2; gsub(/[^0-9]/,"",v); print v; exit }' "$BRIEF" 2>/dev/null || true)"
[ -n "$APP_PORT" ] || APP_PORT="$(cfg app.portBase 3081)"
if [ -n "${LIVE_QA_BASE_URL:-}" ]; then :; elif [ -n "$STATE_APP_URL" ]; then LIVE_QA_BASE_URL="$STATE_APP_URL"; else LIVE_QA_BASE_URL="http://localhost:$APP_PORT"; fi

START_TS="$(date +%s)"
echo
echo -e "${GREEN}Constructive harness — GOLDEN PATH (rot canary)${NC}"
hr
info "brief      : $BRIEF"
info "workspace  : $WORKSPACE"
info "app URL    : $LIVE_QA_BASE_URL"
info "phases     : $PHASES  (+ live-QA gate on Phase 3)"
hr

# ── locate the constructive CLI (only needed if :3000 must be restarted) ────────
discover_constructive_cli() {
  if [ -n "${CONSTRUCTIVE_CLI:-}" ]; then
    [ -f "$CONSTRUCTIVE_CLI" ] && { echo "$CONSTRUCTIVE_CLI"; return 0; }
    return 1
  fi
  local parent child cand
  parent="$(cd "$REPO_ROOT/.." && pwd)"
  # Prefer a plain `constructive` sibling; the CLI ships at packages/cli/dist/index.js
  # (SKILL.md S0). Probe one level of parent-dir siblings, never a literal path.
  for child in "$parent"/constructive "$parent"/constructive*/ "$parent"/*/; do
    cand="${child%/}/packages/cli/dist/index.js"
    [ -f "$cand" ] && { echo "$cand"; return 0; }
  done
  return 1
}

# ── S0 — smoke the warm backend on :3000; restart ONCE with a big heap if down ──
smoke_backend() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$HUB_PORT/graphql" \
    -H "Host: $HUB_PLATFORM_API_HOST" -H 'content-type: application/json' \
    -d '{"query":"{ __typename }"}' 2>/dev/null || echo "000")"
  echo "$code"
}

echo "S0: smoke the shared warm backend (:3000)"
CODE="$(smoke_backend)"
if [ "$CODE" = "200" ]; then
  pass "backend :3000 answers (HTTP 200) — warm hub, Phase 1 is a no-op"
else
  warn "backend :3000 returned HTTP $CODE (down / non-200 / OOM)"
  if [ "$NO_RESTART" = "1" ]; then
    fail "backend :3000 is not healthy and --no-restart/GOLDEN_NO_RESTART is set" \
      "start it yourself (SKILL.md S0) or drop --no-restart to let golden-path restart it once with an 8GB heap"
  fi
  CLI="$(discover_constructive_cli || true)"
  [ -n "$CLI" ] || fail "could not locate the constructive CLI to restart :3000" \
    "set CONSTRUCTIVE_CLI=/abs/.../constructive/packages/cli/dist/index.js (the sibling constructive checkout), or start the server yourself per SKILL.md S0"
  info "restarting :3000 ONCE with an 8GB heap via $CLI (SKILL.md S0)"
  # The per-DB handler cache is heap-fragile under multi-DB load; 8192 is the fix.
  API_IS_PUBLIC=true API_ANON_ROLE=anonymous API_ROLE_NAME=authenticated \
  NODE_OPTIONS=--max-old-space-size=8192 \
    node "$CLI" server --port "$HUB_PORT" --host 0.0.0.0 --origin '*' \
    >/tmp/cnc-3000.golden.log 2>&1 &
  info "waiting for :3000 to come up (up to ~60s; log: /tmp/cnc-3000.golden.log)"
  UP=""
  for _ in $(seq 1 30); do
    CODE="$(smoke_backend)"
    [ "$CODE" = "200" ] && { UP=1; break; }
    sleep 2
  done
  [ -n "$UP" ] || { tail -n 40 /tmp/cnc-3000.golden.log 2>/dev/null || true; \
    fail "backend :3000 did not come up after restart" \
      "inspect /tmp/cnc-3000.golden.log; if it OOMs again the 8192 heap above is already the documented fix (SKILL.md S0)"; }
  pass "backend :3000 healthy after one 8GB-heap restart"
fi
hr

# ── guarded PG* hydration (before the psql-using 2.x grant/RLS gates) ────────────
# The internal Blueprint/grant/RLS gates (verify-phase 2.3, 2.6) shell out to psql, which needs
# PGHOST/PGPORT/PGUSER/PGPASSWORD. golden-path drives those gates as child processes, so EXPORT the
# hub's PG* here once: pgpm env → eval, guarded so it is a no-op when PG* are already set (respect
# the caller) or when pgpm isn't on PATH. verify-phase.sh re-hydrates the same way as a fallback;
# doing it here too means a missing eval "$(pgpm env)" never silently degrades the grant gate.
if [ -z "${PGHOST:-}" ] && command -v pgpm >/dev/null 2>&1; then
  if PGPM_ENV="$(pgpm env 2>/dev/null)" && [ -n "$PGPM_ENV" ]; then
    eval "$PGPM_ENV"
    export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE 2>/dev/null || true
    info "S0b: hydrated + exported PG* from 'pgpm env' (PGHOST was unset; PGHOST=${PGHOST:-?})"
  else
    warn "S0b: PGHOST unset and 'pgpm env' produced nothing — the 2.x grant/RLS gates may degrade (run eval \"\$(pgpm env)\" with the hub up; SKILL.md Phase 1)"
  fi
  unset PGPM_ENV
elif [ -n "${PGHOST:-}" ]; then
  info "S0b: PGHOST already set (${PGHOST}) — leaving caller PG* as-is"
fi
hr

# ── run the phase gates against the golden brief, with LIVE_QA enabled ──────────
# Each phase gate is the SAME script real builds run; passing --spec/--state/--workspace
# and LIVE_QA=1 makes Phase 3 drive scripts/live-qa.mjs across every acceptance flow.
# Per-app run-state (RECON-3): if APP_ID is unset, derive it from the resolved brief's
# db_name so build/<app-id>/run-state.json is found; prefer the per-app file, else the
# LEGACY build/run-state.json (the golden brief's db_name=goldenapp has no
# build/goldenapp/ in the frozen path, so the canary still hits the legacy singleton).
if [ -z "${APP_ID:-}" ] && [ -f "$BRIEF" ]; then
  APP_ID="$(resolve_app_id "$BRIEF")"
fi
STATE_ARGS=()
STATE_FILE="$REPO_ROOT/build/run-state.json"
if [ -n "${APP_ID:-}" ] && [ -f "$REPO_ROOT/build/$APP_ID/run-state.json" ]; then
  STATE_FILE="$REPO_ROOT/build/$APP_ID/run-state.json"
fi
[ -f "$STATE_FILE" ] && STATE_ARGS=(--state "$STATE_FILE")

FAILED_PHASE=""
for ph in $PHASES; do
  echo "PHASE $ph: ./scripts/verify-phase.sh $ph --spec <golden-brief>"
  # LIVE_QA=1 only matters on the UI phase (3); harmless elsewhere. LIVE_QA_SPEC points
  # the driver at the golden brief so it resolves acceptance.required_flows itself.
  # STATE_ARGS is empty on a FRESH build (no build/run-state.json yet). Under `set -u`
  # on bash 3.2 (the macOS default) a bare "${STATE_ARGS[@]}" of an empty array is an
  # "unbound variable" and would abort phase 1. The "${arr[@]+${arr[@]}}" idiom expands
  # to nothing when unset/empty and to the elements otherwise — set-u-safe everywhere.
  if LIVE_QA=1 \
     LIVE_QA_SPEC="$BRIEF" \
     LIVE_QA_BASE_URL="$LIVE_QA_BASE_URL" \
     "$VERIFY" "$ph" --spec "$BRIEF" --workspace "$WORKSPACE" "${STATE_ARGS[@]+${STATE_ARGS[@]}}"; then
    pass "phase $ph green"
  else
    FAILED_PHASE="$ph"
    warn "phase $ph FAILED — stopping the golden path here"
    break
  fi
  hr
done

# ── report: OVERALL + time-to-app KPI ───────────────────────────────────────────
END_TS="$(date +%s)"
ELAPSED=$(( END_TS - START_TS ))
MM=$(( ELAPSED / 60 )); SS=$(( ELAPSED % 60 ))
echo
hr
if [ -z "$FAILED_PHASE" ]; then
  pass "all phases ($PHASES) green, incl. the Chrome live-QA gate over every acceptance flow"
  echo -e "${GREEN}OVERALL: PASS${NC}   (start→pass: ${MM}m${SS}s — time-to-app KPI)"
  hr
  exit 0
else
  echo -e "${RED}OVERALL: FAIL${NC}   (failed at phase ${FAILED_PHASE}; elapsed ${MM}m${SS}s)"
  echo "        The harness drifted or the golden app is broken. Re-run the failed phase verbosely:"
  echo "          ./scripts/verify-phase.sh ${FAILED_PHASE} --spec \"$BRIEF\" --workspace \"$WORKSPACE\""
  echo "        (the live-QA driver's per-flow PASS/FAIL table is in the Phase 3 output above.)"
  hr
  exit 1
fi
