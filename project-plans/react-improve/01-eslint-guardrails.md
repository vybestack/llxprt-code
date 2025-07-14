# Phase 01 – ESLint guardrails (react-improve)

> **STOP.** Complete the tasks in _this_ file, tick every checkbox in **Checklist (implementer)**, write the required progress report, then stop. Do **not** continue to later phases.

## Goal

Introduce lint protections that catch unstable `useEffect`/`useCallback` dependency patterns and other anti-patterns that lead to render-loop bugs.

## Deliverables

- **package.json** – add `eslint-plugin-react-hooks` (devDependency) and ensure version `^4`.
- **eslint.config.js** – enable `plugin:react-hooks/recommended` and the custom rule `no-inline-deps` set to `error`.
- **eslint-rules/no-inline-deps.js** – custom rule that forbids array/object/function literals directly inside React Hook dependency arrays (initial implementation may `throw new Error('NotYetImplemented');`).
- **reports/react-improve/phase01-worker.md** – markdown report written by the worker _at startup_, updated on every action/error/finding, and ending with a final line `### DONE` when finished.

## Checklist (implementer)

- [x] Added **eslint-plugin-react-hooks** to devDependencies in _package.json_.
- [x] Updated _eslint.config.js_ to include `plugin:react-hooks/recommended`.
- [x] Implemented stub of **eslint-rules/no-inline-deps.js** and wired it in config.
- [x] `npm run lint` passes with zero errors or warnings.
- [x] Progress report `reports/react-improve/phase01-worker.md` exists and ends with `### DONE`.

## Self-verify

Run locally:

```bash
npm ci
npm run lint
```

Both commands must exit with code 0.

---

**STOP. Wait for Phase 01a verification.**
