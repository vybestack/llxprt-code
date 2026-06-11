# Package Metadata Constraints: Anti-Cycle Assertions

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

Following the issue1584 provider extraction pattern, this document defines concrete package.json and tsconfig anti-cycle assertions for the tools package.

## Dependency Direction (Approved)

```
packages/tools      -> no core/cli/providers imports
packages/core       -> packages/tools
packages/providers  -> packages/tools + packages/core as still required by issue #1584 interim architecture
packages/cli        -> packages/core + packages/providers only
packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented
packages/a2a-server -> packages/core (ToolRegistry via core re-exports; no direct tools dependency)
```

## package.json Assertions

### Assertion 1: tools has no core/providers/cli dependency

```bash
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
```

Expected: exit code 0 (no forbidden dependencies).

### Assertion 2: test-utils is devDependency-only

```bash
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
```

Expected: exit code 0 (test-utils not in runtime dependencies).

### Assertion 3: core depends on tools

```bash
node -e "const p=require('./packages/core/package.json'); const d=p.dependencies||{}; if (!d['@vybestack/llxprt-code-tools']) process.exit(1)"
```

Expected: exit code 0 (core has tools dependency).

### Assertion 4: providers depends on tools (after P13)

```bash
node -e "const p=require('./packages/providers/package.json'); const d=p.dependencies||{}; if (!d['@vybestack/llxprt-code-tools']) process.exit(1)"
```

Expected: exit code 0 (providers has tools dependency after migration).

### Assertion 5: tools exports exist

```bash
node -e "const p=require('./packages/tools/package.json'); if (!p.exports || !p.exports['.']) process.exit(1)"
```

Expected: exit code 0 (tools has exports map).

### Assertion 6: CLI dependency on tools is conditional

CLI does NOT currently have direct imports from `@vybestack/llxprt-code-tools`. Per approved dependency direction: packages/cli -> packages/core + packages/providers only; packages/cli -X-> packages/tools unless direct imports are intentionally added and documented. CLI uses only core top-level re-exports, so CLI does NOT need a direct tools dependency.

```bash
# CLI should NOT have direct tools dependency (it uses core re-exports)
node -e "const p=require('./packages/cli/package.json'); const d=p.dependencies||{}; if (d['@vybestack/llxprt-code-tools']) { console.log('WARNING: CLI has direct tools dependency - verify this is intentional and documented'); process.exit(0); }"
```

### Assertion 6b: A2A server does not depend directly on tools

A2A server uses ToolRegistry through core re-exports. Verify A2A does not need a direct tools dependency.

```bash
node -e "const p=require('./packages/a2a-server/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-tools']) { console.log('WARNING: A2A has direct tools dependency — verify this is intentional'); process.exit(0); }"
```

Verification: After P13, `npm run typecheck --workspace @vybestack/llxprt-code-a2a-server` and `npm run test --workspace @vybestack/llxprt-code-a2a-server` must pass.

### Assertion 6c: package-lock.json includes tools

```bash
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
```

### Assertion 6d: Root workspaces include tools

```bash
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
```

### Assertion 7: tools has no circular dependencies via depcheck (advisory)

`npx depcheck packages/tools` is advisory and noisy. Do not treat it as the sole proof of cycle-free dependencies. Primary cycle prevention comes from: (1) `packages/tools/package.json` has no core/providers/cli dependencies (Assertion 1), (2) forbidden import scan in `packages/tools/src/` returns zero matches, (3) typecheck succeeds. Depcheck may report false positives for type-only or re-exported packages.

```bash
npx depcheck packages/tools
```

Expected: no unused/missing dependencies that indicate circular wiring. If depcheck reports issues, verify against forbidden import scan and package.json assertions before taking action.

## tsconfig.json Assertions

### Assertion 8: tools tsconfig does not reference core/providers/cli

```bash
node -e "const c=require('./packages/tools/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('../core') || String(r.path).includes('../providers') || String(r.path).includes('../cli'))) process.exit(1)"
```

Expected: exit code 0 (no circular tsconfig references).

### Assertion 9: tools tsconfig extends root or providers pattern

```bash
node -e "const c=require('./packages/tools/tsconfig.json'); if (!c.extends && !c.compilerOptions) process.exit(1)"
```

Expected: exit code 0.

### Assertion 10: core tsconfig may reference tools

```bash
node -e "const c=require('./packages/core/tsconfig.json'); if (!(c.references||[]).some(r => String(r.path).includes('../tools'))) console.log('NOTE: core does not reference tools tsconfig - verify build order')"
```

This is advisory — core may not need a tsconfig reference if it resolves types through node_modules.

## Forbidden Import Scan (Runtime)

### Assertion 11: tools source has no core/providers/cli imports — failing form

```bash
! rg -n "@vybestack/llxprt-code-core|packages/core/src|@vybestack/llxprt-code-providers|packages/providers/src|packages/cli/src" packages/tools/src -g "*.ts"
```

Expected: exit code 0 (zero matches).

### Assertion 11b: post-move transitive external dependency scan

```bash
rg -n "^import .* from ['"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." | sort
```

