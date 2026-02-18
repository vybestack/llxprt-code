# Session Browser & /continue Command — Requirements (EARS Format)

**Issue:** #1385
**Depends on:** #1361 (Session Recording Service — merged)

This document captures every behavioral requirement from the functional specification, technical specification, and UI mockup for the Session Browser & /continue Command feature. Requirements use the EARS (Easy Approach to Requirements Syntax) templates and are grouped by functional area.

---

## 1. Session Browser Dialog — Listing & Display

### REQ-SB-001
When the user types `/continue` with no arguments, the system shall open an interactive session browser dialog.

### REQ-SB-002
When the session browser opens, the system shall list all JSONL sessions matching the current project hash, sorted newest-first by default.

### REQ-SB-003
The system shall display each session row with the following metadata: 1-based index, relative time (e.g. "2 hours ago"), provider/model, file size, and a preview of the first user message.

### REQ-SB-004
The system shall exclude the current active session (the one being recorded) from the session browser list.

### REQ-SB-005
The system shall hide empty sessions from the browser list, where an empty session is defined as one containing no events beyond the `session_start` event (i.e., opened and immediately closed without any conversation content).

### REQ-SB-006
When all sessions are filtered out (empty, current, or no sessions exist), the system shall display "No sessions found for this project." with the supplemental text "Sessions are created automatically when you start a conversation." and a "Press Esc to close" hint.

### REQ-SB-007
When a session has content but no user message (e.g. system-only or tool-call-only content), the system shall display "(no user message)" as the preview fallback.

### REQ-SB-008
When some session files have unreadable headers (corrupted), the system shall exclude those sessions from the list and display an inline notice: "Skipped N unreadable session(s)."

### REQ-SB-009
The system shall display a loading state ("Loading sessions...") while the initial session list is being fetched.

### REQ-SB-010
The system shall indicate sessions that are locked by another process with an "(in use)" indicator displayed in warning color.

### REQ-SB-011
_Design note:_ The session browser shall use `SemanticColors` from the project's color token system for all visual elements. Specific color mappings are captured in REQ-SB-013 through REQ-SB-025.

### REQ-SB-012
The system shall render the session browser within a rounded-border box (`borderStyle="round"`) in wide mode.

### REQ-SB-013
The system shall use a selected item bullet (`●`) in accent color for the highlighted session and an unselected item bullet (`○`) in primary color for other sessions.

### REQ-SB-014
While in wide mode, the system shall display the 1-based index (e.g. `#1`) in secondary color for each session row.

### REQ-SB-026
While in narrow mode, the system shall hide the 1-based index number from session rows.

### REQ-SB-015
The system shall display relative time in primary color for each session row.

### REQ-SB-016
The system shall display provider/model in secondary color for each session row.

### REQ-SB-017
The system shall display file size right-aligned in secondary color for each session row (wide mode only).

### REQ-SB-018
The system shall display first-message previews as quoted, truncated text in secondary color.

### REQ-SB-019
The system shall display preview loading state as "Loading..." in secondary color.

### REQ-SB-020
The system shall display error text inline above the controls bar in error color.

### REQ-SB-021
The system shall display a controls bar at the bottom showing keyboard shortcut hints in secondary color.

### REQ-SB-022
_Merged into REQ-SB-005._ (Empty session definition is now part of REQ-SB-005.)

### REQ-SB-023
The system shall render the search input cursor as `▌` in accent color.

### REQ-SB-024
The system shall render the title text in bold with primary color.

### REQ-SB-025
The system shall render preview fallback text `(no user message)` in italic secondary color.

---

## 2. Session Browser — Preview Loading

### REQ-PV-001
When the session list loads, the system shall render session rows immediately with metadata and `previewState: 'loading'` before first-message previews are available.

### REQ-PV-002
The system shall asynchronously load first-message previews by reading the JSONL file for the first `content` event where `payload.content.speaker === 'user'` and extracting a text preview truncated to 120 characters.

