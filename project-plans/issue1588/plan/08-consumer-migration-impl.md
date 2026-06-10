# Phase 08: Consumer Migration Implementation

## Phase ID

`PLAN-20260608-ISSUE1588.P08`

## Prerequisites

- Required: Phase 07a verified.
- **Refreshed full import inventory required**: Before starting P08 implementation, run the complete import inventory commands below and record actual counts in phase completion marker. These commands are canonical for P08 — do not use ad-hoc alternatives.

```bash
# 1. Root-barrel moved-symbol imports
rg -c "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Root-barrel:", sum+0, "matches"}'
# 2. Deep-path old core settings/config imports
rg -c "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Deep-path:", sum+0, "matches"}'
# 3. Type imports from core/types/modelParams
rg -c "from ['"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Type imports:", sum+0, "matches"}'
# 4. vi.mock paths
rg -c "vi\.mock.*['"].*settings/|vi\.mock.*['"].*config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "vi.mock paths:", sum+0, "matches"}'
# 5. Dynamic import() calls
rg -c "import\(['"]@vybestack/llxprt-code-core/settings/|import\(['"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Dynamic imports:", sum+0, "matches"}'
# 6. Core relative ProfileManager imports
rg -c "from ['"].*config/profileManager" packages/core/src --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Core relative ProfileManager:", sum+0, "matches"}'
# 7. LSP old imports
rg -c "@vybestack/llxprt-code-core/settings|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "LSP imports:", sum+0, "matches"}'
# 8. a2a-server old imports (verification)
rg -n "import.*Storage|import.*SettingsService|import.*ProfileManager|import.*getSettingsService|import.*registerSettingsService|import.*resetSettingsService|import.*SETTINGS_REGISTRY" packages/a2a-server/src --glob '*.ts' 2>/dev/null | head -20
```

## Requirements Implemented (Expanded)

### REQ-CONS-001: Consumer Migration

**Full Text**: Existing imports must be updated to use the new settings package and existing CLI/provider behavior must remain reachable.

**Behavior**:

- GIVEN settings package and consumer tests
- WHEN imports and package metadata are migrated
- THEN consumers compile and behavior passes through new settings package imports

**Why This Matters**: This completes the visible package boundary migration.

## Implementation Tasks

### Files to Modify

- `packages/providers/package.json`, `tsconfig.json` (add settings path aliases), `vitest.config.ts` (add settings workspace alias), production imports, tests (including vi.mock path updates).
- `packages/cli/package.json`, `tsconfig.json` (add settings path aliases if needed), moved API imports.
- `packages/core/package.json`, `tsconfig.json` (add settings path aliases), imports and exports (remove moved root-barrel re-exports).
- `packages/a2a-server` and `packages/test-utils` only where direct old imports exist.
- `packages/core/src/config/configConstructor.ts` — verify that `activateSettingsRuntimeContext()` is used instead of direct `registerSettingsService()`. P06 wired this; P08 only verifies the wiring remains intact during consumer migration.
- All test files listed in `analysis/call-site-migration-matrix.md` as `TEST-CLEANUP` — update import paths to settings package.
- Test files that relied on `resetSettingsService()` clearing the runtime context — add explicit `clearActiveProviderRuntimeContext()` calls or switch to `deactivateSettingsRuntimeContext()`.

Follow `analysis/pseudocode/consumer-migration.md` lines 01-23 and `analysis/call-site-migration-matrix.md` for per-site migration actions.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js
# Supplemental inline scans below
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code
npm run test --workspace @vybestack/llxprt-code-providers
npm run test --workspace @vybestack/llxprt-code-core
# Enforcing: old deep-path imports must be zero after P08
OLD_DEEP_PATHS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$OLD_DEEP_PATHS" && echo "OK: no old deep-path imports" || { echo "FAIL: old deep-path imports found:"; echo "$OLD_DEEP_PATHS"; exit 1; }
# Enforcing: root-barrel moved-symbol imports from core must be zero
ROOT_BARREL=$(rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts' 2>/dev/null || true)
test -z "$ROOT_BARREL" && echo "OK: no root-barrel moved-symbol imports from core" || { echo "FAIL: root-barrel moved-symbol imports from core:"; echo "$ROOT_BARREL"; exit 1; }
# Enforcing: no old vi.mock/dynamic import paths
MOCK_PATHS=$(rg -n "vi\.mock.*['\"].*settings/|vi\.mock.*['\"].*config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$MOCK_PATHS" && echo "OK: no old vi.mock paths" || { echo "FAIL: old vi.mock paths found:"; echo "$MOCK_PATHS"; exit 1; }
# Enforcing: no deep dynamic imports of old core settings/config paths
DEEP_DYNAMIC=$(rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$DEEP_DYNAMIC" && echo "OK: no deep dynamic imports" || { echo "FAIL: deep dynamic imports found:"; echo "$DEEP_DYNAMIC"; exit 1; }
# Include packages/lsp in scan (enforcing)
LSP_IMPORTS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null || true)
test -z "$LSP_IMPORTS" && echo "OK: no unmigrated LSP imports" || { echo "FAIL: unmigrated LSP imports found:"; echo "$LSP_IMPORTS"; exit 1; }
# Behavioral CLI test requirement: at least one behavioral test must exercise CLI settings/profile path
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | tail -5 || echo "Note: CLI integration test may not exist yet"
# CLI smoke test as behavioral verification
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Expected: typechecks/tests pass; old import scans zero or only documented false positives before P09 cleanup.

## Semantic Verification Checklist

- [ ] Provider model/base URL/auth/settings tests pass.
- [ ] CLI profile/settings behavior remains reachable.
- [ ] Consumers have package dependencies matching imports.
- [ ] CLI-specific god-object code was not moved without approval.
- [ ] At least one behavioral CLI-owned test or executable/root entrypoint test exists after import migration (static guards are supplemental only).
- [ ] `configConstructor.ts` uses `activateSettingsRuntimeContext()` — P06 owns this wiring; P08 verifies it remains intact after consumer migration.
- [ ] No vi.mock paths still reference old core settings/config paths.
- [ ] No dynamic imports still reference old core paths.
- [ ] Deep dynamic import scan for `@vybestack/llxprt-code-core/settings/...` and `@vybestack/llxprt-code-core/config/(storage|profileManager)` paths returns zero.
- [ ] `packages/lsp` imports are scanned and migrated if needed.
- [ ] tsconfig.json path aliases for settings exist in providers/core/CLI.
- [ ] vitest.config.ts alias plugin includes settings in providers where needed.

## Success Criteria

All consumers use settings package for moved APIs.

## Failure Recovery

Fix imports/package metadata; do not add core compatibility wrappers.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P08.md`.
