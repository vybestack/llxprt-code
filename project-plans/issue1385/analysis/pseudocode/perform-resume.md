# Pseudocode: performResume — Shared Resume Utility

## Interface Contracts

```typescript
// RECORDING SWAP CALLBACKS — ref-based pattern because recordingIntegration
// is a PROP in AppContainer, not React state. The caller (gemini.tsx or a
// context provider) supplies mutable callbacks that performResume uses to
// imperatively swap recording infrastructure.
interface RecordingSwapCallbacks {
  getCurrentRecording: () => SessionRecordingService | null;
  getCurrentIntegration: () => RecordingIntegration | null;
  getCurrentLockHandle: () => LockHandle | null;
  setRecording: (
    recording: SessionRecordingService,
    integration: RecordingIntegration,
    lock: LockHandle | null,
    metadata: SessionRecordingMetadata,
  ) => void;
}

// INPUTS
interface ResumeContext {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  recordingCallbacks: RecordingSwapCallbacks;
  logger?: Logger;
}

// OUTPUTS — performResume performs ALL side-effects (swap recording,
// release old lock, acquire new) imperatively BEFORE returning.
// It does NOT return an action type. The command wrapper converts
// its result to LoadHistoryActionReturn after the swap is done.
type PerformResumeResult =
  | {
      ok: true;
      history: IContent[];
      metadata: SessionMetadata;
      warnings: string[];
    }
  | { ok: false; error: string };

// DEPENDENCIES (real, injected via context)
// - SessionDiscovery.listSessions() from core
// - SessionDiscovery.resolveSessionRef() from core
// - SessionDiscovery.hasContentEvents() from core
// - resumeSession() from core
// - SessionLockManager for lock operations
```

## Generation Guard

```
A module-level generation counter protects against concurrent/stale resume attempts:

  LET currentGeneration: number = 0

At the start of every performResume() call:
  INCREMENT currentGeneration
  LET capturedGeneration = currentGeneration

After each async operation, check:
  IF capturedGeneration !== currentGeneration THEN
    RETURN { ok: false, error: 'Resume superseded by newer attempt' }
  END IF

This ensures that if a second performResume() call is triggered before the first
completes, the first one's results are safely discarded. The generation counter
is separate from the preview-loading generation counter in useSessionBrowser.
```

## Integration Points

```
Line 20: CALL SessionDiscovery.listSessions(chatsDir, projectHash)
         - Returns SessionSummary[] sorted newest-first
         - Used for resolving session references

Line 35: CALL SessionDiscovery.resolveSessionRef(sessionRef, sessions)
         - Resolves ref to specific SessionSummary
         - May return error for ambiguous, out-of-range, not-found

Line 50: CALL resumeSession({ continueRef, projectHash, chatsDir, currentProvider, currentModel, workspaceDirs })
         - Core function that handles lock, replay, recording init
         - Returns ResumeResult or ResumeError

Line 70: CALL recordingCallbacks.getCurrentIntegration().dispose()
         - Unsubscribes from HistoryService FIRST
         - Must happen before recording service dispose

Line 75: CALL recordingCallbacks.getCurrentRecording().dispose()
         - Flushes and closes the JSONL file
         - Must happen after integration dispose

Line 80: CALL recordingCallbacks.getCurrentLockHandle().release()
         - Releases advisory lock on old session file
         - May be null for fresh (non-resumed) sessions
         - Failure is logged but not fatal

Line 85: CALL recordingCallbacks.setRecording(newRecording, newIntegration, newLock, newMetadata)
         - Installs new recording infrastructure imperatively
         - Triggers re-subscription via useEffect in AppContainer
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Dispose old session before acquiring new session
[OK] DO: Two-phase swap — acquire new FIRST, then dispose old

[ERROR] DO NOT: Use CONTINUE_LATEST or SessionSelector from sessionUtils
[OK] DO: Use SessionDiscovery.listSessions() + resolveSessionRef() directly

[ERROR] DO NOT: Swallow errors from Phase 1 (new session acquisition)
[OK] DO: Return error immediately, old session intact

[ERROR] DO NOT: Let integration dispose failure block the swap
[OK] DO: Log warning and continue on Phase 2 failures

[ERROR] DO NOT: Use React setState to swap recordingIntegration
[OK] DO: Use ref-based RecordingSwapCallbacks pattern — recordingIntegration is a PROP

[ERROR] DO NOT: Return a LoadHistoryActionReturn from performResume
[OK] DO: Perform all side-effects imperatively, return { history, metadata, warnings }
         The command wrapper converts the result to LoadHistoryActionReturn after
```

