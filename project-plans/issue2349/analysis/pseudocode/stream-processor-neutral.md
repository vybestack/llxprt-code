# Pseudocode: StreamProcessor neutralization

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-002.1, REQ-005.3, REQ-006.2, REQ-008.1, BR-1/BR-6/BR-7.
Target file: `packages/agents/src/core/StreamProcessor.ts` (RETYPE; overview §3.2 #6).

## Interface Contracts

INPUTS:
- provider `AsyncIterable<IContent>` from `provider.generateChatCompletion({ contents: IContent[], ... })` (neutral, unchanged — RuntimeProvider.ts:77-84).
- neutral turn request DTO (`ModelGenerationRequest`).

OUTPUTS:
- yields `ModelStreamChunk` per chunk; commits neutral `IContent` to `HistoryService` once at finalize.

DEPENDENCIES (real):
- `toModelStreamChunk` (extended, from neutral-gap-types) — NOT `convertIContentToResponse`.
- `accumulateModelStreamChunk` (core).
- `HistoryService` (real, injected).
- neutral hook adapters (before/after-model), `HookRestrictions` on chunk.
- `turnLogging.logApiRequest` (retyped neutral).

## processStreamResponse / _finalizeStreamProcessing (RETYPE)

```
10: METHOD _sendProviderRequest(request: ModelGenerationRequest): AsyncIterable<IContent>
11:   // unchanged neutral call
12:   RETURN provider.generateChatCompletion({ contents: request.contents, tools: request.tools, ... })
13: METHOD _convertIContentStream(src: AsyncIterable<IContent>): AsyncIterable<ModelStreamChunk>
14:   FOR AWAIT iContent IN src
15:     chunk = toModelStreamChunk(iContent)          // REPLACES convertIContentToResponse; DELETE that call
16:     // hook restrictions ride explicitly on the chunk (no WeakMap)
17:     IF hookAllowedTools !== undefined
18:       chunk.hookRestrictions = { allowedToolNames: hookAllowedTools, hadFilteredRestrictedCalls: filteredFlag }
19:     YIELD chunk
20: METHOD processStreamResponse(request): AsyncIterable<ModelStreamChunk>
21:   acc = emptyModelOutput('ai')
22:   FOR AWAIT chunk IN _fireBeforeModelHook/_convertIContentStream/_processAfterModelHook chain
23:     acc = accumulateModelStreamChunk(acc, chunk)      // ContentBlock[] concat; usage/finishReason last-write-wins (BR-6)
24:     YIELD chunk
25:   _finalizeStreamProcessing(acc)
26: METHOD _finalizeStreamProcessing(acc: ModelOutput): void        // BR-1: single commit AFTER loop
27:   modelBlocks = acc.content.blocks
28:   consolidated = consolidateAdjacentTextBlocks(modelBlocks)      // BR-7 (moves off consolidateTextParts)
29:   filtered = filterThoughtBlocksIfConfigured(consolidated)       // BR-5: drop ThinkingBlock text by config, keep signature
30:   record = { speaker:'ai', blocks: filtered, metadata: { usage: acc.usage, finishReason: acc.finishReason, stopReason: acc.rawStopReason } }
31:   historyService.record(record)                                 // neutral IContent; NO {role:'model',parts} literal
32:   syncTokenCounts(acc.usage)                                    // BR-6 + OQ-2t absent-usage fallback
33: METHOD _processAfterModelHook(chunk: ModelStreamChunk): ModelStreamChunk    // overview §2B.1 streaming after-model
34:   filteredBlocks = filterHookRestrictedBlocks(chunk.content.blocks, chunk.hookRestrictions?.allowedToolNames)
35:   fireAfterModelEvent(request, { speaker: chunk.content.speaker, blocks: filteredBlocks })   // neutral IContent to hook
36:   RETURN { ...chunk, content: { ...chunk.content, blocks: filteredBlocks } }
37: METHOD _patchMissingFinishReason(chunk): ModelStreamChunk       // EC-2 (replaces streamRequestHelpers.patchMissingFinishReason)
38:   IF chunk.finishReason === undefined AND chunkIsTerminal(chunk)
39:     RETURN { ...chunk, finishReason: 'stop' }                   // CanonicalFinishReason 'stop'; NO {candidates} literal, NO FinishReason.STOP
40:   RETURN chunk
41: METHOD syncTokenCounts(usage?: UsageStats): void                // OQ-2t
42:   promptTokens = usage?.promptTokens ?? this.lastPromptTokenCount   // absent-usage fallback preserved (BR-6)
43:   IF promptTokens !== undefined this.lastPromptTokenCount = promptTokens; trackPromptTokens(promptTokens)
```

## Integration Points (line-by-line)

- Line 15: `toModelStreamChunk(iContent)` REPLACES `convertIContentToResponse(iContent)` + downstream `responseToModelStreamChunk` (both DELETED). This is the single conversion; `streamChunkWrapper.ts` is gone.
- Line 18: `HookRestrictions` on the chunk REPLACES `hookToolRestrictions` WeakMap writes (`_convertIContentStream`/`processStreamResponse` consumers) — REQ-003.2.
- Line 23: `accumulateModelStreamChunk` REPLACES the `Part[]`/`FinishReason`/`GenerateContentResponse[]` accumulator in `_finalizeStreamProcessing`.
- Line 28: `consolidateAdjacentTextBlocks` REPLACES `streamResponseHelpers.consolidateTextParts` (§2A.4-I(c), §3.2 #22).
- Line 31: neutral `historyService.record(IContent)` REPLACES the `{role:'model',parts}` builder at `streamResponseHelpers.ts:299-301`.
- Line 39: neutral default REPLACES `streamRequestHelpers.patchMissingFinishReason` `{candidates}` + `FinishReason.STOP`.
- Line 42: OQ-2t fallback preserved from current `_syncTokenCounts`.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: keep convertIContentToResponse — DELETE it and its callers.
[ERROR] DO NOT: accumulate Part[] or GenerateContentResponse[] — accumulate ModelStreamChunk/ContentBlock[].
[ERROR] DO NOT: read chunk.candidates / chunk.usageMetadata.promptTokenCount — read chunk.usage.promptTokens.
[ERROR] DO NOT: move the history commit earlier — BR-1: single commit after the loop.
[ERROR] DO NOT: write hook restrictions to a WeakMap — put HookRestrictions on the chunk.
[OK] DO: mock ONLY the provider AsyncIterable<IContent> in tests; use the REAL StreamProcessor + HistoryService.
```
