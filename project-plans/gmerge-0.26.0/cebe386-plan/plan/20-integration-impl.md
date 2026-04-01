# Phase 20: Integration Wiring

## Phase ID

`PLAN-20260325-MCPSTATUS.P20`

## Prerequisites

- Required: Phase 19a (Integration TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P19a.md`
- Expected files from previous phase: Integration tests all passing

## Requirements Implemented (Expanded)

### REQ-EVT-005: Extension and Non-MCP Event Compatibility

**Full Text**: Extension lifecycle events and all other non-MCP events shall continue to function correctly.
**Behavior**:
- GIVEN: All phases P03-P19 complete
- WHEN: Full application runs
- THEN: No regression in any event-driven behavior
**Why This Matters**: Final integration verification before declaring feature complete.

### All Prior Requirements — Final Wiring Verification

This phase ensures all components are connected and no wiring gaps exist between the individually tested pieces. Every requirement from REQ-EVT through REQ-UI should be reachable via a user action.

## Implementation Tasks

### Note: This Is a Wiring Verification Phase

All implementation was done in prior phases. This phase identifies and fixes any remaining gaps found during integration testing.

### Files to Verify/Fix

- `packages/core/src/utils/events.ts`
  - Verify `CoreEvent.McpClientUpdate` and `McpClientUpdatePayload` exported
  - Verify `CoreEventEmitter` has typed overloads

- `packages/core/src/tools/mcp-client-manager.ts`
  - Verify all emit sites use `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`
  - Verify `getMcpServerCount()` exists
  - Verify COMPLETED, IN_PROGRESS, and zero-server emits present

- `packages/cli/src/ui/hooks/useMcpStatus.ts`
  - Verify subscribes to `coreEvents` with cleanup
  - Verify isMcpReady derivation correct

- `packages/cli/src/ui/hooks/useMessageQueue.ts`
  - Verify all 4 gates checked
  - Verify one-at-a-time drain

- `packages/cli/src/ui/AppContainer.tsx`
  - Verify useMcpStatus + useMessageQueue wired
  - Verify handleFinalSubmit gating logic
  - Verify info message tracking
  - Verify input history preserved

- `packages/cli/src/utils/events.ts`
  - Verify AppEvent.McpClientUpdate removed/deprecated
  - Verify non-MCP events intact

### Wiring Verification Matrix

| Source | → | Sink | Via | Verified? |
|--------|---|------|-----|-----------|
| McpClientManager | → | useMcpStatus | coreEvents.emit/on(CoreEvent.McpClientUpdate) | [ ] |
| useMcpStatus | → | useMessageQueue | isMcpReady prop | [ ] |
| useMessageQueue | → | submitQuery | auto-flush effect | [ ] |
| AppContainer input | → | handleFinalSubmit | existing event handler | [ ] |
| handleFinalSubmit | → | submitQuery (slash) | isSlashCommand check | [ ] |
| handleFinalSubmit | → | addMessage (queue) | isMcpReady/streamingState gate | [ ] |
| handleFinalSubmit | → | submitQuery (direct) | all gates open | [ ] |
| handleFinalSubmit | → | inputHistoryStore | addInput before branch | [ ] |
| handleFinalSubmit | → | coreEvents.emitFeedback | info message (first queue) | [ ] |

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P20
 * @requirement:REQ-EVT-005 (final wiring verification)
 */
```

## Verification Commands

### Automated Checks

```bash
# Full test suite
npm run test
# Expected: ALL pass

# TypeScript
npm run typecheck
# Expected: Clean

# Lint
npm run lint
# Expected: Clean

# Format
npm run format
# Expected: No changes

# Build
npm run build
# Expected: Success

# All plan markers present across all phases
grep -r "@plan:PLAN-20260325-MCPSTATUS" packages/core/src packages/cli/src integration-tests/ | grep -oP "P\d+" | sort -u
# Expected: P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16, P17, P18, P19, P20

# No remaining raw string literals
grep -rn "'mcp-client-update'\|\"mcp-client-update\"\|\`mcp-client-update\`" packages/core/src packages/cli/src integration-tests/ | grep -v "CoreEvent\." | grep -v node_modules
# Expected: 0
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
   - [ ] Full wiring matrix verified (all rows checked)
   - [ ] Events flow from manager → hook → queue → submit
   - [ ] Slash commands bypass all gating
   - [ ] Zero-server case: no gating, no messages

2. **Is this REAL implementation, not placeholder?**
   - [ ] All integration tests pass
   - [ ] Smoke test passes

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing any wire → at least one integration test fails

4. **Is the feature REACHABLE?**
   - [ ] handleFinalSubmit called from input handler
   - [ ] Hooks called in component body
   - [ ] McpClientManager started during app initialization

5. **What's MISSING?** (should be nothing — final wiring)
   - [ ] (check for gaps)

### Deferred Implementation Detection

```bash
# Check all MCP-related files for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/utils/events.ts packages/core/src/tools/mcp-client-manager.ts packages/cli/src/ui/hooks/useMcpStatus.ts packages/cli/src/ui/hooks/useMessageQueue.ts packages/cli/src/ui/AppContainer.tsx | grep -v ".test."
# Expected: 0

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/utils/events.ts packages/core/src/tools/mcp-client-manager.ts packages/cli/src/ui/hooks/useMcpStatus.ts packages/cli/src/ui/hooks/useMessageQueue.ts packages/cli/src/ui/AppContainer.tsx
# Expected: 0
```

## Success Criteria

- Full wiring matrix verified
- All tests pass (unit + integration)
- TypeScript compiles
- Lint passes
- Format clean
- Build succeeds
- No raw string literals outside enum definition
- No deferred implementation

## Failure Recovery

If this phase fails:
1. Identify the specific wiring gap from the failing test
2. Fix the connection (import, prop threading, event name)
3. Re-run full verification
4. Do NOT revert entire phases — fix the specific gap

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P20.md`