Every external package in this production scan MUST be listed in `packages/tools/package.json` dependencies. Compare scan output against declared dependencies:
```bash
node -e "const p=require('./packages/tools/package.json'); console.log(Object.keys(p.dependencies||{}).sort().join('
'))"
```

Every external package in this scan MUST be listed in `packages/tools/package.json` dependencies. Compare scan output against declared dependencies:
```bash
node -e "const p=require('./packages/tools/package.json'); console.log(Object.keys(p.dependencies||{}).sort().join('
'))"
```

### Assertion 11c: missing packages reconciliation

Verify that packages/settings, packages/storage, and packages/mcp are reconciled with current core modules:

```bash
find packages -maxdepth 1 -type d \( -name settings -o -name storage -o -name mcp \)
# Expected: no output (packages do not exist yet)
rg -n "SettingsService|SecureStore|McpClientManager|PromptRegistry" packages/core/src packages/cli/src packages/providers/src -g "*.ts"
# Expected: usages in core only; verify all are covered by temporary interfaces
```

## Build Order Verification

### Assertion 12: npm build resolves dependency order correctly

```bash
npm run build --workspaces 2>&1 | head -20
# tools should build before core if core depends on tools
```

**Note on depcheck**: `npx depcheck packages/tools` is advisory and noisy. Do not treat it as the sole proof of cycle-freedom. Rely on the explicit node -e checks above for definitive anti-cycle verification.

## No-Shim Scan

### Assertion 13: core tools directory has no re-export from tools — failing form

The no-shim scan is **restricted to `packages/core/src/tools/**`** only. It must NOT flag allowed explicit `packages/core/src/index.ts` top-level re-exports needed for CLI compatibility. This is REQ-NO-SHIM-SCOPE per `plan/requirements-appendix.md`.

```bash
! rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
```

Expected: exit code 0 (zero matches — no shims that only re-export from tools).

### Assertion 13b: core top-level index.ts may re-export from tools (allowed)

Explicit top-level re-exports in `packages/core/src/index.ts` are **allowed** for CLI compatibility. These are not deep-import shims — they serve the core package's public API.

```bash
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
```

Expected: non-zero matches showing tool type re-exports for CLI consumption. Verify each re-export is for a type that CLI or core consumers need and is covered by tests.

### Assertion 13c: test fixtures in tools do not import core/providers — failing form

Test fixtures in `packages/tools/src/__tests__/fixtures/**` MUST NOT import from core or providers.

```bash
! rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
```

Expected: exit code 0 (zero matches).

### Separation Rule

- `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools` (no shims)
- `packages/core/src/index.ts` → allowed explicit re-exports from `@vybestack/llxprt-code-tools` for public API compatibility
- `packages/tools/src/__tests__/fixtures/**` → zero imports from core/providers (anti-coupling)

## Root Package Manager Note

The root `packageManager` field says `pnpm@10.17.0`, but the repository uses `npm` with `package-lock.json` for all release and workspace scripts. This plan follows the **existing npm/package-lock release process**. The `packageManager` field is vestigial and should be reconciled separately. All `npm run`, `npm pack`, `npm publish`, and `npm install` commands in this plan use `npm`, consistent with existing CI and release workflows.

## IToolFormatter Export Path Constraint

The `IToolFormatter.ts` file lives in `packages/tools/src/formatters/` (not `src/interfaces/`). The export path in `packages/tools/package.json` MUST map `"./IToolFormatter.js"` to `dist/src/formatters/IToolFormatter.js`, not `dist/src/interfaces/IToolFormatter.js`. This is verified by:

```bash
node -e "const p=require('./packages/tools/package.json'); const e=p.exports&&p.exports['./IToolFormatter.js']; if (!e || !e.includes('formatters')) process.exit(1)"
```

## Test Integration

These assertions should be added as part of P07 (Scaffold Build And Release TDD) as automated test cases:

```typescript
// packages/tools/src/__tests__/package-constraints.test.ts
import { describe, it, expect } from 'vitest';
import toolsPackage from '../../../tools/package.json';

describe('tools package metadata constraints', () => {
  it('has no core dependency', () => {
    const allDeps = { ...toolsPackage.dependencies, ...toolsPackage.devDependencies };
    expect(allDeps['@vybestack/llxprt-code-core']).toBeUndefined();
    expect(allDeps['@vybestack/llxprt-code-providers']).toBeUndefined();
    expect(allDeps['@vybestack/llxprt-code']).toBeUndefined();
  });

  it('test-utils is devDependency only', () => {
    expect(toolsPackage.dependencies?.['@vybestack/llxprt-code-test-utils']).toBeUndefined();
  });

  it('has exports map', () => {
    expect(toolsPackage.exports).toBeDefined();
    expect(toolsPackage.exports['.']).toBeDefined();
  });

  it('IToolFormatter export maps to formatters directory', () => {
    const itoolFormatter = toolsPackage.exports?.['./IToolFormatter.js'];
    expect(itoolFormatter).toBeDefined();
    expect(itoolFormatter).toContain('formatters');
    expect(itoolFormatter).not.toContain('interfaces');
  });
});
```