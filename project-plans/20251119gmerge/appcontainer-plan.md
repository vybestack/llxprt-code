# AppContainer Migration Plan (step-by-step, research inlined)

Goal: adopt the upstream AppContainer/UIStateContext render architecture (includes flicker detector, composer/layout split) to stop redraw flicker (#456) while keeping llxprt features. This plan spells out exact files, mappings, and edits so it can be followed mechanically.

## Upstream architecture snapshot (from current upstream main with exact refs)
- `packages/cli/src/ui/AppContainer.tsx` (upstream): builds UI state/actions and wraps `App` with `UIStateContext`, `UIActionsContext`, `ConfigContext`, `AppContext`, `ShellFocusContext`. Notable code:
  - Ctrl+C/D counters and timers near the bottom (`const [ctrlCPressCount, ...]`, `useEffect` that triggers `/quit` on second press, and cancels active requests first).
  - Copy-mode toggle in `handleGlobalKeypress` (look for `keyMatchers[Command.TOGGLE_COPY_MODE]`).
  - Calls `useFlickerDetector(rootUiRef, terminalHeight)`; sets `ref={uiState.rootUiRef}` in `DefaultAppLayout`.
  - Uses `recordFlickerFrame(config)` and `AppEvent.Flicker` (measure height vs `terminalHeight`).
- `App.tsx` (upstream): only chooses layout and quitting view.
- `layouts/DefaultAppLayout.tsx` (upstream): root Box with `ref={uiState.rootUiRef}` and height/width from `uiState`. Renders `MainContent`, `Notifications`, `DialogManager` or `Composer`, `ExitWarning`, `CopyModeWarning`.
- `hooks/useFlickerDetector.ts` (upstream): `measureElement(rootUiRef) > terminalHeight` → `recordFlickerFrame(config)` + `AppEvent.Flicker` unless `constrainHeight` is false.
- `contexts/UIStateContext.tsx` and `contexts/UIActionsContext.tsx`: define full UI state/actions shape; state includes history, dialogs, auth, buffer, widths, console messages, renderMarkdown, IDE/trust prompts, quota prompt, banners, copy mode, debug profiler, terminal sizes, refs, extensions update state, pending history; actions include dialog open/close, auth select/api key submit, folder trust select, refreshStatic, final submit/clear, quota choice, queue error, pop messages, banner visibility, embedded shell focus, Vim handler, escape prompt change.

## llxprt deltas to preserve (code references)
- Current monolithic `packages/cli/src/ui/App.tsx`: holds multi-provider dialogs (`useProviderDialog`, `useProviderModelDialog`), tools/load profile/workspace migration hooks, token metrics tracker, TodoPanel, ToolCallProvider usage, OAuth wiring, Vim/Kitty input, bracketed paste, runtime API, memory monitor (`loadHierarchicalLlxprtMemory`), history token publisher, workspace migration dialog. We must move these into AppContainer state/actions.
- `packages/cli/src/ui/containers/SessionController.tsx`: history/session state; will be superseded by AppContainer’s history manager but logic for memory refresh and payment mode warnings must be ported.
- Removed Composer/QueuedMessageDisplay in `899b438e0`; we need to reintroduce Composer shape but back it with llxprt input pipeline.
- Double-tap exits with auth guard live in current `App.tsx` `useKeypress` handler; must match upstream double-tap behavior while keeping “don’t exit while authenticating”.

## Concrete migration steps with file-level instructions and code notes
1) **Add upstream files with llxprt import fixes**
   - Copy from upstream into `packages/cli/src/ui/`:
     - `AppContainer.tsx`, `App.tsx` (layout selector), contexts (`UIStateContext.tsx`, `UIActionsContext.tsx`, `ConfigContext.tsx`, `AppContext.tsx`, `ShellFocusContext.tsx`), layouts (`DefaultAppLayout.tsx`, `ScreenReaderAppLayout.tsx`), components (`Composer.tsx`, `DialogManager.tsx`, `Notifications.tsx`, `CopyModeWarning.tsx`, `ExitWarning.tsx`, `AlternateBufferQuittingDisplay.tsx`), hooks (`useFlickerDetector.ts`, `useAlternateBuffer.ts`, `useMessageQueue.ts`, `useConfirmUpdateRequests.ts`, `useExtensionUpdates.ts`, `useSessionResume.ts`, `useIncludeDirsTrust.ts`, `useQuotaAndFallback.ts`, `useModelCommand.ts`), utils (`utils/ui-sizing.ts`).
   - In these files replace imports: `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`; `getAllGeminiMdFilenames` → `getAllLlxprtMdFilenames`; `DEFAULT_GEMINI_FLASH_MODEL` → llxprt default model from config; replace `refreshServerHierarchicalMemory` calls with `loadHierarchicalLlxprtMemory` plus count setter.
   - Remove/replace telemetry calls if absent (e.g., `recordFlickerFrame`, `recordExitFail`); if no llxprt equivalent, keep no-op wrappers or add TODO to connect to llxprt logger.

