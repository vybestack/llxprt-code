# Phase 09a: HighDensityStrategy — Optimize Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P09a`

## Purpose

Verify the HighDensityStrategy class skeleton from P09 compiles correctly, has proper signatures, constants are defined, and existing functionality is unaffected.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers in HighDensityStrategy
grep -c "@plan.*HIGHDENSITY.P09" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 2

# 3. Requirement markers present
grep -c "@requirement.*REQ-HD" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 2

# 4. Pseudocode references present
grep -c "@pseudocode.*high-density" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 3

# 5. No forbidden patterns (stubs are allowed NotYetImplemented — that's the point)
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v "NotYetImplemented" | grep -v ".test."
# Expected: No matches

# 6. Exported from index.ts
grep "HighDensityStrategy" packages/core/src/core/compression/index.ts
# Expected: ≥ 1
```

## Behavioral Verification

### Class Shape Verification

The verifier MUST read `HighDensityStrategy.ts` and confirm:

- [ ] `class HighDensityStrategy implements CompressionStrategy` — implements the interface
- [ ] `readonly name = 'high-density' as const` — literal type
- [ ] `readonly requiresLLM = false` — not an LLM-based strategy
- [ ] `trigger: StrategyTrigger` with `mode: 'continuous'` and `defaultThreshold: 0.85`

### Method Signature Verification

- [ ] `optimize(history: readonly IContent[], config: DensityConfig): DensityResult` — synchronous, correct param/return types
- [ ] `compress(context: CompressionContext): Promise<CompressionResult>` — async, correct param/return types
- [ ] `private pruneReadWritePairs(history, config)` — private, returns `{ removals, replacements, prunedCount }`
- [ ] `private deduplicateFileInclusions(history, config, existingRemovals)` — private, accepts existingRemovals Set
- [ ] `private pruneByRecency(history, config, existingRemovals)` — private, accepts existingRemovals Set

### Stub Behavior Verification

- [ ] `optimize()` throws `Error('NotYetImplemented: optimize')`
- [ ] `compress()` throws `Error('NotYetImplemented: compress')`
- [ ] `pruneReadWritePairs()` throws `Error('NotYetImplemented: pruneReadWritePairs')`
- [ ] `deduplicateFileInclusions()` throws `Error('NotYetImplemented: deduplicateFileInclusions')`
- [ ] `pruneByRecency()` throws `Error('NotYetImplemented: pruneByRecency')`

### Constants Verification

- [ ] `READ_TOOLS` contains exactly: `read_file`, `read_line_range`, `read_many_files`, `ast_read_file`
- [ ] `WRITE_TOOLS` contains exactly: `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range`
- [ ] `PRUNED_POINTER` equals `'[Result pruned — re-run tool to retrieve]'`
- [ ] `FILE_INCLUSION_OPEN_REGEX` pattern matches `--- <filepath> ---`
- [ ] `FILE_INCLUSION_CLOSE` equals `'--- End of content ---'`

### Import Verification

- [ ] `import * as path from 'node:path'`
- [ ] `IContent` imported from correct relative path
- [ ] `CompressionStrategy`, `DensityResult`, `DensityConfig`, `StrategyTrigger` imported from `./types.js`
- [ ] `CompressionContext`, `CompressionResult` imported from `./types.js`
- [ ] No circular imports introduced

### Backward Compatibility Verification

```bash
# Existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# Only new file + index.ts modified
git diff --name-only packages/core/src/core/compression/
# Expected: HighDensityStrategy.ts (new), index.ts (modified)
```

## Success Criteria

- TypeScript compilation passes
- Class implements CompressionStrategy correctly
- All 5 method stubs throw NotYetImplemented
- All constants defined with correct values
- Import paths correct
- Exported from index.ts
- All existing tests pass
- Plan, requirement, and pseudocode markers present

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P09 to fix
3. Re-run P09a
