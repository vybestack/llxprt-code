# Phase 09: Concurrency + Lifecycle Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P09`

## Prerequisites
- Required: Phase 08a completed (Replay Engine works — needed for lock-before-replay pattern)
- Verification: `test -f project-plans/issue1361/.completed/P08a.md`
- Verification: `test -f project-plans/issue1361/.completed/P05a.md` (Writer works — needed for flush-on-shutdown)

## Requirements Implemented (Expanded)

### REQ-CON-001: Sidecar Lockfile
**Full Text**: Each session file `session-*.jsonl` has a corresponding `session-*.jsonl.lock` sidecar file containing the owning process PID and timestamp. PID-based stale detection checks if the owning process is still running.
**Behavior**:
- GIVEN: A session file path
- WHEN: A lock is acquired
- THEN: A `.lock` file is created containing PID and timestamp
**Why This Matters**: Prevents two processes from writing to the same session file simultaneously.

### REQ-CON-002: Lock Acquisition Timing
**Full Text**: Lock acquired before file creation (new session) or before replay (resume session).
**Behavior**:
- GIVEN: A new or resumed session
- WHEN: The SessionLockManager.acquire() is called
- THEN: Lock is held before any file I/O begins
**Why This Matters**: Prevents race conditions during session setup.

### REQ-CON-003: Lock Release via Cleanup
**Full Text**: Lock released via registerCleanup pattern — integrates with existing cleanup.ts infrastructure.
**Behavior**:
- GIVEN: An active lock
- WHEN: Process exits normally or via SIGINT/SIGTERM
- THEN: Lock file is deleted
**Why This Matters**: Prevents stale locks from accumulating after normal exits.

### REQ-CON-004: Concurrent Lock Failure
**Full Text**: Concurrent lock attempt on same session fails with clear error message.
**Behavior**:
- GIVEN: Session is locked by another process
- WHEN: acquire() is called
- THEN: Throws Error("Session is in use by another process")
**Why This Matters**: Clear error message tells user why resume failed.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/SessionLockManager.ts` — Lock manager stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P09`
  - MUST include: `@requirement:REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004`
  - Static class with methods:
    - `getLockPath(sessionFilePath)`: returns `sessionFilePath + '.lock'`
    - `acquire(sessionFilePath)`: throws NotYetImplemented
    - `checkStale(lockPath)`: throws NotYetImplemented
    - `isLocked(sessionFilePath)`: returns false (stub)
    - `isStale(sessionFilePath)`: returns false (stub)
    - `removeStaleLock(sessionFilePath)`: no-op (stub)

### Files to Modify
- `packages/core/src/recording/index.ts` — Add SessionLockManager export

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P09
 * @requirement REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004
 */
```

## Verification Commands

```bash
# Files exist
test -f packages/core/src/recording/SessionLockManager.ts || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P09" packages/core/src/recording/ | wc -l
# Expected: 1+ files

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Method signatures exist
grep -q "acquire" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"
grep -q "checkStale" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"
grep -q "isLocked" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"
grep -q "isStale" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"
grep -q "removeStaleLock" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"
grep -q "getLockPath" packages/core/src/recording/SessionLockManager.ts || echo "FAIL"

# No TODO comments
grep -r "TODO" packages/core/src/recording/SessionLockManager.ts && echo "FAIL: TODO found"

# No V2 or duplicate files
find packages/core/src/recording -name "*V2*" -o -name "*New*" && echo "FAIL: Duplicates"

# Barrel export
grep -q "SessionLockManager" packages/core/src/recording/index.ts || echo "FAIL: Not exported"
```

### Semantic Verification Checklist
- [ ] getLockPath returns deterministic path (sessionFilePath + '.lock')
- [ ] acquire returns a LockHandle with `lockPath` and `release()` method
- [ ] Return types match LockHandle interface from pseudocode
- [ ] Static class — no instantiation needed

## Success Criteria
- Stub compiles with `npm run typecheck`
- Correct method signatures matching pseudocode
- Barrel export works

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionLockManager.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P09.md`
