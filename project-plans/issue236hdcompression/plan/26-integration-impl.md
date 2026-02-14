# Phase 26: Integration — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P26`

## Prerequisites

- Required: Phase 25 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P25" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/integration-high-density.test.ts` (full integration tests)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

This phase fixes any remaining integration issues discovered by the P25 tests. If all P25 tests pass, this phase is minimal — just verification and any minor fixups.

### Integration Checklist (from dev-docs/PLAN.md)

- [ ] Identified all touch points with existing system
- [ ] Listed specific files that import/use the feature
- [ ] Identified old code to be replaced/removed (none — new feature)
- [ ] Planned migration path for existing data (none needed — opt-in)
- [ ] Created integration tests that verify end-to-end flow (P25)
- [ ] User can actually access the feature through existing CLI (`/set compression.strategy high-density`)

## Implementation Tasks

### Potential Fixup Areas

Based on integration testing, the following may need adjustment:

1. **Factory wiring**: If `getCompressionStrategy('high-density')` doesn't return the correct instance, fix the factory case in `compressionStrategyFactory.ts`.

2. **Settings flow**: If density settings don't flow correctly through ephemerals, fix the accessor wiring in the runtime context setup.

3. **Pipeline ordering**: If `ensureDensityOptimized()` doesn't execute at the correct point, fix the hook placement in `ensureCompressionBeforeSend()`.

4. **Type mismatches**: If `DensityConfig` fields don't match what `optimize()` expects, fix the config construction in `ensureDensityOptimized()`.

5. **Import resolution**: If any circular imports or missing exports exist, fix the module boundaries.

### Files Potentially Modified

- `packages/core/src/core/compression/compressionStrategyFactory.ts` — if factory case needs fixing
- `packages/core/src/core/geminiChat.ts` — if orchestration hooks need adjustment
- `packages/core/src/core/compression/types.ts` — if type mismatches found
- Any other files identified by failing integration tests

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P26
 * @requirement [relevant REQ-HD-* for the fix]
 */
```

## Verification Commands

### Automated Checks

```bash
# 1. ALL P25 integration tests pass (primary goal)
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: All pass, 0 failures

# 2. ALL previous HD tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: All pass

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Full test suite
npm run test -- --run
# Expected: All pass

# 5. Full verification cycle
npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass

# 6. Manual integration test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs successfully
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P25)
- [ ] No skipped phases (P25 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check ALL high-density files for remaining stubs
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|NotYetImplemented)" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  packages/core/src/core/compression/types.ts \
  packages/core/src/core/geminiChat.ts \
  2>/dev/null | grep -iv "test"
# Expected: No matches — all stubs should be replaced by now

# Check for cop-out implementations
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  2>/dev/null
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  packages/core/src/core/geminiChat.ts \
  2>/dev/null | grep -v ".test.ts"
# Expected: No matches in implementation code
```

### Semantic Verification Checklist (MANDATORY)

1. **Does the integration WORK end-to-end?**
   - [ ] `/set compression.strategy high-density` → strategy stored → factory resolves → optimize runs
   - [ ] Settings → ephemerals → DensityConfig → optimize(history, config) → result applied
   - [ ] History with prunable content → optimize prunes → token count drops
   - [ ] If still over threshold → compress runs → further reduction
   - [ ] If under threshold → compression skipped

2. **Are all integration points VERIFIED?**
   - [ ] Factory: `getCompressionStrategy('high-density')` returns correct instance
   - [ ] Settings: all 4 density settings accessible via ephemerals
   - [ ] Orchestration: optimize called before shouldCompress
   - [ ] HistoryService: applyDensityResult works with real history
   - [ ] Prompts: enriched sections present in compression prompt

3. **What's MISSING from integration?**
   - [ ] Any failing integration tests documented and addressed
   - [ ] Any type mismatches fixed
   - [ ] Any import issues resolved

#### Feature Actually Works

```bash
# Run all integration tests
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]

# Full verification cycle
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass
# Actual: [paste output]

# Manual test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs, no errors
# Actual: [paste output]
```

## Success Criteria

- ALL P25 integration tests pass
- ALL previous HD tests pass
- Full verification cycle passes
- Manual integration test passes
- No remaining stubs or NotYetImplemented in production code
- All integration points verified

## Failure Recovery

If this phase fails:
1. Revert specific fixup changes
2. Document what integration issue remains
3. Cannot proceed to Phase 27 until all integration tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P26.md`
Contents:
```markdown
Phase: P26
Completed: [timestamp]
Files Modified: [list any files fixed, or "none — all integration tests passed from P25"]
Integration Issues Found: [list, or "none"]
Integration Issues Fixed: [list, or "N/A"]
Tests Passing: All integration + all HD unit tests
Verification: [paste verification output]
```
