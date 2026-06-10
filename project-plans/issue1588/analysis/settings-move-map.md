# Settings Move Map

Plan ID: PLAN-20260608-ISSUE1588

## P01 Preflight Move Classification Validation

All classifications below were validated against the P0.5 preflight command output. Key validations:

1. **Settings source inventory confirmed**: 6 files in `packages/core/src/settings/` (types.ts, SettingsService.ts, settingsRegistry.ts, settingsServiceInstance.ts, index.ts, settingsRegistry.test.ts). All classified as MOVED.
2. **Config storage/profile confirmed**: `storage.ts`, `storage.test.ts`, `profileManager.ts`, `profileManager.test.ts` in `packages/core/src/config/`. All classified as MOVED.
3. **modelParams.ts confirmed**: 13 exported symbols (AuthConfig, AuthConfigSchema, ModelParams, EphemeralSettings, LoadBalancerSubProfileConfig, LoadBalancerConfig, StandardProfile, LoadBalancerProfile, Profile, isLoadBalancerProfile, isStandardProfile, hasAuthConfig, isOAuthProfile). All classified as MOVED to `packages/settings/src/profiles/types.ts`.
4. **Files staying in core confirmed**: config.ts, configBase.ts, configBaseCore.ts, configConstructor.ts, configTypes.ts, toolRegistryFactory.ts, schedulerSingleton.ts, ephemeralSettingsHelpers.ts, subagentManager.ts, endpoints.ts, models.ts, lspIntegration.ts, constants.ts, config.test.ts, and all other config files NOT in the moved list. All classified as RETAINED.
5. **CLI god-object-deferred scope confirmed**: `packages/cli/src/config/settingsSchema.ts` and related CLI-specific settings files remain CLI-owned. Explicitly classified as DEFERRED.
6. **Issue #1584 boundary rules considered**: The providers package (`@vybestack/llxprt-code-providers`) already extracted per issue #1584. Settings must follow the same naming pattern (`@vybestack/llxprt-code-settings`), same build convention (`dist/src/...` exports, `node ../../scripts/build_package.js`), and same cycle-free dependency direction. The providers package sets the precedent for subpath exports, vitest alias plugins, and tsconfig path patterns.
7. **Compression strategy values confirmed**: `COMPRESSION_STRATEGIES = ['middle-out', 'top-down-truncation', 'one-shot', 'high-density']` recorded from preflight. Settings registry will own these as literal values, not import from core compression.
8. **a2a-server import clarification**: The preflight grep flagged false positives (`Storage` from `@google-cloud/storage`, `AsyncLocalStorage` from `node:async_hooks`). a2a-server does NOT directly import any of our moved settings/config/profile/storage symbols. No direct `@vybestack/llxprt-code-settings` dependency needed for a2a-server.

## Files To Move Now

| Current File | Target File | Notes |
|--------------|-------------|-------|
| `packages/core/src/settings/types.ts` | `packages/settings/src/types.ts` | Pure settings types; update imports to local paths |
| `packages/core/src/settings/SettingsService.ts` | `packages/settings/src/settings/SettingsService.ts` | Preserve all methods and events |
| `packages/core/src/settings/settingsRegistry.ts` | `packages/settings/src/settings/settingsRegistry.ts` | Remove core compression import first |
| `packages/core/src/settings/settingsServiceInstance.ts` | `packages/settings/src/settings/settingsServiceInstance.ts` | Rewrite to avoid core runtime context import |
| `packages/core/src/settings/index.ts` | `packages/settings/src/settings/index.ts` or root barrel | Core copy removed during cleanup |
| `packages/core/src/config/storage.ts` | `packages/settings/src/storage/Storage.ts` | Same path outputs; `LLXPRT_DIR = '.llxprt'` moves with Storage. Core `configBaseCore.ts` defines its own local constant — no import from tools or settings. Future storage-package seam. |
| `packages/core/src/config/profileManager.ts` | `packages/settings/src/profiles/ProfileManager.ts` | Move profile types/guards with it |
| `packages/core/src/settings/__tests__/settingsRegistry.test.ts` | `packages/settings/src/settings/__tests__/settingsRegistry.test.ts` | Stop importing core compression |
| `packages/core/src/config/storage.test.ts` | `packages/settings/src/storage/Storage.test.ts` | Path behavior unchanged |
| `packages/core/src/config/profileManager.test.ts` | `packages/settings/src/profiles/ProfileManager.test.ts` | Include `save`/`load` tests |

## Types To Move Or Split

