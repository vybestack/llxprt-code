# Phase 16: AppContainer Gating TDD

## Phase ID

`PLAN-20260325-MCPSTATUS.P16`

## Prerequisites

- Required: Phase 15a (AppContainer Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P15a.md`
- Expected files from previous phase: AppContainer with useMcpStatus, useMessageQueue, and handleFinalSubmit gating logic

## Requirements Implemented (Expanded)

### REQ-GATE-001: Slash Command Immediate Execution

**Full Text**: Slash commands shall execute immediately via `submitQuery`, regardless of MCP discovery state.
**Behavior**:
- GIVEN: `discoveryState === IN_PROGRESS` (MCP not ready)
- WHEN: User submits `/help`
- THEN: `submitQuery("/help")` called immediately, prompt NOT added to queue
**Why This Matters**: Users must always be able to use slash commands.

### REQ-GATE-002: Prompt Queuing When MCP Not Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is false, the system shall add the prompt to the message queue.
**Behavior**:
- GIVEN: `isMcpReady === false`, streaming idle
- WHEN: User submits "hello world"
- THEN: `submitQuery` NOT called, prompt queued
**Why This Matters**: Prevents using MCP tools before they are available.

### REQ-GATE-003: Prompt Direct Submission When MCP Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is true and `streamingState` is `Idle`, the system shall call `submitQuery` directly.
**Behavior**:
- GIVEN: `isMcpReady === true`, `streamingState === Idle`
- WHEN: User submits "hello world"
- THEN: `submitQuery("hello world")` called directly
**Why This Matters**: Normal fast path — no unnecessary queue overhead.

### REQ-GATE-004: Input History Tracking Preserved

**Full Text**: Every submitted prompt (whether queued or direct) shall be added to input history for up-arrow recall.
**Behavior**:
- GIVEN: User submits "hello world" while MCP not ready
- WHEN: Prompt is queued
- THEN: `inputHistoryStore.addInput("hello world")` was still called
**Why This Matters**: Users expect up-arrow to recall prompts even if they haven't executed yet.

### REQ-UI-001: First-Queue Info Message

**Full Text**: When the first prompt is queued while MCP is not ready, emit a user feedback info message. Resets per discovery cycle.
**Behavior**:
- GIVEN: `isMcpReady === false`, no prior queue this cycle
- WHEN: First prompt queued
- THEN: Info message emitted
- WHEN: Second prompt queued same cycle
- THEN: No additional message
**Why This Matters**: Informs user once without spamming.

### REQ-TEST-004: Integration: AppContainer MCP Gating

**Full Text**: AppContainer shall have integration-style tests verifying end-to-end submission gating.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/AppContainer.mcp-gating.test.tsx`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P16` marker
  - ADD `@requirement:REQ-GATE-001` through `@requirement:REQ-GATE-005`, `@requirement:REQ-UI-001`, `@requirement:REQ-TEST-004` markers

### Test Cases Required

1. **Test: Slash command executes immediately during MCP init** (REQ-GATE-001)
   - Setup: Render AppContainer with MCP discovery IN_PROGRESS
   - Submit `/help` via input
   - Assert: `submitQuery("/help")` called, NOT queued

2. **Test: Prompt queued when MCP not ready** (REQ-GATE-002)
   - Setup: Render AppContainer with MCP discovery IN_PROGRESS
   - Submit "hello world" via input
   - Assert: `submitQuery` NOT called with "hello world", prompt in queue

3. **Test: Prompt submitted directly when MCP ready** (REQ-GATE-003)
   - Setup: Render AppContainer with MCP discovery COMPLETED
   - Submit "hello world" via input
   - Assert: `submitQuery("hello world")` called directly

4. **Test: Input history preserved for queued prompts** (REQ-GATE-004)
   - Setup: MCP not ready
   - Submit "queued prompt" via input
   - Assert: `inputHistoryStore.addInput("queued prompt")` was called

5. **Test: Info message on first queue entry** (REQ-UI-001)
   - Setup: MCP not ready
   - Submit first prompt → info message emitted
   - Submit second prompt → NO additional info message

6. **Test: Info message resets on new discovery cycle** (REQ-UI-001)
   - Setup: MCP not ready, queue prompt (info shown), MCP completes, MCP restarts discovery
   - Queue prompt again → info message emitted again

7. **Test: Prompt queued when streaming active** (REQ-GATE-005)
   - Setup: MCP ready, streaming state = Responding
   - Submit "hello world" via input
   - Assert: `submitQuery` NOT called, prompt queued

8. **Test: No MCP message on zero-server startup** (REQ-UI-002)
   - Setup: Zero MCP servers configured, `isMcpReady === true` from start
   - Submit "hello" via input
   - Assert: No info message, `submitQuery("hello")` called directly

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P16
 * @requirement:REQ-GATE-001, REQ-GATE-002, REQ-GATE-003, REQ-GATE-004, REQ-GATE-005
 * @requirement:REQ-UI-001, REQ-UI-002, REQ-TEST-004
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P16" packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: 1+

# Count test cases
grep -c "it(\|test(" packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: 8+

# Slash bypass test
grep -c "isSlashCommand\|/help\|/clear\|slash" packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: 2+

# Info message test
grep -c "emitFeedback\|Waiting for MCP\|info.*message\|first.*queue" packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: 2+

# Run tests
npm test -- packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: All pass (AppContainer gating implemented in P15)
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
   - [ ] Tests verify slash commands bypass queue
   - [ ] Tests verify prompt queuing when MCP not ready
   - [ ] Tests verify direct submission when MCP ready
   - [ ] Tests verify info message once-per-cycle
   - [ ] Tests verify input history for both paths

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests assert on specific behavioral outcomes
   - [ ] Tests verify submitQuery called/not-called with exact values

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing gating logic → queued-prompt test fails
   - [ ] Removing slash bypass → slash-command test fails

## Success Criteria

- 8+ behavioral tests
- Slash bypass, queuing, direct submit, info message, history all tested
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `rm packages/cli/src/ui/AppContainer.mcp-gating.test.tsx`
2. Re-read pseudocode `app-container.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P16.md`
