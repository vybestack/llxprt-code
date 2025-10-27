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

## P08a Verification Notes (2025-10-25)
- `npx vitest run packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts packages/cli/src/runtime/__tests__/profileApplication.test.ts --reporter=verbose` completed 12/12 passing, confirming ProviderManager + CLI runtime wiring injects call-scoped services and enforces guards laid out in @pseudocode provider-runtime-handling.md lines 10-16. @plan:PLAN-20251023-STATELESS-HARDENING.P08a @requirement:REQ-SP4-004 @requirement:REQ-SP4-005
- The profile application warning test remained green, demonstrating runtime metadata surfaces through wrapper + provider stacks whenever stateless hardening is enabled, covering @requirement:REQ-SP4-002 and @requirement:REQ-SP4-003 for call-scoped config propagation. @plan:PLAN-20251023-STATELESS-HARDENING.P08a

## P10a Verification Notes (2025-10-25)
- Confirmed all user-facing documentation that references `MissingProviderRuntimeError` now includes the hardened remediation language: `docs/release-notes/2025-10.md` calls out the CLI surfacing plus diagnostics, `docs/cli/runtime-helpers.md` reiterates the strict guard behavior, and coordinator guidance in `dev-docs/codex-workers.md` mandates isolated runtime activation before helper usage. @plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005
- Verified `packages/cli/src/runtime/messages.ts` formats `MissingProviderRuntimeError` guard output with the required remediation checklist and requirement tags, ensuring CLI operators receive actionable steps that align with the release notes. @plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004
- `rg "MissingProviderRuntimeError" docs dev-docs packages/cli/src/runtime` returned only the refreshed messaging/doc locations, confirming no stale references remain. @plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005
