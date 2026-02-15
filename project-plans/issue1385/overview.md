# Session Browser & /resume Command — Functional Specification

**Issue:** #1385
**Depends on:** #1361 (Session Recording Service — merged)

## 1. Problem Statement

LLxprt Code records sessions as append-only JSONL files (landed in #1361). Users can resume sessions via `--continue` on the command line, but there is no interactive way to browse, search, or select from previous sessions while already inside a running instance. The upstream gemini-cli added a session browser UI and `/resume` slash command; this spec defines LLxprt's equivalent, built on the JSONL session infrastructure.

## 2. Goals

1. **Interactive session browsing** — A focused dialog component that lists all sessions for the current project, with search/filter, sort, and keyboard navigation.
2. **`/resume` slash command** — A top-level slash command that opens the session browser inline and resumes the selected session into the current conversation.
3. **Session deletion from the browser** — Ability to delete sessions directly from the browser with confirmation.
4. **Session info in `/stats`** — Display current session metadata (session ID, duration, file size) in the existing `/stats` command output.
5. **Remove `--resume` flag** — Remove the upstream `--resume` / `-r` CLI flag, which duplicates LLxprt's own `--continue` / `-C` flag.

## 3. Non-Goals

- Migrating old JSON snapshot sessions to JSONL format.
- Multi-project session browsing (sessions are always scoped to the current project hash).
- Session renaming or tagging (out of scope; can be a future enhancement).
- Exporting sessions to other formats.

## 4. User Stories

### 4.1 Browse Sessions

**As a user**, I want to see a list of my previous sessions for this project so I can decide which one to resume.

**Acceptance criteria:**
- Typing `/resume` (with no arguments) opens an interactive session browser dialog.
- The browser lists all JSONL sessions matching the current project hash, sorted newest-first by default.
- Each session row shows: 1-based index, relative time (e.g. "2 hours ago"), provider/model, file size, and a preview of the first user message.
- Sessions that are locked by another process display an "(in use)" indicator.
- The current session (the one actively recording) is excluded from the list.
- Sessions with no content events (empty sessions — opened and immediately closed without any conversation) are hidden from the list. These are noise and not useful to resume.
- The browser displays "No sessions found" if there are no sessions (after filtering out empty and current sessions).
- If a session has content but no user message (e.g. system-only or tool-call-only content), display "(no user message)" as the preview fallback.
- If some session files are unreadable (corrupted headers), they are excluded from the list and an inline notice is shown: "Skipped N unreadable session(s)."
- Replay warnings from `ResumeResult.warnings` are displayed as info messages after successful resume.

### 4.2 Search Sessions

**As a user**, I want to filter sessions by typing a search query so I can quickly find a specific conversation.

**Acceptance criteria:**
- The browser starts in search mode with focus on the search input.
- Typing characters filters the session list in real time against first-message preview text, provider name, and model name.
- Sessions whose previews haven't loaded yet are always included in search results (not filtered out prematurely). As previews load, sessions may be removed from the filtered list if the loaded preview does not match the search term (eventually-consistent filtering).
- The count of matching sessions updates as the user types.
- Any change to the search term resets the page to 1 and selection to the first item.
- Arrow keys (up/down) move the selection cursor even while in search mode — the user can filter and select without switching modes.
- Pressing Escape while searching with a non-empty search term clears the search term first; pressing Escape again (or with an empty term) closes the browser.
- Pressing Tab switches between search mode and navigation mode.

### 4.3 Sort Sessions

**As a user**, I want to sort sessions by different criteria so I can find sessions by recency or size.

**Acceptance criteria:**
- The browser provides sort options: newest (default), oldest, size.
- The active sort is visually indicated with brackets, e.g. `[newest]`.
- Pressing `s` in navigation mode cycles through the sort options.
- Sort state is preserved across search/filter changes.
- In narrow mode, the sort bar is hidden but `s` still cycles sort. The current sort name is shown in the controls bar as a hint (e.g. `s:newest`).

### 4.4 Resume a Session

**As a user**, I want to select a session from the browser and resume it in my current conversation.

**Acceptance criteria:**
- Pressing Enter on a selected session initiates the resume flow (Enter resumes in both search and navigation mode).
- If the filtered list is empty (no sessions or no search matches), Enter is a no-op.
- A "Resuming..." status is shown while the resume is in progress. Enter is disabled during this time to prevent double-resume.
- If the user has an active conversation (non-empty model history), a confirmation prompt appears: "Resuming will replace the current conversation. Continue?"
- On confirmation (or if no active conversation), the session is resumed using a safe two-phase approach: the new session is acquired and replayed first, and only after success is the old session disposed. This prevents data loss.
- If the session is locked by another process, an inline error is shown ("Session is in use by another process") and the browser stays open with the list refreshed.
- If the session file has disappeared since the list was loaded (e.g. deleted by another process), an inline error is shown ("Session no longer exists.") and the list is reloaded.
- If replay fails for any reason, an inline error is shown and the browser stays open. The current session remains intact.
- On successful resume, the browser closes and the user can continue the conversation.

### 4.5 Delete a Session

**As a user**, I want to delete old sessions from the browser so I can clean up clutter.

**Acceptance criteria:**
- Pressing the Delete key on a selected session shows an inline confirmation prompt.
- If the filtered list is empty, Delete is a no-op.
- Confirming with Y deletes the session file (via the existing `deleteSession()` function from core).
- Confirming with N or pressing Escape dismisses the confirmation without deleting.
- The session list refreshes after deletion. Selection is preserved by `sessionId` when possible: if the previously selected session still exists, it remains selected. If it was the one deleted, the selection falls back to the same index position (clamped to the new list length). If the page becomes empty after deletion and there is a previous page, the browser moves to the previous page.
- Sessions locked by another process cannot be deleted; the browser shows an inline error message.
- Backspace does NOT trigger deletion (to avoid accidental triggers when the user expects to be editing search text).

### 4.6 Navigate with Pagination

**As a user**, I want pagination when I have many sessions so the list stays manageable.

**Acceptance criteria:**
- Sessions are displayed 20 per page.
- A "Page X of Y" indicator is shown when there are multiple pages.
- PgUp/PgDn change pages.
- Page indicator shows PgUp/PgDn hint when multiple pages exist.
- Note: Some terminal emulators intercept PgUp/PgDn for scrollback. This is a known limitation of terminal applications.

### 4.7 Resume via Argument

**As a user**, I want to resume a specific session by typing `/resume <id>` directly so I can skip the browser when I know which session I want.

**Acceptance criteria:**
- `/resume latest` resumes the most recent unlocked session without opening the browser.
- `/resume <session-id>` resumes a session by full ID or unique prefix.
- `/resume <number>` resumes the Nth session (1-based, newest-first).
- Invalid references produce clear error messages. These come from `SessionDiscovery.resolveSessionRef()` in core, which handles: out-of-range indices, ambiguous prefixes (listing matching IDs), and not-found references. The `/resume` command passes through these error messages.
- If the session is locked: "Session is in use by another process."
- If the user has an active conversation and the terminal is interactive, the "replace current conversation" confirmation is shown.
- If the user has an active conversation and the terminal is non-interactive (piped input), the resume is rejected with an error: "Cannot replace active conversation in non-interactive mode. Use --continue at startup instead."

### 4.8 Session Info in /stats

**As a user**, I want to see information about my current session in the `/stats` output so I can understand my session state.

**Acceptance criteria:**
- The `/stats` command includes a "Session" section showing:
  - Session ID (truncated to 12 chars)
  - Session start time (relative)
  - Session file size
  - Whether this is a resumed session
- If no session recording is active, the section shows "No active session recording."

### 4.9 Remove --resume Flag

**As a developer**, I want to remove the upstream `--resume` / `-r` flag to avoid confusion with `--continue` / `-C`.

**Acceptance criteria:**
- The `--resume` and `-r` CLI options are removed from the argument parser.
- The `resume` field is removed from the parsed CLI args interface.
- Any code paths referencing `args.resume` are removed.
- `RESUME_LATEST` and `SessionSelector` (along with `SessionSelectionResult`) in `sessionUtils.ts` are removed.
- `SessionInfo`, `SessionFileEntry`, `getSessionFiles()`, and `getAllSessionFiles()` in `sessionUtils.ts` are preserved because `sessionCleanup.ts` depends on them.
- Existing `--continue` / `-C` behavior is unaffected.

## 5. Keyboard Controls

### Modal Priority Stack

When multiple interactive elements are active, key events are consumed in this priority order:

1. **Delete confirmation dialog** — Y/N/Esc are consumed. All other keys are ignored.
2. **Active-conversation confirmation** — Y/N/Esc are consumed. All other keys are ignored.
3. **Resuming state** — All keys are ignored. Resume is non-cancellable once initiated (the core `resumeSession()` call cannot be safely aborted mid-replay). Esc is ignored until the operation completes or fails.
4. **Tool-call in flight** — If the model is currently processing (tool calls executing), `/resume` returns an error: "Cannot resume while a request is in progress." This prevents corrupting in-flight tool-call state.
5. **Search mode / Navigation mode** — Normal browser keyboard handling.

### Escape Key Precedence

Escape is consumed in this strict order (first matching wins):

1. Dismiss delete confirmation (if showing).
2. Dismiss active-conversation confirmation (if showing).
3. Clear search term (if non-empty).
4. Close browser.

### Key Bindings

| Key         | Search Mode              | Navigation Mode            |
|-------------|--------------------------|----------------------------|
| Characters  | Append to search term    | -- (no action)             |
| Backspace   | Delete last search char  | -- (no action)             |
| Delete      | -- (no action)           | Delete selected session (with confirm) |
| Tab         | Switch to nav mode       | Switch to search mode      |
| Escape      | See precedence above     | See precedence above       |
| Up / Down   | Move selection           | Move selection             |
| Enter       | Resume selected session  | Resume selected session    |
| PgUp / PgDn | Previous/next page      | Previous/next page         |
| s           | (typed into search)      | Cycle sort order           |

Note: Enter resumes the selected session in both modes. This is the primary action and should always be one keypress away. When the filtered list is empty, Enter and Delete are no-ops. The controls bar is reduced to show only "Esc Close" when the list is empty (no actions to hint about).

## 6. Entry Points

| Entry Point              | Behavior                                              |
|--------------------------|-------------------------------------------------------|
| `/resume`                | Opens the session browser dialog                      |
| `/resume` (browser already open) | No-op (no second dialog instance)              |
| `/resume latest`         | Resumes most recent resumable (unlocked, not current) session directly (no browser) |
| `/resume <id or index>`  | Resumes specific session directly (no browser)        |
| `--continue` (CLI flag)  | Existing behavior, unchanged -- resumes at startup    |
| `--list-sessions` (CLI)  | Existing behavior, unchanged -- prints list and exits |

## 7. Error Handling

| Scenario                                | Behavior                                                         |
|-----------------------------------------|------------------------------------------------------------------|
| No sessions for project                 | Empty state: "No sessions found for this project." (after filtering out empty and current sessions) |
| Session locked by another process       | Inline error in browser; error message for direct `/resume`      |
| Resume same session as current          | Filtered out of browser list; direct `/resume <id>` returns "That session is already active." |
| Session file corrupted (header unreadable) | Session excluded from list; inline notice "Skipped N unreadable session(s)." |
| Session file disappeared between list and action | Inline error: "Session no longer exists." List reloads.   |
| Replay failure                          | Inline error: "Failed to replay session: {details}". Current session remains intact. |
| Replay warnings                         | Displayed as info messages after successful resume.              |
| Disk full during delete                 | Inline error: "Failed to delete session: {details}"             |
| Permission denied during delete         | Inline error: "Permission denied: {details}"                    |
| Discovery/list failure (permissions)    | Error state: "Failed to load sessions: {details}"               |
| Preview read error for individual file  | Display "(preview unavailable)" for that session.                |
| Search yields no results                | "No sessions match \"{query}\""                                  |
| Active conversation exists (interactive) | Confirmation: "Resuming will replace the current conversation. Continue?" |
| Active conversation exists (non-interactive) | Error: "Cannot replace active conversation in non-interactive mode." |
| Lock release failure during session swap | Warning logged; swap continues (best-effort cleanup).            |
| Resume fails after new session acquired  | Inline error with details. Current session is already preserved (two-phase swap). |
| Non-interactive mode, `/resume` no args | Error: "Session browser requires interactive mode. Use /resume latest or /resume <id>." |
| Model request in flight (`isProcessing`) | Error: "Cannot resume while a request is in progress."                                  |

## 8. Responsive Behavior

The browser adapts to terminal width using `useResponsive()`, consistent with other dialogs in the app. The threshold is determined by `useResponsive().isNarrow` — no hardcoded pixel/column value. Examples showing "80 columns" in mockups are illustrative only.

| Terminal Width        | Behavior                                                          |
|-----------------------|-------------------------------------------------------------------|
| Wide (not narrow)     | Full layout: rounded border, search bar, sort bar, two-line session rows, detail line, controls bar |
| Narrow (`isNarrow`)   | Compact layout: no border, no sort bar, no detail line, compact two-line rows (abbreviated metadata + truncated preview), abbreviated controls bar with sort hint |

### Truncation Rules (narrow mode)

| Element           | Narrow behavior                                   |
|-------------------|---------------------------------------------------|
| Provider name     | Hidden; show model only                           |
| Model name        | Truncated to 20 chars with "..."                  |
| First message     | Truncated to 30 chars with "..."                  |
| Session ID        | Short 8-char prefix shown on selected row         |
| Relative time     | Abbreviated: "2h ago", "1d ago", "3w ago"         |
| Sort bar          | Hidden; sort hint in controls (e.g. `s:newest`)   |
| Detail line       | Hidden; short session ID shown on selected row    |
| File size         | Hidden                                            |

### Wide → Narrow Transition

All layout changes happen as a single switch when `useResponsive().isNarrow` becomes true. There is no intermediate "medium" state. When narrow, all of the following are applied simultaneously:

- Detail line — hidden (short session ID shown on selected row instead)
- Sort bar — hidden (sort hint in controls bar)
- File size column — hidden
- Provider name — hidden (show model only)
- Box border — removed (borderless)
