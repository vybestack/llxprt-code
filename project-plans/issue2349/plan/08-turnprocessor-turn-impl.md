# Phase 08: TurnProcessor wrap + Turn consumption — IMPL (STOP using streamChunkWrapper in core; file DELETED in P25)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P08`

## Prerequisites
- Required: Phase 07 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P07" packages/agents/src`
- Expected files from previous phase: `StreamProcessor.ts` (provider-output path neutralized to `toModelStreamChunk`), `dev-docs/agents-neutral-gate-baseline.md` (ratchet integer updated).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/turnprocessor-turn-wrap.md` — follow line numbers EXACTLY.

## Build-order invariant (READ FIRST — C2/C3/C4 fix)
This phase neutralizes the **streaming** wrap/consumption ONLY. It DOES NOT flip `TurnProcessor.sendMessage`'s
return type and DOES NOT delete `MessageConverter.convertIContentToResponse`, because the **direct
(non-streaming) path** (`DirectMessageProcessor`, `chatSession.convertIContentToResponse` facade at
`chatSession.ts:560-561`, `client.ts:781`, and `TurnProcessor.ts:526`) still produces a synthetic
`GenerateContentResponse` until Phase 13. `sendMessage` therefore continues to return
`Promise<GenerateContentResponse>` at the end of this phase and the monorepo stays **build-green**. The
`sendMessage` → `ModelOutput` flip and the final deletion of `convertIContentToResponse` both happen in
Phase 13, in the same phase that neutralizes the direct path (verified callers:
`grep -rn "convertIContentToResponse" packages/agents/src | grep -v test` — after P08 the remaining
callers are DirectMessageProcessor `:364`/`:752`, chatSession `:560`, client `:781`).

## C2 — `streamChunkWrapper.ts` is NOT deleted here (it has production consumers owned by LATER phases)
The file `packages/agents/src/core/streamChunkWrapper.ts` CANNOT be deleted in P08 because it still has
production importers OUTSIDE this phase's task set, owned by later vertical slices — deleting it now would
break `npm run typecheck`/`npm run build` at the P08 checkpoint. VERIFIED production consumers
(`grep -rnE "chunkToParts|responseToModelStreamChunk" packages/agents/src --include=*.ts | grep -v test`):
- `core/turn.ts:29`/`:348` (`chunkToParts`) — **migrated HERE (P08)**.
- `core/TurnProcessor.ts:63`/`:81` (`responseToModelStreamChunk`) — **migrated HERE (P08)**.
- `core/subagentNonInteractive.ts:44`/`:143` (`chunkToParts`) — **migrated in P23 (subagent slice)**.
- `agents/executor-stream-processor.ts:21`/`:191` (`chunkToParts`) — **migrated in P25 (executor slice)**.
Therefore: **P08 STOPS USING `streamChunkWrapper` in `TurnProcessor.ts` + `turn.ts` but does NOT delete the
file.** The whole-file DELETE moves to the LAST phase that removes its final PRODUCTION consumer. Because
the subagent slice (P23) precedes the executor slice (P25), the final production consumer
(`executor-stream-processor.ts`) is migrated in **P25**, so **`streamChunkWrapper.ts` is DELETED in P25**,
with a verification there that enumerates ALL production importers and proves zero remain (test-helper
importers — `executor-test-helpers.ts`, `subagent-test-helpers.ts`, `turn.tool-restrictions.test.ts`,
`turn-test-helpers.ts` — are migrated in the test-migration phase P28 / their slice test phases and are the
only remaining references, which the P25 deletion also accounts for). See `23-subagent-retypes-impl.md`
(stop using in `subagentNonInteractive.ts`) and `25-executor-retypes-impl.md` (stop using in
`executor-stream-processor.ts` + DELETE the file).

## Requirements Implemented (Expanded)

### REQ-002.2: TurnProcessor wraps ModelStreamChunk directly
**Full Text**: `TurnProcessor._runStreamAttempt` iterates `ModelStreamChunk` and `wrapChunk` wraps `ModelStreamChunk` DIRECTLY into `StreamEvent.CHUNK` — no `responseToModelStreamChunk`.
**Behavior**:
- GIVEN: a neutral `ModelStreamChunk` from `StreamProcessor`
- WHEN: `TurnProcessor` yields it
- THEN: `StreamEvent.CHUNK.value` IS the chunk (no synthetic-response conversion in between).
**Why This Matters**: removes the `streamChunkWrapper` boundary — one of the three neutral↔Google crossings.

### REQ-002.3: Turn operates on ContentBlock[]
**Full Text**: `Turn.processStreamChunk` operates on `ContentBlock[]`/`ToolCallBlock` from the neutral chunk — no `chunkToParts`, no `FunctionCall[]` re-derivation.
**Behavior**:
- GIVEN: `StreamEvent.CHUNK` carrying a `ModelStreamChunk`
- WHEN: `Turn` processes it
- THEN: it reads `chunk.content.blocks` (`ContentBlock[]`) and emits the same `ServerAgentStreamEvent`s — with no `Part[]` re-derivation.
**Why This Matters**: eliminates the final Google-shape re-derivation inside `Turn`.

### REQ-001.4 (streaming AFC): neutral AFC recording
**Full Text**: `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot so `automaticFunctionCallingHistory` survives synthetic-response removal, with identical slicing/hook-restriction-filter semantics (streaming path here; direct path in P13).
**Behavior**:
- GIVEN: a streaming turn producing AFC history
- WHEN: `TurnProcessor._recordAfcHistory` runs
- THEN: AFC is recorded from `afcHistory` (`IContent[]`), NOT a `toGeminiContents`/`toIContent` round-trip (BR-8).
**Why This Matters**: keeps AFC intact on the streaming path without a Google-shaped detour.

