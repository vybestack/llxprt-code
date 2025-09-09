# Phase 05: Provider Performance Tracker Implementation

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P04" .`
- Expected files from previous phase:
  - `packages/core/src/providers/logging/test/ProviderPerformanceTracker.token.test.ts`
  - `packages/core/src/providers/logging/test/ProviderPerformanceTracker.test.ts` (modified)

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 30: Implement tokensPerSecond calculation (from pseudocode lines 30-33)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P05`
  - Implements: `@requirement:REQ-001.1`
  - @pseudocode lines 30-33

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 85: Implement burst tracking mechanism (from pseudocode lines 110-140)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P05`
  - Implements: `@requirement:REQ-001.2`
  - @pseudocode lines 110-140

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Line 105: Implement updateThrottleWaitTime method (from pseudocode lines 75-101)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P05`
  - Implements: `@requirement:REQ-001.3`
  - @pseudocode lines 75-101

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - Throughout file: Update metrics structure to include new properties (from pseudocode lines 40-55)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P05`
  - Implements: `@requirement:REQ-001.4`
  - @pseudocode lines 40-55

### Required Code Markers

Every function/class created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P05
 * @requirement REQ-001.1
 * @pseudocode lines 30-33
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P05
 * @requirement REQ-001.2
 * @pseudocode lines 110-140
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P05
 * @requirement REQ-001.3
 * @pseudocode lines 75-101
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P05
 * @requirement REQ-001.4
 * @pseudocode lines 40-55
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P05" . | wc -l
# Expected: 10+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.1" packages/core/src/providers/logging/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.2" packages/core/src/providers/logging/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.3" packages/core/src/providers/logging/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-001.4" packages/core/src/providers/logging/ | wc -l
# Expected: 2+ occurrences

# Run phase-specific tests
npm test -- --grep "@plan:.*P05"
# Expected: All pass
```

### Manual Verification Checklist

- [ ] Phase 04 markers present (TDD tests)
- [ ] Tokens per second calculation implemented as per pseudocode
- [ ] Burst tracking mechanism implemented as per pseudocode
- [ ] Throttle wait time updating implemented as per pseudocode
- [ ] Session token usage tracking integrated as per specification
- [ ] All existing tests still pass
- [ ] New tests pass
- [ ] Plan markers added to all changes
- [ ] Requirements and pseudocode referenced in all new code
- [ ] TypeScript compiles without errors

## Success Criteria

- ProviderPerformanceTracker.ts fully implements new token tracking features
- All behaviors defined in P04 tests now pass
- All code changes tagged with P05 marker
- TypeScript compilation succeeds
- No console.log or debug code

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
2. Files to revert: `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
3. Cannot proceed to Phase 06 until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P05.md`