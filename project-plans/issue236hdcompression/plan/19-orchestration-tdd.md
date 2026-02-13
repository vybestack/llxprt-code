# Phase 19: Orchestration — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P19`

## Prerequisites

- Required: Phase 18 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P18" packages/core/src/core/geminiChat.ts | wc -l` → ≥ 2
- Expected files from previous phase:
  - `packages/core/src/core/geminiChat.ts` (densityDirty field, ensureDensityOptimized stub, hook points wired)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.
**Behavior**:
- GIVEN: History with content that density optimization can prune
- WHEN: `ensureCompressionBeforeSend()` runs
- THEN: Token count is lower after the density step, before the threshold check
**Why This Matters**: Density optimization reduces tokens, potentially avoiding expensive full compression.

### REQ-HD-002.2: Conditional Optimization

**Full Text**: If the resolved strategy does not implement `optimize`, then the density optimization step shall be skipped.
**Behavior**:
- GIVEN: Active strategy is `'middle-out'` (no optimize method)
- WHEN: `ensureDensityOptimized()` runs
- THEN: History is unchanged; no errors
**Why This Matters**: Must be backward-compatible with existing strategies.

### REQ-HD-002.3: No-Op When Clean

**Full Text**: If the density dirty flag is `false`, the density optimization step shall be skipped.
**Behavior**:
- GIVEN: `densityDirty === false`
- WHEN: `ensureDensityOptimized()` runs
- THEN: Returns without calling optimize or modifying history
**Why This Matters**: Avoids redundant optimization work.

### REQ-HD-002.4: DensityResult Application

**Full Text**: When `optimize()` returns a `DensityResult` with non-empty removals or replacements, the system shall call `historyService.applyDensityResult()` and await token recalculation.
**Behavior**:
- GIVEN: optimize() returns removals=[2] and replacements={1: newContent}
- WHEN: ensureDensityOptimized() processes the result
- THEN: applyDensityResult is called, tokens are recalculated
**Why This Matters**: The density result must be applied for the threshold check to see reduced tokens.

### REQ-HD-002.5: Empty Result Short-Circuit

**Full Text**: When `optimize()` returns zero removals and zero replacements, `applyDensityResult()` shall not be called.
**Behavior**:
- GIVEN: optimize() returns `{ removals: [], replacements: new Map(), metadata: ... }`
- WHEN: Processing result
- THEN: applyDensityResult is NOT called; no async work
**Why This Matters**: Avoids unnecessary token recalculation.

### REQ-HD-002.6: Dirty Flag Set On Content Add

**Full Text**: The density dirty flag shall be set to `true` when new content is added to history via the turn loop. Not set by compression or density-internal operations.
**Behavior**:
- GIVEN: A new user message is added to history
- WHEN: The turn loop calls add()
- THEN: densityDirty is true
**Why This Matters**: The flag drives the optimization gate.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization

**Full Text**: The density dirty flag shall be set to `false` after `ensureDensityOptimized()` completes, in the `finally` block.
**Behavior**:
- GIVEN: ensureDensityOptimized() runs (success or error)
- WHEN: Method completes
- THEN: densityDirty is false
**Why This Matters**: Prevents redundant optimization on the next send.

### REQ-HD-002.8: Emergency Path Optimization

**Full Text**: The emergency compression path shall also call density optimization before attempting compression.
**Behavior**:
- GIVEN: enforceContextWindow() detects over-limit
- WHEN: Attempting to free space
- THEN: ensureDensityOptimized() runs before performCompression()
**Why This Matters**: Density optimization may free enough space without full compression.

### REQ-HD-002.9: Raw History Input

**Full Text**: The `optimize()` method shall receive the raw history array via `getRawHistory()`, not the curated view.
**Behavior**:
- GIVEN: ensureDensityOptimized() calls optimize()
- WHEN: Building arguments
- THEN: `getRawHistory()` is used
**Why This Matters**: Density indices must reference the raw array positions.

### REQ-HD-002.10: Sequential Turn-Loop Safety

**Full Text**: `ensureDensityOptimized()` shall only be called from the sequential pre-send window.
**Behavior**:
- GIVEN: The method is called
- WHEN: It runs
- THEN: It's within ensureCompressionBeforeSend or enforceContextWindow (sequential context)
**Why This Matters**: Concurrent add() calls during optimization would invalidate indices.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/__tests__/geminiChat-density.test.ts` (or appropriate test location)
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P19`
  - MUST include: `@requirement:REQ-HD-002.1` through `REQ-HD-002.10`

### Test Strategy

Testing orchestration in GeminiChat is challenging because it's a large class with many dependencies. The tests should:

1. **Use the project's existing GeminiChat test patterns** — examine how existing `geminiChat.test.ts` or similar files set up GeminiChat instances for testing
2. **Focus on observable behavior** — test through the public interface (sendMessage/sendMessageStream) where possible, or through exposed internal methods if the existing test pattern allows it
3. **Use real strategy instances** — HighDensityStrategy is deterministic, so tests can use it without mocking
4. **Avoid mock theater** — no `toHaveBeenCalled` on internal methods; verify state changes and history mutations instead

