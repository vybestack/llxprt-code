# Canonical Tool ID Implementation Plan

## Overview
Implement a canonical tool ID pipeline that normalizes tool call IDs once at ingestion and uses provider-specific mapping only at the edge. This removes point-to-point conversions while preserving deterministic pairing across providers (Kimi K2, Mistral, OpenAI, OpenAI Responses, Anthropic).

## New Shared Utility
### Location
- `packages/core/src/services/history/canonicalToolIds.ts`

### Responsibilities
- `canonicalizeToolCallId(input)`
- `canonicalizeToolResponseId(input)`
- Deterministic ID generation using base64url(sha256).
- Accept a stable `turnKey` (not array index).

### Input Signature
- `providerName?: string`
- `rawId?: string`
- `toolName?: string`
- `turnKey: string`
- `callIndex: number`

### Output
- Canonical ID format: `hist_tool_${hash}` with allowed chars `[a-zA-Z0-9_-]`.

## Ingestion & History
### ContentConverters
- File: `packages/core/src/services/history/ContentConverters.ts`
- Replace `normalizeToHistoryId` with canonicalizer calls.
- For `functionCall`:
  - Use `canonicalizeToolCallId` with `rawId`, `toolName`, `turnKey`, and call index.
- For `functionResponse`:
  - Use `canonicalizeToolResponseId` with `rawId`, `toolName`, `turnKey`, and call index.
  - If `rawId` missing, resolve via position matcher and reuse call’s canonical ID.
- Store raw provider ID and provider name in `metadata` if needed for debugging.

### HistoryService
- File: `packages/core/src/services/history/HistoryService.ts`
- Replace `generateHistoryId()` with canonicalizer fallback to ensure no random IDs.
- `getIdGeneratorCallback()` should yield canonical IDs derived from `turnKey` + call index.
- Ensure non-tool history IDs are not affected (only tool_call/tool_response).

### GeminiChat
- File: `packages/core/src/core/geminiChat.ts`
- Ensure `ContentConverters.toIContent` receives a stable `turnKey` per message.
- Persist `turnKey` in `IContent.metadata` so replays are stable.
- Use existing position matcher to align tool responses with canonical tool calls.

## Provider Output Mapping
### OpenAI (Chat Completions)
- File: `packages/core/src/providers/openai/OpenAIProvider.ts`
- Replace `normalizeToOpenAIToolId` usage with simple prefix mapping:
  - `hist_tool_x` → `call_x`
- Remove sanitization/fallback randomness since canonical IDs are already compliant.

### OpenAI Responses
- File: `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`
- Use canonical suffix with `call_` prefix for `function_call` and `function_call_output` IDs.

### OpenAI Vercel
- File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `normalizeToOpenAIToolId` becomes prefix transformer.
- `normalizeToHistoryToolId` becomes passthrough for canonical IDs.

### Anthropic
- File: `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `normalizeToAnthropicToolId` becomes prefix transformer:
  - `hist_tool_x` → `toolu_x`
- No sanitization required.

### Kimi K2
- File: `packages/core/src/tools/ToolIdStrategy.ts`
- Kimi strategy uses canonical IDs as keys and maps to `functions.{tool}:{index}`.
- Ensure `createMapper` uses the request tool call order (not history ordering).

### Mistral
- File: `packages/core/src/tools/ToolIdStrategy.ts`
- Mistral strategy should map canonical IDs to 9-char IDs deterministically.
- Replace `generateMistralToolId()` with hash-based 9-char base62 truncation.
- Add collision detection: if generated ID already used for a different canonical ID, rehash with a salt suffix until unique.

## Deterministic Mapping Strategy
- Mistral ID: base62(hash(canonicalId + salt)).slice(0, 9) with collision fallback.
- Kimi ID: stable index order based on outgoing request tool call order.

## Tests to Update
### History/Converters
- `packages/core/src/services/history/ContentConverters.test.ts`
  - Assert canonical IDs match `hist_tool_[a-zA-Z0-9_-]+`.
  - Ensure tool_call/tool_response pairing via canonical IDs.
  - Verify replay stability with same `turnKey`.
  - Verify missing `rawId` or `toolName` still yields deterministic IDs.

### Canonical Tool IDs
- `packages/core/src/services/history/canonicalToolIds.test.ts`
  - Determinism for same input.
  - Different providers/raw IDs yield different outputs.
  - Missing inputs still valid.

### ToolIdStrategy
- `packages/core/src/tools/ToolIdStrategy.test.ts`
  - Kimi mapping uses canonical IDs and stable order.
  - Mistral mapping is deterministic and handles collision fallback.

### Provider Normalization
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts`
  - Expect simple prefix mapping.

- `packages/core/src/providers/anthropic/AnthropicProvider.normalizeToAnthropicToolId.test.ts`
  - Expect direct `toolu_` prefix with canonical suffix.

## Migration Notes
- Existing histories become incompatible by design.
- If legacy histories must be supported, add a one-time canonicalization pass (not in scope).

## Incremental Rollout
1. Introduce canonicalizer utility + tests.
2. Update ContentConverters + HistoryService to store canonical IDs with `turnKey`.
3. Update ToolIdStrategy for Kimi/Mistral deterministic mapping with collision handling.
4. Simplify provider-specific normalization to prefix mapping.
5. Update affected tests for new behavior.
