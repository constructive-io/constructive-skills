# scripts/lib/verify-resolve.sh — spec / state / workspace / app RESOLVER helpers for verify-phase.sh.
#
# Sourced (never executed) by scripts/verify-phase.sh AFTER lib/sh-common.sh + lib/schema-resolve.sh.
# It holds the pure resolution functions the phase gates call to locate the brief/spec, the run-state,
# the workspace root, and the app package — plus the cfg/cfg_endpoint config readers and the
# app-identity helpers. These are exactly the function DEFINITIONS that used to live inline in
# verify-phase.sh; moving the definitions into this lib is purely structural (bash binds functions at
# source time, before any of the orchestrator's executable lines run), so every resolver behaves
# byte-identically. The orchestrator keeps the EXECUTABLE statements that used to sit between these
# defs (PG_HUB_DATABASE=, : "${APP_ID:=}", WORKSPACE_ROOT=…) in their original order.
#
# Reads/uses globals the orchestrator owns (same names/meaning as before): SCRIPT_DIR REPO_ROOT
# (from sh-common.sh), WORKSPACE_ROOT WORKSPACE_OVERRIDE SPEC_PATH STATE_PATH APP_ID PG_HUB_DATABASE
# POSITIONAL_DB_NAME DB_NAME. schema-resolve.sh's helpers are used by resolve_subdomain's callers, not
# here. No `fail` call-site lives in this lib (these resolvers only echo / warn); the phase gates that
# CALL them — and own all the fail() FIX hints — stay in verify-phase.sh.

# ── infra coordinates from constructive.config.json (single source-of-truth) ────
# cfg / cfg_endpoint read one resolved value; each falls back to the literal $2 / its
# own default if the loader can't run (so this script still works standalone). Defaults
# equal today's values — only WHERE a value is read changes, not WHAT it defaults to.
# (|| true keeps these from tripping `set -e` when node is absent.)
cfg() { node "$SCRIPT_DIR/lib/config.mjs" get "$1" 2>/dev/null || printf '%s' "${2:-}"; }
cfg_endpoint() { node "$SCRIPT_DIR/lib/config.mjs" endpoint "$@" 2>/dev/null || true; }
# Host header (no scheme/port/path) from a built endpoint URL.
endpoint_host() { printf '%s' "$1" | sed -e 's#^[a-z]*://##' -e 's#:[0-9]*/graphql$##' -e 's#/graphql$##'; }

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
state_dir() {                       # echoes build/<app-id> when APP_ID set, else build
  if [ -n "${APP_ID:-}" ]; then echo "$REPO_ROOT/build/$APP_ID"; else echo "$REPO_ROOT/build"; fi
}

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
# Used for STRUCTURED reads (e.g. database.name) — the structured replacement for substring-sniffing
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
