# Pseudocode: TurnProcessor wrap path + Turn stream-chunk consumption

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-002.2, REQ-002.3, REQ-004.3, REQ-001.4 (AFC), BR-1/BR-2/BR-3/BR-4/BR-8.
Target files: `packages/agents/src/core/TurnProcessor.ts` (RETYPE §3.2 #7), `packages/agents/src/core/turn.ts` (RETYPE §3.2 #8).

## Interface Contracts

INPUTS:
- `TurnProcessor._runStreamAttempt` iterates `AsyncIterable<ModelStreamChunk>` from `StreamProcessor` (was `GenerateContentResponse`).
- `Turn.processStreamChunk` receives `ModelStreamChunk` from `StreamEvent.CHUNK`.

OUTPUTS:
- `TurnProcessor.sendMessage` returns `Promise<ModelOutput>` (was `GenerateContentResponse`).
- `Turn` emits `ServerAgentStreamEvent` (public shape UNCHANGED — BR-2).

DEPENDENCIES (real):
- `StreamEvent`/`ServerAgentStreamEvent` (core-owned, unchanged).
- `HistoryService` (real).
- `ToolCallBlock`/`ToolResponseBlock` (neutral), `getToolCalls` (core).
- `isProviderApiError` (neutral, replaces ApiError).

## TurnProcessor (RETYPE)

```
10: METHOD _runStreamAttempt(request): AsyncIterable<ModelStreamChunk>
11:   FOR AWAIT chunk IN makeApiCallAndProcessStream()      // now yields ModelStreamChunk directly
12:     YIELD wrapChunk(chunk)
13: FUNCTION wrapChunk(chunk: ModelStreamChunk): StreamEvent
14:   RETURN { type: StreamEventType.CHUNK, value: chunk }  // DIRECT wrap; DELETE responseToModelStreamChunk call
15: METHOD sendMessage(request): Promise<ModelOutput>       // REQ-004.3 (return type flip)
16:   acc = accumulate all chunks via accumulateModelStreamChunk
17:   RETURN acc                                            // neutral ModelOutput
18: METHOD _recordOutputContent(output: ModelOutput): void  // §2A.4-I(c)/§2A.4-II(f) TurnProcessor:796-803
19:   blocks = output.content.blocks
20:   filtered = includeThoughts ? blocks : blocks.filter(b => b.type !== 'thinking')   // BR-5; keep signature elsewhere
21:   IF filtered.length > 0
22:     historyService.record({ speaker:'ai', blocks: filtered, metadata:{ usage: output.usage, ... } })  // no {role,parts}
23: METHOD _recordAfcHistory(output: ModelOutput): void     // BR-8; AFC now neutral (REQ-001.4)
24:   afc = output.afcHistory ?? []                         // REPLACES toGeminiContents(...).length offset (G6) + toIContent sites
25:   index = historyService.getCurated().length            // REPLACES toGeminiContents(curatedHistory).length (TurnProcessor:747)
26:   restricted = filterAfcByHookRestrictions(afc, output.hookRestrictions?.allowedToolNames)  // BR-8
27:   nonEmpty = restricted.filter(c => c.blocks.length > 0)  // REPLACES (content.parts?.length ?? 0) > 0 (TurnProcessor:728)
28:   FOR c IN nonEmpty.slice(index) historyService.record(c)
29:   // NO toIContent — afc is already IContent[]
30: METHOD _syncTokenCounts(output: ModelOutput): void       // §2A.4-II(h) OQ-2t
31:   promptTokens = output.usage?.promptTokens ?? this.lastPromptTokenCount    // absent-usage fallback (BR-6)
32:   syncTotalTokens(promptTokens)
33: METHOD _logApiRequest(request): void
34:   turnLogging.logApiRequest(runtimeContext, state, request.contents, ...)   // neutral IContent[]; DELETE toGeminiContents (G5)
35: METHOD errorPath(e: unknown)
36:   IF isProviderApiError(e) ...                            // REPLACES ApiError value import (§3.2 #7)
```

## Turn (RETYPE)

```
40: METHOD processStreamChunk(chunk: ModelStreamChunk): void   // §3.2 #8; DELETE chunkToParts
41:   blocks = chunk.content.blocks                            // operate on ContentBlock[]; NO Part[]
42:   FOR block IN blocks
43:     IF block.type === 'text'    emit Content event(block.text)
44:     IF block.type === 'thinking' emit Thought event(block)
45:     IF block.type === 'tool_call' collectPendingToolCall(block)   // ToolCallBlock; NO FunctionCall
46:   applyHookRestrictions(blocks, chunk.hookRestrictions)    // filterBlocksByAllowedTools (already block-based)
47: METHOD handlePendingFunctionCall(): void                   // rename intent: pending TOOL CALL
48:   pending = getPendingToolCallBlocks()                     // ToolCallBlock[]; NO FunctionCall[]
49:   emit ToolCallRequest events from pending
50: METHOD emitFinishReason(chunk: ModelStreamChunk): void     // BR-2/BR-3
51:   emit Finished { reason: mapToPublicReason(chunk.finishReason),
52:                   usageMetadata: chunk.usage,               // neutral UsageStats verbatim (§7A path 1)
53:                   outcome, stopReason: chunk.rawStopReason } // #2329 refusal; from rawStopReason (REQ-003.1) — NOT providerStopReason
```

## Integration Points (line-by-line)

- Line 14: DIRECT `{ CHUNK, value: chunk }` REPLACES `responseToModelStreamChunk(resp)` — `streamChunkWrapper.ts` DELETED (§3.2 #1).
- Line 15/17: `sendMessage` return-type flip to `ModelOutput` cascades to `AgentClientContract.generateDirectMessage` (REQ-009.2).
- Line 24-29: `output.afcHistory` (IContent[]) REPLACES the `toGeminiContents`/`toIContent` AFC round-trip (§2A.2 G6, §2A.4-II(g) TurnProcessor:728, §3.2 toIContent sites 757/775/808/827).
- Line 34: neutral `logApiRequest` REPLACES `toGeminiContents(iContents)` (G5).
- Line 41/45/48: `ContentBlock[]`/`ToolCallBlock` REPLACES `chunkToParts`→`Part[]`/`FunctionCall[]` (§2A.4-II(f)).
- Line 53: `chunk.rawStopReason` REPLACES `getProviderStopReason(candidate)` — `providerStopReason.ts` DELETED (REQ-003.1).

## Anti-Pattern Warnings

```
[ERROR] DO NOT: call responseToModelStreamChunk / chunkToParts — both deleted with streamChunkWrapper.ts.
[ERROR] DO NOT: read getProviderStopReason — use chunk.rawStopReason.
[ERROR] DO NOT: round-trip AFC through toGeminiContents/toIContent — afcHistory is already IContent[].
[ERROR] DO NOT: change the ServerAgentStreamEvent union shape (BR-2/RISK-1).
[ERROR] DO NOT: import ApiError as a value — use isProviderApiError.
[OK] DO: test by asserting emitted ServerAgentStreamEvent ordering + committed HistoryService state (behavioral), never {candidates} internals.
```
