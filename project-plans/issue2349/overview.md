# Issue #2349 — Technical Overview & Architecture Inventory

**Migrate `packages/agents` off `@google/genai` (agent loop: `client.ts`, `turn.ts`, `TurnProcessor`)**

> **Scope of this document.** This is an *inventory + architecture analysis* — a map of the current (broken) and target (neutral) architectures. It is **NOT** an implementation plan: it contains no phases, no TDD steps, no task lists, no schedule, and no effort estimates. Its audience is a senior architect who will later turn it into a formal phased plan. Every non-obvious assertion cites concrete evidence (`file:line` or symbol). Where something could not be verified, it is marked **OPEN QUESTION**.

---

## 1. Governing Principle & Definitions

### 1.1 Governing principle (from the maintainer, decisive)

> Only the **Gemini provider** — and the conversion code directly behind it *for the purpose of talking to Gemini* — may use Google/Gemini SDK types. **Every other layer** (agents pipeline, core services, history, the client contract, the CLI) must be expressed in **neutral, domain-named** types.

### 1.2 Corollary (contract correctness)

> If a shared contract imports, or is defined in terms of, Google-shaped types, **THE CONTRACT IS WRONG AND MUST BE FIXED.** "The contract requires `ContractContent`" is **not** a valid reason to keep Google-shaped `Content` flowing through agents. The fix migrates the contract, not the agents around it.

### 1.3 Definition of "Google-shaped"

A type or object value is **Google-shaped** if its envelope structure matches the `@google/genai` wire model, **regardless of the name on it or where it is imported from**. Concretely, any of:

- an object whose shape is `candidates[].content.{role, parts[]}` (a `GenerateContentResponse`/`Candidate`/`Content` envelope);
- a `parts[]` array of `{ text?, functionCall?, functionResponse?, inlineData?, fileData?, thought?, thoughtSignature? }` (`Part[]`);
- a top-level `functionCalls: FunctionCall[]` array;
- a `usageMetadata` object keyed on `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount` / `cachedContentTokenCount` / `thoughtsTokenCount`;
- a `role: 'user' | 'model'` message wrapper (`Content`);
- a `PartListUnion` (`Part | string | Array<Part | string>`).

This is true whether the shape is:

1. **imported from `@google/genai`** (`Part`, `Content`, `GenerateContentResponse`, `FunctionCall`, `PartListUnion`, `Candidate`, `SendMessageParameters`, `GenerateContentConfig`, `FinishReason`, `Type`, `Schema`, `Tool`, `FunctionDeclaration`, `ApiError`, `GoogleGenAI`, `GenerateContentResponseUsageMetadata`, `createUserContent`);
2. **aliased from core `clientContract.ts`** (`ContractPart`, `ContractContent`, `ContractContentUnion`, `ContractPartListUnion`, `ContractGenerateContentResponse`, `ContractSendMessageParameters`, `ContractGenerateContentConfig`, `ContractUsageMetadata`); or
3. **built as an anonymous object literal** (e.g. `{ candidates: [{ content: { role, parts } }] }` in `MessageConverter.convertIContentToResponse`, evidence: `packages/agents/src/core/MessageConverter.ts:518-543`); or
4. **produced by the structural converters `ContentConverters.toGeminiContent(s)`** (returning the barrel-exported `GeminiContent`/`GeminiContentPart` structural types from `llm-types/geminiContent`, re-exported via the neutral barrel `llm-types/index.ts:38`). These carry the Gemini `{role,parts}` shape **without a raw `@google/genai` import at the call site** — the structural repeat of the #2424 vector. See §2A for the full inventory and disposition.

The distinguishing test is **structure, not provenance**. The prior rejected PR #2424 proved that provenance-only gating (grep for `@google/genai`) is insufficient: aliasing the same shape from `clientContract.ts` (case 2) — or routing it through `ContentConverters.toGeminiContents()` (case 4) — produces a green raw-import gate while the design stays Google-shaped.

### 1.4 Definition of "neutral"

**Neutral** types are the domain-named, provider-agnostic types owned by core in `packages/core/src/llm-types/` and `packages/core/src/services/history/IContent.ts`:

- `IContent`, `ContentBlock` (`TextBlock`, `ToolCallBlock`, `ToolResponseBlock`, `ThinkingBlock`, `MediaBlock`, `CodeBlock`), `UsageStats`, `ContentMetadata`
- `ModelOutput`, `ModelStreamChunk`, `HookRestrictions`
- `ModelGenerationRequest`, `ModelGenerationSettings`, `ReasoningConfig`
- `ToolCallRequest`, `ToolResultContent`
- `ToolDeclaration`, `ToolChoice`
- `JsonSchema`
- `CanonicalFinishReason` (+ mappers)
- `ProviderApiError` (+ `isProviderApiError`)

A neutral speaker vocabulary is `'human' | 'ai' | 'tool'` (`IContent['speaker']`), **not** `role: 'user' | 'model'`.

---

## 2. Current Architecture — the Broken Round-Trip

### 2.1 The load-bearing fact

`provider.generateChatCompletion()` **already returns `AsyncIterableIterator<IContent>`** — neutral, end to end from the provider.

> Evidence: `packages/core/src/runtime/contracts/RuntimeProvider.ts:77-84` — both overloads of `generateChatCompletion(...)` return `AsyncIterableIterator<IContent>`. The options type `RuntimeGenerateChatOptions.contents` is `IContent[]` (`packages/core/src/runtime/contracts/RuntimeProviderChat.ts:49-67`). The actual provider call is neutral: `StreamProcessor.ts:450-462` invokes `provider.generateChatCompletion({ contents: requestPayload.contents, ... })` with `IContent[]`.

Therefore the **actual runtime provider call is neutral in both directions** — `IContent[]` in, `AsyncIterable<IContent>` out. The Google shape is **manufactured by agents**, purely internally, and then converted back to neutral at the very end. This is a self-inflicted round-trip.

> **Caveat (do not over-read this).** "Neutral in both directions" describes only the *runtime provider call itself*. The surrounding agents request pipeline is **not** neutral: request preparation, before-model hook modification, and telemetry logging convert those same neutral request contents *back* to Gemini-shaped `Content[]` via `ContentConverters.toGeminiContents(...)` before the provider call. See `streamRequestHelpers.ts:228` (before-model hook target), `streamRequestHelpers.ts:281` (`logOutgoingRequest` telemetry), and `TurnProcessor.ts:457` (`logApiRequest` telemetry). These structural Gemini-content flows are inventoried in §3A and must be dispositioned; they are distinct from the neutral provider call at `StreamProcessor.ts:450-462`.

### 2.2 The round-trip, step by step

1. **Provider → IContent (neutral).** `StreamProcessor._sendProviderRequest` calls `provider.generateChatCompletion(...)` and receives `AsyncIterable<IContent>` (`packages/agents/src/core/StreamProcessor.ts` `_sendProviderRequest`, `_consumeFirstChunkAndReturn`; the param is typed `streamResponse: AsyncIterable<IContent>`).

2. **IContent → synthetic `GenerateContentResponse` (Google-shaped).** `StreamProcessor._convertIContentStream` calls `convertIContentToResponse(iContent)` per chunk, producing `{ candidates: [{ content: { role:'model', parts } }], functionCalls, usageMetadata, ... }`.
   > Evidence: `MessageConverter.convertIContentToResponse` fabricates the envelope: `packages/agents/src/core/MessageConverter.ts:518-543`; called from `StreamProcessor.ts` `_convertIContentStream` and `_processAfterModelHook`, and from `TurnProcessor._executeProviderCall`.

3. **Google-shaped response plumbed through the whole stream pipeline.** `StreamProcessor.processStreamResponse`, accumulation (`accumulateChunkMetadata`, `consolidateTextParts`, `recordHistoryWithUsage`), the AfterModel hook, and the cancellable-stream wrapper all operate on `GenerateContentResponse` and `Part[]` (`StreamProcessor.ts` throughout; note `_finalizeStreamProcessing` accumulator typed with `modelResponseParts: Part[]`, `finishReason: FinishReason`, `allChunks: GenerateContentResponse[]`).

4. **`GenerateContentResponse` yielded up through `TurnProcessor`.** `TurnProcessor._runStreamAttempt` iterates `makeApiCallAndProcessStream()` (yields `GenerateContentResponse`) and wraps each via `wrapChunk(resp)` (`TurnProcessor.ts` `wrapChunk`, `_runStreamAttempt`).

5. **Synthetic response → neutral `ModelStreamChunk` at the yield boundary.** `wrapChunk` calls `responseToModelStreamChunk(resp)` (`streamChunkWrapper.ts`) to satisfy `StreamEvent.CHUNK`, which carries `ModelStreamChunk` (`packages/core/src/core/chatSessionTypes.ts:21-25`, `StreamEvent = { type: CHUNK; value: ModelStreamChunk } | ...`).

6. **`Turn` re-derives Google `Part[]` from the neutral chunk.** `turn.ts` receives `ModelStreamChunk` but immediately calls `chunkToParts(chunk)` (`streamChunkWrapper.chunkToParts` → `MessageConverter.convertBlocksToParts`) and operates on `Part[]`/`FunctionCall[]` internally (`turn.ts` `processStreamChunk`, `handlePendingFunctionCall`).

So the data crosses the neutral↔Google boundary **at least three times**: provider-IContent → synthetic-response → ModelStreamChunk → Part[]-inside-Turn. None of it talks to Gemini.

### 2.3 Data-flow diagram — CURRENT (broken)

```mermaid
flowchart TD
    P["Provider.generateChatCompletion()<br/>returns AsyncIterable&lt;IContent&gt;<br/>(NEUTRAL — RuntimeProvider.ts:77-84)"]
    SP1["StreamProcessor._convertIContentStream<br/>convertIContentToResponse(iContent)<br/>=> synthetic GenerateContentResponse"]
    HK["AfterModel hook + hookToolRestrictions<br/>WeakMap&lt;GenerateContentResponse&gt; side-channel"]
    SP2["StreamProcessor.processStreamResponse<br/>accumulate Part[] / FinishReason<br/>_finalizeStreamProcessing -> HistoryService"]
    TP["TurnProcessor._runStreamAttempt<br/>for-await GenerateContentResponse<br/>wrapChunk()"]
    SCW["streamChunkWrapper.responseToModelStreamChunk<br/>reads providerStopReason side-channel<br/>reads hookToolRestrictions WeakMap<br/>=> ModelStreamChunk (NEUTRAL)"]
    SE["StreamEvent.CHUNK { value: ModelStreamChunk }<br/>(core chatSessionTypes.ts)"]
    TURN["Turn.processStreamChunk<br/>chunkToParts(chunk) => Part[]<br/>(BACK TO GOOGLE SHAPE)"]
    OUT["ServerAgentStreamEvent<br/>(Content/Thought/ToolCallRequest/Finished)"]

    P -->|IContent| SP1
    SP1 -->|GenerateContentResponse| HK
    HK -->|GenerateContentResponse| SP2
    SP2 -->|GenerateContentResponse| TP
    TP -->|GenerateContentResponse| SCW
    SCW -->|ModelStreamChunk| SE
    SE -->|ModelStreamChunk| TURN
    TURN -->|Part[] internally| OUT

    subgraph SIDE["Side-channels (exist only to cross the synthetic boundary)"]
        PSR["providerStopReason.ts<br/>field bolted onto Candidate"]
        HTR["hookToolRestrictions.ts<br/>WeakMap+Symbol keyed on response/FunctionCall identity"]
    end
    SP1 -.writes.-> PSR
    SCW -.reads.-> PSR
    SP1 -.writes.-> HTR
    SCW -.reads.-> HTR
    TURN -.reads.-> HTR
```

### 2.4 Data-flow diagram — TARGET (neutral end-to-end)

```mermaid
flowchart TD
    P["Provider.generateChatCompletion()<br/>returns AsyncIterable&lt;IContent&gt;<br/>(NEUTRAL — unchanged)"]
    SP["StreamProcessor (neutral)<br/>toModelStreamChunk(iContent)<br/>accumulate ContentBlock[] / CanonicalFinishReason<br/>_finalize -> HistoryService"]
    HK["AfterModel hook + neutral restriction metadata<br/>HookRestrictions on ModelStreamChunk<br/>(no WeakMap identity keying)"]
    TP["TurnProcessor (neutral)<br/>for-await ModelStreamChunk"]
    SE["StreamEvent.CHUNK { value: ModelStreamChunk }<br/>(unchanged)"]
    TURN["Turn.processStreamChunk<br/>operates on ContentBlock[] / ToolCallBlock<br/>rawStopReason on chunk (no side-channel)"]
    OUT["ServerAgentStreamEvent<br/>(unchanged public event shape)"]

    P -->|IContent| SP
    SP -->|ModelStreamChunk| HK
    HK -->|ModelStreamChunk| TP
    TP -->|ModelStreamChunk| SE
    SE -->|ModelStreamChunk| TURN
    TURN -->|ContentBlock[]| OUT
```

No synthetic `GenerateContentResponse` is manufactured; no `Part[]` is re-derived; no side-channel WeakMaps or bolted-on candidate fields are needed. `IContent` metadata already carries `stopReason`/`finishReason`/`usage`/`id` (`IContent.ts:75-83, 52-56`), and `toModelStreamChunk(iContent)` already maps them to a neutral chunk (`modelEnvelope.ts:188-210`).

> **`toModelStreamChunk(iContent)` alone is not a complete target conversion — provider output metadata must be normalized first.** As written, `toModelStreamChunk` populates only `rawStopReason`/`finishReason`/`usage`/`responseId` from `IContent.metadata` (`modelEnvelope.ts:188-210`); it does **not** copy `icontent.metadata.providerMetadata` onto `ModelOutput.providerMetadata`, even though the neutral slot exists (`ModelOutput.providerMetadata?: Record<string, unknown>`, `modelEnvelope.ts:51-59`). The current streaming wrapper `streamChunkWrapper.responseToModelStreamChunk` carries **more** than `toModelStreamChunk` does: it maps `resp.responseId` (`streamChunkWrapper.ts:91-93`, `:152-153`), `resp.usageMetadata` via `usageMetadataToUsageStats` (`:125-127`), and hook restrictions read from the WeakMap side channels (`:129-157`). Beyond AFC, the neutral Gemini adapter in core maps provider-specific metadata (`promptFeedback`, `safetyRatings`, `groundingMetadata`) into `ModelOutput.providerMetadata` under `gemini.*` keys (`contentGeneratorAdapters.ts:195-210`). Therefore the target conversion is **use `toModelStreamChunk(iContent)` only after/if provider output metadata is normalized onto `IContent.metadata` (or a wrapper extends the chunk)** — see the provider-metadata inventory item in §5.3-3a. For **AFC (automatic function calling)** specifically: the direct path reads `lastResponse.metadata?.providerMetadata?.['automaticFunctionCallingHistory']` (`DirectMessageProcessor.ts:755-764`) and the streaming path reads AFC from provider metadata too (§5.3-3), so relying on `providerMetadata` requires `toModelStreamChunk` to be **extended (or wrapped)** to preserve it, OR AFC must be promoted to a first-class neutral slot (`ModelOutput.afcHistory?: IContent[]`) so `providerMetadata` need not be load-bearing (OQ-2 / OQ-15). This target diagram assumes those gaps are closed.

### 2.5 The two side-channels (why they exist, exactly)

Both side-channels exist **only** because the pipeline round-trips through a Google-shaped response that has no neutral place to carry the extra data. They evaporate once the pipeline is neutral.

**(a) `providerStopReason.ts` — repo-owned field bolted onto Google `Candidate`.**

- Purpose: carry the *raw provider stop reason* (e.g. Anthropic `'refusal'`, `'end_turn'`) from `MessageConverter` (which sees `IContent.metadata.stopReason`) to `Turn` (which historically saw only `GenerateContentResponse`).
- Mechanism: `interface CandidateWithProviderStopReason extends Candidate { providerStopReason?: string }`; writer `setProviderStopReason(candidate, stopReason)`; reader `getProviderStopReason(candidate)`.
  > Evidence: `packages/agents/src/core/providerStopReason.ts:25-56`. Written by `MessageConverter.applyFinishReasonMapping` (`MessageConverter.ts:550`, `setProviderStopReason(response.candidates[0], terminationReason)` at `MessageConverter.ts:588`); read by `streamChunkWrapper.responseToModelStreamChunk` (`streamChunkWrapper.ts` `getProviderStopReason(candidate)`).
- Why it can't use `candidate.finishMessage`: the file's own doc comment (`providerStopReason.ts:9-21`) states `finishMessage` is a human-readable field a native Gemini response may legitimately populate, so reusing it risks misinterpreting descriptive text as a machine signal.
- Neutral home: `ModelStreamChunk.rawStopReason` (`modelEnvelope.ts` `ModelOutput.rawStopReason`) sourced directly from `IContent.metadata.stopReason`. This ties to **#2329 refusal handling**; the behavior (surfacing `stopReason` on the `Finished` event) must be preserved.

**(b) `hookToolRestrictions.ts` — WeakMaps + Symbols keyed on object identity.**

- Purpose: carry hook tool-restriction metadata (`allowedToolNames`, `hadFilteredRestrictedCalls`) across the synthetic-response boundary so tool filtering survives.
- Mechanism: `WeakMap<GenerateContentResponse, string[]>` (allowed tools), `WeakMap<GenerateContentResponse, boolean>` (filtered flag), `WeakMap<FunctionCall, string[]>`, plus non-enumerable `Symbol` props defined on the same objects as a fallback.
  > Evidence: `packages/agents/src/core/hookToolRestrictions.ts:15-35` (the maps + symbols); `attachHookRestrictedAllowedTools` (clones the response and stamps metadata), `getHookRestrictedAllowedTools`, `hasFilteredHookRestrictedToolCalls`, `setHookRestrictedAllowedToolsOnFunctionCall`. Consumed in `StreamProcessor.ts` (`_convertIContentStream`, `processStreamResponse`), `TurnProcessor.ts` (`_commitSendResult`, `_recordOutputContent`), and `turn.ts` (`processStreamChunk`, `handlePendingFunctionCall`).
- Neutral home: explicit `HookRestrictions` on `ModelStreamChunk` (already exists on `ModelOutput.hookRestrictions`, `modelEnvelope.ts` `HookRestrictions { allowedToolNames?, hadFilteredRestrictedCalls? }`). The `streamChunkWrapper` already reads the WeakMap and copies it onto `chunk.hookRestrictions` (`streamChunkWrapper.ts:129-139` derives `HookRestrictions`, assigned to the chunk at `:155-157`) — proving the neutral field is sufficient; the WeakMap is redundant scaffolding once the intermediate response is gone. Filtering itself moves to `ContentBlock[]`/`ToolCallBlock` filtering (`turn.ts` already has `filterBlocksByAllowedTools` operating on `ContentBlock[]`).

---

## 2A. Structural Google-Shaped Flows That Do NOT Import `@google/genai`

> **Scope of this section.** The raw-import inventory (§3) is necessary but **not sufficient**. The agents pipeline already moves Gemini-shaped `{ role, parts }` payloads through core `ContentConverters` — `toGeminiContent(s)` (neutral → Gemini) and `toIContent(s)` (Gemini → neutral) — which traffic in the structural types `GeminiContent` / `GeminiContentPart` / `GeminiFunctionCall` defined in `packages/core/src/llm-types/geminiContent.ts:71-87`. Those structural types are **Gemini-shaped per §1.3** (`{ role?, parts?: GeminiContentPart[] }`, with parts carrying `text?/thought?/thoughtSignature?/functionCall?/functionResponse?/inlineData?`) and are **re-exported from the neutral barrel** `packages/core/src/llm-types/index.ts:38` (`export * from './geminiContent.js'`). An implementation could therefore be **raw-import clean** (zero `@google/genai`) while continuing to use the Gemini content model as agents' internal currency — the exact #2424 failure mode in *structural* form. This section inventories and dispositions every such flow so a planner can eliminate or explicitly bound it.

### 2A.1 The structural converter boundary (core)

`packages/core/src/services/history/ContentConverters.ts` defines the boundary:

- `toGeminiContent(iContent)` (`ContentConverters.ts:141`) and `toGeminiContents(iContents)` (`ContentConverters.ts:524`) — **neutral → Gemini-shaped** (`IContent[] → GeminiContent[]`). This is the *problematic* direction: it re-manufactures the Gemini envelope from neutral history.
- `toIContent(content, ...)` (`ContentConverters.ts:433`) and `toIContents(contents)` (`ContentConverters.ts:553`) — **Gemini-shaped → neutral** (`GeminiContent[] → IContent[]`). This direction is the legitimate *inbound* conversion when the caller genuinely receives Gemini-shaped/legacy input (public contract input, hook-returned messages) and must normalize it to neutral for the history service.

The disposition principle: the **neutral → Gemini (`toGeminiContents`) direction must be eliminated from the agent loop's internal envelope**; it survives only at explicitly documented external-wire boundaries (public contract surface pending §4 migration, hook JSON wire, telemetry text extraction). The **Gemini → neutral (`toIContent(s)`) direction** is retained where it converts genuinely-external Gemini-shaped input into neutral, but its inputs must themselves become neutral wherever the "Gemini-shaped input" is produced *inside* agents.

### 2A.2 `toGeminiContents` (neutral → Gemini) call sites under `packages/agents/src` production — the offenders

There are **7** neutral→Gemini structural conversions in agents production. Each re-manufactures a Gemini `{ role, parts }` envelope from neutral `IContent[]`:

| # | Call site (`file:line`) | What it feeds | Disposition |
|---|-------------------------|---------------|-------------|
| G1 | `core/client.ts:421` | `getHistory()` returns `ContentConverters.toGeminiContents(storedHistory.getAll())` as `Content[]`; when a chat is live it first awaits `chat.waitForIdle()` before returning (`client.ts:403-413`) | **Contract-surface migration.** Return `IContent[]` once `AgentClientContract.getHistory` is retyped (§4.2). No standalone Gemini conversion remains. **Behavior to preserve:** the neutral `getHistory()` must still await idle before returning (idle-wait semantics), and must not expose mutable internal history. |
| G2 | `core/ConversationManager.ts:419` | `getHistory()` → `toGeminiContents(iContents)` then `structuredClone` returns `Content[]` (`:419-423`) | **Contract-surface migration.** Return `IContent[]` cloning the neutral history. **Behavior to preserve:** the current `structuredClone` defensive copy — the neutral `getHistory()` must return a clone of the neutral `IContent[]` (or otherwise avoid exposing mutable history internals), not a live reference to the history-service projection. |
| G3 | `core/streamRequestHelpers.ts:228` | before-model hook target `{ contents: toGeminiContents(requestContents) }` passed to `applyLLMRequestModifications(...)`; result converted back via `toIContents(modifiedContents)` at `:239` | **Hook-wire boundary (bounded exception).** The hook JSON wire is a legacy external contract (§2B.1). Conversion is allowed **only** in this hook-adapter function, and the neutral `IContent[]` is what re-enters the loop. Must not leak the Gemini shape past the adapter. |
| G4 | `core/streamRequestHelpers.ts:281` | `logOutgoingRequest(...)` → `logApiRequest(runtimeContext, state, toGeminiContents(requestPayload.contents), ...)` | **Telemetry boundary → delete conversion.** `logApiRequest` (`turnLogging.ts:63-70`) only calls `getRequestTextFromContents(contents)` to extract text. Retype `turnLogging.ts` to accept `IContent[]` and extract text neutrally; the `toGeminiContents` call vanishes. |
| G5 | `core/TurnProcessor.ts:457` | `logApiRequest(this.runtimeContext, state, toGeminiContents(iContents), ...)` | **Telemetry boundary → delete conversion** (same as G4). |
| G6 | `core/TurnProcessor.ts:747` | `_recordAfcHistory`: `const index = toGeminiContents(curatedHistory).length` (used purely for a slice offset) | **Internal — delete conversion.** The Gemini array is discarded; only `.length` is used. Replace with `this.historyService.getCurated().length` (neutral count); no Gemini envelope needed. |
| G7 | `core/DirectMessageProcessor.ts:178` | non-streaming path: `requestContents = toGeminiContents(userIContents)` then `logApiRequest(...)` telemetry | **Telemetry boundary → delete conversion** (same as G4). |

**Disposition summary for `toGeminiContents`:** 2 contract-surface migrations (G1, G2 — vanish with §4), 1 bounded hook-wire exception (G3), 4 telemetry/internal deletions (G4, G5, G6, G7). **Target: zero `toGeminiContents` calls in agents production except the single G3 hook-adapter, which must be evaluated against OQ‑1a below.**

### 2A.3 `toIContent(s)` (Gemini → neutral) call sites under `packages/agents/src` production

These convert Gemini-shaped/legacy input **into** neutral `IContent`. They are the inbound normalization boundary and are largely legitimate — but each must be checked so that the *source* of the Gemini-shaped input is either genuinely external (public contract, hook return, AFC provider metadata) or itself migrated to neutral. Verified sites:

