# Phase 10: UI Telemetry TDD

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P10`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P09" .`
- Expected files from previous phase:
  - `packages/ui/src/components/telemetry/TokenUsageDisplay.tsx` with stub component
  - `packages/ui/src/components/telemetry/TelemetryPanel.tsx` with updated imports

## Implementation Tasks

### Files to Create

- `packages/ui/src/components/telemetry/test/TokenUsageDisplay.test.tsx`
  - MUST include: `@plan:PLAN-20250909-TOKENCOUNTER.P10`
  - MUST include: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`
  - Test: Component renders with empty state
  - Test: Component updates with new token metrics
  - Test: Token rate formatting with various values
  - Test: Wait time formatting with various values
  - Test: Component clears display properly

### Files to Modify

- `packages/ui/src/components/telemetry/test/TelemetryPanel.test.tsx`
  - Line 150: Add test suite for token usage display integration
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P10`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`

### Required Code Markers

Every test MUST include:

```typescript
it('should render token usage display component @plan:PLAN-20250909-TOKENCOUNTER.P10 @requirement:REQ-001.1', () => {
  // test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P10" . | wc -l
# Expected: 10+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.1" packages/ui/src/components/telemetry/test/ | wc -l
# Expected: 3+ occurrences

grep -r "@requirement:REQ-001.2" packages/ui/src/components/telemetry/test/ | wc -l
# Expected: 3+ occurrences

grep -r "@requirement:REQ-001.3" packages/ui/src/components/telemetry/test/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.4" packages/ui/src/components/telemetry/test/ | wc -l
# Expected: 2+ occurrences

# Run phase-specific tests (will fail until P11)
npm test -- --grep "@plan:.*P10"
# Expected: Tests exist but fail naturally with "Cannot read property" or "is not a function"
```

### Manual Verification Checklist

- [ ] Phase 09 markers present (TokenUsageDisplay component stub)
- [ ] New test file created for TokenUsageDisplay component
- [ ] Existing test file modified with new test suites
- [ ] Tests follow behavioral pattern (no mocks)
- [ ] Tests will fail naturally until implementation
- [ ] All tests tagged with plan and requirement IDs
- [ ] At least 30% property-based tests included
- [ ] TypeScript compiles without errors

## Success Criteria

- 10+ behavioral tests created for UI telemetry functionality
- Tests cover component rendering and updating
- Tests cover formatting functions for rates and wait times
- Tests cover display clearing functionality
- All tests tagged with P10 marker
- Tests fail with "not implemented" errors, not "cannot find"
- At least 30% of tests are property-based tests

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/ui/src/components/telemetry/test/`
2. Re-run Phase 10 with corrected test designs

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P10.md`