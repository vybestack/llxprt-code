# Phase 26: System Integration Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P26`

## Prerequisites
- Required: Phase 25a completed
- Verification: `test -f project-plans/issue1361/.completed/P25a.md`
- Expected: Integration tests in integration.test.ts exist and fail (or partially fail) against stubs

## Requirements Implemented (Expanded)

Implements the full end-to-end wiring of all recording components into the existing system. This is the phase where the session recording feature becomes reachable by users through the CLI.

### REQ-INT-WIRE-001: Bootstrap SessionRecordingService on Startup
**Full Text**: When a new CLI session starts, a SessionRecordingService instance MUST be created and connected to the session lifecycle.
**Behavior**:
- GIVEN: User starts `llxprt` without `--continue`
- WHEN: Application bootstraps in gemini.tsx
- THEN: A SessionRecordingService is created with sessionId, projectHash, chatsDir, workspaceDirs, provider, model
**Why This Matters**: If recording never starts, nothing gets persisted — the entire feature is dead.

### REQ-INT-WIRE-002: Connect HistoryService Events to Recording
**Full Text**: When content is added to HistoryService, RecordingIntegration MUST capture it for recording.
**Behavior**:
- GIVEN: SessionRecordingService and RecordingIntegration are initialized
- WHEN: HistoryService emits 'contentAdded' (user message, AI response, tool result)
- THEN: RecordingIntegration.subscribeToHistory relays it to SessionRecordingService.recordContent
**Why This Matters**: Without event subscription, content silently vanishes — sessions appear empty on resume.

### REQ-INT-WIRE-003: Flush at Turn Boundaries
**Full Text**: At the end of each user-AI turn (after tool results are committed), the recording MUST be flushed to disk.
**Behavior**:
- GIVEN: RecordingIntegration is subscribed and recording is active
- WHEN: useGeminiStream's submitQuery completes (finally block)
- THEN: `recordingIntegration.flushAtTurnBoundary()` is awaited
**Why This Matters**: Without flush, a crash loses the entire session — durability requires explicit writes.

### REQ-INT-WIRE-004: Connect --continue Flag to Resume Flow
**Full Text**: When user starts `llxprt --continue [ref]`, the system MUST discover and resume the indicated session.
**Behavior**:
- GIVEN: Config.isContinueSession() returns true
- WHEN: gemini.tsx runs session setup
- THEN: SessionDiscovery finds session, SessionLockManager acquires lock, ReplayEngine rebuilds history, SessionRecordingService resumes with lastSeq
**Why This Matters**: This is the user-facing resume feature — without it, `--continue` does nothing.

### REQ-INT-WIRE-005: Dispose Recording on Session Exit
**Full Text**: When the session exits (normal or abnormal), the recording MUST be flushed and disposed.
**Behavior**:
- GIVEN: Session is active with recording
- WHEN: Session exits (user types /exit, Ctrl+C, or crash)
- THEN: RecordingIntegration.dispose() is called, SessionRecordingService.flush() and dispose() are called, lock is released
**Why This Matters**: Incomplete JSONL files and dangling locks corrupt future sessions.

### REQ-INT-WIRE-006: Re-subscribe on Compression
**Full Text**: When compression creates a new HistoryService instance, RecordingIntegration MUST re-subscribe.
**Behavior**:
- GIVEN: Compression triggers and new GeminiChat + HistoryService are created
- WHEN: The new HistoryService is available
- THEN: RecordingIntegration.onHistoryServiceReplaced(newHistoryService) is called
**Why This Matters**: Without re-subscription, all content after compression is lost.

## Implementation Tasks

### Implementation from Pseudocode (MANDATORY line references from `analysis/pseudocode/recording-integration.md`)

#### Session Initialization (New Session) — Pseudocode Lines 115-132
- **Lines 115-128**: In gemini.tsx, create SessionRecordingService with sessionId, projectHash, chatsDir, workspaceDirs, provider, model
  - **projectHash**: Obtain via `import { getProjectHash } from '../utils/paths.js'` (from `packages/core/src/utils/paths.ts`), then call `getProjectHash(config.getBaseDir())`. Do NOT assume projectHash is a Config method — it is a standalone utility function.
  - **chatsDir**: Construct as `path.join(config.getProjectTempDir(), 'chats')`. There is NO `getChatsDir()` method on Config. The chats directory must be explicitly derived.
