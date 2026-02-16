# Pseudocode: Resume Flow / --continue (Issue #1365)

## Interface Contracts

```typescript
// INPUTS
interface ResumeRequest {
  continueRef: string | typeof CONTINUE_LATEST;  // from CLI args
  projectHash: string;
  chatsDir: string;
  currentProvider: string;
  currentModel: string;
}

// OUTPUTS
interface ResumeResult {
  ok: true;
  history: IContent[];
  metadata: SessionMetadata;
  recording: SessionRecordingService;  // Initialized for append
  warnings: string[];
}

interface ResumeError {
  ok: false;
  error: string;
}

// DEPENDENCIES (real)
// - SessionDiscovery (shared utility)
// - ReplayEngine (from #1363)
// - SessionRecordingService (from #1362)
// - SessionLockManager (from #1367)
```

## Integration Points

```
Line 25: CALL sessionDiscovery.listSessions(chatsDir, projectHash)
         - Returns SessionSummary[] sorted newest-first

Line 45: CALL sessionLockManager.acquire(filePath)
         - Must succeed before replay begins
         - Failure means "Session is in use"

Line 55: CALL replaySession(filePath, projectHash)
         - Returns ReplayResult with history, metadata, lastSeq

Line 85: CALL recording.initializeForResume(filePath, lastSeq)
         - Configures recording to append to existing file
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Read entire file to find session ID (use SessionDiscovery)
[OK] DO: Read only first line per file for discovery

[ERROR] DO NOT: Start recording before replay completes
[OK] DO: Replay first, then initialize recording for append

[ERROR] DO NOT: Re-display historical session_events
[OK] DO: Only show the "Session resumed" info message
```

## CLI Flag Changes

```
10: // In yargs option definition (gemini.tsx or CLI args):
11: OPTION 'continue' = {
12:   alias: 'C',
13:   type: 'string',
14:   skipValidation: true,
15:   description: 'Resume a previous session',
16:   coerce: (value) => {
17:     IF value === '' OR value === true THEN
18:       RETURN CONTINUE_LATEST  // sentinel constant
19:     END IF
20:     RETURN String(value)
21:   }
22: }
23:
24: CONSTANT CONTINUE_LATEST = '__CONTINUE_LATEST__'
```

## Config Changes

```
30: // In Config class (packages/core/src/config/config.ts):
31: // Change continueSession from boolean to string | boolean
32:
33: FIELD continueSession: string | boolean = false
34:
35: METHOD isContinueSession(): boolean
36:   RETURN this.continueSession !== false AND this.continueSession !== undefined
37: END METHOD
38:
39: METHOD getContinueSessionRef(): string | null
40:   IF this.continueSession === true OR this.continueSession === CONTINUE_LATEST
41:     RETURN null  // bare --continue, use most recent
42:   END IF
43:   IF typeof this.continueSession === 'string'
44:     RETURN this.continueSession  // specific session ref
45:   END IF
46:   RETURN null
47: END METHOD
```

## Resume Flow

```
50: FUNCTION ASYNC resumeSession(request: ResumeRequest): ResumeResult | ResumeError
51:   // Step 1: Discover sessions
52:   LET sessions = AWAIT SessionDiscovery.listSessions(request.chatsDir, request.projectHash)
53:
54:   IF sessions.length == 0 THEN
55:     RETURN { ok: false, error: "No sessions found for this project" }
56:   END IF
57:
58:   // Step 2: Resolve which session to resume
59:   LET targetSession: SessionSummary
60:   IF request.continueRef == CONTINUE_LATEST THEN
61:     // Find most recent unlocked session
62:     FOR EACH session IN sessions (newest first)
63:       IF NOT SessionLockManager.isLocked(session.filePath) THEN
64:         SET targetSession = session
65:         BREAK
66:       END IF
67:     END FOR
68:     IF targetSession == undefined THEN
69:       RETURN { ok: false, error: "All sessions for this project are in use" }
70:     END IF
71:   ELSE
72:     LET resolved = SessionDiscovery.resolveSessionRef(request.continueRef, sessions)
73:     IF resolved.error THEN
74:       RETURN { ok: false, error: resolved.error }
75:     END IF
76:     SET targetSession = resolved.session
77:   END IF
78:
79:   // Step 3: Acquire lock
80:   TRY
81:     AWAIT SessionLockManager.acquire(targetSession.filePath)
82:   CATCH lockError
83:     RETURN { ok: false, error: "Session is in use by another process" }
84:   END TRY
85:
86:   // Step 4: Replay
87:   LET replayResult = AWAIT replaySession(targetSession.filePath, request.projectHash)
88:   IF NOT replayResult.ok THEN
89:     CALL SessionLockManager.release(targetSession.filePath)
90:     RETURN { ok: false, error: "Failed to replay session: " + replayResult.error }
91:   END IF
92:
93:   // Step 5: Initialize recording for append
94:   LET recording = new SessionRecordingService({
95:     sessionId: replayResult.metadata.sessionId,
96:     projectHash: request.projectHash,
97:     chatsDir: request.chatsDir,
98:     workspaceDirs: replayResult.metadata.workspaceDirs,
99:     provider: request.currentProvider,
100:    model: request.currentModel
101:  })
102:  CALL recording.initializeForResume(targetSession.filePath, replayResult.lastSeq)
103:
104:  // Step 6: Handle provider mismatch
105:  IF request.currentProvider != replayResult.metadata.provider
106:     OR request.currentModel != replayResult.metadata.model THEN
107:    CALL recording.recordSessionEvent('warning',
108:      "Provider/model changed from " + replayResult.metadata.provider + "/" + replayResult.metadata.model
109:      + " to " + request.currentProvider + "/" + request.currentModel)
110:    CALL recording.recordProviderSwitch(request.currentProvider, request.currentModel)
111:  END IF
112:
113:  // Step 7: Record resume event
114:  CALL recording.recordSessionEvent('info',
115:    "Session resumed (originally started " + replayResult.metadata.startTime + ")")
116:
117:  RETURN {
118:    ok: true,
119:    history: replayResult.history,
120:    metadata: replayResult.metadata,
121:    recording: recording,
122:    warnings: replayResult.warnings
123:  }
124: END FUNCTION
```

