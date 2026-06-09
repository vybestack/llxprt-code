## Verdict: FAIL

The plan is much stronger than an initial extraction plan: it explicitly handles the missing packages/storage, follows much of the issue1584 no-shim precedent, inventories many old import paths, and includes real boundary/behavioral verification. However, there are still material execution blockers. The most serious are an impossible P05a pass gate, a broken/non-enforcing adapter bridge scan, inconsistent CLI Vitest alias instructions, insufficient handling of build-order/root scripts for schema generation, and verification commands that will report success while hiding forbidden matches.

## Material issues

1. P05a requires the P04b core integration test to pass before the core adapter is implemented. References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md:35-45,107-118; project-plans/issue1588/plan/05a-settings-package-impl-verification.md:39-41; project-plans/issue1588/plan/06-core-integration-stub.md:29-40. Required change: move the pass gate to P06a, split the test into separately greened seams, or implement the adapter earlier.
2. P04b core integration test scope is internally contradictory and risks a fake/unimplementable test. References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md:68-75,102; packages/core/src/config/configBaseCore.ts:50-53. Required change: target an actual production path such as configConstructor/runtime adapter wiring, not nonexistent ConfigBaseCore settingsServiceInstance wiring.
3. Adapter single-owner bridge scan is non-enforcing and imprecise. References: project-plans/issue1588/plan/06-core-integration-stub.md:71-93,121-123. Required change: replace prose/grep listing with an enforcing script/check that allows only settingsRuntimeAdapter.ts to import/call both settings singleton and runtime-context helpers while allowing ordinary settings reads elsewhere.
4. CLI Vitest alias instructions conflict with the standardized alias strategy. References: project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:64-78,107-117,190-195; packages/cli/vitest.config.ts; packages/providers/vitest.config.ts. Required change: root alias must resolve to ../settings/index.ts and subpaths through settings src with .js-to-.ts conversion, matching provider precedent.
5. Build-order and root script updates are under-specified for core depending on settings. References: package.json predocs:settings; project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:176-179; plan/05a-settings-package-impl-verification.md:42-60; plan/00-overview.md:68. Required change: inspect/update scripts/build.js and root schema/docs scripts so settings builds before core/providers/CLI and verification proves no stale dist dependency.
6. Several forbidden-import boundary scans use || true and do not enforce zero matches. References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md:132-137; plan/05a-settings-package-impl-verification.md:36; plan/10a-final-semantic-review.md:39. Required change: make scans fail on non-empty output or explicitly capture and check emptiness.
7. No-shim cleanup scan misses existing core root settings type exports. References: packages/core/index.ts; project-plans/issue1588/plan/09-cleanup-no-shims.md:47; analysis/anti-shim-policy.md:57. Required change: add ISettingsService, GlobalSettings, SettingsChangeEvent, ProviderSettings, UISettings, AdvancedSettings, EventListener, EventUnsubscribe, SettingsTelemetrySettings, and similar current exports to blocklists/scans.
8. Plan does not concretely resolve LLXPRT_CONFIG_DIR / memoryTool coupling for storage extraction. References: packages/core/src/config/configBaseCore.ts import of LLXPRT_CONFIG_DIR from memoryTool; analysis/settings-move-map.md:14-17; analysis/final-architecture.md:43; analysis/behavioral-regression-matrix.md:56-58. Required change: decide ownership of config path constants and add tests proving identical paths without settings importing core/tools.
9. Package dependency direction for providers/settings is under-verified. References: packages/providers/package.json; project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:95-105; analysis/dependency-audit.md. Required change: add deterministic workspace graph checks proving settings has no core/providers/CLI/a2a-server/tools deps/imports and no package cycles.

## Pedantic improvements

1. Use one package export-map style or justify every deviation; verify richer settings subpath export objects with tsc and runtime import tests.
2. Tighten P04/P04a expected-failure verification by capturing output and asserting no module resolution errors, as P04b does.
3. Avoid ambiguous dependency stub language; specify concrete file:../settings dependency metadata and section.
4. Make refreshed import inventory mandatory before P08 and record actual counts in completion markers.
5. Add explicit package-lock.json verification after workspace registration, including focused diff/no unrelated churn.
6. Clarify whether a2a-server needs a direct settings dependency after import inventory.
7. Add post-build scans of packages/core/dist declarations/JS for stale moved exports/imports.
8. Require preflight to record the full symbol list from packages/core/src/types/modelParams.ts before moving/deleting it.

## Evidence: key files inspected

- project-plans/issue1588/specification.md
- project-plans/issue1588/plan/00-overview.md
- project-plans/issue1588/plan/03-decoupling-stub.md
- project-plans/issue1588/plan/03b-minimal-adapter-wiring.md
- project-plans/issue1588/plan/04-settings-package-tdd.md
- project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md
- project-plans/issue1588/plan/05-settings-package-impl.md
- project-plans/issue1588/plan/05a-settings-package-impl-verification.md
- project-plans/issue1588/plan/06-core-integration-stub.md
- project-plans/issue1588/plan/07-consumer-migration-tdd.md
- project-plans/issue1588/plan/08-consumer-migration-impl.md
- project-plans/issue1588/plan/09-cleanup-no-shims.md
- project-plans/issue1588/plan/10-full-verification.md
- project-plans/issue1588/analysis/final-architecture.md
- project-plans/issue1588/analysis/dependency-audit.md
- project-plans/issue1588/analysis/settings-move-map.md
- project-plans/issue1588/analysis/consumer-import-matrix.md
- project-plans/issue1588/analysis/call-site-migration-matrix.md
- project-plans/issue1588/analysis/integration-contract.md
- project-plans/issue1588/analysis/behavioral-regression-matrix.md
- project-plans/issue1588/analysis/package-metadata-constraints.md
- project-plans/issue1588/analysis/anti-shim-policy.md
- project-plans/issue1588/analysis/phase-verification-matrix.md
- dev-docs/PLAN.md
- dev-docs/PLAN-TEMPLATE.md
- dev-docs/RULES.md
- project-plans/issue1584/analysis/package-metadata-constraints.md
- project-plans/issue1584/analysis/anti-shim-policy.md
- project-plans/issue1584/analysis/final-architecture.md
- package.json
- packages/core/package.json
- packages/core/index.ts
- packages/core/src/index.ts
- packages/core/src/config/configBaseCore.ts
- packages/core/src/settings/settingsServiceInstance.ts
- packages/core/src/runtime/providerRuntimeContext.ts
- packages/core/src/types/modelParams.ts
- packages/providers/package.json
- packages/providers/tsconfig.json
- packages/providers/vitest.config.ts
- packages/cli/package.json
- packages/cli/tsconfig.json
- packages/cli/vitest.config.ts
- Repository grep results showing many current old core settings imports in packages/providers/** and root-barrel moved-symbol imports in packages/cli/** and packages/a2a-server/**.
