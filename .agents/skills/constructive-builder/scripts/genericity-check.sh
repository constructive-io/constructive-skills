#!/bin/bash
set -euo pipefail

# genericity-check.sh — the GENERICITY gate: prove the harness can verify ANY app,
# not just the frozen golden canary, against the REAL phase gates + a Chrome all-flows
# live-QA pass. Sibling of golden-path.sh (the rot canary) — same structure, but it
# takes YOUR brief + YOUR already-built app dir instead of the frozen golden one, and
# runs the BUILD-VERIFY span only (Phase 2.1 → 2.3 → 2.6 → 3); it does NOT scaffold or
# provision (that already happened) and it does NOT run Phase 1 (it smokes the warm hub).
#
# This is the Wave-3 genericity proof's scoring harness: point it at test-crm-brief.yaml /
# test-blog-brief.yaml (or any brief) and the app dir built from it, and it answers the
# two questions the proof asks — is the built app CORRECT (schema/grants/RLS gates green)
# and does it WORK end-to-end (Chrome signup → CRUD → reload across every acceptance flow)?
#
# Named canaries (the standing rot set — the diversity beyond golden-path.sh's frozen
# todos): pass --canary <name> instead of a positional brief+dir to run a TRACKED tier:
#   todos   — owner-scoped (auth:email) ........... fixtures/golden-app-brief.yaml  (the owner floor)
#   blog    — public-read ........................ fixtures/test-blog-brief.yaml   (anon-readable tier)
#   b2b     — org-membership (the b2b/CRM tier) ... fixtures/test-crm-brief.yaml    (AuthzEntityMembership)
#   childfk — required parent FK (the FIX-1 tier) . fixtures/test-childfk-brief.yaml (belongs-to + FK picker)
# Each maps to its frozen brief + its conventional built app dir under .scratch-genericity/
# (canary/golden-app, blog/genblog, crm/gencrm, childfk/genchildfk) and pre-sets the live-QA
# entity path/testids. Override a canary's app dir or brief with GENERICITY_CANARY_DIR /
# GENERICITY_CANARY_BRIEF. These four tiers TOGETHER are the genericity rot-canary: todos
# exercises owner-scope, blog public-read, b2b the org-membership policy class, and childfk the
# required-belongs-to FK frontend emission (the child page's FK picker + camelCase FK key on
# create) — so a drift that only breaks one tier is still caught. The b2b canary's LIVE-QA
# (signup → org-scoped CRUD) now passes hands-free: the platform self-seeds the fresh actor's
# personal-org membership on signup (PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15), so the
# org-scoped INSERT goes through RLS with no reconcile stopgap.
#
# What it does:
#   S0. Smokes the shared warm backend on :3000 (api endpoint). DOWN/non-200 → restart
#       ONCE with an 8GB heap (SKILL.md S0), via the constructive CLI auto-discovered the
#       AGENTS.md sibling way (never a hardcoded /Users/... path). --no-restart smokes only.
#   S0b. Hydrates + exports PG* from `pgpm env` (guarded) so the psql-using 2.3 grant/RLS
#       gates don't silently degrade.
#   2.1→3. Runs verify-phase.sh for the public step numbers 2.1 → 2.3 → 2.6 → 3 against
#       YOUR brief + app dir, with LIVE_QA=1 and an ABSOLUTE LIVE_QA_SPEC so the Phase-3
#       gate drives scripts/live-qa.mjs across ALL of acceptance.required_flows[] in Chrome.
#   Report. Prints OVERALL: PASS/FAIL and start→OVERALL elapsed (the time-to-app KPI).
#
# The CRUD round-trip in live-qa.mjs defaults to the canary's /todos + todo-* testids; a
# divergent app has its OWN entity. Export the entity's testids/path for the driver
# (LIVE_QA_CRUD_PATH + LIVE_QA_TID_TITLE/CREATE/ROW) before running, OR rely on the
# generated `<entity>-*` testids scaffold-frontend.mjs emits (then set only the env that
# differs). This script forwards any LIVE_QA_* you export — it does not invent them.
#
# Usage:
#   ./scripts/genericity-check.sh <brief.yaml> <app-dir> [--no-restart] [--phases "2.1 …"]
#   ./scripts/genericity-check.sh --canary <todos|blog|b2b|childfk> [--no-restart] [--phases "2.1 …"]
#
# Env (all optional):
#   LIVE_QA_BASE_URL   app URL for live-QA     (default: the per-app run-state frontend port — the
#                      allocated free dev port — else the brief frontend_port, else app.portBase)
#   LIVE_QA_CRUD_PATH  app's CRUD route        (e.g. /posts, /contacts — else the driver's /todos default)
#   LIVE_QA_TID_TITLE / LIVE_QA_TID_CREATE / LIVE_QA_TID_ROW   the entity's generated testids
#   GENERICITY_CANARY_DIR    override a --canary's app dir   (default: .scratch-genericity/<tier>)
#   GENERICITY_CANARY_BRIEF  override a --canary's brief      (default: the tier's frozen brief)
#   CONSTRUCTIVE_CLI   abs path to constructive CLI dist/index.js (only if :3000 must restart)
#   GENERICITY_NO_RESTART =1 → never restart :3000 (smoke only; fail if down)
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
# cfg reads one resolved value; falls back to the literal $2 if the loader can't run.
# Defaults equal today's values.
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }
# resolve_app_id <brief-file> — per-app build-state id (plain lowercase [a-z0-9]) from the
# brief's db_name, via the SHARED lib/brief.mjs resolveAppId() helper (one definition, not
# three copy-pasted awks). Tolerant: missing/unreadable brief → empty + exit 0, exactly
# like the old `awk … 2>/dev/null || true`.
resolve_app_id() {
  node -e 'import(process.argv[1]).then(m=>{try{process.stdout.write(m.resolveAppId(require("fs").readFileSync(process.argv[2],"utf8")))}catch(e){}}).catch(()=>{})' \
    "$SCRIPT_DIR/lib/brief.mjs" "$1" 2>/dev/null || true
}
HUB_PORT="$(cfg hub.port 3000)"
HUB_PLATFORM_API="$(node "$SCRIPT_DIR/lib/config.mjs" endpoint api 2>/dev/null || printf 'http://api.localhost:%s/graphql' "$HUB_PORT")"
HUB_PLATFORM_API_HOST="$(printf '%s' "$HUB_PLATFORM_API" | sed -e 's#^[a-z]*://##' -e 's#:[0-9]*/graphql$##' -e 's#/graphql$##')"

