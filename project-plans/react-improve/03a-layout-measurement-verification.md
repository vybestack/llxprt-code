# Phase 03a – Verification of Layout Measurement (react-improve)

## Verification Steps

1. Run `npm ci && npm run build` – build must pass.
2. Grep `packages/cli/src/ui/components/LayoutManager.tsx` for `measureElement` import and removal of `NotYetImplemented` stubs.
3. Execute `npm run test` – existing tests plus any new LayoutManager tests must pass.
4. Ensure `eslint` passes: `npm run lint` returns 0.
5. Confirm checklist in `03-layout-measurement.md` is fully ticked.
6. Open `reports/react-improve/phase03-worker.md` and assert it ends with line `### DONE`.

## Outcome

Emit exactly one of the following:

- `✅` – if all steps succeed.
- Or a list of `❌ Step <n> – <reason>` for each failed verification.
