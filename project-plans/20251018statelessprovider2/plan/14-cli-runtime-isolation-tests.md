# Phase 14: CLI Runtime Isolation Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P14`

## Prerequisites

- Required: Phase 13a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P13a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Pseudocode document `cli-runtime-isolation.md`
  - Stub runtime isolation tests

## Implementation Tasks

### Files to Modify

- `packages/cli/src/runtime/__tests__/runtimeIsolation.stub.test.ts`
  - Rename to `runtimeIsolation.test.ts`
  - Implement tests covering:
    1. Independent runtime contexts for separate CLI sessions
    2. `/provider`, `/model`, `/set`, `/profile`, `/baseurl`, `/key`, `/keyfile` mutations scoped to active runtime
    3. Cleanup ensuring runtime disposal does not affect others
  - Reference pseudocode line numbers for each test case

- Update pseudocode document if numbering changes

### Required Code Markers

```typescript
it('keeps /model scoped to runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines X-Y', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P14" packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts

# EXPECTED TO FAIL
npm test -- --run runtimeIsolation
```

### Manual Verification Checklist

- [ ] Tests fail due to current shared runtime state
- [ ] Each test references pseudocode lines
- [ ] No implementation changes yet

## Success Criteria

- Failure exposes CLI runtime isolation gap

## Failure Recovery

1. Revert renamed file
2. Recreate failing tests

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P14.md`

```markdown
Phase: P14
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts
- project-plans/20251018statelessprovider2/analysis/pseudocode/cli-runtime-isolation.md
Verification:
- <paste failing command output>
```
