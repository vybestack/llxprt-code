# typescriptreviewer Review 07

## Verdict

FAIL

## Must-fix issues

1. `lsp-diagnostics-helper.ts` is acknowledged in `analysis/tool-move-map.md` and related analysis, but is not concretely integrated into P11/P15. Add an explicit decision artifact `analysis/lsp-diagnostics-helper-decision.md`, a P11 migration/retain group, and P15 retained allowlist handling.
2. P11/P12 adapter ownership is contradictory: P11 says adapters are created per compile-safe group, while P12 allows creating missed adapters later. Change P12 to fail if mandatory adapters are missing, and assign every mandatory adapter, especially `CoreLspServiceAdapter.ts`, to a P11 group.
3. Release/package ordering is not fully reconciled with root workspace order and `bind-release-deps.js`. Specify exact root workspace order or update derivation logic/tests so publish order is tools → core → lsp → providers → cli.
4. P10 TDD verification contradicts RED-state expectations. Typecheck should pass, but tests should fail behaviorally against stubs; P10 must record and classify expected RED failures rather than requiring green test execution.
5. Non-tools utility relocation lacks an explicit copy-vs-move ownership rule. Add classification preventing copied production utility behavior from existing in both core and tools except structural type-only cases.
6. P10 scaffold/export verification uses CommonJS `require('./packages/tools')` against a planned ESM package. Replace with build + dynamic `import('@vybestack/llxprt-code-tools')` or a source/export manifest scan.
7. P13 broad consumer scan needs a strict old-path zero check plus classification of remaining valid new tools imports; otherwise valid and invalid matches can be conflated.

## Pedantic issues

1. `plan/00-overview.md` has Plan ID date `PLAN-20260608-ISSUE1585` but `Generated: 2026-06-05`; align for traceability.
2. P14 `scripts/version.js` example order does not clearly match publish order. State whether `actualWorkspaces` order is semantic; if semantic, align it.
3. P13 post-migration evidence command repeats `-g "*.mjs"`.
4. P14 publish command should instruct implementers to match adjacent release.yml style exactly, differing only by package name/order.
5. P10 fixture examples include illustrative expected values; explicitly say they must be overwritten by capture output and never hand-authored.
6. The exact adapter list is duplicated in many files; make `analysis/final-architecture.md` canonical to reduce drift.

## Missing evidence/commands

1. Add `analysis/lsp-diagnostics-helper-imports.txt` and `analysis/lsp-diagnostics-helper-decision.md` generated from `rg -n "^import .* from" packages/core/src/tools/lsp-diagnostics-helper.ts -g "*.ts"`.
2. Add a root workspace order verification command if release derivation depends on workspace order.
3. Add strict old-path post-migration zero check for `@vybestack/llxprt-code-core/tools/` and relative `../tools/` imports, excluding only documented retained files.
4. Add `analysis/non-tools-core-utility-ownership-final.md` with zero `FORBIDDEN_UNRESOLVED` entries.
5. Add explicit P10 RED-state evidence: typecheck pass plus expected behavioral test failures, with non-behavioral failures rejected.
6. Add ESM-compatible runtime export smoke for `@vybestack/llxprt-code-tools` after build/pack.
7. Add classification of remaining matches in `all-tool-consumers-final.txt` after P13 as `NEW_VALID_TOOLS_IMPORT`, `RETAINED_CORE_INFRASTRUCTURE`, or `REFERENCE_ONLY`.

## Suggested edits

1. In `plan/11-tool-move-impl.md`, add a required LSP decision gate for `analysis/lsp-diagnostics-helper-decision.md` and a concrete migration group that either moves `lsp-diagnostics-helper.ts` behind `ILspService` or retains it with rationale and consumer rewrites.
2. In `plan/12-core-adapters-and-registry-integration.md`, replace “create if missed” language with: “P12 MUST NOT create mandatory adapters that P11 missed; missing adapters fail P12 and require returning to the responsible P11 group.”
3. In `plan/14-release-process.md`, specify root workspace order exactly as `packages/tools`, `packages/core`, `packages/lsp`, `packages/providers`, `packages/cli`, followed by private/non-publishable workspaces; or explicitly update `bind-release-deps.js` to derive publish order independently.
4. In `plan/10-tool-move-tdd.md`, change verification so `npm run typecheck --workspace @vybestack/llxprt-code-tools` must pass, while `npm run test --workspace @vybestack/llxprt-code-tools` must fail only for expected behavioral RED reasons.
5. In `analysis/non-tools-core-dependency-map.md`, add classification values `MOVE_PURE_UTILITY`, `COPY_STRUCTURAL_TYPE_ONLY`, `CORE_ADAPTER`, `STAY_CORE_ONLY`, and `FORBIDDEN_UNRESOLVED`, and forbid duplicated production utility behavior.
6. Replace P10 `require('./packages/tools')` export checks with build plus dynamic ESM import of `@vybestack/llxprt-code-tools`, or a source-level export manifest scan.
7. In `plan/13-consumer-migration.md`, add a strict zero-old-path command and require every remaining broad-scan match to be classified as a valid new import, retained infrastructure, or reference-only.
