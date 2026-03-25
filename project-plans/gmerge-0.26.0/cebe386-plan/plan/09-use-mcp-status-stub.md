# Phase 09: useMcpStatus Hook Stub

## Phase ID

`PLAN-20260325-MCPSTATUS.P09`

## Prerequisites

- Required: Phase 08a (MCP Manager Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P08a.md`
- Expected files from previous phase: McpClientManager emitting on coreEvents, getMcpServerCount method
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HOOK-001: Initial State from Current Manager

**Full Text**: The `useMcpStatus` hook shall initialize its state from the current `McpClientManager` state, not from defaults.
**Behavior**:
- GIVEN: `McpClientManager` is already at `COMPLETED` when hook mounts
- WHEN: `useMcpStatus` initializes
- THEN: `discoveryState` is `COMPLETED` immediately (no event needed)
**Why This Matters**: Prevents the hook from showing stale NOT_STARTED state when mounting after discovery.

### REQ-HOOK-005: Hook Return Shape

**Full Text**: The `useMcpStatus` hook shall return `{ discoveryState, mcpServerCount, isMcpReady }`.
**Behavior**:
- GIVEN: Hook is called with a Config
- WHEN: Return value is destructured
- THEN: All three properties are present with correct types
**Why This Matters**: AppContainer and useMessageQueue depend on this exact return shape.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/hooks/useMcpStatus.ts`
  - Create the hook file with full implementation (declarative hooks are not "stubs")
  - Import `Config`, `coreEvents`, `MCPDiscoveryState`, `CoreEvent` from `@vybestack/llxprt-code-core`
  - Implement `useState` initialization from current manager state
  - Implement `useEffect` subscription to `CoreEvent.McpClientUpdate` with cleanup
  - Derive `isMcpReady` from state
  - Return `{ discoveryState, mcpServerCount, isMcpReady }`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P09` marker
  - ADD `@requirement:REQ-HOOK-001` through `@requirement:REQ-HOOK-005` markers

### Why This Phase Implements the Full Hook

React hooks are declarative compositions of primitives (`useState`, `useEffect`, `useMemo`). There is no meaningful "stub" for a hook — either it subscribes to events and derives state, or it doesn't. The hook implementation follows pseudocode `use-mcp-status.md` lines 01-50 directly.

### Implementation from Pseudocode (use-mcp-status.md)

- Lines 01-08: Import statements
- Lines 10-16: useState initializers from config.getMcpClientManager()
- Lines 18-32: useEffect subscription with onChange handler and cleanup
- Lines 34-40: isMcpReady derivation
- Lines 42-48: Return shape

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P09
 * @requirement:REQ-HOOK-001, REQ-HOOK-002, REQ-HOOK-003, REQ-HOOK-004, REQ-HOOK-005
 * @pseudocode use-mcp-status.md lines 01-50
 */
```

## Verification Commands

### Automated Checks

```bash
# Check file exists
test -f packages/cli/src/ui/hooks/useMcpStatus.ts && echo "OK" || echo "FAIL"

# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P09" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1+

# Check exports
grep "export function useMcpStatus" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1

# Check return shape
grep "discoveryState\|mcpServerCount\|isMcpReady" packages/cli/src/ui/hooks/useMcpStatus.ts | wc -l
# Expected: 3+

# Check useEffect cleanup
grep "coreEvents.off" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 1+

# TypeScript compiles
npm run typecheck
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] useState initializes from manager's current state
   - [ ] useEffect subscribes to CoreEvent.McpClientUpdate
   - [ ] Cleanup calls coreEvents.off
   - [ ] isMcpReady derived from discoveryState + mcpServerCount

2. **Is this REAL implementation, not placeholder?**
   - [ ] Hook has real useState/useEffect logic
   - [ ] Not returning hardcoded values

3. **Would the test FAIL if implementation was removed?**
   - [ ] P10 tests will verify behavior

4. **Is the feature REACHABLE?**
   - [ ] Will be consumed by AppContainer in P15-P17

## Success Criteria

- `useMcpStatus.ts` exists with full hook implementation
- Hook initializes state from manager
- Hook subscribes to CoreEvent.McpClientUpdate with cleanup
- Hook derives isMcpReady correctly
- Hook returns { discoveryState, mcpServerCount, isMcpReady }
- TypeScript compiles

## Failure Recovery

If this phase fails:
1. `rm packages/cli/src/ui/hooks/useMcpStatus.ts`
2. Re-read pseudocode `use-mcp-status.md`
3. Retry hook creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P09.md`
