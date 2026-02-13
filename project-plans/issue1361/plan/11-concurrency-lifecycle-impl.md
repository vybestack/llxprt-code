# Phase 11: Concurrency + Lifecycle Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P11`

## Prerequisites
- Required: Phase 10a completed
- Verification: `test -f project-plans/issue1361/.completed/P10a.md`
- Expected: Tests in SessionLockManager.test.ts exist and fail against stub

## Requirements Implemented (Expanded)

Implements all REQ-CON-001 through REQ-CON-006 to make Phase 10 tests pass.

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/SessionLockManager.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P11`
  - MUST reference pseudocode lines from `analysis/pseudocode/concurrency-lifecycle.md`

### Implementation from Pseudocode (MANDATORY line references)

- **Lines 10-11**: Class declaration — static class SessionLockManager
- **Lines 12-14**: getLockPath — return sessionFilePath + '.lock'
- **Lines 16-67**: acquire method:
  - **Lines 17-19**: Compute lockPath, get PID, create lock content JSON
  - **Lines 21-23**: Attempt exclusive creation with `fs.writeFile(lockPath, content, { flag: 'wx' })`
  - **Lines 24-49**: Error handling:
    - **Lines 25-39**: EEXIST — check stale, break if stale, retry, throw if not stale
    - **Lines 41-48**: ENOENT — create parent directory, retry write
  - **Lines 51-64**: Create LockHandle with release method (idempotent, best-effort unlink)
  - **Line 66**: Return handle
- **Lines 69-86**: checkStale method:
  - **Lines 71-72**: Read and parse lock file
  - **Lines 73-74**: Extract PID
  - **Lines 76-78**: process.kill(pid, 0) — signal 0 checks existence
  - **Lines 79-81**: Catch means process is dead → stale
  - **Lines 82-84**: Parse/read errors → treat as stale
- **Lines 88-98**: isLocked method — check file exists, check not stale
- **Lines 100-108**: isStale method — check file exists, return stale check result
- **Lines 110-117**: removeStaleLock method — best-effort unlink

### Shutdown Flush Integration (from pseudocode lines 125-141)
Note: The registerRecordingCleanup function will be implemented in the integration phase (Phase 26). Phase 11 implements only the SessionLockManager class itself.

### Do NOT Modify
- `packages/core/src/recording/SessionLockManager.test.ts` — Tests must not be changed

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/SessionLockManager.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/SessionLockManager.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P11" packages/core/src/recording/SessionLockManager.ts
# Expected: 1+

# Pseudocode references present
grep -c "@pseudocode" packages/core/src/recording/SessionLockManager.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/SessionLockManager.ts && echo "FAIL: Debug/TODO code"

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/SessionLockManager.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/SessionLockManager.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/SessionLockManager.ts
# Expected: No matches in implementation
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does acquire actually create a lock file with exclusive create flag ('wx')?** — [ ]
2. **Does checkStale actually use process.kill(pid, 0) for PID liveness?** — [ ]
3. **Does stale lock detection actually break the old lock and retry?** — [ ]
4. **Does release actually delete the lock file?** — [ ]
5. **Does isLocked correctly distinguish active vs stale locks?** — [ ]

#### Feature Actually Works
```bash
# Manual verification: acquire and release a lock
node -e "
const { SessionLockManager } = require('./packages/core/dist/recording/index.js');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
const fakePath = path.join(tmpDir, 'session-test.jsonl');
SessionLockManager.acquire(fakePath).then(async (handle) => {
  console.log('Lock acquired:', handle.lockPath);
  console.log('Lock exists:', fs.existsSync(handle.lockPath));
  console.log('Lock contents:', fs.readFileSync(handle.lockPath, 'utf-8'));
  console.log('isLocked:', await SessionLockManager.isLocked(fakePath));
  await handle.release();
  console.log('After release, exists:', fs.existsSync(handle.lockPath));
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

#### Integration Points Verified
- [ ] Uses node:fs/promises for file operations
- [ ] Uses process.pid for lock ownership
- [ ] Uses process.kill(pid, 0) for stale detection
- [ ] LockHandle.release() is idempotent

#### Lifecycle Verified
- [ ] Lock file created atomically (exclusive flag)
- [ ] Lock file deleted on release
- [ ] Stale locks broken transparently
- [ ] No resource leaks (released flag prevents double-unlink races)

#### Edge Cases Verified
- [ ] Non-existent parent directory → created
- [ ] Corrupt lock file → treated as stale
- [ ] Double release → no error
- [ ] Dead PID detection works cross-platform

## Success Criteria
- All Phase 10 tests pass without modification
- Implementation follows pseudocode line-by-line
- No deferred implementation patterns
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionLockManager.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P11.md`

## CRITICAL FIX: Lock State Machine Implementation Tasks

### New Methods to Implement (from pseudocode lines 210-346)

#### Task A: `getLockPathForSession()` (pseudocode lines 210-213)

**File: `packages/core/src/recording/SessionLockManager.ts`**

```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P11
 * @requirement REQ-CON-001, REQ-REC-004
 * @pseudocode concurrency-lifecycle.md lines 210-213
 */
static getLockPathForSession(chatsDir: string, sessionId: string): string {
  return path.join(chatsDir, sessionId + '.lock');
}
```

Session-ID-based lock path, independent of JSONL file existence. Used for locking BEFORE deferred materialization creates the JSONL file.

#### Task B: `acquireForSession()` (pseudocode lines 222-266)

**File: `packages/core/src/recording/SessionLockManager.ts`**

- Factory method for session-start locking
- Lock content includes `sessionId` and `state: 'pre_materialization'` fields
- Same exclusive-create (`'wx'` flag) logic as `acquire()`
- Same stale-detection + retry logic as `acquire()`
- Returns `LockHandle` with `release()` method

#### Task C: `cleanupOrphanedLocks()` (pseudocode lines 277-311)

**File: `packages/core/src/recording/SessionLockManager.ts`**

- Scans `chatsDir` for all `.lock` files
- For each stale lock (dead PID):
  - Check if corresponding JSONL file exists
  - Session-ID-based locks: look for `session-<baseName>.jsonl`
  - File-based locks: look for `<baseName>` (without `.lock` suffix)
  - Remove stale lock regardless
  - JSONL file is preserved for resume if it exists
- Active locks (alive PID) are left untouched
- Called during session cleanup (`cleanupExpiredSessions` in `packages/cli/src/utils/sessionCleanup.ts`)

#### Task D: `checkStaleWithPidReuse()` (pseudocode lines 322-346)

**File: `packages/core/src/recording/SessionLockManager.ts`**

- Enhanced stale detection that guards against PID reuse
- Locks older than 48 hours are treated as stale regardless of PID liveness
- Used as an upgrade to `checkStale()` for production reliability
- Falls back to normal PID check for locks within the age threshold

### Integration Point: Session Start Flow

In the Phase 26 integration wiring, the session initialization sequence becomes:

1. `acquireForSession(chatsDir, sessionId)` — creates lock in `PRE_MATERIALIZATION` state
2. Create `SessionRecordingService` — enqueues `session_start` but does NOT create file
3. Subscribe to HistoryService events (via RecordingIntegration)
4. First content event triggers deferred materialization → file created → implicit `MATERIALIZED` state
5. On shutdown: `registerCleanup()` → `flush()` → `release()` → lock removed → `RELEASED` state

### Updated Verification Commands

```bash
# Verify getLockPathForSession exists:
grep -n "getLockPathForSession" packages/core/src/recording/SessionLockManager.ts
# Expected: method definition

# Verify acquireForSession exists:
grep -n "acquireForSession" packages/core/src/recording/SessionLockManager.ts
# Expected: method definition

# Verify cleanupOrphanedLocks exists:
grep -n "cleanupOrphanedLocks" packages/core/src/recording/SessionLockManager.ts
# Expected: method definition

# Verify checkStaleWithPidReuse exists:
grep -n "checkStaleWithPidReuse" packages/core/src/recording/SessionLockManager.ts
# Expected: method definition

# Verify state field in lock content:
grep -n "pre_materialization" packages/core/src/recording/SessionLockManager.ts
# Expected: present in acquireForSession lock content

# All Phase 10 tests pass (including new deferred materialization tests):
cd packages/core && npx vitest run src/recording/SessionLockManager.test.ts
```

