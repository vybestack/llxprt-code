# Feature Specification: Neutral LLM Type Layer (Foundation) — Issue #2347

Plan ID: PLAN-20260702-LLMTYPES
Issue: https://github.com/vybestack/llxprt-code/issues/2347 (authoritative — read the full issue body; this spec operationalizes it)
Umbrella: #2343. Downstream: #2348 (core), #2349 (agents), #2350 (cli), #2351 (leaves), #2352 (enforcement).

## Purpose

Deliver llxprt-owned neutral LLM types replacing the `@google/genai` surface we actually use, additive Gemini boundary converter coverage, behavioral round-trip tests, an import inventory baseline, and migration docs — with **NO call-site migration**. This PR is additive-only.

## Architectural Decisions (from issue #2347 — normative)

- **IContent/ContentBlock is the lingua franca.** No `LlxprtPart`, no Google-shaped mirrors, no candidates arrays.
- **`ModelOutput`/`ModelStreamChunk` envelope** anchored on IContent: `{ content, finishReason?, rawStopReason?, usage?, responseId?, hookRestrictions?, providerMetadata? }`. Chunks are deltas; ModelOutput is the accumulation; `accumulateModelStreamChunk` defines precedence (last-write-wins for usage/responseId/finishReason/rawStopReason; shallow-merge providerMetadata; hookRestrictions set once). Usage-only chunks (empty blocks) are valid. Tool calls derived via `getToolCalls()` (no duplicate functionCalls array). `toModelStreamChunk(icontent)` adapter lifts streamed IContent (mapping existing untyped `metadata.stopReason`/`finishReason`/`usage`/`id`).
- **Finish handling is two fields**: normalized `finishReason` (string-literal union: `'stop' | 'max_tokens' | 'tool_calls' | 'safety' | 'refusal' | 'error' | 'other'`) + provider-native `rawStopReason` string. Per-provider mapping helpers for Gemini enum values, OpenAI (`stop`/`length`/`tool_calls`/`content_filter`), Anthropic (`end_turn`/`max_tokens`/`tool_use`/`refusal`/`stop_sequence`).
- **`JsonSchema`**: structural, dependency-free. Admits boolean schemas (`false` valid), `$schema`/`$id`/`$defs`/`definitions`/`$ref`, `anyOf`/`oneOf`/`allOf`/`not`, `additionalProperties: boolean | schema`, cyclic refs. Neutral layer preserves byte-identical; Gemini `cleanGeminiSchema` stays lossy-by-design but MUST become non-mutating and cycle-safe (the one permitted behavior carve-out — latent-hang bugfix).
- **`ToolDeclaration { name; description?; parametersJsonSchema: JsonSchema }`** + conversion adapters from legacy `ProviderToolset`/`RuntimeProviderToolset` shapes (which have optional parametersJsonSchema + legacy `parameters`). Existing interfaces NOT replaced/aliased in this PR — compile-time assignability tests + conversion adapters only.
- **`ToolChoice { mode: 'auto' | 'required' | 'none'; allowedToolNames?: string[] }`** — mode and allow-list orthogonal (matches hookTranslator AUTO/ANY/NONE + allowedFunctionNames semantics).
- **`ToolCallRequest { id?; name; args }`** — standalone protocol object (distinct from ToolCallBlock). `args` matches internal convention; MCP boundary maps to wire `arguments`. NOTE: `ToolCallRequestInfo` already exists in core/src/core/turn.ts with `args: Record<string, unknown>` — the new type must not collide; it is a separate, simpler llm-types type.
- **`ReasoningConfig`** — budget/effort + include-in-output.
- **`ProviderApiError`** — structural contract: status, code/type, message, provider tag, retryAfter, quota/auth/transient flags, `raw` slot. Type guards/predicates, NOT a required base class. Distinct from errorParsing's parsed-JSON ApiError.
- **Count/embed**: minimal neutral `CountTokensRequest/Result`, `EmbedContentRequest/Result` (contents in; totals/vectors out).
- **Grounding/citations**: neutral `GroundingInfo` (sources, segments) + `UrlAccessInfo` (url metadata) covering what web-search/web-fetch tools consume from `GroundingMetadata`/`UrlMetadata`.
- **`ToolResultContent = string | ContentBlock[]`** + normative PartListUnion conversion rules (string→string; Part/Part[]→ContentBlock[]; text→TextBlock; inlineData→MediaBlock base64; fileData→MediaBlock url; functionResponse→ToolResponseBlock; unsupported shapes = converter error, never silent stringify/drop).
- **Block-level `providerMetadata?: Record<string, unknown>`** added to every ContentBlock variant (optional). Keys namespaced by provider (e.g. `gemini.videoMetadata`). Persisted-history compatibility must be tested.
- **`UsageStats` extensions**: add camelCase `reasoningTokens?`, `toolTokens?`; keep existing snake_case compat fields.
- **String-literal unions, not enums.** Immutable data. Zod NOT required for these types (structural typing; no new runtime deps) — but where runtime validation is genuinely needed, plain type guards.
- **Envelope diagnostics** (promptFeedback, safety ratings, AFC history, chunk traces) ride envelope-level providerMetadata; never first-class fields.

