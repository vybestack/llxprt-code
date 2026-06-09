## Verdict: FAIL

The plan is substantially improved and covers many prior pitfalls, but it still has material implementation blockers. The biggest problems are incomplete migration coverage for existing relative core imports, an unsafe/impossible P03b/P04b production-stub strategy, and an unresolved contradiction around making `providerRuntimeContext.ts` “settings-agnostic” while it currently owns a `SettingsService`-typed runtime contract and default construction path.

## Material issues

1. **P08/P09 migration coverage misses many current core-relative `Storage` consumers, so deleting `packages/core/src/config/storage.ts` will break the repo.**

   **Plan references:**  
   - `project-plans/issue1588/analysis/consumer-import-matrix.md`  
   - `project-plans/issue1588/plan/08-consumer-migration-impl.md`  
   - `project-plans/issue1588/plan/09-cleanup-no-shims.md`

   **Source evidence:**  
   `packages/core/src/config/storage.ts` is not only profile/settings storage. It exports path helpers used throughout core:
   - `Storage.getUserPoliciesDir()`, `getSystemPoliciesDir()`
   - `Storage.getUserSkillsDir()`
   - `Storage.getMcpOAuthTokensPath()`
   - `Storage.getInstallationIdPath()`
   - `Storage.getProviderAccountsPath()`
   - history/temp/checkpoint/project path helpers

   Current direct relative imports include:
   - `packages/core/src/policy/config.ts`
   - `packages/core/src/policy/config.test.ts`
   - `packages/core/src/policy/policy-updater.test.ts`
   - `packages/core/src/policy/persistence.test.ts`
   - `packages/core/src/services/gitService.ts`
   - `packages/core/src/services/gitService.test.ts`
   - `packages/core/src/skills/skillManager.ts`
   - `packages/core/src/skills/skillManager.test.ts`
   - `packages/core/src/hooks/trustedHooks.ts`
   - `packages/core/src/hooks/hookSystem.test.ts`
   - `packages/core/src/hooks/hookRegistry.test.ts`
   - `packages/core/src/storage/SessionPersistenceService.ts`
   - `packages/core/src/storage/SessionPersistenceService.test.ts`
   - `packages/core/src/models/registry.ts`
   - `packages/core/src/mcp/file-token-store.ts`
   - `packages/core/src/mcp/file-token-store.test.ts`
   - `packages/core/src/utils/installationManager.ts`
   - `packages/core/src/utils/userAccountManager.ts`
   - `packages/core/src/code_assist/oauth-credential-storage.ts`

   The plan’s core migration lists focus on config/profile/runtime files and add a relative import scan only for `profileManager`, not for `storage`.

   **Required changes:**
   - Add a complete preflight inventory for core-relative storage imports:
     ```bash
     rg -n "from ['\"].*(config/storage|\.\./config/storage|\./storage)|vi\.mock\(['\"].*config/storage" packages/core/src --glob '*.ts'
     ```
   - Add explicit migration tasks for every core `Storage` consumer to import from `@vybestack/llxprt-code-settings` before P09 deletes `packages/core/src/config/storage.ts`.
   - Add P08/P09 enforcing scans for relative `config/storage` imports and `vi.mock('../config/storage.js')` paths, not just package deep imports.
   - Expand behavioral tests to cover all non-settings storage helper paths that are being moved into settings, especially policies, MCP OAuth token path, provider accounts, installation ID, skills, history, and session temp directories.

