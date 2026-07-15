# Migration Guide: Retiring `@google/genai` Types (Foundation #2347)

Part of the Gemini-containment umbrella [#2343](https://github.com/vybestack/llxprt-code/issues/2343). This document is the migration guide delivered by the foundation PR [#2347](https://github.com/vybestack/llxprt-code/issues/2347); downstream migration issues are #2348–#2351 and the enforcement ratchet is #2352.

> **Status update (0.10.0, issue #2537):** The transitional `geminiLegacyAliases.ts` singleton alias module introduced by #2354 has been deleted. The canonical event types (`AgentEventType`, `ServerAgentStreamEvent`, `ServerAgent*Event`, `AgentErrorEventValue`, `ServerFinishedOutcome`, `InformationalStreamEvent`) are the sole names in `core/turn.js`. `GeminiCodeRequest` (formerly `PartListUnion`) had no internal usages and is removed; use `ContentBlock[]` / `IContent` for conversation content or `ToolResultContent` (`llm-types/toolCall.js`) for tool-result payloads. Architecture enforcement is now AST-based (`providerAgnosticNaming.test.ts`), scanning all workspace source roots for provider-neutral Gemini identifiers while exempting only exact compatibility boundaries. The migration targets below (#2348–#2351) for `@google/genai` type containment remain in progress.

## The lingua franca: `IContent`

The provider-agnostic conversation model — `IContent` / `ContentBlock` in `packages/core/src/services/history/IContent.ts` — is the **lingua franca**. There are no Google-shaped "neutral" types. Wherever `Part` / `PartUnion` / `PartListUnion` / `Content` / `ContentListUnion` appears above the provider boundary, the neutral replacement is `ContentBlock` / `ContentBlock[]` / `IContent`. Tool results, file attachments, and thought content are already covered by `ToolResponseBlock`, `MediaBlock`, and `ThinkingBlock`.

## Where the neutral types live

- **Neutral type layer:** `packages/core/src/llm-types/` — the new `ModelOutput` / `ModelStreamChunk` envelope, finish-reason union + provider mappers, `JsonSchema`, `ToolDeclaration` / `ToolChoice`, `ToolCallRequest`, `ToolResultContent` + conversion rules, neutral request types, `ReasoningConfig`, `ProviderApiError`, count/embed types, and grounding/citation types.
- **Exported from the core package:** `@vybestack/llxprt-code-core` re-exports the barrel (`packages/core/src/index.ts` → `export * from './llm-types/index.js'`), and the dedicated subpath `@vybestack/llxprt-code-core/llm-types/index.js` is declared in `packages/core/package.json`.
- **Gemini boundary helpers:** additive lossless converters in `packages/providers/src/gemini/neutralConverters.ts` — fileData/MediaBlock-url, executableCode/codeExecutionResult, finish reasons, usage, grounding, `ApiError` → `ProviderApiError`, and `toolDeclarationsToGemini`. This is the ONLY location (besides the code_assist enclave) permitted to import `@google/genai`.

## Anti-regression rule

> Migration PRs (#2348–#2351) **may not** introduce Google-shaped "temporary neutral" aliases. There is no `LlxprtPart`, no renamed 1:1 clone of a Google type, and no structurally-Google mirror with a llxprt name. Every neutral type is anchored on `IContent` / `ContentBlock` (the conversation model) or on provider-agnostic protocol shapes. If a genuine gap is found during migration, extend `ContentBlock` with a new discriminated variant — never with an optional-field union that mirrors Google's `Part`.

## Symbol-by-symbol disposition

The table below is the authoritative disposition of every `@google/genai` symbol in use, copied from issue #2347. "Already covered" means the neutral type exists today (no new type needed); the other rows name the new neutral type delivered by #2347 and the migration issue that swaps call sites onto it. (Literal pipe characters inside type unions are escaped as `\|` so they render correctly inside the Markdown table.)

| `@google/genai` symbol (usage)                                                                                                                                                                                                               | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content`, `Part`, `PartUnion`, `PartListUnion`, `ContentListUnion`                                                                                                                                                                          | **Already covered**: `IContent`, `ContentBlock`, `ContentBlock[]`, `IContent[]`. No new types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `FunctionCall` _inside conversation content_                                                                                                                                                                                                 | **Already covered**: `ToolCallBlock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FunctionCall` _as a standalone protocol object_ (policy-helpers.ts, CoreMessageBusAdapter.ts, lspIntegration.ts `callTool(functionCalls)`, mcp-callable-tool.ts, hookToolRestrictions)                                                      | **New neutral `ToolCallRequest` type** in llm-types (`{ id?; name; args }` — `args` matches the existing internal scheduler/policy/message-bus convention; the MCP boundary adapter maps to the wire's `arguments`) — named distinctly from `ToolCallBlock` because these are protocol/event surfaces, not conversation content. Policy, message-bus, MCP `callTool`, and LSP paths re-declare onto it in #2348/#2351.                                                                                                                                                                                                                                |
| Value helpers: `createUserContent` (agents MessageConverter), `createUserContentWithFunctionResponseFix`                                                                                                                                     | **Replaced by llxprt factories**: `createUserMessage`/`createToolResponse` in IContent.ts (extended if gaps found). Migration in #2349.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GenerateContentResponse`, `Candidate`, `GenerateContentResponsePromptFeedback`                                                                                                                                                              | **No structural clone.** New neutral `ModelOutput`/`ModelStreamChunk` envelopes anchored on IContent. One-shot helpers (summarizer, llm-edit-fixer) return `IContent` or `ModelOutput`. `promptFeedback`, candidate safety ratings, and similar Gemini diagnostics ride envelope-level `providerMetadata` (tested on the Gemini path), never first-class fields.                                                                                                                                                                                                                                                                                      |
| `FinishReason`                                                                                                                                                                                                                               | **New neutral type**: canonical finish-reason string-literal union (`'stop' \| 'max_tokens' \| 'tool_calls' \| 'safety' \| 'refusal' \| 'error' \| 'other'`) + per-provider mapping helpers + `rawStopReason` passthrough. Formalizes the existing untyped `ContentMetadata.stopReason`/`finishReason` strings and subsumes providerStopReason.ts.                                                                                                                                                                                                                                                                                                    |
| `GenerateContentResponseUsageMetadata` (telemetry api-events.ts, core contentGenerator.ts, core turn.ts, AgentRuntimeContext, agents)                                                                                                        | **Already mostly covered**: `UsageStats` in IContent.ts; extend with missing fields (reasoning/thoughts tokens, tool-use tokens) using camelCase names; keep existing snake_case compat fields until migration completes. All listed importers are migration targets (#2348 core/runtime/turn, #2349 agents, #2351 telemetry).                                                                                                                                                                                                                                                                                                                        |
| `FunctionDeclaration`, `Tool`, `ToolListUnion`, `Schema`, `Type`                                                                                                                                                                             | **New neutral types**: `ToolDeclaration { name; description?; parametersJsonSchema: JsonSchema }` + `JsonSchema`. `ProviderToolset`/`ITool` (providers) and `RuntimeProviderToolset`/`RuntimeProviderTool` (core runtime contracts) reconcile onto these — note the legacy shapes have _optional_ `parametersJsonSchema` and a legacy `parameters` field, so the foundation ships **conversion adapters** (legacy → canonical, with the documented legacy-`parameters` fallback policy) and behavioral conversion tests, not just assignability assertions. Gemini dialect conversion stays in geminiSchemaHelpers.ts.                                |
| `ToolConfig`, `FunctionCallingConfig`, `FunctionCallingConfigMode` (incl. hooks `BeforeToolSelectionHookOutput`, hookAggregator)                                                                                                             | **New neutral `ToolChoice` type** matching the semantics hooks already use (hookTranslator: `mode: AUTO/ANY/NONE` + independent `allowedFunctionNames`): `{ mode: 'auto' \| 'required' \| 'none'; allowedToolNames?: string[] }` — mode and allow-list are **orthogonal** (allowedToolNames restricts the candidate set; mode says whether a call must happen), not overloaded into one field. Per-provider mapping documented, including behavior when a provider can't express a combination (nearest-mode fallback recorded in providerMetadata, never silent).                                                                                    |
| `GenerateContentParameters`, `GenerateContentConfig`, `SendMessageParameters`                                                                                                                                                                | **New neutral request types**, anchored on what `GenerateChatOptions`/`RuntimeGenerateChatOptions` already carry: contents (`IContent[]`), tools (`ToolDeclaration[]`), generation settings (temperature, maxOutputTokens, systemInstruction, `ReasoningConfig`, `ToolChoice`). Provider-specific extras go through modelParams.                                                                                                                                                                                                                                                                                                                      |
| Hook surface: `GenerateContentResponse`/`GenerateContentParameters`/`ToolConfig`/`ToolListUnion` in packages/core/src/hooks/types.ts + hookTranslator.ts                                                                                     | **Migration target**: hooks' `getSyntheticResponse`/`getModifiedResponse` re-declare onto `ModelOutput`; `applyLLMRequestModifications` onto the neutral request type; `BeforeToolSelectionHookOutput` onto `ToolChoice`. **External-compat constraint:** hookTranslator's `LLMRequest`/`LLMResponse` are the documented _stable JSON wire format for user hooks_ — that external format is frozen (or versioned); only the internal SDK-typed plumbing behind it migrates. Call-site migration in #2348/#2349.                                                                                                                                       |
| Hook tool-restriction WeakMap side channel (packages/agents/src/core/hookToolRestrictions.ts)                                                                                                                                                | **Retired by design**: `ModelOutput.hookRestrictions` carries `allowedToolNames`/`filteredRestrictedCalls` explicitly (nested, so the envelope doesn't become a hook transport). Migration in #2349.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ApiError` (core/src/utils/retry.ts retry classification, errorParsing.ts user-facing formatting — which also has its own local parsed-ApiError shape, agents TurnProcessor retry/schema-depth logic — NOT Gemini-only today)                | **New neutral provider-error contract** `ProviderApiError`: status, error code/type, message, provider tag, `retryAfter`, quota/auth/transient classification flags, and a `raw` slot — covering BOTH retry classification AND parse/format/report consumers. Must be explicitly distinguished from errorParsing's existing _parsed-JSON_ ApiError shape (same name, different thing). Retry migration also covers `RetryOptions.shouldRetryOnContent` (currently typed against `GenerateContentResponse`) → re-typed onto `ModelOutput`/`IContent`. Gemini provider maps the SDK `ApiError` class onto it at the boundary. Migration in #2348/#2349. |
| `ThinkingConfig`                                                                                                                                                                                                                             | **New neutral type**: minimal `ReasoningConfig` (budget/effort + include-in-output), mapped per provider (Gemini thinkingConfig, Anthropic extended thinking, OpenAI reasoning effort).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CountTokensParameters/Response`, `EmbedContentParameters/Response`                                                                                                                                                                          | **New neutral minimal types** (contents in, token count / vectors out). Only the Gemini path implements them natively; others estimate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GroundingMetadata`, `UrlMetadata` (web-search/web-fetch tools)                                                                                                                                                                              | **New neutral citation/grounding types** in core (sources, segments, url metadata). The Gemini provider's serverTools map to them, so packages/tools stops importing `@google/genai` (#2351).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `CallableTool` (mcp)                                                                                                                                                                                                                         | **New neutral interface** owned by the MCP package (it only wraps MCP tools; nothing Google about it). Uses `ToolDeclaration` + `ContentBlock[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ToolResult.llmContent: PartListUnion` (tools)                                                                                                                                                                                               | **Foundation defines the target type** `ToolResultContent = string \| ContentBlock[]` **with normative conversion rules** from today's PartListUnion values: plain string → string; single Part / Part[] → ContentBlock[]; text parts → TextBlock; inlineData → MediaBlock(base64); fileData → MediaBlock(url); functionResponse parts → ToolResponseBlock; unsupported shapes are a converter error, never a silent stringify/drop. Call-site migration in #2351.                                                                                                                                                                                    |
| `Part.fileData` (URI-backed media), `videoMetadata`                                                                                                                                                                                          | **MediaBlock with `encoding: 'url'`** models fileData. `videoMetadata` rides block-level providerMetadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Part.executableCode`, `Part.codeExecutionResult`                                                                                                                                                                                            | **Explicit disposition**: the _semantic payload_ maps to blocks — `executableCode` → `CodeBlock` (code + language), `codeExecutionResult` → `ToolResponseBlock` convention (or a new discriminated block if migration proves the need). Block-level `providerMetadata` carries only the _residual_ Gemini-specific fields (e.g. outcome enums) needed for exact round-trip — it is the extras channel, never the primary payload.                                                                                                                                                                                                                     |
| Turn protocol types (`Part[]` in `responseParts`, `FinishReason`, `GenerateContentResponseUsageMetadata` in core/src/core/turn.ts events; `ServerTool.schema: FunctionDeclaration`)                                                          | **Migration target**: events re-declare onto `ContentBlock[]`, the neutral finish-reason union, and extended `UsageStats`; `ServerTool.schema` onto `ToolDeclaration`. Call-site migration in #2348 (types live in core) and #2349 (agents consumers). Renames (`GeminiEventType` → …) remain Track 1 (#2344).                                                                                                                                                                                                                                                                                                                                        |
| AFC history (`automaticFunctionCallingHistory`), top-level `functionCalls`, `responseId`                                                                                                                                                     | `responseId` is a first-class `ModelOutput` field; `functionCalls` becomes the `getToolCalls()` derived accessor (with ID canonicalization preserved); AFC history rides providerMetadata (Gemini-SDK vestige). Consumer-by-consumer decisions in #2349.                                                                                                                                                                                                                                                                                                                                                                                              |
| `GoogleGenAI` / `GoogleGenAIWrapper` (core/src/core/googleGenAIWrapper.ts, contentGenerator.ts direct-Gemini path), `Chat` (agents test helpers)                                                                                             | **Gemini-destined code, NOT yet enclave**: googleGenAIWrapper.ts currently sits outside the enclaves and is a pre-existing importer owned by #2348, which moves it into providers/src/gemini/** or code_assist/** (or deletes it); no neutral equivalents. Test helpers migrate with their subjects.                                                                                                                                                                                                                                                                                                                                                  |
| `ProviderContentGenerator` (packages/providers/src/ProviderContentGenerator.ts — imports GenerateContent/CountTokens/EmbedContent params+responses; its generateContent paths already just throw "GeminiCompatibleWrapper has been removed") | **Mostly dead code**: #2348 re-declares the live countTokens/embedContent estimation paths onto the neutral count/embed types and deletes the dead throw-only paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Core adapters/config: `CoreMessageBusAdapter.ts`, `CoreMcpToolServiceAdapter.ts`, `policy/policy-helpers.ts`, `config/lspIntegration.ts`                                                                                                     | **Migration targets (#2348)**: `FunctionCall` → `ToolCallRequest`, `Part[]` → `ContentBlock[]`, `CallableTool`/`Tool` → the neutral MCP/tool interfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| a2a-server `PartUnion` (task.ts, task-runtime-helpers.ts)                                                                                                                                                                                    | **Covered by `ContentBlock[]`/`ToolResultContent`**; migrates in #2351 (leaf packages).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SafetySetting`, `MediaResolution`, `ModelSelectionConfig`, `GenerationConfigRoutingConfig`, `SpeechConfigUnion`                                                                                                                             | **Stay Gemini-only** (providers/src/gemini/**, code_assist/**). Never get neutral equivalents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Breaking rename mappings (0.10.0)

The following ToolFormatter tool-declaration/schema conversion methods are renamed because they are provider-neutral conversion utilities, not Gemini-specific code. The old names implied Gemini ownership of tool-declaration shapes that are now neutral (`ToolDeclaration`).

| Old name (removed)              | New name                             |
| ------------------------------- | ------------------------------------ |
| `convertGeminiToOpenAI`         | `convertToolDeclarationsToOpenAI`    |
| `convertGeminiToAnthropic`      | `convertToolDeclarationsToAnthropic` |
| `convertGeminiToFormat`         | `convertToolDeclarationsToFormat`    |
| `convertGeminiSchemaToStandard` | `convertSchemaToStandard`            |

## Per-package migration guidance

The import inventory baseline (`dev-docs/genai-import-baseline.md`) classifies every tracked `@google/genai` importer to the issue that removes it. The per-package guidance below mirrors the issue #2347 plan.

### #2348 — core

The core package owns the largest concentration of non-enclave importers. Migration targets:

- **`ContentGenerator` interface** — re-declare in terms of the neutral request/response types (`ModelGenerationRequest`, `ModelOutput`/`ModelStreamChunk`).
- **`ProviderContentGenerator`** (`packages/providers/src/ProviderContentGenerator.ts`) — re-declare the live `countTokens`/`embedContent` estimation paths onto the neutral count/embed types; delete the dead throw-only `generateContent` paths ("GeminiCompatibleWrapper has been removed").
- **`turn.ts` protocol types** — events re-declare onto `ContentBlock[]` (for `responseParts`), the neutral finish-reason union, and the extended `UsageStats`; `ServerTool.schema` onto `ToolDeclaration`.
- **retry / `errorParsing` `ApiError`** — map onto `ProviderApiError` (explicitly distinct from errorParsing's parsed-JSON `ApiError` shape); re-type `RetryOptions.shouldRetryOnContent` (currently typed against `GenerateContentResponse`) onto `ModelOutput`/`IContent`.
- **hooks internal plumbing** — `getSyntheticResponse`/`getModifiedResponse` re-declare onto `ModelOutput`; `applyLLMRequestModifications` onto the neutral request type; `BeforeToolSelectionHookOutput` onto `ToolChoice`. The **external hook JSON format** (`hookTranslator`'s `LLMRequest`/`LLMResponse`) is the stable user-facing wire format — it is frozen; only the internal SDK-typed plumbing behind it migrates.
- **`googleGenAIWrapper` rehoming** — `core/src/core/googleGenAIWrapper.ts` moves into `packages/providers/src/gemini/**` or `packages/core/src/code_assist/**` (an enclave), or is deleted if dead.
- **Core adapters/config** — `CoreMessageBusAdapter.ts`, `CoreMcpToolServiceAdapter.ts`, `policy/policy-helpers.ts`, `config/lspIntegration.ts`: `FunctionCall` → `ToolCallRequest`, `Part[]` → `ContentBlock[]`, `CallableTool`/`Tool` → the neutral MCP/tool interfaces.

### #2349 — agents (and providers non-gemini)

The agents layer is the primary consumer of the synthetic Gemini envelope. The providers package's non-gemini shared files (e.g. `ProviderContentGenerator.ts`, `IProvider.ts`) migrate here too. Migration targets:

- **Envelope adoption via `toModelStreamChunk`** — insert the adapter at the single point where agents consume the provider stream; `Turn`/`TurnProcessor`/`StreamProcessor` swap onto `ModelOutput`/`ModelStreamChunk` + `accumulateModelStreamChunk`.
- **Retire `convertIContentToResponse`** (`MessageConverter.ts`) — providers emit neutral `IContent`; the agents layer no longer synthesizes a `GenerateContentResponse`.
- **Retire `providerStopReason.ts`** — the widened-`Candidate` smuggling of Anthropic's `refusal` stop reason is replaced by `finishReason` + `rawStopReason` on the envelope.
- **Retire `hookToolRestrictions` WeakMaps** — the hidden side channel (WeakMaps keyed on `GenerateContentResponse`/`FunctionCall` object identity) is replaced by explicit `ModelOutput.hookRestrictions` (`allowedToolNames` / `filteredRestrictedCalls`).
- **Retire `createUserContent` / `createUserContentWithFunctionResponseFix`** — replaced by the llxprt factories `createUserMessage`/`createToolResponse`.

### #2350 — cli

CLI importers are migrated last among the non-leaf packages. The CLI is a thin client of the public Agent/runtime API; its `@google/genai` imports are predominantly type re-exports and test helpers that retire as their upstream subjects (#2348/#2349) migrate. No new neutral types are introduced for the CLI — it consumes the public surface delivered by the foundation and the upstream migration issues.

### #2351 — leaves (tools, mcp, telemetry, a2a-server, test-utils)

The leaf packages migrate independently once core/agents/providers settle. Migration targets:

- **`ToolResultContent`** (`packages/tools`) — `ToolResult.llmContent: PartListUnion` becomes `ToolResultContent = string | ContentBlock[]`; use `toolResultContentFromLegacyPartListUnion` for the conversion (string → string; Part/Part[] → ContentBlock[]; text → TextBlock; inlineData → MediaBlock base64; fileData → MediaBlock url; functionResponse → ToolResponseBlock; unsupported shape → explicit error).
- **`CallableTool`** (`packages/mcp`) — new neutral MCP-owned interface using `ToolDeclaration` + `ContentBlock[]`.
- **Grounding / citations** (`packages/tools` web-search/web-fetch) — consume the neutral `GroundingInfo` / `UrlAccessInfo`; the Gemini provider's serverTools map onto them.
- **a2a-server** — `PartUnion` in `task.ts` / `task-runtime-helpers.ts` is covered by `ContentBlock[]` / `ToolResultContent`.
- **`UsageStats`** (`packages/telemetry`) — `api-events.ts` consumes the extended `UsageStats` (camelCase `reasoningTokens` / `toolTokens`); existing snake_case compat fields retained until all consumers migrate.

### #2352 — enforcement (the ratchet)

`dev-docs/genai-import-baseline.md` is the **#2352 ratchet baseline**: the generated inventory of every tracked `@google/genai` importer, each classified to the issue that removes it. The count may only ever DECREASE as #2348–#2351 land. `scripts/genai-import-inventory.ts --check` regenerates the table in memory and diffs against the checked-in baseline; any drift (a new importer, an unclassified path, or a reclassification) exits non-zero. When #2352 completes:

- **Only `packages/providers/src/gemini/**`and`packages/core/src/code_assist/**`may import`@google/genai`.** Every other importer has been migrated or deleted.
- **`ContentConverters.ts`** (`packages/core/src/services/history/`) — a pre-existing importer that sits outside the end-state enclaves — moves out of `services/history` into an enclave (Google conversion living in a history service is misleading), or is deleted if fully superseded by the additive lossless helpers in `packages/providers/src/gemini/neutralConverters.ts`.
- **`@google/genai` is removed from `package.json` dependencies** of every package except `@vybestack/llxprt-code-providers` (gemini enclave) and `@vybestack/llxprt-code-core` (code_assist enclave).

## How to use the new types

Three concrete before/after examples. Import the neutral types from `@vybestack/llxprt-code-core` (or the `./llm-types/index.js` subpath).

### 1. `FinishReason` enum → `mapGeminiFinishReason`

Before (Google enum, requires `@google/genai`):

```ts
import { FinishReason } from '@google/genai';
if (candidate.finishReason === FinishReason.STOP) {
  /* ... */
}
```

After (neutral union + raw passthrough):

```ts
import { mapGeminiFinishReason } from '@vybestack/llxprt-code-core';
const { finishReason, rawStopReason } = mapGeminiFinishReason(
  candidate.finishReason,
);
if (finishReason === 'stop') {
  /* ... */
}
// rawStopReason preserves the provider-native string verbatim.
```

### 2. `PartListUnion` tool result → `toolResultContentFromLegacyPartListUnion`

Before (Google `PartListUnion` leaks into every tool's output surface):

```ts
import type { PartListUnion } from '@google/genai';
interface ToolResult {
  llmContent: PartListUnion /* ... */;
}
```

After (neutral `ToolResultContent`; the converter operates on `unknown` with structural checks, no `@google/genai` import):

```ts
import {
  toolResultContentFromLegacyPartListUnion,
  type ToolResultContent,
} from '@vybestack/llxprt-code-core';

interface ToolResult {
  llmContent: ToolResultContent /* ... */;
}

const converted = toolResultContentFromLegacyPartListUnion(rawPartList);
if (!converted.ok) {
  throw new Error(`unsupported tool-result shape: ${converted.error}`);
}
result.llmContent = converted.value;
```

### 3. Synthetic `GenerateContentResponse` → `ModelOutput` + `toModelStreamChunk`

Before (agents synthesize a Google response envelope around neutral provider output):

```ts
import type { GenerateContentResponse } from '@google/genai';
const synthetic: GenerateContentResponse = convertIContentToResponse(icontent);
```

After (providers stream neutral `IContent`; the adapter lifts each chunk onto the typed envelope — no Google type):

```ts
import {
  toModelStreamChunk,
  accumulateModelStreamChunk,
  type ModelOutput,
} from '@vybestack/llxprt-code-core';

let acc: ModelOutput = { content: { speaker: 'ai', blocks: [] } };
for (const chunk of providerStream) {
  acc = accumulateModelStreamChunk(acc, toModelStreamChunk(chunk));
}
// acc.finishReason / acc.rawStopReason / acc.usage / acc.responseId
// are now typed envelope fields (no candidates array, no Google field names).
```
