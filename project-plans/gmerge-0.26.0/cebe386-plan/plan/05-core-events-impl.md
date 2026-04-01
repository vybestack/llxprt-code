# Phase 05: Core Events Implementation

## Phase ID

`PLAN-20260325-MCPSTATUS.P05`

## Prerequisites

- Required: Phase 04a (Core Events TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P04a.md`
- Expected files from previous phase: Tests in events.test.ts

## Requirements Implemented (Expanded)

### REQ-EVT-001: McpClientUpdate Event Type

**Full Text**: The `CoreEvent` enum shall include a `McpClientUpdate` member with a unique string value.
**Behavior**:
- GIVEN: The `CoreEvent` enum in `packages/core/src/utils/events.ts`
- WHEN: The enum is inspected
- THEN: A `McpClientUpdate` member exists with a unique string value (e.g., `'mcp-client-update'`)
**Why This Matters**: Without a named enum member, emit/listen sites use raw strings that can silently drift.
**Note**: Already implemented in P03 — this phase verifies.

### REQ-EVT-002: Typed Payload Interface

**Full Text**: The `McpClientUpdate` event shall use a named, typed payload interface.
**Behavior**:
- GIVEN: The `McpClientUpdatePayload` interface in `packages/core/src/utils/events.ts`
- WHEN: The interface is inspected
- THEN: It defines `clients: ReadonlyMap<string, McpClient>` as a required property
**Why This Matters**: Without a typed payload, listeners receive `unknown` and must cast, losing compile-time safety.
**Note**: Already implemented in P03 — this phase verifies.

### REQ-EVT-003: Single Source of Truth for Event Name

**Full Text**: The string value of the `McpClientUpdate` event shall appear exactly once in the codebase — as the enum definition.
**Behavior**:
- GIVEN: The full codebase
- WHEN: Searched for raw `'mcp-client-update'` strings
- THEN: Only the `CoreEvent` enum definition is found (emit sites still use raw strings at this point — they migrate in P08)
**Why This Matters**: String literal sprawl causes silent listener/emitter mismatches.

### REQ-EVT-004: CoreEventEmitter Type Overloads

**Full Text**: Typed overloads exist for on/off/emit.
**Behavior**:
- GIVEN: The `CoreEventEmitter` type in `packages/core/src/utils/events.ts`
- WHEN: Code calls `coreEvents.emit(CoreEvent.McpClientUpdate, payload)`
- THEN: TypeScript enforces that `payload` matches `McpClientUpdatePayload`; mismatched types produce a compile error
**Why This Matters**: Without overloads, `emit('mcp-client-update', {wrong: true})` compiles silently, causing runtime bugs.
**Note**: Already implemented in P03 — this phase verifies.

### REQ-EVT-005: Non-MCP Event Compatibility

**Full Text**: All existing events continue to function correctly.
**Behavior**:
- GIVEN: Existing coreEvents listeners
- WHEN: McpClientUpdate is added
- THEN: No existing event behavior changes
**Why This Matters**: Adding a new event must not break existing subscriptions.

## Implementation Tasks

### Note: Main Work Was Done in P03

The event type system was implemented in P03 (enum, payload, overloads). This phase is verification + cleanup.

### Files to Verify/Fix

- `packages/core/src/utils/events.ts`
  - Verify McpClientUpdate enum entry complete
  - Verify McpClientUpdatePayload interface complete
  - Verify CoreEvents interface entry complete
  - Verify CoreEventEmitter overloads complete
  - Fix any issues found during TDD

### Verification Against Pseudocode

From `analysis/pseudocode/core-events.md`:
- Lines 01-08: McpClientUpdate enum member — verify present
- Lines 10-17: McpClientUpdatePayload interface — verify complete
- Lines 19-28: CoreEvents interface entry — verify present
- Lines 30-46: CoreEventEmitter overloads — verify all three (on, off, emit)

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P05
 * @requirement:REQ-EVT-001, REQ-EVT-002, REQ-EVT-003, REQ-EVT-004, REQ-EVT-005
 * @pseudocode core-events.md lines 01-46
 */
```

## Verification Commands

### Automated Checks

```bash
# All event tests pass
npm test -- packages/core/src/utils/events.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: Exit 0

# Verify plan markers for P03 and P05
grep -c "@plan:PLAN-20260325-MCPSTATUS.P0[35]" packages/core/src/utils/events.ts
# Expected: 1+

# Verify string literal count
grep -c "'mcp-client-update'" packages/core/src/utils/events.ts
# Expected: 1 (only the enum definition)

# Full test suite still passes
npm run test
# Expected: All pass (no regressions)
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
   - [ ] `CoreEvent.McpClientUpdate` exists with string value
   - [ ] `McpClientUpdatePayload` has `clients: ReadonlyMap<string, McpClient>`
   - [ ] Overloads enforce type safety on emit/listen
   - [ ] Existing events unaffected

2. **Is this REAL implementation, not placeholder?**
   - [ ] Enum, interface, and overloads are real — this is declarative code

3. **Would the test FAIL if implementation was removed?**
   - [ ] P04 tests verify all aspects

4. **Is the feature REACHABLE?**
   - [ ] Exported via wildcard from `@vybestack/llxprt-code-core`

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/utils/events.ts
# Expected: No new deferred work markers
```

## Success Criteria

- All P04 tests pass
- TypeScript compiles cleanly
- Only one occurrence of raw `'mcp-client-update'` string (the enum definition)
- No regressions in existing events
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/utils/events.ts`
2. Re-read pseudocode `core-events.md`
3. Fix issues identified by failing tests

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P05.md`
