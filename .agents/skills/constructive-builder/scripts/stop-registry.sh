#!/bin/bash
set -euo pipefail

# stop-registry.sh — tear down the static registry server started by
# serve-registry.sh. Reads its PID file and kills the process. Safe to run when
# nothing is running (no PID file / already dead / foreign PID) — it never errors
# on a no-op, so it can be wired into teardown unconditionally.
#
# Usage: ./scripts/stop-registry.sh

GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}  PASS${NC}: $1"; }
info() { echo "  INFO: $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_DIR="$REPO_ROOT/.run"
PID_FILE="$RUN_DIR/registry-serve.pid"

if [ ! -f "$PID_FILE" ]; then
  info "no PID file at $PID_FILE — registry server not running (nothing to stop)"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -z "$PID" ]; then
  info "PID file empty — clearing it"
  rm -f "$PID_FILE"
  exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  # Give it a moment, then force-kill if still alive.
  for _ in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null || true
  fi
  pass "stopped registry server (pid $PID)"
else
  info "registry server (pid $PID) already stopped"
fi

rm -f "$PID_FILE"
