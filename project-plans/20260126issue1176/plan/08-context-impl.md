# Phase 08: RuntimeInvocationContext Implementation

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P07" .`
- Expected files from previous phase:
  - `packages/core/src/runtime/__tests__/RuntimeInvocationContext.test.ts`

## Requirements Implemented (Expanded)

### REQ-SEP-004: RuntimeInvocationContext separated fields
**Full Text**: RuntimeInvocationContext MUST expose separated fields (cliSettings, modelBehavior, modelParams, customHeaders).
**Behavior**:
- GIVEN: settings snapshot
- WHEN: context is created
- THEN: separated fields are frozen and accessible
**Why This Matters**: Safe snapshots for providers.

### REQ-SEP-010: Backward compatibility shim
**Full Text**: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
**Behavior**:
- GIVEN: context.ephemerals access
- WHEN: property is read
- THEN: value is read from snapshot
**Why This Matters**: Legacy access still works.

## Implementation Tasks

### Files to Modify

- `packages/core/src/runtime/RuntimeInvocationContext.ts`
  - Implement separation and shim per pseudocode lines 01-11
  - Add accessors with correct typing
  - Add @plan markers

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P08
 * @requirement REQ-SEP-004
 * @pseudocode lines 01-11
 */
```

## Verification Commands

```bash
npm run test -- --grep "P07"
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P08.md`
