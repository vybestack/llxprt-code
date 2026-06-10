# Phase 09: Cleanup And No-Shim Removal

## Phase ID

`PLAN-20260608-ISSUE1588.P09`

## Prerequisites

- Required: Phase 08a verified.

## Requirements Implemented (Expanded)

### REQ-CONS-001: Consumer Migration

**Full Text**: Core package deep settings/config exports for moved files must be removed or rejected by no-shim verification.

**Behavior**:

- GIVEN all consumers migrated
- WHEN old core files and exports are removed
- THEN the repository builds only through the settings package boundary

**Why This Matters**: This proves extraction rather than compatibility wrapping.

## Implementation Tasks

### Files to Remove/Modify

- Remove moved core settings files.
- Remove moved core config storage/profileManager files.
- Remove `packages/core/src/types/modelParams.ts` entirely (all symbols moved to settings).
- Remove core package subpath exports for moved APIs including `./types/modelParams.js`.
- Remove core index exports for moved settings/profile/storage APIs.
- Remove core index exports for moved profile/model types (`Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `isLoadBalancerProfile`, `isStandardProfile`, `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile`, `LoadBalancerConfig`, `LoadBalancerSubProfileConfig`).
- Remove core index exports for current settings root type exports: `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo` (currently re-exported from `packages/core/index.ts`).
- Remove core index exports for settings singleton functions: `getSettingsService`, `registerSettingsService`, `resetSettingsService`.
- Remove core index exports for `SETTINGS_REGISTRY` and related registry utilities.
- Update remaining tests/imports if cleanup exposes missed consumers.
- Verify settings package does not import consumer packages (enforcing scan).
- Verify `configConstructor.ts` uses `activateSettingsRuntimeContext()` (wired by P06) not direct `registerSettingsService()`.
- Verify `providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package singleton functions (enforcing scan — expanded to cover type/import/constructor references, not just function names).
- STUB/fraud scan: after P06 has replaced P03b adapter stubs, no `STUB`/`will be implemented` comments should remain in production source (excluding test files).

Follow `analysis/anti-shim-policy.md` exactly.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js --phase post-p09
# Supplemental inline scans below

# Enforcing: old core settings directory must NOT exist after P09 cleanup
# Individual file checks using test ! -f (not just find | sort report)
test ! -d packages/core/src/settings && echo "OK: packages/core/src/settings directory removed" || { echo "FAIL: packages/core/src/settings directory still exists"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
CORE_SETTINGS_COUNT=$(find packages/core/src/settings -type f 2>/dev/null | wc -l | tr -d ' ')
test "$CORE_SETTINGS_COUNT" -eq 0 && echo "OK: packages/core/src/settings directory removed" || { echo "FAIL: packages/core/src/settings still has $CORE_SETTINGS_COUNT files"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
# Enforcing: specific moved files must NOT exist after P09 cleanup
test ! -f packages/core/src/config/storage.ts && echo "OK: config/storage.ts removed" || { echo "FAIL: config/storage.ts still exists"; exit 1; }
test ! -f packages/core/src/config/profileManager.ts && echo "OK: config/profileManager removed" || { echo "FAIL: config/profileManager still exists"; exit 1; }
test ! -f packages/core/src/types/modelParams.ts && echo "OK: types/modelParams.ts removed" || { echo "FAIL: types/modelParams.ts still exists"; exit 1; }
test ! -f packages/core/src/config/storage.test.ts 2>/dev/null && echo "OK: config/storage.test.ts removed or not present" || { echo "FAIL: config/storage.test.ts still exists"; exit 1; }
test ! -f packages/core/src/config/profileManager.test.ts 2>/dev/null && echo "OK: config/profileManager.test.ts removed or not present" || { echo "FAIL: config/profileManager.test.ts still exists"; exit 1; }
test ! -f packages/core/src/settings/__tests__/settingsRegistry.test.ts 2>/dev/null && echo "OK: settings registry test removed or not present" || { echo "FAIL: settings registry test still exists"; exit 1; }
# Enforcing anti-shim scan: core must not forward to settings package
FORWARDING_MATCHES=$(rg -n "SettingsService|settingsRegistry|settingsServiceInstance|export \{ Storage \}|from ['\"]@vybestack/llxprt-code-settings" packages/core/src/index.ts packages/core/index.ts packages/core/package.json 2>/dev/null || true)
test -z "$FORWARDING_MATCHES" && echo "OK: no forwarding to settings package" || { echo "FAIL: forwarding to settings package found:"; echo "$FORWARDING_MATCHES"; exit 1; }
# Settings root type exports scan (must be removed from core barrel)
SETTINGS_TYPE_EXPORTS=$(rg -n "ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/src/index.ts packages/core/index.ts 2>/dev/null || true)
test -z "$SETTINGS_TYPE_EXPORTS" && echo "OK: no settings type exports in core barrel" || { echo "FAIL: settings type exports still in core barrel:"; echo "$SETTINGS_TYPE_EXPORTS"; exit 1; }
# Enforcing: no old-path imports (must be zero)
OLD_PATH_MATCHES=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$OLD_PATH_MATCHES" && echo "OK: no old path imports" || { echo "FAIL: old path imports found:"; echo "$OLD_PATH_MATCHES"; exit 1; }
# Extended scans for moved profile/model types and root imports
PROFILE_TYPE_EXPORTS=$(rg -n "export.*\{[^}]*(Profile|StandardProfile|LoadBalancerProfile|ModelParams|EphemeralSettings|isLoadBalancerProfile|isStandardProfile|AuthConfig|hasAuthConfig|isOAuthProfile)[^}]*\}" packages/core/src/index.ts packages/core/index.ts 2>/dev/null || true)
test -z "$PROFILE_TYPE_EXPORTS" && echo "OK: no moved profile/model type re-exports" || { echo "FAIL: moved profile/model type re-exports found:"; echo "$PROFILE_TYPE_EXPORTS"; exit 1; }
# Core settings type exports scan (must be removed from core barrel)
CORE_SETTINGS_EXPORTS=$(rg -n "ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo" packages/core/src/index.ts packages/core/index.ts 2>/dev/null || true)
test -z "$CORE_SETTINGS_EXPORTS" && echo "OK: no settings type exports in core barrel" || { echo "FAIL: settings type exports still in core barrel:"; echo "$CORE_SETTINGS_EXPORTS"; exit 1; }
# modelParams subpath export must be gone
MODELPARAMS_EXPORT=$(rg -n "modelParams" packages/core/package.json packages/core/src/index.ts 2>/dev/null || true)
test -z "$MODELPARAMS_EXPORT" && echo "OK: no modelParams subpath export" || { echo "FAIL: modelParams subpath export found:"; echo "$MODELPARAMS_EXPORT"; exit 1; }
# modelParams file must not exist
test ! -f packages/core/src/types/modelParams.ts && echo "OK: modelParams.ts deleted" || { echo "FAIL: modelParams.ts still exists"; exit 1; }
# No compatibility-named files
find packages -type f 2>/dev/null | rg '(SettingsService|ProfileManager|Storage)(V2|New|Compat|Wrapper|Copy)\.(ts|tsx)$' && echo "FAIL: compatibility-named files found" || echo "OK: no compatibility-named files"
# Root-barrel import scan for moved symbols (enforcing: must return zero)
ROOT_BARREL_MATCHES=$(rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts' 2>/dev/null || true)
test -z "$ROOT_BARREL_MATCHES" && echo "OK: no root-barrel moved-symbol imports" || { echo "FAIL: root-barrel moved-symbol imports found:"; echo "$ROOT_BARREL_MATCHES"; exit 1; }
# Dynamic import / vi.mock scan (enforcing: must return zero)
MOCK_MATCHES=$(rg -n "vi\.mock.*['\"].*settings/|vi\.mock.*['\"].*config/(storage|profileManager)|import\(['\"]@vybestack/llxprt-code-core['\"]\)\.then" packages --glob '*.ts' 2>/dev/null || true)
test -z "$MOCK_MATCHES" && echo "OK: no old vi.mock/dynamic import paths" || { echo "FAIL: old vi.mock/dynamic import paths found:"; echo "$MOCK_MATCHES"; exit 1; }
# Deep dynamic import scan (enforcing: must return zero)
DEEP_DYNAMIC_MATCHES=$(rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$DEEP_DYNAMIC_MATCHES" && echo "OK: no deep dynamic imports of old paths" || { echo "FAIL: deep dynamic imports of old paths found:"; echo "$DEEP_DYNAMIC_MATCHES"; exit 1; }
# Include packages/lsp (enforcing)
LSP_MATCHES=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null || true)
test -z "$LSP_MATCHES" && echo "OK: no unmigrated LSP imports" || { echo "FAIL: unmigrated LSP imports found:"; echo "$LSP_MATCHES"; exit 1; }
# .llxprt status check
git status --short .llxprt
# STUB/fraud scan: no STUB/will-be-implemented in production source (enforcing)
STUB_MATCHES=$(rg -rn -E "(STUB|will be implemented|not yet implemented|placeholder)" packages --include="*.ts" 2>/dev/null | grep -v ".test.ts" | grep -v "settingsRuntimeAdapter.ts.*STUB.*P03b" || true)
test -z "$STUB_MATCHES" && echo "OK: no STUB markers in production" || { echo "FAIL: STUB markers found:"; echo "$STUB_MATCHES"; exit 1; }
# Single-owner bridge scan (enforcing): providerRuntimeContext must NOT import or reference SettingsService or settings singleton functions
PROVIDER_RT_CTX=$(rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null || true)
test -z "$PROVIDER_RT_CTX" && echo "OK: providerRuntimeContext is settings-agnostic" || { echo "FAIL: providerRuntimeContext imports/references settings:"; echo "$PROVIDER_RT_CTX"; exit 1; }
# LLXPRT_DIR coupling resolved: configBaseCore uses local constant, not memoryTool import
rg -n "from.*memoryTool" packages/core/src/config/configBaseCore.ts && echo "WARN: configBaseCore still imports memoryTool for LLXPRT_CONFIG_DIR" || echo "OK: configBaseCore does not import memoryTool"
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-tools" packages/settings/src/storage/Storage.ts && echo "FAIL: Storage imports from core/tools" || echo "OK: Storage uses own LLXPRT_DIR"
# Post-build stale export scan: verify core dist has no moved settings symbols
npm run build
rg -n "SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|ProfileManager|Storage\b|ModelParams|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/dist/src/index.js packages/core/dist/index.js 2>/dev/null || echo "OK: no stale exports in core dist"
# Lockfile verification
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
npm run typecheck
npm run test
```

Expected: no old files/exports/imports/wrappers; no core re-exports of moved types; `modelParams.ts` does not exist; tests and typecheck pass.

## Semantic Verification Checklist

- [ ] Core does not re-export moved APIs for compatibility.
- [ ] Core does not re-export moved profile/model types from `modelParams.ts`.
- [ ] `packages/core/src/types/modelParams.ts` does not exist.
- [ ] Core `package.json` does not have `./types/modelParams.js` subpath export.
- [ ] No wrapper files remain.
- [ ] No consumer imports moved symbols from core root barrel.
- [ ] Existing behavior still passes through settings package.
- [ ] `configConstructor.ts` uses `activateSettingsRuntimeContext()` from core adapter (wired by P06).
- [ ] Settings package has zero consumer imports.
- [ ] `providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package singleton functions (expanded scan enforced from P06 onward).
- [ ] STUB/fraud scan returns zero in production source.
- [ ] No pnpm-lock.yaml created.
- [ ] `configBaseCore.ts` uses local `LLXPRT_DIR` constant (not imported from memoryTool).
- [ ] Settings `Storage.ts` uses own `LLXPRT_DIR` constant (not imported from core/tools).
- [ ] Post-build stale export scan: `packages/core/dist/` has no moved settings/Storage/ProfileManager/modelParams exports.
- [ ] Deterministic workspace graph checks prove no cycles and no forbidden settings dependencies.

## Success Criteria

No-shim cleanup complete.

## Failure Recovery

Fix missed imports; do not restore wrappers unless user changes policy.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P09.md`.
