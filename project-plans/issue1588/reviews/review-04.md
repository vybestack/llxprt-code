## Verdict: FAIL

The plan is substantially improved and shows serious attention to package-boundary extraction, no-shim policy, missing packages/storage, issue1584 precedent, and behavioral verification. However, there are still material implementation-plan defects that can cause either non-compiling intermediate phases, duplicate lifecycle side effects, or incomplete behavioral verification. These must be fixed before execution.

## Material issues

1. P04b vertical-slice tests cannot compile in providers/CLI at the phase where they are introduced.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md; project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:64-81; project-plans/issue1588/analysis/package-metadata-constraints.md:111-145; packages/providers/tsconfig.json:10-15.
   - P04b requires providers/CLI tests importing @vybestack/llxprt-code-settings, but P03b only adds settings dependency/path alias to core. Move providers/CLI dependency + tsconfig/vitest alias setup into P03b/P04b, or move P04b after those aliases exist.

2. Runtime context/settings lifecycle plan has contradictory double-registration and double-reset semantics.
   - References: project-plans/issue1588/analysis/final-architecture.md:74-105; project-plans/issue1588/plan/06-core-integration-stub.md:29-40,61-67; packages/core/src/runtime/providerRuntimeContext.ts:70-78; packages/core/src/settings/settingsServiceInstance.ts:40-72.
   - final-architecture says providerRuntimeContext set/clear syncs settings, while settingsRuntimeAdapter also calls register/reset around set/clear. Pick exactly one owner and update architecture, call-site matrix, P06, call-count tests, and scans.

3. P04/P05 settings package test commands omit nested ProfileManager and Storage tests.
   - References: project-plans/issue1588/plan/04-settings-package-tdd.md:64-85; project-plans/issue1588/plan/05-settings-package-impl.md; project-plans/issue1588/analysis/behavioral-regression-matrix.md BVE-04/BVE-05.
   - P04 places tests under src/profiles/__tests__ and src/storage/__tests__, but verification only runs src/__tests__. Run full settings src tests or explicitly include nested directories in P04/P05/P05a/P10 and the phase matrix.

4. P04b integration tests risk becoming test-only wiring rather than production-path tests.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md; plan/07-consumer-migration-tdd.md; plan/08-consumer-migration-impl.md.
   - For each P04b test, name the exact production entrypoint/function/class and exact import path being exercised. Require tests to fail if production consumer wiring is absent, not merely if a directly imported settings class is unimplemented.

5. P03/P03b package scaffold requirements are too vague for a new workspace package.
   - References: project-plans/issue1588/plan/03-decoupling-stub.md:28-34; plan/03b-minimal-adapter-wiring.md:75-82; analysis/package-metadata-constraints.md:20-80.
   - P03 must explicitly list packages/settings/package.json, tsconfig.json, index.ts, src layout, vitest config if needed, workspace registration, exports, compilation, package test command availability, and forbidden dependency/import checks.

6. The adapter single-owner scan is under-specified and conflicts with intended providerRuntimeContext behavior.
   - References: project-plans/issue1588/analysis/call-site-migration-matrix.md; plan/06-core-integration-stub.md:61-67.
   - Define exact permitted bridge points after resolving lifecycle ownership. Add concrete scan logic distinguishing production bridge calls, test cleanup, and mocks.

7. Settings package boundary checks should scan tests/configs/package metadata, not only packages/settings/src.
   - References: project-plans/issue1588/plan/04-settings-package-tdd.md:80-84; plan/05-settings-package-impl.md; analysis/consumer-import-matrix.md.
   - Extend scans to packages/settings/**/*.ts(x), package.json, tsconfig.json, vitest.config.ts, and both dependencies/devDependencies.

## Pedantic improvements

1. Fix typo in P05 prerequisite: “Phase 04ba verified” should be “Phase 04b verified” or equivalent.
2. Align settings subpath export map style with providers precedent or explicitly justify using richer {types, import} objects while providers mostly uses string subpath exports.
3. Clarify SettingsService source layout consistently; some artifacts imply packages/settings/src/SettingsService.ts while package metadata requires packages/settings/src/settings/SettingsService.ts.
4. Make CLI god-object deferral more actionable by adding a deferred inventory table naming exact CLI files found and why each remains CLI-owned.
5. Add explicit package-lock verification to package metadata phases after workspace/dependency changes and verify no pnpm-lock.yaml is created.
6. Run generated schema/docs verification earlier if any phase touches CLI schema imports or aliases used by those scripts, not only in P10.
7. Avoid long-lived “STUB/will be implemented” comments in production source where possible, or ensure post-P06 fraud scans fail if they remain.
8. Clarify root vs subpath import preference in migration phases: default to root imports unless a subpath is specifically justified.

## Evidence: key source/plan files inspected

- dev-docs/PLAN.md
- dev-docs/PLAN-TEMPLATE.md
- dev-docs/RULES.md
- project-plans/issue1588/specification.md
- project-plans/issue1588/plan/00-overview.md
- project-plans/issue1588/plan/00a-preflight-verification.md
- project-plans/issue1588/plan/03-decoupling-stub.md
- project-plans/issue1588/plan/03b-minimal-adapter-wiring.md
- project-plans/issue1588/plan/04-settings-package-tdd.md
- project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md
- project-plans/issue1588/plan/05-settings-package-impl.md
- project-plans/issue1588/plan/06-core-integration-stub.md
- project-plans/issue1588/plan/07-consumer-migration-tdd.md
- project-plans/issue1588/plan/08-consumer-migration-impl.md
- project-plans/issue1588/plan/09-cleanup-no-shims.md
- project-plans/issue1588/plan/10-full-verification.md
- project-plans/issue1588/analysis/anti-shim-policy.md
- project-plans/issue1588/analysis/behavioral-regression-matrix.md
- project-plans/issue1588/analysis/call-site-migration-matrix.md
- project-plans/issue1588/analysis/consumer-import-matrix.md
- project-plans/issue1588/analysis/dependency-audit.md
- project-plans/issue1588/analysis/final-architecture.md
- project-plans/issue1588/analysis/package-metadata-constraints.md
- project-plans/issue1584/analysis/anti-shim-policy.md
- project-plans/issue1584/analysis/dependency-audit.md
- project-plans/issue1584/analysis/final-architecture.md
- project-plans/issue1584/analysis/package-metadata-constraints.md
- package.json
- packages/core/package.json
- packages/providers/package.json
- packages/providers/tsconfig.json
- packages/core/src/runtime/providerRuntimeContext.ts
- packages/core/src/settings/settingsServiceInstance.ts
- packages/core/src/settings/SettingsService.ts
- packages/core/src/settings/settingsRegistry.ts
- packages/core/src/config/storage.ts
- packages/core/src/config/profileManager.ts
- packages/core/src/types/modelParams.ts
