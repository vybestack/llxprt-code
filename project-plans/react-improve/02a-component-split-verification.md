# Phase 02a – Verification of Component Split Stubs (react-improve)

## Verification Steps

1. Run `npm ci` (should install without errors).
2. Run `npm run build` (must compile successfully).
3. Verify new files exist:
   - `packages/cli/src/ui/components/LayoutManager.tsx`
   - `packages/cli/src/ui/containers/SessionController.tsx`
   - `packages/cli/src/ui/containers/UIStateShell.tsx`
4. Grep each new file for `NotYetImplemented` (should be present).
5. Ensure `packages/cli/src/ui/App.tsx` imports and renders `<UIStateShell>`.
6. Check **project-plans/react-improve/02-component-split.md** – all checklist boxes are ticked (`[x]`).
7. Confirm report `reports/react-improve/phase02-worker.md` exists and ends with the literal line `### DONE`.

## Outcome

Emit `✅` if every step passes, otherwise list each failed step prefixed with `❌`.
