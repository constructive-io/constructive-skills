# scripts/lib/verify-gates.sh — reusable GATE-assertion helpers for verify-phase.sh.
#
# Sourced (never executed) by scripts/verify-phase.sh AFTER lib/sh-common.sh, lib/schema-resolve.sh,
# and lib/verify-resolve.sh (it calls those resolvers + pass/fail/warn/info). It holds the gate
# helper FUNCTIONS the phase dispatch invokes — the run-state check, the bundled-checker locator, the
# additive Blocks/flows/harness-drift gates, the app compile + build-once helpers, the fail()-hint
# self-lint, and the opt-in live-QA round-trip. These are the exact function DEFINITIONS that used to
# live inline in verify-phase.sh; moving the definitions here is purely structural (bash binds
# functions at source time), so each gate behaves byte-identically.
#
# fail()-HINT NOTE: the helpers here carry their own fail() FIX hints (e.g. build_app,
# check_app_compiles, check_blocks_coverage, check_flows_drift, check_harness_drift, run_live_qa,
# check_state_fields, check_fail_hints). No hint text was changed — every fail() keeps its 2nd-arg
# hint verbatim. check_fail_hints() still LINTS the orchestrator file (it greps
# "$REPO_ROOT/scripts/verify-phase.sh" by its unchanged literal path), which after the split holds the
# arg-parse + per-phase `case` fail() call-sites; this lib's helpers are sourced INTO that script, so
# at runtime the gates fire identically.
#
# Reads/uses globals the orchestrator owns (same names/meaning as before): SCRIPT_DIR REPO_ROOT
# WORKSPACE_ROOT PHASE STATE_PATH SPEC_PATH GREEN (and the env overrides CHECK_SDK_MJS / CHECK_FLOWS_MJS
# / LIVE_QA* it always read). It calls resolvers from verify-resolve.sh (app_rel / workspace_path /
# resolve_app_package / resolve_sdk_package / spec_value / state_value) and logging from sh-common.sh.

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

# Next.js build-artifact dir for the app (the default distDir = <app>/.next; no template overrides
# it). A SUCCESSFUL `next build` always writes <app>/.next/BUILD_ID, so that file's presence is the
# robust "the app has already been built and the build succeeded" marker shared ACROSS phase
# invocations (Phase 2.4 produces it, Phase 2.5 consumes it). app_rel resolves the app package dir
# (`.` for the single-package template → WORKSPACE_ROOT, else packages/app / app).
app_build_id_file() {
  echo "$(workspace_path "$(app_rel)")/.next/BUILD_ID"
}

# Build the app ONCE via `pnpm --filter <pkg> build` and assert success. Factored out of Phase 2.4
# (the producer) and the Phase 2.5 guarded-rebuild fallback so the build invocation + its
# PASS/FAIL assertion are defined once. $1 = the PASS label, $2 = the FAIL summary; the FIX hint is
# the same "check the build log" line both call-sites used. Behaviour is byte-identical to the
# inline build blocks it replaces.
build_app() {
  local pass_label="$1" fail_label="$2"
  local app_package build_log
  app_package="$(resolve_app_package || true)"
  [ -n "$app_package" ] || fail "Could not resolve app package name" "Set a \"name\" in the app's package.json (it's what 'pnpm --filter <name> build' targets) — the nextjs/constructive-app template ships one; restore it if you cleared it (SKILL.md S3)."
  build_log="$(mktemp)"
  if (cd "$WORKSPACE_ROOT" && pnpm --filter "$app_package" build >"$build_log" 2>&1); then
    pass "$pass_label"
  else
    info "Build log: $build_log"
    fail "$fail_label" "Check TypeScript errors in $build_log"
  fi
}

