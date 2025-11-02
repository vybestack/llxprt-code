# Pseudocode – Provider Cache Elimination

> Traceability:
> - @plan:PLAN-20251023-STATELESS-HARDENING.P06 (integration stub scaffolding)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P07 (integration TDD)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08 (integration implementation)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08a (verification)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P09 (cleanup)
> Requirements: @requirement:REQ-SP4-002, @requirement:REQ-SP4-003

10: Audit every provider module (`openai`, `anthropic`, `gemini`, etc.) and delete module-level caches such as `runtimeClientCache`, `modelParams`, and `currentModel`; document removals inline with `(@plan:PLAN-20251023-STATELESS-HARDENING.P08)` to prove stateless readiness for @requirement:REQ-SP4-002.
11: Introduce `buildProviderClient(providerName, resolved, telemetry)` that returns a fresh SDK client per call; construct inside the invocation path using `resolved.baseURL` and `resolved.authToken`, and forbid storing the instance on `this` (@plan:PLAN-20251023-STATELESS-HARDENING.P07, @requirement:REQ-SP4-003).
12: Derive model parameters on demand via `const modelParams = options.config.getEphemeralSettings(providerName);` and attach them to the local call scope only; throwing `ProviderCacheError("Attempted to memoize model parameters for " + providerName)` if a provider tries to persist them (`@plan:PLAN-20251023-STATELESS-HARDENING.P05`).
13: For OAuth/token flows, call `await resolved.authToken.provide()` each invocation; wrap in `try/catch` to surface `ProviderCacheError("Auth token unavailable for runtimeId=" + runtimeId + " (REQ-SP4-003).")` rather than falling back to stale cached tokens (@plan:PLAN-20251023-STATELESS-HARDENING.P08a).
14: Verify streaming handlers reference only local variables (`const streamState = { ... }`); mutate provider fields triggers `throw new ProviderCacheError("Stateful field mutation detected in " + providerName)` so regression tests can assert the guard (@plan:PLAN-20251023-STATELESS-HARDENING.P09).
15: Emit telemetry `telemetry.record("stateless-provider.call", { providerName, cacheEliminated: true })` for later analytics and to confirm shared caches are removed across providers (@plan:PLAN-20251023-STATELESS-HARDENING.P08).

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 -->
## Analysis Notes
- Assumption: Provider constructors remain lightweight; moving client creation into call path will not exceed provider timeout budgets (verify with telemetry for longest-running `gemini` calls).
- Assumption: A shared `ProviderCacheError` class will be available to standardize enforcement messaging; otherwise we introduce it during @plan:PLAN-20251023-STATELESS-HARDENING.P05.
- Open question: Do we retain cache eviction hooks (e.g., `runtimeClientCache.clear()` in shutdown routines) once caches are removed, or convert them to no-ops to preserve API surface?
