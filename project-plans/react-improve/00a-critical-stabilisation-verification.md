# Phase 00a – Verification of Critical Stabilisation (react-improve)

The verifier **MUST** be run by an autonomous Gemini worker (provider = openai, model = o3) in non-interactive mode (`-y`).  
The worker must append its findings to `reports/react-improve/phase00-verify.md` and finish with either `### PASS` or `### FAIL`.

## Verification Steps

1. **Install deps & build:**

   ```bash
   npm ci
   npm run build
   ```

   Both commands must exit with code 0.

2. **Lint check:**

   ```bash
   npm run lint
   ```

   Must exit 0 with **no** ESLint errors or warnings.

3. **Search for infinite-loop patterns fixed in Phase 00**
   - There must be **no** `useEffect(` calls **without** a dependency array.
     ```bash
     grep -R "useEffect(\\s*=>" packages/cli/src | wc -l
     ```
     Output should be `0`.
   - File `packages/cli/src/ui/utils/renderLoopDetector.ts` must either be removed or contain no state-changing side-effects (only refs & logs).
   - In `App.tsx` there must be **no** in-render mutations of arrays (`.push(`, `.splice(`, direct assignment).

4. **Render count sanity test:**
   ```bash
   npm run test -- --run "render-loop-regression"
   ```
   The vitest labelled _render-loop-regression_ (added in Phase 00) must pass.

## Outcome

After executing all steps, write a short markdown snippet to `reports/react-improve/phase00-verify.md`:

_Example PASS section_

```
### PASS
- build ✓
- lint ✓
- no orphan useEffects ✓ (0 found)
- render-loop regression test ✓
```

_Example FAIL section_

```
### FAIL
- lint produced 14 warnings (see log)
```

If **any** step fails, mark the outcome as `### FAIL` and include bullet points of each failure.
