# Phase 07: MCP Manager TDD

## Phase ID

`PLAN-20260325-MCPSTATUS.P07`

## Prerequisites

- Required: Phase 06a (MCP Manager Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P06a.md`
- Expected files from previous phase: Migrated emit sites in mcp-client-manager.ts

## Requirements Implemented (Expanded)

### REQ-MGR-001: Emit on COMPLETED Transition

**Full Text**: When the `McpClientManager` discovery state transitions to `COMPLETED`, the system shall emit `CoreEvent.McpClientUpdate` on `coreEvents` with the current client map.
**Behavior**:
- GIVEN: MCP discovery is `IN_PROGRESS` with servers being resolved
- WHEN: All servers finish resolving (success or failure)
- THEN: `CoreEvent.McpClientUpdate` is emitted with the final client map
**Why This Matters**: Without this emit, `useMcpStatus` never learns discovery is done → queue never flushes → **deadlock**.

### REQ-MGR-002: Emit on IN_PROGRESS Transition

**Full Text**: When the `McpClientManager` discovery state transitions to `IN_PROGRESS`, the system shall emit `CoreEvent.McpClientUpdate` on `coreEvents`.
**Behavior**:
- GIVEN: Discovery state is `NOT_STARTED`
- WHEN: First MCP server discovery begins
- THEN: `CoreEvent.McpClientUpdate` is emitted
**Why This Matters**: UI can show "discovering" status immediately.

### REQ-MGR-003: Emit on Client Map Change

**Full Text**: When the client map changes, the system shall emit `CoreEvent.McpClientUpdate` on `coreEvents`.
**Behavior**:
- GIVEN: Client map has N entries
- WHEN: A client is added, removed, or status changes
- THEN: `CoreEvent.McpClientUpdate` is emitted with updated map
**Why This Matters**: `useMcpStatus` needs real-time server count updates.

### REQ-MGR-004: Zero-Server Fast Path

**Full Text**: When zero MCP servers are configured, the system shall transition to `COMPLETED` and emit.
**Behavior**:
- GIVEN: No MCP servers configured
- WHEN: `startConfiguredMcpServers()` is called
- THEN: `discoveryState` becomes `COMPLETED` and `CoreEvent.McpClientUpdate` is emitted
**Why This Matters**: Without this, zero-server startups hang forever waiting for completion.

### REQ-MGR-005: Server Count Accessibility

**Full Text**: `getMcpServerCount()` returns the count of clients.
**Behavior**:
- GIVEN: Manager with 3 clients
- WHEN: `getMcpServerCount()` called
- THEN: Returns 3
**Why This Matters**: Hook needs count for zero-server isMcpReady derivation.

### REQ-TEST-003: McpClientManager Emit Tests

**Full Text**: Tests verifying `CoreEvent.McpClientUpdate` emission at all state transitions.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/mcp-client-manager.test.ts`
  - ADD test suite for `CoreEvent.McpClientUpdate` emissions
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P07` marker
  - ADD `@requirement:REQ-MGR-001` through `@requirement:REQ-MGR-005` markers

### Test Cases Required

1. **Test: COMPLETED transition emits CoreEvent.McpClientUpdate** (REQ-MGR-001)
   - Setup: Manager with 1 server configured, trigger discovery completion
   - Assert: `coreEvents` received `CoreEvent.McpClientUpdate` with non-empty clients map
   - Assert: `getDiscoveryState()` === `COMPLETED`

2. **Test: IN_PROGRESS transition emits CoreEvent.McpClientUpdate** (REQ-MGR-002)
   - Setup: Manager in NOT_STARTED state, begin discovery
   - Assert: `coreEvents` received `CoreEvent.McpClientUpdate`
   - Assert: `getDiscoveryState()` === `IN_PROGRESS`

3. **Test: Client addition emits CoreEvent.McpClientUpdate** (REQ-MGR-003)
   - Setup: Start discovery, wait for server to connect
   - Assert: `coreEvents` received event with updated clients map

4. **Test: Client removal emits CoreEvent.McpClientUpdate** (REQ-MGR-003)
   - Setup: Manager with active clients, call removeMcpServer
   - Assert: `coreEvents` received event with reduced clients map

5. **Test: Zero-server fast path emits COMPLETED** (REQ-MGR-004)
   - Setup: Manager with empty server config
   - Action: Call `startConfiguredMcpServers()`
   - Assert: Exactly one `CoreEvent.McpClientUpdate` emitted
   - Assert: `getDiscoveryState()` === `COMPLETED`
   - Assert: `getMcpServerCount()` === 0

6. **Test: getMcpServerCount returns correct count** (REQ-MGR-005)
   - Setup: Manager with known number of clients
   - Assert: `getMcpServerCount()` matches expected count

7. **Test: No raw 'mcp-client-update' strings in emits** (REQ-MGR-006)
   - This is a codebase grep check, not a runtime test — documented in verification commands

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P07
 * @requirement:REQ-MGR-001, REQ-MGR-002, REQ-MGR-003, REQ-MGR-004, REQ-MGR-005
 * @requirement:REQ-TEST-003
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P07" packages/core/src/tools/mcp-client-manager.test.ts
# Expected: 1+

# Run test file
npm test -- packages/core/src/tools/mcp-client-manager.test.ts
# Expected: New tests will FAIL (COMPLETED/IN_PROGRESS emits not yet added in P08)

# Note: Some tests may pass if the emit migration in P06 already covers the scenario
# The COMPLETED transition emit and zero-server fast path tests should fail until P08
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
   - [ ] Tests verify COMPLETED transition emits event
   - [ ] Tests verify zero-server fast path
   - [ ] Tests verify getMcpServerCount

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests have concrete assertions on payload content
   - [ ] Tests verify actual coreEvents emission

3. **Would the test FAIL if implementation was removed?**
   - [ ] COMPLETED emit test fails without the new emit (the critical test)
   - [ ] Zero-server test fails without fast path emit

## Success Criteria

- 6+ behavioral tests for MCP manager emit behavior
- Tests use real `coreEvents` singleton to verify emissions
- Plan/requirement markers present
- Tests are well-structured: some may pass (existing emits), some may fail (new emits needed in P08)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/tools/mcp-client-manager.test.ts`
2. Re-read pseudocode `mcp-manager-emits.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P07.md`
