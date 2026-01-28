# Phase 16: Compatibility Implementation

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P15" .`

## Requirements Implemented (Expanded)

### REQ-SEP-010: Backward compatibility shim
**Full Text**: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
**Behavior**:
- GIVEN: invocation.ephemerals access
- WHEN: access occurs
- THEN: a deprecation warning path is triggered (per architecture)
**Why This Matters**: Allows migration without breaking existing code.

## Implementation Tasks

### Files to Modify

- `packages/core/src/runtime/RuntimeInvocationContext.ts`
  - Add deprecation warning behavior to ephemerals shim
  - Ensure warning is gated (e.g., DEBUG or test)

Add @plan markers and pseudocode references.

## Verification Commands

```bash
npm run test -- --grep "P07"
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P16.md`
