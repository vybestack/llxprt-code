# Phase 16a: Settings & Factory — TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P16a`

## Purpose

Verify the settings & factory TDD tests from P16 are behavioral, properly marked, cover all REQ-HD-004 and REQ-HD-009 requirements, and would fail meaningfully against incorrect implementations.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-settings.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
[ "$count" -ge 20 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P16" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 6. No spying on internals
grep -c "vi\.spyOn\|jest\.spyOn" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
echo "Property tests: $prop_count / $total total (need ≥ 30%)"
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

### Test Quality Checks

- [ ] **Tests use REAL SETTINGS_REGISTRY** — imported directly, searched by key
- [ ] **Tests use REAL COMPRESSION_STRATEGIES** — imported directly, membership checked
- [ ] **Tests use REAL getCompressionStrategy** — factory called with `'high-density'`
- [ ] **Tests use REAL runtime context builder** — or minimal-real equivalent
- [ ] **Assertions check actual values** — not just `.toBeDefined()`
- [ ] **Settings spec tests verify ALL properties** — key, type, default, category, persistToProfile

### Test Completeness Matrix

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-004.1 | COMPRESSION_STRATEGIES includes 'high-density' | ⬜ |
| REQ-HD-004.1 | Existing strategies preserved | ⬜ |
| REQ-HD-004.2 | Factory returns HighDensityStrategy | ⬜ |
| REQ-HD-004.2 | Factory result has optimize method | ⬜ |
| REQ-HD-004.2 | Factory result has compress method | ⬜ |
| REQ-HD-004.3 | Strategy properties (name, requiresLLM, trigger) | ⬜ |
| REQ-HD-004.4 | compression.strategy enumValues includes 'high-density' | ⬜ |
| REQ-HD-004.4 | enumValues derives from COMPRESSION_STRATEGIES | ⬜ |
| REQ-HD-009.1 | readWritePruning setting spec | ⬜ |
| REQ-HD-009.2 | fileDedupe setting spec | ⬜ |
| REQ-HD-009.3 | recencyPruning setting spec | ⬜ |
| REQ-HD-009.4 | recencyRetention setting spec | ⬜ |
| REQ-HD-009.5 | Accessor returns configured value | ⬜ |
| REQ-HD-009.5 | Accessor returns default when unset | ⬜ |
| REQ-HD-009.5 | Threshold precedence (ephemeral > profile > default) | ⬜ |
| REQ-HD-009.6 | EphemeralSettings type fields (implicit via accessor tests) | ⬜ |

### Test Behavior Verification

For each test, verify it would FAIL if implementation was wrong:

- [ ] **Tuple test**: Would detect if 'high-density' was missing from COMPRESSION_STRATEGIES
- [ ] **Factory test**: Would detect if factory returned wrong strategy or threw
- [ ] **Properties test**: Would detect wrong name, requiresLLM, or trigger values
- [ ] **Settings spec tests**: Would detect wrong type, default, category, or persistToProfile
- [ ] **Accessor tests**: Would detect wrong value returned or missing accessor
- [ ] **Precedence test**: Would detect if ephemeral didn't override profile

### Property-Based Test Verification

- [ ] At least 7 property-based tests present
- [ ] Properties test real invariants (category consistency, type consistency, factory name match)
- [ ] Properties cover: settings category, persistToProfile, accessor types, tuple membership, factory names

### Test Run Verification

```bash
# Tests compile and run
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | head -30

# Factory tests should fail (stub throws NotYetImplemented)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | grep -c "FAIL\|fail"
# Expected: ≥ 1 (factory tests fail)

# Settings spec tests should pass (specs are data, already added in P15)
# Accessor default tests should pass (wiring already added in P15)

# No compile errors
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError\|TypeError.*is not"
# Expected: 0

# Optimize/compress tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- ≥ 20 behavioral tests, ≥ 30% property-based
- All REQ-HD-004 and REQ-HD-009 sub-requirements covered in completeness matrix
- No mock theater, no reverse testing, no spying
- Tests compile and run (factory tests fail from stub; settings/accessor tests may pass)
- All test behavior verification items checked
- No production code modifications
- Existing tests unaffected

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P16 to fix test quality
3. Re-run P16a
