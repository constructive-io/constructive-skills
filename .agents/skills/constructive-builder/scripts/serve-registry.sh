#!/bin/bash
set -euo pipefail

# serve-registry.sh — one deterministic command for the Blocks on-ramp registry.
#
# Replaces the manual "build → npx serve → repoint components.json → curl-verify"
# sequence in references/blocks-onramp.md §4c (and SKILL.md S4c) with a single,
# idempotent step. It:
#   1. auto-discovers the dashboard-blocks registry dir via the AGENTS.md sibling
#      pattern (NEVER a hardcoded /Users/... path),
#   2. builds that registry and asserts a KNOWN FLOW block JSON is present (so a
#      primitives-only / wrong registry fails loudly, not silently),
#   3. serves public/ over HTTP on $REGISTRY_PORT (default 4081), backgrounded,
#      writing a PID file consumed by stop-registry.sh,
#   4. repoints the scaffolded app's components.json registries["@constructive"]
#      at the local server using node (JSON-safe, not sed),
#   5. curl-verifies a FLOW block resolves (200, not 404), and — when
#      REGISTRY_COVERAGE=1 — additionally asserts EVERY flows.json flow block
#      resolves (full coverage, via scripts/check-registry-coverage.mjs).
#
# Usage:
#   ./scripts/serve-registry.sh [REGISTRY_PORT] [APP_DIR]
#     REGISTRY_PORT  port for the static server      (default 4081; or $REGISTRY_PORT)
#     APP_DIR        scaffolded app WORKSPACE ROOT to repoint (optional; or $APP_DIR).
#                    Pass the SAME locator the scaffolders take — the WORKSPACE ROOT;
#                    we DERIVE the dir that holds components.json from it (the root
#                    itself for the single-package nextjs/constructive-app template,
#                    else packages/app, else app). An explicit package dir (the dir
#                    holding components.json) is still accepted for back-compat.
#                    — when omitted, components.json is left untouched and a note
#                      tells you how to point it yourself.
#
# Registry SOURCE (where the block JSON comes from — constructive.config.json
# `registry.source`, overridable by CONSTRUCTIVE_REGISTRY_SOURCE). Three modes; the
# DEFAULT ("sibling") is the long-standing auto-discovery, so a warm local build is
# unchanged. The other two make a build reproducible on a fresh checkout that has NO
# co-located registry beside it:
#   sibling (DEFAULT)  auto-discover a registry checkout placed beside this toolkit
#                      (one parent-dir level), preferring a dashboard-*blocks* worktree.
#   <abs PATH>         serve apps/registry/public from a local registry repo/dir (the
#                      repo root, its apps/registry dir, or the public dir itself).
#   git:<url>#<branch> shallow clone + sparse-checkout the built public tree into a
#                      gitignored cache (.registry-cache/) and serve it (refreshes when
#                      stale). The remote must carry the BUILT public tree. The url +
#                      branch may instead come from registry.url / registry.branch.
# The whole policy lives in scripts/lib/registry-source.mjs (shared with the coverage
# check); this script just consumes its resolution.
#
# Env (override the configured source / build):
#   CONSTRUCTIVE_REGISTRY_SOURCE  one of the three source values above (wins over config).
#   REGISTRY_DIR       absolute path to a registry `apps/registry` dir (its `public/` is
#                      served). Honored in the DEFAULT sibling mode — skips auto-discovery.
#   REGISTRY_FORCE_BUILD=1  force a registry rebuild even if the cache looks fresh
#                      (build-capable sibling/PATH modes only; a git source is prebuilt).
#   REGISTRY_COVERAGE=1     after the single-block verify, also assert FULL coverage —
#                      every flows.json flow block resolves (step 5b). OFF by default so
#                      the common serve-then-install loop stays fast.
#
# Exit: 0 served + verified · non-zero on any build/serve/verify failure.

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

# Read a value from constructive.config.json (the single infra source-of-truth).
# Falls back to the literal $2 if the loader can't resolve it (e.g. node missing),
# so this script still runs standalone. Defaults below equal today's values.
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }

