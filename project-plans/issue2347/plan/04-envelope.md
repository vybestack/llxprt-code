# Phase 04: llm-types envelope + request + exports (TDD + impl)

Plan: PLAN-20260702-LLMTYPES.P04
Pseudocode: analysis/pseudocode/llm-types-envelope.md (follow line numbers exactly)
Requirements: REQ-005, REQ-006, REQ-003.4, REQ-013

## Deliverables

NEW packages/core/src/llm-types/modelEnvelope.ts (+ modelEnvelope.test.ts)
NEW packages/core/src/llm-types/modelRequest.ts (+ minimal shape/behavior test)
NEW packages/core/src/llm-types/index.ts — barrel exporting ALL llm-types symbols + re-exporting
  IContent/ContentBlock/UsageStats etc. from ../services/history/IContent.js
MODIFY packages/core/src/index.ts — add `export * from './llm-types/index.js';`
  (check for symbol collisions with existing exports — IContent already exported at line ~525;
   if `export *` collides, export llm-types symbols explicitly instead)
MODIFY packages/core/package.json — add subpath export "./llm-types/index.js" following the
  existing pattern (bun: ./src/..., import: ./dist/src/...)
NEW packages/core/src/llm-types/assignability.test.ts — compile-time compatibility (REQ-003.4):
  - expectTypeOf or direct typed assignments proving:
    - a ProviderToolset-shaped literal converts via toolDeclarationsFromLegacyToolset without casts
    - a RuntimeProviderToolset-shaped literal converts likewise
    - IContent[] assigns to ModelGenerationRequest.contents
  - DO NOT import from @vybestack/llxprt-code-providers (would invert package deps);
    replicate the structural shapes as local type literals with a comment citing
    packages/providers/src/IProvider.ts and core runtime contracts as sources

## TDD discipline

RED first (failing naturally), then GREEN per pseudocode lines, tagged @plan/@requirement/@pseudocode.

## Test requirements (behavioral, ≥30% property-based)

accumulateModelStreamChunk:
- blocks concatenate in order across 3 chunks (deep-equal full result)
- usage on middle chunk then final chunk → final wins
- finishReason only on terminal chunk → present in result
- providerMetadata shallow-merge: acc {a:1,b:1} + chunk {b:2} → {a:1,b:2}
- inputs NOT mutated (deep-freeze acc and chunk fixtures; Object.freeze nested)
- property: for ANY sequence of text-block chunks, accumulated blocks length === sum of chunk block lengths and text preserved in order
- empty-blocks usage-only chunk is valid and contributes usage without blocks

getToolCalls:
- extracts id/name/args from tool_call blocks among mixed blocks, order preserved
- non-object parameters → args {}
- property: n tool_call blocks in → n ToolCallRequests out with matching names

toModelStreamChunk:
- IContent with metadata {stopReason:'end_turn', usage:{...}, id:'x'} → {rawStopReason:'end_turn', finishReason:'stop', usage, responseId:'x'}
- metadata.finishReason 'length' (OpenAI) → max_tokens
- Gemini 'MAX_TOKENS' → max_tokens
- unknown raw 'weird_reason' → finishReason 'other', rawStopReason preserved
- no metadata → bare chunk {content} with no extra keys
- already-canonical value passes through

## Forbidden

Same as Phase 03 + no candidates/parts/functionCalls fields on the envelope.
