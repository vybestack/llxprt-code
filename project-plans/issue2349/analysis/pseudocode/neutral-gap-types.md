# Pseudocode: Neutral gap types (AgentMessageInput, lossless converter, AFC slot, extended toModelStreamChunk)

Plan: PLAN-20260707-AGENTNEUTRAL — components for REQ-001.
Follow line numbers exactly in implementation phases.

## Interface Contracts

INPUTS this component receives:
- `unknown` legacy input (string | Part-like | Content-like | arrays) at the agents boundary.
- `IContent` streamed from the provider (for `toModelStreamChunk`).

OUTPUTS this component produces:
- `AgentMessageInput` (type), `IContent[]` (converted), extended `ModelOutput` with `afcHistory`, `ModelStreamChunk` with preserved provider metadata.

DEPENDENCIES (real, injected/imported — never stubbed):
- `IContent`/`ContentBlock`/`ContentMetadata`/`UsageStats` from `../services/history/IContent.js`.
- `CanonicalFinishReason` + mappers from `./finishReasons.js`.
- Existing `accumulateModelStreamChunk`/`getToolCalls` in `modelEnvelope.ts` (unchanged).
- NO `@google/genai` import (input typed `unknown`, structural checks only).

## agentMessageInput.ts (NEW — REQ-001.1/.2)

```
10: TYPE AgentMessageInput = string | ContentBlock[] | IContent | IContent[]
11: FUNCTION iContentFromAgentMessageInput(input: AgentMessageInput): IContent[]
12:   IF typeof input === 'string'
13:     RETURN [ { speaker:'human', blocks:[ { type:'text', text: input } ] } ]
14:   IF isIContent(input)                       // has speaker+blocks
15:     RETURN [ input ]
16:   IF isIContentArray(input)
17:     RETURN input
18:   IF isContentBlockArray(input)              // neutral blocks
19:     RETURN [ { speaker:'human', blocks: input } ]
20:   THROW-FREE: unreachable by type; defensively return [] only if input is empty array
21: FUNCTION iContentFromLegacyInput(input: unknown): Result<IContent[]>   // Result = {ok:true,value}|{ok:false,error}
22:   // lossless legacy PartListUnion/Content → IContent; preserves thoughtSignature/media/toolResponse/toolCallId
23:   IF typeof input === 'string' RETURN ok([ humanText(input) ])
24:   IF isLegacyPartArray(input) RETURN ok([ { speaker:'human', blocks: mapLegacyParts(input) } ])
25:   IF isLegacyContent(input)  RETURN ok([ legacyContentToIContent(input) ])
26:   IF isLegacyContentArray(input) RETURN ok(input.map(legacyContentToIContent))
27:   RETURN err('unsupported legacy input shape')      // never silent stringify/drop (ES-2)
28: FUNCTION mapLegacyParts(parts: unknown[]): ContentBlock[]
29:   result = []
30:   FOR p IN parts
31:     IF hasText(p)           PUSH TextBlock(p.text)
32:     ELSE IF hasThought(p)   PUSH ThinkingBlock(thought=p.text, signature=p.thoughtSignature, sourceField='thought')  // BR-5: preserve signature
33:     ELSE IF hasInlineData(p) PUSH MediaBlock(base64=p.inlineData.data, mimeType=p.inlineData.mimeType)
34:     ELSE IF hasFileData(p)  PUSH MediaBlock(url=p.fileData.fileUri, mimeType=p.fileData.mimeType)
35:     ELSE IF hasFunctionCall(p) PUSH ToolCallBlock(id=p.functionCall.id, name=p.functionCall.name, parameters=p.functionCall.args)
36:     ELSE IF hasFunctionResponse(p) PUSH ToolResponseBlock(id=p.functionResponse.id, name=p.functionResponse.name, result=p.functionResponse.response)
37:     ELSE RETURN-SIGNAL unsupported   // bubbles to err() in caller (ES-2)
38:   RETURN result
39: FUNCTION legacyContentToIContent(c: unknown): IContent
40:   speaker = c.role === 'model' ? 'ai' : c.role === 'function'||'tool' ? 'tool' : 'human'
41:   RETURN { speaker, blocks: mapLegacyParts(c.parts ?? []) }
42: FUNCTION iContentFromBlocks(blocks: ContentBlock[], speaker?: IContent['speaker']): IContent   // REQ-001.2 — neutral block[] → IContent
43:   // Direct, lossless wrapper: builds ONE neutral IContent from already-neutral ContentBlock[].
44:   // Used where the caller already holds filtered/derived neutral blocks (e.g. StreamProcessor
45:   // after-model hook filtering P07, DirectMessageProcessor after-model hook filtering P13) and must
46:   // hand a neutral IContent to fireAfterModelEvent WITHOUT any Google-shaped intermediary.
47:   // NO Google shape: no role/parts/candidates; returns .blocks only. Immutable (new object).
48:   RETURN { speaker: speaker ?? 'ai', blocks }
```

