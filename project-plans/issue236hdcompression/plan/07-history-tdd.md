# Phase 07: HistoryService Extensions — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P06" packages/core/src/services/history/ | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/services/history/HistoryService.ts` (modified with 3 stub methods)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-003.1: applyDensityResult Method

**Full Text**: The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>` method that applies replacements and removals to the raw history array.
**Behavior**:
- GIVEN: A HistoryService with history entries at indices [0, 1, 2, 3, 4]
- WHEN: `applyDensityResult({ removals: [1, 3], replacements: new Map([[2, newContent]]), metadata })` is called
- THEN: Entry at index 2 is replaced, entries at indices 3 and 1 are removed (reverse order), and tokens are recalculated
**Why This Matters**: The density optimization pipeline produces surgical edits as index-based removals and replacements. This method is the safe boundary between strategy output and history mutation.

### REQ-HD-003.2: Replacement Before Removal

**Full Text**: `applyDensityResult()` shall apply replacements before removals, so that removal indices are stable during the replacement pass.
**Behavior**:
- GIVEN: A DensityResult with replacement at index 2 AND removal at index 4
- WHEN: `applyDensityResult()` executes
- THEN: Index 2 is replaced first (array length unchanged), then index 4 is removed
**Why This Matters**: Replacements use direct index assignment (`history[i] = x`) which doesn't change array length. Removals use splice which shifts subsequent indices. Replacement-first keeps all indices valid.

### REQ-HD-003.3: Reverse-Order Removal

**Full Text**: `applyDensityResult()` shall apply removals in reverse index order (highest first), so that earlier indices remain stable during removal.
**Behavior**:
- GIVEN: Removals at indices [1, 3, 5] in a 7-element history
- WHEN: Removals are applied
- THEN: Index 5 removed first, then 3, then 1 — resulting history has entries [0, 2, 4, 6]
**Why This Matters**: Forward-order splice shifts indices: removing index 1 makes what was at index 3 now at index 2. Reverse-order avoids this corruption.

### REQ-HD-001.6: DensityResult Conflict Invariant

**Full Text**: An index shall NOT appear in both `removals` and `replacements` within a single `DensityResult`. `applyDensityResult()` shall throw if this invariant is violated.
**Behavior**:
- GIVEN: A DensityResult where index 3 is in both removals and replacements
- WHEN: `applyDensityResult()` is called
- THEN: Throws `CompressionStrategyError` with code `'DENSITY_CONFLICT'`
**Why This Matters**: A conflicting result means the strategy has a bug — you can't both replace and remove the same entry. Failing fast prevents data corruption.

### REQ-HD-001.7: DensityResult Index Bounds

**Full Text**: All indices in `removals` and `replacements` shall be within `[0, history.length)`. `applyDensityResult()` shall throw if any index is out of bounds.
**Behavior**:
- GIVEN: A 5-element history and a DensityResult with removal at index 7
- WHEN: `applyDensityResult()` is called
- THEN: Throws `CompressionStrategyError` with code `'DENSITY_INDEX_OUT_OF_BOUNDS'`
**Why This Matters**: Out-of-bounds indices indicate a stale result or strategy bug. Applying them would either no-op or corrupt history.

### REQ-HD-003.4: Token Recalculation

**Full Text**: After applying removals and replacements, `applyDensityResult()` shall trigger a full token recalculation through the existing `tokenizerLock` promise chain.
**Behavior**:
- GIVEN: A HistoryService that has had entries removed
- WHEN: `applyDensityResult()` completes
- THEN: `totalTokens` reflects the actual token count of remaining entries

### REQ-HD-003.5: getRawHistory Accessor

**Full Text**: The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]` method that returns a read-only typed view of the backing history array.
**Behavior**:
- GIVEN: A HistoryService with 5 history entries
- WHEN: `getRawHistory()` is called
- THEN: Returns an array of length 5 containing the exact entries (same references)
**Why This Matters**: The optimize() method needs the raw array, not the curated view which filters empty AI messages. Readonly typing prevents accidental mutation.

### REQ-HD-003.6: recalculateTotalTokens

