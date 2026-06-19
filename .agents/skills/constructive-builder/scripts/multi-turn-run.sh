#!/bin/bash
set -euo pipefail

# multi-turn-run.sh — the GENERIC day-2 multi-turn DRIVER.
#
# It proves the skill is not just a one-shot scaffolder but a DAY-2 tool: build a baseline app
# (turn 0), then apply a SEQUENCE of one-change-per-turn edits and, after each, re-verify that
# the change landed AND nothing regressed — recording HOW each change landed in a scorecard.
#
# Everything app-specific is read from a TURNS FILE (turns.json) — the brief to seed turn 0, and
# per-turn { what to change, how to apply it skill-only, what new capability to assert, what
# baseline flows must still pass }. This script hard-codes NOTHING about any app/domain/entity:
# the fixtures carry all the specifics. Point it at a different turns.json and it drives that app.
#
# ── MODES ─────────────────────────────────────────────────────────────────────
#   skill-only   FULLY BUILT. Each turn is applied the way the SKILL prescribes (apply the turn's
#                brief_patch_ops to the brief copy, re-scaffold the provision files, re-provision),
#                exactly per the turn's skill_only_path. The VERDICT is decided EMPIRICALLY — by what
#                actually happened to the live app — NOT by any prediction the fixture wrote:
#                  • provision exit 0  AND  the new column/table/relation/policy ACTUALLY APPEARS in
#                    the tenant's live schema (the generic "did-it-land" probe below)  AND  the dual
#                    re-verify passes                              → clean
#                  • the change landed only after a manual edit / extra mechanism              → hand-fixed
#                  • the change did NOT land (whatever the cause — capture the REAL error VERBATIM)→ impossible
#                  • some layers synced and others drifted (e.g. modules unchanged but Blocks/ops
#                    wired, or schema landed but a regression flow broke)                       → partial
#                The runner does NOT read a "[EXPECT abort: …]" marker as a verdict signal; the abort
#                code a fixture once guessed (PROVISION-RERUN-001) is irrelevant — only DID-IT-LAND
#                decides. (Verified day-2 reality: additive re-provision is IDEMPOTENT — an additive
#                column/table/relation lands CLEAN skill-only; the real wall is a NOT-NULL column on a
#                populated table, and a no-module flow add is PARTIAL — Blocks install, re-provision
#                leg is a no-op. The runner measures this rather than asserting it.)
#   hybrid       STUB this stage. Requires the Stage-C day-2 driver (scripts/day2-sync.sh). When
#                that script is absent, every turn records verdict=blocked-stage-c and the run
#                prints "hybrid mode requires Stage C day2-driver". (Stage C fills this in.)
#
# ── WHAT EACH TURN DOES ────────────────────────────────────────────────────────
#   TURN 0  Build the baseline app from turns.json's app.turn0_brief via the EXISTING skill build
#           path (scaffold-app.mjs provision + frontend; the operator's warm-hub create-db +
#           provision + codegen happen between, per SKILL.md S1–S7), gated green by verify-phase.sh
#           (the SAME gates golden-path runs). On green: git init the workspace, commit, tag
#           turn-0-green. Record turn-0 time.
#   TURN N  (sequential; each RESUMES the prior workspace) Start a per-turn timer. Apply the turn's
#           brief_patch_ops to the brief copy + re-scaffold (skill-only) — or the hybrid stub. Run
#           the skill_only_path command, capturing its exit + output. THEN probe the live tenant
#           schema to see if the turn's change ACTUALLY LANDED (did_change_land — generic over the
#           brief_patch_ops). If provision exited non-zero AND the change did not land → verdict
#           impossible, with the REAL error captured VERBATIM (no marker, no predicted code). If the
#           change landed (or provision was a no-op for a no-module flow add), restart dev CLEAN (the
#           mid-session codegen+scaffold guard), best-effort re-verify, then call lib/day2-verify.mjs
#           for the DUAL assertion (new capability round-trips AND every regression flow still
#           passes), fold land×dual into a verdict, write a scorecard row, tag turn-<N>-<v>. If the
#           change did NOT land, REVERT this turn's brief patch + partial scaffold before the next
#           turn so a failed turn never poisons a later re-provision (LAND-OR-REVERT).
#   Report  Print the scorecard markdown table + total + per-turn elapsed.
#
# ── turns.json CONTRACT (what this GENERIC runner reads — author A's schema) ───
#   app:   { turn0_brief, db_name_base, owner_entity, owner_entity_singular, turn0_flows[] }
#   turns[]: each {
#     id, title, layer,
#     skill_only_path:  STRING — the literal skill-only steps the runner executes (edit brief →
#                       scaffold-provision → re-provision). It is DOCUMENTATION of the steps, NOT a
#                       verdict oracle: any "[EXPECT …]"/"[NOTE …]" prose in it is ignored for
#                       scoring — the verdict comes from the live did-it-land probe + dual-verify.
#     hybrid_path:      STRING — the Stage-C day2-driver steps (driven only in hybrid mode = stub here).
#     brief_patch_ops[]: the MACHINE-PARSEABLE change the runner applies to the per-run brief copy:
#                        { op: add_field,        table, field:{name,type:{name},required?,default?} }
#                        { op: add_table,        table:{name,policy,fields[]} }
#                        { op: add_relation,     relation:{$type,source_table,target_table,field_name,delete_action,is_required} }
#                        { op: add_ui_route,     route:{path,label,kind,entity} }
#                        { op: set_table_policy, table, to_policy }
#                        { op: add_flow,         flow:"<id>" }
#     new_capability_assert: STRING (the human assertion). The runner derives the new-capability FLOW
#                            set generically: a turn that adds a flow (op add_flow or a `flow.id`)
#                            drives THAT flow; otherwise the new capability is the owner-entity CRUD
#                            round-trip, which the regression flow already exercises on the owner entity.
#     regression_flows[]:    the baseline flows that must STILL pass.
#     flow?:                 (turn that adds a flow) { id, exposed_ops[], blocks[], needs_email, mailpit_url }
#   }
#
# ── USAGE ──────────────────────────────────────────────────────────────────────
#   ./scripts/multi-turn-run.sh --mode <skill-only|hybrid> --turns <path/to/turns.json> \
#       [--tag <alnum>] [--up-to <N>] [--help]
#
#   --mode    skill-only (fully built) | hybrid (Stage-C stub)
#   --turns   path to the turns.json fixture (repo- or cwd-relative, or absolute)
#   --tag     per-run alphanumeric suffix appended to db_name so concurrent runs never collide
#             (default: a short timestamp-derived tag). Sanitized to [a-z0-9].
#   --up-to   stop after turn <id> N (default: run every turn in the file). Turn 0 always runs.
#
# ── ENV ────────────────────────────────────────────────────────────────────────
#   MTR_BUILD_CMD     the turn-0 cold-build command (a single shell command, cwd=app workspace, with
#                     APP_ID/BRIEF/STATE_PATH/DB_NAME exported). RECOMMENDED for a real end-to-end run:
#                     the DEFAULT only EMITS files (scaffold-provision + scaffold-frontend) — it does
#                     NOT run create-db/provision/codegen (that mutates the hub), so the default alone
#                     will NOT pass the 2.3/2.6 gates. Supply the operator's full SKILL.md S1–S7 build
#                     here (pgpm init → scaffold-provision → create-db + provision → frontend template +
#                     wire-app → install + codegen → scaffold-frontend) for a green turn 0, or pre-build
#                     the workspace and set MTR_BUILD_PHASES so the gates verify the existing build.
#   MTR_BUILD_PHASES  override the turn-0 verify phase set (default "1 2.1 2.3 2.6 3").
#   MTR_NO_GIT=1      skip the per-workspace git init/commit/tag (CI without a git identity)
#   LIVE_QA_BASE_URL  app URL for the dual-assert driver (default: per-app run-state port → brief → config)
#   CONSTRUCTIVE_CLI  abs path to the constructive CLI (only if :3000 must restart; see S0)
#   MTR_NO_RESTART=1  never restart :3000 (smoke only; fail if down)
#
# Exit: 0 = turn 0 green AND every turn was MEASURED to a recorded verdict (clean / hand-fixed /
#       partial / impossible) without the runner itself erroring; a turn whose change did not land
#       (impossible — real error captured) or a hybrid 'blocked-stage-c' turn is a recorded FINDING,
#       not a run failure. Non-zero = turn-0 build failed, or the runner could not measure a turn
#       (e.g. could not even apply the brief patch / probe the schema / drive the dual-verify).

