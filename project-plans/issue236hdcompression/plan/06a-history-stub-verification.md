# Phase 06a: HistoryService Extensions — Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P06a`

## Purpose

Verify the HistoryService stubs from P06 compile correctly, have proper signatures, don't break existing functionality, and are correctly marked.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers in HistoryService
grep -c "@plan.*HIGHDENSITY.P06" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 1

# 3. Requirement markers present
grep -c "@requirement.*REQ-HD-003" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 1

# 4. Pseudocode references present
grep -c "@pseudocode.*history-service" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 1

# 5. Import exists
grep "import.*DensityResult" packages/core/src/services/history/HistoryService.ts && echo "PASS" || echo "FAIL"

# 6. No forbidden patterns in stubs (stubs are allowed to have NotYetImplemented — that's the point)
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/services/history/HistoryService.ts | grep -v "NotYetImplemented" | grep -v ".test."
# Expected: No matches
```

## Behavioral Verification

### Method Signature Verification

The verifier MUST read `HistoryService.ts` and confirm:

- [ ] `applyDensityResult(result: DensityResult): Promise<void>` — correct parameter type, async return
- [ ] `getRawHistory(): readonly IContent[]` — correct return type with readonly modifier
- [ ] `recalculateTotalTokens(): Promise<void>` — correct async return type
- [ ] `DensityResult` is imported from `'../../core/compression/types.js'` (correct relative path from services/history to core/compression)

### Stub Behavior Verification

- [ ] `applyDensityResult()` throws `Error('NotYetImplemented: applyDensityResult')` — not a no-op
- [ ] `getRawHistory()` returns `[]` — empty array, not undefined/null
- [ ] `recalculateTotalTokens()` throws `Error('NotYetImplemented: recalculateTotalTokens')` — not a no-op

### Method Placement Verification

- [ ] Methods are public (no `private` or `protected` modifier)
- [ ] Methods are instance methods (not static)
- [ ] Methods are placed logically near related functionality (e.g., near compression-related methods)

### Backward Compatibility Verification

```bash
# Existing tests still pass (stubs should not affect existing behavior)
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# Only HistoryService.ts modified
git diff --name-only packages/core/src/services/history/
# Expected: HistoryService.ts only

# No new files created
git diff --name-only --diff-filter=A packages/core/src/services/history/
# Expected: empty
```

## Success Criteria

- TypeScript compilation passes
- All 3 method signatures correct
- Import path correct
- Stubs behave as specified (throws or empty return)
- All existing tests pass
- Plan and requirement markers present
- No new files (modification only)

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P06 to fix
3. Re-run P06a
