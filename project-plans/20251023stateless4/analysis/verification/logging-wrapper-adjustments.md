# Verification – Logging Wrapper Adjustments

- Confirm instrumentation references `@plan:PLAN-20251023-STATELESS-HARDENING.P08` and requirements `@requirement:REQ-SP4-004`.
- Review diff to ensure wrapper no longer stores constructor `Config` references beyond call scope.
- Run telemetry/unit suites touching wrapper: `vitest packages/core/src/providers/LoggingProviderWrapper.test.ts --runInBand` (add tests if missing).

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005 -->
## Acceptance Signals
- Existing wrapper constructor signature `constructor(private readonly wrapped: IProvider, private readonly config: Config, ...)` (LoggingProviderWrapper.ts:58-66) confirms stale config capture; after refactor the config reference should be request-scoped and inspection of the compiled artifact must show no lingering `this.config` usage, validating REQ-SP4-004.
- Telemetry replay from `logConversationRequest` currently omits runtime identifiers; ensure new instrumentation attaches `runtimeId` sourced from per-call options so CLI logs demonstrate correct provider isolation for REQ-SP4-005.

## Verification Review
- [x] Added runtime instrumentation drift scenario to `analysis/domain-model.md` covering wrapper reuse across resets, ensuring @requirement:REQ-SP4-004 and @requirement:REQ-SP4-005 remain in scope. @plan:PLAN-20251023-STATELESS-HARDENING.P01
- [x] Pseudocode step 14 tracks teardown expectations so telemetry drops constructor state; no further adjustments needed. @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-004
- [x] Phase P02a verification reconfirmed wrapper statelessness checks and requirement tags for logging teardown. @plan:PLAN-20251023-STATELESS-HARDENING.P02 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005
