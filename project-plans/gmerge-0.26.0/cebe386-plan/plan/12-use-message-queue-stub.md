# Phase 12: useMessageQueue Hook Stub

## Phase ID

`PLAN-20260325-MCPSTATUS.P12`

## Prerequisites

- Required: Phase 11a (useMcpStatus Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P11a.md`
- Expected files from previous phase: Working `useMcpStatus` hook
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-QUEUE-001: Queue Creation

**Full Text**: A `useMessageQueue` hook shall provide a message queue holding user prompts submitted while gates are closed.
**Behavior**:
- GIVEN: The hook is called
- WHEN: `addMessage("hello")` is called
- THEN: `messageQueue` contains `["hello"]`
**Why This Matters**: Foundation for MCP-gated submission.

### REQ-QUEUE-002: Gate Parameters

**Full Text**: The hook accepts `isConfigInitialized`, `streamingState`, `submitQuery`, and `isMcpReady`.
**Behavior**:
- GIVEN: Hook is created with all four parameters
- WHEN: TypeScript compiles
- THEN: No type errors
**Why This Matters**: All four gates must be enforced for correct flush behavior.

### REQ-QUEUE-003: Auto-Flush When Gates Open

**Full Text**: When all gates are open and queue has items, dequeue first message and call submitQuery.
**Behavior**:
- GIVEN: `messageQueue = ["a", "b"]`, all gates open
- WHEN: Flush effect runs
- THEN: `submitQuery("a")` called, queue becomes `["b"]`
**Why This Matters**: Core auto-retry mechanism.

### REQ-QUEUE-006: FIFO Ordering

**Full Text**: Queued prompts shall be submitted in FIFO order.
**Behavior**:
- GIVEN: Queue is `["first", "second", "third"]`
- WHEN: Flush cycles run
- THEN: `submitQuery` calls are `"first"` → `"second"` → `"third"` (across separate cycles)
**Why This Matters**: User intent ordering must be preserved.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/hooks/useMessageQueue.ts`
  - Create the hook with full implementation (declarative hook — see P09 rationale)
  - Import `StreamingState` from types
  - Implement `useState` for `messageQueue: string[]`
  - Implement `useCallback` for `addMessage`
  - Implement `useEffect` for auto-flush with gate checks
  - Return `{ messageQueue, addMessage }`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P12` marker
  - ADD `@requirement:REQ-QUEUE-001` through `@requirement:REQ-QUEUE-006` markers

### Implementation from Pseudocode (use-message-queue.md)

- Lines 01-10: Interface definition (UseMessageQueueOptions, UseMessageQueueReturn)
- Lines 12-20: Function signature and state
- Lines 22-26: addMessage callback
- Lines 28-48: useEffect flush logic (gate checks, one-at-a-time drain)
- Lines 50-54: Return value

### Key Implementation Rules

1. **One message per cycle**: `const [next, ...rest] = messageQueue; setMessageQueue(rest); submitQuery(next);`
2. **All four gates required**: `isConfigInitialized && streamingState === StreamingState.Idle && isMcpReady && messageQueue.length > 0`
3. **No joining**: Messages are NOT concatenated — each is a separate `submitQuery` call
4. **Slash commands never enter**: Queue is for prompts only (slash bypass is in AppContainer)

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P12
 * @requirement:REQ-QUEUE-001, REQ-QUEUE-002, REQ-QUEUE-003, REQ-QUEUE-004, REQ-QUEUE-005, REQ-QUEUE-006
 * @pseudocode use-message-queue.md lines 01-54
 */
```

## Verification Commands

### Automated Checks

```bash
# Check file exists
test -f packages/cli/src/ui/hooks/useMessageQueue.ts && echo "OK" || echo "FAIL"

# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P12" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 1+

# Check exports
grep "export function useMessageQueue" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 1

# Check gate parameters
grep "isConfigInitialized\|streamingState\|submitQuery\|isMcpReady" packages/cli/src/ui/hooks/useMessageQueue.ts | wc -l
# Expected: 4+ (all gates referenced)

# Check return shape
grep "messageQueue\|addMessage" packages/cli/src/ui/hooks/useMessageQueue.ts | wc -l
# Expected: 2+

# TypeScript compiles
npm run typecheck
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
   - [ ] `addMessage` appends to queue
   - [ ] Flush effect checks all 4 gates
   - [ ] Flush submits one message, not all
   - [ ] FIFO order maintained

2. **Is this REAL implementation, not placeholder?**
   - [ ] Real useState/useEffect/useCallback logic
   - [ ] Not returning empty arrays or no-ops

## Success Criteria

- `useMessageQueue.ts` exists with full implementation
- Accepts all 4 gate parameters
- Returns `{ messageQueue, addMessage }`
- Flush logic dequeues one message per cycle
- TypeScript compiles

## Failure Recovery

If this phase fails:
1. `rm packages/cli/src/ui/hooks/useMessageQueue.ts`
2. Re-read pseudocode `use-message-queue.md`
3. Retry hook creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P12.md`
