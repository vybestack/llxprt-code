# Token-Tracking Consolidation Ledger (AC3, issue #2278)

**Scope:** the six `integration-tests/token-tracking*.test.ts` files consolidated
into one survivor (`integration-tests/token-tracking.test.ts`) plus a new
package-level formatter suite (`packages/cli/src/ui/utils/tokenFormatters.test.ts`).

## Count reconciliation

The issue/plan text reports **89 `it` cases**. An independent `grep
'^\\s*(it|itProp)(\\.skip)?\\('` over all six files at `HEAD` finds **90**
matches, of which **2 are not test cases** but the helper internals of the
local `itProp` shim (`token-tracking-property.test.ts:80 it(testName, run)` and
`:95 it.skip(testName, run)` — the registration callbacks the helper hands to
Bun). Subtracting those two mechanisms leaves **88 real behavioral cases**
(87 active + 1 `itProp.skip` that never executes). This ledger rows **all 88**.
The prior "89" figure double-counted one of those helper internals.

Disposition legend:

- `KEPT (survivor:LINE)` — behavior retained in `integration-tests/token-tracking.test.ts`.
- `MOVED (tokenFormatters.test.ts:LINE)` — behavior moved to the cli-package formatter suite.
- `DUPLICATE OF (path:LINE)` — behavior already covered by an existing test in `packages/**` (or by the survivor canonical); cited.
- `DELETED NON-BEHAVIORAL (reason)` — tautological / mock-theater / asserts on a locally-built object; zero coverage lost.

## 1. `integration-tests/token-tracking.test.ts` (8 cases → rewritten in place)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking.test.ts:68 | should correctly calculate tokens per minute based on API responses | DUPLICATE OF (survivor:315 exact TPM property; also packages/providers/src/logging/ProviderPerformanceTracker.test.ts:46-55) |
| token-tracking.test.ts:85 | should correctly accumulate throttle wait times | DUPLICATE OF (survivor:302 throttle accumulate+reset; also ProviderPerformanceTracker.test.ts:165-175) |
| token-tracking.test.ts:100 | should correctly accumulate session token usage from multiple providers | DUPLICATE OF (survivor:168 session accumulation; also ProviderManager.test.ts:173-244) |
| token-tracking.test.ts:128 | should correctly accumulate session tokens from provider responses | DUPLICATE OF (survivor:168; also ProviderManager.test.ts:173-244) |
| token-tracking.test.ts:169 | should create logging wrapper without errors | DELETED NON-BEHAVIORAL (asserts only `typeof === 'function'` on wrapper methods + passthrough `wrapper.name`; no token behavior. Wrapping verified at ProviderManager.test.ts:132) |
| token-tracking.test.ts:183 | should format TPM and throttle wait time for footer display | DELETED NON-BEHAVIORAL (hand-written formatting logic inside the test, never imports/calls production `formatTokensPerMinute`/`formatThrottleTime`; regex is near-tautological. Coverage MOVED to tokenFormatters.test.ts:15,21,28,33,41,47,56) |
| token-tracking.test.ts:208 | should display detailed token metrics correctly in stats UI | DELETED NON-BEHAVIORAL (asserts fields on a `statsDisplay` object the test itself constructs; the underlying accumulate/throttle are covered by survivor:168/302) |
| token-tracking.test.ts:253 | should include comprehensive token tracking information in diagnostics output | DELETED NON-BEHAVIORAL (`toHaveProperty` on a `diagnosticsOutput` object the test itself constructs; production `diagnosticsCommand.action` is never invoked) |

