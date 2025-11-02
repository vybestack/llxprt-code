# Pseudocode – Logging Wrapper Adjustments

> Traceability:
> - @plan:PLAN-20251023-STATELESS-HARDENING.P06 (integration stub expectations)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P07 (integration TDD)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08 (integration implementation)
> - @plan:PLAN-20251023-STATELESS-HARDENING.P08a (verification)
> Requirements: @requirement:REQ-SP4-004, @requirement:REQ-SP4-005

10: During wrapper construction, drop cached `config`/`settings` fields; retain only logger + metrics dependencies so instances remain stateless (@plan:PLAN-20251023-STATELESS-HARDENING.P06, @requirement:REQ-SP4-004).
11: On `generateChatCompletion` invocation, call `const runtimeScope = runtimeContextTracker.push(callId, normalizedOptions)`; if the push fails, throw `ProviderRuntimeScopeError("Unable to push runtime scope for callId=" + callId)` to block logging without context (@plan:PLAN-20251023-STATELESS-HARDENING.P07).
12: Merge `incomingOptions` with `runtimeScope.options`, prioritising caller overrides while ensuring `settings`/`config` come from the runtime payload; log a debug event `logger.debug("stateless-runtime.merge", {...})` referencing @requirement:REQ-SP4-004.
13: Wrap provider invocation with `logger.withContext(runtimeScope.telemetry, () => wrappedProvider.generateChatCompletion(mergedOptions))` so every log line includes runtime metadata demanded by @plan:PLAN-20251023-STATELESS-HARDENING.P08.
14: On stream or promise resolution, emit `logger.trace("stateless-runtime.complete", { callId, duration })`; on error, emit `logger.warn("stateless-runtime.error", { callId, requirement: "REQ-SP4-005", err })` before rethrowing to satisfy @plan:PLAN-20251023-STATELESS-HARDENING.P08a.
15: In a `finally` block, execute `runtimeContextTracker.pop(callId)` and verify it returns the same scope; if not, raise `ProviderRuntimeScopeError("Pop mismatch for callId=" + callId)` to prevent dangling context and ensure @requirement:REQ-SP4-004 integrity.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005 -->
## Analysis Notes
- Assumption: `ProviderPerformanceTracker` can accept runtime metadata without breaking current metrics schema; evaluate need for migration before wiring new fields.
- Assumption: A reusable `runtimeContextTracker` utility exists (or will be introduced in @plan:PLAN-20251023-STATELESS-HARDENING.P05) to coordinate push/pop semantics without deadlocks.
- Open question: Should wrapper request runtime context via `ProviderManager.pushCallContext` or a new dependency to avoid circular import risk highlighted in `ProviderManager.ts`?
