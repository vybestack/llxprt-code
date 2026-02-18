# Pseudocode: Recording Integration (Issue #1364)

## Interface Contracts

```typescript
// INPUTS: Events from HistoryService and other subsystems
// OUTPUTS: Events enqueued to SessionRecordingService

// DEPENDENCIES (real, injected)
// - SessionRecordingService instance
// - HistoryService instance (STABLE through compression — same instance always)
// - Config (for provider/model)
```

## Integration Points

```
Line 46: SUBSCRIBE to historyService.on('contentAdded', handler)
         - HistoryService emits 'contentAdded' when content is committed via addInternal()
         - Currently only emits 'tokensUpdated', so 'contentAdded' event MUST be added
         - Add this.emit('contentAdded', content) after this.history.push() in addInternal()

Line 52: SUBSCRIBE to historyService.on('compressionStarted', handler)
         SUBSCRIBE to historyService.on('compressionEnded', handler)
         - Compression is IN-PLACE on the SAME HistoryService instance
         - GeminiChat.historyService is `private readonly` (geminiChat.ts line 408)
         - performCompression() calls clear()+add() on the SAME instance (lines 2022-2026)
         - 'compressionStarted' fires from startCompression() (line 1483)
         - 'compressionEnded' fires from endCompression() (line 1492) with summary and count

Line 80: CALL recordingService.flush() at turn boundaries
         - Must be awaited (not fire-and-forget)
         - Called from useGeminiStream's submitQuery finally block
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Poll HistoryService for changes
[OK] DO: Subscribe to events and react

[ERROR] DO NOT: Duplicate the content when recording (deep copy)
[OK] DO: Pass the IContent reference directly (JSONL serialization handles copying)

[ERROR] DO NOT: Fire-and-forget flush calls
[OK] DO: Await flush at turn boundaries for durability guarantee

[ERROR] DO NOT: Assume compression replaces HistoryService instance
[OK] DO: Know that compression is in-place (clear+add on same instance)
```

## HistoryService Event Enhancement

```
10: // ADD to HistoryServiceEventEmitter interface (~line 37-43 in HistoryService.ts):
11: // Extend the existing interface to include three new events:
12: TYPE HistoryServiceEvents = {
13:   tokensUpdated: (event: TokensUpdatedEvent) => void
14:   contentAdded: (content: IContent) => void
15:   compressionStarted: () => void
16:   compressionEnded: (summary: IContent, itemsCompressed: number) => void
17: }
18:
19: // ADD to HistoryService.addInternal() after line 279 (this.history.push):
20: EMIT 'contentAdded' event WITH content
21:
22: // ADD to HistoryService.startCompression() at line 1483:
23: // After setting isCompressing = true:
24: EMIT 'compressionStarted'
25:
26: // ADD to HistoryService.endCompression() at line 1492:
27: // After draining the pending queue, with compression result passed through:
28: EMIT 'compressionEnded' WITH (summary, itemsCompressed)
```

## Recording Integration Hook/Manager

