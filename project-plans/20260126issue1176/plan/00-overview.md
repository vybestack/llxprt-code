# Plan: Settings Separation (Issue #1176)

Plan ID: PLAN-20260126-SETTINGS-SEPARATION
Generated: 2026-01-26
Total Phases: 17 (each with verification sub-phase)
Requirements: REQ-SEP-001, REQ-SEP-002, REQ-SEP-003, REQ-SEP-004, REQ-SEP-005, REQ-SEP-006, REQ-SEP-007, REQ-SEP-008, REQ-SEP-009, REQ-SEP-010, REQ-SEP-011, REQ-SEP-012, REQ-SEP-013

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Rules Snapshot (must be enforced in every phase)

- TDD mandatory, single assertion per test, behavioral tests only
- No type assertions; use type predicates
- No comments in production code
- Immutable data only
- MSW for HTTP interception in tests
- Vertical slice testing: integration tests before provider implementation

## Requirements (Full Text)

- REQ-SEP-001: A central settings registry MUST exist with five categories: model-behavior, provider-config, cli-behavior, model-param, and custom-header.
- REQ-SEP-002: separateSettings() MUST classify all known settings into the correct category and output separated buckets.
- REQ-SEP-003: Unknown settings MUST default to cli-behavior to prevent unsafe API leakage.
- REQ-SEP-004: RuntimeInvocationContext MUST expose separated fields (cliSettings, modelBehavior, modelParams, customHeaders).
- REQ-SEP-005: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
- REQ-SEP-006: CLI-only settings MUST never appear in provider API requests.
- REQ-SEP-007: Model params MUST pass through unchanged when valid for the provider.
- REQ-SEP-008: Custom headers MUST be extracted and merged correctly, including provider overrides.
- REQ-SEP-009: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
- REQ-SEP-010: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
- REQ-SEP-011: Provider-config keys MUST be filtered from API requests.
- REQ-SEP-012: Reasoning object MUST be sanitized and internal keys stripped.
- REQ-SEP-013: Profile alias normalization MUST occur when loading persisted settings.

## Phase Map

- 00a: Preflight Verification
- 01 / 01a: Analysis + Verification
- 02 / 02a: Pseudocode + Verification
- 03 / 03a: Registry Stub + Verification
- 04 / 04a: Registry TDD + Verification
- 05 / 05a: Registry Implementation + Verification
- 06 / 06a: RuntimeInvocationContext Stub + Verification
- 07 / 07a: RuntimeInvocationContext TDD + Verification
- 08 / 08a: RuntimeInvocationContext Implementation + Verification
- 09 / 09a: Integration TDD (Vertical Slice, MSW) + Verification
- 10 / 10a: Providers Stub + Verification
- 11 / 11a: Providers TDD + Verification
- 12 / 12a: Providers Implementation + Verification
- 13 / 13a: CLI Stub + Verification
- 14 / 14a: CLI TDD + Verification
- 15 / 15a: CLI Implementation + Verification
- 16 / 16a: Compatibility Implementation + Verification
- 17 / 17a: E2E Verification + Verification
