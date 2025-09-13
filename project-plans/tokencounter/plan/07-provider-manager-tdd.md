# Phase 07: Provider Manager TDD

## Phase ID

`PLAN-20250909-TOKENCOUNTER.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P06" .`
- Expected files from previous phase:
  - `packages/core/src/providers/ProviderManager.ts` with new properties and stub methods

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/test/ProviderManager.token.test.ts`
  - MUST include: `@plan:PLAN-20250909-TOKENCOUNTER.P07`
  - MUST include: `@requirement:REQ-001.4`
  - Test: Session token initialization
  - Test: Token accumulation with various combinations of input/output/cache/tool/thought tokens
  - Test: Token accumulation with missing optional token types
  - Test: Session token retrieval
  - Test: Error handling for unregistered providers

### Files to Modify

- `packages/core/src/providers/test/ProviderManager.test.ts`
  - Line 300: Add test suite for session token tracking functionality
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P07`
  - Implements: `@requirement:REQ-001.4`

### Required Code Markers

Every test MUST include:

```typescript
it('should initialize session token tracking @plan:PLAN-20250909-TOKENCOUNTER.P07 @requirement:REQ-001.4', () => {
  // test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P07" . | wc -l
# Expected: 12+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001.4" packages/core/src/providers/test/ | wc -l
# Expected: 6+ occurrences

# Run phase-specific tests (will fail until P08)
npm test -- --grep "@plan:.*P07"
# Expected: Tests exist but fail naturally with "Cannot read property" or "is not a function"
```

### Manual Verification Checklist

- [ ] Phase 06 markers present (ProviderManager changes)
- [ ] New test file created for session token tracking functionality
- [ ] Existing test file modified with new test suites
- [ ] Tests follow behavioral pattern (no mocks)
- [ ] Tests will fail naturally until implementation
- [ ] All tests tagged with plan and requirement IDs
- [ ] At least 30% property-based tests included
- [ ] TypeScript compiles without errors

## Success Criteria

- 12+ behavioral tests created for session token tracking functionality
- Tests cover session initialization
- Tests cover token accumulation with all token types
- Tests cover token accumulation with missing optional types
- Tests cover session token retrieval
- Tests cover error handling for invalid providers
- All tests tagged with P07 marker
- Tests fail with "not implemented" errors, not "cannot find"
- At least 30% of tests are property-based tests

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/test/`
2. Re-run Phase 07 with corrected test designs

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P07.md`