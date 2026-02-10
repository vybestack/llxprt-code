# Session Resuming Improvement Plan (LLxprt vs upstream 6893d2744)

## Summary of upstream 6893d2744 (gemini-cli)
Upstream introduced a full session management/resume flow across CLI + core:
- **CLI flags**: `--resume [latest|index|uuid]`, `--list-sessions`, `--delete-session`.
- **Session selection**: `SessionSelector` discovers session files, orders them, resolves by index/UUID/latest.
- **Session listing UX**: shows index, first user message preview, relative time, marks current session.
- **Delete session**: prevents deleting current session; uses recording service to delete.
- **Resume wiring**:
  - Interactive UI: `useSessionResume` + `useSessionBrowser` converts saved sessions into UI history + client history.
  - Non-interactive: `resumeChat` on the client with converted history.
  - Core: `GeminiClient.resumeChat` and `GeminiChat` initialize chat recording with `ResumedSessionData`.

## Current LLxprt state
- CLI only supports `--continue` (boolean), mapped to `continueSession: argv.continue ?? false`.
- Session persistence is custom: `SessionPersistenceService` writes `persisted-session-<timestamp>.json` with **core history + optional UI history**.
- `--continue` restores **latest** only, no list/delete/selection UX.
- Error observed: `Could not restore AI context - history service unavailable.`
  - In LLxprt, core history restore uses `geminiClient.getHistoryService()`. If chat is never initialized (content generator/auth not ready), history service stays null and restore fails.

## Gap Analysis vs upstream
1. **CLI flags + UX**
   - Missing: `--list-sessions`, `--delete-session`.
   - Missing: selection by index/UUID or `latest`.
   - Missing: list display with first message preview + relative time + current session marker.

2. **Resume behavior**
   - Upstream explicitly passes session data into `resumeChat` and rehydrates both UI history and client history.
   - LLxprt restores UI history from persisted cache, but AI history restore can fail if the client isn’t initialized yet.

3. **Session storage/format**
   - Upstream uses core conversation records (`ConversationRecord`) with message metadata for tools, display, timestamps, etc.
   - LLxprt uses a custom `PersistedSession` format; it’s adequate for UI restore, but lacks list/index metadata and selection semantics.

## Root cause for the reported error
- Message originates from LLxprt’s history restore flow (core client) when `getHistoryService()` returns null.
- Chat initialization fails or is deferred when auth/content generator isn’t ready. The restore waits/polls and times out.
- Result: UI history restored from cache, **AI context not restored**.

## Improvement Plan

### Phase 1: Feature parity on selection and listing (CLI + storage index)
1. **Add session discovery/indexing in core**
   - Add a `SessionIndexService` or extend `SessionPersistenceService` to:
     - List persisted sessions with metadata: `sessionId`, `fileName`, `createdAt`, `updatedAt`, `firstUserMessage`, `index`, `isCurrentSession`.
     - Parse `PersistedSession` to get `firstUserMessage` (truncate to 100 chars) and timestamps.
     - Sort sessions by `createdAt` (oldest first) so indexes are stable and “latest” is last.

2. **Add CLI flags**
   - `--resume [value]` (string with “latest” default when passed without value).
   - `--list-sessions` (boolean).
   - `--delete-session <index|uuid>` (string).
   - Keep `--continue` for backward compatibility but map to `--resume latest` internally.

3. **Implement list and delete handlers**
   - `listSessions(config)` prints: index, first user message preview, relative time, `[sessionId]`, marks current.
   - `deleteSession(config, identifier)` deletes by index/UUID, guard current session.
   - Reuse `SessionPersistenceService` to delete persisted session file.

### Phase 2: Resume selection + rehydration improvements
4. **Session selection**
   - Add `SessionSelector` to resolve `latest`, index, or UUID to a persisted session file.
   - Return `{ sessionPath, sessionData }` for resume.

5. **Resume flow (interactive + non-interactive)**
   - If `--resume` is used, pass `resumedSessionData` into the UI or non-interactive pipeline.
   - Rehydrate UI history from `PersistedSession.uiHistory` when available.
   - Convert `PersistedSession.history` into client history for `resumeChat`.

6. **Replace `--continue` logic**
   - Map `--continue` to `--resume latest` and allow `--continue` + `--prompt` to work like upstream `--resume`.

### Phase 3: Fix the “history service unavailable” failure path
7. **Ensure client initialization before restore**
   - Align with upstream: perform **resumeChat** after client initialization (or store history for later use).
   - Option A: If auth not ready, store history and apply after `lazyInitialize()`.
   - Option B: Ensure `GeminiClient` starts chat prior to `restoreHistory` and returns a valid history service.

8. **Upgrade error messaging + telemetry**
   - If history restore fails due to auth/config, log actionable guidance (e.g., “Auth required to restore AI context; re-run with --prompt after login”).
   - Track resume failures to help diagnose.

### Phase 4: Tests and validation
9. **Tests**
   - New tests for session listing, selection by index/UUID/latest, delete guard for current session.
   - Resume flow tests: UI history + client history conversions, and non-interactive resume.
   - Regression test for “history service unavailable” path to verify it’s resolved.

10. **Manual validation**
   - Create multiple sessions, verify list output and indices.
   - Resume latest, resume by index, resume by UUID.
   - Delete a non-current session; attempt delete current session (should fail gracefully).

## Implementation Notes
- Prefer reusing upstream patterns where possible (SessionSelector + formatRelativeTime + first user message extraction).
- Keep LLxprt’s persisted session file format, but add index/list capabilities without breaking existing sessions.
- Backward compatibility: `--continue` remains as alias to `--resume latest`.

## Expected Outcome
- Users can list, select, and delete sessions.
- Session resuming restores both UI and AI context reliably.
- The “history service unavailable” error is eliminated or replaced with a clear auth-required path.
