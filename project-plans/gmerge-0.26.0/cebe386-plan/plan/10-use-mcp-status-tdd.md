# Phase 10: useMcpStatus TDD

## Phase ID

`PLAN-20260325-MCPSTATUS.P10`

## Prerequisites

- Required: Phase 09a (useMcpStatus Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P09a.md`
- Expected files from previous phase: `packages/cli/src/ui/hooks/useMcpStatus.ts`

## Requirements Implemented (Expanded)

### REQ-HOOK-001: Initial State from Current Manager

**Full Text**: The hook initializes from the manager's current state.
**Behavior**:
- GIVEN: Manager at COMPLETED
- WHEN: Hook mounts
- THEN: `discoveryState === COMPLETED`, `isMcpReady === true`
**Why This Matters**: Prevents stale state if hook mounts late.

### REQ-HOOK-002: Reactive State Updates

**Full Text**: When a `CoreEvent.McpClientUpdate` event is emitted, the hook updates.
**Behavior**:
- GIVEN: Hook mounted with IN_PROGRESS state
- WHEN: Manager transitions to COMPLETED and emits
- THEN: Hook's `discoveryState` updates to COMPLETED
**Why This Matters**: Core reactivity mechanism.

### REQ-HOOK-003: isMcpReady Derivation

**Full Text**: `isMcpReady` is true when COMPLETED, or when NOT_STARTED with 0 servers.
**Behavior**:
- GIVEN: Various state combinations
- WHEN: `isMcpReady` is read
- THEN: Follows the truth table: COMPLETED→true, NOT_STARTED+0→true, IN_PROGRESS→false, NOT_STARTED+N>0→false
**Why This Matters**: Determines whether the message queue gate opens.

### REQ-HOOK-004: Listener Cleanup on Unmount

**Full Text**: The hook removes its listener when the component unmounts.
**Behavior**:
- GIVEN: Hook is mounted and listening
- WHEN: Component unmounts
- THEN: `coreEvents.off` is called, no further state updates
**Why This Matters**: Prevents memory leaks and stale closure bugs.

### REQ-TEST-001: useMcpStatus Unit Tests

**Full Text**: Comprehensive unit tests covering all state combinations and transitions.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/hooks/useMcpStatus.test.tsx`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P10` marker
  - ADD `@requirement:REQ-HOOK-001` through `@requirement:REQ-HOOK-005`, `@requirement:REQ-TEST-001` markers

### Test Cases Required

1. **Test: Initialize with no servers → isMcpReady === true** (REQ-HOOK-001, REQ-HOOK-003)
   - Config has manager with 0 servers, NOT_STARTED
   - Assert: `discoveryState === NOT_STARTED`, `mcpServerCount === 0`, `isMcpReady === true`

2. **Test: Initialize with servers, NOT_STARTED → isMcpReady === false** (REQ-HOOK-001, REQ-HOOK-003)
   - Config has manager with 1+ servers, NOT_STARTED
   - Assert: `isMcpReady === false`

3. **Test: Initialize with servers, IN_PROGRESS → isMcpReady === false** (REQ-HOOK-003)
   - Config has manager at IN_PROGRESS
   - Assert: `isMcpReady === false`

4. **Test: Initialize with manager already COMPLETED → isMcpReady === true** (REQ-HOOK-001)
   - Config has manager at COMPLETED
   - Assert: `discoveryState === COMPLETED`, `isMcpReady === true`

5. **Test: Event emission updates state** (REQ-HOOK-002)
   - Mount with IN_PROGRESS, then emit CoreEvent.McpClientUpdate with manager at COMPLETED
   - Assert: state transitions to COMPLETED, isMcpReady becomes true

6. **Test: Cleanup on unmount removes listener** (REQ-HOOK-004)
   - Mount hook, capture listener count
   - Unmount component
   - Emit event
   - Assert: no state update after unmount

7. **Test: Config with no McpClientManager** (REQ-HOOK-001)
   - Config returns null for getMcpClientManager()
   - Assert: `discoveryState === NOT_STARTED`, `mcpServerCount === 0`, `isMcpReady === true`

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P10
 * @requirement:REQ-HOOK-001, REQ-HOOK-002, REQ-HOOK-003, REQ-HOOK-004, REQ-HOOK-005
 * @requirement:REQ-TEST-001
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P10" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 1+

# Run tests
npm test -- packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: All pass (hook was fully implemented in P09)

# No mock theater
grep -c "toHaveBeenCalled\b" packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: 0 or minimal
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
   - [ ] Tests cover all 4 isMcpReady state combinations
   - [ ] Tests verify event-driven state updates
   - [ ] Tests verify cleanup on unmount

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests have concrete assertions on state values
   - [ ] Tests use real coreEvents for emission

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing isMcpReady logic → state tests fail
   - [ ] Removing useEffect → cleanup test fails

## Success Criteria

- 7+ behavioral tests
- All isMcpReady truth table entries covered
- Event-driven updates verified
- Cleanup verified
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `rm packages/cli/src/ui/hooks/useMcpStatus.test.tsx`
2. Re-read pseudocode `use-mcp-status.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P10.md`
