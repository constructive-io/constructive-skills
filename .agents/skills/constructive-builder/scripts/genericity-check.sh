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

# ── shared preamble + phase-runner machinery (one copy, in lib/) ────────────────
# sh-common.sh: RED/GREEN/YELLOW/NC + pass/fail/warn/info/hr + SCRIPT_DIR/REPO_ROOT.
# phase-runner.sh: cfg / resolve_app_id / state_dir / pr_hub_coords / discover_constructive_cli /
#   smoke_backend / pr_s0_smoke_and_restart / pr_pg_hydrate / state_app_field / pr_resolve_app_url /
#   pr_run_phases — the S0-smoke, PG-hydration, app-URL and phase-loop boilerplate this script and
#   golden-path.sh share byte-for-byte (the consumers pass the few differing strings as args).
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/sh-common.sh
. "$_LIB_DIR/sh-common.sh"
# shellcheck source=lib/phase-runner.sh
. "$_LIB_DIR/phase-runner.sh"

# Infra coordinates (HUB_PORT + platform api endpoint + Host header) from constructive.config.json.
pr_hub_coords

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
# pr_resolve_app_url (lib/phase-runner.sh) sets LIVE_QA_BASE_URL with the unchanged precedence:
# explicit LIVE_QA_BASE_URL → the per-app run-state frontend port/url wire-app PERSISTED (the
# ALLOCATED free dev port) → the brief's frontend_port (a BASE) → config default (app.portBase).
# APP_ID is set above (from the brief db_name), so it reads this app's own build/<app-id>/run-state.
pr_resolve_app_url

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

