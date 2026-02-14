# P09 Audit: Concurrency + Lifecycle Stub
## Plan Requirements
- Create `packages/core/src/recording/SessionLockManager.ts` as a **stub** for Phase P09 with markers:
  - `@plan:PLAN-20260211-SESSIONRECORDING.P09`
  - `@requirement:REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004`
- Stub methods expected:
  - `getLockPath(sessionFilePath)` => `sessionFilePath + '.lock'`
  - `acquire(sessionFilePath)` => throws NotYetImplemented
  - `checkStale(lockPath)` => throws NotYetImplemented
  - `isLocked(sessionFilePath)` => `false`
  - `isStale(sessionFilePath)` => `false`
  - `removeStaleLock(sessionFilePath)` => no-op
- Add barrel export from `packages/core/src/recording/index.ts`.
- Semantic checklist expected a static class and `acquire` returning `LockHandle`.

## What Was Actually Done
- `SessionLockManager.ts` exists and is a **fully implemented lock manager**, not a stub.
- Plan marker is `@plan PLAN-20260211-SESSIONRECORDING.P11` (not P09) and requirements include `REQ-CON-005`.
- Lock-path strategy differs from P09 text:
  - Implemented: `getLockPath(chatsDir, sessionId)` => `<chatsDir>/<sessionId>.lock`
  - Also adds `getLockPathFromFilePath(sessionFilePath)` parsing `session-<id>.jsonl`.
- `acquire(chatsDir, sessionId)` is implemented with:
  - atomic create via `fs.writeFile(..., { flag: 'wx' })`
  - stale-check and stale-lock cleanup/retry
  - ENOENT directory creation
  - returns `LockHandle` with `release()` best-effort unlink.
- `checkStale(lockPath)` is implemented using PID liveness (`process.kill(pid, 0)`).
- `isLocked`, `isStale`, `removeStaleLock` are implemented (not stubbed).
- Additional methods beyond P09 scope exist:
  - `cleanupOrphanedLocks(chatsDir)`
  - `checkStaleWithPidReuse(lockPath)` with age-based stale heuristic.

## Gaps / Divergences
1. **Phase/marker mismatch**: File is tagged to P11, not P09.
2. **Stub vs implementation mismatch**: P09 requested lifecycle/concurrency stub; reality is production-style implementation.
3. **API signature drift**:
   - P09 spec centered on `sessionFilePath` parameterization.
   - Implementation uses `(chatsDir, sessionId)` and adds a helper for file-path conversion.
4. **Behavior drift on lock naming**:
   - P09 requirement text implies sidecar `session-*.jsonl.lock`.
   - Implementation uses `sessionId.lock` in chats dir.
5. **Scope expansion**: Includes orphan cleanup and PID-reuse checks not required by P09.
6. **Auditability gap for P09 checks**:
   - Required grep marker `@plan:...P09` would fail against current file.

## Severity
- **Medium** overall.
  - No obvious regression from a functionality perspective; implementation likely supersedes stub intent.
  - But there is significant **traceability/spec conformance drift** for Phase P09 artifacts (markers, signatures, naming convention), which can break phase-gated verification and documentation alignment.

## Summary Verdict
**Partial / Not conformant to P09 as written.**
The code appears to implement a later-phase (P11) design with expanded functionality and different API/naming conventions. It is likely operationally stronger than the P09 stub target, but it does not satisfy P09’s explicit phase markers and stub-level contract requirements verbatim.