| Current Symbol | Current File | Target Ownership | Reason |
|----------------|--------------|------------------|--------|
| `AuthConfig` / `AuthConfigSchema` | `packages/core/src/types/modelParams.ts` | settings profile types | Auth profile data is persisted settings/profile schema |
| `ModelParams` | `packages/core/src/types/modelParams.ts` | settings profile/model parameter types | Used by persisted profiles and providers |
| `EphemeralSettings` | `packages/core/src/types/modelParams.ts` | settings types/profile types | Persisted in profiles and settings service |
| `LoadBalancerSubProfileConfig` | `packages/core/src/types/modelParams.ts` | settings profile types | Profile JSON contract |
| `LoadBalancerConfig` | `packages/core/src/types/modelParams.ts` | settings profile types | Profile JSON contract |
| `StandardProfile` | `packages/core/src/types/modelParams.ts` | settings profile types | Profile JSON contract |
| `LoadBalancerProfile` | `packages/core/src/types/modelParams.ts` | settings profile types | Profile JSON contract |
| `Profile` | `packages/core/src/types/modelParams.ts` | settings profile types | Required by `ProfileManager` |
| `isLoadBalancerProfile` | `packages/core/src/types/modelParams.ts` | settings profile types | Required by `ProfileManager` |
| `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile` | `packages/core/src/types/modelParams.ts` | settings profile types | Consumers update imports |

Implementation must verify no remaining profile-type imports force `packages/settings` to import core.

### Final State Of `packages/core/src/types/modelParams.ts`

After extraction, `packages/core/src/types/modelParams.ts` is **removed entirely**. All symbols currently defined in this file move to settings-owned modules:

- Profile/parameter types and guards move to `packages/settings/src/profiles/types.ts`.
- `AuthConfig`/`AuthConfigSchema` move to `packages/settings/src/profiles/types.ts` (used by profile save/load and registry validation).
- `ModelParams` and `EphemeralSettings` move to `packages/settings/src/profiles/types.ts` (used by persisted profiles and settings service).
- Any remaining non-settings model parameter helpers that core itself needs are re-imported from `@vybestack/llxprt-code-settings`.

**If any symbols remain in core after extraction, they would constitute a compatibility shim.** The entire file is removed and all consumers are migrated.

### Symbol-by-Symbol Move Map

