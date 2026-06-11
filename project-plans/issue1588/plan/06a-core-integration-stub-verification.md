# Phase 06a: Core Integration Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P06a`

## Prerequisites

- Required: Phase 06 completed.

## Requirements Implemented (Expanded)

### REQ-CONS-001: Consumer Migration

**Full Text**: Core must import moved settings/profile/storage APIs from settings package.

**Behavior**:

- GIVEN P06 core changes
- WHEN reviewer checks runtime/config data flow
- THEN core is a consumer, not owner, of moved settings APIs

**Why This Matters**: Core integration is the largest cycle risk.

## Implementation Tasks

No production implementation. Review core changes and tests.

## Verification Commands

```bash
rg -n "from ['\"].*\.\./settings|from ['\"].*\.\/storage|from ['\"].*\.\/profileManager|from ['\"].*config/profileManager" packages/core/src --glob '*.ts'
rg -n "@vybestack/llxprt-code-settings" packages/core/src packages/core/package.json packages/core/tsconfig.json
# Enforcing single-owner bridge scan (same script as P06)
node -e "
  const { execSync } = require('child_process');
  try {
    const singletonFiles = execSync(
      'grep -rl "registerSettingsService\|resetSettingsService" packages/core/src --include=\"*.ts\" | grep -v settingsRuntimeAdapter | grep -v .test. | grep -v __tests__',
      { encoding: 'utf8' }
    ).trim();
    if (!singletonFiles) { console.log('OK: no production files import register/reset outside adapter'); process.exit(0); }
    const files = singletonFiles.split('\n').filter(Boolean);
    const violations = [];
    for (const f of files) {
      try {
        const content = execSync('cat "' + f + '"', { encoding: 'utf8' });
        if (content.includes('setActiveProviderRuntimeContext') || content.includes('clearActiveProviderRuntimeContext') || content.includes('createProviderRuntimeContext')) {
          violations.push(f);
        }
      } catch {}
    }
    if (violations.length > 0) {
      console.error('FAIL: single-owner violation:'); violations.forEach(v => console.error('  ' + v)); process.exit(1);
    }
    console.log('OK: no single-owner violations');
  } catch (e) { console.log('OK: no production files import register/reset outside adapter'); process.exit(0); }
"
# Verify providerRuntimeContext.ts does NOT import or reference SettingsService or settings functions (enforcing)
! grep -n "SettingsService\|registerSettingsService\|resetSettingsService\|getSettingsService\|@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts && echo "OK: providerRuntimeContext is settings-agnostic" || { echo "FAIL: providerRuntimeContext imports/references settings"; exit 1; }
# Rerun P04b core integration test as pass gate (P06a is the first pass gate for production configConstructor/runtime wiring — adapter is now fully implemented and configConstructor is wired)
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration
# Deterministic workspace dependency graph check: no production cycles, settings has no forbidden deps
# Cycle DFS uses production dependencies ONLY (aligns with P05a semantics).
# Forbidden-deps check covers both dependencies AND devDependencies for settings.
node -e "
  const fs = require('fs'); const path = require('path');
  const root = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const prodGraph = {};
  const allDepsGraph = {};
  for (const ws of root.workspaces) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
      const prodDeps = pkg.dependencies || {};
      const allDeps = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
      prodGraph[pkg.name] = Object.keys(prodDeps).filter(d => d.startsWith('@vybestack/llxprt-code'));
      allDepsGraph[pkg.name] = Object.keys(allDeps).filter(d => d.startsWith('@vybestack/llxprt-code'));
    } catch {}
  }
  // Forbidden deps check: check both prod and dev for settings package
  const forbidden = ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server'];
  const settingsAllDeps = allDepsGraph['@vybestack/llxprt-code-settings'] || [];
  const found = settingsAllDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('FAIL: settings has forbidden workspace deps:', found.join(', ')); process.exit(1); }
  // Cycle DFS: production dependencies only (dev-only cycles like core <-> test-utils are acceptable)
  const visited = new Set(); const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) { console.error('FAIL: production dependency cycle detected involving', node); process.exit(1); }
    if (visited.has(node)) return;
    visited.add(node); stack.add(node);
    for (const dep of (prodGraph[node] || [])) dfs(dep);
    stack.delete(node);
  }
  for (const node of Object.keys(prodGraph)) dfs(node);
  console.log('OK: no forbidden settings deps, no production cycles in workspace graph');
"
# Settings source has no forbidden imports (enforcing)
SETTINGS_SRC_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code-tools" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_SRC_IMPORTS" && echo "OK: settings source has no forbidden imports" || { echo "FAIL: forbidden imports:"; echo "$SETTINGS_SRC_IMPORTS"; exit 1; }
# Post-build stale export scan: verify core dist does not re-export moved settings symbols
# (During P05-P08 old core files still exist, so core dist WILL contain old symbols.
# This scan is a pre-check to establish the pattern. P09/P09a enforce zero stale exports.)
npm run build
rg -n "SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/dist/src/index.js packages/core/dist/index.js 2>/dev/null | head -10 && echo "NOTE: core dist still has old exports (expected before P09 cleanup)" || echo "OK: core dist has no old settings exports"
# LLXPRT_DIR constant identity verification: configBaseCore uses local constant, not memoryTool import
rg -n "from.*memoryTool" packages/core/src/config/configBaseCore.ts && echo "WARN: configBaseCore still imports memoryTool for LLXPRT_CONFIG_DIR" || echo "OK: configBaseCore uses local LLXPRT_DIR"
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-tools" packages/settings/src/storage/Storage.ts && echo "FAIL: Storage imports from core/tools" || echo "OK: Storage uses own LLXPRT_DIR constant"
```