```
30: CLASS RecordingIntegration
31:   PRIVATE recording: SessionRecordingService
32:   PRIVATE historySubscription: (() => void) | null = null
33:   PRIVATE compressionInProgress: boolean = false
34:
35:   CONSTRUCTOR(recording: SessionRecordingService)
36:     SET this.recording = recording
37:   END CONSTRUCTOR
38:
39:   METHOD subscribeToHistory(historyService: HistoryService): void
40:     // Unsubscribe from previous if any (handles startChat edge case)
41:     CALL this.unsubscribeFromHistory()
42:
43:     // Subscribe to content additions
44:     LET onContentAdded = (content: IContent) => {
45:       IF this.compressionInProgress THEN
46:         // Skip: these are re-populated items from compression, not new content
47:         RETURN
48:       END IF
49:       CALL this.recording.recordContent(content)
50:     }
51:     CALL historyService.on('contentAdded', onContentAdded)
52:
53:     // Subscribe to compression lifecycle
54:     LET onCompressionStarted = () => {
55:       SET this.compressionInProgress = true
56:     }
57:     CALL historyService.on('compressionStarted', onCompressionStarted)
58:
59:     LET onCompressionEnded = (summary: IContent, itemsCompressed: number) => {
60:       SET this.compressionInProgress = false
61:       CALL this.recording.recordCompressed(summary, itemsCompressed)
62:     }
63:     CALL historyService.on('compressionEnded', onCompressionEnded)
64:
65:     // Store cleanup function
66:     SET this.historySubscription = () => {
67:       CALL historyService.off('contentAdded', onContentAdded)
68:       CALL historyService.off('compressionStarted', onCompressionStarted)
69:       CALL historyService.off('compressionEnded', onCompressionEnded)
70:     }
71:   END METHOD
72:
73:   METHOD unsubscribeFromHistory(): void
74:     IF this.historySubscription THEN
75:       CALL this.historySubscription()
76:       SET this.historySubscription = null
77:     END IF
78:   END METHOD
79:
80:   METHOD recordProviderSwitch(provider: string, model: string): void
81:     CALL this.recording.recordProviderSwitch(provider, model)
82:   END METHOD
83:
84:   METHOD recordDirectoriesChanged(dirs: string[]): void
85:     CALL this.recording.recordDirectoriesChanged(dirs)
86:   END METHOD
87:
88:   METHOD recordSessionEvent(severity: 'info'|'warning'|'error', message: string): void
89:     CALL this.recording.recordSessionEvent(severity, message)
90:   END METHOD
91:
92:   METHOD ASYNC flushAtTurnBoundary(): Promise<void>
93:     AWAIT this.recording.flush()
94:   END METHOD
95:
96:   METHOD dispose(): void
97:     CALL this.unsubscribeFromHistory()
98:   END METHOD
99:
100:  // Handle the rare edge case where HistoryService is genuinely replaced
101:  // (only happens on GeminiClient.startChat() without storeHistoryServiceForReuse)
102:  METHOD onHistoryServiceReplaced(newHistoryService: HistoryService): void
103:    CALL this.subscribeToHistory(newHistoryService)
104:  END METHOD
105: END CLASS
```

## Flush Integration in useGeminiStream

```
110: // In useGeminiStream.ts, at the turn completion point:
111: // (after all tool results committed, in the finally block of submitQuery)
112: //
113: // Existing code approximately:
114: //   finally {
115: //     setIsResponding(false)
116: //     ...
117: //   }
118: //
119: // Add flush call:
120: ASYNC METHOD onTurnComplete():
121:   TRY
122:     IF recordingIntegration IS available THEN
123:       AWAIT recordingIntegration.flushAtTurnBoundary()
124:     END IF
125:   CATCH error
126:     // Non-fatal: log warning, don't break turn completion
127:     LOG_DEBUG("Failed to flush recording at turn boundary:", error)
128:   END TRY
129: END METHOD
```

## Session Initialization (New Session)

```
135: // In gemini.tsx, during session setup:
136: METHOD setupNewSessionRecording(config, storage):
137:   LET sessionId = config.getSessionId()
138:   // projectHash from: import { getProjectHash } from '../utils/paths.js'
139:   LET projectHash = getProjectHash(config.getBaseDir())
140:   // chatsDir must be explicitly constructed — there is NO getChatsDir() on Config
141:   LET chatsDir = path.join(config.getProjectTempDir(), 'chats')
142:
143:   LET recording = new SessionRecordingService({
144:     sessionId,
145:     projectHash,
146:     chatsDir,
147:     workspaceDirs: config.getWorkspaceDirs(),
148:     provider: config.getProvider(),
149:     model: config.getModel()
150:   })
151:
152:   LET integration = new RecordingIntegration(recording)
153:
154:   RETURN { recording, integration }
155: END METHOD
```

## Compression Event Suppression Logic

