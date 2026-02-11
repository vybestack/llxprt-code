# REIMPLEMENT: b1258dd5 — Context overflow prompt race condition fix

## Upstream Summary

Fixes a race condition where `onCancelSubmit(true)` (restore prompt) is called before `userMessages` state has been updated with the latest user message, causing the wrong prompt to be restored after a context overflow.

## What Upstream Changed

1. Add `pendingRestorePrompt` state: `useState(false)`
2. Modify `onCancelSubmit`:
   - If `shouldRestorePrompt` is true: set `pendingRestorePrompt = true` (defer)
   - If false: call `cancelHandlerRef.current(false)` immediately
3. Add `useEffect` that watches `[pendingRestorePrompt, userMessages, historyManager.history]`:
   - When `pendingRestorePrompt` is true AND the last history user message matches the last userMessage (state is synced), call `cancelHandlerRef.current(true)` and clear the flag
4. Add test for the race condition scenario

## LLxprt Differences

- LLxprt uses `inputHistoryStore.inputHistory` instead of `userMessages`
- LLxprt's cancel handler is `() => void` (will be updated by Batch 2 / b644f037 first)
- The `pendingRestorePrompt` pattern maps cleanly to LLxprt's architecture

## Dependencies

- **Batch 2 (b644f037) must be applied first** — this commit depends on the `shouldRestorePrompt` parameter

## Implementation Steps

1. **Read** current `packages/cli/src/ui/AppContainer.tsx` — verify b644f037 changes are present (cancelHandler has shouldRestorePrompt param)
2. **Add** `pendingRestorePrompt` state near other useState declarations
3. **Modify** `onCancelSubmit` callback:
   - If `shouldRestorePrompt` is true: `setPendingRestorePrompt(true)` (defer restoration)
   - If false or undefined: `cancelHandlerRef.current(false)` immediately
4. **Add** `useEffect` after the `onCancelSubmit` callback:
   - Dependencies: `[pendingRestorePrompt, inputHistoryStore.inputHistory, historyManager.history]`
   - When `pendingRestorePrompt` is true: check if last history user message matches last input history entry
   - If synced: call `cancelHandlerRef.current(true)` and `setPendingRestorePrompt(false)`
5. **Add test** in `AppContainer.test.tsx` for the race condition scenario:
   - Setup with initial history
   - Add new message to history
   - Call `onCancelSubmit(true)` before state syncs
   - Verify correct (new) prompt is eventually restored

## Branding: N/A

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```
