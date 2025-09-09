# Phase 06: RetryService Stub Implementation

## Phase ID

`PLAN-20250909-TOKENTRACKING.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENTRACKING.P05" .`
- Expected files from previous phase:
  - `packages/core/src/providers/LoggingProviderWrapper.ts`

## Implementation Tasks

### Files to Modify

- `packages/core/src/utils/retry.ts`
  - Line 150: Implement recordRetryWait function
  - ADD comment: `@plan:PLAN-20250909-TOKENTRACKING.P06`
  - Implements: `@requirement:REQ-001.3` (throttle wait time tracking)

### Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENTRACKING.P06
 * @requirement REQ-001.3
 * @pseudocode lines X-Y (from retry-service.md)
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENTRACKING.P06" . | wc -l
# Expected: 1+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.3" packages/core/src/utils/retry.ts | wc -l
# Expected: 1 occurrences

# Run phase-specific tests (will fail until P07)
npm test -- --grep "@plan:.*P06"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 05 markers present for LoggingProviderWrapper modifications
- [ ] Retry service modified with throttle wait time tracking
- [ ] Methods throw "NotYetImplemented" or return empty values when needed
- [ ] All methods tagged with plan and requirement IDs
- [ ] New function properly integrated with ProviderPerformanceTracker

## Success Criteria

- recordRetryWait function implemented (stub)
- Function connects to ProviderPerformanceTracker for actual metric recording
- Changes tagged with P06 marker and REQ-001.3 requirement

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/utils/retry.ts`
2. Re-run Phase 06 with corrected implementation

## Phase Completion Marker

Create: `project-plans/token-tracking/.completed/P06.md`