- **Lines 130-132**: Create RecordingIntegration wrapping the SessionRecordingService

#### HistoryService Subscription — Pseudocode Lines 38-59
- **Lines 38-40**: subscribeToHistory: unsubscribe from previous first
- **Lines 43-46**: Subscribe to 'contentAdded' event → recordContent
- **Lines 49-52**: Subscribe to 'compressed' event → recordCompressed
- **Lines 55-58**: Store cleanup function for both handlers

#### Flush at Turn Boundary — Pseudocode Lines 90-109
- **Lines 100-108**: In useGeminiStream's finally block, call recordingIntegration.flushAtTurnBoundary() with try/catch (non-fatal on failure)

#### HistoryService Re-subscription on Compression — Pseudocode Lines 140-157
- **EXACT HOOKPOINT**: In geminiChat.ts, the compression callback (~line 1475) creates a new GeminiChat with a new HistoryService. The hookpoint for re-subscription is:
  1. In the compression callback in geminiChat.ts, BEFORE replacing the old HistoryService: emit `'compressed'` on the old HistoryService so RecordingIntegration captures it
  2. After the new GeminiChat/HistoryService is created and returned to AppContainer: call `recordingIntegration.onHistoryServiceReplaced(newHistoryService)`
  3. The call to `onHistoryServiceReplaced` should be placed in AppContainer.tsx (or the hook that receives the new client after compression), where the new HistoryService reference becomes available
- **Lines 155-156**: `onHistoryServiceReplaced(newHistoryService)` calls `subscribeToHistory(newHistoryService)` which handles unsubscription from old + subscription to new

### Files to Modify
- `packages/cli/src/gemini.tsx` — Wire up session recording at startup and --continue resume
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P26`
  - Add SessionRecordingService creation during bootstrap
  - Add --continue detection and resume flow (SessionDiscovery → lock → replay → resume)
  - Add recording disposal on session exit
  - Reference pseudocode lines 115-132

- `packages/cli/src/ui/AppContainer.tsx` — Pass recording integration to hooks
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P26`
  - Thread RecordingIntegration through to useGeminiStream
  - Connect HistoryService re-subscription on compression

- `packages/cli/src/ui/hooks/useGeminiStream.ts` — Add flush at turn boundaries
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P26`
  - In submitQuery's finally block, call flushAtTurnBoundary()
  - Reference pseudocode lines 90-109

- `packages/core/src/config/config.ts` — Ensure getContinueSessionRef() returns the correct value
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P26` (if modified)
  - getContinueSessionRef() returns string for named session, null for bare --continue

### Files NOT to Modify
- `packages/core/src/recording/integration.test.ts` — Tests must not be changed
- `packages/core/src/recording/SessionRecordingService.ts` — Already implemented
- `packages/core/src/recording/RecordingIntegration.ts` — Already implemented
- `packages/core/src/recording/ReplayEngine.ts` — Already implemented
- `packages/core/src/recording/SessionDiscovery.ts` — Already implemented
- `packages/core/src/recording/SessionLockManager.ts` — Already implemented

## Required Code Markers

Every function/method modified in this phase MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines X-Y
 */
```

## Verification Commands

```bash
# Integration tests pass
cd packages/core && npx vitest run src/recording/integration.test.ts
# Expected: All pass

# Full test suite passes
npm run test 2>&1 | tail -20

# TypeScript compiles
npm run typecheck

# Build succeeds
npm run build

# Lint passes
npm run lint

# Plan markers present in all modified files
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P26" packages/cli/src/gemini.tsx
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P26" packages/cli/src/ui/AppContainer.tsx
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P26" packages/cli/src/ui/hooks/useGeminiStream.ts
# Expected: 1+ each

# Pseudocode references present
grep -c "@pseudocode" packages/cli/src/gemini.tsx
# Expected: 1+