## 2. `integration-tests/token-tracking-behavioral.test.ts` (17 cases → deleted)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking-behavioral.test.ts:82 | should accumulate tokens as streaming chunks arrive | DUPLICATE OF (survivor:168; also ProviderManager.test.ts:173-244) |
| token-tracking-behavioral.test.ts:137 | should handle streaming responses with missing token metadata | DUPLICATE OF (survivor:168 — accumulation of zero-valued fields sums identically) |
| token-tracking-behavioral.test.ts:177 | should accumulate tokens from different providers in the same session | DUPLICATE OF (survivor:168; also ProviderManager.test.ts:173-244) |
| token-tracking-behavioral.test.ts:218 | should maintain accurate session totals when providers are switched mid-session | KEPT (survivor:197) |
| token-tracking-behavioral.test.ts:275 | should calculate TPM based on recent token activity within the last minute | DUPLICATE OF (survivor:315 exact TPM; also ProviderPerformanceTracker.test.ts:46-92) |
| token-tracking-behavioral.test.ts:300 | should return zero TPM when no recent activity exists | DUPLICATE OF (ProviderPerformanceTracker.test.ts:16-25 zero-state assertions incl. tokensPerMinute===0) |
| token-tracking-behavioral.test.ts:318 | should accumulate throttle wait times from 429 errors | DUPLICATE OF (survivor:302; also ProviderPerformanceTracker.test.ts:165-175) |
| token-tracking-behavioral.test.ts:336 | should reset throttle wait time when tracker is reset | DUPLICATE OF (survivor:302 reset branch; also ProviderPerformanceTracker.test.ts:193-196) |
| token-tracking-behavioral.test.ts:357 | should format TPM values with appropriate suffixes | MOVED (tokenFormatters.test.ts:15,21,28,33) |
| token-tracking-behavioral.test.ts:365 | should format throttle wait times with appropriate units | MOVED (tokenFormatters.test.ts:41,47,56) |
| token-tracking-behavioral.test.ts:375 | should format session token usage for detailed display | MOVED (tokenFormatters.test.ts:63) |
| token-tracking-behavioral.test.ts:406 | should handle OpenAI token format correctly | DUPLICATE OF (survivor:331; also extracted-helpers.behavior.test.ts:280-294) |
| token-tracking-behavioral.test.ts:442 | should handle Anthropic token format correctly | DUPLICATE OF (survivor:393 Anthropic headers) |
| token-tracking-behavioral.test.ts:482 | should track tokens through complete request-response cycle | DUPLICATE OF (survivor:168 accumulation; `expect(providerMetrics).toBeDefined()` is non-behavioral; format covered by tokenFormatters.test.ts:63) |
| token-tracking-behavioral.test.ts:523 | should maintain token tracking accuracy across session lifecycle | DUPLICATE OF (survivor:168 + survivor:239 reset; also ProviderManager.test.ts:241-244) |
| token-tracking-behavioral.test.ts:565 | should handle invalid token values gracefully | KEPT (survivor:262 negative-clamp — no external coverage exists for negative-input clamping) |
| token-tracking-behavioral.test.ts:588 | should handle missing provider gracefully | DELETED NON-BEHAVIORAL (`accumulateSessionTokens` ignores the provider name (`_providerName`) and never throws — it is pure arithmetic; "does not throw" is tautological) |

