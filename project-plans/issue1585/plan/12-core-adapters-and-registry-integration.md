# Phase 12: Core Adapters And Registry Integration — Verify Mandatory Adapters

## Phase ID

`PLAN-20260608-ISSUE1585.P12`

## Purpose

Verify remaining registry/scheduler integration and core-to-tools wiring. P11 already creates core adapters as part of each migration group. P12 focuses ONLY on verifying/completing what P11 migration groups produce — it does NOT create adapters from scratch (that is P11's job). If mandatory adapters are missing from P11, P12 returns to the responsible P11 group rather than silently creating them. P12 may only complete conditional/deferred adapters that were explicitly deferred from P11 groups; mandatory adapter gaps fail P12 and return to the responsible P11 group.

## Prerequisites

- Required: P11a completed (moved tools verified, zero forbidden imports).
- Artifacts: moved tools in packages/tools, adapters created per P11 groups.

## Requirements Implemented

### REQ-API-001, REQ-TEST-001, REQ-CONFIG-REPLACEMENT, REQ-INTERFACE-OWNERSHIP

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-INTERFACE-OWNERSHIP, REQ-CONFIG-REPLACEMENT, REQ-BEHAVIOR-PRESERVATION

**Behavior specification**:
- GIVEN: All P11 migration groups completed with tools/zero forbidden imports
- WHEN: Remaining adapters are created and registry/scheduler integration is verified
- THEN: All 14 mandatory core adapters exist and compile (+ 1 conditional CoreMcpToolServiceAdapter if mcp-tool.ts moves); adapters are narrow (one service each); toolRegistryFactory passes adapters to moved tools; ToolContext has no generic service fields; no remaining ../tools/ imports for moved modules

**Why it matters**: Missing adapters break tool functionality. A "service bag" adapter defeats the purpose of interface separation.

## Implementation Tasks

### Step 1: Verify All Core Adapters Exist And Compile

Verify that all adapters required by P11 migration groups were created. **P12 MUST NOT create mandatory adapters that P11 missed.** Missing mandatory adapters indicate a P11 failure and require returning to the responsible P11 group. P12 only creates adapters that are explicitly deferred (not mandated by any P11 group) or conditional adapters whose prerequisite decision (e.g., mcp-tool.ts classification) resolved after P11 Group 8. **Mandatory adapters are verify-only — missing means return to the assigned P11 group.** Only `CoreMcpToolServiceAdapter` may be conditional-created if the mcp-tool.ts decision resolved after P11 Group 8.

**Adapter ownership rule**: Each mandatory adapter is assigned to exactly one P11 group. If a mandatory adapter is missing after all P11 groups, P12 MUST fail and the implementation must return to the responsible P11 group. P12 does NOT silently fill gaps.

**Exact adapter list (14 mandatory + 1 conditional per REQ-ADAPTER-EXACT-COUNT)**. The canonical adapter table with P11 group assignments is in `analysis/final-architecture.md` §Contract Ownership — refer there for the authoritative list. Summary:

| Adapter File | Created In P11 Group | Implements | Status |
| --- | --- | --- | --- |
| `CoreToolHostAdapter.ts` | Group 3 | IToolHost | verify |
| `CoreToolRegistryHostAdapter.ts` | Group 6 | IToolRegistryHost | verify |
| `CoreMessageBusAdapter.ts` | Group 2 | IToolMessageBus | verify |
| `CoreShellToolHostAdapter.ts` | Group 5 | IShellToolHost | verify |
| `CoreSubagentServiceAdapter.ts` | Group 5 | ISubagentService | verify |
| `CoreAsyncTaskServiceAdapter.ts` | Group 5 | IAsyncTaskService | verify |
| `CoreSkillServiceAdapter.ts` | Group 5 | ISkillService | verify |
| `CoreMcpToolServiceAdapter.ts` | Group 8 | IMcpToolService | verify (conditional) |
| `CoreIdeServiceAdapter.ts` | Group 3 | IIdeService | verify |
| `CoreLspServiceAdapter.ts` | Group 3 | ILspService | verify (mandatory — missing means return to P11 Group 3) |
| `CoreStorageServiceAdapter.ts` | Group 5 | IStorageService | verify |
| `CoreToolKeyStorageAdapter.ts` | Group 5 | IToolKeyStorage | verify |
| `CoreTodoServiceAdapter.ts` | Group 5 | ITodoService | verify |
| `CoreSettingsServiceAdapter.ts` | Group 5 | ISettingsService | verify (mandatory — missing means return to P11 Group 5) |
| `CorePromptRegistryServiceAdapter.ts` | Group 5 | IPromptRegistryService | verify (mandatory — missing means return to P11 Group 5) |
| `index.ts` | — | barrel export | verify |

For any adapter missing from P11 groups, P12 MUST differentiate between mandatory and deferred adapters:

- **Mandatory adapter missing (e.g., CoreLspServiceAdapter):** This indicates a P11 failure. P12 MUST NOT create it. Instead, return to the responsible P11 group (Group 3 for CoreLspServiceAdapter, per the updated group assignment in plan/11-tool-move-impl.md) to create the adapter. **This is the key distinction from the previous title**: P12 verifies and completes, but mandatory adapter gaps are escalated back to P11, not silently filled here.
- **Conditional adapter (CoreMcpToolServiceAdapter):** May be created here only if mcp-tool.ts receives MOVE_AFTER_INTERFACE classification after P11 Group 8 completed and the adapter was not created in P11 because the decision was pending.
- **Deferred adapter (explicitly excluded from all P11 groups in plan/11-tool-move-impl.md):** May be created here only if the plan documents the deferral with justification.

**Specific adapter assignments to P11 groups (canonical)**:

| Adapter File | P11 Group | Mandatory? |
| --- | --- | --- |
| CoreToolHostAdapter.ts | Group 3 | Yes |
| CoreToolRegistryHostAdapter.ts | Group 6 | Yes |
| CoreMessageBusAdapter.ts | Group 2 | Yes |
| CoreShellToolHostAdapter.ts | Group 5 | Yes |
| CoreSubagentServiceAdapter.ts | Group 5 | Yes |
| CoreAsyncTaskServiceAdapter.ts | Group 5 | Yes |
| CoreSkillServiceAdapter.ts | Group 5 | Yes |
| CoreIdeServiceAdapter.ts | Group 3 | Yes |
| CoreLspServiceAdapter.ts | Group 3 | Yes |
| CoreStorageServiceAdapter.ts | Group 5 | Yes |
| CoreToolKeyStorageAdapter.ts | Group 5 | Yes |
| CoreTodoServiceAdapter.ts | Group 5 | Yes |
| CoreSettingsServiceAdapter.ts | Group 5 | Yes |
| CorePromptRegistryServiceAdapter.ts | Group 5 | Yes |
| CoreMcpToolServiceAdapter.ts | Group 8 | Conditional (only if mcp-tool.ts moves) |
| index.ts | Group 5 | Yes |

### Step 2: Verify toolRegistryFactory Integration

Edit `packages/core/src/config/toolRegistryFactory.ts`:
- Verify all moved tool classes are imported from `@vybestack/llxprt-code-tools`
- Verify all core adapters are imported from `../tools-adapters/`
- Verify adapters are constructed and passed to moved tool constructors
- Verify tool registration uses the same names and discovery logic as before extraction
- Verify no adapter is a "grab-bag" — each adapter implements exactly one tools-owned interface

### Step 3: Verify Scheduler Integration

Verify `packages/core/src/scheduler/` files import tool types from `@vybestack/llxprt-code-tools`:
- `scheduler/types.ts`: ToolResult, ToolConfirmationOutcome, etc.
- `scheduler/confirmation-coordinator.ts`: ToolConfirmationOutcome, ToolCallConfirmationDetails
- `scheduler/tool-dispatcher.ts`: AnyDeclarativeTool, AnyToolInvocation, ToolRegistry
- `scheduler/result-aggregator.ts`: ToolResult, ToolErrorType
- `scheduler/tool-executor.ts`: ToolResult

Run scheduler integration test:
```bash
npm run test --workspace @vybestack/llxprt-code-core -- --grep "registry\|scheduler"
```

### Step 4: Verify No Service Bag

```bash
# ToolContext must not have generic service fields
rg -n "any|service.*bag|getService|getServiceBag" packages/tools/src -g "*.ts"
# Expected: zero matches
# Each adapter implements exactly one interface
for f in packages/core/src/tools-adapters/Core*Adapter.ts; do
  echo "=== $f ==="
  grep "implements" "$f"
done
# Each file should implement exactly one tools-owned interface
```

### Step 5: Verify Core Package Dependencies

```bash
# Core must depend on tools
node -e "const p=require('./packages/core/package.json'); const d=p.dependencies||{}; if (!d['@vybestack/llxprt-code-tools']) process.exit(1)"
# Tools must NOT depend on core
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core']) process.exit(1)"
```

### Step 6: Verify Complete Core Consumer Import Rewrites

For all core files that imported from `../tools/`, verify they now use `@vybestack/llxprt-code-tools`:
```bash
# Check for remaining ../tools/ imports in core (excluding retained MCP files)
rg -n "from ['\"]\.\.\/tools\/" packages/core/src -g "*.ts" | rg -v "mcp-client|mcp-client-manager|tools-adapters"
# Expected: zero matches for moved modules
```

### Step 7: Run Full Core + Tools Tests

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
```

## Files To Verify

- `packages/core/src/tools-adapters/Core*Adapter.ts` (14 mandatory adapters + 1 conditional CoreMcpToolServiceAdapter)
- `packages/core/src/tools-adapters/index.ts`
- `packages/core/src/config/toolRegistryFactory.ts`
- `packages/core/package.json`
- `packages/tools/package.json`
- Various core scheduler/runtime/agent files

## Verification Commands

```bash
# Typecheck both packages
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
# Run core tests
npm run test --workspace @vybestack/llxprt-code-core
# Run tools tests
npm run test --workspace @vybestack/llxprt-code-tools
# Verify no service bag
rg -n "any|service.*bag|getService|getServiceBag" packages/tools/src -g "*.ts"
# Verify adapter count — 14 mandatory or 15 with CoreMcpToolServiceAdapter
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
# Verify tools reachable through registry
npm run test --workspace @vybestack/llxprt-code-core -- packages/core/src/__tests__/tools-registry-scheduler.test.ts
```

## Semantic Verification Checklist

- [ ] All 14 mandatory + 1 conditional core adapters exist and compile.
- [ ] Adapters are narrow (one service per adapter, no grab-bags).
- [ ] toolRegistryFactory constructs adapters and passes to moved tools.
- [ ] Scheduler/confirmation-coordinator imports are updated.
- [ ] Core compiles with tools dependency.
- [ ] No remaining `../tools/` imports for moved modules in core (except retained MCP files).
- [ ] ToolContext has no generic service fields.
- [ ] No circular dependencies.

## Success Criteria

- Typecheck passes in both core and tools.
- Core tests pass.
- Moved tools are reachable through registry factory and scheduler.
- All adapters compile and are narrow.

## Failure Recovery

Return to P11 or P12 to fix missing adapters, incorrect constructor wiring, or remaining old import paths.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P12.md` with adapter verification, test results, and scheduler integration evidence.
