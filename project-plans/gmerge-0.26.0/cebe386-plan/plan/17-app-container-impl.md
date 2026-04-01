# Phase 17: AppContainer Gating Implementation

## Phase ID

`PLAN-20260325-MCPSTATUS.P17`

## Prerequisites

- Required: Phase 16a (AppContainer TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P16a.md`
- Expected files from previous phase: Tests in AppContainer.mcp-gating.test.tsx all passing

## Requirements Implemented (Expanded)

### REQ-GATE-001: Slash Command Immediate Execution

**Full Text**: Slash commands shall execute immediately via `submitQuery`, regardless of MCP discovery state.
**Behavior**:
- GIVEN: `discoveryState === IN_PROGRESS` (MCP not ready)
- WHEN: User submits `/help`
- THEN: `submitQuery("/help")` is called immediately; the prompt is NOT added to the queue
**Why This Matters**: Users must always be able to use slash commands for help, clearing, configuration — even during MCP initialization.

### REQ-GATE-002: Prompt Queuing When MCP Not Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is false, the system shall add the prompt to the message queue.
**Behavior**:
- GIVEN: `isMcpReady === false`, streaming idle
- WHEN: User submits "hello world"
- THEN: `submitQuery` is NOT called; the prompt is added to the message queue for deferred execution
**Why This Matters**: Prevents tool calls against MCP servers that haven't finished discovery, avoiding silent failures.

### REQ-GATE-003: Prompt Direct Submission When MCP Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is true and `streamingState` is `Idle`, the system shall call `submitQuery` directly.
**Behavior**:
- GIVEN: `isMcpReady === true`, `streamingState === Idle`
- WHEN: User submits "hello world"
- THEN: `submitQuery("hello world")` is called directly without touching the queue
**Why This Matters**: This is the normal fast path — no unnecessary queue overhead when everything is ready.

### REQ-GATE-004: Input History Tracking Preserved

**Full Text**: Every submitted prompt (whether queued or direct) shall be added to input history for up-arrow recall.
**Behavior**:
- GIVEN: User submits "hello world" while MCP is not ready
- WHEN: The prompt is queued (not yet executed)
- THEN: `inputHistoryStore.addInput("hello world")` is still called, so the user can recall it with up-arrow
**Why This Matters**: Users expect up-arrow recall to work regardless of whether the prompt has executed yet.

### REQ-GATE-005: Non-Idle Prompt Submission Behavior

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is true and `streamingState` is not `Idle`, the system shall queue the prompt.
**Behavior**:
- GIVEN: `isMcpReady === true`, `streamingState === Responding` (streaming active)
- WHEN: User submits "hello world"
- THEN: `submitQuery` is NOT called; the prompt is queued and auto-submitted when streaming completes and gates reopen
**Why This Matters**: Prompts submitted during active streaming should be queued rather than dropped or causing race conditions.

### REQ-UI-001: First-Queue Info Message

**Full Text**: When the first prompt is queued while MCP is not ready, emit a user feedback info message. Resets per discovery cycle.
**Behavior**:
- GIVEN: `isMcpReady === false`, no prior queue entry this discovery cycle
- WHEN: First prompt is queued
- THEN: An info-severity message is emitted indicating MCP servers are initializing and prompts will be queued
- AND WHEN: A second prompt is queued in the same cycle
- THEN: No additional info message is emitted
**Why This Matters**: Informs users once per discovery cycle without spamming on every queued prompt.

### REQ-UI-002: No Message on Zero-Server Startup

**Full Text**: While zero MCP servers are configured, the system shall not display any MCP initialization message.
**Behavior**:
- GIVEN: Zero MCP servers configured, `isMcpReady === true` from first render
- WHEN: User submits a prompt
- THEN: No MCP-related info message is shown; `submitQuery` is called directly
**Why This Matters**: Users without MCP servers should see no MCP-related noise — the feature is invisible to them.

**Note**: This phase verifies and fixes any issues found during TDD. Since the AppContainer wiring was implemented in P15, this phase is primarily verification and cleanup.

## Implementation Tasks

### Note: Main Work Was Done in P15

The AppContainer wiring was fully implemented in P15. This phase confirms all P16 tests pass and cleans up any issues found during TDD.

### Files to Verify/Fix

- `packages/cli/src/ui/AppContainer.tsx`
  - Verify all P16 tests pass
  - Fix any issues discovered during TDD
  - Verify pseudocode compliance (app-container.md lines 01-54)
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P17` marker if fixes were needed

### Pseudocode Compliance Check

From `analysis/pseudocode/app-container.md`:
- Lines 01-04: Hook calls (useMcpStatus after useGeminiStream)
- Lines 07-12: useMessageQueue with all 4 gate parameters
- Lines 14-21: hasShownMcpQueueMessage ref + reset useEffect
- Lines 24-27: handleFinalSubmit — trim, early return on empty
- Lines 29-31: inputHistoryStore.addInput BEFORE branch
- Lines 33-37: Slash command bypass
- Lines 39-42: Direct submit when all gates open
- Lines 43-51: Queue path + conditional info message
- Lines 53-54: Dependency array

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P17
 * @requirement:REQ-GATE-001, REQ-GATE-002, REQ-GATE-003, REQ-GATE-004, REQ-GATE-005
 * @requirement:REQ-UI-001, REQ-UI-002
 * @pseudocode app-container.md lines 01-54
 */
```

## Verification Commands

### Automated Checks

```bash
# All gating tests pass
npm test -- packages/cli/src/ui/AppContainer.mcp-gating.test.tsx
# Expected: All pass

# TypeScript compiles
npm run typecheck

# No deferred work in gating-related code
grep -n "handleFinalSubmit\|useMcpStatus\|useMessageQueue\|addMessage\|isSlashCommand" packages/cli/src/ui/AppContainer.tsx | grep -i "TODO\|FIXME\|HACK\|STUB"
# Expected: 0

# Full test suite
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
   - [ ] Slash commands bypass the queue at all times
   - [ ] Prompts queued when isMcpReady === false
   - [ ] Prompts submitted directly when all gates open
   - [ ] Info message shown once per discovery cycle
   - [ ] Input history tracks both queued and direct prompts
   - [ ] Zero-server startup: no info message, direct submit

2. **Is this REAL implementation, not placeholder?**
   - [ ] All P16 tests pass with real behavior

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing gating → multiple test failures
   - [ ] Removing slash bypass → slash test fails
   - [ ] Removing info message → info message test fails

4. **Is the feature REACHABLE?**
   - [ ] handleFinalSubmit is called from the existing input handler in AppContainer
   - [ ] hooks are called in the component body on every render

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/ui/AppContainer.tsx | grep -i "mcp\|queue\|gate\|slash\|message"
# Expected: 0

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/ui/AppContainer.tsx | grep -i "mcp\|queue\|gate"
# Expected: 0
```

## Success Criteria

- All P16 tests pass
- TypeScript compiles
- Pseudocode compliance verified
- No deferred implementation in gating logic
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/AppContainer.tsx`
2. Re-read pseudocode `app-container.md` and the specific failing test
3. Re-run verification

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P17.md`
