# Phase 06: HistoryService Extensions — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P05" packages/core/src/core/compression/ | wc -l` → ≥ 4
- Expected files from previous phase:
  - `packages/core/src/core/compression/types.ts` (DensityResult, CompressionStrategyError defined)
  - `packages/core/src/core/compression/index.ts` (exports present)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-003.1: applyDensityResult Method

**Full Text**: The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>` method that applies replacements and removals to the raw history array.
**Behavior**:
- GIVEN: A HistoryService instance with populated history
- WHEN: `applyDensityResult(result)` is called
- THEN: Replacements and removals are applied to `this.history`, and tokens are recalculated
**Why This Matters**: The density optimization pipeline needs a safe, validated way to mutate history entries. Without this method, the orchestrator would need to manipulate history directly, bypassing validation and token recalculation.

### REQ-HD-003.2: Replacement Before Removal

**Full Text**: `applyDensityResult()` shall apply replacements before removals, so that removal indices are stable during the replacement pass.
**Behavior**:
- GIVEN: A DensityResult with both replacements and removals
- WHEN: `applyDensityResult()` is called
- THEN: Replacements are applied first (array length unchanged), then removals (array shrinks)
**Why This Matters**: If removals happened first, replacement indices would be invalidated by the index shifts from splice operations.

### REQ-HD-003.3: Reverse-Order Removal

**Full Text**: `applyDensityResult()` shall apply removals in reverse index order (highest first), so that earlier indices remain stable during removal.
**Behavior**:
- GIVEN: Removals at indices [2, 5, 8] in a 10-element history
- WHEN: `applyDensityResult()` applies removals
- THEN: Index 8 is removed first, then 5, then 2 — each splice leaves earlier indices unchanged
**Why This Matters**: Forward-order removal causes index drift — removing index 2 shifts index 5 to 4, producing incorrect results.

### REQ-HD-003.4: Token Recalculation

**Full Text**: After applying removals and replacements, `applyDensityResult()` shall trigger a full token recalculation through the existing `tokenizerLock` promise chain.
**Behavior**:
- GIVEN: History modified by applyDensityResult
- WHEN: Mutations are complete
- THEN: `recalculateTotalTokens()` is awaited, and `tokensUpdated` event is emitted
**Why This Matters**: The orchestrator's `shouldCompress()` check depends on accurate token counts. Stale counts after density optimization would cause incorrect compression decisions.

### REQ-HD-003.5: getRawHistory Accessor

**Full Text**: The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]` method that returns a read-only typed view of the backing history array.
**Behavior**:
- GIVEN: A HistoryService instance with history entries
- WHEN: `getRawHistory()` is called
- THEN: Returns `this.history` with readonly typing (no defensive copy)
**Why This Matters**: The `optimize()` method needs direct access to the raw history array (not the curated view from `getCuratedHistory()` which filters empty AI messages). Read-only typing prevents accidental mutation.

### REQ-HD-003.6: recalculateTotalTokens

**Full Text**: The `HistoryService` shall provide an async `recalculateTotalTokens()` method that re-estimates tokens for all entries in the history, running through the `tokenizerLock`.
**Behavior**:
- GIVEN: History entries with possibly stale token counts
- WHEN: `recalculateTotalTokens()` is called
- THEN: All entries are re-estimated and `totalTokens` is updated atomically through the tokenizerLock chain
**Why This Matters**: After density operations mutate history (removing/replacing entries), the running token total is invalid. A full recalculation is needed before the threshold check.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/history/HistoryService.ts`
  - ADD import: `DensityResult` from `'../../core/compression/types.js'`
  - ADD method stub: `applyDensityResult(result: DensityResult): Promise<void>` — throws `new Error('NotYetImplemented: applyDensityResult')`
  - ADD method stub: `getRawHistory(): readonly IContent[]` — returns `[]` (empty array stub)
  - ADD method stub: `recalculateTotalTokens(): Promise<void>` — throws `new Error('NotYetImplemented: recalculateTotalTokens')`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P06`
  - MUST include: `@requirement:REQ-HD-003.1, REQ-HD-003.5, REQ-HD-003.6`
  - MUST include: `@pseudocode history-service.md lines 10-15, 20-82, 90-120`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P06
 * @requirement REQ-HD-003.1
 * @pseudocode history-service.md lines 20-82
 */
async applyDensityResult(result: DensityResult): Promise<void> {
  throw new Error('NotYetImplemented: applyDensityResult');
}
```

### Stub Rules

- `applyDensityResult()` — throws NotYetImplemented. This is a mutation method with complex validation; it cannot be a trivial stub.
- `getRawHistory()` — returns `[]` (empty array). This is the simplest safe stub for a method returning `readonly IContent[]`. The real implementation returns `this.history`.
- `recalculateTotalTokens()` — throws NotYetImplemented. This enqueues work on the tokenizerLock; a no-op stub would silently skip token recalculation.
- The `DensityResult` import must be from the correct relative path (`../../core/compression/types.js`)
- NO implementation logic in this phase — just method signatures and throws/returns

## Verification Commands

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. New methods exist
grep -n "applyDensityResult" packages/core/src/services/history/HistoryService.ts
# Expected: at least 1 match (method signature)

grep -n "getRawHistory" packages/core/src/services/history/HistoryService.ts
# Expected: at least 1 match

grep -n "recalculateTotalTokens" packages/core/src/services/history/HistoryService.ts
# Expected: at least 1 match

# 3. Import exists
grep "DensityResult" packages/core/src/services/history/HistoryService.ts
# Expected: import line present

# 4. Plan markers present
grep -c "@plan.*HIGHDENSITY.P06" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 1

# 5. Stubs are proper stubs (throws or empty return)
grep -A2 "applyDensityResult" packages/core/src/services/history/HistoryService.ts | grep "NotYetImplemented"
# Expected: 1 match

grep -A2 "recalculateTotalTokens" packages/core/src/services/history/HistoryService.ts | grep "NotYetImplemented"
# Expected: 1 match

# 6. Existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass
```

## Success Criteria

- `npx tsc --noEmit` passes with 0 errors
- All 3 new method stubs exist in HistoryService.ts
- `DensityResult` import present
- `@plan:PLAN-20260211-HIGHDENSITY.P06` markers present
- `applyDensityResult` and `recalculateTotalTokens` throw NotYetImplemented
- `getRawHistory` returns empty array
- Existing tests pass unchanged

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/services/history/HistoryService.ts`
2. Cannot proceed to Phase 07 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P06.md`
Contents:
```markdown
Phase: P06
Completed: [timestamp]
Files Modified:
  - packages/core/src/services/history/HistoryService.ts [+N lines]
Tests Added: 0 (stub phase)
Verification: [paste verification output]
```
