# Phase 03: Provider Performance Tracker Stub

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P02" .`
- Expected files from previous phase:
  - `project-plans/tokencounter/analysis/pseudocode/provider-performance-tracker.md`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 30: Add tokensPerSecond property to metrics structure
  - Line 31: Add burstTokensPerSecond property to metrics structure
  - Line 32: Add throttleWaitTimeMs property to metrics structure
  - Line 33: Add sessionTokenUsage property to metrics structure
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P03`
  - Implements: `@requirement:REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4`

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 85: Add burst tracking mechanism (stub with empty implementation)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P03`
  - Implements: `@requirement:REQ-001.2`

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 105: Add updateThrottleWaitTime method (stub that throws NotYetImplemented)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P03`
  - Implements: `@requirement:REQ-001.3`

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P03
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3, REQ-001.4
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P03
 * @requirement REQ-001.2
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P03
 * @requirement REQ-001.3
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P03" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered (should fail until implementation)
grep -r "@requirement:REQ-001.1" . | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.2" . | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.3" . | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-001.4" . | wc -l
# Expected: 1+ occurrences

# Run phase-specific tests (will fail until P04)
npm test -- --grep "@plan:.*P03"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 02 markers present (pseudocode)
- [ ] ProviderPerformanceTracker.ts modified with new properties
- [ ] Burst tracking mechanism stub added
- [ ] updateThrottleWaitTime method stub added
- [ ] Plan markers added to all changes
- [ ] Requirements referenced in code markers
- [ ] All tests tagged with plan and requirement IDs
- [ ] TypeScript compiles without errors

## Success Criteria

- ProviderPerformanceTracker.ts updated with new metric properties
- Burst tracking stub added
- Throttle wait time update method stub added
- All code changes tagged with P03 marker
- TypeScript compilation succeeds
- Tests will fail naturally until implementation (P05)

## Failure Recovery

If this phase fails:

1. Rollback commands: `git checkout -- packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
2. Files to revert: `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
3. Cannot proceed to Phase 04 until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P03.md`