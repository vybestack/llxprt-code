# Phase 02c: Integration Contract Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P02c`

## Purpose

Verify contract boundaries are cycle-free and reachable through existing runtime paths.

## Prerequisites

- Required: P02b completed with integration-contract.md.
- Artifacts: analysis/integration-contract.md.

## Requirements Implemented

### REQ-DEP-001, REQ-TEST-001

## Verification Tasks

### Step 1: Verify No Cycles

Check dependency graph manually:
- packages/tools → (no core/cli/providers) [OK]
- packages/core → packages/tools [OK]
- packages/providers → packages/tools [OK]
- No cycle exists.

### Step 2: Verify Runtime Path Reachability

For each moved tool, trace the runtime path from CLI startup through registry factory:
1. CLI startup → config initialization
2. toolRegistryFactory creates ToolRegistry
3. toolRegistryFactory imports tools from @vybestack/llxprt-code-tools
4. toolRegistryFactory constructs core adapters from packages/core/src/tools-adapters/
5. toolRegistryFactory passes adapters to tool constructors
6. Scheduler uses ToolRegistry to discover and invoke tools
7. Tools use adapters to reach core services

Verify that every existing CLI tool invocation path is preserved through this chain.

### Step 3: Verify Provider Path

1. Provider imports formatter/ID utilities from @vybestack/llxprt-code-tools
2. Same runtime behavior because packages/tools provides identical implementations

## Verification Commands

```bash
npm run typecheck
```

## Semantic Verification Checklist

- [ ] Dependency graph has no cycles.
- [ ] Every moved tool is reachable through toolRegistryFactory.
- [ ] Provider formatting path is preserved.
- [ ] No code changed (contract verification, no code markers required).

## Success Criteria

- Contracts are cycle-free.
- Runtime paths are preserved on paper.
- No code changed.

## Failure Recovery

Return to P02b to fix contract definitions.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P02c.md` with cycle analysis and reachability assessment.
