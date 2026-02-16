# Phase 13a: HighDensityStrategy — Compress TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P13a`

## Purpose

Verify the compress TDD tests from P13 are behavioral, properly marked, cover all REQ-HD-008 requirements, and would fail meaningfully when stubs are replaced with real implementations.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-compress.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
[ "$count" -ge 18 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P13" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 6. No spying on strategy internals
grep -c "vi\.spyOn.*strategy\|jest\.spyOn.*strategy" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
echo "Property tests: $prop_count / $total total (need ≥ 30%)"
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

### Test Quality Checks

- [ ] **Tests use a REAL HighDensityStrategy instance** — `new HighDensityStrategy()`
- [ ] **CompressionContext is built with real-ish objects** — not mocked
- [ ] **estimateTokens function returns meaningful values** — word count or similar
- [ ] **resolveProvider throws if called** — proves no LLM usage
- [ ] **Assertions check actual newHistory content** — not just `.toBeDefined()`
- [ ] **Assertions check metadata values** — specific counts, strategy name, llmCallMade

### Test Completeness Matrix

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-008.1 | No LLM call (resolveProvider not invoked) | ⬜ |
| REQ-HD-008.1 | metadata.llmCallMade === false | ⬜ |
| REQ-HD-008.2 | Recent tail entries preserved intact | ⬜ |
| REQ-HD-008.2 | Tail boundary respects tool_call/response pairs | ⬜ |
| REQ-HD-008.2 | Tail covering everything → no changes | ⬜ |
| REQ-HD-008.3 | Tool responses outside tail summarized | ⬜ |
| REQ-HD-008.3 | Summary includes tool name + outcome | ⬜ |
| REQ-HD-008.3 | Summary includes key parameters | ⬜ |
| REQ-HD-008.3 | Tool responses inside tail NOT summarized | ⬜ |
| REQ-HD-008.4 | Human messages preserved intact | ⬜ |
| REQ-HD-008.4 | AI entries preserved intact | ⬜ |
| REQ-HD-008.5 | CompressionResult metadata shape | ⬜ |
| REQ-HD-008.5 | newHistory is valid IContent array | ⬜ |
| REQ-HD-008.6 | Target token calculation (threshold × contextLimit × 0.6) | ⬜ |
| REQ-HD-008.6 | Aggressive truncation when summarization insufficient | ⬜ |
| (edge) | Empty history | ⬜ |
| (edge) | Single entry history | ⬜ |

### Test Behavior Verification

For each test, verify it would FAIL if implementation was wrong:

- [ ] **No LLM test**: Would detect if resolveProvider was called (it throws)
- [ ] **Tail test**: Would detect if tail entries were modified (reference equality or deep equal)
- [ ] **Summarization test**: Would detect if full result remained (check result is short string)
- [ ] **Preservation test**: Would detect if human/AI entries were modified or removed
- [ ] **Metadata test**: Would detect wrong strategy name, wrong llmCallMade, wrong counts
- [ ] **Token target test**: Would detect if no compression occurred (estimated tokens still high)

### Property-Based Test Verification

- [ ] At least 7 property-based tests present
- [ ] Properties test real invariants (newHistory length, human preservation, metadata fields)
- [ ] Properties use generators producing valid IContent arrays and CompressionContext
- [ ] Properties cover: length, human preservation, AI tail preservation, metadata constants, summary format

### CompressionContext Helper Verification

- [ ] Helper function exists for building test contexts
- [ ] estimateTokens is a real function (word count or similar), not a mock
- [ ] ephemerals provide configurable preserveThreshold, compressionThreshold, contextLimit
- [ ] resolveProvider throws if called (behavioral proof of no LLM usage)
- [ ] logger is a real but silent logger

## Test Failure Mode Verification

```bash
# Tests should compile and run (fail from stubs)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | head -30
# Expected: Tests run, most fail due to stubs

# Verify failures are from stubs
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | grep -i "NotYetImplemented"
# Expected: Multiple matches

# No compile errors
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError\|TypeError.*is not"
# Expected: 0

# Optimize tests still pass (no cross-contamination)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- ≥ 18 behavioral tests, ≥ 30% property-based
- All REQ-HD-008 sub-requirements covered in completeness matrix
- No mock theater, no reverse testing, no spying on internals
- Tests compile and run (failures from stubs only)
- All test behavior verification items checked
- CompressionContext helper is real-ish (not mocked)
- No production code modifications
- Optimize tests unaffected

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P13 to fix test quality
3. Re-run P13a
