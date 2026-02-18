# Phase 07a: MessageBus TDD Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P07a`

## Prerequisites

- Required: Phase 07 (MessageBus TDD) completed
- Verification: `ls packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts`

## Verification Commands

```bash
# 1. Test file exists
ls packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts || exit 1

# 2. Minimum test count
TOTAL=$(grep -c "^\s*it(" packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts)
[ "$TOTAL" -ge 15 ] && echo "PASS: $TOTAL tests" || echo "FAIL: Only $TOTAL tests"

# 3. Property test percentage
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: $PERCENTAGE% property tests" || \
  echo "FAIL: Only $PERCENTAGE% property tests"

# 4. Requirements covered
for req in "DELTA-HEVT-001" "DELTA-HEVT-002" "DELTA-HEVT-003" "DELTA-HBUS-002" "DELTA-HBUS-003" "DELTA-HPAY-003"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts && \
    echo "PASS: $req covered" || echo "FAIL: $req not covered"
done

# 5. Tests fail naturally
npm test -- --testPathPattern="hookEventHandler-messagebus" 2>&1 | tee /tmp/p07-test-output.txt
grep "NotYetImplemented" /tmp/p07-test-output.txt && echo "FAIL: NotYetImplemented in failures" || echo "PASS: No NotYetImplemented"
grep "FAIL\|failed" /tmp/p07-test-output.txt && echo "PASS: Tests are failing (as expected)" || echo "WARN: No failures found"

# 6. No mock theater
grep -cE "toHaveBeenCalled\b" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Acceptable if only used for lifecycle/translator verification; 0 ideal for bus messages

# 7. No reverse testing
grep -E "NotYetImplemented|\.not\.toThrow\(\)" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 0

# 8. Behavioral assertions
grep -cE "toBe\(|toEqual\(|toStrictEqual\(|toMatch\(|toContain\(" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 12+

# 9. Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P07" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 5+

# 10. All previous tests still pass
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep "passed"
# Expected: 15+ still passing
```

### Semantic Verification Checklist

1. **Do tests verify real bus behavior?**
   - [ ] correlationId echo test captures actual response message content
   - [ ] Unsupported event test reads actual failure response (not just that an error occurred)
   - [ ] Model translation test verifies translated payload reaches hooks

2. **Are property tests meaningful?**
   - [ ] correlationId property tests any string and verifies echo
   - [ ] "One response per request" property is a real invariant
   - [ ] Properties would catch real bugs (empty correlationId, multiple responses)

3. **Is the integration approach correct?**
   - [ ] Tests use real (or minimal fake) MessageBus, not deeply mocked one
   - [ ] Tests verify message contents on the bus, not just internal method calls

4. **Are all 6 requirements exercised?**
   - [ ] DELTA-HEVT-001: subscription setup test present
   - [ ] DELTA-HEVT-002: correlationId echo test present
   - [ ] DELTA-HEVT-003: unsupported event failure test present
   - [ ] DELTA-HBUS-002: direct path without bus test present
   - [ ] DELTA-HBUS-003: UUID generation test present
   - [ ] DELTA-HPAY-003: model translation test present

#### Holistic Assessment

**What tests were written?**
Behavioral tests for MessageBus integration covering subscription lifecycle,
correlated response publishing, unsupported event handling, bus-absent fallback,
correlationId generation, and model payload translation.

**Are the tests sufficient?**
Tests cover the full round-trip: publish request → handler processes → response published.
This is end-to-end for the bus integration (unit would only test one side).

**Verdict**: PASS if count ≥15, property% ≥30%, tests fail naturally, no mock theater
for bus messages, all 6 requirements tagged.

### Mutation Testing

```bash
npx stryker run --mutate packages/core/src/hooks/hookEventHandler.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc -l) -eq 1 ] && echo "PASS" || { echo "FAIL: $MUTATION_SCORE%"; exit 1; }
```

## Success Criteria

- 15+ tests, 5+ property-based (30%+)
- Tests fail naturally (not NotYetImplemented)
- No mock theater for bus message content
- All 6 requirements tagged
- Mutation score ≥ 80%

## Failure Recovery

1. Rewrite tests that only check mock calls — change to verify bus message contents
2. Add missing requirement coverage
3. Cannot proceed to P08 until all checks pass

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

Create: `project-plans/hooksystemrefactor/.completed/P07a.md`
