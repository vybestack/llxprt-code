# AppContainer Alignment Report

## What upstream changed
- Gemini CLI refactored the top-level UI into an `AppContainer` + `UIStateContext` stack with a Composer/QueuedMessageDisplay pipeline. Several v0.6.1→v0.7.0 commits assume that structure (e.g., dialog handling keyed off `UIStateContext`).

## Where llxprt stands
- llxprt keeps a single root component (`packages/cli/src/ui/App.tsx`) wrapped by `AppWrapper`/`AppDispatchProvider` plus `RuntimeContext`, `ToolCallProvider`, `TodoProvider`, `SessionStatsProvider`, and `KeypressProvider`. It already implements Ctrl+C/Ctrl+D double-tap exit, dialog orchestration, multi-provider model dialogs, Vim mode, Kitty keyboard protocol, and trust/auth flows without `AppContainer`.
- `packages/cli/src/ui/containers/SessionController.tsx` and `UIStateShell.tsx` provide history/session state wiring; there is no `AppContainer` or `UIStateContext`.
- We explicitly removed upstream Composer/AppContainer artifacts in `899b438e0` (“drop unused composer”), deleting `Composer.tsx`/`QueuedMessageDisplay.tsx` and reverting related tests. The codebase is now AppContainer-free.

## AppContainer-related cherry-picks encountered
- #34 `92c99d78` (QueuedMessageDisplay extract) was cherry-picked but then the resulting components were deleted in `899b438e0` because the upstream stack doesn’t exist here.
- #73 `e48f61bd` (Ctrl+C/D dialog handling) was skipped as “incompatible with AppContainer/UIStateContext.” Our `App.tsx` already handles Ctrl+C/Ctrl+D in `useKeypress` (double-tap exit with authentication guard), so the upstream change is unnecessary.
- No other pick-listed commits through v0.7.0 reference `AppContainer`; the remaining batches target extensions, trust, stream quality, model dialogs, permissions, and sandbox/deferred-init work.

## Options considered
- **Port upstream AppContainer wholesale:** High risk. Would require rewriting `App.tsx` (~2000 LOC) to mirror upstream UIStateContext/Composer plumbing and then re-layering llxprt-specific features (multi-provider dialogs, todo panel, tool batching, token metrics tracker, Vim/kitty input, workspace migration, IDE nudge, etc.). Likely to regress custom flows and slow the gmerge.
- **Reimplement upstream behaviors inside current App:** Low risk. For #73, our existing key handling already covers the intended behavior. Any future upstream fixes touching `AppContainer` can be ported as targeted changes on `App.tsx`/`SessionController.tsx` without introducing the upstream stack.
- **Do nothing and keep skipping AppContainer-only patches:** Viable given the pick list; only #73 is AppContainer-dependent and is already skipped.

## Recommendation
- Stay on the llxprt `App.tsx` architecture and **do not reintroduce AppContainer**. Apply upstream UI fixes case-by-case directly in `App.tsx`/related hooks when needed.
- Mark #73 as a firm skip in `project-plans/20251119gmerge/odc.md` to match the rationale already recorded in the pick list. No reimplementation is required unless we discover a Ctrl+C/D regression in our flow.
- When future upstream commits reference `AppContainer`/`UIStateContext`/`Composer`, treat them as “reimplement in App.tsx if the behavior is missing,” not as structural ports.
