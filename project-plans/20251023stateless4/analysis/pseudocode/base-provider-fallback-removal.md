# Pseudocode – BaseProvider Fallback Removal

> Traceability:
> - @plan:PLAN-20251023-STATELESS-HARDENING.P03 (stub guard scaffolding)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P04 (guard TDD coverage)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P05 (guard implementation)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P05a (guard verification)
> Requirements: @requirement:REQ-SP4-001, @requirement:REQ-SP4-002

10: Accept `options: NormalizedGenerateChatOptions` from the provider manager and enter `runtimeContextStorage.run(options, ...)` to scope state per call (@plan:PLAN-20251023-STATELESS-HARDENING.P03, @plan:PLAN-20251023-STATELESS-HARDENING.P05) satisfying isolation mandated by @requirement:REQ-SP4-001.
11: Invoke `assertRuntimeContext(options, providerName)`; if `!options?.settings`, throw `MissingProviderRuntimeError("BaseProvider.<providerName> requires ProviderManager-injected settings (@requirement:REQ-SP4-001).")` before any provider logic executes (@plan:PLAN-20251023-STATELESS-HARDENING.P05a).
12: Within `assertRuntimeContext`, verify `options.config` is defined; on failure throw `MissingProviderRuntimeError("BaseProvider.<providerName> missing normalized config; disable legacy getSettingsService fallback (@plan:PLAN-20251023-STATELESS-HARDENING.P05).")` to prevent silent fallbacks and align with @requirement:REQ-SP4-001.
13: Confirm `options.resolved` includes `model`, `baseURL`, and `authToken`; when absent, raise `ProviderRuntimeValidationError("Provider runtime incomplete for <providerName>; expected resolved.authToken/model/baseURL.", { requirement: "REQ-SP4-002" })` so downstream phases can assert correct messaging (@plan:PLAN-20251023-STATELESS-HARDENING.P07).
14: Return `{ settings, config, resolved, telemetry, metadata }` from `assertRuntimeContext` and hand the tuple to provider implementations, ensuring every consumer references the validated structure instead of deprecated globals (@plan:PLAN-20251023-STATELESS-HARDENING.P05).
15: Remove all usage of `peekActiveProviderRuntimeContext`, `getSettingsService()`, and other ambient read paths; the only runtime data source must be the verified tuple passed into the call scope (@plan:PLAN-20251023-STATELESS-HARDENING.P05, @requirement:REQ-SP4-001).
16: When deriving auth credentials, call `context.resolved.authToken.get()` (or equivalent) and bubble the explicit error `ProviderRuntimeValidationError("Auth token resolver unavailable in stateless mode.")` instead of substituting defaults, ensuring @requirement:REQ-SP4-002 coverage and supporting @plan:PLAN-20251023-STATELESS-HARDENING.P08 checks.
17: After provider execution, exit the `runtimeContextStorage` scope (`runtimeContextStorage.disable()` or implicit promise resolution) so subsequent calls start without residual context, preventing fallback leakage verified in @plan:PLAN-20251023-STATELESS-HARDENING.P08a.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 -->
## Analysis Notes
- Assumption: `MissingProviderRuntimeError` and `ProviderRuntimeValidationError` already exist (or can be extended) within the shared provider error module; otherwise we will extend the taxonomy during @plan:PLAN-20251023-STATELESS-HARDENING.P05.
- Open question: `AuthPrecedenceResolver` currently constructed with fallback `SettingsService`; need clarification whether we replace constructor dependency or guard to maintain OAuth refresh support without reintroducing stateless violations.