| Source Symbol | Source File | Destination File | Destination Export |
|---|---|---|---|
| `AuthConfig` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `AuthConfigSchema` (zod schema) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `ModelParams` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `EphemeralSettings` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `LoadBalancerSubProfileConfig` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `LoadBalancerConfig` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `StandardProfile` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `LoadBalancerProfile` (interface) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `Profile` (type alias) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `isLoadBalancerProfile` (function) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `isStandardProfile` (function) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `hasAuthConfig` (function) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `isOAuthProfile` (function) | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` | Root + `./profiles/types.js` subpath |
| `SettingsService` (class) | `packages/core/src/settings/SettingsService.ts` | `packages/settings/src/settings/SettingsService.ts` | Root + `./settings/SettingsService.js` subpath |
| SettingsService types (ISettingsService, GlobalSettings, etc.) | `packages/core/src/settings/types.ts` | `packages/settings/src/types.ts` | Root export |
| `settingsRegistry` + registry functions | `packages/core/src/settings/settingsRegistry.ts` | `packages/settings/src/settings/settingsRegistry.ts` | Root + `./settings/settingsRegistry.js` subpath |
| `getSettingsService` / `registerSettingsService` / `resetSettingsService` | `packages/core/src/settings/settingsServiceInstance.ts` | `packages/settings/src/settings/settingsServiceInstance.ts` | Root + `./settings/settingsServiceInstance.js` subpath |
| `SETTINGS_REGISTRY` | `packages/core/src/settings/settingsRegistry.ts` | `packages/settings/src/settings/settingsRegistry.ts` | Root + `./settings/settingsRegistry.js` subpath |
| `ProfileManager` (class) | `packages/core/src/config/profileManager.ts` | `packages/settings/src/profiles/ProfileManager.ts` | Root + `./profiles/ProfileManager.js` subpath |
| `Storage` (class) + `LLXPRT_DIR` constant | `packages/core/src/config/storage.ts` | `packages/settings/src/storage/Storage.ts` | Root + `./storage/Storage.js` subpath |
| `DiagnosticsInfo` (type) | `packages/core/src/settings/types.ts` | `packages/settings/src/types.ts` | Root export |

### P09 Verification: Deletion and No Core Re-Exports

After P09 deletes `packages/core/src/types/modelParams.ts` and removes core re-exports, verify:

```bash
# modelParams.ts must not exist
test ! -f packages/core/src/types/modelParams.ts && echo "OK: modelParams.ts deleted" || { echo "FAIL: modelParams.ts still exists"; exit 1; }
# No core re-exports of moved symbols
rg -n "export.*\{[^}]*(Profile|StandardProfile|LoadBalancerProfile|ModelParams|EphemeralSettings|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile|SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY)[^}]*\}" packages/core/src/index.ts packages/core/index.ts && echo "FAIL: core still re-exports moved symbols" || echo "OK: no moved symbol re-exports"
# No deep imports of modelParams from core
rg -n "from ['"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts' && echo "FAIL: deep modelParams imports found" || echo "OK: no deep modelParams imports"
# All moved symbols exported from settings package
node --input-type=module -e "const mod = await import('@vybestack/llxprt-code-settings'); const symbols = ['Profile','StandardProfile','LoadBalancerProfile','ModelParams','EphemeralSettings','isLoadBalancerProfile','isStandardProfile','AuthConfig','AuthConfigSchema','hasAuthConfig','isOAuthProfile','SettingsService','ProfileManager','Storage','getSettingsService','registerSettingsService','resetSettingsService','SETTINGS_REGISTRY','DiagnosticsInfo']; for (const s of symbols) { if (!(s in mod)) { console.error('FAIL: missing export', s); process.exitCode = 1; } } console.log('OK: all moved symbols exported from settings');"
```

### Core Export Removal For Moved Types

After extraction, the following core exports must be removed:

1. `packages/core/src/types/modelParams.ts` — entire file deleted in P09.
2. `packages/core/src/index.ts` — `export * from './types/modelParams.js'` (or equivalent named exports) removed.
3. `packages/core/package.json` — `./types/modelParams.js` subpath export removed (if present).

### Scans For Moved Profile/Model Type Imports From Core

```bash
rg -n "from ['"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'
```

Expected: zero after P09.

## Files To Stay In Core For This Issue

| File | Reason |
|------|--------|
| `packages/core/src/config/config.ts` | Core config god object; broad decomposition prerequisite not complete |
| `packages/core/src/config/configBase.ts` | Core config hierarchy |
| `packages/core/src/config/configBaseCore.ts` | Stays but imports settings classes from settings package |
| `packages/core/src/config/configConstructor.ts` | Stays but constructs/imports settings classes from settings package |
| `packages/core/src/config/configTypes.ts` | Stays but imports settings types from settings package |
| `packages/core/src/config/toolRegistryFactory.ts` | Tool-related; settings must not depend on tools |
| `packages/core/src/config/schedulerSingleton.ts` | Runtime scheduling, not settings package ownership |
| `packages/core/src/runtime/providerRuntimeContext.ts` | Core runtime context; imports settings but is not imported by settings |

## CLI Files Deferred By God Object Prerequisite

Issue #1588 mentions CLI settings schema/runtime settings after god-object decomposition. The plan must inventory these but not move them until decomposition exists. Examples to inspect during P01:

- `packages/cli/src/config/**`
- `packages/cli/src/runtime/**`
- CLI settings schema files and settings command logic

Allowed P08 action: update imports of moved settings/profile/storage APIs. Forbidden action: move CLI-specific UI/config command logic into settings while it still depends on CLI concerns.

## Consumer Import Migration Examples

| Old Import | New Import |
|------------|------------|
| `@vybestack/llxprt-code-core/settings/SettingsService.js` | `@vybestack/llxprt-code-settings/settings/SettingsService.js` or root export |
| `@vybestack/llxprt-code-core/settings/settingsServiceInstance.js` | `@vybestack/llxprt-code-settings/settings/settingsServiceInstance.js` or root export |
| `@vybestack/llxprt-code-core/settings/settingsRegistry.js` | `@vybestack/llxprt-code-settings/settings/settingsRegistry.js` or root export |
| `@vybestack/llxprt-code-core/config/storage.js` | `@vybestack/llxprt-code-settings/storage/Storage.js` or root export |
| `@vybestack/llxprt-code-core/config/profileManager.js` | `@vybestack/llxprt-code-settings/profiles/ProfileManager.js` or root export |
| `../settings/SettingsService.js` inside core | `@vybestack/llxprt-code-settings` |
| `./storage.js` inside core config | `@vybestack/llxprt-code-settings` |
| `./profileManager.js` inside core config | `@vybestack/llxprt-code-settings` |

## Removal Rule

After P09, moved source files must not remain under `packages/core/src/settings` or `packages/core/src/config` except for unrelated config files. Do not leave forwarding wrappers.

## Internal Storage Seam/Boundary

`packages/settings/src/storage/Storage.ts` defines an internal boundary seam for future storage extraction. The seam consists of:

1. **`Storage` class** with clear public API surface: global/settings/accounts/profiles path helpers that depend only on `os.homedir()` and `path.join()`.
2. **`LLXPRT_DIR` constant** as a self-contained string value (`'.llxprt'`), not imported from core/tools.
3. **No imports from settings service/registry** inside `Storage.ts` — Storage is self-contained and does not reference `SettingsService`, `settingsRegistry`, or `settingsServiceInstance`.

This seam means future extraction to `packages/storage` would move only `Storage.ts` and `Storage.test.ts` without touching settings service/registry internals. The `./storage/Storage.js` subpath export in `package.json` would simply become a new package's export. No structural changes to `Storage.ts` are required for this extraction.
