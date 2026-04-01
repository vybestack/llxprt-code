# Phase 08: MCP Manager Implementation

## Phase ID

`PLAN-20260325-MCPSTATUS.P08`

## Prerequisites

- Required: Phase 07a (MCP Manager TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P07a.md`
- Expected files from previous phase: Tests for new emit behavior in mcp-client-manager.test.ts

## Requirements Implemented (Expanded)

### REQ-MGR-001: Emit on COMPLETED Transition

**Full Text**: When the `McpClientManager` discovery state transitions to `COMPLETED`, the system shall emit `CoreEvent.McpClientUpdate` on `coreEvents`.
**Behavior**:
- GIVEN: Discovery is `IN_PROGRESS`
- WHEN: All servers finish resolving
- THEN: `discoveryState = COMPLETED` AND `coreEvents.emit(CoreEvent.McpClientUpdate, ...)` fires
**Why This Matters**: THIS IS THE CRITICAL FIX. Without this emit, the UI never learns discovery completed and the queue never flushes — a deadlock.

### REQ-MGR-002: Emit on IN_PROGRESS Transition

**Full Text**: When discovery state transitions to `IN_PROGRESS`, emit `CoreEvent.McpClientUpdate`.
**Behavior**:
- GIVEN: `discoveryState === NOT_STARTED`
- WHEN: First `maybeDiscoverMcpServer` transitions to `IN_PROGRESS`
- THEN: Emit event
**Why This Matters**: UI shows "discovering" status.

### REQ-MGR-004: Zero-Server Fast Path

**Full Text**: When zero servers are configured, transition directly to `COMPLETED` and emit.
**Behavior**:
- GIVEN: Empty server config
- WHEN: `startConfiguredMcpServers()` called
- THEN: `discoveryState = COMPLETED`, emit event, return immediately
**Why This Matters**: Prevents infinite wait on zero-server startup.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/mcp-client-manager.ts`
  - ADD emit on COMPLETED transition (from pseudocode mcp-manager-emits.md lines 31-40):
    - In the `.then()` callback (~line 240-243) that sets `discoveryState = COMPLETED`
    - Add `coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })` immediately after the state assignment
  - ADD emit on IN_PROGRESS transition (from pseudocode lines 41-50):
    - When `discoveryState` first changes to `IN_PROGRESS`
    - Add `coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })`
  - ADD zero-server fast path (from pseudocode lines 51-64):
    - In `startConfiguredMcpServers()`, if no servers configured:
    - Set `discoveryState = COMPLETED`
    - Emit `CoreEvent.McpClientUpdate`
    - Return early
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P08` marker
  - ADD `@requirement:REQ-MGR-001`, `@requirement:REQ-MGR-002`, `@requirement:REQ-MGR-004` markers

### Critical Implementation Details

1. **COMPLETED emit placement**: Must be IMMEDIATELY after `this.discoveryState = MCPDiscoveryState.COMPLETED` — not in a separate callback or microtask. The emit must fire synchronously with the state change to prevent races where the hook reads state between assignment and emit.

2. **IN_PROGRESS guard**: Only emit on the FIRST transition to IN_PROGRESS (from NOT_STARTED), not on subsequent calls. Check `this.discoveryState !== MCPDiscoveryState.IN_PROGRESS` before emitting.

3. **Zero-server detection**: Check `Object.keys(servers).length === 0` or equivalent BEFORE entering the discovery loop. The COMPLETED transition here must also emit.

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P08
 * @requirement:REQ-MGR-001, REQ-MGR-002, REQ-MGR-004
 * @pseudocode mcp-manager-emits.md lines 31-64
 */
```

## Verification Commands

### Automated Checks

```bash
# All MCP manager tests pass (including new P07 tests)
npm test -- packages/core/src/tools/mcp-client-manager.test.ts
# Expected: ALL pass (including COMPLETED transition, zero-server)

# TypeScript compiles
npm run typecheck

# Verify COMPLETED transition has emit
grep -A 5 "MCPDiscoveryState.COMPLETED" packages/core/src/tools/mcp-client-manager.ts | grep -c "CoreEvent.McpClientUpdate"
# Expected: 2+ (normal completion + zero-server path)

# Verify no remaining raw string emits
grep -c "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0

# Full test suite still passes
npm run test
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
   - [ ] COMPLETED transition emits event (verified by reading the code path)
   - [ ] IN_PROGRESS transition emits event
   - [ ] Zero-server fast path transitions to COMPLETED and emits
   - [ ] All 6+3 emit sites use coreEvents

2. **Is this REAL implementation, not placeholder?**
   - [ ] emit calls are real `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`
   - [ ] State transitions are real `this.discoveryState = MCPDiscoveryState.COMPLETED`

3. **Would the test FAIL if implementation was removed?**
   - [ ] P07 COMPLETED test fails without the new emit
   - [ ] P07 zero-server test fails without the fast path

4. **Is the feature REACHABLE?**
   - [ ] `startConfiguredMcpServers()` is called during app startup
   - [ ] Events are receivable by any coreEvents listener

5. **What's MISSING?** (should be nothing — verify)
   - [ ] (check for gaps)

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/tools/mcp-client-manager.ts
# Expected: No new deferred work

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/tools/mcp-client-manager.ts
# Expected: No cop-out comments
```

## Success Criteria

- ALL P07 tests pass
- COMPLETED transition emits `CoreEvent.McpClientUpdate`
- IN_PROGRESS transition emits `CoreEvent.McpClientUpdate`
- Zero-server fast path: sets COMPLETED, emits, returns
- No raw `'mcp-client-update'` strings remain
- TypeScript compiles
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/tools/mcp-client-manager.ts`
2. Re-read pseudocode `mcp-manager-emits.md` lines 31-64
3. Focus on the specific failing test to identify the missing code path
4. Retry implementation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P08.md`
