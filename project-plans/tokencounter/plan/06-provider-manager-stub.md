# Phase 06: Provider Manager Stub

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P05" .`
- Expected files from previous phase:
  - `packages/core/src/providers/logging/ProviderPerformanceTracker.ts` with fully implemented token tracking

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/ProviderManager.ts`
  - Line 45: Add sessionTokenUsage property to track cumulative token usage
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P06`
  - Implements: `@requirement:REQ-001.4`

- `packages/core/src/providers/ProviderManager.ts`
  - Line 120: Add accumulateSessionTokens method (stub that throws NotYetImplemented)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P06`
  - Implements: `@requirement:REQ-001.4`

- `packages/core/src/providers/ProviderManager.ts`
  - Line 140: Add getSessionTokenUsage method (stub that returns empty object)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P06`
  - Implements: `@requirement:REQ-001.4`

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P06
 * @requirement REQ-001.4
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P06" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered (should fail until implementation)
grep -r "@requirement:REQ-001.4" packages/core/src/providers/ | wc -l
# Expected: 4+ occurrences

# Run phase-specific tests (will fail until P07)
npm test -- --grep "@plan:.*P06"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 05 markers present (ProviderPerformanceTracker implementation)
- [ ] ProviderManager.ts modified with new sessionTokenUsage property
- [ ] accumulateSessionTokens method stub added
- [ ] getSessionTokenUsage method stub added
- [ ] Plan markers added to all changes
- [ ] Requirements referenced in code markers
- [ ] TypeScript compiles without errors

## Success Criteria

- ProviderManager.ts updated with session token tracking properties
- accumulateSessionTokens method stub added
- getSessionTokenUsage method stub added
- All code changes tagged with P06 marker
- TypeScript compilation succeeds
- Tests will fail naturally until implementation (P08)

## Failure Recovery

If this phase fails:

1. Rollback commands: `git checkout -- packages/core/src/providers/ProviderManager.ts`
2. Files to revert: `packages/core/src/providers/ProviderManager.ts`
3. Cannot proceed to Phase 07 until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P06.md`