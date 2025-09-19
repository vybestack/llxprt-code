#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

print_usage() {
  cat <<USAGE
Usage: ${0##*/} <results-file> [--skip-sections]

  <results-file>   Path to the task results markdown (relative or absolute).
  --skip-sections  Skip validation that required sections exist in the results file.
USAGE
}

if [[ $# -lt 1 ]]; then
  print_usage >&2
  exit 1
fi

RESULTS_PATH="$1"
shift || true
VALIDATE_SECTIONS=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-sections)
      VALIDATE_SECTIONS=false
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$RESULTS_PATH" ]]; then
  if [[ -f "$REPO_ROOT/$RESULTS_PATH" ]]; then
    RESULTS_PATH="$REPO_ROOT/$RESULTS_PATH"
  else
    echo "Results file not found: $RESULTS_PATH" >&2
    exit 2
  fi
fi

TASK_TOKEN=$(basename "$RESULTS_PATH")
TASK_TOKEN=${TASK_TOKEN%.md}
LOG_DIR="$SCRIPT_DIR/.quality-logs/$TASK_TOKEN"
mkdir -p "$LOG_DIR"

cd "$REPO_ROOT"

if [[ -f .git/MERGE_HEAD ]]; then
  echo "Merge conflict detected (.git/MERGE_HEAD present). Resolve it before running quality gates." >&2
  exit 3
fi

if git diff --name-only --diff-filter=U | grep -q '.'; then
  echo "Unresolved merge conflicts detected in working tree." >&2
  exit 3
fi

if $VALIDATE_SECTIONS; then
  declare -a REQUIRED_SECTIONS=(
    "Commits Picked"
    "Commits Picked / Ported"
    "Original Diffs"
    "Our Committed Diffs"
    "Test Results"
    "Lint Results"
    "Typecheck Results"
    "Build Results"
    "Format Check"
    "Lines of Code Analysis"
  )
  missing_sections=()
  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -iq "$section" "$RESULTS_PATH"; then
      missing_sections+=("$section")
    fi
  done
  if [[ ${#missing_sections[@]} -gt 0 ]]; then
    echo "Results file is missing required section heading(s): ${missing_sections[*]}" >&2
    echo "(Disable this check with --skip-sections if you are mid-edit.)" >&2
    exit 4
  fi
fi

kill_vitest() {
  if command -v pgrep >/dev/null 2>&1; then
    local pids
    pids=$(pgrep -f "[v]itest" || true)
    if [[ -n "$pids" ]]; then
      echo "Terminating existing vitest processes: $pids"
      echo "$pids" | xargs -r kill -9
    fi
  else
    echo "pgrep not available; skipping vitest process check" >&2
  fi
}

run_step() {
  local label="$1"
  shift
  local logfile="$LOG_DIR/${label// /_}.log"
  echo "=== $label ==="
  if "$@" | tee "$logfile"; then
    echo "=== $label PASSED (log: $logfile) ==="
  else
    echo "=== $label FAILED (log: $logfile) ===" >&2
    exit 10
  fi
}

kill_vitest

if [[ -f "$HOME/.cerebras_key" ]]; then
  export CEREBRAS_API_KEY="$(<"$HOME/.cerebras_key")"
  export CEREBRAS_BASE_URL="https://api.cerebras.ai/v1"
  export CEREBRAS_MODEL="qwen-3-coder-480b"
fi

run_step "Tests" npm run test
kill_vitest
run_step "Lint CI" npm run lint:ci
run_step "Typecheck" npm run typecheck
run_step "Build" npm run build
run_step "Format Check" npm run format:check

if git status --short | grep -q '^U'; then
  echo "Conflicted files detected after running quality gates." >&2
  exit 11
fi

echo "All quality gates passed for $TASK_TOKEN"
