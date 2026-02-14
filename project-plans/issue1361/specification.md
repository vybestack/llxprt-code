# Feature Specification: Session Recording Service

## GitHub Issues

- Parent: #1361 — Session Recording Service: Replace SessionPersistenceService with event-driven JSONL recording
- Sub-issues: #1362, #1363, #1364, #1365, #1366, #1367, #1368, #1369

## Purpose

Replace the current `SessionPersistenceService` — a snapshot-based system that writes the full conversation state as a single JSON blob on idle — with an event-driven, append-only JSONL recording system. This resolves three fundamental problems:

1. **Crash safety**: The current idle-triggered save can lose all work since the last save on crash.
2. **Dual source of truth**: Core history (`IContent[]`) and UI history (`PersistedUIHistoryItem[]`) are saved separately and can drift.
3. **Opaque compression**: Pre-compression history is silently replaced with no audit trail.

The new system records conversation events as they happen, provides a single source of truth (the JSONL file), and makes compression, rewind, and provider switches visible as first-class events.

## Design Philosophy

This plan follows a **rip-and-replace** philosophy:

- **No backward compatibility shims.** If an API changes, all callers are updated. No optional parameters to keep old callers working.
- **No migration.** Old `.json` session files are not converted, not coexisted with. Existing cleanup handles them.
- **No dual-format support.** The new system writes `.jsonl`. Cleanup targets `.jsonl` only.
- **No deprecation periods.** The old system is removed in Phase 27. It's gone.

## Architectural Decisions

- **Pattern**: Event-driven, append-only log (Event Sourcing for conversations)
- **File Format**: JSONL (JSON Lines) — one JSON object per line, each event self-contained
- **Technology Stack**: Node.js fs (async append), TypeScript strict mode
- **Data Flow**: HistoryService → event emission → SessionRecordingService → JSONL file → ReplayEngine (on resume)
- **Integration Points**: HistoryService events, Config CLI args, AppContainer UI, process lifecycle handlers
- **Concurrency**: PID-based advisory lockfiles for single-writer guarantee

## Project Structure

```
packages/core/src/
  recording/
    types.ts                          # Event envelope, payload types, SessionMetadata
    SessionRecordingService.ts        # Core async writer with deferred materialization
    SessionRecordingService.test.ts
    ReplayEngine.ts                   # Pure function: JSONL file → ReplayResult
    ReplayEngine.test.ts
    SessionDiscovery.ts               # Shared session listing/resolution utility
    SessionDiscovery.test.ts
    SessionLockManager.ts             # PID-based advisory lockfiles
    SessionLockManager.test.ts
    index.ts                          # Module barrel export

packages/cli/src/
  utils/
    sessionCleanup.ts                 # MODIFIED: .jsonl support, lock-aware protection
  ui/
    AppContainer.tsx                  # MODIFIED: remove old restoration, add new resume
  gemini.tsx                          # MODIFIED: new --continue, --list-sessions, --delete-session
```

## Technical Environment

- **Type**: CLI Tool
- **Runtime**: Node.js 20.x+
- **Dependencies**: No new production dependencies (uses node:fs, node:path, node:crypto, node:readline). Test-only dependency: fast-check for property-based testing (devDependency).
- **Testing**: Vitest + real filesystem operations (no mock theater)

## Integration Points (MANDATORY SECTION)

### Existing Code That Will USE This Feature

1. `packages/cli/src/gemini.tsx` — Bootstrap/startup: creates SessionRecordingService, handles --continue/--list-sessions/--delete-session
2. `packages/cli/src/ui/AppContainer.tsx` — Session lifecycle: subscribes to HistoryService events, manages recording service instance, handles resume UI reconstruction
3. `packages/cli/src/ui/hooks/useGeminiStream.ts` — Turn boundaries: calls `recording.flush()` at end of each complete turn
4. `packages/cli/src/ui/hooks/useHistoryManager.ts` — History management: recording integration with HistoryService events
5. `packages/cli/src/utils/sessionCleanup.ts` — Cleanup: adapted for .jsonl files with lock-aware protection
6. `packages/cli/src/utils/cleanup.ts` — Process lifecycle: registerCleanup for flush + lock release
7. `packages/core/src/config/config.ts` — Config: `isContinueSession()` changes from boolean to string-aware, add `getContinueSessionRef()`

### Existing Code To Be REPLACED

1. `packages/core/src/storage/SessionPersistenceService.ts` — **REMOVED ENTIRELY**: Old snapshot-based persistence
2. `packages/core/src/storage/SessionPersistenceService.test.ts` — **REMOVED**: Old tests
3. `packages/core/src/storage/SessionPersistenceService.ts` exports (`PersistedSession`, `PersistedUIHistoryItem`, `PersistedToolCall`) — **REMOVED from core index.ts**
4. `packages/core/src/core/geminiChat.ts` — **MODIFIED**: Remove ChatRecordingService stub reference (line ~2276)
5. Session restoration `useEffect` blocks in `AppContainer.tsx` (lines ~607-755) — **REPLACED** by new replay-based restoration
6. `restoredSession` prop in `AppContainer.tsx` (line 157) — **REMOVED**
7. `SessionPersistenceService` instantiation in `AppContainer.tsx` (line ~2061) — **REMOVED**
8. `loadMostRecent()` call and `restoredSession` variable in `gemini.tsx` (lines ~250-265) — **REPLACED**

