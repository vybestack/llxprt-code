# Pseudocode: DirectMessageProcessor (non-streaming) neutralization

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-004.1/.2/.3, REQ-001.4 (AFC), REQ-006.3, OQ-1c/OQ-2/OQ-14.
Target file: `packages/agents/src/core/DirectMessageProcessor.ts` (RETYPE §3.2 #14).

## Interface Contracts

INPUTS: neutral turn request DTO; provider `AsyncIterable<IContent>` (collected to final).
OUTPUTS: `ModelOutput` (neutral) on BOTH blocking-BeforeModel and normal paths. NO `GenerateContentResponse`.
DEPENDENCIES (real): `toModelStreamChunk`/`accumulateModelStreamChunk` (core), `filterHookRestrictedBlocks`/`filterAfcByHookRestrictions` (neutral hookToolRestrictions), `isProviderApiError`. NO synthetic fabricator.

## generateDirectMessage (RETYPE → ModelOutput)

```
10: METHOD generateDirectMessage(request): Promise<ModelOutput>
11:   userIContents = iContentFromAgentMessageInput(request.message)      // §2A.3 streamRequestHelpers/DirectMessageProcessor:233,239
12:   logApiRequest(runtimeContext, state, userIContents, ...)            // neutral; DELETE toGeminiContents (G7)
13:   beforeModel = fireBeforeModelHook(request)
14:   IF beforeModel.blocks
15:     RETURN buildBlockingModelOutput(beforeModel)                      // OQ-1c; NO _buildBlockingSyntheticResponse
16:   final = collectProviderOutput(request)                             // ModelOutput via accumulate
17:   afc = getNeutralAfcHistory(final)                                  // REQ-001.4
18:   processed = processDirectResponse(final, afc)
19:   RETURN processed
20: FUNCTION buildBlockingModelOutput(beforeModel): ModelOutput          // REPLACES _buildBlockingSyntheticResponse(:677-701)
21:   RETURN { content: { speaker:'ai', blocks:[ { type:'text', text: beforeModel.reason } ] },
22:            finishReason: 'stop', rawStopReason: beforeModel.rawReason }   // neutral; NO {candidates} cast/literal
23: FUNCTION getNeutralAfcHistory(final: ModelOutput): IContent[]         // OQ-2; was getIContentAutomaticFunctionCallingHistory(:99-110)
24:   RETURN final.afcHistory ?? []                                      // from ModelOutput.afcHistory (providerMetadata not load-bearing)
25: FUNCTION processDirectResponse(final: ModelOutput, afc): ModelOutput  // §2B.1 non-streaming after-model
26:   allowedTools = final.hookRestrictions?.allowedToolNames
27:   filteredBlocks = filterHookRestrictedBlocks(final.content.blocks, allowedTools)   // NO convertIContentToResponse
28:   filteredAfc = filterAfcByHookRestrictions(afc, allowedTools)                      // REPLACES (content.parts?.length??0)>0 (:386,:764)
29:   fireAfterModelEvent(request, { speaker:'ai', blocks: filteredBlocks })            // neutral IContent to hook
30:   RETURN { ...final, content:{ speaker:'ai', blocks: filteredBlocks }, afcHistory: filteredAfc }
31: FUNCTION ensureResponseText(out: ModelOutput): ModelOutput           // was _ensureResponseText(:855-880) mutating candidate.content.parts
32:   IF getResponseTextFromBlocks(out.content.blocks) === ''
33:     RETURN { ...out, content:{ ...out.content, blocks:[ ...out.content.blocks, { type:'text', text:'' } ] } }  // block-based
34:   RETURN out
35: FUNCTION extractResponseText(out: ModelOutput): string              // was _extractResponseText(:894-899)
36:   RETURN getResponseTextFromBlocks(out.content.blocks) ?? ''         // ContentBlock[]; NO candidates?.[0]?.content?.parts
37: // reasoning tokens (OQ-14): out.usage.reasoningTokens populated when present so direct path matches streaming
38: METHOD errorPath(e): IF isProviderApiError(e) ...                    // REQ-006.3; DELETE ApiError value import(:12)
```

## Integration Points (line-by-line)

- Line 11-12: neutral ingestion + neutral telemetry REPLACE `toGeminiContents(userIContents)` (G7) + `logApiRequest`.
- Line 15/20-22: `buildBlockingModelOutput` REPLACES `_buildBlockingSyntheticResponse` (§2B.2-3, §3.2 function-delete inventory) — a blocking BeforeModel hook yields neutral `ModelOutput` (OQ-1c).
- Line 24: `final.afcHistory` REPLACES `automaticFunctionCallingHistory` provider-metadata read (`:755-764`) — OQ-2/OQ-15.
- Line 27-30: `filterHookRestrictedBlocks`/`filterAfcByHookRestrictions` REPLACE the after-model synthetic fabrication (`convertIContentToResponse` at `:744-753`) + `.parts` filters (`:386,:764,:775-779`).
- Line 31-36: block-based text extraction REPLACES `_ensureResponseText`/`_extractResponseText` `.parts` mutation (§2A.4-II(f)).
- Line 38: `isProviderApiError` REPLACES `ApiError` value import.
- Return-type flip cascades to `TurnProcessor.sendMessage` (ModelOutput) and `AgentClientContract.generateDirectMessage` (REQ-009.2).

## Anti-Pattern Warnings

```
[ERROR] DO NOT: fabricate a GenerateContentResponse on EITHER the blocking or normal path.
[ERROR] DO NOT: read candidate.content.parts / candidates?.[0] — read out.content.blocks.
[ERROR] DO NOT: read automaticFunctionCallingHistory from providerMetadata — read final.afcHistory.
[ERROR] DO NOT: drop reasoningTokens on the direct path (OQ-14).
[OK] DO: test by asserting the returned ModelOutput blocks/usage/afcHistory + committed history, never {candidates}.
```
