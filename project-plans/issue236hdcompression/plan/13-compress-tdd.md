# Phase 13: HighDensityStrategy — Compress TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P13`

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P12" packages/core/src/core/compression/HighDensityStrategy.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/HighDensityStrategy.ts` (optimize implemented, compress + helpers stubbed)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-008.1: No LLM Call

**Full Text**: The `HighDensityStrategy.compress()` method shall not make any LLM calls.
**Behavior**:
- GIVEN: A CompressionContext with a resolveProvider function
- WHEN: `compress()` executes
- THEN: resolveProvider is never invoked; no LLM request is made
**Why This Matters**: The entire value of high-density strategy is free, deterministic compression without LLM cost.

### REQ-HD-008.2: Recent Tail Preservation

**Full Text**: The `compress()` method shall preserve the recent tail of history, determined by `preserveThreshold` from the runtime context (same as other strategies).
**Behavior**:
- GIVEN: History of 10 entries, preserveThreshold=0.4
- WHEN: `compress()` runs
- THEN: The last 4 entries are preserved intact (including tool responses)
**Why This Matters**: The model needs recent conversation context to stay on track.

### REQ-HD-008.3: Tool Response Summarization

**Full Text**: For tool responses outside the preserved tail, `compress()` shall replace the full response payload with a compact one-line summary containing: tool name, key parameters (file path or command), and outcome (success or error status).
**Behavior**:
- GIVEN: A tool response `{ toolName: 'read_file', result: '...200 lines...', error: false }` outside tail
- WHEN: Summarized
- THEN: Result becomes a compact string like `'[read_file: 200 lines — success]'`
**Why This Matters**: Tool response payloads (file contents, command output) are the largest context consumers.

### REQ-HD-008.4: Non-Tool Content Preserved

**Full Text**: All tool call blocks, human messages, and AI text blocks shall be preserved intact by `compress()`.
**Behavior**:
- GIVEN: History with human, AI (text + tool_call), and tool entries
- WHEN: `compress()` runs
- THEN: Human and AI entries appear unchanged in newHistory; only tool response result fields change
**Why This Matters**: Human messages and AI reasoning are essential context; tool results are expendable.

### REQ-HD-008.5: CompressionResult Assembly

**Full Text**: The `compress()` method shall return a `CompressionResult` with `newHistory` containing the modified history and appropriate `metadata`.
**Behavior**:
- GIVEN: compress() completes with 20 original and 20 compressed entries
- WHEN: Checking the result
- THEN: `metadata.originalMessageCount === 20`, `metadata.compressedMessageCount === 20`, `metadata.strategyUsed === 'high-density'`, `metadata.llmCallMade === false`

### REQ-HD-008.6: Target Token Count

