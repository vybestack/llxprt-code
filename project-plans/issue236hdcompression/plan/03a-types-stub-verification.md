# Phase 03a: Types Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P03a`

## Purpose

Verify the type stubs from P03 compile correctly, are properly shaped, and don't break existing functionality.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers in all modified files
grep -r "@plan.*HIGHDENSITY.P03" packages/core/src/core/compression/ | wc -l
# Expected: ≥ 4

# 3. All new types exported
grep "export.*StrategyTrigger" packages/core/src/core/compression/types.ts && echo "PASS" || echo "FAIL"
grep "export.*DensityResult" packages/core/src/core/compression/types.ts && echo "PASS" || echo "FAIL"
grep "export.*DensityResultMetadata" packages/core/src/core/compression/types.ts && echo "PASS" || echo "FAIL"
grep "export.*DensityConfig" packages/core/src/core/compression/types.ts && echo "PASS" || echo "FAIL"

# 4. high-density in tuple
grep "'high-density'" packages/core/src/core/compression/types.ts && echo "PASS" || echo "FAIL"

# 5. No forbidden patterns
grep -rn "TODO\|FIXME\|HACK" packages/core/src/core/compression/types.ts | grep -v test && echo "FAIL" || echo "PASS: clean"
```

## Behavioral Verification

### Type Shape Verification

The verifier MUST read `types.ts` and confirm:

- [ ] `StrategyTrigger` is a discriminated union with `mode: 'threshold'` and `mode: 'continuous'`, both having `defaultThreshold: number`
- [ ] `DensityResult` has exactly 3 fields: `removals` (readonly number[]), `replacements` (ReadonlyMap<number, IContent>), `metadata` (DensityResultMetadata)
- [ ] `DensityResultMetadata` has exactly 3 fields: `readWritePairsPruned`, `fileDeduplicationsPruned`, `recencyPruned` — all numbers
- [ ] `DensityConfig` has exactly 5 readonly fields: `readWritePruning` (boolean), `fileDedupe` (boolean), `recencyPruning` (boolean), `recencyRetention` (number), `workspaceRoot` (string)
- [ ] `CompressionStrategy` interface has `trigger: StrategyTrigger` as REQUIRED (not optional)
- [ ] `CompressionStrategy` interface has `optimize?` as OPTIONAL
- [ ] `optimize` signature matches: `(history: readonly IContent[], config: DensityConfig) => DensityResult`
- [ ] `COMPRESSION_STRATEGIES` tuple has exactly 4 entries: `'middle-out'`, `'top-down-truncation'`, `'one-shot'`, `'high-density'`

### Existing Strategy Verification

The verifier MUST read each strategy file and confirm:

- [ ] `MiddleOutStrategy.trigger` is `{ mode: 'threshold', defaultThreshold: 0.85 }`
- [ ] `TopDownTruncationStrategy.trigger` is `{ mode: 'threshold', defaultThreshold: 0.85 }`
- [ ] `OneShotStrategy.trigger` is `{ mode: 'threshold', defaultThreshold: 0.85 }`
- [ ] None of the three strategies implement `optimize()` — they remain threshold-only
- [ ] `compress()` method bodies are UNCHANGED in all three strategies

### Backward Compatibility Verification

```bash
# Existing compression tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All existing tests pass

# No new files created (only modifications in this phase)
git diff --name-only --diff-filter=A packages/core/src/core/compression/
# Expected: No new files (empty output)

# Only expected files modified
git diff --name-only packages/core/src/core/compression/
# Expected: types.ts, MiddleOutStrategy.ts, TopDownTruncationStrategy.ts, OneShotStrategy.ts
```

## Success Criteria

- TypeScript compilation passes
- All type shapes match specification exactly
- All 3 existing strategies have correct trigger value
- No existing strategy compress() behavior changed
- All existing tests pass
- Plan markers present in all modified files

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P03 to fix
3. Re-run P03a