## 3. `integration-tests/token-tracking-provider-behavioral.test.ts` (14 cases → deleted)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking-provider-behavioral.test.ts:89 | should extract tokens from standard OpenAI completion response | DUPLICATE OF (survivor:331; also extracted-helpers.behavior.test.ts:280-294) |
| token-tracking-provider-behavioral.test.ts:116 | should handle OpenAI streaming response chunks without usage | KEPT (survivor:353 no-usage→zeros; no external coverage for this path) |
| token-tracking-provider-behavioral.test.ts:145 | should extract tokens from final OpenAI streaming chunk with usage | KEPT (survivor:373 final-chunk-with-usage) |
| token-tracking-provider-behavioral.test.ts:176 | should handle OpenAI function calling token usage | DUPLICATE OF (survivor:331 — function_call payload does not alter `usage` extraction; tool_token_count===0 asserted there) |
| token-tracking-provider-behavioral.test.ts:217 | should extract tokens from Anthropic response headers | KEPT (survivor:393) |
| token-tracking-provider-behavioral.test.ts:245 | should handle Anthropic streaming response with incremental headers | DUPLICATE OF (survivor:393 — same `anthropic-input/output-tokens` header path) |
| token-tracking-provider-behavioral.test.ts:268 | should extract tokens from Anthropic tool use response | DUPLICATE OF (survivor:393 — `anthropic-tool-use-*-tokens` headers are not read by the extractor; only input/output asserted) |
| token-tracking-provider-behavioral.test.ts:300 | should handle Anthropic thinking (reasoning) tokens | KEPT (survivor:415 thoughts_tokens; no external coverage) |
| token-tracking-provider-behavioral.test.ts:339 | should extract tokens from Gemini response usage metadata | KEPT (survivor:437 cached_content_tokens) |
| token-tracking-provider-behavioral.test.ts:374 | should handle Gemini streaming response with progressive token counts | DUPLICATE OF (survivor:437 — same usage-object path) |
| token-tracking-provider-behavioral.test.ts:404 | should extract tokens from Gemini function calling response | DUPLICATE OF (survivor:437 — same usage-object path) |
| token-tracking-provider-behavioral.test.ts:447 | should maintain consistent session totals regardless of provider mix | DUPLICATE OF (survivor:168; also ProviderManager.test.ts:173-244) |
| token-tracking-provider-behavioral.test.ts:497 | should handle missing or incomplete token data gracefully across providers | KEPT (survivor:467 missing/invalid→zeros across providers) |
| token-tracking-provider-behavioral.test.ts:536 | should preserve token accuracy when switching between providers | DUPLICATE OF (survivor:197 provider switching) |

## 4. `integration-tests/token-tracking-ui-behavioral.test.ts` (13 cases → deleted)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking-ui-behavioral.test.ts:74 | should display tokens per minute in footer when available | MOVED (tokenFormatters.test.ts:15,21,28,33) |
| token-tracking-ui-behavioral.test.ts:90 | should display throttle wait time in footer when throttling occurs | MOVED (tokenFormatters.test.ts:41,47,56) |
| token-tracking-ui-behavioral.test.ts:106 | should show session token total in footer | DUPLICATE OF (survivor:168 accumulation; the `.toLocaleString()` display is covered by tokenFormatters.test.ts:63,93) |
| token-tracking-ui-behavioral.test.ts:138 | should format comprehensive session token breakdown for stats display | MOVED (tokenFormatters.test.ts:63) |
| token-tracking-ui-behavioral.test.ts:167 | should handle zero values in token breakdown gracefully | MOVED (tokenFormatters.test.ts:78) |
| token-tracking-ui-behavioral.test.ts:194 | should reflect typical chat conversation token progression | DUPLICATE OF (survivor:168 accumulation + tokenFormatters.test.ts:63 format) |
| token-tracking-ui-behavioral.test.ts:242 | should handle rapid token accumulation during streaming responses | DUPLICATE OF (survivor:168 — monotonic accumulation) |
| token-tracking-ui-behavioral.test.ts:281 | should accurately reflect multi-provider usage in UI display | DUPLICATE OF (survivor:168 + tokenFormatters.test.ts:63) |
| token-tracking-ui-behavioral.test.ts:330 | should handle high-frequency token updates without UI lag | KEPT (survivor:278 performance characteristic) |
| token-tracking-ui-behavioral.test.ts:367 | should maintain formatting consistency across large token values | MOVED (tokenFormatters.test.ts:93) |
| token-tracking-ui-behavioral.test.ts:399 | should display zero state appropriately when no tokens have been used | MOVED (tokenFormatters.test.ts:78) |
| token-tracking-ui-behavioral.test.ts:416 | should handle TPM formatting edge cases | MOVED (tokenFormatters.test.ts:15,21,28,33) |
| token-tracking-ui-behavioral.test.ts:433 | should handle throttle time formatting edge cases | MOVED (tokenFormatters.test.ts:41,47,56) |