Expected: core uses settings package for moved APIs; no relative moved imports remain in core production files (including `subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts`).

## Semantic Verification Checklist

- [ ] Core `Config` accessors still return usable settings/profile/storage objects.
- [ ] Runtime context lifecycle is behaviorally tested.
- [ ] No core-to-providers dependency added.
- [ ] Core internal ProfileManager consumers (`subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts`) import from settings package.
- [ ] No core relative imports of `profileManager` remain.
- [ ] `registerSettingsService` does not import or create core `ProviderRuntimeContext`.
- [ ] Core adapter code bridges context creation via `settingsRuntimeAdapter.ts`.
- [ ] `deactivateSettingsRuntimeContext()` clears both context and settings state.
- [ ] `configConstructor.ts` uses `activateSettingsRuntimeContext()`, not direct `registerSettingsService()` (P06 wires this production call-site switch; P03b did NOT wire it).
- [ ] `resetSettingsService()` from settings does not call `clearActiveProviderRuntimeContext()`.
- [ ] `providerRuntimeContext.ts` does NOT import or reference `SettingsService` or settings-package singleton functions (`registerSettingsService`, `resetSettingsService`, `getSettingsService`) — it stays settings-agnostic. Scan checks for both function names AND `SettingsService` type/import references.
- [ ] Adapter permitted bridge scan passes: only `settingsRuntimeAdapter.ts` bridges both calls in production code.
- [ ] P04b core integration test passes (rerun as pass gate at P06a — P06a is the first pass gate for production configConstructor/runtime wiring; core adapter is now fully implemented and configConstructor is wired, so the test must pass).
- [ ] `configBaseCore.ts` does NOT import `LLXPRT_CONFIG_DIR` from `memoryTool.ts` (uses local constant).
- [ ] Settings `Storage.ts` uses its own `LLXPRT_DIR` constant (no import from core/tools).
- [ ] Deterministic workspace graph check passes: no cycles, settings has no forbidden workspace deps.
- [ ] Settings source has no forbidden imports (enforcing scan passes).
- [ ] Post-build stale export scan: core dist verified for moved settings exports (pre-check).

## Success Criteria

Core integration is ready for broad consumer migration.

## Failure Recovery

Return to P06.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P06a.md`.
