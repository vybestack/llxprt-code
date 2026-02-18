# Phase 31: End-to-End Integration — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P31`

## Prerequisites

- Required: Phase 30a completed
- Verification: `test -f project-plans/issue1385/.completed/P30a.md`
- Expected files from previous phase:
  - `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — test infrastructure from P30
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-SW-001: Two-Phase Swap
**Full Text**: When resuming a session, the system shall acquire and replay the new session before disposing the old session.
**Behavior**:
- GIVEN: An active recording session with ID "session-A"
- WHEN: The user resumes session "session-B"
- THEN: session-B is fully acquired and replayed BEFORE session-A is disposed

### REQ-SW-002: Phase 1 Failure — Old Session Intact
**Full Text**: If Phase 1 fails, the old session remains intact.
**Behavior**:
- GIVEN: Active session "session-A" and target session "session-B" is locked
- WHEN: Resume is attempted for session-B
- THEN: session-A remains the active session with no data loss

### REQ-SW-006: State Update After Swap
**Full Text**: After a successful swap, React state shall point to the new recording infrastructure.
**Behavior**:
- GIVEN: Successful resume from session-A to session-B
- WHEN: The swap completes
- THEN: Recording events go to session-B file, not session-A

### REQ-SW-007: Events to New Session
**Full Text**: After swap, events shall be recorded to the new session file.
**Behavior**:
- GIVEN: Successful resume to session-B
- WHEN: New conversation events occur
- THEN: Events appear in session-B's JSONL file

### REQ-EN-001: /continue Opens Browser
**Full Text**: `/continue` with no args opens the session browser dialog.
**Behavior**:
- GIVEN: User in an active session
- WHEN: `/continue` command returns
- THEN: Return type is `OpenDialogActionReturn` with dialog `'sessionBrowser'`

### REQ-EN-002: /continue Latest
**Full Text**: `/continue latest` resumes most recent resumable session.
**Behavior**:
- GIVEN: Multiple sessions exist, newest is unlocked
- WHEN: `/continue latest` is executed via performResume
- THEN: The newest non-current, non-empty, unlocked session is resumed

### REQ-EN-004: /continue by Index
**Full Text**: `/continue <number>` resumes the Nth session (1-based, newest-first).
**Behavior**:
- GIVEN: 5 sessions exist
- WHEN: `/continue 3` is executed
- THEN: The 3rd newest session is resumed

### REQ-CV-001: Client History Conversion
**Full Text**: `IContent[]` from resume is converted to `Content[]` via `geminiClient.restoreHistory()`.
**Behavior**:
- GIVEN: Resume returns `IContent[]` with user and model turns
- WHEN: The resume flow completes
- THEN: The client's history is set to the converted content

### REQ-CV-002: UI History Conversion
**Full Text**: `IContent[]` is converted to `HistoryItemWithoutId[]` via `iContentToHistoryItems()`.
**Behavior**:
- GIVEN: Resume returns `IContent[]` with user and model turns
- WHEN: The resume flow completes
- THEN: UI history items match the conversation content

### REQ-EH-001: Discovery Failure
**Full Text**: If session discovery fails (permissions), display "Failed to load sessions: {details}".
**Behavior**:
- GIVEN: The chats directory is unreadable
- WHEN: Session browser tries to load sessions
- THEN: An error message is set in the hook state

### REQ-EH-004: Phase 1 Failure Recovery
**Full Text**: If Phase 1 of the swap fails, the old session remains intact.
**Behavior**:
- GIVEN: Active session-A
- WHEN: resumeSession() fails for session-B
- THEN: session-A is still the active recording session

### REQ-PR-001: Single performResume Function
**Full Text**: Both browser and direct paths use a single `performResume()` function.
**Behavior**:
- GIVEN: The `performResume()` function
- WHEN: Called from the browser selection handler OR from `/continue <ref>`
- THEN: The same code path executes in both cases

### REQ-PR-003: Error Propagation
**Full Text**: `performResume()` returns errors as `{ ok: false, error: string }`.
**Behavior**:
- GIVEN: A resume that encounters an error
- WHEN: performResume completes
- THEN: Returns `{ ok: false, error: "descriptive message" }`

## Implementation Tasks

### Files to Modify

- `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — Add behavioral tests using the infrastructure from P30
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P31`
  - MUST include: `@requirement:REQ-SW-001` through applicable requirements

### Test Cases (minimum 15)

#### Core Resume Flow Tests

1. **performResume resolves "latest" to newest unlocked session** — Creates 3 sessions, calls performResume("latest"), verifies it picks the newest
   - `@requirement:REQ-EN-002, REQ-PR-001`

2. **performResume resolves numeric index** — Creates 3 sessions, calls performResume("2"), verifies it picks the 2nd
   - `@requirement:REQ-EN-004, REQ-PR-001`

3. **performResume resolves session ID** — Creates a session, calls performResume with its ID
   - `@requirement:REQ-PR-001`

4. **performResume returns error for locked session** — Creates a locked session, verifies error return
   - `@requirement:REQ-SW-002, REQ-PR-003`

5. **performResume returns error for non-existent session** — Verifies error for invalid ID
   - `@requirement:REQ-PR-003`

6. **performResume returns error for current session** — Verifies "already active" error
   - `@requirement:REQ-PR-003`

#### Two-Phase Swap Tests

7. **New session acquired before old disposed** — Verifies swap ordering (new session file is opened before old is closed)
   - `@requirement:REQ-SW-001`

8. **Failed resume preserves old session** — After a failed resume attempt, verify old recording is still active
   - `@requirement:REQ-SW-002, REQ-EH-004`

9. **After successful swap, events go to new session** — Resume a session, then write an event, verify it appears in the new file AND old file event count is unchanged
   - `@requirement:REQ-SW-006, REQ-SW-007`
   - MUST verify: `countEvents(oldSessionPath)` unchanged after new event
   - MUST verify: `countEvents(newSessionPath)` increases after new event

9a. **Swap completes without write errors** — After resume, verify old session file is valid complete JSONL (not truncated mid-write)
   - `@requirement:REQ-SW-003`
   - MUST verify: each line in old session file parses as valid JSON
   - MUST verify: no partial/truncated lines exist

#### History Conversion Tests

10. **IContent to HistoryItem conversion** — Create a session with known content, resume it, verify `iContentToHistoryItems()` produces expected UI history
    - `@requirement:REQ-CV-002`

11. **Resume returns correct history** — Verify the history array from performResume contains the expected conversation turns
    - `@requirement:REQ-CV-001`

#### Command Integration Tests

12. **continueCommand with no args returns OpenDialogActionReturn** — Verify return type
    - `@requirement:REQ-EN-001`

13. **continueCommand with "latest" returns LoadHistoryActionReturn on success** — Verify return type
    - `@requirement:REQ-EN-002`

14. **continueCommand with invalid ref returns error message** — Verify error handling
    - `@requirement:REQ-PR-003`

#### Error Handling Tests

15. **Discovery failure produces error state** — Verify error when chats directory is inaccessible
    - `@requirement:REQ-EH-001`

16. **performResume "latest" skips empty sessions** — Create an empty session (no content events) and a non-empty session, verify "latest" picks the non-empty one
    - `@requirement:REQ-EN-002`

#### Property-Based Tests (~30%)

17. **Any valid session index resolves correctly** — For N sessions, any index 1..N resolves to the correct session
    - Uses `fc.integer({ min: 1, max: N })`
    - `@requirement:REQ-EN-004`

18. **Any session ID prefix resolves if unique** — For a set of sessions with distinct IDs, any unique prefix of length >= 4 resolves correctly
    - Uses `fc.nat()` for prefix length
    - `@requirement:REQ-PR-001`

19. **performResume always returns discriminated union** — For any input (valid or invalid), result is always `{ ok: true, ... }` or `{ ok: false, error: string }`
    - Uses `fc.oneof(fc.constant('latest'), fc.string(), fc.nat().map(String))`
    - `@requirement:REQ-PR-003`

### Forbidden Patterns

```bash
grep -n "vi.mock\|jest.mock" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0 matches

