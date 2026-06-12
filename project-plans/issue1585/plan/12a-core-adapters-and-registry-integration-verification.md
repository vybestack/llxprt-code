# Phase 12a: Core Integration Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P12a`

## Purpose

Verify moved tools are reachable through Config/ToolRegistry/scheduler paths, adapters are narrow, no service bag exists, and all core consumer imports are updated.

## Prerequisites

- Required: P12 completed (adapters verified/created, registry factory updated).

## Verification Tasks

### Step 1: Verify Tool Reachability

```bash
# Registry integration test
npm run test --workspace @vybestack/llxprt-code-core -- --grep "registry\|scheduler"
# Or run specific integration test
npm run test --workspace @vybestack/llxprt-code-core -- packages/core/src/__tests__/tools-registry-scheduler.test.ts
```

### Step 2: Verify No Service Bag

```bash
# ToolContext does not have generic service fields
rg -n "any|service.*bag|getService|getServiceBag" packages/tools/src -g "*.ts"
# Expected: zero matches
# Adapters are narrow (each implements exactly one interface)
for f in packages/core/src/tools-adapters/Core*Adapter.ts; do
  echo "=== $f ==="
  grep "implements" "$f"
done
# Each adapter implements exactly one tools-owned interface
```

### Step 3: Verify Adapter Delegation

```bash
# Adapters should delegate to concrete services
grep -c "Config\|MessageBus\|shellExecutionService\|SubagentManager\|AsyncTaskManager\|SkillManager\|McpClientManager\|IdeClient\|LspDiagnostics\|SecureStore\|TodoReminder\|TodoContext" packages/core/src/tools-adapters/*.ts
```

### Step 4: Verify No Remaining ../tools/ Imports

```bash
# Check core for remaining old imports (excluding retained MCP and tools-adapters)
rg -n "from ['\"]\.\.\/tools\/" packages/core/src -g "*.ts" | rg -v "mcp-client|mcp-client-manager|tools-adapters"
# Expected: zero matches for moved modules
```

### Step 5: Run Core And Tools Tests

```bash
npm run typecheck
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
```

## Verification Commands

```bash
npm run typecheck
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
rg -n "from ['\"]\.\.\/tools\/" packages/core/src -g "*.ts" | rg -v "mcp-client|mcp-client-manager|tools-adapters"
```

## Semantic Verification Checklist

- [ ] Tools reachable through registry/scheduler paths.
- [ ] No service bag in ToolContext.
- [ ] Adapters are narrow and explicit.
- [ ] CoreToolKeyStorageAdapter does NOT import moved ToolKeyStorage class (adapter owns lifecycle).
- [ ] No remaining old ../tools/ imports for moved modules.
- [ ] Core and tools tests pass.

## Success Criteria

- All integration tests pass.
- Tools reachable from CLI to execution.
- No remaining old import paths for moved modules.

## Failure Recovery

Return to P12 to fix reachability or adapter issues.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P12a.md` with reachability verification.
