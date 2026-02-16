# Phase 18: Orchestration — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P18`

## Prerequisites

- Required: Phase 17 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P17" packages/core/src/core/compression/compressionStrategyFactory.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/compressionStrategyFactory.ts` (high-density case implemented)
  - `packages/core/src/core/compression/__tests__/high-density-settings.test.ts` (all passing)
  - All previous HD test files passing
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.
**Behavior**:
- GIVEN: `ensureCompressionBeforeSend()` is executing
- WHEN: Token updates are settled
- THEN: `ensureDensityOptimized()` is called before `shouldCompress()`
**Why This Matters**: Density optimization runs first, potentially freeing enough tokens to avoid full compression entirely.

### REQ-HD-002.2: Conditional Optimization

**Full Text**: If the resolved strategy does not implement `optimize`, then the density optimization step shall be skipped.
**Behavior**:
- GIVEN: Active strategy is `'middle-out'` (no `optimize` method)
- WHEN: `ensureDensityOptimized()` runs
- THEN: Returns immediately without modifying history
**Why This Matters**: Existing strategies don't have density optimization; the hook must be safe for all strategies.

### REQ-HD-002.3: No-Op When Clean

**Full Text**: If the density dirty flag is `false` (no new content added since last optimization), then the density optimization step shall be skipped.
**Behavior**:
- GIVEN: `densityDirty === false`
- WHEN: `ensureDensityOptimized()` is called
- THEN: Returns immediately without calling `optimize()`
**Why This Matters**: Avoids unnecessary async work on every send when nothing has changed.

### REQ-HD-002.4: DensityResult Application

**Full Text**: When `optimize()` returns a `DensityResult` with non-empty removals or replacements, the system shall call `historyService.applyDensityResult()` and await token recalculation before proceeding to the threshold check.
**Behavior**:
- GIVEN: `optimize()` returns removals=[2,4] and replacements={1: ...}
- WHEN: Processing the result
- THEN: `applyDensityResult()` is called, then `waitForTokenUpdates()` completes
**Why This Matters**: History must be updated and tokens recounted before the threshold check.

### REQ-HD-002.5: Empty Result Short-Circuit

**Full Text**: When `optimize()` returns a `DensityResult` with zero removals and zero replacements, the system shall not call `applyDensityResult()`.
**Behavior**:
- GIVEN: `optimize()` returns `{ removals: [], replacements: new Map(), metadata: ... }`
- WHEN: Processing the result
- THEN: `applyDensityResult()` is NOT called; method returns
**Why This Matters**: Avoids unnecessary async work when optimization produces no changes.

### REQ-HD-002.6: Dirty Flag Set On Content Add

**Full Text**: The density dirty flag shall be set to `true` when new content is added to history via the turn loop (user messages, AI responses, tool results). It shall NOT be set by compression or density-internal token recalculation.
**Behavior**:
- GIVEN: A new user message is added to history
- WHEN: `historyService.add()` is called in the turn loop
- THEN: `densityDirty` becomes `true`
**Why This Matters**: The flag tracks whether new content exists that density optimization hasn't seen.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization

**Full Text**: The density dirty flag shall be set to `false` after `ensureDensityOptimized()` completes, regardless of whether optimization produced changes.
**Behavior**:
- GIVEN: `ensureDensityOptimized()` runs (with or without producing changes)
- WHEN: The method completes (in the `finally` block)
- THEN: `densityDirty === false`
**Why This Matters**: Prevents redundant optimization on the next send.

### REQ-HD-002.8: Emergency Path Optimization

**Full Text**: The emergency compression path (projected tokens exceed hard context limit) shall also call the density optimization step before attempting compression.
**Behavior**:
- GIVEN: `enforceContextWindow()` detects projected tokens exceed the limit
- WHEN: Attempting to free space
- THEN: `ensureDensityOptimized()` is called before `performCompression()`
**Why This Matters**: Density optimization may free enough space to avoid full compression.

### REQ-HD-002.9: Raw History Input

**Full Text**: The `optimize()` method shall receive the raw history array (via `getRawHistory()`), not the curated view.
**Behavior**:
- GIVEN: `ensureDensityOptimized()` calls `optimize()`
- WHEN: Building the call arguments
- THEN: `this.historyService.getRawHistory()` is used, not `getCurated()`
**Why This Matters**: Density optimization needs to see all entries including system messages to correctly index removals/replacements.

### REQ-HD-002.10: Sequential Turn-Loop Safety

