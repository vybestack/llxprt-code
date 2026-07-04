# Pseudocode: llm-types scalar surface (Phase 03)

## Interface Contracts

INPUTS: raw provider strings (finish reasons), unknown values (schema guards), legacy toolset objects, unknown PartListUnion-shaped values.
OUTPUTS: CanonicalFinishReason mappings, JsonSchema guards, ToolDeclaration[], Result<ToolResultContent>.
DEPENDENCIES: IContent types from ../services/history/IContent.js ONLY. NO @google/genai imports anywhere in llm-types.

## finishReasons.ts

10: TYPE CanonicalFinishReason = 'stop'|'max_tokens'|'tool_calls'|'safety'|'refusal'|'error'|'other'
11: TYPE FinishInfo = { finishReason: CanonicalFinishReason; rawStopReason: string }
12: CONST GEMINI_FINISH_MAP: Record<string, CanonicalFinishReason> =
13:   STOP→stop, MAX_TOKENS→max_tokens, SAFETY→safety, IMAGE_SAFETY→safety,
14:   RECITATION→safety, LANGUAGE→other, BLOCKLIST→safety, PROHIBITED_CONTENT→safety,
15:   SPII→safety, MALFORMED_FUNCTION_CALL→error, UNEXPECTED_TOOL_CALL→error,
16:   OTHER→other, FINISH_REASON_UNSPECIFIED→other
17: FUNCTION mapGeminiFinishReason(raw: string): FinishInfo
18:   RETURN { finishReason: GEMINI_FINISH_MAP[raw] ?? 'other', rawStopReason: raw }
19: CONST OPENAI_FINISH_MAP = stop→stop, length→max_tokens, tool_calls→tool_calls,
20:   function_call→tool_calls, content_filter→safety
21: FUNCTION mapOpenAIFinishReason(raw): FinishInfo  // same fallback pattern
22: CONST ANTHROPIC_STOP_MAP = end_turn→stop, max_tokens→max_tokens, tool_use→tool_calls,
23:   refusal→refusal, stop_sequence→stop
24: FUNCTION mapAnthropicStopReason(raw): FinishInfo  // same fallback pattern
25: FUNCTION isCanonicalFinishReason(value: unknown): value is CanonicalFinishReason
26:   RETURN typeof value === 'string' AND value in the union set

## jsonSchema.ts

30: TYPE JsonSchemaObject = { [keyword: string]: unknown } (open structural; documented keys:
31:   type, properties, items, required, $ref, $defs, definitions, anyOf, oneOf, allOf, not,
32:   additionalProperties, enum, const, format, description, title, default)
33: TYPE JsonSchema = boolean | JsonSchemaObject
34: FUNCTION isJsonSchema(value: unknown): value is JsonSchema
35:   IF typeof value === 'boolean' RETURN true
36:   IF value is non-null non-array object RETURN true
37:   RETURN false

## toolDeclaration.ts

40: TYPE ToolDeclaration = { name: string; description?: string; parametersJsonSchema: JsonSchema }
41: TYPE ToolChoice = { mode: 'auto'|'required'|'none'; allowedToolNames?: string[] }
42: TYPE LegacyToolsetLike = ReadonlyArray<{ functionDeclarations: ReadonlyArray<{
43:   name: string; description?: string; parametersJsonSchema?: unknown; parameters?: unknown }> }>
44: FUNCTION toolDeclarationsFromLegacyToolset(toolset: LegacyToolsetLike): ToolDeclaration[]
45:   result = []
46:   FOR each group IN toolset
47:     FOR each decl IN group.functionDeclarations
48:       schema = decl.parametersJsonSchema if isJsonSchema else
49:                decl.parameters if isJsonSchema else
50:                {} (empty object schema)
51:       PUSH { name: decl.name, description: decl.description, parametersJsonSchema: schema }
52:       (omit description key entirely when undefined)
53:   RETURN result

## toolCall.ts

60: TYPE ToolCallRequest = { id?: string; name: string; args: Record<string, unknown> }
61: TYPE ToolResultContent = string | ContentBlock[]
62: TYPE ConversionResult<T> = { ok: true; value: T } | { ok: false; error: string }
63: FUNCTION toolResultContentFromLegacyPartListUnion(input: unknown): ConversionResult<ToolResultContent>
64:   IF typeof input === 'string' RETURN ok(input)
65:   IF Array.isArray(input)
66:     blocks = []
67:     FOR each item IN input
68:       IF typeof item === 'string' → PUSH TextBlock(item)
69:       ELSE r = partLikeToBlock(item); IF !r.ok RETURN r; PUSH r.value
70:     RETURN ok(blocks)
71:   r = partLikeToBlock(input); IF !r.ok RETURN r; RETURN ok([r.value])
72: FUNCTION partLikeToBlock(item: unknown): ConversionResult<ContentBlock>
73:   IF not non-null object RETURN error('unsupported tool result part: ' + describe)
74:   IF 'text' in item AND typeof item.text === 'string' → TextBlock{text}
75:   IF 'inlineData' in item with {mimeType: string, data: string} → MediaBlock{mimeType, data, encoding:'base64'}
76:   IF 'fileData' in item with {mimeType?: string, fileUri: string} → MediaBlock{mimeType ?? 'application/octet-stream', data: fileUri, encoding:'url'}
77:   IF 'functionResponse' in item with {name, response, id?} → ToolResponseBlock{callId: id ?? '', toolName: name, result: response}
78:   RETURN error('unsupported tool result part shape') — NEVER stringify/drop

## providerApiError.ts

80: TYPE ProviderApiError = { provider?: string; status?: number; code?: string; message: string;
81:   retryAfterMs?: number; isQuotaError?: boolean; isAuthError?: boolean; isTransient?: boolean; raw?: unknown }
82: FUNCTION isProviderApiError(value: unknown): value is ProviderApiError
83:   RETURN non-null object AND typeof value.message === 'string' AND
84:     (status absent or number) AND (code absent or string) AND (provider absent or string)

## IContent.ts modifications (in place)

90: ADD to each ContentBlock variant interface: providerMetadata?: Record<string, unknown>
91: ADD to UsageStats: reasoningTokens?: number; toolTokens?: number
92: DO NOT change ContentValidation logic

## grounding.ts

95: TYPE GroundingSource = { title?: string; url?: string; snippet?: string }
96: TYPE GroundingSegment = { startIndex?: number; endIndex?: number; text?: string; sourceIndices?: number[] }
97: TYPE GroundingInfo = { sources: GroundingSource[]; segments?: GroundingSegment[] }
98: TYPE UrlAccessInfo = { url: string; status: string }

## tokensAndEmbeddings.ts

100: TYPE CountTokensRequest = { contents: IContent[] }
101: TYPE CountTokensResult = { totalTokens: number }
102: TYPE EmbedContentRequest = { texts: string[] }
103: TYPE EmbedContentResult = { embeddings: number[][] }

## Anti-Pattern Warnings

DO NOT: import anything from '@google/genai' in llm-types (guardrail REQ-INT-001.3)
DO NOT: throw for control flow in conversion (use ConversionResult)
DO NOT: use enums (string-literal unions only)
DO NOT: mutate inputs anywhere
