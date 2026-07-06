# Phase 05: Gemini boundary additive helpers (TDD + impl)

Plan: PLAN-20260702-LLMTYPES.P05
Pseudocode: analysis/pseudocode/gemini-neutral-converters.md (follow line numbers exactly)
Requirements: REQ-010, REQ-011

## Deliverables

NEW packages/providers/src/gemini/neutralConverters.ts (+ neutralConverters.test.ts)
  — this file MAY import @google/genai (inside the providers/src/gemini/** enclave)
MODIFY packages/providers/src/gemini/geminiSchemaHelpers.ts — cycle-safety + non-mutation
  (public signature unchanged; internal visited WeakSet default param; pseudocode lines 80-88)
NEW tests appended in a NEW file packages/providers/src/gemini/geminiSchemaHelpers.cycles.test.ts
  (do NOT modify any existing test file):
  - cyclic schema: const s = {type:'object', properties:{}}; s.properties.self = s; cleanGeminiSchema(s) terminates and returns object
  - non-mutation: deep-frozen input schema not mutated; output !== input reference for objects
  - $ref/$defs stripped (documenting lossiness) — assert absent from output
  - all EXISTING geminiSchemaHelpers tests still pass unmodified

## neutralConverters tests (behavioral, real code, ≥30% property-based)

Round-trip invariant tests (REQ-010.2) — for each Part shape, blocksToGeminiParts(geminiPartsToBlocks([P])) deep-equals [P]:
- { text }
- { functionCall: { id, name, args } }
- { functionResponse: { id, name, response } }
- { inlineData: { mimeType: 'image/png', data: base64 } }
- { fileData: { mimeType: 'video/mp4', fileUri: 'https://...' } }
- { fileData: { fileUri } } (no mimeType — lossless via marker)
- { executableCode: { code, language: 'PYTHON' } } (casing preserved through providerMetadata)
- { codeExecutionResult: { outcome: 'OUTCOME_OK', output } }
- { thought: true, text, thoughtSignature }
- media part with videoMetadata → preserved via 'gemini.videoMetadata'
Property-based: arbitrary text strings, arbitrary base64ish data, arbitrary args objects survive round-trip.

Direction tests:
- geminiPartsToBlocks maps each shape to the documented block type with exact field values
- blockToGeminiPart for MediaBlock url encoding emits fileData (compare with GeminiMessageConverter's existing url→fileData behavior; do not modify that file)
- plain CodeBlock (no gemini providerMetadata) → fenced text Part (matches existing ContentConverters convention — cite in comment)

Usage/grounding/error:
- geminiUsageToUsageStats with thoughtsTokenCount/toolUsePromptTokenCount/cachedContentTokenCount → reasoningTokens/toolTokens/cachedTokens; missing fields → 0 for required, omitted for optional
- geminiGroundingToGroundingInfo on a realistic GroundingMetadata fixture (groundingChunks web title/uri + groundingSupports segments) → exact GroundingInfo
- geminiUrlMetadataToUrlAccessInfo
- geminiApiErrorToProviderApiError: construct real ApiError instances (status 429, 401, 500, 400) → flags per pseudocode line 72; isProviderApiError guard accepts result

toolDeclarationsToGemini:
- schema with $ref/oneOf stripped via REAL cleanGeminiSchema; name/description preserved

Consistency-with-existing-converters test (REQ-010.7 / integration):
- For overlapping shapes (text, functionCall, functionResponse, thought), geminiPartsToBlocks output deep-equals the blocks ContentConverters.toIContent produces for the same single-part Content (modulo the toIContent-level ID canonicalization — read ContentConverters first and assert precisely; where canonicalization applies, test documents the difference explicitly)
- Existing ContentConverters/geminiResponseMapper test files pass unmodified

## TDD discipline

RED first, GREEN per pseudocode lines, tag @plan/@requirement/@pseudocode.
Run: npm run test --workspace @vybestack/llxprt-code-providers (all pass, existing untouched).

## Forbidden

- Modifying ContentConverters.ts, GeminiMessageConverter.ts, geminiResponseMapper.ts
- Modifying ANY existing test file
- Mock theater (use real cleanGeminiSchema, real ApiError, real converters)
- eslint-disable / ts-ignore / any / type assertions (type predicates OK)
