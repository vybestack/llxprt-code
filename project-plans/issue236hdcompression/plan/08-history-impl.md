# Phase 08: HistoryService Extensions — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P07" packages/core/src/services/history/__tests__/ | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/services/history/__tests__/density-history.test.ts`
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-003.1: applyDensityResult Method

**Full Text**: The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>` method that applies replacements and removals to the raw history array.
**Behavior**:
- GIVEN: A HistoryService with history entries
- WHEN: `applyDensityResult(result)` is called with a valid DensityResult
- THEN: Entries listed in `result.replacements` are swapped, entries listed in `result.removals` are spliced out, and tokens are recalculated
**Why This Matters**: This is the mutation boundary between the density optimization strategy and the history store. It validates inputs, applies changes in correct order, and ensures token consistency.

### REQ-HD-003.2: Replacement Before Removal

**Full Text**: `applyDensityResult()` shall apply replacements before removals, so that removal indices are stable during the replacement pass.
**Behavior**:
- GIVEN: A DensityResult with both replacements and removals
- WHEN: applyDensityResult executes
- THEN: Replacement pass uses direct index assignment (no length change), THEN removal pass uses splice in reverse order
**Why This Matters**: Replacements via `this.history[index] = replacement` don't change array length, so all indices remain valid. Removals via `splice()` shift subsequent indices, so they MUST happen after replacements.

### REQ-HD-003.3: Reverse-Order Removal

**Full Text**: `applyDensityResult()` shall apply removals in reverse index order (highest first), so that earlier indices remain stable during removal.
**Behavior**:
- GIVEN: Removals at indices [1, 3, 5]
- WHEN: Applied in reverse order (5, 3, 1)
- THEN: Each splice only affects indices AFTER the removed one, preserving earlier indices

### REQ-HD-001.6: DensityResult Conflict Invariant

**Full Text**: An index shall NOT appear in both `removals` and `replacements` within a single `DensityResult`. `applyDensityResult()` shall throw if this invariant is violated.
**Behavior**:
- GIVEN: A DensityResult where index N appears in both removals and replacements.keys()
- WHEN: `applyDensityResult()` validates the result
- THEN: Throws `CompressionStrategyError` with code `'DENSITY_CONFLICT'` BEFORE any mutations

### REQ-HD-001.7: DensityResult Index Bounds

**Full Text**: All indices in `removals` and `replacements` shall be within `[0, history.length)`. `applyDensityResult()` shall throw if any index is out of bounds.
**Behavior**:
- GIVEN: Any index < 0 or >= this.history.length in removals or replacements
- WHEN: `applyDensityResult()` validates
- THEN: Throws `CompressionStrategyError` with code `'DENSITY_INDEX_OUT_OF_BOUNDS'` BEFORE any mutations

### REQ-HD-003.4: Token Recalculation

**Full Text**: After applying removals and replacements, `applyDensityResult()` shall trigger a full token recalculation through the existing `tokenizerLock` promise chain.
**Behavior**:
- GIVEN: History mutated by apply
- WHEN: Mutation phase completes
- THEN: `await this.recalculateTotalTokens()` is called, serialized on tokenizerLock
**Why This Matters**: Incremental token tracking is invalid after bulk mutations. Full recalculation ensures accurate counts for shouldCompress().

### REQ-HD-003.5: getRawHistory Accessor

**Full Text**: The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]` method that returns a read-only typed view of the backing history array.
**Behavior**:
- GIVEN: A HistoryService with N entries in `this.history`
- WHEN: `getRawHistory()` is called
- THEN: Returns `this.history` cast to `readonly IContent[]` — no defensive copy, same array reference
**Why This Matters**: The density strategy's `optimize()` is synchronous and runs in the sequential pre-send window. A copy is wasteful and unnecessary. Readonly typing is the contract.

### REQ-HD-003.6: recalculateTotalTokens

