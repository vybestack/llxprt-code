# PLAN-20260214-SESSIONBROWSER — TypeScript Expert Review (Part 1: Phases 00–19)

**Reviewer:** typescriptexpert
**Date:** 2025-02-14
**Scope:** Phases 00 (Overview), 01 (Preflight), 02 (Analysis), 03 (Pseudocode), 09–11 (performResume), 12–14 (useSessionBrowser), 15–17 (SessionBrowserDialog), 18–20 (continueCommand)
**Documents reviewed:** overview.md, technical-overview.md, mockup.md, requirements.md, all analysis/pseudocode files, all plan phase files 00–20a, codebase source for types.ts, SessionDiscovery.ts, commands/types.ts, DialogManager.tsx, AppContainer.tsx, resumeSession.ts, sessionManagement.ts, RecordingIntegration.ts, useResponsive.ts, sessionUtils.ts, config.ts, gemini.tsx

---

## CRITICAL Issues

### C-01: `recordingIntegration` is a prop, not React state — swap cannot trigger re-render

**Files:** `technical-overview.md` §9, `plan/11-perform-resume-impl.md`, `analysis/pseudocode/perform-resume.md`
**Spec says:** "The new `RecordingIntegration` must be stored in React state (not just on a ref or `CommandContext`) so that the component tree re-renders and the `useEffect` re-fires with the new integration."
**Reality:** In `AppContainer.tsx` (line 156), `recordingIntegration` is received as an `AppContainerProps` prop, injected from `gemini.tsx` where it is created once at startup (line 977: `const recordingIntegration = new RecordingIntegration(recordingService)`). It is **not** stored in React state anywhere — it's a const in the outer `main()` scope passed into the Ink `render()` call. The `useEffect` at line 428 that subscribes `recordingIntegration` to `HistoryService` depends on `[config, recordingIntegration]` — but since `recordingIntegration` is a prop from the outer scope, changing it requires re-rendering from outside the React tree.

**Impact:** The two-phase swap design assumes you can call `setState(newRecordingIntegration)` to trigger re-render + re-subscription. This is architecturally impossible with the current prop-threading pattern. The plan's Phase 2 step 6 ("Update React state to point to the new recording/lock") has no implementation path.

**Fix:** The plan must explicitly design one of:
1. **Lift to state in gemini.tsx:** Convert the recording infrastructure to a mutable ref or state pattern that Ink can re-render from (e.g., wrap in a `RecordingProvider` component rendered inside the Ink tree that holds `useState<RecordingIntegration>`).
2. **Use a ref + manual re-subscription:** Store `recordingIntegration` in a `useRef` inside `AppContainer`, and after swap, manually call `recordingIntegration.onHistoryServiceReplaced()` on the new integration + update the ref. This avoids needing React state but requires the subscription `useEffect` to also watch for ref changes (which it can't natively — so you'd need a state counter to force re-render).
3. **RecordingContext provider:** As the technical-overview briefly mentions but doesn't spec. This must be fully designed with the provider component location, state management, and how `gemini.tsx` passes the initial value into the React tree.

The plan phases 09–11 must include a concrete design for this mechanism, not leave it as "the implementor should trace the prop flow."

---

### C-02: `performResume()` cannot return `LoadHistoryActionReturn` for the direct path — side-effects happen outside the command return cycle

**Files:** `technical-overview.md` §7, `plan/20-continue-command-impl.md`, `plan/11-perform-resume-impl.md`
**Spec says:** For `/continue latest`, `performResume()` is called directly and returns a `LoadHistoryActionReturn`.
**Problem:** `LoadHistoryActionReturn` is `{ type: 'load_history', history: HistoryItemWithoutId[], clientHistory: Content[] }`. The `slashCommandProcessor` handles this by calling `loadHistory()` and `restoreHistory()`. But `performResume()` also needs to:
- Dispose the old `RecordingIntegration` + `SessionRecordingService`
- Release the old lock
- Install the new `RecordingIntegration` + lock
- Update `SessionRecordingMetadata`

