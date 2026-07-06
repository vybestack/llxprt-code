# Pseudocode: Gemini boundary additive helpers (Phase 05)

## Interface Contracts

INPUTS: @google/genai Part[]/GroundingMetadata/UrlMetadata/usage metadata/ApiError; llxprt ContentBlock[]/ToolDeclaration[].
OUTPUTS: neutral types (ContentBlock[], UsageStats, GroundingInfo, UrlAccessInfo, ProviderApiError) and Gemini shapes (Part[], FunctionDeclaration[]).
DEPENDENCIES: @google/genai (this file lives in packages/providers/src/gemini/ — permitted enclave); @vybestack/llxprt-code-core llm-types + IContent.
LOCATION: packages/providers/src/gemini/neutralConverters.ts (NEW file — new Google importer is allowed ONLY because it is inside providers/src/gemini/**).

## neutralConverters.ts

10: FUNCTION geminiPartToBlock(part: Part): ContentBlock | null
11:   IF part.thought === true → delegate semantics matching ContentConverters.partToThinkingBlock:
12:     ThinkingBlock { thought: part.text ?? '', isHidden: true, sourceField: 'thought', signature? }
13:   IF part.text (non-thought) → TextBlock { text }
14:   IF part.functionCall → ToolCallBlock { id: functionCall.id ?? '', name, parameters: args }
15:   IF part.functionResponse → ToolResponseBlock { callId: id ?? '', toolName: name, result: response }
16:   IF part.inlineData → MediaBlock { mimeType, data, encoding: 'base64' }
17:   IF part.fileData → MediaBlock { mimeType ?? 'application/octet-stream', data: fileUri, encoding: 'url',
18:     providerMetadata: { 'gemini.fileData': true } only if mimeType was absent (needed for lossless round-trip) }
19:   IF part.executableCode → CodeBlock { code: executableCode.code, language: executableCode.language?.toLowerCase?,
20:     providerMetadata: { 'gemini.executableCode': { language: original } } }   // preserve original enum casing
21:   IF part.codeExecutionResult → ToolResponseBlock { callId: '', toolName: 'code_execution',
22:     result: { output: codeExecutionResult.output },
23:     providerMetadata: { 'gemini.codeExecutionResult': { outcome: codeExecutionResult.outcome } } }
24:   IF part.videoMetadata present on a media part → merge under providerMetadata['gemini.videoMetadata']
25:   ELSE RETURN null
26: FUNCTION geminiPartsToBlocks(parts: Part[]): ContentBlock[]  // map + filter nulls
27: FUNCTION blockToGeminiPart(block: ContentBlock): Part | null
28:   INVERSE of above:
29:   TextBlock → { text }
30:   ToolCallBlock → { functionCall: { id, name, args } }
31:   ToolResponseBlock with providerMetadata['gemini.codeExecutionResult'] → { codeExecutionResult: { outcome, output } }
32:   ToolResponseBlock (plain) → { functionResponse: { id, name, response } }
33:   MediaBlock encoding 'base64' → { inlineData: { mimeType, data } }
34:   MediaBlock encoding 'url' → { fileData: { mimeType (omit if 'gemini.fileData' marker says absent), fileUri: data } }
35:     + videoMetadata restored from providerMetadata if present
36:   CodeBlock with providerMetadata['gemini.executableCode'] → { executableCode: { code, language: preserved } }
37:   CodeBlock (plain) → fenced-text Part (MATCH existing ContentConverters behavior)
38:   ThinkingBlock → { thought: true, text, thoughtSignature? }
39: FUNCTION blocksToGeminiParts(blocks): Part[]
40: ROUND-TRIP INVARIANT (tested): for all supported Part shapes P: blocksToGeminiParts(geminiPartsToBlocks([P])) deep-equals [P]

50: FUNCTION geminiUsageToUsageStats(u: GenerateContentResponseUsageMetadata): UsageStats
51:   promptTokens: u.promptTokenCount ?? 0
52:   completionTokens: u.candidatesTokenCount ?? 0
53:   totalTokens: u.totalTokenCount ?? 0
54:   cachedTokens: u.cachedContentTokenCount (omit if undefined)
55:   reasoningTokens: u.thoughtsTokenCount (omit if undefined)
56:   toolTokens: u.toolUsePromptTokenCount (omit if undefined)

60: FUNCTION geminiGroundingToGroundingInfo(g: GroundingMetadata): GroundingInfo
61:   sources = (g.groundingChunks ?? []).map(chunk → { title: chunk.web?.title, url: chunk.web?.uri })
62:   segments = (g.groundingSupports ?? []).map(s → { startIndex: s.segment?.startIndex,
63:     endIndex: s.segment?.endIndex, text: s.segment?.text, sourceIndices: s.groundingChunkIndices })
64:   (omit segments key when no supports)
65: FUNCTION geminiUrlMetadataToUrlAccessInfo(m: UrlMetadata): UrlAccessInfo
66:   { url: m.retrievedUrl ?? '', status: String(m.urlRetrievalStatus ?? '') }

70: FUNCTION geminiApiErrorToProviderApiError(e: ApiError): ProviderApiError
71:   { provider: 'gemini', status: e.status, message: e.message, raw: e,
72:     isQuotaError: status===429, isAuthError: status===401||403, isTransient: status===429||status>=500 }

75: FUNCTION toolDeclarationsToGemini(decls: ToolDeclaration[]): FunctionDeclaration[]
76:   FOR each d: { name, description, parametersJsonSchema: cleanGeminiSchema(d.parametersJsonSchema) }
77:   NOTE: lossy by design ($ref/$defs/oneOf/allOf/not/additionalProperties stripped)

## geminiSchemaHelpers.ts hardening (MODIFY EXISTING — behavior carve-out REQ-011)

80: FUNCTION cleanGeminiSchema(schema, visited = new WeakSet())
81:   IF not object or null → return as-is (unchanged)
82:   IF visited.has(schema) → RETURN {} (drop cycle edge, terminate)
83:   visited.add(schema)
84:   ... existing whitelist copy loop, passing visited through recursive calls
85:     (cleanPropertiesObject, items, anyOf all thread visited)
86:   NEVER assign into the input object (already copy-based — verify and add non-mutation test)
87:   Public signature stays cleanGeminiSchema(schema: unknown): Schema — visited is an internal
88:     default param (existing external callers unaffected)

## Anti-Pattern Warnings

DO NOT: modify ContentConverters.toGeminiContent / toIContent behavior (REQ-010.7)
DO NOT: modify geminiResponseMapper behavior
DO NOT: throw from converters for supported shapes; unsupported ContentBlock in blockToGeminiPart returns null ONLY where existing converters do — for the new lossless helpers, unsupported → null is acceptable only for block types with no Gemini equivalent, and MUST be covered by a test documenting the case
DO NOT: mock ContentConverters/cleanGeminiSchema in tests — use real code