**Full Text**: The `ensureDensityOptimized()` method shall only be called from the sequential pre-send window (within `ensureCompressionBeforeSend`), where no concurrent `historyService.add()` calls occur.
**Behavior**:
- GIVEN: The method is called within the pre-send window
- WHEN: It runs
- THEN: No concurrent add() calls modify history during optimization
**Why This Matters**: History mutations during optimization would invalidate indices.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/geminiChat.ts`
  - ADD private field: `private densityDirty: boolean = true;`
  - ADD stub method: `private async ensureDensityOptimized(): Promise<void>` that returns immediately
  - ADD `this.densityDirty = true;` at turn-loop content add sites (STUB: add comments marking where these go, but DO NOT set the flag yet — the stub method is a no-op so the flag doesn't matter)
  - ADD hook point in `ensureCompressionBeforeSend()`: call `await this.ensureDensityOptimized();` after `waitForTokenUpdates()` and before `shouldCompress()`
  - ADD hook point in `enforceContextWindow()`: call `await this.ensureDensityOptimized();` before `performCompression()`
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P18`
  - Implements: `@requirement:REQ-HD-002.1` through `REQ-HD-002.10`

### Stub Outline

```typescript
/**
 * Density dirty flag — tracks whether new content has been added since last optimization.
 * @plan PLAN-20260211-HIGHDENSITY.P18
 * @requirement REQ-HD-002.6, REQ-HD-002.7
 */
private densityDirty: boolean = true;

/**
 * Run density optimization if the active strategy supports it and new content exists.
 * @plan PLAN-20260211-HIGHDENSITY.P18
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4, REQ-HD-002.5, REQ-HD-002.7
 * @pseudocode orchestration.md lines 50-99
 */
private async ensureDensityOptimized(): Promise<void> {
  // Stub: no-op. Full implementation in P20.
  return;
}
```

### Hook Points

#### In ensureCompressionBeforeSend() (line ~1791):

```typescript
// After: await this.historyService.waitForTokenUpdates();
// BEFORE: if (this.shouldCompress(pendingTokens)) {

// @plan PLAN-20260211-HIGHDENSITY.P18
// @requirement REQ-HD-002.1
await this.ensureDensityOptimized();
```

#### In enforceContextWindow() (line ~1980):

```typescript
// After the "attempting compression" warning log
// BEFORE: await this.performCompression(promptId);

// @plan PLAN-20260211-HIGHDENSITY.P18
// @requirement REQ-HD-002.8
await this.ensureDensityOptimized();
await this.historyService.waitForTokenUpdates();

// Re-check after optimization — may have freed enough space
const postOptProjected =
  this.getEffectiveTokenCount() +
  Math.max(0, pendingTokens) +
  completionBudget;

if (postOptProjected <= marginAdjustedLimit) {
  this.logger.debug(
    () => '[GeminiChat] Density optimization reduced tokens below limit',
    { postOptProjected, marginAdjustedLimit },
  );
  return;
}
```

### Stub Rules

- `ensureDensityOptimized()` — returns immediately (no-op stub). Safe for all strategies.
- `densityDirty` field — added but NOT set anywhere yet (the stub method ignores it)
- Hook points in `ensureCompressionBeforeSend` and `enforceContextWindow` — ACTUALLY WIRED (calling the no-op stub is safe)
- NO changes to `performCompression()`, `shouldCompress()`, or history add paths
- The emergency path re-check logic in enforceContextWindow IS added in this phase since it's structural (the no-op stub makes it a no-op, but the control flow is wired)

## Verification Commands

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. densityDirty field exists
grep -c "densityDirty" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2 (field declaration + method reference)

# 3. ensureDensityOptimized method exists
grep -c "ensureDensityOptimized" packages/core/src/core/geminiChat.ts
# Expected: ≥ 3 (declaration + 2 call sites)

# 4. Hook in ensureCompressionBeforeSend
grep -A5 "waitForTokenUpdates" packages/core/src/core/geminiChat.ts | grep "ensureDensityOptimized"
# Expected: 1 match

# 5. Hook in enforceContextWindow
grep -B2 -A2 "ensureDensityOptimized" packages/core/src/core/geminiChat.ts | grep -c "enforceContextWindow\|postOptProjected\|ensureDensityOptimized"
# Expected: ≥ 1

# 6. Plan markers
grep -c "@plan.*HIGHDENSITY.P18" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2

# 7. Existing tests still pass (stub is no-op, so all behavior unchanged)
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# 8. Typecheck
npm run typecheck
# Expected: 0 errors
```

## Success Criteria

- TypeScript compiles cleanly
- `densityDirty` field declared on GeminiChat
- `ensureDensityOptimized()` method exists as no-op stub
- Hook wired in `ensureCompressionBeforeSend()` (after waitForTokenUpdates, before shouldCompress)
- Hook wired in `enforceContextWindow()` (before performCompression, with re-check logic)
- ALL existing tests pass (no regression — stub is a no-op)
- Plan markers reference P18
- No changes to existing compression/history behavior

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/geminiChat.ts`
2. Orchestration unchanged
3. Cannot proceed to Phase 19 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P18.md`
Contents:
```markdown
Phase: P18
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/geminiChat.ts [+N lines]
Tests Added: 0 (stub phase — no-op method)
Verification: [paste verification output]
```