## modelEnvelope.ts (EXTEND — REQ-001.4/.5, OQ-15/OQ-16)

```
50: EXTEND interface ModelOutput to add: afcHistory?: IContent[]     // REQ-001.4; first-class neutral AFC slot
51: // (ModelStreamChunk = ModelOutput alias inherits the field)
52: MODIFY FUNCTION toModelStreamChunk(icontent: IContent): ModelStreamChunk   // existing at modelEnvelope.ts:188
53:   meta = icontent.metadata
54:   chunk = { content: icontent }
55:   raw = meta?.stopReason ?? meta?.finishReason
56:   IF raw !== undefined
57:     chunk.rawStopReason = raw
58:     chunk.finishReason = isCanonicalFinishReason(raw) ? raw : tryAllMappers(raw)
59:   IF meta?.usage   chunk.usage = meta.usage
60:   IF meta?.id      chunk.responseId = meta.id
61:   // NEW (OQ-16): preserve response-level provider metadata onto the chunk
62:   IF meta?.providerMetadata
63:     chunk.providerMetadata = { ...meta.providerMetadata }   // shallow copy; gemini.* keys pass through untouched
64:   RETURN chunk
65: // NOTE: block-level providerMetadata already lives on each ContentBlock inside icontent.blocks and
66: //       is carried by reference — no extra work; DO NOT strip it.
```

## Turn request DTO (EXTEND ModelGenerationRequest — REQ-001.3, OQ-1) — CONCRETE

DECISION (OQ-1, domain-model §5): the turn-level neutral request DTO that replaces the Google-shaped
`SendMessageParameters` (`{ message: PartListUnion; config?: GenerateContentConfig }`) is
`ModelGenerationRequest` (already core-owned, carries `contents: IContent[]` + `settings`), used together
with `AgentMessageInput` for the raw user-message portion. No NEW sibling type is introduced unless the
P0.5 preflight proves `ModelGenerationRequest` insufficient (see preflight assumption 11); if it is
insufficient, the fallback is a sibling `AgentGenerationRequest` in `llm-types/` — but the DEFAULT and
planned outcome is EXTEND/REUSE `ModelGenerationRequest`.

```
70: TYPE (reused, core-owned) ModelGenerationRequest = {
71:   contents: IContent[];              // replaces SendMessageParameters.message (Google PartListUnion)
72:   settings?: ModelGenerationSettings; // replaces SendMessageParameters.config (GenerateContentConfig)
73:   tools?: ToolDeclaration[];          // replaces GenerateContentConfig.tools
74: }
75: // Mapping a legacy SendMessageParameters call site to the neutral DTO:
76: FUNCTION sendParamsToRequest(message: AgentMessageInput, settings?: ModelGenerationSettings): ModelGenerationRequest
77:   RETURN { contents: iContentFromAgentMessageInput(message), settings }
78: // INVARIANT (REQ-001.3): the resulting request carries NO Google-shaped config or message —
79: //   no `role`/`parts`/`candidates`, no GenerateContentConfig; `contents` is IContent[] only.
80: // If ModelGenerationRequest lacks a slot a call site needs (e.g. a Gemini-only config field),
81: //   map it per OQ-18 (thinkingConfig→ReasoningConfig; responseJsonSchema/responseMimeType→ModelGenerationSettings slots);
82: //   it MUST NOT reintroduce GenerateContentConfig.
```

