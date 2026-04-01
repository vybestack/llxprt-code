# Phase 19: Integration Tests

## Phase ID

`PLAN-20260325-MCPSTATUS.P19`

## Prerequisites

- Required: Phase 18a (Event Audit Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P18a.md`
- Expected files from previous phase: All components implemented, event audit clean

## Requirements Implemented (Expanded)

### REQ-EVT-005: Extension and Non-MCP Event Compatibility

**Full Text**: Extension lifecycle events and all other non-MCP events shall continue to function correctly after the migration.
**Behavior**:
- GIVEN: All MCP event migration complete
- WHEN: Extension loads/unloads, flicker fires, other non-MCP events fire
- THEN: All work exactly as before
**Why This Matters**: Prevents regression in unrelated event subsystems.

### REQ-UI-002: No Message on Zero-Server Startup

**Full Text**: While zero MCP servers are configured, no MCP initialization message shall be displayed.
**Behavior**:
- GIVEN: App starts with no MCP servers configured
- WHEN: User submits a prompt
- THEN: No MCP-related info/warning messages, `isMcpReady === true`, prompt submits immediately
**Why This Matters**: Users without MCP servers should see zero difference in behavior.

### REQ-TEST-004: Integration: AppContainer MCP Gating

**Full Text**: AppContainer shall have integration-style tests verifying end-to-end submission gating flow.
**Behavior**:
- GIVEN: Full component tree rendered
- WHEN: MCP events fire, user submits prompts
- THEN: Gating, queuing, flushing all work end-to-end
**Why This Matters**: Unit tests verify individual pieces; integration tests verify they work together.

## Implementation Tasks

### Files to Create

- `integration-tests/mcp-gating.test.ts` (or appropriate test location following project conventions)
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P19` marker
  - ADD `@requirement:REQ-EVT-005`, `@requirement:REQ-UI-002`, `@requirement:REQ-TEST-004` markers

### Test Cases Required

1. **Test: End-to-end prompt gating during MCP discovery** (REQ-TEST-004)
   - Setup: McpClientManager with servers, discovery IN_PROGRESS
   - Submit prompt → queued
   - Fire CoreEvent.McpClientUpdate with COMPLETED
   - Assert: Queued prompt auto-submitted via submitQuery

2. **Test: End-to-end slash command bypass** (REQ-TEST-004)
   - Setup: MCP discovery IN_PROGRESS
   - Submit `/help`
   - Assert: submitQuery called immediately, no queuing

3. **Test: End-to-end FIFO drain after COMPLETED** (REQ-TEST-004)
   - Setup: MCP discovery IN_PROGRESS
   - Queue 3 prompts: "A", "B", "C"
   - Fire COMPLETED event
   - Assert: Prompts drain in order A → B → C across flush cycles

4. **Test: Zero-server startup — no gating** (REQ-UI-002)
   - Setup: No MCP servers configured
   - Submit prompt
   - Assert: submitQuery called immediately, no info message, isMcpReady true from start

5. **Test: Non-MCP events still work post-migration** (REQ-EVT-005)
   - Setup: Full event system initialized
   - Emit non-MCP events (e.g., UserFeedback, SettingsChanged)
   - Assert: Listeners receive events correctly

6. **Test: Two prompts queued — first submits on COMPLETED, second waits for idle** (REQ-TEST-004)
   - Setup: MCP IN_PROGRESS, queue "first" and "second"
   - Fire COMPLETED → "first" auto-submitted
   - Assert: "second" still in queue (streaming state is now non-Idle)
   - Return to Idle → "second" auto-submitted

7. **Test: Info message shown once per discovery cycle in integration** (REQ-UI-001)
   - Setup: Full component tree
   - Queue first prompt → info message
   - Queue second prompt → no additional message
   - Complete discovery, restart discovery, queue prompt → info message again

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P19
 * @requirement:REQ-EVT-005, REQ-UI-002, REQ-TEST-004
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P19" integration-tests/mcp-gating.test.ts
# Expected: 1+

# Count test cases
grep -c "it(\|test(" integration-tests/mcp-gating.test.ts
# Expected: 7+

# Run integration tests
npm test -- integration-tests/mcp-gating.test.ts
# Expected: All pass

# Full suite still passes
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
   - [ ] End-to-end gating flow tested
   - [ ] Zero-server startup tested
   - [ ] Non-MCP event compatibility tested
   - [ ] FIFO drain tested across flush cycles

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests exercise actual component interactions
   - [ ] Tests verify observable outcomes (not just mock calls)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing gating → prompt-queuing test fails
   - [ ] Removing event migration → integration flow breaks

## Success Criteria

- 7+ integration tests
- End-to-end gating flow verified
- Zero-server startup verified
- Non-MCP event compatibility verified
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `rm integration-tests/mcp-gating.test.ts`
2. Review P15-P18 implementation for integration issues
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P19.md`
