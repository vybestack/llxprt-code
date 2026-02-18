# Domain Model: Session Browser & /continue Command

## Entity Relationships

### SessionBrowserDialog (UI Component)
- **Owns**: Rendering of the session list, search bar, sort bar, detail line, controls bar
- **Delegates to**: `useSessionBrowser` hook for all state management
- **Uses**: `useKeypress` for keyboard handling, `useResponsive` for layout adaptation
- **Receives**: `chatsDir`, `projectHash`, `currentSessionId`, `onSelect`, `onClose` via props
- **Renders within**: `DialogManager` component tree
- **Pattern reference**: `ProfileListDialog` — same structural pattern

### useSessionBrowser Hook (State Manager)
- **Owns**: All browser state (sessions, filteredSessions, searchTerm, sortOrder, selectedIndex, page, isSearching, isLoading, isResuming, deleteConfirmIndex, error, skippedCount)
- **References**: `EnrichedSessionSummary[]` (browser-side extended type)
- **Calls**: `SessionDiscovery.listSessionsDetailed(chatsDir, projectHash)`, `SessionDiscovery.readFirstUserMessage(filePath, maxLength?)`, `SessionDiscovery.hasContentEvents(filePath)`, `SessionLockManager.isLocked(chatsDir, sessionId)`, `deleteSession()`
- **Exposes callbacks**: `loadSessions()`, `handleSelect()`, `handleDelete()`, `handleSearch()`, `handleSort()`, `handlePageChange()`, `dismissError()`
- **Cache**: Preview text cached by `sessionId`; generation counter for stale-read protection

### EnrichedSessionSummary (Browser-Side Value Object)
- **Extends**: `SessionSummary` from core
- **Adds**: `firstUserMessage?: string`, `previewState: PreviewState`, `isLocked: boolean`
- **Lives in**: `useSessionBrowser.ts` (NOT in core types)
- **PreviewState discriminant**: `'loading' | 'loaded' | 'none' | 'error'`

### performResume (Shared Utility)
- **Owns**: Session resolution, new-session acquisition via `resumeSession()`, old-session disposal (two-phase swap)
- **Used by**: Browser path (via `onSelect`) AND direct `/continue <ref>` path
- **Calls**: `SessionDiscovery.listSessions()`, `SessionDiscovery.resolveSessionRef()`, `SessionDiscovery.hasContentEvents()`, `resumeSession()` from core
- **Receives mutable infrastructure refs**: `{ getCurrentRecording, setRecording }` callback pattern — NOT React setState
- **Returns**: `PerformResumeResult` discriminated union:
  - `{ ok: true, history: IContent[], clientHistory: Content[], metadata, warnings }` on success
  - `{ ok: false, error: string }` on failure
- **Side-effects performed BEFORE returning**: Acquires new session, disposes old recording integration and service, releases old lock, installs new recording infrastructure via `setRecording` callback
- **Does NOT own**: Confirmation dialogs, UI history conversion — those are caller responsibilities