**Full Text**: The `HistoryService` shall provide an async `recalculateTotalTokens()` method that re-estimates tokens for all entries in the history, running through the `tokenizerLock`.
**Behavior**:
- GIVEN: A HistoryService with history entries and a stale totalTokens value
- WHEN: `recalculateTotalTokens()` is awaited
- THEN: `totalTokens` is updated to reflect actual token estimates for all entries
**Why This Matters**: After density operations mutate history, the incremental token total is invalid. Full recalculation must happen through the tokenizerLock to serialize with pending incremental updates.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/history/__tests__/density-history.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P07`
  - MUST include: `@requirement:REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-003.4, REQ-HD-003.5, REQ-HD-003.6, REQ-HD-001.6, REQ-HD-001.7`

### Test Cases (Behavioral — NOT mock theater)

All tests operate on a REAL HistoryService instance. The HistoryService is constructed with its real dependencies (logger, event emitter). History entries are added via `add()` before exercising the density methods. Token estimation may require a minimal setup — use the real `estimateContentTokens` if feasible, or provide a lightweight tokenizer that counts words. Do NOT mock HistoryService methods.

#### applyDensityResult — Ordering Tests

1. **`applyDensityResult applies replacements before removals`** `@requirement:REQ-HD-003.2`
   - GIVEN: History [A, B, C, D, E], replacement at index 1 (B→B'), removal at index 3 (D)
   - WHEN: `applyDensityResult()` is called
   - THEN: Result is [A, B', C, E] — B was replaced while indices were stable, D was removed after
   - Pseudocode ref: history-service.md lines 58–70

2. **`applyDensityResult removes in reverse index order`** `@requirement:REQ-HD-003.3`
   - GIVEN: History [A, B, C, D, E], removals at [1, 3]
   - WHEN: `applyDensityResult()` is called
   - THEN: Result is [A, C, E] — index 3 removed first, then index 1
   - Pseudocode ref: history-service.md lines 63–70

3. **`applyDensityResult handles removals-only (no replacements)`**
   - GIVEN: History [A, B, C], removals at [0, 2], no replacements
   - WHEN: `applyDensityResult()` is called
   - THEN: Result is [B]

4. **`applyDensityResult handles replacements-only (no removals)`**
   - GIVEN: History [A, B, C], replacement at index 1 (B→B'), no removals
   - WHEN: `applyDensityResult()` is called
   - THEN: Result is [A, B', C]

5. **`applyDensityResult handles empty result (no-op)`**
   - GIVEN: History [A, B, C], empty removals, empty replacements
   - WHEN: `applyDensityResult()` is called
   - THEN: History unchanged, still [A, B, C]

#### applyDensityResult — Validation Tests

6. **`applyDensityResult rejects conflicting index in removals and replacements`** `@requirement:REQ-HD-001.6`
   - GIVEN: Index 2 in both removals and replacements
   - WHEN: `applyDensityResult()` is called
   - THEN: Throws with code `'DENSITY_CONFLICT'`
   - Pseudocode ref: history-service.md lines 33–38

7. **`applyDensityResult rejects removal index out of bounds`** `@requirement:REQ-HD-001.7`
   - GIVEN: History length 3, removal at index 5
   - WHEN: `applyDensityResult()` is called
   - THEN: Throws with code `'DENSITY_INDEX_OUT_OF_BOUNDS'`
   - Pseudocode ref: history-service.md lines 41–46

8. **`applyDensityResult rejects replacement index out of bounds`** `@requirement:REQ-HD-001.7`
   - GIVEN: History length 3, replacement at index 10
   - WHEN: `applyDensityResult()` is called
   - THEN: Throws with code `'DENSITY_INDEX_OUT_OF_BOUNDS'`
   - Pseudocode ref: history-service.md lines 49–54

9. **`applyDensityResult rejects negative removal index`** `@requirement:REQ-HD-001.7`
   - GIVEN: Removal at index -1
   - WHEN: `applyDensityResult()` is called
   - THEN: Throws with code `'DENSITY_INDEX_OUT_OF_BOUNDS'`

10. **`applyDensityResult rejects duplicate removal indices`**
    - GIVEN: Removals at [2, 2]
    - WHEN: `applyDensityResult()` is called
    - THEN: Throws (duplicate would cause double-splice corruption)
    - Pseudocode ref: history-service.md lines 25–30

#### applyDensityResult — Token Recalculation Tests

11. **`applyDensityResult triggers token recalculation after mutation`** `@requirement:REQ-HD-003.4`
    - GIVEN: History with known token estimates
    - WHEN: Entries are removed via `applyDensityResult()`
    - THEN: After awaiting, `getTotalTokens()` reflects the reduced set (not the old total)
    - Pseudocode ref: history-service.md lines 81–82

#### getRawHistory Tests

12. **`getRawHistory returns the raw history array`** `@requirement:REQ-HD-003.5`
    - GIVEN: A HistoryService with 3 entries added via `add()`
    - WHEN: `getRawHistory()` is called
    - THEN: Returns array of length 3 containing all entries (including empty AI messages that `getCuratedHistory` would filter)
    - Pseudocode ref: history-service.md lines 10–15

13. **`getRawHistory returns entries that getCuratedHistory filters`** `@requirement:REQ-HD-003.5`
    - GIVEN: History containing an AI message with no valid content (empty blocks)
    - WHEN: `getRawHistory()` is called
    - THEN: The empty AI message IS present in the raw array
    - AND: `getCuratedHistory()` does NOT include it
    - This proves getRawHistory returns the unfiltered view

14. **`getRawHistory returns empty array for empty history`**
    - GIVEN: A fresh HistoryService with no entries
    - WHEN: `getRawHistory()` is called
    - THEN: Returns empty array

#### recalculateTotalTokens Tests

15. **`recalculateTotalTokens updates totalTokens for current entries`** `@requirement:REQ-HD-003.6`
    - GIVEN: A HistoryService with entries added
    - WHEN: `recalculateTotalTokens()` is awaited
    - THEN: `getTotalTokens()` returns a value reflecting token estimates for all entries
    - Pseudocode ref: history-service.md lines 90–120

16. **`recalculateTotalTokens serializes through tokenizerLock`** `@requirement:REQ-HD-003.6`
    - GIVEN: A HistoryService with pending token operations on the lock
    - WHEN: `recalculateTotalTokens()` is called
    - THEN: The recalculation completes after pending operations (does not race)
    - Pseudocode ref: history-service.md lines 94–118

#### Property-Based Tests (≥ 30% of total)

17. **`applyDensityResult: history length after removal equals original minus removal count`**
    - Property: For any valid set of removal indices within bounds, `history.length` after apply equals `originalLength - removals.length`

18. **`applyDensityResult: non-removed non-replaced entries are unchanged`**
    - Property: For any valid DensityResult, entries at indices NOT in removals or replacements retain their original content (same reference)

19. **`applyDensityResult: replaced entries match the replacement content`**
    - Property: For any valid replacements map, after apply, each replaced index contains the replacement content

20. **`applyDensityResult: all conflict/bounds combinations are caught`**
    - Property: For any index that appears in both removals and replacements, the method throws (never silently applies)

21. **`getRawHistory length equals number of add() calls`**
    - Property: For any sequence of N add() calls with valid content, `getRawHistory().length` equals N

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P07
 * @requirement REQ-HD-003.1, REQ-HD-003.2
 * @pseudocode history-service.md lines 58-70
 */
it('applyDensityResult applies replacements before removals', async () => { ... });
```

