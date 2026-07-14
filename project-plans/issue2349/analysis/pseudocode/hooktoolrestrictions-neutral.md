# Pseudocode: hookToolRestrictions neutral redesign + providerStopReason retirement

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-003.1, REQ-003.2, BR-3, §6.2.
Target files: `packages/agents/src/core/hookToolRestrictions.ts` (NEUTRALIZE-IN-PLACE §3.2 #4), `packages/agents/src/core/providerStopReason.ts` (DELETE §3.2 #2).

## Interface Contracts

INPUTS: `ModelStreamChunk` (carries `hookRestrictions`), `ContentBlock[]`/`ToolCallBlock[]`, `allowedToolNames`.
OUTPUTS: filtered `ContentBlock[]`; `HookRestrictions` set on the chunk. NO `WeakMap`/`Symbol`, NO `Candidate.providerStopReason`.
DEPENDENCIES (real): `canonicalizeToolName` (existing), `ToolCallBlock` (core), `HookRestrictions` (core `modelEnvelope.ts`), `getToolCallBlocks` (core).

## providerStopReason.ts — DELETE (REQ-003.1)

```
10: DELETE file providerStopReason.ts entirely
11:   // interface CandidateWithProviderStopReason, setProviderStopReason, getProviderStopReason all gone
12: // Raw stop reason now flows: IContent.metadata.stopReason -> toModelStreamChunk -> chunk.rawStopReason
13: //   -> Turn.emitFinishReason Finished.stopReason (BR-3 / #2329). No bolted-on Candidate field.
```

## hookToolRestrictions.ts — NEUTRALIZE (REQ-003.2)

```
20: DELETE responseRestrictions/responseFilteredRestrictedCalls/functionCallRestrictions WeakMaps (:15-20)
21: DELETE responseRestrictionsSymbol/... Symbol props (:22-26)
22: DELETE HookRestrictedResponse/HookRestrictedFunctionCall types (:28-34)
23: FUNCTION applyHookRestrictionsToChunk(chunk: ModelStreamChunk, allowedTools: string[]): ModelStreamChunk
24:   // REPLACES attachHookRestrictedAllowedTools (which cloned a GenerateContentResponse and stamped metadata)
25:   toolCallBlocks = getToolCallBlocks(chunk.content)
26:   { kept, removed } = partition(toolCallBlocks, b => allowedTools.includes(canonicalizeToolName(b.name)))
27:   newBlocks = chunk.content.blocks.filter(b => b.type !== 'tool_call' OR kept.includes(b))
28:   RETURN { ...chunk,
29:            content: { ...chunk.content, blocks: newBlocks },
30:            hookRestrictions: { allowedToolNames: allowedTools, hadFilteredRestrictedCalls: removed.length > 0 } }
31: FUNCTION filterHookRestrictedBlocks(blocks: ContentBlock[], allowedTools?: string[]): ContentBlock[]
32:   // REPLACES filterHookRestrictedContent(:184-192) which read content.parts and returned {...content, parts:...}
33:   IF allowedTools === undefined RETURN blocks
34:   RETURN blocks.filter(b => b.type !== 'tool_call' OR allowedTools.includes(canonicalizeToolName(b.name)))
35: FUNCTION getHookRestrictedAllowedTools(chunk: ModelStreamChunk): string[] | undefined
36:   RETURN chunk.hookRestrictions?.allowedToolNames        // REPLACES WeakMap read
37: FUNCTION hasFilteredHookRestrictedToolCalls(chunk: ModelStreamChunk): boolean
38:   RETURN chunk.hookRestrictions?.hadFilteredRestrictedCalls === true   // REPLACES WeakMap read
39: // AFC filter (was hookToolRestrictions.ts:133 clone/parts-filter):
40: FUNCTION filterAfcByHookRestrictions(afc: IContent[], allowedTools?: string[]): IContent[]
41:   IF allowedTools === undefined RETURN afc
42:   RETURN afc.map(c => ({ ...c, blocks: filterHookRestrictedBlocks(c.blocks, allowedTools) }))
43:            .filter(c => c.blocks.length > 0)             // REPLACES (content.parts?.length ?? 0) > 0
```

## Integration Points (line-by-line)

- Line 12: consumed by `Turn.emitFinishReason` (turnprocessor-turn-wrap line 53).
- Line 23/28-30: consumed by `StreamProcessor._convertIContentStream` (stream-processor-neutral line 18) and `TurnProcessor._commitSendResult`.
- Line 31-34: consumed by `StreamProcessor._processAfterModelHook` (stream-processor-neutral line 34) + `DirectMessageProcessor` after-model.
- Line 35-38: consumed by `turn.ts` `processStreamChunk`/`handlePendingFunctionCall` (turnprocessor-turn-wrap line 46/48).
- Line 40-43: consumed by `TurnProcessor._recordAfcHistory` (turnprocessor-turn-wrap line 26) + `DirectMessageProcessor` AFC.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: keep any WeakMap/Symbol identity keying — deleted entirely.
[ERROR] DO NOT: clone a GenerateContentResponse to stamp restrictions — operate on ContentBlock[] + HookRestrictions.
[ERROR] DO NOT: reuse candidate.finishMessage for the raw stop reason — use chunk.rawStopReason (BR-3 rationale).
[ERROR] DO NOT: read content.parts in AFC filter — filter c.blocks.
[OK] DO: test restriction behavior by asserting which ToolCallRequest events are emitted + hadFilteredRestrictedCalls, not WeakMap internals.
```
