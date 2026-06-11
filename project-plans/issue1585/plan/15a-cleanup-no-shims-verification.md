# Phase 15a: Cleanup Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P15a`

## Purpose

Verify no core deep-import shims, duplicate implementations, forbidden imports, and full move-map satisfaction.

## Prerequisites

- Required: P15 completed (cleanup applied).

## Verification Tasks

### Step 1: Core Tools Directory Audit

```bash
find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/core-tools-final-files.txt
cat project-plans/issue1585/analysis/core-tools-final-files.txt
# Must match approved retained-file allowlist exactly, including snapshots/fixtures/non-TS artifacts
# Approved allowlist:
# - mcp-client.ts (STAY_CORE_INFRASTRUCTURE)
# - mcp-client-manager.ts (STAY_CORE_INFRASTRUCTURE)
# - tool-key-storage.ts (STAY_CORE_INFRASTRUCTURE — ToolKeyStorage class + SecureStore)
# - mcp-client.test.ts (if exists — test for retained mcp-client)
# - mcp-client-manager.test.ts (if exists — test for retained mcp-client-manager)
# - tool-key-storage.test.ts (if exists — SecureStore integration test)
# - mcp-tool.ts (if classified STAY_CORE_INFRASTRUCTURE because it cannot move — document decision)
# - Any file explicitly classified STAY_CORE_INFRASTRUCTURE with written rationale
```

**Retained-file verification**: Compare actual files with move-map retained list:
```bash
find packages/core/src/tools -type f | sort > /tmp/actual-core-tools.txt
grep "STAY_CORE_INFRASTRUCTURE" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}' | sort > /tmp/expected-retained.txt
diff /tmp/actual-core-tools.txt /tmp/expected-retained.txt
# Expected: zero diff; every remaining file is classified
# Expected: no diff (actual matches expected)
```

### Step 2: No Re-Export Shims (Restricted Scope)

The no-shim scan is **restricted to `packages/core/src/tools/**`** — it must NOT flag explicit `packages/core/src/index.ts` top-level re-exports which are allowed for CLI compatibility. This is REQ-NO-SHIM-SCOPE per `plan/requirements-appendix.md`.

```bash
# Check for any file in core/tools that re-exports from packages/tools
rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: zero matches (no shims in core/tools)
# Separately verify allowed top-level re-exports in packages/core/src/index.ts
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero matches for CLI-compatible type re-exports (this is allowed)
# Check for export forwarding patterns in core/tools only
  rg -n "export .* from" packages/core/src/tools -g "*.ts" | rg -v "test|spec"
# Any remaining exports should be only from retained files
```

**Separation rule**: `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools`. `packages/core/src/index.ts` → allowed explicit re-exports for public API compatibility.

### Step 3: Move Map Satisfaction

```bash
# Every MOVE_NOW and MOVE_AFTER_INTERFACE file should exist in packages/tools
for file in $(grep "MOVE_NOW\|MOVE_AFTER_INTERFACE" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}'); do
  target=$(echo "$file" | sed 's|packages/core/src/tools|packages/tools/src|')
  test -f "$target" && echo "OK: $file -> $target" || echo "MISSING: $target"
done
```

### Step 4: No Duplicate Implementations

```bash
# Check that no tool implementation file exists in both core and tools
for file in $(find packages/tools/src -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts'); do
  basename=$(basename "$file")
      find packages/core/src/tools -name "$basename" -not -name '*.test.ts' -not -name '*.spec.ts' | rg -v "mcp-client|tool-key-storage" | head -1
done
# Expected: zero matches (except retained MCP infrastructure and ToolKeyStorage class)
```

### Step 5: ToolKeyStorage Ownership Verification

```bash
# ToolKeyStorage class should remain in core (imports SecureStore)
test -f packages/core/src/tools/tool-key-storage.ts
# Pure functions should be in tools
grep -l "maskKeyForDisplay\|getSupportedToolNames\|isValidToolKeyName" packages/tools/src/utils/tool-key-utils.ts
# CoreToolKeyStorageAdapter should not delegate to moved class
rg -n "ToolKeyStorage" packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts -g "*.ts"
# Expected: adapter creates ToolKeyStorage instance internally (adapter owns lifecycle)
# Verify adapter does NOT delegate to a moved ToolKeyStorage class
rg -n "from.*tools.*tool-key-storage|from.*@vybestack/llxprt-code-tools.*tool-key" packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts -g "*.ts"
# Expected: zero matches (adapter must not import moved class)
```

### Step 6: Full Verification

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
# Verify format produced zero diff (REQ-FORMAT-DIFF-CHECK)
git diff --quiet
# Expected: exit code 0
```

### Step 7: Key Storage And Memory Path Regression

```bash
# Verify key storage behavior
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "key.*storage\|maskKey\|tool.*key"
# Verify memory path behavior  
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "memory\|LLXPRT.*dir\|storage.*path"
```

### Step 8: Package Metadata Constraints

```bash
# Anti-cycle checks
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# test-utils devDependency-only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
# tsconfig anti-cycle
node -e "const c=require('./packages/tools/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('../core') || String(r.path).includes('../providers') || String(r.path).includes('../cli'))) process.exit(1)"
# IToolFormatter export path check
node -e "const p=require('./packages/tools/package.json'); const e=p.exports&&p.exports['./IToolFormatter.js']; if (!e || !e.includes('formatters')) process.exit(1)"
# No-shim scan (restricted to packages/core/src/tools/ only — NOT index.ts)
rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: zero matches
# Allowed top-level re-exports (separate verification — NOT flagged as shims)
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero (allowed for CLI compatibility)
# Test fixture anti-coupling check
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: zero matches (fixtures must not import core/providers)
```

## Verification Commands

```bash
find packages/core/src/tools -type f | sort
rg -n "@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Separately verify allowed top-level re-exports (NOT flagged as shims)
rg -n "export .* from ['"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
```

## Semantic Verification Checklist

- [ ] Core tools directory matches approved all-file allowlist (mcp-client.ts, mcp-client-manager.ts, tool-key-storage.ts, their tests, any STAY_CORE_INFRASTRUCTURE files).
- [ ] Zero re-export shims in packages/core/src/tools/ (scanned with `rg` restricted to packages/core/src/tools/).
- [ ] All move map entries satisfied.
- [ ] No duplicate implementations (except ToolKeyStorage class in core).
- [ ] Key storage/memory path behavior preserved.
- [ ] Package metadata constraints pass (anti-cycle, test-utils devDep-only, IToolFormatter export path).
- [ ] No core/tools file re-exports from packages/tools.
- [ ] Allowed packages/core/src/index.ts top-level re-exports verified separately.
- [ ] ToolKeyStorage class remains in core; adapter does NOT import moved class; pure functions moved to tools.
- [ ] Test fixtures in packages/tools do not import core/providers (anti-coupling rule).

## Success Criteria

- Full project verification passes.
- No shims or duplicates remain.
- Move map is fully satisfied.
- Package metadata anti-cycle assertions pass.

## Failure Recovery

Return to P15 to fix remaining issues.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P15a.md` with audit results and verification output.