### REQ-INT-001 (streaming): stop using streamChunkWrapper in TurnProcessor + turn (file DELETED in P25)
**Full Text**: The streaming wrap/consumption in `TurnProcessor.ts` + `turn.ts` stops importing/calling `streamChunkWrapper` (`responseToModelStreamChunk`/`chunkToParts`); the `Part[]`/`GenerateContentResponse[]` accumulators are removed from the streaming path. The `streamChunkWrapper.ts` FILE is NOT deleted here (it still has production consumers in `subagentNonInteractive.ts` (P23) and `executor-stream-processor.ts` (P25)); the whole-file DELETE is owned by **P25** (the last phase removing its final production consumer). `convertIContentToResponse` dies in P13 with its last caller.
**Behavior**:
- GIVEN: the streaming path in `TurnProcessor.ts` + `turn.ts`
- WHEN: this phase completes
- THEN: neither file imports or calls `streamChunkWrapper`, and no streaming code in them re-derives `Part[]`; `streamChunkWrapper.ts` still EXISTS (its remaining importers are `subagentNonInteractive.ts`, `executor-stream-processor.ts`, and test helpers) and builds green.
**Why This Matters**: real dead-code removal WITHOUT breaking the build mid-plan (C2) — the file is deleted only when zero production importers remain (P25).

## Implementation Tasks (MODIFY; P06 tests stay green)

### `packages/agents/src/core/TurnProcessor.ts`
- `wrapChunk`: DIRECT `{ type: StreamEventType.CHUNK, value: chunk }` (line 13-14); DELETE `responseToModelStreamChunk` call.
- `_recordOutputContent`/`_recordAfcHistory`/`_syncTokenCounts`: neutral blocks + `afcHistory` (lines 18-32, BR-5/BR-8/OQ-2t); DELETE `toGeminiContents` (G6 here; G5 finalized in P19) + `toIContent` AFC round-trip. `@requirement:REQ-010.1` (G6 deletion).
- `_executeProviderCall` (`:526`): stop wrapping the streaming provider output in `convertIContentToResponse` (streaming caller removed here); the direct caller in DirectMessageProcessor remains until P13.
- `_logApiRequest`: neutral `IContent[]` (line 33-34).
- `ApiError` → `isProviderApiError` (line 35-36).
- **DO NOT** change `sendMessage`'s return type — it stays `Promise<GenerateContentResponse>` until P13 (build-order invariant above). Deferred to P13: `@requirement:REQ-004.3`.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P08`, `@requirement:REQ-002.2`, `@requirement:REQ-010.1` (G6 `toGeminiContents` deletion).