## Project Structure (new files)

```
packages/core/src/llm-types/
  index.ts                 # Barrel: re-exports everything incl. IContent re-export
  finishReasons.ts         # CanonicalFinishReason union + mapping helpers
  jsonSchema.ts            # JsonSchema structural type + guards
  toolDeclaration.ts       # ToolDeclaration, ToolChoice, adapters from legacy toolsets
  toolCall.ts              # ToolCallRequest, ToolResultContent + conversion helpers (Part-free rules typed on unknown)
  modelEnvelope.ts         # ModelOutput, ModelStreamChunk, accumulateModelStreamChunk, getToolCalls, toModelStreamChunk
  modelRequest.ts          # ModelGenerationRequest/Settings, ReasoningConfig
  providerApiError.ts      # ProviderApiError + guards
  tokensAndEmbeddings.ts   # CountTokensRequest/Result, EmbedContentRequest/Result
  grounding.ts             # GroundingInfo, UrlAccessInfo
  (tests co-located *.spec.ts per file)
packages/core/src/services/history/IContent.ts   # MODIFIED: block-level providerMetadata?, UsageStats extensions
packages/providers/src/gemini/geminiSchemaHelpers.ts  # MODIFIED: cycle-safe, non-mutating (behavior carve-out)
packages/providers/src/gemini/neutralConverters.ts    # NEW: additive lossless helpers (fileData/MediaBlock-url, executableCode/codeExecutionResult, finish reasons, usage, grounding, ApiError→ProviderApiError)
scripts/genai-import-inventory.ts                     # NEW: generates inventory
project-plans/issue2347/genai-import-baseline.md OR dev-docs/  # checked-in baseline
dev-docs/genai-migration.md                            # NEW: migration notes per package
```

`ToolResultContent` conversion FROM PartListUnion: lives at the Gemini boundary (neutralConverters.ts) because PartListUnion is a Google type — llm-types/toolCall.ts defines only the target type. Wait — packages/tools needs the converter in #2351 without importing providers. DECISION: the converter operates on `unknown` input with structural checks (no @google/genai import needed — Part is structurally `{text?...}`), so it CAN live in llm-types/toolCall.ts typed against `unknown`, keeping core free of new @google/genai imports. This satisfies the enclave guardrail.

## Integration Points (MANDATORY)

This is explicitly a FOUNDATION PR: the issue mandates NO call-site migration. Consumers are #2348–#2351 (documented in dev-docs/genai-migration.md with per-symbol dispositions). Within THIS PR the integration evidence is:

- packages/core/src/index.ts exports llm-types (existing code path: published package index).
- packages/core/package.json gains `./llm-types/index.js` subpath export (pattern matches existing subpaths).
- IContent.ts modified in place (block providerMetadata + UsageStats) — used by ALL existing history/provider code, proving non-breakage via the untouched existing suite.
- geminiSchemaHelpers.ts modified in place — used by geminiRequestBuilding.ts today.
- gemini neutralConverters consume the REAL ContentConverters/geminiResponseMapper machinery in round-trip tests.

### Existing Code To Be Replaced (by downstream issues, documented here)