2) **Provider wrapping order (code splice)**
   - In llxprt entry (where `AppWrapper` is exported, `packages/cli/src/ui/App.tsx` currently), change render to:
     ```
     export const AppWrapper = (props: AppProps) => (
       <KeypressProvider ...>
         <SessionStatsProvider>
           <VimModeProvider ...>
             <ToolCallProvider ...>
               <TodoProvider ...>
                 <RuntimeContextProvider>
                   <OverflowProvider> // if used
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
   - Remove inner `AppWithState` path; AppContainer now orchestrates state.

3) **Port llxprt state into AppContainer (code locations)**
   - Move from old `App.tsx` into AppContainer:
     - Provider/model dialogs: import `useProviderDialog` / `useProviderModelDialog` and expose flags & handlers in UIState/UIActions instead of upstream `useModelCommand`.
     - Tools dialog (`useToolsDialog`), load profile (`useLoadProfileDialog`), workspace migration (`useWorkspaceMigration`), todo panel state (`useTodoContext`), todo pause controller (`TodoPausePreserver`).
     - Token metrics tracker: copy logic around history service polling (`historyTokenCleanupRef`, `lastHistoryServiceRef`) and `updateHistoryTokenCount`.
     - Memory refresh: replace upstream memory refresh with `loadHierarchicalLlxprtMemory` from `../config/config.js` plus `setLlxprtMdFileCount` on config.
     - Runtime/tool: keep `ToolCallProvider` API; keep `cancelOngoingRequest` wiring in Ctrl+C handling (from old `useGeminiStream`).
     - Auto-accept indicator (`useAutoAcceptIndicator`) and tool batching flags.
     - OAuth wiring: global `__oauth_add_item`, `globalOAuthUI.setAddItem`, `validateAuthMethod` usage from old App.tsx.
     - IDE trust listener / restart prompt: use llxprt `useIdeTrustListener(config)` with `setShowIdeRestartPrompt`.
     - History/static refresh: `useStaticHistoryRefresh`, `useHistory` integration as in llxprt.
   - Keep Ctrl+C/D guard: in AppContainer’s `handleGlobalKeypress`, before double-tap exit, return if `isAuthenticating` (from `useAuthCommand`).

4) **Port llxprt actions into UIActions (code mapping)**
   - Add to `uiActions`:
     - Provider/model dialog actions from `useProviderDialog` / `useProviderModelDialog`.
     - Tools dialog open/close and selection handlers from `useToolsDialog`.
     - Load profile, workspace migration actions.
     - Memory refresh action calling `loadHierarchicalLlxprtMemory` and setting config counts.
     - Slash command processor: swap upstream slash commands with llxprt `useSlashCommandProcessor` set; ensure `/model` (llxprt version) retained; keep `/quit` for Ctrl+C/D.
     - Auth actions from llxprt `useAuthCommand` (supports external auth & OAuth UI).
     - Auto-accept indicator toggles and tool batching actions if any.

5) **Rendering/layout integration (code adjustments)**
   - `DefaultAppLayout.tsx`: keep `ref={uiState.rootUiRef}`. Ensure `MainContent`, `Notifications`, `DialogManager`, `Composer`, `ExitWarning` imports use llxprt components if they differ; otherwise copy upstream versions.
   - `Composer.tsx`: back with llxprt input pipeline: use llxprt `useTextBuffer`, slash command processor, prompt rendering, suggestions; ensure Vim/Kitty integration is preserved.
   - `DialogManager.tsx`: include llxprt dialogs: provider/model/tools/load profile/workspace migration, todo dialogs, folder trust, permissions, auth, settings, theme, IDE prompts, quota, custom.
   - Width calc: choose `calculateMainAreaWidth` (upstream) or keep llxprt `useResponsive`; delete the other to avoid drift; set `mainAreaWidth` in UIState accordingly.
   - `useFlickerDetector`: wire `rootUiRef` and `terminalHeight`; ensure `constrainHeight` initial value matches llxprt behavior (previously true).

6) **Core integration fixes (code swaps)**
   - Extension manager: use llxprt consent/update wiring; swap upstream `requestConsentInteractive` with llxprt consent dialog.
   - Banners: remove Gemini promo text; use neutral copy or config-provided banners.
   - Model default: remove `DEFAULT_GEMINI_FLASH_MODEL`; use `config.getModel()` or runtime active model; update `getEffectiveModel` accordingly.
   - Telemetry hooks: if `recordExitFail` / `recordFlickerFrame` not present in llxprt, either import from llxprt logger or create no-op wrappers.
   - Alternate buffer: if llxprt lacks `useAlternateBuffer`, keep upstream hook and ensure it reads from llxprt terminal buffering logic (or stub always false if unsupported).

7) **Shim/retire old components (code updates)**
   - Update components that consumed props from old App to use `useUIState`/`useUIActions` (History, Footer, Header, token stats, todo panel, provider/model dialogs, settings/theme/auth dialogs). Replace prop drilling with context calls.
   - Keep `AppWrapper` export signature; internally render new AppContainer.
   - Retire `SessionController` once history/session state is unified; or leave as thin wrapper during transition and later remove its context in favor of UIState.

8) **Testing and proof of flicker fix**
   - Tests to add/adjust:
     - `useFlickerDetector` unit: mock `measureElement` to exceed `terminalHeight` when `constrainHeight` true; assert `AppEvent.Flicker` emitted (spy).
     - Ctrl+C/D double-tap flow: when `isAuthenticating` true, ensure no exit; when false, second tap triggers `/quit`; first tap cancels ongoing request.
     - Dialog switching: when `dialogsVisible` true, `DefaultAppLayout` renders `DialogManager`; when false, `Composer`.
     - Provider/model/tools/load profile/workspace migration dialogs: actions open/close and mutate UIState.
     - Token metrics tracker: history service emits `tokensUpdated` → session stats updated.
   - Manual: reproduce #456 flicker with narrow terminal and dialogs; verify `recordFlickerFrame` not firing and no redraw flicker.
   - Run AGENTS checklist: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "just say hi"`.

