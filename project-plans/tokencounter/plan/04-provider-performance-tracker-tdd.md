# Phase 04: Provider Performance Tracker TDD

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P03" .`
- Expected files from previous phase:
  - `packages/core/src/providers/logging/ProviderPerformanceTracker.ts` with new properties

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/logging/test/ProviderPerformanceTracker.token.test.ts`
  - MUST include: `@plan:PLAN-20250909-TOKENCOUNTER.P04`
  - MUST include: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`
  - Test: Tokens per second calculation with various durations
  - Test: Burst rate tracking functionality
  - Test: Throttle wait time updating
  - Test: Session token usage tracking integration

### Files to Modify

- `packages/core/src/providers/logging/test/ProviderPerformanceTracker.test.ts`
  - Line 250: Add test suite for new token tracking features
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P04`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`

### Required Code Markers

Every test MUST include:

```typescript
it('should calculate tokens per second @plan:PLAN-20250909-TOKENCOUNTER.P04 @requirement:REQ-001.1', () => {
  // test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P04" . | wc -l
# Expected: 15+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.1" packages/core/src/providers/logging/test/ | wc -l
# Expected: 4+ occurrences

grep -r "@requirement:REQ-001.2" packages/core/src/providers/logging/test/ | wc -l
# Expected: 4+ occurrences

grep -r "@requirement:REQ-001.3" packages/core/src/providers/logging/test/ | wc -l
# Expected: 3+ occurrences

grep -r "@requirement:REQ-001.4" packages/core/src/providers/logging/test/ | wc -l
# Expected: 4+ occurrences

# Run phase-specific tests (will fail until P05)
npm test -- --grep "@plan:.*P04"
# Expected: Tests exist but fail naturally with "Cannot read property" or "is not a function"
```

### Manual Verification Checklist

- [ ] Phase 03 markers present (ProviderPerformanceTracker changes)
- [ ] New test file created for token tracking functionality
- [ ] Existing test file modified with new test suites
- [ ] Tests follow behavioral pattern (no mocks)
- [ ] Tests will fail naturally until implementation
- [ ] All tests tagged with plan and requirement IDs
- [ ] At least 30% property-based tests included
- [ ] TypeScript compiles without errors

## Success Criteria

- 15+ behavioral tests created for token tracking functionality
- Tests cover tokens per second calculation
- Tests cover burst rate tracking
- Tests cover throttle wait time updating
- Tests cover session token usage tracking
- All tests tagged with P04 marker
- Tests fail with "not implemented" errors, not "cannot find"
- At least 30% of tests are property-based tests

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/logging/test/`
2. Re-run Phase 04 with corrected test designs

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P04.md`