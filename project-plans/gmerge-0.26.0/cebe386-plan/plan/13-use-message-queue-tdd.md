# Phase 13: useMessageQueue TDD

## Phase ID

`PLAN-20260325-MCPSTATUS.P13`

## Prerequisites

- Required: Phase 12a (useMessageQueue Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P12a.md`
- Expected files from previous phase: `packages/cli/src/ui/hooks/useMessageQueue.ts`

## Requirements Implemented (Expanded)

### REQ-QUEUE-003: Auto-Flush When Gates Open

**Full Text**: When all gates are open and queue has items, dequeue first message and call submitQuery.
**Behavior**:
- GIVEN: Queue has `["msg1", "msg2", "msg3"]`, all gates open
- WHEN: Flush effect runs
- THEN: `submitQuery("msg1")` called, queue becomes `["msg2", "msg3"]`
**Why This Matters**: Core mechanism for deferred prompt submission.

### REQ-QUEUE-004: No Flush While Streaming

**Full Text**: While `streamingState` is not `Idle`, queue shall not flush.
**Behavior**:
- GIVEN: Queue has items, MCP ready, config initialized
- WHEN: `streamingState === StreamingState.Responding`
- THEN: Queue remains intact, `submitQuery` NOT called
**Why This Matters**: Prevents sending new prompts during active AI response.

### REQ-QUEUE-005: No Flush While MCP Not Ready

**Full Text**: While `isMcpReady` is false, queue shall not flush.
**Behavior**:
- GIVEN: Queue has items, streaming idle, config initialized
- WHEN: `isMcpReady === false`
- THEN: Queue remains intact, `submitQuery` NOT called
**Why This Matters**: Prevents sending prompts before MCP tools are available.

### REQ-QUEUE-006: FIFO Ordering

**Full Text**: Queued prompts submitted in order A, B, C across three flush cycles.
**Behavior**:
- GIVEN: Queue `["A", "B", "C"]`, all gates open
- WHEN: Three flush cycles complete (each waits for streaming to return to Idle)
- THEN: `submitQuery` called with `"A"`, then `"B"`, then `"C"` in that order
**Why This Matters**: User intent must be preserved.

### REQ-TEST-002: useMessageQueue Unit Tests

**Full Text**: Comprehensive tests covering queue, flush, and gate behavior.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/hooks/useMessageQueue.test.tsx`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P13` marker
  - ADD `@requirement:REQ-QUEUE-001` through `@requirement:REQ-QUEUE-006`, `@requirement:REQ-TEST-002` markers

### Test Cases Required

1. **Test: addMessage increases queue length** (REQ-QUEUE-001)
   - Call `addMessage("hello")`
   - Assert: `messageQueue.length === 1`, `messageQueue[0] === "hello"`

2. **Test: Queue prompt while MCP not ready** (REQ-QUEUE-005)
   - Setup: `isMcpReady = false`, `streamingState = Idle`, `isConfigInitialized = true`
   - Call `addMessage("hello")`
   - Assert: `messageQueue.length === 1`, `submitQuery` NOT called

3. **Test: Flush when all gates open** (REQ-QUEUE-003)
   - Setup: All gates open, queue has 1 item
   - Assert: `submitQuery` called with the item, queue becomes empty

4. **Test: Three items drain across three calls (FIFO)** (REQ-QUEUE-006)
   - Queue `["A", "B", "C"]`
   - Assert: First flush → `submitQuery("A")`, queue = `["B", "C"]`
   - Simulate return to Idle, second flush → `submitQuery("B")`, queue = `["C"]`
   - Simulate return to Idle, third flush → `submitQuery("C")`, queue = `[]`

5. **Test: No flush while streaming** (REQ-QUEUE-004)
   - Setup: Queue has items, all gates open EXCEPT `streamingState = Responding`
   - Assert: `submitQuery` NOT called, queue intact

6. **Test: No flush while MCP not ready** (REQ-QUEUE-005)
   - Setup: Queue has items, all gates open EXCEPT `isMcpReady = false`
   - Assert: `submitQuery` NOT called, queue intact

7. **Test: No flush while config not initialized** (REQ-QUEUE-002)
   - Setup: Queue has items, all gates open EXCEPT `isConfigInitialized = false`
   - Assert: `submitQuery` NOT called, queue intact

8. **Test: Zero-server startup — no queueing needed** (integration scenario)
   - Setup: `isMcpReady = true` from start
   - Assert: No queue interaction needed, direct submit works

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P13
 * @requirement:REQ-QUEUE-001, REQ-QUEUE-002, REQ-QUEUE-003, REQ-QUEUE-004, REQ-QUEUE-005, REQ-QUEUE-006
 * @requirement:REQ-TEST-002
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P13" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 1+

# Run tests
npm test -- packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: All pass (hook fully implemented in P12)

# Count test cases
grep -c "it(\|test(" packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: 8+
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] Tests verify one-at-a-time drain (not join)
   - [ ] Tests verify all 4 gate conditions
   - [ ] Tests verify FIFO ordering

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests assert on specific queue contents
   - [ ] Tests verify submitQuery called with exact values

3. **Would the test FAIL if implementation was removed?**
   - [ ] Empty addMessage → queue length assertion fails
   - [ ] Missing flush logic → auto-submit tests fail

## Success Criteria

- 8+ behavioral tests
- FIFO ordering verified across 3+ flush cycles
- All 4 gate conditions tested individually
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `rm packages/cli/src/ui/hooks/useMessageQueue.test.tsx`
2. Re-read pseudocode `use-message-queue.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P13.md`