# Gate-3 (Phase 2.5) build check. Phase 2.4 already runs a full `pnpm build` and, on success, leaves
# the <app>/.next/BUILD_ID artifact. Re-running a full build here was a pure double-rebuild time sink,
# so PREFER the existing artifact: if BUILD_ID is present (Phase 2.4 built the app this run), VERIFY
# against it instead of rebuilding. GUARD: if the artifact is missing (e.g. this phase is run
# standalone, or .next was cleaned), fall back to building ONCE via build_app — so the assertion is
# preserved (a broken build still FAILS here). $1 = PASS label, $2 = FAIL summary (same args build_app
# takes), so the fallback path is byte-identical to the old inline build.
verify_or_build_app() {
  local pass_label="$1" fail_label="$2"
  local build_id
  build_id="$(app_build_id_file)"
  if [ -f "$build_id" ]; then
    pass "$pass_label (verified against the existing build artifact from Phase 2.6 — $(dirname "$build_id"); not rebuilt)"
  else
    info "No existing build artifact ($build_id) — building once (Phase 2.6 was not run this session, or .next was cleaned)"
    build_app "$pass_label" "$fail_label"
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

# Additive DESIGN subsystem gate. Post-pivot the design COMPILER is gone: the design.md is the
# full spec the AGENT authors the frontend from, Blocks compose, and the ONLY surviving machine
# check is FUNCTIONAL — does the BUILT app's globals.css still satisfy the shadcn-token +
# Tailwind-v4 contract so Blocks render? Two independent checks, each self-disabling:
#   (A) ROT-CANARY — run the surviving Blocks token-contract validator's own test
#       (scripts/lib/design/blocks-contract.test.mjs) so the validator's pass/fail behaviour
#       (every shadcn name in :root + .dark, the @theme inline / @custom-variant / @source
#       wiring) cannot rot unnoticed. It ships in the skill, so it runs whenever this gate
#       fires — NO app needed. Self-disables only if that test is absent or `node` can't run it.
#   (B) FUNCTIONAL BLOCKS-CONTRACT GATE — once the frontend exists, validate the BUILT
#       <app>/src/app/globals.css with `check-design.mjs --app <app_root>` (RAIL 2): a dropped /
#       renamed shadcn token name or broken Tailwind-v4 wiring = ERROR, because Blocks would then
#       render unstyled. This is what the agent authors TOWARD, not a lint of any design.md.
# No app / no built globals.css yet → (B) is a clean no-op (pre-frontend phases). Wired into
# Phase 1 (the canary, app-independent) and Phase 2.4 (the functional --app check, post-frontend).
check_design() {
  command -v node >/dev/null 2>&1 || { warn "Design gate: 'node' not on PATH — skipped the design subsystem checks (not failing)"; return 0; }

  # (A) the rot-canary — the ONE surviving design test: the Blocks token-contract validator's
  #     own test (the compiler + its suite are deleted; this is all that remains).
  local canary_test="$REPO_ROOT/scripts/lib/design/blocks-contract.test.mjs"
  if [ -f "$canary_test" ]; then
    local out status=0
    out="/tmp/check-design-tests.$$"
    node --test "$canary_test" >"$out" 2>&1 || status="$?"
    if [ "$status" -eq 0 ]; then
      pass "Design: Blocks token-contract validator green (the shadcn-name + Tailwind-v4 wiring contract holds)"
      rm -f "$out"
    else
      tail -n 40 "$out" 2>/dev/null | sed 's/^/  /' || true
      rm -f "$out"
      fail "Design: the Blocks token-contract validator test FAILED (scripts/lib/design/blocks-contract.test.mjs)" "The Blocks-contract validator (check-design.mjs --globals) changed behaviour — it no longer PASSES a complete globals.css or no longer FAILS a broken one (a dropped shadcn token name, or missing @theme inline / @custom-variant dark / @source wiring). See the failing assertion above; fix scripts/check-design.mjs (or the test fixture) until 'node --test scripts/lib/design/blocks-contract.test.mjs' is green."
    fi
  fi

  # (B) FUNCTIONAL gate — validate the BUILT app's globals.css against the Blocks contract.
  #     No app / no built globals.css yet (pre-frontend phases) → clean no-op (return 0); the
  #     pre-check below means the checker is only invoked once there is something to validate,
  #     so its own exit-2 "globals.css not found" never reaches us here.
  local checker="$REPO_ROOT/scripts/check-design.mjs"
  [ -f "$checker" ] || return 0
  local app_root globals_css
  app_root="$(workspace_path "$(app_rel)")"
  [ -d "$app_root" ] || return 0
  globals_css="$app_root/src/app/globals.css"
  [ -f "$globals_css" ] || return 0

  echo "  INFO: Design gate — validating the BUILT app globals.css against the Blocks token contract ($globals_css)"
  local dout dstatus=0
  dout="/tmp/check-design-globals.$$"
  node "$checker" --app "$app_root" >"$dout" 2>&1 || dstatus="$?"
  if [ "$dstatus" -eq 0 ]; then
    pass "Design: built app globals.css satisfies the shadcn-token + Tailwind-v4 contract — Blocks render (check-design.mjs --app ok)"
    rm -f "$dout"
  elif [ "$dstatus" -eq 2 ]; then
    cat "$dout" 2>/dev/null || true
    rm -f "$dout"
    warn "Design: check-design.mjs could not run on $globals_css (exit 2) — skipped (not failing)"
  else
    cat "$dout" 2>/dev/null || true
    rm -f "$dout"
    fail "Design: built app globals.css fails the Blocks token contract (check-design.mjs --app, exit $dstatus)" "A shadcn token name or the @theme inline/@custom-variant/@source wiring is missing from the built globals.css — Blocks will render unstyled; restore the token contract in src/app/globals.css. See the finding(s) above and re-run 'node scripts/check-design.mjs --app <app_root>' until ok."
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
  # `set -e` GUARD: when nothing is listening, curl exits 7 (connection refused). curl is the LAST
  # command in this substitution, so its exit 7 becomes the assignment's status and, under `set -e`,
  # ABORTS the whole gate right here — BEFORE the `[ -z ]` fallback and the dev-server-start branch
  # below ever run (the app would never get started). `|| true` neutralizes ONLY curl's exit status
  # while keeping its stdout ("000" on refusal, or the real code on a live server); it does NOT
  # re-introduce the double-"000" the old `|| echo "000"` caused, since `true` prints nothing.
  already="$( { curl -s -o /dev/null -w "%{http_code}" "$base_url" 2>/dev/null || true; } )"; [ -z "$already" ] && already="000"
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
      # Same `set -e` guard as above: until the app binds, curl exits 7 and would abort the poll
      # loop on its very first iteration. `|| true` keeps the captured code while ignoring the exit.
      code="$( { curl -s -o /dev/null -w "%{http_code}" "$base_url" 2>/dev/null || true; } )"; [ -z "$code" ] && code="000"
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
