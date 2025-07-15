# Phase 00 – Critical Stabilisation (react-improve)

> **STOP.** Complete ONLY the tasks in _this_ file, tick every box in **Checklist (implementer)**, write the required progress report, then stop. Wait for Phase 00a verification before moving on.

## Goal

Eliminate the most frequent "Maximum update depth exceeded" crashes so the code-base builds and the CLI can run while deeper refactors land later.

## Scope (self-contained)

1. **Remove / neutralise dev helper that triggers loops**  
   • Comment out or delete all calls to `useRenderLoopDetector` & `useWhyDidYouRender`.  
   • Export the hooks as empty no-op functions in _ui/utils/renderLoopDetector.ts_ so imports remain valid.
2. **Patch effects missing dependency arrays**  
   • `useSlashCommandProcessor.ts` – ensure the effect that copies refs into state has `[]` dependency array OR guard inside effect to avoid `setState` on every render.  
   • `useReactToolScheduler.ts` – same treatment.
3. **Stop array mutation in render**  
   • In _App.tsx_ replace `pendingHistoryItems.push(...)` / direct mutations with creation of new arrays (spread) **outside render loops**. Guard with `useMemo` where needed.
4. **Stabilise CoreToolScheduler memo**  
   • Convert unstable `useMemo(() => new Scheduler(), [])` to `useRef` that initialises the scheduler once.
5. **NO new architecture** – limit edits to the four files above plus optional imports. No tests added in this phase.
6. **Reporting** – at startup write progress log to **reports/react-improve/phase00-worker.md**, append for every action/error/finding, and finish with a single line `### DONE`.

## Deliverables

- Patched source files compile & unit tests pass.
- _ui/utils/renderLoopDetector.ts_ now exports no-op stubs.
- Progress report `reports/react-improve/phase00-worker.md` ending with `### DONE`.

## Checklist (implementer)

- [ ] Removed live calls to `useRenderLoopDetector` / `useWhyDidYouRender`.
- [ ] Added `[]` dep-arrays or equivalent guards to the two offending effects.
- [ ] Replaced in-render array mutation(s) with immutable updates.
- [ ] CoreToolScheduler initialised via `useRef` instead of unstable `useMemo`.
- [ ] Code builds: `npm run build` ↦ exit 0.
- [ ] All unit tests: `npm test` ↦ exit 0.
- [ ] Progress report exists and ends with `### DONE`.

## Self-verify (run locally)

```bash
npm ci
npm run build
npm test --silent
```

All commands must exit with status 0.

---

**STOP. Wait for Phase 00a verification.**
