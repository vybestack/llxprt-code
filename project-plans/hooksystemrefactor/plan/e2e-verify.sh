#!/usr/bin/env bash
# @plan PLAN-20250218-HOOKSYSTEM.P16
# End-to-end verification for hook system refactor

set -euo pipefail
PASS_COUNT=0
FAIL_COUNT=0
FAILURES=()

check() {
  local name="$1"
  local cmd="$2"

  if eval "$cmd" > /dev/null 2>&1; then
    echo "[OK] PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[ERROR] FAIL: $name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILURES+=("$name")
  fi
}

echo "=== Hook System Refactor E2E Verification ==="
echo "Plan ID: PLAN-20250218-HOOKSYSTEM"
echo ""

# ---- TRACEABILITY: All phases executed ----
echo "--- Traceability ---"
for PHASE in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15; do
  check "Phase $PHASE markers in codebase" \
    "grep -r 'PLAN-20250218-HOOKSYSTEM\.$PHASE' packages/core/src/hooks/ | grep -v '.md'"
done

# ---- REQUIREMENTS: All REQ tags present ----
echo "--- Requirement Coverage ---"
for req in DELTA-HSYS-001 DELTA-HSYS-002 \
           DELTA-HEVT-001 DELTA-HEVT-002 DELTA-HEVT-003 DELTA-HEVT-004 \
           DELTA-HRUN-001 DELTA-HRUN-002 DELTA-HRUN-003 DELTA-HRUN-004 \
           DELTA-HPAY-001 DELTA-HPAY-002 DELTA-HPAY-003 DELTA-HPAY-004 DELTA-HPAY-005 DELTA-HPAY-006 \
           DELTA-HBUS-001 DELTA-HBUS-002 DELTA-HBUS-003 \
           DELTA-HTEL-001 DELTA-HTEL-002 DELTA-HTEL-003 \
           DELTA-HAPP-001 DELTA-HAPP-002 \
           DELTA-HFAIL-001 DELTA-HFAIL-002 DELTA-HFAIL-003 DELTA-HFAIL-004 DELTA-HFAIL-005; do
  check "Requirement $req covered" \
    "grep -r '$req' packages/core/src/hooks/ | grep -v '.md'"
done

# ---- FILES: Required files exist ----
echo "--- Required Files ---"
check "hookEventHandler.ts exists" "ls packages/core/src/hooks/hookEventHandler.ts"
check "hookSystem.ts exists" "ls packages/core/src/hooks/hookSystem.ts"
check "hookBusContracts.ts exists" "ls packages/core/src/hooks/hookBusContracts.ts"
check "hookValidators.ts exists" "ls packages/core/src/hooks/hookValidators.ts"

# ---- ANTI-PATTERNS: Forbidden patterns absent ----
echo "--- Anti-Pattern Detection ---"
check "No EMPTY_SUCCESS_RESULT in catch blocks" \
  "! grep -n 'return EMPTY_SUCCESS_RESULT[^(]' packages/core/src/hooks/hookEventHandler.ts"

check "No TODO/FIXME in production hooks code" \
  "! grep -rn -E '(TODO|FIXME|HACK|STUB|XXX)' packages/core/src/hooks/ --include='*.ts' | grep -v '.test.ts' | grep -v '.md'"

check "No stubs remaining in validators" \
  "! grep 'return false; // stub' packages/core/src/hooks/hookValidators.ts"

check "No stub no-ops remaining in semantics methods" \
  "! grep '// Stub\|// no-op until P14\|// stub' packages/core/src/hooks/hookEventHandler.ts"

check "No console.log in production hooks" \
  "! grep -rn 'console\.' packages/core/src/hooks/ --include='*.ts' | grep -v '.test.ts'"

check "No V2/New/Copy version files created" \
  "! find packages/core/src/hooks -name '*V2*' -o -name '*New*' -o -name '*Copy*' | grep -q ."

# ---- TYPE SAFETY: HookEventName enum used everywhere ----
echo "--- Type Safety ---"
check "HookEventName used in hookEventHandler" \
  "grep -q 'HookEventName' packages/core/src/hooks/hookEventHandler.ts"

check "SessionStartSource imported/used" \
  "grep -q 'SessionStartSource' packages/core/src/hooks/hookEventHandler.ts"

check "SessionEndReason imported/used" \
  "grep -q 'SessionEndReason' packages/core/src/hooks/hookEventHandler.ts"

check "Type predicates in hookValidators" \
  "[ \$(grep -c 'input is ' packages/core/src/hooks/hookValidators.ts) -ge 3 ]"

# ---- TESTS: Full test suite ----
echo "--- Test Suites ---"
check "Full test suite passes" "npm test 2>&1 | tail -5 | grep -qiE 'passed|Tests?.*passed'"

check "Lifecycle tests (P04)" \
  "npm test -- --testPathPattern='hookSystem-lifecycle' 2>&1 | grep -q 'passed'"

check "MessageBus TDD tests (P07)" \
  "npm test -- --testPathPattern='hookEventHandler-messagebus' 2>&1 | grep -q 'passed'"

check "Validation tests (P10)" \
  "npm test -- --testPathPattern='hookValidators' 2>&1 | grep -q 'passed'"

check "Semantics tests (P13)" \
  "npm test -- --testPathPattern='hookSemantics' 2>&1 | grep -q 'passed'"

check "Integration tests (P15)" \
  "npm test -- --testPathPattern='hookSystem-integration' 2>&1 | grep -q 'passed'"

check "Pre-existing application tests" \
  "npm test -- --testPathPattern='hooks-caller-application' 2>&1 | grep -q 'passed'"

check "Pre-existing integration tests" \
  "npm test -- --testPathPattern='hooks-caller-integration' 2>&1 | grep -q 'passed'"

# ---- BUILD ----
echo "--- Build ---"
check "TypeScript typechecks" "npm run typecheck"
check "Build succeeds" "npm run build"
check "Lint passes" "npm run lint"
check "Format passes" "npm run format"

# ---- SYSTEM TEST (REAL ENTRYPOINT -- production composition root, no mocks) ----
echo "--- System Test (Real Entrypoint) ---"
check "Haiku test uses real entrypoint node scripts/start.js" \
  "node scripts/start.js --profile-load synthetic 'write me a haiku' 2>&1 | grep -qi 'haiku\|syllable\|poetry\|petals\|dew\|wind'"

check "No vi.mock/jest.mock in E2E verification script" \
  "! grep -E 'vi\.mock|jest\.mock' project-plans/hooksystemrefactor/plan/e2e-verify.sh"

check "Hook execution reaches process stdout (no silent failure)" \
  "node scripts/start.js --profile-load synthetic 'write me a haiku' 2>&1 | wc -c | awk '{exit (\$1 < 50)}'"

# ---- FINAL SUMMARY ----
echo ""
echo "=============================================="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo ""
  echo "Failed checks:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "RESULT: [ERROR] E2E VERIFICATION FAILED"
  exit 1
else
  echo ""
  echo "RESULT: [OK] E2E VERIFICATION PASSED"
fi
