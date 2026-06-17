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

# ── shared preamble + phase-runner machinery (one copy, in lib/) ────────────────
# sh-common.sh: RED/GREEN/YELLOW/NC + pass/fail/warn/info/hr + SCRIPT_DIR/REPO_ROOT.
# phase-runner.sh: cfg / resolve_app_id / state_dir / pr_hub_coords / discover_constructive_cli /
#   smoke_backend / pr_s0_smoke_and_restart / pr_pg_hydrate / state_app_field / pr_resolve_app_url /
#   pr_run_phases — the S0-smoke, PG-hydration, app-URL and phase-loop boilerplate this script and
#   genericity-check.sh share byte-for-byte (the consumers pass the few differing strings as args).
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/sh-common.sh
. "$_LIB_DIR/sh-common.sh"
# shellcheck source=lib/phase-runner.sh
. "$_LIB_DIR/phase-runner.sh"

# Infra coordinates (HUB_PORT + platform api endpoint + Host header) from constructive.config.json.
pr_hub_coords

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
# pr_resolve_app_url (lib/phase-runner.sh) sets LIVE_QA_BASE_URL with the unchanged precedence: an
# explicit LIVE_QA_BASE_URL → the per-app run-state frontend port/url wire-app PERSISTED (the
# ALLOCATED free dev port) → the brief's frontend_port (a BASE) → config default (app.portBase). It
# reads $BRIEF (resolved above) and this app's run-state (per-app build/<app-id>/, else legacy build/).
pr_resolve_app_url

START_TS="$(date +%s)"
echo
echo -e "${GREEN}Constructive harness — GOLDEN PATH (rot canary)${NC}"
hr
info "brief      : $BRIEF"
info "workspace  : $WORKSPACE"
info "app URL    : $LIVE_QA_BASE_URL"
info "phases     : $PHASES  (+ live-QA gate on Phase 3)"
hr

# ── S0 — smoke the warm backend on :3000; restart ONCE with a big heap if down ──
# pr_s0_smoke_and_restart (lib/phase-runner.sh) does the smoke + one-shot 8GB-heap restart; the
# constructive CLI is auto-discovered the AGENTS.md sibling way (never a hardcoded path). Args:
# no-restart flag, restart log file, warm-hub PASS tail, the --no-restart env var name, the actor
# phrase in that fail's FIX.
pr_s0_smoke_and_restart "$NO_RESTART" /tmp/cnc-3000.golden.log "Phase 1 is a no-op" GOLDEN_NO_RESTART "golden-path"
hr

# ── guarded PG* hydration (before the psql-using 2.x grant/RLS gates) ────────────
# pr_pg_hydrate (lib/phase-runner.sh) exports the hub's PG* from `pgpm env` once (guarded: no-op when
# PG* are already set or pgpm is absent), so the child grant/RLS gates don't silently degrade.
pr_pg_hydrate "2.x"
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

# pr_run_phases (lib/phase-runner.sh) runs verify-phase.sh across $PHASES against the golden brief +
# workspace with LIVE_QA=1, forwards STATE_ARGS set-u-safely, and sets FAILED_PHASE ("" on full
# success). LIVE_QA=1 only matters on the UI phase (3); harmless elsewhere. The header tail mirrors
# the line this script always printed.
pr_run_phases "$PHASES" "$VERIFY" "$BRIEF" "$WORKSPACE" "golden path" "--spec <golden-brief>"

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
