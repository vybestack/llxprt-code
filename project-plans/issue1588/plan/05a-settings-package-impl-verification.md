# Phase 05a: Settings Package Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P05a`

## Prerequisites

- Required: Phase 05 completed.

## Requirements Implemented (Expanded)

### REQ-SET-001 / REQ-DEP-001 / REQ-PROF-001 / REQ-REG-001 / REQ-SVC-001

**Full Text**: Settings package must own moved APIs, preserve behavior, and remain cycle-free.

**Behavior**:

- GIVEN P05 implementation
- WHEN reviewer traces code and runs checks
- THEN the settings package is independent and behavior-preserving

**Why This Matters**: Independent package success must be proven before consumer migration.

## Implementation Tasks

No production implementation. Review code and run commands.

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-settings
npm run lint --workspace @vybestack/llxprt-code-settings
npm run typecheck --workspace @vybestack/llxprt-code-settings
npm run build --workspace @vybestack/llxprt-code-settings
# Forbidden import scan (enforcing: must return zero matches)
SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no forbidden imports" || { echo "FAIL: forbidden imports found:"; echo "$SETTINGS_IMPORTS"; exit 1; }
# Package metadata boundary: check both dependencies and devDependencies
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('FORBIDDEN:', n); process.exit(1); }; console.log('settings deps OK')"
# Deterministic workspace dependency graph check: settings has no forbidden deps, no production cycles
# Uses ONLY production dependencies for cycle detection (devDependencies are test-only and do not create production cycles).
# Settings forbidden-deps check still covers both dependencies and devDependencies.
node -e "
  const fs = require('fs'); const path = require('path');
  const root = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const prodGraph = {};
  const allDeps = {};
  for (const ws of root.workspaces) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
      prodGraph[pkg.name] = Object.keys(pkg.dependencies||{}).filter(d => d.startsWith('@vybestack/llxprt-code'));
      allDeps[pkg.name] = Object.keys({...pkg.dependencies,...(pkg.devDependencies||{})}).filter(d => d.startsWith('@vybestack/llxprt-code'));
    } catch {}
  }
  const forbidden = ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server'];
  const settingsAll = allDeps['@vybestack/llxprt-code-settings'] || [];
  const found = settingsAll.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('FAIL: settings has forbidden workspace deps:', found.join(', ')); process.exit(1); }
  const visited = new Set(); const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) { console.error('FAIL: production cycle detected involving', node); process.exit(1); }
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
# Note: P04b core integration test pass gate is NOT run in P05a.
# REASON: At P05a, settings package is fully implemented but the core adapter
# (settingsRuntimeAdapter.ts) is still a transparent no-op from P03b.
# The P04b test exercises activateSettingsRuntimeContext from the adapter,
# which is a no-op pass-through at this stage. Running the test here would
# not validate the settings implementation because the adapter has no
# behavioral wiring yet — it would produce a false-positive or false-negative.
# The pass gate is MOVED to P06a (after P06 implements the adapter and wires configConstructor).
# Provider/CLI vertical-slice integration tests are deferred to P07/P08a.

# Built-runtime import verification: MUST run after full root build, not only settings package build
# This ensures all cross-package references are resolved correctly
# PREREQUISITE: npm install and full workspace build must be complete
# Validating against actual package.json export map and built files
npm run build
node --input-type=module -e "
  const fs = await import('fs');
  const path = await import('path');
  const pkg = JSON.parse(fs.readFileSync('./packages/settings/package.json', 'utf8'));
  const paths = ['.', ...Object.keys(pkg.exports).filter(k => k !== '.')];
  for (const p of paths) {
    const importSpecifier = p === '.' ? '@vybestack/llxprt-code-settings' : '@vybestack/llxprt-code-settings/' + p.replace('./', '');
    // Verify built file exists for each declared export
    const exportEntry = pkg.exports[p];
    const jsPath = typeof exportEntry === 'object' ? exportEntry.import : exportEntry;
    const fullPath = path.join('./packages/settings', jsPath);
    if (!fs.existsSync(fullPath)) { console.error('FAIL: built export', p, 'missing:', fullPath); process.exitCode = 1; continue; }
    try {
      const mod = await import(importSpecifier);
      console.log('OK:', p);
    } catch (e) {
      console.error('FAIL:', p, e.message);
      process.exitCode = 1;
    }
  }
"
# Schema/docs early verification
npm run schema:settings 2>&1 | tail -3
npm run docs:settings 2>&1 | tail -3
# No pnpm lockfile created
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
```

Expected: all pass; forbidden import scan zero.

## Semantic Verification Checklist

- [ ] Read implementation, not just tests.
- [ ] Trace a settings set/get flow.
- [ ] Trace a profile save/load flow.
- [ ] Trace singleton register/get/reset flow.
- [ ] Confirm no placeholder/deferred work in implementation.
- [ ] Settings tests verify ONLY settings-owned state (no core ProviderRuntimeContext creation/clearing assertions in settings package tests). Core adapter behavior is tested in core tests (P06).
- [ ] P05 temporary duplicate policy is followed: old core files still exist independently; no shims/forwarding from core to settings.
- [ ] Settings package boundary: no forbidden imports in `packages/settings/**/*.ts(x)`, `package.json` (dependencies and devDependencies), `tsconfig.json`, or `vitest.config.ts`.
- [ ] Schema/docs scripts still work (early check).
- [ ] No pnpm-lock.yaml created.
- [ ] P04b core integration test pass gate is NOT run in P05a (deferred to P06a after adapter implementation). At P05a the adapter is still a transparent no-op, so the pass gate would not validate genuine settings implementation through the adapter path.
- [ ] LLXPRT_DIR constant: settings Storage uses own `LLXPRT_DIR = '.llxprt'` constant, no import from core/tools.
- [ ] Deterministic workspace graph checks prove no cycles and no forbidden settings dependencies.
- [ ] Root build ordering verified: settings builds before core/providers/CLI (evidence recorded).

## Success Criteria

Settings package is ready for core/providers/CLI migration.

## Failure Recovery

Return to P05.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P05a.md` with holistic assessment.
