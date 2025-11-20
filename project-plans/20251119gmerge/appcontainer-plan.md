# AppContainer Migration Plan (detailed, code-researched)

Objective: replace llxprt’s monolithic `packages/cli/src/ui/App.tsx` render loop with the upstream AppContainer/UIStateContext architecture (flicker-resistant) while preserving llxprt-specific behavior (multi-provider flows, OAuth/auth, token metrics, tool batching, todo, workspace/IDE trust, custom slash commands, etc.). This plan assumes no concurrent code changes; execute in order.

## Current llxprt structure (what we must preserve/move)
- Providers/wrappers in `packages/cli/src/ui/App.tsx`: `KeypressProvider` (Kitty/Vim flags), `SessionStatsProvider`, `VimModeProvider`, `ToolCallProvider`, `TodoProvider`, `RuntimeContextProvider`, `OverflowProvider?`, plus `AppDispatchProvider` for `appReducer`.
- State & hooks in `App.tsx` (llxprt-only bits):
  - Multi-provider dialogs: `useProviderDialog`, `useProviderModelDialog` (provider/model selection); `/model` slash command already multi-provider.
  - Tools dialog: `useToolsDialog`; load profile dialog `useLoadProfileDialog`; workspace migration `useWorkspaceMigration`.
  - Todo stack: `TodoProvider`, `TodoPanel`, `TodoPausePreserver`.
  - Token metrics tracker: polling history service (`historyTokenCleanupRef`, `updateHistoryTokenCount`) and `tokenMetricsTracker.ts`.
  - Reactive history/static refresh: `useStaticHistoryRefresh`.
  - OAuth wiring: `globalOAuthUI`, `__oauth_add_item` global, `validateAuthMethod`.
  - Memory refresh: `loadHierarchicalLlxprtMemory` and `setLlxprtMdFileCount`.
  - IDE trust/nudge: `useIdeTrustListener(config)`, `IdeIntegrationNudge`/restart prompt.
  - Slash command processor: `useSlashCommandProcessor` with llxprt commands (`/provider`, `/tools`, `/model`, `/load-profile`, etc.).
  - Input stack: Vim (`useVim`, `VimModeProvider`), Kitty protocol, bracketed paste, `useKeypress` double-tap exit guard while authenticating.
  - Tool batching/auto-accept: `useAutoAcceptIndicator`, ToolCallProvider usage.
  - Workspace trust: `useFolderTrust`, `isWorkspaceTrusted`, include-dirs trust (llxprt variant).
- Additional state holder: `packages/cli/src/ui/containers/SessionController.tsx` handles history/session state, memory refresh, payment mode warnings. We should retire this once AppContainer owns history, but port its logic (payment mode warning, memory refresh) into new state/actions.

## Upstream architecture (what we are importing)
- `AppContainer.tsx`: builds UI state/actions, wraps `App` with `UIStateContext`, `UIActionsContext`, `ConfigContext`, `AppContext`, `ShellFocusContext`. Handles:
  - Ctrl+C/D counters with timers; first press cancels request, second runs `/quit`; copy-mode toggle; constrainHeight toggle; shell focus toggle; IDE status shortcut.
  - Calls `useFlickerDetector(rootUiRef, terminalHeight)` and sets `ref={uiState.rootUiRef}` in layout.
  - Uses `useAlternateBuffer`, `calculateMainAreaWidth`, `useTerminalSize`, `useTextBuffer`, slash commands, extension updates/consent, banners, quota prompts, etc.
- `App.tsx`: layout chooser + quitting display.
- `layouts/DefaultAppLayout.tsx`: `MainContent` + (`Notifications` + `DialogManager` | `Composer`) + `ExitWarning` + `CopyModeWarning`; root `ref` for flicker detector.
- `hooks/useFlickerDetector.ts`: `measureElement(rootUiRef)` vs `terminalHeight`; on overflow (when `constrainHeight` true) calls `recordFlickerFrame(config)` and emits `AppEvent.Flicker`.
- `contexts/UIStateContext.tsx`/`UIActionsContext.tsx`: state shape includes dialogs, auth, buffer, widths, console messages, renderMarkdown, IDE/trust prompts, quota, banners, copy mode, debug profiler, terminal sizes, refs, extension update state, pending history; actions include dialog open/close, auth select/api key submit, folder trust select, refreshStatic, final submit/clear, quota choice, queue error, pop messages, banner visibility, embedded shell focus, Vim handler, escape prompt change.

