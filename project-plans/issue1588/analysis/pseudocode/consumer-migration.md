# Pseudocode: Consumer Migration

Plan ID: PLAN-20260608-ISSUE1588

## Interface Contracts

Inputs:

- Existing core, providers, CLI, a2a-server, test-utils, and lsp imports of moved symbols
- New settings package public API (`@vybestack/llxprt-code-settings`)
- Consumer import matrix from `analysis/consumer-import-matrix.md`
- Call-site migration matrix from `analysis/call-site-migration-matrix.md`
- Final-architecture.md dependency direction and forbidden import rules

Outputs:

- Consumers compile against `@vybestack/llxprt-code-settings`
- Old core settings/config imports are removed
- No behavior regression

## Numbered Pseudocode

01: RUN full consumer import inventory refresh — covers all workspaces, root-barrel, deep-path, type, mock, dynamic imports per `analysis/consumer-import-matrix.md` Full Import Inventory Requirement
02: CLASSIFY each match as: production, test, package export, dynamic import, vi.mock path, or false positive
03: ADD settings package dependency to each package with production direct imports (`"@vybestack/llxprt-code-settings": "file:../settings"` in `dependencies`)
04: ADD settings package dependency to packages with test-only direct imports if package metadata requires it (check `test-utils` for direct settings imports)
05: VERIFY a2a-server does NOT directly import moved symbols — confirmed false positives only (`@google-cloud/storage`, `AsyncLocalStorage`, `requestStorage`)
06: VERIFY lsp package has no direct settings/config/profile/storage imports
07: UPDATE core runtime/config imports from relative settings/config paths to settings package imports
08: UPDATE core internal ProfileManager consumers (`subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts`, `configBaseCore.ts`) to import from settings package
09: UPDATE core `configConstructor.ts` to use `activateSettingsRuntimeContext()` from core adapter — **P06 task** (P03b creates adapter module but does NOT wire configConstructor)
10: UPDATE core `configBaseCore.ts` to define its own local `LLXPRT_DIR = '.llxprt'` constant instead of importing from `memoryTool.ts`
11: UPDATE core `Storage` consumers (19+ files in `policy/`, `services/`, `skills/`, `hooks/`, `storage/`, `models/`, `mcp/`, `utils/`, `code_assist/`, `config/`) to import `Storage` from settings package
12: UPDATE core settings service instance consumers to import `getSettingsService`, `registerSettingsService`, `resetSettingsService` from settings package
13: UPDATE providers production imports to settings package (`BaseProvider.ts`, `providerConfigKeys.ts`, `AnthropicProvider.ts`, `OpenAIProvider.ts`, `OpenAIResponsesProviderBase.ts`, `OpenAIVercelProvider.ts`, etc.)
14: UPDATE provider tests and singleton mocks to settings package paths — including `vi.mock` path updates for all 12+ test files with old paths
15: UPDATE CLI imports of moved settings/profile/storage APIs to settings package
16: LEAVE CLI-specific settings schema/runtime modules (`settingsSchema.*`, `cliEphemeralSettings.*`, `runtimeContextFactory.*`, `runtimeAccessors.*`) in CLI unless P01 plan update approves move
17: UPDATE test-utils imports only where direct old settings imports exist
18: UPDATE core modelParams type consumers to import from settings package (`packages/settings/src/profiles/types.ts` or root export)
19: REMOVE core root barrel exports of ALL moved symbols (`SettingsService`, `ISettingsService`, `GlobalSettings`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `SettingsChangeEvent`, `EventListener`, `EventUnsubscribe`, `DiagnosticsInfo`, `SettingsTelemetrySettings`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `ProfileManager`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `AuthConfig`, `AuthConfigSchema`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`, `Storage`)
20: REMOVE core `package.json` subpath exports for moved files including `./types/modelParams.js`, all `./settings/*` subpaths, `./config/storage.js`, `./config/profileManager.js`
21: UPDATE `ProviderRuntimeContext` type: change `settingsService` field type from `SettingsService` to `ProviderRuntimeSettingsService` (core-owned structural interface)
22: UPDATE all `createProviderRuntimeContext` call sites to provide `settingsService` as `ProviderRuntimeSettingsService` — this is required, not optional, after migration
23: ADD tsconfig.json path aliases and vitest workspace alias plugin entries for settings in downstream packages (providers, core, CLI)
24: RUN targeted core tests: `npm run test --workspace @vybestack/llxprt-code-core`
25: RUN targeted providers tests: `npm run test --workspace @vybestack/llxprt-code-providers`
26: RUN targeted CLI tests: `npm run test --workspace @vybestack/llxprt-code`
27: RUN old import scan — deep paths: `rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'` must return zero
28: RUN old import scan — root-barrel moved-symbol scan: `rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|...)[^}]*\}.*from '@vybestack/llxprt-code-core'" packages --glob '*.ts'` must return zero
29: RUN old import scan — vi.mock/dynamic import paths: `rg -n "vi\.mock.*'.*settings/|vi\.mock.*'.*config/(storage|profileManager)|import\('@vybestack/llxprt-code-core'\)\.then" packages --glob '*.ts'` must return zero
30: RUN type import scan: `rg -n "from '@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'` must return zero
31: IF old import scan has matches THEN migrate remaining consumers or justify false positives
32: RUN no-shim scan: verify `packages/core/src/types/modelParams.ts` does not exist and no re-exports of moved symbols remain in core index or package.json
33: RUN adapter permitted bridge scan: only `settingsRuntimeAdapter.ts` may import BOTH settings-package singleton functions AND core runtime-context functions in production code
34: VERIFY `providerRuntimeContext.ts` does NOT import or reference settings-package types or functions (enforcing scan)
35: VERIFY `packages/core/src/config/configBaseCore.ts` defines local `LLXPRT_DIR = '.llxprt'` constant instead of importing from memoryTool
36: RETURN consumer migration complete

## Anti-Pattern Warnings

- DO NOT use core re-exports as a temporary compatibility layer in final state. P09 removes ALL core re-exports of moved symbols.
- DO NOT move CLI UI or command-specific settings logic into settings while it imports CLI-only modules. Only import paths change; logic stays CLI-owned.
- DO NOT update tests to assert mocks were called instead of settings behavior. Tests must verify actual settings behavior.
- DO NOT forget to update `vi.mock(...)` paths that reference old core settings/config paths — all 12+ mock paths must be migrated.
- DO NOT forget to update dynamic `import('@vybestack/llxprt-code-core').then(...)` paths that reference moved symbols.
- DO NOT use `.spec.ts` or `.test.ts` exclusively — match repo convention for each package (repo uses both).
- DO NOT add tsconfig/vitest alias updates "if needed" — add them explicitly and verify they work per package-metadata-constraints.md.
- DO NOT import `SettingsService` in `providerRuntimeContext.ts` — use `ProviderRuntimeSettingsService` structural interface instead. The adapter is the SOLE bridge.
- DO NOT leave `modelParams.ts` as a shim file re-exporting from settings. Delete it entirely.
- DO NOT allow `a2a-server` to gain a direct `@vybestack/llxprt-code-settings` dependency unless direct imports of moved symbols are found.
- RUNTIME ISOLATION: Consumer code that needs both settings-package singleton functions AND core runtime-context functions must use the adapter (`settingsRuntimeAdapter.ts`) in production code. Test files may import both for setup/teardown but production bridge calls are restricted to the adapter only. Settings-package functions (`registerSettingsService`, `getSettingsService`, `resetSettingsService`) manage settings-package-owned state only and have no side effects in core runtime context.
