#!/bin/bash
# Apply risky ESLint suggestions with per-directory test gates.
# Reverts any directory where package typecheck or targeted tests regress.
#
# Usage: bash scripts/codemods/apply-risky-suggestions.sh [pkg] [rules] [dir_filter]
#   pkg: core, cli, a2a-server, vscode-ide-companion (default: all)
#   rules: comma-separated (default: risky set)
#   dir_filter: optional comma-separated list of top-level src directories to process
#
# Examples:
#   bash scripts/codemods/apply-risky-suggestions.sh cli
#   bash scripts/codemods/apply-risky-suggestions.sh cli "<rules>" "auth,commands,providers"

set -euo pipefail

PKG="${1:-all}"
RULES="${2:-@typescript-eslint/no-unnecessary-condition,@typescript-eslint/strict-boolean-expressions,sonarjs/different-types-comparison,sonarjs/no-alphabetical-sort,sonarjs/no-misleading-array-reverse}"
DIR_FILTER="${3:-}"

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/codemods/apply-eslint-suggestions.mjs"

passed=0
failed=0
skipped=0
failed_dirs=""

contains_dir() {
  local needle="$1"
  if [ -z "$DIR_FILTER" ]; then
    return 0
  fi

  IFS=',' read -r -a selected <<<"$DIR_FILTER"
  for item in "${selected[@]}"; do
    if [ "$item" = "$needle" ]; then
      return 0
    fi
  done

  return 1
}

typecheck_command_for_package() {
  local pkg_name="$1"
  case "$pkg_name" in
    core)
      echo "npm run typecheck --workspace @vybestack/llxprt-code-core"
      ;;
    cli)
      echo "npm run typecheck --workspace @vybestack/llxprt-code"
      ;;
    a2a-server)
      echo "npm run typecheck --workspace @vybestack/llxprt-code-a2a-server"
      ;;
    vscode-ide-companion)
      echo "npm run check-types --workspace llxprt-code-vscode-ide-companion"
      ;;
    *)
      echo ""
      ;;
  esac
}

run_typecheck_error_count() {
  local pkg_name="$1"
  local typecheck_cmd
  typecheck_cmd="$(typecheck_command_for_package "$pkg_name")"

  if [ -z "$typecheck_cmd" ]; then
    echo "0"
    return 0
  fi

  local output
  output=$(cd "$PROJECT_ROOT" && bash -lc "$typecheck_cmd" 2>&1 || true)

  if echo "$output" | grep -q "error TS"; then
    echo "$output" | grep -c "error TS"
  else
    echo "0"
  fi
}

run_test_failed_file_count() {
  local pkg_name="$1"
  local pattern="$2"

  local output
  output=$(cd "$PROJECT_ROOT/packages/$pkg_name" && npx vitest run "$pattern" --reporter=basic 2>&1 || true)

  if echo "$output" | grep -q "No test files found"; then
    echo "0"
    return 0
  fi

  local test_files_line
  test_files_line=$(echo "$output" | grep "Test Files" | tail -1 || true)
  if [ -z "$test_files_line" ]; then
    echo "0"
    return 0
  fi

  local fail_count
  fail_count=$(echo "$test_files_line" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+' || true)
  echo "${fail_count:-0}"
}

apply_and_test() {
  local pkg_name="$1"
  local dir="$2"
  local dirname
  dirname=$(basename "$dir")

  echo ""
  echo "=== $pkg_name/$dirname ==="

  local baseline_type_errors
  baseline_type_errors=$(run_typecheck_error_count "$pkg_name")
  local baseline_test_fails
  baseline_test_fails=$(run_test_failed_file_count "$pkg_name" "src/$dirname")
  echo "  Baseline: typecheck errors=$baseline_type_errors, failed test files=$baseline_test_fails"

  # Apply suggestions
  node "$SCRIPT" "$dir" --rules "$RULES" 2>&1 | tail -2

  # Check if anything changed
  if git diff --quiet -- "$dir"; then
    echo "  [SKIP] No changes"
    skipped=$((skipped + 1))
    return 0
  fi

  # Typecheck regression gate
  echo "  Typechecking..."
  local new_type_errors
  new_type_errors=$(run_typecheck_error_count "$pkg_name")
  if [ "$new_type_errors" -gt "$baseline_type_errors" ]; then
    echo "  [FAIL] Typecheck regressed ($new_type_errors > $baseline_type_errors) - reverting $dirname"
    git checkout -- "$dir"
    failed=$((failed + 1))
    failed_dirs="$failed_dirs $pkg_name/$dirname(typecheck)"
    return 1
  fi

  # Test regression gate
  echo "  Testing $pkg_name src/$dirname..."
  local new_test_fails
  new_test_fails=$(run_test_failed_file_count "$pkg_name" "src/$dirname")

  if [ "$new_test_fails" -gt "$baseline_test_fails" ]; then
    echo "  [FAIL] Tests regressed ($new_test_fails > $baseline_test_fails) - reverting $dirname"
    git checkout -- "$dir"
    failed=$((failed + 1))
    failed_dirs="$failed_dirs $pkg_name/$dirname(tests)"
    return 1
  fi

  if [ "$new_test_fails" -gt 0 ]; then
    echo "  [OK] Pre-existing failed test files remain at $new_test_fails"
  fi

  echo "  [PASS] $pkg_name/$dirname"
  passed=$((passed + 1))
  return 0
}

process_package() {
  local pkg_name="$1"
  local pkg_dir="packages/$pkg_name/src"

  echo ""
  echo "========================================"
  echo "Processing package: $pkg_name"
  echo "========================================"

  # Process each top-level subdirectory
  for dir in "$pkg_dir"/*/; do
    [ -d "$dir" ] || continue

    local dirname
    dirname=$(basename "$dir")
    if ! contains_dir "$dirname"; then
      continue
    fi

    apply_and_test "$pkg_name" "$dir" || true
  done

  echo ""
  echo "=== $pkg_name/src (root files) ==="
  echo "  [SKIP] Root-level broad pass disabled for risky phase; handle root files manually"
}

if [ "$PKG" = "all" ]; then
  for p in core cli a2a-server vscode-ide-companion; do
    process_package "$p"
  done
else
  process_package "$PKG"
fi

echo ""
echo "========================================"
echo "SUMMARY"
echo "========================================"
echo "Passed: $passed"
echo "Failed: $failed"
echo "Skipped: $skipped"
if [ -n "$failed_dirs" ]; then
  echo "Failed directories:$failed_dirs"
fi

if [ "${SKIP_FORMAT:-0}" = "1" ]; then
  echo ""
  echo "Skipping formatter (SKIP_FORMAT=1)"
else
  echo ""
  echo "Running formatter..."
  npm run format 2>&1 | tail -1
fi