## Integration Points (line-by-line)

- Line 11 (`iContentFromAgentMessageInput`): consumed by `turn.run`, `client.sendMessageStream`, `AgenticLoop`, `api/agentBootstrap.ts`, `executor.ts`, `subagent*` — replacing `PartListUnion` inputs. Input MUST NOT be a Google `Part`/`Content`.
- Line 21 (`iContentFromLegacyInput`): consumed at the public/hook ingestion boundary where genuinely-external legacy input arrives (pairs with `toIContent(s)` inbound sites in overview §2A.3). Returns Result — caller MUST handle `{ok:false}` (ES-2).
- Line 42 (`iContentFromBlocks`): consumed on the AfterModel hook filtering paths that already hold neutral filtered `ContentBlock[]` and must pass a neutral `IContent` to `fireAfterModelEvent` — `StreamProcessor._processAfterModelHook` (P07, MODIFY/STOP branches) and `DirectMessageProcessor._processDirectResponse` (P13, direct after-model). It replaces the phantom helper name the plan previously used and removes the last synthetic intermediary on those event calls. Input is neutral `ContentBlock[]` (never a Google `Part[]`); `speaker` defaults to `'ai'` (model output) but is passed explicitly (`chunk.content.speaker`) where the caller has it.
- Line 50 (`afcHistory`): consumed by `TurnProcessor._recordAfcHistory` (streaming) + `DirectMessageProcessor` (direct); slicing/hook-filter semantics identical (BR-8).
- Line 52 (`toModelStreamChunk` extension): consumed by `StreamProcessor` per-chunk conversion (replaces `convertIContentToResponse` + `responseToModelStreamChunk`). Lines 61-64 close the OQ-16 provider-metadata gap so `contentGeneratorAdapters.ts:195-210` `gemini.*` metadata survives.
- Lines 70-82 (turn request DTO): consumed everywhere `SendMessageParameters` is today (overview §3.2 #6, #7, #9, #14, #18, #21, #24). `sendParamsToRequest` (line 76) is the mapping helper the retype slices apply at each `SendMessageParameters` call site. REQ-001.3 acceptance: a `SendMessageParameters` call site can be expressed as `ModelGenerationRequest` + `AgentMessageInput` with zero Google-shaped `config`/`message` leakage.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: import { Part, Content } from '@google/genai'   → structural checks on unknown only.
[ERROR] DO NOT: silently stringify/drop unsupported legacy input → return err() (ES-2).
[ERROR] DO NOT: route thinking-bearing input through legacyPartToBlocks/partLikeToBlock (lossy — BR-5).
[ERROR] DO NOT: add candidates/parts/role to AgentMessageInput → it is neutral by definition.
[ERROR] DO NOT: strip block-level providerMetadata in toModelStreamChunk → carry by reference (line 65-66).
[ERROR] DO NOT: use `as`/`as unknown as` casts to narrow the `unknown` legacy input or any legacy-shape branch
        (RULES.md forbids type assertions) → use TYPE PREDICATES (`isLegacyPartArray`/`isLegacyContent`/
        `isIContent`/`isContentBlockArray`, each `(x: unknown): x is T`) so every branch is checked, not asserted.
[OK] DO: return NEW objects (immutability, RULES.md); never mutate icontent/meta.
[OK] DO: gate EVERY legacy branch behind a `(x: unknown): x is T` predicate; the compiler narrows — no `as`.
```
