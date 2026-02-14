# Phase 10a: HighDensityStrategy — Optimize TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P10a`

## Purpose

Verify the optimize TDD tests from P10 are behavioral, properly marked, cover all pruning requirements, and would fail meaningfully when stubs are replaced with real implementations.

## Structural Checks

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-optimize.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
[ "$count" -ge 26 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers
grep -c "@plan.*HIGHDENSITY.P10" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 1

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: 0

# 5. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: 0

# 6. No spying on strategy internals
grep -c "vi\.spyOn.*strategy\|jest\.spyOn.*strategy" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
echo "Property tests: $prop_count / $total total (need ≥ 30%)"
```

## Behavioral Verification

The verifier MUST read the test file and confirm:

### Test Quality Checks

- [ ] **Tests use a REAL HighDensityStrategy instance** — not a mock or partial
- [ ] **History entries are real IContent objects** — properly typed with speaker, blocks, etc.
- [ ] **Tests import real types** — DensityResult, DensityConfig, IContent from source
- [ ] **Assertions check actual DensityResult values** — removals array, replacements map, metadata counts
- [ ] **Tests verify block-level content** — not just that replacements exist, but that the right blocks were kept/removed

### Test Completeness Matrix — READ→WRITE Pruning

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-005.1 | Stale read identified and removed | ⬜ |
| REQ-HD-005.2 | All four read tool types recognized | ⬜ |
| REQ-HD-005.3 | All five write tool types recognized | ⬜ |
| REQ-HD-005.4 | file_path, absolute_path, path keys extracted | ⬜ |
| REQ-HD-005.5 | Path normalization via resolve | ⬜ |
| REQ-HD-005.6 | Stale read removal (tool_call + tool_response) | ⬜ |
| REQ-HD-005.7 | Post-write reads preserved | ⬜ |
| REQ-HD-005.8 | Block-level granularity (partial AI entry) | ⬜ |
| REQ-HD-005.9 | read_many_files concrete vs glob handling | ⬜ |
| REQ-HD-005.10 | Disabled when config false | ⬜ |
| REQ-HD-005.11 | Workspace root resolution for relative paths | ⬜ |
| REQ-HD-013.5 | Malformed params skipped without throw | ⬜ |

### Test Completeness Matrix — @ File Deduplication

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-006.1 | Delimiter pattern detection | ⬜ |
| REQ-HD-006.2 | Latest inclusion preserved, earlier stripped | ⬜ |
| REQ-HD-006.3 | Replacement not removal (surrounding text kept) | ⬜ |
| REQ-HD-006.4 | Disabled when config false | ⬜ |
| REQ-HD-006.5 | Unpaired delimiters fail-safe | ⬜ |

### Test Completeness Matrix — Recency Pruning

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-007.1 | Recency window per tool name | ⬜ |
| REQ-HD-007.2 | Pointer string content correct | ⬜ |
| REQ-HD-007.3 | Structure preservation (only result changes) | ⬜ |
| REQ-HD-007.6 | Disabled when config false | ⬜ |
| REQ-HD-013.6 | Retention < 1 treated as 1 | ⬜ |

### Test Completeness Matrix — Cross-Cutting

| Requirement | Test Description | Present? |
|-------------|-----------------|----------|
| REQ-HD-013.7 | Metadata accuracy across all phases | ⬜ |
| (invariant) | No index in both removals and replacements | ⬜ |
| (invariant) | All indices within bounds | ⬜ |
| (merge) | Removed entries skipped by later phases | ⬜ |
| (edge) | Empty history → empty result | ⬜ |
| (edge) | All options disabled → empty result | ⬜ |

### Test Behavior Verification

For each test category, verify the test would FAIL if implementation was wrong:

- [ ] **RW pruning**: Would detect if reads AFTER writes were incorrectly removed
- [ ] **Block granularity**: Would detect if entire AI entry was removed instead of partial replacement
- [ ] **Dedup**: Would detect if earliest inclusion was preserved instead of latest
- [ ] **Recency**: Would detect if per-tool counting was wrong (all tools counted together)
- [ ] **Structure**: Would detect if tool response entries were removed instead of replaced
- [ ] **Config disable**: Would detect if pruning still occurred when disabled
- [ ] **Metadata**: Would detect if counts were wrong

### Property-Based Test Verification

- [ ] At least 8 property-based tests present
- [ ] Properties test invariants across random histories (removal/replacement overlap, bounds, speaker preservation)
- [ ] Properties use generators producing valid IContent arrays
- [ ] Properties cover all three pruning phases plus merge

## Test Failure Mode Verification

```bash
# Tests should compile and run (fail from stubs)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | head -30
# Expected: Tests run, most fail due to stubs

# Verify failures are from stubs
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | grep -i "NotYetImplemented"
# Expected: Multiple matches

# No compile errors
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError\|TypeError.*is not"
# Expected: 0
```

## Success Criteria

- ≥ 26 behavioral tests, ≥ 30% property-based
- All requirements in all three completeness matrices covered
- No mock theater, no reverse testing, no spying on internals
- Tests compile and run (failures from stubs only)
- All test behavior verification items checked
- No production code modifications

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P10 to fix test quality
3. Re-run P10a
