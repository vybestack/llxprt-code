# Session Browser & /resume Command — Technical Specification

**Issue:** #1385
**Depends on:** #1361 (Session Recording Service — merged)

## 1. Architecture Overview

The session browser is a React/Ink dialog component in `packages/cli`, driven by a custom hook, that interacts with existing core-layer APIs for session discovery, replay, locking, and deletion. A new `/resume` top-level slash command serves as the entry point. The browser integrates with the existing dialog management system via `DialogManager` and `UIState` flags — the same pattern used by all other dialogs in the app.

Both the browser path and the direct `/resume <ref>` path share a single `performResume()` utility that owns the side-effects (lock management, recording swap, history restore). This avoids ownership drift between the two paths.

```
┌─────────────────────────────────────────────────────────┐
│  /resume slash command                                  │
│  (packages/cli/src/ui/commands/resumeCommand.ts)        │
│         │                                               │
│     ┌───┴────────────────────┐                          │
│     │ no args                │ with args                │
│     v                        v                          │
│  OpenDialogActionReturn    performResume() directly     │
│  { dialog: 'sessionBrowser' }  │                        │
│     │                          │                        │
│     v                          v                        │
│  DialogManager renders       Returns                    │
│  SessionBrowserDialog        LoadHistoryActionReturn     │
│     │                                                   │
│     v                                                   │
│  User selects -> onSelect(summary)                      │
│     │                                                   │
│     v                                                   │
│  performResume()                                        │
│     │ (shared with direct path)                         │
│     v                                                   │
│  Core APIs:                                             │
│    resumeSession()                                      │
│    SessionDiscovery.listSessions()                      │
│    sessionManagement.deleteSession()                    │
└─────────────────────────────────────────────────────────┘
```

## 2. Core APIs (Existing — Minimal Changes)

The following APIs from `packages/core/src/recording/` are used as-is:

### SessionDiscovery

- `SessionDiscovery.listSessions(chatsDir, projectHash): Promise<SessionSummary[]>` — Returns all JSONL sessions for the project, sorted newest-first by modification time. Signature unchanged.
- `SessionDiscovery.listSessionsDetailed(chatsDir, projectHash): Promise<{ sessions: SessionSummary[], skippedCount: number }>` — **New.** Same as `listSessions()` but also returns a count of session files that were skipped due to unreadable headers. The browser hook uses this variant; `listSessions()` remains unchanged for all existing callers.
- `SessionDiscovery.hasContentEvents(filePath): Promise<boolean>` — **New.** Reads just past the first line of a JSONL file to determine if the session contains any events beyond `session_start`. Returns `false` for empty sessions (opened and immediately closed). Used by the browser hook to filter out empty sessions from the list. This is a fast operation — it only needs to check if a second line exists.
- `SessionDiscovery.resolveSessionRef(ref, sessions): SessionResolution | SessionResolutionError` — Resolves a user reference (exact ID, prefix, or 1-based index) to a specific session.

### sessionManagement

- `deleteSession(ref, chatsDir, projectHash): Promise<DeleteSessionResult | DeleteSessionError>` — Deletes a session by reference, refusing if locked.

### resumeSession

- `resumeSession(request: ResumeRequest): Promise<ResumeResult | ResumeError>` — Discovers, locks, replays, and initializes recording for a session. Returns reconstructed `IContent[]` history, metadata, a `SessionRecordingService` for append, and a `LockHandle`.

### Types

- `SessionSummary` — `{ sessionId, filePath, projectHash, startTime, lastModified, fileSize, provider, model }`
- `ResumeResult` — `{ ok: true, history, metadata, recording, lockHandle, warnings }`
- `ResumeError` — `{ ok: false, error }`

## 3. New Core Enhancement: First Message Preview

`SessionSummary` does not currently include a first-message preview. The session browser needs this for display.

### New Static Method on SessionDiscovery

Add `SessionDiscovery.readFirstUserMessage(filePath): Promise<string | null>` that reads the JSONL file sequentially until it finds the first `content` event where `payload.content.speaker === 'user'`, extracts a text preview (truncated to 120 chars), and returns it. Returns `null` if no user message is found. If the file is readable but the payload has an unexpected schema, returns `null` (does not throw).

