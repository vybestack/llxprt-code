# Phase 17: Auth Scope Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P17`

## Prerequisites

- Required: Phase 16a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P16a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Pseudocode document `auth-runtime-scope.md`
  - Stub auth suite

## Implementation Tasks

### Files to Modify

- `packages/core/src/auth/__tests__/authRuntimeScope.stub.test.ts`
  - Rename to `authRuntimeScope.test.ts`
  - Implement tests covering runtime-specific token caching, cache invalidation, and OAuth fallback
  - Reference pseudocode line numbers in each test case

- Update pseudocode document if numbering changed

### Required Code Markers

```typescript
it('isolates cached token per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P17 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines X-Y', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P17" packages/core/src/auth/__tests__/authRuntimeScope.test.ts

# EXPECTED TO FAIL
npm test -- --run authRuntimeScope
```

### Manual Verification Checklist

- [ ] Tests fail due to shared caching
- [ ] Each test references pseudocode lines
- [ ] No implementation changes yet

## Success Criteria

- Failure exposes runtime-scoped auth gap

## Failure Recovery

1. Revert renamed file
2. Recreate failing tests

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P17.md`

```markdown
Phase: P17
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/auth/__tests__/authRuntimeScope.test.ts
- project-plans/20251018statelessprovider2/analysis/pseudocode/auth-runtime-scope.md
Verification:
- <paste failing command output>
```
