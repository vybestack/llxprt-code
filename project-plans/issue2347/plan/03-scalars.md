# Phase 03: llm-types scalar surface (TDD + impl)

Plan: PLAN-20260702-LLMTYPES.P03
Pseudocode: analysis/pseudocode/llm-types-scalars.md (follow line numbers exactly)
Requirements: REQ-001, REQ-002, REQ-003 (types+adapter only; assignability tests in P04), REQ-004, REQ-007, REQ-008, REQ-009

## Deliverables

NEW packages/core/src/llm-types/finishReasons.ts (+ finishReasons.test.ts)
NEW packages/core/src/llm-types/jsonSchema.ts (+ jsonSchema.test.ts)
NEW packages/core/src/llm-types/toolDeclaration.ts (+ toolDeclaration.test.ts)
NEW packages/core/src/llm-types/toolCall.ts (+ toolCall.test.ts)
NEW packages/core/src/llm-types/providerApiError.ts (+ providerApiError.test.ts)
NEW packages/core/src/llm-types/grounding.ts (types only — covered by envelope/converter tests later; a minimal shape test is fine)
NEW packages/core/src/llm-types/tokensAndEmbeddings.ts (types only)
MODIFY packages/core/src/services/history/IContent.ts:
  - add `providerMetadata?: Record<string, unknown>` to TextBlock, ToolCallBlock, ToolResponseBlock, MediaBlock, ThinkingBlock, CodeBlock
  - add `reasoningTokens?: number; toolTokens?: number` to UsageStats
  - DO NOT touch ContentValidation logic or any function bodies
NEW packages/core/src/services/history/IContent.providerMetadata.test.ts:
  - behavioral test: JSON of a pre-change serialized history entry (no providerMetadata fields) parses and ContentValidation.hasContent returns same verdicts as before
  - blocks WITH providerMetadata round-trip through JSON.parse(JSON.stringify(...)) unchanged

## TDD discipline (mandatory order)

1. RED: write ALL tests first per requirement tags. Run them; they must fail naturally
   ("is not a function" / module not found), NOT with NotYetImplemented expectations.
2. GREEN: implement per pseudocode line numbers. Tag each exported symbol with
   /** @plan PLAN-20260702-LLMTYPES.P03 @requirement REQ-XXX @pseudocode lines N-M */
3. All new tests pass; run existing suite for touched package: npm run test --workspace @vybestack/llxprt-code-core

## Test requirements

- Behavioral: input → output values (toBe/toEqual), never structure-only or mock-calls.
- ≥30% property-based via fast-check (root has @fast-check/vitest 0.2.4 + fast-check 4.5.3; core devDeps has fast-check). Examples:
  - property: for ANY string s, mapGeminiFinishReason(s).rawStopReason === s and finishReason is in the union
  - property: for ANY JSON-object schema, toolDeclarationsFromLegacyToolset output parametersJsonSchema deep-equals input
  - property: toolResultContentFromLegacyPartListUnion on arrays of {text: string} yields TextBlocks preserving order/content
- Every Gemini FinishReason enum string tested explicitly (REQ-001.2 list in spec).
- toolCall conversion: explicit unsupported-shape test asserting {ok:false} with descriptive error (e.g. {executableCode:...} unsupported at THIS layer, numbers, null).
- NO imports from '@google/genai' anywhere in llm-types or its tests (raw strings/plain objects for fixtures).

## Forbidden

- eslint-disable / ts-ignore / any / type assertions
- Mutating inputs
- Modifying ANY existing test file
- TODO comments
