# Anti-Shim Policy

Plan ID: PLAN-20260608-ISSUE1588

## Policy

The settings extraction must update consumers to import from `@vybestack/llxprt-code-settings`. It must not preserve old core settings/config paths through wrapper files or re-export compatibility shims.

This follows the issue1584 provider extraction model: package extraction means ownership and import boundaries change. Leaving core wrappers hides the boundary, preserves accidental dependencies, and prevents the acceptance criterion "existing imports updated" from being meaningfully verified.

## Temporary Duplicate vs Shim Distinction

During P05–P08, old core files coexist with new settings package files. This is an **explicit temporary duplicate** for consumer safety, not a compatibility shim. The distinction is critical:

| Attribute | Temporary Duplicate (Allowed) | Compatibility Shim (Forbidden) |
|-----------|------------------------------|-------------------------------|
| Source | Original core code, unchanged | Wrapper forwarding to settings |
| Direction | Consumers import from core → core own code | Consumers import from core → settings (forwarded) |
| Lifecycle | Deleted in P09 | Would persist indefinitely |
| Breaking risk | None — consumers keep working until P08 migrates them | Consumers accidentally rely on shim forever |
| Post-P09 | Both copies gone (old deleted, new is the real code) | Shim would still exist |

**Key rule**: Old core files must NOT `import` from or `export` via `@vybestack/llxprt-code-settings`. They remain independent original code. P09 deletes them unconditionally.

## Forbidden Patterns

Forbidden after P09:

- `packages/core/src/settings/SettingsService.ts` forwarding to settings package
- `packages/core/src/settings/settingsRegistry.ts` forwarding to settings package
- `packages/core/src/settings/settingsServiceInstance.ts` forwarding to settings package
- `packages/core/src/config/storage.ts` forwarding to settings package
- `packages/core/src/config/profileManager.ts` forwarding to settings package
- `packages/core/src/types/modelParams.ts` remaining as a file after all symbols are moved (entire file is deleted)
- core `package.json` subpath exports for moved files including `./types/modelParams.js`
- core `index.ts` re-exporting moved settings/profile/storage APIs for compatibility
- core `index.ts` re-exporting moved profile/model types (`Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `isLoadBalancerProfile`, `isStandardProfile`, `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile`)
- core `index.ts` re-exporting moved settings types (`ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `SettingsService`, `DiagnosticsInfo`)
- core `index.ts` re-exporting settings singleton functions (`getSettingsService`, `registerSettingsService`, `resetSettingsService`) if present
- core `index.ts` re-exporting `SETTINGS_REGISTRY` and related registry utilities
- new files named `SettingsServiceV2`, `SettingsServiceNew`, `SettingsServiceCompat`, `ProfileManagerCompat`, `StorageWrapper`, or similar

## Allowed During Intermediate Phases

Temporary old files may exist only before P09 while imports are being migrated, and only if the phase explicitly records they are not final. P09 must remove them.

**Temporary duplicate policy**: During P05, code is copied (not symlinked or forwarded) into settings package. Old core files remain independently — they are the original code, not shims. Consumers continue importing from old core paths until P08 migrates them. This is explicitly allowed and is NOT a compatibility shim because:
1. Old core files do NOT import from or forward to settings package.
2. The duplication is temporary and P09 deletes all old core files.
3. No consumer is broken between P05 and P08.

Core may still expose config APIs that contain settings objects as part of existing `Config` behavior. That is not a shim if the API is core-owned config behavior, not a moved settings API wrapper.

## Forbidden Scan Commands

All forbidden-import and forbidden-export scans use **enforcing** logic: they capture output into a variable and test for emptiness with explicit fail messages and `exit 1` on non-empty results. Bare `|| true` is NOT used for scans that must return zero matches. The `rg -n` flag is used (not `rg -c`) because `rg -n` shows file:line:content, making failures easy to diagnose. Where `rg -c` was previously used, it has been replaced with `rg -n` capture-and-check-empty patterns or `rg -q` fail/pass patterns.

