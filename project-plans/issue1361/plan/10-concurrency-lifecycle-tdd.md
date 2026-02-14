# Phase 10: Concurrency + Lifecycle TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P10`

## Prerequisites
- Required: Phase 09a completed
- Verification: `test -f project-plans/issue1361/.completed/P09a.md`

## Requirements Implemented (Expanded)

### REQ-CON-001: Sidecar Lockfile
**Full Text**: Each session file `session-*.jsonl` has a corresponding `session-*.jsonl.lock` sidecar file containing the owning process PID and timestamp. PID-based stale detection checks if the owning process is still running.
**Behavior**:
- GIVEN: A session file path
- WHEN: acquire() is called
- THEN: A `.lock` file is created containing JSON with `pid` and `timestamp` fields
**Why This Matters**: Prevents two processes from writing to the same session file simultaneously.

### REQ-CON-002: Lock Acquisition Timing
**Full Text**: Lock acquired before file creation (new session) or before replay (resume session).
**Behavior**:
- GIVEN: A session file path (file may not exist yet)
- WHEN: acquire() is called
- THEN: Lock file is created using exclusive create flag ('wx')
**Why This Matters**: Atomic acquisition prevents race conditions.

### REQ-CON-003: Lock Release
**Full Text**: Lock released via the LockHandle.release() method which deletes the lock file.
**Behavior**:
- GIVEN: An acquired lock handle
- WHEN: release() is called
- THEN: Lock file is deleted from disk
**Why This Matters**: Clean release prevents stale locks.

### REQ-CON-004: Concurrent Lock Failure
**Full Text**: Concurrent lock attempt on same session fails with clear error message.
**Behavior**:
- GIVEN: Session is locked by current process
- WHEN: Another acquire() is called for the same session
- THEN: Throws Error("Session is in use by another process")
**Why This Matters**: Clear error message tells user why resume failed.

### REQ-CON-005: Stale Lock Detection
**Full Text**: Stale locks (from crashed processes) are detected by checking if the PID in the lock file is still running, and are automatically broken.
**Behavior**:
- GIVEN: A lock file exists with a PID that is no longer running
- WHEN: acquire() is called
- THEN: Stale lock is broken and new lock is acquired
**Why This Matters**: Crashed processes shouldn't permanently block session reuse.