## Provider origins and handling
- Upstream-derived (keep but point to llxprt config/runtime): `KeypressProvider`, `SessionStatsProvider`, `VimModeProvider`, `RuntimeContextProvider`, `OverflowProvider`, `ToolCallProvider` concept, `useIdeTrustListener` design, folder trust dialog, include-dirs trust hook, memory monitor, auto-accept indicator, extension consent/update hooks.
- llxprt-unique (must be integrated explicitly): TodoProvider/TodoPanel/TodoPausePreserver; multi-provider dialogs and `/model` variant; tool batching semantics; token metrics polling/publisher; OAuth addItem wiring; unique slash commands (`/provider`, `/tools`, `/load-profile`, etc.); workspace migration dialog; external auth variants; branded banners; corgi mode; git branch handling.
- Recommendation: keep upstream-born providers outside AppContainer (as wrappers), but move *all* stateful behavior into AppContainer/UIState/UIActions so there is a single source of truth (do not leave `appReducer` + `SessionController` running in parallel).

## Migration steps (executable)
1) **Vendor upstream files (with import rewrites)**
   - Copy into `packages/cli/src/ui/`: `AppContainer.tsx`, `App.tsx` (layout selector), contexts (`UIStateContext.tsx`, `UIActionsContext.tsx`, `ConfigContext.tsx`, `AppContext.tsx`, `ShellFocusContext.tsx`), layouts (`DefaultAppLayout.tsx`, `ScreenReaderAppLayout.tsx`), components (`Composer.tsx`, `DialogManager.tsx`, `Notifications.tsx`, `CopyModeWarning.tsx`, `ExitWarning.tsx`, `AlternateBufferQuittingDisplay.tsx`), hooks (`useFlickerDetector.ts`, `useAlternateBuffer.ts`, `useMessageQueue.ts`, `useConfirmUpdateRequests.ts`, `useExtensionUpdates.ts`, `useSessionResume.ts`, `useIncludeDirsTrust.ts`, `useQuotaAndFallback.ts`, `useModelCommand.ts`), utils (`utils/ui-sizing.ts`).
   - Replace imports:
     - `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`.
     - `getAllGeminiMdFilenames` → `getAllLlxprtMdFilenames`.
     - Remove `DEFAULT_GEMINI_FLASH_MODEL`; use `config.getModel()` or runtime model.
     - Replace `refreshServerHierarchicalMemory` with llxprt `loadHierarchicalLlxprtMemory` + `config.setLlxprtMdFileCount`.
     - If `recordFlickerFrame` / `recordExitFail` missing, stub with llxprt logger or TODO (prefer minimal no-op to unblock).

2) **Rebuild AppWrapper provider stack**
   - In `packages/cli/src/ui/App.tsx` (entry), render:
     ```
     export const AppWrapper = (props: AppProps) => (
       <KeypressProvider ...>
         <SessionStatsProvider>
           <VimModeProvider settings={props.settings}>
             <ToolCallProvider sessionId={props.config.getSessionId()}>
               <TodoProvider sessionId={props.config.getSessionId()}>
                 <RuntimeContextProvider>
                   <OverflowProvider>
                     <AppContainer {...props} />
                   </OverflowProvider>
                 </RuntimeContextProvider>
               </TodoProvider>
             </ToolCallProvider>
           </VimModeProvider>
         </SessionStatsProvider>
       </KeypressProvider>
     );
     ```
   - Remove `AppWithState`/`appReducer` wiring. AppContainer owns UI state.

3) **Port llxprt state into AppContainer**
   - Integrate llxprt hooks in AppContainer (replacing/upgrading upstream choices):
     - Replace upstream `useModelCommand` with llxprt `useProviderDialog` + `useProviderModelDialog`; store dialog flags/selections in UIState; expose open/close/select actions in UIActions.
     - Add tools dialog (`useToolsDialog`), load profile (`useLoadProfileDialog`), workspace migration (`useWorkspaceMigration`), todo panel (`useTodoContext`) and `TodoPausePreserver`.
     - Token metrics: copy `useEffect` from current App.tsx that polls history service (`historyTokenCleanupRef`, `lastHistoryServiceRef`, `updateHistoryTokenCount`) into AppContainer; wire into `useSessionStats`.
     - Memory refresh: drop `refreshServerHierarchicalMemory`; add llxprt `loadHierarchicalLlxprtMemory(...)` call and `config.setLlxprtMdFileCount`.
     - OAuth wiring: set `global.__oauth_add_item`, `globalOAuthUI.setAddItem(addItem)`; clear on unmount; keep `validateAuthMethod`.
     - Slash commands: use llxprt `useSlashCommandProcessor` with existing commands (`/provider`, `/model`, `/tools`, `/load-profile`, etc.); ensure `handleSlashCommand('/quit')` used by Ctrl+C/D.
     - Input: preserve Vim/Kitty/bracketed paste from llxprt; merge into upstream `handleGlobalKeypress`. Keep guard: if `isAuthenticating` true, Ctrl+C/D should not exit.
     - Tool batching/auto-accept: include `useAutoAcceptIndicator`, ToolCallProvider cancel callback hooked to Ctrl+C.
     - IDE trust/nudge: use llxprt `useIdeTrustListener(config)` to set `showIdeRestartPrompt`; include `IdeIntegrationNudge` handler in UIState/UIActions.
     - Workspace trust: use llxprt `useFolderTrust(settings, config)` and include include-dirs trust hook.
     - Git branch/name: keep `useGitBranchName`.
     - History/static refresh: keep `useStaticHistoryRefresh` logic if still needed; align with AppContainer’s history manager.