2. **The same relative-import gap exists for `packages/core/src/settings/**`; current core tests/imports will break when P09 deletes the directory.**

   **Plan references:**  
   - `project-plans/issue1588/analysis/consumer-import-matrix.md`
   - `project-plans/issue1588/plan/08-consumer-migration-impl.md`
   - `project-plans/issue1588/plan/09-cleanup-no-shims.md`

   **Source evidence:**  
   Current source/tests import or mock core-local settings files via relative paths, e.g.:
   - `packages/core/src/integration-tests/settings-remediation.test.ts` imports `../settings/settingsServiceInstance.js` and `../settings/SettingsService.js`.
   - `packages/core/src/lsp/__tests__/system-integration.test.ts` mocks `../../settings/settingsServiceInstance.js`.
   - `packages/core/src/lsp/__tests__/e2e-lsp.test.ts` mocks `../../settings/settingsServiceInstance.js`.
   - `packages/core/src/utils/shell-utils.shellReplacement.test.ts` imports `../settings/SettingsService.js`.

   The plan mostly scans package-style paths such as `@vybestack/llxprt-code-core/settings/...`. It does not consistently enforce migration of static relative imports like `../settings/SettingsService.js`.

   **Required changes:**
   - Add a complete relative settings import/mocking inventory:
     ```bash
     rg -n "from ['\"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)|vi\.mock\(['\"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)" packages/core/src --glob '*.ts'
     ```
   - Add P08 migration tasks for each match.
   - Add P08/P09 enforcing scans that fail on any remaining relative moved settings imports/mocks before deleting `packages/core/src/settings`.

3. **P03b production wiring to a throwing adapter stub is likely impossible to validate and violates the plan’s own “don’t break unrelated tests” goal.**

   **Plan references:**  
   - `project-plans/issue1588/plan/03b-minimal-adapter-wiring.md`
   - `project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md`
   - `dev-docs/PLAN.md`

   **Problem:**  
   P03b requires changing `packages/core/src/config/configConstructor.ts` so normal config construction calls `activateSettingsRuntimeContext()`, whose P03b implementation throws `NotYetImplemented`. The plan then requires a blast-radius gate where only the new P04b test fails. That is not credible in this repository because many existing core/CLI/provider tests construct `Config` or call config-construction paths. A throwing adapter in production config construction will almost certainly break existing non-P04b tests before P06.

   The plan includes an escape hatch: “If non-P04b core tests break, defer `configConstructor` production wiring to P06.” But P04b’s stated prerequisite and test design require P03b wiring to exist. That leaves implementers with contradictory instructions.

   **Required changes:**
   - Do not wire `configConstructor.ts` to a throwing production stub in P03b.
   - Instead, create a non-throwing minimal adapter with transparent current-compatible behavior, or keep P03b compile-only and move the production call-site switch to P06 after settings implementation exists.
   - If integration-first red testing is still required before P06, write a test against a controlled adapter stub/import boundary, not against globally used production config construction.
   - Remove or rewrite the “only P04b fails” blast-radius requirement if the plan retains a throwing production stub, because it is not a dependable pass gate.

4. **P04b expected-failure design risks violating the mandatory “no reverse testing / no NotYetImplemented testing” rule.**

   **Plan references:**  
   - `project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md`
   - `dev-docs/PLAN.md`

   **Problem:**  
   The plan says P04b should exercise `configConstructor → activateSettingsRuntimeContext` and “expects the call to fail because the adapter stub throws `NotYetImplemented`.” Even if the test does not literally assert `toThrow('NotYetImplemented')`, the red-phase verification explicitly greps for `NotYetImplemented`. The planning docs state tests must fail naturally against real behavior and must not check for stub behavior.

   **Required changes:**
   - Make P04b tests assert intended behavior: config construction registers/activates the provided settings service and `getSettingsService()` returns it.
   - Red-phase verification may confirm the test runner exits nonzero and has no module-resolution errors, but it should not require `NotYetImplemented`.
   - If a stub failure pattern is used, require generic behavioral assertion failure patterns, not a named stub marker.

