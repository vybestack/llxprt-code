# Playbook: Refine Loading Indicator Action-Required and Focus-Hint Behavior for LLxprt

**Upstream SHA:** `304caa4e43a`
**Upstream Subject:** fix(cli): refine 'Action Required' indicator and focus hints (#16497)
**Upstream Stats:** UI/loading-indicator polish; small-to-moderate LLxprt adaptation

## What Upstream Does

Upstream improves the loading indicator when the app is blocked on user action. It refines the “Action Required” state, adjusts focus hints, and avoids misleading loading text when the model is not actually progressing. The overall intent is to make the waiting state clearer and more context-aware instead of relying on a generic UI state machine message.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this work **REIMPLEMENT** because LLxprt’s loading indicator state is wired differently from upstream.
2. The user explicitly called out that `usePhraseCycler.ts` already includes shell focus hints and waiting phrase handling.
3. In LLxprt today:
   - `packages/cli/src/ui/hooks/usePhraseCycler.ts` already emits `INTERACTIVE_SHELL_WAITING_PHRASE` and `Waiting for user confirmation...`.
   - `packages/cli/src/ui/hooks/useLoadingIndicator.ts` derives phrase/timer behavior from `StreamingState` rather than an upstream UI state machine.
   - `packages/cli/src/ui/components/LoadingIndicator.tsx` chooses between thought text, shell-focus hint text, and timer text using `StreamingContext` and the current loading phrase.
   - `packages/cli/src/ui/AppContainer.tsx` passes `isInteractiveShellWaiting` as `!!activeShellPtyId && !embeddedShellFocused` into `useLoadingIndicator()`.
4. Because LLxprt already has shell focus hints and waiting phrase handling, this batch must adapt to LLxprt’s existing state model rather than importing upstream UI state-machine concepts.
5. The execution goal is therefore to refine LLxprt’s loading-indicator wording/selection logic so “action required” states are clearer without fighting the current `StreamingState`, phrase cycler, or shell-focus flow.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/ui/hooks/usePhraseCycler.ts` — already includes waiting phrase handling and shell focus hint phrase
- [OK] `packages/cli/src/ui/hooks/useLoadingIndicator.ts` — current loading-indicator state adapter built on `StreamingState`
- [OK] `packages/cli/src/ui/components/LoadingIndicator.tsx` — current rendering logic for spinner, phrase, thought subject, and timer
- [OK] `packages/cli/src/ui/AppContainer.tsx` — supplies shell waiting inputs to `useLoadingIndicator()`
- [OK] `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` — consumes `currentLoadingPhrase` and renders `LoadingIndicator`
- [OK] `packages/cli/src/ui/hooks/usePhraseCycler.test.ts` — phrase-cycler coverage
- [OK] `packages/cli/src/ui/hooks/useLoadingIndicator.test.ts` — loading-indicator hook coverage

**Not the architecture to introduce:**
- No upstream-style UI state machine file should be added for this batch.

## Files to Modify/Create

### Modify: `packages/cli/src/ui/hooks/useLoadingIndicator.ts`
- Refine how LLxprt translates `StreamingState`, shell waiting, and retained elapsed time into a user-facing indicator state.
- If needed, return a small amount of additional derived state to distinguish generic waiting from explicit action-required waiting, but keep it grounded in current LLxprt inputs.
- Preserve the current timer-retention behavior across `Responding` → `WaitingForConfirmation` transitions.

### Modify: `packages/cli/src/ui/components/LoadingIndicator.tsx`
- Refine the displayed primary text so action-required states are clearer and do not get overridden incorrectly by unrelated thought text.
- Preserve LLxprt’s existing shell focus hint behavior for `INTERACTIVE_SHELL_WAITING_PHRASE`.
- Ensure timer text and wrapping/truncation still behave correctly for the chosen message.

### Maybe modify: `packages/cli/src/ui/hooks/usePhraseCycler.ts`
- Only if execution-time inspection shows wording/selection changes are best centralized there.
- Keep in mind the user’s instruction: `usePhraseCycler.ts` already includes shell focus hints and waiting phrase handling, so this file should only be touched surgically.

### Maybe modify tests:
- `packages/cli/src/ui/hooks/useLoadingIndicator.test.ts`
- `packages/cli/src/ui/hooks/usePhraseCycler.test.ts`
- `packages/cli/src/ui/components/LoadingIndicator` tests if present

## Preflight Checks

```bash
# Inspect current phrase-cycler waiting/focus-hint behavior
sed -n '1,220p' packages/cli/src/ui/hooks/usePhraseCycler.ts

# Inspect current loading-indicator state adapter
sed -n '1,220p' packages/cli/src/ui/hooks/useLoadingIndicator.ts

# Inspect current rendering logic
sed -n '1,220p' packages/cli/src/ui/components/LoadingIndicator.tsx

# Inspect where shell waiting is wired in from AppContainer
sed -n '1580,1605p' packages/cli/src/ui/AppContainer.tsx

# Review existing tests before changing behavior
sed -n '1,260p' packages/cli/src/ui/hooks/useLoadingIndicator.test.ts
sed -n '1,300p' packages/cli/src/ui/hooks/usePhraseCycler.test.ts
```

## Implementation Steps

1. Read `usePhraseCycler.ts`, `useLoadingIndicator.ts`, and `LoadingIndicator.tsx` together to understand the current LLxprt indicator flow end-to-end.
2. Identify all current “action required” situations expressible in LLxprt’s state model.
   - `StreamingState.WaitingForConfirmation`
   - interactive shell waiting with focus-hint messaging
   - any existing confirmation/dialog state already threaded into the loading indicator path
3. Decide the smallest LLxprt-native refinement point:
   - phrase selection in `usePhraseCycler`
   - state derivation in `useLoadingIndicator`
   - final display precedence in `LoadingIndicator`
4. Implement the wording/precedence refinement so that:
   - shell focus hints remain explicit and high-signal,
   - waiting-for-confirmation messaging reads as action-required rather than generic progress,
   - thought summaries do not mask action-required states when they should not.
5. Preserve the current `StreamingState`-driven timer behavior and avoid introducing an upstream-style parallel UI state machine.
6. Update targeted tests for the refined action-required and focus-hint behavior.
7. Run verification.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/cli/src/ui/hooks/useLoadingIndicator.test.ts
npm run test -- --reporter=verbose packages/cli/src/ui/hooks/usePhraseCycler.test.ts
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Key repo fact:** `usePhraseCycler.ts` already includes shell focus hints and waiting phrase handling.
- **Key repo fact:** loading-indicator work must adapt to LLxprt’s existing state model rather than upstream’s UI state machine.
- **Risk:** `LoadingIndicator.tsx` currently prefers `thought?.subject` over most phrases except the shell-focus hint. If action-required wording should take precedence, adjust that carefully without losing useful thought summaries during normal responding.
- **Risk:** over-editing `usePhraseCycler.ts` could regress existing shell hint timing or random phrase cycling. Keep changes surgical.
- **Risk:** `WaitingForConfirmation` currently suppresses the timer suffix in `LoadingIndicator.tsx`. Preserve or intentionally refine that behavior based on LLxprt’s current UX, not upstream defaults.
- **Do not** introduce a new UI state machine or upstream-only indicator components.
- **Do not** rename LLxprt’s existing `StreamingState` values or shell-focus constants.
- **Success criteria:** LLxprt displays clearer action-required/focus-hint messaging while preserving its current `StreamingState`-based architecture, existing shell waiting phrase logic, and naming conventions.
