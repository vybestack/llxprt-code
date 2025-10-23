# Verification – BaseProvider Fallback Removal

- Confirm pseudocode lines 10-14 exist in implementation pull request diff.
- Ensure unit tests simulate missing `settings` to trigger explicit error for REQ-SP4-001.
- Run `vitest packages/core/src/providers/BaseProvider.test.ts --runInBand` once new tests exist.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 -->
## Acceptance Signals
- Debug replay from `packages/core/src/providers/BaseProvider.ts:96-133` currently shows fallback to `getSettingsService()`; post-fix trace must emit `MissingProviderRuntimeError` with runtime id when `settings` absent, confirming REQ-SP4-001.
- Integration harness `packages/cli/src/runtime/runtimeSettings.test.ts` should log `active runtime context required` when invoking without `activateIsolatedRuntimeContext`, matching REQ-SP4-002 guard expectations.

## Verification Review
- [x] Domain model `Runtime ↔ Provider Interaction Failures` documents the singleton fallback leak with explicit BaseProvider/ProviderManager paths, covering @requirement:REQ-SP4-001 and @requirement:REQ-SP4-002. @plan:PLAN-20251023-STATELESS-HARDENING.P01
- [x] Pseudocode lines 10-14 retain the `MissingProviderRuntimeError` enforcement without conflicting assumptions; no additional corrections required. @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001
- [x] Phase P02a verification confirms error guard references and requirement tags remain intact for stateless coverage. @plan:PLAN-20251023-STATELESS-HARDENING.P02 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002
- [x] Stub guard scaffolding compiles cleanly; `BaseProvider.guard.stub.test.ts` skip annotated to hand off runtime enforcement to @plan:PLAN-20251023-STATELESS-HARDENING.P04 while preserving fallback behaviour for @requirement:REQ-SP4-001. @plan:PLAN-20251023-STATELESS-HARDENING.P03