### User Access Points

- **`--continue` / `-C`** (existing flag, changed): No arg = resume most recent; with arg = resume specific session by ID/prefix/index
- **`--list-sessions`** (new flag): List available sessions for current project, exit
- **`--delete-session <id>`** (new flag): Delete a session by ID/prefix/index, exit
- **Normal session start**: Transparent — recording happens automatically, file materializes on first content

### Transition Notes

1. **Old session files** (`persisted-session-*.json`): NOT migrated or converted. The existing cleanup code already handles old `.json` files by age/count policy — that code is untouched by this feature.
2. **`--continue` boolean → string**: Changes from boolean to `string | boolean`. Bare `--continue` resumes most recent. `--continue <id>` resumes a specific session.
3. **`continueSession` config field**: Changes from `boolean` to `string | boolean` in `ConfigParams`, with `isContinueSession()` returning boolean and new `getContinueSessionRef()` returning the string value.
4. **PersistedUIHistoryItem removal**: UI history is reconstructed from `IContent[]` via existing `convertToUIHistory()` logic — no separate UI history format needed.

## Formal Requirements

### Core Types & Writer (#1362)
- [REQ-REC-001] Event Envelope: All events follow `{v, seq, ts, type, payload}` envelope format
- [REQ-REC-001.1] Schema version field `v` starts at 1 and is the canonical version indicator
- [REQ-REC-001.2] Sequence numbers are monotonically increasing per session
- [REQ-REC-001.3] Timestamps are ISO-8601 for human readability, not used for ordering
- [REQ-REC-002] Event Types: session_start, content, compressed, rewind, provider_switch, session_event, directories_changed
- [REQ-REC-003] SessionRecordingService: synchronous enqueue, async background writer
- [REQ-REC-003.1] Enqueue is synchronous and non-blocking
- [REQ-REC-003.2] Background writer drains queue and appends JSON lines
- [REQ-REC-003.3] Each event is one JSON line terminated by newline
- [REQ-REC-004] Deferred Materialization: file not created until first content event
- [REQ-REC-004.1] session_start buffered until first content triggers file creation
- [REQ-REC-004.2] Starting CLI and exiting without typing leaves no file
- [REQ-REC-005] Flush: returns Promise resolving when all queued events written
- [REQ-REC-006] ENOSPC: write failure disables recording for session remainder
- [REQ-REC-006.1] Warning surfaced to UI, conversation continues unrecorded
- [REQ-REC-006.2] Subsequent enqueue calls become no-ops
- [REQ-REC-007] isActive() returns recording state (enabled vs disabled)
- [REQ-REC-008] initializeForResume(filePath, lastSeq) for continuing existing files

### Replay Engine (#1363)
- [REQ-RPL-001] Pure function: file path → ReplayResult (history, metadata, lastSeq, eventCount, warnings, sessionEvents)
- [REQ-RPL-002] Event Processing: session_start→metadata, content→append, compressed→reset, rewind→remove-N, provider_switch→update, session_event→collect in sessionEvents (NOT added to IContent[] history), directories_changed→update, unknown→skip+warn
- [REQ-RPL-003] Corruption Handling: bad last line silently discarded, bad mid-file line skipped with warning, missing session_start is fatal error. If >5% of events are malformed, emit an additional WARNING-level entry in ReplayResult.warnings.
- [REQ-RPL-005] Non-monotonic/duplicate seq: warning but continue in file order
- [REQ-RPL-006] Project hash validation: replay validates session_start projectHash against expected hash; mismatch returns error result
- [REQ-RPL-007] Metadata tracking: provider_switch and directories_changed events update session metadata during replay so resumed session reflects the most recent state
- [REQ-RPL-008] session_event handling: session_event records collected into ReplayResult.sessionEvents for audit, NOT added to IContent[] history, NOT re-displayed in UI on resume

### Recording Integration (#1364)
- [REQ-INT-001] Subscribe to HistoryService `contentAdded` → enqueue `content` event
- [REQ-INT-002] Subscribe to HistoryService `compressionStarted`/`compressionEnded` → enqueue `compressed` event. Compression is in-place (clear+add on the same HistoryService instance), so RecordingIntegration suppresses `contentAdded` events during compression to avoid double-recording.
- [REQ-INT-003] Handle HistoryService replacement for the rare `startChat()` edge case (provider switch without reuse). The `onHistoryServiceReplaced()` method re-subscribes to the new instance.
- [REQ-INT-004] recordProviderSwitch(provider, model) → enqueue `provider_switch`
- [REQ-INT-005] recordDirectoriesChanged(dirs) → enqueue `directories_changed`
- [REQ-INT-006] recordSessionEvent(severity, message) → enqueue `session_event`
- [REQ-INT-007] Flush at end of each complete turn (after submitQuery completes)

### Resume Flow (#1365)
- [REQ-RSM-001] `--continue` bare: resume most recent session for project
- [REQ-RSM-002] `--continue <id>`: resume specific session by exact ID, unique prefix, or numeric index
- [REQ-RSM-003] Session file discovery: scan chatsDir, read first line, filter by projectHash
- [REQ-RSM-004] Replay → seed HistoryService with IContent[] → reconstruct UI from IContent[]
- [REQ-RSM-005] Provider mismatch: warning + provider_switch event, current config takes precedence
- [REQ-RSM-006] Session file reopened for append with seq continuing from lastSeq