Text extraction from `IContent`: The `IContent` type has a `parts` array containing `TextPart`, `InlineDataPart`, etc. The implementation should concatenate text from `TextPart` entries (those with a `text` property) and ignore non-text parts. Reference: `iContentToHistoryItems.ts` in `packages/cli/src/ui/utils/` for the existing text extraction pattern.

This method is NOT called during `listSessions()` — the core API remains unchanged. Instead, the browser hook calls it separately for progressive enrichment (see Section 4.1).

### Extended SessionSummary (Browser-Side Only)

The browser hook defines an extended type for its internal use:

```typescript
type PreviewState = 'loading' | 'loaded' | 'none' | 'error';

interface EnrichedSessionSummary extends SessionSummary {
  firstUserMessage?: string;     // Present only when previewState === 'loaded'
  previewState: PreviewState;    // Discriminated state for UI rendering
  isLocked: boolean;             // Lock status at time of list load
}
```

This extended type lives in the browser hook, NOT in core types. The discriminated `previewState` avoids ambiguous null semantics.

## 4. New CLI Components

### 4.1 useSessionBrowser Hook

**Location:** `packages/cli/src/ui/hooks/useSessionBrowser.ts`

**State managed:**
- `sessions: EnrichedSessionSummary[]` — Full list from discovery with progressive enrichment.
- `filteredSessions: EnrichedSessionSummary[]` — After search filter applied.
- `searchTerm: string` — Current search input.
- `sortOrder: 'newest' | 'oldest' | 'size'` — Active sort.
- `selectedIndex: number` — Currently highlighted item index within the filtered list.
- `page: number` — Current page (0-based).
- `isSearching: boolean` — Whether search input is focused.
- `isLoading: boolean` — Whether initial session list is being loaded.
- `isResuming: boolean` — Whether a resume is in progress (disables Enter/navigation).
- `deleteConfirmIndex: number | null` — If non-null, showing delete confirmation for this item.
- `error: string | null` — Error message to display (clears on next action).
- `skippedCount: number` — Count of unreadable session files skipped, from `SessionDiscovery.listSessionsDetailed()` (see Section 2).

**Key behaviors:**

- **Initial load:** Calls `SessionDiscovery.listSessionsDetailed()`, checks lock status for each session (via `SessionLockManager.isLocked()`), filters out the current session by `sessionId`, filters out empty sessions (those with no content events — only a `session_start` line), stores `skippedCount`, and renders immediately with metadata (`previewState: 'loading'`). Then asynchronously calls `readFirstUserMessage()` for each session on the visible page, updating `previewState` to `'loaded'` (with text), `'none'` (no user message found), or `'error'` (read failed) as each resolves.
- **Preview cancellation and caching:** When the user changes pages or re-sorts, in-flight preview reads for the old page are discarded using a generation counter. Each page/list load increments the counter; results from stale generations are ignored. Successfully-loaded previews are cached by `sessionId` to avoid re-reading when navigating back to a previously-visited page.
- **Lock checking policy:** Lock status is checked once during initial load and again when a resume or delete is attempted. No periodic polling.
- **Search:** Filters against `firstUserMessage` (if loaded), `provider`, and `model` fields. Sessions with `previewState !== 'loaded'` are always included in search results (not prematurely filtered out). Filtering is eventually-consistent: as previews resolve, sessions whose loaded preview does not match the search term are removed from the filtered list. This may cause the list to shrink as previews arrive.
- **Sort:** Re-sorts the session list; triggers preview enrichment for the new visible page.
- **Selection clamping:** When the filtered list changes (search term change, deletion, page change), the selected index is clamped to `[0, max(filteredSessions.length - 1, 0)]`. If the page becomes empty after deletion and page > 0, the page decrements.
- **Empty list behavior:** When `filteredSessions.length === 0`, Enter and Delete are no-ops. Up/Down/PgUp/PgDn are no-ops. The selection index is reset to 0.
- **Refresh:** Called after delete success, resume failure (session disappeared), or other stale-data scenarios. Reloads the full session list.