4) **Port actions into UIActions**
   - Add: provider/model dialog open/select/close; tools dialog actions; load profile/workspace migration actions; memory refresh action (llxprt path); slash command run; tool enable/disable actions; todo pause register; workspace trust accept/deny; IDE nudge completion; OAuth dialog open; auto-accept toggle.
   - Auth actions: use llxprt `useAuthCommand` (external auth, OAuth UI); wire `handleAuthSelect`, `handleApiKeySubmit/Cancel` exactly as llxprt requires.
   - Keep upstream actions for theme/settings dialogs, quota prompts, banner visibility, embedded shell focus, escape prompt change.

5) **Layout integration**
   - `DefaultAppLayout.tsx`: keep `ref={uiState.rootUiRef}`; width/height from `uiState`. Ensure `DialogManager` includes llxprt dialogs listed above. Ensure `Composer` uses llxprt prompt pipeline (input buffer, suggestions, slash commands, Vim/Kitty).
   - Choose width calc: either upstream `calculateMainAreaWidth` or llxprt `useResponsive`; remove the unused one; set `uiState.mainAreaWidth` accordingly.
   - Retain `useFlickerDetector` hook with `constrainHeight` default true (llxprt behavior).

6) **Core integration swaps**
   - Extension consent/update: hook into llxprt extension manager (requested consent dialog) instead of upstream `requestConsentInteractive`.
   - Banners: replace Gemini promo with llxprt-neutral copy or config-provided banners.
   - Model defaults: do not use `DEFAULT_GEMINI_FLASH_MODEL`; rely on `config.getModel()`/runtime active model.
   - Telemetry stubs: if `recordExitFail`/`recordFlickerFrame` missing, add no-op or route to llxprt logger (avoid breaking build).
   - Alternate buffer: vendor upstream `useAlternateBuffer` if absent; hook to llxprt terminal handling or return false if unsupported (document).

7) **Shim/update components**
   - Components that read props from old App must swap to `useUIState`/`useUIActions`: history display, footer/header, token metrics display, todo panel, provider/model/tools dialogs, settings/theme/auth dialogs, workspace migration, load profile, trust dialogs.
   - Keep `AppWrapper` export stable for IDE companion; internally render AppContainer.
   - Retire `SessionController` after history/session logic is fully inside AppContainer (or leave temporarily and then remove).

8) **Testing & acceptance**
   - Unit/integration updates:
     - `useFlickerDetector`: mock `measureElement` > `terminalHeight` ⇒ emits `AppEvent.Flicker` when `constrainHeight` true.
     - Ctrl+C/D: first tap cancels request; second tap runs `/quit`; guard when `isAuthenticating`; guard when input buffer non-empty for Ctrl+D.
     - Dialog switching: `dialogsVisible` => `DialogManager`, else `Composer`.
     - Provider/model/tools/load profile/workspace migration dialogs: actions open/close and mutate UIState.
     - Token metrics: `tokensUpdated` event updates session stats.
   - Manual: reproduce #456 flicker (narrow terminal + dialogs/long output) and confirm no flicker (no `recordFlickerFrame`), UI stable.
   - Run AGENTS checklist: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "just say hi"`.

## Acceptance criteria
- AppContainer/UIStateContext fully replace monolithic `App.tsx` render flow.
- All llxprt features (multi-provider, tools/timeouts/todo, OAuth/auth, token metrics, trust/IDE/workspace, custom slash commands, Vim/Kitty input) work unchanged.
- Flicker eliminated under #456 scenario; flicker detector active.
- Tests updated and pass; full AGENTS command list passes.
