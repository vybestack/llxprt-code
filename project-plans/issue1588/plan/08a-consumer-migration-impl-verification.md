# Phase 08a: Consumer Migration Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P08a`

## Prerequisites

- Required: Phase 08 completed.

## Requirements Implemented (Expanded)

### REQ-CONS-001 / REQ-DEP-001

**Full Text**: Consumers must import moved APIs from settings package, and dependency direction must remain cycle-free.

**Behavior**:

- GIVEN P08 migration
- WHEN reviewer checks imports, metadata, and behavior
- THEN migration is complete without shims or cycles

**Why This Matters**: This is the main acceptance gate before deletion/cleanup.

## Implementation Tasks

No production implementation. Review migration.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js
# Supplemental inline scans below
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'
rg -n "@vybestack/llxprt-code-settings" packages/core/package.json packages/providers/package.json packages/cli/package.json packages --glob '*.ts'
node --input-type=module -e "const p = (await import('fs')).default; const s = JSON.parse(p.readFileSync('./packages/settings/package.json','utf8')); const d={...(s.dependencies||{}),...(s.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('forbidden:', n); process.exit(1); }; console.log('settings deps OK');"
# Verify settings package has no consumer imports (enforcing)
SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no consumer imports" || { echo "FAIL: forbidden imports in settings:"; echo "$SETTINGS_IMPORTS"; exit 1; }
# Deterministic workspace dependency graph check
node -e "
  const fs = require('fs'); const path = require('path');
  const root = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const graph = {};
  for (const ws of root.workspaces) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
      const deps = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
      graph[pkg.name] = Object.keys(deps).filter(d => d.startsWith('@vybestack/llxprt-code'));
    } catch {}
  }
  const visited = new Set(); const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) { console.error('FAIL: cycle involving', node); process.exit(1); }
    if (visited.has(node)) return;
    visited.add(node); stack.add(node);
    for (const dep of (graph[node] || [])) dfs(dep);
    stack.delete(node);
  }
  for (const node of Object.keys(graph)) dfs(node);
  console.log('OK: no cycles in workspace graph');
"
# Verify core uses adapter
rg -n "activateSettingsRuntimeContext" packages/core/src/config/configConstructor.ts
# Rerun all vertical-slice integration tests as pass gate (including P07 provider/CLI tests)
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/__tests__/settings-integration
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration
# Built-runtime ESM import verification for all documented exports
node --input-type=module -e "
  const paths = ['.', './settings/SettingsService.js', './settings/settingsServiceInstance.js', './settings/settingsRegistry.js', './profiles/ProfileManager.js', './profiles/types.js', './storage/Storage.js'];
  for (const p of paths) {
    try {
      const mod = await import('@vybestack/llxprt-code-settings' + (p === '.' ? '' : '/' + p.replace('./', '')));
      console.log('OK:', p);
    } catch (e) {
      console.error('FAIL:', p, e.message);
      process.exitCode = 1;
    }
  }
"
```

Expected: old imports zero; dependencies declared; settings has no forbidden deps.

## Semantic Verification Checklist

- [ ] Read representative provider and CLI migrated files.
- [ ] Confirm import changes did not alter behavior logic.
- [ ] Confirm package metadata matches imports.
- [ ] `configConstructor.ts` uses `activateSettingsRuntimeContext()` (P06 wired this; P08a verifies it remains intact).
- [ ] Settings package has zero consumer imports.
- [ ] Test cleanup files migrated per `call-site-migration-matrix.md` classifications.
- [ ] All vertical-slice integration tests pass (core from P04b, provider/CLI from P07; rerun as pass gate after P08 implementation).
- [ ] Built-runtime ESM dynamic import verification passes for all documented exports.
- [ ] Refreshed full import inventory (including providers deep imports and all workspaces including `packages/lsp`) confirms zero old-path matches before proceeding to P09.

## Success Criteria

Ready for old file/export cleanup.

## Failure Recovery

Return to P08.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P08a.md`.