### RecordingInfrastructure Refs (Mutable State Pattern)
- **Problem**: `recordingIntegration` is passed as a PROP to `AppContainer` from `gemini.tsx` (where it's a `const`). React `setState` CANNOT be used to swap it.
- **Solution**: Use a ref-based pattern where the caller (gemini.tsx integration layer or AppContainer) provides mutable callbacks:
  ```typescript
  interface RecordingSwapCallbacks {
    getCurrentRecording: () => SessionRecordingService | null;
    getCurrentIntegration: () => RecordingIntegration | null;
    getCurrentLockHandle: () => LockHandle | null;
    setRecording: (recording: SessionRecordingService, integration: RecordingIntegration, lock: LockHandle | null) => void;
  }
  ```
- **Lifecycle**: These callbacks mutate refs/variables in the hosting scope (gemini.tsx or a context provider). The new `RecordingIntegration` triggers HistoryService re-subscription via the existing `useEffect` in AppContainer.

### ResumeProgressOverlay (UI Component)
- **Owns**: Rendering of "Resuming..." status within the browser dialog
- **Controlled by**: `isResuming` state from `useSessionBrowser`
- **Blocks**: All keyboard input when active

### /continue Slash Command (Entry Point)
- **Owns**: Argument parsing, non-interactive mode checks, in-flight request checks, same-session checks
- **Returns**: `OpenDialogActionReturn` (no args) OR `LoadHistoryActionReturn` (direct resume) OR `MessageActionReturn` (error)
- **Provides**: Tab completion schema for session refs
- **Registered in**: `BuiltinCommandLoader.registerBuiltinCommands()`

### SessionDiscovery Extensions (Core Additions)
- **`listSessionsDetailed()`**: New static method — same as `listSessions()` plus `skippedCount`
- **`readFirstUserMessage(filePath, maxLength?)`**: New static method — reads JSONL for first user content event, extracts text preview (truncated to 120 chars)
- **`hasContentEvents(filePath)`**: New static method — checks if file has events beyond `session_start`

### Dialog Integration (Existing Pattern Extension)
- **DialogType union**: Add `'sessionBrowser'`
- **UIState**: Add `isSessionBrowserDialogOpen: boolean`
- **UIActions**: Add `openSessionBrowserDialog()`, `closeSessionBrowserDialog()`
- **DialogManager**: Add rendering case
- **slashCommandProcessor**: Add `case 'sessionBrowser'` in dialog switch

### SessionRecordingMetadata (State Object)
- **Fields**: `sessionId`, `filePath`, `startTime`, `isResumed`
- **Populated**: During startup in `gemini.tsx`
- **Updated**: During resume flow (via `setRecording` callback which also updates metadata)
- **Used by**: `/stats` session section, `performResume()` for currentSessionId

### /stats Session Section (UI Extension)
- **Reads**: `SessionRecordingMetadata` from command context
- **Displays**: Session ID (12 chars), start time (relative), file size, resumed status

### --resume Flag Removal (Cleanup)
- **Removes from**: `config.ts` (yargs option + parsed type), `sessionUtils.ts` (RESUME_LATEST, SessionSelector, SessionSelectionResult)
- **Preserves**: `SessionInfo`, `SessionFileEntry`, `getSessionFiles()`, `getAllSessionFiles()` (used by sessionCleanup)

### Relative Time Formatter (Utility)
- **Input**: Date or timestamp
- **Output**: Human-readable relative time in long or short mode
- **Used by**: SessionBrowserDialog (session rows), /stats session section
- **Long mode**: "2 hours ago", "yesterday", "3 days ago"
- **Short mode**: "2h ago", "1d ago", "3w ago"

### IContent Conversion (Caller Responsibility)
After `performResume()` returns successfully with `history: IContent[]`, the caller is responsible for converting this to the formats needed by the UI and model client:

- **`geminiClient.restoreHistory(history: IContent[])`**: Converts to `Content[]` (client history format) for model continuation. This restores the conversation state that the model API expects.
- **`iContentToHistoryItems(history: IContent[])`**: Converts to `HistoryItemWithoutId[]` (UI history format) for rendering in the conversation view. This populates the visual history display.

Note: `performResume()` already returns `clientHistory: Content[]` pre-converted via `restoreHistory()`, so callers typically only need to call `iContentToHistoryItems()` for UI history conversion.

### SemanticColors (Visual System Reference)
The SessionBrowserDialog uses the project's `SemanticColors` token system for consistent styling:

- **Accent color**: Selected item bullet (`●`), active sort label, search cursor (`▌`)
- **Primary color**: Title text, relative time, unselected bullets (`○`)
- **Secondary color**: Indexes, provider/model, file size, preview text, hints, inactive sort labels
- **Error color**: Error messages, inline error text
- **Warning color**: "(in use)" lock indicator

All color usage follows the existing dialog patterns (e.g., `ProfileListDialog`).

## State Transitions

### Session Browser Dialog States
```
CLOSED → /continue (no args) → LOADING
LOADING → listSessionsDetailed() complete → BROWSING
LOADING → listSessionsDetailed() error → ERROR_STATE
BROWSING → user types → SEARCHING
BROWSING → Tab key → SEARCHING
SEARCHING → Tab key → BROWSING (nav mode)
SEARCHING → Esc (non-empty term) → SEARCHING (term cleared)
SEARCHING → Esc (empty term) → CLOSED
BROWSING → Esc → CLOSED
BROWSING → Enter → CONFIRMING (if active conversation) | RESUMING (if no conversation)
BROWSING → Delete → DELETE_CONFIRMING
DELETE_CONFIRMING → Y → REFRESHING → BROWSING
DELETE_CONFIRMING → N/Esc → BROWSING
CONFIRMING → Y → RESUMING
CONFIRMING → N/Esc → BROWSING
RESUMING → success → CLOSED (history restored)
RESUMING → failure → BROWSING (error displayed)
```

### Preview Loading States (per session)
```
LOADING → readFirstUserMessage() returns text → LOADED
LOADING → readFirstUserMessage() returns null → NONE
LOADING → readFirstUserMessage() throws → ERROR
LOADING → page change (stale generation) → DISCARDED
```

### Two-Phase Recording Swap State Machine

This state machine governs the recording infrastructure swap during `performResume()`:

```
Idle
  │
  ├── performResume() called
  ▼
Preparing
  │  - Resolve session reference
  │  - capturedGeneration = ++currentGeneration
  │  - Check same-session, lock, emptiness
  │
  ├── resolution error → return { ok: false } → Idle
  ▼
AcquiringNewSession  (Phase 1)
  │  - Call resumeSession() — acquires lock, replays, creates new recording
  │  - Check capturedGeneration === currentGeneration (abort if stale)
  │
  ├── resumeSession() fails → return { ok: false } → Idle (old session fully intact)
  ▼
CurrentQuiesced  (Phase 2a — unsubscribe old)
  │  - Call currentRecordingIntegration.dispose() — unsubscribes from HistoryService
  │  - This prevents new events from reaching the old recording service
  │
  ├── dispose error → log warning, continue
  ▼
OldServiceFlushed  (Phase 2b — flush & close old)
  │  - Call currentRecording.dispose() — flushes queue, closes file handle
  │  - Safe because HistoryService is already unsubscribed
  │
  ├── dispose error → log warning, continue
  ▼
OldLockReleased  (Phase 2c — release old lock)
  │  - Call currentLockHandle.release() (skip if null — fresh session)
  │
  ├── release error → log warning, continue
  ▼
TargetActivated  (Phase 2d — install new infrastructure)
  │  - Call setRecording(newRecordingService, newIntegration, newLockHandle)
  │  - Update SessionRecordingMetadata (isResumed = true)
  │  - New RecordingIntegration triggers useEffect re-subscription in AppContainer
  │
  ▼
Committed
  │  - Return { ok: true, history, metadata, warnings }
  │  - All new events now go to the new session file
  │
  ▼
Idle

Rollback transitions:
  - Preparing → error → Idle (nothing to roll back)
  - AcquiringNewSession → error → Idle (old session intact, new session not yet acquired)
  - CurrentQuiesced → error (dispose fail) → log + continue to OldServiceFlushed
  - OldServiceFlushed → error (dispose fail) → log + continue to OldLockReleased
  - OldLockReleased → error (release fail) → log + continue to TargetActivated
  
Note: Once Phase 1 (AcquiringNewSession) succeeds, Phase 2 is best-effort.
Phase 2 failures are logged but do NOT prevent the swap from completing.
```

### performResume Flow States
```
IDLE → performResume() called → DISCOVERING
DISCOVERING → listSessions() → RESOLVING
RESOLVING → resolveSessionRef() → CHECKING_LOCK
CHECKING_LOCK → hasContentEvents() (for "latest") → ACQUIRING
ACQUIRING → resumeSession() → SWAPPING
SWAPPING → dispose old integration → SWAPPING
SWAPPING → dispose old service → SWAPPING
SWAPPING → release old lock → SWAPPING
SWAPPING → install new recording via setRecording() → COMPLETE
COMPLETE → return ok result → IDLE

ERROR at any step → return error result → IDLE
```

### Generation Guard Lifecycle

```
The generation counter protects against stale async results:

1. performResume() increments generationCounter at start: capturedGeneration = ++currentGeneration
2. After each async operation (listSessions, resolveSessionRef, resumeSession), check:
   if (capturedGeneration !== currentGeneration) return { ok: false, error: 'Stale resume attempt' }
3. This ensures that if a second performResume() call is triggered before the first completes,
   the first one's results are safely discarded.
4. The generation counter is separate from the preview-loading generation counter in useSessionBrowser.
```

### Recording Service Swap States (Two-Phase)
```
PHASE_1_START → call resumeSession(request) → PHASE_1_PENDING
PHASE_1_PENDING → success → PHASE_1_COMPLETE (new recording acquired)
PHASE_1_PENDING → failure → ABORT (old session intact)
PHASE_1_COMPLETE → dispose old recording integration (unsubscribes HistoryService) → PHASE_2_DISPOSING
PHASE_2_DISPOSING → dispose old recording service (flushes + closes file) → PHASE_2_LOCK_RELEASE
PHASE_2_LOCK_RELEASE → release old lock handle → PHASE_2_INSTALL
PHASE_2_INSTALL → setRecording(newService, newIntegration, newLock) → PHASE_2_COMPLETE
PHASE_2_COMPLETE → return { ok: true } → DONE
```

### Escape Key Priority Stack
```
CHECK: deleteConfirmIndex !== null? → dismiss delete confirm
CHECK: showActiveConversationConfirm? → dismiss conversation confirm
CHECK: searchTerm !== ''? → clear search term
CHECK: none of above? → close browser
```

### Modal Priority Stack
```
Priority 1: Delete confirmation (Y/N/Esc consumed, all else ignored)
Priority 2: Active-conversation confirmation (Y/N/Esc consumed, all else ignored)
Priority 3: isResuming (ALL keys ignored including Esc)
Priority 4: Normal browser operation (search mode / nav mode)
```

## Business Rules

### Browser Display Rules
1. **Current session excluded**: The session being actively recorded is never shown
2. **Empty sessions hidden**: Sessions with only `session_start` (no content events) are filtered out
3. **Unreadable sessions counted**: Sessions with corrupt headers are excluded but counted in `skippedCount`
4. **Sort default**: Newest-first by modification time
5. **Page size**: 20 sessions per page
6. **Preview truncation**: First user message truncated to 120 chars
7. **Search fields**: Matches against `firstUserMessage`, `provider`, `model`

### Preview Loading Rules
1. **Page-scoped**: Only load previews for visible page
2. **Generation counter**: Discard results from stale pages/sorts
3. **Cache by sessionId**: Never re-read a successfully loaded preview
4. **Eventually-consistent search**: Unloaded previews included in search results; removed when loaded preview doesn't match
5. **Error tolerance**: Preview errors show "(preview unavailable)", not crash

### Resume Rules
1. **Two-phase swap**: New session acquired before old disposed
2. **Single utility**: Both browser and direct path use `performResume()`
3. **Active conversation check**: Confirmation shown if non-empty model history
4. **Non-interactive rejection**: Active conversation in non-interactive mode → error
5. **Same-session check**: Cannot resume the currently active session
6. **In-flight check**: Cannot resume while model is processing
7. **Lock re-check**: Lock verified at action time (initial check is best-effort)
8. **Concurrent prevention**: `isResuming` flag blocks second attempt
9. **Ref-based recording swap**: `performResume()` receives `RecordingSwapCallbacks` to imperatively swap recording infrastructure — does NOT use React setState for `recordingIntegration`
10. **Generation guard**: Every `performResume()` call increments a generation counter; all async operations check `currentGeneration === capturedGeneration` before proceeding; stale results are discarded

### Delete Rules
1. **Navigation mode only**: Delete key only works in nav mode
2. **Confirmation required**: Y to confirm, N or Esc to cancel
3. **By sessionId**: Delete uses sessionId, not UI index
4. **Selection preservation**: After delete, select by sessionId or fall back to clamped index
5. **Page adjustment**: If page empties after delete and page > 0, move to previous page
6. **Lock check**: Locked sessions cannot be deleted

### Keyboard Rules
1. **Backspace NEVER deletes sessions**: Only edits search text
2. **Enter works in both modes**: Resumes selected session from search or nav mode
3. **Tab toggles mode**: Search ↔ Navigation
4. **s cycles sort**: Only in navigation mode; typed into search in search mode
5. **Empty list**: Enter, Delete, arrows, PgUp/PgDn are all no-ops

### Dialog Integration Rules
1. **No second instance**: `/continue` while browser is open is a no-op
2. **Confirmation inline**: Active-conversation confirmation rendered inside browser, not via ConsentPrompt
3. **Props computed at render time**: chatsDir, projectHash, currentSessionId derived from config/state

## Edge Cases

### Browser Edge Cases
- Zero sessions for project (after filtering): Empty state message
- All sessions locked: All show "(in use)", resume/delete fail with error
- Session disappears between list and action: "Session no longer exists", refresh
- Very long first message: Truncated to 120 chars with "..."
- Session with no user messages: Shows "(no user message)"
- Preview read I/O error: Shows "(preview unavailable)"
- Rapid page changes: Generation counter discards stale previews
- Search term matches loading previews: Included until proven non-matching
- Delete last session on page > 0: Move to previous page
- Delete when only 1 session exists: Empty state after refresh

### Resume Edge Cases
- Resume during active model processing: Blocked with error
- Resume with active conversation (interactive): Confirmation shown
- Resume with active conversation (non-interactive): Error
- Resume locked session: Error, list refresh
- Resume session that disappeared: Error, list refresh
- Replay failure: Error, old session intact
- Lock release failure during swap: Warning logged, continue
- Concurrent resume attempts: Blocked by isResuming flag AND generation guard
- Resume "latest" when all are locked/empty: Error
- Resume into different provider/model: Warning from core resumeSession
- Stale resume attempt (generation mismatch): Silently discarded

### Keyboard Edge Cases
- Esc with delete confirmation showing: Dismiss confirmation (not clear search or close)
- Esc with conversation confirmation: Dismiss confirmation
- Esc during resume: Ignored (non-cancellable)
- Backspace in nav mode: No-op (not delete)
- Delete in search mode: No-op
- PgUp on first page: No-op
- PgDn on last page: No-op
- Terminal intercepts PgUp/PgDn: Known limitation

### Responsive Edge Cases
- Terminal resized during browse: Layout adapts via useResponsive
- Narrow mode: No border, no sort bar, no detail line, truncated content
- Switch between wide and narrow: Single switch, no intermediate state

## Error Scenarios

| Scenario | Component | Behavior |
|----------|-----------|----------|
| Discovery failure (permissions) | useSessionBrowser | Error state: "Failed to load sessions: {details}" |
| Individual preview read failure | useSessionBrowser | "(preview unavailable)" for that session |
| Session locked (resume attempt) | performResume | Inline error: "Session is in use by another process." |
| Session locked (delete attempt) | useSessionBrowser | Inline error from deleteSession() |
| Session disappeared | performResume | Inline error: "Session no longer exists." |
| Replay failure | performResume | Inline error: "Failed to replay session: {details}" |
| Lock release failure (swap) | performResume | Warning logged, new session continues |
| Delete I/O failure | useSessionBrowser | Inline error: "Failed to delete session: {details}" |
| Delete permission denied | useSessionBrowser | Inline error: "Permission denied: {details}" |
| Non-interactive /continue (no args) | continueCommand | Error: "Session browser requires interactive mode." |
| In-flight request | continueCommand | Error: "Cannot resume while a request is in progress." |
| Same session as current | continueCommand | Error: "That session is already active." |
| Active conversation (non-interactive) | continueCommand | Error: "Cannot replace active conversation in non-interactive mode." |
| Ambiguous session prefix | SessionDiscovery | Error listing matching IDs |
| Out-of-range index | SessionDiscovery | Error: out of range |
| No resumable sessions for "latest" | performResume | Error: no resumable sessions |
| Stale resume (generation mismatch) | performResume | Silently discarded, returns stale error |
