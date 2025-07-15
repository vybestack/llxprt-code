# Phase 06 – Dispatch-based State & Callback Removal (react-improve)

> **STOP.** Finish tasks below, tick every box in **Checklist (implementer)**, update the progress report, then stop. Do **not** start Phase 07.

## Goal

Replace imperative callback props (`addItem`, `openThemeDialog`, etc.) with a reducer/dispatch pattern so data flow is unidirectional and effects are easier to reason about.

## Deliverables

1. **packages/cli/src/ui/contexts/AppDispatchContext.tsx** – React context exporting `dispatch` function typed with `AppAction` union.
2. **packages/cli/src/ui/reducers/appReducer.ts** – initial reducer handling `ADD_ITEM`, `OPEN_DIALOG`, `CLOSE_DIALOG`, `SET_WARNING`, `CLEAR_WARNING` actions (real logic, no stubs).
3. Update **SessionController.tsx** to own the reducer and provide `dispatch` via `AppDispatchContext`.
4. Refactor `UIStateShell` and any direct children (`LayoutManager`, dialogs) to consume `dispatch` instead of callback props for at least `addItem` and dialog open/close.
5. **reports/react-improve/phase06-worker.md** – report written at startup, appended on every change/error, ending with `### DONE`.

## Checklist (implementer)

- [ ] Created and exported `AppDispatchContext`.
- [ ] Implemented `appReducer` with coverage for the listed actions.
- [ ] SessionController wires `dispatch` + derives state.
- [ ] Replaced at least `addItem` + theme/auth dialog open pathways with dispatches.
- [ ] `npm run build && npm run test` succeed.
- [ ] Progress report ends with `### DONE`.

## Self-verify

```bash
npm ci
npm run build
npm run test -- -t "(SessionController|appReducer)"
```

All exit codes must be 0.

---

**STOP. Wait for Phase 06a verification.**
