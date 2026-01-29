# Phase 06: RuntimeInvocationContext Stub

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P05" .`
- Expected files from previous phase:
  - `packages/core/src/settings/settingsRegistry.ts`

## Requirements Implemented (Expanded)

### REQ-SEP-004: RuntimeInvocationContext separated fields
**Full Text**: RuntimeInvocationContext MUST expose separated fields (cliSettings, modelBehavior, modelParams, customHeaders).
**Behavior**:
- GIVEN: Context type is updated
- WHEN: Context is created
- THEN: Fields exist with correct types
**Why This Matters**: Providers and tools can read separate buckets.

### REQ-SEP-010: Backward compatibility shim
**Full Text**: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
**Behavior**:
- GIVEN: ephemerals access
- WHEN: context is created
- THEN: ephemerals field exists as shim
**Why This Matters**: Prevents breaking existing consumers.

## Implementation Tasks

### Files to Modify

- `packages/core/src/runtime/RuntimeInvocationContext.ts`
  - Add separated fields and stub accessor methods
  - Add ephemerals shim placeholder
  - MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P06`

## Verification Commands

```bash
npm run typecheck
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P06.md`
