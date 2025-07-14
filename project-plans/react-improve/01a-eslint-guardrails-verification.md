# Phase 01a – Verification of ESLint Guardrails (react-improve)

## Verification Steps

1. Run `npm ci` to install dependencies exactly as locked.
2. Execute `npm run lint`.
3. Confirm exit code is 0 and stderr contains no warnings.
4. `grep -q "no-inline-dep" eslint.config.js` – ensure custom rule is registered.
5. Ensure `package.json` includes `eslint-plugin-react-hooks` in `devDependencies`.
6. Inspect `/reports/react-improve/phase01-worker.md`:
   - Must exist.
   - Must contain the sentinel line `### DONE`.
   - Must include at least one "File changed:" entry.
7. Open `project-plans/react-improve/01-eslint-guardrails.md` and verify all checklist items are ticked (`[x]`).

## Outcome

If **all** steps pass, append to `/reports/react-improve/phase01-verify.md` the single line:

```
✅ Phase 01 passed
```

Otherwise append lines starting with `❌` describing each failed check and exit with non-zero status.