### REQ-PV-003
The system shall load previews only for sessions on the current visible page (up to 20 sessions per page).

### REQ-PV-004
When the user changes pages or re-sorts, the system shall discard in-flight preview reads for the old page using a generation counter. The same generation counter shall also protect list refresh operations: if a newer refresh is triggered before an older one completes, the stale results shall be discarded.

### REQ-PV-005
The system shall cache successfully-loaded previews by `sessionId` to avoid re-reading when navigating back to a previously visited page.

### REQ-PV-006
When a preview read succeeds and returns text, the system shall set `previewState` to `'loaded'` with the first user message text.

### REQ-PV-007
When a preview read succeeds but returns null (no user message found), the system shall set `previewState` to `'none'` and display "(no user message)".

### REQ-PV-008
When a preview read fails (e.g. I/O error, permission denied), the system shall set `previewState` to `'error'` and display "(preview unavailable)".

### REQ-PV-009
When extracting text from `IContent`, the system shall concatenate text from `TextPart` entries (those with a `text` property) and ignore non-text parts.

### REQ-PV-010
If the JSONL payload has structurally valid JSON but an unexpected schema, the system shall treat the preview as unavailable (not throw an error).

---

## 3. Session Browser — Search

### REQ-SR-001
When the session browser opens, the system shall start in search mode with focus on the search input.

### REQ-SR-002
While in search mode, the system shall filter the session list in real time as the user types characters, matching against first-message preview text, provider name, and model name.

### REQ-SR-003
While filtering, the system shall always include sessions whose previews have not yet loaded (`previewState !== 'loaded'`) in search results (not filter them out prematurely).

### REQ-SR-004
When a preview loads for a session that is currently in the filtered results and the loaded preview does not match the search term, the system shall remove that session from the filtered list (eventually-consistent filtering).

### REQ-SR-005
While searching, the system shall update the count of matching sessions as the user types (e.g. "5 sessions found", "1 session found", "0 sessions found").

### REQ-SR-006
When the search term changes, the system shall reset the page to page 1 and the selection to the first item.

### REQ-SR-007
While in search mode, the system shall allow arrow keys (Up/Down) to move the selection cursor without switching modes.

### REQ-SR-008
When the user presses Escape while searching with a non-empty search term, the system shall clear the search term (not close the browser).

### REQ-SR-009
When the user presses Escape while searching with an empty search term, the system shall close the browser.

### REQ-SR-010
When the user presses Tab in search mode, the system shall switch to navigation mode.

### REQ-SR-011
When the search yields no results, the system shall display 'No sessions match "{query}"'.

### REQ-SR-012
While in search mode, the system shall display a "(Tab to navigate)" hint and the match count next to the search bar.

### REQ-SR-013
While in search mode, typing characters shall append to the search term.

### REQ-SR-014
While in search mode, pressing Backspace shall delete the last character of the search term.

---

## 4. Session Browser — Sort

### REQ-SO-001
The system shall provide sort options: newest (default), oldest, and size.

### REQ-SO-002
The system shall visually indicate the active sort option with brackets, e.g. `[newest]`.

### REQ-SO-003
When the user presses `s` in navigation mode, the system shall cycle through the sort options (newest → oldest → size → newest).

### REQ-SO-004
The system shall preserve the sort state across search/filter changes.

### REQ-SO-005
When the sort order changes, the system shall trigger preview enrichment for the new visible page.

### REQ-SO-006
The system shall display inactive sort labels in secondary color and the active sort label in accent color.

### REQ-SO-007
The system shall display a "(press s to cycle)" hint next to the sort bar in wide mode.

---

## 5. Session Browser — Pagination

### REQ-PG-001
The system shall display sessions 20 per page.

### REQ-PG-002
When there are multiple pages, the system shall display a "Page X of Y" indicator. When there is only one page, the page indicator is hidden. (Note: mockup examples that show "Page 1 of 1" are illustrative artifacts; the spec behavior is to show the indicator only for multi-page lists.)