## Deliverables
- AppContainer/UIStateContext architecture in place with llxprt feature parity.
- Flicker detector active on the root layout, stopping redraw flicker (#456).
- Updated components/hooks wired to the new contexts; tests covering new behavior and existing llxprt flows.

## llxprt deltas to preserve
- Multi-provider: provider/model dialogs (`useProviderDialog`, `useProviderModelDialog`), `/model` slash command, RuntimeContextProvider, multi-provider status footer.
- Tooling: ToolCallProvider, token metrics tracker, tool batching/auto-accept indicator, tools dialog, load profile dialog, workspace migration dialog, todo panel + pause preserver.
- Input stack: Vim mode, Kitty protocol, bracketed paste, KeypressProvider, double-tap exit with authentication guard (don’t exit while authenticating), debug keystroke logging.
- Auth/trust: folder trust dialog, include-dirs trust, OAuth addItem wiring, external auth, settings/theme dialogs, privacy notice, load profile/tools dialogs.
- IDE: IDE nudge/restart prompt, IDE trust listener, IDE context status, Zed/IDE companion compatibility.
- Misc: memory monitor (LLXPRT.md), session stats, git branch, history token publisher, static history refresh, banners, token metrics, workspace migration, static history refresh hook.

## Concrete migration steps (do in order)
1) **Add upstream files with llxprt imports fixed**
   - Copy into `packages/cli/src/ui/`: `AppContainer.tsx`, `App.tsx` (overwriting existing layout selector), `contexts/UIStateContext.tsx`, `contexts/UIActionsContext.tsx`, `contexts/ConfigContext.tsx`, `contexts/AppContext.tsx`, `contexts/ShellFocusContext.tsx`, `layouts/DefaultAppLayout.tsx`, `layouts/ScreenReaderAppLayout.tsx`, `components/Composer.tsx`, `DialogManager.tsx`, `Notifications.tsx`, `CopyModeWarning.tsx`, `ExitWarning.tsx`, `AlternateBufferQuittingDisplay.tsx`, `hooks/useFlickerDetector.ts`, `hooks/useAlternateBuffer.ts`, `utils/ui-sizing.ts`, and any hook files the copied AppContainer references that don’t exist locally (`useMessageQueue`, `useConfirmUpdateRequests`, `useExtensionUpdates`, `useSessionResume`, `useIncludeDirsTrust`, `useQuotaAndFallback`, `useModelCommand`, `useIncludeDirsTrust`, `useAlternateBuffer`).
   - Replace imports: `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`; `getAllGeminiMdFilenames` → `getAllLlxprtMdFilenames`; `DEFAULT_GEMINI_FLASH_MODEL` → llxprt default model (or keep config model); `recordFlickerFrame`, `recordExitFail`, `refreshServerHierarchicalMemory` → map to llxprt equivalents (`loadHierarchicalLlxprtMemory`, token metrics tracker, etc.).
   - Keep upstream `App.tsx` layout-only version; move the current llxprt monolithic `App.tsx` logic into AppContainer state/actions (below).

