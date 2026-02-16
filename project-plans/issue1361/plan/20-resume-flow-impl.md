# Phase 20: Resume Flow Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P20`

## Prerequisites
- Required: Phase 19a completed
- Verification: `test -f project-plans/issue1361/.completed/P19a.md`
- Expected: Tests in SessionDiscovery.test.ts and resumeSession.test.ts exist and fail

## Requirements Implemented (Expanded)

Implements all REQ-RSM-001 through REQ-RSM-006 to make Phase 19 tests pass.

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/SessionDiscovery.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P20`
  - MUST reference pseudocode lines from `analysis/pseudocode/session-management.md`

- `packages/core/src/recording/resumeSession.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P20`
  - MUST reference pseudocode lines from `analysis/pseudocode/resume-flow.md`

### IMPORTANT: API Usage Notes
- **History seeding**: The resume flow returns `IContent[]` to the caller. At the integration point (Phase 26), the history MUST be seeded via `client.restoreHistory(history)` (packages/core/src/core/client.ts:762), NOT via `historyService.addAll()` directly. `client.restoreHistory()` ensures chat/content generator readiness.
- **UI reconstruction**: `convertToUIHistory` is a `useCallback` inside AppContainer.tsx — it is NOT an importable utility function. The resume flow passes `IContent[]` to AppContainer, and UI reconstruction happens there.
- **Pseudocode references**: This phase should reference BOTH `analysis/pseudocode/resume-flow.md` for the `resumeSession` function and `analysis/pseudocode/session-management.md` for `SessionDiscovery`.

### SessionDiscovery Implementation from Pseudocode (session-management.md)

- **Lines 10-11**: Class declaration — static class SessionDiscovery
- **Lines 12-45**: listSessions method:
  - **Lines 13-18**: Read directory, handle ENOENT
  - **Lines 20**: Filter for session-*.jsonl files
  - **Lines 22-40**: For each file: readSessionHeader, filter by projectHash, stat for mtime/size
  - **Lines 42-44**: Sort by lastModified descending, return
- **Lines 47-67**: resolveSessionRef method:
  - **Lines 48-50**: Exact session ID match
  - **Lines 52-58**: Unique prefix match (with ambiguity error)
  - **Lines 60-64**: Numeric index (1-based)
  - **Line 66**: Not found error

### resumeSession Implementation from Pseudocode (resume-flow.md)

- **Lines 50-51**: Function signature
- **Lines 52-56**: Step 1: Discover sessions, handle empty
- **Lines 58-77**: Step 2: Resolve target session:
  - **Lines 60-70**: CONTINUE_LATEST → find most recent unlocked session
  - **Lines 71-77**: Specific ref → use resolveSessionRef
- **Lines 79-84**: Step 3: Acquire lock (with error handling)
- **Lines 86-91**: Step 4: Replay session (release lock on failure)
- **Lines 93-102**: Step 5: Initialize recording for append
  - Create SessionRecordingService with metadata from replay
  - Call initializeForResume(filePath, lastSeq)
- **Lines 104-111**: Step 6: Handle provider mismatch — record warning and provider_switch
- **Lines 113-115**: Step 7: Record resume session_event
- **Lines 117-123**: Step 8: Return ResumeResult with history, metadata, recording, warnings

### Do NOT Modify
- `packages/core/src/recording/SessionDiscovery.test.ts` — Tests must not be changed
- `packages/core/src/recording/resumeSession.test.ts` — Tests must not be changed

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/SessionDiscovery.test.ts
cd packages/core && npx vitest run src/recording/resumeSession.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/SessionDiscovery.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL"
git diff packages/core/src/recording/resumeSession.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL"

# Plan markers
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P20" packages/core/src/recording/SessionDiscovery.ts
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P20" packages/core/src/recording/resumeSession.ts
# Expected: 1+ each

# Pseudocode references
grep -c "@pseudocode" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts
# Expected: 1+ total

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts && echo "FAIL"

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/SessionDiscovery.ts packages/core/src/recording/resumeSession.ts
# Expected: No matches
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does listSessions actually read session file headers?** — [ ]
2. **Does resolveSessionRef handle all three resolution modes (exact, prefix, index)?** — [ ]
3. **Does resumeSession acquire lock before replay?** — [ ]
4. **Does resumeSession release lock on replay failure?** — [ ]
5. **Does initializeForResume set correct filePath and lastSeq?** — [ ]

#### Feature Actually Works
```bash
# Manual verification: create sessions, then discover and resume
node -e "
const { SessionRecordingService, SessionDiscovery, resumeSession, CONTINUE_LATEST } = require('./packages/core/dist/recording/index.js');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
// Create a session
const svc = new SessionRecordingService({
  sessionId: 'sess-resume-test',
  projectHash: 'hash-xyz',
  chatsDir: tmpDir,
  workspaceDirs: ['/project'],
  provider: 'anthropic',
  model: 'claude-4'
});
svc.recordContent({ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] });
svc.recordContent({ speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there!' }] });
svc.flush().then(async () => {
  await svc.dispose();
  // Now discover and resume
  const sessions = await SessionDiscovery.listSessions(tmpDir, 'hash-xyz');
  console.log('Discovered sessions:', sessions.length);
  const result = await resumeSession({
    continueRef: CONTINUE_LATEST,
    projectHash: 'hash-xyz',
    chatsDir: tmpDir,
    currentProvider: 'anthropic',
    currentModel: 'claude-4'
  });
  if (result.ok) {
    console.log('Resume success! History items:', result.history.length);
    console.log('Session ID:', result.metadata.sessionId);
  } else {
    console.log('Resume error:', result.error);
  }
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

#### Integration Points Verified
- [ ] SessionDiscovery uses readSessionHeader from ReplayEngine
- [ ] resumeSession uses replaySession from ReplayEngine
- [ ] resumeSession uses SessionLockManager for locking
- [ ] resumeSession uses SessionRecordingService for continued recording

#### Lifecycle Verified
- [ ] Lock acquired before replay, released on failure
- [ ] Recording initialized after successful replay
- [ ] Provider mismatch handled correctly

#### Edge Cases Verified
- [ ] No sessions → clear error
- [ ] All locked → clear error
- [ ] Ambiguous prefix → error with matching IDs listed
- [ ] Invalid session ref → clear error

## Success Criteria
- All Phase 19 tests pass without modification
- Implementation follows pseudocode
- No deferred implementation patterns
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.ts
git checkout -- packages/core/src/recording/resumeSession.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P20.md`


---

## Addendum: session_event Exclusion from Reconstructed UI

### Requirement
When the resume flow reconstructs the conversation for display, it MUST exclude historical `session_event` records from the `IContent[]` passed to the UI layer.

### Implementation Detail
- The `ReplayResult` from the replay engine contains `history: IContent[]` (conversation content) and `sessionEvents: SessionEvent[]` (operational metadata), as separate fields.
- The resume flow passes `history` (NOT `sessionEvents`) to the UI reconstruction path.
- The `ResumeResult` returned by `resumeSession()` includes:
  - `history: IContent[]` — conversation content only, suitable for `client.restoreHistory()` and `convertToUIHistory()`.
  - `sessionEvents: SessionEvent[]` — retained for audit logging but NOT passed to AppContainer or any UI rendering code.
- `convertToUIHistory` (in AppContainer.tsx) receives only `IContent[]` items — it never sees `session_event` data.

### Why This Matters
If `session_event` records leaked into the UI history, they would appear as malformed conversation entries (no speaker, no text blocks) and break the UI rendering pipeline. The separation is enforced at the replay engine level and respected at the resume flow level.


---

## Addendum: Sub-Task Breakdown for Phase Density Management

### Context
Phase 20 implements two separate modules (SessionDiscovery + resumeSession) with different concerns (file system listing vs. session reconstruction). Breaking into sub-tasks makes scope manageable.

### Sub-Task Breakdown

#### Sub-Task 20.1: SessionDiscovery.listSessions() Implementation
- **Scope**: Implement directory reading, `.jsonl` file filtering, header parsing for each file, project hash filtering, sorting by mtime.
- **Files**: `packages/core/src/recording/SessionDiscovery.ts` (listSessions method)
- **Complexity**: Medium — file I/O with error handling (ENOENT, permission errors, malformed headers).
- **Estimated effort**: ~40 minutes
- **Risk**: Must handle partial reads gracefully (file deleted between readdir and stat). Must filter by projectHash correctly.
- **Verification**: SessionDiscovery listing tests pass.

#### Sub-Task 20.2: SessionDiscovery.resolveSessionRef() Implementation
- **Scope**: Implement exact ID match, unique prefix match (with ambiguity error), numeric index resolution.
- **Files**: `packages/core/src/recording/SessionDiscovery.ts` (resolveSessionRef method)
- **Complexity**: Medium — three resolution strategies with precedence rules and error cases.
- **Estimated effort**: ~30 minutes
- **Risk**: Numeric-looking prefixes must be handled correctly (pure digits = index, not prefix). Ambiguity detection must list all matching IDs in error message.
- **Verification**: SessionDiscovery resolution tests pass (including ambiguity edge cases from addendum).

#### Sub-Task 20.3: resumeSession() — Session Selection and Lock Acquisition
- **Scope**: Implement steps 1-3: discover sessions, resolve target (CONTINUE_LATEST or specific ref), acquire lock with error handling.
- **Files**: `packages/core/src/recording/resumeSession.ts` (steps 1-3)
- **Complexity**: Medium — lock acquisition must handle "already locked" errors gracefully and release on failure.
- **Estimated effort**: ~30 minutes
- **Risk**: Lock must be released in all error paths (use try/finally pattern).
- **Verification**: Lock-related resume tests pass.

#### Sub-Task 20.4: resumeSession() — Replay, Recording Init, and Result Assembly
- **Scope**: Implement steps 4-8: replay session file, initialize recording for append, handle provider mismatch, record resume event, assemble ResumeResult.
- **Files**: `packages/core/src/recording/resumeSession.ts` (steps 4-8)
- **Complexity**: **High** — must correctly wire ReplayResult into RecordingService initialization, handle provider mismatch warnings, and ensure the ResumeResult contract is complete.
- **Estimated effort**: ~45 minutes
- **Risk**: Incorrect lastSeq from replay breaks append sequencing. Provider mismatch handling must record both warning and provider_switch event.
- **Verification**: All Phase 19 resumeSession tests pass.

#### Sub-Task 20.5: End-to-End Verification
- **Scope**: Run full test suite, verify plan markers, check for deferred implementation, run TypeScript compilation.
- **Files**: None modified — verification only.
- **Complexity**: Low
- **Estimated effort**: ~15 minutes

### Recommended Execution Order
20.1 → 20.2 → 20.3 → 20.4 → 20.5

Rationale: Build discovery first (20.1-20.2) since resumeSession depends on it, then build the resume flow in dependency order (lock before replay before result assembly).
