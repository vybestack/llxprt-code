# Phase 05: LoggingProviderWrapper Stub Implementation

## Phase ID

`PLAN-20250909-TOKENTRACKING.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENTRACKING.P04" .`
- Expected files from previous phase:
  - `packages/core/src/providers/ProviderManager.ts`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/LoggingProviderWrapper.ts`
  - Line 160: Implement recordSessionTokenUsage method
  - Line 290: Implement recordRequestMetrics method
  - Line 300: Implement recordThrottleWait method
  - ADD comment: `@plan:PLAN-20250909-TOKENTRACKING.P05`
  - Implements: `@requirement:REQ-001.1` (tokens per second tracking)
  - Implements: `@requirement:REQ-001.2` (burst tokens tracking)
  - Implements: `@requirement:REQ-001.3` (throttle wait time tracking)
  - Implements: `@requirement:REQ-001.4` (session cumulative token usage)

### Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENTRACKING.P05
 * @requirement REQ-XXX (where XXX is the requirement ID)
 * @pseudocode lines X-Y (from logging-provider-wrapper.md)
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENTRACKING.P05" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.[1234]" packages/core/src/providers/LoggingProviderWrapper.ts | wc -l
# Expected: 4 occurrences

# Run phase-specific tests (will fail until P06)
npm test -- --grep "@plan:.*P05"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 04 markers present for ProviderManager modifications
- [ ] LoggingProviderWrapper class modified with token tracking capabilities
- [ ] Methods throw "NotYetImplemented" or return empty values when needed
- [ ] All methods tagged with plan and requirement IDs
- [ ] New methods properly integrated with ProviderPerformanceTracker

## Success Criteria

- recordSessionTokenUsage method implemented (stub)
- recordRequestMetrics method implemented (stub)
- recordThrottleWait method implemented (stub)
- All changes tagged with P05 marker and corresponding requirements
- Methods connect to ProviderPerformanceTracker for actual metric recording

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/LoggingProviderWrapper.ts`
2. Re-run Phase 05 with corrected implementation

## Phase Completion Marker

Create: `project-plans/token-tracking/.completed/P05.md`