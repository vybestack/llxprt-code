# Phase 04: ProviderManager Stub Implementation

## Phase ID

`PLAN-20250909-TOKENTRACKING.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENTRACKING.P03" .`
- Expected files from previous phase:
  - `packages/core/src/providers/logging/ProviderPerformanceTracker.ts`
  - `packages/core/src/providers/types.ts`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/ProviderManager.ts`
  - Line 10: Add sessionTokenUsage property to track token usage by provider
  - Line 160: Implement accumulateSessionTokens method
  - Line 170: Implement getSessionTokenUsage method
  - ADD comment: `@plan:PLAN-20250909-TOKENTRACKING.P04`
  - Implements: `@requirement:REQ-001.4` (session cumulative token usage)

### Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENTRACKING.P04
 * @requirement REQ-XXX (where XXX is the requirement ID)
 * @pseudocode lines X-Y (from provider-manager.md)
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENTRACKING.P04" . | wc -l
# Expected: 2+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.4" packages/core/src/providers/ | wc -l
# Expected: 1+ occurrence

# Run phase-specific tests (will fail until P05)
npm test -- --grep "@plan:.*P04"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 03 markers present for ProviderPerformanceTracker modifications
- [ ] ProviderManager class modified with token tracking capabilities
- [ ] Session token usage property added
- [ ] Methods throw "NotYetImplemented" or return empty values when needed
- [ ] All methods tagged with plan and requirement IDs

## Success Criteria

- Session token usage tracking property added to ProviderManager
- accumulateSessionTokens method implemented (stub)
- getSessionTokenUsage method implemented (stub)
- All changes tagged with P04 marker and REQ-001.4 requirement

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/ProviderManager.ts`
2. Re-run Phase 04 with corrected implementation

## Phase Completion Marker

Create: `project-plans/token-tracking/.completed/P04.md`