- `core/ConversationManager.ts:110,133,212,231,243,362,439,452` — normalize contract/legacy `Content` input into `IContent` for the history service (public `addHistory`/`setHistory`/pending-content ingestion). **Legitimate inbound** while the contract input is still Gemini-shaped; migrates to no-op once §4 makes the surface `IContent`.
- `core/ChatSessionFactory.ts:183` — ingest initial history (`Content → IContent`). **Legitimate inbound**, migrates with §4.
- `core/streamRequestHelpers.ts:67,76` and `core/DirectMessageProcessor.ts:233,239` — convert the incoming user message (`PartListUnion`/legacy) to `IContent`. **Becomes the `AgentMessageInput` → `IContent` conversion** (§5.3-1); source shape migrates to neutral.
- `core/streamRequestHelpers.ts:239` — convert **hook-returned** modified messages back to `IContent`. **Bounded hook-wire boundary** (pairs with G3).
- `core/TurnProcessor.ts:320,757,775,808,827` — convert AFC-history `Content[]` (carried in provider metadata) back to `IContent` for recording. **Ties to AFC neutralization** (§5.3-3, OQ-2); source is provider-metadata `automaticFunctionCallingHistory` (still `Content[]`).
- `core/DirectMessageProcessor.ts:367,784` and `core/StreamProcessor.ts:698` — convert **hook-filtered** synthetic-response content back to `IContent` after AfterModel filtering. **Disappears with the synthetic-response elimination** (the AfterModel hook path is retyped onto neutral blocks; §2B.2).
- `core/clientLlmUtilities.ts:143`, `core/baseLlmClient.ts:124,337` — convert caller-supplied `Content[]`/legacy input to `IContent` in the stateless LLM helper surface. **Legitimate inbound**, source migrates with the helper signatures (`generateJson`/`generateContent`).
- `api/control/sessionControl.ts:218,314` — convert public session-control history input (`Content[]`) to `IContent`. **Public-API inbound boundary**; migrates with the public API surface (§4).

> **Named structural types.** No agents production file references `GeminiContent` / `GeminiContentPart` / `GeminiFunctionCall` *by name* (verified: `grep -rn "GeminiContent\b\|GeminiContentPart\|GeminiFunctionCall" packages/agents/src` excluding tests ⇒ **0 hits**). The structural Gemini shape enters agents through **three** channels, not two: (a) `@google/genai`'s own `Content`/`Part` (the §3 raw importers); (b) the `ContentConverters.toGeminiContent(s)` return values catalogued above; and (c) **anonymous structural `{role,parts}`/`{candidates}` object literals and generic `.parts` mutators** — some with **no raw SDK import at all** (e.g. `executor-prompt-builder.ts`, §2A.4-I(e)). The gate (§8) therefore keys on the converter *call expressions*, on any future import of the barrel-exported `GeminiContent*` names, **and** on the structural literal/mutator patterns (§8 check (f)) — not just the raw SDK specifier.

### 2A.4 Anonymous structural Google-envelope surface — construction AND access/mutation

This section inventories the structural Google-envelope surface that a #2424-proof gate (§8) must cover. It is split into **two** parts because a planner needs both: **(I) literal construction sites** — where `{role,parts}`/`{candidates}` envelopes are *built* (§2A.4-I below), and **(II) structural payload access/mutation sites** — where existing code *reads or mutates* `.parts`, `candidate.content`, `automaticFunctionCallingHistory`, or Google-named usage keys and therefore semantically depends on the Google shape (§2A.4-II). A full production sweep (`grep -rn "candidates:\s*\[" | grep -rn "role:\s*'model'\|role:\s*'user'\|parts:"` under `packages/agents/src`, excluding `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*`) shows many production `{ role, parts }` and `{ candidates: … }` constructions outside `MessageConverter`, several in files that *do not import `@google/genai`* (e.g. `executor-prompt-builder.ts`). The gate (§8) would catch most of the access/mutation sites in Part II via its `.parts`/usage-key checks; they are inventoried here so their dispositions are explicit rather than left to gate prose.

## 2A.4-I — Literal envelope construction sites

Disposition legend: **[contract-vanish]** disappears when the client contract / synthetic round-trip is neutralized (no standalone structural literal remains); **[wire-adapter]** stays only as a bounded external-wire adapter (hook JSON) confined to one function; **[retype→neutral]** the literal must be retyped so it constructs/mutates `IContent`/`ContentBlock[]` rather than Gemini `{role,parts}`/`{candidates}`.

#### (a) Synthetic *response envelopes* — `{ candidates: [{ content: { role, parts } }] }`

