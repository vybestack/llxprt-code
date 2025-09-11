# Phase 07: ProviderPerformanceTracker TDD Implementation

## Phase ID

`PLAN-20250909-TOKENTRACKING.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENTRACKING.P06" .`
- Expected files from previous phase:
  - `packages/core/src/utils/retry.ts`

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/logging/ProviderPerformanceTracker.tokenTracking.test.ts`
  - MUST include: `@plan:PLAN-20250909-TOKENTRACKING.P07`
  - MUST include: `@requirement:REQ-001.1`
  - MUST include: `@requirement:REQ-001.2`
  - MUST include: `@requirement:REQ-001.3`
  - MUST include: `@requirement:REQ-001.4`
  - Test: tokensPerSecond calculation
  - Test: burstTokensPerSecond tracking
  - Test: throttleWaitTimeMs accumulation
  - Test: sessionTokenUsage accumulation

### Files to Modify

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 18: Update initializeMetrics to include new metric fields
  - Line 60: Update recordCompletion to calculate tokensPerSecond
  - Line 85: Add recordSessionTokenUsage method
  - Line 90: Add recordBurstRate method
  - Line 96: Add recordThrottleWait method
  - ADD comment: `@plan:PLAN-20250909-TOKENTRACKING.P07`
  - Implements: `@requirement:REQ-001.1` (tokens per second tracking)
  - Implements: `@requirement:REQ-001.2` (burst tokens tracking)
  - Implements: `@requirement:REQ-001.3` (throttle wait time tracking)
  - Implements: `@requirement:REQ-001.4` (session cumulative token usage)

### Required Code Markers

Every test and implementation MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENTRACKING.P07
 * @requirement REQ-XXX
 * @pseudocode lines X-Y (from provider-performance-tracker.md)
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENTRACKING.P07" . | wc -l
# Expected: 5+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.[1234]" packages/core/src/providers/logging/ | wc -l
# Expected: 4+ occurrences

# Run phase-specific tests
npm test -- --grep "@plan:.*P07"
# Expected: All tests pass
```

### Manual Verification Checklist

- [ ] Phase 06 markers present
- [ ] Test file created for ProviderPerformanceTracker token tracking
- [ ] ProviderPerformanceTracker properly extended with new methods
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests pass with proper implementation (not stub behavior)
- [ ] New metrics properly initialized in initializeMetrics
- [ ] Tokens per second correctly calculated during recordCompletion
- [ ] Session token usage properly accumulated
- [ ] Burst rate tracking implemented
- [ ] Throttle wait time tracking implemented

## Success Criteria

- ProviderPerformanceTracker.tokenTracking.test.ts file created with comprehensive tests
- ProviderPerformanceTracker.ts modified with implementation of new methods
- All tests pass and verify real behavior (not stubs)
- Implementation follows pseudocode exactly
- All changes tagged with P07 marker and corresponding requirements

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
2. `git checkout -- packages/core/src/providers/logging/ProviderPerformanceTracker.tokenTracking.test.ts`
3. Re-run Phase 07 with corrected implementation

## Phase Completion Marker

Create: `project-plans/token-tracking/.completed/P07.md`