### REQ-CON-006: Shutdown Flush
**Full Text**: SIGINT/SIGTERM/exit triggers flush before lock release via registerCleanup integration.
**Behavior**:
- GIVEN: Recording service is active and events are queued
- WHEN: Process begins shutdown
- THEN: flush() is awaited before lock is released
**Why This Matters**: Ensures no data loss on clean shutdown.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/SessionLockManager.test.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P10`
  - MUST include: `@requirement:REQ-CON-001` through `@requirement:REQ-CON-006`
  - All tests use REAL filesystem (os.tmpdir temp directories)
  - No mock theater

### Test Cases (BEHAVIORAL — expect REAL behavior)

1. **acquire creates .lock file** — acquire lock, verify .lock file exists on disk with correct path
2. **Lock file contains PID and timestamp** — acquire lock, read .lock file, parse JSON, verify pid === process.pid, verify timestamp is valid ISO-8601
3. **getLockPath returns path + '.lock'** — verify deterministic path construction
4. **release deletes lock file** — acquire, release, verify .lock file no longer exists
5. **Double release is safe (idempotent)** — acquire, release, release again → no error
6. **Concurrent acquire fails** — acquire lock, attempt second acquire on same path → throws "Session is in use"
7. **Lock with non-existent directory creates parent** — acquire with path in non-existent subdir → creates directory and lock file
8. **Stale lock detection: dead PID** — write fake lock file with PID 999999999, call checkStale → returns true
9. **Stale lock detection: alive PID** — write lock with current process PID, call checkStale → returns false
10. **Stale lock is broken on acquire** — write fake lock file with dead PID, call acquire → succeeds, old lock replaced
11. **isLocked returns true when locked** — acquire, call isLocked → true
12. **isLocked returns false when not locked** — no lock file, call isLocked → false
13. **isLocked returns false for stale lock** — write fake stale lock, call isLocked → false (stale = not effectively locked)
14. **isStale returns true for dead PID** — write fake lock with dead PID, call isStale → true
15. **isStale returns false when no lock** — call isStale on unlocked path → false
16. **removeStaleLock deletes lock file** — write fake lock, call removeStaleLock → file removed
17. **removeStaleLock is safe when no lock exists** — call removeStaleLock on non-existent path → no error
18. **Corrupt lock file treated as stale** — write non-JSON garbage to .lock, call checkStale → true

### Property-Based Tests (30%+ of total — minimum 8 property tests)

19. **Any valid file path produces deterministic lock path** — fc.string for path components, verify getLockPath is pure and deterministic
20. **Acquire + release cycle is atomic (no leftover files)** — fc.array of acquire/release sequences, verify no orphaned .lock files at end
21. **Multiple session paths can be locked independently** — fc.array of unique paths, acquire all, verify all .lock files exist, release all
22. **Lock file always contains valid JSON with pid field** — fc.nat for session IDs, acquire, read file, verify parseable JSON with pid
23. **Release is always idempotent regardless of call count** — fc.nat for release call count (1-10), verify no errors
24. **Stale detection is consistent** — fc.boolean for alive/dead PID, verify checkStale returns correct result
25. **Lock file timestamp is always a valid ISO-8601 date** — fc.nat for session IDs, acquire, read file, verify timestamp is parseable as Date
26. **getLockPath always appends exactly '.lock' to any input path** — fc.string for base path, verify getLockPath(p) === p + '.lock'

### FORBIDDEN Patterns
- `expect(mockFs.writeFile).toHaveBeenCalled()` — NO mock theater
- `expect(() => acquire()).not.toThrow()` — NO reverse testing
- No mocking of `process.kill` — test with real PIDs where possible, fake PIDs (999999999) for dead PID tests

## Required Code Markers

Every test case MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P10
 * @requirement REQ-CON-001 (or appropriate REQ-CON-*)
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/SessionLockManager.test.ts

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/SessionLockManager.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/SessionLockManager.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
[ "$TOTAL" -lt 18 ] && echo "FAIL: Insufficient tests"

# No mock theater
grep -r "toHaveBeenCalled\|mockImplementation\|jest\.mock\|vi\.mock" packages/core/src/recording/SessionLockManager.test.ts && echo "FAIL: Mock theater"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/SessionLockManager.test.ts && echo "FAIL: Reverse testing"

# Behavioral assertions present
grep -c "toBe\|toEqual\|toContain\|toMatch\|toHaveLength\|toThrow\|fileExists" packages/core/src/recording/SessionLockManager.test.ts
# Expected: 18+

# Tests fail naturally against stub
cd packages/core && npx vitest run src/recording/SessionLockManager.test.ts 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Tests verify actual file system state (lock files exist/don't exist)
- [ ] Tests use real temp directories
- [ ] Each test has @requirement annotation
- [ ] Property-based tests use fast-check
- [ ] Stale detection tests use real PID checking (not mocked)
- [ ] No test would pass with an empty implementation

## Success Criteria
- 18+ behavioral tests created
- 8+ property-based tests (30%+ of total = 8/26 = 30.8%)
- All tests tagged with plan/requirement markers
- Tests fail naturally against stub
- No mock theater, no reverse testing

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionLockManager.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P10.md`

## CRITICAL FIX: Deferred Materialization Lock Tests

### Additional Test Cases for Lock State Machine

These tests verify that locking works correctly when the JSONL file does not yet exist
(deferred materialization — REQ-REC-004).

27. **acquireForSession creates lock before JSONL file exists** — call `acquireForSession(chatsDir, sessionId)`, verify `.lock` file exists but no `.jsonl` file exists
    - `@requirement REQ-CON-002, REQ-REC-004`

28. **Lock file contains sessionId and state fields** — call `acquireForSession()`, read lock file, parse JSON, verify `sessionId` field matches and `state === 'pre_materialization'`
    - `@requirement REQ-CON-001`

29. **getLockPathForSession uses session-ID-based path** — verify `getLockPathForSession(chatsDir, 'abc123')` returns `<chatsDir>/abc123.lock` (not tied to `.jsonl` path)
    - `@requirement REQ-CON-001`

30. **Lock transition: pre-materialization to released (no JSONL created)** — acquire lock, release without creating JSONL → lock file removed, no JSONL file, clean state
    - `@requirement REQ-CON-003`

31. **Orphan lock cleanup: stale lock with no JSONL** — create fake lock with dead PID and no corresponding JSONL, call `cleanupOrphanedLocks()` → lock removed
    - `@requirement REQ-CON-005`

32. **Orphan lock cleanup: stale lock with existing JSONL** — create fake lock with dead PID AND a corresponding JSONL file, call `cleanupOrphanedLocks()` → lock removed, JSONL preserved
    - `@requirement REQ-CON-005`

33. **Orphan lock cleanup: active lock is not removed** — create lock with current PID, call `cleanupOrphanedLocks()` → lock NOT removed
    - `@requirement REQ-CON-004`

