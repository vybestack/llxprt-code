# Phase 03: Shared Utilities TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P02" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/types.ts`
  - `packages/core/src/core/compression/index.ts`

## Requirements Implemented (Expanded)

### REQ-CS-004.1: Boundary Adjustment

**Full Text**: The system shall provide a shared `adjustForToolCallBoundary(history, index)` function that finds a valid split point that does not break tool call/response pairs.
**Behavior**:
- GIVEN: A history array and a proposed split index
- WHEN: `adjustForToolCallBoundary(history, index)` is called
- THEN: It returns an adjusted index where the split does not orphan any tool response from its tool call
**Why This Matters**: Both strategies (middle-out and top-down) need this. Without it, truncation/compression could produce malformed history that crashes the LLM.

### REQ-CS-004.2: Forward Search

**Full Text**: The shared utilities shall provide `findForwardValidSplitPoint(history, index)` that scans forward from an index to find a position where no tool response is orphaned.
**Behavior**:
- GIVEN: A history where index N lands in the middle of a tool response sequence
- WHEN: `findForwardValidSplitPoint(history, N)` is called
- THEN: It returns an index past the end of the tool response sequence

### REQ-CS-004.3: Backward Search

**Full Text**: The shared utilities shall provide `findBackwardValidSplitPoint(history, startIndex)` that scans backward to find a valid split position.
**Behavior**:
- GIVEN: Forward search reached the end of history (no valid forward point)
- WHEN: `findBackwardValidSplitPoint(history, startIndex)` is called
- THEN: It searches backward to find the nearest valid split that keeps tool call/response pairs intact

### REQ-CS-004.4: Behavioral Equivalence

**Full Text**: The shared utility functions shall produce the same results as the current implementations in `geminiChat.ts` for identical inputs.
**Behavior**:
- GIVEN: Identical history and index inputs
- WHEN: The extracted utility function is called vs. the current inline function
- THEN: Both return the same adjusted index
**Why This Matters**: This is a refactor, not a rewrite. Existing behavior must be preserved exactly.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/utils.test.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P03`
  - MUST include: `@requirement REQ-CS-004.1, REQ-CS-004.2, REQ-CS-004.3, REQ-CS-004.4`
  - Tests must use REAL `IContent` objects (speaker: 'human', 'ai', 'tool' with appropriate blocks)
  - Tests:
    - `adjustForToolCallBoundary` returns original index when no tool calls at boundary
    - `adjustForToolCallBoundary` skips past orphaned tool responses (forward)
    - `adjustForToolCallBoundary` falls back to backward search when forward reaches end
    - `adjustForToolCallBoundary` handles index 0 (returns 0)
    - `adjustForToolCallBoundary` handles empty history
    - `findForwardValidSplitPoint` advances past consecutive tool responses
    - `findForwardValidSplitPoint` detects AI message with tool calls whose responses are NOT in the kept portion, and adjusts
    - `findBackwardValidSplitPoint` finds a clean human/AI boundary before tool responses
    - `findBackwardValidSplitPoint` handles all-tool-response history (returns startIndex)
    - Edge case: tool call with multiple responses
    - Edge case: interleaved tool calls from different AI turns
    - Edge case: history with no tool calls at all (pass-through)

### Required Code Markers

```typescript
describe('compression/utils @plan PLAN-20260211-COMPRESSION.P03', () => {
  describe('adjustForToolCallBoundary @requirement REQ-CS-004.1', () => {
    it('returns original index when split is at a clean boundary', () => {
      // ...
    });
  });
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P03" packages/core/src/core/compression/ | wc -l
# Expected: 10+ occurrences

# Tests fail naturally (no implementation yet)
npx vitest run packages/core/src/core/compression/utils.test.ts 2>&1 | head -20
# Expected: failures due to missing module, NOT due to test syntax errors

# No mock theater
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/core/compression/utils.test.ts
# Expected: 0 matches

# No reverse testing
grep -r "NotYetImplemented\|expect.*not\.toThrow" packages/core/src/core/compression/utils.test.ts
# Expected: 0 matches
```

## Success Criteria

- 12+ behavioral tests created for all three utility functions
- Tests use real `IContent` objects with tool_call and tool_response blocks
- Tests fail with import/module errors (no implementation yet), not syntax errors
- No mock theater, no reverse testing

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/utils.test.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P03.md`
Contents:
```
Phase: P03
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
