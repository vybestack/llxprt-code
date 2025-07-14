# Phase 04a – Verification of Session Controller Logic (react-improve)

## Verification Steps

1. `npm ci`
2. `npm run build`
3. `npm run test -t "SessionController"` – all new tests must pass.
4. Grep `packages/cli/src/ui/containers/SessionController.tsx` for `NotYetImplemented` – MUST return no matches.
5. Grep `packages/cli/src/ui/App.tsx` to confirm `<SessionController>` is imported from `containers/SessionController`.
6. Ensure all check-boxes in `project-plans/react-improve/04-session-controller-logic.md` are ticked.

## Outcome

Output `✅` if every step passes, otherwise list each failure prefixed with `❌`.