# ── per-app build-state dir (RECON-3 convention) ─────────────────────────────
# APP_ID selects build/<app-id>/ for the per-app run-state.json; we export it from the
# resolved brief's db_name (below, once BRIEF is known) so concurrent canary tiers each
# read their OWN state. UNSET = legacy singleton build/run-state.json.
: "${APP_ID:=}"
state_dir() {                       # echoes build/<app-id> when APP_ID set, else build
  if [ -n "${APP_ID:-}" ]; then echo "$REPO_ROOT/build/$APP_ID"; else echo "$REPO_ROOT/build"; fi
}

# ── args ─────────────────────────────────────────────────────────────────────
BRIEF=""
APP_DIR=""
CANARY=""
NO_RESTART="${GENERICITY_NO_RESTART:-0}"
PHASES_OVERRIDE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-restart) NO_RESTART=1; shift ;;
    --phases) PHASES_OVERRIDE="$2"; shift 2 ;;
    --canary) CANARY="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,61p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) fail "Unknown option: $1" "see ./scripts/genericity-check.sh --help" ;;
    *)
      if [ -z "$BRIEF" ]; then BRIEF="$1"
      elif [ -z "$APP_DIR" ]; then APP_DIR="$1"
      else fail "Unexpected argument: $1" "Usage: ./scripts/genericity-check.sh <brief.yaml> <app-dir> [--no-restart] [--phases \"…\"]"
      fi
      shift
      ;;
  esac
done

