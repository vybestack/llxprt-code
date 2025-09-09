# Phase 08: Provider Manager Implementation

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P07" .`
- Expected files from previous phase:
  - `packages/core/src/providers/test/ProviderManager.token.test.ts`
  - `packages/core/src/providers/test/ProviderManager.test.ts` (modified)

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/ProviderManager.ts`
  - Line 45: Implement sessionTokenUsage property (from pseudocode lines 11-12)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P08`
  - Implements: `@requirement:REQ-001.4`
  - @pseudocode lines 11-12

- `packages/core/src/providers/ProviderManager.ts`
  - Line 120: Implement accumulateSessionTokens method (from pseudocode lines 50-120)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P08`
  - Implements: `@requirement:REQ-001.4`
  - @pseudocode lines 50-120

- `packages/core/src/providers/ProviderManager.ts`
  - Line 140: Implement getSessionTokenUsage method (from pseudocode lines 130-140)
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P08`
  - Implements: `@requirement:REQ-001.4`
  - @pseudocode lines 130-140

### Required Code Markers

Every function/class created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P08
 * @requirement REQ-001.4
 * @pseudocode lines 11-12
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P08
 * @requirement REQ-001.4
 * @pseudocode lines 50-120
 */
```

or

```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P08
 * @requirement REQ-001.4
 * @pseudocode lines 130-140
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P08" . | wc -l
# Expected: 6+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.4" packages/core/src/providers/ | wc -l
# Expected: 6+ occurrences

# Run phase-specific tests
npm test -- --grep "@plan:.*P08"
# Expected: All pass
```

### Manual Verification Checklist

- [ ] Phase 07 markers present (TDD tests)
- [ ] sessionTokenUsage property implemented as per pseudocode
- [ ] accumulateSessionTokens method implemented as per pseudocode
- [ ] getSessionTokenUsage method implemented as per pseudocode
- [ ] All existing tests still pass
- [ ] New tests pass
- [ ] Plan markers added to all changes
- [ ] Requirements and pseudocode referenced in all new code
- [ ] TypeScript compiles without errors

## Success Criteria

- ProviderManager.ts fully implements session token tracking features
- All behaviors defined in P07 tests now pass
- All code changes tagged with P08 marker
- TypeScript compilation succeeds
- No console.log or debug code

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/ProviderManager.ts`
2. Files to revert: `packages/core/src/providers/ProviderManager.ts`
3. Cannot proceed to Phase 09 until fixed

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P08.md`