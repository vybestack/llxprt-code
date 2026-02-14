# Phase 15: Session Cleanup Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P15`

## Prerequisites
- Required: Phase 11a completed (SessionLockManager works — needed for lock-aware protection)
- Verification: `test -f project-plans/issue1361/.completed/P11a.md`
- Required: Phase 08a completed (ReplayEngine works — readSessionHeader needed for header reading)
- Verification: `test -f project-plans/issue1361/.completed/P08a.md`

## Requirements Implemented (Expanded)

### REQ-CLN-001: Updated Scan Pattern
**Full Text**: Session cleanup scans for `session-*.jsonl` files.
**Behavior**:
- GIVEN: A chats directory with .jsonl session files
- WHEN: Session files are scanned
- THEN: All `session-*.jsonl` files are discovered
**Why This Matters**: Cleanup targets the new JSONL session format.

### REQ-CLN-002: Lock-Aware Active Protection
**Full Text**: Before deleting any .jsonl file, check if a corresponding .lock sidecar exists and is held by a running process. If locked, skip deletion.
**Behavior**:
- GIVEN: A .jsonl file with an active .lock file
- WHEN: Cleanup evaluates it for deletion
- THEN: The file is skipped (not deleted)
**Why This Matters**: Must never delete the session file for an active conversation.

### REQ-CLN-004: Orphaned Lock Cleanup
**Full Text**: .lock files with no corresponding .jsonl file are deleted.
**Behavior**:
- GIVEN: A .lock file with no matching .jsonl file
- WHEN: Stale lock cleanup runs
- THEN: The orphaned .lock file is deleted
**Why This Matters**: Prevents lock file accumulation from crashes.

## Implementation Tasks

### Strategy
This phase modifies the EXISTING `sessionCleanup.ts` file (or the relevant cleanup utility). The stub adds the new function signatures but delegates to existing behavior or returns empty results.

### Files to Modify
- `packages/cli/src/utils/sessionCleanup.ts` — Add stub functions for .jsonl support
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P15`
  - ADD: `cleanupStaleLocks(chatsDir)`: returns Promise.resolve(0) (stub)
  - ADD: `shouldDeleteSession(entry)`: returns 'delete' (stub — delegates to existing logic)
  - MODIFY: `getAllSessionFiles` or equivalent to recognize .jsonl pattern (stub — only adds type signature)

### Files to Create (if needed)
- If session cleanup utility functions are better placed in a separate file:
  `packages/core/src/recording/sessionCleanupUtils.ts` — Utility functions for .jsonl cleanup
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P15`

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P15
 * @requirement REQ-CLN-001, REQ-CLN-002, REQ-CLN-004
 */
```

## Verification Commands

```bash
# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P15" packages/ | wc -l
# Expected: 1+

# TypeScript compiles
npm run typecheck

# New function signatures exist
grep -q "cleanupStaleLocks\|shouldDeleteSession" packages/cli/src/utils/sessionCleanup.ts || grep -q "cleanupStaleLocks\|shouldDeleteSession" packages/core/src/recording/ || echo "FAIL: Functions not found"

# No TODO
grep -r "TODO" packages/cli/src/utils/sessionCleanup.ts packages/core/src/recording/sessionCleanupUtils.ts 2>/dev/null && echo "FAIL"

# Existing tests still pass
npm run test -- --grep "cleanup\|sessionCleanup" 2>&1 | tail -10
```

### Semantic Verification Checklist
- [ ] New functions have correct signatures matching pseudocode
- [ ] Stub doesn't break existing cleanup functionality
- [ ] .jsonl pattern recognition added to file scanning
- [ ] SessionLockManager imported (or will be on implementation)

## Success Criteria
- Stub compiles
- Existing cleanup tests still pass
- New function signatures visible

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P15.md`
