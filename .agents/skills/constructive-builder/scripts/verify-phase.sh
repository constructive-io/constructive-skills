#!/bin/bash
set -euo pipefail

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

# ── infra coordinates from constructive.config.json (single source-of-truth) ────
# cfg / cfg_endpoint read one resolved value; each falls back to the literal $2 / its
# own default if the loader can't run (so this script still works standalone). Defaults
# equal today's values — only WHERE a value is read changes, not WHAT it defaults to.
# (|| true keeps these from tripping `set -e` when node is absent.)
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }
cfg_endpoint() { node "$SCRIPT_DIR/lib/config.mjs" endpoint "$@" 2>/dev/null || true; }
# Host header (no scheme/port/path) from a built endpoint URL.
endpoint_host() { printf '%s' "$1" | sed -e 's#^[a-z]*://##' -e 's#:[0-9]*/graphql$##' -e 's#/graphql$##'; }
PG_HUB_DATABASE="$(cfg db.hubDatabase constructive)"

# ── app-identity helpers (shared via lib/brief.mjs — one definition, not three) ──
# resolve_app_id <brief-file>: per-app build-state id (plain lowercase [a-z0-9]) from the
# brief's db_name. Tolerant: missing/unreadable brief → empty + exit 0, exactly like the
# old `awk … 2>/dev/null || true`.
resolve_app_id() {
  node -e 'import(process.argv[1]).then(m=>{try{process.stdout.write(m.resolveAppId(require("fs").readFileSync(process.argv[2],"utf8")))}catch(e){}}).catch(()=>{})' \
    "$SCRIPT_DIR/lib/brief.mjs" "$1" 2>/dev/null || true
}
# resolve_subdomain_id <db-name>: the GraphQL subdomain from the two RESOLVING steps of
# lib/brief.mjs subdomainFor() — run-state $STATE_PATH database.subdomain → platform psql
# lookup — returning EMPTY when neither resolved (noFallback:true). resolve_subdomain()
# below applies the db-name fallback + the historical `warn`, so this matches the old
# inline behaviour exactly (stdout AND stderr). STATE_PATH + PG_HUB_DATABASE are read from
# the environment the helper inherits, so the precedence is identical.
resolve_subdomain_id() {
  STATE_PATH="${STATE_PATH:-}" PG_HUB_DATABASE="$PG_HUB_DATABASE" \
  node -e 'import(process.argv[1]).then(m=>{try{process.stdout.write(m.subdomainFor(process.argv[2],{noFallback:true}))}catch(e){}}).catch(()=>{})' \
    "$SCRIPT_DIR/lib/brief.mjs" "$1" 2>/dev/null || true
}

# Per-app build-state dir (RECON-3 state convention). APP_ID (or --app) selects build/<app-id>/;
# unset = legacy build/. APP_ID is the brief's naming.db_name (plain lowercase) so one token
# disambiguates brief + state + port + flows; $APP_ID is the env escape hatch. This ONLY changes
# the FALLBACKS below (explicit --spec/--state still win), so with APP_ID UNSET every reader
# collapses to the EXACT legacy chain — golden-path/canary/check-scaffold stay byte-equal.
: "${APP_ID:=}"
state_dir() {                       # echoes build/<app-id> when APP_ID set, else build
  if [ -n "${APP_ID:-}" ]; then echo "$REPO_ROOT/build/$APP_ID"; else echo "$REPO_ROOT/build"; fi
}

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