# ── named-canary resolution ──────────────────────────────────────────────────
# --canary <tier> is a shorthand for "the brief + built app dir of a TRACKED rot tier",
# so the b2b/org-membership class is exercised the same hands-free way as todos + blog.
# It fills BRIEF + APP_DIR from a small registry and pre-sets the live-QA entity env so
# the Phase-3 driver targets that tier's OWN entity. Positional brief/app-dir and
# --canary are mutually exclusive. The app dirs live under .scratch-genericity/<tier>
# (operator-built, NOT committed) — overridable via GENERICITY_CANARY_DIR/BRIEF.
if [ -n "$CANARY" ]; then
  if [ -n "$BRIEF" ] || [ -n "$APP_DIR" ]; then
    fail "--canary <name> and positional <brief> <app-dir> are mutually exclusive" \
      "pass EITHER --canary <todos|blog|b2b|childfk> OR a brief + app dir, not both"
  fi
  SCRATCH_ROOT="$(cd "$REPO_ROOT/../.." 2>/dev/null && pwd || echo "$REPO_ROOT/..")"
  # c_path selects WHICH entity the live-QA drives (a legitimate per-tier choice — e.g. the
  # CHILD /posts of a parent/child FK app). The testids are NOT set here: the live-QA driver
  # DERIVES them generically from the brief (deriveCrudTarget → `${entity}-title-input` etc.,
  # now path-aware via LIVE_QA_CRUD_PATH). Hard-coding testids here would defeat that derivation
  # and drift stale — which it did (todo-create vs the emitted todo-create-submit).
  c_brief=""; c_dir=""; c_path=""
  case "$CANARY" in
    todos|golden|owner)
      c_brief="$REPO_ROOT/fixtures/golden-app-brief.yaml"
      c_dir="$SCRATCH_ROOT/.scratch-genericity/canary/golden-app"
      c_path="/todos"
      ;;
    blog|public|public-read)
      c_brief="$REPO_ROOT/fixtures/test-blog-brief.yaml"
      c_dir="$SCRATCH_ROOT/.scratch-genericity/blog/genblog"
      c_path="/posts"
      ;;
    b2b|crm|org|org-membership)
      c_brief="$REPO_ROOT/fixtures/test-crm-brief.yaml"
      c_dir="$SCRATCH_ROOT/.scratch-genericity/crm/gencrm"
      c_path="/companies"
      ;;
    childfk|child-fk|fk)
      # The required-belongs-to FK tier (FIX-1): posts BELONGS-TO topics via a required FK.
      # The CHILD entity (post) is the live-QA surface — its page must let the driver pick a
      # parent topic (post-topic-select) before creating a post, so the FK-picker emission is
      # exercised end-to-end. The live-QA driver navigates to the CHILD route /posts and uses
      # the generated post-* testids (its FK-aware create step is keyed off LIVE_QA_CRUD_PATH).
      c_brief="$REPO_ROOT/fixtures/test-childfk-brief.yaml"
      c_dir="$SCRATCH_ROOT/.scratch-genericity/childfk/genchildfk"
      c_path="/posts"
      ;;
    *)
      fail "unknown --canary tier: $CANARY" \
        "valid tiers: todos (owner/auth:email) · blog (public-read) · b2b (org-membership/CRM) · childfk (required parent FK)"
      ;;
  esac
  BRIEF="${GENERICITY_CANARY_BRIEF:-$c_brief}"
  APP_DIR="${GENERICITY_CANARY_DIR:-$c_dir}"
  # Select WHICH entity the Phase-3 driver drives for this tier (only if the caller didn't
  # already choose). The driver then DERIVES the testids for that entity from the brief
  # (deriveCrudTarget, path-aware via LIVE_QA_CRUD_PATH) — nothing else to pre-seed.
  : "${LIVE_QA_CRUD_PATH:=$c_path}";  export LIVE_QA_CRUD_PATH
  info "canary tier: $CANARY  →  brief=$BRIEF  dir=$APP_DIR  crud=$LIVE_QA_CRUD_PATH"
  case "$CANARY" in
    b2b|crm|org|org-membership)
      info "b2b canary: its LIVE-QA (signup → org-scoped CRUD) is expected to PASS hands-free —"
      info "the platform self-seeds the fresh actor's personal-org membership on signup"
      info "(PLATFORM-GAPS.md GAP-1b/1c, CLOSED 2026-06-15), so the org-scoped INSERT goes through"
      info "RLS with no reconcile stopgap. An org-scoped create that 403s here is a real regression."
      ;;
  esac
