# Phase 04a: Lifecycle TDD Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P04a`

## Prerequisites

- Required: Phase 04 (lifecycle TDD) completed
- Verification: `ls packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts`

## Verification Commands

### Test Quality Checks

```bash
# 1. Test file exists
ls packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts || exit 1
echo "PASS: Test file exists"

# 2. Minimum test count
TOTAL=$(grep -c "^\s*it(" packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts)
echo "Total tests: $TOTAL"
[ "$TOTAL" -ge 15 ] && echo "PASS: 15+ tests" || echo "FAIL: Only $TOTAL tests"

# 3. Property-based test count (30% minimum)
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
echo "Property tests: $PROPERTY ($PERCENTAGE%)"
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: 30%+ property tests" || echo "FAIL: Only $PERCENTAGE% property tests"

# 4. All requirements covered
for req in "DELTA-HSYS-001" "DELTA-HSYS-002" "DELTA-HEVT-004" "DELTA-HPAY-006"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts || \
    echo "FAIL: $req not covered"
done
echo "PASS: All requirements covered"

# 5. Plan markers present
grep -c "PLAN-20250218-HOOKSYSTEM.P04" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 5+

# 6. Tests fail NATURALLY (not on NotYetImplemented)
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep -E "FAIL|NotYetImplemented"
# Expected: FAIL present (tests are failing as expected), NOT "NotYetImplemented"
# If you see "NotYetImplemented" in failures, the stubs are wrong

# 7. Tests do NOT pass yet (they must fail before implementation)
PASS_COUNT=$(npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep -c "[OK]\|PASS")
echo "Passing tests: $PASS_COUNT (should be 0 or very low until P05)"
```

### Anti-Fraud Checks

```bash
# No mock theater
grep -cE "toHaveBeenCalled\b|toHaveBeenCalledTimes\b|toHaveBeenCalledWith\b" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 (lifecycle spy for dispose is an exception if needed)
# If >0: verify each is a LIFECYCLE assertion, not a behavior replacement

# No reverse testing
grep -E "NotYetImplemented|\.not\.toThrow\(\)" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 matches

# Behavioral assertions dominate
grep -cE "toBe\(|toEqual\(|toStrictEqual\(|toContain\(|toMatch\(" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 10+

# No structure-only tests (toHaveProperty alone)
grep -E "toHaveProperty\|toBeDefined\(\)|toBeUndefined\(\)" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts | head -5
# Expected: 0 unless paired with value assertion
```

### Deferred Implementation Detection

```bash
grep -rn "TODO\|FIXME\|HACK\|STUB\|placeholder" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 matches
```

### Semantic Verification Checklist

1. **Do tests verify REAL BEHAVIOR?**
   - [ ] Tests check actual output values (not just that code ran)
   - [ ] getAllHooks() tests check returned array contents
   - [ ] setHookEnabled() tests verify the state change persisted

2. **Would tests fail if implementation was removed?**
   - [ ] Yes — removing setHookEnabled implementation would cause tests to fail
   - [ ] Yes — removing dispose() would cause lifecycle tests to fail

3. **Are property tests meaningful?**
   - [ ] Property tests cover real invariants (not trivially true statements)
   - [ ] fc.string() generates realistic hook IDs
   - [ ] Properties would catch real bugs

4. **Are all DELTA-HSY/HEVT/HPAY-006 requirements exercised?**
   - [ ] DELTA-HSYS-001: Injection test written (may fail with "undefined" not "NotYetImplemented")
   - [ ] DELTA-HSYS-002: Management API tests written
   - [ ] DELTA-HEVT-004: Dispose lifecycle test written
   - [ ] DELTA-HPAY-006: Session enum type test written

5. **What specific failures occur when running tests?**
   - Document actual failure messages here (paste npm test output)
   - They should say things like "expected false received undefined" not "NotYetImplemented"

#### Holistic Functionality Assessment

**What tests were written?**
Behavioral tests for lifecycle management: injection forwarding, management API
state changes, dispose lifecycle, enum type enforcement, session event parameter types.

**Do tests target real behavioral outcomes?**
Yes — each test checks a specific state change or output value, not just that a
method was called or that an object has a property.

**Are property tests testing real invariants?**
Yes — enable/disable toggle idempotency and id-independence are real correctness properties.

**Verdict**: PASS if test count ≥15, property% ≥30%, tests fail naturally, no mock theater,
no reverse testing.

### Mutation Testing

```bash
npx stryker run --mutate packages/core/src/hooks/hookEventHandler.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc -l) -eq 1 ] && echo "PASS" || { echo "FAIL: $MUTATION_SCORE%"; exit 1; }
```

## Success Criteria

- 15+ tests written
- 5+ property-based tests (30%+)
- Tests fail naturally when run against stubs
- No mock theater, no reverse testing, no structure-only tests
- All requirements tagged
- Mutation score ≥ 80%

## Failure Recovery

1. `git checkout -- packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts`
2. Re-read PLAN.md behavioral testing requirements
3. Rewrite failing tests to check actual output values
4. Cannot proceed to P05 until this verification passes

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

Create: `project-plans/hooksystemrefactor/.completed/P04a.md`

```markdown
Phase: P04a
Completed: YYYY-MM-DD HH:MM
Total Tests: [N]
Property Tests: [N] ([P]%)
Naturally Failing: YES
Anti-Fraud: PASS
Verdict: PASS/FAIL
```