### Session Management (#1366)
- [REQ-MGT-001] `--list-sessions`: table with index, ID, start time, last updated, provider/model, size
- [REQ-MGT-002] `--delete-session <id>`: resolve by ID/prefix/index, check lock, delete file + sidecar
- [REQ-MGT-003] Refuse to delete locked (active) session
- [REQ-MGT-004] Stale lock on delete target: proceed with deletion

### Concurrency & Lifecycle (#1367)
- [REQ-CON-001] Sidecar lockfile per session with PID-based stale detection. Lock path: `<chatsDir>/<sessionId>.lock` (session-ID-based, always).
- [REQ-CON-002] Lock acquired before file creation (new) or before replay (resume)
- [REQ-CON-003] Lock released via registerCleanup pattern
- [REQ-CON-004] Concurrent lock attempt fails with clear error
- [REQ-CON-005] Shutdown flush: SIGINT/SIGTERM/`/exit`/uncaught exception → flush before exit
- [REQ-CON-006] Integrate with existing `registerCleanup()` / `runExitCleanup()` in cleanup.ts

### Session Cleanup Adaptation (#1369)
- [REQ-CLN-001] Scan pattern updated for `session-*.jsonl`
- [REQ-CLN-002] Lock-aware active protection: check lock before delete
- [REQ-CLN-003] Stale lock cleanup: dead PID → delete lock + data file
- [REQ-CLN-004] Orphaned lock cleanup: .lock with no .jsonl → delete

### Remove Old System (#1368)
- [REQ-DEL-001] Remove SessionPersistenceService.ts and its tests
- [REQ-DEL-002] Remove PersistedSession, PersistedUIHistoryItem, PersistedToolCall types
- [REQ-DEL-003] Remove exports from core index.ts
- [REQ-DEL-004] Remove restoredSession prop and restoration useEffects from AppContainer
- [REQ-DEL-005] Remove SessionPersistenceService instantiation from gemini.tsx
- [REQ-DEL-006] Remove ChatRecordingService stub from geminiChat.ts
- [REQ-DEL-007] All existing tests pass, typecheck passes, build succeeds

## Data Schemas

### Event Envelope

The envelope `v` field is the SOLE schema version indicator. Every JSONL line carries `v` in its envelope. There is no separate version field in any event payload, including `session_start`. This eliminates consistency hazards between duplicate version fields.

```typescript
interface SessionRecordLine {
  v: number;           // schema version (starts at 1, sole version indicator)
  seq: number;         // monotonic sequence number
  ts: string;          // ISO-8601 timestamp
  type: SessionEventType;
  payload: unknown;
}

type SessionEventType =
  | 'session_start'
  | 'content'
  | 'compressed'
  | 'rewind'
  | 'provider_switch'
  | 'session_event'
  | 'directories_changed';
```

Forward compatibility: if a future schema version (v=2) changes a payload shape, the `v` in the envelope on that line is sufficient for the replay engine to branch parsing logic.

### Event Payloads
```typescript
interface SessionStartPayload {
  sessionId: string;
  projectHash: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
  startTime: string;  // ISO-8601
  // NOTE: No schema version field — v lives only in the envelope
}

interface ContentPayload {
  content: IContent;
}

interface CompressedPayload {
  summary: IContent;           // speaker: 'ai', text block with summary
  itemsCompressed: number;
}

interface RewindPayload {
  itemsRemoved: number;        // positive integer
}

interface ProviderSwitchPayload {
  provider: string;
  model: string;
}

interface SessionEventPayload {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

interface DirectoriesChangedPayload {
  directories: string[];
}
```

### Replay Result
```typescript
interface ReplayResult {
  history: IContent[];
  metadata: SessionMetadata;
  lastSeq: number;
  eventCount: number;
  warnings: string[];
  sessionEvents: SessionEvent[];  // session_event records collected for audit, NOT in history
}

interface SessionMetadata {
  sessionId: string;
  projectHash: string;
  provider: string;
  model: string;
  workspaceDirs: string[];
  startTime: string;
}
```

### Session Summary (for listing)
```typescript
interface SessionSummary {
  sessionId: string;
  filePath: string;
  startTime: string;
  lastModified: Date;
  fileSize: number;
  provider: string;
  model: string;
}
```

## Example Data

### Session JSONL File
```jsonl
{"v":1,"seq":1,"ts":"2026-02-11T16:00:00.000Z","type":"session_start","payload":{"sessionId":"a1b2c3d4","projectHash":"abc123def456","workspaceDirs":["/home/user/project"],"provider":"anthropic","model":"claude-4","startTime":"2026-02-11T16:00:00.000Z"}}
{"v":1,"seq":2,"ts":"2026-02-11T16:00:05.000Z","type":"content","payload":{"content":{"speaker":"human","blocks":[{"type":"text","text":"Hello, write me a haiku"}]}}}
{"v":1,"seq":3,"ts":"2026-02-11T16:00:07.000Z","type":"content","payload":{"content":{"speaker":"ai","blocks":[{"type":"text","text":"Silent morning dew\nDrops on petals, soft and bright\nNature's gentle hymn"}],"metadata":{"model":"claude-4","provider":"anthropic"}}}}
{"v":1,"seq":4,"ts":"2026-02-11T16:00:07.500Z","type":"session_event","payload":{"severity":"info","message":"Turn completed successfully"}}
```