# Canonical registry port (drift-gated by check-harness-drift.mjs). Default 4081,
# from constructive.config.json (positional arg / $REGISTRY_PORT still win).
REGISTRY_PORT="${1:-${REGISTRY_PORT:-$(cfg registry.port 4081)}}"
# Optional app WORKSPACE ROOT to repoint (positional arg wins over env). The dir that
# actually holds components.json is DERIVED from this (derive_components_dir below), so
# callers pass the same locator the scaffolders take and need not know the package nesting.
APP_DIR="${2:-${APP_DIR:-}}"

# ---------------------------------------------------------------------------
# Shared app-locator → components.json dir (Gap5a).
# serve-registry needs the dir that HOLDS components.json; the scaffolders (and our
# callers) hand us a WORKSPACE ROOT. Derive it: return the locator itself when it holds
# components.json (single-package nextjs/constructive-app template — or an explicit
# package dir passed for back-compat), else probe <locator>/packages/app (nested
# template layout), else <locator>/app (legacy). Fail LOUDLY when none resolves so a
# wrong/empty locator can never silently leave components.json un-repointed.
#   $1 = app locator (workspace root, or an explicit package dir)
#   echoes the resolved dir on success; calls fail() (exits) when unresolvable.
# ---------------------------------------------------------------------------
derive_components_dir() {
  local base="$1" cand
  if [ -f "$base/components.json" ]; then
    echo "$base"
    return 0
  fi
  for cand in "$base/packages/app" "$base/app"; do
    if [ -f "$cand/components.json" ]; then
      echo "$cand"
      return 0
    fi
  done
  fail "could not locate components.json under app locator '$base' (tried '$base', '$base/packages/app', '$base/app')" \
    "pass the scaffolded app WORKSPACE ROOT as the 2nd arg (or APP_DIR=) — the dir the scaffolders write to. We derive the package that holds components.json from it (root for the single-package nextjs/constructive-app template, else packages/app, else app). If your app lives elsewhere, point at the package dir that directly contains components.json."
}

# A KNOWN FLOW block — its presence after build distinguishes the dashboard-blocks
# registry (carries auth/account/org FLOW blocks) from a primitives-only registry.
KNOWN_FLOW_BLOCK="auth-sign-in-card"

# PID file (consumed by stop-registry.sh). Kept under the harness so teardown finds it.
RUN_DIR="$REPO_ROOT/.run"
PID_FILE="$RUN_DIR/registry-serve.pid"
mkdir -p "$RUN_DIR"

# ---------------------------------------------------------------------------
# 1. Resolve the registry SOURCE (config-driven; see the header). The whole policy
#    — sibling auto-discovery (DEFAULT), a local PATH, or a git clone+cache — lives
#    in scripts/lib/registry-source.mjs, shared with check-registry-coverage.mjs so
#    both honor the SAME source. We consume its JSON resolution:
#      mode           sibling | path | git
#      publicDir      the dir to SERVE (always holds r/<slug>.json)
#      registryAppDir the build-capable apps/registry dir (sibling/path; null for git)
#      prebuilt       1 for git (already-built clone — skip the build step)
#    The DEFAULT sibling resolution is byte-for-byte the old auto-discovery (it also
#    still honors REGISTRY_DIR), so a warm local build is unchanged. Fail LOUD with an
#    actionable message when no source resolves.
# ---------------------------------------------------------------------------
SOURCE_RESOLVER="$SCRIPT_DIR/lib/registry-source.mjs"
SRC_JSON=""
if [ -f "$SOURCE_RESOLVER" ]; then
  SRC_JSON="$(node "$SOURCE_RESOLVER" resolve 2>/tmp/.serve-registry-resolve.$$)" || {
    sed 's/^/  /' /tmp/.serve-registry-resolve.$$ 2>/dev/null >&2 || true
    rm -f /tmp/.serve-registry-resolve.$$
    fail "could not resolve a registry source (registry.source = $(cfg registry.source sibling))" \
      "set registry.source in constructive.config.json (or CONSTRUCTIVE_REGISTRY_SOURCE) to \"sibling\" (auto-discover a registry checkout beside this toolkit), an absolute registry PATH, or \"git:<url>#<branch>\"; see the message above for the exact reason"
  }
  rm -f /tmp/.serve-registry-resolve.$$
else
  fail "registry source resolver missing: $SOURCE_RESOLVER" "this toolkit checkout is incomplete — restore scripts/lib/registry-source.mjs"
fi

