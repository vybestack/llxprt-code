# Phase 11: UI Telemetry Implementation

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P10" .`
- Expected files from previous phase:
  - `packages/ui/src/components/telemetry/test/TokenUsageDisplay.test.tsx`
  - `packages/ui/src/components/telemetry/test/TelemetryPanel.test.tsx` (modified)

## Implementation Tasks

### Files to Modify

- `packages/ui/src/components/telemetry/TokenUsageDisplay.tsx`
  - Throughout component: Implement token usage display (from pseudocode lines 10-135)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P11`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`
  - @pseudocode lines 10-135

- `packages/ui/src/components/telemetry/TelemetryPanel.tsx`
  - Throughout component: Connect TokenUsageDisplay to telemetry data (from specification)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P11`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`

### Required Code Markers

Every function/class created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P11
 * @requirement REQ-001.1
 * @pseudocode lines 10-135
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P11
 * @requirement REQ-001.2
 * @pseudocode lines 10-135
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P11
 * @requirement REQ-001.3
 * @pseudocode lines 10-135
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P11
 * @requirement REQ-001.4
 * @pseudocode lines 10-135
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P11" . | wc -l
# Expected: 8+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.1" packages/ui/src/components/telemetry/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.2" packages/ui/src/components/telemetry/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.3" packages/ui/src/components/telemetry/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.4" packages/ui/src/components/telemetry/ | wc -l
# Expected: 2+ occurrences

# Run phase-specific tests
npm test -- --grep "@plan:.*P11"
# Expected: All pass
```

### Manual Verification Checklist

- [ ] Phase 10 markers present (TDD tests)
- [ ] TokenUsageDisplay component fully implemented as per pseudocode
- [ ] TelemetryPanel updated to integrate token display component
- [ ] All existing tests still pass
- [ ] New tests pass
- [ ] Plan markers added to all changes
- [ ] Requirements and pseudocode referenced in all new code
- [ ] TypeScript compiles without errors

## Success Criteria

- TokenUsageDisplay component fully implements token display features
- TelemetryPanel properly integrates token display component
- All behaviors defined in P10 tests now pass
- All code changes tagged with P11 marker
- TypeScript compilation succeeds
- No console.log or debug code

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/ui/src/components/telemetry/`
2. Files to revert: `packages/ui/src/components/telemetry/TokenUsageDisplay.tsx`, `packages/ui/src/components/telemetry/TelemetryPanel.tsx`
3. Cannot proceed to next phase until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P11.md`