### REQ-PG-003
When the user presses PgUp (in either search mode or navigation mode), the system shall navigate to the previous page (if one exists).

### REQ-PG-004
When the user presses PgDn (in either search mode or navigation mode), the system shall navigate to the next page (if one exists).

### REQ-PG-005
When there are multiple pages, the system shall show a PgUp/PgDn hint next to the page indicator (e.g. "PgUp/PgDn to page").

---

## 6. Session Browser — Keyboard Navigation & Modes

### REQ-KN-001
While in navigation mode, pressing Up shall move the selection to the previous session row.

### REQ-KN-002
While in navigation mode, pressing Down shall move the selection to the next session row.

### REQ-KN-003
When the user presses Tab in navigation mode, the system shall switch to search mode.

### REQ-KN-004
While in navigation mode, typing characters (other than defined shortcuts) shall be a no-op.

### REQ-KN-005
While in navigation mode, pressing Backspace shall be a no-op.

### REQ-KN-006
While in search mode, pressing Delete shall be a no-op (Delete only works in navigation mode).

### REQ-KN-007
The system shall not trigger deletion on Backspace in any mode (to avoid accidental triggers when the user expects to be editing search text).

---

## 7. Session Browser — Selection & Detail

### REQ-SD-001
The system shall display a detail line below the session list (wide mode) showing the selected session's full session ID, provider/model, and relative time.

### REQ-SD-002
When the filtered list changes (search term change, deletion, page change), the system shall clamp the selected index to `[0, max(filteredSessions.length - 1, 0)]`.

### REQ-SD-003
When the filtered list is empty, the system shall reset the selection index to 0 and treat Enter, Delete, Up, Down, PgUp, and PgDn as no-ops.

---

## 8. Session Browser — Resume Flow

### REQ-RS-001
When the user presses Enter on a selected session in either search or navigation mode, the system shall initiate the resume flow.

### REQ-RS-002
If the filtered list is empty when Enter is pressed, the system shall treat it as a no-op.

### REQ-RS-003
While a resume is in progress, the system shall display a "Resuming..." status.

### REQ-RS-004
While a resume is in progress, the system shall disable Enter to prevent double-resume.

### REQ-RS-005
While a resume is in progress, the system shall ignore all key input including Escape (resume is non-cancellable once initiated).

### REQ-RS-006
When the user has an active conversation (non-empty model history) and attempts to resume, the system shall display an inline confirmation prompt: "Resuming will replace the current conversation. Continue?" with `[Y] Yes` and `[N] No` options, rendered within a bordered box inline inside the session browser dialog.

### REQ-RS-013
When the user presses N on the active-conversation confirmation, the system shall dismiss the confirmation and return to the browser without resuming.

### REQ-RS-014
When the user presses Escape on the active-conversation confirmation, the system shall dismiss the confirmation and return to the browser without resuming (same behavior as N).

### REQ-RS-007
The system shall perform resume using a two-phase approach: acquire and replay the new session first (Phase 1), then dispose the old session only after success (Phase 2).

### REQ-RS-008
If the selected session is locked by another process at resume time, the system shall display an inline error ("Session is in use by another process.") and stay in the browser with the list refreshed.

### REQ-RS-009
If the selected session file has disappeared since the list was loaded, the system shall display an inline error ("Session no longer exists.") and reload the list.

### REQ-RS-010
If replay fails for any reason, the system shall display an inline error ("Failed to replay session: {details}") and stay in the browser with the current session intact.

### REQ-RS-011
When resume succeeds, the system shall close the browser and allow the user to continue the conversation with the restored history.

### REQ-RS-012
When `ResumeResult.warnings` contains replay warnings, the system shall display them as info messages after successful resume.

---

## 9. Session Browser — Delete Flow

### REQ-DL-001
When the user presses the Delete key on a selected session in navigation mode, the system shall show an inline delete confirmation prompt displaying the session's first-message preview and relative time.

### REQ-DL-002
If the filtered list is empty when Delete is pressed, the system shall treat it as a no-op.

