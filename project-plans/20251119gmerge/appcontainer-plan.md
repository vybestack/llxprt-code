# AppContainer Migration Plan (step-by-step, research inlined)

Goal: adopt the upstream AppContainer/UIStateContext render architecture (includes flicker detector, composer/layout split) to stop redraw flicker (#456) while keeping llxprt features. This plan spells out exact files, mappings, and edits so it can be followed mechanically.

## Upstream architecture snapshot (from current upstream main)
- `packages/cli/src/ui/AppContainer.tsx`: builds all UI state/actions; wraps `App` with `UIStateContext`, `UIActionsContext`, `ConfigContext`, `AppContext`, `ShellFocusContext`. Handles Ctrl+C/D counters, copy-mode toggle, constrainHeight toggle, IDE status shortcut, shell focus toggle, and double-tap exit (Ctrl+C cancels requests; second tap `/quit`).
- `App.tsx`: chooses layouts based on screen reader/alternate buffer; renders `DefaultAppLayout` or `ScreenReaderAppLayout`; shows `QuittingDisplay` or `AlternateBufferQuittingDisplay` when quitting.
- `DefaultAppLayout.tsx`: root Box with `ref={uiState.rootUiRef}`; renders `MainContent`; below it `Notifications`, `CopyModeWarning`, `DialogManager` (when dialogs visible) or `Composer`; `ExitWarning`.
- `useFlickerDetector.ts`: `measureElement(rootUiRef)` vs terminal height; if overflow and `constrainHeight` is true, call `recordFlickerFrame(config)` and emit `AppEvent.Flicker`. Requires `rootUiRef`, `constrainHeight`, `terminalHeight`.
- `UIStateContext.tsx`: `UIState` shape includes history + historyManager, dialogs flags, auth state, buffer, widths, console messages, renderMarkdown, IDE/trust prompts, quota prompt, banners, copy mode, debug profiler, terminal sizes, refs, extensions update state, pending history, etc.
- `UIActionsContext.tsx`: actions for dialogs, auth selection/api key submit, folder trust select, refreshStatic, final submit/clear, quota choice, queue error, pop messages, banner visibility, embedded shell focus, Vim handler, escape prompt change.
- Layout support files: `Composer.tsx`, `DialogManager.tsx`, `Notifications.tsx`, `CopyModeWarning.tsx`, `ExitWarning.tsx`, `AlternateBufferQuittingDisplay.tsx`, `useAlternateBuffer.ts`, `utils/ui-sizing.ts`, `useMessageQueue`, `useConfirmUpdateRequests`, `useExtensionUpdates`, `useSessionResume`, `useIncludeDirsTrust`, `useQuotaAndFallback`, `useModelCommand`, etc.

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
