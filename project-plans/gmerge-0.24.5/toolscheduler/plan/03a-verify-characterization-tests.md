# Phase 03a: Verify Characterization Tests

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P03a`

## Prerequisites

- Required: Phase 03 completed
- Verification: `test -f packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts`
- Expected: Characterization tests written

## Verification Tasks

### 1. Tests Pass Against Unmodified Code

```bash
# Run characterization tests
npm test -- coreToolScheduler.toolExecutor.characterization.test.ts || {
  echo "FAIL: Characterization tests do not pass against current code"
  exit 1
}

echo "[OK] Characterization tests pass"
```

### 2. Requirement Coverage

```bash
# Check all TS-EXEC requirements are covered
for req in TS-EXEC-001 TS-EXEC-002 TS-EXEC-003 TS-EXEC-004 TS-EXEC-005 TS-EXEC-006 TS-EXEC-007; do
  if ! grep -q "$req" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts; then
    echo "FAIL: $req not covered in characterization tests"
    exit 1
  fi
done

echo "[OK] All TS-EXEC requirements covered"
```

### 3. No Modifications to coreToolScheduler

```bash
# Verify coreToolScheduler.ts was not modified
git diff packages/core/src/core/coreToolScheduler.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && {
  echo "FAIL: coreToolScheduler.ts was modified (should not happen until Phase 04)"
  exit 1
} || echo "[OK] coreToolScheduler.ts not modified"
```

### 4. Plan Markers Present

```bash
# Check plan markers
grep "@plan PLAN-20260302-TOOLSCHEDULER.P03" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

echo "[OK] Plan markers present"
```

### 5. Test Quality Check

```bash
# Check minimum test count (should have at least 7 tests for 7 requirements)
test_count=$(grep -c "it('\\|it(\"" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts)
if [ "$test_count" -lt 7 ]; then
  echo "FAIL: Only $test_count tests found, expected at least 7"
  exit 1
fi

echo "[OK] Sufficient test coverage ($test_count tests)"
```

### 6. No Stub Behavior Testing

```bash
# Check that tests don't expect NotYetImplemented or similar stub behavior
if grep -i "NotYetImplemented\\|NotImplemented\\|TODO" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts; then
  echo "FAIL: Tests contain stub/TODO markers (should test real behavior)"
  exit 1
fi

echo "[OK] No stub behavior testing detected"
```

## Structural Verification Checklist

- [ ] File exists: `packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts`
- [ ] Phase 03 completion marker exists: `.completed/P03.md`
- [ ] Plan markers `@plan PLAN-20260302-TOOLSCHEDULER.P03` present
- [ ] All 7 requirement markers present (TS-EXEC-001 through TS-EXEC-007)
- [ ] At least 7 test cases defined (one per requirement minimum)
- [ ] Tests follow describe/it pattern
- [ ] No TODO or stub markers in test code
- [ ] Tests import from coreToolScheduler module
- [ ] Tests use proper test framework syntax (Vitest)
- [ ] File passes linting rules
- [ ] coreToolScheduler.ts has no git diff changes (not modified)
- [ ] All tests pass (`npm test` succeeds)

## Semantic Verification Checklist

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions

1. **Do tests verify REAL behavior?**
   - [ ] I read several test cases
   - [ ] Tests call actual scheduler.schedule() method
   - [ ] Tests verify actual state transitions occur
   - [ ] Tests don't just check mocks were called

2. **Are all requirements covered?**
   - [ ] TS-EXEC-001: State transitions verified
   - [ ] TS-EXEC-002: PID tracking verified
   - [ ] TS-EXEC-003: Output streaming verified
   - [ ] TS-EXEC-005: Error handling verified
   - [ ] TS-EXEC-006: Cancellation verified
   - [ ] TS-EXEC-007: Hook invocation verified

3. **Will these tests catch regressions?**
   - [ ] Tests would fail if behavior changes during extraction
   - [ ] Tests verify end-to-end behavior, not implementation details
   - [ ] Tests use realistic mock tools

## Success Criteria

- [ ] All characterization tests pass
- [ ] All TS-EXEC-001 through TS-EXEC-007 requirements covered
- [ ] coreToolScheduler.ts not modified
- [ ] Plan markers present
- [ ] At least 7 test cases
- [ ] No stub behavior testing

## Failure Recovery

If this phase fails:

1. **Tests fail:** Debug why tests don't pass against current code
2. **Missing requirements:** Add tests for uncovered requirements
3. **Stub behavior:** Rewrite tests to exercise real behavior
4. Return to Phase 03 and fix issues

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 03 for remediation.

## Phase Completion Marker

If PASS, create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P03a.md`

Contents:
```markdown
Phase: P03a
Completed: [TIMESTAMP]
Verification Results:
  - Tests pass: PASS
  - Requirements covered: All 7
  - Code not modified: PASS
  - Real behavior tested: PASS
Next Phase: 04 (Extract tool executor)
```

## Phase Completion

If PASS:
1. Create completion marker above
2. Update execution-tracker.md: Mark P03 and P03a complete
3. Proceed to Phase 04

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 03
3. Re-run Phase 03a