These side-effects cannot be expressed in a `LoadHistoryActionReturn`. The command processor doesn't know about recording infrastructure at all.

**Impact:** The direct `/continue <ref>` path has no mechanism to perform the recording service swap. Returning `LoadHistoryActionReturn` only handles the history UI — the recording infrastructure remains pointed at the old session.

**Fix:** Either:
1. `performResume()` must perform ALL side-effects (including recording swap) before returning, and the `LoadHistoryActionReturn` just carries the UI/client history. This means `performResume()` needs direct access to the recording infrastructure refs/state (not just `CommandContext.recordingIntegration` which is read-only).
2. Define a new action return type (e.g., `ResumeActionReturn`) that the command processor knows how to handle, including the recording infrastructure update.
3. The command's `action()` function performs the swap imperatively (using refs/contexts) and THEN returns `LoadHistoryActionReturn` for just the UI update.

The plan acknowledges this partially ("The returned `LoadHistoryActionReturn` carries only the UI history and client history; the recording infrastructure is already swapped") but doesn't explain HOW the swap happens before the return, given that the command action doesn't have mutable access to recording infrastructure today.

---

### C-03: `deleteSession()` in core takes a string ref, not a sessionId — plan/pseudocode pass sessionId directly

**Files:** `plan/14-use-session-browser-impl.md`, `analysis/pseudocode/use-session-browser.md`, `requirements.md` REQ-DL-004
**REQ-DL-004 says:** "the system shall delete the session file using the session's `sessionId` as the deletion reference"
**Reality:** `deleteSession(ref, chatsDir, projectHash)` in `sessionManagement.ts` (line 72) takes a `ref: string` and internally calls `SessionDiscovery.resolveSessionRef(ref, sessions)` to resolve it. It works with session IDs, prefixes, AND numeric indices. Passing a `sessionId` directly will work as long as `resolveSessionRef` finds an exact match.

**However**, `deleteSession()` also internally re-lists sessions (`SessionDiscovery.listSessions()`) and re-checks locks. The plan's pseudocode in `use-session-browser.md` (handleDelete) shows:
```
await deleteSession(session.sessionId, chatsDir, projectHash)
```

This is correct but redundant — `deleteSession` re-discovers and re-resolves, which means a second `listSessions()` call. This is not wrong, but the plan should acknowledge this double-list cost. For the hook calling `deleteSession()` with a `sessionId`, the resolution will always be an exact match (fast path), so this is **MINOR** not critical. Downgrading.

**Revised severity: MINOR** — see M-07 below.

---

## MAJOR Issues

### J-01: `listSessionsDetailed()` does not exist — plan requires new core API without a core-layer phase

**Files:** `technical-overview.md` §2, `plan/12-use-session-browser-stub.md`, `plan/14-use-session-browser-impl.md`, `analysis/pseudocode/session-discovery-extensions.md`
**Spec says:** `SessionDiscovery.listSessionsDetailed(chatsDir, projectHash): Promise<{ sessions: SessionSummary[], skippedCount: number }>` is a new method.
**Problem:** Phases 09–20 cover `performResume`, `useSessionBrowser`, `SessionBrowserDialog`, and `continueCommand` — all in `packages/cli`. But the new core methods (`listSessionsDetailed`, `hasContentEvents`, `readFirstUserMessage`) are in `packages/core/src/recording/SessionDiscovery.ts`. There is NO dedicated phase for implementing these core extensions.

The plan overview (00-overview.md) lists phase groupings but the core-layer `SessionDiscovery` extensions appear to be expected as part of the `useSessionBrowser` phases (12–14). This is architecturally mixed — the stub/TDD/impl cycle for `useSessionBrowser` (a React hook in `packages/cli`) shouldn't be the place where `packages/core` gets new exported methods.