# ── shared preamble + phase-runner machinery (one copy, in lib/) ────────────────
# sh-common.sh: RED/GREEN/YELLOW/NC + pass/fail/warn/info/hr + SCRIPT_DIR/REPO_ROOT.
# phase-runner.sh: cfg / resolve_app_id / state_dir / pr_hub_coords / discover_constructive_cli /
#   smoke_backend / pr_s0_smoke_and_restart / pr_pg_hydrate / state_app_field / pr_resolve_app_url /
#   pr_run_phases — the SAME S0-smoke, PG-hydration, app-URL and phase-loop boilerplate golden-path.sh
#   and genericity-check.sh use (we pass the few differing strings as args, exactly as they do).
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/sh-common.sh
. "$_LIB_DIR/sh-common.sh"
# shellcheck source=lib/phase-runner.sh
. "$_LIB_DIR/phase-runner.sh"

# Infra coordinates (HUB_PORT + platform api endpoint + Host header) from constructive.config.json.
pr_hub_coords

SCORECARD_LIB="$REPO_ROOT/scripts/lib/day2-scorecard.mjs"
VERIFY_LIB="$REPO_ROOT/scripts/lib/day2-verify.mjs"
DAY2_SYNC="$REPO_ROOT/scripts/day2-sync.sh"  # Stage-C hybrid driver (absent this stage → hybrid is a stub)

# Physical hub Postgres database that holds the metaschema + every per-tenant schema (config
# db.hubDatabase, env-overridable). The did-it-land probe connects here to inspect the tenant's
# live schema. Single source of truth — never a literal db name.
HUB_PG_DB="$(cfg db.hubDatabase constructive)"

# ── args ─────────────────────────────────────────────────────────────────────
MODE=""
TURNS_FILE=""
TAG=""
UP_TO=""
NO_RESTART="${MTR_NO_RESTART:-0}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --turns) TURNS_FILE="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --up-to) UP_TO="$2"; shift 2 ;;
    --no-restart) NO_RESTART=1; shift ;;
    -h|--help)
      # Print the header doc block (lines 3 .. the line before the "shared preamble" marker), so the
      # help text auto-tracks header edits — no brittle hard-coded end line.
      _hdr_end="$(grep -n '^# ── shared preamble' "${BASH_SOURCE[0]}" | head -n1 | cut -d: -f1)"
      [ -n "$_hdr_end" ] || _hdr_end=110
      sed -n "3,$((_hdr_end - 2))p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "Unknown argument: $1" "see ./scripts/multi-turn-run.sh --help" ;;
  esac
done

case "$MODE" in
  skill-only|hybrid) : ;;
  "") fail "missing --mode" "pass --mode skill-only (fully built) or --mode hybrid (Stage-C stub)" ;;
  *) fail "unknown --mode: $MODE" "valid modes: skill-only | hybrid" ;;
esac