## 5. `integration-tests/token-tracking-integration.test.ts` (11 cases → deleted)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking-integration.test.ts:62 | should track tokens from OpenAI streaming response with usage metadata | DUPLICATE OF (ProviderManager.test.ts:132 wrapping; `sessionTokens.total >= 0` is tautological after reset) |
| token-tracking-integration.test.ts:80 | should extract tokens from non-streaming OpenAI response | DUPLICATE OF (survivor:168 — test only accumulates, never extracts) |
| token-tracking-integration.test.ts:106 | should track throttle wait times from retry logic | KEPT (survivor:495 retry+429+trackThrottleWaitTime; core retry.test.ts has no trackThrottleWaitTime) |
| token-tracking-integration.test.ts:139 | should calculate TPM correctly from recent token events | DUPLICATE OF (survivor:315 exact TPM; totalTokens/totalRequests covered by ProviderPerformanceTracker.test.ts:16-49) |
| token-tracking-integration.test.ts:153 | should accumulate session tokens correctly | DUPLICATE OF (survivor:168; also ProviderManager.test.ts:173-244) |
| token-tracking-integration.test.ts:174 | should track throttle wait time in performance metrics | DUPLICATE OF (survivor:302; also ProviderPerformanceTracker.test.ts:165-175) |
| token-tracking-integration.test.ts:188 | should accumulate exponential backoff delays | KEPT (survivor:523 exponential-backoff ordering) |
| token-tracking-integration.test.ts:222 | should track tokens through complete request cycle | DUPLICATE OF (survivor:168; `expect(metrics).toBeDefined()` is non-behavioral) |
| token-tracking-integration.test.ts:254 | should work without conversation logging enabled | DUPLICATE OF (survivor:168 accumulation + ProviderManager.test.ts:132 wrapping) |
| token-tracking-integration.test.ts:284 | should respect ephemeral retry settings | DELETED NON-BEHAVIORAL (asserts fields of a `providerConfig` object the test itself builds and assigns; no production code reads it — round-trips a hand-built mock) |
| token-tracking-integration.test.ts:306 | should disable OpenAI SDK built-in retries | DELETED NON-BEHAVIORAL (sole assertion is `expect(provider).toBeDefined()` on a just-constructed object) |

## 6. `integration-tests/token-tracking-property.test.ts` (25 cases → deleted)

