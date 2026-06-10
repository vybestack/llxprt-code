# Phase 09a: Cleanup Semantic Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P09a`

## Prerequisites

- Required: Phase 09 completed.

## Requirements Implemented (Expanded)

### REQ-CONS-001 / REQ-TEST-001

**Full Text**: No old core deep settings exports remain, and tests must prove behavior.

**Behavior**:

- GIVEN cleanup phase output
- WHEN reviewer checks source, package exports, tests, and behavior
- THEN the extraction is real and behavior-preserving

**Why This Matters**: Cleanup often regresses behavior or leaves hidden shims.

## Implementation Tasks

No production implementation. Review cleanup and write holistic assessment.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js --phase post-p09
# Supplemental inline scans below
npm run typecheck
npm run test
# Enforcing: old deep-path imports must be zero
OLD_PATHS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$OLD_PATHS" && echo "OK: no old path imports" || { echo "FAIL: old path imports found:"; echo "$OLD_PATHS"; exit 1; }
# Enforcing: old core settings directory must NOT exist after P09 cleanup
test ! -d packages/core/src/settings && echo "OK: packages/core/src/settings directory removed" || { echo "FAIL: packages/core/src/settings directory still exists"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
CORE_SETTINGS_COUNT=$(find packages/core/src/settings -type f 2>/dev/null | wc -l | tr -d ' ')
test "$CORE_SETTINGS_COUNT" -eq 0 && echo "OK: packages/core/src/settings removed" || { echo "FAIL: packages/core/src/settings still has $CORE_SETTINGS_COUNT files"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
# Include packages/lsp (enforcing)
LSP_MATCHES=$(rg -n "@vybestack/llxprt-code-core/settings|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null || true)
test -z "$LSP_MATCHES" && echo "OK: no unmigrated LSP imports" || { echo "FAIL: unmigrated LSP imports found:"; echo "$LSP_MATCHES"; exit 1; }
# Deep dynamic import scan (enforcing: must return zero)
DEEP_DYNAMIC=$(rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$DEEP_DYNAMIC" && echo "OK: no deep dynamic imports of old paths" || { echo "FAIL: deep dynamic imports found:"; echo "$DEEP_DYNAMIC"; exit 1; }
# STUB/fraud scan — no STUB/will-be-implemented comments should remain after P06 (enforcing: exit 1 on non-empty)
STUB_MATCHES=$(rg -rn -E "(STUB|will be implemented|not yet implemented|placeholder)" packages --include="*.ts" 2>/dev/null | grep -v ".test.ts" | grep -v "settingsRuntimeAdapter.ts.*STUB.*P03b" || true)
test -z "$STUB_MATCHES" && echo "OK: no STUB markers in production" || { echo "FAIL: STUB markers found:"; echo "$STUB_MATCHES"; exit 1; }
# Post-build stale export scan: verify core dist does not contain moved settings exports (enforcing)
STALE_EXPORTS=$(rg -n "SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|ProfileManager|Storage\b|modelParams|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/dist/src/index.js packages/core/dist/index.js 2>/dev/null || true)
test -z "$STALE_EXPORTS" && echo "OK: no stale exports in core dist" || { echo "FAIL: stale exports in core dist:"; echo "$STALE_EXPORTS"; exit 1; }
# Verify core dist declarations don't have moved types (enforcing)
STALE_TYPES=$(rg -n "SettingsService|ProfileManager|Storage\b|ModelParams|Profile|StandardProfile|LoadBalancerProfile" packages/core/dist/src/types/ 2>/dev/null || true)
test -z "$STALE_TYPES" && echo "OK: no stale type declarations in core dist" || { echo "FAIL: stale type declarations in core dist:"; echo "$STALE_TYPES"; exit 1; }
# Single-owner bridge scan: providerRuntimeContext.ts must NOT import, construct, or reference SettingsService or settings singleton functions (enforcing expanded scan)
SETTINGS_FN_RESULTS=$(rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null || true)
test -z "$SETTINGS_FN_RESULTS" && echo "OK: providerRuntimeContext is settings-agnostic" || { echo "FAIL: providerRuntimeContext imports/references settings functions/types:"; echo "$SETTINGS_FN_RESULTS"; exit 1; }
# Enforcing: old core settings directory must NOT exist after P09 cleanup
CORE_SETTINGS_COUNT=$(find packages/core/src/settings -type f 2>/dev/null | wc -l | tr -d ' ')
test "$CORE_SETTINGS_COUNT" -eq 0 && echo "OK: packages/core/src/settings removed" || { echo "FAIL: packages/core/src/settings still has $CORE_SETTINGS_COUNT files"; find packages/core/src/settings -type f 2>/dev/null; exit 1; }
# Enforcing: moved files must NOT exist after P09 cleanup
test ! -f packages/core/src/config/storage.ts && echo "OK: config/storage.ts removed" || { echo "FAIL: config/storage.ts still exists"; exit 1; }
test ! -f packages/core/src/config/profileManager.ts && echo "OK: config/profileManager removed" || { echo "FAIL: config/profileManager still exists"; exit 1; }
test ! -f packages/core/src/types/modelParams.ts && echo "OK: types/modelParams.ts removed" || { echo "FAIL: types/modelParams.ts still exists"; exit 1; }
# Lockfile verification
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
git status --short .llxprt
```

Expected: all pass; no old settings files/imports.

## Semantic Verification Checklist

- [ ] Trace settings use from core config to settings package.
- [ ] Trace provider settings use to settings package.
- [ ] Trace profile save/load to settings package.
- [ ] Confirm no shims.
- [ ] STUB/fraud scan returns zero in production source (post-P06).
- [ ] providerRuntimeContext.ts does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan enforced from P06).
- [ ] No pnpm-lock.yaml created.

## Success Criteria

Extraction is ready for full verification.

## Failure Recovery

Return to P09.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P09a.md`.