**Callbacks exposed:**
- `loadSessions()` — Initial load and refresh. Uses a generation counter (shared with preview enrichment) to discard results from stale loads if a newer refresh was triggered before the older one completed.
- `handleSelect(index)` — Emits the selected `SessionSummary` to the parent via `onSelect`.
- `handleDelete(index)` — Shows delete confirmation; on confirm, calls `deleteSession()` with the `sessionId` (not numeric index) and refreshes. After refresh, selection is preserved by `sessionId`: if the previously-selected session still exists, it remains selected; otherwise the selection falls back to the same index position (clamped to the new list length).
- `handleSearch(term)` — Updates `searchTerm`, resets page to 1, resets selection to the first item, and re-filters.
- `handleSort(order)` — Updates `sortOrder` and re-sorts.
- `handlePageChange(delta)` — Changes page by +/-1.
- `dismissError()` — Clears the error state.

### 4.2 SessionBrowserDialog Component

**Location:** `packages/cli/src/ui/components/SessionBrowserDialog.tsx`

A React/Ink component that renders the session browser dialog. Follows the patterns established by `ProfileListDialog`:

- Uses `useSessionBrowser` hook for state and callbacks.
- Uses `useKeypress` for keyboard handling.
- Uses `useResponsive` for narrow/wide layout adaptation (uses `isNarrow` from `useResponsive()`, not a hardcoded threshold).
- Renders within a `<Box borderStyle="round">` container (wide mode) or borderless (narrow mode).
- Uses `SemanticColors` from `'../colors.js'` for all color tokens.

**Props:**
```typescript
interface SessionBrowserDialogProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}
```

The dialog does not call `resumeSession()` directly. `onSelect` is wired by the parent to call `performResume()` and returns its result. The hook `await`s this promise, using it to:
- Set `isResuming = true` before the call and `false` after.
- On success (`ok: true`): signal the parent to close the dialog and restore history.
- On failure (`ok: false`): set `error` state to display the error inline and refresh the list.

This keeps resume side-effects external while giving the dialog the feedback it needs for inline error display and the "Resuming..." spinner.

**Layout structure (wide mode):**
1. Title: "Session Browser"
2. Search bar: `Search: {searchTerm}` with match count and mode hint
3. Sort bar: labels with active indicator and `(press s to cycle)` hint
4. Skipped notice: "Skipped N unreadable session(s)." (only if skippedCount > 0)
5. Session list: paginated, 20 per page, two-line rows (metadata + preview)
6. Page indicator: "Page X of Y" with PgUp/PgDn hint (only when multi-page)
7. Error message (if any): inline above the detail line
8. Resume status: "Resuming..." (if `isResuming`)
9. Selection detail: session ID, provider/model, relative time
10. Controls bar: keyboard shortcut legend

**Layout structure (narrow mode):**
1. Title: "Sessions"
2. Search bar: compact
3. Skipped notice (if applicable)
4. Session list: compact two-line rows (abbreviated metadata + truncated preview), short session ID suffix on selected row
5. Page indicator (if multi-page)
6. Error message (if any)
7. Controls bar: abbreviated, includes sort hint (e.g. `s:newest`)

### 4.3 /resume Slash Command

**Location:** `packages/cli/src/ui/commands/resumeCommand.ts`

A new top-level slash command registered alongside existing commands like `/chat`, `/stats`, etc.

**Behavior:**
- `/resume` (no args) — Returns `{ type: 'dialog', dialog: 'sessionBrowser' }` (an `OpenDialogActionReturn`), which causes the command processor to set `uiState.isSessionBrowserDialogOpen = true`.
- `/resume latest` — Calls `performResume()` directly and returns a `LoadHistoryActionReturn` on success, or a `MessageActionReturn` with the error on failure.
- `/resume <ref>` — Same as `latest` but with the specific ref.

For the direct path (`/resume latest` and `/resume <ref>`), `performResume()` handles all side-effects (recording swap, lock management) before returning. The returned `LoadHistoryActionReturn` carries only the UI history and client history; the recording infrastructure is already swapped.

**Same-session check:** If the ref resolves to the current session ID, the command returns an error: "That session is already active."

**In-flight request check:** If the model is currently processing (tool calls executing, `isProcessing` is true), the command returns an error: "Cannot resume while a request is in progress." This prevents corrupting in-flight tool-call state. The `isProcessing` flag is available from `CommandContext` or the relevant UI state.

**Non-interactive mode check:** If `config.isInteractive()` returns false and no argument is provided, the command returns an error: "Session browser requires interactive mode. Use /resume latest or /resume <id>."

