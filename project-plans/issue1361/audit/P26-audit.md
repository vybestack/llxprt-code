# P26 Audit: System Integration Implementation — CRITICAL

## Plan Requirements (REQ-INT-WIRE-001 through 006)

- **REQ-INT-WIRE-001: Bootstrap SessionRecordingService on Startup**
  - A `SessionRecordingService` must be created on startup with `sessionId`, `projectHash`, `chatsDir`, `workspaceDirs`, `provider`, and `model`.
- **REQ-INT-WIRE-002: Connect HistoryService Events to Recording**
  - `RecordingIntegration` must be subscribed to `HistoryService` events so `contentAdded`/compression events are recorded.
- **REQ-INT-WIRE-003: Flush at Turn Boundaries**
  - `useGeminiStream` must await `recordingIntegration.flushAtTurnBoundary()` in `submitQuery` `finally`.
- **REQ-INT-WIRE-004: Connect --continue Flag to Resume Flow**
  - `--continue` must run resume discovery/replay/lock flow and seed runtime history from resumed history.
- **REQ-INT-WIRE-005: Dispose Recording on Session Exit**
  - On exit, recording integration/service must flush/dispose and release resources.
- **REQ-INT-WIRE-006: Re-subscribe on Compression**
  - If a new `HistoryService` appears (per plan wording), call `recordingIntegration.onHistoryServiceReplaced(newHistoryService)`.

## KEY CHECK RESULTS

### a. History seeding on --continue resume: NOT DONE
- In `packages/cli/src/gemini.tsx`, resume flow sets `recordingService = resumeResult.recording` on success.
- No use of `resumeResult.history` was found.
- No call found to any history-seeding API such as `client.restoreHistory(history)`.

### b. Metadata usage from resume: NOT DONE
- No use of `resumeResult.metadata` found in `gemini.tsx`.
- No provider/model override from resumed metadata found.
- Runtime provider/model still come from normal config/bootstrap paths, not resumed session metadata.

### c. HistoryService re-subscription on compression: DONE (as implemented)
- In `packages/cli/src/ui/AppContainer.tsx`, a polling effect detects `geminiClient.getHistoryService()` instance changes and calls:
  - `recordingIntegration.onHistoryServiceReplaced(historyService)`
- This re-subscription mechanism is wired and active.
- Note: pseudocode says compression is in-place on same instance; this implementation is broader (instance-change detection), but the required callback wiring exists.

### d. Recording event callers wired: DONE
- `recordProviderSwitch` is called from actual command/hook paths:
  - `ui/commands/providerCommand.ts`
  - `ui/commands/modelCommand.ts`
  - `ui/commands/profileCommand.ts`
  - `ui/hooks/useProviderDialog.ts`
  - `ui/components/DialogManager.tsx`
- `recordDirectoriesChanged` is called from:
  - `ui/commands/directoryCommand.tsx`
- `recordSessionEvent` is called from:
  - `ui/hooks/slashCommandProcessor.ts`
  - `ui/AppContainer.tsx` (core feedback warnings/errors)

### e. --list-sessions wired: DONE
- In `gemini.tsx`, early-exit block checks `argv.listSessions`.
- Calls `listSessions(chatsDir, projectHash)`.
- Prints either no-session message or formatted session list, then exits 0.

### f. --delete-session wired: DONE
- In `gemini.tsx`, early-exit block checks `argv.deleteSession`.
- Calls `deleteSession(argv.deleteSession, chatsDir, projectHash)`.
- On success prints deleted session and exits 0; on failure prints error and exits 1.

## What Was Actually Done

- P26 integration marker and block added in `gemini.tsx`:
  - Computes `projectHash` and `chatsDir`, ensures chats dir exists.
  - Implements `--list-sessions` and `--delete-session` early exits with actual core API calls.
  - Implements resume/new recording service selection:
    - Uses `config.getContinueSessionRef()` to decide resume path.
    - On resume success, uses `resumeResult.recording`.
    - On resume failure, falls back to new `SessionRecordingService`.
  - Creates `RecordingIntegration(recordingService)`.
  - Registers cleanup calling `recordingIntegration.dispose()` then `await recordingService.dispose()`.

- `AppContainer.tsx`:
  - Accepts/passes `recordingIntegration` prop.
  - Wires history-service-aware subscription by calling `recordingIntegration.onHistoryServiceReplaced(historyService)` when detected instance changes.
  - Records warning/error session feedback events.

- `useGeminiStream.ts`:
  - In `submitQuery` `finally`, awaits `recordingIntegration?.flushAtTurnBoundary()` in try/catch (non-fatal on error).

## Gaps / Divergences

1. **Resume history not seeded into active chat history**
   - Required by your check and plan intent (`history MUST be seeded via client.restoreHistory(history)`).
   - Current code does not consume `resumeResult.history`.

2. **Resume metadata not applied to provider/model**
   - `resumeResult.metadata` is unused.
   - No explicit alignment of active provider/model to resumed session metadata.

3. **Continue trigger likely misses bare `--continue`**
   - Plan requirement text references `Config.isContinueSession()` behavior including bare `--continue`.
   - Current gate in `gemini.tsx` is `const continueRef = config.getContinueSessionRef(); if (continueRef) ...`.
   - If bare `--continue` yields `null` (as described in plan notes for config behavior), this path will not attempt resume.

## Severity

- **Gap 1 (history not seeded): Critical**
  - Resume may claim success at recording layer but conversation context/history is not reconstructed for runtime behavior.
- **Gap 2 (metadata unused): High**
  - Resumed session may run under mismatched provider/model, risking behavior divergence and inconsistent continuation.
- **Gap 3 (bare --continue gate via ref truthiness): High**
  - User-visible `--continue` path can be skipped depending on config contract.

## Summary Verdict

**Partial implementation; critical resume wiring is incomplete.**

- Event wiring, flush boundary, and session list/delete early exits are implemented.
- However, the most critical integration behaviors for `--continue` are missing:
  - resumed history is not seeded,
  - resumed metadata is not applied,
  - and continue gating may fail for bare `--continue`.

Given this is the “most critical audit,” **P26 should be considered NOT FULLY DONE** until resume state hydration is correctly wired end-to-end.