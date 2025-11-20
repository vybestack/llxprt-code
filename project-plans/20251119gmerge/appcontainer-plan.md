# AppContainer Migration Plan (llxprt → upstream architecture)

## Objective
Adopt the upstream AppContainer/UIStateContext layout (the architecture Gemini CLI used to stop redraw flicker per llxprt issue #456 and upstream discussions) while preserving all llxprt-specific behaviors. Goal: eliminate redraw flicker and align with upstream rendering model without regressing multi-provider, trust, tooling, or IDE flows.

## References to study before coding
- Upstream `packages/cli/src/ui/AppContainer.tsx`, `UIStateContext.tsx`, `LayoutManager`, and any recent flicker fixes tied to that stack (search upstream issues/PRs around dialog/input flicker and Ctrl+C/D handling).
- Upstream commit(s) that introduced AppContainer + flicker fixes (likely around the Composer/QueuedMessageDisplay refactor).
- llxprt issue #456 for symptoms and acceptance criteria.
- llxprt-specific UI layers to preserve: `App.tsx`, `SessionController.tsx`, `UIStateShell.tsx`, `AppWrapper` provider stack, and custom hooks/contexts (Vim, Kitty protocol, RuntimeContext, token metrics tracker, todo panel, multi-provider dialogs, workspace migration, IDE nudge, folder trust/auth flows).

## Migration approach
1) **Baseline capture**
   - Pull the upstream AppContainer/UIStateContext files at the target tag (v0.7.0 ancestry) and list their dependencies (state contexts, reducers, hooks).
   - Inventory llxprt-only features and where they live in `App.tsx` (keyboard handling, multi-provider dialogs, tool batching, memory load hooks, todo panel, token metrics, workspace migration, IDE nudge/restart prompts, OAuth addItem wiring, Vim/Kitty input wrappers, runtime/tool-call providers).

2) **Design the integration**
   - Decide where llxprt providers wrap/fit into the upstream tree (e.g., keep `AppWrapper`/`KeypressProvider` outermost, nest new `AppContainer` inside with llxprt’s `RuntimeContextProvider`, `ToolCallProvider`, `TodoProvider`, `SessionStatsProvider`, `VimModeProvider`, `KeypressProvider`, etc.).
   - Map upstream UIStateContext/app state to llxprt reducers: identify which parts can replace `appReducer` and which llxprt state must stay (e.g., tool description toggles, auth dialog flags, provider/model dialogs).
   - Plan event/keypress handling: merge upstream flicker-safe input handling with llxprt’s `useKeypress`, Vim/Kitty, and Ctrl+C/D double-tap exit logic.

3) **Incremental implementation steps**
   - Introduce upstream AppContainer/UIStateContext files and wire them behind a feature branch without removing `App.tsx` yet.
   - Create a compatibility adapter so upstream AppContainer renders llxprt’s main UI body (initially the existing `App` tree) while we migrate state consumers to the new contexts.
   - Gradually move llxprt-specific state slices into the new container/context (or bridge into it) to avoid dual sources of truth.
   - Rehome flicker fixes: ensure the redraw optimization (upstream change that gated rerenders) is active in the new stack; remove redundant llxprt workarounds once verified.
   - Clean out old Composer/QueuedMessageDisplay deletions only after the new stack fully replaces them (or stub equivalents if upstream expects them).

4) **Feature parity checklist (must stay working)**
   - Multi-provider dialogs (`useProviderDialog`, `useProviderModelDialog`, `/model` slash command path), token metrics tracking, todo panel + pause preserver, tool batching/ToolCallProvider, OAuth addItem wiring, workspace migration dialog, IDE nudge/restart prompt, Vim mode + Kitty protocol + bracketed paste, folder trust/auth dialogs, Settings/Theme dialogs, load profile/tools dialogs, static history refresh, history token publishing, Git branch display, memory monitor, session stats, non-interactive UI behaviors.

5) **Testing & verification**
   - Update/port tests: `App.test.tsx`, `App.e2e.test.tsx`, `App.quittingMessages.test.ts`, container/context tests, plus new tests mirroring upstream UIStateContext/AppContainer behavior and flicker-fix expectations.
   - Run full llxprt verification sequence after each major merge: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "just say hi"`.
   - Capture a narrow terminal flicker repro (from #456) before/after to confirm the flicker is fixed.

## Risks & mitigations
- **State divergence/duplicate reducers:** avoid running `appReducer` and upstream UIStateContext in parallel; plan a controlled migration with adapters.
- **Input handling regressions:** carefully merge upstream’s flicker-safe input handling with Vim/Kitty/double-tap exit; add regression tests for Ctrl+C/D, auth-in-progress, and buffer-not-empty cases.
- **Provider/memory flows:** ensure RuntimeContext/Config interactions remain intact when AppContainer owns render loop; add smoke tests for provider selection and memory refresh.

## Deliverables
- New AppContainer/UIStateContext wired in place of the monolithic `App.tsx` render path, with llxprt features preserved.
- Updated tests and docs (plan/odc notes) confirming flicker fix and parity.
