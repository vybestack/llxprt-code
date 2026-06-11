# Phase 03a: Scaffold + Contract Stub Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P03a`

## Purpose

Verify scaffold exists, all 15 interface stubs compile, zero forbidden imports, and no core-local interfaces consumed by tools.

## Prerequisites

- Required: P03 completed (scaffold + interface stubs created).
- Artifacts from P03: packages/tools with all interface files.

## Requirements Implemented

### REQ-PKG-001, REQ-API-001, REQ-DEP-001

## Verification Tasks

### Step 1: Verify Scaffold

```bash
test -f packages/tools/package.json
node -e "const p=require('./packages/tools/package.json'); console.log(p.name)"  # @vybestack/llxprt-code-tools
test -f packages/tools/tsconfig.json
test -f packages/tools/src/index.ts
```

### Step 2: Verify All Interface Stubs Exist

```bash
for iface in IToolHost IToolRegistryHost IToolMessageBus IShellExecutionService ISubagentService IAsyncTaskService ISkillService IMcpToolService IIdeService ILspService IStorageService IToolKeyStorage ITodoService ISettingsService IPromptRegistryService; do
  test -f "packages/tools/src/interfaces/${iface}.ts" && echo "OK: ${iface}" || echo "MISSING: ${iface}"
done
```

### Step 3: Verify No Forbidden Imports

```bash
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
```

### Step 4: Verify No Core-Local Interfaces Consumed By Tools

```bash
# No interface files outside packages/tools consumed by tools
find packages/core/src -name 'I*.ts' -path '*/tools/*' 2>/dev/null
# Expected: zero (no core-local interfaces in tools directory consumed by tools package)
```

## Verification Commands

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck
npm run test --workspaces --if-present
```

## Semantic Verification Checklist

- [ ] All 15 interface stubs exist and compile.
- [ ] Zero forbidden imports in packages/tools.
- [ ] No core-local interfaces that tools consume.
- [ ] ToolContext is NOT a grab-bag of services.

## Success Criteria

- Typecheck passes in tools package and globally.
- Zero forbidden imports.

## Failure Recovery

Return to P03 to fix interface definitions.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P03a.md` with interface inventory and forbidden import scan results.
