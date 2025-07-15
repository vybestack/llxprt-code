# Phase 04 – SessionController Logic (react-improve)

> **STOP.** Perform the tasks below, tick every box in **Checklist (implementer)**, update the report, then stop. Do **not** start Phase 05.

## Goal

Port history management, provider/quota switching, and memory-refresh logic from `App.tsx` into the new `SessionController` container without altering visible behaviour.

## Deliverables

1. **packages/cli/src/ui/containers/SessionController.tsx** –
   - Implements internal reducer(s) for history + provider state.
   - Exposes React context(s) for child components.
   - Migrates `useHistory`, provider payment-mode change detection, Flash fallback handler, and memory-refresh logic.
2. **packages/cli/src/ui/hooks/useSession.ts** – convenience hook consuming the context.
3. **unit tests** at `packages/cli/src/ui/containers/SessionController.test.tsx` covering:
   - adding / clearing history items
   - provider switch triggers payment-mode banner event
4. **reports/react-improve/phase04-worker.md** – progress report created at startup, appended per action; ends with `### DONE`.

## Checklist (implementer)

- [x] `SessionController` now owns history and provider state.
- [x] `App.tsx` no longer imports `useHistory` directly.
- [x] All moved code passes existing unit tests.
- [x] New unit tests written and green.
- [x] `npm run test` & `npm run build` succeed.
- [x] Progress report ends with `### DONE`.

## Self-verify

```bash
npm ci
npm run test -- -t "SessionController"
npm run build
```

All commands must exit 0.

---

**STOP. Wait for Phase 04a verification.**
