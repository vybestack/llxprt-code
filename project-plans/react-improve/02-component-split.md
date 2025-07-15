# Phase 02 – Component Split Stubs (react-improve)

> **STOP.** Complete tasks below, tick every checkbox in **Checklist (implementer)**, update the progress report, then stop. Do **not** start Phase 03.

## Goal

Create skeletal components that will host the refactored logic, without changing existing behaviour.

## Deliverables

1. **packages/cli/src/ui/components/LayoutManager.tsx** – exports `<LayoutManager>` that currently renders `{children}` only and throws `NotYetImplemented` in `useEffect` placeholders.
2. **packages/cli/src/ui/containers/SessionController.tsx** – exports `<SessionController>` with stub reducer and context providers (logic `NotYetImplemented`).
3. **packages/cli/src/ui/containers/UIStateShell.tsx** – wraps `LayoutManager` and `SessionController`, passes props through; contains TODO comments.
4. **packages/cli/src/ui/App.tsx** – minimally modified to import & use `<UIStateShell>` and otherwise delegate.
5. **reports/react-improve/phase02-worker.md** – progress report written at startup, appended throughout; ends with `### DONE`.

## Checklist (implementer)

- [ ] New component files created with valid TypeScript, compile passes.
- [ ] App.tsx delegates to `UIStateShell` without changing runtime behaviour.
- [ ] `npm run build` succeeds.
- [ ] Progress report exists and ends with `### DONE`.

## Self-verify

```bash
npm ci
npm run build
```

Both must exit 0.

---

**STOP. Wait for Phase 02a verification.**