**Fix:** Add a dedicated phase group (e.g., phases 06–08) for `SessionDiscovery` core extensions:
- Phase 06: Stub `listSessionsDetailed()`, `hasContentEvents()`, `readFirstUserMessage()` in `packages/core`
- Phase 07: TDD for these methods (unit tests in `packages/core`)
- Phase 08: Implement

Alternatively, if the overview already has phases 04–08 allocated for other work, insert these before phase 09 and renumber. The useSessionBrowser phases should depend on the core extensions being complete.

---

### J-02: `SessionRecordingService.dispose()` is async but plan's Phase 2 swap ordering may drop awaits

**Files:** `technical-overview.md` §9, `plan/11-perform-resume-impl.md`
**Spec says:** "Call `recordingIntegration.dispose()` on the old bridge first… Then call `recordingService.dispose()` on the underlying `SessionRecordingService`"
**Reality:** `RecordingIntegration.dispose()` is synchronous (line 153 of RecordingIntegration.ts — sets `this.disposed = true` and calls `this.unsubscribeFromHistory()`). But `SessionRecordingService.dispose()` is **async** (line 271 — calls `await this.flush()`). If the plan's pseudocode doesn't properly `await` the service dispose, buffered events may be lost.

**Additionally:** The plan says `performResume()` returns `PerformResumeResult` which includes `newRecording: SessionRecordingService`. But `performResume()` is supposed to perform the old-session disposal as a side-effect. If `performResume()` awaits `oldRecordingService.dispose()`, that's correct. But the pseudocode in `perform-resume.md` shows:

```
Phase 2 — dispose old:
  context.oldRecordingIntegration.dispose()      // sync
  await context.oldRecordingService.dispose()    // async — flush + close
  await context.oldLockHandle?.release()         // async
```

This looks correct in the pseudocode, but the plan phases (11-perform-resume-impl) must ensure the implementation `await`s both async calls. The issue is that `performResume()` needs references to `oldRecordingService` and `oldRecordingIntegration` — but `CommandContext.recordingIntegration` is the bridge, and there's no `CommandContext.recordingService` exposed separately. The `RecordingIntegration` wraps the service but doesn't expose a public `.dispose()` for the underlying service.

**Fix:** 
1. Verify that calling `RecordingIntegration.dispose()` followed by `SessionRecordingService.dispose()` is safe — ensure the service's `dispose()` can be called after the integration's `dispose()` without issues (it should be, since integration dispose just unsubscribes).
2. `performResume()` needs access to the raw `SessionRecordingService` reference, not just the `RecordingIntegration`. Either expose it on the integration (e.g., `RecordingIntegration.getService()`) or pass it separately in `ResumeContext`.
3. The plan phases must spec exactly where `oldRecordingService` comes from in `ResumeContext`. Currently `CommandContext` only has `recordingIntegration?: RecordingIntegration` — no raw service ref.

---

### J-03: Missing `isProcessing` access in command context for the `/continue` command guard

**Files:** `technical-overview.md` §4.3, `plan/20-continue-command-impl.md`, `requirements.md` REQ-MP-004
**Spec says:** "If the model is currently processing (`isProcessing` is true), the command returns an error"
**Reality:** `isProcessing` is React state in `AppContainer.tsx` (line 595: `const [isProcessing, setIsProcessing] = useState<boolean>(false)`). It's passed through `UIStateContext` (line 176) as `isProcessing: boolean`. However, `CommandContext` (in `commands/types.ts`) does NOT include `isProcessing`. The command's `action()` function receives `CommandContext` — it has no way to read `isProcessing`.

