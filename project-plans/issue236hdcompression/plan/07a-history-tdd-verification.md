# Phase 07a: HistoryService Extensions — TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P07a`

## Purpose

Verify the TDD tests from P07 are behavioral, properly marked, test real outcomes, and cover all HistoryService density requirements.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/services/history/__tests__/density-history.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/services/history/__tests__/density-history.test.ts)
[ "$count" -ge 16 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P07" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: 0

# 6. No spying on HistoryService methods
grep -c "vi\.spyOn.*historyService\|jest\.spyOn.*historyService" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/services/history/__tests__/density-history.test.ts)
total=$(grep -c "it(" packages/core/src/services/history/__tests__/density-history.test.ts)
echo "Property tests: $prop_count / $total total (need ≥ 30%)"
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

### Test Quality Checks

- [ ] **Tests use a REAL HistoryService instance** — not a mock or partial
- [ ] **History entries are added via `add()`** — not by directly manipulating internals
- [ ] **Tests import real types** — DensityResult, IContent, etc. from source
- [ ] **Assertions check actual content** — not just `.toBeDefined()` or `.toBeTruthy()`
- [ ] **Error tests check specific error codes** — `DENSITY_CONFLICT`, `DENSITY_INDEX_OUT_OF_BOUNDS`
- [ ] **Token tests verify actual values** — `getTotalTokens()` returns a concrete number, not just "changed"

### Test Completeness Matrix

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-003.1 | applyDensityResult applies both removals and replacements | ⬜ |
| REQ-HD-003.2 | Replacements applied before removals (order verified) | ⬜ |
| REQ-HD-003.3 | Removals in reverse index order (verified by final array) | ⬜ |
| REQ-HD-003.4 | Token recalculation triggered after mutation | ⬜ |
| REQ-HD-003.5 | getRawHistory returns unfiltered array | ⬜ |
| REQ-HD-003.5 | getRawHistory includes entries getCuratedHistory filters | ⬜ |
| REQ-HD-003.6 | recalculateTotalTokens updates through tokenizerLock | ⬜ |
| REQ-HD-001.6 | Conflict invariant (same index in removals + replacements) | ⬜ |
| REQ-HD-001.7 | Out-of-bounds removal index rejected | ⬜ |
| REQ-HD-001.7 | Out-of-bounds replacement index rejected | ⬜ |
| REQ-HD-001.7 | Negative index rejected | ⬜ |
| (safety) | Duplicate removal indices rejected | ⬜ |

### Test Behavior Verification

For each test category, verify the test would FAIL if implementation was wrong:

- [ ] **Ordering test**: Would detect if removals happened before replacements (the replaced entry would be at wrong index or missing)
- [ ] **Reverse removal test**: Would detect if forward-order removal was used (wrong entries removed)
- [ ] **Conflict test**: Would detect if conflict check was missing (no error thrown)
- [ ] **Bounds test**: Would detect if bounds check was missing (no error thrown, or wrong entries affected)
- [ ] **Token test**: Would detect if recalculation was skipped (stale token count)
- [ ] **Raw history test**: Would detect if getRawHistory returned curated view (missing entries)

### Property-Based Test Verification

- [ ] At least 5 property-based tests present
- [ ] Properties test invariants, not specific values (e.g., "length after removal = original - removals.length")
- [ ] Property generators produce valid HistoryService state (real IContent entries)
- [ ] Properties cover: length invariant, untouched entries, replacement correctness, conflict detection, raw history length

## Test Failure Mode Verification

```bash
# Tests should compile and run (even though stubs fail)
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1 | head -30
# Expected: Tests run, most/all fail due to stubs

# Verify failure messages are from stubs, not infrastructure
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1 | grep -i "NotYetImplemented\|not implemented\|stub"
# Expected: Multiple matches (stubs throwing)

# No compile errors
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1 | grep -i "cannot find\|SyntaxError\|TypeError.*is not"
# Expected: 0 matches (tests compile cleanly)
```

## Success Criteria

- ≥ 16 behavioral tests, ≥ 30% property-based
- All requirements in the test completeness matrix covered
- No mock theater, no reverse testing, no spying on HistoryService
- Tests compile and run (failures from stubs only)
- All test behavior verification items checked
- No production code modifications

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P07 to fix test quality
3. Re-run P07a
