# Phase 05: Implement BaseProvider Runtime Guard

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P05`

## Prerequisites
- Required: `.completed/P04a.md` recorded.
- Verification: `test -f project-plans/20251023stateless4/.completed/P04a.md`
- Expected files from previous phase: Failing guard tests, stubbed `assertRuntimeContext`.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/BaseProvider.ts`
  - Replace stub logic with guard implementation aligning with pseudocode lines 10-14 (`analysis/pseudocode/base-provider-fallback-removal.md`).
  - Remove fallback usage of `getSettingsService()` and global runtime contexts.
  - Integrate `assertRuntimeContext` to normalize `settings`, `config`, `runtime` before call scope entry (`@plan:PLAN-20251023-STATELESS-HARDENING.P05`, `@requirement:REQ-SP4-001`).
- `packages/core/src/providers/errors.ts`
  - Implement `MissingProviderRuntimeError` carrying helpful message and metadata (REQ-SP4-001).
- `packages/core/src/providers/__tests__/BaseProvider.guard.test.ts`
  - Update expectations to confirm guard throws error with descriptive message and metadata references (pseudocode line 11).
- `packages/core/src/providers/ProviderManager.ts`
  - Ensure manager injects runtime context prior to guard invocation (pseudocode lines 10 & 11 from `provider-runtime-handling.md`).

### Activities
- Update `AsyncLocalStorage` usage to run within validated context; ensure call exit cleans up.
- Adjust `generateChatCompletion` wrappers to call guard before performing operations.
- Confirm `setRuntimeSettingsService` updates align with new guard expectations.

### Required Code Markers
- Every modified function must include `@plan:PLAN-20251023-STATELESS-HARDENING.P05` and a relevant `@requirement:REQ-SP4-00X` comment block referencing pseudocode line ranges.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter "BaseProvider runtime guard" --runInBand
pnpm lint providers --filter BaseProvider
```

### Manual Verification Checklist
- [ ] BaseProvider throws `MissingProviderRuntimeError` when runtime data absent.
- [ ] ProviderManager ensures guard satisfied in normal flows.
- [ ] No fallback to `getSettingsService()` or other singletons remains.

## Success Criteria
- Previously failing tests now pass, demonstrating guard enforcement.

## Failure Recovery
1. If tests remain red, re-check pseudocode alignment and guard normalization logic.
2. Ensure error metadata accessible to logging wrapper for diagnostics.

## Phase Completion Marker
- Create `.completed/P05.md` capturing timestamp, diff summary, and passing test output per PLAN-TEMPLATE guidelines.