| Original | Test name | Disposition |
| --- | --- | --- |
| token-tracking-property.test.ts:170 | should never have negative tokensPerMinute values (itProp) | DUPLICATE OF (survivor:315 exact TPM, strictly stronger) |
| token-tracking-property.test.ts:181 | should have zero tokensPerMinute for identical timestamps (itProp) | DUPLICATE OF (survivor:315 exact TPM; identical durations yield 60*tokens deterministically) |
| token-tracking-property.test.ts:197 | should calculate tokensPerMinute correctly from completion records (itProp) | DUPLICATE OF (survivor:315; totalRequests covered by ProviderPerformanceTracker.test.ts:16-49) |
| token-tracking-property.test.ts:221 | should derive tokensPerMinute from recorded tokens and durations (itProp) | KEPT (survivor:315 — the exact-formula property; carried over verbatim in intent) |
| token-tracking-property.test.ts:248 | should never have negative throttleWaitTimeMs values (itProp) | DUPLICATE OF (survivor:302 exact sum) |
| token-tracking-property.test.ts:259 | should have zero throttleWaitTimeMs for empty sequences (it) | DUPLICATE OF (survivor:302 reset branch; also ProviderPerformanceTracker.test.ts:196) |
| token-tracking-property.test.ts:267 | should correctly sum throttle wait times (itProp) | DUPLICATE OF (survivor:302; also ProviderPerformanceTracker.test.ts:165-175) |
| token-tracking-property.test.ts:293 | should reset throttleWaitTimeMs to zero after reset (itProp) | DUPLICATE OF (survivor:302 reset branch) |
| token-tracking-property.test.ts:315 | should never have negative token usage fields (itProp) | DUPLICATE OF (survivor:168 — non-negative inputs always yield non-negative sums) |
| token-tracking-property.test.ts:339 | should accurately sum all provider token contributions (itProp) | DUPLICATE OF (survivor:168 canonical asserts exact per-field sums) |
| token-tracking-property.test.ts:394 | should reset all token fields to zero after reset (itProp) | DUPLICATE OF (survivor:239 reset; also ProviderManager.test.ts:241-244) |
| token-tracking-property.test.ts:420 | should increase total when adding token usage (itProp) | DUPLICATE OF (survivor:168 — accumulation is monotonic) |
| token-tracking-property.test.ts:492 | should never return negative token counts (itProp) | DUPLICATE OF (survivor:331/465 extraction with non-negative inputs) |
| token-tracking-property.test.ts:526 | should return zero counts when no token fields are present (itProp) | DUPLICATE OF (survivor:467 missing-data→zeros) |
| token-tracking-property.test.ts:547 | should handle missing/null token fields gracefully (itProp) | DUPLICATE OF (survivor:467; original only asserts `typeof === 'number'`) |
| token-tracking-property.test.ts:573 | should extract tokens from usage object (it) | DUPLICATE OF (survivor:331; also extracted-helpers.behavior.test.ts:280-294) |
| token-tracking-property.test.ts:591 | should produce at least one positive token count (itProp.skip) | DELETED NON-BEHAVIORAL (permanently `.skip`ped — never executed, contributes zero coverage) |
| token-tracking-property.test.ts:687 | should increase throttle wait time with retry attempts (itProp) | DELETED NON-BEHAVIORAL (mock-theater: asserts `mockTracker.addThrottleWaitTime` was called via `vi.fn()`; empty arbitraries `[]`. Real behavior covered by survivor:495) |
| token-tracking-property.test.ts:726 | should properly accumulate different delay strategies (itProp) | DUPLICATE OF (survivor:495 — retry invokes trackThrottleWaitTime regardless of 429 vs 500) |
| token-tracking-property.test.ts:774 | should properly format TPM values from 0 to 100k+ (itProp) | MOVED (tokenFormatters.test.ts:15,21,28,33 — explicit boundaries are stronger than the unit-only property) |
| token-tracking-property.test.ts:793 | should display appropriate units for throttle wait time ranges (itProp) | MOVED (tokenFormatters.test.ts:41,47,56) |
| token-tracking-property.test.ts:820 | should include all token tracking components in stats display (itProp) | DELETED NON-BEHAVIORAL (`toHaveProperty` on a `sessionUsage` object the test itself constructs, using non-production field names `prompt`/`candidates`) |
| token-tracking-property.test.ts:850 | should correctly format token usage for CLI display (itProp) | DUPLICATE OF (survivor:550 — the full-regex shape property is strictly stronger than these contain-checks) |
| token-tracking-property.test.ts:897 | should include all token tracking metrics in diagnostics (itProp) | DELETED NON-BEHAVIORAL (arbitraries build a `mockContext` but `diagnosticsCommand.action` reads the global `getRuntimeApi()`, not it; sole assertion `result instanceof Promise` is tautological for an `async` function) |
| token-tracking-property.test.ts:933 | should properly format token metrics for CLI output (itProp) | KEPT (survivor:550 — the formatSessionTokenUsage shape property; carried over verbatim in intent) |

## Summary

| Disposition | Rows |
| --- | --- |
| KEPT (survivor) | 13 |
| MOVED (tokenFormatters.test.ts) | 13 |
| DUPLICATE OF (survivor canonical or packages/** external) | 51 |
| DELETED NON-BEHAVIORAL | 11 |
| **Total real cases** | **88** (+ 2 helper-internal `it(testName, run)` registrations inside the `itProp` shim, which are not test cases) |

Counts are row counts over the six tables above (8 + 17 + 14 + 13 + 11 + 25 = 88);
each row carries exactly one disposition.

**Before:** 6 files, 3223 lines, 88 real `it` cases, run once per E2E matrix leg (×3).
**After:** 1 survivor file (integration-tests/token-tracking.test.ts) with 17 `it`
cases covering genuine cross-package integration + 1 cli-package formatter suite
(packages/cli/src/ui/utils/tokenFormatters.test.ts) with 11 `it` cases. Formatter
coverage now runs once in the cli shard instead of three times in E2E.
