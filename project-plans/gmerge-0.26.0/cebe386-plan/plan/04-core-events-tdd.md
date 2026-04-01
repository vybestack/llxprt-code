# Phase 04: Core Events TDD

## Phase ID

`PLAN-20260325-MCPSTATUS.P04`

## Prerequisites

- Required: Phase 03a (Core Events Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P03a.md`
- Expected files from previous phase: Modified `packages/core/src/utils/events.ts` with McpClientUpdate

## Requirements Implemented (Expanded)

### REQ-EVT-001: McpClientUpdate Event Type

**Full Text**: The `CoreEvent` enum shall include a `McpClientUpdate` member with a unique string value.
**Behavior**:
- GIVEN: The `CoreEvent` enum
- WHEN: `CoreEvent.McpClientUpdate` is accessed
- THEN: It returns a string value
**Why This Matters**: Runtime verification that the enum member exists and has a value.

### REQ-EVT-002: Typed Payload Interface

**Full Text**: The `McpClientUpdate` event shall use a named, typed payload interface.
**Behavior**:
- GIVEN: A `coreEvents` emitter
- WHEN: `emit(CoreEvent.McpClientUpdate, { clients: new Map() })` is called
- THEN: The event is received by listeners with the correct payload type
**Why This Matters**: Verifies runtime emit/listen cycle works.

### REQ-EVT-004: CoreEventEmitter Type Overloads

**Full Text**: The `CoreEventEmitter` class shall include typed overloads for the `McpClientUpdate` event.
**Behavior**:
- GIVEN: A `coreEvents` listener registered for `McpClientUpdate`
- WHEN: `McpClientUpdate` is emitted with a payload
- THEN: The listener receives the payload
**Why This Matters**: Verifies the event system actually works at runtime, not just at compile time.

## Implementation Tasks

### Files to Create or Modify

- `packages/core/src/utils/events.test.ts` (create if not exists, otherwise modify)
  - ADD test suite for `CoreEvent.McpClientUpdate`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P04` marker
  - ADD `@requirement:REQ-EVT-001`, `@requirement:REQ-EVT-002`, `@requirement:REQ-EVT-004` markers

### Test Cases Required

1. **Test: CoreEvent.McpClientUpdate has a string value**
   - `expect(CoreEvent.McpClientUpdate).toBe('mcp-client-update')`

2. **Test: coreEvents emits and receives McpClientUpdate**
   - Register listener on `coreEvents` for `CoreEvent.McpClientUpdate`
   - Emit event with a `McpClientUpdatePayload`
   - Assert listener received the payload with correct `clients` map

3. **Test: McpClientUpdate payload contains clients as ReadonlyMap**
   - Emit with `{ clients: new Map([['test-server', mockClient]]) }`
   - Assert `payload.clients.get('test-server')` equals the mock client
   - Assert `payload.clients.size` equals 1

4. **Test: coreEvents.off removes McpClientUpdate listener**
   - Register listener, then remove with `off`
   - Emit event
   - Assert listener was NOT called after removal

5. **Test: McpClientUpdate does not interfere with existing events**
   - Register listeners for both `CoreEvent.UserFeedback` and `CoreEvent.McpClientUpdate`
   - Emit `McpClientUpdate`
   - Assert only McpClientUpdate listener fires
   - Emit `UserFeedback`
   - Assert only UserFeedback listener fires

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P04
 * @requirement:REQ-EVT-001, REQ-EVT-002, REQ-EVT-004
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers in test file
grep -c "@plan:PLAN-20260325-MCPSTATUS.P04" packages/core/src/utils/events.test.ts
# Expected: 1+

# Check requirement markers
grep -c "@requirement:REQ-EVT-00" packages/core/src/utils/events.test.ts
# Expected: 1+

# Run the specific test file
npm test -- packages/core/src/utils/events.test.ts
# Expected: All tests pass (P03 already implemented the types)
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
   - [ ] Tests verify McpClientUpdate enum value
   - [ ] Tests verify emit/listen round-trip

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests have concrete assertions (toBe, toEqual)
   - [ ] No mock theater

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing enum member → import fails
   - [ ] Removing overloads → TypeScript compile error

4. **Is the feature REACHABLE?**
   - [ ] coreEvents is the singleton used throughout the app

## Success Criteria

- 5+ behavioral tests for CoreEvent.McpClientUpdate
- Tests verify runtime emit/listen cycle
- Tests verify listener cleanup
- Tests verify non-interference with existing events
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/utils/events.test.ts`
2. Re-read pseudocode `core-events.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P04.md`
