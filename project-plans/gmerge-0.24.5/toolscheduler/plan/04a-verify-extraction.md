# Phase 04a: Verify Tool Executor Extraction

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P04a`

## Prerequisites

- Required: Phase 04 completed
- Verification: `test -f packages/core/src/scheduler/tool-executor.ts`
- Expected: ToolExecutor extracted, coreToolScheduler delegates

## Verification Tasks

### 1. Extraction Completed

```bash
# Check tool-executor.ts exists
test -f packages/core/src/scheduler/tool-executor.ts || {
  echo "FAIL: tool-executor.ts not created"
  exit 1
}

# Check plan markers
grep "@plan:PLAN-20260302-TOOLSCHEDULER.P04" packages/core/src/scheduler/tool-executor.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

echo "[OK] Tool executor file created"
```

### 2. Delegation Wired

```bash
# Check launchToolExecution delegates to ToolExecutor
grep "new ToolExecutor" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: ToolExecutor not instantiated"
  exit 1
}

grep "toolExecutor.execute" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: execute() not called"
  exit 1
}

# Check import added
grep "import.*ToolExecutor.*from.*scheduler/tool-executor" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: Import not added"
  exit 1
}

echo "[OK] Delegation wired correctly"
```

### 3. TypeScript Compilation

```bash
# Verify TypeScript compiles
npm run typecheck || {
  echo "FAIL: TypeScript compilation failed"
  exit 1
}

echo "[OK] TypeScript compilation passed"
```

### 4. All Existing Tests Pass

```bash
# Run ALL existing coreToolScheduler tests
npm test -- coreToolScheduler.test.ts || {
  echo "FAIL: Existing tests failed"
  exit 1
}

npm test -- coreToolScheduler.cancellation.test.ts || {
  echo "FAIL: Cancellation tests failed"
  exit 1
}

npm test -- coreToolScheduler.contextBudget.test.ts || {
  echo "FAIL: Context budget tests failed"
  exit 1
}

npm test -- coreToolScheduler.duplication.test.ts || {
  echo "FAIL: Duplication tests failed"
  exit 1
}

npm test -- coreToolScheduler.interactiveMode.test.ts || {
  echo "FAIL: Interactive mode tests failed"
  exit 1
}

npm test -- coreToolScheduler.publishingError.test.ts || {
  echo "FAIL: Publishing error tests failed"
  exit 1
}

npm test -- coreToolScheduler.raceCondition.test.ts || {
  echo "FAIL: Race condition tests failed"
  exit 1
}

echo "[OK] All existing tests pass"
```

### 5. Characterization Tests Pass

```bash
# Run characterization tests
npm test -- coreToolScheduler.toolExecutor.characterization.test.ts || {
  echo "FAIL: Characterization tests failed after extraction"
  exit 1
}

echo "[OK] Characterization tests pass (behavior preserved)"
```

### 6. File Size Verification

```bash
# Check file size reduction
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
original_size=2140

reduction=$((original_size - current_size))

if [ "$reduction" -lt 100 ]; then
  echo "FAIL: File size only reduced by $reduction lines (expected ~130)"
  exit 1
fi

echo "[OK] File size reduced by $reduction lines"
```

### 7. No Behavior Change

```bash
# Verify NO test files were modified (except creation of characterization tests)
git diff packages/core/src/core/*.test.ts | grep -v "characterization.test.ts" | grep -E "^[+-]" | grep -v "^[+-]{3}" && {
  echo "FAIL: Test files were modified (behavior changed)"
  exit 1
} || echo "[OK] No test modifications (behavior preserved)"
```

### 8. No Circular Dependencies

```bash
# Run module graph analysis
npx madge --circular packages/core/src/scheduler/tool-executor.ts 2>&1 | tee madge-output.txt

if grep -q "Circular dependency" madge-output.txt; then
  echo "FAIL: Circular dependencies detected"
  cat madge-output.txt
  exit 1
fi

echo "[OK] No circular dependencies"
```

## Success Criteria

- [ ] tool-executor.ts exists with extracted code
- [ ] launchToolExecution delegates to ToolExecutor
- [ ] Import added correctly
- [ ] TypeScript compilation succeeds
- [ ] All existing tests pass
- [ ] Characterization tests pass
- [ ] File size reduced by ~130 lines
- [ ] No test files modified
- [ ] No circular dependencies

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 04 for remediation.

## Phase Completion

If PASS:
1. Update execution-tracker.md: Mark P04 and P04a complete
2. Proceed to Phase 05

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 04
3. Re-run Phase 04a
