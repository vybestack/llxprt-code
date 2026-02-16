# Phase 04a: Types TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P04a`

## Purpose

Verify the TDD tests from P04 are behavioral, properly marked, and test real outcomes — not mocks or structure.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/types-highdensity.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/types-highdensity.test.ts)
[ "$count" -ge 12 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P04" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: 0

# 6. No structure-only testing (toHaveProperty without value check)
grep -c "toHaveProperty" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: 0 or each instance also checks value
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

- [ ] **Tests import real classes** — MiddleOutStrategy, TopDownTruncationStrategy, OneShotStrategy are imported from source (not mocked)
- [ ] **Tests import real types** — COMPRESSION_STRATEGIES, StrategyTrigger, DensityResult etc. imported from types.ts
- [ ] **Trigger tests check actual values** — `expect(strategy.trigger).toEqual({ mode: 'threshold', defaultThreshold: 0.85 })` not just `toBeDefined()`
- [ ] **Optimize absence tests check undefined** — `expect(strategy.optimize).toBeUndefined()` (this is correct — they don't implement it)
- [ ] **COMPRESSION_STRATEGIES test checks actual membership** — `expect(COMPRESSION_STRATEGIES).toContain('high-density')`
- [ ] **Property-based tests present** — at least 3 tests use property-based testing (fc.assert, fc.property, or test.prop)
- [ ] **No tests modify production code** — tests are read-only checks

### Test Completeness Matrix

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-001.1 | Trigger property exists and is correctly typed | ⬜ |
| REQ-HD-001.3 | Each existing strategy has threshold/0.85 trigger | ⬜ |
| REQ-HD-001.4 | Existing strategies don't implement optimize | ⬜ |
| REQ-HD-001.5 | DensityResult shape constructible | ⬜ |
| REQ-HD-001.8 | DensityResultMetadata shape constructible | ⬜ |
| REQ-HD-001.9 | DensityConfig shape constructible | ⬜ |
| REQ-HD-004.1 | high-density in COMPRESSION_STRATEGIES | ⬜ |

## Property-Based Test Verification

```bash
# Count property-based tests
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/types-highdensity.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/types-highdensity.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: prop_count / total ≥ 0.30
```

## Success Criteria

- ≥ 12 behavioral tests, ≥ 30% property-based
- No mock theater, no reverse testing, no structure-only testing
- All requirements in the test completeness matrix covered
- Tests that exercise existing strategy behavior should PASS
- No production code modifications

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P04 to fix test quality
3. Re-run P04a
