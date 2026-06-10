Verdict: **PASS**

Material findings: **None.** I found no blockers for P09a.

Pedantic / non-blocking findings:
- `packages/core/src/runtime/settingsRuntimeAdapter.ts` exports more helper APIs than the minimal architecture example (`resolveRuntimeSettingsService`, `getRuntimeSettingsService`, `createSettingsProviderRuntimeContext`, etc.). These are not shims back to old core settings APIs: they are core runtime bridge helpers and are exported only via the runtime adapter subpath / runtime index. This is acceptable for P09a because the old settings/profile/storage/modelParams APIs are not re-exported from core root or legacy deep paths.
- The broad stale-dist scan pattern from the plan catches unrelated symbols like `ProviderKeyStorage`, `MCPOAuthTokenStorage`, and `getModelParams` from `AgentRuntimeState`. A refined stale-export scan excluding unrelated “KeyStorage” and runtime-state symbols passed.

Verification performed:
- `node scripts/check-settings-boundary.js --phase post-p09`
  - **PASS**: all boundary checks OK, including old paths, root barrel, anti-shim, core re-exports, modelParams subpath, vi.mock paths, dynamic import paths, provider runtime context, adapter single-owner, lockfile.
- Targeted removed-file checks:
  - **PASS**: `packages/core/src/settings` absent.
  - **PASS**: old core `config/storage.ts`, `config/profileManager.ts`, `types/modelParams.ts`, and moved core tests absent.
  - **PASS**: stale `packages/core/test/settings/*` files absent.
- Targeted import/export/mock/dynamic scans:
  - **PASS**: no imports of `@vybestack/llxprt-code-core/settings`, core `config/storage`, core `config/profileManager`, or core `types/modelParams`.
  - **PASS**: no root-barrel imports of moved settings/profile/storage/modelParams symbols from `@vybestack/llxprt-code-core`.
  - **PASS**: no old `vi.mock` paths or dynamic imports for moved core settings/profile/storage/modelParams paths.
  - **PASS**: `packages/settings` has no forbidden imports from core/providers/tools/cli.
- Provider runtime ownership checks:
  - **PASS**: `packages/core/src/runtime/providerRuntimeContext.ts` contains no `SettingsService`, settings singleton functions, or settings-package import.
  - **PASS**: `packages/core/src/runtime/settingsRuntimeAdapter.ts` is the production file that bridges settings singleton registration/reset with provider runtime context mutation.
  - `configConstructor.ts` uses `activateSettingsRuntimeContext(config.settingsService)`.
- Tests spot-checked:
  - `packages/settings/src/__tests__/settingsServiceInstance.test.ts`: verifies settings-package singleton behavior without core runtime context.
  - `packages/core/src/runtime/settingsRuntimeAdapter.test.ts`: verifies adapter activation/deactivation, isolation, and that direct settings reset does not clear runtime context.
  - `packages/settings/src/profiles/__tests__/ProfileManager.test.ts`: real temp filesystem profile save/load/list/delete behavior; not mock theater.
  - `packages/settings/src/storage/__tests__/Storage.test.ts`: real path and directory behavior.
  - CLI runtime/profile tests preserve behavior across migration.
- Commands run:
  - `npm run test --workspace @vybestack/llxprt-code-settings -- --run`
    - **PASS**: 5 files, 156 tests.
  - `npm run test --workspace @vybestack/llxprt-code-core -- --run src/runtime/settingsRuntimeAdapter.test.ts src/runtime/providerRuntimeContext.test.ts`
    - **PASS**: 2 files, 11 tests.
  - `npm run test --workspace @vybestack/llxprt-code -- --run src/config/__tests__/profileOverridePrecedenceParity.test.ts src/runtime/__tests__/runtimeIsolation.test.ts`
    - **PASS**: 2 files, 20 tests.
  - `npm run typecheck`
    - **PASS** across workspaces.
  - Refined core dist stale export scan:
    - **PASS**: no moved settings/profile/modelParams exports in core dist barrels.
  - `git status --short .llxprt`
    - **PASS**: no `.llxprt` modifications reported.

P09 marker assessment:
- `project-plans/issue1588/.completed/P09.md` is accurate enough to proceed. Its boundary, typecheck, test, build/dist, and semantic checklist claims align with the current worktree based on the checks above.

P09a marker: **May be created.**