| Site (`file:line`) | Construction | Disposition |
|--------------------|--------------|-------------|
| `core/MessageConverter.ts:518-543` (`convertIContentToResponse`) | `{ candidates:[{content:{role:'model',parts}}], get text(), functionCalls, executableCode:undefined, codeExecutionResult:undefined }` | **[contract-vanish]** DELETE — the streaming/direct round-trip's synthetic fabricator (§3.2 #5, §9.1-3). |
| `core/DirectMessageProcessor.ts:684-699` (`_buildBlockingSyntheticResponse`) | blocking BeforeModel result: `beforeModelResult.getSyntheticResponse() as GenerateContentResponse` **OR** inline `{ candidates:[{content:{role:'model',parts:[{text}]}}] }` | **[contract-vanish]** DELETE — a blocking BeforeModel hook must instead yield a neutral `ModelOutput` (or neutral hook result) carrying the same text/reason (§2B.2). The streaming counterpart at `beforeModelHookDecision.ts:54-76` (§3.2 #20) casts the same synthetic response. |
| `core/streamRequestHelpers.ts:162-169` (`patchMissingFinishReason`) | `{ ...syntheticResponse, candidates:[{ ...candidate, finishReason: FinishReason.STOP }] }` (runtime `FinishReason` value) | **[contract-vanish]** — the "missing finish reason" patch operates on the synthetic response; once the pipeline carries `CanonicalFinishReason` on `ModelStreamChunk`, the default-to-STOP logic moves onto the neutral chunk and the `{candidates}` literal + runtime `FinishReason.STOP` disappear. |

#### (b) Legacy public/contract *`Content` construction* — `{ role: 'user'|'model', parts }` at contract/public seams

| Site (`file:line`) | Construction | Disposition |
|--------------------|--------------|-------------|
| `core/MessageConverter.ts:170-173` (`convertPartListUnionToIContent` builder path) | `{ role:'user' as const, parts }` fallback when the input is a part array | **[retype→neutral]** becomes construction of `IContent{speaker:'human', blocks}` via the neutral `AgentMessageInput → IContent` converter (§5.3-1, OQ-1b). |
| `core/baseLlmClient.ts:160-161`, `:287-288` | `{ role:'user', parts:[{text}] }` request wrappers in stateless LLM helpers | **[retype→neutral]** stateless-helper request build migrates to `IContent[]`/neutral request DTO (§4.2 `generateJson`/`generateContent`). |
| `core/baseLlmClient.ts:333-336` (systemInstruction extraction) | `{ role:'user', parts:[systemInstruction as Part] }` to text-extract a non-string `systemInstruction` | **[retype→neutral]** — depends on the systemInstruction compat decision (OQ-11): if the neutral contract narrows to `string`, this wrapper is deleted; if legacy `Part`/`Content` inputs remain accepted, the text-extraction is done on neutral blocks. |
| `core/client.ts:667-668` | `{ role:'user', parts:[{text: getDirectoryContextString(...)}] }` (directory-context injection) | **[retype→neutral]** construct `IContent{speaker:'human'}` directly. |
| `core/MessageStreamOrchestrator.ts:341-342` | `{ role:'user', parts:[{text: contextParts.join('
')}] }` (context injection) | **[retype→neutral]** as above. |

#### (c) History / write-path *`Content` construction* — `{ role, parts }` fed to history recording

| Site (`file:line`) | Construction | Disposition |
|--------------------|--------------|-------------|
| `core/streamResponseHelpers.ts:299-301` (`recordHistoryWithUsage`) | `const modelOutput: Content[] = [{ role:'model', parts: args.consolidatedParts }]` before `toIContent`→history | **[retype→neutral]** accumulate `ContentBlock[]` and record `IContent{speaker:'ai'}` directly (§3.2 #22). |
| `core/ConversationManager.ts:272-277` (`_recordOutputContent`) | `{ ...content, parts: parts.filter(!isThoughtPart) }` (thought filtering on `Content`) | **[retype→neutral]** filter `ContentBlock[]` (drop `ThinkingBlock` by config) on `IContent` (§3.2 #13). |
| `core/ConversationManager.ts:306`, `:310` | `{ role:'model', parts:[] } as Content` empty-model-output placeholders | **[retype→neutral]** empty `IContent{speaker:'ai', blocks:[]}`. |
| `core/TurnProcessor.ts:796-801` (`_recordOutputContent`) | `{ ...filteredOutputContent, parts: (…).filter(!isThoughtPart) }` thought-filter before `toIContent`→history | **[retype→neutral]** block-level thought filtering on `IContent` (§3.2 #7). |
| `core/TurnProcessor.ts:828` | `{ role:'model', parts:[] } as Content` empty-model placeholder before `toIContent`→history | **[retype→neutral]** empty `IContent{speaker:'ai'}`. |
| `core/agenticLoop/loopHelpers.ts:110-117` (`recordCancelledToolHistory`) | `agentClient.addHistory({ role:'model', parts: functionCalls })` and `{ role:'user', parts:[...functionResponses, ...otherParts] }` | **[retype→neutral]** — `addHistory` retypes to `IContent` (§4.2), so these become `IContent{speaker:'ai'|'tool'}` with `ToolCallBlock`/`ToolResponseBlock`; the `splitPartsByRole`/`convertBlocksToParts` round-trip is removed (§3.2 #44-46). |

#### (d) Hook fallback / restriction adapters — `{ role:'model', parts:[] }` fed to `filterHookRestrictedContent`/`toIContent`

| Site (`file:line`) | Construction | Disposition |
|--------------------|--------------|-------------|
| `core/StreamProcessor.ts:690-693` (`_processAfterModelHook`) | `convertIContentToResponse(iContent).candidates?.[0]?.content ?? { role:'model', parts:[] }` as arg to `filterHookRestrictedContent` | **[contract-vanish]** disappears with synthetic-response elimination; AfterModel filtering runs on `ContentBlock[]` from the neutral chunk (§2B.1). |
| `core/DirectMessageProcessor.ts:368-371` (`_applyHookRestrictedAllowedTools`/filter helper) | `filteredResponse.candidates?.[0]?.content ?? { role:'model', parts:[] }` → `toIContent` | **[contract-vanish]** same as above (direct path, §2B.2). |
| `core/DirectMessageProcessor.ts:775-779` (`_processDirectResponse` AfterModel) | `directResponse.candidates?.[0]?.content ?? { role:'model', parts:[] }` → `filterHookRestrictedContent` → `toIContent` | **[contract-vanish]** same as above. |
| `core/DirectMessageProcessor.ts:865-866` | `{ role:'model', parts:[] }` fallback content in direct-path finalization | **[contract-vanish]**/**[retype→neutral]** resolves to neutral empty `IContent` once the synthetic response is gone. |
| `core/hookToolRestrictions.ts:115-118`, `:189-191` | rebuilds `{ ...candidate.content, parts: filterHookRestrictedParts(parts, allowedTools) }` while cloning/filtering a `GenerateContentResponse` | **[contract-vanish]** NEUTRALIZE — the WeakMap/clone/parts-filter mechanism is replaced by explicit `HookRestrictions` on `ModelStreamChunk` + `ContentBlock[]`/`ToolCallBlock` filtering (§6.2, §3.2 #4). |

#### (e) Subagent / executor structural `{ role:'user', parts }` and generic `parts` mutation

| Site (`file:line`) | Construction | Imports `@google/genai`? | Disposition |
|--------------------|--------------|--------------------------|-------------|
| `core/subagentExecution.ts:165`, `:195` | `[{ role:'user', parts:[{text: nudge}] }]` (todo-reminder / output-nudge `Content[]`) | yes (#28) | **[retype→neutral]** subagent turn input becomes `AgentMessageInput`/`IContent` (§3.2 #28). |
| `core/subagentToolProcessing.ts:484`, `:514` | `[{ role:'user', parts: toolResponseParts }]` (tool-response `Content[]`) | yes (#31) | **[retype→neutral]** tool responses become `IContent{speaker:'tool'}` / `ToolResponseBlock[]`. |
| `core/subagent.ts:378-379`, `:686` | `{ role:'user', parts:[{text: initialInstruction}] }` and `[{ role:'user', parts: responseParts }]` | yes (#27) | **[retype→neutral]** subagent request/response construction on neutral blocks. |
| `agents/executor.ts:224-225` | `{ role:'user', parts:[{text: query}] }` initial executor message | yes (#33) | **[retype→neutral]** executor initial message → `AgentMessageInput`/`IContent`. |
| `agents/recovery.ts:117-120` | `{ role:'user', parts:[{text: prefix+suffix}] }` recovery nudge message | yes (#36) | **[retype→neutral]** recovery message → neutral. |
| `agents/executor-tool-dispatch.ts:513` | `nextMessage: { role:'user', parts: toolResponseParts }` (tool-response feed) | yes (#35) | **[retype→neutral]** tool-response feed → `IContent{speaker:'tool'}`/`ToolResponseBlock[]`. |
| `agents/executor-prompt-builder.ts:47-58` | **generic structural** `applyTemplateToInitialMessages<T extends { parts?: Array<{text?}\|object> }>` mutating `content.parts` and returning `{ ...content, parts: newParts }` — **NO raw `@google/genai` import** | **no** | **[retype→neutral]** — this is the pure #2424-structural case: a Gemini-shaped `{parts}` mutator with zero SDK provenance. It must be retyped to operate on `IContent`/`ContentBlock[]` (or, if it is deemed a legacy external adapter for the initial-messages wire, explicitly bounded — **OQ-12**). The gate (§8 check (f)/(g)) must catch generic `parts` mutation like this, not only `role`-bearing literals. |

**Construction-site summary (Part I).** The literal-construction surface spans: 3 synthetic-response `{candidates}` fabricators (a); 5 contract/public `{role,parts}` builders (b); 6 history/write-path `Content` builders (c); 5 hook fallback/restriction adapters (d); and 7 subagent/executor structural sites — **one of which (`executor-prompt-builder.ts`) has no raw SDK import at all** (e). §8 and §9.1 account for this entire construction surface, not just `MessageConverter` + two fallbacks.

## 2A.4-II — Structural payload access/mutation sites (read/mutate the Google shape)

Distinct from the literal builders in Part I, these sites **read or mutate** an existing Google-shaped payload (`.parts`, `candidate.content`, `automaticFunctionCallingHistory`, or Google-named usage keys). They semantically depend on the Gemini envelope even where they construct nothing. Each must be retyped onto neutral `IContent`/`ContentBlock[]`/`UsageStats` or removed with the synthetic round-trip. Neutral types never expose `.parts` (only `.blocks`) or Google usage keys, so every site below is a structural-Gemini signal the §8 gate flags via checks (f)/(h). This inventory is the full production `.parts`/`candidate.content`/usage-key access surface under `packages/agents/src` (verified by sweeping `candidates?.[0]`, `.candidates?.find`, `content?.parts`, `content.parts`, `.parts?.`, `.parts ??`, `.role === 'model'`/`'user'`, and the Google usage keys, excluding `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*` and neutral `.blocks` access). Sites covered by a whole-file DELETE disposition (e.g. `streamChunkWrapper.responseToIContent`) are included and annotated as such rather than omitted.

#### (f) `.parts` / `candidate.content` readers & mutators

| Site (`file:line`) | Access / mutation | Disposition |
|--------------------|-------------------|-------------|
| `core/client.ts:437-450` (`setHistory`, `stripThoughts`) | reads and **mutates** `newContent.parts` to strip `thoughtSignature` from each part | **[retype→neutral]** operate on `ContentBlock[]` (drop `ThinkingBlock.signature`) on `IContent`; the `.parts` map/delete disappears with the contract retype (§4.2). |
| `core/clientHelpers.ts:42-45`, `:66` | reads `content.parts?.some(... functionResponse / functionCall ...)` to find compress-split points; `:66` reads `content?.parts` for a no-function-call test | **[retype→neutral]** derive tool-call/response presence from `ContentBlock` types (`ToolCallBlock`/`ToolResponseBlock`) on `IContent`. |
| `core/clientLlmUtilities.ts:61-70` | extracts prompt text by mapping `c.parts` → `p.text` over `Content[]` in the stateless `next_speaker` helper | **[retype→neutral]** extract text from `ContentBlock[]` (`TextBlock.text`) on neutral `IContent[]`; ties to the stateless-helper contract decision (OQ-3s). |
| `core/clientLlmUtilities.ts:84-92` | reads `c.parts?.some((p) => p.text?.includes('next_speaker'))` for the `next_speaker` fallback test | **[retype→neutral]** test `TextBlock` text on neutral `IContent[]`; same helper-contract decision (OQ-3s). |
| `core/ConversationManager.ts:34-40` (`appendTextContentParts`) | **mutates** `lastParts[0].text` and pushes `content.parts` slices to merge adjacent text `Content` | **[retype→neutral]** consolidate adjacent `TextBlock`s on `IContent`/`ContentBlock[]`; the `.parts` mutation is removed (§3.2 #13 note, §7 contract 12). |
| `core/ConversationManager.ts:330-345` (`_consolidateModelOutput`) | iterates `Content[]`, using `hasTextContent` (`MessageConverter.ts:320-333`, reads `content.parts[0].text`) + `appendTextContentParts` to merge model output | **[retype→neutral]** consolidate on `ContentBlock[]`; `hasTextContent` becomes a `TextBlock`-based test (§3.2 #13 note, §7 contract 12). |
| `core/ConversationManager.ts:272-277`, `:282` | thought-filter mutation `parts: (content.parts ?? []).filter(!isThoughtPart)` (`:275`) and thought-extraction read `.flatMap((content) => content.parts ?? [])` (`:282`) in `_recordOutputContent` | **[retype→neutral]** filter/extract `ThinkingBlock`s on `IContent`/`ContentBlock[]` (also §2A.4-I(c), §3.2 #13). |
| `core/DirectMessageProcessor.ts:855-880` (`_ensureResponseText`) | reads `candidate.content?.parts` (`:859`), falls back to creating `candidate.content = { role:'model', parts:[] }` (`:864-867`), then **mutates** `candidate.content.parts` to append text (`:868-871`) | **[contract-vanish]** the whole synthetic-response finalization is removed; the "ensure non-empty text" step moves onto neutral `ContentBlock[]`/`ModelOutput`. |
| `core/DirectMessageProcessor.ts:894-899` (`_extractResponseText`) | reads `response.candidates?.[0]?.content?.parts` via `getResponseTextFromParts(...)` to extract visible text (distinct extractor from `_ensureResponseText`) | **[contract-vanish]**/**[retype→neutral]** direct-path visible-text extraction moves to `ContentBlock[]`/`ModelOutput` text (block-based `getResponseTextFromBlocks`); disappears with the synthetic response. |
| `core/MessageStreamOrchestrator.ts:333` | reads `lastMessage.parts?.some((p) => 'functionCall' in p)` to detect a pending tool call before IDE-context injection | **[retype→neutral]** detect pending tool call from `ToolCallBlock` presence on the neutral last `IContent` (history is `IContent[]` after §4.2). |
| `core/subagent.ts:563` | reads `currentMessages[0]?.parts` to feed `turn.run(parts, ...)` | **[retype→neutral]** subagent turn input becomes `AgentMessageInput`/`IContent`; `turn.run` takes the neutral request DTO (§5.3-1). |
| `core/subagentNonInteractive.ts:365` | reads `currentMessages[0]?.parts` into `messageParams.message` | **[retype→neutral]** as above. |
| `agents/executor-stream-processor.ts:74` | reads `message.parts` into `messageParams.message` | **[retype→neutral]** executor message input → neutral request DTO. |
| `core/MessageConverter.ts:242-254` (`isValidContent`) | reads `content.parts` (length + per-`part` `thought`/`text`) to validate a `Content`; reached from `extractCuratedHistory`/`collectModelRun` | **[retype→neutral]** validity test moves onto `ContentBlock[]` (`IContent`); the `.parts` iteration is removed. Ties to the `MessageConverter` split (OQ-5). |
| `core/MessageConverter.ts:272-314` (`extractCuratedHistory`) + `collectModelRun` | iterates `Content[]` by `role` (`comprehensiveHistory[i].role === 'user'`/`'model'`) and validates `parts` via `isValidContent`; called on AFC history at `ConversationManager.ts:207` | **[retype→neutral]** curated-history extraction operates on `IContent[]` by `speaker` (`getCurated()` is already `IContent`-based); the Google-shaped variant is deleted or retyped onto neutral. |
| `core/MessageConverter.ts:320-333` (`hasTextContent`) | reads `content.role` and `content.parts[0].text` to test for leading text (own access site; also a dependency of `ConversationManager._consolidateModelOutput`) | **[retype→neutral]** becomes a `TextBlock`-based leading-text test on `IContent` (§3.2 #13, §7 contract 12). |
| `core/streamResponseHelpers.ts:101-108` (`accumulateChunkMetadata`) | reads `chunk.candidates?.find((c) => c.finishReason !== undefined)` (`:101-104`) and `chunk.candidates?.[0]?.content?.parts ?? []` (`:108`) to accumulate finish reason + parts | **[retype→neutral]** accumulate `CanonicalFinishReason` and `ContentBlock[]` from the neutral chunk (§3.2 #22); the `candidates`/`.parts` reads disappear. |
| `core/TurnProcessor.ts:798-803` (`_recordOutputContent`) | reads and **reconstructs** `filteredOutputContent.parts` (`:798`), filters thought parts, then gates on `contentForHistory.parts?.length` (`:803`) before recording | **[retype→neutral]** block-level thought filter + non-empty check on `IContent`/`ContentBlock[]` (paired with the §2A.4-I(c) construction row at `:796-801`; both the build and the read/gate move onto neutral blocks). |
| `core/hookToolRestrictions.ts:184-192` (`filterHookRestrictedContent`) | reads `content.parts ?? []` and returns `{ ...content, parts: filterHookRestrictedParts(...) }` — the top-level content mutator (distinct from the `:115-133` clone branch in (g)) | **[contract-vanish]** the parts-filter mechanism is replaced by explicit `HookRestrictions` + `ContentBlock[]`/`ToolCallBlock` filtering (§6.2, §3.2 #4). |
| `core/streamChunkWrapper.ts:77-83` (`responseToIContent`) | reads `resp.candidates?.[0]` (`:80`), `candidate?.content?.parts` (`:81`), `candidate?.content?.role` (`:82`) to reconstruct `IContent` from the synthetic response | **[contract-vanish]** — covered by the whole-file **DELETE** disposition (§3.2 #1): the reconstruction vanishes because the synthetic response is never manufactured; `toModelStreamChunk(iContent)` sources the chunk directly. |

#### (g) AFC / content length filters — `(content.parts?.length ?? 0) > 0` and `automaticFunctionCallingHistory`

| Site (`file:line`) | Access | Disposition |
|--------------------|--------|-------------|
| `core/TurnProcessor.ts:728` | filters AFC history by `(content.parts?.length ?? 0) > 0` after `filterHookRestrictedContents` | **[retype→neutral]** filter neutral AFC (`IContent[]`) by block count once AFC is neutralized (§5.3-3, OQ-2/OQ-15). |
| `core/DirectMessageProcessor.ts:386`, `:764` | same `(content.parts?.length ?? 0) > 0` filter on `automaticFunctionCallingHistory` (both hook-restriction paths) | **[retype→neutral]** as above (direct path). |
| `core/hookToolRestrictions.ts:133` | same `(content.parts?.length ?? 0) > 0` filter while rebuilding filtered AFC on a cloned `GenerateContentResponse` | **[contract-vanish]** the clone/parts-filter mechanism is replaced by neutral `HookRestrictions` + block filtering (§6.2). |

#### (h) Internal Google-named usage-metadata keys — `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`

| Site (`file:line`) | Access | Disposition |
|--------------------|--------|-------------|
| `core/TurnProcessor.ts:844-850` (`_syncTokenCounts`) | reads `response.usageMetadata.promptTokenCount` to `syncTotalTokens` (with a `lastPromptTokenCount` fallback when absent) | **[retype→neutral]** read `UsageStats.promptTokens` from the neutral chunk/`ModelOutput.usage` or `IContent.metadata.usage`, preserving the absent-usage fallback (OQ-2t). |
| `core/streamResponseHelpers.ts:149-151` | reads `chunk.usageMetadata.promptTokenCount` to set `compressionHandler.lastPromptTokenCount` | **[retype→neutral]** as above, from the neutral chunk's `usage`. |
| `core/streamResponseHelpers.ts:308-314` | reads `usageMetadata.promptTokenCount`/`candidatesTokenCount`/`totalTokenCount` from the last chunk to build streaming usage | **[retype→neutral]** accumulate neutral `UsageStats` (`promptTokens`/`completionTokens`/`totalTokens`). |
| `core/MessageConverter.ts:651-662` | **constructs** a Gemini-shaped `usageMetadata` (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount` + cache keys) inside `convertIContentToResponse` | **[contract-vanish]** disappears with the synthetic fabricator; usage rides `IContent.metadata.usage` / `ModelOutput.usage`. |
| `core/turnLogging.ts:85-104` (`logApiResponse`) | accepts `usageMetadata?: GenerateContentResponseUsageMetadata` (`:12-16` import) and spreads Gemini-named usage (`{ ...usageMetadata }`) into telemetry (`:101-102`); callers pass the synthetic response's Gemini-named usage (`TurnProcessor.ts:407-415`, `StreamProcessor.ts:745-753`, `DirectMessageProcessor.ts:198-206`) | **[retype→neutral]** `logApiResponse` accepts neutral `UsageStats` (or a documented telemetry wire DTO). If telemetry deliberately keeps Gemini-named keys for downstream consumers, that is a **bounded telemetry-serialization exception** confined to `turnLogging.ts` and covered by the §8(h) usage-metadata gate — converted from neutral `UsageStats` at that edge, banned everywhere else (§7A telemetry note, OQ-3t). |

These usage-key sites also inform the public-event decision in §7A (the Gemini-named `ServerUsageMetadataEvent`/API `UsageMetadataValue` must not silently re-enter the internal loop; §8 gate check (h)). The `turnLogging.ts` row is the telemetry-serialization surface where Gemini-named usage can persist even after a raw-import swap.

**Access/mutation summary (Part II).** The read/mutate surface spans: **20 `.parts`/`candidate.content` reader/mutator sites** (f) — `client.ts`, `clientHelpers.ts`, `clientLlmUtilities.ts` (×2), `ConversationManager.ts` (×3: the `appendTextContentParts` merge, `_consolidateModelOutput`, and the `_recordOutputContent` thought filter/extract), `DirectMessageProcessor.ts` (×2: `_ensureResponseText`, `_extractResponseText`), `MessageStreamOrchestrator.ts`, `subagent.ts`, `subagentNonInteractive.ts`, `executor-stream-processor.ts`, `MessageConverter.ts` (×3: `isValidContent`, `extractCuratedHistory`+`collectModelRun`, `hasTextContent`), `streamResponseHelpers.accumulateChunkMetadata` (`:101-108`), `TurnProcessor._recordOutputContent` (`:798-803`), `hookToolRestrictions.filterHookRestrictedContent` (`:184-192`), and `streamChunkWrapper.responseToIContent` (`:77-83`, covered by the whole-file DELETE per §3.2 #1); **4 AFC/content-length filter sites** (g) — `TurnProcessor.ts:728`, `DirectMessageProcessor.ts:386`/`:764`, `hookToolRestrictions.ts:133`; and **5 internal Google-named usage-key sites** (h) — `TurnProcessor.ts:844-850`, `streamResponseHelpers.ts:149-151`/`:308-314`, `MessageConverter.ts:651-662`, and the `turnLogging.ts:85-104` telemetry-serialization surface. This is the complete production `.parts`/`candidate.content`/usage-key access surface (verified by sweeping `candidates?.[0]`, `.candidates?.find`, `content?.parts`, `.parts?.`, `.parts ??`, `content.parts`, `.role === 'model'`/`'user'`, and the Google usage keys, excluding `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*` and neutral `.blocks` access). §8 gate checks (f)/(g)/(h) and acceptance §9.1-2 cover this entire access/mutation surface; acceptance cannot pass while any of it remains (except the bounded telemetry exception if §7A/OQ-3t elects to keep Gemini-named telemetry keys confined to `turnLogging.ts`, and the DELETE-file `streamChunkWrapper.responseToIContent` site which vanishes with the file).

## 2B. Hook-Boundary & Non-Streaming (Direct-Message) Data Flows

> **Scope of this section.** "Hook JSON wire compatibility" is a recurring constraint, so this section maps it to the concrete Gemini-shaped payloads that force conversions, and details the non-streaming `DirectMessageProcessor` path (which *also* fabricates responses, filters hook-restricted tools, carries AFC in provider metadata, and returns a Gemini-shaped response). Both are mapped here so the plan can decide, per boundary, whether the Gemini shape stays a legacy external wire contract (with conversion confined to a named adapter) or migrates to neutral DTOs.

### 2B.1 Hook-boundary inventory

| Hook boundary | Current Gemini-shaped payload | Evidence | Target disposition |
|---------------|-------------------------------|----------|--------------------|
| **Before-model request modification** | `applyLLMRequestModifications(target)` takes/returns `{ contents?: Content[] }`; agents builds `target.contents = toGeminiContents(requestContents)` and converts the result back via `toIContents(modifiedContents)` | `streamRequestHelpers.ts:226-239` | **Legacy external wire** — hook JSON `llm_request.messages` stays Gemini-shaped for byte compatibility. Conversion confined to this one adapter (G3); the loop re-enters neutral `IContent[]`. **OQ‑1a:** confirm the hook wire truly requires the Gemini `{role,parts}` message shape vs. a neutral messages shape. |
| **Before-model *blocking* synthetic response** | Two sites fire **before any provider output** when a BeforeModel hook blocks: **(non-streaming)** `_buildBlockingSyntheticResponse(beforeModelResult): GenerateContentResponse` returns `beforeModelResult.getSyntheticResponse() as GenerateContentResponse` **OR** inline `{ candidates:[{ content:{ role:'model', parts:[{ text: reason }] } }] }`; **(streaming)** `enforceBeforeModelHookDecision` casts `getSyntheticResponse() as GenerateContentResponse`, reads `candidate.finishReason`, patches missing finish reason via `patchFinishReason`, and throws `AgentExecutionBlockedError` carrying the synthetic response through `attachHookRestrictedAllowedTools` | `DirectMessageProcessor.ts:677-701` (non-streaming); `beforeModelHookDecision.ts:54-76` (streaming) | **Neutralize** — a blocking BeforeModel hook must yield/return a neutral `ModelOutput` (or neutral hook result) carrying the same text/reason semantics, **not** a `GenerateContentResponse` cast or an inline candidate envelope (§2B.2, §3.2 #20). **OQ‑1c:** exact neutral result replacing `BeforeModelHookOutput.getSyntheticResponse()` — legacy wire converted at the boundary vs. hooks must produce neutral output. |
| **After-model response modification (streaming)** | `_processAfterModelHook` builds `filterHookRestrictedContent(convertIContentToResponse(iContent).candidates?.[0]?.content ?? {role:'model',parts:[]}, ...)` then `fireAfterModelEvent(llmRequest, toIContent(filteredContent))` | `StreamProcessor.ts:662-699` | **Neutralize** — filter on `ContentBlock[]` from the neutral chunk; the synthetic `convertIContentToResponse` and the `{role:'model',parts}` fallback are deleted. Hook still receives/returns its JSON wire shape via a boundary adapter, not an internal response. |
| **After-model response modification (non-streaming)** | `_processDirectResponse` builds `directResponse = _applyHookRestrictedAllowedTools(convertIContentToResponse(lastResponse), ...)`, then filters `directResponse.candidates?.[0]?.content` and calls `fireAfterModelEvent(llmRequest, toIContent(filteredContent))` | `DirectMessageProcessor.ts:744-795` | **Neutralize** (same principle as streaming) — operate on `IContent`/`ContentBlock[]`; delete the synthetic response. |
| **Before-tool-selection tool config** | hook-restricted `allowedFunctionNames` filter tool calls out of `candidates[].content.parts[]`, `functionCalls`, and `automaticFunctionCallingHistory` | `hookToolRestrictions.ts` (`attachHookRestrictedAllowedTools`); consumed in `StreamProcessor`/`TurnProcessor`/`turn.ts` | **Neutralize** — filtering moves to `ContentBlock[]`/`ToolCallBlock` (`turn.filterBlocksByAllowedTools` already block-based); restriction metadata rides `ModelStreamChunk.hookRestrictions` (§6.2). Tool-selection hook JSON wire unchanged. |
| **Event / API serialization** | `ServerUsageMetadataEvent` + API `UsageMetadataValue`/`FinishedValue.usageMetadata` are Gemini-named (`promptTokenCount`…) | `packages/core/src/core/turn.ts:221-228` (the event is **core-owned**, NOT `packages/agents/src/core/turn.ts`); `packages/agents/src/api/event-types.ts:32-41`; `event-schema.ts:30-39` | **Public-contract decision required** — see §2B.3 / §7A. |

### 2B.2 Direct-message (non-streaming) round-trip

The non-streaming `DirectMessageProcessor.generateDirectMessage` path is a **second** self-inflicted round-trip that the streaming diagrams (§2.3/§2.4) do not cover. Its Gemini-shaped touchpoints:

1. **Request build + telemetry:** `userIContents` (neutral) → `toGeminiContents(...)` → `logApiRequest(...)` (`DirectMessageProcessor.ts:178`, G7). *(Telemetry boundary — delete conversion, §2A.2.)*
2. **AFC extraction:** `getIContentAutomaticFunctionCallingHistory(content)` reads `automaticFunctionCallingHistory` from either a top-level field or `content.metadata.providerMetadata['automaticFunctionCallingHistory']`, typed `Content[]` (`DirectMessageProcessor.ts:99-110`). *(Ties to AFC neutralization, §5.3-3 / OQ-2.)*
3. **Blocking BeforeModel synthetic response (fired BEFORE any provider output):** when a BeforeModel hook blocks, `_buildBlockingSyntheticResponse(beforeModelResult)` returns either `beforeModelResult.getSyntheticResponse()` **cast** as `GenerateContentResponse`, or an inline `{ candidates:[{ content:{ role:'model', parts:[{ text: reason }] } }] }` (`DirectMessageProcessor.ts:677-701`). This is **production behavior on the block path**, distinct from the after-model `_processDirectResponse` fabrication below. *(Synthetic-response elimination, §2A.4-I(a)/(d); the block path must return a neutral `ModelOutput`/hook result carrying the same text/reason — OQ‑1c.)*
4. **After-model synthetic response fabrication + hook restriction:** `_processDirectResponse` builds a `GenerateContentResponse` via `convertIContentToResponse(lastResponse)`, applies hook-restricted allowed tools, copies filtered `automaticFunctionCallingHistory` onto the synthetic response, and runs the AfterModel hook on it (`DirectMessageProcessor.ts:744-795`). *(Synthetic-response elimination + neutral hook filtering, §2B.1.)*
5. **Return shape:** `TurnProcessor.sendMessage(...)` still returns `Promise<GenerateContentResponse>` (`TurnProcessor.ts:130-150`) and `AgentClientContract.generateDirectMessage(...)` returns `ContractGenerateContentResponse` (§4.2).

So the direct path fabricates a `GenerateContentResponse` at **two** distinct sites: the pre-provider **blocking** path (`_buildBlockingSyntheticResponse`, `:677-701`) and the post-provider **after-model** path (`convertIContentToResponse`, `:744-753`).

**Target neutral output:** the direct path returns **`ModelOutput`** (neutral) on **both** the blocking and the normal path. `sendMessage`/`generateDirectMessage` signatures retype to `Promise<ModelOutput>` (contract migration §4.2), AFC rides the neutral AFC slot (OQ-2), and hook restriction/filtering operate on `ContentBlock[]`. No `GenerateContentResponse` is fabricated on the direct path — neither at the blocking BeforeModel site nor at the after-model site.

### 2B.3 Public event usage-metadata (Gemini-named) — see §7A

`ServerUsageMetadataEvent` (`packages/core/src/core/turn.ts:221-228` — **core-owned**, not `packages/agents/src/core/turn.ts`, whose 221-228 is unrelated constructor/debug code) and the API adapter's `UsageMetadataValue`/`FinishedValue` (`packages/agents/src/api/event-types.ts:32-41`, `event-schema.ts:30-39`) remain Gemini-named by field. This is a **public-contract** decision, broken out in §7A and folded into acceptance (§9.1) so that "zero Google-shaped types in agents" does not silently exempt a Google-named public event that the CLI consumes.

## 3. Complete File Inventory — Production Importers of `@google/genai`

**Measured count (verified):** `grep -rl "@google/genai" packages/agents/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__"` ⇒ **46 production files**. Total importers (prod + test) = **100**; test-only = **54**.

`sdkTypeBridge.ts` (the vehicle of the rejected PR #2424) does **not** exist in the tree (`ls packages/agents/src/core/sdkTypeBridge.ts` ⇒ not found) — confirming #2424 was closed/reverted.

### 3.1 Disposition categories

- **DELETE** — file exists *only* to service the synthetic round-trip; nothing neutral needs it.
- **NEUTRALIZE-IN-PLACE** — file must be renamed away from Google naming and retyped onto `ContentBlock`/`IContent`/neutral metadata (its *mechanism*, not just its type imports, is Google-shaped).
- **RETYPE** — swap Google/Contract-Google types for neutral ones; semantics unchanged. (The bulk.)

### 3.2 Production inventory table (46 files)

**Value-import vs type-only annotation (drives runtime-enum/class replacement risk).** Symbols are annotated **(value)** when imported as a runtime binding (`import { X }` — the value exists at runtime and its use cannot be erased by a pure type-swap) and left unannotated when they are type-only (`import type { X }` or an inline `type X` specifier — erased at compile time). The complete set of runtime **(value)** imports across all 46 production files is: `Type` (`agents/executor-tool-dispatch.ts:19`, `core/subagentRuntimeSetup.ts:25-30` — where `Type` is the only runtime binding in that import clause; `Content`/`FunctionDeclaration`/`GenerateContentConfig` are erased `type` imports), `FinishReason` (`core/MessageConverter.ts`, `core/streamRequestHelpers.ts:20`, `core/streamResponseHelpers.ts:17`), `createUserContent` (`core/MessageConverter.ts`), and `ApiError` (`core/DirectMessageProcessor.ts`, `core/TurnProcessor.ts`, `core/schemaDepthErrorEnrichment.ts`). Every other imported Google symbol in the table is type-only. Only the **(value)** imports require runtime replacements (enum → string literals / `CanonicalFinishReason`, `ApiError` → `isProviderApiError`, `createUserContent` → neutral builder); type-only imports are pure retypes.

| # | File | Google symbols imported | Role in pipeline | Disposition |
|---|------|------------------------|------------------|-------------|
| 1 | `core/streamChunkWrapper.ts` | `GenerateContentResponse` | Converts synthetic response → `ModelStreamChunk` at yield boundary; `chunkToParts` converts back to `Part[]` for Turn | **DELETE** (boundary vanishes; `toModelStreamChunk(iContent)` already exists in core) |
| 2 | `core/providerStopReason.ts` | `Candidate` | Side-channel field on Candidate for raw stop reason | **DELETE** (→ `ModelStreamChunk.rawStopReason` from `IContent.metadata.stopReason`) |
| 3 | `core/googlePartHelpers.ts` | `Part`, `FunctionCall`, `GenerateContentResponseUsageMetadata` | `Part[]`-based helpers: `getFunctionCallsFromParts`, `getResponseTextFromParts`, `analyzeResponseOutcomeFromParts`, `isThoughtPart`, `UsageMetadataWithCache`, `ThoughtPart` | **NEUTRALIZE-IN-PLACE** (rename; retype onto `ContentBlock[]`/`ToolCallBlock`; core already has `getToolCallBlocks`/block-based equivalents per `@issue #2348` notes in-file) |
| 4 | `core/hookToolRestrictions.ts` | `Content`, `FunctionCall`, `GenerateContentResponse`, `Part` | WeakMap/Symbol identity side-channel for hook tool restrictions | **NEUTRALIZE-IN-PLACE** (explicit `HookRestrictions` on chunk + `ContentBlock`/`ToolCallBlock` filtering; drop WeakMaps) |
| 5 | `core/MessageConverter.ts` | `GenerateContentResponse`, `Content`, `Part`, `createUserContent` (value), `PartListUnion`, `FinishReason` (value) | IContent↔Part translation **and** `convertIContentToResponse` (the synthetic fabricator) + `applyResponseMetadata`/`applyFinishReasonMapping` | **NEUTRALIZE-IN-PLACE**: `convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `isValidResponse`, `createUserContentWithFunctionResponseFix` **DELETED**; remaining `IContent`↔neutral-block/DTO conversion retyped |
| 6 | `core/StreamProcessor.ts` | `GenerateContentResponse`, `Content`, `SendMessageParameters`, `Part`, `FinishReason` (type), `GenerateContentConfig` | Core streaming engine: retry, hooks, accumulation, history commit | **RETYPE** (drop `convertIContentToResponse`; accumulate `ContentBlock[]`/`CanonicalFinishReason`; request DTO neutral) |
| 7 | `core/TurnProcessor.ts` | `GenerateContentResponse`, `Content`, `GenerateContentConfig`, `SendMessageParameters`, `ApiError` (value) | Turn-level send/sendStream orchestration, AFC history commit, `wrapChunk` | **RETYPE** (yield `ModelStreamChunk`; AFC + output-content recording onto `IContent`; `ApiError` → neutral `ProviderApiError`/`isProviderApiError`) |
| 8 | `core/turn.ts` | `PartListUnion`, `FunctionCall` | Agentic Turn: consumes stream, emits `ServerAgentStreamEvent`; re-derives `Part[]` via `chunkToParts` | **RETYPE** (already largely block-based; drop `chunkToParts`/`FunctionCall`; `req: PartListUnion` → neutral request DTO) |
| 9 | `core/client.ts` | `GenerateContentResponse`, `GenerateContentConfig`, `PartListUnion`, `Content`, `Tool`, `SendMessageParameters` | `AgentClient` (implements `AgentClientContract`); method signatures | **RETYPE** (signatures follow migrated `AgentClientContract`; internal `generateContentConfig`→`ModelGenerationSettings`) |
| 10 | `core/clientHelpers.ts` | `PartListUnion`, `Part`, `Content` | Client helper utilities (compress split, thinking support) | **RETYPE** |
| 11 | `core/clientLlmUtilities.ts` | `GenerateContentConfig`, `Content` | `generateJson`/`generateContent`/`generateEmbedding` helpers | **RETYPE** |
| 12 | `core/clientToolGovernance.ts` | `FunctionDeclaration` | Builds tool declarations from tool view | **RETYPE** (→ `ToolDeclaration`) |
| 13 | `core/ConversationManager.ts` | `Content` | Conversation/pending-content bookkeeping **plus Google-shaped merge/consolidation logic**: `appendTextContentParts` mutates `.parts` (`:34-40`), `_consolidateModelOutput` merges adjacent-text `Content[]` (`:330-345`) via `hasTextContent` (`MessageConverter.ts:320-333`), and `_recordOutputContent` thought-filters/extracts `.parts` (`:272-282`); imports part helpers `isFunctionResponse`/`isThoughtPart`/`hasTextContent`/`validateHistory` (`:26-32`) that operate on the Google shape | **RETYPE (with block-level merge reimplementation — not a pure signature swap)** — beyond retyping signatures to `IContent`, the consolidation/merge behavior must be reimplemented on `ContentBlock[]`: consolidate adjacent `TextBlock`s (same merge boundaries), preserve thought-filter via `ThinkingBlock`, and remove all `.parts` mutation (see §2A.4-II(f), §7 contract 12). |
| 14 | `core/DirectMessageProcessor.ts` | `GenerateContentResponse` (type-only, `:7`), `Content`, `GenerateContentConfig`, `SendMessageParameters`, `PartListUnion`, `ApiError` (**value**, `:12`) | Non-streaming `generateDirectMessage` path — **fabricates a synthetic `GenerateContentResponse` at TWO sites: `_buildBlockingSyntheticResponse` (`:677-701`, pre-provider BeforeModel-block) and `convertIContentToResponse` (`:744-753`, post-provider after-model); filters hook-restricted tools, carries AFC in provider metadata, returns Google-shaped (see §2B.2). `GenerateContentResponse` is imported type-only (used for casts/annotations); only `ApiError` is a runtime value.** | **RETYPE** (return `ModelOutput` on both blocking and normal paths; drop `convertIContentToResponse` **and** `_buildBlockingSyntheticResponse`; AFC + hook filtering onto `IContent`/`ContentBlock[]`; `ApiError`→neutral) |
| 15 | `core/MessageStreamOrchestrator.ts` | `PartListUnion`, `Part`, `Content` | Orchestrates message-stream deps for `client.ts` | **RETYPE** |
| 16 | `core/MessageStreamTerminalHandler.ts` | `PartListUnion` | Terminal handling for message stream | **RETYPE** |
| 17 | `core/ChatSessionFactory.ts` | `Content`, `GenerateContentConfig`, `Tool` | Builds `ChatSession`, system instruction | **RETYPE** |
| 18 | `core/chatSession.ts` | `Content`, `GenerateContentConfig`, `GenerateContentResponse`, `SendMessageParameters`, `Tool`, `PartListUnion` | `ChatSession` facade (`sendMessageStream`, history) + re-exports `StreamEvent`/errors | **RETYPE** |
| 19 | `core/baseLlmClient.ts` | `Content`, `Part` | `BaseLLMClient` stateless utilities | **RETYPE** |
| 20 | `core/beforeModelHookDecision.ts` | `FinishReason` (type-only), `GenerateContentResponse` (type-only) — `import type { FinishReason, GenerateContentResponse } from '@google/genai'` (`:7`) | **Blocking BeforeModel synthetic-response decision point (streaming).** `enforceBeforeModelHookDecision` casts `getSyntheticResponse() as GenerateContentResponse` (`:54-56`), reads `candidate.finishReason` (`:59-63`), patches a missing finish reason via `patchFinishReason` (`:64-66`), and throws `AgentExecutionBlockedError` carrying the synthetic response via `attachHookRestrictedAllowedTools` (`:68-76`). Both symbols are type-only, but the file is a blocking-hook neutralization site, not merely a type importer (§2B.1, §2B.2). | **RETYPE** (decision logic onto neutral chunk/`CanonicalFinishReason`; the blocking hook must yield a neutral `ModelOutput`/hook result carrying the same text/reason instead of a `GenerateContentResponse` cast — pairs with `DirectMessageProcessor._buildBlockingSyntheticResponse` and `streamRequestHelpers.patchMissingFinishReason`; no runtime-enum replacement needed since `FinishReason` is used only as a type here) |
| 21 | `core/streamRequestHelpers.ts` | `Content` (type), `GenerateContentResponse` (type), `SendMessageParameters` (type) — `:15-19`; `FinishReason` (**value**) + `GenerateContentConfig` (type) — `:20` | Request build helpers; `patchMissingFinishReason` (`:162-169`) constructs `{ ...syntheticResponse, candidates:[{ ...candidate, finishReason: FinishReason.STOP }] }` using the runtime `FinishReason.STOP` enum value | **RETYPE** (default-to-STOP logic moves onto the neutral chunk's `CanonicalFinishReason`; the runtime `FinishReason.STOP` and the `{candidates}` literal disappear) |
| 22 | `core/streamResponseHelpers.ts` | `Content` (type), `GenerateContentResponse` (type), `Part` (type) — `:16`; `FinishReason` (**value**) — `:17` | Stream accumulator (`createStreamAccumulator`, `consolidateTextParts`, `recordHistoryWithUsage`, etc.). **Internal Google-named usage dependency:** reads `chunk.usageMetadata.promptTokenCount` (`:149-151`) and `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount` from the last chunk to build streaming usage (`:308-314`); also builds the `{ role:'model', parts }` history record (`:299-301`, §2A.4-I(c)) | **RETYPE** (accumulate `ContentBlock[]`/`CanonicalFinishReason`; usage from neutral `UsageStats` — §2A.4-II(h), OQ-2t) |
| 23 | `core/streamCleanup.ts` | `GenerateContentResponse` | `withCompressionCallbackCleanup` stream wrapper typing | **RETYPE** (generic over `ModelStreamChunk`) |
| 24 | `core/turnAbortHelpers.ts` | `SendMessageParameters` | `shouldRetryStreamAttempt` (abort/transient retry, #2150) | **RETYPE** (neutral request DTO param) |
| 25 | `core/turnLogging.ts` | `Content`, `GenerateContentConfig`, `GenerateContentResponseUsageMetadata` | API request/response/error telemetry logging — `logApiRequest` logs `Content[]` request text (`:63-70`); `logApiResponse` accepts and spreads Gemini-named `GenerateContentResponseUsageMetadata` into telemetry (`:85-104`) | **RETYPE** (log neutral `IContent`; `logApiResponse` accepts neutral `UsageStats` or a documented telemetry wire DTO — see §2A.4-II(h), §7A telemetry note, OQ-3t; if Gemini-named usage keys are retained for consumers, they are a bounded telemetry-serialization exception confined to this file) |
| 26 | `core/schemaDepthErrorEnrichment.ts` | `ApiError` (value) | Enriches schema-depth errors with cyclic-tool hints | **RETYPE** (→ `isProviderApiError`/`ProviderApiError`) |
| 27 | `core/subagent.ts` | `Content`, `Part` | Subagent orchestration entry | **RETYPE** |
| 28 | `core/subagentExecution.ts` | `Content`, `FunctionCall` | Subagent execution loop | **RETYPE** |
| 29 | `core/subagentNonInteractive.ts` | `FunctionCall`, `FunctionDeclaration`, `Content` | Non-interactive subagent run | **RETYPE** |
| 30 | `core/subagentRuntimeSetup.ts` | `Type` (**value**, `:25-30`); `Content`, `FunctionDeclaration`, `GenerateContentConfig` (type, `:25-30`) | Subagent runtime setup; **`Type` is the only runtime binding** in the import clause (`:25-30`) — the rest are erased `type` imports; `Type` enum is used at runtime to build schemas | **RETYPE** (→ `ToolDeclaration`/`JsonSchema`; runtime `Type` enum → JSON-schema string literals) |
| 31 | `core/subagentToolProcessing.ts` | `Part`, `FunctionCall`, `Content` | Subagent tool-call processing | **RETYPE** |
| 32 | `core/TodoContinuationService.ts` | `PartListUnion`, `Part` | Todo continuation post-turn action | **RETYPE** |
| 33 | `agents/executor.ts` | `Content`, `FunctionCall`, `GenerateContentConfig`, `FunctionDeclaration` | Agent executor top-level | **RETYPE** |
| 34 | `agents/executor-stream-processor.ts` | `Content`, `Part`, `FunctionCall`, `FunctionDeclaration` | Executor stream processing | **RETYPE** |
| 35 | `agents/executor-tool-dispatch.ts` | `Type` (**value**, `:19`); `Content`, `Part`, `FunctionCall` (type, `:20`); `Schema`, `FunctionDeclaration` (type, `:23`) | Executor tool dispatch; **`Type` is the only runtime value** (used to build schemas); also builds `{ role:'user', parts: toolResponseParts }` tool-response feed (`:513`, §2A.4-I(e)) | **RETYPE** (`Schema`→`JsonSchema`, `FunctionDeclaration`→`ToolDeclaration`, runtime `Type` enum → JSON-schema string literals; tool-response feed → `IContent{speaker:'tool'}`) |
| 36 | `agents/recovery.ts` | `Content`, `FunctionCall` | Executor recovery / repair | **RETYPE** |
| 37 | `agents/types.ts` | `Content`, `FunctionDeclaration` | Executor shared types | **RETYPE** |
| 38 | `api/agent.ts` | `Content`, `Part` | Public agent API surface | **RETYPE** |
| 39 | `api/agentBootstrap.ts` | `PartListUnion`, `Part` | Agent bootstrap/initial request | **RETYPE** (initial request → neutral request DTO) |
| 40 | `api/control/sessionControl.ts` | `Content` | Session control (history ops) | **RETYPE** |
| 41 | `compression/CompressionHandler.ts` | `GenerateContentConfig` | Compression orchestration | **RETYPE** (→ `ModelGenerationSettings`) |
| 42 | `compression/compressionBudgeting.ts` | `GenerateContentConfig` | Token budgeting for compression | **RETYPE** |
| 43 | `compression/providerContentEnforcement.ts` | `GenerateContentConfig` | Enforces provider content constraints | **RETYPE** |
| 44 | `core/agenticLoop/AgenticLoop.ts` | `PartListUnion` | Agentic loop driver | **RETYPE** (→ neutral request DTO) |
| 45 | `core/agenticLoop/loopHelpers.ts` | `Part` | Agentic loop helpers | **RETYPE** |
| 46 | `core/agenticLoop/types.ts` | `PartListUnion` | Agentic loop shared types | **RETYPE** |

**File-level disposition tally (production):** DELETE = **2**; NEUTRALIZE-IN-PLACE = **3**; RETYPE = **41**.

> **This is a *file-level* tally and understates deletion work.** Many files categorized **RETYPE** or **NEUTRALIZE-IN-PLACE** contain **synthetic-response-only functions that are deleted outright** (the whole-file disposition survives because *other* functions in the same file are retyped). The function-level delete inventory below makes that deletion surface explicit so the file-level tally is not read as the total delete cost.

**Function-level delete inventory — synthetic-response-only / round-trip-only functions that vanish (verified round-trip-only; not a whole-file DELETE):**

| Function (`file:line`) | Why it is delete-only | Sole caller(s) / evidence |
|------------------------|-----------------------|---------------------------|
| `MessageConverter.convertIContentToResponse` (`MessageConverter.ts:518-543`) | Fabricates the synthetic `{candidates:[{content:{role:'model',parts}}]}` envelope — the streaming/direct round-trip's response fabricator | §3.2 #5, §2A.4-I(a); called only from `StreamProcessor`/`TurnProcessor`/`DirectMessageProcessor` synthetic paths |
| `MessageConverter.applyResponseMetadata` (`MessageConverter.ts:634`) | Populates metadata **onto the synthetic response** | Called only from `convertIContentToResponse` (`:542`) |
| `MessageConverter.applyFinishReasonMapping` (`MessageConverter.ts:550`) | Maps finish reason **onto the synthetic response** and writes the `providerStopReason` side-channel (`:588`) | Called only from `applyResponseMetadata` (`:665`) |
| `DirectMessageProcessor._buildBlockingSyntheticResponse` (`DirectMessageProcessor.ts:677-701`) | Fabricates the pre-provider blocking-hook synthetic `GenerateContentResponse` | §2B.2-3; called once at `:649` |
| `streamRequestHelpers.patchMissingFinishReason` (`streamRequestHelpers.ts:162-169`) | Patches `finishReason` onto the synthetic `{candidates}` literal using the runtime `FinishReason.STOP` | §2A.4-I(a); called via `StreamProcessor._patchMissingFinishReason` (`:378-382`) |
| `streamChunkWrapper.responseToIContent` / `responseToModelStreamChunk` / `chunkToParts` / `usageMetadataToUsageStats` (`streamChunkWrapper.ts:77`, `:105`, `:167`, `:43`) | The entire synthetic-response ↔ chunk ↔ `Part[]` boundary; the file is a whole-file **DELETE** (§3.2 #1) and every exported helper vanishes with it | file-level DELETE; consumers move to `toModelStreamChunk(iContent)` (core) |

> **Not a synthetic-only delete (verified — retained, retyped):** `MessageConverter.createUserContentWithFunctionResponseFix` (`MessageConverter.ts:138-173`) is **inbound** input normalization (`PartListUnion → Content`), called from `convertPartListUnionToIContent` (`:190`, `:203`, `:207`) and `normalizeToolInteractionInput`, **not** the synthetic response round-trip. Its `{role:'user',parts}` construction is dispositioned under §2A.4-I(b) as **[retype→neutral]** (build `IContent`/`ContentBlock[]` directly), not deleted. (This corrects the assumption that it is round-trip-only.)

**Files needing extra verification before final categorization (see also §9 Open Questions):**

- `MessageConverter.ts` (#5) straddles DELETE-content + RETYPE-content. Marked NEUTRALIZE-IN-PLACE because part of the file is deleted (`convertIContentToResponse` et al.) and part survives retyped. A planner must decide the surviving conversion surface precisely (e.g. whether `normalizeToolInteractionInput`'s tool-response packaging needs a neutral equivalent — **OPEN QUESTION**).
- `googlePartHelpers.ts` (#3): its in-file `@issue #2348` comments explicitly say core already migrated these to `ContentBlock[]` (`getToolCallBlocks`, `getResponseTextFromBlocks`). Verify the core equivalents cover all three functions before deleting vs. re-homing.
- `hookToolRestrictions.ts` (#4): NEUTRALIZE vs partial-DELETE depends on whether any restriction logic must remain a discrete module or folds into `turn.ts`/`StreamProcessor.ts` block filtering. `turn.ts` already contains a block-based `filterBlocksByAllowedTools`.

### 3.3 Test-file inventory — 54 raw importers PLUS structural fixture/converter tests

The test surface for behavioral migration is **two** sets, not one: (1) the **54 raw `@google/genai` importers** (§3.3, below), and (2) **structural Gemini fixture/converter tests that do NOT import `@google/genai`** but still fabricate `{candidates}`/`{role,parts}` fixtures or assert on `.parts`/`role:'model'` structure (§3.3-A). Both **must be migrated behaviorally** — not just re-pointed. A name-only swap (or leaving a structural fixture in place) reproduces the #2424 failure at the test layer.

#### Raw `@google/genai` importers (54 files, grouped)

The **exact, sorted 54-file list is in Appendix A.5**. By directory the 54 break down as (each count is exact, verifiable against A.5):

| Area | Count (exact) | Notes |
|------|---------------|-------|
| `core/` (directly under `core/`: client, stream, turn, converter, subagent, conversation, scheduler, chatSession, MessageStreamOrchestrator + `client-test-helpers.ts`/`subagent-test-helpers.ts`) | 42 | Includes `client.sendMessageStream*.test.ts` (5: base/errors/overflow/overflow-compression/thinking), `client.*.test.ts` (7: methods/hooks/ide-context/editor-context/lifecycle/model-profile/test), `turn.*.test.ts` (8: abort-timeout/debug-responses/hook-events/idle-timeout/issue2329/preRequestTimeout/tool-restrictions/undefined_issue) + `turn.test.ts`, `chatSession.*` (6: directRefusal-issue2329/issue1150-integration/runtime/runtime.history/runtime.streaming/thinkingHistory), `MessageConverter.issue1844`/`issue2329`, `StreamProcessor.retryBoundary`/`yieldAsYouGo`, `ConversationManager.modelStamp`, `clientHelpers`, `coreToolScheduler.edit-cancel`, `MessageStreamOrchestrator.modelinfo`/`todoPause`, `client-test-helpers.ts`, `subagent-test-helpers.ts`, `subagent.buildParts`/`create`/`runNonInteractive`/`runNonInteractive-execution`. |
| `core/__tests__/` | 3 | `executionControlErrors.test.ts`, `subagent.stateless.test.ts`, `turn.thinking.test.ts` |
| `core/agenticLoop/__tests__/` | 2 | `agenticLoop.auto-policy.test.ts`, `agenticLoop-test-helpers.ts` |
| `agents/` | 4 | `executor.execution.test.ts`, `executor.recovery.test.ts`, `executor.test.ts`, `executor-test-helpers.ts` |
| `api/__tests__/` (+ helpers) | 3 | `event-characterization.spec.ts`, `helpers/eventHarness.ts`, `helpers/realLoopHarness.ts` |
| **Total** | **54** | matches §10 and Appendix A.5 |

> Behavioral migration means: assertions on observable outputs (emitted `ServerAgentStreamEvent`s, committed `HistoryService` state, retry ordering, finish/stop reasons) rather than on the internal `GenerateContentResponse` shape. Test helpers that fabricate `{ candidates: [...] }` fixtures must be rewritten to produce `IContent`/`ModelStreamChunk`.

### 3.3-A Structural Gemini fixture/converter tests that do NOT import `@google/genai`

The raw-import count (54) undercounts the behavioral-migration surface because the issue's failure mode is **structural**, not import-based. Several agents tests exercise or assert on Gemini `{role,parts}`/`{candidates}` structure without importing `@google/genai`. **Reproducible, sorted evidence — commands + full outputs, classed by structural pattern ({candidates} response fixtures / {role,parts} message fixtures / `.parts` assertions-mutators / converter-boundary) — is in Appendix A.6** (mirroring A.5's rigor). The named dispositions below are the concrete allow-list artifact for the §8.1 test gate; A.6 shows the full no-import candidate surface each disposition is drawn from.

| Test file | Structural usage (`file:line`) | Nature | Disposition |
|-----------|-------------------------------|--------|-------------|
| `core/__tests__/boundaryRecovery.test.ts:59-62` | round trip `ContentConverters.toIContents(ContentConverters.toGeminiContents(contents))` to simulate the hook-translator text-only round-trip | **Converter/boundary characterization** — deliberately exercises the neutral↔Gemini converter to pin pending-boundary recovery semantics | **RETAIN as named characterization test** (it tests the converter boundary itself, which persists at the hook wire; OQ-1d). Must not assert internal agent-loop `GenerateContentResponse`. |
| `core/chatSession.thinking-toolcalls.repro.test.ts:118-125`, `:542-563` | `ContentConverters.toGeminiContents(curated)` then asserts `c.role === 'model'`, `c.parts?.some(functionCall)`, and `thoughtSignature` on a parts element before `toIContents` back | **Converter/boundary characterization** — pins thoughtSignature fidelity across the Gemini round trip (issue #1150) | **RETAIN as named characterization test** (thoughtSignature fidelity is a §5.4 converter concern). Legitimate boundary assertion. |
| `api/__tests__/switch-context.spec.ts:344` | after `stripThoughts`, `normalized.find((c) => c.role === 'model')` then reads `.parts` to assert the thought flag/text survive and the signature is stripped | **Converter/boundary characterization** — pins `stripThoughts` behavior at the history-normalization boundary | **RETAIN as named characterization test** (boundary behavior). |
| `core/chatSession.hook-control.test.ts:172-185`, `:313-...` | fabricates `{ candidates:[{ content:{ role:'model', parts:[...] } }] }` inside `BeforeModelHookOutput`/`AfterModelHookOutput.hookSpecificOutput.llm_response` | **Hook-wire fixture** — the `{candidates}` shape is the hook JSON wire (`llm_response`), a legacy external contract (§2B.1) | **RETAIN or RETYPE per OQ-1a/OQ-1c** — if the hook wire stays Gemini-shaped, this fixture is a legitimate boundary fixture; if the blocking hook must yield neutral output, rewrite to assert observable blocked-turn behavior. |
| `core/chatSession.issue1749.test.ts:149-...`, `:208-...` | fabricates `{ candidates:[{ content:{ role:'model', parts:['hook modified text'] } }] }` in `AfterModelHookOutput.hookSpecificOutput.llm_response` | **Hook-wire fixture** (after-model modification) | **RETAIN or RETYPE per OQ-1a** (hook-wire boundary). |
| `core/subagent.stream-idle.test.ts:240-...`, `subagent.runNonInteractive-term.test.ts:255-...` | fabricates `{ candidates:[{ content:{ parts:[{text}] } }] }` passed through `mockResponseToChunk(...)` to build stream chunks | **Agent-loop fabrication** — the `{candidates}` fixture is used to synthesize provider stream chunks, i.e. it fabricates the internal round-trip shape | **REWRITE off `GenerateContentResponse`/`{candidates}` fixtures** — produce `IContent`/`ModelStreamChunk` chunks directly (the mock should yield neutral chunks, not Gemini candidates). |
| `core/__tests__/chatSession.runtimeState.test.ts:123` | mock `ContentGenerator.generateContent` returns `{ response: { text, candidates: [] } }` | **Legacy content-generator mock** — the empty `candidates: []` is the old ContentGenerator shape, not the agent-loop currency | **REWRITE** if the mocked surface migrates; low-risk (empty array), but should not fabricate Gemini responses once the surface is neutral. |

**Note — many of the 54 raw importers ALSO carry `{candidates}` fixtures** (e.g. `turn.*.test.ts`, `StreamProcessor.*.test.ts`, `turn.issue2329.test.ts`, `turn.thinking.test.ts`, `executionControlErrors.test.ts`). Those are agent-loop tests and fall under the "rewrite off `GenerateContentResponse`/`{candidates}`" rule; they are already in the 54 (§3.3 / Appendix A.5) and are not double-counted here. §3.3-A adds only the tests that would otherwise be **missed** because they carry no raw import.

**Classification summary.** Legitimate converter/boundary characterization tests to **retain** (asserting Gemini structural compatibility *at a boundary that persists*): `boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts`. Hook-wire fixtures whose fate follows the hook-wire decision (OQ-1a/OQ-1c): `chatSession.hook-control.test.ts`, `chatSession.issue1749.test.ts`. Agent-loop fabrications to **rewrite** off internal `GenerateContentResponse`/`{candidates}` fixtures: `subagent.stream-idle.test.ts`, `subagent.runNonInteractive-term.test.ts`, `chatSession.runtimeState.test.ts` (plus the `{candidates}`-bearing tests already inside the 54).

---

## 4. The `clientContract.ts` Problem (cross-package, central)

`packages/core/src/core/clientContract.ts` is the corollary in §1.2 made concrete. Its own doc comment admits the shapes are the SDK:

> "Structural shapes matching **the portions of the @google/genai SDK types** used by the agent-client contract surface. Defined locally so core does not import @google/genai" (`clientContract.ts:41-49`; the first payload type `ContractFunctionCall` begins at L51).

This is "the Google SDK with the serial numbers filed off." Passing the raw-import gate while remaining Google-shaped is exactly how the design stays broken.

### 4.1 Google-shaped PAYLOAD types (must be removed/neutralized)

Defined in `clientContract.ts`:

| Type | Definition (evidence: line) | Google shape |
|------|------------------------------|--------------|
| `ContractPart` | L63-71 | `{ text?, inlineData?, functionCall?, functionResponse?, fileData?, thought?, thoughtSignature? }` = `Part` |
| `ContractPartListUnion` | L73-76 | `ContractPart \| string \| Array<ContractPart\|string>` = `PartListUnion` |
| `ContractContent` | L78-81 | `{ role?, parts?: ContractPart[] }` = `Content` |
| `ContractContentUnion` | L83-87 | `ContractContent \| ContractPart \| string \| Array<...>` |
| `ContractGenerateContentConfig` | L89-98 | `{ temperature?, maxOutputTokens?, topP?, topK?, systemInstruction?, abortSignal?, tools?, toolConfig? }` = `GenerateContentConfig`. **`systemInstruction` is `ContractContentUnion` (Google-shaped)**; the neutral target `ModelGenerationSettings.systemInstruction` is **string-only** — see the compat decision in §5.3-8 / OQ-11. |
| `ContractGenerateContentResponse` | L100-121 | `{ text?, data, functionCalls, executableCode, codeExecutionResult, candidates[].content.parts[], usageMetadata.promptTokenCount... }` = `GenerateContentResponse` |
| `ContractSendMessageParameters` | L122-125 | `{ message: ContractPartListUnion, config? }` = `SendMessageParameters` |
| `ContractUsageMetadata` (inline in response) | L114-120 | `{ promptTokenCount?, candidatesTokenCount?, totalTokenCount?, cachedContentTokenCount?, thoughtsTokenCount?, toolUsePromptTokenCount? }` = usage envelope |
| `ContractFunctionCall` / `ContractFunctionResponse` (internal) | L51-61 | `FunctionCall` / `FunctionResponse` |

### 4.2 Legitimately-neutral CLIENT-SURFACE interfaces (stay, but member signatures must be retyped)

`AgentClientContract` and `AgentChatContract` are *surface* contracts (they define the agent-client API). They **stay**, but every member whose signature references a Google-shaped payload type must be retyped to neutral. Offending member signatures are in `clientContract.ts:127-200` (`AgentChatContract` at `:127-142`, `AgentClientContract` at `:148-200`):

`AgentChatContract`:
- `sendMessageStream(params: ContractSendMessageParameters, prompt_id): Promise<AsyncGenerator<StreamEvent>>` → neutral request DTO
- `getHistory(): ContractContent[]` → `IContent[]`
- `setHistory(history: ContractContent[]): void` → `IContent[]`

`AgentClientContract`:
- `getChat(): AgentChatContract` (transitively migrated)
- `getHistory(): Promise<ContractContent[]>` → `IContent[]`
- `storeHistoryForLaterUse(history: ContractContent[])` → `IContent[]`
- `addHistory(content: ContractContent): Promise<void>` → `IContent`
- `resumeChat(history: ContractContent[]): Promise<void>` → `IContent[]`
- `setHistory(history: ContractContent[], options?): Promise<void>` → `IContent[]`
- `startChat(extraHistory?: ContractContent[]): Promise<AgentChatContract>` → `IContent[]`
- `generateDirectMessage(params: ContractSendMessageParameters, promptId): Promise<ContractGenerateContentResponse>` → neutral request DTO in, `ModelOutput` out
- `generateJson(contents: ContractContent[], schema, abortSignal, model, config?: ContractGenerateContentConfig)` → `IContent[]` + `ModelGenerationSettings`
- `generateContent(contents: ContractContent[], generationConfig: ContractGenerateContentConfig, abortSignal, model): Promise<ContractGenerateContentResponse>` → `IContent[]` + `ModelGenerationSettings` in, `ModelOutput` out
- `sendMessageStream(initialRequest: ContractPartListUnion, signal, prompt_id, turns?, ...): AsyncGenerator<ServerAgentStreamEvent, unknown>` → `initialRequest` neutral request DTO

`restoreHistory(historyItems: IContent[])` (L168) is already neutral and is the template for the rest.

> **Behavioral preservation on `getHistory()` retype.** Retyping `getHistory()` to `IContent[]` must preserve two current behaviors: (1) **idle-wait** — `client.getHistory()` awaits `chat.waitForIdle()` before returning when a chat is live (`client.ts:403-413`); (2) **defensive copy** — `ConversationManager.getHistory()` returns a `structuredClone` of the projection (`ConversationManager.ts:419-423`). The neutral `getHistory()` must clone the neutral `IContent[]` (or otherwise avoid exposing mutable history internals) and retain the idle-wait, so callers cannot mutate committed history and do not observe a mid-flight projection.

### 4.3 Cross-package blast radius (measured)

The Google-shaped `Contract*` payload types are consumed outside agents. Migrating them **will** touch CLI and core — this is expected and correct.

- **CLI consumers (production):** **23 files** — verified via:
  ```
  grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/cli/src \
    | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | sort
  ```
  (The raw grep returns 25 paths; two are test-helper files — `nonInteractiveCli.test-helpers.ts` and `ui/hooks/useAgentStream-test-helpers.ts` — which are excluded as non-production, giving **23**.) Category breakdown (sums to 23): `ui/hooks/agentStream/*` (9), `ui/hooks/*` non-agentStream (7), `zed-integration/*` (3), `nonInteractiveCli*` (2), `ui/utils/*` (2). *(Issue estimated ~21; measured 23. The full sorted file list is in Appendix A.)*
- **CORE consumers (production, excluding `clientContract.ts` itself):** **5 files** — `commands/types.ts`, `config/agentClientLifecycle.ts`, `utils/checkpointUtils.ts`, `utils/llm-edit-fixer.ts`, `utils/summarizer.ts`.
- **AGENTS consumers of `Contract*` (production):** **0** — agents imports Google symbols directly from `@google/genai`, not the `Contract*` aliases. (The `Contract*` surface is what agents *implements* via `AgentClientContract`, so agents is bound to it structurally, not by importing the payload types.)

### 4.4 HistoryService is already neutral — and MUST stay neutral

`packages/core/src/services/history/HistoryService.ts` has **zero** `@google/genai` imports (verified: `grep -c "@google/genai"` ⇒ 0) — but, per the governing principle that **structure matters more than provenance** (§1.3), zero imports is not sufficient proof. Its neutrality is proven **structurally** by its storage type and method signatures, which accept and return `IContent`/`IContent[]` (never `{role,parts}`):

- **Storage:** `private history: IContent[]` (`HistoryService.ts:74`).
- **Write:** `add(content: IContent, modelName?): void` (`:280`), `addAll(contents: IContent[], modelName?): void` (`:377`), `recordTurn(userInput: IContent, aiResponse: IContent, toolInteractions?: IContent[])` (`:627-629`).
- **Read:** `getAll(): IContent[]` (`:475`), `getCurated(): IContent[]` (`:548`), `getComprehensive(): IContent[]` (`:553`), `getRawHistory(): readonly IContent[]` (`:434`), `clone(): IContent[]` (`:649`).

The migration must **not** push Google shapes back into `HistoryService` (or any core service) to make agents compile. `IContent` is the neutral boundary the whole pipeline already commits to (`TurnProcessor._recordOutputContent`, `StreamProcessor.recordHistoryWithUsage` both ultimately call `historyService.add(IContent, ...)` after `ContentConverters.toIContent`).

---

## 5. Target Neutral Type Surface — Gap Analysis

### 5.1 Neutral types that ALREADY EXIST

**`packages/core/src/llm-types/`:**

| File | Exports |
|------|---------|
| `index.ts` | Barrel: re-exports all below + type-only re-export of `IContent` family; also re-exports `canonicalizeToolCallId`/`canonicalizeToolResponseId` |
| `modelEnvelope.ts` | `ModelOutput`, `ModelStreamChunk` (alias of `ModelOutput`), `HookRestrictions`, `emptyModelOutput`, `accumulateModelStreamChunk`, `getToolCalls`, `toModelStreamChunk(IContent)` |
| `modelRequest.ts` | `ModelGenerationRequest`, `ModelGenerationSettings`, `ReasoningConfig` |
| `toolCall.ts` | `ToolCallRequest`, `ToolResultContent`, `toolResultContentFromLegacyPartListUnion` (structural `unknown` input, no genai import) |
| `toolDeclaration.ts` | `ToolDeclaration`, `ToolChoice`, `toolDeclarationsFromLegacyToolset` |
| `jsonSchema.ts` | `JsonSchema`, `JsonSchemaObject`, `isJsonSchema`, `isRecord` |
| `finishReasons.ts` | `CanonicalFinishReason`, `FinishInfo`, `GEMINI/OPENAI/ANTHROPIC` maps, `mapGeminiFinishReason`/`mapOpenAIFinishReason`/`mapAnthropicStopReason`, `isCanonicalFinishReason` |
| `providerApiError.ts` | `ProviderApiError`, `isProviderApiError` |
| `tokensAndEmbeddings.ts`, `grounding.ts` | token/embedding + grounding neutral types |
| `geminiContent.ts` | **structural** (non-importing) `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall`/... (`geminiContent.ts:71-87`) — models the Gemini wire shape *without* importing the SDK, and is **re-exported from the neutral barrel** (`index.ts:38`). **This is a Gemini-shaped structural type; per §1.3 (case 4) it must NOT become the agents pipeline currency.** It exists for core's history-conversion boundary (`ContentConverters`). The agents-side flows that traffic in this shape via `ContentConverters.toGeminiContent(s)` are inventoried and dispositioned in **§2A**, and the enforcement gate check (g) (§8) bans them. |

**`packages/core/src/services/history/IContent.ts`:** `IContent`, `ContentBlock` union, `TextBlock`, `ToolCallBlock`, `ToolResponseBlock`, `ThinkingBlock`, `MediaBlock`, `CodeBlock`, `UsageStats`, `ContentMetadata`, plus `createUserMessage`, `createToolResponse`, `stampAiTurnModel`, `ContentValidation`.

`ContentMetadata` already carries the fields the side-channels currently smuggle: `usage` (`UsageStats`), `id`, `stopReason`, `finishReason`, `providerMetadata` (`IContent.ts:52-83`).

### 5.2 Substitution table (current Google/Contract type → target neutral type)

| Current (Google / Contract) | Target neutral | Notes / lossy edges |
|-----------------------------|----------------|---------------------|
| `Part` | `ContentBlock` (`TextBlock`/`ToolCallBlock`/`ToolResponseBlock`/`ThinkingBlock`/`MediaBlock`/`CodeBlock`) | `thought`/`thoughtSignature` → `ThinkingBlock.signature` + `sourceField`. **Not globally lossless — see §5.4 lossy-edge note.** `MessageConverter.classifyMixedParts` (part→block, `MessageConverter.ts:421-431`) and `convertBlocksToParts` (block→part, `:492-504`) preserve `thoughtSignature`, but `generateContentResponseUtilities.legacyPartToBlocks` (`generateContentResponseUtilities.ts:271-280`) **drops** it and `toolCall.partLikeToBlock` (`toolCall.ts:109-171`) does not handle thought parts at all. **Block-level provider metadata:** every `ContentBlock` variant carries an optional `providerMetadata?: Record<string, unknown>` (`IContent.ts:136`/`:162`/`:191`/`:220`/`:251`/`:271`), and `IContent` itself carries one (`:65`); block-level provider metadata round-trips through JSON (`IContent.providerMetadata.test.ts`). So per-`Part`/per-block provider-specific data has a **block-level** home distinct from response-level `ModelOutput.providerMetadata` — see the provider-metadata placement note in §5.3-3a (OQ-16) for which of block-level `providerMetadata`, top-level `ModelOutput.providerMetadata`, or an explicit neutral field a given payload should use. |
| `Content` (`{role, parts}`) | `IContent` (`{speaker, blocks}`) | `role:'user'/'model'` → `speaker:'human'/'ai'/'tool'`; tool-response arrays → `speaker:'tool'` |
| `PartListUnion` | **neutral message-input DTO** (`AgentMessageInput` — *gap, see §5.3*) | `toolResultContentFromLegacyPartListUnion` exists for the tool-result sub-case (`toolCall.ts`) |
| `FunctionCall` | `ToolCallBlock` / `ToolCallRequest` | `id`/`name`/`args` map 1:1; `getToolCalls(ModelOutput)` already derives `ToolCallRequest[]` |
| `FunctionResponse` | `ToolResponseBlock` | `callId`/`toolName`/`result` |
| `FunctionDeclaration` | `ToolDeclaration` | `parametersJsonSchema` |
| `Schema` / `Type` (enum) | `JsonSchema` (+ schema string literals) | `Type` enum values (`OBJECT`, `STRING`, …) → JSON-schema `type` strings; **runtime `Type` value uses in `executor-tool-dispatch.ts` & `subagentRuntimeSetup.ts` must be replaced with literals** |
| `FunctionDeclaration[]` (tool declarations) | `ModelGenerationRequest.tools: ToolDeclaration[]` | Declarations live on the **request**, not on settings (`modelRequest.ts:68-87`). |
| `Tool` (legacy toolset group: `Tool.functionDeclarations[]`) | `ToolDeclaration[]` on `ModelGenerationRequest.tools` | Legacy grouped `Tool` shape converts via `toolDeclarationsFromLegacyToolset()` (`toolDeclaration.ts`); confirm whether agents needs its own converter or reuses this. |
| `toolConfig` (tool-choice / allowed-function restriction) | `ModelGenerationSettings.toolChoice: ToolChoice` | `toolConfig.allowedFunctionNames` → `ToolChoice.allowedToolNames`; `toolChoice` lives on **settings**, not the request root (`modelRequest.ts:45-61`, `toolDeclaration.ts:32-46`). |
| `FinishReason` (enum) | `CanonicalFinishReason` | `mapGeminiFinishReason` etc. already exist; **runtime `FinishReason` value uses in `MessageConverter.ts`, `streamRequestHelpers.ts`, `streamResponseHelpers.ts` must be replaced** |
| `GenerateContentResponse` | `ModelStreamChunk` / `ModelOutput` | full envelope elimination |
| `GenerateContentConfig` | **split across `ModelGenerationRequest` + `ModelGenerationSettings`** | Scalar generation settings (`temperature`/`maxOutputTokens`/`topP`/`systemInstruction`/`responseJsonSchema`/`reasoning`) → `ModelGenerationSettings` (`modelRequest.ts:45-61`, which has **no `tools` member**). Tool **declarations** → `ModelGenerationRequest.tools` (`modelRequest.ts:68-87`). Tool **choice** (`toolConfig.allowedFunctionNames`) → `ModelGenerationSettings.toolChoice.allowedToolNames`. `thinkingConfig` → `ModelGenerationSettings.reasoning` (`ReasoningConfig`). `abortSignal` → `ModelGenerationRequest.abortSignal`. Provider-specific extras (e.g. `topK`, `responseMimeType`) → `ModelGenerationRequest.modelParams` (`modelRequest.ts:80-87`). **Do not put `tools` on `ModelGenerationSettings`.** **Full per-key mapping proof and out-of-scope field list in §5.2a; open items in OQ-18.** |
| `SendMessageParameters` | **neutral request DTO** (`AgentGenerationRequest` — *gap, see §5.3*) | `{message, config}` → `{message: AgentMessageInput, settings: ModelGenerationSettings, abortSignal}` |
| `usageMetadata` (`GenerateContentResponseUsageMetadata`) | `UsageStats` | `promptTokenCount`→`promptTokens`, `candidatesTokenCount`→`completionTokens`, `totalTokenCount`→`totalTokens`, `cachedContentTokenCount`→`cachedTokens`, **`thoughtsTokenCount`→`reasoningTokens` (ALREADY mapped — see fidelity note below)**, `toolUsePromptTokenCount`→`toolTokens`; plus Anthropic `cache_read_input_tokens`/`cache_creation_input_tokens` already on `UsageStats`. (`usageMetadataToUsageStats` in `streamChunkWrapper.ts:43-69` already does this map.) |
| `ApiError` (class) | `ProviderApiError` + `isProviderApiError` | `status`/`message` guarded structurally |
| `executableCode` / `codeExecutionResult` (on `GenerateContentResponse`/`ContractGenerateContentResponse`) | **none today (synthetic-`undefined`)** | `clientContract.ts:100-105` declares both; the **only** production uses are `MessageConverter.convertIContentToResponse` fabricating both as `undefined` (`MessageConverter.ts:538-539`) — no real value is ever produced/consumed in agents. Disposition: either map to a neutral `CodeBlock` if real code-execution support is required, or **remove them from the neutral agent contract as unused legacy fields**. **OQ-13.** |
| `Candidate` | (folded into `ModelStreamChunk`) | `finishReason`+`content` → chunk fields; **`providerStopReason` field → `ModelStreamChunk.rawStopReason`** |
| `createUserContent` (fn) | neutral user-message builder | `IContent.createUserMessage` exists; verify tool-response-array behavior parity |
| `automaticFunctionCallingHistory` | *(gap — neutral AFC representation)* | see §5.3 + §6/§9 |
### 5.2a `GenerateContentConfig` field sub-inventory (non-lossy mapping proof)

The `GenerateContentConfig → ModelGenerationRequest/ModelGenerationSettings` split above is only provably non-lossy if every config key **actually referenced in agents** has a named neutral home. This sub-inventory enumerates (i) the config keys referenced under `packages/agents/src` production (verified by grepping `GenerateContentConfig['…']` indexed-access and `config`/`generationConfig`/`settings` field reads/writes), and (ii) the keys exposed through the existing `ContractGenerateContentConfig` (`clientContract.ts:89-98`: `temperature`, `maxOutputTokens`, `topP`, `topK`, `systemInstruction`, `abortSignal`, `tools`, `toolConfig`). Each is assigned a concrete neutral home.

| `GenerateContentConfig` key | Referenced in agents? (evidence) | Neutral home |
|-----------------------------|----------------------------------|--------------|
| `temperature` | yes — `executor.ts:755` (`temperature: modelConfig.temp`), `baseLlmClient.ts:169`, `config?.temperature` reads | `ModelGenerationSettings.temperature` (`modelRequest.ts:46`) |
| `maxOutputTokens` | via contract surface (`ContractGenerateContentConfig`) | `ModelGenerationSettings.maxOutputTokens` (`modelRequest.ts:47`) |
| `topP` | yes — `executor.ts:756` (`topP: modelConfig.top_p`), `baseLlmClient.ts:170` | `ModelGenerationSettings.topP` (`modelRequest.ts:55`) |
| `topK` | yes — only `CompressionProfileResolver.ts:125` (`topK: modelParams.top_k`) | `ModelGenerationRequest.modelParams` (provider-specific extra; `modelRequest.ts:80-87`) |
| `systemInstruction` | yes — `chatSession.ts:483`, `baseLlmClient.ts:173`/`:330`/`:342`, `executor.ts:763` (12 reads/writes) | `ModelGenerationSettings.systemInstruction` (**string-only**, `modelRequest.ts:48`) — legacy non-string forms governed by OQ-11 (§5.3-8) |
| `abortSignal` | yes — 19 reads (`config?.abortSignal` etc.) across StreamProcessor/TurnProcessor/DirectMessageProcessor | `ModelGenerationRequest.abortSignal` (`modelRequest.ts:78`) |
| `tools` (tool **declarations**) | yes — `GenerateContentConfig['tools']` at `TurnProcessor.ts:628`/`:634`, `StreamProcessor.ts:398`/`:514`/`:520`, `streamRequestHelpers.ts:41`/`:93`/`:94`/`:119`, `DirectMessageProcessor.ts:512` | `ModelGenerationRequest.tools: ToolDeclaration[]` (`modelRequest.ts:70`) — **not** on settings |
| `toolConfig` (tool **choice**) | yes — `GenerateContentConfig['toolConfig']` at `turnLogging.ts:33`/`:41`; `config.toolConfig` reads | `ModelGenerationSettings.toolChoice: ToolChoice` (`toolConfig.allowedFunctionNames → ToolChoice.allowedToolNames`) |
| `thinkingConfig` (reasoning) | yes — `ChatSessionFactory.ts:227` (`thinkingConfig:{thinkingBudget:-1,includeThoughts:true}`), `executor.ts:756-759` | `ModelGenerationSettings.reasoning: ReasoningConfig` (`modelRequest.ts:49`, `ReasoningConfig{budgetTokens,effort,includeInOutput}` `:34-38`) — `thinkingBudget→budgetTokens`, `includeThoughts→includeInOutput` |
| `responseJsonSchema` | yes — `baseLlmClient.ts:178` (**already writes neutral** `settings.responseJsonSchema`) | `ModelGenerationSettings.responseJsonSchema: JsonSchema` (`modelRequest.ts:60`) — already mapped |
| `responseMimeType` | yes — `baseLlmClient.ts:179` (**already writes neutral** `modelParams.responseMimeType`) | `ModelGenerationRequest.modelParams` (`modelRequest.ts:80-87`) — already mapped |

**Not referenced in agents (out of scope for #2349 — do NOT invent scope).** A sweep of `packages/agents/src` production for `responseSchema`, `safetySettings`, `cachedContent`, `candidateCount`, `stopSequences`, `seed`, `presencePenalty`, `frequencyPenalty` finds **no agents references** (`safetySettings`/`cachedContent`/`candidateCount`/`stopSequences`/`seed`/penalties ⇒ 0 hits; `responseSchema` ⇒ 0, distinct from the referenced `responseJsonSchema`). These are Gemini config fields the agents surface does not currently touch; they are therefore **out of scope** for this migration, not silent drops. If any later enters the agents surface it needs a neutral home decision (OQ-18 below).

**OPEN QUESTIONS for Gemini config fields lacking a clear neutral home should they enter the agents surface (OQ-18):** `responseSchema`/`responseJsonSchema` (the neutral `ModelGenerationSettings.responseJsonSchema` exists and is already used; a Gemini `responseSchema` `Schema`-typed variant would need `JsonSchema` conversion), `responseMimeType` (currently ridden via `modelParams`; promote to a neutral field if ≥2 providers need it), `thinkingConfig`/reasoning (mapped to `ReasoningConfig` — confirm `thinkingBudget`/`includeThoughts` semantics are fully covered by `budgetTokens`/`includeInOutput`/`effort`), `safetySettings` (no neutral home — decide preserve-as-`modelParams` / promote / drop), and `cachedContent` (no neutral home — Gemini context-cache handle; decide `modelParams` vs explicit neutral slot vs out-of-scope). None of these except `thinkingConfig`/`responseJsonSchema`/`responseMimeType` is referenced in agents today, so the decision is only forced if the neutral contract must accept them at a public boundary.


### 5.3 Gaps — neutral types MISSING that agents will need

Using **domain names, not Google names** (maintainer guidance: `AgentRequestContent` / `AgentMessageInput` / `AgentGenerationConfig` over `PartListUnion`/`GenerateContentConfig` aliases):

1. **`AgentMessageInput`** (neutral replacement for `PartListUnion`). A domain DTO for "what the user/tool sends into a turn": a string, a single content block, or a list. Home: `llm-types` (new) or extend `IContent` layer. Needed by `turn.run(req)`, `client.sendMessageStream(initialRequest)`, `agentBootstrap`, `AgenticLoop`, `TodoContinuationService`.
2. **`AgentGenerationRequest`** (neutral replacement for `SendMessageParameters`). `{ message: AgentMessageInput; settings?: ModelGenerationSettings; abortSignal?: AbortSignal; promptId?: string }`. Home: `llm-types`. Needed by `TurnProcessor`, `StreamProcessor`, `chatSession`, `turnAbortHelpers`, `DirectMessageProcessor`.
   - `ModelGenerationRequest` (exists) is close but is provider-facing (`contents: IContent[]`); the *turn-level* send DTO carries a single `message` plus config, so a distinct DTO is warranted — **OPEN QUESTION** whether to reuse/extend `ModelGenerationRequest` or add a sibling.
3. **AFC (automaticFunctionCallingHistory) neutral home.** Currently `GenerateContentResponse.automaticFunctionCallingHistory: Content[]` (read in `TurnProcessor._commitSendResult`/`_recordAfcHistory`, `hookToolRestrictions.attachHookRestrictedAllowedTools`, and the direct path from `metadata.providerMetadata['automaticFunctionCallingHistory']` — `DirectMessageProcessor.ts:755-764`). No neutral type carries a *history slice* on a `ModelOutput`. Options: `ModelOutput.providerMetadata` slot, or a dedicated `ModelOutput.afcHistory?: IContent[]`. **Constraint:** if AFC rides `ModelOutput.providerMetadata`, `toModelStreamChunk` **does not currently copy `providerMetadata`** (`modelEnvelope.ts:188-210`) — so relying on the `providerMetadata` slot requires extending/wrapping `toModelStreamChunk` to preserve it, whereas a first-class `ModelOutput.afcHistory?: IContent[]` avoids making `providerMetadata` load-bearing. **OPEN QUESTION (OQ-2 / OQ-15).**
3a. **Provider output metadata beyond AFC — response-level AND block-level.** The target conversion `toModelStreamChunk(iContent)` is sufficient only for `IContent.metadata` fields (`stopReason`/`finishReason`/`usage`/`id`); it does **not** carry the additional data the current pipeline surfaces. Provider metadata has **two placement levels** in the neutral model, and the plan must decide, per payload, which level it lives at:
   - **Response-level (`ModelOutput.providerMetadata`).** A top-level `Record<string, unknown>` on `ModelOutput`/`ModelStreamChunk` (`modelEnvelope.ts:51-59`), shallow-merged across chunks by `accumulateModelStreamChunk` (`:142-147`). This is the home for response-scoped provider data.
   - **Block-level (`ContentBlock.providerMetadata` / `IContent.providerMetadata`).** Every block variant AND `IContent` itself carry an optional `providerMetadata?: Record<string, unknown>` (`IContent.ts:65`/`:136`/`:162`/`:191`/`:220`/`:251`/`:271`), and block-level provider metadata round-trips through JSON (`IContent.providerMetadata.test.ts`). This is the home for provider data attached to an *individual* content block (e.g. a per-block safety rating, a per-tool-call provider id, per-media provider fields), which response-level `providerMetadata` cannot express.

   Concrete payloads and their current sources:
   - **Response id + usage on the current wrapper.** `streamChunkWrapper.responseToModelStreamChunk` maps `resp.responseId` (`streamChunkWrapper.ts:91-93`, `:152-153`) and `resp.usageMetadata` via `usageMetadataToUsageStats` (`:125-127`). These map cleanly to `IContent.metadata.id`/`IContent.metadata.usage`, so `toModelStreamChunk` covers them **once the neutral chunk is sourced from `IContent` that already carries them** — the streaming path must ensure `id`/`usage` are populated on `IContent.metadata` before conversion.
   - **Gemini provider-specific response metadata: `promptFeedback` / `safetyRatings` / `groundingMetadata`.** Core's neutral Gemini adapter maps these into `ModelOutput.providerMetadata` (response-level) under `gemini.*` keys (`contentGeneratorAdapters.ts:195-210`). `toModelStreamChunk` does **not** copy `IContent.metadata.providerMetadata` (`modelEnvelope.ts:188-210`), so this data is dropped by the plain target conversion.
   - **Per-block provider data.** Any provider-specific data that is naturally attached to a single `Part`/block (rather than the whole response) belongs on that block's `providerMetadata`, not squeezed into the response-level slot.

   **Disposition (OPEN QUESTION — OQ-16):** decide, **per payload and per level**, whether agents must (i) **preserve** it through events/history (requires extending/wrapping `toModelStreamChunk` to copy response-level `providerMetadata`, and ensuring block-level `providerMetadata` survives the `IContent`↔block conversions, or promoting specific fields to explicit neutral slots), (ii) **ignore by design** (Gemini-only, not consumed by the agent loop — verify no agents consumer reads it), or (iii) **keep at provider/core-only boundaries** (never reaches agents). This includes deciding whether **both** block-level and response-level provider metadata are in scope for preservation. This is not resolvable from the agents code alone (the fields originate in core's Gemini adapter and are consumed, if at all, downstream), so it is surfaced as an open question.
4. **`thoughtSignature` on neutral blocks.** The neutral **type** exists (`ThinkingBlock.signature` + `sourceField`, `IContent.ts:228-241`; `googlePartHelpers.ThoughtPart.llxprtSourceField`), but fidelity is **not globally solved across all converters** — see the §5.4 lossy-edge note. The plan must route model-output conversion through a signature-preserving converter (or extend the lossy ones), and round-trip fidelity must be pinned in tests.
5. **Provider stop reason.** Covered by `ModelStreamChunk.rawStopReason` + `IContent.metadata.stopReason`. No new type; retire the side-channel.
6. **Cache token fields.** Already on `UsageStats` (`cachedTokens`, `cacheCreationTokens`, `cacheMissTokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `reasoningTokens`, `toolTokens`). No gap.
7. **Tool-response packaging (`normalizeToolInteractionInput`).** `MessageConverter.normalizeToolInteractionInput` packages tool responses as a user `Content`. Whether a neutral equivalent is needed (vs. constructing `IContent{speaker:'tool'}` directly) is an **OPEN QUESTION** (§9).
8. **`systemInstruction` shape (compat decision).** The neutral `ModelGenerationSettings.systemInstruction` is **string-only** (`modelRequest.ts:45-61`), but current agents code accepts non-string legacy forms: `baseLlmClient.ts:68` declares `systemInstruction?: string | Part | Part[] | Content`, and `:328-342` extracts text from the non-string forms (wrapping a bare `Part` as `{ role:'user', parts:[systemInstruction as Part] }` then `toIContent` → join text blocks). This is not a missing type — the neutral type exists — but a **behavior/contract decision**: either (a) keep accepting legacy `Part`/`Content` system instructions at public/compat boundaries and normalize them to `string` (preserving current behavior), or (b) narrow the neutral contract to `string` only as a **documented breaking change** (callers must pre-flatten). **OQ-11.** Note this also governs the `{role:'user',parts:[systemInstruction as Part]}` literal at `baseLlmClient.ts:333-336` (§2A.4-I(b)): under (b) that wrapper is deleted; under (a) it is retyped to build neutral blocks.

### 5.4 Lossy-edge note — `thoughtSignature` fidelity across converters

`thoughtSignature` (the model's opaque thinking-continuity token) is **preserved by some converters and dropped by others**. A planner must not assume "thoughtSignature is handled" globally; the migration must ensure model-output paths that carry thinking signatures use only the preserving converters (or extend the lossy ones).

| Converter | thoughtSignature | Evidence |
|-----------|------------------|----------|
| `MessageConverter.convertBlocksToParts` (block→part) **and** `classifyMixedParts` (part→block) | **Preserved** both directions — block→part: `ThinkingBlock.signature` → `thoughtPart.thoughtSignature`, `sourceField` → `llxprtSourceField` (`MessageConverter.ts:498-502`); part→block: `thoughtSignature` → `ThinkingBlock.signature` (`MessageConverter.ts:428-430`) | `MessageConverter.ts:492-504` (block→part), `:421-431` (part→block) |
| `ContentConverters.toGeminiContent` (block→Gemini) | Preserved (thinking part carries signature) | `ContentConverters.ts:111` (`thinkingPart: GeminiContentPart`) |
| `generateContentResponseUtilities.legacyPartToBlocks` (legacy part→block) | **DROPPED** — produces `{ thought, isHidden, sourceField:'thought' }` with **no `signature`** | `generateContentResponseUtilities.ts:271-280` |
| `toolCall.partLikeToBlock` (tool-result part→block) | **Not handled at all** — recognizes `text`/`inlineData`/`fileData`/`functionResponse` only; a thought part falls through to the unsupported-shape error | `toolCall.ts:109-171` |

**Implication for the plan:** neutralizing model-output conversion must route through a signature-preserving converter (the `MessageConverter`/`ContentConverters` block path), OR `generateContentResponseUtilities.legacyPartToBlocks` and `toolCall.partLikeToBlock` must be extended to carry `signature` before they are used on any model-output/thinking path. This is a fidelity requirement, not merely a type-swap.

### 5.5 Reasoning-token (`thoughtsTokenCount`) mapping — status and fidelity note

The streaming path **already maps** `thoughtsTokenCount → UsageStats.reasoningTokens`: `usageMetadataToUsageStats` in `streamChunkWrapper.ts` sets `if (usage.thoughtsTokenCount !== undefined) { stats.reasoningTokens = usage.thoughtsTokenCount; }` (`streamChunkWrapper.ts:57-59`). `thoughtsTokenCount` is native to `GenerateContentResponseUsageMetadata`, so `UsageMetadataWithCache` (`googlePartHelpers.ts:25-29`, which intersects that base type with `cache_read_input_tokens`/`cache_creation_input_tokens`/`toolUsePromptTokenCount`) carries it without re-declaration. The §5.2 substitution table's note ("`usageMetadataToUsageStats` already does this map") is accurate for the streaming path.

The residual fidelity requirement is **parity across BOTH neutral paths.** The *streaming* neutral chunk derives usage via `usageMetadataToUsageStats` (mapping `reasoningTokens`), but the *direct* path currently returns a Gemini-shaped `GenerateContentResponse` whose `usageMetadata.thoughtsTokenCount` is carried natively (`DirectMessageProcessor.ts:204` logs `response.usageMetadata`) rather than as neutral `UsageStats`. When the direct path is retyped to return `ModelOutput` (§2B.2), its `UsageStats` must likewise populate `reasoningTokens` from `thoughtsTokenCount` (via the same neutral mapper or `IContent.metadata.usage`), so reasoning-token accounting is not dropped when the synthetic response is removed. This is an acceptance/fidelity check (§9.1-8, OQ-14).

---

## 6. Side-Channel Retirement Analysis

### 6.1 `providerStopReason`

- **Data carried:** a single `string` — the raw provider stop reason (`'refusal'`, `'end_turn'`, `'max_tokens'`, OpenAI `'stop'`/`'length'`/`'tool_calls'`, etc.).
- **Written:** `MessageConverter.applyFinishReasonMapping` (`MessageConverter.ts:550`) — `setProviderStopReason(response.candidates[0], terminationReason)` (`MessageConverter.ts:588`) where `terminationReason = input.metadata?.stopReason ?? input.metadata?.finishReason`.
- **Read:** `streamChunkWrapper.responseToModelStreamChunk` — `getProviderStopReason(candidate)`, then set on `chunk.rawStopReason` (`streamChunkWrapper.ts`). Ultimately surfaced by `turn.processStreamChunk` → `emitFinishReason({ stopReason })` → `Finished` event `value.stopReason` (`turn.ts` `emitFinishReason`, only included when non-empty — #2329).
- **Neutral home:** `ModelStreamChunk.rawStopReason`, sourced directly from `IContent.metadata.stopReason`/`finishReason` via `toModelStreamChunk`. The `Candidate` extension and `setProviderStopReason`/`getProviderStopReason` helpers are deleted.
- **Behavior to preserve (#2329):** the `Finished` event must still carry `stopReason` (and only when present/non-empty) so consumers can distinguish a refusal from a generic stop.

### 6.2 `hookToolRestrictions`

- **Data carried:** `allowedToolNames: string[]` and `hadFilteredRestrictedCalls: boolean`, associated with a response and with individual function calls.
- **Attachment mechanism (current):** `WeakMap<GenerateContentResponse, string[]>` + `WeakMap<GenerateContentResponse, boolean>` + `WeakMap<FunctionCall, string[]>`, plus non-enumerable `Symbol` props as a serialization-surviving fallback (`hookToolRestrictions.ts:15-35`, `setResponseRestrictionMetadata`, `setResponseFilteredMetadata`, `setHookRestrictedAllowedToolsOnFunctionCall`). `attachHookRestrictedAllowedTools` clones the response, filters `candidates[].content.parts[]` + `functionCalls` + `automaticFunctionCallingHistory`, and re-stamps.
- **Read:** `getHookRestrictedAllowedTools(response)`, `hasFilteredHookRestrictedToolCalls(response)`, `getHookRestrictedAllowedToolsForFunctionCall(fnCall)` — consumed in `StreamProcessor`, `TurnProcessor`, `turn.ts`, and copied onto `ModelStreamChunk.hookRestrictions` in `streamChunkWrapper.ts`.
- **Neutral home:** `HookRestrictions` on `ModelStreamChunk` (`modelEnvelope.ts` — already exists and already populated by `streamChunkWrapper`). Tool filtering moves to `ContentBlock[]`/`ToolCallBlock` filtering (`turn.ts.filterBlocksByAllowedTools` already exists and is block-based). The WeakMaps/Symbols and the response-cloning are deleted; restriction metadata rides *explicitly* on the chunk and on `ToolCallRequestInfo.hookRestrictedAllowedTools` (already set in `turn.handlePendingFunctionCall`).
- **Behavior to preserve:** (a) **hook JSON wire compatibility** — the before/after-model and tool-selection hook payloads and the `Finished`/`ToolCallRequest` events must be byte-compatible; (b) **tool-filtering semantics** — a restricted tool call is dropped from emitted tool calls, from AFC history, and the `hadFilteredRestrictedCalls` flag is set when any call was filtered; (c) canonicalization via `canonicalizeToolName` (currently used in both the Google-part and block paths).

---

## 7. Behavioral Contracts That Must Be Preserved

These are the observable behaviors a later test suite must pin (evidence in the current code):

1. **Stream event ordering.** `RETRY` emitted before a retried attempt's chunks; `AGENT_EXECUTION_STOPPED` / `AGENT_EXECUTION_BLOCKED` handled with correct terminal/continue semantics (`TurnProcessor._runStreamAttempt`; `turn.dispatchStreamEvent`). `StreamEventType` enum ordering/labels are public (`chatSessionTypes.ts`).
2. **History commit points.** History is committed in `StreamProcessor._finalizeStreamProcessing` **after** the stream loop completes (`recordHistoryWithUsage`), so **turn-level retry must not duplicate history** (`TurnProcessor._createStreamGenerator` retry loop). The non-stream path commits in `TurnProcessor._commitSendResult`.
3. **Tool dispatch.** `turn.handlePendingFunctionCall` builds `ToolCallRequestInfo` (callId synthesis when id missing, `undefined_tool_name` fallback, `normalizeToolName`, `hookRestrictedAllowedTools` propagation).
4. **Retry / refusal semantics.**
   - **#2150 mid-stream transient retry:** `shouldRetryStreamAttempt(error, params, attempt)` (`turnAbortHelpers.ts`) governs turn-level retry; abort must not be retried (`TurnProcessor`).
   - **#2329 refusal notice:** `stopReason` surfaced on `Finished` when present (`turn.emitFinishReason`); `providerStopReason` mapping preserved.
5. **Thinking / thoughtSignature.** `ThinkingBlock` (`thought`, `signature`, `sourceField`, `isHidden`) round-trips; `include-thoughts` gating in history recording (`TurnProcessor._recordOutputContent` filters thought parts when `reasoning.includeInContext()` is false).
6. **Compression / token accounting.** `CompressionHandler.enforceProviderContents`, `trackPromptTokens`, `syncTotalTokens`, `lastPromptTokenCount` (`StreamProcessor`, `TurnProcessor._syncTokenCounts`).
7. **Abort / idle-timeout handling.** First-response watchdog + inter-chunk idle watchdog (`turn.acquireFirstStreamEvent`, `consumeStreamEvents`, `nextStreamEventWithIdleTimeout`); `TurnProcessor` abort-driven `sendPromise` resolution; `TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE`.
8. **AFC handling.** `automaticFunctionCallingHistory` sliced against curated history and recorded, with hook-restriction filtering (`TurnProcessor._recordAfcHistory`, `_commitSendResult`).
9. **Hook decisions.** Before-model (stop/block/modify), after-model (stop/block/modify), and before-tool-selection (allowed-function filtering) semantics (`StreamProcessor._fireBeforeModelHook`, `_processAfterModelHook`, `_applyToolSelectionHook`; `beforeModelHookDecision.enforceBeforeModelHookDecision`).
10. **Invalid-stream retry.** `InvalidStreamError`/`EmptyStreamError` classification and `INVALID_CONTENT_RETRY_OPTIONS` (`chatSessionTypes.ts`; `StreamProcessor`, `TurnProcessor`).
11. **Public event shape.** `ServerAgentStreamEvent` union (`Content`, `Thought`, `ToolCallRequest`, `Finished` with `{reason, usageMetadata, outcome, stopReason?}`, `Citation`, `Retry`, `Error`, `UserCancelled`, `StreamIdleTimeout`, `AgentExecutionStopped/Blocked`) — core-owned in `packages/core/src/core/turn.ts`, must not change. **Note the two distinct usage-metadata paths in §7A: `ServerFinishedEvent.value.usageMetadata` is neutral `UsageStats` (`packages/core/src/core/turn.ts:241-252`), but `ServerUsageMetadataEvent` (`packages/core/src/core/turn.ts:221-228`) and the API adapter's `FinishedValue.usageMetadata` are Google-named (`promptTokenCount`…). The public event shape MUST NOT silently change; §7A defines whether the Google-named path is an explicit legacy exception or is bridged.**
12. **Model-output text consolidation.** Adjacent model-output text is merged before history recording (`ConversationManager._consolidateModelOutput`, `:330-345`, via `appendTextContentParts`, `:34-40`, and `hasTextContent`, `MessageConverter.ts:320-333`), and thought content is filtered out of recorded history when `reasoning.includeInContext()` is false while thinking blocks are extracted for their dedicated slot (`ConversationManager._recordOutputContent`, `:272-282`). The neutral target must preserve both behaviors on `ContentBlock[]`: consolidate adjacent `TextBlock`s (same merge boundaries), route thought content through `ThinkingBlock` (drop from history text by config, retain signature/`sourceField`), and expose no `.parts` mutation. This is behavior to preserve, not just a signature retype.

### 7A. Public-contract usage metadata — the Google-named event path (decision required)

The pipeline exposes usage metadata on **multiple** public/telemetry paths with **different shapes**, and the migration must not conflate them or silently leave a Google-named type in a "neutral agents" pipeline:

| Path | Shape | Google-shaped? | Evidence |
|------|-------|----------------|----------|
| `ServerFinishedEvent.value.usageMetadata` (emitted value) | `UsageStats` (neutral: `promptTokens`/`completionTokens`/…) | **No** | `packages/core/src/core/turn.ts:241-252`; emitted verbatim by `packages/agents/src/core/turn.ts:293-310`, `:399-406` (`usageMetadata: chunk.usage`) |
| `ServerUsageMetadataEvent.value` | `{ promptTokenCount?, candidatesTokenCount?, totalTokenCount?, cachedContentTokenCount? }` | **Yes** (Gemini field names) | `packages/core/src/core/turn.ts:221-228` (**core-owned**; the agents-package `turn.ts:221-228` is unrelated constructor/debug code) |
| API adapter `UsageMetadataValue` + `FinishedValue.usageMetadata` (declared/validated type) | `{ promptTokenCount?, candidatesTokenCount?, totalTokenCount?, cachedContentTokenCount? }` | **Yes** (Gemini field names) | `packages/agents/src/api/event-types.ts:32-41`; `event-schema.ts:30-39` |
| Telemetry `logApiResponse(usageMetadata)` (serialized to telemetry) | `GenerateContentResponseUsageMetadata` (raw `@google/genai`) spread into telemetry | **Yes** (Gemini type + field names) | `packages/agents/src/core/turnLogging.ts:12-16`, `:85-104`; fed the synthetic response's `usageMetadata` at `TurnProcessor.ts:407-415`, `StreamProcessor.ts:745-753`, `DirectMessageProcessor.ts:198-206` |

So the declared API adapter type/schema describes usage metadata with **Gemini field names** even though the neutral `Finished` event carries `UsageStats`. `ServerUsageMetadataEvent` is a separate public event that is Gemini-named at its core.

**Emitter inventory for `ServerUsageMetadataEvent` / `AgentEventType.UsageMetadata` — the event is NOT emitted in production (legacy/dead on the emit path).** A sweep for any production construction of the `AgentEventType.UsageMetadata` (`'usage_metadata'`) event finds **zero** emitters under `packages/agents/src` and `packages/core/src`:

| Site | Role | Emits the event? |
|------|------|------------------|
| `packages/core/src/core/turn.ts:222` | **Type/enum definition** of `ServerUsageMetadataEvent` (`AgentEventType.UsageMetadata = 'usage_metadata'`, `:55`); part of the `ServerAgentStreamEvent` union (`:302`) | No (declaration only) |
| `packages/agents/src/api/eventAdapter.ts:267-269` | **Consumer/forwarder** — `case AgentEventType.UsageMetadata: yield { type:'usage', usage: e.value }` | No (forwards an incoming event; never originates one) |
| `packages/a2a-server/src/agent/task-support.ts:136` | **Consumer** — lists `AgentEventType.UsageMetadata` in `SILENT_TYPES` (log-only, no task-state effect) | No (defensive consumer handling) |
| `packages/agents/src/api/__tests__/helpers/eventHarness.ts:108` | **Test helper** — `return { type: AgentEventType.UsageMetadata, value: usage }` | Only in tests |

**Finding: the `ServerUsageMetadataEvent` path is legacy/dead in production — no production code path yields it; the only producer is a test harness.** This sharpens the §7A option decision: because nothing emits `ServerUsageMetadataEvent` today, migrating or removing it (option B) has **no production emit-path impact** (only the declared type, the verbatim adapter forwarder, and defensive consumers change), whereas keeping it Gemini-named (option A) preserves a public type that is currently never populated by the agent loop. The *live* Gemini-named surface that actually matters is therefore the API `FinishedValue.usageMetadata` declared type (fact 2 below) and the telemetry `logApiResponse` usage (the fourth surface), not the `UsageMetadata` event.

**Three separate facts about this boundary — the declared public type and the actually-emitted runtime value disagree:**

1. **The core/agents `Finished` event carries neutral usage.** `ServerFinishedEvent.value.usageMetadata` is typed `UsageStats` (`packages/core/src/core/turn.ts:241-252`), and the agents turn loop emits it verbatim: `Turn.emitFinishReason` yields `AgentEventType.Finished` with `usageMetadata: chunk.usage` where `chunk.usage` is neutral `UsageStats` (`packages/agents/src/core/turn.ts:399-406` supplies it; `:293-310` emits `value.usageMetadata: usageMetadata` unchanged).
2. **The API `FinishedValue`/`UsageMetadataValue` is DECLARED and VALIDATED Gemini-named.** `UsageMetadataValue` (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`/`cachedContentTokenCount`) and `FinishedValue.usageMetadata?: UsageMetadataValue` are declared at `packages/agents/src/api/event-types.ts:32-41` and validated by the matching zod schema at `packages/agents/src/api/event-schema.ts:30-39`.
3. **The current API adapter performs NO usage conversion — it forwards the core finished value verbatim.** The adapter's `Finished` case casts only `e.value as { reason: string; stopReason?: string }`, stores it as `state.lastFinished`, and `makeDone` spreads it onto `done.finished` unchanged (`packages/agents/src/api/eventAdapter.ts:317-323`, `:229-235`); it never maps `UsageStats` fields (`promptTokens`/`completionTokens`) to `UsageMetadataValue` fields (`promptTokenCount`/`candidatesTokenCount`). The only direct usage-event forwarding is likewise verbatim: `AgentEventType.UsageMetadata` yields `{ type:'usage', usage: e.value }` unchanged (`eventAdapter.ts:267-270`).

The consequence: **the declared public API type/schema (Gemini-named) and the runtime value the adapter actually emits (neutral `UsageStats`) disagree whenever usage is present.** There is no existing seam that converts `UsageStats` → Gemini-named keys on the `Finished` path; if the public wire is to be Gemini-named, that mapping **must be implemented** at the adapter, not assumed to exist.

**Target decision (planner must pick ONE explicitly; the plan should state the chosen option and reconcile it with §9.1):**

- **(A) Legacy public-wire exception.** Keep `ServerUsageMetadataEvent` and the API `UsageMetadataValue` Gemini-named as a *documented public compatibility exception*. Because the runtime value is currently neutral (fact 3), this option requires **implementing** the `UsageStats` → Gemini-named mapping at the API/CLI boundary so the emitted value matches the declared type. Agents internal state stays neutral; the Gemini names exist only on the serialized public event. This exception must be explicitly listed in §9.1 so "zero Google-shaped types in agents" is understood to *exclude this named public wire event by design*.
- **(B) Migrate to `UsageStats`.** Rename the declared event/adapter fields to the neutral `UsageStats` keys — a **public breaking change** for any consumer reading `promptTokenCount` off `UsageMetadata`/`Finished`; requires coordinated CLI update. This is the option that makes the declared type match the currently-emitted neutral runtime value.
- **(C) Bridge at the boundary — a REQUIRED new adapter mapping, not an existing seam.** Agents emits neutral `UsageStats`; a thin CLI/API serialization adapter is **added** to map neutral `UsageStats` → the Gemini-named public shape only at the outermost edge, keeping the internal event neutral while preserving the external wire. This mapping does not exist today (fact 3); the current adapter forwards the neutral value unchanged, so option C means writing the missing converter at `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases (or a dedicated boundary mapper).

This document does not decide between (A)/(B)/(C) — that is a maintainer/planner call — but it **removes the ambiguity**: whichever is chosen, the Gemini-named `ServerUsageMetadataEvent`/`UsageMetadataValue` must be named as an explicit, bounded exception (A/C) or a public change (B), not silently exempted; and options A and C both require a new `UsageStats`→Gemini-named mapping to be written, since none exists today. Cross-referenced by acceptance §9.1-2b, OQ-2u, and the runtime-shape characterization question OQ-2v.

**Telemetry response-usage is a fourth Gemini-named surface (distinct from the public event).** `logApiResponse` accepts `usageMetadata?: GenerateContentResponseUsageMetadata` (raw `@google/genai`) and spreads it (`{ ...usageMetadata }`) into `runtimeContext.telemetry.logApiResponse` (`turnLogging.ts:85-104`); its callers pass the synthetic response's Gemini-named `usageMetadata` (`TurnProcessor.ts:407-415`, `StreamProcessor.ts:745-753`, `DirectMessageProcessor.ts:198-206`). After a raw-import type-swap this Gemini-named usage could persist in telemetry without any SDK import. Disposition: `logApiResponse` must accept **neutral `UsageStats`** (or an explicitly documented telemetry wire DTO). If telemetry intentionally preserves Gemini-named field names for downstream consumers, that is a **bounded telemetry-serialization exception** covered by the same usage-metadata gate (§8(h)) — the Gemini usage keys are then permitted only inside `turnLogging.ts`'s serialization boundary, converted from neutral `UsageStats` at that edge, and banned everywhere else in the loop. Inventoried in §2A.4-II(h); see OQ-3t.

---

## 8. Enforcement Gate Requirements (functional description)

The existing gate (`scripts/genai-import-inventory.ts`) is a **shrink-ratchet on the raw `@google/genai` module specifier only** (`GENAI_IMPORT_PATTERN = /['"`]@google\/genai['"`]|.../`). It classifies importers by path prefix and diffs against `dev-docs/genai-import-baseline.md`. It **cannot** detect aliasing, re-declared enums, or structural literals — which is precisely why #2424 went green while staying Google-shaped.

A gate that would have caught #2424 must mechanically detect, under `packages/agents/src` **production** files (excluding `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*`):

> **Detection must be AST-aware, not bare-name grep.** Checks (b), (c), and (g) below are expressed in terms of **import specifiers** and **type-alias/type-reference nodes bound to the banned modules**, and checks (e)–(h) in terms of **structural AST patterns** — NOT a naive substring grep on identifiers. A bare-name grep on `Content`/`Type`/`Schema`/`Tool` would false-positive on legitimate neutral/domain names (`ContentBlock`, `ToolDeclaration`, `JsonSchema`, `ContentMetadata`, `ToolChoice`, public content/event types). The gate should therefore parse each production file and match: (i) import specifiers imported/aliased from a banned module (`@google/genai`, `core/clientContract`, `llm-types/geminiContent`), and (ii) the specific structural literal/call patterns below. This is why the existing `scripts/genai-import-inventory.ts` (a module-specifier regex) is insufficient and a parser-based gate is required.

> **Exemption mechanism — a central, versioned allow-list is the single AUTHORITATIVE source of truth (decided, not open).** Every bounded exception below (the hook-wire `toGeminiContents` adapter, the usage-metadata boundary modules, any telemetry-serialization exception, any bounded external-wire `.parts` adapter) is granted **only** by an entry in one central, version-controlled gate allow-list artifact — never by an inline comment in production code. This is deliberate: an inline `// gate-exempt`-style marker is the same class of local escape hatch the project forbids (new suppression/escape-hatch directives), it is hard to audit, and it can spread silently. The authoritative capability is therefore: **(1)** a central allow-list file lists, per exemption, the **exact file**, the **AST-context pattern** that is permitted (matching §8(g)/(h) structural context, not a bare line number), and a **written justification**; **(2)** the AST-context match of §8(g)/(h) is the actual enforcement that grants the exemption; **(3)** any inline breadcrumb, if present at all, is a purely secondary human-readable marker that **does NOT grant the exemption** — removing or omitting it changes nothing about what the gate permits, because the allow-list entry + AST context are authoritative. A structural hit with no matching central allow-list entry fails the gate regardless of any inline comment. Because the allow-list is a versioned, reviewable artifact, every structural exception is visible in one place. (This is a target-state enforcement *capability*, not a CI wiring or file-naming prescription.)

- **(a) Any `@google/genai` import** (the existing check — retained; target count for agents production = **0**).
- **(b) Import or alias of legacy Google payload symbols from a banned module** — the banned exact names `Part`, `Content`, `PartListUnion`, `PartUnion`, `GenerateContentResponse`, `GenerateContentConfig`, `FinishReason`, `FunctionDeclaration`, `FunctionCall`, `Tool`, `Schema`, `Type`, `SendMessageParameters`, `Candidate`, `GoogleGenAI`, `ApiError`, `GenerateContentResponseUsageMetadata`, `createUserContent` matter **only** when they are (i) **imported from a banned module** (`@google/genai`, `core/clientContract`, `llm-types/geminiContent`) — e.g. `import { Content }`, `import { Part as X }`, `import { Type }`; (ii) **aliased from a banned imported symbol** — e.g. `type MyContent = Content` where `Content` resolves to a banned import; or (iii) **structurally re-declaring the Google payload/enums** (a local `type`/`interface`/`enum` whose shape reproduces the Gemini `Content`/`Part`/response envelope or the Gemini enum string values — caught structurally by checks (e)/(f)). Matched as `ImportSpecifier`/`ImportClause` name-or-alias bound to a banned module, or a `TypeReference`/`type X = ...` resolving to such an import. **Explicitly NOT matched — do not ban arbitrary local/domain identifiers by name:** a locally-declared or domain-owned `Content`/`Type`/`Schema`/`Tool` that is neither imported from a banned module nor structurally Google-shaped is allowed, as are the neutral names `StreamEventType`, `ContentBlock`, `ToolDeclaration`, `ToolChoice`, `JsonSchema`, `ContentMetadata`, and public content/event types. The gate keys on the import binding / structural shape, never on a bare identifier substring. (Real Google runtime `Type` imports to catch are specific: `agents/executor-tool-dispatch.ts:19`, `core/subagentRuntimeSetup.ts:25-30`.)
- **(c) Import or alias of Google-shaped `Contract*` payload types** (import-specifier / type-alias match, per the AST rule above): `ContractPart`, `ContractContent`, `ContractContentUnion`, `ContractPartListUnion`, `ContractPartUnion`, `ContractGenerateContentResponse`, `ContractGenerateContentConfig`, `ContractSendMessageParameters`, `ContractUsageMetadata`. (The neutral *surface* interfaces `AgentClientContract`/`AgentChatContract` are allowed **only after** their signatures are migrated.)
- **(d) Presence of the round-trip symbols**: `sdkTypeBridge`, `convertIContentToResponse`, `streamChunkWrapper`, `responseToModelStreamChunk`, `chunkToParts`, `providerStopReason`, `setProviderStopReason`, `getProviderStopReason`.
- **(e) Local re-declaration of `Type` or `FinishReason` enums with Google string values** (e.g. `enum FinishReason { STOP = 'STOP', ... }` or an object literal with the uppercase Gemini enum values) — the #2424 runtime-enum trick.
- **(f) Structural construction of Google envelopes** — the structural check that distinguishes *shape* from provenance (§1.3). A naive "ban any `candidates:` literal / any `parts:` literal" rule is **simultaneously too broad and too narrow** and MUST NOT be used:
  - **Too broad (false positives to exclude):** the repo has unrelated domain `candidates` identifiers that are NOT Gemini envelopes — `CompressionLoadBalancingProvider.ts:34` (`private readonly candidates: readonly CompressionLoadBalancerCandidate[]`), `CompressionProfileResolver.ts:401` (`const candidates: CompressionLoadBalancerCandidate[]`), `api/control/profilesControl.ts:392` (`const candidates: PublicProfileCandidate[]`). A bare `candidates:` ban would flag all three legitimate non-Gemini sites.
  - **Too narrow (must also catch):** generic structural `parts` mutation with **no `role`** — e.g. `executor-prompt-builder.ts:47-58` mutates `content.parts` on a message typed only `T extends { parts?: … }` and returns `{ ...content, parts: newParts }`, with **zero `@google/genai` import** (the pure #2424-structural case, §2A.4-I(e)).

  **Concrete AST patterns the gate matches (Gemini-envelope, not unrelated candidates):**
  1. **`candidates` array literals whose elements structurally contain `content` with `role`/`parts`** — i.e. an object literal with a `candidates:` array property **whose element objects have a nested `content` object bearing `role` and/or `parts`** (`{ candidates:[{ content:{ role, parts } }] }`). A `candidates:` property whose element type is anything else (a `*Candidate[]` domain array, an empty `[]` typed as a non-Gemini type) does **not** match. This catches `MessageConverter.ts:518-543`, `DirectMessageProcessor.ts:684-699`, `streamRequestHelpers.ts:166-169`, and the `{role:'model',parts:[]}` fallbacks (§2A.4-I(a)/(d)) while sparing the compression/profile candidates.
  2. **`GenerateContentResponse` casts / type annotations** — any `as GenerateContentResponse`, `: GenerateContentResponse`, or a variable/return typed to it (covers `_buildBlockingSyntheticResponse`'s `getSyntheticResponse() as GenerateContentResponse` even though its inline literal is caught by pattern 1).
  3. **`{ role: 'user'|'model', parts: … }` message literals** — an object literal with a `role` string-literal property (`'user'`/`'model'`) **and** a `parts` property (the Gemini `Content` shape). This catches §2A.4-I(b)/(c)/(e) message builders.
  4. **Object literals passed to known Google-shaped APIs** (until those APIs are neutralized) — a `{ …parts… }` / `{ …candidates… }` literal passed as an argument to `addHistory(`, `setHistory(`, `storeHistoryForLaterUse(`, `resumeChat(`, `filterHookRestrictedContent(`, `filterHookRestrictedContents(`, `toIContent(`, `toGeminiContent(s)(`. This catches `loopHelpers.ts:111,114` (`addHistory({role,parts})`), the `filterHookRestrictedContent(… ?? {role:'model',parts:[]})` fallbacks, and history-record builders, *by call context* — so the gate flags them even where the literal itself is minimal.
  5. **Generic structural `parts` mutation** — a function/expression that reads or reconstructs a `.parts` array on a value typed only structurally (`T extends { parts?: … }`, `content.parts`, `{ ...x, parts: … }`) and is **not** operating on a neutral `IContent`/`ContentBlock[]` (which uses `.blocks`, never `.parts`). This is the `executor-prompt-builder.ts:47-58` case. Because neutral types never expose a `parts` member, any production `.parts` read/write is a structural-Gemini signal; the gate treats it as a hit unless the value is provably a bounded external-wire adapter (see allow-list). See **OQ-12** for whether `executor-prompt-builder.ts` is retyped or bounded.

  The distinguishing rule is: **match on the Gemini `Content`/`Candidate`/response *structure* (`role`+`parts`, `candidates[].content`, or a bare `.parts` on non-neutral values), or on a Google-shaped API call context — never on the bare identifier `candidates`/`parts` in isolation.**
- **(g) Structural-converter call expressions & barrel-`Gemini*` imports (NEW — closes the #2424 *structural* bypass, §2A).** Match, as call expressions, the **neutral → Gemini** converters used as agents' internal currency: `ContentConverters.toGeminiContent(` and `ContentConverters.toGeminiContents(`. Also match imports of the barrel-exported structural Gemini types `GeminiContent`, `GeminiContentPart`, `GeminiFunctionCall` from `llm-types/geminiContent` (directly or via the `llm-types` barrel). Because these produce/consume the Gemini `{role,parts}` shape without a raw `@google/genai` import (they flow through the neutral barrel, `llm-types/index.ts:38`), (a)/(b) alone would miss them.
  - **Bounded allow-list (must be AST-context-aware, NOT file/line/comment-based):** the allow-list must match on the *AST context of the call*, not merely the file or a line number, because `streamRequestHelpers.ts` contains **both** a possibly-legitimate hook-wire adapter call (`:228`) **and** a telemetry offender (`:281`, `logOutgoingRequest`) — a file-level or line-level exemption would either wrongly permit `:281` or be brittle to line drift. The **only** permitted `toGeminiContents` call is the before-model hook-wire adapter's `target.contents` construction where the converted contents are immediately re-entered as neutral `IContent[]` via `ContentConverters.toIContents(...)` within the same adapter function (§2A.2 G3, `streamRequestHelpers.ts:226-249`: `target.contents = toGeminiContents(requestContents)` at `:228`, `toIContents(modifiedContents)` at `:239`) — and only *if* option OQ‑1a keeps that wire Gemini-shaped. The gate must verify this structural context: (a) the call result flows into a `contents` property of a `target`/request object passed to `applyLLMRequestModifications`, and (b) the same function converts the modified result back via `toIContents`. **Every other `toGeminiContents` call — including `streamRequestHelpers.ts:281` (telemetry) and G1, G2, G4–G7 — stays banned**, even though `:281` is in the same file as the permitted `:228`. `toGeminiContent` (singular) has no allowed site in agents production. The permission for this single adapter is granted **only** by its entry in the central allow-list artifact (per the exemption-mechanism note above), which records the file, the required AST context (the `target.contents = toGeminiContents(...)` → `applyLLMRequestModifications` → `toIContents(...)` round-trip within one function), and the justification; the AST-context match is authoritative. No inline comment grants the exemption — an inline breadcrumb, if any, is purely a secondary human-readable marker.
- **(h) Gemini-named public usage-metadata fields inside the agent loop (NEW, §7A).** Match object literals / type members using the Gemini usage-metadata keys `promptTokenCount`/`candidatesTokenCount`/`cachedContentTokenCount`/`totalTokenCount` in agents **core-loop** files, and ban them in the internal loop. Permit them **only** in the following designated boundary modules, and only if §7A option (A) or (C) is chosen:
  - `packages/agents/src/api/event-types.ts` and `packages/agents/src/api/event-schema.ts` — the declared public API `UsageMetadataValue`/`FinishedValue` type and schema.
  - the **specific adapter mapper once implemented** — the `UsageStats`→Gemini-named converter added at `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases (or a dedicated boundary mapper) under §7A option (A)/(C). This module does not exist today (§7A fact 3); once written, its exemption is recorded as a central allow-list entry (per the exemption-mechanism note), not an inline marker.
  - `packages/agents/src/core/turnLogging.ts` — **only** if the telemetry-serialization exception (§7A telemetry note, §2A.4-II(h), OQ-3t) elects to keep Gemini-named usage keys in telemetry; converted from neutral `UsageStats` at that edge.

  Everywhere else in agents production, the Gemini usage keys are banned. This prevents the Google-named usage event from silently re-entering agents' internal state.

  > **Scope caveat — the offending public event type `ServerUsageMetadataEvent` is CORE-owned, not agents-owned.** `ServerUsageMetadataEvent` is defined Gemini-named at `packages/core/src/core/turn.ts:221-228` (part of the core `ServerAgentStreamEvent` union at `:302`), and agents merely imports it (`packages/agents/src/core/turn.ts:189`). The #2349 agents-scoped gate **cannot** enforce or rewrite this core-owned type — a gate scoped to `packages/agents/src` will never see `core/turn.ts`. Two options, and the plan must state which applies:
  > - define a **second, core-package check** for `packages/core/src/core/turn.ts` (and any future core public-event usage types) that applies the same key ban with the same boundary exceptions; **or**
  > - state plainly that the #2349 agents gate **does not and cannot** enforce the core-owned `ServerUsageMetadataEvent`, and that this decision (rename to `UsageStats`, keep as legacy public wire, or bridge) is tracked in the cross-package contract migration (OQ-8 gate-scope, tied to §7A/OQ-2u).
  > Either way, §9.1-2b must not read as if an agents-only gate mechanically enforces the core-owned event — it does not.

As a target-state enforcement capability, a mechanical check must be able to detect every hit above and distinguish it from an allow-listed exemption, failing on any non-exempt hit with a clear per-hit message. The pre-existing shrink-ratchet baseline for agents (`dev-docs/genai-import-baseline.md`) reaching zero is part of the target-state acceptance (§9.1-1). (Sequencing and job wiring are for the later implementation plan, not this map.)

### 8.1 Test-file enforcement policy (separate, narrower gate)

The core gate above is scoped to **production** files (`packages/agents/src`, excluding `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*`). Test files therefore need a **separate, narrower test gate** so that acceptance §9.1-9 ("agent-loop tests do not assert `GenerateContentResponse`/`{candidates}` internals") is mechanically enforceable and internally consistent with the production-only core gate. Without it, the two statements can only coexist by prose. The test gate:

- **Bans, in agents test files:** construction of `GenerateContentResponse` (raw import, `as GenerateContentResponse` casts, `{ candidates:[{ content:{ role, parts } }] }` fixtures) and `mockResponseToChunk({candidates:...})`-style Gemini-fixture stream builders — i.e. the same structural patterns as core check (f), applied to test files.
- **Allows, via the same central allow-list artifact (§8 exemption-mechanism note):** the converter/boundary characterization tests inventoried in §3.3-A that intentionally assert Gemini structural compatibility at a boundary that persists (`boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts`), plus the hook-wire fixture tests whose fate follows OQ-1a/OQ-1c (`chatSession.hook-control.test.ts`, `chatSession.issue1749.test.ts`) *if* the hook wire stays Gemini-shaped. Each allow-listed test is granted its exemption **only** by a central allow-list entry (file + justification), not by an inline comment — consistent with the production gate's single exemption strategy, so the exemption cannot silently spread.
- **Scope reconciliation:** production files → §8 core gate (a)–(h); test files → §8.1 test gate. Acceptance §9.1-9/-10 references both. This closes the §8-vs-§9 inconsistency where the production-scoped gate could not enforce the "no fabricated `{candidates}` in tests" acceptance bullet.

> **OPEN QUESTION (gate scope):** whether checks (b)–(h) apply repo-wide eventually (umbrella #2343) or agents-only for #2349. This document scopes them to `packages/agents/src` production for #2349 (plus the §8.1 test gate for agents tests); cross-package `Contract*` removal (§4) will separately clear CLI/core.

---

## 9. Acceptance Criteria & Open Questions

### 9.1 Target-state constraints / acceptance-relevant invariants

These are the architectural end-state checks the migration must satisfy — not a task list, sequence, or schedule. Each is phrased as a verifiable invariant of the target state.

1. **Zero raw `@google/genai` imports** in `packages/agents/src` production files (verify: `grep -rl "@google/genai" packages/agents/src | grep -v test` ⇒ empty; agents owner count in `dev-docs/genai-import-baseline.md` ⇒ 0).
2. **Zero Google-shaped types in the agents pipeline** — no imported/aliased Google names, no aliased Google-shaped `Contract*` payload types, no re-declared `Type`/`FinishReason` enums, and **none of the structural surface inventoried in §2A.4** remains. That surface has two parts: the construction sites of §2A.4-I (3 synthetic-response `{candidates}` fabricators, 5 contract/public `{role,parts}` builders, 6 history/write-path `Content` builders, 5 hook fallback/restriction adapters, and 7 subagent/executor structural sites including the raw-import-free `executor-prompt-builder.ts` generic `.parts` mutator), and the access/mutation sites of §2A.4-II (20 `.parts`/`candidate.content` reader/mutator sites (f) — including the `ConversationManager` merge/consolidation logic, the stateless-helper `clientLlmUtilities` reads, the `MessageStreamOrchestrator` pending-tool-call read, both `DirectMessageProcessor` text extractors, the `MessageConverter` `isValidContent`/`extractCuratedHistory`/`hasTextContent` validators, the `streamResponseHelpers` accumulate read, the `TurnProcessor._recordOutputContent` parts read/gate, the `hookToolRestrictions.filterHookRestrictedContent` mutator, and the DELETE-file `streamChunkWrapper.responseToIContent` reconstruction; 4 `(content.parts?.length ?? 0) > 0` AFC filters (g); and 5 internal Google-named usage-key sites (h) including the `turnLogging.ts` telemetry surface). Verify via the §8 gate checks (a)–(h), where (f) matches the Gemini `Content`/`Candidate` *structure* (role+parts, `candidates[].content`, bare `.parts` on non-neutral values) and Google-shaped API call contexts — **not** the bare identifiers `candidates`/`parts` (which false-positive on the domain candidates at `CompressionLoadBalancingProvider.ts:34`, `CompressionProfileResolver.ts:401`, `profilesControl.ts:392`) — (g) matches the AFC/content-length filters and the structural-converter call expressions, and (h) matches the Google-named usage keys. Acceptance cannot pass while any §2A.4-II site remains (except the bounded telemetry-serialization exception in `turnLogging.ts` if §7A/OQ-3t elects to keep Gemini-named telemetry keys confined there).
2a. **Zero structural-Gemini-content flow as internal currency (§2A)** — no `ContentConverters.toGeminiContent(...)` calls, and no `ContentConverters.toGeminiContents(...)` calls in agents production **except** the single documented hook-wire adapter (§2A.2 G3) *if and only if* §7A/OQ‑1a keeps that wire Gemini-shaped and it is recorded as a central gate allow-list entry (§8 exemption-mechanism note); no imports of `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall` (barrel or direct). The `toGeminiContents` sites G1/G2 vanish with the contract migration (§4); G4–G7 are deleted (telemetry/internal). Verify via §8 gate check (g).
2b. **Public usage-metadata decision applied (§7A)** — the Gemini-named `ServerUsageMetadataEvent` / API `UsageMetadataValue` are either (A) an explicitly-documented legacy public-wire exception converted at the boundary, (B) migrated to `UsageStats`, or (C) bridged at the outermost edge — and in cases (A)/(C) the Gemini-named usage keys appear **only** in the designated boundary modules (`api/event-types.ts`, `api/event-schema.ts`, the specific adapter mapper once implemented, and — under the OQ-3t telemetry exception — `core/turnLogging.ts`), never in the internal loop (verify via §8 gate check (h)). "Zero Google-shaped types in agents" does not silently exempt this public event. **Scope limitation (not mechanically enforceable by the agents gate):** `ServerUsageMetadataEvent` is core-owned (`packages/core/src/core/turn.ts:221-228`), so the agents-scoped §8 gate cannot enforce or rewrite it; that decision is either enforced by a separate core-package check (§8(h) scope caveat) or tracked in the cross-package contract migration (OQ-8). This invariant governs the *agents-owned* API `UsageMetadataValue`/adapter/telemetry surface via check (h); the core-owned event is covered only if the core-package check is added.
3. **No synthetic `GenerateContentResponse` round-trip (streaming AND direct-message)** — `MessageConverter.convertIContentToResponse`, `DirectMessageProcessor._buildBlockingSyntheticResponse` (the pre-provider BeforeModel-block fabricator, §2B.2-3), `streamRequestHelpers.patchMissingFinishReason`'s `{candidates}` literal, `streamChunkWrapper.ts`, and `providerStopReason.ts` are gone; both the streaming pipeline and the non-streaming `DirectMessageProcessor` path (§2B.2) are `IContent → ModelStreamChunk`/`ModelOutput` end to end (**no fabricated response on either path — neither the after-model nor the BeforeModel-blocking site**). A blocking BeforeModel hook yields a neutral `ModelOutput`/hook result (same text/reason), not a `GenerateContentResponse` cast/inline candidate envelope. `TurnProcessor.sendMessage` and `AgentClientContract.generateDirectMessage` return `ModelOutput`.
3a. **Provider metadata needed for AFC is not lost when `convertIContentToResponse` is removed.** Because `toModelStreamChunk` does **not** copy `IContent.metadata.providerMetadata` today (`modelEnvelope.ts:188-210`), the neutralized pipeline must either (i) extend/wrap the neutral chunk conversion to preserve `providerMetadata`, or (ii) promote AFC to a first-class `ModelOutput.afcHistory?: IContent[]`. Either way, `automaticFunctionCallingHistory` recorded via `TurnProcessor._recordAfcHistory` (streaming) and `DirectMessageProcessor` (direct, provider-metadata fallback `:755-764`) must survive the removal of the synthetic response with identical slicing/hook-restriction-filtering semantics (§5.3-3, OQ-2/OQ-15).
3b. **Provider output metadata beyond AFC dispositioned (§5.3-3a).** Gemini `promptFeedback`/`safetyRatings`/`groundingMetadata` (mapped into `ModelOutput.providerMetadata` at `contentGeneratorAdapters.ts:195-210`) and the `responseId`/`usage` currently mapped by `streamChunkWrapper` (`:91-93`, `:125-127`, `:152-153`) are each explicitly **preserved** (chunk/wrapper extended), **ignored by design**, or **kept provider/core-only** — per OQ-16 — rather than silently dropped by the plain `toModelStreamChunk(iContent)` target conversion.
4. **Both side-channels retired** — no `WeakMap`/`Symbol` identity keying for hook restrictions; no bolted-on `Candidate.providerStopReason`. Restriction and stop-reason data ride explicitly on `ModelStreamChunk` (`hookRestrictions`, `rawStopReason`).
5. **`clientContract.ts` neutralized** — Google-shaped payload types (`ContractPart`/`ContractContent`/`ContractGenerateContentResponse`/`ContractSendMessageParameters`/`ContractGenerateContentConfig`/`ContractPartListUnion`/`ContractContentUnion`/`ContractUsageMetadata`) removed; `AgentClientContract`/`AgentChatContract` member signatures retyped to neutral (`IContent`/`ModelOutput`/`ModelGenerationSettings`/neutral request DTO).
6. **No Google shapes pushed into core services or history** — `HistoryService` and other core services remain neutral (0 `@google/genai`, `IContent`-based).
7. **CLI and core consumers migrated** — the 23 CLI + 5 core production consumers of `Contract*` compile against the neutral surface; the build stays green cross-package.
8. **All behavioral contracts (§7) preserved** — event ordering, history-commit-once-per-turn (no retry duplication), tool dispatch, #2150 mid-stream transient retry, #2329 refusal `stopReason`, thinking/thoughtSignature, compression/token accounting, abort/idle-timeout, AFC, hook decisions/restrictions — verified by behavioral tests (not internal-shape assertions).
9. **Tests migrated behaviorally, with a bounded characterization allow-list.** Agent-loop tests (the tests that exercise the streaming/direct pipeline, hooks, retry, history commit, tool dispatch) assert on **observable outputs** — emitted `ServerAgentStreamEvent`s, committed `HistoryService` state, retry ordering, finish/stop reasons — **not** on internal `GenerateContentResponse`/`{candidates}` structure. Because the structural-fixture surface is larger than the 54 raw importers (see §3.3-A: structural `{candidates}`/converter tests exist that do **not** import `@google/genai`), acceptance is stated as: **no agent-loop test asserts `GenerateContentResponse`/`{candidates}` internals**, EXCEPT a small, **explicitly-named** set of converter/boundary characterization tests that intentionally assert Gemini structural compatibility while the boundary exists (dispositioned in §3.3-A and OQ-1d). This is mechanically enforceable via the **separate test gate** in §8 (test policy), which bans `GenerateContentResponse` construction and `{candidates}` fixtures in agents tests **except** in the named allow-list. Acceptance §9 is therefore internally consistent with the production-only scope of the §8 core gate: production files are covered by the §8 core gate (a)–(h); test files are covered by the §8 test gate.
10. **Enforcement gates in place (production + test).** A parser-based **core gate** capability mechanically detects §8 (a)–(h) on `packages/agents/src` production files (including the structural-converter check (g) and the public usage-metadata check (h)), granting exemptions only via the central allow-list artifact (§8 exemption-mechanism note); a **separate, narrower test gate** bans `GenerateContentResponse`/`{candidates}` fixtures in agents test files except the named converter/boundary characterization allow-list (§8.1 test policy). Together they must be able to prevent a future #2424-style name-only **or structural** regression in both production and test code.

### 9.2 Open questions / risks a planner must resolve

- **OQ-1 (request DTO shape):** Exact neutral shape for the turn-level send request replacing `SendMessageParameters` — reuse/extend `ModelGenerationRequest` or add a sibling `AgentGenerationRequest`? (§5.3-2). And the neutral `AgentMessageInput` replacing `PartListUnion` (§5.3-1).
- **OQ-1a (hook wire message shape):** May agents call `ContentConverters.toGeminiContents()` **at all** after #2349? The document's position (§2A.2): **only** at the single before-model hook-adapter (G3) *if* the hook JSON wire (`llm_request.messages`) must stay Gemini-shaped `{role,parts}` for byte compatibility. Confirm whether the hook wire genuinely requires the Gemini message shape or whether a neutral messages shape is acceptable — if neutral is acceptable, G3 is deleted too and the answer is "no, never." This is the boundary module where legacy hook wire serialization is allowed (§2B.1); the agent loop must never use the Gemini shape internally.
- **OQ-1b (converter ownership for lossless legacy input):** Which neutral converter owns **lossless** conversion of legacy input (the `AgentMessageInput` replacing `PartListUnion`), preserving thought signatures, media, tool responses, and tool-call IDs? Candidates: extend `MessageConverter` (signature-preserving, §5.4), `toolCall.toolResultContentFromLegacyPartListUnion` (tool-result sub-case only, no thought handling — §5.4), or a new `llm-types` converter. The chosen converter must not be one of the §5.4 lossy paths (`generateContentResponseUtilities.legacyPartToBlocks`, `toolCall.partLikeToBlock`) on any thinking-bearing path.
- **OQ-1d (converter/boundary tests may remain structural):** The plan must distinguish "**agent-loop** tests must not assert `GenerateContentResponse` internals" from "**converter/boundary** tests may intentionally assert Gemini structural compatibility." Explicit dispositions (§3.3-A): `boundaryRecovery.test.ts:59-62` (round-trips `toGeminiContents`/`toIContents` to pin pending-boundary recovery) and `chatSession.thinking-toolcalls.repro.test.ts:542-563` (asserts `thoughtSignature` on a Gemini `parts` element across the round trip) are **retained** as named converter/boundary characterization tests — they test a boundary that persists (the hook wire / history converter) and are on the §8.1 allow-list. The open item is confirming the final allow-list membership; each entry is recorded in the central allow-list artifact with a written justification (§8 exemption-mechanism note), not an inline comment.
- **OQ-2 (AFC mapping):** How `automaticFunctionCallingHistory` (`Content[]`) maps to neutral — `ModelOutput.afcHistory?: IContent[]` vs `providerMetadata` slot — while preserving `TurnProcessor._recordAfcHistory` slicing semantics (§5.3-3). **This must cover BOTH the streaming path (`TurnProcessor._recordAfcHistory`, `toIContent` sites `TurnProcessor.ts:757,775,808,827`) AND the direct-message path + provider-metadata fallback (`DirectMessageProcessor.getIContentAutomaticFunctionCallingHistory`, `DirectMessageProcessor.ts:99-110`), which reads AFC from `metadata.providerMetadata['automaticFunctionCallingHistory']`.** How is the neutral AFC history typed and filtered (hook-restriction filtering) across both paths?
- **OQ-2u (public usage-metadata target, §7A):** Pick (A) legacy public-wire exception, (B) migrate `ServerUsageMetadataEvent`/API `UsageMetadataValue` to `UsageStats`, or (C) bridge at the CLI/API boundary. **Options (A) and (C) require WRITING a new `UsageStats`→Gemini-named mapper** at `eventAdapter.ts` (or a dedicated boundary module) — no such mapping exists today; the adapter currently forwards the neutral `Finished` value verbatim (§7A fact 3). **Emit-path note (§7A emitter inventory):** `ServerUsageMetadataEvent` has zero production emitters (only `eventHarness.ts:108` constructs it), so option (B) has no production emit-path cost for that event specifically; the live Gemini-named surface is the API `FinishedValue.usageMetadata` declared type and telemetry. Reconcile with acceptance §9.1-2b, and note the core-owned `ServerUsageMetadataEvent` scope limitation (§8(h) scope caveat, OQ-8).
  > **RESOLVED (plan domain-model.md OQ-2u, Critical 1 round 7): COMMITTED UNCONDITIONALLY to option (C).** Option (B) is REJECTED for #2349 because it is a public breaking change that would break the CLI/public-event consumers that read Gemini-named usage keys (`packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts:406`; `packages/cli/src/zed-integration/zedIntegration.ts:614-615`) with no owning migration phase in this plan. The declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type stays Gemini-named (UNCHANGED); the `usageStatsToPublicUsageMetadata` mapper is written at the `eventAdapter.ts` boundary; the internal loop stays neutral `UsageStats`. OQ-2v (below) is therefore RECORDED EVIDENCE only, not a branch selector. Migrating the public usage wire to neutral is deferred to a future coordinated cross-package issue.
- **OQ-2v (runtime shape of `done.finished.usageMetadata` today — characterization required):** The core/agents `Finished` event emits neutral `UsageStats` (`packages/agents/src/core/turn.ts:293-310`, `:399-406`), but the API `FinishedValue.usageMetadata` is DECLARED Gemini-named (`event-types.ts:32-41`, `event-schema.ts:30-39`), and the adapter forwards the value verbatim without conversion (`eventAdapter.ts:317-323`, `:229-235`). **The declared public type and the actually-emitted runtime value therefore disagree when usage is present.** Before choosing §7A option (A)/(B)/(C), a characterization check must establish what consumers currently see on `done.finished.usageMetadata` at runtime — neutral keys (`promptTokens`) or Gemini-named keys (`promptTokenCount`) — since code and declared type conflict. The answer determines whether (A)/(C) is a *fix to align runtime with the declared type* or (B) is a *fix to align the declared type with runtime*.
  > **RESOLVED (plan, Critical 1 round 7): the OQ-2u decision is committed UNCONDITIONALLY to option (C) (see OQ-2u above), so this characterization is RECORDED EVIDENCE only — it does NOT select an option/branch. P18 records the runtime key set to document why the option-(C) mapper is needed; P19 implements option (C) regardless of the observed keys.**
- **OQ-2t (usage-token sync source after neutralization):** After the synthetic response is removed, what does token sync read? Current code reads Gemini-named `usageMetadata.promptTokenCount` at `TurnProcessor.ts:844-850` (`_syncTokenCounts`) and `streamResponseHelpers.ts:149-151` / `:308-314` (streaming accumulator). Specify whether the target reads `UsageStats.promptTokens`, accumulated `ModelOutput.usage`, or `IContent.metadata.usage`, AND how it preserves the current **absent-usage fallback** (`TurnProcessor._syncTokenCounts` falls back to `this.lastPromptTokenCount` when `usageMetadata.promptTokenCount` is undefined; `streamResponseHelpers` finds the last chunk with metadata). The neutral source must retain that fallback so token accounting is not lost when a chunk carries no usage.
- **OQ-3s (stateless helper paths — migrate with contract or bounded legacy adapter):** `generateJson`/`generateContent` (`clientLlmUtilities.ts`, `baseLlmClient.ts`) are not only type consumers; they perform text extraction and `next_speaker` fallback over `Content.parts` (`clientLlmUtilities.ts:61-70`, `:84-92`) and build `{role:'user',parts}` request wrappers (`baseLlmClient.ts:160-161`, `:287-288`). Decide whether these stateless-helper compatibility surfaces migrate with `AgentClientContract` (retyped to neutral `IContent[]`/`ContentBlock[]`) or get a bounded legacy adapter at their public boundary. Governs §2A.4-II(f) `clientLlmUtilities.ts` rows and §4.2 `generateJson`/`generateContent` signatures.
- **OQ-3t (telemetry wire contract, §7A telemetry note / §2A.4-II(h)):** Do telemetry consumers expect Google-named request contents / usage keys, or can telemetry become neutral `IContent[]` + `UsageStats`? `logApiRequest` logs `Content[]` (`turnLogging.ts:63-70`) and `logApiResponse` spreads Gemini-named `GenerateContentResponseUsageMetadata` (`:85-104`). If consumers require the Gemini-named keys, telemetry is a **bounded serialization exception** confined to `turnLogging.ts` (converted from neutral `UsageStats`, recorded as a central gate allow-list entry under §8(h)); otherwise `turnLogging.ts` retypes fully to neutral and the Gemini usage keys are banned there too.
- **OQ-3 (`normalizeToolInteractionInput`):** Does its tool-response-as-user-message packaging need a neutral equivalent, or can callers construct `IContent{speaker:'tool'}` directly? (§5.3-7).
- **OQ-4 (cross-package ordering):** Ordering of `clientContract.ts` neutralization vs agents vs CLI/core so the monorepo build stays green at each step (the surface contract is implemented by agents and consumed by CLI/core, so a big-bang or a carefully-staged shim may be required). Note: this migration **will** touch CLI (23) and core (5) production files.
- **OQ-5 (`MessageConverter` split):** Precisely which functions survive (retyped) vs are deleted. `createUserContentWithFunctionResponseFix`, `isValidResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `convertIContentToResponse` are round-trip-only; `classifyMixedParts`/`convertBlocksToParts`/`convertPartListUnionToIContent` may survive in retyped form or be replaced by core equivalents.
- **OQ-6 (`googlePartHelpers` fate):** DELETE vs NEUTRALIZE — confirm core already provides `ContentBlock[]` equivalents (`getToolCallBlocks`, `getResponseTextFromBlocks`, block-based outcome analysis) for all three helpers before removing (the in-file `@issue #2348` comments assert core migrated them).
- **OQ-7 (`Type`/`FinishReason` runtime values):** `Type` is used as a runtime value in `executor-tool-dispatch.ts` and `subagentRuntimeSetup.ts`; `FinishReason` as a runtime value in `MessageConverter.ts`, `streamRequestHelpers.ts`, `streamResponseHelpers.ts`. These need literal/`CanonicalFinishReason` replacements — verify no external consumer depends on the Gemini uppercase strings.
- **OQ-8 (gate scope):** Whether §8 (b)–(h) apply agents-only for #2349 or repo-wide under umbrella #2343 (§8 note).
- **OQ-9 (`geminiContent.ts` boundary):** Confirm the structural `GeminiContent`/`GeminiContentPart` types in `llm-types` are *only* used at core's history-conversion boundary and never leak into the agents pipeline as the working currency (they are Gemini-shaped per §1.3). **Status (this doc, §2A):** no agents production file references these types by name; the shape enters agents only via the raw `@google/genai` importers (§3) and the `toGeminiContent(s)` call sites (§2A.2). The residual question is whether OQ‑1a's hook-adapter exception is retained.
- **OQ-10 (thoughtSignature converter routing, §5.4):** Ensure model-output conversion routes through a signature-preserving converter (`MessageConverter`/`ContentConverters` block path) and that the lossy converters (`generateContentResponseUtilities.legacyPartToBlocks`, `toolCall.partLikeToBlock`) are either extended to carry `signature` or kept off thinking-bearing paths.
- **OQ-11 (legacy `systemInstruction` inputs, §5.3-8):** Is accepting non-string `Part`/`Content` `systemInstruction` still a public compatibility requirement, or can the neutral contract require **string-only** `systemInstruction` (a documented breaking change)? Governs `baseLlmClient.ts:68` (`string | Part | Part[] | Content`), the text-extraction at `:328-342`, and the `{role:'user',parts:[systemInstruction as Part]}` wrapper at `:333-336` (§2A.4-I(b)). Under string-only, the wrapper and extraction are deleted; under compat, they are retyped onto neutral blocks at the boundary.
- **OQ-18 (Gemini config fields lacking a neutral home, §5.2a):** For Gemini `GenerateContentConfig` fields that could enter the agents surface but lack a clear neutral home — `responseSchema` (vs the mapped `responseJsonSchema`), `responseMimeType` (currently via `modelParams`), `thinkingConfig`/reasoning (mapped to `ReasoningConfig` — confirm coverage), `safetySettings`, and `cachedContent` — decide per field: preserve-via-`modelParams`, promote to an explicit neutral slot, or keep out of scope. Only `thinkingConfig`/`responseJsonSchema`/`responseMimeType` are referenced in agents today (§5.2a); the rest are out of scope unless the neutral contract must accept them at a public boundary.
- **OQ-12 (generic structural `{parts}` helpers & the executor prompt-config schema):** Which production helpers that structurally manipulate `{ parts }` **without a raw `@google/genai` import** (notably `agents/executor-prompt-builder.ts:47-58`, `applyTemplateToInitialMessages<T extends {parts?:…}>`) are external **legacy adapters** for the initial-messages wire versus **internal currency** that must become `IContent`/`ContentBlock[]`? The default disposition (§2A.4-I(e)) is retype-to-neutral; if any is a bounded external adapter it must be recorded as a central gate allow-list entry (§8 exemption-mechanism note; check (f) pattern 5). Neutral types never expose `.parts` (only `.blocks`), so any surviving `.parts` mutator needs an explicit allow-list justification. **Distinct sub-question — the executor PROMPT-CONFIGURATION surface:** `PromptConfig.initialMessages?: Content[]` (`agents/types.ts:87-95`) and `applyTemplateToInitialMessages(initialMessages: Content[], ...)` (`agents/executor.ts:894-898`) are Google-shaped `Content[]` on what looks like a **public/extension config schema** (how callers configure an agent's initial prompt), not just internal currency. This needs its own compatibility decision, separate from the `executor-prompt-builder.ts` internal mutator: does the public prompt-config schema become `IContent[]` (breaking change for extension authors) or keep a legacy `Content[]` shape converted at ingestion?
- **OQ-13 (`executableCode`/`codeExecutionResult` fate, §5.2):** These fields on `ContractGenerateContentResponse` (`clientContract.ts:100-105`) are only ever fabricated as `undefined` (`MessageConverter.ts:538-539`) with no real production producer/consumer. Decide: map to a neutral `CodeBlock` (if real code-execution support is required) or **remove them from the neutral agent contract** as unused legacy fields.
- **OQ-14 (reasoning-token fidelity across both paths, §5.5) — RESOLVED in the plan (SPLIT internal/public):** The streaming path already maps `thoughtsTokenCount → UsageStats.reasoningTokens` (`streamChunkWrapper.ts:57-59`). **INTERNAL (mandatory):** the **direct** path also populates `reasoningTokens` when it is retyped to return `ModelOutput` (§2B.2), so reasoning-token accounting is not dropped when the synthetic response is removed. **PUBLIC (out of scope for #2349):** the public usage event does NOT expose reasoning tokens — the declared public `UsageMetadataValue` (`packages/agents/src/api/event-types.ts:32-37`) stays UNCHANGED (Gemini-named, option (C), ties to OQ-2u) and declares neither `reasoningTokens` nor `thoughtsTokenCount`; the option-(C) mapper emits only the 4 declared keys. Adding a public reasoning-token field would be a public API change with CLI blast radius. (See spec REQ-007.4, domain-model OQ-14, and pseudocode `usage-metadata-boundary.md` lines 25-26.)
- **OQ-15 (provider-metadata propagation vs first-class AFC, §2.4/§5.3-3):** `toModelStreamChunk` does **not** copy `IContent.metadata.providerMetadata` (`modelEnvelope.ts:188-210`). Decide: extend/wrap `toModelStreamChunk` to preserve `providerMetadata` (making it load-bearing for AFC), OR promote AFC to a first-class `ModelOutput.afcHistory?: IContent[]` so `providerMetadata` need not be load-bearing. Must cover both streaming (`TurnProcessor._recordAfcHistory`) and direct (`DirectMessageProcessor.ts:755-764`) paths (merges with OQ-2).
- **OQ-16 (provider metadata beyond AFC — block-level AND response-level, §5.3-3a):** Beyond AFC, the neutral core adapter maps Gemini `promptFeedback`/`safetyRatings`/`groundingMetadata` into **response-level** `ModelOutput.providerMetadata` under `gemini.*` keys (`contentGeneratorAdapters.ts:195-210`), and `streamChunkWrapper` maps `responseId`/`usageMetadata`/hook-restrictions from side channels (`streamChunkWrapper.ts:91-93`, `:125-127`, `:129-157`, `:152-153`). Separately, **block-level** provider metadata exists on every `ContentBlock`/`IContent` (`IContent.ts:65`/`:136`/`:162`/`:191`/`:220`/`:251`/`:271`; round-trips per `IContent.providerMetadata.test.ts`) for provider data attached to an individual block. Decide, per field **and per level**, whether agents must **preserve** it through events/history (requiring the neutral chunk conversion to carry response-level `providerMetadata`/`responseId`, and block-level `providerMetadata` to survive the `IContent`↔block conversions), **ignore it by design**, or **keep it provider/core-only**. Explicitly resolve whether **both** block-level and response-level provider metadata are in scope for preservation, or only one. This governs whether the target conversion can be the plain `toModelStreamChunk(iContent)` or must be a wrapper that also normalizes provider output metadata onto `IContent.metadata`/the chunk (§2.4, §5.2 `Part`→`ContentBlock` row).
- **OQ-17 (gate exemption mechanism) — DECIDED (see §8 exemption-mechanism note).** The enforcement gate's exemptions are granted **only** by a central, versioned allow-list artifact (per-exemption: exact file, permitted AST-context pattern, written justification), with the AST-context matching of §8(g)/(h) as the actual enforcement. Inline `// gate-exempt`-style markers are **not** the permitting mechanism — a local suppression comment is the same class of escape hatch the project forbids and can spread silently. Any inline breadcrumb is at most a secondary human-readable marker that does not grant the exemption. This is no longer open; it is the single coherent exemption strategy referenced by §8, §8.1, and §9.1-2a/-10. The only residual planner choice is the concrete artifact format/location (an implementation-plan detail), not whether inline comments may grant exemptions (they may not).
- **OQ-1c (blocking BeforeModel neutral result):** What exact neutral result replaces `BeforeModelHookOutput.getSyntheticResponse()` on the **blocking** path (`_buildBlockingSyntheticResponse`, `DirectMessageProcessor.ts:677-701`; streaming counterpart `beforeModelHookDecision.ts:54-76`)? Either hook-provided synthetic responses remain a legacy wire shape converted to `ModelOutput` at the boundary, or hooks must produce neutral model output directly. Either way, the blocking hook must yield a neutral `ModelOutput`/hook result with the same text/reason, not a `GenerateContentResponse` cast/inline candidate envelope (§2B.2).
- **RISK-1:** `ServerAgentStreamEvent` and `StreamEvent`/`StreamEventType` are core-owned public event shapes; the migration must not alter them (only the *values'* internal derivation).
- **RISK-2:** Hook JSON wire compatibility (before/after-model, tool-selection) — changing the internal carrier must not change the serialized hook payloads. Concrete Gemini-shaped hook payloads are now inventoried in §2B.1 (before-model `Content[]` request-modification, after-model streaming/non-streaming response-modification, before-tool-selection restriction, event/API serialization).

---

## 10. Summary of Measured Counts

- **Production importers of `@google/genai` in `packages/agents/src`:** **46** (verified).
- **Test importers (raw `@google/genai`):** **54** (verified). Total raw importers (prod + test) = **100**.
- **Structural test files that do NOT import `@google/genai`** (fabricate `{candidates}`/`{role,parts}` or assert `.parts`/`role:'model'` — §3.3-A): the behavioral-migration test surface is **54 raw importers PLUS** these structural fixture/converter tests — verified additional NO-IMPORT structural files: `boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts` (converter/boundary characterization — retained), `chatSession.hook-control.test.ts`, `chatSession.issue1749.test.ts` (hook-wire fixtures — fate per OQ-1a/OQ-1c), `subagent.stream-idle.test.ts`, `subagent.runNonInteractive-term.test.ts`, `chatSession.runtimeState.test.ts` (agent-loop fabrications — rewrite).
- **File-level disposition tally (production):** DELETE = **2** (`streamChunkWrapper.ts`, `providerStopReason.ts`); NEUTRALIZE-IN-PLACE = **3** (`googlePartHelpers.ts`, `hookToolRestrictions.ts`, `MessageConverter.ts`); RETYPE = **41**. **This is a file-level count and understates deletion** — see the §3.2 function-level delete inventory for synthetic-response-only functions inside RETYPE/NEUTRALIZE files that are deleted outright (`convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `_buildBlockingSyntheticResponse`, `patchMissingFinishReason`, and the `streamChunkWrapper` helpers).
- **Structural surface (§2A.4, no raw import required):** construction sites (§2A.4-I) = 3 synthetic-response `{candidates}` fabricators + 5 contract/public `{role,parts}` builders + 6 history/write-path builders + 5 hook fallback/restriction adapters + 7 subagent/executor sites (one raw-import-free); access/mutation sites (§2A.4-II) = 20 `.parts`/`candidate.content` reader/mutator sites (f, including the `MessageConverter` `isValidContent`/`extractCuratedHistory`/`hasTextContent` validators, the `streamResponseHelpers` accumulate read, the `TurnProcessor._recordOutputContent` read/gate, the `hookToolRestrictions.filterHookRestrictedContent` mutator, and the DELETE-file `streamChunkWrapper.responseToIContent` reconstruction) + 4 AFC/content-length filter sites (g) + 5 internal Google-named usage-key sites (h, including the `turnLogging.ts` telemetry serialization surface).
- **Cross-package `Contract*` blast radius (production):** CLI = **23** (raw grep 25 − 2 test-helpers), core = **5** (excluding `clientContract.ts`), agents = **0** (agents imports Google symbols directly, not the aliases).
- **Structural-Gemini flows (§2A, no raw import required):** `ContentConverters.toGeminiContents` (neutral→Gemini) in agents production = **7** (G1–G7); `toGeminiContent` (singular) = **0**; named `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall` references = **0** (they arrive only via the converters/raw importers). `toIContent(s)` (Gemini→neutral, inbound normalization) sites are catalogued in §2A.3.
- **Public Gemini-named usage-metadata events (§7A):** `ServerUsageMetadataEvent` (**`packages/core/src/core/turn.ts:221-228`** — core-owned) and API `UsageMetadataValue`/`FinishedValue` (`packages/agents/src/api/event-types.ts:32-41`, `event-schema.ts:30-39`) — decision required (A/B/C). **`ServerUsageMetadataEvent` has ZERO production emitters** (legacy/dead emit path; only `eventHarness.ts:108` constructs it, and `eventAdapter.ts:267-269` forwards it) — so the live Gemini-named surface is the API `FinishedValue.usageMetadata` declared type and the telemetry `logApiResponse` usage, not the event.
- **`HistoryService` `@google/genai` imports:** **0** (already neutral; must stay neutral).
- **`sdkTypeBridge.ts`:** absent (PR #2424 closed/reverted, confirmed).
- **Existing gate:** `scripts/genai-import-inventory.ts` — raw-specifier shrink-ratchet only; insufficient to catch aliasing/enums/structural literals/structural converters (§8).

---

## Appendix A — Reproducible verification commands & sorted outputs

**A.1 — 46 raw `@google/genai` production importers under `packages/agents/src`.** The §3.2 table IS this sorted list (46 rows). Command:

```
grep -rl "@google/genai" packages/agents/src \
  | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | sort
```

Output (46 files):

```
packages/agents/src/agents/executor-stream-processor.ts
packages/agents/src/agents/executor-tool-dispatch.ts
packages/agents/src/agents/executor.ts
packages/agents/src/agents/recovery.ts
packages/agents/src/agents/types.ts
packages/agents/src/api/agent.ts
packages/agents/src/api/agentBootstrap.ts
packages/agents/src/api/control/sessionControl.ts
packages/agents/src/compression/compressionBudgeting.ts
packages/agents/src/compression/CompressionHandler.ts
packages/agents/src/compression/providerContentEnforcement.ts
packages/agents/src/core/agenticLoop/AgenticLoop.ts
packages/agents/src/core/agenticLoop/loopHelpers.ts
packages/agents/src/core/agenticLoop/types.ts
packages/agents/src/core/baseLlmClient.ts
packages/agents/src/core/beforeModelHookDecision.ts
packages/agents/src/core/chatSession.ts
packages/agents/src/core/ChatSessionFactory.ts
packages/agents/src/core/client.ts
packages/agents/src/core/clientHelpers.ts
packages/agents/src/core/clientLlmUtilities.ts
packages/agents/src/core/clientToolGovernance.ts
packages/agents/src/core/ConversationManager.ts
packages/agents/src/core/DirectMessageProcessor.ts
packages/agents/src/core/googlePartHelpers.ts
packages/agents/src/core/hookToolRestrictions.ts
packages/agents/src/core/MessageConverter.ts
packages/agents/src/core/MessageStreamOrchestrator.ts
packages/agents/src/core/MessageStreamTerminalHandler.ts
packages/agents/src/core/providerStopReason.ts
packages/agents/src/core/schemaDepthErrorEnrichment.ts
packages/agents/src/core/streamChunkWrapper.ts
packages/agents/src/core/streamCleanup.ts
packages/agents/src/core/StreamProcessor.ts
packages/agents/src/core/streamRequestHelpers.ts
packages/agents/src/core/streamResponseHelpers.ts
packages/agents/src/core/subagent.ts
packages/agents/src/core/subagentExecution.ts
packages/agents/src/core/subagentNonInteractive.ts
packages/agents/src/core/subagentRuntimeSetup.ts
packages/agents/src/core/subagentToolProcessing.ts
packages/agents/src/core/TodoContinuationService.ts
packages/agents/src/core/turn.ts
packages/agents/src/core/turnAbortHelpers.ts
packages/agents/src/core/turnLogging.ts
packages/agents/src/core/TurnProcessor.ts
```

> Note: `agents/recovery.ts` is the executor recovery / repair module (§3.2 #36).

**A.2 — 23 production CLI consumers of Google-shaped `Contract*` payload types (§4.3).** Command:

```
grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/cli/src \
  | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | sort
```

Output (23 files):

```
packages/cli/src/nonInteractiveCli.ts
packages/cli/src/nonInteractiveCliCommands.ts
packages/cli/src/ui/hooks/agentStream/queryPreparer.ts
packages/cli/src/ui/hooks/agentStream/streamUtils.ts
packages/cli/src/ui/hooks/agentStream/toolCompletionHandler.ts
packages/cli/src/ui/hooks/agentStream/types.ts
packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts
packages/cli/src/ui/hooks/agentStream/useAgentStream.ts
packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts
packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts
packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts
packages/cli/src/ui/hooks/atCommandProcessor.ts
packages/cli/src/ui/hooks/atCommandProcessorHelpers.ts
packages/cli/src/ui/hooks/atCommandResourceHelpers.ts
packages/cli/src/ui/hooks/shellCommandProcessor.ts
packages/cli/src/ui/hooks/slashCommandHandlers.ts
packages/cli/src/ui/hooks/usePromptCompletion.ts
packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts
packages/cli/src/ui/utils/autoPromptGenerator.ts
packages/cli/src/ui/utils/historyExportUtils.ts
packages/cli/src/zed-integration/zed-content-utils.ts
packages/cli/src/zed-integration/zed-path-resolver.ts
packages/cli/src/zed-integration/zedIntegration.ts
```

> The raw grep (without the `test-helpers` exclusion) returns 25; the two excluded non-production files are `packages/cli/src/nonInteractiveCli.test-helpers.ts` and `packages/cli/src/ui/hooks/useAgentStream-test-helpers.ts`.

**A.3 — 5 production core consumers of `Contract*` (excluding `clientContract.ts`):** `packages/core/src/commands/types.ts`, `packages/core/src/config/agentClientLifecycle.ts`, `packages/core/src/utils/checkpointUtils.ts`, `packages/core/src/utils/llm-edit-fixer.ts`, `packages/core/src/utils/summarizer.ts`.

**A.4 — `toGeminiContents` (neutral→Gemini) sites in agents production (§2A.2):** Command:

```
grep -rn "toGeminiContents\|toGeminiContent\b" packages/agents/src \
  | grep -v -E "\.(test|spec)\.|test-helpers|__tests__"
```

Output (7 `toGeminiContents` sites, 0 singular `toGeminiContent`): `client.ts:421`, `ConversationManager.ts:419`, `streamRequestHelpers.ts:228`, `streamRequestHelpers.ts:281`, `TurnProcessor.ts:457`, `TurnProcessor.ts:747`, `DirectMessageProcessor.ts:178`.

**A.5 — 54 test/helper importers of `@google/genai` under `packages/agents/src` (§3.3).** This is the exact, sorted list behind the grouped §3.3 counts (replacing the earlier approximate `~6`/`~10` subcounts). Command:

```
grep -rl "@google/genai" packages/agents/src \
  | grep -E "\.(test|spec)\.|test-helpers|__tests__" | sort
```

Output (54 files):

```
packages/agents/src/agents/executor-test-helpers.ts
packages/agents/src/agents/executor.execution.test.ts
packages/agents/src/agents/executor.recovery.test.ts
packages/agents/src/agents/executor.test.ts
packages/agents/src/api/__tests__/event-characterization.spec.ts
packages/agents/src/api/__tests__/helpers/eventHarness.ts
packages/agents/src/api/__tests__/helpers/realLoopHarness.ts
packages/agents/src/core/__tests__/executionControlErrors.test.ts
packages/agents/src/core/__tests__/subagent.stateless.test.ts
packages/agents/src/core/__tests__/turn.thinking.test.ts
packages/agents/src/core/agenticLoop/__tests__/agenticLoop-test-helpers.ts
packages/agents/src/core/agenticLoop/__tests__/agenticLoop.auto-policy.test.ts
packages/agents/src/core/chatSession.directRefusal.issue2329.test.ts
packages/agents/src/core/chatSession.issue1150.integration.test.ts
packages/agents/src/core/chatSession.runtime.history.test.ts
packages/agents/src/core/chatSession.runtime.streaming.test.ts
packages/agents/src/core/chatSession.runtime.test.ts
packages/agents/src/core/chatSession.thinkingHistory.test.ts
packages/agents/src/core/client-test-helpers.ts
packages/agents/src/core/client.editor-context.test.ts
packages/agents/src/core/client.hooks.test.ts
packages/agents/src/core/client.ide-context.test.ts
packages/agents/src/core/client.lifecycle.test.ts
packages/agents/src/core/client.methods.test.ts
packages/agents/src/core/client.model-profile.test.ts
packages/agents/src/core/client.sendMessageStream-errors.test.ts
packages/agents/src/core/client.sendMessageStream-overflow-compression.test.ts
packages/agents/src/core/client.sendMessageStream-overflow.test.ts
packages/agents/src/core/client.sendMessageStream-thinking.test.ts
packages/agents/src/core/client.sendMessageStream.test.ts
packages/agents/src/core/client.test.ts
packages/agents/src/core/clientHelpers.test.ts
packages/agents/src/core/ConversationManager.modelStamp.test.ts
packages/agents/src/core/coreToolScheduler.edit-cancel.test.ts
packages/agents/src/core/MessageConverter.issue1844.test.ts
packages/agents/src/core/MessageConverter.issue2329.test.ts
packages/agents/src/core/MessageStreamOrchestrator.modelinfo.test.ts
packages/agents/src/core/MessageStreamOrchestrator.todoPause.test.ts
packages/agents/src/core/StreamProcessor.retryBoundary.test.ts
packages/agents/src/core/StreamProcessor.yieldAsYouGo.test.ts
packages/agents/src/core/subagent-test-helpers.ts
packages/agents/src/core/subagent.buildParts.test.ts
packages/agents/src/core/subagent.create.test.ts
packages/agents/src/core/subagent.runNonInteractive-execution.test.ts
packages/agents/src/core/subagent.runNonInteractive.test.ts
packages/agents/src/core/turn.abort-timeout.test.ts
packages/agents/src/core/turn.debug-responses.test.ts
packages/agents/src/core/turn.hook-events.test.ts
packages/agents/src/core/turn.idle-timeout.test.ts
packages/agents/src/core/turn.issue2329.test.ts
packages/agents/src/core/turn.preRequestTimeout.test.ts
packages/agents/src/core/turn.test.ts
packages/agents/src/core/turn.tool-restrictions.test.ts
packages/agents/src/core/turn.undefined_issue.test.ts
```

**A.6 — Structural Gemini test fixtures that do NOT import `@google/genai` (§3.3-A).** Mirrors Appendix A.5's rigor: reproducible commands + sorted output, classed by structural pattern. In every command the raw-import test set (A.5, 54 files) is subtracted so only the **no-import** structural fixtures remain. The behavioral-migration test policy is **allow-list based** (not exhaustive rewrite): the concrete artifact is the §3.3-A classification (retain-as-characterization vs rewrite vs hook-wire-fate), enforced by the §8.1 test gate against the central allow-list. These lists make that policy auditable.

Shared exclusion (the 54 raw importers, subtracted from every class below):

```
grep -rl "@google/genai" packages/agents/src \
  | grep -E "\.(test|spec)\.|test-helpers|__tests__" | sort > /tmp/raw_test_importers.txt
```

**Class 1 — `{candidates}` response fixtures (no raw import).** Command:

```
grep -rlE "candidates:\s*\[" packages/agents/src --include='*.test.ts' --include='*.spec.ts' \
  | sort | comm -23 - /tmp/raw_test_importers.txt
```

Output (5 files):

```
packages/agents/src/core/__tests__/chatSession.runtimeState.test.ts
packages/agents/src/core/chatSession.hook-control.test.ts
packages/agents/src/core/chatSession.issue1749.test.ts
packages/agents/src/core/subagent.runNonInteractive-term.test.ts
packages/agents/src/core/subagent.stream-idle.test.ts
```

Disposition (§3.3-A): `chatSession.hook-control.test.ts` / `chatSession.issue1749.test.ts` = hook-wire fixtures (fate per OQ-1a/OQ-1c); `subagent.stream-idle.test.ts` / `subagent.runNonInteractive-term.test.ts` / `chatSession.runtimeState.test.ts` = agent-loop fabrications to **rewrite** off `{candidates}`.

**Class 2 — `{role,parts}` message fixtures (no raw import).** Command:

```
grep -rlE "role:\s*'(model|user)'" packages/agents/src --include='*.test.ts' --include='*.spec.ts' \
  | sort | comm -23 - /tmp/raw_test_importers.txt
```

Output (15 files):

```
packages/agents/src/api/__tests__/core-conversation.spec.ts
packages/agents/src/api/__tests__/core-history.spec.ts
packages/agents/src/api/__tests__/session.spec.ts
packages/agents/src/api/__tests__/switch-context.spec.ts
packages/agents/src/compression/__tests__/compression-recency.test.ts
packages/agents/src/compression/__tests__/compression-retry-hardlimit.test.ts
packages/agents/src/core/__tests__/boundaryRecovery.test.ts
packages/agents/src/core/__tests__/compression-logic.test.ts
packages/agents/src/core/__tests__/compression.test.ts
packages/agents/src/core/baseLlmClient.test.ts
packages/agents/src/core/chatSession.hook-control.test.ts
packages/agents/src/core/chatSession.issue1749.test.ts
packages/agents/src/core/ChatSessionFactory.test.ts
packages/agents/src/core/ChatSessionFactory.tokenReestimate.test.ts
packages/agents/src/core/clientLlmUtilities.test.ts
```

These are broader than the §3.3-A named set: several (`baseLlmClient.test.ts:258-259`, `compression.test.ts:17-18`, `core-conversation.spec.ts:161`) build `{role,parts}` `Content[]` fixtures as request/history input. Each must be classified per §3.3-A when the corresponding production surface migrates (input/history builders → neutral `IContent` fixtures; converter/boundary characterization → retain on the allow-list). `boundaryRecovery.test.ts` and `switch-context.spec.ts` are already dispositioned in §3.3-A (retain as characterization).

**Class 3 — `.parts` assertions/mutators (no raw import).** Command:

```
grep -rlE "\.parts\b" packages/agents/src --include='*.test.ts' --include='*.spec.ts' \
  | sort | comm -23 - /tmp/raw_test_importers.txt
```

Output (5 files):

```
packages/agents/src/api/__tests__/core-history.spec.ts
packages/agents/src/api/__tests__/session.spec.ts
packages/agents/src/api/__tests__/switch-context.spec.ts
packages/agents/src/core/chatSession.thinking-toolcalls.repro.test.ts
packages/agents/src/core/subagentExecution.test.ts
```

Disposition: `chatSession.thinking-toolcalls.repro.test.ts` / `switch-context.spec.ts` = converter/boundary characterization (retain, §3.3-A); `subagentExecution.test.ts:148,186` asserts `result[0].parts[0]` on subagent turn output — rewrite to assert neutral `ContentBlock[]` once the subagent surface is neutral; `core-history.spec.ts` / `session.spec.ts` assert `.parts` on public history round-trips — classify with the §4 contract-surface migration.

**Class 4 — converter-boundary tests (`toGeminiContents`/`toIContents`, no raw import).** Command:

```
grep -rlE "toGeminiContents|toIContents\(" packages/agents/src --include='*.test.ts' --include='*.spec.ts' \
  | sort | comm -23 - /tmp/raw_test_importers.txt
```

Output (2 files):

```
packages/agents/src/core/__tests__/boundaryRecovery.test.ts
packages/agents/src/core/chatSession.thinking-toolcalls.repro.test.ts
```

Disposition: both are **retained** converter/boundary characterization tests (§3.3-A, OQ-1d) — they intentionally exercise the neutral↔Gemini converter at a boundary that persists (hook wire / history converter) and are on the §8.1 central allow-list.