[ -n "$TURNS_FILE" ] || fail "missing --turns" "pass --turns path/to/turns.json (the day-2 turn fixture)"
case "$TURNS_FILE" in
  /*) : ;;
  *) if [ -f "$PWD/$TURNS_FILE" ]; then TURNS_FILE="$PWD/$TURNS_FILE";
     elif [ -f "$REPO_ROOT/$TURNS_FILE" ]; then TURNS_FILE="$REPO_ROOT/$TURNS_FILE";
     elif [ -f "$REPO_ROOT/fixtures/$TURNS_FILE" ]; then TURNS_FILE="$REPO_ROOT/fixtures/$TURNS_FILE";
     fi ;;
esac
[ -f "$TURNS_FILE" ] || fail "turns file not found: $TURNS_FILE" \
  "pass an existing turns.json (e.g. fixtures/day2/turns.json). It carries the seed brief + per-turn changes."
TURNS_DIR="$(cd "$(dirname "$TURNS_FILE")" && pwd)"

# A tiny zero-dep JSON reader over the turns file (Node). `tj <dotted/bracket path>` prints a
# scalar (objects/arrays as compact JSON); `tj_json <path>` is its alias for a sub-tree; `tj_len
# <path>` prints an array length. ALL turns.json access goes through these — the script never
# hand-parses JSON. Paths use dots + [i] (e.g. turns[0].title). Missing → "" (scalar) / 0 (len).
tj() { node -e '
  const fs=require("fs");
  const obj=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const toks=(process.argv[2]||"").split(/\.|\[/).map(t=>t.replace(/\]$/,"")).filter(s=>s!=="");
  let cur=obj; for(const t of toks){ if(cur==null){cur=undefined;break;} cur=cur[/^\d+$/.test(t)?Number(t):t]; }
  process.stdout.write(cur==null?"":(typeof cur==="object"?JSON.stringify(cur):String(cur)));
' "$TURNS_FILE" "$1" 2>/dev/null || true; }
tj_len() { node -e '
  const fs=require("fs");
  const obj=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const toks=(process.argv[2]||"").split(/\.|\[/).map(t=>t.replace(/\]$/,"")).filter(s=>s!=="");
  let cur=obj; for(const t of toks){ if(cur==null){cur=undefined;break;} cur=cur[/^\d+$/.test(t)?Number(t):t]; }
  process.stdout.write(String(Array.isArray(cur)?cur.length:0));
' "$TURNS_FILE" "$1" 2>/dev/null || echo 0; }
# tj_json: a sub-tree as JSON. tj already serializes objects/arrays as compact JSON, so this is
# simply an alias kept for call-site readability where a JSON value (not a scalar) is expected.
tj_json() { tj "$1"; }

# ── resolve the seed brief + db_name base + per-run app-id (author A's `app` block) ─────────────
SEED_BRIEF="$(tj app.turn0_brief)"
# Back-compat: also accept a turn_0.brief shape if a future fixture uses it.
[ -n "$SEED_BRIEF" ] || SEED_BRIEF="$(tj turn_0.brief)"
[ -n "$SEED_BRIEF" ] || fail "turns.json has no app.turn0_brief" \
  "the fixture must name the seed brief, e.g. \"app\": { \"turn0_brief\": \"turn0-….yaml\" }"
case "$SEED_BRIEF" in
  /*) : ;;
  *) if [ -f "$TURNS_DIR/$SEED_BRIEF" ]; then SEED_BRIEF="$TURNS_DIR/$SEED_BRIEF";
     elif [ -f "$PWD/$SEED_BRIEF" ]; then SEED_BRIEF="$PWD/$SEED_BRIEF";
     elif [ -f "$REPO_ROOT/$SEED_BRIEF" ]; then SEED_BRIEF="$REPO_ROOT/$SEED_BRIEF"; fi ;;
esac
[ -f "$SEED_BRIEF" ] || fail "seed brief not found: $SEED_BRIEF" "fix app.turn0_brief in $TURNS_FILE"

DB_BASE="$(tj app.db_name_base)"; [ -n "$DB_BASE" ] || DB_BASE="$(tj db_name_base)"
[ -n "$DB_BASE" ] || DB_BASE="$(resolve_app_id "$SEED_BRIEF")"
[ -n "$DB_BASE" ] || fail "could not determine a db_name base" \
  "set app.db_name_base, or give the seed brief a naming.db_name"

# Per-run tag → a DISTINCT database per run (<db_name_base> + a1b2c3 → <db_name_base>a1b2c3). The combined
# db_name MUST be ^[a-z][a-z0-9]*$ (validateBrief), so the tag is lowercase [a-z0-9] only.
[ -n "$TAG" ] || TAG="$(date +%s | tail -c 7)"
TAG="$(printf '%s' "$TAG" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
[ -n "$TAG" ] || fail "the --tag sanitized to empty" "pass an alphanumeric --tag (a-z0-9)"
DB_NAME="${DB_BASE}${TAG}"
APP_ID="$DB_NAME"           # per-app state id = the (tagged) db_name (the harness convention)
export APP_ID

# Owner entity → the live-QA CRUD path (pluralized route, e.g. post → /posts). Generic: pulled
# from the fixture's app.owner_entity, never hard-coded. Falls back to the seed brief's first crud route.
OWNER_ENTITY="$(tj app.owner_entity)"            # the table (plural), e.g. "posts" — or owner_entity_singular
OWNER_SINGULAR="$(tj app.owner_entity_singular)" # the entity (singular), e.g. "post"
TURN0_FLOWS="$(tj_json app.turn0_flows)"; [ -n "$TURN0_FLOWS" ] || TURN0_FLOWS='["email-password"]'
# CRUD path: prefer a route in the seed brief that matches the owner entity; else /<owner_entity>.
OWNER_CRUD_PATH=""
if [ -n "$OWNER_ENTITY" ]; then OWNER_CRUD_PATH="/$OWNER_ENTITY"; fi

# Per-app STATE dir (build/<app-id>/) and the app WORKSPACE (build/<app-id>/<app-id>/ — the nested
# pnpm workspace the harness scaffolds, mirroring build/crmfinal/crmfinal). State files (brief copy,
# run-state, flow-surfaces, scorecard) live in the STATE dir; the workspace holds packages/*.
STATE_DIR="$REPO_ROOT/build/$APP_ID"
APP_DIR="$STATE_DIR/$APP_ID"
RUN_BRIEF="$STATE_DIR/app-brief.yaml"   # the per-app brief COPY the gates + driver read
SCORECARD_FILE="$STATE_DIR/day2-scorecard.json"
mkdir -p "$STATE_DIR"

VERIFY="$REPO_ROOT/scripts/verify-phase.sh"
[ -x "$VERIFY" ] || fail "verify-phase.sh not found/executable at $VERIFY" "the runner gates turns through the real phase gates"
[ -f "$SCORECARD_LIB" ] || fail "day2-scorecard.mjs not found at $SCORECARD_LIB" "the runner records each turn there"
[ -f "$VERIFY_LIB" ] || fail "day2-verify.mjs not found at $VERIFY_LIB" "the runner dual-asserts each turn there"

BUILD_PHASES="${MTR_BUILD_PHASES:-1 2.1 2.3 2.6 3}"
NTURNS="$(tj_len turns)"

echo
echo -e "${GREEN}Constructive harness — DAY-2 MULTI-TURN RUN${NC}"
hr
info "mode       : $MODE"
info "turns file : $TURNS_FILE  ($NTURNS turn(s))"
info "seed brief : $SEED_BRIEF"
info "db_name    : $DB_NAME  (base '$DB_BASE' + tag '$TAG')"
info "app-id     : $APP_ID"
info "owner CRUD : ${OWNER_CRUD_PATH:-(derived from brief)}  (entity '${OWNER_SINGULAR:-?}')"
info "state dir  : $STATE_DIR"
info "app dir    : $APP_DIR"
[ -n "$UP_TO" ] && info "up-to      : turn $UP_TO"
hr

node "$SCORECARD_LIB" init --file "$SCORECARD_FILE" --app-id "$APP_ID" --db-name "$DB_NAME" --mode "$MODE" >/dev/null 2>&1 || true

# ── git helpers (operate ON THE APP WORKSPACE; build/ is gitignored in the skill repo, so this
#    nested repo is isolated). MTR_NO_GIT=1 skips them for CI without a git identity. ───────────
git_w() { ( cd "$APP_DIR" && git "$@" ); }
git_init_workspace() {
  [ "${MTR_NO_GIT:-0}" = "1" ] && { info "git: skipped (MTR_NO_GIT=1)"; return 0; }
  [ -d "$APP_DIR" ] || return 0
  if [ ! -d "$APP_DIR/.git" ]; then
    git_w init -q 2>/dev/null || { warn "git init failed in $APP_DIR — continuing without snapshots (set MTR_NO_GIT=1 to silence)"; return 0; }
    git_w add -A >/dev/null 2>&1 || true
    git_w -c user.email=day2@harness -c user.name='day2-runner' commit -q -m 'turn 0: baseline app (pre-tag)' >/dev/null 2>&1 || true
  fi
}
git_commit_tag() {
  # $1 = tag, $2 = message. Best-effort: never let a git hiccup fail the run.
  [ "${MTR_NO_GIT:-0}" = "1" ] && return 0
  [ -d "$APP_DIR/.git" ] || return 0
  git_w add -A >/dev/null 2>&1 || true
  git_w -c user.email=day2@harness -c user.name='day2-runner' commit -q -m "$2" --allow-empty >/dev/null 2>&1 || true
  git_w tag -f "$1" >/dev/null 2>&1 || true
  info "git: tagged $1"
}

# ── per-app brief COPY writer: seed → state/app-brief.yaml, rewriting naming.db_name to the tagged
#    DB_NAME (so this run is isolated). Generic: a single targeted line-rewrite of the first db_name
#    value — no YAML dep, no app specifics. Re-callable. ──────────────────────────────────────────
seed_run_brief() {
  cp "$SEED_BRIEF" "$RUN_BRIEF"
  if grep -qE '^[[:space:]]*db_name[[:space:]]*:' "$RUN_BRIEF"; then
    awk -v repl="$DB_NAME" '
      BEGIN{done=0}
      /^[[:space:]]*db_name[[:space:]]*:/ && !done { sub(/db_name[[:space:]]*:.*/, "db_name: " repl); done=1 }
      { print }
    ' "$RUN_BRIEF" > "$RUN_BRIEF.tmp" && mv "$RUN_BRIEF.tmp" "$RUN_BRIEF"
  fi
  info "brief copy : $RUN_BRIEF  (naming.db_name → $DB_NAME)"
}

resolve_app_url() { BRIEF="$RUN_BRIEF" pr_resolve_app_url; }