### REQ-DL-003
When the delete confirmation is showing, the system shall accept only Y, N, and Escape keys; all other keys shall be ignored.

### REQ-DL-004
When the user presses Y on the delete confirmation, the system shall delete the session file using the session's `sessionId` as the deletion reference (not the UI row index, which can become stale after filtering or re-sorting).

### REQ-DL-005
When the user presses N on the delete confirmation, the system shall dismiss the confirmation without deleting.

### REQ-DL-006
When the user presses Escape on the delete confirmation, the system shall dismiss the confirmation without deleting.

### REQ-DL-007
When a session is deleted, the system shall refresh the session list.

### REQ-DL-008
When the session list refreshes after deletion, the system shall preserve selection by `sessionId`: if the previously-selected session still exists, it remains selected; if it was deleted, the selection falls back to the same index position (clamped to the new list length).

### REQ-DL-009
If the page becomes empty after deletion and there is a previous page, the system shall move to the previous page.

### REQ-DL-010
If a session is locked by another process, the system shall refuse deletion and display an inline error message.

### REQ-DL-011
If deletion fails due to a disk-full condition, the system shall display an inline error: "Failed to delete session: {details}".

### REQ-DL-012
If deletion fails due to a permission-denied error, the system shall display an inline error: "Permission denied: {details}".

### REQ-DL-013
The delete confirmation shall be rendered as an inline nested box within the session list, adjacent to the selected session row.

### REQ-DL-014
The delete confirmation prompt shall display the options `[Y] Yes  [N] No  [Esc] Cancel`.

---

## 10. Session Browser — Escape Key Precedence

### REQ-EP-001
When Escape is pressed and a delete confirmation is showing, the system shall dismiss the delete confirmation (first priority).

### REQ-EP-002
When Escape is pressed and an active-conversation confirmation is showing (and no delete confirmation), the system shall dismiss the active-conversation confirmation (second priority).

### REQ-EP-003
When Escape is pressed and the search term is non-empty (and no confirmation dialogs are showing), the system shall clear the search term (third priority).

### REQ-EP-004
When Escape is pressed and the search term is empty and no confirmation dialogs are showing, the system shall close the browser (fourth priority).

---

## 11. Session Browser — Modal Priority Stack

### REQ-MP-001
While a delete confirmation dialog is active, the system shall consume Y/N/Esc keys and ignore all other keys.

### REQ-MP-002
While an active-conversation confirmation is active, the system shall consume Y/N/Esc keys and ignore all other keys.

### REQ-MP-003
While a resume is in progress (`isResuming`), the system shall ignore all key input including Escape (resume is non-cancellable once initiated).

### REQ-MP-004
If the model is currently processing (tool calls executing), the `/continue` command shall return an error: "Cannot resume while a request is in progress."

---

## 12. Session Browser — Lock Status

### REQ-LK-001
When the session browser loads, the system shall check lock status once for all sessions via `SessionLockManager.isLocked()`.

### REQ-LK-002
When a resume or delete is attempted, the system shall re-check the lock at action time (the action-time check is authoritative).

### REQ-LK-003
The system shall not poll lock status periodically; the "(in use)" indicator is best-effort based on the initial load.

### REQ-LK-004
When the session list loads, the system shall call `SessionLockManager.isStale()` and clean up stale locks from crashed processes.

### REQ-LK-005
Locked sessions shall appear in the list and be selectable (to show their metadata) but resume and delete actions on them shall fail with a clear error.

### REQ-LK-006
When an action fails due to a lock conflict, the system shall refresh the list (which may update lock states for other sessions).

---

## 13. /continue Slash Command — Direct Resume

### REQ-RC-001
When the user types `/continue latest`, the system shall resume the most recent unlocked, non-current, non-empty session without opening the browser.

### REQ-RC-002
If `/continue latest` is used and all sessions are locked, current, or empty (no resumable session exists), the system shall return an error.

### REQ-RC-003
When the user types `/continue <session-id>`, the system shall resume the session matching the full ID or unique prefix.