**Full Text**: The `compress()` method shall target a post-compression token count of approximately `compressionThreshold × contextLimit × 0.6`, providing headroom before the next threshold trigger.
**Behavior**:
- GIVEN: threshold=0.85, contextLimit=128000
- WHEN: Target is calculated
- THEN: targetTokens ≈ 65,280 (within ±10%)
**Why This Matters**: The 0.6 multiplier ensures the strategy provides enough headroom to avoid immediate re-compression.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/__tests__/high-density-compress.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P13`
  - MUST include: `@requirement:REQ-HD-008.1` through `REQ-HD-008.6`

### Test Cases (Behavioral — NOT mock theater)

All tests operate on a REAL `HighDensityStrategy` instance. A CompressionContext is constructed with real or minimal-real dependencies (estimateTokens as a simple word-count function, ephemerals returning configured values). No mocking of strategy internals.

#### No LLM Call Tests

1. **`compress does not call resolveProvider`** `@requirement:REQ-HD-008.1`
   - GIVEN: A CompressionContext with a resolveProvider that throws if called
   - WHEN: `compress()` executes
   - THEN: No error thrown (resolveProvider was never invoked)
   - Note: This is a behavioral test — if resolveProvider throws and compress succeeds, it proves no LLM call was made.

2. **`metadata.llmCallMade is always false`** `@requirement:REQ-HD-008.1`
   - GIVEN: Any history
   - WHEN: `compress()` returns
   - THEN: `result.metadata.llmCallMade === false`

#### Tail Preservation Tests

3. **`recent tail entries are preserved intact`** `@requirement:REQ-HD-008.2`
   - GIVEN: History of 10 entries, preserveThreshold=0.3 (tail = 3 entries)
   - WHEN: `compress()` runs
   - THEN: The last 3 entries in newHistory are identical (same reference or deep equal) to the last 3 in original

4. **`tail boundary does not split tool_call/tool_response pairs`** `@requirement:REQ-HD-008.2`
   - GIVEN: History where the tail boundary falls between an AI entry with tool_call and its tool response
   - WHEN: `compress()` runs
   - THEN: The boundary adjusts to include both the tool_call and tool_response in the tail

5. **`tail covering entire history returns history unchanged`** `@requirement:REQ-HD-008.2`
   - GIVEN: History of 3 entries, preserveThreshold=1.0 (tail covers all)
   - WHEN: `compress()` runs
   - THEN: newHistory equals original history; no entries modified

#### Tool Response Summarization Tests

6. **`tool responses outside tail are summarized to one-line strings`** `@requirement:REQ-HD-008.3`
   - GIVEN: A tool entry with result containing 200 lines of text, outside the tail
   - WHEN: `compress()` runs
   - THEN: The result field in the output entry is a short string (< 100 chars) containing the tool name and outcome

7. **`summary includes tool name and success/error status`** `@requirement:REQ-HD-008.3`
   - GIVEN: A successful read_file response and a failed grep response, both outside tail
   - WHEN: Summarized
   - THEN: Summaries contain 'read_file' / 'grep' and 'success' / 'error' respectively

8. **`summary for responses with file paths includes the path`** `@requirement:REQ-HD-008.3`
   - GIVEN: A tool response where result contains recognizable file path info
   - WHEN: Summarized
   - THEN: Summary includes a reference to key parameters

9. **`tool responses inside tail are NOT summarized`** `@requirement:REQ-HD-008.2, REQ-HD-008.3`
   - GIVEN: A tool entry in the preserved tail
   - WHEN: `compress()` runs
   - THEN: Its result field is unchanged (full content preserved)

#### Non-Tool Content Preservation Tests

10. **`human messages are preserved intact`** `@requirement:REQ-HD-008.4`
    - GIVEN: Human messages in history (both inside and outside tail)
    - WHEN: `compress()` runs
    - THEN: All human messages appear unchanged in newHistory

11. **`AI text blocks and tool_call blocks are preserved intact`** `@requirement:REQ-HD-008.4`
    - GIVEN: AI entries with text and tool_call blocks
    - WHEN: `compress()` runs
    - THEN: AI entries appear unchanged in newHistory (tool_calls never summarized)

#### CompressionResult Shape Tests

12. **`result has correct metadata shape`** `@requirement:REQ-HD-008.5`
    - GIVEN: History with 15 entries
    - WHEN: `compress()` returns
    - THEN: `metadata.originalMessageCount === 15`, `metadata.strategyUsed === 'high-density'`, `metadata.llmCallMade === false`, `metadata.compressedMessageCount` is defined

13. **`newHistory is a proper IContent array`** `@requirement:REQ-HD-008.5`
    - GIVEN: Any valid history
    - WHEN: `compress()` returns
    - THEN: `result.newHistory` is an array of IContent, each with valid speaker and blocks

#### Token Target Tests

14. **`target token calculation is approximately threshold × contextLimit × 0.6`** `@requirement:REQ-HD-008.6`
    - GIVEN: threshold=0.85, contextLimit=128000 (configurable via ephemerals)
    - WHEN: compress() processes a large history
    - THEN: Estimated tokens of newHistory are within ±10% of 65,280 (or aggressive truncation brings it close)

15. **`aggressive truncation removes oldest entries when summarization insufficient`** `@requirement:REQ-HD-008.6`
    - GIVEN: History with very large entries that remain above target even after summarization
    - WHEN: `compress()` runs
    - THEN: Oldest non-tail entries are removed from the front until under target

#### Edge Case Tests

16. **`empty history returns empty result`**
    - GIVEN: Empty history array
    - WHEN: `compress()` runs
    - THEN: `newHistory: []`, `metadata.originalMessageCount === 0`

17. **`single entry history is preserved`**
    - GIVEN: History with 1 entry
    - WHEN: `compress()` runs
    - THEN: `newHistory` contains that entry unchanged

#### Property-Based Tests (≥ 30% of total)

18. **`newHistory length ≤ original length`**
    - Property: For any history, `result.newHistory.length <= history.length`

19. **`all human messages are preserved in newHistory`**
    - Property: For any history, every human-speaker entry in the input appears in the output

20. **`all AI entries are preserved in newHistory (unless truncated from front)`**
    - Property: For any history, AI entries in the preserved tail appear unchanged

21. **`metadata.llmCallMade is always false`**
    - Property: For any history and context, `result.metadata.llmCallMade === false`

22. **`metadata.strategyUsed is always 'high-density'`**
    - Property: For any history, `result.metadata.strategyUsed === 'high-density'`

23. **`preserved tail entries appear unchanged at the end of newHistory`**
    - Property: The last tailSize entries in newHistory are reference-equal to the last tailSize entries in input

24. **`tool response results outside tail are strings (summarized)`**
    - Property: For any tool speaker entry outside the tail in newHistory, each tool_response block's result is a string (not an object)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P13
 * @requirement REQ-HD-008.1
 * @pseudocode high-density-compress.md lines 10-91
 */
it('compress does not call resolveProvider', async () => { ... });
```