## performResume Function

```
10: // Module-level generation counter for concurrency protection
11: LET currentGeneration: number = 0
12:
13: FUNCTION ASYNC performResume(
14:   sessionRef: string,
15:   context: ResumeContext
16: ): Promise<PerformResumeResult>
17:
18:   // Increment generation counter; capture for staleness checks
19:   INCREMENT currentGeneration
20:   LET capturedGeneration = currentGeneration
21:
22:   // Step 1: Resolve session reference
23:   IF sessionRef === 'latest' THEN
24:     // Find first resumable session
25:     LET sessions = AWAIT SessionDiscovery.listSessions(context.chatsDir, context.projectHash)
26:     IF capturedGeneration !== currentGeneration THEN
27:       RETURN { ok: false, error: 'Resume superseded by newer attempt' }
28:     END IF
29:
30:     LET resumable: SessionSummary | null = null
31:
32:     FOR EACH session IN sessions
33:       IF session.sessionId === context.currentSessionId THEN CONTINUE END IF
34:       LET hasContent = AWAIT SessionDiscovery.hasContentEvents(session.filePath)
35:       IF NOT hasContent THEN CONTINUE END IF
36:       LET isLocked = AWAIT SessionLockManager.isLocked(context.chatsDir, session.sessionId)
37:       IF isLocked THEN CONTINUE END IF
38:       SET resumable = session
39:       BREAK  // First valid one (newest-first)
40:     END FOR
41:
42:     IF capturedGeneration !== currentGeneration THEN
43:       RETURN { ok: false, error: 'Resume superseded by newer attempt' }
44:     END IF
45:
46:     IF resumable IS null THEN
47:       RETURN { ok: false, error: "No resumable sessions found. All sessions are locked, empty, or in use." }
48:     END IF
49:     SET sessionRef = resumable.sessionId
50:   ELSE
51:     // Resolve specific ref (ID, prefix, or index)
52:     LET sessions = AWAIT SessionDiscovery.listSessions(context.chatsDir, context.projectHash)
53:     IF capturedGeneration !== currentGeneration THEN
54:       RETURN { ok: false, error: 'Resume superseded by newer attempt' }
55:     END IF
56:
57:     LET resolved = SessionDiscovery.resolveSessionRef(sessionRef, sessions)
58:     IF 'error' IN resolved THEN
59:       RETURN { ok: false, error: resolved.error }
60:     END IF
61:
62:     IF resolved.session.sessionId === context.currentSessionId THEN
63:       RETURN { ok: false, error: "That session is already active." }
64:     END IF
65:
66:     SET sessionRef = resolved.session.sessionId
67:   END IF
68:
69:   // Step 2: Phase 1 — Acquire new session (old session still active)
70:   TRY
71:     LET resumeResult = AWAIT resumeSession({
72:       continueRef: sessionRef,
73:       projectHash: context.projectHash,
74:       chatsDir: context.chatsDir,
75:       currentProvider: context.currentProvider,
76:       currentModel: context.currentModel,
77:       workspaceDirs: context.workspaceDirs
78:     })
79:
80:     IF capturedGeneration !== currentGeneration THEN
81:       // Stale: dispose the just-acquired session and return
82:       TRY AWAIT resumeResult.recording?.dispose() CATCH ignore END TRY
83:       TRY AWAIT resumeResult.lockHandle?.release() CATCH ignore END TRY
84:       RETURN { ok: false, error: 'Resume superseded by newer attempt' }
85:     END IF
86:
87:     IF NOT resumeResult.ok THEN
88:       RETURN { ok: false, error: resumeResult.error }
89:     END IF
90:   CATCH acquireError
91:     RETURN { ok: false, error: "Failed to resume session: " + acquireError.message }
92:   END TRY
93:
94:   // Phase 1 succeeded — new session is acquired
95:   // Phase 2: Dispose old session (best-effort), then install new
96:
97:   // Step 3: Dispose old recording integration (unsubscribes from HistoryService)
98:   LET oldIntegration = context.recordingCallbacks.getCurrentIntegration()
99:   IF oldIntegration THEN
100:    TRY
101:      CALL oldIntegration.dispose()
102:    CATCH disposeError
103:      LOG warning "Failed to dispose old recording integration: " + disposeError.message
104:    END TRY
105:  END IF
106:
107:  // Step 4: Dispose old recording service (flushes and closes file)
108:  LET oldRecording = context.recordingCallbacks.getCurrentRecording()
109:  IF oldRecording THEN
110:    TRY
111:      AWAIT oldRecording.dispose()
112:    CATCH disposeError
113:      LOG warning "Failed to dispose old recording service: " + disposeError.message
114:    END TRY
115:  END IF
116:
117:  // Step 5: Release old lock (may be null for fresh sessions)
118:  LET oldLockHandle = context.recordingCallbacks.getCurrentLockHandle()
119:  IF oldLockHandle THEN
120:    TRY
121:      AWAIT oldLockHandle.release()
122:    CATCH releaseError
123:      LOG warning "Failed to release old session lock: " + releaseError.message
124:    END TRY
125:  END IF
126:
127:  // Step 6: Install new recording infrastructure via callbacks
128:  LET newIntegration = NEW RecordingIntegration(resumeResult.recording)
129:  LET newMetadata: SessionRecordingMetadata = {
130:    sessionId: resumeResult.metadata.sessionId,
131:    filePath: resumeResult.recording.getFilePath(),
132:    startTime: resumeResult.metadata.startTime,
133:    isResumed: true
134:  }
135:
136:  CALL context.recordingCallbacks.setRecording(
137:    resumeResult.recording,
138:    newIntegration,
139:    resumeResult.lockHandle ?? null,
140:    newMetadata
141:  )
142:
143:  // Return success with history and metadata for the caller to update UI
144:  RETURN {
145:    ok: true,
146:    history: resumeResult.history,
147:    metadata: resumeResult.metadata,
148:    warnings: resumeResult.warnings ?? []
149:  }
150: END FUNCTION
```

## Recording Service Swap Detail (Phase 2 Ordering)

```
155: // CRITICAL ORDERING in Phase 2:
156: // 1. Dispose RecordingIntegration (unsubscribes HistoryService listener)
157: //    This MUST happen first to prevent events being written to closing file
158: // 2. Dispose SessionRecordingService (flushes queue, closes file)
159: //    Safe now because no new events will arrive from HistoryService
160: // 3. Release LockHandle on old session file
161: //    Best-effort; failure logged but not fatal
162: // 4. Install new recording via setRecording() callback
163: //    This updates refs in the hosting scope (gemini.tsx or context provider)
164: //    The new RecordingIntegration triggers useEffect re-subscription in AppContainer
165: //
166: // If steps 1-2 are reversed, HistoryService events could be written
167: // to a file that is being flushed/closed, causing data corruption.
168: //
169: // IMPORTANT: recordingIntegration is passed as a PROP to AppContainer from
170: // gemini.tsx (where it's a const). React setState CANNOT be used to swap it.
171: // Instead, the setRecording callback mutates refs/variables in the hosting scope.
```
