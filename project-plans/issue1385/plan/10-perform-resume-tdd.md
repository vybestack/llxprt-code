# Phase 10: performResume — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P10`

## Prerequisites
- Required: Phase 09a completed
- Verification: `test -f project-plans/issue1385/.completed/P09a.md`
- Expected files: `packages/cli/src/services/performResume.ts` (stub from P09)

## Requirements Implemented (Expanded)

### REQ-PR-001: Single Shared Utility
**Behavior**: Both browser and direct `/continue` paths use the same function.

### REQ-PR-002: Discriminated Union Result
**Behavior**: Returns `{ ok: true, ... }` on success, `{ ok: false, error }` on failure.

### REQ-PR-003: "latest" Resolution
**Behavior**: "latest" picks first resumable (non-locked, non-current, non-empty) session.

### REQ-SW-001: Two-Phase Swap
**Behavior**: Acquires new session before disposing old.

### REQ-SW-002: Phase 1 Failure Safety
**Behavior**: Failed acquisition leaves old session intact.

### REQ-SW-003: Phase 2 Disposal Ordering
**Behavior**: RecordingIntegration disposed before RecordingService.

### REQ-SW-004: Old Lock Release
**Behavior**: Old lock released during Phase 2. Null lock skipped.

### REQ-SW-005: Lock Release Failure Tolerance
**Behavior**: Lock release failure logged as warning, new session continues.

### REQ-RC-009: Same-Session Check
**Behavior**: Returns error "That session is already active."

### REQ-RC-008: Locked Session Check
**Behavior**: Returns error "Session is in use by another process."

### REQ-EH-004: Phase 1 Failure Leaves Old Intact
**Behavior**: On Phase 1 failure, old recording/lock are untouched.

### REQ-RS-012: Warnings Propagation
**Behavior**: When `ResumeResult.warnings` contains replay warnings, they are propagated in the success result.

## Test Cases

### File to Create
- `packages/cli/src/services/__tests__/performResume.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P10`

### Test Strategy
performResume integrates with real core APIs (resumeSession, SessionDiscovery, deleteSession). Tests should use REAL JSONL session files in temp directories. For the recording infrastructure (SessionRecordingService, RecordingIntegration, LockHandle), tests need real instances since the function performs actual dispose/release operations.

Create a test helper that:
1. Creates a temp chatsDir with real JSONL session files
2. Creates real SessionRecordingService instances (writing to temp files)
3. Creates real LockHandle instances (lock files in temp dir)
4. Provides a valid ResumeContext

### BEHAVIORAL Tests

1. **Resolve by session ID**: Given a valid session ID, performResume resolves and resumes it. Returns `{ ok: true }` with history.
2. **Resolve by "latest"**: Given multiple sessions, "latest" picks the newest non-locked, non-current, non-empty session.
3. **Resolve by index**: Given "1", resumes the first (newest) session.
4. **Resolve by prefix**: Given a unique prefix, resolves to the matching session.
5. **Same-session error**: Given currentSessionId matching the target, returns `{ ok: false, error: "That session is already active." }`.
6. **Locked session error**: Given a locked target session, returns `{ ok: false, error: /in use/ }`.
7. **Missing session error**: Given a non-existent session ref, returns `{ ok: false, error }`.
8. **Ambiguous prefix error**: Given an ambiguous prefix, returns `{ ok: false, error }` with matching IDs.
9. **Out-of-range index error**: Given index "999", returns `{ ok: false, error }`.
10. **Phase 1 failure preserves old session**: When resumeSession fails, old session file still receives new events when enqueue() is called.
11. **After resume, old session file is closed**: After success, writing to old session file via old recording service has no effect (file unchanged).
12. **After resume, new events go to new file**: After success, calling newRecording.enqueue() + flush() appends to the NEW session file, not the old one.
13. **After resume, old lock file is released**: After success, the old lock file no longer exists or is stale (isLocked returns false).
14. **Phase 2 skips null lock gracefully**: When currentLockHandle is null, no error occurs.
15. **After resume, old file event count unchanged**: After success, reading old session file shows same event count as before resume (no new events written).
16. **Lock release failure tolerance**: Old lock release fails with error, function still returns `{ ok: true }` and new session is operational.
17. **"latest" with all locked**: Returns `{ ok: false, error }` indicating no resumable session.
18. **"latest" with all empty**: Returns `{ ok: false, error }` indicating no resumable session.
19. **"latest" skips current session**: The current session is excluded from "latest" resolution.
20. **History contains original messages**: On success, `result.history` includes the user message from the original session JSONL file (verify content matches).
21. **Metadata has correct sessionId**: On success, `result.metadata.sessionId` equals the target session ID from the JSONL filename.
22. **Warnings array present**: On success, `result.warnings` is an array.
22a. **Warnings from resumeSession are propagated (REQ-RS-012)**: Given a session with truncated tool response, `result.warnings` contains warning about truncation.
22b. **Empty warnings array when no issues**: Given a clean session (no truncation/corruption), `result.warnings.length === 0`.
23. **New recording writes to new session file**: On success, `result.newRecording.enqueue()` + `flush()` appends event to the NEW session file (verified by reading file).
24. **New lock holds target session**: On success, `result.newLockHandle` file path matches target session lock path, and `isLocked()` returns true for that path.

### Property-Based Tests (~30%)

25. **Property: result is always discriminated union**: For any session ref input, result has `ok: true` or `ok: false`.
26. **Property: ok:false always has error string**: For any failure, `result.error` is a non-empty string.
27. **Property: ok:true always has all fields**: For any success, history/metadata/warnings/newRecording/newLockHandle are present.
28. **Property: same-session always fails**: For any context where ref resolves to currentSessionId, result.ok is false.

### FORBIDDEN Patterns
```typescript
// NO mocking core APIs for unit tests of integration behavior
vi.mock('../recording/continueSession') // FORBIDDEN in behavioral tests

// NO reverse testing
expect(performResume(ref, ctx)).not.toThrow()

// NO mock theater - testing "was X called" instead of "did X have the expected effect"
expect(oldRecording.dispose).toHaveBeenCalled() // FORBIDDEN
expect(lockHandle.release).toHaveBeenCalled() // FORBIDDEN

// OK: Test actual effects on file system
expect(await readFile(oldSessionPath)).not.toContain('newEvent') // Old file unchanged
expect(await readFile(newSessionPath)).toContain('newEvent') // New file has event
expect(await isLockActive(oldLockPath)).toBe(false) // Lock released
```

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/services/__tests__/performResume.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P10" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 1+

# Test count
grep -c "it(" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 24+

# Property tests
grep -c "fc\.\|fast-check\|property" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 3+

# No mock theater on core APIs
grep "vi.mock.*recording\|vi.mock.*resumeSession\|vi.mock.*SessionDiscovery" packages/cli/src/services/__tests__/performResume.spec.ts && echo "FAIL: mock theater" || echo "OK"

# Tests fail against stub (expected)
cd packages/cli && npx vitest run src/services/__tests__/performResume.spec.ts 2>&1 | tail -5
# Expected: FAIL
```

## Success Criteria
- 26+ behavioral tests (including REQ-RS-012 warnings tests)
- 4+ property-based tests
- Tests use real JSONL files and real recording services
- Tests fail against stub (expected)

## Failure Recovery
```bash
git checkout -- packages/cli/src/services/__tests__/performResume.spec.ts
rm -f packages/cli/src/services/__tests__/performResume.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P10.md`

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