**Schema (for tab completion):**
```typescript
const resumeSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'session',
    description: 'Session ID, index, or "latest"',
    completer: async (ctx) => {
      // Return "latest" plus session previews as completions
    },
  },
];
```

### 4.4 /stats Session Section

**Location:** Modify `packages/cli/src/ui/commands/statsCommand.ts`

Add a "Session" section to the existing stats output that displays:
- Session ID (first 12 chars)
- Started (relative time)
- File size
- Resumed (yes/no)

**Data source:** Session metadata is stored in a `SessionRecordingMetadata` object that is maintained as React state (see Section 9 for details on how this integrates with the React component tree).

```typescript
interface SessionRecordingMetadata {
  sessionId: string;
  filePath: string | null;
  startTime: string;
  isResumed: boolean;
}
```

This metadata is populated during startup (in `gemini.tsx`) and updated during the resume flow.

## 5. Dialog Integration (Existing Pattern — No New Action Types)

The session browser uses the existing dialog management pattern. No new `SlashCommandActionReturn` union members are needed.

### Integration Steps

1. Add `'sessionBrowser'` to the `DialogType` union in `packages/cli/src/ui/commands/types.ts`.
2. Add `isSessionBrowserDialogOpen: boolean` to `UIState` in `packages/cli/src/ui/contexts/UIStateContext.ts`.
3. Add `openSessionBrowserDialog()` / `closeSessionBrowserDialog()` to `UIActions` in `packages/cli/src/ui/contexts/UIActionsContext.ts`.
4. In the command processor's dialog-open switch (`slashCommandProcessor.ts`), handle `'sessionBrowser'` by calling `uiActions.openSessionBrowserDialog()`.
5. In `DialogManager.tsx`, add a conditional block for `uiState.isSessionBrowserDialogOpen` that renders `<SessionBrowserDialog>`, passing the required props and an `onSelect` handler.

### Prop Plumbing for SessionBrowserDialog

The dialog requires three external values: `chatsDir`, `projectHash`, and `currentSessionId`.

- **`chatsDir`**: Computed from `config.storage.getProjectTempDir()` + `'/chats'` — available from the `Config` instance accessible via `CommandContext.services.config` or the `ConfigContext`.
- **`projectHash`**: Computed by `getProjectHash(config.getProjectRoot())` — a pure hash function safe to call at any time.
- **`currentSessionId`**: Available from the `SessionRecordingMetadata` state (populated during startup).

The `DialogManager` (or `AppContainer`) computes these at dialog render time and passes them as props. The exact wiring depends on which component has `config` in scope — trace the existing dialog plumbing pattern (e.g., how `ProfileListDialog` gets its props).

### onSelect Handler Ownership

The `onSelect` handler is wired in `DialogManager` (or `AppContainer` where all necessary dependencies are in scope). It returns a `Promise<PerformResumeResult>` so the dialog can show inline errors and the "Resuming..." spinner. When `onSelect(session)` fires:

1. If there is an active conversation (non-empty model history), the dialog shows the active-conversation confirmation inline (rendered inside `SessionBrowserDialog`, NOT via the existing `ConsentPrompt` mechanism which would close the browser).
2. On confirmation (or no active conversation), the hook sets `isResuming = true` and `await`s the `onSelect` promise.
3. The `onSelect` implementation in `DialogManager` calls `performResume()`.
4. On success (`ok: true`), update React state for the recording infrastructure (see Section 9) and close the dialog.
5. On failure (`ok: false`), return the error. The hook sets `error` state and refreshes the list.

## 6. --resume Flag Removal

### Files to Modify

1. **`packages/cli/src/config/config.ts`** — Remove the `.option('resume', ...)` yargs configuration and the `resume` field from the parsed args type.
2. **`packages/cli/src/config/config.ts`** — Remove any coercion logic for `--resume`.
3. **`packages/cli/src/config/config.test.ts`** — Remove tests for `--resume` parsing.
4. **`packages/cli/src/utils/sessionUtils.ts`** — Remove `RESUME_LATEST`, `SessionSelector`, and `SessionSelectionResult`.

### What MUST Be Preserved

The following exports in `sessionUtils.ts` are used by `sessionCleanup.ts` and cannot be removed:
- `SessionInfo` interface
- `SessionFileEntry` interface
- `getSessionFiles()` function
- `getAllSessionFiles()` function