### CompressionContext Test Helper

Tests will need a helper function to build a minimal but real CompressionContext:

```typescript
function buildTestCompressionContext(overrides?: Partial<{
  history: IContent[],
  preserveThreshold: number,
  compressionThreshold: number,
  contextLimit: number,
}>): CompressionContext {
  // Build with real-ish defaults:
  // - estimateTokens: simple word-count estimator
  // - ephemerals: returns configured preserveThreshold, compressionThreshold, contextLimit
  // - resolveProvider: throws if called (proves no LLM usage)
  // - logger: silent debug logger
}
```

This helper should be defined at the top of the test file or in a shared test utility. It must NOT mock the strategy — it builds a real context object.

## Verification Commands

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-compress.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
[ "$count" -ge 18 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers present
grep -c "@plan.*HIGHDENSITY.P13" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: ≥ 1

# 4. Requirement markers present
grep -c "@requirement.*REQ-HD-008" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: ≥ 6

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 6. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 7. No spying on strategy internals
grep -c "vi\.spyOn.*strategy\|jest\.spyOn.*strategy" packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: 0

# 8. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-compress.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: ratio ≥ 0.30

# 9. Tests run but FAIL (stubs throw NotYetImplemented)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -15
# Expected: Tests exist but most fail

# 10. No compile errors
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError"
# Expected: 0

# 11. Optimize tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- Test file created with ≥ 18 behavioral test cases
- ≥ 30% property-based tests
- No mock theater (no `toHaveBeenCalled`)
- No reverse testing (no `NotYetImplemented` expectations)
- Tests compile and run (failures from stubs, not infrastructure)
- All REQ-HD-008 sub-requirements covered
- CompressionContext helper provides real-ish context
- Plan, requirement, and pseudocode markers present
- No modifications to production code (tests only)
- Optimize tests still pass

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/high-density-compress.test.ts`
2. Re-run Phase 13 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P13.md`
Contents:
```markdown
Phase: P13
Completed: [timestamp]
Files Created: packages/core/src/core/compression/__tests__/high-density-compress.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count]
Tests Failing: [count] (expected — stubs not implemented)
Verification: [paste verification output]
```