# Pull the fields out of the JSON via the config loader's host (node) — no jq dep.
read_src() { printf '%s' "$SRC_JSON" | SRC_KEY="$1" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const v=o[process.env.SRC_KEY];process.stdout.write(v==null?"":String(v));}catch{process.exit(1);}})' 2>/dev/null; }
REGISTRY_MODE="$(read_src mode)"
PUBLIC_DIR="$(read_src publicDir)"
REGISTRY_APP_DIR="$(read_src registryAppDir)"
REGISTRY_PREBUILT="$(read_src prebuilt)"
SOURCE_DETAIL="$(read_src detail)"

[ -n "$PUBLIC_DIR" ] || fail "registry source resolver returned no public dir" \
  "check registry.source in constructive.config.json (CONSTRUCTIVE_REGISTRY_SOURCE) — run: node scripts/lib/registry-source.mjs resolve"
info "registry source: mode=$REGISTRY_MODE — $SOURCE_DETAIL"
[ -n "$REGISTRY_APP_DIR" ] && info "registry app dir: $REGISTRY_APP_DIR"
info "serving public dir: $PUBLIC_DIR"

KNOWN_BLOCK_JSON="$PUBLIC_DIR/r/$KNOWN_FLOW_BLOCK.json"

# ---------------------------------------------------------------------------
# 2. Build the registry (CACHED), then assert the KNOWN FLOW block JSON exists.
#    Run the build from the registry's OWN package (its build script writes
#    public/r/*.json). We prefer the workspace-filtered build so it works from
#    any cwd; fall back to running the package's build script in place.
#
#    SPEED: rebuilding the dashboard-blocks registry is a multi-second-to-minute
#    sink, and it is fully deterministic from its sources (registry.json + the
#    registry/ + src/ trees + scripts/build.mjs). So we SKIP the build when the
#    built output is already up to date — i.e. the KNOWN block JSON exists AND no
#    source input is newer than it (`find -newer` returns nothing). Correctness is
#    preserved: the presence assertion + the curl-verify at the end still run, so a
#    stale or wrong cache can never silently serve a missing block. Force a rebuild
#    with REGISTRY_FORCE_BUILD=1 (or just `touch` a source / delete public/r).
# ---------------------------------------------------------------------------
# A git source is served PREBUILT (the clone carries the built public tree) and has no
# build-capable apps/registry package, so the build step is skipped for it — the
# presence assertion below still runs, so a clone missing the FLOW block fails loud.
needs_build=1
if [ "$REGISTRY_PREBUILT" = "1" ] || [ -z "$REGISTRY_APP_DIR" ]; then
  needs_build=0
  info "registry build SKIPPED — source is prebuilt (mode=$REGISTRY_MODE); serving $PUBLIC_DIR as-is"
elif [ "${REGISTRY_FORCE_BUILD:-0}" != "1" ] && [ -f "$KNOWN_BLOCK_JSON" ]; then
  # Collect the source inputs that actually exist, then ask whether ANY is newer than
  # the built sentinel. No newer input → the cache is fresh → skip the build.
  cache_inputs=()
  for src in "$REGISTRY_APP_DIR/registry.json" "$REGISTRY_APP_DIR/registry" \
             "$REGISTRY_APP_DIR/src" "$REGISTRY_APP_DIR/scripts" "$REGISTRY_APP_DIR/package.json"; do
    [ -e "$src" ] && cache_inputs+=("$src")
  done
  if [ "${#cache_inputs[@]}" -gt 0 ]; then
    newer="$(find "${cache_inputs[@]}" -newer "$KNOWN_BLOCK_JSON" -print -quit 2>/dev/null || true)"
    if [ -z "$newer" ]; then
      needs_build=0
      info "registry build SKIPPED — built output is up to date (no source newer than $KNOWN_BLOCK_JSON; set REGISTRY_FORCE_BUILD=1 to force)"
    fi
  fi
fi

if [ "$needs_build" = "1" ]; then
  info "building registry (this can take a minute)…"
  build_ok=""
  if command -v pnpm >/dev/null 2>&1; then
    if pnpm --dir "$REGISTRY_APP_DIR" run build >/dev/null 2>&1; then build_ok=1; fi
  fi
  if [ -z "$build_ok" ]; then
    # Fallback: invoke the build script directly (matches package.json "build": node scripts/build.mjs).
    if [ -f "$REGISTRY_APP_DIR/scripts/build.mjs" ] \
       && ( cd "$REGISTRY_APP_DIR" && node scripts/build.mjs ) >/dev/null 2>&1; then
      build_ok=1
    fi
  fi
  [ -n "$build_ok" ] || fail "registry build failed in $REGISTRY_APP_DIR" \
    "run it directly to see the error: pnpm --dir \"$REGISTRY_APP_DIR\" run build"