5. **`providerRuntimeContext.ts` “settings-agnostic” target is under-specified and conflicts with the actual current runtime-context contract.**

   **Plan references:**  
   - `project-plans/issue1588/analysis/final-architecture.md`
   - `project-plans/issue1588/analysis/integration-contract.md`
   - `project-plans/issue1588/plan/06-core-integration-stub.md`
   - `project-plans/issue1588/plan/09-cleanup-no-shims.md`

   **Source evidence:**  
   `packages/core/src/runtime/providerRuntimeContext.ts` currently:
   - Imports `SettingsService` from `../settings/SettingsService.js` at line 21.
   - Defines `ProviderRuntimeContext.settingsService: SettingsService` at line 32.
   - Defines `ProviderRuntimeContextInit.settingsService?: SettingsService` at line 47.
   - Constructs `new SettingsService()` in `createProviderRuntimeContext()` at line 63.

   The plan says `providerRuntimeContext.ts` must not import, construct, or reference `SettingsService`, and scans enforce zero matches for `SettingsService`. But it does not specify the replacement type contract or default-construction behavior. The adapter pseudocode still creates a `ProviderRuntimeContext` with a settings service, so the context is not fully settings-agnostic in data shape.

   **Required changes:**
   - Define the exact replacement type:
     - Either a core-owned structural interface, e.g. `ProviderRuntimeSettingsService` with the minimum methods core needs, or
     - A generic `settingsService: unknown` plus typed accessors elsewhere, though this weakens type safety.
   - Decide what `createProviderRuntimeContext({})` does after it can no longer `new SettingsService()`.
     - Prefer requiring `settingsService` in `ProviderRuntimeContextInit` and updating all callers, or moving default construction to the adapter.
   - Add an inventory of all `createProviderRuntimeContext()` call sites, especially calls with no `settingsService`.
   - Add tests proving the new type/default behavior, not just grep scans.

6. **The plan moves the entire `Storage` class into `packages/settings` but does not fully confront the ownership/scope impact.**

   **Plan references:**  
   - `project-plans/issue1588/specification.md`
   - `project-plans/issue1588/analysis/final-architecture.md`
   - `project-plans/issue1588/analysis/settings-move-map.md`
   - `project-plans/issue1588/analysis/behavioral-regression-matrix.md`

   **Problem:**  
   The plan correctly notes there is no `packages/storage`, but it responds by moving the full `Storage` class into settings. The current `Storage` class is broader than settings persistence: policies, skills, MCP OAuth token files, installation ID, command directories, history, and project temp paths all become settings package API surface by default.

   This may be acceptable as a temporary internal seam, but the plan currently frames storage as “settings/profile/storage” and does not explicitly say that non-settings storage helpers are being temporarily owned by settings. This is a package-boundary scope risk.

   **Required changes:**
   - Add a section listing every `Storage` static/instance method and classify it:
     - settings/profile persistence,
     - general app storage,
     - policy storage,
     - MCP auth storage,
     - skills/commands/history/session storage.
   - Explicitly justify why each non-settings helper is allowed to live in `packages/settings` until a real `packages/storage` exists.
   - Alternatively, split the current class so only settings/profile-related helpers move, and leave unrelated core storage helpers in core. If split, update the no-shim policy accordingly.
   - Add behavioral tests for every moved `Storage` helper, not just global LLxprt/profile paths.

7. **P08 root-barrel moved-symbol enforcement uses partial symbol lists and can miss required migrations before cleanup.**

   **Plan references:**  
   - `project-plans/issue1588/analysis/anti-shim-policy.md`
   - `project-plans/issue1588/analysis/settings-move-map.md`
   - `project-plans/issue1588/plan/08-consumer-migration-impl.md`

   **Problem:**  
   The canonical blocklist includes many symbols:
   - `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`
   - `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile`
   - `LoadBalancerConfig`, `LoadBalancerSubProfileConfig`
   - plus singleton and registry symbols.

   P08’s root-barrel scan only checks a subset:
   - `SettingsService`, `ProfileManager`, `Storage`, `ModelParams`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `EphemeralSettings`, `SETTINGS_REGISTRY`, `getSettingsService`

   This lets consumers continue importing moved type symbols from `@vybestack/llxprt-code-core` through P08, only to fail later in P09.

   **Required changes:**
   - Replace all P08/P09/P10 moved-symbol scans with a single canonical symbol list from `analysis/anti-shim-policy.md`.
   - Include type-only imports and multiline imports. The current regex may miss multiline import blocks.
   - Prefer a checked-in boundary script, as the plan already proposes, and require all phases to use it.

