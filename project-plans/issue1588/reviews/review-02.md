## Verdict: FAIL

The revised plan is substantially stronger than the prior review artifacts indicate, and it now handles many important issue #1588 constraints: no packages/storage invention, no core shims, provider-extraction precedent, modelParams.ts ownership, root-barrel migrations, and full verification. However, there are still material blockers around test/package dependency direction and the singleton/runtime-context semantic break.

## Material issues

1. Vertical-slice integration tests are planned inside packages/settings, creating forbidden reverse dependencies.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md, project-plans/issue1588/plan/04b-vertical-slice-integration-tdd-verification.md, project-plans/issue1588/analysis/integration-contract.md, project-plans/issue1588/analysis/package-metadata-constraints.md.
   - Problem: P04b creates core/provider/CLI integration tests under packages/settings/src/__tests__/integration. Those tests are explicitly supposed to exercise core, providers, and CLI call paths from inside settings. This makes settings tests import its consumers, conflicting with the issue dependency rule and with the plan's own forbidden dependency checks.
   - Required change: Move P04b vertical-slice integration tests out of packages/settings. Put them in owning consumer packages or root integration tests. Keep packages/settings tests limited to settings-owned behavior.

2. Runtime-context / singleton semantic change is under-specified for existing registerSettingsService and resetSettingsService call sites.
   - References: project-plans/issue1588/analysis/final-architecture.md, project-plans/issue1588/analysis/integration-contract.md IC-02, project-plans/issue1588/analysis/behavioral-regression-matrix.md BVE-06a/BVE-06b, project-plans/issue1588/plan/06-core-integration-stub.md, packages/core/src/settings/settingsServiceInstance.ts, packages/core/src/runtime/providerRuntimeContext.ts.
   - Problem: The plan intentionally changes settings-owned registerSettingsService so it no longer creates ProviderRuntimeContext, and resetSettingsService so it clears only settings package state. Existing core/provider/CLI call sites and tests call these APIs and may rely on old behavior.
   - Required change: Add an explicit call-site migration matrix for registerSettingsService, getSettingsService, and resetSettingsService. Classify every call site as settings-only singleton use, runtime-context activation use, test cleanup use, or provider behavior requiring core runtime context. Define a concrete replacement for callers requiring runtime context, and add behavioral tests proving cleanup and isolation still work.

3. P04b sequencing claims integration-first but still depends on consumer integration before consumers are migrated.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md, project-plans/issue1588/plan/07-consumer-migration-tdd.md, project-plans/issue1588/plan/08-consumer-migration-impl.md.
   - Problem: P04b says it will test core/providers/CLI consuming settings package stubs before P05, but broad consumer migration does not happen until P08. This either requires production consumer import changes earlier than P08 or creates artificial test-only wiring.
   - Required change: Clarify sequencing. Either move minimal consumer import stubs/adapter wiring earlier with explicit production files, or move consumer integration TDD closer to P07/P08. Ensure every integration test exercises a real planned production path.

4. Settings package public export map is not concrete enough for the planned import styles.
   - References: project-plans/issue1588/analysis/package-metadata-constraints.md, project-plans/issue1588/analysis/final-architecture.md, project-plans/issue1588/analysis/settings-move-map.md, project-plans/issue1588/analysis/consumer-import-matrix.md.
   - Problem: The package metadata template only requires the root export, while multiple artifacts allow subpath imports like @vybestack/llxprt-code-settings/settings/SettingsService.js, profiles/ProfileManager.js, profiles/types.js, and storage/Storage.js.
   - Required change: Decide the actual public API: root-only or root plus explicit grouped subpath exports. If subpaths are allowed, make them mandatory in packages/settings/package.json and verify built/runtime import resolution for each.

## Pedantic improvements

1. Fix duplicate pseudocode line numbers in analysis/pseudocode/package-boundary.md and analysis/pseudocode/settings-service.md.
2. Clarify whether settings package tests may use consumer packages as dev-only fixtures; preferably forbid this explicitly.
3. Make generated settings schema/docs ownership more explicit, since scripts/generate-settings-schema.ts and scripts/generate-settings-doc.ts currently import CLI settings schema.
4. Clarify test naming/location conventions per owning package after moving P04b tests out of packages/settings.
5. Add built-runtime verification that imports the built settings package root and any documented subpaths with Node.

## Evidence: key files inspected

Planning rules: dev-docs/PLAN.md, dev-docs/PLAN-TEMPLATE.md, dev-docs/RULES.md.

Issue1588 plan/spec/analysis: specification.md; plan/00-overview.md; plan/03-decoupling-stub.md; plan/04-settings-package-tdd.md; plan/04b-vertical-slice-integration-tdd.md; plan/05-settings-package-impl.md; plan/06-core-integration-stub.md; plan/07-consumer-migration-tdd.md; plan/08-consumer-migration-impl.md; plan/09-cleanup-no-shims.md; plan/10-full-verification.md; execution-tracker.md; analysis/final-architecture.md; analysis/dependency-audit.md; analysis/settings-move-map.md; analysis/consumer-import-matrix.md; analysis/integration-contract.md; analysis/behavioral-regression-matrix.md; analysis/package-metadata-constraints.md; analysis/anti-shim-policy.md; analysis/phase-verification-matrix.md; analysis/pseudocode/package-boundary.md; analysis/pseudocode/settings-service.md; analysis/pseudocode/profile-storage.md; analysis/pseudocode/consumer-migration.md; analysis/pseudocode/verification.md.

Issue1584 precedent: project-plans/issue1584/analysis/final-architecture.md, anti-shim-policy.md, package-metadata-constraints.md.

Repository source/package files: package.json; packages/core/package.json; packages/core/tsconfig.json; packages/providers/package.json; packages/providers/tsconfig.json; packages/providers/vitest.config.ts; packages/cli/package.json; packages/cli/tsconfig.json; packages/core/src/settings/SettingsService.ts; packages/core/src/settings/settingsServiceInstance.ts; packages/core/src/settings/settingsRegistry.ts; packages/core/src/settings/types.ts; packages/core/src/runtime/providerRuntimeContext.ts; packages/core/src/config/profileManager.ts; packages/core/src/config/storage.ts; packages/core/src/types/modelParams.ts; scripts/generate-settings-schema.ts; scripts/generate-settings-doc.ts.
