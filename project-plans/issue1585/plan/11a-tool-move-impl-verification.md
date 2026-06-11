# Phase 11a: Tool Move Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P11a`

## Purpose

Verify all migration groups completed, moved tools have no core/cli/providers imports, behavioral tests pass, and core adapters exist.

## Prerequisites

- Required: P11 completed (all grouped tool move implementation).

## Verification Tasks

### Step 1: Verify All Migration Groups Completed

```bash
# Verify each group moved successfully by checking tools package
find packages/tools/src -type f -name '*.ts' | wc -l
# Should have all MOVE_NOW and MOVE_AFTER_INTERFACE files
```

### Step 2: Forbidden Import Scan

```bash
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
```

### Step 3: Behavioral Tests Pass

```bash
npm run test --workspace @vybestack/llxprt-code-tools
```

### Step 4: Core Still Compiles

```bash
npm run typecheck --workspace @vybestack/llxprt-code-core
```

### Step 5: Core Adapters Exist

```bash
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
# Expected: 14 (mandatory) or 15 (with CoreMcpToolServiceAdapter if mcp-tool.ts moves)
# Exact mandatory adapter list: CoreToolHostAdapter, CoreToolRegistryHostAdapter, CoreMessageBusAdapter,
#   CoreShellToolHostAdapter, CoreSubagentServiceAdapter, CoreAsyncTaskServiceAdapter, CoreSkillServiceAdapter, CoreWebSearchServiceAdapter, CoreMcpToolServiceAdapter,
#   CoreIdeServiceAdapter, CoreLspServiceAdapter, CoreStorageServiceAdapter, CoreToolKeyStorageAdapter,
#   CoreTodoServiceAdapter, CoreSettingsServiceAdapter, CorePromptRegistryServiceAdapter
# + CoreMcpToolServiceAdapter (conditional: only if mcp-tool.ts moves)
```

### Step 6: Pre-Extraction Characterization Fixtures Match

```bash
# Verify provider formatting fixtures match
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "formatting\|normalization"
# Verify filesystem fixtures match
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "filesystem"
# Verify key storage fixtures match
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "key.*storage\|maskKey"
```

### Step 7: Package Dependency Health

```bash
# Tools has no forbidden dependencies
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# Test-utils is devDependency only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
# Tools has required runtime dependencies
node -e "const p=require('./packages/tools/package.json'); if (!p.dependencies || !p.dependencies['diff'] || !p.dependencies['@google/genai']) process.exit(1)"
```

### Step 8: MCP Retention Verification

```bash
test -f packages/core/src/tools/mcp-client.ts
test -f packages/core/src/tools/mcp-client-manager.ts
```

## Verification Commands

```bash
npm run typecheck
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
rg -n "@vybestack/llxprt-code-core\|packages/core/src" packages/tools/src -g "*.ts"
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
```

## Semantic Verification Checklist

- [ ] All migration groups completed.
- [ ] Zero forbidden imports in tools package.
- [ ] Behavioral tests pass including pre-extraction fixtures.
- [ ] Core still compiles.
- [ ] All core adapters exist.
- [ ] MCP client/manager remain in core.
- [ ] ToolKeyStorage class stays in core (pure functions moved).
- [ ] CoreToolKeyStorageAdapter does NOT import moved ToolKeyStorage class (adapter owns lifecycle internally).
- [ ] packages/tools/package.json has required dependencies and no forbidden ones.

## Success Criteria

- All behavioral tests pass.
- Zero forbidden imports.
- All adapters exist.
- Pre-extraction fixtures verified.

## Failure Recovery

Return to P11 to fix imports or create missing adapters.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P11a.md` with verification output.
