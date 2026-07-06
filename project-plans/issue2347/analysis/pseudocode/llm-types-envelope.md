# Pseudocode: llm-types envelope + request (Phase 04)

## Interface Contracts

INPUTS: IContent (from providers' existing stream), ModelStreamChunk deltas.
OUTPUTS: ModelOutput accumulations, ToolCallRequest[] derivations.
DEPENDENCIES: IContent/ContentBlock/UsageStats from ../services/history/IContent.js; finishReasons.ts, toolCall.ts from Phase 03. NO @google/genai.

## modelEnvelope.ts

10: TYPE HookRestrictions = { allowedToolNames?: string[]; filteredRestrictedCalls?: ToolCallRequest[] }
11: TYPE ModelOutput = { content: IContent; finishReason?: CanonicalFinishReason; rawStopReason?: string;
12:   usage?: UsageStats; responseId?: string; hookRestrictions?: HookRestrictions;
13:   providerMetadata?: Record<string, unknown> }
14: TYPE ModelStreamChunk = ModelOutput  // structurally identical; semantic distinction (delta vs final) documented; kept as separate named alias for call-site clarity
15: FUNCTION emptyModelOutput(speaker='ai'): ModelOutput
16:   RETURN { content: { speaker, blocks: [] } }
17: FUNCTION accumulateModelStreamChunk(acc: ModelOutput, chunk: ModelStreamChunk): ModelOutput
18:   // pure — returns NEW object, never mutates acc or chunk
19:   content = { speaker: acc.content.speaker, blocks: [...acc.content.blocks, ...chunk.content.blocks] }
20:   IF acc.content.metadata OR chunk.content.metadata
21:     content.metadata = { ...acc.content.metadata, ...chunk.content.metadata }
22: result = { content }
23:   result.finishReason = chunk.finishReason ?? acc.finishReason      // last-write-wins
24:   result.rawStopReason = chunk.rawStopReason ?? acc.rawStopReason
25:   result.usage = chunk.usage ?? acc.usage
26:   result.responseId = chunk.responseId ?? acc.responseId
27:   result.hookRestrictions = chunk.hookRestrictions ?? acc.hookRestrictions  // set once by hook layer
28:   IF acc.providerMetadata OR chunk.providerMetadata
29:     result.providerMetadata = { ...acc.providerMetadata, ...chunk.providerMetadata }  // shallow, chunk wins
30:   OMIT undefined-valued optional keys from result
31:   RETURN result
32: FUNCTION getToolCalls(output: ModelOutput): ToolCallRequest[]
33:   result = []
34:   FOR block IN output.content.blocks WHERE block.type === 'tool_call'
35:     args = block.parameters if plain object else {}   // parameters: unknown → Record guard
36:     PUSH { id: block.id, name: block.name, args }
37:   RETURN result
38: FUNCTION toModelStreamChunk(icontent: IContent): ModelStreamChunk
39:   meta = icontent.metadata
40:   chunk = { content: icontent }
41:   raw = meta?.stopReason ?? meta?.finishReason        // stopReason preferred (provider-native)
42:   IF raw !== undefined
43:     chunk.rawStopReason = raw
44:     chunk.finishReason = isCanonicalFinishReason(raw) ? raw
45:       : tryAllMappers(raw)   // try gemini/openai/anthropic maps; fall back 'other'
46:   IF meta?.usage → chunk.usage = meta.usage
47:   IF meta?.id → chunk.responseId = meta.id
48:   RETURN chunk
49: FUNCTION tryAllMappers(raw: string): CanonicalFinishReason
50:   FOR map IN [OPENAI_FINISH_MAP, ANTHROPIC_STOP_MAP, GEMINI_FINISH_MAP]
51:     IF raw in map RETURN map[raw]
52:   RETURN 'other'

## modelRequest.ts

60: TYPE ReasoningConfig = { budgetTokens?: number; effort?: 'low'|'medium'|'high'; includeInOutput?: boolean }
61: TYPE ModelGenerationSettings = { temperature?: number; maxOutputTokens?: number;
62:   systemInstruction?: string; reasoning?: ReasoningConfig; toolChoice?: ToolChoice }
63: TYPE ModelGenerationRequest = { contents: IContent[]; tools?: ToolDeclaration[];
64:   settings?: ModelGenerationSettings }

## Integration Points

- toModelStreamChunk consumes the EXACT metadata fields providers already emit (verified in IContent.ts ContentMetadata: stopReason, finishReason, usage, id).
- Compile-time assignability test file (.test-d.ts or expectTypeOf in .test.ts) proves GenerateChatOptions.contents / RuntimeGenerateChatOptions.contents assignable to ModelGenerationRequest.contents and legacy toolsets convertible via toolDeclarationsFromLegacyToolset.

## Anti-Pattern Warnings

DO NOT: mutate acc/chunk in accumulate (spread everything)
DO NOT: add a functionCalls array field to the envelope
DO NOT: add candidates/parts/promptFeedback fields
DO NOT: import @google/genai