### REQ-RC-004
When the user types `/continue <number>`, the system shall resume the Nth session (1-based, newest-first).

### REQ-RC-005
If the session reference is out of range, the system shall return a clear error message (from `SessionDiscovery.resolveSessionRef()`).

### REQ-RC-006
If the session reference is an ambiguous prefix, the system shall return an error listing the matching session IDs.

### REQ-RC-007
If the session reference is not found, the system shall return a clear error message.

### REQ-RC-008
If the referenced session is locked, the system shall return an error: "Session is in use by another process."

### REQ-RC-009
If the referenced session is the current active session, the system shall return an error: "That session is already active."

### REQ-RC-010
When the user has an active conversation (non-empty model history) and the terminal is interactive, the system shall show the "Resuming will replace the current conversation. Continue?" confirmation.

### REQ-RC-011
When the user has an active conversation and the terminal is non-interactive (piped input), the system shall reject the resume with an error: "Cannot replace active conversation in non-interactive mode. Use --continue at startup instead."

### REQ-RC-012
When `/continue` with no arguments is invoked in non-interactive mode, the system shall return an error: "Session browser requires interactive mode. Use /continue latest or /continue <id>."

### REQ-RC-013
The `/continue` command shall provide tab completion offering "latest" plus session previews as completions.

---

## 14. Recording Service Swap (Two-Phase)

### REQ-SW-001
When resuming a session, the system shall acquire and replay the new session before disposing the old session (two-phase swap).

### REQ-SW-002
If Phase 1 (acquiring the new session) fails, the system shall leave the old session fully intact with no data loss.

### REQ-SW-003
During Phase 2, the system shall first call `recordingIntegration.dispose()` on the old bridge (to unsubscribe from `HistoryService`) before calling `recordingService.dispose()` on the underlying service (to flush and close the file). This ordering prevents writing events to a closing file.

### REQ-SW-004
During Phase 2, the system shall call `lockHandle.release()` on the old lock handle. If the old `lockHandle` is null (fresh session, not resumed), the system shall skip this step.

### REQ-SW-005
If the old lock release fails (e.g. EPERM, stale), the system shall log a warning but continue with the new session (best-effort cleanup).

### REQ-SW-006
After a successful swap, the system shall update React state to point to the new recording integration, lock handle, and session metadata, triggering a re-render that re-subscribes to `HistoryService`.

### REQ-SW-007
After a successful swap, events recorded shall go to the new session file, not the old one.

### REQ-SW-008
The system shall prevent concurrent resume attempts; if `isResuming` is true, a second attempt shall be rejected.

---

## 15. IContent Conversion

### REQ-CV-001
When resuming a session, the system shall convert the returned `IContent[]` history to `Content[]` (client history) using `geminiClient.restoreHistory()`.

### REQ-CV-002
When resuming a session, the system shall convert the returned `IContent[]` history to `HistoryItemWithoutId[]` (UI history) using `iContentToHistoryItems()`.

---

## 16. /stats — Session Info

### REQ-ST-001
The `/stats` command shall include a "Session" section in its output.

### REQ-ST-002
The session section shall display the session ID (truncated to 12 characters).

### REQ-ST-003
The session section shall display the session start time as a relative time.

### REQ-ST-004
The session section shall display the session file size.

### REQ-ST-005
The session section shall display whether this is a resumed session (yes/no).

### REQ-ST-006
If no session recording is active, the section shall display "No active session recording."

---

## 17. --resume Flag Removal

### REQ-RR-001
The system shall remove the `--resume` and `-r` CLI options from the argument parser.

### REQ-RR-002
The system shall remove the `resume` field from the parsed CLI args interface.

### REQ-RR-003
The system shall remove all code paths referencing `args.resume`.

### REQ-RR-004
The system shall remove `RESUME_LATEST` and `SessionSelector` (along with `SessionSelectionResult`) from `sessionUtils.ts`.

