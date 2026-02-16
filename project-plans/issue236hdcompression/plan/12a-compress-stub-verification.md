# Phase 12a: HighDensityStrategy — Compress Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P12a`

## Purpose

Verify the compress sub-method stubs from P12 compile correctly, have proper signatures, pseudocode references are present, and optimize functionality is unaffected.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers include P12
grep -c "@plan.*HIGHDENSITY.P12" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 1

# 3. Requirement markers for REQ-HD-008
grep -c "@requirement.*REQ-HD-008" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 1

# 4. Pseudocode references for compress
grep -c "@pseudocode.*high-density-compress" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 4

# 5. No forbidden patterns (stubs are allowed NotYetImplemented)
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v "NotYetImplemented" | grep -v ".test."
# Expected: No matches
```

## Behavioral Verification

### Method Signature Verification

The verifier MUST read `HighDensityStrategy.ts` and confirm:

- [ ] `compress(context: CompressionContext): Promise<CompressionResult>` — async, correct types
- [ ] `private summarizeToolResponseBlocks(blocks: ContentBlock[]): ContentBlock[]` — correct input/output types
- [ ] `private buildToolSummaryText(response: ToolResponseBlock): string` — returns string summary
- [ ] `private truncateToTarget(history: IContent[], tailStartIndex: number, targetTokens: number, context: CompressionContext): IContent[]` — correct parameter types
- [ ] `private buildMetadata(originalCount: number, compressedCount: number, llmCallMade: boolean): CompressionResultMetadata` — correct return type

### Stub Behavior Verification

- [ ] `compress()` throws `Error('NotYetImplemented: compress')`
- [ ] `summarizeToolResponseBlocks()` throws `Error('NotYetImplemented: summarizeToolResponseBlocks')`
- [ ] `buildToolSummaryText()` throws `Error('NotYetImplemented: buildToolSummaryText')`
- [ ] `truncateToTarget()` throws `Error('NotYetImplemented: truncateToTarget')`
- [ ] `buildMetadata()` throws `Error('NotYetImplemented: buildMetadata')`

### Optimize Regression Verification

- [ ] `optimize()` is still fully implemented (NOT reverted to stub)
- [ ] `pruneReadWritePairs()` still implemented
- [ ] `deduplicateFileInclusions()` still implemented
- [ ] `pruneByRecency()` still implemented
- [ ] Constants still defined

```bash
# Optimize tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass, 0 failures

# Full suite passes
npm run test -- --run 2>&1 | tail -10
# Expected: All pass
```

### Import Verification

- [ ] Any new types needed for compress method signatures are imported (ContentBlock, ToolResponseBlock, CompressionResultMetadata)
- [ ] No circular imports introduced
- [ ] Existing imports preserved

## Success Criteria

- TypeScript compilation passes
- All 5 compress-related method stubs throw NotYetImplemented
- Method signatures match pseudocode contracts
- Pseudocode references point to high-density-compress.md
- ALL optimize tests still pass (no regression)
- Full test suite passes
- Plan and requirement markers present

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P12 to fix
3. Re-run P12a
