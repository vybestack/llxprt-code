# Phase 10a: Validation TDD Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P10a`

## Prerequisites

- Required: Phase 10 (validation TDD) completed
- Verification: `ls packages/core/src/hooks/__tests__/hookValidators.test.ts`

## Verification Commands

```bash
# 1. Test file exists
ls packages/core/src/hooks/__tests__/hookValidators.test.ts || exit 1

# 2. Minimum test count (15+)
TOTAL=$(grep -c "^\s*it(" packages/core/src/hooks/__tests__/hookValidators.test.ts)
[ "$TOTAL" -ge 15 ] && echo "PASS: $TOTAL tests" || echo "FAIL: Only $TOTAL"

# 3. Property test percentage (30%+)
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookValidators.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: $PERCENTAGE%" || echo "FAIL: $PERCENTAGE%"

# 4. All 8 event families covered
for event in "BeforeTool" "AfterTool" "BeforeAgent" "AfterAgent" \
             "BeforeModel" "AfterModel" "BeforeToolSelection" "Notification"; do
  grep -q "validate${event}Input\|$event" packages/core/src/hooks/__tests__/hookValidators.test.ts && \
    echo "PASS: $event covered" || echo "FAIL: $event not covered"
done

# 5. Tests fail naturally (not NotYetImplemented)
npm test -- --testPathPattern="hookValidators" 2>&1 | tee /tmp/p10a-output.txt
grep "NotYetImplemented" /tmp/p10a-output.txt && echo "FAIL: NotYetImplemented" || echo "PASS: No NYI"
grep "FAIL\|failed" /tmp/p10a-output.txt && echo "PASS: Failing as expected" || echo "WARN: No failures"

# 6. No mock theater
grep -cE "toHaveBeenCalled\b" packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 0 (pure functions need no mocks)

# 7. Behavioral assertions (toBe true/false)
grep -cE "toBe\(true\)|toBe\(false\)" packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 15+ (each validator test checks actual return value)

# 8. Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P10" packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 5+

# 9. Requirements covered
for req in "DELTA-HPAY-001" "DELTA-HPAY-002" "DELTA-HPAY-005"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookValidators.test.ts && \
    echo "PASS: $req" || echo "FAIL: $req"
done

# 10. P04 tests still pass
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep "passed"
# Expected: 15+ passing
```

### Semantic Verification Checklist

1. **Do tests check real behavior (true/false returns)?**
   - [ ] Valid BeforeTool input → assertTrue(result)
   - [ ] Missing tool_name → assertFalse(result)
   - [ ] Tests fail because stub returns false for valid inputs

2. **Do property tests test real invariants?**
   - [ ] "any non-empty string + object passes BeforeTool" is a real invariant
   - [ ] "null/undefined fails all validators" is a real invariant
   - [ ] "extra fields tolerated" tests the minimal validation business rule

3. **Is integration test present (validation gate)?**
   - [ ] Test that invalid mediated request gets 'validation_failure' response code
   - [ ] Test that valid request does NOT get validation failure

4. **Are type predicates implied by tests?**
   - [ ] Tests verify boolean return (type narrowing verified by TypeScript compilation)

#### Holistic Assessment

**What tests were written?**
Behavioral tests for all 8 event-family validator functions plus the mediated path
validation gate. Tests check concrete true/false returns from validators for valid
and invalid inputs. Property tests cover null/undefined rejection and extra-field tolerance.

**Are tests sufficient?**
Yes — each validator is tested with at least one valid and one invalid case.
Property tests cover universal edge cases. Integration test verifies the gate
actually prevents bad requests from reaching executeHooksCore.

**Why tests fail now?**
Stub validators return false for everything. Tests expecting `true` for valid inputs
will fail with `expected true received false`. This is the correct natural failure mode.

**Verdict**: PASS if count ≥15, property% ≥30%, tests fail on false-returning stubs,
all 8 events covered, no mock theater.

### Mutation Testing

```bash
npx stryker run --mutate packages/core/src/hooks/hookEventHandler.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc -l) -eq 1 ] && echo "PASS" || { echo "FAIL: $MUTATION_SCORE%"; exit 1; }
```

## Success Criteria

- 15+ tests, 5+ property-based (30%+)
- All 8 event families covered
- Tests fail naturally (false for valid inputs)
- No mock theater, no reverse testing
- All 3 requirements tagged
- Mutation score ≥ 80%

## Failure Recovery

1. Add missing event family coverage
2. Convert mock-checking tests to value-checking tests
3. Cannot proceed to P11 until all checks pass

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

Create: `project-plans/hooksystemrefactor/.completed/P10a.md`
