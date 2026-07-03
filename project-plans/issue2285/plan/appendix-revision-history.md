# Appendix: Historical Revision History

> **Purpose (architect review finding 11):** this appendix consolidates
> historical rationale and prior-approach decision history so executable
> phase instructions can remain focused on current requirements. Phase files
> reference this appendix where historical context is needed but should not
> clutter executable instructions. This file is NOT an executable phase — it
> is a reference document. Workers execute the CURRENT instructions in each
> phase file; this appendix explains why prior approaches were revised.

## Revision 1–3 Summary

- **Revision 1**: initial plan creation with phases P00–P13a.
- **Revision 2 findings 1–10**: P04a verification commands no longer mask
  test failures with `|| true`. Guard-failure proofs use fixture/temp-directory
  based proofs (no production source mutation). P06 no longer commits
  skipped/guarded tests — provides an executable isolated characterization
  proof. P03/P05 no longer embed `npm run build` inside the Vitest lifecycle
  (standalone API-surface script). P04 A2A behavior-test requirements made
  precise. P08 single-source path produces an executable structural typecheck
  proof. P13a mechanically fails if tracker has unchecked items. Grep
  verification commands converted to exact pass/fail assertions. OCR workflow
  includes an executable preview gate.
- **Revision 3 findings 12–24**: runtime factory verification BRANCHES on the
  recorded decision (single-source vs retained-duplication). Characterization
  tests GREEN unchanged after split (P11-baseline hash comparison). Stale
  `cliSessionDispatch` reference check is FAIL-CLOSED. Per-phase structured
  diff evidence in completion markers.

## Revision 4 Architect Findings

- **Finding 1**: API-surface guard wired into GitHub CI (explicit step in
  `.github/workflows/ci.yml`).
- **Finding 2**: report path under `node_modules/.cache/agents-api-surface/`
  (already gitignored, NOT in `packages/agents/src/api/__tests__/`).
- **Finding 3**: standalone API guard build uses temp tsconfig extending
  SOURCE-path `packages/agents/tsconfig.json` (NOT `tsconfig.build.json`).
- **Finding 4**: P04 A2A behavior test files explicitly listed in Files to
  Create.
- **Finding 5**: P08/P08a branch on recorded decision (single-source vs
  retained-duplication).
- **Finding 6**: P08 single-source proof strengthened to prove actual target
  core module.
- **Finding 7**: P13 format runs FIRST, then before-suite git status snapshot.
- **Finding 8**: API guard CI inclusion verified via `.github/workflows/ci.yml`.
- **Finding 9**: NO `@plan`/`@requirement` markers in executable scripts
  (including `scripts/check-agents-api-surface.mjs`). Markers restricted to
  test files and plan artifacts only.
- **Finding 10**: P01 temp-tsconfig proof uses pwd-derived absolute paths.
- **Finding 11**: P06 lists `scripts/tests/cli-import-boundary.test.js` in
  Files to Modify.
- **Finding 12**: guard test fails in CI (`CI=true`) when report absent;
  local skip only under `LLXPRT_API_SURFACE_SKIP=1`.

## Revision 5 Architect Findings

- **Finding 1**: `apiSurfaceParser.mjs` reclassified as executable ESM helper
  (marker-free).
- **Finding 2**: guard test made consistently fail-closed (NEVER silently
  skips).
- **Finding 3**: rootDir fallback for temp tsconfig (B1/B1a/B1b/B2).
- **Finding 4**: P08 single-source proof uses disposable full-repo worktree.
- **Finding 5**: `runtime-factory-single-source-proof.mjs` marker-free.
- **Finding 6**: P13/P13a status-diff filters all expected generated outputs.
- **Finding 7**: P06 renamed to "Current-Behavior Characterization Proof".

## Revision 6 Architect Findings

- **Finding 1**: P01 B1a-fallback control-flow bug fixed (MECHANISM variable +
  if/else).
- **Finding 2**: P01 rootDir detection captures both stdout AND stderr.
- **Finding 3**: P03 parser `.js`-to-`.d.ts` specifier normalization.
- **Finding 4**: P08/P08a drift proof EXECUTES perturbation assertions.
- **Finding 5**: P08 decision-dependent artifact set (`PROOF_FILES`).
- **Finding 6**: P08a same decision-dependent artifact-set fix.
- **Finding 7**: CI fallback mechanism-conditional (B1/B1a/B1b in
  `lint_javascript`, B2 in `test` only).
- **Finding 8**: P13/P13a normalized filtered git status snapshot comparison.
- **Finding 9**: deferred-language scans restricted to executable/source files
  (NOT `.md` planning docs).
- **Finding 10**: P06 characterization proof clarified as RED-equivalent
  artifact (not true committed-failing-test TDD).

## Prior Architect Review Findings

- **Finding 1 (runtime factory decision record lifecycle)**: decision record
  CREATED in P01, FINALIZED in P09.
- **Finding 2 (API-surface guard mode transition)**: standalone script always
  enforcement-active; mode transition via snapshot update.
- **Finding 3 (B2 API-guard CI placement)**: job-scoped placement verified.
- **Finding 4 (CLI seam audit Verdict C stop condition)**: P10a FAILS unless
  revised-plan marker exists.
- **Finding 5 (P10 Verdict C coordinator decision)**: malformed options
  sentence rewritten as explicit bullets.
- **Finding 6 (P10a checklist)**: no longer scans `.md` for deferred
  vocabulary.
- **Finding 7 (P04 A2A fixture evidence)**: references corrected from
  `import-inventory.md` to `preflight-results.md`.
- **Finding 8 (guard test cache-report ordering)**:
  `lint:agents-api-surface` MUST run immediately before the guard test.
- **Finding 9 (grep-count structural checks)**: require concrete structural
  entries, not keyword hits.
- **Finding 10 (P13/P13a git status algorithm)**: inline normalized filtered
  snapshot comparison.

## Architect Review Revision 5 (Current) Findings — Summary

These are the CURRENT revision findings addressed in this plan revision:

1. **A2A test file paths** (P04/P04a): use COLOCATED tests, not `__tests__/`.
2. **A2A behavior test APIs** (P04/P04a): use REAL APIs (`sendMessageStream`,
   `Task.create`, `scheduler.schedule`), not nonexistent `.sendMessage`.
3. **Test command reliability** (P04/P04a): use workspace-scoped commands,
   not root path args. P01 records exact working commands.
4. **P13 build/status verification**: capture `git status --ignored --short`.
5. **Marker policy vs existing debt**: prohibit only NEW issue2285 markers in
   production source; pre-existing markers NOT removed.
6. **Deferred-language scans**: use pre-phase baselines/git-diff added-lines
   so pre-existing debt does not cause false failures.
7. **P13a executable PR checks**: actually RUN `gh pr checks "$PR_NUMBER"`
   with the REAL PR number.
8. **P03 TDD sequencing**: split into contract-first sub-steps so the test
   is established before implementation.
9. **`LLXPRT_API_SURFACE_SKIP` escape hatch**: P13/P13a assert it is UNSET
   before final verification.
10. **P10/P10a Verdict C downstream sequencing**: revised-plan marker is NOT
    a bypass — requires P11/P12/P13 re-review.
11. **Historical revision annotations**: consolidated into THIS appendix so
    executable phase instructions focus on current requirements.
