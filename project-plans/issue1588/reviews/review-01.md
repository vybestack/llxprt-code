## Verdict: FAIL

The plan is directionally strong and correctly handles several major constraints (no nonexistent `packages/storage`, no settings→core/providers/CLI dependency, no core shims, issue1584 naming precedent). However, it has material gaps that would let implementation either fail to compile, leave compatibility shims/imports behind, or violate the mandatory integration-first/TDD planning rules.

## Material issues

1. Root-barrel imports of moved settings/profile/storage APIs are not fully inventoried or blocked. The forbidden import scans focus on deep paths such as `@vybestack/llxprt-code-core/settings/*` and `@vybestack/llxprt-code-core/config/(storage|profileManager)`, but the repository has many consumers importing moved symbols from the core root barrel, for example CLI tests importing `ProfileManager`, `SettingsService`, `Storage`, and `Profile` from `@vybestack/llxprt-code-core`, and provider tests importing `SettingsService` from core root. If core root continues exporting those symbols, that is a compatibility shim/no-shim violation. If core root stops exporting them without a root-import migration plan, consumers will fail. Required change: add explicit inventory and migration rules for root imports of moved symbols from `@vybestack/llxprt-code-core`, including `SettingsService`, settings singleton helpers, registry APIs, `ProfileManager`, `Storage`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, and related type guards. Add verification scans that detect named imports of moved symbols from the core root barrel.

2. Profile/model parameter type ownership is under-specified and risks either a shim or widespread breakage. The plan says profile/model parameter types move from `packages/core/src/types/modelParams.ts` into settings to prevent `settings -> core`, but it does not define the final state of `packages/core/src/types/modelParams.ts`, `packages/core/src/index.ts` export of `./types/modelParams.js`, or `packages/core/package.json` export `./types/modelParams.js`. The current file contains many settings/profile-owned types and guards. If these remain re-exported from core, extraction keeps a compatibility shim. If removed, many imports must be migrated. Required change: add an explicit type-migration phase/detail: whether `modelParams.ts` is removed, split, or left with only non-settings-owned types; which symbols move to settings; how root and deep core exports are removed without shims; scans for `@vybestack/llxprt-code-core` imports of moved profile/model types and for `@vybestack/llxprt-code-core/types/modelParams.js`.

3. Core internal `ProfileManager` consumers are not sufficiently analyzed. The plan names core config/runtime files, but current core has additional production files importing or typing against core-local `ProfileManager`, including `packages/core/src/config/subagentManager.ts`, `packages/core/src/config/toolRegistryFactory.ts`, `packages/core/src/tools/task.ts`, and `packages/core/src/core/subagentOrchestrator.ts`. If `packages/core/src/config/profileManager.ts` is removed in P09, these break unless migrated. Required change: expand the core consumer matrix and P06/P08 tasks to cover all core production and test imports of `ProfileManager`. Add a verification scan for relative imports of `../config/profileManager.js` and `./profileManager.js` across `packages/core/src`.

4. Settings singleton/runtime-context inversion changes current semantics without a clear compatibility decision. Current `packages/core/src/settings/settingsServiceInstance.ts` does more than store a singleton: `getSettingsService()` reads the active `ProviderRuntimeContext`, `registerSettingsService()` creates a provider runtime context when none exists, and `resetSettingsService()` clears both the settings instance and active provider runtime context. The proposed settings-owned module cannot create a core `ProviderRuntimeContext` without violating `settings -> core`, so behavior necessarily changes unless core provides some adapter/callback. Required change: define exact replacement semantics. Does settings `registerSettingsService()` only set the settings singleton? Which core/CLI/provider callers/tests need updating? If preserving old behavior is required, what core-owned adapter performs context creation without settings importing core? Add behavioral tests for both register-before-context and context-activation updates.

5. Integration-first/TDD sequencing is not compliant enough for a multi-package extraction. The plan implements the settings package in P05 before writing consumer migration integration tests in P07. For this issue, acceptance criteria include import migration, clean package boundaries, and no cycles, not only isolated settings behavior. The mandatory planning docs require integration tests before implementation for multi-component features. Required change: move at least a minimal vertical-slice integration TDD phase before P05 implementation, after stubs exist: core config/runtime consumes settings package stubs; provider consumes settings package API and registry; CLI/profile path exercises `ProfileManager`/`Storage` from settings; tests fail naturally against stubs/missing implementation and are not import-only tests.