### Preservation of Other Functionality

- `--continue` / `-C` flag and its entire flow through `Config.getContinueSessionRef()` -> `resumeSession()` is untouched.
- `--list-sessions` flag is untouched.
- `--delete-session` flag is untouched.

## 7. performResume() — Shared Resume Utility

Both the browser path and the direct `/resume <ref>` path use a single `performResume()` function that owns all resume side-effects.

**Location:** `packages/cli/src/utils/performResume.ts` (or co-located with `resumeCommand.ts`)

**Signature:**
```typescript
async function performResume(
  sessionRef: string,
  context: ResumeContext,
): Promise<PerformResumeResult>
```

Where `sessionRef` is the raw user argument ("latest", a session ID, a prefix, or a 1-based index string). The function uses `SessionDiscovery.listSessions()` + `SessionDiscovery.resolveSessionRef()` to resolve it — this is independent of the `--continue` CLI flow and does NOT use `CONTINUE_LATEST` or `SessionSelector`. For `"latest"`, `performResume()` picks the first resumable session from the newest-first list — i.e. the first session that is not locked, not the current session, and not empty (has content events). If no resumable session exists, it returns an error.

`ResumeContext` contains `chatsDir`, `projectHash`, `currentSessionId`, `currentProvider`, `currentModel`, `workspaceDirs`, and references to the current recording/lock infrastructure. The provider/model/workspaceDirs are required by the core `resumeSession()` API to initialize the new recording service. `PerformResumeResult` is a discriminated union:

```typescript
type PerformResumeResult =
  | { ok: true; history: IContent[]; metadata: SessionMetadata; warnings: string[]; newRecording: SessionRecordingService; newLockHandle: LockHandle | null }
  | { ok: false; error: string }
```

The caller (command action or dialog handler) is responsible for:
- Checking same-session (if `ref` resolves to `currentSessionId`)
- Showing confirmation for active conversation
- Converting `IContent[]` to `Content[]` + `HistoryItemWithoutId[]`
- Updating React state / CommandContext
- Displaying warnings

## 8. IContent[] Conversion

`resumeSession()` returns `IContent[]`. The generative client expects `Content[]` (Google genai type) and the UI expects `HistoryItemWithoutId[]`.

**Existing utilities to reuse:**
- **Client history:** `geminiClient.restoreHistory(history: IContent[])` — already handles `IContent[]` → `Content[]` conversion and sets client history in one call. Used by the `--continue` resume flow in `gemini.tsx`.
- **UI history:** `iContentToHistoryItems(history: IContent[]): HistoryItemWithoutId[]` — already exists at `packages/cli/src/ui/utils/iContentToHistoryItems.ts` and is tested.

No new conversion utility is needed. The `performResume()` caller uses `geminiClient.restoreHistory()` for the client side and `iContentToHistoryItems()` for the UI side, matching the existing `--continue` flow.

## 9. Recording Service Swap — Two-Phase Approach

When resuming a session (from browser or direct), the recording infrastructure must be swapped safely. The key invariant is: **the old session is not disposed until the new session is fully acquired and ready.**

### Two-Phase Swap

**Phase 1 — Acquire new session (old session still active):**
1. Call `resumeSession()` with the selected session's ref.
2. If it fails: return error. The old session remains fully intact, no data loss.
3. If it succeeds: we now have a new `SessionRecordingService`, new `LockHandle`, and replayed `IContent[]` history.

**Phase 2 — Swap (new session acquired, now dispose old):**
4. Call `recordingIntegration.dispose()` on the old bridge first — this unsubscribes from `HistoryService` so no new events are routed to the old recording. Then call `recordingService.dispose()` on the underlying `SessionRecordingService` — this flushes any buffered events and closes the file handle. Order matters: unsubscribe before flush/close to prevent writing events to a closing file.
5. Call `lockHandle.release()` on the old lock. If this fails (e.g. EPERM, stale), log a warning but continue — the stale-lock mechanism will clean it up. Note: `lockHandle` may be null for sessions that were started fresh (not resumed) — skip this step in that case.
6. Update React state to point to the new recording/lock:
   - Set new `recordingIntegration` (wrapping `ResumeResult.recording`)
   - Set new `lockHandle`
   - Set new `sessionRecordingMetadata`