fi

# Assert the FLOW block is present — guards against a wrong/primitives registry, a stale
# cache, OR a fetched/local source whose public tree lacks the FLOW blocks.
if [ ! -f "$KNOWN_BLOCK_JSON" ]; then
  fail "FLOW block '$KNOWN_FLOW_BLOCK' is MISSING at $KNOWN_BLOCK_JSON (mode=$REGISTRY_MODE)" \
    "the resolved registry source carries UI primitives only (or its public tree is unbuilt). The auth/account/org FLOW blocks live in the dashboard-blocks registry's public tree — point registry.source (CONSTRUCTIVE_REGISTRY_SOURCE) at that registry: \"sibling\" (a checkout beside this toolkit, or REGISTRY_DIR=/abs/.../apps/registry), an absolute PATH to it, or \"git:<url>#<branch>\" of a branch that publishes its built apps/registry/public, then re-run"
fi
[ "$needs_build" = "1" ] && pass "registry built; FLOW block '$KNOWN_FLOW_BLOCK' present" \
  || pass "registry ready (no build needed); FLOW block '$KNOWN_FLOW_BLOCK' present"

# ---------------------------------------------------------------------------
# 3. Serve public/ over HTTP on $REGISTRY_PORT, backgrounded, with a PID file.
#    Idempotent: if a live server from a prior run already answers on the port,
#    reuse it instead of starting a second one.
# ---------------------------------------------------------------------------
# Served base URL: config scheme+host + the active port (so a caller-supplied
# REGISTRY_PORT still reflects in the URL). Defaults to http://localhost:<port>.
REGISTRY_SCHEME="$(cfg registry.scheme http)"
REGISTRY_HOST="$(cfg registry.host localhost)"
serve_url="${REGISTRY_SCHEME}://${REGISTRY_HOST}:$REGISTRY_PORT"
known_url="$serve_url/r/$KNOWN_FLOW_BLOCK.json"

already_up=""
if curl -sf -o /dev/null "$known_url" 2>/dev/null; then
  already_up=1
  info "a registry already answers on :$REGISTRY_PORT — reusing it"
fi

if [ -z "$already_up" ]; then
  # If a stale PID file points at a dead/foreign process, clear it before starting.
  if [ -f "$PID_FILE" ]; then
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      info "stopping stale registry server (pid $old_pid) from a prior run"
      kill "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  SERVE_LOG="$RUN_DIR/registry-serve.log"
  info "starting static server on :$REGISTRY_PORT (log: $SERVE_LOG)"
  # `npx serve -l <port> <dir>` serves the dir; -l binds the port. --yes avoids the install prompt.
  nohup npx --yes serve -l "$REGISTRY_PORT" "$PUBLIC_DIR" >"$SERVE_LOG" 2>&1 &
  serve_pid=$!
  echo "$serve_pid" >"$PID_FILE"
  info "registry server pid $serve_pid → $PID_FILE"

  # Poll for readiness (server install + boot can take a few seconds on first run).
  ready=""
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$known_url" 2>/dev/null; then ready=1; break; fi
    # If the process died, stop waiting and surface its log.
    if ! kill -0 "$serve_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ -z "$ready" ]; then
    warn "server did not become ready in time; last log lines:"
    tail -n 20 "$SERVE_LOG" 2>/dev/null || true
    fail "registry server failed to serve $known_url on :$REGISTRY_PORT" \
      "check the log at $SERVE_LOG (port in use? wrong dir?), then re-run; stop a stuck server with ./scripts/stop-registry.sh"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Repoint the scaffolded app's components.json (JSON-safe, via node — NOT sed).