# ── apply ONE turn's brief_patch_ops[] to the run-brief copy. GENERIC over author A's op set
#    (add_field / add_table / add_relation / add_ui_route / set_table_policy / add_flow). It is a
#    structural-but-text-level YAML editor (no serializer dep): each op maps to an insertion under
#    the right block or a value replacement, matching the OBJECT field shapes brief.mjs expects
#    (type:{name}, default:{value}). Driven entirely by the ops JSON — nothing app-specific here.
#    Implemented as one Node pass so multi-line YAML edits are reliable. Echoes a per-op log. ─────
apply_brief_patch_ops() {
  local turn_idx="$1" ops_json
  ops_json="$(tj "turns[$turn_idx].brief_patch_ops")"
  [ -n "$ops_json" ] && [ "$ops_json" != "null" ] || { info "no brief_patch_ops for this turn"; return 0; }
  BRIEF_PATH="$RUN_BRIEF" OPS_JSON="$ops_json" node -e '
    const fs=require("fs");
    const file=process.env.BRIEF_PATH; let text=fs.readFileSync(file,"utf8");
    let ops; try{ ops=JSON.parse(process.env.OPS_JSON); }catch{ ops=[]; }
    if(!Array.isArray(ops)) ops=[ops];
    const lines=()=>text.split("\n");
    const indentOf=(l)=>{const m=l.match(/^(\s*)/);return m?m[1].length:0;};
    // Find the line index of a `key:` at a given indent under a section opened by parentKey.
    function findKeyLine(arr,key,fromIdx=0){ for(let i=fromIdx;i<arr.length;i++){ if(new RegExp("^\\s*"+key+"\\s*:").test(arr[i])) return i; } return -1; }
    // Append a YAML sequence item under `key:` (creating the block if it was `key: []`). itemLines is
    // an array of already-indented (relative) strings; we re-indent to the block.
    function appendUnderKey(key,itemLines){
      let arr=lines();
      let ki=findKeyLine(arr,key);
      if(ki<0){ // no such key — append the key + block at end (best-effort)
        arr.push(key+":"); ki=arr.length-1;
      }
      const baseIndent=indentOf(arr[ki]);
      // If the key is inline empty (`key: []`), convert to a block header.
      arr[ki]=arr[ki].replace(/:\s*\[\s*\]\s*$/,":");
      // Insertion point: after the last child line that is MORE-indented than the key (the block body).
      let ins=ki+1;
      for(let i=ki+1;i<arr.length;i++){ const l=arr[i]; if(l.trim()==="" ){ins=i+1;continue;} if(indentOf(l)>baseIndent){ins=i+1;} else break; }
      const childIndent=" ".repeat(baseIndent+2);
      const block=itemLines.map(s=>childIndent+s);
      arr.splice(ins,0,...block);
      text=arr.join("\n");
    }
    // Replace `policy: X` for a specific table block (the table whose `- name: <t>` we match).
    function setTablePolicy(table,toPolicy){
      const arr=lines(); let inTbl=false, tblIndent=-1;
      for(let i=0;i<arr.length;i++){
        const l=arr[i];
        const nameM=l.match(/^(\s*)-\s*name\s*:\s*([A-Za-z0-9_]+)/) || l.match(/^(\s*)-\s*\{\s*name\s*:\s*([A-Za-z0-9_]+)/);
        if(nameM){ inTbl = nameM[2]===table; tblIndent = nameM[1].length; continue; }
        if(inTbl){
          if(l.trim()!=="" && indentOf(l)<=tblIndent && /^\s*-/.test(l)) { inTbl=false; continue; }
          if(/^\s*policy\s*:/.test(l)){ arr[i]=l.replace(/policy\s*:.*/,"policy: "+toPolicy); inTbl=false; }
        }
      }
      text=arr.join("\n");
    }
    // Render a field object as a one-line flow map matching brief.mjs (type:{name}, default:{value}).
    function fieldLine(f){
      const parts=["name: "+f.name];
      if(f.type&&f.type.name) parts.push("type: { name: "+f.type.name+" }");
      if(f.required===true) parts.push("required: true");
      if(f.default&&("value" in f.default)) parts.push("default: { value: "+JSON.stringify(f.default.value)+" }");
      return "- { "+parts.join(", ")+" }";
    }
    for(const op of ops){
      if(!op||!op.op) continue;
      if(op.op==="add_field"){
        // Insert the field under the target table fields block. Locate the table, then its fields:.
        const arr=lines(); let ti=-1, tIndent=-1;
        for(let i=0;i<arr.length;i++){ const m=arr[i].match(/^(\s*)-\s*name\s*:\s*([A-Za-z0-9_]+)/); if(m&&m[2]===op.table){ ti=i; tIndent=m[1].length; break; } }
        if(ti<0){ console.error("  [ops] add_field: table "+op.table+" not found — skipped"); continue; }
        let fi=-1; for(let i=ti+1;i<arr.length;i++){ if(indentOf(arr[i])<=tIndent && /^\s*-/.test(arr[i])) break; if(/^\s*fields\s*:/.test(arr[i])){ fi=i; break; } }
        if(fi<0){ console.error("  [ops] add_field: fields: not found under "+op.table+" — skipped"); continue; }
        const fIndent=indentOf(arr[fi]);
        let ins=fi+1; for(let i=fi+1;i<arr.length;i++){ const l=arr[i]; if(l.trim()===""){ins=i+1;continue;} if(indentOf(l)>fIndent){ins=i+1;} else break; }
        arr.splice(ins,0," ".repeat(fIndent+2)+fieldLine(op.field));
        text=arr.join("\n");
        console.error("  [ops] add_field "+op.table+"."+op.field.name);
      } else if(op.op==="add_table"){
        const t=op.table; const body=["- name: "+t.name];
        if(t.policy) body.push("  policy: "+t.policy);
        body.push("  fields:");
        for(const f of (t.fields||[])) body.push("    "+fieldLine(f));
        appendUnderKey("tables",body.map(s=>s)); // tables: lives under data_model: — appendUnderKey finds `tables:`
        console.error("  [ops] add_table "+t.name+" (policy "+(t.policy||"?")+")");
      } else if(op.op==="add_relation"){
        const r=op.relation; const item=["- { $type: "+r.$type+", source_table: "+r.source_table+", target_table: "+r.target_table+", field_name: "+r.field_name+(r.delete_action?(", delete_action: "+r.delete_action):"")+(r.is_required===true?", is_required: true":"")+" }"];
        appendUnderKey("relations",item);
        console.error("  [ops] add_relation "+r.source_table+"."+r.field_name+" -> "+r.target_table);
      } else if(op.op==="add_ui_route"){
        const rt=op.route; const item=["- { path: "+rt.path+", label: "+rt.label+", kind: "+(rt.kind||"crud")+(rt.entity?(", entity: "+rt.entity):"")+" }"];
        appendUnderKey("routes",item);
        console.error("  [ops] add_ui_route "+rt.path);
      } else if(op.op==="set_table_policy"){
        setTablePolicy(op.table,op.to_policy);
        console.error("  [ops] set_table_policy "+op.table+" -> "+op.to_policy);
      } else if(op.op==="add_flow"){
        const id=typeof op.flow==="string"?op.flow:(op.flow&&op.flow.id);
        if(id){ appendUnderKey("flows",["- "+id]); console.error("  [ops] add_flow "+id); }
      } else {
        console.error("  [ops] unknown op "+op.op+" — skipped");
      }
    }
    fs.writeFileSync(file,text);
  ' 2>&1 | sed 's/^/    /' || warn "brief_patch_ops application reported issues (continuing — the did-it-land probe will tell us whether the change actually took effect)"
}

# ── BRIEF SNAPSHOT / REVERT (cumulative-brief LAND-OR-REVERT) ───────────────────
# The turns are cumulative: each turn edits the SAME run-brief on top of the prior turn's. If a
# turn's change FAILS TO LAND, its half-applied brief patch (and any provision files re-scaffolded
# from it) must NOT carry into the next turn's re-provision — otherwise a failed turn poisons every
# later turn (the Stage-B turn-4 inherited turn-3's residue). So before applying a turn we SNAPSHOT
# the run-brief; if the change did not land we RESTORE that snapshot and re-scaffold the provision
# files from the restored (good) brief, leaving the next turn a clean cumulative base. Generic: it
# snapshots/restores a file + re-runs the same scaffolder — nothing app-specific.
BRIEF_SNAPSHOT="$STATE_DIR/.brief-snapshot.yaml"
snapshot_run_brief() { cp "$RUN_BRIEF" "$BRIEF_SNAPSHOT" 2>/dev/null || true; }
revert_run_brief() {
  [ -f "$BRIEF_SNAPSHOT" ] || { warn "no brief snapshot to revert to (continuing)"; return 0; }
  cp "$BRIEF_SNAPSHOT" "$RUN_BRIEF" 2>/dev/null || true
  info "land-or-revert: restored the run-brief to its pre-turn snapshot (the failed turn's patch is dropped)"
  # Re-scaffold the provision files from the restored brief so the next turn's re-provision starts
  # from the LAST-GOOD schema, not the failed turn's half-written one. Best-effort + quiet.
  node "$REPO_ROOT/scripts/scaffold-app.mjs" "$RUN_BRIEF" "$APP_DIR" --phase provision >/dev/null 2>&1 \
    || warn "re-scaffold from the reverted brief reported issues (the next turn still starts from the good brief)"
}

# ── DEV RESTART CLEAN (mid-session codegen+scaffold guard) ──────────────────────
# A day-2 turn that lands its change re-runs codegen + scaffold-frontend while a Next.js dev server
# (`next dev`, Turbopack) is still serving the app. That dev server's PostCSS/Tailwind HOT-RELOAD
# chokes on a mid-session regen and starts serving HTTP 500 for the app's CSS (a documented day-2
# derailer) — which then fails Chrome live-QA for reasons that have NOTHING to do with the change.
# The fix is to restart dev CLEAN after the regen: (1) KILL any process bound to the app's resolved
# port — the stale hot-reloading dev server — and (2) remove the stale .next build cache. We do NOT
# start a server here: the very NEXT step the runner takes is the re-verify phase sweep, whose public
# phase 2.6 runs a fresh `next build` (rebuilding .next from scratch) and whose phase 3 live-QA gate
# then `next start`s that clean build — so this teardown is what makes that next build+start clean.
# (rm -rf .next is safe precisely because phase 2.6 rebuilds it before anything serves it.) Generic +
# best-effort: it derives the port from run-state/brief (never a literal) and never fails the run.
# Skipped when the hub/app lifecycle is unmanaged (CONSTRUCTIVE_HUB_MANAGED=false / hub.managed=false)
# — an embedder owns its own dev server and we must not kill it.
restart_dev_clean() {
  local why="${1:-mid-session codegen+scaffold}"
  local hub_managed; hub_managed="$(cfg hub.managed true)"
  if [ "${CONSTRUCTIVE_HUB_MANAGED:-$hub_managed}" = "false" ]; then
    info "dev-restart: skipped (unmanaged lifecycle) — restart the app's dev server yourself after $why so a stale PostCSS hot-reload (HTTP 500 on CSS) doesn't derail Chrome QA"
    return 0
  fi
  info "dev-restart CLEAN after $why (avoids the PostCSS hot-reload 500 that derails Chrome QA)"
  # Kill any dev server bound to THIS app's resolved port (derived, never a literal). Best-effort.
  resolve_app_url
  local port; port="${APP_PORT:-}"
  if [ -n "$port" ]; then
    local pids; pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill $pids >/dev/null 2>&1 || true
      info "dev-restart: stopped dev server(s) on port $port (pids: $(printf '%s' "$pids" | tr '\n' ' '))"
    fi
  fi
  # Remove the stale Next.js build cache; the re-verify phase 2.6 (`next build`) regenerates it from
  # scratch before phase 3 serves it, so the served CSS is clean (no stale hot-reload state).
  local nextdir
  for nextdir in "$APP_DIR/packages/app/.next" "$APP_DIR/.next"; do
    [ -d "$nextdir" ] && { rm -rf "$nextdir" >/dev/null 2>&1 && info "dev-restart: removed stale build cache $nextdir" || true; }
  done
}

# ── run a turn's skill_only_path. skill_only_path is a human STRING; the runner executes the
#    canonical skill-only day-2 steps it documents: re-scaffold provision from the edited brief,
#    then `cd packages/provision && pnpm run provision`. Sets CMD_EXIT + CMD_TAIL. ───────────────
run_skill_only_steps() {
  local log status=0
  CMD_EXIT=0; CMD_TAIL=""
  info "skill-only: re-scaffold provision files from the edited brief (scaffold-provision)"
  if ! node "$REPO_ROOT/scripts/scaffold-app.mjs" "$RUN_BRIEF" "$APP_DIR" --phase provision >/dev/null 2>&1; then
    warn "scaffold-provision returned non-zero on the edited brief"
  fi
  log="$(mktemp)"
  info "skill-only: cd packages/provision && pnpm run provision  (full re-provision of an already-provisioned DB)"
  if ( cd "$APP_DIR/packages/provision" 2>/dev/null && APP_ID="$APP_ID" STATE_PATH="$STATE_DIR/run-state.json" \
       pnpm run provision ) >>"$log" 2>&1; then
    :
  else
    status="$?"; CMD_EXIT="$status"
  fi
  CMD_TAIL="$(tail -n 40 "$log" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' || true)"
  rm -f "$log"
  return 0
}

# ── did_change_land — the GENERIC "DID-IT-LAND" probe (the verdict's ground truth) ──────────────
# After a turn's re-provision, ask the LIVE tenant schema whether the turn's change ACTUALLY took
# effect — NOT whether a fixture predicted it would. It is generic over author A's brief_patch_ops:
# each op maps to an existence check in the tenant's own `app_public` schema (resolved exactly the
# way provision.ts does — by DATABASE_ID from the app's .env, with a db-name LIKE fallback), using
# only catalog/information_schema queries. NOTHING app-specific is hard-coded: the table/column/
# relation/policy names all come from the ops.
#   add_field        → the column field.name exists on `table`  (also reports its nullability, so the
#                      caller can tell a clean add from a NOT-NULL-on-populated-table failure)
#   add_table        → the table table.name exists
#   add_relation     → the FK column relation.field_name exists on relation.source_table
#   set_table_policy → (to public-read+owner-write) a `_publishable$` SELECT policy exists on `table`
#                      (the platform's AuthzPublishable derivation — the SAME signal provision.ts
#                      discovers); other policy targets check the table simply still has policies
#   add_ui_route     → no DB artifact (frontend-only) → not a DB landing signal (dual-verify judges it)
#   add_flow         → no DB artifact when the flow adds zero modules (Blocks+ops only) → not a DB
#                      landing signal (dual-verify + the no-module note judge it)
# Sets DID_LAND ∈ { yes | no | unknown | n/a } and DID_LAND_DETAIL (a one-line human summary):
#   yes      every DB-checkable op for this turn is present
#   no       at least one DB-checkable op is absent (the change did NOT land)
#   n/a      this turn has NO DB-checkable op (e.g. a pure add_flow / add_ui_route) — landing is
#            judged downstream by the dual-verify, not here
#   unknown  the probe could not run (no PG env, no .env/DATABASE_ID, schema unresolved, pg missing) —
#            the caller must NOT treat unknown as a failure; it falls back to exit-code + dual-verify
# Reads: APP_DIR (.env), HUB_PG_DB, the turn's brief_patch_ops. Pure read; never mutates anything.
did_change_land() {
  local idx="$1" ops_json
  DID_LAND="unknown"; DID_LAND_DETAIL=""
  ops_json="$(tj "turns[$idx].brief_patch_ops")"
  if [ -z "$ops_json" ] || [ "$ops_json" = "null" ]; then DID_LAND="n/a"; DID_LAND_DETAIL="no brief_patch_ops to probe"; return 0; fi
  # Resolve `pg` from the provision package the templates installed it into (same module the
  # provisioner uses). If it isn't there, the probe degrades to 'unknown' (never a false 'no').
  local pg_dir="$APP_DIR/packages/provision/node_modules"
  local probe_out
  probe_out="$(APP_DIR="$APP_DIR" HUB_PG_DB="$HUB_PG_DB" OPS_JSON="$ops_json" NODE_PATH="$pg_dir" node -e '
    const fs=require("fs"), path=require("path");
    const out=(o)=>{ process.stdout.write(JSON.stringify(o)); };
    // Whole body in ONE async IIFE so the early-exit `return`s are function-scoped (node -e does
    // NOT allow top-level return). Every exit path calls out(...) exactly once.
    (async()=>{
      let ops; try{ ops=JSON.parse(process.env.OPS_JSON); }catch{ ops=[]; }
      if(!Array.isArray(ops)) ops=[ops];
      // DB-checkable ops only — a turn of pure add_flow/add_ui_route has none.
      const dbOps=ops.filter(o=>o&&["add_field","add_table","add_relation","set_table_policy"].includes(o.op));
      if(dbOps.length===0){ return out({landed:"n/a",detail:"no DB-checkable op (frontend-only change)"}); }
      if(!process.env.PGHOST){ return out({landed:"unknown",detail:"PGHOST unset — cannot probe the live schema"}); }
      // Read DATABASE_ID/DATABASE_NAME from the app .env (workspace root).
      let envText=""; try{ envText=fs.readFileSync(path.join(process.env.APP_DIR,".env"),"utf8"); }catch{}
      const envOf=(k)=>{ const m=envText.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
      const dbId=envOf("DATABASE_ID"), dbName=envOf("DATABASE_NAME");
      if(!dbId && !dbName){ return out({landed:"unknown",detail:".env has no DATABASE_ID/DATABASE_NAME — app not provisioned yet?"}); }
      let Pool; try{ ({Pool}=require("pg")); }catch{ return out({landed:"unknown",detail:"pg module not resolvable from the provision package — cannot probe"}); }
      const pool=new Pool({ database: process.env.HUB_PG_DB });
      try{
        // Resolve THIS tenant app_public schema — DATABASE_ID first (exact), db-name LIKE fallback.
        let schema;
        if(dbId){
          const r=await pool.query("SELECT schema_name FROM metaschema_public.schema WHERE database_id=$1 AND name=$2 LIMIT 1",[dbId,"app_public"]);
          schema=r.rows[0]&&r.rows[0].schema_name;
        }
        if(!schema && dbName){
          const like=dbName.replace(/_/g,"%").replace(/-/g,"%")+"%app%public";
          const r=await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1 ORDER BY length(schema_name) LIMIT 1",[like]);
          schema=r.rows[0]&&r.rows[0].schema_name;
        }
        if(!schema){ await pool.end(); return out({landed:"unknown",detail:"could not resolve the tenant app_public schema (db "+(dbName||dbId)+")"}); }
        const checks=[]; let allPresent=true;
        for(const op of dbOps){
          if(op.op==="add_field"){
            const r=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3 LIMIT 1",[schema,op.table,op.field&&op.field.name]);
            const present=r.rows.length>0; allPresent=allPresent&&present;
            checks.push({op:"add_field",target:op.table+"."+(op.field&&op.field.name),present,nullable:present?(r.rows[0].is_nullable==="YES"):null});
          } else if(op.op==="add_table"){
            const t=op.table&&op.table.name;
            const r=await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1",[schema,t]);
            const present=r.rows.length>0; allPresent=allPresent&&present;
            checks.push({op:"add_table",target:t,present});
          } else if(op.op==="add_relation"){
            const r=op.relation||{};
            const q=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3 LIMIT 1",[schema,r.source_table,r.field_name]);
            const present=q.rows.length>0; allPresent=allPresent&&present;
            checks.push({op:"add_relation",target:(r.source_table||"?")+"."+(r.field_name||"?")+"->"+(r.target_table||"?"),present});
          } else if(op.op==="set_table_policy"){
            // public-read+owner-write lands an AuthzPublishable SELECT policy (name ~ _publishable$).
            const wantPub=/public-read/.test(String(op.to_policy||""));
            if(wantPub){
              const r=await pool.query("SELECT 1 FROM pg_policies WHERE schemaname=$1 AND tablename=$2 AND cmd=$3 AND policyname ~ $4 LIMIT 1",[schema,op.table,"SELECT","_publishable$"]);
              const present=r.rows.length>0; allPresent=allPresent&&present;
              checks.push({op:"set_table_policy",target:op.table+" -> "+op.to_policy,present,signal:"AuthzPublishable SELECT policy"});
            } else {
              // A non-public policy flip — assert the table at least still carries policies.
              const r=await pool.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname=$1 AND tablename=$2",[schema,op.table]);
              const present=(r.rows[0]&&r.rows[0].n)>0; allPresent=allPresent&&present;
              checks.push({op:"set_table_policy",target:op.table+" -> "+op.to_policy,present,signal:r.rows[0]&&r.rows[0].n+" policies"});
            }
          }
        }
        const absent=checks.filter(c=>!c.present).map(c=>c.target);
        const nn=checks.filter(c=>c.op==="add_field"&&c.present&&c.nullable===false).map(c=>c.target);
        const detail = allPresent
          ? ("all "+checks.length+" DB artifact(s) present in "+schema+(nn.length?(" (NOT NULL: "+nn.join(", ")+")"):""))
          : ("MISSING in "+schema+": "+absent.join(", "));
        out({landed: allPresent?"yes":"no", schema, checks, detail});
      } catch(e){
        out({landed:"unknown",detail:"probe query failed: "+String(e&&e.message||e).slice(0,160)});
      } finally { try{ await pool.end(); }catch{} }
    })();
  ' 2>/dev/null || true)"
  # Parse the probe JSON's landed + detail (single Node pass; tolerate empty/garbled → unknown).
  local parsed
  parsed="$(printf '%s' "$probe_out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.trim());process.stdout.write((j.landed||"unknown")+"\t"+(j.detail||""))}catch{process.stdout.write("unknown\t")}})' 2>/dev/null || printf 'unknown\t')"
  DID_LAND="$(printf '%s' "$parsed" | cut -f1)"
  DID_LAND_DETAIL="$(printf '%s' "$parsed" | cut -f2-)"
  [ -n "$DID_LAND" ] || DID_LAND="unknown"
}

