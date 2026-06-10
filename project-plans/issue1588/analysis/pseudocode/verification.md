# Pseudocode: Verification

Plan ID: PLAN-20260608-ISSUE1588

## Numbered Pseudocode

01: VERIFY branch is `issue1588`
02: VERIFY `.llxprt/` was not modified (`git status --short .llxprt`)
03: RUN settings package tests (`npm run test --workspace @vybestack/llxprt-code-settings`)
04: RUN core tests touching config/runtime/settings
05: RUN providers tests touching settings-backed provider behavior
06: RUN CLI tests touching profile/settings startup where available
07: RUN forbidden settings package dependency check using Node.js JSON parsing (exact field comparison, not regex): `dependencies` AND `devDependencies` must not contain `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-a2a-server`
08: RUN forbidden settings-to-core import scan: `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx'` must return zero — covers BOTH source AND test files AND config files
09: RUN forbidden old core settings import scan (deep paths): `rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'` must return zero
10: RUN root-barrel moved-symbol import scan: `rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from '@vybestack/llxprt-code-core'" packages --glob '*.ts'` must return zero
11: RUN moved profile/model type import scan from core: `rg -n "from '@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'` must return zero
12: RUN core relative ProfileManager import scan: `rg -n "from '.*config/profileManager" packages/core/src --glob '*.ts'` must return zero
13: RUN core relative Storage import scan: `rg -n "from '.*config/storage" packages/core/src --glob '*.ts'` must return zero
14: RUN dynamic import / vi.mock old path scan: `rg -n "vi\.mock.*'.*settings/|vi\.mock.*'.*config/(storage|profileManager)|import\('@vybestack/llxprt-code-core'\)\.then" packages --glob '*.ts'` must return zero
15: RUN deep dynamic import scan for `import('@vybestack/llxprt-code-core/settings/...')` and `import('@vybestack/llxprt-code-core/config/(storage|profileManager)')` paths
16: RUN anti-shim file/export scan: verify `packages/core/src/types/modelParams.ts` does not exist AND no core re-exports of moved symbols exist in `packages/core/src/index.ts` or `packages/core/package.json`
17: RUN package boundary dependency graph check using ESM dynamic import for cycle detection: `node --input-type=module -e` script checking production `dependencies` ONLY (dev dependency cycles are non-blocking)
18: RUN settings package metadata boundary check using Node JSON parsing (exact field comparison): forbidden deps in both `dependencies` AND `devDependencies`
19: RUN `npm run test`
20: RUN `npm run lint`
21: RUN `npm run typecheck`
22: RUN `npm run format`
23: RECORD `git status --short` and `git diff --stat` output after format (completion marker must include format result)
24: RUN `npm run build`
25: RUN `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
26: VERIFY `packages/core/src/types/modelParams.ts` does not exist
27: VERIFY core index.ts does not re-export moved settings/profile/storage/model-param symbols (`SettingsService`, `ISettingsService`, `GlobalSettings`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `SettingsChangeEvent`, `EventListener`, `EventUnsubscribe`, `DiagnosticsInfo`, `SettingsTelemetrySettings`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `ProfileManager`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `AuthConfig`, `AuthConfigSchema`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`, `Storage`)
28: VERIFY core `package.json` does not have `modelParams` subpath export or any moved symbol subpath exports (`./settings/*`, `./config/storage.js`, `./config/profileManager.js`, `./types/modelParams.js`)
29: VERIFY `providerRuntimeContext.ts` does NOT import or reference settings-package types or functions: `rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from '@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts` must return zero
30: INSPECT diffs for moved files and import migration completeness
31: CHECK root docs/schema scripts reference settings package if applicable: `npm run schema:settings` and `npm run docs:settings`
32: RUN built-runtime ESM import verification for all documented exports from settings package: root + all subpaths per `analysis/package-metadata-constraints.md`
33: RUN settings package consumer-import-free check: `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/settings/src --glob '*.ts'` must return zero
34: RUN extended settings boundary check: `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx'` (all files including tests, configs, metadata) must return zero
35: RUN settings package metadata boundary check: Node JSON parsing for forbidden deps in both `dependencies` AND `devDependencies`
36: RUN adapter permitted bridge scan: only `settingsRuntimeAdapter.ts` may import BOTH settings-package singleton functions AND core runtime-context functions in production code. No other production file may bridge both.
37: RUN `packages/lsp` import scan to verify no unmigrated old imports
38: RUN npm vs pnpm evidence check: `test -f package-lock.json && echo "npm lockfile present"; test ! -f pnpm-lock.yaml && echo "pnpm lockfile absent"`
39: RUN lockfile/no pnpm-lock verification after every workspace/dependency change
40: RUN full import inventory refresh per `analysis/call-site-migration-matrix.md` Full Import Inventory Requirement — covers all workspaces, root-barrel, deep-path, type, mock, dynamic imports
41: WRITE holistic assessment explaining data flow and why behavior is preserved
42: VERIFY production dependency cycle check (dependencies ONLY, not devDependencies): no cycles in workspace production dependency graph
43: VERIFY `packages/core/package.json` declares `@vybestack/llxprt-code-settings` in dependencies
44: VERIFY `packages/providers/package.json` declares `@vybestack/llxprt-code-settings` in dependencies
45: VERIFY `packages/settings/package.json` does NOT declare forbidden workspace packages in `dependencies` OR `devDependencies`
46: VERIFY settings build order: settings appears before core in workspaces array OR build script ensures settings builds first
47: RETURN final verification complete

