# Verification – Provider Runtime Handling

- Ensure normalized options wiring uses call-scoped `settings`/`config` in providers (pseudocode lines 10-16).
- Integration tests validate `LoggingProviderWrapper` pushes runtime context per invocation (REQ-SP4-003, REQ-SP4-004).
- Execute targeted suite: `vitest packages/core/src/providers --runInBand`.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-005 -->
## Acceptance Signals
- Trace `ProviderManager.updateProviderWrapping()` (ProviderManager.ts:170-216) to ensure new implementation pushes runtime context before invoking the wrapped provider; instrumentation should expose `runtimeId` in `logProviderSwitch`, aligning with REQ-SP4-005.
- Confirm CLI runtime registry tests call `resetCliProviderInfrastructure` and observe fresh `ProviderManager` instances without shared `settingsService`, demonstrating compliant call-scoped context under REQ-SP4-002/003.

## Verification Review
- [x] Domain model now includes runtime instrumentation drift path, ensuring ProviderManager/reset scenarios surface REQ-SP4-004 and REQ-SP4-005 obligations for runtime handling. @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-005
- [x] Pseudocode steps 10-16 align with per-call normalization and explicit error handling; no additional edits required. @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003
- [x] Phase P02a verification cross-checked normalization and teardown coverage against requirements. @plan:PLAN-20251023-STATELESS-HARDENING.P02 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-005
