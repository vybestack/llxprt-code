# Phase 02: Multi-Runtime Guardrail Tests

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P02`

## Prerequisites

- Required: Phase 01a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P01a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - `packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts`

## Implementation Tasks

### Files to Modify

- `packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts`
  - Replace placeholder assertion with real tests that spin up **two independent CLI runtimes** using different profile fixtures (e.g., `zai` vs `cerebrasqwen`)
  - Ensure tests intentionally fail with current implementation due to shared provider state
  - Each test MUST include `@plan:PLAN-20251018-STATELESSPROVIDER2.P02` and `@requirement:REQ-SP2-002`
  - Document expectations (should fail until P03 implementation) within test comments

- `packages/cli/src/integration-tests/test-utils.ts` (if needed to support runtime bootstrapping)
  - Add helper utilities required by the new tests
  - Tag helper functions with plan/requirement markers

### Required Code Markers

```typescript
it('isolates settings across runtimes @plan:PLAN-20251018-STATELESSPROVIDER2.P02 @requirement:REQ-SP2-002', async () => {
  // ...
});
```

## Verification Commands

### Automated Checks

```bash
# Ensure new plan markers exist
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P02" packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts

# Run targeted suite (EXPECTED TO FAIL)
npm run test:multi-runtime && exit 1
```

### Manual Verification Checklist

- [ ] Tests clearly document expected failure
- [ ] Failure demonstrates provider state leakage (e.g., shared model/base URL)
- [ ] No implementation fixes attempted
- [ ] Failure output captured for next phase

## Success Criteria

- `npm run test:multi-runtime` fails due to intentional assertions detecting leakage
- Plan markers present on all new tests/helpers

## Failure Recovery

1. Revert modifications: `git checkout -- packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts`
2. Reapply failing tests carefully

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P02.md`

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts
- packages/cli/src/integration-tests/test-utils.ts (if applicable)
Verification:
- <paste failing command output>
```
