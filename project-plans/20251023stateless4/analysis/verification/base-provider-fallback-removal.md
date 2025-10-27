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

## Phase P04a Red State
- Red: `pnpm test --filter "runtime guard" --runInBand` aborts for every workspace with `CACError: Unknown option --filter`, so BaseProvider guard scenarios (pseudocode lines 10-16) remain unexecuted and continue documenting the missing runtime context guard for @requirement:REQ-SP4-001, @requirement:REQ-SP4-004, and @requirement:REQ-SP4-005. @plan:PLAN-20251023-STATELESS-HARDENING.P04

## Phase P05 Verification
- [x] `npx vitest run packages/core/src/providers/__tests__/BaseProvider.guard.test.ts` validates missing-settings guard behaviour and structured error metadata. @plan:PLAN-20251023-STATELESS-HARDENING.P05 @requirement:REQ-SP4-001
- [x] `npx vitest run packages/core/src/providers/__tests__/ProviderManager.guard.test.ts …` executes stateless provider suites (Gemini, Anthropic, OpenAI, OpenAI Responses) with injected runtime config, demonstrating guard compliance across providers. @plan:PLAN-20251023-STATELESS-HARDENING.P05 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005
- [x] `npx vitest run packages/cli/src/runtime/runtimeSettings.test.ts` confirms CLI registration wires config into the manager and exercises runtime guard entry points. @plan:PLAN-20251023-STATELESS-HARDENING.P05 @requirement:REQ-SP4-005
- [x] `pnpm lint && pnpm typecheck && pnpm build` complete without errors, ensuring no residual singleton fallbacks remain and implementation matches pseudocode traceability. @plan:PLAN-20251023-STATELESS-HARDENING.P05

## P09a Verification Notes (2025-10-25)
- `rg "getSettingsService" packages/core/src/providers` returned only `.test.ts`, `.spec.ts`, and integration test files, confirming no production provider resurrected the BaseProvider fallback path. This satisfies the guard hardening acceptance criteria for both stateless runtime sourcing and the REQ-SP4-004 runtime-context enforcement. @plan:PLAN-20251023-STATELESS-HARDENING.P09a @requirement:REQ-SP4-002 @requirement:REQ-SP4-004