### Test Cases (Behavioral — NOT mock theater)

#### ensureDensityOptimized Behavior Tests

1. **`ensureDensityOptimized calls optimize when dirty and strategy supports it`** `@requirement:REQ-HD-002.1, REQ-HD-002.4`
   - GIVEN: Active strategy is `'high-density'`, densityDirty is true, history contains prunable content (stale read→write pairs)
   - WHEN: `ensureDensityOptimized()` runs
   - THEN: History has been modified (stale entries removed), token count updated

2. **`ensureDensityOptimized skips when strategy has no optimize method`** `@requirement:REQ-HD-002.2`
   - GIVEN: Active strategy is `'middle-out'` (no optimize method)
   - WHEN: `ensureDensityOptimized()` runs
   - THEN: History is unchanged; no errors thrown

3. **`ensureDensityOptimized skips when not dirty`** `@requirement:REQ-HD-002.3`
   - GIVEN: `densityDirty === false` (e.g., after a previous optimization)
   - WHEN: `ensureDensityOptimized()` runs
   - THEN: History is unchanged; no optimize call

4. **`ensureDensityOptimized applies result when optimize returns changes`** `@requirement:REQ-HD-002.4`
   - GIVEN: History with content that triggers density removals
   - WHEN: `ensureDensityOptimized()` runs
   - THEN: `applyDensityResult()` is called (verified by checking history was modified)
   - AND: Token count reflects the change (verified by `getTotalTokens()` after)

5. **`ensureDensityOptimized awaits token recalculation after apply`** `@requirement:REQ-HD-002.4`
   - GIVEN: History with prunable content
   - WHEN: `ensureDensityOptimized()` completes
   - THEN: `getTotalTokens()` returns updated value (not stale pre-optimization count)

6. **`ensureDensityOptimized does not call applyDensityResult for empty result`** `@requirement:REQ-HD-002.5`
   - GIVEN: History with no prunable content (clean history, no stale reads)
   - WHEN: `ensureDensityOptimized()` runs with high-density strategy
   - THEN: History is unchanged (verified by comparing history before and after)

7. **`ensureDensityOptimized clears dirty flag in finally block`** `@requirement:REQ-HD-002.7`
   - GIVEN: `densityDirty === true`
   - WHEN: `ensureDensityOptimized()` completes (even if optimize returns empty result)
   - THEN: `densityDirty === false`
   - Note: May need to test via consecutive calls — second call should be a no-op

8. **`ensureDensityOptimized clears dirty flag even on error`** `@requirement:REQ-HD-002.7`
   - GIVEN: Strategy's optimize() throws an error
   - WHEN: `ensureDensityOptimized()` throws
   - THEN: `densityDirty === false` after the error (verified by next call being a no-op)
   - Note: Error propagation still happens (REQ-HD-013.1)

#### Dirty Flag Tests

9. **`dirty flag is set when user message is added`** `@requirement:REQ-HD-002.6`
   - GIVEN: After a successful optimization (densityDirty = false)
   - WHEN: A new user message is sent/added through the turn loop
   - THEN: densityDirty becomes true (next ensureDensityOptimized will run)

10. **`dirty flag is set when AI response is recorded`** `@requirement:REQ-HD-002.6`
    - GIVEN: After a successful optimization (densityDirty = false)
    - WHEN: An AI response is recorded via the turn loop
    - THEN: densityDirty becomes true