7. The React component tree re-renders with the new `recordingIntegration`, triggering the `useEffect` in `AppContainer` that subscribes it to `HistoryService`.

**Cancellation:** Resume is non-cancellable once Phase 1 begins. The core `resumeSession()` call cannot be safely aborted mid-replay. The `isResuming` flag prevents concurrent attempts and Esc is ignored until the operation completes or fails.

### React State Integration

The current `recordingIntegration` is passed as a prop to `AppContainer`, which uses a `useEffect` to subscribe it to `HistoryService`. After a swap:

- The new `RecordingIntegration` must be stored in React state (not just on a ref or `CommandContext`) so that the component tree re-renders and the `useEffect` re-fires with the new integration.
- This may require lifting `recordingIntegration` into the state of whichever component manages it (likely `AppContainer` or its parent), or introducing a `RecordingContext` that provides the current integration.
- The exact integration point depends on the current prop-threading architecture — the implementor should trace the `recordingIntegration` prop flow and store the new integration at the correct level to trigger re-subscription.

### Failure Recovery

- If Phase 1 fails: Old session is intact. No recovery needed.
- If Phase 2 steps 4-5 fail (old dispose/lock-release): Log warnings, continue with new session. Old lock becomes stale and will be cleaned up eventually.
- If Phase 2 step 6 fails (React state update fails): This should not happen in practice (React setState is synchronous within the render cycle). If it did, the new recording would be orphaned — but this is an extreme edge case.

### State After Resume

```
recordingIntegration = new (wrapping ResumeResult.recording)
lockHandle = ResumeResult.lockHandle
sessionRecordingMetadata = { sessionId: resumed, isResumed: true, ... }
geminiClient.history = converted IContent[] -> Content[]
UI history = converted IContent[] -> HistoryItemWithoutId[]
HistoryService subscription = new integration (via useEffect re-fire)
```

## 10. Relative Time Formatting

Session times are displayed as relative timestamps. This requires a utility function.

**Location:** `packages/cli/src/ui/utils/relativeTime.ts`

Before creating this utility, check if the project already has time formatting utilities that can be reused.

The function accepts a `Date` and a `mode: 'short' | 'long'` parameter. Future timestamps (e.g., from clock skew) are clamped to "just now" / "now" — never display negative deltas.

**Long mode (wide terminal):**
- < 1 minute: "just now"
- < 1 hour: "N minutes ago"
- < 24 hours: "N hours ago"
- < 48 hours: "yesterday"
- < 7 days: "N days ago"
- < 30 days: "N weeks ago"
- otherwise: formatted date (e.g. "Jan 15")

**Short mode (narrow terminal):**
- < 1 minute: "now"
- < 1 hour: "Nm ago"
- < 24 hours: "Nh ago"
- < 7 days: "Nd ago"
- < 30 days: "Nw ago"
- otherwise: "Jan 15"

## 11. First-Message Preview Extraction

### Approach: Hook-Side Progressive Enrichment

The `listSessions()` core API is NOT modified. Preview extraction happens in the browser hook:

1. `listSessions()` returns `SessionSummary[]` with metadata only.
2. The hook renders immediately with metadata (`previewState: 'loading'`).
3. The hook asynchronously calls `SessionDiscovery.readFirstUserMessage(filePath)` for each session on the current visible page.
4. As each preview resolves, the hook updates state: `previewState: 'loaded'` (with `firstUserMessage`), `previewState: 'none'` (null return — no user message), or `previewState: 'error'` (read threw).
5. When the user changes pages, a generation counter is incremented and results from stale generations are discarded.

### Performance

Each `readFirstUserMessage()` reads 2-10 lines of JSONL (the first user message is typically among the first few events). For 20 sessions per page, this is ~20 small sequential reads — well under 100ms total on local disk. The async progressive approach ensures the UI is never blocked. On slow filesystems, the "Loading..." state is visible until the preview resolves.

### Display Mapping

| `previewState`  | UI Display                                    |
|-----------------|-----------------------------------------------|
| `'loading'`     | "Loading..." in secondary color               |
| `'loaded'`      | `"first message text..."` in secondary color  |
| `'none'`        | "(no user message)" in secondary color        |
| `'error'`       | "(preview unavailable)" in secondary color    |

