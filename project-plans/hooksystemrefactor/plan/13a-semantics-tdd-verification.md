# Phase 13a: Semantics/Logging TDD Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P13a`

## Prerequisites

- Required: Phase 13 (semantics TDD) completed
- Verification: `ls packages/core/src/hooks/__tests__/hookSemantics.test.ts`

## Verification Commands

```bash
# 1. Test file exists
ls packages/core/src/hooks/__tests__/hookSemantics.test.ts || exit 1

# 2. Minimum test count (15+)
TOTAL=$(grep -c "^\s*it(" packages/core/src/hooks/__tests__/hookSemantics.test.ts)
[ "$TOTAL" -ge 15 ] && echo "PASS: $TOTAL tests" || echo "FAIL: Only $TOTAL"

# 3. Property test percentage (30%+)
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: $PERCENTAGE%" || echo "FAIL: $PERCENTAGE%"

# 4. Requirements covered
for req in "DELTA-HRUN-001" "DELTA-HRUN-002" "DELTA-HRUN-003" "DELTA-HRUN-004" \
           "DELTA-HTEL-001" "DELTA-HTEL-002" "DELTA-HFAIL-001"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookSemantics.test.ts && \
    echo "PASS: $req" || echo "FAIL: $req missing"
done

# 5. Tests fail naturally (not via NotYetImplemented)
npm test -- --testPathPattern="hookSemantics" 2>&1 | tee /tmp/p13a-output.txt
grep "NotYetImplemented" /tmp/p13a-output.txt && echo "FAIL: NYI pattern" || echo "PASS: no NYI"
grep -E "FAIL|failed" /tmp/p13a-output.txt && echo "PASS: Tests are failing (expected)" || \
  echo "WARN: All tests passing — check stubs are not already real"

# 6. No mock theater (log verification by content not mock.toHaveBeenCalled)
grep -cE "toHaveBeenCalled\b" packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 0 or near 0 (log records captured in array, not mock verification)

# 7. Behavioral assertions
grep -cE "toBe\(|toEqual\(|toStrictEqual\(" packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 15+

# 8. Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P13" packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 5+

# 9. Stop semantics coverage
grep -cE "shouldStop|stopReason" packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 6+ test assertions about stop semantics

# 10. Logging semantics coverage
grep -cE "hook:result|hook:batch_summary|hook:failure" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 3+ log channel references

# 11. Previous tests still pass
npm test -- --testPathPattern="hookSystem-lifecycle|hookValidators|hookEventHandler-messagebus" \
  2>&1 | grep "passed"
# Expected: all still passing
```

### Semantic Verification Checklist

1. **Do stop semantics tests verify real behavior?**
   - [ ] Test verifies shouldStop=true with specific value, not just toBeDefined
   - [ ] Test verifies first-wins semantics with concrete second reason ignored
   - [ ] Tests fail because stub returns shouldStop=false (defaults)

2. **Do logging tests capture content?**
   - [ ] Logger implemented as record-accumulating array, not jest.fn()
   - [ ] Tests assert specific channel names ('hook:result', 'hook:batch_summary')
   - [ ] Tests assert specific record field values (count, success flags, etc.)

3. **Do failure envelope tests check structure?**
   - [ ] Verify result.success === false (not just that it doesn't throw)
   - [ ] Verify errors array has specific stage and message
   - [ ] Would pass on real implementation, fail on EMPTY_SUCCESS_RESULT

4. **Are property tests testing real invariants?**
   - [ ] shouldStop determined by outputs (not stubbed false)
   - [ ] Log count equals hook count (real 1:1 relationship)
   - [ ] Trim semantics verified for any input string

#### Holistic Assessment

**What tests were written?**
Behavioral tests for processCommonHookOutputFields (stop semantics, systemMessage,
suppressOutput, normalization), emitPerHookLogs (record count and content), 
emitBatchSummary (summary fields), and buildFailureEnvelope (catch block behavior).
Property tests for stop determinism, trim invariants, and log count.

**Why tests fail now?**
Stubs return default ProcessedHookResult (shouldStop=false). Tests expecting
shouldStop=true for hook outputs that signal stop will fail with
`expected true received false`.

**Verdict**: PASS if count ≥15, property% ≥30%, tests fail on stub defaults,
all 7 requirements tagged, no mock theater.

### Mutation Testing

```bash
npx stryker run --mutate packages/core/src/hooks/hookEventHandler.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc -l) -eq 1 ] && echo "PASS" || { echo "FAIL: $MUTATION_SCORE%"; exit 1; }
```

## Success Criteria

- 15+ tests, 5+ property-based (30%+)
- Tests fail naturally (defaults != real behavior)
- All 7 requirements tagged
- No mock theater (content verification)
- Previous tests pass
- Mutation score ≥ 80%

## Failure Recovery

1. If tests aren't failing: stubs may already be real; verify stub phase was done
2. If mock theater detected: replace jest.fn() logger with accumulating array
3. Cannot proceed to P14 until all checks pass

## Mandatory Reviewer Judgment (BLOCKING)

The reviewer executing this phase MUST manually verify and attest:

### 1. Test Reality Check
- [ ] Tests assert REAL behavior, not stub/mock returns
- [ ] Tests would FAIL if implementation returned constants/empty values
- [ ] Tests verify observable outcomes, not internal implementation details

### 2. dev-docs/RULES.md Compliance
- [ ] NO reverse testing (tests expecting NotYetImplemented, TODO, or stub behavior)
- [ ] NO mock theater (tests that just verify mocks were called)
- [ ] Tests are BEHAVIORAL (verify what the code does, not how it does it)
- [ ] Integration tests come before unit tests in test file

### 3. RED Phase Evidence (CRITICAL)
- [ ] Tests were run BEFORE implementation and FAILED
- [ ] Failure output captured in .completed/P##.md marker
- [ ] Test IDs in RED output match test IDs in GREEN output
- [ ] Cannot proceed without RED evidence

### 4. Attestation
```
I, [reviewer], attest that I have:
1. Read each test and verified it tests real behavior
2. Confirmed tests follow dev-docs/RULES.md
3. Verified RED phase failure evidence exists
4. Confirmed tests would catch an empty/stub implementation

Signature: _______________
Date: _______________
```

**If ANY checkbox is unchecked, this phase FAILS and cannot proceed.**

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P13a.md`