### `packages/agents/src/core/turn.ts`
- `processStreamChunk`/`handlePendingFunctionCall`: operate on `ContentBlock[]`/`ToolCallBlock` (lines 40-49); DELETE `chunkToParts`; drop `PartListUnion`/`FunctionCall`.
- `emitFinishReason`: `stopReason` from `chunk.rawStopReason` (lines 50-53); DELETE `getProviderStopReason`.
- `req: PartListUnion` → `AgentMessageInput` (feeds `iContentFromAgentMessageInput`).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P08`, `@requirement:REQ-002.3`.

### DO NOT DELETE `streamChunkWrapper.ts` here (C2) — file DELETE owned by P25
- This phase REMOVES the `streamChunkWrapper` import + calls from `TurnProcessor.ts` and `turn.ts` ONLY. It does NOT delete `packages/agents/src/core/streamChunkWrapper.ts` — that file still has production importers `subagentNonInteractive.ts` (P23) and `executor-stream-processor.ts` (P25). The whole-file DELETE (all exports `responseToIContent`/`responseToModelStreamChunk`/`chunkToParts`/`usageMetadataToUsageStats` — §3.2 #1) happens in **P25**, after the executor slice removes the final production consumer, with a verification there enumerating ALL production importers and proving zero remain.

### Required Code Markers
EVERY touched function MUST carry the marker block with the SPECIFIC `@pseudocode` line range for that function (from `turnprocessor-turn-wrap.md`), not only the prose bullets above:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P08
 * @requirement:REQ-002.2
 * @pseudocode lines 13-14   // wrapChunk (use the exact per-function range for each touched function)
 */
```
- `TurnProcessor.wrapChunk` → `@pseudocode lines 13-14`; `@requirement:REQ-002.2`.
- `TurnProcessor._recordOutputContent`/`_recordAfcHistory`/`_syncTokenCounts` → `@pseudocode lines 18-32`; `@requirement:REQ-001.4`, `@requirement:REQ-010.1` (G6 deletion).
- `TurnProcessor._logApiRequest` → `@pseudocode lines 33-34`.
- `turn.processStreamChunk`/`handlePendingFunctionCall` → `@pseudocode lines 40-49`; `@requirement:REQ-002.3`.
- `turn.emitFinishReason` → `@pseudocode lines 50-53`.
- Markers: `@plan:PLAN-20260707-AGENTNEUTRAL.P08`, `@requirement:REQ-002.2/REQ-002.3/REQ-010.1`, plus the per-function `@pseudocode lines X-Y` above.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # green
# C2 — streamChunkWrapper.ts is NOT deleted here (deleted in P25); it STILL EXISTS with production importers:
test -f packages/agents/src/core/streamChunkWrapper.ts   # STILL PRESENT (consumers in subagentNonInteractive.ts P23 + executor-stream-processor.ts P25)
# TurnProcessor.ts + turn.ts no longer use it; the ONLY remaining production importers are the two later-slice files:
if grep -rnE "streamChunkWrapper|responseToModelStreamChunk|chunkToParts" packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/turn.ts; then echo "FAIL: TurnProcessor.ts/turn.ts still use streamChunkWrapper here"; exit 1; fi
# ONLY subagentNonInteractive.ts (P23) + executor-stream-processor.ts (P25) may still reference these until their slices:
scw=$(grep -rnE "chunkToParts|responseToModelStreamChunk" packages/agents/src --include=*.ts | grep -v test | grep -vE "core/subagentNonInteractive\.ts|agents/executor-stream-processor\.ts")
if [ -n "$scw" ]; then echo "FAIL: unexpected chunkToParts/responseToModelStreamChunk site:"; echo "$scw"; exit 1; fi
# getProviderStopReason must survive ONLY inside streamChunkWrapper.ts (turn.ts stopped reading it here):
psr=$(grep -rn "getProviderStopReason" packages/agents/src --include=*.ts | grep -v test | grep -v "core/streamChunkWrapper\.ts")
if [ -n "$psr" ]; then echo "FAIL: getProviderStopReason read outside streamChunkWrapper.ts:"; echo "$psr"; exit 1; fi
if grep -rn "@google/genai" packages/agents/src/core/turn.ts; then echo "FAIL: turn.ts not fully neutral (@google/genai remains)"; exit 1; fi
# BUILD-GREEN INVARIANT: TurnProcessor.sendMessage STILL returns GenerateContentResponse here (flipped in P13);
# convertIContentToResponse STILL exists (deleted in P13). Both are expected.
grep -n "sendMessage" packages/agents/src/core/TurnProcessor.ts | grep -q "GenerateContentResponse" && echo "sendMessage still Google-shaped (expected until P13)"
# ---- MAJOR 4: P08-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly these structural-hit IDs; assert ABSENT now:
#   streamChunkWrapper.responseToIContent .parts/candidate.content reads (:77-83, whole-file DELETE);
#   TurnProcessor._recordOutputContent .parts filter/gate (:796-803, F3/F5) + `{role:'model',parts}` (:828);
#   TurnProcessor AFC content-length filter (:728, G-filter); TurnProcessor usage-key read (:844-850);
#   TurnProcessor _recordAfcHistory toGeminiContents G6 (:747); turn.ts chunkToParts/Part[] path.
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p08_byfile.txt   # per-site detail; assert EACH P08-owned baseline hit ID ABSENT below, then remove from the baseline listing
# Mechanical shrink-ratchet (Major 2): net --count MUST be STRICTLY LOWER than the prior slice (P07) recorded in the baseline file.
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than prior (P07) $prev"; exit 1; }
echo "PASS: P08 net --count $cur < prior (P07) $prev"
npm run typecheck && npm run build   # green cross-package (build-green checkpoint P08)
```

## Success Criteria
- `TurnProcessor.ts` + `turn.ts` no longer import/call `streamChunkWrapper` (`responseToModelStreamChunk`/`chunkToParts`); `turn.ts` fully neutral; streaming path yields `ModelStreamChunk` directly; public event shape unchanged; characterization green; monorepo build green with `sendMessage` still `GenerateContentResponse` (direct path un-migrated until P13). **`streamChunkWrapper.ts` STILL EXISTS** (its production importers `subagentNonInteractive.ts` (P23) + `executor-stream-processor.ts` (P25) are not migrated yet) — its whole-file DELETE is owned by P25 (C2). Deleting it here would break typecheck/build.
- **Site-specific closure (Major 4):** every P08-OWNED baseline structural-hit ID (TurnProcessor `_recordOutputContent` `.parts` filter + `{role:'model',parts}`; TurnProcessor AFC content-length filter; TurnProcessor usage-key read; G6 `toGeminiContents`; turn.ts `chunkToParts` USAGE) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing below P07; those IDs are removed from the baseline listing. NOTE: the `streamChunkWrapper.responseToIContent` `.parts`/`candidate.content` hit is NOT closed here — it is owned by the P25 file DELETE (its last production consumer migrates in P25); P08 removes only the `TurnProcessor`/`turn.ts` `chunkToParts`/`responseToModelStreamChunk` USAGE hits.

## Failure Recovery
If this phase fails (characterization red, build breaks, or an accidental `sendMessage` flip breaks the still-Google direct path):
1. `git checkout -- packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/turn.ts`
2. If the build breaks because `subagentNonInteractive.ts`/`executor-stream-processor.ts` lost their `chunkToParts` import: you MUST NOT have deleted `streamChunkWrapper.ts` in this phase (C2) — restore it from HEAD; the file DELETE is owned by P25.
3. Re-apply strictly per the build-order invariant (streaming-only changes in `TurnProcessor.ts`/`turn.ts`; NO `streamChunkWrapper.ts` deletion; NO sendMessage flip; NO convertIContentToResponse deletion). Cannot proceed to Phase 09 until build is green and P06 is green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P08.md`.
