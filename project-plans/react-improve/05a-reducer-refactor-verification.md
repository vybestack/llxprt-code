# Phase 05a – Verification of Reducer Refactor (react-improve)

## Verification Steps

1. Run full build & tests:
   ```bash
   npm ci
   npm run preflight
   ```
2. Grep that new context/reducer files exist:
   ```bash
   test -f packages/cli/src/ui/contexts/SessionStateContext.ts || exit 1
   ```
3. Ensure `UIStateShell` and descendant components consume context, not props:
   ```bash
   grep -R "createContext(" packages/cli/src/ui/contexts | grep SessionStateContext
   ```
4. Confirm no state setter props are passed through `UIStateShell`:
   ```bash
   ! grep -R "set[A-Z]" packages/cli/src/ui/containers/UIStateShell.tsx
   ```
5. Ensure progress report `reports/react-improve/phase05-worker.md` ends with `### DONE` and all checklist boxes in `05-reducer-refactor.md` are ticked.

## Outcome

Emit `✅` if all steps succeed, otherwise list each failed step prefixed with `❌`.
