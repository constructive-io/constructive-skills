# scripts/lib/sh-common.sh — shared shell preamble for the harness scripts.
#
# Sourced (never executed) by verify-phase.sh, golden-path.sh, and genericity-check.sh. It defines
# the RED/GREEN/YELLOW/NC color codes, the pass/fail/warn/info/hr log helpers, and the SCRIPT_DIR /
# REPO_ROOT anchors — the byte-identical preamble those three scripts each used to inline.
#
# SCRIPT_DIR / REPO_ROOT are computed from THIS LIB's own location (its parent dir is scripts/, and
# REPO_ROOT is scripts/..), so every consumer that sources this from scripts/ gets the exact same
# values it computed inline before. Consumers keep their own `set -euo pipefail`; this lib sets no
# shell options. fail() calls `exit 1`, which (since this is sourced) exits the consumer script —
# identical to the inline definition.
#
# NOTE (verify-phase.sh): it never called hr(); gaining an unused hr() function changes no output and
# no behavior. The pass/fail/warn/info bodies are byte-identical across all three former copies.

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

# scripts/ dir (this lib's parent) and the skill root (its parent). Computed from the LIB's own
# path so it is identical for every consumer that sources this from scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
