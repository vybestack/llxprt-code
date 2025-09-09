# Phase 09: UI Telemetry Stub

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P08" .`
- Expected files from previous phase:
  - `packages/core/src/providers/ProviderManager.ts` with session token tracking methods

## Implementation Tasks

### Files to Create

- `packages/ui/src/components/telemetry/TokenUsageDisplay.tsx`
  - MUST include: `@plan:PLAN-20250909-TOKENCOUNTER.P09`
  - MUST include: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`
  - Stub component that displays token metrics
  - Methods for updating display with new metrics
  - Formatting methods for token rates and wait times

### Files to Modify

- `packages/ui/src/components/telemetry/TelemetryPanel.tsx`
  - Line 75: Add TokenUsageDisplay component to telemetry panel
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P09`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P09
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P09
 * @requirement REQ-001.2
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P09" . | wc -l
# Expected: 5+ occurrences

# Check requirements covered (should fail until implementation)
grep -r "@requirement:REQ-001.1" packages/ui/src/components/telemetry/ | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.2" packages/ui/src/components/telemetry/ | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.3" packages/ui/src/components/telemetry/ | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.4" packages/ui/src/components/telemetry/ | wc -l
# Expected: 1+ occurrences

# Run phase-specific tests (will fail until P10)
npm test -- --grep "@plan:.*P09"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 08 markers present (ProviderManager implementation)
- [ ] TokenUsageDisplay component created with stub methods
- [ ] TelemetryPanel.tsx modified to include TokenUsageDisplay
- [ ] Plan markers added to all changes
- [ ] Requirements referenced in code markers
- [ ] TypeScript compiles without errors (JSX support)

## Success Criteria

- TokenUsageDisplay component stub created
- TelemetryPanel updated to include token display component
- All code changes tagged with P09 marker
- TypeScript compilation succeeds
- Tests will fail naturally until implementation (P11)

## Failure Recovery

If this phase fails:

1. Rollback commands: `git checkout -- packages/ui/src/components/telemetry/`
2. Files to revert: `packages/ui/src/components/telemetry/TokenUsageDisplay.tsx`, `packages/ui/src/components/telemetry/TelemetryPanel.tsx`
3. Cannot proceed to Phase 10 until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P09.md`