# No debug code in modified files
grep -rn "console\.log\|TODO\|FIXME\|XXX" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts | grep -v "test\." && echo "WARNING: Debug/TODO code"

# --continue flag is wired
grep -q "isContinueSession\|getContinueSessionRef" packages/cli/src/gemini.tsx || echo "FAIL: --continue not wired"

# Recording service is created
grep -q "new SessionRecordingService\|SessionRecordingService(" packages/cli/src/gemini.tsx || echo "FAIL: Recording service not created"

# Flush at turn boundary is wired
grep -q "flushAtTurnBoundary" packages/cli/src/ui/hooks/useGeminiStream.ts || echo "FAIL: Flush not wired"

# Dispose is wired
grep -q "dispose\|recording.*dispose\|integration.*dispose" packages/cli/src/gemini.tsx || echo "FAIL: Dispose not wired"
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts | grep -v ".test."
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts
# Expected: No matches in implementation code
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Is SessionRecordingService actually instantiated during bootstrap?** — [ ]
   - Trace: gemini.tsx → session setup → `new SessionRecordingService(config)` → active service
2. **Is RecordingIntegration actually subscribed to HistoryService events?** — [ ]
   - Trace: integration.subscribeToHistory(historyService) → 'contentAdded' listener registered
3. **Does flushAtTurnBoundary actually get called after each AI response?** — [ ]
   - Trace: useGeminiStream → submitQuery → finally → flushAtTurnBoundary()
4. **Does --continue actually trigger the resume flow?** — [ ]
   - Trace: config.isContinueSession() → SessionDiscovery → lock → ReplayEngine → resume
5. **Does session exit actually flush and dispose?** — [ ]
   - Trace: exit handler → recording.flush() → recording.dispose() → lock.release()

#### Feature Actually Works
```bash
# Smoke test: start a session, verify JSONL file is created
npm run build
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# After session exits, check for .jsonl file:
find ~/.llxprt -name "*.jsonl" -newer /tmp/before-test -type f 2>/dev/null | head -5
# Expected: At least one .jsonl file created

# Verify JSONL content is valid
JSONL_FILE=$(find ~/.llxprt -name "*.jsonl" -newer /tmp/before-test -type f 2>/dev/null | head -1)
[ -n "$JSONL_FILE" ] && head -5 "$JSONL_FILE" | while read line; do echo "$line" | python3 -m json.tool > /dev/null 2>&1 && echo "OK" || echo "INVALID JSON"; done
```

#### Integration Points Verified
- [ ] gemini.tsx creates SessionRecordingService with correct config values
- [ ] AppContainer receives and threads RecordingIntegration to hooks
- [ ] useGeminiStream calls flushAtTurnBoundary() in finally block
- [ ] --continue flag triggers SessionDiscovery → lock → replay → resume chain
- [ ] Compression re-subscription is wired (onHistoryServiceReplaced called)
- [ ] Session exit calls dispose on both integration and recording service

#### Lifecycle Verified
- [ ] Recording service created before first HistoryService event
- [ ] Subscription established before first user message processed
- [ ] Flush awaited (not fire-and-forget) at turn boundaries
- [ ] Dispose called on all exit paths (normal, /exit, Ctrl+C)
- [ ] Lock released even on abnormal exit

#### Edge Cases Verified
- [ ] --continue with invalid session ref fails gracefully
- [ ] --continue when no sessions exist shows helpful message
- [ ] Flush failure is non-fatal (session continues working)
- [ ] Recording disabled by config still allows session to work

## Success Criteria
- All Phase 25 integration tests pass without modification
- Implementation follows pseudocode from recording-integration.md
- No deferred implementation patterns
- TypeScript compiles cleanly
- Full build succeeds
- Smoke test produces valid JSONL file

## Failure Recovery
```bash
git checkout -- packages/cli/src/gemini.tsx
git checkout -- packages/cli/src/ui/AppContainer.tsx
git checkout -- packages/cli/src/ui/hooks/useGeminiStream.ts
git checkout -- packages/core/src/config/config.ts
# Re-implement following pseudocode more carefully
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P26.md`