## UI Reconstruction After Resume

```
130: // In AppContainer or gemini.tsx after resume:
131: METHOD reconstructUIAfterResume(history: IContent[], metadata: SessionMetadata):
132:   // Seed HistoryService via client.restoreHistory() — NOT historyService.addAll()
133:   // client.restoreHistory(history) ensures chat/content generator readiness
134:   // (see packages/core/src/core/client.ts:762)
135:   CALL client.restoreHistory(history)
136:
137:   // NOTE: convertToUIHistory is a useCallback inside AppContainer — NOT an importable utility.
138:   // The resume flow MUST pass IContent[] to AppContainer, where convertToUIHistory
139:   // reconstructs the UI history within the React component.
140:   LET uiHistory = convertToUIHistory(history)
141:
142:   // Display reconstructed history in UI
143:   FOR EACH uiItem IN uiHistory
144:     CALL addItemToUI(uiItem)
145:   END FOR
146:
147:   // Add resume info message (only message shown to user)
148:   CALL addInfoToUI("Session resumed from " + metadata.startTime)
149: END METHOD
```

## Replacing Existing Resume Logic

```
150: // REMOVE from gemini.tsx:
151: //   - SessionPersistenceService import and instantiation (line ~74, ~254)
152: //   - loadMostRecent() call (line ~258)
153: //   - restoredSession variable (line ~250)
154: //   - Passing restoredSession to AppContainer (line ~322)
155: //
156: // REPLACE WITH:
157: //   - Import resumeSession function
158: //   - Call resumeSession() when isContinueSession()
159: //   - Pass resume result to AppContainer/UI setup
160: //
161: // REMOVE from AppContainer.tsx:
162: //   - restoredSession prop (line ~157)
163: //   - Session restoration useEffect (lines ~607-700)
164: //   - coreHistoryRestoredRef and its useEffect (lines ~704-755)
165: //
166: // KEEP in AppContainer.tsx:
167: //   - convertToUIHistory function (used by new resume)
```



---

## Session Discovery: mtime Tiebreaker

### Context

`SessionDiscovery.listSessions()` returns sessions sorted newest-first by file modification time (`mtime` from `fs.stat()`). In the overwhelmingly common case, no two session files share the same mtime. However, for deterministic behavior in all cases (including tests and fast CI environments), a tiebreaker is needed.

### Tiebreaker Rule

When sorting sessions by recency, if two or more session files have **identical `mtime` values** (same millisecond timestamp), sort secondarily by **session ID in lexicographic descending order** (i.e., the session ID that sorts later alphabetically is considered "more recent").

### Pseudocode Update

In the session discovery sort (around line 25 / `listSessions` implementation):

```
SORT sessions BY:
  PRIMARY: file.mtime DESCENDING (newest first)
  SECONDARY (tiebreaker): session.sessionId DESCENDING (lexicographic)
```

Equivalent TypeScript:
```typescript
sessions.sort((a, b) => {
  const mtimeDiff = b.lastModified.getTime() - a.lastModified.getTime();
  if (mtimeDiff !== 0) return mtimeDiff;
  // Tiebreaker: lexicographic descending by session ID
  return b.sessionId.localeCompare(a.sessionId);
});
```

### Why Lexicographic Descending?

- Session IDs are generated with `crypto.randomUUID()` or similar — they have no inherent temporal ordering.
- The goal is **determinism**, not semantic correctness. Any consistent tiebreaker suffices.
- Lexicographic descending was chosen because it mirrors the primary sort direction (descending/newest-first) and is simple to implement and test.
- This ensures that `--continue` (bare) always selects the same session when faced with an mtime tie, regardless of filesystem enumeration order.