fi

[ -n "$BRIEF" ] || fail "no brief given" "Usage: ./scripts/genericity-check.sh <brief.yaml> <app-dir> [--no-restart]  (or --canary <todos|blog|b2b|childfk>)"
[ -n "$APP_DIR" ] || fail "no app dir given" "Usage: ./scripts/genericity-check.sh <brief.yaml> <app-dir> [--no-restart]  (or --canary <todos|blog|b2b|childfk>)"

# Absolutize the brief — the live-QA driver runs with cwd=app workspace, so a relative
# LIVE_QA_SPEC would existsSync() against the wrong dir and resolve ZERO flows.
case "$BRIEF" in
  /*) : ;;
  *) if [ -f "$PWD/$BRIEF" ]; then BRIEF="$PWD/$BRIEF"; elif [ -f "$REPO_ROOT/$BRIEF" ]; then BRIEF="$REPO_ROOT/$BRIEF"; elif [ -f "$REPO_ROOT/fixtures/$BRIEF" ]; then BRIEF="$REPO_ROOT/fixtures/$BRIEF"; fi ;;
esac
[ -f "$BRIEF" ] || fail "brief not found: $BRIEF" "pass an existing brief (e.g. fixtures/test-crm-brief.yaml)"

# Per-app build-state (RECON-3): derive APP_ID from the now-resolved brief's db_name (unless
# the caller already set it) so each --canary tier reads its OWN build/<db_name>/run-state.json.
# db_name is plain lowercase (lib/brief.mjs enforces it); strip anything else defensively.
# Falls through to the legacy build/run-state.json when no per-app file exists, so existing
# single-tenant flows are unchanged.
if [ -z "${APP_ID:-}" ]; then
  APP_ID="$(resolve_app_id "$BRIEF")"
fi
export APP_ID

case "$APP_DIR" in
  /*) : ;;
  *) APP_DIR="$PWD/$APP_DIR" ;;
esac
if [ ! -d "$APP_DIR" ]; then
  if [ -n "$CANARY" ]; then
    fail "canary '$CANARY' app dir not found: $APP_DIR" \
      "the named canaries verify an ALREADY-BUILT app under .scratch-genericity/<tier> (operator-built, not committed). Build the $CANARY app from its brief ($BRIEF) — scaffold-provision.mjs + scaffold-frontend.mjs + pnpm codegen — into that dir, or point GENERICITY_CANARY_DIR at an existing build of it."
  else
    fail "app dir not found: $APP_DIR" \
      "genericity-check verifies an ALREADY-BUILT app — scaffold + build it first, then point this at its workspace root"
  fi
fi

VERIFY="$REPO_ROOT/scripts/verify-phase.sh"
[ -x "$VERIFY" ] || fail "verify-phase.sh not found/executable at $VERIFY" \
  "the genericity gate drives the real phase gates — ensure scripts/verify-phase.sh is present"

# The BUILD-VERIFY span (NOT Phase 1 — the hub is already warm; smoked in S0 instead).
# Public step numbers: 2.1 Workspace · 2.3 Blueprint Provision · 2.6 Frontend+SDK · 3 UI/Blocks.
PHASES="${PHASES_OVERRIDE:-2.1 2.3 2.6 3}"

# ── app port / base URL ──────────────────────────────────────────────────────
# Precedence: explicit LIVE_QA_BASE_URL → the per-app run-state frontend port/url that wire-app
# PERSISTED (the ALLOCATED free dev port — authoritative, so concurrent apps each hit their OWN
# port) → the brief's frontend_port (only a BASE) → config default (app.portBase). APP_ID is set
# above (from the brief db_name), so we read this app's own build/<app-id>/run-state.json frontend.
state_app_field() {  # $1 = json key under .frontend (frontend_port|base_url|port|url) → scalar
  local sf="$REPO_ROOT/build/run-state.json"
  [ -n "${APP_ID:-}" ] && [ -f "$REPO_ROOT/build/$APP_ID/run-state.json" ] && sf="$REPO_ROOT/build/$APP_ID/run-state.json"
  [ -f "$sf" ] || return 0
  node -e "try{const s=JSON.parse(require('fs').readFileSync('$sf','utf8'));const f=(s&&s.frontend)||{};process.stdout.write(String(f['$1']!=null?f['$1']:''))}catch(e){}" 2>/dev/null || true
}
STATE_APP_URL="$(state_app_field base_url)"; [ -n "$STATE_APP_URL" ] || STATE_APP_URL="$(state_app_field url)"
STATE_APP_PORT="$(state_app_field frontend_port)"; [ -n "$STATE_APP_PORT" ] || STATE_APP_PORT="$(state_app_field port)"
APP_PORT="$STATE_APP_PORT"
[ -n "$APP_PORT" ] || APP_PORT="$(awk -F': ' '$1 ~ /^[[:space:]]*frontend_port$/ { v=$2; gsub(/[^0-9]/,"",v); print v; exit }' "$BRIEF" 2>/dev/null || true)"
[ -n "$APP_PORT" ] || APP_PORT="$(cfg app.portBase 3081)"
if [ -n "${LIVE_QA_BASE_URL:-}" ]; then :; elif [ -n "$STATE_APP_URL" ]; then LIVE_QA_BASE_URL="$STATE_APP_URL"; else LIVE_QA_BASE_URL="http://localhost:$APP_PORT"; fi

START_TS="$(date +%s)"
echo
echo -e "${GREEN}Constructive harness — GENERICITY CHECK (build-verify + Chrome all-flows)${NC}"
hr
info "brief      : $BRIEF"
info "app dir    : $APP_DIR"
info "app URL    : $LIVE_QA_BASE_URL"
info "phases     : $PHASES  (+ live-QA gate on Phase 3)"
[ -n "${LIVE_QA_CRUD_PATH:-}" ] && info "live-QA CRUD path (override): $LIVE_QA_CRUD_PATH"
hr

# ── locate the constructive CLI (only needed if :3000 must be restarted) ────────
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

# ── S0 — smoke the warm backend on :3000; restart ONCE with a big heap if down ──
smoke_backend() {
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:$HUB_PORT/graphql" \
    -H "Host: $HUB_PLATFORM_API_HOST" -H 'content-type: application/json' \
    -d '{"query":"{ __typename }"}' 2>/dev/null || echo "000"
}

echo "S0: smoke the shared warm backend (:3000)"
CODE="$(smoke_backend)"
if [ "$CODE" = "200" ]; then
  pass "backend :3000 answers (HTTP 200) — warm hub, Phase 1 skipped"
else
  warn "backend :3000 returned HTTP $CODE (down / non-200 / OOM)"
  if [ "$NO_RESTART" = "1" ]; then
    fail "backend :3000 is not healthy and --no-restart/GENERICITY_NO_RESTART is set" \
      "start it yourself (SKILL.md S0) or drop --no-restart to let this restart it once with an 8GB heap"
  fi
  CLI="$(discover_constructive_cli || true)"
  [ -n "$CLI" ] || fail "could not locate the constructive CLI to restart :3000" \
    "set CONSTRUCTIVE_CLI=/abs/.../constructive/packages/cli/dist/index.js (the sibling constructive checkout), or start the server yourself per SKILL.md S0"
  info "restarting :3000 ONCE with an 8GB heap via $CLI (SKILL.md S0)"
  API_IS_PUBLIC=true API_ANON_ROLE=anonymous API_ROLE_NAME=authenticated \
  NODE_OPTIONS=--max-old-space-size=8192 \
    node "$CLI" server --port "$HUB_PORT" --host 0.0.0.0 --origin '*' \
    >/tmp/cnc-3000.genericity.log 2>&1 &
  info "waiting for :3000 to come up (up to ~60s; log: /tmp/cnc-3000.genericity.log)"
  UP=""
  for _ in $(seq 1 30); do
    CODE="$(smoke_backend)"
    [ "$CODE" = "200" ] && { UP=1; break; }
    sleep 2
  done
  [ -n "$UP" ] || { tail -n 40 /tmp/cnc-3000.genericity.log 2>/dev/null || true; \
    fail "backend :3000 did not come up after restart" \
      "inspect /tmp/cnc-3000.genericity.log; if it OOMs again the 8192 heap above is already the documented fix (SKILL.md S0)"; }
  pass "backend :3000 healthy after one 8GB-heap restart"
fi
hr

# ── guarded PG* hydration (before the psql-using 2.3 grant/RLS gates) ────────────
if [ -z "${PGHOST:-}" ] && command -v pgpm >/dev/null 2>&1; then
  if PGPM_ENV="$(pgpm env 2>/dev/null)" && [ -n "$PGPM_ENV" ]; then
    eval "$PGPM_ENV"
    export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE 2>/dev/null || true
    info "S0b: hydrated + exported PG* from 'pgpm env' (PGHOST was unset; PGHOST=${PGHOST:-?})"
  else
    warn "S0b: PGHOST unset and 'pgpm env' produced nothing — the 2.3 grant/RLS gates may degrade (run eval \"\$(pgpm env)\" with the hub up; SKILL.md Phase 1)"
  fi
  unset PGPM_ENV
elif [ -n "${PGHOST:-}" ]; then
  info "S0b: PGHOST already set (${PGHOST}) — leaving caller PG* as-is"
fi
hr

# ── run the phase gates against the brief + app dir, with LIVE_QA enabled ────────
# Each phase gate is the SAME script real builds run; --spec is the brief, --workspace
# the built app dir, and LIVE_QA=1 + an ABSOLUTE LIVE_QA_SPEC make Phase 3 drive
# scripts/live-qa.mjs across every acceptance flow. Any LIVE_QA_* env the caller
# exported (CRUD path / entity testids) is inherited by the child gate automatically.
# Per-app run-state (RECON-3): prefer build/<app-id>/run-state.json (APP_ID derived from
# the brief's db_name above), else the LEGACY build/run-state.json singleton.
STATE_ARGS=()
STATE_FILE="$REPO_ROOT/build/run-state.json"
if [ -n "${APP_ID:-}" ] && [ -f "$REPO_ROOT/build/$APP_ID/run-state.json" ]; then
  STATE_FILE="$REPO_ROOT/build/$APP_ID/run-state.json"
fi
[ -f "$STATE_FILE" ] && STATE_ARGS=(--state "$STATE_FILE")

FAILED_PHASE=""
for ph in $PHASES; do
  echo "PHASE $ph: ./scripts/verify-phase.sh $ph --spec <brief> --workspace <app-dir>"
  # "${arr[@]+${arr[@]}}" expands to nothing when STATE_ARGS is empty (no run-state yet)
  # and to the elements otherwise — set-u-safe on bash 3.2 (the macOS default).
  if LIVE_QA=1 \
     LIVE_QA_SPEC="$BRIEF" \
     LIVE_QA_BASE_URL="$LIVE_QA_BASE_URL" \
     "$VERIFY" "$ph" --spec "$BRIEF" --workspace "$APP_DIR" "${STATE_ARGS[@]+${STATE_ARGS[@]}}"; then
    pass "phase $ph green"
  else
    FAILED_PHASE="$ph"
    warn "phase $ph FAILED — stopping the genericity check here"
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
  echo -e "${GREEN}OVERALL: PASS${NC}   (start→OVERALL: ${MM}m${SS}s — time-to-app)"
  hr
  exit 0
else
  echo -e "${RED}OVERALL: FAIL${NC}   (failed at phase ${FAILED_PHASE}; elapsed ${MM}m${SS}s — time-to-app)"
  echo "        Re-run the failed phase verbosely to see the gate's FIX line:"
  echo "          ./scripts/verify-phase.sh ${FAILED_PHASE} --spec \"$BRIEF\" --workspace \"$APP_DIR\""
  echo "        (the live-QA driver's per-flow PASS/FAIL table is in the Phase 3 output above.)"
  hr
  exit 1
fi
