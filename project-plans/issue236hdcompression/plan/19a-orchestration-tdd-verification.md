# Phase 19a: Orchestration — TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P19a`

## Purpose

Verify the orchestration TDD tests from P19 are behavioral, properly marked, cover all REQ-HD-002 requirements, follow existing GeminiChat test patterns, and would fail meaningfully when the stub is replaced with real implementation.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/core/__tests__/geminiChat-density.test.ts && echo "PASS" || echo "FAIL"
# Note: actual path may differ — adjust based on existing GeminiChat test locations

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/__tests__/geminiChat-density.test.ts)
[ "$count" -ge 18 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P19" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 6. No spying on internal methods
grep -c "vi\.spyOn.*ensureDensityOptimized\|vi\.spyOn.*optimize" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/__tests__/geminiChat-density.test.ts)
total=$(grep -c "it(" packages/core/src/core/__tests__/geminiChat-density.test.ts)
echo "Property tests: $prop_count / $total total (need ≥ 30%)"
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

### Test Quality Checks

- [ ] **Tests follow existing GeminiChat test patterns** — same setup/teardown, same helpers
- [ ] **Tests use REAL HighDensityStrategy** — not mocked
- [ ] **Tests build realistic history** — with tool calls, responses, user messages
- [ ] **Tests verify observable outcomes** — history changes, token counts, not internal method calls
- [ ] **No toHaveBeenCalled on internal methods** — behavior-only verification
- [ ] **Dirty flag behavior tested via consecutive operations** — not by reading private field directly (unless test pattern allows)

### Test Completeness Matrix

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-002.1 | Optimization runs before threshold check | ⬜ |
| REQ-HD-002.1 | Density can prevent compression from triggering | ⬜ |
| REQ-HD-002.1 | Compression still runs if density insufficient | ⬜ |
| REQ-HD-002.2 | Skips when strategy has no optimize | ⬜ |
| REQ-HD-002.3 | Skips when not dirty | ⬜ |
| REQ-HD-002.4 | Applies result and awaits tokens | ⬜ |
| REQ-HD-002.4 | Token count reflects changes | ⬜ |
| REQ-HD-002.5 | Empty result → no apply | ⬜ |
| REQ-HD-002.6 | Dirty flag set on user message add | ⬜ |
| REQ-HD-002.6 | Dirty flag set on AI response | ⬜ |
| REQ-HD-002.6 | Dirty flag NOT set during compression | ⬜ |
| REQ-HD-002.7 | Dirty flag cleared after optimization | ⬜ |
| REQ-HD-002.7 | Dirty flag cleared even on error | ⬜ |
| REQ-HD-002.8 | Emergency path runs density first | ⬜ |
| REQ-HD-002.8 | Emergency path skips compression if density sufficient | ⬜ |
| REQ-HD-002.9 | Optimize receives raw history | ⬜ |
| REQ-HD-002.10 | Only called from sequential pre-send paths | ⬜ |

### Test Behavior Verification

For each test, verify it would FAIL if implementation was wrong:

- [ ] **Optimization test**: Would detect if optimize was never called (history unchanged for prunable content)
- [ ] **Conditional skip test**: Would detect if optimize ran for middle-out (history would error or be unexpected)
- [ ] **Clean skip test**: Would detect if optimization ran when not dirty (unexpected history change)
- [ ] **Apply test**: Would detect if applyDensityResult was skipped (history unchanged)
- [ ] **Token test**: Would detect if tokens weren't recalculated (stale count)
- [ ] **Empty result test**: Would detect if apply was called unnecessarily (side effects)
- [ ] **Dirty flag tests**: Would detect wrong flag state via consecutive operation behavior
- [ ] **Emergency test**: Would detect if density step was missing from emergency path

### Property-Based Test Verification

- [ ] At least 6 property-based tests present
- [ ] Properties test real invariants (dirty flag, history length, token monotonicity)
- [ ] Properties use realistic generators for history content
- [ ] Properties cover: dirty flag reset, history monotonicity, strategy compatibility, empty result idempotency

### Test Run Verification

```bash
# Tests compile and run
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1 | head -30

# Most tests should fail (stub is no-op)
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1 | grep -c "FAIL\|fail"
# Expected: ≥ 10 (most tests fail because stub doesn't implement behavior)

# No compile errors
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError\|TypeError.*is not"
# Expected: 0

# Existing tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- ≥ 18 behavioral tests, ≥ 30% property-based
- All REQ-HD-002 sub-requirements covered in completeness matrix
- No mock theater, no reverse testing, no spying on internals
- Tests compile and run (failures from no-op stub, not infrastructure)
- Tests follow existing GeminiChat test patterns
- All test behavior verification items checked
- No production code modifications
- Existing tests unaffected

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P19 to fix test quality
3. Re-run P19a
