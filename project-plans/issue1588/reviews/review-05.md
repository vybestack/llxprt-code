## Verdict: FAIL

The plan is much stronger than the earlier review and addresses many package-boundary concerns, but it still has material sequencing and verification defects. The largest remaining problem is that P04b/P05a/P06a/P08 sequencing is internally inconsistent: P04b requires vertical-slice tests to fail when consumers still import old core paths, while consumer migration is not implemented until P08, yet those same P04b tests are required to pass in P05a and P06a. There are also concrete command/path and alias issues that will cause tests not to run as intended.

## Material issues

1. P04b vertical-slice tests require production consumer migration before P08, making P05a/P06a pass gates impossible. P04b says provider/CLI tests must fail if production wiring still imports moved APIs from core, but P05a/P06a rerun those tests as pass gates before consumer migration in P08. Required: either move minimal production rewiring into P03b/P04b, delay these pass gates until P08a, or move provider/CLI vertical-slice tests to P07 consumer migration TDD.
2. P04b CLI workspace test command uses the wrong path despite the plan’s workspace-relative rule. Commands use `packages/cli/src/__tests__/settings-integration` under `--workspace @vybestack/llxprt-code`; they should use `src/__tests__/settings-integration`. Fix every occurrence in P04b, P05a, P06/P06a, P08a, and the phase matrix.
3. P03b does not update CLI Vitest source aliasing even though P04b introduces CLI tests importing `@vybestack/llxprt-code-settings`. `packages/cli/vitest.config.ts` currently aliases core/providers only. Add CLI Vitest root/subpath settings aliases and verification that CLI tests resolve settings source, not stale dist.
4. P06 lifecycle wording still contradicts the single-owner adapter design. Some checklist language says runtime context activation/clearing calls settings helpers, implying `providerRuntimeContext.ts` owns sync. Rewrite to say `settingsRuntimeAdapter.ts` calls both runtime-context and settings helpers, while `providerRuntimeContext.ts` remains settings-agnostic.
5. P04/P04b TDD verification does not clearly handle expected failing tests. Raw `npm run test` commands will exit nonzero, but the plan does not require capture/inspection proving failures are expected behavioral/stub failures rather than module resolution, path, or setup errors. Add explicit failure-output assertions.
6. Call-site inventories understate actual current import surface and risk misleading implementers. The singleton call-site matrix is not the full migration inventory; actual source contains many provider and CLI old-path/root-barrel/type/mock imports. Mark the singleton matrix as lifecycle-only and add a refreshed full import inventory before execution/P08 covering all workspaces, root/deep/type/mock/dynamic imports.
7. P03/P03b TypeScript path alias targets are inconsistent with the planned package entrypoint layout. Core maps root to `../settings/index.ts`, providers/CLI map root to `../settings/src`. Use one strategy matching package entrypoint/export behavior and verify TypeScript/Vitest resolution for root and documented subpaths.
8. The plan does not explicitly update/verify root build ordering or project/build orchestration for the new settings package. Add checks for root scripts/build package ordering, update hard-coded package lists if present, and verify settings builds before packages importing it.

## Pedantic improvements

1. Empty test directories will not be tracked by git; specify `.gitkeep` or create directories only when test files are added.
2. The ripgrep glob `--glob '*.ts(x)?'` may not behave as intended; prefer explicit `--glob '*.ts' --glob '*.tsx'` or scan all non-dist files.
3. Several zero-match `rg` commands will exit nonzero despite success semantics; wrap or document them so scripted phase execution is not misleading.
4. Nonstandard suffix phases P03b/P04b are acceptable but execution ordering should be made explicit in tracker and verification artifacts.
5. Built runtime import verification should explicitly run after full root build, not only package build.
6. Settings package profile/storage tests should explicitly use real temp filesystem directories/environment overrides rather than mock-only tests.
7. `npm run format` is mutating; completion markers should record resulting git status/diffs after format.

## Evidence: key source/plan files inspected

- GitHub issue #1588 title/body/comments via `gh issue view 1588`
- `dev-docs/PLAN.md`
- `dev-docs/PLAN-TEMPLATE.md`
- `dev-docs/RULES.md`
- `project-plans/issue1588/specification.md`
- `project-plans/issue1588/plan/00-overview.md`
- `project-plans/issue1588/plan/03-decoupling-stub.md`
- `project-plans/issue1588/plan/03b-minimal-adapter-wiring.md`
- `project-plans/issue1588/plan/04-settings-package-tdd.md`
- `project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md`
- `project-plans/issue1588/plan/05-settings-package-impl.md`
- `project-plans/issue1588/plan/05a-settings-package-impl-verification.md`
- `project-plans/issue1588/plan/06-core-integration-stub.md`
- `project-plans/issue1588/plan/07-consumer-migration-tdd.md`
- `project-plans/issue1588/plan/08-consumer-migration-impl.md`
- `project-plans/issue1588/plan/09-cleanup-no-shims.md`
- `project-plans/issue1588/plan/10-full-verification.md`
- `project-plans/issue1588/analysis/anti-shim-policy.md`
- `project-plans/issue1588/analysis/behavioral-regression-matrix.md`
- `project-plans/issue1588/analysis/call-site-migration-matrix.md`
- `project-plans/issue1588/analysis/consumer-import-matrix.md`
- `project-plans/issue1588/analysis/dependency-audit.md`
- `project-plans/issue1588/analysis/final-architecture.md`
- `project-plans/issue1588/analysis/integration-contract.md`
- `project-plans/issue1588/analysis/package-metadata-constraints.md`
- `project-plans/issue1588/analysis/settings-move-map.md`
- `project-plans/issue1588/analysis/phase-verification-matrix.md`
- `project-plans/issue1588/reviews/review-04.md`
- `project-plans/issue1588/reviews/revision-04.md`
- `project-plans/issue1584/analysis/anti-shim-policy.md`
- `project-plans/issue1584/analysis/final-architecture.md`
- `project-plans/issue1584/analysis/package-metadata-constraints.md`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/config/configConstructor.ts`
- `packages/core/src/settings/settingsServiceInstance.ts`
- `packages/core/src/config/profileManager.ts`
- `packages/providers/package.json`
- `packages/providers/tsconfig.json`
- `packages/providers/vitest.config.ts`
- `packages/providers/src/BaseProvider.ts`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/vitest.config.ts`
- Repository source grep results for old settings/profile/storage/modelParams imports across `packages/**`.