#    Only when an APP_DIR is supplied. Rewrites registries["@constructive"] to
#    the local server URL, preserving every other key.
# ---------------------------------------------------------------------------
if [ -n "$APP_DIR" ]; then
  # Derive the dir that HOLDS components.json from the WORKSPACE ROOT (fails loudly if none).
  APP_PKG_DIR="$(derive_components_dir "$APP_DIR")"
  COMPONENTS_JSON="$APP_PKG_DIR/components.json"
  [ "$APP_PKG_DIR" = "$APP_DIR" ] || info "derived app package dir from workspace root: $APP_PKG_DIR"
  REGISTRY_URL="$serve_url/r/{name}.json" \
  COMPONENTS_JSON="$COMPONENTS_JSON" \
  node -e '
    const fs = require("node:fs");
    const file = process.env.COMPONENTS_JSON;
    const url = process.env.REGISTRY_URL;
    let json;
    try { json = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { console.error("components.json is not valid JSON: " + e.message); process.exit(1); }
    json.registries = json.registries || {};
    json.registries["@constructive"] = url;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    console.log("  INFO: components.json registries[\"@constructive\"] = " + url);
  ' || fail "failed to rewrite $COMPONENTS_JSON" "ensure it is valid JSON, then re-run"
  pass "components.json @constructive repointed → $serve_url/r/{name}.json"
else
  info "no APP_DIR given — components.json NOT modified."
  info "point your app yourself: set components.json registries[\"@constructive\"] = \"$serve_url/r/{name}.json\""
fi

# ---------------------------------------------------------------------------
# 5. Final verification — the FLOW block resolves with HTTP 200 (not 404).
# ---------------------------------------------------------------------------
http_code="$(curl -s -o /dev/null -w '%{http_code}' "$known_url" 2>/dev/null || echo 000)"
if [ "$http_code" != "200" ]; then
  fail "GET $known_url returned HTTP $http_code (expected 200)" \
    "the server is up but not serving the registry JSON — confirm \$PUBLIC_DIR holds r/$KNOWN_FLOW_BLOCK.json and the port is free; stop with ./scripts/stop-registry.sh and re-run"
fi
pass "verified $known_url → HTTP 200"

# ---------------------------------------------------------------------------
# 5b. OPTIONAL full coverage gate — assert the served registry covers EVERY flow
#     block the harness's references/flows.json references (not just the one
#     KNOWN_FLOW_BLOCK sentinel above). The sentinel proves "this is a flow
#     registry, not primitives-only"; coverage proves "no flow block is MISSING"
#     — catching a PARTIAL registry (e.g. has auth-sign-in-card but lacks
#     org-roles-editor / use-step-up) before an agent 404s mid-`shadcn add`.
#
#     GATED so the fast path stays fast: OFF by default (the single curl above is
#     enough for the common serve-then-install loop). Enable with REGISTRY_COVERAGE=1
#     to run scripts/check-registry-coverage.mjs in ONLINE mode against this very
#     server — on a primitives-only / partial registry it FAILS with the exact list
#     of missing slugs (not just the one sentinel).
# ---------------------------------------------------------------------------
if [ "${REGISTRY_COVERAGE:-0}" = "1" ]; then
  COVERAGE_MJS="$SCRIPT_DIR/check-registry-coverage.mjs"
  if [ ! -f "$COVERAGE_MJS" ]; then
    warn "REGISTRY_COVERAGE=1 but $COVERAGE_MJS not found — skipping full coverage gate"
  else
    info "REGISTRY_COVERAGE=1 — asserting full flows.json coverage on :$REGISTRY_PORT"
    cov_rc=0
    REGISTRY_PORT="$REGISTRY_PORT" REGISTRY_BASE="$serve_url" \
      node "$COVERAGE_MJS" --online || cov_rc=$?
    if [ "$cov_rc" != "0" ]; then
      fail "registry served on :$REGISTRY_PORT does NOT cover every flows.json flow block (see the missing-slug list above)" \
        "the resolved registry source (mode=$REGISTRY_MODE) is a primitives-only or PARTIAL flow registry. The auth/account/org FLOW blocks live in the dashboard-blocks registry's public tree — point registry.source (CONSTRUCTIVE_REGISTRY_SOURCE) at it (\"sibling\" / an absolute PATH / \"git:<url>#<branch>\"), rebuild a build-capable source with REGISTRY_FORCE_BUILD=1, and re-run"
    fi
    pass "full coverage: every flows.json flow block resolves on :$REGISTRY_PORT"
  fi
fi

echo
echo "registry served at :$REGISTRY_PORT"