Looking at how other commands might access this: `slashCommandProcessor.ts` has `setIsProcessing` in scope, but individual command actions don't. The command would need to either:
1. Access `isProcessing` via the `ui` section of `CommandContext` (it's not there today), or
2. Access it via a hook (but commands are not React components), or
3. Have the `slashCommandProcessor` guard against `/continue` while processing (before dispatching to the command action).

**Fix:** The plan must specify how `isProcessing` is made available to the `/continue` command. Options:
- Add `isProcessing: boolean` to `CommandContext.session` or `CommandContext.ui`.
- Have the slash command processor pre-check `isProcessing` before dispatching any command that returns `'dialog'` or `'load_history'` — but this would be too broad.
- Best approach: add `isProcessing` to `CommandContext.session` (it's session-relevant state). Phase 18 (stub) must include this addition.

---

### J-04: `onSelect` callback type mismatch — dialog expects `Promise<PerformResumeResult>`, but `DialogManager` plumbing needs design

**Files:** `technical-overview.md` §4.2 and §5, `plan/17-session-browser-dialog-impl.md`, `plan/15-session-browser-dialog-stub.md`
**Spec says:** `SessionBrowserDialogProps.onSelect: (session: SessionSummary) => Promise<PerformResumeResult>`. The dialog `await`s this promise for inline error display.
**Problem:** The `DialogManager` renders dialogs and wires callbacks. For `SessionBrowserDialog`, the `onSelect` handler must:
1. Check for active conversation (the dialog handles this inline, NOT via `ConsentPrompt`)
2. Call `performResume()`
3. On success: update recording infrastructure, close dialog, load history
4. On failure: return the error

But `DialogManager` doesn't have access to all required dependencies:
- `performResume()` needs `ResumeContext` with `chatsDir`, `projectHash`, `currentSessionId`, `currentProvider`, `currentModel`, `workspaceDirs`, plus mutable refs to `recordingService`, `recordingIntegration`, and `lockHandle`.
- The current `DialogManager` receives `{ addItem, terminalWidth, config, settings }` as props (line 58 of DialogManager.tsx).
- It accesses `uiState` and `uiActions` from context, plus `runtime` from `useRuntimeApi()`.
- It does NOT have access to `recordingIntegration`, `lockHandle`, `geminiClient.restoreHistory()`, or `loadHistory` from the history manager.

**Fix:** The plan phases 15–17 must specify exactly which new props or context values `DialogManager` needs. The `onSelect` handler will likely need to be wired at the `AppContainer` level (which has access to `recordingIntegration`, `config`, the history manager, and the runtime), not in `DialogManager` itself. This requires either:
- Passing a pre-wired `onSelect` callback down to `DialogManager` as a prop, or
- Rendering `SessionBrowserDialog` directly in `AppContainer` (bypassing `DialogManager`), like some other special-case dialogs.

The plan's statement "The exact wiring depends on which component has `config` in scope — trace the existing dialog plumbing pattern" is insufficient for implementation guidance.

---

### J-05: The active-conversation check uses "non-empty model history" — no clear API to check this from command or dialog

**Files:** `technical-overview.md` §5, `requirements.md` REQ-RS-006 / REQ-RC-010, `plan/20-continue-command-impl.md`
**Spec says:** "If the user has an active conversation (non-empty model history)" — show confirmation.
**Problem:** How is "non-empty model history" determined?
- `geminiClient.getHistory()` could work, but `geminiClient` isn't accessible from `CommandContext`.
- The UI `history` array (from `useHistoryManager`) tracks display items, not model history.
- `CommandContext.session.stats` has token counts but not a "has history" boolean.

For the browser path, the dialog renders the confirmation inline. For the direct `/continue <ref>` path, the command needs to check and potentially show confirmation via `ConfirmActionReturn`.

**Fix:** The plan must define exactly how "has active conversation" is checked:
- Option A: Add `hasActiveConversation: boolean` to `CommandContext.session` (derived from model history length).
- Option B: Use `CommandContext.session.stats.totalTokens > 0` as a proxy.
- Option C: Access `geminiClient` through `config.getGeminiClient()?.getHistory()?.length > 0`.

For the browser path, the dialog needs this same check — the `onSelect` handler or the hook needs to know whether to show confirmation before calling `performResume()`.

---

### J-06: Missing phase dependency — Phase 09 (performResume stub) depends on core extensions that aren't implemented yet

**Files:** `plan/00-overview.md`, `plan/09-perform-resume-stub.md`
**Problem:** Phase 09 creates the `performResume()` stub. But `performResume()` depends on:
- `SessionDiscovery.listSessions()` (exists [OK])
- `SessionDiscovery.resolveSessionRef()` (exists [OK])
- `SessionDiscovery.hasContentEvents()` (does NOT exist — needed for `"latest"` to skip empty sessions per REQ-PR-002)
- `resumeSession()` from core (exists [OK])

The `hasContentEvents()` method is listed as a new core extension in the technical overview but there's no phase for implementing it. Phase 09's stub will reference a method that doesn't exist.

**Fix:** As noted in J-01, add a core-extensions phase before phase 09. At minimum, `hasContentEvents()` must be stubbed/tested/implemented before `performResume` can be implemented.

---

### J-07: `deleteSession` uses session ref resolution internally — the hook passes `sessionId` but plan doesn't mention this could fail on ambiguous resolution

**Files:** `plan/14-use-session-browser-impl.md`, `analysis/pseudocode/use-session-browser.md`
**Spec says:** Delete by `sessionId`. The pseudocode shows `await deleteSession(session.sessionId, chatsDir, projectHash)`.
**Problem:** A `sessionId` is a UUID-like string. `deleteSession()` internally calls `resolveSessionRef(ref, sessions)` which first checks for an exact match. UUIDs should always exactly-match. However, if `sessionId` happens to be all digits (unlikely but not impossible in theory), `resolveSessionRef()` would treat it as a 1-based index instead. The existing resolution has a precedence: exact match first, then numeric index, then prefix. For UUIDs this is fine, but the plan should document this assumption.

**Impact:** Low probability but worth noting.

**Fix:** Add a code comment or assertion in the hook that `sessionId` is not purely numeric. Or better: add a direct-delete-by-path API to core that bypasses resolution entirely (future enhancement, not blocking).

**Revised severity: MINOR** — UUID session IDs are never purely numeric.

---

## MINOR Issues

### M-01: `PreviewState` type `'none'` vs `null` ambiguity in pseudocode

**Files:** `analysis/pseudocode/use-session-browser.md`, `technical-overview.md` §3
**Spec says:** `previewState: PreviewState` where `PreviewState = 'loading' | 'loaded' | 'none' | 'error'`.
**Pseudocode shows:** `firstUserMessage?: string` is present only when `previewState === 'loaded'`.
**Issue:** When `previewState === 'none'`, is `firstUserMessage` `undefined` or absent? The type says `firstUserMessage?: string` (optional). The pseudocode should clarify that `'none'` means "the file was read successfully but no user message was found" — `firstUserMessage` should be `undefined`. This is a minor clarity issue for the implementor.

**Fix:** Add a comment in the `EnrichedSessionSummary` type definition: `firstUserMessage` is defined only when `previewState === 'loaded'`, undefined otherwise.

---

### M-02: Pagination is described as "20 per page" but PAGE_SIZE constant is not defined in any phase

**Files:** `requirements.md` REQ-PG-001, `plan/12-use-session-browser-stub.md`, `plan/14-use-session-browser-impl.md`
**Issue:** The magic number `20` appears in the spec but the plan phases don't define a named constant (e.g., `SESSION_BROWSER_PAGE_SIZE`). This should be a constant, not a magic number.

**Fix:** Phase 12 (stub) should define `const SESSION_BROWSER_PAGE_SIZE = 20` and export it for use in both the hook and the dialog.

---

### M-03: Sort cycle order is specified but `technical-overview.md` and mockup slightly differ on sort options

**Files:** `requirements.md` REQ-SO-003, `mockup.md`
**Spec says:** Sort cycles: newest → oldest → size → newest.
**Mockup shows:** `Sort: [newest]  oldest  size`
**Issue:** These are consistent, but the plan phases should ensure the `sortOrders` array is defined in the hook as `['newest', 'oldest', 'size'] as const` and the cycling wraps around. This is correctly described; just flagging that the implementation phase should use a typed constant array.

**Fix:** Phase 12 (stub) should define the sort order type and cycling constant.

---

### M-04: `relativeTime` utility location inconsistency

**Files:** `technical-overview.md` §10, `plan/12-use-session-browser-stub.md`
**Spec says:** Location is `packages/cli/src/ui/utils/relativeTime.ts`.
**Issue:** The plan phases 12–14 (useSessionBrowser) are where the hook is implemented, but `relativeTime.ts` is a standalone utility. It should be implemented in its own mini-phase or explicitly noted as part of the stub phase. The plan phase 12 stub file doesn't mention creating `relativeTime.ts`.

**Fix:** Phase 12 or an earlier phase should explicitly list `relativeTime.ts` as a deliverable with its own test file.

---

### M-05: `SessionBrowserDialogProps.onClose` type doesn't appear in the dialog integration section

**Files:** `technical-overview.md` §4.2 and §5
**Issue:** The props include `onClose: () => void` which the dialog calls when Esc closes the browser. The integration section (§5) mentions `closeSessionBrowserDialog()` in `UIActions`. But the plan doesn't explicitly connect `onClose` to `uiActions.closeSessionBrowserDialog()` in the `DialogManager` wiring. This should be explicit.

**Fix:** Phase 15 (stub) or phase 17 (impl) should document: `onClose={() => uiActions.closeSessionBrowserDialog()}` in `DialogManager`.

---

### M-06: `iContentToHistoryItems` returns `HistoryItem[]` (with IDs), not `HistoryItemWithoutId[]`

**Files:** `technical-overview.md` §8
**Spec says:** "UI history: `iContentToHistoryItems(history: IContent[]): HistoryItemWithoutId[]`"
**Reality:** Looking at `packages/cli/src/ui/utils/iContentToHistoryItems.ts` line 36: `export function iContentToHistoryItems(contents: IContent[]): HistoryItem[]` — it returns `HistoryItem[]`, not `HistoryItemWithoutId[]`. `HistoryItem` includes an `id` field.

**Impact:** The `loadHistory()` function from `useHistoryManager` expects `HistoryItemWithoutId[]`. There may be a type mismatch when passing the output of `iContentToHistoryItems()` to `loadHistory()`. Looking at `AppContainer.tsx` line 215, the existing resume flow uses `iContentToHistoryItems(resumedHistory)` and passes the result to `loadHistory()` — so either `loadHistory` accepts `HistoryItem[]` too (structural compatibility), or there's already an existing cast.

**Fix:** Verify the type compatibility. If `HistoryItem extends HistoryItemWithoutId`, this is fine (structural subtyping). But the spec should reference the correct return type to avoid confusion. Update technical-overview.md §8 to say `HistoryItem[]` not `HistoryItemWithoutId[]`.

---

### M-07: `deleteSession()` re-lists sessions internally — double listing cost

**Files:** `plan/14-use-session-browser-impl.md`, `analysis/pseudocode/use-session-browser.md`
**Issue:** (Downgraded from C-03.) The hook already has the full session list. Calling `deleteSession(sessionId, chatsDir, projectHash)` re-lists all sessions to resolve the ref. This is redundant I/O.

**Fix:** Consider adding a `deleteSessionByPath(filePath, chatsDir)` API to core that takes the file path directly, checks the lock, and deletes. This avoids the double-list. If not worth the API change, document the cost as acceptable (20 files × stat = negligible).

---

### M-08: Escape key during `isResuming` — spec says "ignored" but plan phase 16 TDD doesn't test this

**Files:** `requirements.md` REQ-RS-005 / REQ-MP-003, `plan/16-session-browser-dialog-tdd.md`
**Issue:** The spec says all keys (including Escape) are ignored during `isResuming`. Phase 16 (TDD) should include an explicit test case: "When `isResuming` is true and Escape is pressed, the browser does NOT close."

**Fix:** Add this test case to phase 16 TDD.

---

### M-09: `getProjectTempDir()` vs `getProjectRoot()` confusion in prop plumbing

**Files:** `technical-overview.md` §5
**Spec says:** `chatsDir` is computed from `config.storage.getProjectTempDir() + '/chats'`.
**Reality:** In `gemini.tsx` line 892: `const chatsDir = join(config.getProjectTempDir(), 'chats')` — note it's `config.getProjectTempDir()`, NOT `config.storage.getProjectTempDir()`. The `Config` class exposes `getProjectTempDir()` directly.

**Fix:** Update the technical-overview to reference `config.getProjectTempDir()` (not `config.storage.getProjectTempDir()`). Phase 15/17 must use the correct API.

---

### M-10: `CommandContext` doesn't have a way to open dialogs — the `action()` returns `OpenDialogActionReturn`

**Files:** `plan/20-continue-command-impl.md`, `technical-overview.md` §4.3
**Issue:** For `/continue` with no args, the command returns `{ type: 'dialog', dialog: 'sessionBrowser' }`. But `'sessionBrowser'` must be added to the `DialogType` union in `commands/types.ts`. Phase 18 (continue-command-stub) correctly lists this, but phase 15 (session-browser-dialog-stub) also mentions adding to `DialogType`. The ordering is: phase 15 comes before phase 18, so `DialogType` gets updated in phase 15. This is fine if phase 15 correctly adds `'sessionBrowser'` to both `DialogType` and `DialogDataMap`.

**However:** The plan doesn't define a `SessionBrowserDialogData` type in `DialogDataMap`. Other dialogs that need data (e.g., `ModelsDialog`) have entries in `DialogDataMap`. If the session browser dialog needs data passed through the dialog system (e.g., `chatsDir`, `projectHash`), a `SessionBrowserDialogData` interface should be defined.

**Fix:** Phase 15 should define whether `SessionBrowserDialogData` is needed or whether the dialog gets its props through other means (context/computation at render time). If computed at render time (as the spec suggests), add a note explaining why no `DialogDataMap` entry is needed.

---

### M-11: Test strategy for `SessionBrowserDialog` — Ink testing-library may not support `useKeypress` well

**Files:** `plan/16-session-browser-dialog-tdd.md`, `technical-overview.md` §13
**Issue:** The plan says to use "Ink testing-library render tests" for the dialog, including keyboard navigation. Ink's `ink-testing-library` has limited support for simulating keypresses — it uses `stdin.write()` which doesn't always trigger `useInput`/`useKeypress` handlers correctly in tests. Other dialog tests in the codebase should be examined for patterns.

**Fix:** Phase 16 should reference existing keyboard-driven dialog tests (e.g., `ProfileListDialog` tests, `ProviderDialog` tests) to see how they handle keypress simulation. If the project uses a custom test utility for keypresses, the plan should reference it.

---

### M-12: `readFirstUserMessage()` preview truncation length (120 chars) is only used for storage, not display

**Files:** `technical-overview.md` §3 and §11, `requirements.md` REQ-PV-002
**Issue:** `readFirstUserMessage()` truncates to 120 characters. But the display truncation depends on terminal width: wide mode shows more, narrow mode truncates to 30 chars. The 120-char truncation is for the in-memory cached preview. This is fine but worth noting that the display layer will further truncate. The plan should make clear that 120 is a read-time budget (to avoid storing huge strings in memory), not a display-time truncation.

**Fix:** Add a comment in the pseudocode/plan explaining the two-level truncation: 120 chars at read time (memory budget), variable at display time (terminal-width-dependent).

---

### M-13: `plan/10-perform-resume-tdd.md` — test for "latest picks first non-locked, non-current, non-empty" needs `hasContentEvents` mock

**Files:** `plan/10-perform-resume-tdd.md`
**Issue:** Testing `performResume('latest', ...)` requires mocking `SessionDiscovery.hasContentEvents()` to simulate empty sessions being skipped. If `hasContentEvents` doesn't exist yet (see J-01/J-06), the TDD phase can't write this test.

**Fix:** Ensure core extensions are implemented before phase 10, or phase 10's tests should stub `hasContentEvents` as a mock, with a note that the real implementation comes from the core-extensions phase.

---

### M-14: `DialogManager` cascade position — session browser must be inserted at correct priority in the if-else chain

**Files:** `plan/17-session-browser-dialog-impl.md`, `DialogManager.tsx`
**Issue:** `DialogManager` uses a cascading if-else chain (not a switch). Each dialog type is checked in priority order. The session browser must be inserted at the right position. Since it's a normal user-initiated dialog (not a system dialog like `FolderTrust` or `Welcome`), it should go near the bottom — after `SubagentManagerDialog` and `ModelsDialog`, before the final `return null`.

**Fix:** Phase 17 should specify the exact insertion point in the `DialogManager` cascade — after the `isModelsDialogOpen` block and before `return null`.

---

### M-15: Phase 09a/10a/11a verification phases reference `npm run test` but don't scope to specific test files

**Files:** `plan/09a-perform-resume-stub-verification.md`, `plan/10a-perform-resume-tdd-verification.md`, `plan/11a-perform-resume-impl-verification.md`
**Issue:** Verification phases say to run the full test suite. For efficiency during implementation, they should also note the specific test file to run in isolation: e.g., `npx vitest run packages/cli/src/utils/performResume.test.ts`.

**Fix:** Each verification phase should include both the targeted test command and the full suite.

---

### M-16: `RecordingIntegration` dispose does NOT flush — plan's Phase 2 ordering assumption needs explicit verification

**Files:** `technical-overview.md` §9, `RecordingIntegration.ts`
**Reality:** `RecordingIntegration.dispose()` (line 153) only sets `disposed = true` and calls `unsubscribeFromHistory()`. It does NOT flush. `SessionRecordingService.dispose()` (line 271) does `await this.flush()`. The plan's ordering (integration dispose first, then service dispose) is correct — it prevents new events from being enqueued while flushing. But the plan should explicitly note that `RecordingIntegration.dispose()` is synchronous and non-flushing, while `SessionRecordingService.dispose()` is async and flushes.

**Fix:** Add this detail to the pseudocode in `perform-resume.md` as a comment.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 2 | Recording infrastructure swap has no React state path (C-01); direct `/continue` path can't perform side-effects through `LoadHistoryActionReturn` (C-02) |
| MAJOR | 7 | Missing core-extensions phase (J-01, J-06); async dispose ordering (J-02); `isProcessing` not in CommandContext (J-03); DialogManager prop plumbing gap (J-04); active-conversation check API undefined (J-05); delete session re-lists (J-07→M-07) |
| MINOR | 16 | Type precision (M-01, M-06); constants (M-02, M-03); utility phase ordering (M-04); test strategy (M-08, M-11, M-13, M-15); API path corrections (M-09); dialog integration details (M-05, M-10, M-14); documentation clarity (M-12, M-16) |

### Recommended Phase Restructuring

1. **Insert phases 06–08:** Core SessionDiscovery extensions (`listSessionsDetailed`, `hasContentEvents`, `readFirstUserMessage`) — stub, TDD, impl.
2. **Insert phase 08.5:** `relativeTime` utility — stub + TDD + impl (small enough for one phase).
3. **Phase 09 (performResume stub):** Must also design the recording-infrastructure-swap mechanism (C-01) — either a `RecordingContext` provider or a lifted state pattern. This is architectural and must be decided before implementation.
4. **Phase 15 (SessionBrowserDialog stub):** Must specify DialogManager insertion point, `onSelect` handler wiring location (AppContainer vs DialogManager), and whether `SessionBrowserDialogData` is needed.
5. **Phase 18 (continueCommand stub):** Must add `isProcessing` to `CommandContext` and define how the direct path performs recording swap side-effects (C-02).