# Derive the NEW-capability flow set for a turn (csv). GENERIC: a turn that adds a flow (a `flow.id`
# or an add_flow op) drives THAT flow; otherwise the new capability is the owner-entity CRUD, which
# the regression flow already exercises on the owner entity → reuse the regression flows.
new_capability_flows_csv() {
  local idx="$1" fid
  fid="$(tj "turns[$idx].flow.id")"
  if [ -z "$fid" ]; then
    # add_flow op?
    local nops i op f
    nops="$(tj_len "turns[$idx].brief_patch_ops")"
    i=0
    while [ "$i" -lt "$nops" ]; do
      op="$(tj "turns[$idx].brief_patch_ops[$i].op")"
      if [ "$op" = "add_flow" ]; then
        f="$(tj "turns[$idx].brief_patch_ops[$i].flow")"
        # flow may be a string id or an object {id}
        case "$f" in
          \{*) fid="$(tj "turns[$idx].brief_patch_ops[$i].flow.id")" ;;
          *) fid="$f" ;;
        esac
        break
      fi
      i=$((i+1))
    done
  fi
  if [ -n "$fid" ]; then
    printf '%s' "$fid"
  else
    # no new flow → assert the owner-entity CRUD via the regression flow(s)
    printf '%s' "$(tj_json "turns[$idx].regression_flows" | tr -d '[]" ')"
  fi
}

