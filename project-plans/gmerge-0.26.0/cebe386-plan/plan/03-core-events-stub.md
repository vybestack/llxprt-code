# Phase 03: Core Events Stub

## Phase ID

`PLAN-20260325-MCPSTATUS.P03`

## Prerequisites

- Required: Phase 02a (Pseudocode Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P02a.md`
- Expected files from previous phase: All 5 pseudocode files in `analysis/pseudocode/`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-EVT-001: McpClientUpdate Event Type

**Full Text**: The `CoreEvent` enum shall include a `McpClientUpdate` member with a unique string value.
**Behavior**:
- GIVEN: The `CoreEvent` enum in `packages/core/src/utils/events.ts`
- WHEN: The enum is inspected
- THEN: `CoreEvent.McpClientUpdate` exists and maps to a unique string value
**Why This Matters**: Without the enum member, all downstream code (emitters, listeners) has no typed constant to reference.

### REQ-EVT-002: Typed Payload Interface

**Full Text**: The `McpClientUpdate` event shall use a named, typed payload interface following LLxprt conventions.
**Behavior**:
- GIVEN: The events module
- WHEN: `McpClientUpdatePayload` is inspected
- THEN: It contains a `clients` property typed as `ReadonlyMap<string, McpClient>`
**Why This Matters**: Named payload interfaces are the LLxprt convention for all core events. The `ReadonlyMap` prevents accidental mutation of the manager's internal client map.

### REQ-EVT-004: CoreEventEmitter Type Overloads

**Full Text**: The `CoreEventEmitter` class shall include typed `on`, `off`, and `emit` overloads for the `McpClientUpdate` event.
**Behavior**:
- GIVEN: A `CoreEventEmitter` instance
- WHEN: `on(CoreEvent.McpClientUpdate, handler)` is called
- THEN: TypeScript enforces `handler: (payload: McpClientUpdatePayload) => void`
**Why This Matters**: Without type overloads, handlers receive `any` payload, losing compile-time safety.

## Implementation Tasks

### Why This Phase Is Both Stub AND Implementation

Schema/type definitions in `events.ts` are **declarative** — the definition IS the implementation. The enum member, payload interface, and type overloads are all compile-time artifacts. There is no "stub" behavior to replace later. This phase implements the full event type system.

### Files to Modify

- `packages/core/src/utils/events.ts`
  - ADD `McpClientUpdate = 'mcp-client-update'` to `CoreEvent` enum (after `SettingsChanged`)
  - ADD `import type { McpClient } from '../tools/mcp-client.js'` (if not already present)
  - ADD `McpClientUpdatePayload` interface with `readonly clients: ReadonlyMap<string, McpClient>`
  - ADD `[CoreEvent.McpClientUpdate]: [McpClientUpdatePayload]` to `CoreEvents` interface
  - ADD `on`, `off`, `emit` overloads for `McpClientUpdate` to `CoreEventEmitter` class
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P03` marker
  - ADD `@requirement:REQ-EVT-001`, `@requirement:REQ-EVT-002`, `@requirement:REQ-EVT-004` markers

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P03
 * @requirement:REQ-EVT-001, REQ-EVT-002, REQ-EVT-004
 * @pseudocode core-events.md lines 01-46
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260325-MCPSTATUS.P03" packages/core/src/utils/events.ts | wc -l
# Expected: 1+

# Check McpClientUpdate exists in enum
grep "McpClientUpdate" packages/core/src/utils/events.ts | wc -l
# Expected: 3+ (enum, interface, overloads)

# Check McpClientUpdatePayload exists
grep "McpClientUpdatePayload" packages/core/src/utils/events.ts | wc -l
# Expected: 2+ (interface definition, usage in overload/CoreEvents)

# Check ReadonlyMap used for clients
grep "ReadonlyMap.*McpClient" packages/core/src/utils/events.ts | wc -l
# Expected: 1+

# TypeScript compiles
npm run typecheck

# Verify no raw string 'mcp-client-update' outside enum definition
grep -n "'mcp-client-update'" packages/core/src/utils/events.ts | wc -l
# Expected: 1 (only the enum value itself)
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
   - [ ] `CoreEvent.McpClientUpdate` is defined
   - [ ] `McpClientUpdatePayload` has `clients: ReadonlyMap<string, McpClient>`
   - [ ] `CoreEventEmitter` has typed overloads for the new event

2. **Is this REAL implementation, not placeholder?**
   - [ ] Enum member has a real string value
   - [ ] Payload interface has real typed properties
   - [ ] Overloads match the pattern of existing events

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests in P04 will verify type compilation — not yet written

4. **Is the feature REACHABLE?**
   - [ ] `CoreEvent` is exported from `@vybestack/llxprt-code-core` via wildcard re-export
   - [ ] `McpClientUpdatePayload` follows the same export path

5. **What's MISSING?** (expected — deferred to later phases)
   - [ ] Emit sites in McpClientManager (P06-P08)
   - [ ] Listener in useMcpStatus (P09-P11)

## Success Criteria

- `CoreEvent.McpClientUpdate` exists with string value
- `McpClientUpdatePayload` interface exported with `clients: ReadonlyMap<string, McpClient>`
- `CoreEventEmitter` has on/off/emit overloads for McpClientUpdate
- `CoreEvents` interface includes the new event
- `npm run typecheck` passes
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/utils/events.ts`
2. Re-read pseudocode `core-events.md` lines 01-46
3. Retry the event type additions

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P03.md`
