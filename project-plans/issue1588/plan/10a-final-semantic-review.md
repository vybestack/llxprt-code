# Phase 10a: Final Semantic Review

## Phase ID

`PLAN-20260608-ISSUE1588.P10a`

## Prerequisites

- Required: Phase 10 completed.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification

**Full Text**: Verification must be semantic, not only structural.

**Behavior**:

- GIVEN completed implementation and full verification outputs
- WHEN reviewer performs holistic review
- THEN the reviewer can explain why issue #1588 acceptance criteria are satisfied

**Why This Matters**: A final semantic review catches subtle package-boundary and behavior gaps.

## Implementation Tasks

No production implementation. Reviewer must write a holistic assessment covering:

- What moved to settings.
- What stayed in core/CLI and why.
- Dependency graph evidence.
- Behavior preservation evidence.
- Any residual risks or explicitly deferred CLI god-object work.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js --phase post-p09
# Supplemental inline scans below
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'
# Settings package forbidden import scan (enforcing: must return zero)
SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no forbidden imports" || { echo "FAIL: forbidden imports in settings:"; echo "$SETTINGS_IMPORTS"; exit 1; }
rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts'
rg -n "from ['\"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'
rg -n "from ['\"].*config/profileManager" packages/core/src --glob '*.ts'
# Settings root type exports must be gone from core barrel
rg -n "ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/src/index.ts packages/core/index.ts
test ! -f packages/core/src/types/modelParams.ts
# Post-build stale export scan
rg -n "SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|ProfileManager|Storage\b|ModelParams|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY" packages/core/dist/src/index.js packages/core/dist/index.js 2>/dev/null || echo "OK: no stale exports in core dist"
node --input-type=module -e "const p = (await import('fs')).default; const s = JSON.parse(p.readFileSync('./packages/settings/package.json','utf8')); const d={...(s.dependencies||{}),...(s.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('forbidden:', n); process.exit(1); }; console.log('settings deps OK');"
# Deterministic workspace dependency graph: production cycle check (dependencies ONLY) + settings forbidden-dep check (dependencies AND devDependencies). These two checks MUST NOT be merged or conflated — they have different scopes and different failure conditions.
# Check 1: Production dependency cycle detection
node -e "
  const fs = require('fs'); const path = require('path');
  const root = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const graph = {};
  for (const ws of root.workspaces) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
      const deps = pkg.dependencies || {};
      graph[pkg.name] = Object.keys(deps).filter(d => d.startsWith('@vybestack/llxprt-code'));
    } catch {}
  }
  const visited = new Set(); const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) { console.error('FAIL: production cycle involving', node); process.exit(1); }
    if (visited.has(node)) return;
    visited.add(node); stack.add(node);
    for (const dep of (graph[node] || [])) dfs(dep);
    stack.delete(node);
  }
  for (const node of Object.keys(graph)) dfs(node);
  console.log('OK: no production cycles in dependencies-only graph.');
  for (const [pkg, deps] of Object.entries(graph)) console.log('  ', pkg, '->', deps.join(', ') || '(none)');
}
"
# Check 2: Settings forbidden deps (dependencies AND devDependencies)
node -e "
  const p = require('./packages/settings/package.json');
  const d = {...(p.dependencies||{}), ...(p.devDependencies||{})};
  const forbidden = ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server'];
  const found = forbidden.filter(n => d[n]);
  if (found.length > 0) { console.error('FAIL: settings has forbidden deps:', found.join(', ')); process.exit(1); }
  console.log('OK: no forbidden settings deps. All deps:', Object.keys(d).join(', ') || 'none');
}
"
# Single-owner bridge scan: providerRuntimeContext.ts must NOT import, construct, or reference SettingsService or settings singleton functions (enforcing expanded scan)
# This covers both singleton function names AND SettingsService type/import/constructor references
SETTINGS_FN_RESULTS=$(rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null || true)
test -z "$SETTINGS_FN_RESULTS" && echo "OK: providerRuntimeContext is settings-agnostic" || { echo "FAIL: providerRuntimeContext imports/references settings functions/types:"; echo "$SETTINGS_FN_RESULTS"; exit 1; }
# STUB/fraud scan
rg -rn -E "(STUB|will be implemented|not yet implemented|placeholder)" packages --include="*.ts" | grep -v ".test.ts"
# Schema/docs verification
npm run schema:settings 2>&1 | tail -3
npm run docs:settings 2>&1 | tail -3
# Lockfile verification
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
git status --short .llxprt
```

Expected: boundary scans pass; diff is consistent with extraction.

## Semantic Verification Checklist

- [ ] Issue #1588 acceptance criteria mapped to evidence.
- [ ] No circular dependencies.
- [ ] Tests pass in new package.
- [ ] Existing imports updated (deep paths, root barrel, vi.mock, dynamic imports).
- [ ] `modelParams.ts` deleted, not left as shim.
- [ ] Core root barrel does not re-export moved symbols.
- [ ] Core `package.json` does not have moved subpath exports.
- [ ] Deferred CLI code is justified by god-object prerequisite (see CLI deferral inventory in `plan/00-overview.md`).
- [ ] Settings package dependency graph is cycle-free (deterministic Node.js graph check passes).
- [ ] Settings package boundary: no forbidden imports in `packages/settings/**/*.ts(x)`, `package.json` (dependencies + devDependencies), `tsconfig.json`, `vitest.config.ts`.
- [ ] Post-build stale export scan: core dist has no moved settings/Storage/ProfileManager/modelParams exports (including `DiagnosticsInfo` and all settings type exports).
- [ ] Deterministic workspace dependency graph check passes: production cycle detection over `dependencies` ONLY (dev dependency cycles are non-blocking); settings forbidden-dependency check over `dependencies` AND `devDependencies` (dev deps can pull forbidden packages into settings build/test). These are separate checks with separate scopes and MUST NOT be merged.
- [ ] `providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan covers singleton function names, SettingsService type references, and constructor calls — enforced from P06 onward).
- [ ] CLI behavioral test is deterministic: either a concrete CLI integration test or the smoke command `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` is used as the red/green gate. Static import guards alone are insufficient.
- [ ] STUB/fraud scan: zero `STUB`/`will be implemented` in production source.
- [ ] Schema/docs scripts verified.
- [ ] Lockfile/no pnpm-lock verification passes.
- [ ] Test file extensions match repo convention (`.test.ts` and `.spec.ts` used appropriately).
- [ ] `.llxprt/` directory unchanged (`git status --short .llxprt` shows no modifications to tracked files).

## Success Criteria

Reviewer verdict is pass with no material blockers.

## Failure Recovery

Return to the phase that owns the failure.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P10a.md` with holistic assessment.
