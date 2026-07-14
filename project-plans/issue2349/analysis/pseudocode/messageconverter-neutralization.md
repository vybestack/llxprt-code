# Pseudocode: MessageConverter neutralization (delete synthetic fabricators; retype survivors)

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-002.4, REQ-006.2/.4, OQ-5/OQ-10.
Target file: `packages/agents/src/core/MessageConverter.ts` (NEUTRALIZE-IN-PLACE §3.2 #5).

## Interface Contracts

INPUTS: `IContent` (from provider/history), legacy input (`unknown`, at ingestion only).
OUTPUTS: `ContentBlock[]`/`IContent` conversions that SURVIVE; NOTHING that fabricates `GenerateContentResponse`.
DEPENDENCIES (real): `IContent`/`ContentBlock` (core), the neutral `iContentFromLegacyInput` (neutral-gap-types), `CanonicalFinishReason`. NO `@google/genai`, NO `createUserContent`, NO `FinishReason` value.

## DELETE (synthetic-response-only — REQ-002.4)

```
10: DELETE convertIContentToResponse (MessageConverter.ts:518-543)   // fabricates {candidates:[{content:{role,parts}}]}
11: DELETE applyResponseMetadata (:634)                              // metadata onto synthetic response
12: DELETE applyFinishReasonMapping (:550)                           // + the setProviderStopReason(:588) write (side-channel gone)
13: DELETE isValidResponse                                          // validates synthetic response
14: // callers of 10-13 are the streaming/direct synthetic paths — all removed by StreamProcessor/DirectMessageProcessor neutralization
```

## RETYPE / SURVIVE (OQ-5)

```
20: FUNCTION createUserContentFromInput(input: AgentMessageInput|unknown): IContent    // was createUserContentWithFunctionResponseFix (:138-173)
21:   // §2A.4-I(b): build IContent{speaker:'human'} directly; NO {role:'user',parts} literal
22:   RETURN iContentFromLegacyInput/iContentFromAgentMessageInput(input)
23: FUNCTION isValidIContent(c: IContent): boolean                   // was isValidContent(:242-254) reading content.parts
24:   RETURN c.blocks.length > 0 AND c.blocks.some(b => b.type==='text' ? b.text : true)   // block-based validity
25: FUNCTION extractCuratedHistoryNeutral(history: IContent[]): IContent[]   // was extractCuratedHistory(:272-314) iterating Content[] by role
26:   // iterate by speaker ('human'/'ai'/'tool'); validate via isValidIContent; NO .role/.parts
27:   RETURN collectModelRunsBySpeaker(history)
28: FUNCTION hasLeadingText(c: IContent): boolean                    // was hasTextContent(:320-333) reading content.parts[0].text
29:   RETURN c.blocks[0]?.type === 'text' AND c.blocks[0].text.length > 0
30: // classifyMixedParts/convertBlocksToParts/convertPartListUnionToIContent:
31: //   confirm callers in the impl phase; retype onto ContentBlock[] OR replace with core equivalents (getToolCallBlocks etc.).
```

## Integration Points (line-by-line)

- Lines 10-13: their sole callers are `StreamProcessor`/`TurnProcessor`/`DirectMessageProcessor` synthetic paths — verify zero remaining callers after those slices land (the gate check (d) also bans the symbol name).
- Line 20-22: consumed by `streamRequestHelpers.ts:67,76`, `DirectMessageProcessor.ts:233,239` (user-message ingestion) — now build `IContent` directly.
- Line 23-29: consumed by `ConversationManager` consolidation + curated-history extraction (`ConversationManager.ts:207`) — block-based.
- Line 12: deleting `applyFinishReasonMapping` removes the last `setProviderStopReason` writer, enabling `providerStopReason.ts` DELETE (REQ-003.1).

## Anti-Pattern Warnings

```
[ERROR] DO NOT: keep convertIContentToResponse "just in case" — it is the round-trip fabricator; DELETE.
[ERROR] DO NOT: import createUserContent / FinishReason from @google/genai.
[ERROR] DO NOT: build {role:'user',parts} — build IContent{speaker:'human'}.
[ERROR] DO NOT: read content.parts / content.role — read c.blocks / c.speaker.
[OK] DO: route thinking-bearing conversion through the signature-preserving path (BR-5/OQ-10).
```
