# Phase 05 – Reducer-based State & Context (react-improve)

> **STOP.** Complete tasks below, tick every checkbox in **Checklist (implementer)**, update the progress report, then stop. Do **not** begin Phase 06.

## Goal

Replace scattered `useState` in `SessionController` with a single reducer + context to centralise state updates and eliminate cross-coupled effects.

## Deliverables

1. **packages/cli/src/ui/contexts/SessionStateContext.tsx** – React context exporting `[state, dispatch]` with strict typing.
2. **packages/cli/src/ui/reducers/sessionReducer.ts** – pure reducer handling existing session actions (addItem, clearItems, setPaymentMode, etc.).
3. **packages/cli/src/ui/containers/SessionController.tsx** – now initialises reducer, provides context, removes previous `useState` hooks (may retain TODO for un-migrated pieces).
4. **reports/react-improve/phase05-worker.md** – progress report written/updated by worker ending with `### DONE`.

## Checklist (implementer)

- [x] Added reducer and context files with exhaustive `switch` on action.types.
- [x] Replaced old `useState` in `SessionController` with reducer logic.
- [x] All unit tests compile; `npm run test` passes current suite.
- [x] Progress report exists and ends with `### DONE`.

## Self-verify

```bash
npm ci
npm run test
npm run build
```

All commands must exit with status 0.

---

**STOP. Wait for Phase 05a verification.**