## Verification Commands

```bash
# 1. Test file exists
test -f packages/core/src/services/history/__tests__/density-history.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/services/history/__tests__/density-history.test.ts)
[ "$count" -ge 16 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers present
grep -c "@plan.*HIGHDENSITY.P07" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: ≥ 1

# 4. Requirement markers present
grep -c "@requirement.*REQ-HD-003" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: ≥ 5

# 5. Pseudocode references present
grep -c "@pseudocode.*history-service" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: ≥ 3

# 6. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: 0

# 7. No reverse testing (expecting NotYetImplemented)
grep -c "NotYetImplemented" packages/core/src/services/history/__tests__/density-history.test.ts
# Expected: 0

# 8. Property-based tests present
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/services/history/__tests__/density-history.test.ts)
total=$(grep -c "it(" packages/core/src/services/history/__tests__/density-history.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: ratio ≥ 0.30

# 9. Tests run but FAIL (stubs throw NotYetImplemented)
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1 | tail -15
# Expected: Tests exist but most fail (stubs are not implemented yet)

# 10. Tests fail with meaningful errors, not "cannot find module" or compile errors
npm run test -- --run packages/core/src/services/history/__tests__/density-history.test.ts 2>&1 | grep -c "FAIL\|Error"
# Expected: ≥ 1 (test failures, not infrastructure errors)
```

## Success Criteria

- Test file created with ≥ 16 behavioral test cases
- ≥ 30% property-based tests
- No mock theater (no `toHaveBeenCalled`)
- No reverse testing (no `NotYetImplemented` expectations)
- Tests compile and run (failures are from stubs, not infrastructure)
- Tests fail with "NotYetImplemented" or similar (proving stubs exist but aren't implemented)
- Plan, requirement, and pseudocode markers present
- No modifications to production code (tests only)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/services/history/__tests__/density-history.test.ts`
2. Re-run Phase 07 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P07.md`
Contents:
```markdown
Phase: P07
Completed: [timestamp]
Files Created: packages/core/src/services/history/__tests__/density-history.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count]
Tests Failing: [count] (expected — stubs not implemented)
Verification: [paste verification output]
```
