# P11 Audit: Concurrency + Lifecycle Implementation

## Plan Requirements
- Plan asks for full `SessionLockManager` implementation aligned to pseudocode, including:
  - Canonical session-ID lock path (`<chatsDir>/<sessionId>.lock`)
  - Acquire with atomic `wx`, stale-lock break + retry, ENOENT mkdir handling
  - `checkStale`, `isLocked`, `isStale`, `removeStaleLock`
  - Additional “critical fix” methods:
    - `getLockPathForSession()`
    - `acquireForSession()` with `state: 'pre_materialization'` in lock content
    - `cleanupOrphanedLocks()` behavior that checks for corresponding JSONL and removes stale lock
    - `checkStaleWithPidReuse()`
- Plan also expects annotations (`@plan`, `@pseudocode`) and no test edits.

## Pseudocode Compliance
- **Implemented and compliant (core):**
  - `getLockPath(chatsDir, sessionId)` exists and returns `<chatsDir>/<sessionId>.lock`.
  - `getLockPathFromFilePath(sessionFilePath)` exists and matches pseudocode extraction contract.
  - `acquire(chatsDir, sessionId)` implements:
    - lock content with pid/timestamp/sessionId
    - `fs.writeFile(..., { flag: 'wx' })`
    - EEXIST stale check + unlink + retry
    - ENOENT mkdir + retry
    - idempotent best-effort `release()`
  - `checkStale(lockPath)` uses `process.kill(pid, 0)` and treats read/parse errors as stale.
  - `isLocked`, `isStale`, `removeStaleLock` match expected semantics.
- **Partially compliant / divergent:**
  - `cleanupOrphanedLocks(chatsDir)` exists, scans `.lock`, checks stale, removes stale locks.
  - It does **not** implement pseudocode’s explicit JSONL existence check branch (commented intent in pseudocode), though practical effect (remove stale lock, preserve JSONL by default) is mostly equivalent.
- **Non-compliant with pseudocode narrative:**
  - `checkStaleWithPidReuse(lockPath)` adds a 48-hour age override and can mark a live-PID lock stale.
  - Pseudocode text (lines 290-296) explicitly says accepted risk is PID-only, no age-based override.

## What Was Actually Done
- `SessionLockManager.ts` is fully implemented (not a stub) with plan/pseudocode annotations present.
- API implemented around `acquire(chatsDir, sessionId)` rather than adding separate `acquireForSession()` and `getLockPathForSession()` methods from the plan’s “critical fix” section.
- Added extra method `checkStaleWithPidReuse()` with age-based stale policy.
- Added `cleanupOrphanedLocks()` that removes stale lock files but does not explicitly branch on matching `session-<id>.jsonl` existence.

## Gaps / Divergences
1. **Missing methods required by plan critical-fix section**
   - `getLockPathForSession()` not present.
   - `acquireForSession()` not present.
   - Current `getLockPath()`/`acquire()` may cover functional needs but do not match required method names/contracts in the plan.
2. **Lock content state field missing for pre-materialization path**
   - Plan calls for `state: 'pre_materialization'` in `acquireForSession()` payload.
   - Current lock content has `pid`, `timestamp`, `sessionId` only.
3. **`cleanupOrphanedLocks()` does not implement JSONL existence check logic explicitly**
   - Pseudocode includes checking corresponding JSONL to classify never-materialized vs materialized crashed sessions.
   - Current implementation removes stale locks without this explicit determination.
4. **`checkStaleWithPidReuse()` conflicts with pseudocode’s accepted-risk guidance**
   - Implemented age-based override contradicts pseudocode statement that PID liveness alone determines validity.

## Severity
- **High:** Missing `acquireForSession()` / `getLockPathForSession()` if downstream Phase 26 integration expects these exact APIs.
- **Medium:** Missing explicit `state: 'pre_materialization'` in lock content (affects observability/state-machine traceability more than lock correctness).
- **Low-Medium:** `cleanupOrphanedLocks()` missing explicit JSONL check branch (behavior mostly still safe; JSONL is not deleted).
- **Medium:** `checkStaleWithPidReuse()` semantic mismatch with pseudocode narrative (policy inconsistency; potential false stale after 48h).

## Summary Verdict
**Partial pass.**
Core concurrency lock behavior (atomic acquisition, stale detection, lifecycle release, lock-path convention) is implemented well and largely aligns with the main pseudocode body. However, there are notable divergences from the plan’s critical-fix requirements (missing `acquireForSession`/`getLockPathForSession`, missing `pre_materialization` state field) and a policy conflict in `checkStaleWithPidReuse` vs pseudocode guidance. If strict plan compliance is required, this phase should be considered **incomplete** until those gaps are reconciled.