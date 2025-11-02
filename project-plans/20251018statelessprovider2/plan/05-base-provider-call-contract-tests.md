# Phase 05: Base Provider Call Contract Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P05`

## Prerequisites

- Required: Phase 04a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P04a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Pseudocode document `base-provider-call-contract.md`
  - Stub test suite `baseProvider.stateless.stub.test.ts`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/__tests__/baseProvider.stateless.stub.test.ts`
  - Rename file to `baseProvider.stateless.test.ts`
  - Replace placeholder test with comprehensive TDD suite verifying:
    1. Providers read models/base URLs exclusively from call options
    2. Concurrent calls with different options remain isolated
    3. Settings overrides revert after completion
  - Each test MUST reference pseudocode line numbers (from `base-provider-call-contract.md`)
  - Tests MUST currently fail with existing implementation

- `project-plans/20251018statelessprovider2/analysis/pseudocode/base-provider-call-contract.md`
  - Update with line numbers referenced in tests if numbering changed

### Required Code Markers

```typescript
it('restores settings after call @plan:PLAN-20251018-STATELESSPROVIDER2.P05 @requirement:REQ-SP2-001 @pseudocode base-provider-call-contract.md lines X-Y', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P05" packages/core/src/providers/__tests__/baseProvider.stateless.test.ts

# EXPECTED TO FAIL
npm test -- --run baseProvider.stateless
```

### Manual Verification Checklist

- [ ] Tests cover all pseudocode steps
- [ ] Failure message clearly indicates shared-state issue
- [ ] No implementation changes made yet

## Success Criteria

- Test suite fails due to existing stateful behavior
- Plan markers and pseudocode references present

## Failure Recovery

1. Revert renamed file
2. Recreate failing tests per instructions

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P05.md`

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/__tests__/baseProvider.stateless.test.ts
- project-plans/20251018statelessprovider2/analysis/pseudocode/base-provider-call-contract.md
Verification:
- <paste failing command output>
```