2) **Wrap providers correctly**
   - Outer shell remains llxprt: `KeypressProvider` (Kitty/Vim), `SessionStatsProvider`, `VimModeProvider`, `ToolCallProvider`, `TodoProvider`, `RuntimeContextProvider`, `OverflowProvider` if used, `TodoPausePreserver`.
   - Inside outer providers, render new `AppContainer` (with props config/settings/version). Inside it, upstream contexts (`UIStateContext`, `UIActionsContext`, `ConfigContext`, `AppContext`, `ShellFocusContext`) are provided by AppContainer itself.
   - Non-interactive CLI remains untouched.

3) **Port llxprt state into UIState**
   - From old `App.tsx`, move these into AppContainer’s state build:
     - Provider/model dialogs: integrate `useProviderDialog`/`useProviderModelDialog` in place of upstream `useModelCommand`; expose open/close flags, selections in UIState.
     - Tools dialog (`useToolsDialog`), load profile dialog (`useLoadProfileDialog`), workspace migration dialog (`useWorkspaceMigration`), todo panel visibility (`useTodoContext`), todo pause controller (`TodoPausePreserver`).
     - Token metrics tracker (`tokenMetricsTracker.toTokenMetricsSnapshot`) and history token publisher: keep polling history service and publish to session stats.
     - Memory monitor: switch upstream `refreshServerHierarchicalMemory` to llxprt `loadHierarchicalLlxprtMemory` and file count setter.
     - Runtime/tool pipelines: keep `ToolCallProvider` state, cancel callback for Ctrl+C handling.
     - Auto-accept indicator/tool batching flags.
     - OAuth addItem wiring (`globalOAuthUI`, `__oauth_add_item`), validateAuthMethod from llxprt.
     - Workspace trust: `useFolderTrust(settings, config)` plus include-dirs trust hook.
     - IDE trust listener/restart prompt + IDE context display using llxprt RuntimeContext.
     - Git branch name hook, history token refresh, static history refresh hook.
   - Ensure Ctrl+C/D logic keeps llxprt’s “block exit while authenticating” guard.