# ── DESIGN rot-canary (hermetic — no backend / no built app needed) ──────────────
# Proves the ONE surviving design check stays GENERIC + correct as a standing canary,
# the same way the four app tiers above guard the build span. Post-pivot there is no
# compiler and no wire-design step: the design.md is the spec the AGENT authors the
# frontend from, and the only machine check is FUNCTIONAL — does a built globals.css
# satisfy the shadcn-token + Tailwind-v4 contract so Blocks render? This canary drives
# that validator directly (check-design.mjs --globals) on synthesized CSS, self-contained
# (a temp globals.css; no network, no DB, no fixtures):
#   1. a COMPLETE globals.css (all shadcn token names in :root + .dark + the Tailwind-v4
#      wiring) PASSES (exit 0) — the validator accepts a contract-satisfying app.
#   2. a BROKEN globals.css (one shadcn token name dropped) FAILS (exit 1) — the validator
#      still catches the regression that would render Blocks unstyled.
# Skips gracefully (warn, never fail the canary) only if node or check-design.mjs is absent.
design_rot_canary() {
  command -v node >/dev/null 2>&1 || { warn "design rot-canary: 'node' not on PATH — skipped (not failing)"; return 0; }
  local check_design="$REPO_ROOT/scripts/check-design.mjs"
  if [ ! -f "$check_design" ]; then
    warn "design rot-canary: scripts/check-design.mjs missing — skipped (not failing)"
    return 0
  fi

  # The canonical shadcn token contract (the 40 names; radius is a scalar handled separately).
  # GENERIC: token NAMES only — no app/entity/flow/domain literal, no brand name.
  local names=(
    background foreground card card-foreground popover popover-foreground
    primary primary-foreground secondary secondary-foreground muted muted-foreground
    accent accent-foreground destructive destructive-foreground border input ring
    chart-1 chart-2 chart-3 chart-4 chart-5
    sidebar sidebar-foreground sidebar-primary sidebar-primary-foreground
    sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring
    info info-foreground success success-foreground warning warning-foreground
  )

  # Emit a contract-satisfying globals.css to $1, with the value $2 for every color token.
  # Includes the Tailwind-v4 wiring the validator hard-requires: @import 'tailwindcss', a
  # non-empty @theme inline carrying --color-*: var(--*) maps, @custom-variant dark, a @source.
  _emit_good_globals() {
    local out="$1" val="$2" n
    {
      echo "@import 'tailwindcss';"
      echo '@custom-variant dark (&:is(.dark *));'
      echo '@source "../";'
      echo ':root {'
      for n in "${names[@]}"; do echo "  --${n}: ${val};"; done
      echo '  --radius: 0.5rem;'
      echo '}'
      echo '.dark {'
      for n in "${names[@]}"; do echo "  --${n}: ${val};"; done
      echo '}'
      echo '@theme inline {'
      for n in "${names[@]}"; do echo "  --color-${n}: var(--${n});"; done
      echo '  --radius-md: var(--radius);'
      echo '}'
    } > "$out"
  }

  local tmp; tmp="$(mktemp -d)"

  # 1) a COMPLETE globals.css must PASS the validator (exit 0).
  _emit_good_globals "$tmp/good.css" "oklch(0.5 0.05 250)"
  if node "$check_design" --globals "$tmp/good.css" >/dev/null 2>&1; then
    pass "design rot-canary: a complete globals.css PASSES the Blocks token-contract validator (exit 0)"
  else
    rm -rf "$tmp"
    fail "design rot-canary: a complete globals.css was REJECTED by check-design.mjs --globals" "the Blocks-contract validator (check-design.mjs --globals) no longer accepts a contract-satisfying globals.css — it should pass when every shadcn token name is in :root + .dark and the @theme inline/@custom-variant dark/@source wiring is present. Fix scripts/check-design.mjs."
  fi

  # 2) a BROKEN globals.css (one shadcn token name dropped from :root) must FAIL (exit 1).
  _emit_good_globals "$tmp/broken.css" "oklch(0.5 0.05 250)"
  # Drop the FIRST occurrence of --primary: (the :root declaration) so a contract name is missing.
  awk 'BEGIN{done=0} /^[[:space:]]*--primary:/ && !done {done=1; next} {print}' "$tmp/broken.css" > "$tmp/broken.css.tmp" && mv "$tmp/broken.css.tmp" "$tmp/broken.css"
  local bstatus=0
  node "$check_design" --globals "$tmp/broken.css" >/dev/null 2>&1 || bstatus="$?"
  if [ "$bstatus" -eq 1 ]; then
    pass "design rot-canary: a globals.css missing a shadcn token name is REJECTED by the validator (exit 1)"
    rm -rf "$tmp"
  else
    rm -rf "$tmp"
    fail "design rot-canary: a broken globals.css (dropped shadcn token name) was NOT rejected (got exit $bstatus, expected 1)" "the Blocks-contract validator must HARD-FAIL (exit 1, rail2-name-missing) when a shadcn token name is missing from :root/.dark — a build that drops one would otherwise ship unstyled Blocks. Fix scripts/check-design.mjs."
  fi
  unset -f _emit_good_globals
}
design_rot_canary
hr

# ── S0 — smoke the warm backend on :3000; restart ONCE with a big heap if down ──
# pr_s0_smoke_and_restart (lib/phase-runner.sh) does the smoke + one-shot 8GB-heap restart; the
# constructive CLI is auto-discovered the AGENTS.md sibling way (never a hardcoded path). Args:
# no-restart flag, restart log file, warm-hub PASS tail, the --no-restart env var name, the actor
# phrase in that fail's FIX.
pr_s0_smoke_and_restart "$NO_RESTART" /tmp/cnc-3000.genericity.log "Phase 1 skipped" GENERICITY_NO_RESTART "this"
hr

# ── guarded PG* hydration (before the psql-using 2.3 grant/RLS gates) ────────────
# pr_pg_hydrate (lib/phase-runner.sh) exports the hub's PG* from `pgpm env` once (guarded: no-op when
# PG* are already set or pgpm is absent), so the child grant/RLS gates don't silently degrade.
pr_pg_hydrate "2.3"
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

# pr_run_phases (lib/phase-runner.sh) runs verify-phase.sh across $PHASES against the brief + app dir
# with LIVE_QA=1, forwards STATE_ARGS set-u-safely, and sets FAILED_PHASE ("" on full success). Any
# LIVE_QA_* the caller exported (CRUD path / entity testids) is inherited by the child gate. The
# header tail mirrors the line this script always printed.
pr_run_phases "$PHASES" "$VERIFY" "$BRIEF" "$APP_DIR" "genericity check" "--spec <brief> --workspace <app-dir>"

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