8. **The plan says to create `scripts/check-settings-boundary.js`, but the later phase commands still rely heavily on drifting inline grep snippets.**

   **Plan references:**  
   - `project-plans/issue1588/plan/00-overview.md`
   - `project-plans/issue1588/analysis/boundary-verification-script.md` (listed as mandatory)
   - Multiple phase files, especially P08/P09/P10

   **Problem:**  
   The overview declares a reusable boundary verification script mandatory and says later phases MUST use it. The phase plans still duplicate many inline scans with inconsistent symbol lists and scopes. This defeats the point of the script and is already causing gaps noted above.

   **Required changes:**
   - Make the boundary script the authoritative enforcement mechanism.
   - In P08/P09/P10, replace duplicated inline scans with `node scripts/check-settings-boundary.js` plus a small number of truly phase-specific checks.
   - Ensure the script covers:
     - old package deep imports,
     - root-barrel moved symbols,
     - relative core settings/storage/profile imports,
     - `vi.mock`,
     - dynamic imports,
     - package metadata dependencies,
     - `providerRuntimeContext.ts` rule,
     - no `packages/storage`,
     - no core shim exports.

9. **The plan’s `settingsRuntimeAdapter` single-owner scan is too narrow and grep-based logic can miss actual violations.**

   **Plan references:**  
   - `project-plans/issue1588/plan/06-core-integration-stub.md`
   - `project-plans/issue1588/analysis/call-site-migration-matrix.md`

   **Problem:**  
   The scan looks for files containing `registerSettingsService|resetSettingsService` and then checks for runtime context helper names. It can miss:
   - Aliased imports.
   - Re-exported or indirectly called bridge helpers.
   - Multiline imports where names are not in the same grep context.
   - Bridge behavior hidden behind wrapper function names.
   - Test utility files outside `.test.ts` but still part of production-ish support.

   **Required changes:**
   - Move bridge enforcement into the proposed boundary script.
   - Parse import declarations or use a simple TypeScript/AST-aware check if available.
   - At minimum, scan full file content for both import specifiers and function identifiers, and report exact files.
   - Include `getActiveProviderRuntimeContext`/`peekActiveProviderRuntimeContext` decisions explicitly: are callers allowed to combine settings reads with context reads, or only forbidden to combine register/reset with set/clear/create?

10. **`SettingsService` event behavior tests are underspecified relative to actual current implementation.**

   **Plan references:**  
   - `project-plans/issue1588/analysis/behavioral-regression-matrix.md`
   - `project-plans/issue1588/plan/04-settings-package-tdd.md`

   **Source evidence:**  
   `packages/core/src/settings/SettingsService.ts` has multiple event surfaces:
   - Emits `'change'` on `set`.
   - Emits `'provider-change'` on `setProviderSetting`.
   - Emits `'cleared'` on `clear`.
   - Has a typed overload for `'settings_changed'`, but the implementation does not obviously emit `'settings_changed'` in the shown code.

   The plan says “settings changed events” but does not require precise preservation of all three actual emitted event names and payloads, nor does it call out the apparent legacy `'settings_changed'` subscription behavior.

   **Required changes:**
   - Add explicit tests for actual current events:
     - `'change'` payload from `set`.
     - `'provider-change'` payload from `setProviderSetting`.
     - `'cleared'` event from `clear`.
     - Existing behavior of `onSettingsChanged` / `'settings_changed'`, including whether it currently fires or only subscribes.
   - Avoid broad “changed events” wording without naming the event names and expected payloads.

## Pedantic improvements

1. **Fix phase naming drift.**  
   `plan/06-core-integration-stub.md` says it is not a stub. Rename file/title to `06-core-integration-impl.md` or similar to avoid implementation-agent confusion.

2. **Normalize test path conventions.**  
   Some sections place registry tests under `packages/settings/src/__tests__/settingsRegistry.test.ts`; others mention `packages/settings/src/settings/__tests__/settingsRegistry.test.ts`. Pick one convention and align all plan files.

