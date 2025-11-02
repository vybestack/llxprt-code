# Phase 04: BaseProvider Runtime Guard TDD

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P04`

## Prerequisites
- Required: `.completed/P03a.md` present.
- Verification: `test -f project-plans/20251023stateless4/.completed/P03a.md`
- Expected files from previous phase: Stub guard, skipped tests.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/__tests__/BaseProvider.guard.test.ts` (create if absent)
  - Add failing tests verifying errors thrown when `settings`/`config` missing per pseudocode lines 10-14 (REQ-SP4-001).
- `packages/core/src/providers/__tests__/ProviderManager.guard.test.ts`
  - Add tests ensuring ProviderManager injects runtime context on wrapper calls (REQ-SP4-004).
- `packages/cli/src/runtime/runtimeSettings.test.ts`
  - Introduce tests asserting runtime registry supplies settings/config to provider calls (REQ-SP4-005).

### Activities
- Use dependency injection/mocking to simulate provider invocation without runtime; expect `MissingProviderRuntimeError`.
- Cover multi-runtime scenarios ensuring tests fail under current stub behaviour.

### Required Code Markers
- Each new test annotated inline with `@plan:PLAN-20251023-STATELESS-HARDENING.P04` and corresponding `@requirement:REQ-SP4-00X`.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter "BaseProvider runtime guard" --runInBand
pnpm test --filter "ProviderManager guard" --runInBand
pnpm test --filter "CLI runtime settings" --runInBand
```

### Manual Verification Checklist
- [ ] Tests fail under stub implementation.
- [ ] Negative paths cover missing settings, missing config, and runtime mismatch.
- [ ] CLI runtime coverage asserts isolation expectations.

## Success Criteria
- All new tests fail due to current behaviour, setting stage for implementation.

## Failure Recovery
1. Adjust tests to assert desired behaviour (not stub actions).
2. Ensure failure messages align with REQ-SP4 objectives.

## Phase Completion Marker
- Create `.completed/P04.md` capturing timestamp, failing test output, and notes per PLAN-TEMPLATE guidelines.