## 12. Lock Status Handling

### Lock Check Policy

- **On initial load:** Lock status is checked once for all sessions via `SessionLockManager.isLocked()`. This is batched with the list load.
- **On resume attempt:** Lock is re-checked at the time `resumeSession()` tries to acquire it. If it fails, the error is shown inline and the list is refreshed (lock states may have changed).
- **On delete attempt:** Lock is checked by `deleteSession()` in core. If locked, the error is shown inline.
- **No periodic polling:** Lock status is not refreshed on a timer. The `(in use)` indicator is best-effort; action-time checks are authoritative.

### Stale Lock Cleanup

`SessionLockManager.isStale()` is called during initial load. Stale locks from crashed processes are cleaned up automatically, consistent with the existing behavior in `deleteSession()`.

### Display

Locked sessions appear in the list with an `(in use)` indicator in warning color. They can be selected (to show their metadata) but resume and delete will fail with a clear error. After a failed action, the list is refreshed, which may update lock states.

## 13. Testing Strategy

### Unit Tests

- **useSessionBrowser hook** — Test state transitions: loading, search filtering (against preview + provider + model), sort ordering, pagination, selection movement, selection clamping after delete/filter/page-empty, delete confirmation flow, `isResuming` guard, empty-list no-ops, generation counter for preview cancellation, search term change resets page and selection, selection preservation by sessionId on refresh, preview cache hit (no re-read on page revisit), eventually-consistent search (session removed from results when preview loads and doesn't match).
- **SessionBrowserDialog** — Ink testing-library render tests for: loading state, empty state, populated list, search filtering, keyboard navigation, delete confirmation, locked session display, error display, skipped-sessions notice, narrow vs wide layout, narrow sort hint, narrow session ID display.
- **resumeCommand** — Test action returns: no-args returns `{ type: 'dialog', dialog: 'sessionBrowser' }`, `latest` returns `load_history`, `latest` with all sessions locked returns error, invalid ref returns error message, non-interactive mode returns error for no-args, same-session ref returns "already active" error, `isProcessing` true returns "request in progress" error, `/resume` while browser already open is a no-op.
- **performResume()** — Tests for: successful two-phase swap, Phase 1 failure (old session preserved), Phase 2 best-effort cleanup (lock release warning), concurrent resume guard.
- **relativeTime utility** — Tests for all time buckets, boundary conditions, both short and long modes, future timestamp clamping.
- **First-message preview extraction** — Tests with: no user message (system-only), immediate user message, tool-call before user message, empty session file, corrupted JSONL line, read permission error, structurally valid JSON but unexpected payload schema returns null.
- **IContent[] conversion utility** — Tests for: user messages, AI messages, tool-call content, mixed content, empty history.

### Recording Service Swap Tests

- Two-phase ordering: new session is acquired before old is disposed.
- Dispose order: `RecordingIntegration.dispose()` (unsubscribe) THEN `SessionRecordingService.dispose()` (flush/close).
- Old lock `release()` is called (or warning logged on failure). Null lockHandle (fresh session) is handled gracefully.
- New `RecordingIntegration` triggers `useEffect` re-subscription to `HistoryService`.
- Events recorded after resume go to the new session file, not the old one.
- If `resumeSession()` fails, the old session remains intact and recording continues.
- Concurrent resume guard: if `isResuming` is true, second attempt is rejected.

### Integration Tests

- Full flow: `/resume` -> browser opens -> select session -> history restored -> can continue chatting.
- Full flow: `/resume latest` -> session resumes directly.
- Delete flow: select session -> delete -> confirm -> session removed from list.
- Error flow: attempt to resume locked session -> error shown, browser stays open, list refreshed.
- Stale data flow: session deleted by another process -> resume fails -> list refreshes.
- Active conversation flow: user has history -> resume -> confirmation shown -> confirm -> two-phase swap -> old session flushed/disposed -> new session active.
- Same-session flow: `/resume <current-session-id>` -> error "already active".
- Non-interactive flow: piped input -> `/resume` no args -> error with suggestion.
- In-flight request flow: tool call executing -> `/resume` -> error "Cannot resume while a request is in progress."
- Warnings flow: session with replay warnings -> resume -> warnings displayed as info messages.