### REQ-RR-005
The system shall preserve `SessionInfo`, `SessionFileEntry`, `getSessionFiles()`, and `getAllSessionFiles()` in `sessionUtils.ts` (required by `sessionCleanup.ts`).

### REQ-RR-006
The existing `--continue` / `-C` behavior shall remain unaffected.

### REQ-RR-007
The existing `--list-sessions` flag shall remain unaffected.

### REQ-RR-008
The existing `--delete-session` flag shall remain unaffected.

---

## 18. Responsive Behavior — Wide Mode

### REQ-RW-001
While the terminal is in wide mode (not narrow per `useResponsive().isNarrow`), the system shall display the full layout: rounded border, search bar, sort bar, two-line session rows (metadata line + preview line), detail line, and controls bar.

### REQ-RW-002
While in wide mode, the system shall display the title "Session Browser".

### REQ-RW-003
While in wide mode, each session row shall occupy two lines: a metadata line (index, relative time, provider/model, file size) and a preview line (first user message).

### REQ-RW-004
While in wide mode, the system shall display a selection detail line below the session list showing the full session ID, provider/model, and relative time.

### REQ-RW-005
While in wide mode, the system shall display the sort bar with all sort options and the "(press s to cycle)" hint.

### REQ-RW-006
While in wide mode, the system shall display the full controls bar: "↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close".

### REQ-RW-007
When the filtered session list is empty (no search results or no sessions), the system shall display a reduced controls bar showing only "Esc Close".

---

## 19. Responsive Behavior — Narrow Mode

### REQ-RN-001
While the terminal is in narrow mode (`useResponsive().isNarrow` is true), the system shall display the compact layout: no border, no sort bar, no detail line, compact two-line rows (abbreviated metadata + truncated preview), and abbreviated controls bar.

### REQ-RN-002
While in narrow mode, the system shall display the title "Sessions" (shortened).

### REQ-RN-003
While in narrow mode, the system shall hide the provider name and show only the model name.

### REQ-RN-004
While in narrow mode, the system shall truncate model names to 20 characters with "...".

### REQ-RN-005
While in narrow mode, the system shall truncate first-message previews to 30 characters with "...".

### REQ-RN-006
While in narrow mode, the system shall show the first 8 characters of the session ID at the end of the selected row only.

### REQ-RN-007
While in narrow mode, the system shall use abbreviated relative times: "2h ago", "1d ago", "3w ago".

### REQ-RN-008
While in narrow mode, the system shall hide the sort bar but continue to allow `s` to cycle sort order; the current sort name shall appear as a hint in the controls bar (e.g. `s:newest`).

### REQ-RN-009
While in narrow mode, the system shall hide the detail line.

### REQ-RN-010
While in narrow mode, the system shall hide the file size column.

### REQ-RN-011
While in narrow mode, the system shall render the browser without a border (borderless).

### REQ-RN-012
The system shall have exactly two responsive modes (wide and narrow) with no intermediate breakpoint; all narrow-mode layout changes apply as a single switch when `useResponsive().isNarrow` becomes true.

### REQ-RN-013
While in narrow mode, the system shall display an abbreviated controls bar: "↑↓ Nav  Enter Resume  Del Delete  s:newest  Esc Close".

---

## 20. Relative Time Formatting

### REQ-RT-001
The system shall format session times as relative timestamps using both a long and a short mode.

### REQ-RT-002
In long mode (wide terminal), the system shall display: "just now" (< 1 minute), "N minutes ago" (< 1 hour), "N hours ago" (< 24 hours), "yesterday" (< 48 hours), "N days ago" (< 7 days), "N weeks ago" (< 30 days), and a formatted date (e.g. "Jan 15") otherwise.

### REQ-RT-003
In short mode (narrow terminal), the system shall display: "now" (< 1 minute), "Nm ago" (< 1 hour), "Nh ago" (< 24 hours), "Nd ago" (< 7 days), "Nw ago" (< 30 days), and a short date (e.g. "Jan 15") otherwise.