### Compressed Session Example
```jsonl
{"v":1,"seq":1,"ts":"2026-02-11T16:00:00.000Z","type":"session_start","payload":{"sessionId":"a1b2c3d4","projectHash":"abc123","workspaceDirs":["/project"],"provider":"anthropic","model":"claude-4","startTime":"2026-02-11T16:00:00.000Z"}}
{"v":1,"seq":2,"ts":"...","type":"content","payload":{"content":{"speaker":"human","blocks":[{"type":"text","text":"msg1"}]}}}
{"v":1,"seq":3,"ts":"...","type":"content","payload":{"content":{"speaker":"ai","blocks":[{"type":"text","text":"response1"}]}}}
{"v":1,"seq":50,"ts":"...","type":"compressed","payload":{"summary":{"speaker":"ai","blocks":[{"type":"text","text":"Summary of 48 previous messages about project setup..."}],"metadata":{"isSummary":true}},"itemsCompressed":48}}
{"v":1,"seq":51,"ts":"...","type":"content","payload":{"content":{"speaker":"human","blocks":[{"type":"text","text":"Now let's continue..."}]}}}
```

## Event Ordering Contract

This section defines the exact event ordering that MUST appear in the JSONL file for each session lifecycle scenario. The replay engine relies on this ordering for correct state reconstruction.

### New Session

A fresh session (no `--continue`) produces events in this order:

```
session_start                          ← ALWAYS first line in file
  [session_event("Session started")]   ← optional informational
  [provider_switch]                    ← only if provider changed since config default
  [directories_changed]               ← only if dirs differ from session_start
content (user message 1)               ← first user turn triggers file materialization
content (AI response 1)
  [session_event]*                     ← any info/warning/error events
content (user message 2)
content (AI response 2)
  ...
  [compressed]                         ← if compression occurs
  content*                             ← post-compression content continues
  [rewind]                             ← if user invokes undo
```

**Invariants:**
- `session_start` is ALWAYS seq=1 and ALWAYS the first line
- The first `content` event triggers file materialization (deferred materialization)
- `session_event` entries may appear between any two events — they are metadata, not content
- `compressed` resets the replay content accumulator — all prior `content` events are superseded
- `rewind` operates on the current accumulated content list

### Resumed Session (`--continue`)

After replay, the file is reopened for append. New events continue with monotonically increasing `seq` from the last value:

```
[... existing events from prior session(s) ...]
session_event("Session resumed at <timestamp>")    ← ALWAYS emitted on resume
  [provider_switch]                                 ← ONLY if current provider/model differs from last recorded provider/model
content (new user message)
content (new AI response)
  ...
```

**Invariants:**
- NO new `session_start` event is emitted on resume — the original `session_start` from the first line remains the session identity
- `session_event("Session resumed...")` is ALWAYS the first event written after reopening
- If the current provider/model differs from the session's last known provider/model, a `provider_switch` event is emitted AFTER the resume `session_event` and BEFORE any new `content`
- `seq` continues from `lastSeq + 1` (no gaps, no resets)

### After Compression

When compression occurs mid-session, the event stream contains:

```
[... content events before compression ...]
compressed { summary: IContent, itemsCompressed: N }
content (next user message)
content (next AI response)
  ...
```

**Replay semantics:**
- On encountering `compressed`, the replay engine discards ALL accumulated `IContent` items
- The `summary` IContent from the `compressed` payload becomes the sole starting point
- Subsequent `content` events accumulate after the summary
- Multiple `compressed` events: each one supersedes all prior history. Only the content after the LAST `compressed` event (plus its summary) constitutes the active history

### Session With Multiple Resumes

A session that has been resumed multiple times:

```
session_start                                       ← seq=1, original session
content (turn 1 user)                               ← seq=2
content (turn 1 AI)                                 ← seq=3
  ...
session_event("Session resumed at T1")              ← seq=N, first resume
  [provider_switch]                                 ← seq=N+1, if provider changed
content (resumed turn 1 user)                       ← seq=N+2
content (resumed turn 1 AI)                         ← seq=N+3
  ...
session_event("Session resumed at T2")              ← seq=M, second resume
content (second resumed turn 1 user)                ← seq=M+1
  ...
```

**Invariants:**
- Exactly ONE `session_start` per file (the first line)
- One `session_event("Session resumed...")` per resume operation
- `seq` is strictly monotonically increasing across all resumes (no resets at resume boundaries)
- No duplicate `session_start` events — resume does NOT re-emit `session_start`

## Durability Contract

### Turn Completion Signal

**The `submitQuery` `finally` block** (useGeminiStream.ts line 1286-1288) is the single authoritative turn-completion signal for interactive mode. Every path through `submitQuery` — normal, error, cancellation, tool-call continuation — eventually reaches this `finally` block.

```typescript
// useGeminiStream.ts, submitQuery callback:
try {
  const stream = geminiClient.sendMessageStream(queryToSend, abortSignal, prompt_id!);
  const processingStatus = await processGeminiStreamEvents(stream, ...);
  // ... flush pending items ...
} catch (error: unknown) {
  // ... add error item to UI ...
} finally {
  await recordingIntegration?.flushAtTurnBoundary();  // Flush recording
  setIsResponding(false);
}
```

