# Phase 03 – Layout Measurement Logic (react-improve)

> **STOP.** Finish tasks, tick every checkbox, update report, then stop. Do **not** continue to Phase 04.

## Goal

Move all terminal size / footer-height measurement and constrain-height behaviour out of `App.tsx` into the new `LayoutManager` component while keeping existing runtime output identical.

## Deliverables

1. **packages/cli/src/ui/components/LayoutManager.tsx** – fully implemented measurement logic:
   - Tracks `terminalHeight`, `terminalWidth`, `footerHeight`, `constrainHeight`, `availableTerminalHeight`.
   - Exposes these via a new React Context `LayoutContext` (exported from same file).
   - Removes all measurement code from `App.tsx`.
2. **packages/cli/src/ui/components/LayoutContext.tsx** – (if extracted) context definition & hook `useLayout()`.
3. **packages/cli/src/ui/components/**tests**/LayoutManager.test.tsx** – Vitest ensuring context values change on resize.
4. **reports/react-improve/phase03-worker.md** – report with `### DONE` at end.

## Checklist (implementer)

- [x] Measurement & resize logic implemented in `LayoutManager`.
- [x] `App.tsx` no longer contains `measureElement`, `setFooterHeight`, or resize effects.
- [x] All existing tests pass; new tests added.
- [x] `npm run preflight` passes.
- [x] Progress report ends with `### DONE`.

## Self-verify

```bash
npm ci
npm run preflight
```

All green.

---

**STOP. Wait for Phase 03a verification.**