11. **`dirty flag is NOT set during compression rebuild`** `@requirement:REQ-HD-002.6`
    - GIVEN: After optimization, compression triggers
    - WHEN: performCompression() clears and re-adds history
    - THEN: densityDirty remains false (or at least doesn't trigger redundant optimization)
    - Note: This may be tested by verifying that after compression, a send without new content doesn't re-optimize

#### Integration with ensureCompressionBeforeSend Tests

12. **`ensureCompressionBeforeSend runs density before threshold check`** `@requirement:REQ-HD-002.1`
    - GIVEN: History is large enough to be near the threshold, with prunable density content
    - WHEN: `ensureCompressionBeforeSend()` runs
    - THEN: Density optimization runs first; if it reduces tokens below threshold, compression does NOT trigger
    - Note: Behavioral test — verify compression did NOT run by checking history is not fully recompressed

13. **`ensureCompressionBeforeSend still compresses after density if over threshold`** `@requirement:REQ-HD-002.1`
    - GIVEN: History is well over the threshold, density optimization alone is insufficient
    - WHEN: `ensureCompressionBeforeSend()` runs
    - THEN: Density optimization runs, then compression also runs (both applied)

#### Emergency Path Tests

14. **`enforceContextWindow runs density before compression`** `@requirement:REQ-HD-002.8`
    - GIVEN: Projected tokens exceed context limit, history has prunable density content
    - WHEN: `enforceContextWindow()` runs
    - THEN: Density optimization runs before performCompression()

15. **`enforceContextWindow skips compression if density freed enough space`** `@requirement:REQ-HD-002.8`
    - GIVEN: Projected tokens slightly over limit, density optimization frees enough
    - WHEN: `enforceContextWindow()` runs
    - THEN: Returns without calling performCompression() (density was sufficient)

#### Raw History Input Test

16. **`optimize receives raw history, not curated`** `@requirement:REQ-HD-002.9`
    - GIVEN: History with system-level entries that getCurated() would filter
    - WHEN: ensureDensityOptimized() calls optimize()
    - THEN: The optimization operates on raw history (verified by density result indices matching raw positions)

#### Sequential Safety Tests

17. **`ensureDensityOptimized is only called from sequential pre-send paths`** `@requirement:REQ-HD-002.10`
    - GIVEN: The GeminiChat class
    - WHEN: Searching for call sites of ensureDensityOptimized
    - THEN: Only called from ensureCompressionBeforeSend and enforceContextWindow
    - Note: This is a structural test — grep the code or verify call sites

#### Dirty Flag Site Completeness Tests

18. **`densityDirty is set after each representative add operation, not just once`** `@requirement:REQ-HD-002.6`
    - GIVEN: A GeminiChat instance with high-density strategy, densityDirty has been cleared (post-optimization)
    - WHEN: A user message is sent (add), then an AI response is recorded (add), then a tool result is added (add)
    - THEN: After EACH add operation, densityDirty is true (verified by running ensureDensityOptimized between adds — it should execute optimization each time, not just after the first add)
    - Note: This tests that ALL turn-loop add sites set the dirty flag, not just one. If any site is missed, the second or third ensureDensityOptimized call would be a no-op.

#### Property-Based Tests (≥ 30% of total)

19. **`dirty flag is always false after ensureDensityOptimized completes`**
    - Property: For any history state and strategy, after ensureDensityOptimized() completes, densityDirty is false

20. **`history is unchanged when strategy has no optimize method`**
    - Property: For any history, when strategy is middle-out, history before === history after ensureDensityOptimized()

21. **`history length after optimization <= history length before`**
    - Property: For any prunable history, the post-optimization history length is ≤ the pre-optimization length

22. **`empty result produces no history changes`**
    - Property: For any history where optimize returns empty removals and replacements, history is unchanged

23. **`optimization never increases token count`**
    - Property: For any history, totalTokens after ≤ totalTokens before (optimization only removes/shrinks)

24. **`consecutive clean optimizations are no-ops`**
    - Property: Calling ensureDensityOptimized() twice without adding content produces identical history both times

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P19
 * @requirement REQ-HD-002.1
 */
it('ensureDensityOptimized calls optimize when dirty and strategy supports it', async () => { ... });
```

### Test Infrastructure Notes

- Examine existing GeminiChat test patterns for setup boilerplate
- May need to use `createTestGeminiChat()` or similar helper
- HighDensityStrategy is deterministic — build history with known prunable content to get predictable results
- For dirty flag tests, may need to expose densityDirty for testing (or test via consecutive send behavior)
- For "compression did not trigger" tests, verify history content shape (compressed vs uncompressed)

## Verification Commands

```bash
# 1. Test file exists
test -f packages/core/src/core/__tests__/geminiChat-density.test.ts && echo "PASS" || echo "FAIL"
# Note: actual file path may differ based on existing test patterns

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/__tests__/geminiChat-density.test.ts)
[ "$count" -ge 19 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers present
grep -c "@plan.*HIGHDENSITY.P19" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: ≥ 1

# 4. Requirement markers present
grep -c "@requirement.*REQ-HD-002" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: ≥ 8

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 6. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 7. No spying on internal methods
grep -c "vi\.spyOn.*ensureDensityOptimized\|vi\.spyOn.*optimize" packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: 0

# 8. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/__tests__/geminiChat-density.test.ts)
total=$(grep -c "it(" packages/core/src/core/__tests__/geminiChat-density.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: ratio ≥ 0.30

# 9. Tests run but FAIL (stub ensureDensityOptimized is a no-op)
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1 | tail -15
# Expected: Tests exist but many fail (stub doesn't implement behavior)

# 10. No compile errors
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError"
# Expected: 0

# 11. Existing tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- Test file created with ≥ 19 behavioral test cases
- ≥ 30% property-based tests
- No mock theater, no reverse testing, no spying on internals
- Tests compile and run (failures from stub no-op, not infrastructure)
- All REQ-HD-002 sub-requirements covered
- Test infrastructure follows existing GeminiChat test patterns
- Plan, requirement, and pseudocode markers present
- No modifications to production code (tests only)
- Existing tests still pass

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/__tests__/geminiChat-density.test.ts`
2. Re-run Phase 19 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P19.md`
Contents:
```markdown
Phase: P19
Completed: [timestamp]
Files Created: packages/core/src/core/__tests__/geminiChat-density.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count]
Tests Failing: [count] (expected — stub is no-op)
Verification: [paste verification output]
```
