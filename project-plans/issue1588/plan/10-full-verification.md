# Phase 10: Full Verification Suite

## Phase ID

`PLAN-20260608-ISSUE1588.P10`

## Prerequisites

- Required: Phase 09a verified.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification

**Full Text**: Full repository verification and smoke command are required before check-in.

**Behavior**:

- GIVEN completed extraction
- WHEN full verification suite runs
- THEN repo tests, lint, typecheck, format, build, and smoke command all pass

**Why This Matters**: Multi-package refactors can pass local package checks while failing root workflows.

## Implementation Tasks

No new implementation unless verification fails and fixes are required.

## Verification Commands

**Primary boundary enforcement**: `node scripts/check-settings-boundary.js` is the authoritative boundary check. Inline scans below are supplemental and must be consistent with the script — any discrepancy is resolved in favor of the script.

```bash
# Authoritative boundary check (primary enforcement)
node scripts/check-settings-boundary.js --phase post-p09
# Supplemental inline scans below
npm run test
npm run lint
npm run typecheck
npm run format
# Record format result: git status and diff after format
git status --short
git diff --stat
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
git status --short .llxprt
```

Also run boundary scans from `analysis/phase-verification-matrix.md` including root-barrel moved-symbol import scan, profile/model type import scan, core relative ProfileManager import scan, vi.mock/dynamic import path scan, `modelParams.ts` deletion check, package boundary dependency graph checks, **settings-package consumer-import-free check**, **built-runtime import verification for all documented exports**, and **dynamic deep import scan for `@vybestack/llxprt-code-core/settings/...` and `@vybestack/llxprt-code-core/config/(storage|profileManager)` paths used in dynamic `import()` calls**.

### No packages/storage Verification

```bash
# Verify no packages/storage workspace or package.json was introduced
node -e "const p=require('./package.json'); if (p.workspaces.includes('packages/storage')) { console.error('FAIL: packages/storage found in workspaces'); process.exit(1); } console.log('OK: packages/storage not in workspaces');"
test ! -d packages/storage && echo "OK: no packages/storage directory" || { echo "FAIL: packages/storage directory exists"; exit 1; }
test ! -f packages/storage/package.json && echo "OK: no packages/storage/package.json" || { echo "FAIL: packages/storage/package.json exists"; exit 1; }
```

### Settings Package Export Path Verification

### Deterministic Workspace Dependency Graph Verification

Two separate checks with different scopes (they MUST NOT be merged or conflated — they have different failure conditions):

**Check 1: Production dependency cycle detection** — cycles in production `dependencies` only would break runtime. This check uses `dependencies` only because production cycles are blocking; `devDependencies` cycles are development-only and non-blocking.

```bash
# Production cycle detection (dependencies only)
node -e "
  const fs = require('fs');
  const path = require('path');
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
  console.log('OK: no production cycles in dependencies-only graph:');
  for (const [pkg, deps] of Object.entries(graph)) console.log('  ', pkg, '->', deps.join(', ') || '(none)');
}
"
```

**Check 2: Settings forbidden-dependency check** — settings must not depend on core/providers/CLI/tools/a2a-server even in devDependencies, because dev dependency cycles could still pull those packages into the settings build/test environment. This check uses BOTH `dependencies` AND `devDependencies`.

```bash
# Settings forbidden deps (dependencies AND devDependencies)
node -e "
  const p = require('./packages/settings/package.json');
  const d = {...(p.dependencies||{}), ...(p.devDependencies||{})};
  const forbidden = ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server'];
  const found = forbidden.filter(n => d[n]);
  if (found.length > 0) { console.error('FAIL: settings has forbidden deps:', found.join(', ')); process.exit(1); }
  console.log('OK: settings deps clean. All deps:', Object.keys(d).join(', ') || 'none');
}
"
```

# Verify all documented export paths resolve at runtime (ESM dynamic import)
# PREREQUISITE: npm install and full workspace build must be complete
# Validates against actual package.json export map and built files
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

# Verify settings package has no consumer imports
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts'
```

### Generated Schema/Docs Script Verification

```bash
# Verify schema and docs scripts still work (they import from CLI settingsSchema, not settings registry)
npm run schema:settings
npm run docs:settings
```

### Lockfile/No pnpm-lock Verification

```bash
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
```

### STUB/Fraud Scan (Post-P06)

After P06 has replaced P03b adapter stubs, no `STUB` or `will be implemented` comments should remain in production source:

```bash
rg -rn -E "(STUB|will be implemented|not yet implemented|placeholder)" packages --include="*.ts" | grep -v ".test.ts"
```

Expected: zero matches in production source.

## Semantic Verification Checklist

- [ ] Full suite outputs pasted into completion marker.
- [ ] `npm run format` result recorded: `git status --short` and `git diff --stat` after format included in completion marker.
- [ ] Smoke command output confirms startup path works.
- [ ] Boundary scans pass.
- [ ] `.llxprt/` unchanged (`git status --short .llxprt` shows no modifications to tracked files).
- [ ] Schema/docs scripts verified.
- [ ] Lockfile/no pnpm-lock verification passes.
- [ ] STUB/fraud scan returns zero in production source.
- [ ] `providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan covers both singleton function names AND SettingsService type/import/constructor references — enforced from P06 onward).
- [ ] Deterministic workspace dependency graph checks verify: (1) production cycle detection over `dependencies` only — dev dependency cycles are non-blocking; (2) settings forbidden-dependency check over `dependencies` AND `devDependencies` — dev deps can still pull forbidden packages into settings build/test. These are separate checks with separate scopes and MUST NOT be merged.
- [ ] CLI behavioral test is deterministic: either a concrete CLI integration test or the smoke command `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` is used as the red/green behavioral gate.
- [ ] Deterministic workspace dependency graph check passes: production cycle detection over `dependencies` ONLY; settings forbidden-dependency check over `dependencies` AND `devDependencies`. These are separate checks with separate scopes and MUST NOT be merged.
- [ ] CLI behavioral test is deterministic: either a concrete CLI integration test or the smoke command `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` is used as the red/green gate.

## Success Criteria

All verification commands pass.

## Failure Recovery

Fix failures through the appropriate earlier phase logic and rerun P10.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P10.md`.