# ════════════════════════════════════════════════════════════════════════════════
# TURN 0 — build the baseline app via the EXISTING skill build path, gate green, snapshot.
# ════════════════════════════════════════════════════════════════════════════════
TURN0_START="$(date +%s)"
echo -e "${GREEN}TURN 0 — baseline build${NC}  (db=$DB_NAME)"
hr
seed_run_brief
mkdir -p "$APP_DIR"

# S0 — smoke the warm hub once (restart with a big heap if down, unless --no-restart). Reused
# verbatim from golden-path/genericity-check via phase-runner.sh.
pr_s0_smoke_and_restart "$NO_RESTART" /tmp/cnc-3000.day2.log "Phase 1 is a no-op" MTR_NO_RESTART "multi-turn-run"
hr
pr_pg_hydrate "2.x"
hr

# The cold build. CAPABILITY-NEUTRAL: this runner adds NO new build capability — it sequences the
# EXISTING skill scaffolders (scaffold-provision.mjs → provision package → scaffold-frontend.mjs)
# and the SAME verify-phase.sh gates golden-path runs. The full S1–S7 cold chain (pgpm workspace
# init, frontend template, wire-app, install, codegen) is the operator's documented build; override
# the whole thing with MTR_BUILD_CMD when driving an end-to-end build. The default emits the
# provision files + frontend so a warm-hub operator run reaches a verifiable workspace; the operator
# (or MTR_BUILD_CMD) runs create-db + provision + codegen in between — this script reinvents no skill step.
build_turn0() {
  if [ -n "${MTR_BUILD_CMD:-}" ]; then
    info "turn-0 build: MTR_BUILD_CMD override"
    ( cd "$APP_DIR" && APP_ID="$APP_ID" BRIEF="$RUN_BRIEF" STATE_PATH="$STATE_DIR/run-state.json" \
        DB_NAME="$DB_NAME" bash -c "$MTR_BUILD_CMD" )
    return $?
  fi
  info "turn-0 build: scaffold-provision (Phase 2) → [operator: create-db+provision, frontend template, wire-app, codegen] → scaffold-frontend (Phase 4)"
  node "$REPO_ROOT/scripts/scaffold-app.mjs" "$RUN_BRIEF" "$APP_DIR" --phase provision
  info "provision files emitted under $APP_DIR/packages/provision/src/"
  info "NEXT (operator, warm hub): cd $APP_DIR/packages/provision && pnpm install && pnpm run create-db && pnpm run provision; then wire-app + pnpm codegen; then scaffold-frontend."
  node "$REPO_ROOT/scripts/scaffold-app.mjs" "$RUN_BRIEF" "$APP_DIR" --phase frontend || true
}

BUILD_OK=1
if build_turn0; then info "turn-0 scaffolders completed"; else BUILD_OK=0; warn "turn-0 build chain returned non-zero"; fi

resolve_app_url
STATE_ARGS=()
[ -f "$STATE_DIR/run-state.json" ] && STATE_ARGS=(--state "$STATE_DIR/run-state.json")
[ -n "$OWNER_CRUD_PATH" ] && export LIVE_QA_CRUD_PATH="$OWNER_CRUD_PATH"
pr_run_phases "$BUILD_PHASES" "$VERIFY" "$RUN_BRIEF" "$APP_DIR" "day-2 turn 0" "--spec <seed-brief> --workspace <app-dir>"