- convertIContentToResponse (agents) → ModelOutput (#2349)
- providerStopReason.ts widened-Candidate smuggling → finishReason/rawStopReason (#2349)
- hookToolRestrictions WeakMaps → ModelOutput.hookRestrictions (#2349)
- ToolResult.llmContent: PartListUnion → ToolResultContent (#2351)
- etc. per issue disposition table

## Formal Requirements

[REQ-001] Canonical finish reasons
  [REQ-001.1] CanonicalFinishReason = 'stop'|'max_tokens'|'tool_calls'|'safety'|'refusal'|'error'|'other'
  [REQ-001.2] mapGeminiFinishReason covers every @google/genai FinishReason enum member (STOP, MAX_TOKENS, SAFETY, RECITATION, LANGUAGE, BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL, OTHER, IMAGE_SAFETY, UNEXPECTED_TOOL_CALL, FINISH_REASON_UNSPECIFIED) without importing @google/genai (accepts string)
  [REQ-001.3] mapOpenAIFinishReason: stop→stop, length→max_tokens, tool_calls/function_call→tool_calls, content_filter→safety, unknown→other
  [REQ-001.4] mapAnthropicStopReason: end_turn→stop, max_tokens→max_tokens, tool_use→tool_calls, refusal→refusal, stop_sequence→stop, unknown→other
  [REQ-001.5] All mappers return {finishReason, rawStopReason} preserving the raw input string
[REQ-002] JsonSchema
  [REQ-002.1] `false`/`true` are valid JsonSchema values, distinguishable from absent
  [REQ-002.2] Object schemas admit $ref/$defs/definitions/anyOf/oneOf/allOf/not/additionalProperties and arbitrary keywords (open structural type)
  [REQ-002.3] isJsonSchema guard accepts boolean and object, rejects null/number/string/array
[REQ-003] ToolDeclaration + ToolChoice
  [REQ-003.1] ToolDeclaration { name: string; description?: string; parametersJsonSchema: JsonSchema }
  [REQ-003.2] toolDeclarationsFromLegacyToolset converts ProviderToolset-shaped input (functionDeclarations with optional parametersJsonSchema, legacy parameters fallback → parametersJsonSchema; missing both → {} empty schema)
  [REQ-003.3] ToolChoice { mode: 'auto'|'required'|'none'; allowedToolNames?: string[] } — orthogonal fields
  [REQ-003.4] Compile-time assignability: existing ProviderToolset and RuntimeProviderToolset entries convertible without casts
[REQ-004] ToolCallRequest + ToolResultContent
  [REQ-004.1] ToolCallRequest { id?: string; name: string; args: Record<string, unknown> }
  [REQ-004.2] ToolResultContent = string | ContentBlock[]
  [REQ-004.3] toolResultContentFromLegacyPartListUnion(input: unknown): string→string; {text}→TextBlock; {inlineData:{mimeType,data}}→MediaBlock base64; {fileData:{mimeType,fileUri}}→MediaBlock url; {functionResponse}→ToolResponseBlock; arrays map element-wise; unsupported shape → explicit error result (never silent stringify/drop). Returns {ok:true,value}|{ok:false,error} — no exceptions for control flow
[REQ-005] Model envelope
  [REQ-005.1] ModelOutput { content: IContent; finishReason?: CanonicalFinishReason; rawStopReason?: string; usage?: UsageStats; responseId?: string; hookRestrictions?: { allowedToolNames?: string[]; filteredRestrictedCalls?: ToolCallRequest[] }; providerMetadata?: Record<string, unknown> }
  [REQ-005.2] ModelStreamChunk — same envelope fields, content is a delta IContent; empty-blocks chunks valid
  [REQ-005.3] accumulateModelStreamChunk(acc, chunk): concatenates blocks; last-write-wins usage/responseId/finishReason/rawStopReason; shallow-merge providerMetadata (chunk wins); does not mutate inputs
  [REQ-005.4] getToolCalls(output): derives ToolCallRequest[] from ToolCallBlocks in content.blocks (id, name, parameters→args)
  [REQ-005.5] toModelStreamChunk(icontent): maps metadata.finishReason/stopReason→finishReason (via canonical mapping when recognizable, else 'other')+rawStopReason, metadata.usage→usage, metadata.id→responseId
[REQ-006] Request types + ReasoningConfig
  [REQ-006.1] ModelGenerationSettings { temperature?; maxOutputTokens?; systemInstruction?: string; reasoning?: ReasoningConfig; toolChoice?: ToolChoice }
  [REQ-006.2] ModelGenerationRequest { contents: IContent[]; tools?: ToolDeclaration[]; settings?: ModelGenerationSettings }
  [REQ-006.3] ReasoningConfig { budgetTokens?: number; effort?: 'low'|'medium'|'high'; includeInOutput?: boolean }
[REQ-007] ProviderApiError
  [REQ-007.1] ProviderApiError { provider?: string; status?: number; code?: string; message: string; retryAfterMs?: number; isQuotaError?: boolean; isAuthError?: boolean; isTransient?: boolean; raw?: unknown }
  [REQ-007.2] isProviderApiError type guard (structural)
[REQ-008] Count/embed + grounding
  [REQ-008.1] CountTokensRequest { contents: IContent[] } / CountTokensResult { totalTokens: number }
  [REQ-008.2] EmbedContentRequest { texts: string[] } / EmbedContentResult { embeddings: number[][] }
  [REQ-008.3] GroundingInfo { sources: Array<{ title?; url?; snippet? }>; segments?: Array<{ startIndex?; endIndex?; text?; sourceIndices?: number[] }> }
  [REQ-008.4] UrlAccessInfo { url: string; status: string }
[REQ-009] IContent extensions (in-place modification)
  [REQ-009.1] Every ContentBlock variant gains optional providerMetadata?: Record<string, unknown>
  [REQ-009.2] UsageStats gains reasoningTokens?, toolTokens? (camelCase); existing fields unchanged
  [REQ-009.3] Pre-existing serialized history (JSON without the new fields) still parses/validates: ContentValidation.hasContent unchanged for all prior inputs
[REQ-010] Gemini boundary additive helpers (packages/providers/src/gemini/neutralConverters.ts)
  [REQ-010.1] geminiPartsToBlocks/blocksToGeminiParts supporting fileData ↔ MediaBlock(url), inlineData ↔ MediaBlock(base64), executableCode → CodeBlock (+gemini.* block providerMetadata residuals), codeExecutionResult → ToolResponseBlock convention, thought parts unchanged semantics (delegating to/consistent with ContentConverters where overlapping)
  [REQ-010.2] Round-trips are lossless for these part shapes (input == regenerated output)
  [REQ-010.3] geminiUsageToUsageStats maps thoughtsTokenCount→reasoningTokens, toolUsePromptTokenCount→toolTokens, cached counts
  [REQ-010.4] geminiGroundingToGroundingInfo, geminiUrlMetadataToUrlAccessInfo
  [REQ-010.5] geminiApiErrorToProviderApiError (accepts SDK ApiError instance)
  [REQ-010.6] toolDeclarationsToGemini via cleanGeminiSchema (documented lossy)
  [REQ-010.7] EXISTING entry points (ContentConverters.toGeminiContent/toIContent, geminiResponseMapper) behavior unchanged — verified by untouched existing tests
[REQ-011] cleanGeminiSchema hardening (behavior carve-out)
  [REQ-011.1] Never mutates input schema
  [REQ-011.2] Terminates on cyclic schemas (visited tracking); cycle edges dropped in output (lossy-by-design, documented)
  [REQ-011.3] All existing cleanGeminiSchema tests still pass
[REQ-012] Inventory + docs
  [REQ-012.1] scripts/genai-import-inventory.ts emits deterministic sorted list of tracked files importing @google/genai (source AND tests), each classified to owning issue (2348/2349/2350/2351/enclave)
  [REQ-012.2] Checked-in baseline file; unclassified entries cause script to exit 1
  [REQ-012.3] dev-docs/genai-migration.md: disposition table + per-package guidance + anti-regression rule (no Google-shaped temporary aliases)
[REQ-013] Exports
  [REQ-013.1] packages/core/src/index.ts re-exports llm-types
  [REQ-013.2] packages/core/package.json subpath export ./llm-types/index.js following existing pattern
[REQ-INT-001] Additive-only gates
  [REQ-INT-001.1] No existing exported signature breaks (existing suite untouched and green)
  [REQ-INT-001.2] No existing converter entry-point behavior change except REQ-011
  [REQ-INT-001.3] No new files importing @google/genai outside providers/src/gemini/** and core/src/code_assist/** (llm-types is Google-import-free; gemini test fixtures inside providers/src/gemini/** are fine)

## Constraints

- TypeScript strict; no `any`; no type assertions (type predicates OK); immutable patterns.
- No eslint-disable/ts-ignore/severity downgrades/complexity-threshold increases (CI-enforced by lint:eslint-guard).
- Tests: Vitest; behavioral per dev-docs/RULES.md; NO mock theater; ≥30% property-based (fast-check is available: `@fast-check/vitest` 0.2.4 / fast-check 4.5.3 at root; core devDeps include fast-check ^4.2.0).
- Round-trip tests in providers use REAL ContentConverters/mapper code, not mocks.
- File naming: existing core uses camelCase file names (e.g. contentGenerator.ts) — follow the surrounding convention (camelCase in llm-types).
- Tests co-located as *.spec.ts or *.test.ts matching neighbors (core uses .test.ts predominantly — use .test.ts).

## Verification (whole PR)

- npm run test / lint / typecheck / format / build green
- Smoke: node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
- git diff shows no modifications to existing test files (except adding new ones)
- Additive gates of REQ-INT-001 hold