### REQ-RT-004
If the session time is in the future (e.g. clock skew), the system shall clamp the display to "just now" (long mode) or "now" (short mode) — never display negative deltas.

---

## 21. Error Handling

### REQ-EH-001
If discovery/list loading fails (e.g. permissions), the system shall display an error state: "Failed to load sessions: {details}".

### REQ-EH-002
If an individual preview read fails, the system shall display "(preview unavailable)" for that session and continue displaying the rest of the list.

### REQ-EH-003
If a lock release fails during session swap, the system shall log a warning and continue (best-effort cleanup).

### REQ-EH-004
If Phase 1 (acquiring the new session) fails, the old session shall remain fully intact with no data loss. If Phase 2 (disposing the old session) fails, the system shall log a warning and continue with the new session — Phase 2 failures are best-effort cleanup and do not affect session integrity.

### REQ-EH-005
When an error is displayed inline in the browser, the error shall clear on the next user action.

---

## 22. Dialog Integration

### REQ-DI-001
The system shall register `'sessionBrowser'` in the `DialogType` union.

### REQ-DI-002
The system shall add `isSessionBrowserDialogOpen` to `UIState`.

### REQ-DI-003
The system shall provide `openSessionBrowserDialog()` and `closeSessionBrowserDialog()` actions in `UIActions`.

### REQ-DI-004
When `/continue` with no arguments returns `{ type: 'dialog', dialog: 'sessionBrowser' }`, the command processor shall set `uiState.isSessionBrowserDialogOpen = true`.

### REQ-DI-005
The `DialogManager` shall render `SessionBrowserDialog` when `uiState.isSessionBrowserDialogOpen` is true, passing `chatsDir`, `projectHash`, `currentSessionId`, `onSelect`, and `onClose` as props.

### REQ-DI-006
The active-conversation confirmation shall be rendered inline inside `SessionBrowserDialog` (not via the existing `ConsentPrompt` mechanism, which would close the browser).

---

## 23. Entry Points

### REQ-EN-001
When the user types `/continue` with no arguments, the system shall open the session browser dialog.

### REQ-EN-002
When the user types `/continue latest`, the system shall resume the most recent resumable session directly without opening the browser.

### REQ-EN-003
When the user types `/continue <id or index>`, the system shall resume the specific session directly without opening the browser.

### REQ-EN-004
The existing `--continue` / `-C` CLI flag behavior shall remain unchanged (resumes at startup).

### REQ-EN-005
The existing `--list-sessions` CLI flag behavior shall remain unchanged (prints list and exits).

### REQ-EN-006
When `/continue` with no arguments is invoked while the session browser dialog is already open, the system shall treat it as a no-op (no second dialog instance).

---

## 24. Session Recording Metadata

### REQ-SM-001
The system shall maintain a `SessionRecordingMetadata` object containing `sessionId`, `filePath`, `startTime`, and `isResumed` fields.

### REQ-SM-002
The system shall populate session recording metadata during startup.

### REQ-SM-003
When a session is resumed, the system shall update session recording metadata with the new session's information and set `isResumed` to true.

---

## 25. performResume() Shared Utility

### REQ-PR-001
The system shall use a single `performResume()` utility for both the browser path and the direct `/continue <ref>` path.

### REQ-PR-002
When `performResume()` is called with the `"latest"` reference, the system shall select the first resumable session from the newest-first list (first session that is not locked, not the current session, and not empty — i.e., has content events).

### REQ-PR-003
When resolving a session reference, the system shall use `SessionDiscovery.listSessions()` and `SessionDiscovery.resolveSessionRef()`, independently from the `--continue` CLI startup flow.

### REQ-PR-004
When `performResume()` completes, the system shall return a discriminated union result: `{ ok: true, history, metadata, warnings, newRecording, newLockHandle }` on success, or `{ ok: false, error }` on failure.

### REQ-PR-005
When called from the browser, the dialog shall set `isResuming = true` before the call and `false` after, regardless of success or failure.
