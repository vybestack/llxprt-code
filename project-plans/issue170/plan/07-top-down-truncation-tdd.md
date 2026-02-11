# Phase 07: Top-Down Truncation Strategy TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P07`

## Prerequisites

- Required: Phase 06 completed (MiddleOutStrategy passes)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P06" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/MiddleOutStrategy.ts` (passing tests)

## Requirements Implemented (Expanded)

### REQ-CS-003.1: LLM-Free Operation

**Full Text**: The `TopDownTruncationStrategy` shall not make any LLM calls. Its `requiresLLM` property shall be `false`.
**Behavior**:
- GIVEN: A `TopDownTruncationStrategy` instance
- WHEN: `strategy.requiresLLM` is checked
- THEN: It is `false`
- AND: `compress()` completes without calling any provider/LLM
**Why This Matters**: Users who want fast, cheap compression without LLM costs should get exactly that.

### REQ-CS-003.2: Oldest-First Removal

**Full Text**: The `TopDownTruncationStrategy` shall remove messages from the beginning of the history until the estimated token count is below the compression target.
**Behavior**:
- GIVEN: History of 20 messages, current token count 100000, target ~85% of context limit
- WHEN: Strategy removes messages from the top
- THEN: It drops the oldest messages first until estimated tokens < target
**Why This Matters**: Oldest context is typically least relevant; recent context is most valuable.

### REQ-CS-003.3: Tool-Call Boundary Respect

**Full Text**: The `TopDownTruncationStrategy` shall use shared boundary utilities.
**Behavior**:
- GIVEN: Truncation would leave an orphaned tool response at the new start
- WHEN: Strategy adjusts the truncation point
- THEN: It uses `adjustForToolCallBoundary` to find a clean boundary

### REQ-CS-003.4: Result Assembly

**Full Text**: Only surviving messages, no synthetic summary or acknowledgment.
**Behavior**:
- GIVEN: Strategy decides to keep messages 8–20
- WHEN: It assembles the result
- THEN: `newHistory` is exactly `[msg8, msg9, ..., msg20]` — no inserted summary or ack messages

### REQ-CS-003.5: Minimum Preservation

**Full Text**: Preserve at least 2 messages. If truncation to target would require fewer, return last 2 respecting tool-call boundaries.
**Behavior**:
- GIVEN: History where every message is huge, target requires keeping < 2
- WHEN: Strategy hits the minimum
- THEN: It keeps at least 2 messages (adjusted for tool-call boundaries)
**Why This Matters**: An empty or single-message history is degenerate and will confuse the model.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/TopDownTruncationStrategy.test.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P07`
  - MUST include: `@requirement REQ-CS-003.1, REQ-CS-003.2, REQ-CS-003.3, REQ-CS-003.4, REQ-CS-003.5`
  - Tests:
    - `requiresLLM` is `false`
    - `name` is `'top-down-truncation'`
    - No provider/LLM calls made during compress (provide a mock provider that throws if called)
    - Removes oldest messages first until under target token count
    - Token counting: use `context.estimateTokens()` — provide a fake that returns predictable token counts per message
    - Respects tool-call boundaries: truncation that would orphan a tool response is adjusted forward
    - Returns only surviving messages (no synthetic messages in result)
    - Metadata: `llmCallMade: false`, correct `originalMessageCount`, `compressedMessageCount`
    - Minimum preservation: with extremely large messages, keeps at least 2
    - Minimum preservation: the 2 kept messages respect tool-call boundaries (if msg[-1] is a tool response, keep its tool call too)
    - Edge case: history already under target → returns unchanged
    - Edge case: single message in history → returns unchanged (can't go below minimum)
    - Edge case: all messages are tool responses → boundary adjustment keeps associated tool calls

### Required Code Markers

```typescript
describe('TopDownTruncationStrategy @plan PLAN-20260211-COMPRESSION.P07', () => {
  it('does not make any LLM calls @requirement REQ-CS-003.1', () => {
    // ...
  });
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P07" packages/core/src/core/compression/ | wc -l
# Expected: 10+ occurrences

# Tests fail naturally (TopDownTruncationStrategy not yet implemented)
npx vitest run packages/core/src/core/compression/TopDownTruncationStrategy.test.ts 2>&1 | head -20

# No mock theater
grep -r "toHaveBeenCalled\b" packages/core/src/core/compression/TopDownTruncationStrategy.test.ts
# Expected: 0 matches
```

## Success Criteria

- 10+ behavioral tests covering all REQ-CS-003 sub-requirements
- Token estimation is faked via `context.estimateTokens`, not by mocking internals
- Tests fail with import/module errors, not syntax errors

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/TopDownTruncationStrategy.test.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P07.md`
Contents:
```
Phase: P07
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