34. **Stale detection with PID reuse protection: old lock treated as stale** — create lock with current PID but timestamp > 48 hours ago, call `checkStaleWithPidReuse()` → returns true (stale despite alive PID)
    - `@requirement REQ-CON-005`

35. **Stale detection with PID reuse protection: recent lock not stale** — create lock with current PID and recent timestamp, call `checkStaleWithPidReuse()` → returns false
    - `@requirement REQ-CON-005`

### Additional Property-Based Tests

36. **Any sessionId produces deterministic lock path** — `fc.string()` for sessionId, verify `getLockPathForSession(chatsDir, id)` always returns `<chatsDir>/<id>.lock`
    - `@requirement REQ-CON-001`

37. **acquireForSession + release cycle leaves no artifacts** — `fc.string()` for sessionId, acquire, release, verify no lock file and no JSONL file remain
    - `@requirement REQ-CON-003`

38. **cleanupOrphanedLocks is idempotent** — `fc.nat(1,3)` for call count, create stale locks, call cleanup N times → same result each time, no errors
    - `@requirement REQ-CON-005`

### Updated Success Criteria

- 26+ behavioral tests (original 18 + 9 new deferred materialization tests)
- 11+ property-based tests (original 8 + 3 new)
- All tests tagged with plan/requirement markers
- Tests fail naturally against stub



---

## Addendum: Strengthened PID Reuse Stale Lock Tests

### Context
Tests 34-35 cover the basic PID reuse detection with timestamp heuristics. The following additional scenario ensures the edge case where a PID is reused by an unrelated process is handled correctly.

### Additional Test

39. **Stale lock with PID reused by unrelated process** — GIVEN: a lock file exists with PID P and timestamp T (where T is 30 minutes ago, within the "recent" window). WHEN: PID P is currently alive (belongs to a different, unrelated process — e.g., a system daemon). THEN: `checkStaleWithPidReuse()` returns false (not stale), because within the recent window an alive PID is trusted. BUT: if T is > 48 hours ago, returns true (stale) even though PID P is alive — the timestamp override catches long-lived PID reuse.
    - GIVEN: Lock file with `{ pid: <current_process_pid>, timestamp: <30_minutes_ago>, sessionId: "session-abc" }`
    - WHEN: `checkStaleWithPidReuse()` is called
    - THEN: Returns false (PID is alive and timestamp is recent)
    - AND GIVEN: Same lock but `timestamp: <49_hours_ago>`
    - WHEN: `checkStaleWithPidReuse()` is called
    - THEN: Returns true (timestamp override — stale despite alive PID)
    - `@requirement REQ-CON-005`

### Updated Success Criteria Addendum
- 27+ behavioral tests (adding test 39)


---

## Addendum: Dual-Process Lock Contention Test (Architecture Review FIX 6)

### Real Process Fork Test (NOT mocked)

40. **Dual-process lock contention with real process fork** — Use `child_process.fork()` to spawn a real child process that acquires a lock on a session file. From the parent process, attempt to acquire the same lock. Verify:
    - Parent's `acquire()` throws "Session is in use by another process"
    - Child process holds a valid lock file with its own PID
    - After child exits (via IPC signal or natural termination), parent can acquire the lock (stale detection kicks in)
    - `@requirement REQ-CON-004, REQ-CON-005`
    - **Implementation hint**: Create a helper script `test-lock-child.ts` that acquires a lock and waits for an IPC message before releasing. The test forks this script, waits for it to signal "lock acquired", then attempts acquisition from the parent.

```typescript
// Conceptual test structure (not exact implementation):
it('dual-process lock contention with real fork', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-fork-'));
  const lockPath = path.join(tmpDir, 'test-session.jsonl.lock');

  // Fork child process that acquires the lock
  const child = fork('./test-lock-child.js', [lockPath]);
  await waitForMessage(child, 'lock-acquired');

  // Parent attempts to acquire — should fail
  await expect(SessionLockManager.acquire(lockPath)).rejects.toThrow(/in use/);

  // Tell child to release and exit
  child.send('release');
  await waitForExit(child);

  // Now parent can acquire (stale detection or clean release)
  const handle = await SessionLockManager.acquire(lockPath);
  expect(handle).toBeDefined();
  await handle.release();

  await fs.rm(tmpDir, { recursive: true });
});
```

41. **Dual-process lock with child crash (no clean release)** — Fork child, have it acquire lock, then `child.kill('SIGKILL')` (unclean termination — no cleanup handlers run). Parent waits briefly, then attempts to acquire. The stale PID detection should succeed because the child PID is no longer running.
    - `@requirement REQ-CON-005`
    - Verify: parent acquires lock successfully after child crash
    - Verify: lock file now contains parent's PID

