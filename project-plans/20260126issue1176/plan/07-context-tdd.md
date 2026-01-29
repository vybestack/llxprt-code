# Phase 07: RuntimeInvocationContext TDD

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P06" .`
- Expected files from previous phase:
  - `packages/core/src/runtime/RuntimeInvocationContext.ts`

## Requirements Implemented (Expanded)

### REQ-SEP-004: RuntimeInvocationContext separated fields
**Full Text**: RuntimeInvocationContext MUST expose separated fields (cliSettings, modelBehavior, modelParams, customHeaders).
**Behavior**:
- GIVEN: settings snapshot with temperature/streaming/custom-headers
- WHEN: context is created
- THEN: getters return values from the correct separated bucket
**Why This Matters**: Consumers read correct settings without filtering.

### REQ-SEP-010: Backward compatibility shim
**Full Text**: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
**Behavior**:
- GIVEN: invocation.ephemerals access
- WHEN: value is read
- THEN: value comes from snapshot and remains unchanged after updates
**Why This Matters**: Prevents breaking existing consumers.

## Implementation Tasks

### Files to Create

- `packages/core/src/runtime/__tests__/RuntimeInvocationContext.test.ts`
  - Single-assertion behavioral tests
  - MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P07`

## Test Scenarios (single assertion each)

- getCliSetting returns streaming
- getModelParam returns temperature
- getModelBehavior returns reasoning.enabled
- customHeaders contains user-agent
- ephemerals returns snapshot value
- snapshot is frozen (modifying settings after creation does not change ephemerals)

## Verification Commands

```bash
npm run test -- --grep "P07"
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P07.md`
