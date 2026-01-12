# Test-First Plan: Canonical Tool IDs

## Scope
Implement a canonical, deterministic tool ID pipeline with a single cross-provider history format and provider-specific edge mapping. Tests must fail before production changes.

## Phase 0: Test Setup
- Add a shared helper for canonical tool ID expectations (pattern + determinism).
- Define stable `turnKey` creation and storage in history metadata.
- Identify golden test cases for Kimi K2, Mistral, OpenAI, OpenAI Responses, Anthropic.

## Phase 1: History Canonicalization (RED)
### New Tests
- `ContentConverters.test.ts`
  - Assert `tool_call.id` and `tool_response.callId` are canonical and match.
  - Verify canonical IDs only contain `[a-zA-Z0-9_-]`.
  - Verify determinism for identical input across calls.
  - Verify missing raw IDs still produce canonical IDs.
  - Verify replay stability via `turnKey` persistence.

Expected failure: current normalization preserves raw suffixes and does not hash.

## Phase 2: Canonical ID Utility (RED)
### New Tests
- `canonicalToolIds.test.ts`
  - `canonicalizeToolCallId` deterministic for same inputs.
  - Different provider/rawId produce different outputs.
  - Missing inputs still generate valid canonical IDs.
  - `turnKey` changes produce different IDs.

Expected failure: utility not implemented.

## Phase 3: Provider Edge Mapping (RED)
### New Tests
- `OpenAIResponsesProvider.toolIdNormalization.test.ts`
  - Expect simple `hist_tool_` → `call_` mapping, no sanitization.
- `AnthropicProvider.normalizeToAnthropicToolId.test.ts`
  - Expect simple `hist_tool_` → `toolu_` mapping, no sanitization.
- `ToolIdStrategy.test.ts`
  - Kimi strategy: stable `functions.{tool}:{index}` mapping from canonical IDs using request order.
  - Mistral strategy: stable 9-char base62 mapping with collision handling.

Expected failure: current logic uses sanitization/random IDs or history ordering.

## Phase 4: Implement Canonicalization (GREEN)
### Code Changes
- Add `services/history/canonicalToolIds.ts`.
- Update `ContentConverters.normalizeToHistoryId` to use canonicalizer with `turnKey`.
- Update `HistoryService.getIdGeneratorCallback()` to emit canonical IDs.
- Ensure `GeminiChat` stores a stable `turnKey` per message for replay.

## Phase 5: Implement Edge Mapping (GREEN)
### Code Changes
- Simplify `normalizeToOpenAIToolId`, `normalizeToAnthropicToolId` to prefix mapping.
- Update `OpenAIResponsesProvider` to use canonical IDs without extra sanitization.
- Update `ToolIdStrategy` for Kimi/Mistral deterministic mapping and collision handling.

## Phase 6: Refactor & Cleanup (REFACTOR)
- Remove unused sanitization/random fallback logic where canonical IDs guarantee compliance.
- Update comments and documentation for canonical ID contract.

## Phase 7: Verification
- Run `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`.