grep -n "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0 matches

grep -n "NotYetImplemented" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0 matches
```

### Required Code Markers

```typescript
describe('Session Browser E2E @plan PLAN-20260214-SESSIONBROWSER.P31', () => {
  describe('performResume', () => {
    it('resolves latest to newest unlocked session @requirement:REQ-EN-002 @requirement:REQ-PR-001', () => {
      // ...
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# 1. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P31" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 15+

# 2. Requirements covered
for req in REQ-SW-001 REQ-SW-002 REQ-SW-006 REQ-SW-007 REQ-EN-001 REQ-EN-002 REQ-EN-004 REQ-CV-001 REQ-CV-002 REQ-EH-001 REQ-PR-001 REQ-PR-003; do
  echo -n "$req: "
  grep -c "@requirement:$req" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
done
# Expected: Each has 1+

# 3. Test count
grep -c "it(" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 19+

# 4. Property tests
grep -c "fc\.\|fast-check" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 3+

# 5. Forbidden patterns
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled\|NotYetImplemented" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0

# 6. Tests should fail (some components may not be fully wired yet for E2E)
npm run test -- --run packages/cli/src/__tests__/sessionBrowserE2E.spec.ts 2>&1 | tail -10
# Expected: Tests exist (some may fail if stubs remain)
```

### Semantic Verification Checklist

1. **Do tests exercise REAL component interactions?**
   - [ ] Tests create real JSONL files
   - [ ] Tests call real `performResume()` function
   - [ ] Tests verify real file I/O results

2. **Do tests cover the critical integration paths?**
   - [ ] Browser → onSelect → performResume
   - [ ] /continue latest → performResume
   - [ ] performResume → resumeSession → history conversion
   - [ ] Two-phase swap ordering

3. **Are property tests meaningful?**
   - [ ] Index resolution property covers full range
   - [ ] ID prefix resolution covers various lengths
   - [ ] Result union property verifies exhaustiveness

## tmux Harness E2E Tests

In addition to the programmatic E2E tests, this phase includes tmux-based visual UI tests.

### Files
- `scripts/oldui-tmux-script.session-browser.json` — Test script for session browser UI
- `scripts/tests/session-browser-e2e.test.js` — Jest wrapper for tmux harness

### tmux Test Scenarios

1. **Open browser with /continue**: Type `/continue` → screen shows "Session Browser" title.
2. **Keyboard navigation**: Press Down/Up → selection moves.
3. **Mode switching**: Press Tab → mode changes (search ↔ nav).
4. **Sort cycling**: In nav mode, press `s` → sort indicator changes.
5. **Search input**: Type characters → search term appears.
6. **Escape closes**: Press Escape → browser closes.
7. **Session count visible**: Screen shows "N sessions found".

### tmux Verification Commands

```bash
# Run tmux harness test
node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.session-browser.json --assert

# Run via test runner
npx vitest run scripts/tests/session-browser-e2e.test.js
```

## Success Criteria

- 19+ programmatic tests covering 12+ requirements
- At least 3 property-based tests
- tmux harness test passing
- No forbidden patterns
- All tests use real filesystem, no mocks
- Tests fail naturally where implementation is incomplete

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/__tests__/sessionBrowserE2E.spec.ts`
2. Re-run Phase 31 with corrected tests

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P31.md`
Contents:
```markdown
Phase: P31
Completed: YYYY-MM-DD HH:MM
Tests Added: [count]
Tests Failing: [count] (some expected)
Verification: [paste of verification command outputs]
```