4) **Port llxprt actions into UIActions**
   - Keep dialog open/close handlers for provider/model/tools/load profile/workspace migration/settings/theme/auth/privacy/trust.
   - Auth actions: use llxprt `useAuthCommand` (external auth, OAuth UI); ensure `handleAuthSelect`, `handleApiKeySubmit`, `handleApiKeyCancel` follow llxprt behavior (no Gemini-only flows).
   - Provider/model selection: actions call runtime APIs and update UIState.
   - Tool dialogs: enable/disable tool actions route through llxprt ToolCallProvider/batching.
   - Memory refresh action: call `loadHierarchicalLlxprtMemory` and set counts on Config.
   - Slash command processor: use llxprt command set (including `/model`, `/provider`, `/tools`, etc.); keep `/quit` semantics used by Ctrl+C/D.

5) **Rendering/layout integration**
   - Reuse upstream `DefaultAppLayout` but ensure components it renders (`MainContent`, `Notifications`, `DialogManager`, `Composer`, `ExitWarning`) import llxprt variants where they differ; if components are missing locally, copy upstream versions and adapt imports/behavior.
   - Attach `ref={uiState.rootUiRef}` to layout root to enable `useFlickerDetector`.
   - Ensure `mainAreaWidth` computation uses upstream `calculateMainAreaWidth` unless llxprt `useResponsive` is needed; pick one and remove duplicate to avoid mismatch.
   - Confirm `DialogManager` shows llxprt dialogs set (provider/model/tools/load profile/workspace migration/todo/trust/auth/permissions/IDE prompts/etc.).
   - Ensure `Composer` drives llxprt input prompt, suggestions, status, and honors Vim/Kitty buffer integration.

6) **Core integration fixes while porting**
   - Replace upstream `ExtensionManager` consent/update wiring with llxprt extension manager and consent dialogs.
   - Replace banner text (Gemini promotional copy) with llxprt-neutral text or config-based banners.
   - Model defaults: remove `DEFAULT_GEMINI_FLASH_MODEL`; use current provider/model from llxprt config/runtime.
   - Repoint `recordExitFail`/telemetry hooks to llxprt equivalents or no-op if absent.
   - Ensure `useAlternateBuffer` detection works in llxprt; if missing, vendor upstream hook and connect to existing alternate buffer logic (if any).

7) **Shim existing components**
   - Update llxprt components that read props from old App to instead read `useUIState`/`useUIActions` (History display, Footer, Header, token stats, todo panel, provider/model dialogs, settings/theme/auth dialogs).
   - Keep `AppWrapper` export stable for IDE companion; it should render new AppContainer internally.
   - Keep `SessionController` only if needed during transition; otherwise retire once history/state is unified in AppContainer.

8) **Testing and proof of flicker fix**
   - Update tests: `App.test.tsx`, `App.e2e.test.tsx`, `App.quittingMessages.test.ts`, `SessionController.test.tsx`, plus new tests for:
     - `useFlickerDetector` emitting `AppEvent.Flicker` when measured height > terminal height and `constrainHeight` true.
     - Ctrl+C/D double-tap with auth guard and buffer-not-empty guard.
     - Dialogs visibility and Composer switching.
     - Provider/model/tools/load profile/workspace migration dialogs via UIActions.
     - Token metrics updates and history token polling.
   - Manually reproduce #456 flicker scenario (narrow terminal with dialogs and long output) pre/post and capture that `recordFlickerFrame` is not firing after migration.
   - Run full AGENTS checklist: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "just say hi"`.

## Deliverables
- AppContainer/UIStateContext architecture in place with llxprt feature parity.
- Flicker detector active on the root layout, stopping redraw flicker (#456).
- Updated components/hooks wired to the new contexts; tests covering new behavior and existing llxprt flows.