**Full Text**: The `HistoryService` shall provide an async `recalculateTotalTokens()` method that re-estimates tokens for all entries in the history, running through the `tokenizerLock`.
**Behavior**:
- GIVEN: History with N entries and a stale totalTokens
- WHEN: `recalculateTotalTokens()` is awaited
- THEN: totalTokens is set to the sum of `estimateContentTokens()` for each entry; `tokensUpdated` event is emitted
**Why This Matters**: Must serialize on tokenizerLock to prevent races with pending incremental `updateTokenCount()` calls from concurrent `add()` operations.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/history/HistoryService.ts`
  - REPLACE stub `applyDensityResult()` with full implementation
  - REPLACE stub `getRawHistory()` with full implementation
  - REPLACE stub `recalculateTotalTokens()` with full implementation
  - UPDATE plan markers: `@plan:PLAN-20260211-HIGHDENSITY.P08`
  - RETAIN requirement markers: `@requirement:REQ-HD-003.1` through `REQ-HD-003.6`, `REQ-HD-001.6`, `REQ-HD-001.7`
  - RETAIN pseudocode references

### Implementation Mapping (Pseudocode → Code)

#### getRawHistory() — pseudocode lines 10–15

```
Line 10: METHOD getRawHistory(): READONLY ARRAY OF IContent
Line 15:   RETURN this.history AS READONLY ARRAY OF IContent
```

Implementation:
- Return `this.history` with readonly typing
- NO defensive copy (see pseudocode line 12–14 rationale: readonly typing is the contract, optimize() is synchronous in the sequential window)
- One-liner method

#### applyDensityResult() — pseudocode lines 20–82

Validation phase (lines 22–54):
```
Line 25-30: V1 — Duplicate removal detection via Set size comparison
Line 33-38: V2 — Conflict invariant (index in both removals and replacements.keys())
Line 41-46: V3 — Removal index bounds [0, history.length)
Line 49-54: V4 — Replacement index bounds [0, history.length)
```

All validation MUST happen BEFORE any mutation. If any check fails, throw `CompressionStrategyError` with the appropriate error code.

Mutation phase (lines 56–77):
```
Line 58-61: M1 — Apply replacements first (direct index assignment)
            FOR EACH [index, replacement] IN result.replacements
              this.history[index] = replacement
Line 63-70: M2 — Sort removals descending, M3 — splice in reverse order
            sortedRemovals = [...result.removals].sort((a, b) => b - a)
            FOR EACH index IN sortedRemovals
              this.history.splice(index, 1)
