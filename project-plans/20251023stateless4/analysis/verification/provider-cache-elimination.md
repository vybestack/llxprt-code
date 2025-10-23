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
