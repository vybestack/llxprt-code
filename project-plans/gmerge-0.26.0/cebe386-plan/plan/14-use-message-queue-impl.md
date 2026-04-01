# Phase 14: useMessageQueue Implementation Verification + Cleanup

## Phase ID

`PLAN-20260325-MCPSTATUS.P14`

## Prerequisites

- Required: Phase 13a (useMessageQueue TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P13a.md`
- Expected files from previous phase: Tests in useMessageQueue.test.tsx all passing

## Requirements Implemented (Expanded)

### REQ-QUEUE-001 through REQ-QUEUE-006 (All Queue Requirements)

This phase verifies and fixes any issues found during TDD. Since the hook was fully implemented in P12 (declarative hooks), this is primarily verification and cleanup.

## Implementation Tasks

### Note: Main Work Was Done in P12

The `useMessageQueue` hook was fully implemented in P12 because React hooks are declarative. This phase confirms all P13 tests pass and cleans up any issues.

### Files to Verify/Fix

- `packages/cli/src/ui/hooks/useMessageQueue.ts`
  - Verify all P13 tests pass
  - Fix any issues discovered during TDD
  - Verify pseudocode compliance (use-message-queue.md lines 01-54)
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P14` marker if fixes were needed

### Pseudocode Compliance Check

From `analysis/pseudocode/use-message-queue.md`:
- Lines 01-10: Interface definitions — verify options and return types
- Lines 12-20: Function signature and useState — verify queue state
- Lines 22-26: addMessage callback — verify append-only behavior
- Lines 28-48: useEffect flush logic — verify 4 gate checks, one-at-a-time drain, correct dependency array
- Lines 50-54: Return shape — verify { messageQueue, addMessage }

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P14
 * @requirement:REQ-QUEUE-001, REQ-QUEUE-002, REQ-QUEUE-003, REQ-QUEUE-004, REQ-QUEUE-005, REQ-QUEUE-006
 * @pseudocode use-message-queue.md lines 01-54
 */
```

## Verification Commands

### Automated Checks

```bash
# All queue tests pass
npm test -- packages/cli/src/ui/hooks/useMessageQueue.test.tsx
# Expected: All pass

# TypeScript compiles
npm run typecheck

# No deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0

# Full test suite
npm run test
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
   - [ ] addMessage appends to queue
   - [ ] Flush checks all 4 gates
   - [ ] Flush dequeues one message per cycle
   - [ ] FIFO order preserved

2. **Is this REAL implementation, not placeholder?**
   - [ ] All tests pass with real behavior

3. **Would the test FAIL if implementation was removed?**
   - [ ] No-op addMessage → queue length tests fail
   - [ ] Missing flush → auto-submit tests fail

4. **Is the feature REACHABLE?**
   - [ ] Will be consumed by AppContainer in P15

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0

grep -rn "return \[\]|return \{\}" packages/cli/src/ui/hooks/useMessageQueue.ts
# Expected: 0 (initial state [] is OK in useState, but no empty returns in logic)
```

## Success Criteria

- All P13 tests pass
- TypeScript compiles
- Pseudocode compliance verified
- No deferred implementation
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/hooks/useMessageQueue.ts`
2. Re-read pseudocode and fix the specific failing test
3. Re-run verification

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P14.md`