3. **Remove duplicated/contradictory paragraphs.**  
   Several artifacts repeat the same a2a-server conclusion, deterministic graph checks, P04b sequencing explanation, and lockfile guidance. Duplication increases the risk of edits diverging.

4. **Clarify `packages/settings/index.ts` vs `packages/settings/src/index.ts` build outputs.**  
   The plan says root export resolves to `dist/index.js` from `packages/settings/index.ts → ./src/index.js`. Include a concrete required `packages/settings/index.ts` snippet and verify both `.d.ts` paths exist.

5. **Use exact JSON dependency checks for all downstream packages.**  
   Some phases still use `rg` for dependency presence. Prefer Node JSON parsing for core/providers/CLI/test-utils/lsp/a2a-server dependency assertions.

6. **P10 should run `npm run format:check` or record that `npm run format` changed files.**  
   The repository memory requires `npm run format`; the plan records status afterward, which is good. But final verification should make clear that any format-induced changes require rerunning relevant checks.

7. **Add `package-lock.json` validation after every `npm install`, not only diff-stat checks.**  
   Run `npm run check:lockfile` if applicable, because the root package already has a script for lockfile checks.

8. **Avoid `head`/`tail` in verification gates where success/failure details matter.**  
   Some commands pipe through `tail -3` or `head -20`. That is fine for summaries, but phase completion markers should preserve full outputs for failing schema/docs/test commands.

9. **Clarify whether `zod` version in settings should match core’s current `zod` version exactly.**  
   The plan says current package version must match repository version, but dependency versions should also be exact/focused where copied code requires `zod`.

10. **Add an explicit `npm run test --workspace @vybestack/llxprt-code-settings -- --run src/storage src/profiles src/settings src/__tests__` command only if Vitest path filtering works as expected.**  
   The broad `-- --run` is safer; avoid path-specific commands that might silently skip nested tests.

## Evidence: key source/plan files inspected

- `project-plans/issue1588/specification.md`
- `project-plans/issue1588/plan/00-overview.md`
- `project-plans/issue1588/plan/03b-minimal-adapter-wiring.md`
- `project-plans/issue1588/plan/04-settings-package-tdd.md`
- `project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md`
- `project-plans/issue1588/plan/05-settings-package-impl.md`
- `project-plans/issue1588/plan/06-core-integration-stub.md`
- `project-plans/issue1588/plan/07-consumer-migration-tdd.md`
- `project-plans/issue1588/plan/08-consumer-migration-impl.md`
- `project-plans/issue1588/plan/09-cleanup-no-shims.md`
- `project-plans/issue1588/plan/09a-cleanup-no-shims-verification.md`
- `project-plans/issue1588/analysis/final-architecture.md`
- `project-plans/issue1588/analysis/dependency-audit.md`
- `project-plans/issue1588/analysis/settings-move-map.md`
- `project-plans/issue1588/analysis/consumer-import-matrix.md`
- `project-plans/issue1588/analysis/behavioral-regression-matrix.md`
- `project-plans/issue1588/analysis/integration-contract.md`
- `project-plans/issue1588/analysis/package-metadata-constraints.md`
- `project-plans/issue1588/analysis/anti-shim-policy.md`
- `dev-docs/PLAN.md`
- `dev-docs/PLAN-TEMPLATE.md`
- `dev-docs/RULES.md`
- `package.json`
- `packages/core/package.json`
- `packages/core/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/config/storage.ts`
- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/config/configConstructor.ts`
- `packages/core/src/config/profileManager.ts`
- `packages/core/src/runtime/providerRuntimeContext.ts`
- `packages/core/src/settings/SettingsService.ts`
- `packages/core/src/settings/settingsRegistry.ts`
- `packages/core/src/settings/settingsServiceInstance.ts`
- `packages/core/src/settings/types.ts`
- `packages/core/src/types/modelParams.ts`
- `packages/providers/package.json`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/vitest.config.ts`