#### Path-by-Path Mapping

| # | Path | Content Committed When? | Flush Point | Notes |
|---|------|------------------------|-------------|-------|
| 1 | **Normal AI response** | `geminiChat.sendMessageStream()` internally calls `historyService.add()` for user message + AI response | `submitQuery` finally (line 1286) | [OK] Covered |
| 2 | **Tool call loop** | Each tool result committed via `handleCompletedTools()` → `submitQuery(responsesToSend, {isContinuation: true})` → nested `sendMessageStream()` → `historyService.add()` for tool results + AI follow-up | The continuation's `submitQuery` call enters the SAME try/catch/finally flow. Its `finally` block fires when the continuation completes. All tool results are already committed to HistoryService before flush. | [OK] Covered |
| 3 | **Cancellation (Escape key)** | `cancelOngoingRequest()` aborts controller → content already committed to HistoryService (via stream before cancellation) is present. The `submitQuery` `finally` block still fires because the abort causes an AbortError. | [OK] Covered (plus additional fire-and-forget flush in `cancelOngoingRequest`) |
| 3a | **Cancellation (user presses Ctrl-C during response)** | `cancelOngoingRequest()` aborts the stream → `submitQuery`'s `finally` block fires → `flush()` is awaited (Tier 1). This is NOT fire-and-forget. The cancelled turn's partial events are flushed. The additional fire-and-forget flush in `cancelOngoingRequest` is a belt-and-suspenders safety net — the `finally` block is the authoritative flush point. | [OK] Covered |
| 4 | **Error during streaming** | `submitQuery` catch block adds error UI item. Falls through to `finally` block. | [OK] Covered |
| 5 | **Slash command (handled)** | No `sendMessageStream()` call. No content reaches HistoryService. | [OK] Not applicable |
| 6 | **Slash command (schedule_tool)** | Tool runs asynchronously. When complete, flows through `handleCompletedTools` → continuation `submitQuery` → standard try/catch/finally. | [OK] Covered via continuation |
| 7 | **Slash command (submit_prompt)** | Transforms query, proceeds to `sendMessageStream()`. | [OK] Covered (same as #1) |
| 8 | **Compression during turn** | `performCompression()` calls `startCompression()`, `clear()`, `add()` for each item, `endCompression()` on the SAME HistoryService instance. Happens WITHIN `sendMessageStream()`, WITHIN `submitQuery`. | [OK] Covered |

**Key Invariant:** Every content event that reaches HistoryService has already been committed BEFORE the `finally` block fires, because `historyService.add()` is synchronous.

#### Non-Interactive Mode Flush

For non-interactive mode (`--prompt`), the authoritative flush point is the `finally` block of `runNonInteractive()` in `packages/cli/src/nonInteractiveCli.ts`:

```typescript
// In runNonInteractive():
try {
  // ... while(true) turn loop ...
} catch (error) {
  // ... error handling ...
} finally {
  cleanupStdinCancellation();
  // Recording flush goes HERE, before shutdownTelemetry():
  await recordingService?.flush();
  consolePatcher.cleanup();
  // ...
}
```

### Flush Guarantee Tiers

#### Tier 1 — Guaranteed Flush

**Applies to:** Controlled shutdown paths where the process has full control over its exit sequence.

- `/exit` command (interactive mode)
- Normal completion (non-interactive `--prompt` mode — turn loop exits cleanly)
- `--prompt` exit (non-interactive mode completes without error)

**Guarantee:** `flush()` is **AWAITED**. All queued events in the in-memory buffer are written to the JSONL file before the process exits. The `finally` block runs to completion, and the async `flush()` Promise resolves before `process.exit()` or natural exit.

**Test expectation:** Tests MUST assert that all enqueued events appear in the JSONL file after a Tier 1 shutdown.

#### Tier 2 — Best-Effort Flush

**Applies to:** Signal-driven and exception-driven shutdown paths where the process may be terminated before async operations complete.

- SIGINT (Ctrl-C)
- SIGTERM (kill signal)
- Uncaught exception / unhandled rejection

**Guarantee:** `flush()` is **CALLED** (via `registerCleanup()` handlers) but **may not complete**. The signal handler invokes `flush()` and attempts to await it, but the Node.js process may exit before the Promise resolves — particularly if a second SIGINT arrives or if the OS sends SIGKILL after a timeout.

**Test expectation:** Tests MUST assert that `flush()` is **attempted** (the cleanup handler is registered and invoked). Tests MUST NOT assert that all events are present in the JSONL file after a Tier 2 shutdown — partial writes are acceptable and expected.

All plan documents and test cases that discuss flush behavior MUST reference the appropriate tier.

### ENOSPC API Contract

The `SessionRecordingService` has a synchronous front door (`enqueue()`) and an asynchronous back end (the background writer):

1. **`enqueue()` is synchronous and always succeeds.** It pushes an event onto an in-memory array and returns immediately. No I/O, no error path, no failure mode.

2. **ENOSPC is detected asynchronously during the background write.** The background writer calls `fs.appendFile()` to drain the queue. If the filesystem returns ENOSPC (or any write error), the error is caught by the writer's error handler.

3. **When ENOSPC is detected:**
   - `isActive()` flips to `false`
   - A warning is surfaced to the UI (REQ-REC-006.1)
   - All subsequent `enqueue()` calls become no-ops (REQ-REC-006.2)
   - The session continues unrecorded for the remainder

4. **The write-failure window:** There is a small window between an `enqueue()` call and the corresponding write failure where events are queued in memory but will never be written to disk. This window covers at most one turn's worth of events (the queue drains on each flush cycle). This is acceptable because the session continues uninterrupted.

5. **Events already in the queue when ENOSPC occurs** may or may not be written, depending on where in the batch the write failed. Partially written events are handled by the replay engine's corruption tolerance (corrupt last line is silently discarded).

## Recording Service Lifecycle Ownership

The `SessionRecordingService` has a **single owner** for each execution mode. There is no shared or duplicated ownership:

| Mode | Owner (creates + holds reference) | Flush Responsibility | Lock Lifecycle |
|------|-----------------------------------|---------------------|----------------|
| Interactive | `gemini.tsx` creates → passes to `AppContainer` via props → `AppContainer` subscribes to HistoryService events | `useGeminiStream` calls `flush()` at turn end; `registerCleanup()` handles shutdown | Created in `gemini.tsx`, released via `registerCleanup()` |
| Non-interactive (`--prompt`) | `gemini.tsx` creates → passes to `runNonInteractive()` via `RunNonInteractiveParams` | `finally` block in `runNonInteractive()` | Created in `gemini.tsx`, released via `registerCleanup()` |
| Resume (`--continue`) | `gemini.tsx` creates via `initializeForResume()` → same ownership as interactive/non-interactive | Same as above based on mode | Acquired before replay in `gemini.tsx` |

**Key invariant:** `gemini.tsx` is always the creator and `registerCleanup()` is always the release mechanism. No other code path creates or disposes the recording service.

## Event Serialization Guarantee

ALL event enqueue calls go through `SessionRecordingService.enqueue()`, which is a **synchronous** method. JavaScript (Node.js) runs on a **single-threaded event loop**:

1. **Only one piece of JavaScript code executes at a time.** No preemptive multithreading.
2. **`enqueue()` is synchronous, so it cannot be interrupted.** The chain `add()` → `emit()` → `onContentAdded()` → `enqueue()` runs without yielding to the event loop.
3. **Events are serialized by call order.** If content A is added before content B, `enqueue(A)` completes before `enqueue(B)` begins.
4. **The async writer drains the queue in FIFO order.** The background writer processes sequentially: dequeue from front, `await fs.appendFile()`, repeat.
5. **No concurrent race is possible.** Even if two tool processes send results at the "same time," the event loop processes them one at a time.

The single-threaded nature of Node.js, combined with the synchronous `enqueue()` method, provides a total order identical to JavaScript execution order. No additional synchronization is needed.

## UI Reconstruction Fidelity

### What IS Preserved After Resume

All `IContent` items from HistoryService are preserved in the JSONL recording and replayed on resume. These map to the following UI items via `convertToUIHistory()`:

| IContent Speaker | Block Types | UI HistoryItem Type | Preserved? |
|-----------------|-------------|--------------------|---------:|
| `human` | `text` | `user` | [OK] YES |
| `ai` | `text` | `gemini` | [OK] YES |
| `ai` | `tool_call` | `tool_group` (with tool names, call IDs, descriptions) | [OK] YES |
| `tool` | `tool_response` | (merged into `tool_group` via `toolResponseMap` lookup) | [OK] YES |
| `ai` | `text` + `tool_call` | `gemini` (text) + `tool_group` (tools) — both items | [OK] YES |
| `ai` | `thinking` | Not displayed separately (thinking is ephemeral) | WARNING: Thinking content in metadata is preserved in JSONL but not reconstructed as UI thought bubble |

### What is NOT Preserved (Transient UI Items)

The following UI item types exist during a live session but are NOT `IContent` — they are transient UI state that does not survive resume:

| UI HistoryItem Type | Source | Why Not Preserved |
|--------------------|--------|-------------------|
| `info` | Slash commands (`/help`, `/model`), system notices, "Request cancelled" | UI feedback items, not conversation content |
| `error` | API errors, tool errors surfaced to UI | Error banners are transient. Tool error content IS preserved in `tool_response.error`. |
| `warning` | System warnings (context window, loop detection) | Informational only |
| `compression` | Chat compression notice | The compression itself is captured as a `compressed` JSONL event. The UI notice is cosmetic. |
| `profile_change` | Profile switch notification | The provider switch is captured as a `provider_switch` JSONL event. |
| Loading spinner, streaming indicators | React state | Ephemeral React render state |
| Thinking bubbles | `thought` state in `useGeminiStream` | Displayed during streaming only |

### Why This Is Acceptable

1. **Same behavior as current `--continue`**: The existing implementation also only restores `IContent[]` items. Identical fidelity.
2. **Transient items are available for audit**: All session events are captured in the JSONL file as `session_event` entries. They are collected in `ReplayResult.sessionEvents` for audit but not added to `IContent[]` history and not re-displayed in UI.
3. **No user expectation of transient state**: Users expect to see the conversation (messages, tool calls, results) — which IS fully preserved.

### Historical session_event Surfacing on Resume

Historical `session_event` records are NOT re-displayed individually in the UI on resume. Instead, the resume flow inspects `ReplayResult.warnings` and `ReplayResult.sessionEvents` for actionable conditions:

- If any `session_event` has severity `"error"` and message contains `"ENOSPC"`: display a one-line warning — `"Note: Recording was disabled in the previous session due to disk full."`
- Otherwise: no historical session events are shown.

This ensures that critical operational issues (like disk full disabling recording) are surfaced to the user on resume, while routine informational events (like "Session resumed at...") are not re-displayed.

## Malformed Event Impact Analysis

When the replay engine encounters a known event type that fails schema validation, the event is skipped with a warning per REQ-RPL-003.

### Per-Event-Type Impact of Silent Drop

| Event Type | Impact of Dropping | Severity |
|---|---|---|
| `content` | A gap in conversation history. No state corruption — subsequent events still valid. | **Low** |
| `compressed` | Pre-compression history NOT cleared. History bloat, but conversation continues. | **Low** |
| `rewind` | Items that should have been removed remain. Longer-than-expected history, no crash. | **Low** |
| `provider_switch` | Wrong metadata (cosmetic). Actual provider determined by current CLI config. | **Cosmetic** |
| `session_event` | No impact. Session events are not part of `IContent[]` history. | **None** |
| `directories_changed` | Stale directory metadata (cosmetic). Actual dirs determined by current config. | **Cosmetic** |

**No malformed event can produce a crash or data loss.** The skip-with-warning policy is safe for all event types.

### Replay Malformed Event Summary Reporting

1. After replay completes, if any events were skipped, `ReplayResult.warnings` MUST include a summary: `"Replay completed: <N> of <total> events skipped due to malformation"`
2. If skipped count exceeds **5% of total events**, emit an additional WARNING-level entry: `"WARNING: >5% of events in session file are malformed (<N>/<total>). Session file may be significantly corrupted."`
3. This warning MUST be surfaced to the user on resume.
4. Threshold formula: `malformedKnownEventCount / (totalEventCount - unknownEventCount - unparseableLineCount) > 0.05`. Unknown event types (forward-compatible) and unparseable JSON lines are excluded from both numerator and denominator — only known event types with invalid payloads count as "malformed."

### Line 1 (session_start) vs Mid-File Corruption Tolerance

Line 1 is special. If line 1 cannot be parsed as a valid `session_start` event:
- **During discovery** (`--list-sessions`, `--continue` most-recent resolution): the file is skipped — not listed, not selectable. A file with a corrupt first line is not a valid session.
- **During explicit `--continue <id>`**: returns an error: "Session file is corrupt — missing or invalid session_start".
- **This is NOT the same as mid-file corruption tolerance.** Mid-file corrupt lines (line 2+) are individually skipped with warnings. The file remains usable — only the corrupt lines are lost.

The distinction: a corrupt first line makes the file **unidentifiable** (no sessionId, no projectHash). A corrupt line in the middle is simply a gap in the event stream.

## Non-Interactive Mode Recording

Non-interactive mode (`--prompt` flag or piped stdin) runs through `runNonInteractive()` in `packages/cli/src/nonInteractiveCli.ts`. This path has a fundamentally different lifecycle from the interactive `useGeminiStream` hook. Recording must be explicitly integrated.

### When Recording is Enabled

Recording is enabled in non-interactive mode if:
1. Session recording is globally enabled (not disabled via settings)
2. A session ID is available (always true — `config.getSessionId()` returns one)

### Execution Flow with Recording

```
1. gemini.tsx main():
   a. Config initialized, GeminiClient created
   b. Lock acquired: SessionLockManager.acquireForSession(chatsDir, sessionId)
   c. SessionRecordingService created (deferred materialization)
   d. RecordingIntegration created and subscribed to HistoryService
   e. registerCleanup() registered for lock release + final flush

2. runNonInteractive():
   a. User query processed (slash commands, @includes)
   b. while(true) loop runs turns:
      - geminiClient.sendMessageStream() → HistoryService records content
      - RecordingIntegration.onContentAdded() fires → writes to JSONL
      - Tool calls executed, responses sent back
   c. Loop exits when no more function calls

3. Flush: finally block of runNonInteractive() — BEFORE shutdownTelemetry()
```

### Differences from Interactive Mode

| Aspect | Interactive | Non-Interactive |
|--------|-----------|-----------------|
| Turn loop | `useGeminiStream` hook with React lifecycle | `while(true)` in `runNonInteractive()` |
| Flush trigger | Turn boundary in `useGeminiStream` `finally` | `finally` block in `runNonInteractive()` |
| Compression | Can happen mid-session | Unlikely but possible in multi-turn tool loops |
| Session end | `/exit`, Ctrl-C, window close | Loop exit, error, SIGINT |
| Recording lifetime | AppContainer mount → unmount | `runNonInteractive()` entry → exit |

### Error Handling

- If recording flush fails in the `finally` block, the error is caught and logged to stderr but does NOT prevent clean process exit
- If lock release fails, same best-effort behavior
- Abort signal (Ctrl-C) triggers `abortController.abort()`, which causes the stream loop to exit, which enters the `finally` block — recording flush still happens

## CLI Flag Exclusivity Matrix

### Current Flag Definitions (from `packages/cli/src/config/config.ts`)

| Flag | Type | Alias | Config Field | Line |
|------|------|-------|-------------|------|
| `--prompt` | `string` | `-p` | `argv.prompt` | 325 |
| `--prompt-interactive` | `string` | `-i` | `argv.promptInteractive` | 338 |
| `--continue` | `string \| boolean` | `-C` | `argv.continue` → `config.continueSession` | 363-369, 1413 |
| (positional) | `string[]` | — | `argv.promptWords` | 454-458 |

### New Flags (to be added in Phase 22)

| Flag | Type | Alias | Config Field |
|------|------|-------|-------------|
| `--list-sessions` | `boolean` | — | `argv.listSessions` |
| `--delete-session` | `string` | — | `argv.deleteSession` |

### NOTE on `--continue` Type Change

`--continue` is currently `boolean`. It changes to `string | boolean`:
- `--continue` (no value) → resume most recent session
- `--continue <id>` → resume specific session by ID/prefix

### Exclusivity Matrix

| Flag Combination | Behavior | Recording? |
|---|---|---|
| `--prompt "text"` | Non-interactive single run | [OK] Recorded, flush on completion |
| `--prompt "text" --continue` | Resume most recent + send prompt (non-interactive) | [OK] Recorded, appended to existing JSONL |
| `--prompt "text" --continue <id>` | Resume specific session + send prompt (non-interactive) | [OK] Recorded, appended to existing JSONL |
| `--continue` (no prompt) | Interactive, resume most recent session | [OK] Recorded, appended to existing JSONL |
| `--continue <id>` (no prompt) | Interactive, resume specific session | [OK] Recorded, appended to existing JSONL |
| `--list-sessions` | List recorded sessions, exit | [ERROR] No recording, read-only |
| `--delete-session <id>` | Delete session, exit | [ERROR] No recording, destructive |
| `--list-sessions --prompt` | **ERROR**: Mutually exclusive | N/A |
| `--delete-session --prompt` | **ERROR**: Mutually exclusive | N/A |
| `--list-sessions --continue` | **ERROR**: Mutually exclusive | N/A |
| `--delete-session --continue` | **ERROR**: Mutually exclusive | N/A |
| `--list-sessions --delete-session` | **ERROR**: Mutually exclusive | N/A |
| `piped stdin` (no flags) | Non-interactive, stdin as prompt | [OK] Recorded, flush on completion |
| `piped stdin --continue` | Resume + piped input | [OK] Recorded, appended to existing JSONL |
| `--prompt-interactive "text"` | Interactive with initial prompt | [OK] Recorded, normal interactive lifecycle |

### Validation Rules (to implement in `parseArguments()`)

```
1. --list-sessions and --delete-session are terminal flags:
   - Cannot combine with --prompt, --continue, positional words
   - --list-sessions and --delete-session cannot combine with each other

2. --prompt and positional words are mutually exclusive (already enforced)

3. Non-interactive detection:
   - !argv.promptInteractive && (hasPromptWords || argv.prompt || !process.stdin.isTTY)
   - --continue does NOT force interactive mode if --prompt is also given
```

### Recording Lifecycle by Mode

```
Interactive (no --continue):
  1. Lock acquired at startup
  2. New recording created
  3. RecordingIntegration subscribes to HistoryService
  4. Content events recorded on each turn
  5. Flush on turn boundary (useGeminiStream finally)
  6. Final flush + lock release on exit

Interactive (--continue):
  1. Lock acquired (re-lock existing session)
  2. Existing JSONL opened in append mode
  3. RecordingIntegration subscribes to HistoryService
  4. New content events appended (seq continues from last)
  5. Same flush/release lifecycle as fresh interactive

Non-interactive (--prompt):
  1. Lock acquired
  2. New recording created
  3. RecordingIntegration subscribes to HistoryService
  4. All turns run in while(true) loop
  5. Flush in finally block of runNonInteractive()
  6. Lock release via registerCleanup()

Non-interactive (--prompt --continue):
  1. Lock acquired (re-lock existing session)
  2. Existing JSONL opened in append mode
  3. RecordingIntegration subscribes
  4. New turn content appended
  5. Same finally-block flush as fresh non-interactive
```

## Constraints

- No external HTTP calls in tests
- All async operations must be properly awaited (no fire-and-forget except background write drain)
- File operations use `node:fs/promises` consistently
- Lock files use PID-based stale detection (check if PID is still running)
- No new npm dependencies — use only Node.js built-in modules
- JSONL lines must be independently parseable (no multi-line JSON)
- Replay trusts file order, not seq values (seq is for debugging only)
- Tests use real filesystem operations via `os.tmpdir()` temp directories

## Performance Requirements

- Session file creation: <5ms (deferred materialization means no I/O on startup)
- Event enqueue: <1ms (synchronous, in-memory)
- Flush: <50ms for typical turn (5-20 events)
- Replay: <500ms for files up to 10,000 events
- Session listing: <100ms (reads only first line + stat per file)
- Session discovery: <200ms for up to 100 session files

## Dependency Graph

```
#1362 (Core types + writer) ─── FOUNDATION, no deps
   ├── #1363 (Replay engine)
   ├── #1367 (Concurrency + lifecycle)
   ├── #1364 (Recording integration)
   │
   ├── #1365 (Resume flow) ←── depends on #1363 + #1367
   │     └── #1366 (List/delete) ←── depends on #1365 + #1367
   │
   └── #1369 (Cleanup adaptation) ←── depends on #1367
         └── #1368 (Remove old system) ←── depends on #1364 + #1365 + #1369 (LAST)
```
