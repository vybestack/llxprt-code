# Pseudocode – Provider Runtime Handling

> Traceability:
> - @plan:PLAN-20251023-STATELESS-HARDENING.P02 (pseudocode authoring)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P03-P05 (guard scaffolding and implementation)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P06 (integration stub scaffolding)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P07 (integration TDD)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08 (integration implementation)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08a (verification and integration)
> Requirements: @requirement:REQ-SP4-002, @requirement:REQ-SP4-003, @requirement:REQ-SP4-005

10: On `ProviderManager.generateChatCompletion` entry, clone caller-provided `GenerateChatOptions` and push them through `normalizeRuntimeInputs(rawOptions)` before any provider code runs (@plan:PLAN-20251023-STATELESS-HARDENING.P02, @requirement:REQ-SP4-002).
11: `normalizeRuntimeInputs` must require `runtimeContext.settings` and `runtimeContext.config`; if either missing, throw `ProviderRuntimeNormalizationError("ProviderManager requires call-scoped settings/config; legacy provider state is disabled.")` to block fallbacks (@plan:PLAN-20251023-STATELESS-HARDENING.P05, @requirement:REQ-SP4-002).
12: Compose `normalized.resolved = { model, baseURL, authToken, telemetry }` using runtime helpers; when any field is undefined, surface `ProviderRuntimeNormalizationError("Incomplete runtime resolution (model/baseURL/authToken) for runtimeId=" + runtimeId)` tagged with @requirement:REQ-SP4-003 and recorded for @plan:PLAN-20251023-STATELESS-HARDENING.P07.
13: Ensure `normalized.userMemory` and `normalized.metadata` derive from the runtime context payload instead of provider constructors; reject attempts to read `this.currentModel` by throwing `ProviderRuntimeNormalizationError("Stateless provider attempted to read deprecated instance fields.")` (@plan:PLAN-20251023-STATELESS-HARDENING.P05).
14: Enter the provider call inside `runtimeScope.run(normalized, providerInvoker)` so `AsyncLocalStorage` resets per invocation and fulfills @requirement:REQ-SP4-005 with traceability to @plan:PLAN-20251023-STATELESS-HARDENING.P06.
15: Within `providerInvoker`, destructure `const { settings, config, resolved, userMemory } = normalized;` and pass to the concrete provider; prohibit reading mutable manager state by lint guard hooks referenced in @plan:PLAN-20251023-STATELESS-HARDENING.P07 and @plan:PLAN-20251023-STATELESS-HARDENING.P08.
16: After provider completion (success or error), execute `finally { runtimeScope.exit(); normalized.clearEphemeral?.(); }` to wipe shared references, preventing cross-call leakage mandated by @requirement:REQ-SP4-003 and verified in @plan:PLAN-20251023-STATELESS-HARDENING.P08a.
17: Emit structured error logs `logRuntimeValidationFailure(err, runtimeId)` including requirement tags so verification harness can assert messaging and remediation guidance (@plan:PLAN-20251023-STATELESS-HARDENING.P08a, @requirement:REQ-SP4-002, @requirement:REQ-SP4-005).

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-005 -->
## Analysis Notes
- Assumption: Runtime metadata includes stable `runtimeId`; need confirmation from CLI team to avoid empty identifiers in background sessions.
- Assumption: `runtimeScope` helper exposes `run()` / `exit()` semantics compatible with `AsyncLocalStorage`; otherwise @plan:PLAN-20251023-STATELESS-HARDENING.P03 must introduce the abstraction.
- Open question: Should normalization provide default `userMemory` stubs for providers lacking feature support, or must callers supply explicit ability lists per REQ-SP4-005?
- Open question: How do we signal runtime swaps between sequential calls so telemetry can differentiate multi-runtime sessions without reintroducing shared state?