spec_value() {
  local key="$1"
  if [ -z "$SPEC_PATH" ] || [ ! -f "$SPEC_PATH" ]; then
    return 1
  fi

  awk -F': ' -v key="$key" '
    $1 ~ "^[[:space:]]*" key "$" {
      val = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
      gsub(/^"/, "", val)
      gsub(/"$/, "", val)
      print val
      exit
    }
  ' "$SPEC_PATH"
}

spec_table_names() {
  if [ -z "$SPEC_PATH" ] || [ ! -f "$SPEC_PATH" ]; then
    return 1
  fi

  awk '
    /^[[:space:]]*tables:/ { in_tables = 1; next }
    in_tables && /^[[:space:]]*relations:/ { in_tables = 0 }
    in_tables && /^[[:space:]]{2,4}-[[:space:]]*name:/ {
      line = $0
      sub(/.*name:[[:space:]]*/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print line
    }
  ' "$SPEC_PATH"
}

resolve_app_package() {
  local app_package
  app_package="$(spec_value app_package || true)"
  if [ -n "$app_package" ]; then
    echo "$app_package"
    return
  fi

  local package_json
  package_json="$(workspace_path "$(app_rel)/package.json")"
  if [ -f "$package_json" ]; then
    node -e "console.log(require(process.argv[1]).name)" "$package_json"
  fi
}

# Resolve the SDK the frontend imports. Two supported layouts (F8):
#   (A) standalone SDK package  sdk/sdk  (the OPTIONAL extension, SKILL public 2.5)
#   (B) the mainline template per-DB SDK at <app>/src/graphql/sdk, imported via the
#       `@sdk/{admin,auth,app}` aliases (SKILL Phase 3 — `pnpm codegen` output)
# Preference: an explicit spec `sdk_package`, then a real standalone `sdk/sdk` package,
# else fall back to the IN-APP SDK marker `@sdk/` so the mainline (which has no standalone
# package) does not false-fail "Could not resolve SDK package name".
resolve_sdk_package() {
  local sdk_package
  sdk_package="$(spec_value sdk_package || true)"
  if [ -n "$sdk_package" ]; then
    echo "$sdk_package"
    return
  fi

  local package_json
  package_json="$(workspace_path "sdk/sdk/package.json")"
  if [ -f "$package_json" ]; then
    node -e "console.log(require(process.argv[1]).name)" "$package_json"
    return
  fi

  # No standalone SDK package — mainline template layout. Signal the in-app SDK marker.
  local app_root
  app_root="$(app_rel)"
  if [ -d "$(workspace_path "$app_root/src/graphql/sdk")" ]; then
    echo "@sdk/"
  fi
}

resolve_app_source_dir() {
  local app_root
  app_root="$(app_rel)"
  if [ -d "$(workspace_path "$app_root/app")" ]; then
    echo "$app_root/app"
    return
  fi
  if [ -d "$(workspace_path "$app_root/pages")" ]; then
    echo "$app_root/pages"
    return
  fi
  if [ -d "$(workspace_path "$app_root/src")" ]; then
    echo "$app_root/src"
    return
  fi
}

resolve_workspace_root() {
  if [ -n "$WORKSPACE_OVERRIDE" ]; then
    echo "$WORKSPACE_OVERRIDE"
    return
  fi

  local spec_workspace
  spec_workspace="$(spec_value workspace_root || true)"
  if [ -n "$spec_workspace" ]; then
    if [[ "$spec_workspace" = /* ]]; then
      echo "$spec_workspace"
    else
      echo "$REPO_ROOT/$spec_workspace"
    fi
    return
  fi

  if [ -f "$PWD/pgpm.json" ]; then
    echo "$PWD"
    return
  fi

  echo "$PWD"
}

WORKSPACE_ROOT="$(resolve_workspace_root)"

workspace_path() {
  local rel="$1"
  if [[ "$rel" = /* ]]; then
    echo "$rel"
  else
    echo "$WORKSPACE_ROOT/$rel"
  fi
}

# Resolve the frontend app PACKAGE, returned as a path RELATIVE to WORKSPACE_ROOT.
#
# CONTRACT (shared app-locator, Gap5a): callers pass a WORKSPACE ROOT (the dir the
# scaffolders write to), and this derives the app package inside it — they no longer
# have to hand us the package dir. Because the mainline `nextjs/constructive-app`
# template is a SINGLE-PACKAGE layout (its components.json/package.json/src all live at
# the workspace root, with only packages/provision beside them), the workspace root IS
# the app package there; other layouts nest it under packages/app (or a legacy app/).
# Passing an explicit package dir still works (back-compat): a package dir holds the
# marker, so the marker check returns `.` for it too.
#
# Resolution (the order the task prescribes, with the spec override kept first):
#   1. an explicit `app_root` in the spec (app-brief.yaml) — escape hatch, wins.
#   2. the WORKSPACE ROOT itself when it holds the app-package MARKER
#      (components.json, OR package.json + src/) → `.`  (single-package template /
#      an explicit package dir passed as the locator).
#   3. `packages/app/` if it exists (nested sandbox-template layout).
#   4. root-level `app/` if it exists (legacy layout).
#   5. fall back to `app` — UNRESOLVED. We don't hard-fail here (app_rel is called
#      inside many command substitutions); instead the downstream phase gates fail
#      LOUDLY with a concrete message (e.g. "$APP_ROOT/ not found" at Phase 3), which
#      already cites how to scaffold. So an unresolvable locator still fails the run.
app_rel() {
  local spec_app_root
  spec_app_root="$(spec_value app_root || true)"
  if [ -n "$spec_app_root" ]; then
    echo "$spec_app_root"
    return
  fi
  # Marker: does WORKSPACE_ROOT itself hold the app package? components.json is the
  # strongest signal (shadcn/registry target); else the package.json + src/ pair.
  if [ -f "$(workspace_path "components.json")" ] \
     || { [ -f "$(workspace_path "package.json")" ] && [ -d "$(workspace_path "src")" ]; }; then
    echo "."
    return
  fi
  if [ -d "$(workspace_path "packages/app")" ]; then
    echo "packages/app"
    return
  fi
  if [ -d "$(workspace_path "app")" ]; then
    echo "app"
    return
  fi
  echo "app"
}

state_field_ok() {
  local path="$1"
  if [ -z "$STATE_PATH" ] || [ ! -f "$STATE_PATH" ]; then
    return 0
  fi

  node - "$STATE_PATH" "$path" <<'NODE'
const fs = require('fs');
const [statePath, fieldPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));

function readPath(obj, rawPath) {
  const parts = rawPath.replace(/\[(.+?)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

const value = readPath(data, fieldPath);
let ok = true;

if (value == null) ok = false;
else if (typeof value === 'boolean') ok = value;
else if (typeof value === 'string') ok = value.length > 0;
else if (Array.isArray(value)) ok = value.length > 0;
else if (typeof value === 'object') ok = Object.keys(value).length > 0;

process.exit(ok ? 0 : 1);
NODE
}

# Echo a single (possibly dotted) run-state field's scalar value, or empty string when absent.
# Used for STRUCTURED reads (e.g. grant_source) — the structured replacement for substring-sniffing
# freeform notes[]. Returns non-zero only when there is no state file at all.
state_value() {
  local path="$1"
  if [ -z "$STATE_PATH" ] || [ ! -f "$STATE_PATH" ]; then
    return 1
  fi

  node - "$STATE_PATH" "$path" <<'NODE'
const fs = require('fs');
const [statePath, fieldPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));

function readPath(obj, rawPath) {
  const parts = rawPath.replace(/\[(.+?)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

const value = readPath(data, fieldPath);
process.stdout.write(value == null ? '' : String(value));
NODE
}

state_notes_contain() {
  local pattern="$1"
  if [ -z "$STATE_PATH" ] || [ ! -f "$STATE_PATH" ]; then
    return 1
  fi

  node - "$STATE_PATH" "$pattern" <<'NODE'
const fs = require('fs');
const [statePath, pattern] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const notes = Array.isArray(data.notes) ? data.notes.join('\n') : '';
const regex = new RegExp(pattern, 'i');
process.exit(regex.test(notes) ? 0 : 1);
NODE
}

check_state_fields() {
  if [ -z "$STATE_PATH" ] || [ ! -f "$STATE_PATH" ]; then
    return 0
  fi

  local fields=()

  # NOTE: $PHASE here is the INTERNAL name (after the public→internal remap above).
  # Mainline-phase labels are given for orientation only — the field lists are unchanged.
  case "$PHASE" in
    1) fields=("platform.postgres_ready" "platform.graphql_ready") ;;                                                                  # Phase 1 — Backend Up
    2.1) fields=("workspace.root" "workspace.pgpm_initialized" "workspace.pnpm_workspace_configured") ;;                               # Phase 2 — Data Model Provisioned (workspace)
    2.2) fields=("packages.provision.path" "packages.provision.name" "database.name" "auth.platform_token_ref" "auth.per_db_token_ref") ;; # Phase 2 — Data Model Provisioned (blueprint, public 2.3)
    2.3) fields=("codegen.schema_exported" "codegen.sdk_generated" "codegen.cli_generated") ;;                                          # Standalone-SDK Optional Extension (public 2.5)
    2.4) fields=("packages.app.path" "frontend.env_written") ;;                                                                         # Phase 3 — Frontend + SDK (public 2.6)
    2.5) fields=("ui.crud_flows_ok" "ui.forms_ok" "ui.routes_verified") ;;                                                              # Phase 4 — UI / Blocks (public 3)
  esac

  local missing=0
  for field in "${fields[@]}"; do
    if state_field_ok "$field"; then
      pass "run-state field present: $field"
    else
      warn "run-state field missing or false: $field"
      missing=1
    fi
  done

  [ "$missing" -eq 0 ] || fail "run-state is incomplete for phase $PHASE" "Fill in the WARNed fields above in build/run-state.json (set this phase's booleans true / non-empty strings) — update it at the end of every phase (SKILL.md 'Checkpoint + run-state after every green gate')."
}

# Locate one of the checker scripts (check-sdk.mjs / check-flows.mjs). These are now BUNDLED in
# THIS skill's own scripts/ dir ($SCRIPT_DIR), so the self-contained copy is preferred (no
# cross-repo glob needed). An explicit env override still wins for an out-of-tree checker, and the
# legacy sibling-skills glob + an app-vendored copy remain as best-effort FALLBACKS only.
# Usage: skill_checker_path <basename> <ENV_OVERRIDE_VALUE>; echoes the first hit, empty if none.
skill_checker_path() {
  local base="$1" override="${2:-}"
  local app_root cand
  app_root="$(workspace_path "$(app_rel)")"
  # 1. explicit env override (CHECK_SDK_MJS / CHECK_FLOWS_MJS) — highest priority.
  if [ -n "$override" ] && [ -f "$override" ]; then
    echo "$override"
    return 0
  fi
  # 2. the LOCAL bundled copy in this skill's scripts/ (self-contained; the canonical source). Then
  #    3. the legacy sibling skills repo glob (name is constructive-skills*, not fixed) under both
  #       roots, and 4. a copy vendored under the app's own scripts/ — both FALLBACKS only. The loop
  #       picks the first existing match.
  for cand in \
    "$SCRIPT_DIR/$base" \
    "$REPO_ROOT"/../constructive-skills*/.agents/skills/constructive-blocks/scripts/"$base" \
    "$WORKSPACE_ROOT"/../constructive-skills*/.agents/skills/constructive-blocks/scripts/"$base" \
    "$app_root/scripts/$base"; do
    if [ -f "$cand" ]; then
      echo "$cand"
      return 0
    fi
  done
  return 0
}

# Additive Blocks coverage gate. No-op unless the app installed Constructive Blocks
# (i.e. a `.constructive/blocks/*.requires.json` manifest exists). When manifests are
# present it asserts the on-ramp wiring from references/blocks-onramp.md:
#   1. the @/generated/* alias is present in the app tsconfig
#   2. check-sdk.mjs passes (if the script can be located)
#   3. <BlocksRuntime is mounted somewhere in the app source
# This never fires for non-blocks apps, so existing phases are unaffected.
check_blocks_coverage() {
  local app_root manifest_dir manifest_root
  app_root="$(workspace_path "$(app_rel)")"
  [ -d "$app_root" ] || return 0

  # Manifests land at <root>/.constructive/blocks — BUT shadcn writes them under the components.json
  # registry target, which for this Next.js template is src/, so the real location is usually
  # `<app>/src/.constructive/blocks` (not `<app>/.constructive/blocks`). Probe in order:
  #   1. <app>/.constructive/blocks         (app root, the documented canonical)
  #   2. <app>/src/.constructive/blocks      (where shadcn ACTUALLY writes — was the self-disable gap)
  #   3. <workspace>/.constructive/blocks    (unlikely fallback)
  # Track BOTH the manifest dir AND the project root that contains the tsconfig (`manifest_root`) so
  # check-sdk.mjs is pointed at the SAME app whose manifests we found — check-sdk itself looks in both
  # the project root and project/src/.constructive, so manifest_root stays the APP ROOT (where
  # tsconfig.json lives) even when the manifests are under src/. Otherwise check-sdk could read a
  # different (empty) .constructive/blocks and exit 0 with zero ops verified (a false pass).
  manifest_root="$app_root"
  manifest_dir="$app_root/.constructive/blocks"
  if [ ! -d "$manifest_dir" ] && [ -d "$app_root/src/.constructive/blocks" ]; then
    manifest_root="$app_root"
    manifest_dir="$app_root/src/.constructive/blocks"
  elif [ ! -d "$manifest_dir" ]; then
    manifest_root="$WORKSPACE_ROOT"
    manifest_dir="$(workspace_path ".constructive/blocks")"
  fi
  [ -d "$manifest_dir" ] || return 0

  local manifest_count
  manifest_count="$(find "$manifest_dir" -maxdepth 1 -name '*.requires.json' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$manifest_count" -gt 0 ] || return 0

  echo "  INFO: Blocks coverage gate — found $manifest_count installed block manifest(s) in $manifest_dir"

  # 1. @/generated/* alias present in the app tsconfig?
  local tsconfig="$app_root/tsconfig.json"
  if [ -f "$tsconfig" ] && grep -q '@/generated/' "$tsconfig"; then
    pass "Blocks: @/generated/* alias present in app tsconfig"
  else
    fail "Blocks: @/generated/* alias missing from $tsconfig" "Alias @/generated/{auth,admin} onto src/graphql/sdk/{auth,admin} (references/blocks-onramp.md Step 1)"
  fi

  # 2. <BlocksRuntime mounted in app source?
  local app_src
  app_src="$app_root/src"
  [ -d "$app_src" ] || app_src="$app_root"
  if grep -rqE '<BlocksRuntime[[:space:]/>]' "$app_src" 2>/dev/null; then
    pass "Blocks: <BlocksRuntime> is mounted in app source"
  else
    fail "Blocks: <BlocksRuntime> not found in app source" "Mount <BlocksRuntime> once at the app root (references/blocks-onramp.md Step 5b)"
  fi

  # 3. check-sdk.mjs preflight — run if we can locate the script. It ships BUNDLED in this skill's
  #    scripts/ (preferred); a CHECK_SDK_MJS env override wins, the sibling glob / app copy are
  #    fallbacks. Advisory-skip only if it cannot be found.
  local checker=""
  checker="$(skill_checker_path check-sdk.mjs "${CHECK_SDK_MJS:-}")"

  if [ -n "$checker" ]; then
    # Point check-sdk.mjs at the SAME root we discovered manifests in (manifest_root), so its
    # op-level assertions actually run against the manifests this gate found. check-sdk reads
    # <project>/.constructive/blocks; passing app_root when manifests live at workspace root would
    # make it see "nothing to check" and exit 0 (false pass). check-sdk also needs the tsconfig at
    # that root — true for the app root (the canonical case); for the rare workspace-root fallback we
    # require a tsconfig there before trusting the op-level pass, else flag it instead of silently
    # passing.
    if [ ! -f "$manifest_root/tsconfig.json" ]; then
      warn "Blocks: manifests found at $manifest_dir but no tsconfig.json at $manifest_root; cannot run op-level preflight there (install blocks into the app root so check-sdk.mjs can resolve the SDK alias)"
    elif node "$checker" --project "$manifest_root" >/tmp/check-sdk-out.$$ 2>&1; then
      pass "Blocks: check-sdk.mjs preflight passed ($manifest_count manifest(s) satisfied)"
      rm -f /tmp/check-sdk-out.$$
    else
      cat /tmp/check-sdk-out.$$ || true
      rm -f /tmp/check-sdk-out.$$
      fail "Blocks: check-sdk.mjs reported unsatisfied prerequisites" "See check-sdk.mjs output above; regenerate the SDK or treat the op as backend-pending (constructive-blocks skill). Ignore check-sdk's '-o src/generated' hint — for this template regenerate into src/graphql/sdk via 'pnpm codegen' (references/blocks-onramp.md Step 6)"
    fi
  else
    warn "Blocks: check-sdk.mjs not found (it ships in this skill's scripts/; restore it or set CHECK_SDK_MJS); skipped op-level preflight"
  fi
}

# App-compile gate. `next build` runs with typescript.ignoreBuildErrors = true (so Next does NOT
# fail on the sibling generated SDK/provision tree it can't resolve), which means a green
# `pnpm build` does NOT prove the app's OWN source type-checks — a typo'd block/SDK import or a
# wrong hook name slips through every other gate. This closes that hole: it runs a no-emit
# TypeScript check scoped to the app's src/** and FAILS the phase loudly if the app does not
# compile. Target the SCOPED project tsconfig.appcheck.json (src/** only) when present — that is
# the documented app-TS gate (SKILL.md S4c/S8); fall back to the app's tsconfig.json otherwise.
# Runs INSIDE the per-app build flow (Phase 2.4 + 2.5), right after the build. Self-disables only
# when there is genuinely no app/tsconfig to check (the surrounding phase already hard-fails those),
# and advisory-skips (warn, not fail) if the TypeScript compiler can't be launched at all — so it
# never masks a real type error, but a missing toolchain doesn't block a static run.
check_app_compiles() {
  local app_root app_root_abs app_package tsconfig_rel
  app_root="$(app_rel)"
  app_root_abs="$(workspace_path "$app_root")"
  [ -d "$app_root_abs" ] || return 0

  # Prefer the scoped app-TS project (src/** only) — it excludes the sibling provision tree whose
  # deps aren't hoisted, so it checks the app's own code without the whole-workspace false-fails.
  if [ -f "$app_root_abs/tsconfig.appcheck.json" ]; then
    tsconfig_rel="tsconfig.appcheck.json"
  elif [ -f "$app_root_abs/tsconfig.json" ]; then
    tsconfig_rel="tsconfig.json"
  else
    return 0  # nothing to compile-check; the phase's own scaffold gates already cover a missing tsconfig
  fi

  app_package="$(resolve_app_package || true)"
  [ -n "$app_package" ] || { warn "Compile check: could not resolve the app package name; skipped tsc --noEmit"; return 0; }

  local compile_log compile_rc
  compile_log="$(mktemp)"
  # Run the no-emit type-check in the app package's own dir (pnpm --filter <pkg> exec cd's there),
  # so `-p $tsconfig_rel` resolves against the app and `tsc` is the app's own devDep.
  if (cd "$WORKSPACE_ROOT" && pnpm --filter "$app_package" exec tsc -p "$tsconfig_rel" --noEmit >"$compile_log" 2>&1); then
    compile_rc=0
  else
    compile_rc=$?
  fi

  if [ "$compile_rc" -eq 0 ]; then
    pass "App type-checks (tsc --noEmit via $tsconfig_rel) — no compile errors"
    rm -f "$compile_log"
  else
    # Tail the compiler output so the failure is actionable inline (full log path printed too).
    echo "  ----- tsc --noEmit ($tsconfig_rel) output (tail) -----"
    tail -n 40 "$compile_log" 2>/dev/null | sed 's/^/  /' || true
    info "Full compile log: $compile_log"
    if [ "$tsconfig_rel" = "tsconfig.json" ]; then
      fail "App does not type-check (tsc --noEmit via tsconfig.json reported errors)" "Fix the TypeScript errors above (a common cause is a typo'd or non-existent block/SDK import — e.g. importing a hook or component name the generated SDK does not export). For a clean, app-scoped signal, add a scoped project '$app_root/tsconfig.appcheck.json' = { \"extends\": \"./tsconfig.json\", \"include\": [\"src/**/*.ts\", \"src/**/*.tsx\"], \"exclude\": [\"node_modules\"] } and re-run (SKILL.md S4c/S8) — tsconfig.json also type-checks sibling packages that may not be hoisted."
    else
      fail "App does not type-check (tsc --noEmit via tsconfig.appcheck.json reported errors)" "Fix the TypeScript errors above before this phase can pass — a common cause is a typo'd or non-existent block/SDK import (importing a hook/component name the generated SDK does not export, or a wrong @sdk/* / @/generated/* path). Re-run 'pnpm codegen' if an SDK symbol is genuinely missing, then 'pnpm exec tsc -p tsconfig.appcheck.json --noEmit' in the app dir until clean (SKILL.md S8)."
    fi
  fi
}

# Additive flows-catalog drift gate. No-op unless this skill ships a generated
# references/flows.json (the flow catalog emitted from the apps/blocks manifest). When it
# is present, this runs the BUNDLED check-flows.mjs (in this skill's scripts/), which recomputes
# the catalog's sotHash from the source-of-truth + node-type-registry presets and asserts
# the references copy of flows.json matches. This closes the same silent-drift class as the
# modules:['all'] bug: a flow's module list can no longer rot relative to the presets it claims
# to ride. Mirrors check_blocks_coverage: self-disables when there is nothing to check, and
# advisory-skips only if the bundled checker cannot be located.
check_flows_drift() {
  # Self-disable when this harness has no generated flow catalog (mirrors the
  # "no manifests → return 0" guard in check_blocks_coverage).
  local flows_json="$REPO_ROOT/references/flows.json"
  [ -f "$flows_json" ] || return 0

  echo "  INFO: Flows drift gate — found generated flow catalog at $flows_json"

  # Locate check-flows.mjs via skill_checker_path: the LOCAL bundled copy in this skill's scripts/
  # is preferred (CHECK_FLOWS_MJS override wins; the legacy sibling glob / app copy remain
  # fallbacks). Advisory-skip only if it somehow cannot be found (the bundled copy was removed).
  local checker=""
  checker="$(skill_checker_path check-flows.mjs "${CHECK_FLOWS_MJS:-}")"

  if [ -z "$checker" ]; then
    warn "Flows: check-flows.mjs not found (it ships in this skill's scripts/; restore it or set CHECK_FLOWS_MJS); skipped flow-catalog drift check"
    return 0
  fi

  # check-flows.mjs exit codes mirror check-sdk.mjs house style: 0 = in sync, 1 = drift,
  # 2 = could not run. Treat drift (1) as a hard fail; treat can't-run (2) as an advisory skip
  # so a half-checked-out skill repo never breaks an otherwise-green harness run.
  local out status=0
  out="/tmp/check-flows-out.$$"
  node "$checker" --harness-flows "$flows_json" >"$out" 2>&1 || status="$?"
  if [ "$status" -eq 0 ]; then
    pass "Flows: check-flows.mjs reports the flow catalog is in sync (no drift)"
    rm -f "$out"
  elif [ "$status" -eq 2 ]; then
    cat "$out" 2>/dev/null || true
    rm -f "$out"
    warn "Flows: check-flows.mjs could not run (exit 2); skipped flow-catalog drift check (not failing)"
  else
    cat "$out" 2>/dev/null || true
    rm -f "$out"
    fail "Flows: check-flows.mjs reported flow-catalog drift (exit $status)" "Regenerate the catalog from the apps/blocks manifest ('pnpm gen:flows') so references/flows.json matches the source-of-truth + node-type-registry presets, then re-run. Do NOT hand-edit references/flows.json."
  fi
}

# Additive harness self-consistency gate. No-op unless this harness ships
# scripts/check-harness-drift.mjs (a harness-owned checker that asserts the docs/scripts agree on
# the canonical values that have historically drifted: the per-DB data endpoint = api-<sub>, the
# registry/app ports, and the @constructive/<name> install form). Mirrors check_flows_drift:
# self-disables when the checker is absent, surfaces the checker's own output, and treats a drift
# (exit 1) as a hard gate fail. Wired into Phase 1 so it runs early, before the build/codegen work.
check_harness_drift() {
  # Self-disable when the checker has not been authored yet (mirrors the "no file → return 0"
  # guard the other additive gates use). The checker is harness-owned and lives beside the other
  # *.mjs in this script's scripts/ dir.
  local checker="$REPO_ROOT/scripts/check-harness-drift.mjs"
  [ -f "$checker" ] || return 0

  echo "  INFO: Build-flow drift gate — running scripts/check-harness-drift.mjs"

  # exit 0 = harness is internally consistent; exit 1 = drift (hard fail). Any other non-zero is
  # treated as a fail too so a broken checker never silently passes.
  local out status=0
  out="/tmp/check-harness-drift-out.$$"
  node "$checker" >"$out" 2>&1 || status="$?"
  if [ "$status" -eq 0 ]; then
    cat "$out" 2>/dev/null || true
    rm -f "$out"
    pass "Config: check-harness-drift.mjs reports the build flow is internally consistent (no drift)"
  else
    cat "$out" 2>/dev/null || true
    rm -f "$out"
    fail "Config: check-harness-drift.mjs reported drift (exit $status)" "The build-flow docs/scripts disagree on a canonical value (per-DB data endpoint = api-<sub>, REGISTRY_PORT=4081, APP_PORT=3081, or install form @constructive/<name>). See the checker output above and align the flagged file(s)."
  fi
}

# Additive self-lint: every fail() CALL-SITE in this script must pass a 2nd arg = a self-correcting
# FIX hint, so an agent that trips a gate always gets a concrete next action (cite the gotcha CODE +
# the one-liner / SKILL anchor). This keeps the hint-coverage ratio from regressing as call-sites are
# added. Pure grep (no deps); mirrors `npm run check:fix-hints`. A hintless fail() is a hard gate fail.
check_fail_hints() {
  local self="$REPO_ROOT/scripts/verify-phase.sh"
  [ -f "$self" ] || return 0
  # Hintless call-site = a `fail "…"` with nothing after the closing quote, excluding comment lines.
  local hintless
  hintless="$(grep -nE 'fail "[^"]*"[[:space:]]*$' "$self" | grep -vE '^[[:space:]]*[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$hintless" ]; then
    echo "  INFO: fail()-hint self-lint found call-site(s) with no 2nd-arg FIX hint:"
    echo "$hintless" | sed 's/^/        /'
    fail "Self-lint: a fail() call-site is missing its 2nd-arg FIX hint" "Add a concrete FIX hint (the optional 2nd arg) to each fail() listed above — cite the relevant gotcha CODE + the exact one-liner / SKILL anchor (run 'npm run check:fix-hints' to re-check)."
  else
    pass "Self-lint: every fail() call-site carries a 2nd-arg FIX hint"
  fi
}

# Detect whether the spec declares at least one acceptance.required_flows entry.
# spec_value cannot see YAML list items, so scan the acceptance: block for a `- ` item
# under required_flows:. Returns 0 (true) if a non-empty list is present.
spec_has_required_flows() {
  if [ -z "$SPEC_PATH" ] || [ ! -f "$SPEC_PATH" ]; then
    return 1
  fi
  awk '
    /^[[:space:]]*acceptance:/ { in_acc = 1; next }
    in_acc && /^[^[:space:]]/ { in_acc = 0 }
    in_acc && /^[[:space:]]*required_flows:[[:space:]]*\[[[:space:]]*\]/ { next }   # inline empty list
    in_acc && /^[[:space:]]*required_flows:/ { in_flows = 1; next }
    in_flows && /^[[:space:]]*[a-zA-Z_]/ { in_flows = 0 }
    in_flows && /^[[:space:]]*-[[:space:]]*[^[:space:]#]/ { found = 1; exit }
    END { exit (found ? 0 : 1) }
  ' "$SPEC_PATH"
}

# ── Opt-in live running-app acceptance gate (signup → login → CRUD round-trip) ──────────────
# Runs ONLY in the Phase 4 / UI path. Enabled when LIVE_QA=1 OR the spec declares
# acceptance.required_flows. Drives the running app headlessly (agent-browser or Playwright)
# through a real signup → login → CRUD round-trip and asserts the persisted effect. HARD-FAILS
# when enabled and the drive fails. DEGRADES GRACEFULLY (clear skip notice, exit 0) when the
# gate is disabled, no browser/driver is available, or no acceptance-drive script is wired —
# so environments without a browser are never broken. Set LIVE_QA_STRICT=1 to turn the
# "enabled but nothing to run" skip into a hard fail.
#   $1 = app workspace-relative root (app or packages/app)
#   $2 = resolved app package name (for `pnpm --filter`)
run_live_qa() {
  local app_root="$1"
  local app_package="$2"

  # 1. Enablement: explicit flag OR required_flows in the brief.
  local enabled="no"
  if [ "${LIVE_QA:-0}" = "1" ]; then
    enabled="yes"
  elif spec_has_required_flows; then
    enabled="yes"
  fi
  if [ "$enabled" != "yes" ]; then
    info "Live-QA gate: disabled (set LIVE_QA=1 or add acceptance.required_flows to the brief to enable) — skipping"
    return 0
  fi

  echo "  INFO: Live-QA gate: ENABLED (signup → login → CRUD round-trip against the running app)"

  # 2. Browser/driver availability — degrade gracefully if none is present.
  local have_browser="no"
  if command -v agent-browser >/dev/null 2>&1; then
    have_browser="agent-browser"
  elif command -v npx >/dev/null 2>&1 && npx --no-install playwright --version >/dev/null 2>&1; then
    have_browser="playwright"
  fi
  if [ "$have_browser" = "no" ]; then
    warn "Live-QA gate: no browser driver available (neither 'agent-browser' on PATH nor a resolvable Playwright). Skipping the live drive — install agent-browser ('npm i -g agent-browser && agent-browser install') to enable. NOT failing: this environment has no browser."
    return 0
  fi
  info "Live-QA gate: using browser driver: $have_browser"

  # 3. Locate the acceptance-drive script. The actual signup→login→CRUD steps live in a driver
  #    (JS/TS) so the gate stays portable; point at it with LIVE_QA_DRIVER, ship scripts/live-qa.mjs,
  #    or define an `e2e`/`test:e2e` script in the app package.
  local driver_cmd=""
  if [ -n "${LIVE_QA_DRIVER:-}" ] && [ -f "${LIVE_QA_DRIVER}" ]; then
    driver_cmd="node ${LIVE_QA_DRIVER}"
  elif [ -f "$REPO_ROOT/scripts/live-qa.mjs" ]; then
    driver_cmd="node $REPO_ROOT/scripts/live-qa.mjs"
  elif [ -f "$(workspace_path "$app_root/package.json")" ] && node -e "const s=require('$(workspace_path "$app_root/package.json")').scripts||{}; process.exit((s['test:e2e']||s['e2e'])?0:1)" 2>/dev/null; then
    driver_cmd="pnpm --filter $app_package run $(node -e "const s=require('$(workspace_path "$app_root/package.json")').scripts||{}; process.stdout.write(s['test:e2e']?'test:e2e':'e2e')" 2>/dev/null)"
  fi

  if [ -z "$driver_cmd" ]; then
    if [ "${LIVE_QA_STRICT:-0}" = "1" ]; then
      fail "Live-QA gate: enabled and a browser is present, but no acceptance-drive script was found" "Provide one: set LIVE_QA_DRIVER=/abs/path/to/driver.mjs, add scripts/live-qa.mjs, or define an 'e2e'/'test:e2e' script in $app_root/package.json. The driver must sign up, log in, do a CRUD round-trip, assert 200s + a persisted row, and exit non-zero on any failure."
    fi
    warn "Live-QA gate: enabled and a browser is present, but no acceptance-drive script is wired (LIVE_QA_DRIVER / scripts/live-qa.mjs / app 'e2e' script). Skipping the live drive. Set LIVE_QA_STRICT=1 to make this a hard fail. The independent evaluator (references/evaluator-role.md) still owns final acceptance."
    return 0
  fi
  info "Live-QA gate: drive command: $driver_cmd"

  # 4. Resolve the app's base URL/port. Precedence: explicit LIVE_QA_BASE_URL → the per-app
  #    run-state frontend port/url that wire-app PERSISTED (the ALLOCATED free dev port — authoritative,
  #    so two concurrent apps each hit their OWN port) → the brief's frontend_port (only a BASE) →
  #    config default (app.portBase). The run-state wins over the brief because the brief port is just
  #    the base the allocator grew from; the running app is on the persisted port.
  local port base_url state_port state_url
  state_url="$(state_value frontend.base_url 2>/dev/null || true)"
  state_port="$(state_value frontend.frontend_port 2>/dev/null || true)"
  # tolerate the older field names too (frontend.url / frontend.port)
  [ -n "$state_url" ] || state_url="$(state_value frontend.url 2>/dev/null || true)"
  [ -n "$state_port" ] || state_port="$(state_value frontend.port 2>/dev/null || true)"
  port="$state_port"
  [ -n "$port" ] || port="$(spec_value frontend_port || true)"
  # Default app/dev port from constructive.config.json (app.portBase = canonical 3081).
  [ -n "$port" ] || port="$(cfg app.portBase 3081)"
  if [ -n "${LIVE_QA_BASE_URL:-}" ]; then
    base_url="$LIVE_QA_BASE_URL"
  elif [ -n "$state_url" ]; then
    base_url="$state_url"
  else
    base_url="http://localhost:$port"
  fi
  info "Live-QA gate: target app URL: $base_url (port $port)"

  # 5. Bring up the app unless one is already responding (then reuse it).
  local started_app="no" app_pid="" app_log
  app_log="$(mktemp)"
  local already
  # curl -w "%{http_code}" ALREADY prints "000" to stdout on a connection failure (exit 7) by itself;
  # the old `|| echo "000"` then APPENDED a second "000" → "000000", which "!= 000" made the gate
  # WRONGLY conclude the app was already responding (HTTP 000000) and NEVER start it → agent-browser
  # then opened a dead port. Take curl's code verbatim and treat empty/000 as down, so a
  # not-already-running app IS started.
  already="$(curl -s -o /dev/null -w "%{http_code}" "$base_url" 2>/dev/null)"; [ -z "$already" ] && already="000"
  if [ "$already" != "000" ]; then
    info "Live-QA gate: app already responding at $base_url (HTTP $already) — reusing it"
  else
    info "Live-QA gate: starting the app (pnpm --filter $app_package start) on port ${port}..."
    ( cd "$WORKSPACE_ROOT" && PORT="$port" pnpm --filter "$app_package" start >"$app_log" 2>&1 ) &
    app_pid="$!"
    started_app="yes"
    local up="no" i
    for i in $(seq 1 60); do
      local code
      code="$(curl -s -o /dev/null -w "%{http_code}" "$base_url" 2>/dev/null)"; [ -z "$code" ] && code="000"
      if [ "$code" != "000" ]; then up="yes"; break; fi
      # Bail early if the app process already died.
      if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
      sleep 2
    done
    if [ "$up" != "yes" ]; then
      [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
      cat "$app_log" 2>/dev/null || true
      rm -f "$app_log"
      fail "Live-QA gate: app did not come up at $base_url within timeout" "Check the app start log above; ensure 'pnpm --filter $app_package start' serves port $port (or set LIVE_QA_BASE_URL)."
    fi
  fi

  # 5b. Resolve the spec the driver reads to an ABSOLUTE path before exporting it.
  #     The driver runs with cwd=$WORKSPACE_ROOT (step 6), but LIVE_QA_SPEC / --spec are usually
  #     REPO-relative (e.g. fixtures/golden-app-brief.yaml) — a relative path would `existsSync()`
  #     against the wrong dir in the driver and silently resolve ZERO flows ("nothing to QA").
  #     Precedence: an explicit LIVE_QA_SPEC, else this gate's own $SPEC_PATH. We absolutize a
  #     relative value by probing the caller cwd first, then $REPO_ROOT, then $REPO_ROOT/fixtures
  #     (where the frozen briefs live).
  local qa_spec="${LIVE_QA_SPEC:-$SPEC_PATH}"
  if [ -n "$qa_spec" ] && [[ "$qa_spec" != /* ]]; then
    if [ -f "$PWD/$qa_spec" ]; then
      qa_spec="$PWD/$qa_spec"
    elif [ -f "$REPO_ROOT/$qa_spec" ]; then
      qa_spec="$REPO_ROOT/$qa_spec"
    elif [ -f "$REPO_ROOT/fixtures/$qa_spec" ]; then
      qa_spec="$REPO_ROOT/fixtures/$qa_spec"
    fi
  fi
  if [ -n "$qa_spec" ] && [ -f "$qa_spec" ]; then
    export LIVE_QA_SPEC="$qa_spec"
    info "Live-QA gate: spec (absolute) for the driver: $LIVE_QA_SPEC"
  fi

  # 6. Run the acceptance drive. HARD-FAIL on non-zero exit.
  #    NOTE: `set -e` is active — capture the exit code with `|| qa_status=$?` so a failing drive
  #    does NOT abort the script before teardown (step 7) and the explicit fail message below.
  local qa_log qa_status=0
  qa_log="$(mktemp)"
  ( cd "$WORKSPACE_ROOT" && LIVE_QA_BASE_URL="$base_url" BASE_URL="$base_url" $driver_cmd >"$qa_log" 2>&1 ) || qa_status="$?"

  # 7. Tear down the app if we started it.
  if [ "$started_app" = "yes" ] && [ -n "$app_pid" ]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi

  if [ "$qa_status" -eq 0 ]; then
    pass "Live-QA gate: signup → login → CRUD round-trip passed against $base_url"
    rm -f "$qa_log" "$app_log"
  else
    cat "$qa_log" 2>/dev/null || true
    rm -f "$qa_log" "$app_log"
    fail "Live-QA gate: signup → login → CRUD round-trip FAILED against $base_url (driver exit $qa_status)" "See driver output above. A flow is only green when its request returns 2xx AND the effect is persisted (row visible after reload)."
  fi
}

resolve_db_name() {
  if [ -n "$POSITIONAL_DB_NAME" ]; then
    echo "$POSITIONAL_DB_NAME"
    return
  fi

  if [ -n "${DB_NAME:-}" ]; then
    echo "$DB_NAME"
    return
  fi

  local spec_db
  spec_db="$(spec_value db_name || true)"
  if [ -n "$spec_db" ]; then
    echo "$spec_db"
    return
  fi

  echo "myapp"
}

resolve_subdomain() {
  local db_name="${1:-$(resolve_db_name)}"

  # Steps 1+2 (run-state stored subdomain → platform psql lookup) are now centralized in
  # lib/brief.mjs subdomainFor(); resolve_subdomain_id returns EMPTY when neither resolves.
  local subdomain
  subdomain="$(resolve_subdomain_id "$db_name")"
  if [ -n "$subdomain" ]; then
    echo "$subdomain"
    return
  fi

  # 3. Fallback to db name (may not work if platform assigns random subdomains)
  warn "Could not resolve subdomain for '$db_name'; falling back to db name"
  echo "$db_name"
}

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

    # Grant provenance (structured, not prose-sniffed): an agent may legitimately have applied the
    # documented manual GRANT fallback (S2 step 3). We honor that by reading a STRUCTURED run-state
    # field rather than punishing honest freeform notes. grant_source ∈ {sdk, manual-fallback};
    # 'manual-fallback' is allowed (just INFO). The real proof is the OUTCOME assertion below.
    GRANT_SOURCE="$(state_value "database.grant_source" || true)"
    case "$GRANT_SOURCE" in
      sdk)            pass "run-state grant_source = sdk (object-form blueprint grants)" ;;
      manual-fallback) info "run-state grant_source = manual-fallback (documented S2-step-3 GRANT) — allowed; outcome is asserted below" ;;
      "")             info "run-state grant_source unset — skipping provenance note; outcome is asserted below" ;;
      *)              warn "run-state grant_source='$GRANT_SOURCE' is not one of {sdk, manual-fallback}" ;;
    esac

    # Per-DB schema resolution tolerant of BOTH naming conventions (gotchas SUBDOMAIN-001):
    #   OLD dash+hash:  <db>-<hash>-memberships-public   (fv4-* era)
    #   NEW underscore: <db>_memberships_public          (goldenapp_*/fv5_*/fv6_*)
    # A LIKE pinned to one separator 0-matches the other (the false-fail this fixes). DB_LIKE is
    # the db name with its own '-'/'_' turned into '%', anchored at the START (no leading %, so a
    # sibling tenant whose name merely CONTAINS this db can't match). Resolve each schema DIRECTLY
    # via '<DB_LIKE>%<token>%public' — no prefix arithmetic — so an underscore name (which the old
    # '${x%-memberships-public}' strip left untouched) can't yield a wrong app/users schema. Kept
    # byte-for-byte in step with scripts/fix-grants.sh so the gate and the reconcile always agree.
    DB_LIKE="$(psql -d constructive -t -c "SELECT replace(replace('$DB_NAME_RESOLVED', '_', '%'), '-', '%');" 2>/dev/null | tr -d ' ')"
    [ -n "$DB_LIKE" ] || DB_LIKE="$DB_NAME_RESOLVED"

    MEMBERSHIP_SCHEMA="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'app_membership_defaults' AND table_schema LIKE '${DB_LIKE}%memberships%public' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' ')"
    [ -n "$MEMBERSHIP_SCHEMA" ] && pass "Resolved platform membership schema: $MEMBERSHIP_SCHEMA" || fail "Could not resolve Constructive membership schema for '$DB_NAME_RESOLVED'" "DB exists but app schemas aren't provisioned — re-run create-db + provision (SKILL.md S2); if provision aborted with NOT_FOUND (memberships_module) you used AuthzEntityMembership on an auth:email app — switch to AuthzDirectOwner (gotchas RLS-POLICY-001)."

    # Human-readable prefix (display only; app/users resolved directly below). Strip the
    # 'memberships' segment with EITHER separator via a [-_] bracket glob.
    SCHEMA_PREFIX="${MEMBERSHIP_SCHEMA%[-_]memberships[-_]public}"
    [ -n "$SCHEMA_PREFIX" ] && pass "Resolved platform schema prefix: $SCHEMA_PREFIX" || fail "Could not resolve Constructive schema prefix for '$DB_NAME_RESOLVED'" "Membership schema didn't match the expected '<db>…memberships…public' shape — re-run provision (SKILL.md S2); the provision.ts membership SQL must use the separator-tolerant match (gotchas SUBDOMAIN-001)."

    APP_SCHEMA="$(psql -d constructive -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${DB_LIKE}%app%public' ORDER BY length(schema_name), schema_name LIMIT 1;" 2>/dev/null | tr -d ' ')"
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
      fail "'authenticated' is missing required privileges on $APP_SCHEMA (found ${GRANT_PRIVS:-0}/4)" "Grant didn't land — every authenticated write 403s. Use object-form grants (grants:[{roles:['authenticated'],privileges:[['select','*'],['insert','*'],['update','*'],['delete','*']]}]) in the blueprint (gotchas F3 / SKILL.md S2 step 1); run scripts/fix-grants.sh to apply + reconcile idempotently, or the one-time psql GRANT fallback in SKILL.md S2 step 3."
    fi

    # Resolve the users schema DIRECTLY (anchored + separator-tolerant), same as app/memberships
    # above — tolerates BOTH '<db>-…-users-public' and '<db>_users_public' (SUBDOMAIN-001).
    USERS_SCHEMA="$(psql -d constructive -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${DB_LIKE}%users%public' ORDER BY length(schema_name), schema_name LIMIT 1;" 2>/dev/null | tr -d ' ')"
    [ -n "$USERS_SCHEMA" ] || USERS_SCHEMA="${SCHEMA_PREFIX}-users-public"
    USERS_SELF_UPDATE_POLICY="$(psql -d constructive -t -c "SELECT count(*) FROM pg_policies WHERE schemaname = '$USERS_SCHEMA' AND tablename = 'users' AND cmd = 'UPDATE';" 2>/dev/null | tr -d ' ')"
    if [ "${USERS_SELF_UPDATE_POLICY:-0}" -ge 1 ] 2>/dev/null; then
      pass "users-table self_update UPDATE policy present in $USERS_SCHEMA (updateUser will persist)"
    else
      fail "users-table self_update UPDATE policy missing in $USERS_SCHEMA" "updateUser is a silent 200-but-0-rows no-op without it (gotchas RLS-USERS-UPDATE-001). provision.ts must run the createSecureTableProvision self_update step (SKILL.md S2 step 1); run scripts/fix-grants.sh to reconcile it idempotently, or apply the one-time fallback policy in SKILL.md S2 step 3."
    fi

    # ── ORG-TIER grant OUTCOME assertion (b2b only; owner-only apps are untouched) ─────────────
    # The b2b counterpart of the owner-tier gate above. It asserts the OUTCOME of scripts/fix-org-grants.sh
    # (gotchas RLS-ORG-RECONCILE-001 / PLATFORM-GAPS.md GAP-1b/1c) — the org analogue of RLS-USERS-UPDATE-001.
    # It is GATED on the app being b2b/org so it NEVER fires for owner-only apps (the frozen canary is
    # owner-tier → this whole block is skipped there). Org tier is detected from TWO structured signals
    # (mirrors live-qa.mjs caps.orgReconcile + brief.mjs's b2b gate — NOT prose):
    #   (1) run-state database.org_reconcile is a non-empty string (the reconcile stamps 'sdk' /
    #       'manual-fallback' once it ran — this is also live-qa's org-tier capability gate), OR
    #   (2) the brief declares an org tier: modules.preset ∈ {b2b, b2b:storage, full}, OR a table carries
    #       an org-scoped policy intent (policy: org-membership | member-owner). brief.mjs requires a b2b
    #       preset for those policies, so either is a sound org-tier signal.
    # $SPEC_PATH is YAML and spec_value() is a FLAT-key reader (can't see nested modules.preset), so we
    # scan the brief directly with a scoped awk (preset under the `modules:` block) + a grep for the
    # policy intents — bounded reads of the brief the agent wrote, no platform SQL.
    ORG_RECONCILE_STATE="$(state_value "database.org_reconcile" || true)"
    ORG_TIER=0
    ORG_TIER_REASON=""
    if [ -n "$ORG_RECONCILE_STATE" ]; then
      ORG_TIER=1
      ORG_TIER_REASON="run-state database.org_reconcile='$ORG_RECONCILE_STATE'"
    elif [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
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
      info "Org tier detected ($ORG_TIER_REASON) — asserting b2b reconcile OUTCOME (gotchas RLS-ORG-RECONCILE-001)"

      # Resolve the org/membership schemas with the SAME anchored, separator-tolerant DB_LIKE machinery
      # already used above (SUBDOMAIN-001) and EXACTLY mirrored from scripts/fix-org-grants.sh, so the
      # gate and the reconcile always agree on which physical schema is the live tenant's.
      MEMBERSHIP_PUB_SCHEMA="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'org_memberships' AND table_schema LIKE '${DB_LIKE}%memberships%public' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' ')"
      [ -n "$MEMBERSHIP_PUB_SCHEMA" ] && pass "Resolved org memberships-public schema: $MEMBERSHIP_PUB_SCHEMA" || fail "Could not resolve the org memberships-public schema (table org_memberships) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%memberships%public')" "This app reads as b2b/org ($ORG_TIER_REASON) but org_memberships isn't provisioned — provision with the b2b preset (modules.preset: b2b; SKILL.md S2), or if it's actually owner-only clear the org signal (don't set modules.preset b2b / don't stamp database.org_reconcile). gotchas RLS-ORG-RECONCILE-001."

      MEMBERSHIP_PRIV_SCHEMA="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'org_memberships_sprt' AND table_schema LIKE '${DB_LIKE}%memberships%private' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' ')"
      [ -n "$MEMBERSHIP_PRIV_SCHEMA" ] && pass "Resolved org memberships-private schema: $MEMBERSHIP_PRIV_SCHEMA" || fail "Could not resolve the org memberships-private schema (table org_memberships_sprt) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%memberships%private')" "The org SPRT tables aren't provisioned — re-run create-db + provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."

      PERMISSIONS_PUB_SCHEMA="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'app_permissions' AND table_schema LIKE '${DB_LIKE}%permissions%public' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' ')"
      [ -n "$PERMISSIONS_PUB_SCHEMA" ] && pass "Resolved org permissions-public schema: $PERMISSIONS_PUB_SCHEMA" || fail "Could not resolve the org permissions-public schema (table app_permissions) for '$DB_NAME_RESOLVED' (anchored '${DB_LIKE}%permissions%public')" "The permissions module isn't provisioned — re-run create-db + provision with the b2b preset (SKILL.md S2). gotchas RLS-ORG-RECONCILE-001."

      # (a) org-table GRANTs to 'authenticated': the dynamic provisioner ships org_memberships SELECT/DELETE
      #     but OMITS INSERT/UPDATE, and grants org_member_profiles nothing (fix-org-grants step b). Assert
      #     the 4 privileges on org_memberships AND SELECT on org_member_profiles (the RLS policies already
      #     exist from provision; these GRANTs are what let members-list / role-change / profile reads round-trip).
      ORG_GM_PRIVS="$(psql -d constructive -t -c "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_PUB_SCHEMA' AND table_name = 'org_memberships' AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');" 2>/dev/null | tr -d ' ')"
      ORG_OMP_SEL="$(psql -d constructive -t -c "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = '$MEMBERSHIP_PUB_SCHEMA' AND table_name = 'org_member_profiles' AND grantee = 'authenticated' AND privilege_type = 'SELECT';" 2>/dev/null | tr -d ' ')"
      if [ "${ORG_GM_PRIVS:-0}" -ge 4 ] 2>/dev/null && [ "${ORG_OMP_SEL:-0}" -ge 1 ] 2>/dev/null; then
        pass "'authenticated' holds org_memberships SELECT/INSERT/UPDATE/DELETE + org_member_profiles SELECT in $MEMBERSHIP_PUB_SCHEMA"
      else
        fail "org-table grants incomplete in $MEMBERSHIP_PUB_SCHEMA (org_memberships ${ORG_GM_PRIVS:-0}/4, org_member_profiles SELECT=${ORG_OMP_SEL:-0})" "The provisioner ships org_memberships SELECT/DELETE only + nothing on org_member_profiles, so member-list / role-change / org writes 403 (PLATFORM-GAPS.md GAP-1b). Run scripts/fix-org-grants.sh <db-name> to backfill INSERT/UPDATE + the profiles SELECT idempotently (SKILL.md S2 step 3b; gotchas RLS-ORG-RECONCILE-001)."
      fi

      # (b) the create_entity app-permission bit must be DEFINED (org create / member writes gate on it;
      #     bit 5 = 0x20 = 32, but we resolve it BY NAME — never hard-coded — exactly as fix-org-grants does).
      #     If it's not defined the b2b permissions weren't provisioned (fail); the seed-row assertion (c)
      #     needs this literal, so it runs ONLY in the defined branch.
      ORG_CREATE_ENTITY_BIT="$(psql -d constructive -t -c "SELECT bitstr::text FROM \"$PERMISSIONS_PUB_SCHEMA\".app_permissions WHERE name = 'create_entity' LIMIT 1;" 2>/dev/null | tr -d ' ')"
      if [ -z "$ORG_CREATE_ENTITY_BIT" ]; then
        fail "create_entity app-permission bit is NOT defined in $PERMISSIONS_PUB_SCHEMA.app_permissions" "Org create / member writes gate on the create_entity bit (PLATFORM-GAPS.md GAP-1c) — its absence means the b2b permissions weren't provisioned. Re-run provision with the b2b preset (SKILL.md S2); scripts/fix-org-grants.sh sets the bit on actors once it exists. gotchas RLS-ORG-RECONCILE-001."
      fi
      pass "create_entity app-permission bit is defined in $PERMISSIONS_PUB_SCHEMA.app_permissions (...${ORG_CREATE_ENTITY_BIT: -8})"

      # (c) the personal-org seed row the AuthzEntityMembership RLS actually reads:
      #     org_memberships_sprt(actor_id = entity_id) (fix-org-grants step c). It only exists per-ACTOR
      #     after a signup + reconcile, so we branch on whether an actor exists yet (this gate runs at
      #     provision time, which is BEFORE the first signup):
      #       • If run-state stamped database.org_reconcile (reconcile claims it ran) → assert the OUTCOME:
      #         a personal-org row exists AND carries the create_entity bit. Stamped but missing/bit-less → FAIL
      #         (the stamp lied, or a different-suffix tenant was reconciled).
      #       • If NOT yet stamped but an actor exists → surface (WARN) with the fix pointer (the per-actor
      #         seed is the runtime reconcile's job; not a provision-time hard fail).
      #       • Pre-signup (no actor) → the seed can't exist yet; grants (a) + bit (b) are the assertable
      #         provision-time outcome (keeps a fresh b2b provision-time gate green, like the owner canary).
      USERS_SCHEMA_ORG="$(psql -d constructive -t -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 'users' AND table_schema LIKE '${DB_LIKE}%users%public' ORDER BY length(table_schema), table_schema LIMIT 1;" 2>/dev/null | tr -d ' ')"
      [ -n "$USERS_SCHEMA_ORG" ] || USERS_SCHEMA_ORG="$USERS_SCHEMA"
      ORG_USER_COUNT="$(psql -d constructive -t -c "SELECT count(*) FROM \"$USERS_SCHEMA_ORG\".users;" 2>/dev/null | tr -d ' ')"
      # Personal-org seed rows present (actor = entity), and of those, how many carry the create_entity bit.
      ORG_SEED_ROWS="$(psql -d constructive -t -c "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = entity_id;" 2>/dev/null | tr -d ' ')"
      ORG_SEED_WITH_BIT="$(psql -d constructive -t -c "SELECT count(*) FROM \"$MEMBERSHIP_PRIV_SCHEMA\".org_memberships_sprt WHERE actor_id = entity_id AND (permissions & '${ORG_CREATE_ENTITY_BIT}'::bit(64)) = '${ORG_CREATE_ENTITY_BIT}'::bit(64);" 2>/dev/null | tr -d ' ')"

      if [ -n "$ORG_RECONCILE_STATE" ]; then
        # Reconcile claims it ran — assert the OUTCOME (the seed row + its create_entity bit) exists.
        if [ "${ORG_SEED_WITH_BIT:-0}" -ge 1 ] 2>/dev/null; then
          pass "personal-org seed row present in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt (actor=entity) carrying create_entity (${ORG_SEED_WITH_BIT} of ${ORG_SEED_ROWS:-0}) — createCompany etc. will pass RLS"
        elif [ "${ORG_SEED_ROWS:-0}" -ge 1 ] 2>/dev/null; then
          fail "personal-org seed row(s) exist in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt but NONE carry the create_entity bit (0 of ${ORG_SEED_ROWS})" "database.org_reconcile is stamped '$ORG_RECONCILE_STATE' but the seeded row is missing create_entity, so AuthzEntityMembership writes (createCompany) stay RLS-denied. Re-run scripts/fix-org-grants.sh <db-name> --app-dir <app> (it ORs the bit onto the sprt row idempotently; PLATFORM-GAPS.md GAP-1c; gotchas RLS-ORG-RECONCILE-001)."
        else
          fail "run-state database.org_reconcile='$ORG_RECONCILE_STATE' but NO personal-org seed row exists in $MEMBERSHIP_PRIV_SCHEMA.org_memberships_sprt (actor=entity)" "The reconcile stamp claims it ran, yet the row the AuthzEntityMembership RLS reads is absent — the stamp is stale or a DIFFERENT-suffix tenant was reconciled (a shared hub mints a new hash-suffixed tenant per create-db). Re-run scripts/fix-org-grants.sh <db-name> --app-dir <app> so it pins the LIVE tenant by DATABASE_ID and seeds actor_id=entity_id (PLATFORM-GAPS.md GAP-1b; gotchas RLS-ORG-RECONCILE-001)."
        fi
      elif [ "${ORG_USER_COUNT:-0}" -ge 1 ] 2>/dev/null; then
        # An actor exists but the reconcile was never stamped — the per-actor seed is the runtime
        # reconcile's job; surface it (not a provision-time hard fail) so the operator knows to run it.
        if [ "${ORG_SEED_WITH_BIT:-0}" -ge 1 ] 2>/dev/null; then
          pass "personal-org seed row present + carries create_entity (${ORG_SEED_WITH_BIT}) though run-state isn't stamped — stamp database.org_reconcile so live-qa's org gate fires"
        else
          warn "org tier ($ORG_TIER_REASON) with ${ORG_USER_COUNT} actor(s) but NO create_entity-bearing personal-org sprt row yet (${ORG_SEED_WITH_BIT:-0}/${ORG_SEED_ROWS:-0}) — run scripts/fix-org-grants.sh <db-name> --app-dir <app> before org writes (createCompany will 403 until then; PLATFORM-GAPS.md GAP-1b/1c; gotchas RLS-ORG-RECONCILE-001)"
        fi
      else
        # Pre-signup (no actor yet): the per-actor seed can't exist; the runtime reconcile seeds it after
        # the first signup. Grants (a) + the bit (b) above are the assertable provision-time outcome.
        info "Org tier with no signed-up actor yet — grants + create_entity bit asserted; the personal-org sprt seed is reconciled per-actor after first signup (scripts/fix-org-grants.sh; gotchas RLS-ORG-RECONCILE-001)"
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
    FRONTEND_BUILD_LOG="$(mktemp)"
    if (cd "$WORKSPACE_ROOT" && pnpm --filter "$APP_PACKAGE" build >"$FRONTEND_BUILD_LOG" 2>&1); then
      pass "Frontend build succeeds"
    else
      info "Build log: $FRONTEND_BUILD_LOG"
      fail "Frontend build failed (see build log above)" "Check TypeScript errors in $FRONTEND_BUILD_LOG"
    fi

    # The build above runs with ignoreBuildErrors, so it does NOT prove the app's own source
    # type-checks — gate that explicitly with a no-emit TypeScript check on the app (src/**).
    check_app_compiles

    # Additive: only fires if Constructive Blocks were installed (Phase 2.7).
    check_blocks_coverage

    # Additive: only fires if this harness ships a generated references/flows.json.
    check_flows_drift

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
    FINAL_BUILD_LOG="$(mktemp)"
    if (cd "$WORKSPACE_ROOT" && pnpm --filter "$APP_PACKAGE" build >"$FINAL_BUILD_LOG" 2>&1); then
      pass "Final frontend build succeeds"
    else
      info "Build log: $FINAL_BUILD_LOG"
      fail "Final frontend build failed (see build log above)" "Check TypeScript errors in $FINAL_BUILD_LOG"
    fi

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