During compression, `performCompression()` calls `historyService.clear()` then `historyService.add()` in a loop to re-add compressed items. Each `add()` emits `contentAdded`, which the RecordingIntegration must NOT record (those are re-adds, not new user/AI content).

The suppression protocol:

```
WHEN compressionStarted fires:
  SET suppressContentEvents = true

WHEN contentAdded fires:
  IF suppressContentEvents THEN SKIP (do not enqueue — these are re-populated items from compression)

WHEN compressionEnded(summary, itemsCompressed) fires:
  SET suppressContentEvents = false
  ENQUEUE compressed event with summary and itemsCompressed
```

**Why this works:** The `compressionStarted` / `compressionEnded` bracket is emitted by HistoryService itself, synchronously around the clear+add loop. Because Node.js is single-threaded, no interleaving is possible — the `compressionStarted` flag is set before any `add()` calls fire, and `compressionEnded` fires after the last `add()` completes.

**What this prevents:** Without suppression, a compression of 48 items into 1 summary would emit 1 `compressed` event AND N `content` events for the re-added items. On replay, this would produce duplicate history entries.

## Compression Architecture

Compression is **in-place** on the same HistoryService instance. The instance is never replaced during compression.

```
160: // ACTUAL compression flow (geminiChat.ts lines 2011-2037):
161: //   1. historyService.startCompression()    — sets isCompressing=true, emits 'compressionStarted'
162: //   2. strategy.compress(context)           — produces newHistory IContent[]
163: //   3. historyService.clear()               — empties history array
164: //   4. historyService.add(item, model)      — adds each compressed item back
165: //   5. historyService.endCompression()      — sets isCompressing=false, drains queue, emits 'compressionEnded'
166: //
167: // The HistoryService instance reference is STABLE through compression.
168: // GeminiChat.historyService is a `private readonly` field (line 408).
169: //
170: // RecordingIntegration handles this by:
171: //   - On 'compressionStarted': sets compressionInProgress = true
172: //   - During compression: contentAdded events from clear()+add() are SUPPRESSED
173: //   - On 'compressionEnded': sets compressionInProgress = false, records 'compressed' event
174: //
175: // This means RecordingIntegration subscribes ONCE and stays subscribed.
176: // No re-subscription is needed for compression.
```

## HistoryService Replacement (Rare Edge Case)

The only scenario where the HistoryService instance is genuinely replaced at runtime:

```
180: // GeminiClient.startChat() (client.ts line 873) creates a new HistoryService
181: // UNLESS _storedHistoryService is set (lines 864-870).
182: //
183: // This happens:
184: //   - On initial session creation (RecordingIntegration subscribes after — no rebind needed)
185: //   - On provider switch without storeHistoryServiceForReuse() (rare edge case)
186: //   - On resetChat() (client.ts line 744) — creates new HistoryService
187: //
188: // For these rare cases, the code path that detects the new chat must call:
189: //   recordingIntegration.onHistoryServiceReplaced(geminiClient.getHistoryService()!)
190: //
191: // This is wired in Phase 26 integration.
```

## Exact File Paths and Function Names

| Component | File | Function | Line |
|-----------|------|----------|------|
| Compression start event | `packages/core/src/services/history/HistoryService.ts` | `startCompression()` | ~1485 |
| Compression end event | `packages/core/src/services/history/HistoryService.ts` | `endCompression()` | ~1492 |
| HistoryService stable reference | `packages/core/src/core/geminiChat.ts` | field `historyService` | 408 |
| In-place compression | `packages/core/src/core/geminiChat.ts` | `performCompression()` | 2011-2037 |
| HistoryService creation | `packages/core/src/core/client.ts` | `startChat()` | 873 |
| HistoryService reuse | `packages/core/src/core/client.ts` | `storeHistoryServiceForReuse()` | 665-669 |
| Re-subscription trigger | `packages/core/src/recording/RecordingIntegration.ts` | `onHistoryServiceReplaced()` | (new) |
| Compression-aware filter | `packages/core/src/recording/RecordingIntegration.ts` | `onContentAdded()` | (new) |