```bash
# Enforcing: old core settings directory must NOT exist after P09 cleanup
# Use test ! -d for directory existence check (not just find | sort report)
test ! -d packages/core/src/settings && echo "OK: packages/core/src/settings directory removed" || { echo "FAIL: packages/core/src/settings directory still exists"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
CORE_SETTINGS_COUNT=$(find packages/core/src/settings -type f 2>/dev/null | wc -l | tr -d ' ')
test "$CORE_SETTINGS_COUNT" -eq 0 && echo "OK: packages/core/src/settings removed" || { echo "FAIL: packages/core/src/settings has $CORE_SETTINGS_COUNT files"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
# Enforcing: moved files must NOT exist after P09 cleanup
test ! -f packages/core/src/config/storage.ts && echo "OK: config/storage.ts removed" || { echo "FAIL: config/storage.ts still exists"; exit 1; }
test ! -f packages/core/src/config/profileManager.ts && echo "OK: config/profileManager removed" || { echo "FAIL: config/profileManager still exists"; exit 1; }
test ! -f packages/core/src/types/modelParams.ts && echo "OK: types/modelParams.ts removed" || { echo "FAIL: types/modelParams.ts still exists"; exit 1; }
test ! -f packages/core/src/config/storage.test.ts 2>/dev/null && echo "OK: config/storage.test.ts removed" || { echo "FAIL: config/storage.test.ts still exists"; exit 1; }
test ! -f packages/core/src/config/profileManager.test.ts 2>/dev/null && echo "OK: config/profileManager.test.ts removed" || { echo "FAIL: config/profileManager.test.ts still exists"; exit 1; }
test ! -f packages/core/src/settings/__tests__/settingsRegistry.test.ts 2>/dev/null && echo "OK: settings registry test removed" || { echo "FAIL: settings registry test still exists"; exit 1; }
# Check core does not forward to settings package (anti-shim check) — enforcing capture-and-check-empty
FORWARDING=$(rg -n "SettingsService|settingsRegistry|settingsServiceInstance|export \{ Storage \}|from ['\"]@vybestack/llxprt-code-settings" packages/core/src/index.ts packages/core/index.ts packages/core/package.json 2>/dev/null || true)
test -z "$FORWARDING" && echo "OK: no forwarding to settings package" || { echo "FAIL: forwarding to settings package found:"; echo "$FORWARDING"; exit 1; }
# Check no consumers import old paths (enforcing — must return zero)
OLD_PATHS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$OLD_PATHS" && echo "OK: no old path imports" || { echo "FAIL: old path imports found:"; echo "$OLD_PATHS"; exit 1; }
# Check no compatibility-named files exist
find packages -type f 2>/dev/null | rg '(SettingsService|ProfileManager|Storage)(V2|New|Compat|Wrapper|Copy)\.(ts|tsx)$' && echo "FAIL: compatibility-named files found" || echo "OK: no compatibility-named files"
```

### Extended Scans: Moved Profile/Model Types And Root Exports

These scans detect core re-exports of moved profile/model/settings types, which would be compatibility shims:

```bash
# Core root barrel re-exports of moved type symbols
rg -n "export.*\{[^}]*(Profile|StandardProfile|LoadBalancerProfile|ModelParams|EphemeralSettings|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}" packages/core/src/index.ts packages/core/index.ts || echo "OK: no moved profile/model type re-exports in core barrel"

# Core root barrel re-exports of moved settings types and singleton functions
rg -n "export.*\{[^}]*(SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY)[^}]*\}" packages/core/src/index.ts packages/core/index.ts || echo "OK: no moved settings type/singleton re-exports in core barrel"

# Core package subpath export for moved modelParams types
MODELPARAMS_EXPORT=$(rg -n "modelParams" packages/core/package.json packages/core/src/index.ts 2>/dev/null || true)
test -z "$MODELPARAMS_EXPORT" && echo "OK: no modelParams subpath export" || { echo "FAIL: modelParams subpath export found:"; echo "$MODELPARAMS_EXPORT"; exit 1; }

# Consumer imports of moved profile/model types from core root or deep paths
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts'

# Core relative imports of moved profileManager from remaining core files
PROFILEREL_IMPORTS=$(rg -n "from ['\"].*config/profileManager" packages/core/src --glob '*.ts' 2>/dev/null || true)
test -z "$PROFILEREL_IMPORTS" && echo "OK: no core relative profileManager imports" || { echo "FAIL: core relative profileManager imports found:"; echo "$PROFILEREL_IMPORTS"; exit 1; }
```

Expected final state: zero matches. Any core re-export of moved types is a forbidden compatibility shim. `packages/core/src/types/modelParams.ts` must not exist after P09.

Expected final state:

- No moved core settings files remain.
- `packages/core/src/types/modelParams.ts` is deleted entirely.
- No core package exports expose moved settings subpaths or moved type subpaths.
- No core root barrel re-exports moved settings/profile/storage/model-parameter symbols.
- No consumer imports old core settings/storage/profileManager paths.
- No consumer imports moved profile/model types from core (root or deep paths).
- No compatibility-named duplicate files exist.

### Blocklist: Current Core Root Settings Type Exports (Must Be Removed in P09)

The following symbols are currently exported from `packages/core/index.ts` or `packages/core/src/index.ts` and MUST be removed during P09 cleanup. They represent moved settings types, singleton functions, and registry utilities that belong in `@vybestack/llxprt-code-settings`:

**Settings types**: `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`

**Settings singleton functions**: `getSettingsService`, `registerSettingsService`, `resetSettingsService`

**Settings registry**: `SETTINGS_REGISTRY` and related registry utility functions

**Settings service class**: `SettingsService`

**Profile/storage classes**: `ProfileManager`, `Storage`

**All moved symbols (complete list for scans)**: `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`, `SettingsService`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `ProfileManager`, `Storage`, `ModelParams`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `EphemeralSettings`, `isLoadBalancerProfile`, `isStandardProfile`, `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile`, `LoadBalancerConfig`, `LoadBalancerSubProfileConfig`

Scans must check for ALL of these in core barrel re-exports and `package.json` subpath exports. Any remaining re-export of these symbols from core after P09 is a forbidden compatibility shim.

## Review Requirement

Every CodeRabbit or human suggestion to preserve compatibility through core re-exports must be evaluated against this policy. Backward compatibility may be introduced only if the plan is explicitly changed with user approval and a cycle-free deprecation strategy.