```

Token recalculation phase (lines 79–82):
```
Line 82: AWAIT this.recalculateTotalTokens()
```

#### recalculateTotalTokens() — pseudocode lines 90–120

```
Line 94:   Enqueue on tokenizerLock chain: this.tokenizerLock = this.tokenizerLock.then(async () => {
Line 95-96:   let newTotal = 0; const defaultModel = 'gpt-4.1'
Line 98-100:  FOR EACH entry IN this.history: newTotal += await this.estimateContentTokens(entry, defaultModel)
Line 103-104: Atomic swap: previousTotal = this.totalTokens; this.totalTokens = newTotal
Line 106-110: Debug log with previousTotal, newTotal, entryCount
Line 113-117: Emit 'tokensUpdated' event with getTotalTokens() (includes baseTokenOffset), addedTokens, contentId: null
Line 120:   RETURN this.tokenizerLock
```

Key implementation notes from pseudocode:
- Line 96: Default model `'gpt-4.1'` matches existing `updateTokenCount()` default (HistoryService.ts line ~304)
- Line 95–104: Accumulate into local `newTotal` variable, then assign atomically. Do NOT set `this.totalTokens = 0` first (see anti-pattern warning)
- Line 94: Chain on tokenizerLock, do NOT call outside the chain
- Line 114: `getTotalTokens()` includes `baseTokenOffset` — the event carries the offset-adjusted value
- Line 116: `contentId: null` because this is a full recalc, not a single-content update

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P08
 * @requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-001.6, REQ-HD-001.7
 * @pseudocode history-service.md lines 20-82
 */
async applyDensityResult(result: DensityResult): Promise<void> {
  // REAL implementation — validation, mutation, recalculation
}
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** make `getRawHistory()` return `[...this.history]` — no defensive copy needed
- **DO NOT** call `recalculateTotalTokens()` outside the tokenizerLock chain
- **DO NOT** use `this.totalTokens = 0` then add incrementally — use local accumulator, atomic swap
- **DO NOT** import from wrong path — use `../../core/compression/types.js` from services/history/
- **DO NOT** apply removals in ascending order — must be descending
- **DO NOT** skip validation — all three invariants (duplicates, conflicts, bounds) MUST be checked

## Verification Commands

### Automated Checks

```bash
# 1. ALL P07 tests pass
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: All pass, 0 failures

# 2. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 3. Full test suite passes
npm run test -- --run
# Expected: All pass

# 4. Plan markers updated to P08
grep -c "@plan.*HIGHDENSITY.P08" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 1

# 5. Pseudocode references present
grep -c "@pseudocode.*history-service" packages/core/src/services/history/HistoryService.ts
# Expected: ≥ 2
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P07)
- [ ] No skipped phases (P07 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/services/history/HistoryService.ts | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/services/history/HistoryService.ts | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations (stubs must be replaced)
grep -rn "NotYetImplemented" packages/core/src/services/history/HistoryService.ts
# Expected: 0 matches (all stubs replaced with real code)

# Check that getRawHistory does NOT return empty array anymore
grep -A3 "getRawHistory" packages/core/src/services/history/HistoryService.ts | grep "return \[\]"
# Expected: 0 matches (stub replaced)

# Check for empty returns in implementation
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/services/history/HistoryService.ts | grep -v ".test.ts"
# Expected: No matches in new density methods
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-003.1: `applyDensityResult()` applies both replacements and removals — verified by reading implementation
   - [ ] REQ-HD-003.2: Replacements happen BEFORE removals — verified by reading code order
   - [ ] REQ-HD-003.3: Removals happen in REVERSE order — verified by seeing `.sort((a, b) => b - a)` before splice loop
   - [ ] REQ-HD-001.6: Conflict check throws `DENSITY_CONFLICT` — verified by reading validation section
   - [ ] REQ-HD-001.7: Bounds check throws `DENSITY_INDEX_OUT_OF_BOUNDS` — verified for both removals and replacements
   - [ ] REQ-HD-003.4: Token recalculation happens after mutation — verified by seeing `await this.recalculateTotalTokens()` at end of method
   - [ ] REQ-HD-003.5: `getRawHistory()` returns `this.history` (not a copy) — verified by reading one-liner
   - [ ] REQ-HD-003.6: `recalculateTotalTokens()` chains on `tokenizerLock` — verified by seeing `this.tokenizerLock = this.tokenizerLock.then(...)`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB/NotYetImplemented)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
   - [ ] `getRawHistory()` returns `this.history`, not `[]`
   - [ ] `applyDensityResult()` has validation + mutation + recalculation, not just a throw
   - [ ] `recalculateTotalTokens()` iterates entries and sums tokens, not just a no-op

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing validation → conflict/bounds tests fail
   - [ ] Removing replacement logic → replacement tests fail
   - [ ] Removing reverse-sort → ordering tests fail
   - [ ] Removing recalculation → token tests fail
   - [ ] Returning `[]` from getRawHistory → raw history tests fail

4. **Is the feature REACHABLE by users?**
   - [ ] Methods are public on HistoryService
   - [ ] HistoryService is available in the runtime context
   - [ ] Will be called from `ensureDensityOptimized()` in the orchestrator (later phase)

5. **What's MISSING?**
   - [ ] The orchestrator call site (`ensureDensityOptimized()`) — not in this phase
   - [ ] The density strategy that produces DensityResults — not in this phase
   - [ ] Settings integration for DensityConfig — not in this phase

#### Feature Actually Works

```bash
# Manual verification: run the density-specific test suite
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]
```

#### Integration Points Verified

- [ ] `DensityResult` type imported correctly from `../../core/compression/types.js`
- [ ] `CompressionStrategyError` imported for validation throws
- [ ] `this.history` is the same array accessed by `add()`, `getCuratedHistory()`, `replaceHistory()`
- [ ] `this.tokenizerLock` is the same promise chain used by `updateTokenCount()`
- [ ] `this.estimateContentTokens()` is the same method used for incremental token updates
- [ ] `this.emit('tokensUpdated', ...)` matches the event shape expected by listeners

#### Edge Cases Verified

- [ ] Empty DensityResult (no removals, no replacements) — no-op, no error
- [ ] All entries removed — history becomes empty array
- [ ] Single removal — works correctly
- [ ] Single replacement — works correctly
- [ ] Negative index — rejected
- [ ] Index equal to history.length — rejected (must be < length)

## Success Criteria

- ALL P07 tests pass
- TypeScript compiles cleanly
- Full test suite passes
- Deferred implementation detection clean
- All semantic verification items checked
- No NotYetImplemented remaining in any of the 3 methods
- Pseudocode line references match implementation logic

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/services/history/HistoryService.ts`
2. Stubs from P06 will be restored
3. Cannot proceed to Phase 09 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P08.md`
Contents:
```markdown
Phase: P08
Completed: [timestamp]
Files Modified:
  - packages/core/src/services/history/HistoryService.ts [+N lines, -M lines]
Tests Passing: [all count from density-history.test.ts]
Verification: [paste verification output]

## Holistic Functionality Assessment
[Worker MUST fill this in — see Semantic Verification Checklist]

## Implementation Trace
- getRawHistory(): pseudocode lines 10-15 → [actual line range in HistoryService.ts]
- applyDensityResult(): pseudocode lines 20-82 → [actual line range]
- recalculateTotalTokens(): pseudocode lines 90-120 → [actual line range]
```
