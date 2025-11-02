# Verification – Provider Cache Elimination

- Ensure diff removes persistent caches (`runtimeClientCache`, `modelParams`, `currentModel`) or scopes them per call.
- Tests must assert no state leakage between successive calls using different runtime IDs.
- Run targeted provider suites with isolation scenarios: `vitest packages/core/src/providers/gemini --runInBand`, `vitest packages/core/src/providers/openai --runInBand`, `vitest packages/core/src/providers/anthropic --runInBand`.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 -->
## Acceptance Signals
- Code review identified module-level caches at `OpenAIProvider.ts:49-70`, `AnthropicProvider.ts:28-51`, and `GeminiProvider.ts:46-78`; success requires these declarations disappear or become factory-scoped with runtime keys derived from call options, confirming REQ-SP4-002.
- Capture isolation regression test that alternates runtime IDs within `packages/core/src/providers/__tests__/providerIsolation.test.ts` (to be authored) and ensure captured logs record distinct OAuth tokens per call, satisfying REQ-SP4-003.

## Verification Review
- [x] Confirmed domain model references for cache reuse include OAuth leakage scenario, keeping @requirement:REQ-SP4-002 and @requirement:REQ-SP4-003 highlighted for remediation. @plan:PLAN-20251023-STATELESS-HARDENING.P01
- [x] Pseudocode steps 10-14 mandate per-call client creation and token derivation; no conflicting notes detected. @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-003
- [x] Phase P02a verification ensures cache-elimination pseudocode retains explicit guards and requirement mappings. @plan:PLAN-20251023-STATELESS-HARDENING.P02 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003

## P08a Verification Notes (2025-10-25)
- `AnthropicProvider` cache checks confirmed: `anthropic.stateless.test.ts` re-run via `npx vitest run packages/core/src/providers/anthropic/__tests__/anthropic.stateless.test.ts ...` produced green results for runtime-scoped client creation and memoization guard enforcement, demonstrating per-call OAuth + config sourcing per @pseudocode provider-cache-elimination.md lines 10-12. @plan:PLAN-20251023-STATELESS-HARDENING.P08a @requirement:REQ-SP4-002 @requirement:REQ-SP4-003
- `OpenAIProvider` suite validates that `createClient()` only reuses clients within a single runtime ID and that `getModelParams()` throws when asked for cached values; the 3/3 passing results from the consolidated stateless run provide direct cache-elimination evidence. @plan:PLAN-20251023-STATELESS-HARDENING.P08a @requirement:REQ-SP4-002
- `GeminiProvider` streaming + OAuth tests remain green except for the known `Tool prompt not found: fetchSomething` warning, confirming runtime-specific tool metadata and auth tokens are attached per call without module caches. @plan:PLAN-20251023-STATELESS-HARDENING.P08a @requirement:REQ-SP4-002 @requirement:REQ-SP4-003
- `OpenAIResponsesProvider` regression covers cleared conversation caches and per-call config propagation; 3/3 passing ensures no state persists between calls and that runtime-provided user memory is injected only within the current invocation scope. @plan:PLAN-20251023-STATELESS-HARDENING.P08a @requirement:REQ-SP4-002 @requirement:REQ-SP4-003

## P09a Verification Notes (2025-10-25)
- `rg "modelParams" packages/core/src/providers` now reports matches exclusively inside `AnthropicProvider.modelParams.test.ts`, demonstrating that production providers no longer declare or apply cached `modelParams` blobs. This search run locks in the stateless cache removal for REQ-SP4-002/REQ-SP4-003, and it doubles as the guard for REQ-SP4-004 because runtime overrides only flow through the normalized options delta. @plan:PLAN-20251023-STATELESS-HARDENING.P09a @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-004