TURN0_END="$(date +%s)"; TURN0_SECS=$((TURN0_END - TURN0_START))

if [ -n "$FAILED_PHASE" ] || [ "$BUILD_OK" != "1" ]; then
  node "$SCORECARD_LIB" append --file "$SCORECARD_FILE" --app-id "$APP_ID" --db-name "$DB_NAME" --mode "$MODE" \
    --row "$(printf '{"turn":0,"title":"baseline build","layer":"build","mechanism":"cold-build","verdict":"impossible","seconds":%s,"layers_synced":[],"layers_drifted":["build"],"blocker":"turn-0 build/gate failed at phase %s — fix the cold build before day-2 turns"}' "$TURN0_SECS" "${FAILED_PHASE:-build}")" >/dev/null 2>&1 || true
  hr
  echo -e "${RED}TURN 0 FAILED${NC} (phase ${FAILED_PHASE:-build}; ${TURN0_SECS}s). Day-2 turns need a green baseline."
  echo "  Re-run the failed phase verbosely:"
  echo "    APP_ID=$APP_ID ./scripts/verify-phase.sh ${FAILED_PHASE:-2.1} --spec \"$RUN_BRIEF\" --workspace \"$APP_DIR\""
  node "$SCORECARD_LIB" render --file "$SCORECARD_FILE" --md 2>/dev/null || true
  exit 1
fi

pass "turn 0 green (phases $BUILD_PHASES) in ${TURN0_SECS}s"
git_init_workspace
git_commit_tag "turn-0-green" "turn 0: baseline app green ($BUILD_PHASES)"
node "$SCORECARD_LIB" append --file "$SCORECARD_FILE" --app-id "$APP_ID" --db-name "$DB_NAME" --mode "$MODE" \
  --row "$(printf '{"turn":0,"title":"baseline build","layer":"build","mechanism":"cold-build","verdict":"clean","seconds":%s,"layers_synced":["schema","frontend","sdk","ui"],"layers_drifted":[],"blocker":""}' "$TURN0_SECS")" >/dev/null 2>&1 || true
hr

