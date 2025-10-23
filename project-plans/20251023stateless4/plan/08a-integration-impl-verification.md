# Phase 08a: Integration Implementation Verification

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P08a`

## Prerequisites
- Required: `.completed/P08.md` demonstrating passing integration implementation tests.
- Verification: `test -f project-plans/20251023stateless4/.completed/P08.md`
- Expected files from previous phase: Updated providers, logging wrapper, provider manager, and CLI runtime wiring.

## Implementation Tasks

### Files to Modify
- `project-plans/20251023stateless4/analysis/verification/provider-cache-elimination.md`
  - Append confirmation checks for each provider with references to updated tests.
- `project-plans/20251023stateless4/analysis/verification/logging-wrapper-adjustments.md`
  - Document wrapper verification results.
- `project-plans/20251023stateless4/analysis/verification/provider-runtime-handling.md`
  - Capture CLI/runtime verification outcomes tying back to pseudocode lines 10-16 and @requirement:REQ-SP4-005.
- `packages/core/src/providers/__tests__/*stateless*.test.ts`
  - Convert `test()` names from `it.skip` to `it` if previously skipped and add assertions confirming absence of caches.
- `packages/cli/src/runtime/__tests__/*.test.ts`
  - Ensure integration tests assert that runtime registry and profile application honour call-scoped services.

### Activities
- Review git diff for each provider to ensure no leftover caches or constructor-captured config.
- Confirm instrumentation includes required plan markers referencing pseudocode lines.
- Inspect Anthropic and OpenAI Responses providers to confirm `config`/user-memory references happen within the call scope (pseudocode line 13 in `analysis/pseudocode/provider-runtime-handling.md`, @plan:PLAN-20251023-STATELESS-HARDENING.P08, @requirement:REQ-SP4-003).
- Review CLI runtime diffs to ensure ProviderManager/LoggingProviderWrapper receive call-scoped data and produce actionable errors when a runtime is missing.
- Confirm CLI profile application and runtime isolation suites pass with the stateless providers, documenting results in verification notes.

### Required Code Markers
- Verification notes cite `@plan:PLAN-20251023-STATELESS-HARDENING.P08` and relevant `@requirement:REQ-SP4-00X` IDs.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter "stateless" --runInBand
pnpm test --filter "LoggingProviderWrapper" --runInBand
pnpm test --filter "runtime" --runInBand
```

### Manual Verification Checklist
- [ ] Providers instantiate API clients per call without shared caches.
- [ ] Anthropic/OpenAI Responses executions observe the active call-scoped `config`/user-memory (validated via passing tests and inspection).
- [ ] Logging wrapper defers to runtime-provided config/settings.
- [ ] CLI runtime registry propagates the validated context into ProviderManager/Wrapper and isolation tests remain green.
- [ ] No `getSettingsService()` fallback remains anywhere in provider stack.

## Success Criteria
- Stateless implementation validated with updated provider and CLI runtime tests.

## Failure Recovery
1. If caches remain, re-open implementation to remove lingering state.
2. Strengthen tests to assert absence of shared state.

## Phase Completion Marker
- Create `.completed/P08a.md` with timestamp, verification output, and reviewer notes per PLAN-TEMPLATE guidelines.
