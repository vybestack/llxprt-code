# Phase 07: Integration TDD

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P07`

## Prerequisites
- Required: `.completed/P06a.md` available.
- Verification: `test -f project-plans/20251023stateless4/.completed/P06a.md`
- Expected files from previous phase: Stub helpers in ProviderManager/LoggingProviderWrapper and CLI runtime wiring guarded by feature flags.

## Implementation Tasks

### Files to Modify / Create
- `packages/core/src/providers/__tests__/AnthropicProvider.stateless.test.ts`
  - Add failing tests asserting per-call options override any cached model/params (pseudocode lines 10-14 from `provider-cache-elimination.md`, REQ-SP4-002/003).
  - Introduce explicit red cases that alternate runtime contexts with distinct `config.getUserMemory()` outputs and expect Anthropic calls to honour the latest call-scoped values (pseudocode line 13 in `analysis/pseudocode/provider-runtime-handling.md`, @plan:PLAN-20251023-STATELESS-HARDENING.P07, @requirement:REQ-SP4-003).
- `packages/core/src/providers/__tests__/OpenAIProvider.stateless.test.ts`
  - Cover runtime isolation and ensure no cross-call leakage.
- `packages/core/src/providers/__tests__/GeminiProvider.stateless.test.ts`
  - Verify removal of `currentModel`/`modelParams` caching.
- `packages/core/src/providers/__tests__/OpenAIResponsesProvider.stateless.test.ts`
  - Assert conversation caches replaced with call-scoped data (pseudocode lines 10-14 from `analysis/pseudocode/provider-cache-elimination.md`).
  - Add failing scenarios that swap per-call `config` and user-memory snapshots to verify OpenAI Responses uses the injected call context rather than constructor state (pseudocode line 13 in `analysis/pseudocode/provider-runtime-handling.md`, @plan:PLAN-20251023-STATELESS-HARDENING.P07, @requirement:REQ-SP4-003).
- `packages/core/src/providers/__tests__/LoggingProviderWrapper.stateless.test.ts`
  - Ensure wrapper doesn't retain config between calls (pseudocode line 10 from `logging-wrapper-adjustments.md`, REQ-SP4-004).
- `packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts`
  - Add failing CLI-level cases capturing missing runtime guard behaviour (pseudocode lines 10-16 in `provider-runtime-handling.md`, @requirement:REQ-SP4-005).
- `packages/cli/src/runtime/__tests__/profileApplication.test.ts`
  - Introduce failing assertions demonstrating that profile application must respect call-scoped settings/config once integration lands.

### Activities
- Use fake runtime contexts to simulate multi-runtime scenarios and capture expected failures.
- Alternate `config`/user-memory values between calls for Anthropic and OpenAI Responses to surface constructor-captured regressions (pseudocode line 13).
- Document expected errors/messages to ensure tests fail before implementation.

### Required Code Markers
- Each test case must annotate `@plan:PLAN-20251023-STATELESS-HARDENING.P07` plus relevant `@requirement:REQ-SP4-00X` IDs.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter "stateless" --runInBand && exit 1
```

### Manual Verification Checklist
- [ ] All new tests fail due to existing caches/stateful behaviour.
- [ ] Anthropic and OpenAI Responses suites fail on scenarios that toggle call-scoped `config`/user memory (pseudocode line 13 reference).
- [ ] Failures reference missing implementation details matching pseudocode lines.
- [ ] Tests cover assorted runtimes (CLI, subagent, logging wrapper) and the CLI integration suites (`runtimeIsolation`, `profileApplication`) fail with actionable errors.

## Success Criteria
- Comprehensive failing tests capturing stateless requirements across providers and wrapper.

## Failure Recovery
1. Adjust tests to assert behaviour rather than implementation internals.
2. Ensure failure output includes requirement IDs for traceability.

## Phase Completion Marker
- Create `.completed/P07.md` with timestamp, affected files, failing test output, and verification notes per PLAN-TEMPLATE guidelines.