## Anti-Pattern Warnings

- DO NOT verify with regex-only package metadata checks; use Node.js JSON parsing for exact field comparison to avoid package-name collision/regex risks.
- DO NOT skip settings-package forbidden-dependency checks in devDependencies — both dependencies AND devDependencies must not contain forbidden workspace packages per `analysis/package-metadata-constraints.md`.
- DO NOT skip the adapter permitted bridge scan — production code may only bridge settings and runtime context in `settingsRuntimeAdapter.ts`.
- DO NOT skip the `providerRuntimeContext.ts` import scan — it must stay settings-agnostic.
- DO NOT skip `packages/lsp` in import scans — it must be explicitly included.
- DO NOT skip lockfile integrity checks after workspace/dependency changes.
- RUNTIME ISOLATION: Settings-package singleton functions manage settings-package-owned state only. `registerSettingsService()` does NOT create `ProviderRuntimeContext`. `getSettingsService()` reads settings-package state only. `resetSettingsService()` clears settings-package state and calls `.clear()` on previous service — it does NOT call `clearActiveProviderRuntimeContext()`. Core runtime context is decoupled: `providerRuntimeContext.ts` uses `ProviderRuntimeSettingsService` structural interface, never imports `SettingsService`. The sole bridge is `settingsRuntimeAdapter.ts`.

## Required Semantic Questions

- Does `SettingsService` behavior match prior behavior by reading implementation and tests?
- Does `ProfileManager` still write/read the same JSON under `~/.llxprt/profiles`?
- Does runtime context isolation still select the intended settings service?
- Does register-before-context work without creating core `ProviderRuntimeContext`?
- Do providers use settings through the new package, not through core?
- Are old core paths gone rather than wrapped?
- Are all moved profile/model types imported from settings, not core?
- Does settings package have zero consumer imports (not even dev-only)?
- Do integration tests for consumer→settings paths live in owning consumer packages?
- Does `settingsRuntimeAdapter.ts` correctly bridge core runtime context with settings package?
- Does `resetSettingsService()` from settings NOT call `clearActiveProviderRuntimeContext()`?
- Is `modelParams.ts` deleted, not left as a shim?
- Does `providerRuntimeContext.ts` reference only `ProviderRuntimeSettingsService` interface, never `SettingsService` directly?
- Does `Storage.ts` have `// @storage-seam` marker and zero imports from settings service/registry/profile modules?
- Does `LLXPRT_DIR` equal `'.llxprt'` in both `Storage.ts` (settings) and `configBaseCore.ts` (core local constant)?