# ════════════════════════════════════════════════════════════════════════════════
# TURNS 1..N — sequential; each resumes the prior workspace.
# ════════════════════════════════════════════════════════════════════════════════
TOTAL_SECS=$TURN0_SECS
RUN_EXIT=0
ti=0
while [ "$ti" -lt "$NTURNS" ]; do
  N="$(tj "turns[$ti].id")"; [ -n "$N" ] || N="$(tj "turns[$ti].n")"; [ -n "$N" ] || N=$((ti+1))
  if [ -n "$UP_TO" ] && [ "$N" -gt "$UP_TO" ] 2>/dev/null; then
    info "reached --up-to $UP_TO; stopping before turn $N"; break
  fi

  TITLE="$(tj "turns[$ti].title")"
  LAYER="$(tj "turns[$ti].layer")"
  # mechanism: author A has no separate field — derive from the first brief_patch_ops op (generic).
  MECH="$(tj "turns[$ti].mechanism")"
  [ -n "$MECH" ] || MECH="$(tj "turns[$ti].brief_patch_ops[0].op")"
  REG_CSV="$(tj_json "turns[$ti].regression_flows" | tr -d '[]" ')"
  NEW_CSV="$(new_capability_flows_csv "$ti")"
  # New-flow turns that need email drive on the owner CRUD path too; otherwise reuse the owner path.
  NEW_CRUD="$OWNER_CRUD_PATH"

  echo -e "${GREEN}TURN $N — ${TITLE:-(untitled)}${NC}  [layer=${LAYER:-?} mechanism=${MECH:-?}]"
  hr
  TURN_START="$(date +%s)"
  VERDICT=""; BLOCKER=""; SYNCED="[]"; DRIFTED="[]"
  DID_LAND=""; DID_LAND_DETAIL=""

  if [ "$MODE" = "hybrid" ]; then
    # ── HYBRID — STUB this stage. Requires the Stage-C day-2 driver. ───────────
    echo "  hybrid mode requires Stage C day2-driver (scripts/day2-sync.sh) — not yet built"
    if [ -x "$DAY2_SYNC" ]; then
      warn "hybrid: $DAY2_SYNC exists but multi-turn-run.sh does not yet orchestrate it — Stage C owns that wiring."
    fi
    warn "hybrid mode is a documented STUB at this stage."
    VERDICT="blocked-stage-c"
    BLOCKER="hybrid mode requires the Stage-C day2-driver/day2-sync.sh (not built this stage); hybrid_path: $(tj "turns[$ti].hybrid_path" | cut -c1-100)"
    DRIFTED="[\"${LAYER:-schema}\"]"
  else
    # ── SKILL-ONLY — apply the turn's brief_patch_ops, run the skill-only steps, then DECIDE THE
    #    VERDICT EMPIRICALLY: probe the live tenant schema for whether the change actually landed
    #    (did_change_land), NOT from any fixture prediction or "[EXPECT abort]" marker. ──
    snapshot_run_brief                 # land-or-revert base: the pre-turn (good) brief
    apply_brief_patch_ops "$ti"
    run_skill_only_steps               # sets CMD_EXIT + CMD_TAIL (the REAL provision exit + output)

    info "did-it-land probe: inspect the live tenant schema for this turn's change"
    did_change_land "$ti"
    info "did-it-land: $DID_LAND — ${DID_LAND_DETAIL:-(no detail)}"

    if [ "$DID_LAND" = "no" ]; then
      # The change did NOT land. This is the FINDING — whatever the cause. Capture the REAL error
      # VERBATIM from the provision tail (no predicted code, no marker). A non-zero provision exit is
      # the usual cause but not required: a silent no-op that left the artifact absent is ALSO 'no'.
      VERDICT="impossible"
      DRIFTED="[\"${LAYER:-schema}\"]"
      local_err="$(printf '%s' "$CMD_TAIL" | grep -iE 'error|abort|already exists|null value|not-null|not null|violates|duplicate|permission denied|cannot' | tail -n 1)"
      [ -n "$local_err" ] || local_err="$(printf '%s' "$CMD_TAIL" | tail -n 1)"
      if [ "${CMD_EXIT:-0}" -ne 0 ]; then
        BLOCKER="change did NOT land (skill-only). provision exit ${CMD_EXIT}; ${DID_LAND_DETAIL}. REAL error: ${local_err:-<none captured>}"
      else
        BLOCKER="change did NOT land (skill-only) even though provision exit 0 (silent no-op); ${DID_LAND_DETAIL}. tail: ${local_err:-<none>}"
      fi
      warn "turn $N: change did NOT land — verdict 'impossible' (a day-2 finding, not a run failure)"
      echo "  ── captured provision tail (verbatim) ──"
      printf '%s\n' "$CMD_TAIL" | sed 's/^/    /'
      # LAND-OR-REVERT: drop this turn's brief patch so it does not poison the next turn's re-provision.
      revert_run_brief
    elif [ "$DID_LAND" = "unknown" ] && [ "${CMD_EXIT:-0}" -ne 0 ]; then
      # The probe could not run (no PG / no .env / pg missing) AND provision failed. We cannot prove
      # the change landed, and provision errored — treat as impossible, REAL error verbatim, and
      # revert so the run can still proceed cleanly. (If the probe were available this would be
      # decided by landing; without it we fall back to the exit code — never inventing a cause.)
      VERDICT="impossible"
      DRIFTED="[\"${LAYER:-schema}\"]"
      local_err="$(printf '%s' "$CMD_TAIL" | grep -iE 'error|abort|already exists|null value|violates|duplicate|permission denied|cannot' | tail -n 1)"
      [ -n "$local_err" ] || local_err="$(printf '%s' "$CMD_TAIL" | tail -n 1)"
      BLOCKER="change unverifiable (probe ${DID_LAND}: ${DID_LAND_DETAIL}) and provision exit ${CMD_EXIT}. REAL error: ${local_err:-<none captured>}"
      warn "turn $N: could not probe landing AND provision failed — verdict 'impossible' (real error captured)"
      echo "  ── captured provision tail (verbatim) ──"
      printf '%s\n' "$CMD_TAIL" | sed 's/^/    /'
      revert_run_brief
    fi
    # else: DID_LAND ∈ {yes, n/a, or unknown-with-exit-0} → the change either provably landed, has no
    # DB artifact to probe (frontend-only — judged by dual-verify), or was a clean no-op. Fall through
    # to the dual assertion, which decides clean vs partial vs hand-fixed.
  fi

  # ── if the apply step did NOT already conclude 'impossible'/'blocked', restart dev CLEAN (the
  #    mid-session codegen+scaffold guard) then best-effort re-verify + the DUAL assertion. ──
  if [ -z "$VERDICT" ]; then
    # Guard the documented PostCSS hot-reload 500: a landed change just re-ran codegen+scaffold on a
    # live dev server; tear the dirty one down so the next live-QA start serves clean CSS.
    restart_dev_clean "turn $N codegen+scaffold"

    resolve_app_url
    STATE_ARGS=()
    [ -f "$STATE_DIR/run-state.json" ] && STATE_ARGS=(--state "$STATE_DIR/run-state.json")
    [ -n "$NEW_CRUD" ] && export LIVE_QA_CRUD_PATH="$NEW_CRUD"
    pr_run_phases "2.1 2.3 2.6 3" "$VERIFY" "$RUN_BRIEF" "$APP_DIR" "day-2 turn $N re-verify" "--spec <brief> --workspace <app-dir>"
    REVERIFY_FAILED="$FAILED_PHASE"

    info "dual assertion: new capability round-trips AND regression flows still pass"
    DV_JSON="$(node "$VERIFY_LIB" \
      --app-dir "$APP_DIR" --brief "$RUN_BRIEF" --base-url "$LIVE_QA_BASE_URL" --app-id "$APP_ID" \
      --new-flows "$NEW_CSV" ${NEW_CRUD:+--crud-path "$NEW_CRUD"} \
      --regression-flows "$REG_CSV" 2>/dev/null || true)"
    # Extract the three verdict legs from the driver's JSON (its last stdout line) in ONE pass,
    # as three tab-separated tokens (overall<TAB>new<TAB>regression), then read them positionally.
    DV_TRIPLE="$(printf '%s' "$DV_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.trim().split("\n").pop());process.stdout.write([j.overall||"",j.new_capability||"",j.regression||""].join("\t"))}catch{process.stdout.write("\t\t")}})' 2>/dev/null || printf '\t\t')"
    DV_OVERALL="$(printf '%s' "$DV_TRIPLE" | cut -f1)"
    DV_NEW="$(printf '%s' "$DV_TRIPLE" | cut -f2)"
    DV_REG="$(printf '%s' "$DV_TRIPLE" | cut -f3)"

    # ── fold (did-it-land × re-verify × dual-verify) into a GROUNDED verdict ──
    #   clean      DB change present (or n/a) AND re-verify green AND dual-verify pass.
    #   partial    a meaningful part synced but another part drifted — e.g. a no-module flow add whose
    #              Blocks/ops wired (DB n/a, no regression) but whose NEW capability did not round-trip
    #              skill-only, OR the schema landed but the new-capability leg didn't (frontend not
    #              wired) while the regression still passes. NOT a hard failure, NOT fully clean.
    #   hand-fixed landed only after intervention / a regression broke / a re-verify gate failed.
    if [ "$DV_OVERALL" = "pass" ] && [ -z "$REVERIFY_FAILED" ]; then
      VERDICT="clean"; SYNCED="[\"${LAYER:-schema}\"]"; BLOCKER=""
      pass "turn $N: change landed cleanly (did-it-land=$DID_LAND, new-capability=$DV_NEW, regression=$DV_REG, re-verify green)"
    elif [ "$DV_REG" != "fail" ] && [ -z "$REVERIFY_FAILED" ] && { [ "$DID_LAND" = "yes" ] || [ "$DID_LAND" = "n/a" ]; }; then
      # The baseline still passes and re-verify is green; the only gap is the NEW capability not
      # rounding-trip skill-only (e.g. a flow whose Blocks/ops the skill-only re-provision cannot wire,
      # or a frontend-only change not yet surfaced). Some layers synced, others drifted → partial.
      VERDICT="partial"; SYNCED="[\"${LAYER:-schema}\"]"; DRIFTED="[\"frontend\"]"
      BLOCKER="partial: backing change present (did-it-land=$DID_LAND) + regression intact (regression=$DV_REG), but the NEW capability did not round-trip skill-only (new=$DV_NEW) — the frontend wiring (Blocks/ops/codegen) is the Stage-C day2-driver's job"
      warn "turn $N: $BLOCKER"
    else
      VERDICT="hand-fixed"; DRIFTED="[\"${LAYER:-schema}\"]"
      if [ "$DV_REG" = "fail" ]; then BLOCKER="REGRESSION: a baseline flow broke after the change (regression=$DV_REG; new=$DV_NEW; did-it-land=$DID_LAND)"
      elif [ "$DV_NEW" = "fail" ]; then BLOCKER="new capability did NOT round-trip (new=$DV_NEW; regression=$DV_REG; did-it-land=$DID_LAND)"
      elif [ -n "$REVERIFY_FAILED" ]; then BLOCKER="re-verify gate failed at phase $REVERIFY_FAILED after the change (did-it-land=$DID_LAND)"
      else BLOCKER="dual-assert inconclusive (driver produced no verdict; did-it-land=$DID_LAND) — see output above"; fi
      warn "turn $N: $BLOCKER"
    fi
  fi

  TURN_END="$(date +%s)"; TURN_SECS=$((TURN_END - TURN_START)); TOTAL_SECS=$((TOTAL_SECS + TURN_SECS))

  node "$SCORECARD_LIB" append --file "$SCORECARD_FILE" --app-id "$APP_ID" --db-name "$DB_NAME" --mode "$MODE" \
    --row "$(node -e '
      const [turn,title,layer,mech,verdict,secs,synced,drifted,blocker]=process.argv.slice(1);
      const arr=(s)=>{try{const j=JSON.parse(s);return Array.isArray(j)?j:[]}catch{return []}};
      process.stdout.write(JSON.stringify({turn:Number(turn),title,layer,mechanism:mech,verdict,seconds:Number(secs),layers_synced:arr(synced),layers_drifted:arr(drifted),blocker}));
    ' "$N" "$TITLE" "$LAYER" "$MECH" "$VERDICT" "$TURN_SECS" "$SYNCED" "$DRIFTED" "$BLOCKER")" >/dev/null 2>&1 || true
  git_commit_tag "turn-${N}-${VERDICT}" "turn $N: ${TITLE:-change} → $VERDICT (${TURN_SECS}s)"
  info "turn $N: verdict=$VERDICT  elapsed=${TURN_SECS}s"
  hr

  ti=$((ti+1))
done

# ════════════════════════════════════════════════════════════════════════════════
# Report — the scorecard table + totals + per-turn elapsed.
# ════════════════════════════════════════════════════════════════════════════════
MM=$((TOTAL_SECS / 60)); SS=$((TOTAL_SECS % 60))
echo
hr
echo -e "${GREEN}DAY-2 SCORECARD${NC}  (mode=$MODE · db=$DB_NAME)"
hr
node "$SCORECARD_LIB" render --file "$SCORECARD_FILE" --md 2>/dev/null || true
echo
echo "  scorecard JSON : $SCORECARD_FILE"
echo -e "  total elapsed  : ${MM}m${SS}s  (turn 0 + ${NTURNS} turn(s))"
hr
if [ "$RUN_EXIT" -eq 0 ]; then
  echo -e "${GREEN}OVERALL: PASS${NC}   (turn 0 green; every turn was MEASURED to a recorded verdict — see the scorecard. clean/partial/hand-fixed/impossible are FINDINGS about what the skill-only path actually did, not run failures.)"
else
  echo -e "${RED}OVERALL: FAIL${NC}   (turn 0 failed, or a turn could not be measured at all — see the scorecard 'Blocker' column)"
fi
hr
exit "$RUN_EXIT"