6. No-shim cleanup scans miss core package/root exports for moved profile/model types and root-level moved symbols. P09 scans for names such as `SettingsService`, `settingsRegistry`, `settingsServiceInstance`, `ProfileManager`, and `Storage` in core index/package exports, but it does not scan for moved type exports like `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, or `isLoadBalancerProfile`. Current `packages/core/src/index.ts` re-exports all of `./types/modelParams.js`, which would keep moved settings/profile contracts available from core. Required change: extend anti-shim policy and P09 scans to reject core root exports of moved profile/model settings types, core package export `./types/modelParams.js` if it becomes a moved-profile-type shim, and consumers importing moved type symbols from core.

7. Package metadata/build-order details are incomplete for the existing alias/test setup. `packages/providers/tsconfig.json` currently aliases core and providers only. `packages/providers/vitest.config.ts` has a custom workspace alias plugin for core/providers source paths. Adding `@vybestack/llxprt-code-settings` will require coordinated updates to downstream tsconfig path aliases and Vitest source alias plugins. The plan says “if needed” but does not make this concrete. Required change: add explicit metadata/test-runner tasks for settings aliases/subpaths in providers and other downstream packages where needed, plus verification that tests use settings source consistently before build artifacts exist.

8. P03 verification allows typecheck failure, which undermines the stub phase. P03 says typecheck may pass or fail only with documented stubs allowed by phase. A stub phase’s purpose is to compile. Allowing typecheck failure creates ambiguity and weakens later TDD phases: tests may fail because the workspace does not compile, not because behavior is missing. Required change: make P03 success require `npm run typecheck` or affected workspace typechecks to pass.

## Pedantic improvements

1. Clarify package manager language. Root `package.json` declares `packageManager: pnpm`, but scripts/memories use npm and `package-lock.json` exists. Explicitly state npm is intended to prevent accidental pnpm lockfile churn.

2. Use exact export-map convention from providers. `packages/providers/package.json` uses `import` under `exports`.`.`, not `default`. Match current package convention unless deliberately diverging.

3. Add explicit scans for old relative imports in all packages, including mocks and dynamic imports such as `vi.mock('../settings/settingsServiceInstance.js')` and `import('@vybestack/llxprt-code-core').then(mod => mod.ProfileManager)`.

4. Narrow “settings can depend on zod” to actual moved need. `modelParams.ts` currently imports `zod` for `AuthConfigSchema`, so settings likely needs `zod`; state this as verified by current source.

5. Add explicit generated-doc/schema follow-up checks. Root scripts include `predocs:settings`, `schema:settings`, and `docs:settings`; moving settings registry likely requires script/import updates.

6. Strengthen full verification with package-boundary dependency graph checks in addition to grep scans.

7. Clarify test naming expectations. Existing repo uses both `.test.ts` and `.spec.ts`; phase verification should not assume only one extension.

## Evidence: key files inspected

- `project-plans/issue1588/specification.md`
- `project-plans/issue1588/plan/00-overview.md`
- `project-plans/issue1588/plan/00a-preflight-verification.md`
- `project-plans/issue1588/plan/03-decoupling-stub.md`
- `project-plans/issue1588/plan/04-settings-package-tdd.md`
- `project-plans/issue1588/plan/05-settings-package-impl.md`
- `project-plans/issue1588/plan/06-core-integration-stub.md`
- `project-plans/issue1588/plan/07-consumer-migration-tdd.md`
- `project-plans/issue1588/plan/08-consumer-migration-impl.md`
- `project-plans/issue1588/plan/09-cleanup-no-shims.md`
- `project-plans/issue1588/plan/10-full-verification.md`
- `project-plans/issue1588/analysis/final-architecture.md`
- `project-plans/issue1588/analysis/dependency-audit.md`
- `project-plans/issue1588/analysis/settings-move-map.md`
- `project-plans/issue1588/analysis/consumer-import-matrix.md`
- `project-plans/issue1588/analysis/behavioral-regression-matrix.md`
- `project-plans/issue1588/analysis/integration-contract.md`
- `project-plans/issue1588/analysis/anti-shim-policy.md`
- `project-plans/issue1588/analysis/package-metadata-constraints.md`
- `project-plans/issue1588/analysis/phase-verification-matrix.md`
- `project-plans/issue1588/analysis/pseudocode/*.md`
- `project-plans/issue1588/execution-tracker.md`
- `project-plans/issue1584/analysis/*` precedent files
- `dev-docs/PLAN.md`
- `dev-docs/PLAN-TEMPLATE.md`
- `dev-docs/RULES.md`
- `package.json`
- `packages/core/package.json`
- `packages/providers/package.json`
- `packages/providers/tsconfig.json`
- `packages/providers/vitest.config.ts`
- `packages/core/src/settings/SettingsService.ts`
- `packages/core/src/settings/settingsRegistry.ts`
- `packages/core/src/settings/settingsServiceInstance.ts`
- `packages/core/src/settings/index.ts`
- `packages/core/src/config/profileManager.ts`
- `packages/core/src/config/storage.ts`
- `packages/core/src/runtime/providerRuntimeContext.ts`
- `packages/core/src/types/modelParams.ts`
- `packages/core/src/index.ts`
- Repository search results for moved settings/profile/storage consumers across `packages/**`
