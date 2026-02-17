# Phase 11: performResume — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P11`

## Prerequisites
- Required: Phase 10a completed
- Verification: `test -f project-plans/issue1385/.completed/P10a.md`
- Expected files:
  - `packages/cli/src/services/performResume.ts` (stub from P09)
  - `packages/cli/src/services/__tests__/performResume.spec.ts` (tests from P10)

## Requirements Implemented (Expanded)

### REQ-PR-001 / REQ-PR-002: Shared Utility + Result Contract
**Full Text**: `performResume` is the single resume orchestrator for browser and direct command paths and returns `{ ok: true, history, metadata, warnings }` on success, `{ ok: false, error }` on failure.
**Behavior**:
- GIVEN: A resume ref from either path
- WHEN: `performResume` completes
- THEN: Side-effects are already applied and caller receives the discriminated union payload
**Why This Matters**: Eliminates duplicate resume orchestration and keeps command/browser behavior aligned.

### REQ-SW-001 through REQ-SW-005: Two-Phase Swap + Ordered Disposal
**Full Text**: Acquire new session before disposing old; dispose old integration before old recording; release old lock best-effort.
**Behavior**:
- GIVEN: A successful acquisition
- WHEN: Performing Phase 2
- THEN: integration.dispose -> recording.dispose -> lock.release ordering is maintained

### REQ-PR-005: Generation Guard
**Full Text**: Stale or superseded resume attempts are discarded.
**Behavior**:
- GIVEN: concurrent/superseded attempts
- WHEN: an older attempt reaches async continuation
- THEN: it exits with stale/superseded error and best-effort disposes acquired resources if acquisition already happened

## Implementation Tasks

### Files to Modify
- `packages/cli/src/services/performResume.ts`
  - Replace stub logic with real implementation
  - Preserve `@plan PLAN-20260214-SESSIONBROWSER.P09`
  - Add `@plan PLAN-20260214-SESSIONBROWSER.P11`
  - Implement algorithm from pseudocode `perform-resume.md` lines 10-170

### Implementation Notes
- Use `SessionDiscovery.listSessions(chatsDir, projectHash)` for ref-resolution source set.
- In `latest` flow iterate newest-first and skip candidate when:
  - `session.sessionId === currentSessionId`
  - `SessionLockManager.isLocked(chatsDir, session.sessionId)` returns true
  - `SessionDiscovery.hasContentEvents(session.filePath)` returns false
- Resolve non-latest refs with `SessionDiscovery.resolveSessionRef(ref, sessions)`.
- Acquire new session via `resumeSession(...)` before disposing old infrastructure.
- If generation becomes stale after acquisition, dispose `resumeResult.recording` and `resumeResult.lockHandle` best-effort and return stale/superseded error.
- Dispose old infrastructure in this order:
  1. `recordingCallbacks.getCurrentIntegration()?.dispose()`
  2. `await recordingCallbacks.getCurrentRecording()?.dispose()`
  3. `await recordingCallbacks.getCurrentLockHandle()?.release()` (warning-only failure)
- Install new infrastructure via:
  `recordingCallbacks.setRecording(newRecording, newIntegration, newLock, newMetadata)`
- Return success payload only with `history`, `metadata`, `warnings`.

### Do NOT Modify
- `packages/cli/src/services/__tests__/performResume.spec.ts` — tests must pass unchanged.

## Verification Commands
```bash
# Phase tests pass
cd packages/cli && npx vitest run src/services/__tests__/performResume.spec.ts

# Marker checks
grep -q "@plan PLAN-20260214-SESSIONBROWSER.P09" packages/cli/src/services/performResume.ts || echo "FAIL: missing P09 marker"
grep -q "@plan PLAN-20260214-SESSIONBROWSER.P11" packages/cli/src/services/performResume.ts || echo "FAIL: missing P11 marker"
grep -q "@pseudocode" packages/cli/src/services/performResume.ts || echo "FAIL: missing pseudocode marker"

# Contract checks (no newRecording/newLock/newIntegration in success type)
! rg -n "newRecording|newLockHandle|newRecordingIntegration" packages/cli/src/services/performResume.ts || echo "FAIL: stale success-shape field present"

# Lock signature usage check
rg -n "SessionLockManager\.isLocked\(.*chatsDir.*,.*sessionId" packages/cli/src/services/performResume.ts || echo "FAIL: wrong isLocked signature"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Deferred Implementation Detection
```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" packages/cli/src/services/performResume.ts
# Expected: no matches

rg -n "return \[\]|return \{\}|return null|return undefined" packages/cli/src/services/performResume.ts
# Expected: no placeholder returns except valid discriminated-union branches
```

## Feature Actually Works
Manual command:
```bash
cd packages/cli && npx vitest run src/services/__tests__/performResume.spec.ts --reporter=verbose
```
Expected: all performResume behavioral tests pass, including stale-discard and two-phase ordering paths.

### Semantic Verification Questions (YES required)
1. YES/NO — Does `performResume` perform swap side-effects before returning success payload?
2. YES/NO — Does success payload contain only `history`, `metadata`, and `warnings` plus `ok: true`?
3. YES/NO — Is lock check invoked with `SessionLockManager.isLocked(chatsDir, sessionId)`?
4. YES/NO — On stale-after-acquire, are newly acquired recording/lock resources disposed best-effort before return?
5. YES/NO — Is disposal order old integration -> old recording -> old lock explicitly implemented?

## Integration Points Verified
- Browser flow calls the same `performResume` path as direct `/continue <ref>` flow.
- `recordingCallbacks.setRecording(...)` is the handoff boundary to hosting scope for prop/ref-based recording integration swap.
- Result payload is directly convertible by caller to `LoadHistoryActionReturn` without duplicate side-effect logic.

## Success Criteria
- All P10 tests pass unchanged.
- No deferred implementation markers remain.
- Side-effect-first swap model and success payload contract match pseudocode/spec.
- Lock signature and stale-discard behaviors are implemented and verifiable.

## Failure Recovery
```bash
git checkout -- packages/cli/src/services/performResume.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P11.md`
