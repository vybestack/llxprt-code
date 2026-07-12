# Phase 06: Stream-pipeline behavioral characterization — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P06`

## Prerequisites
- Required: Phase 05 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P05" packages/core/src/llm-types`
- Expected files from previous phase: neutral gap types IMPLEMENTED — `packages/core/src/llm-types/agentMessageInput.ts` (`iContentFromAgentMessageInput`/`iContentFromLegacyInput`), extended `modelEnvelope.ts` (`ModelOutput.afcHistory`, provider-metadata-preserving `toModelStreamChunk`), `sendParamsToRequest`.
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `stream-processor-neutral.md`, `turnprocessor-turn-wrap.md` — CHARACTERIZATION-ONLY phase: writes NO production code and implements NO pseudocode lines. It PINS the observable streaming behavior that the P07/P08 impls (which carry the concrete `@pseudocode lines X-Y` citations from these files) must preserve. These files are read here as the behavior catalog, not a line map to implement.

## Purpose (TDD-as-migration)
Pin the OBSERVABLE behavior of the streaming agent loop BEFORE migrating internals, so the migration (P07-P09) is proven behavior-preserving. Tests use the REAL `StreamProcessor`/`TurnProcessor`/`Turn`/`HistoryService`; mock ONLY the provider `AsyncIterable<IContent>`.

## Requirements Implemented (Expanded)

### REQ-002.1: Stream pipeline neutral end-to-end
**Full Text**: The streaming pipeline consumes provider `AsyncIterable<IContent>` and produces `ModelStreamChunk`, with NO synthetic `GenerateContentResponse` manufactured internally. `StreamProcessor` accumulates `ContentBlock[]`/`CanonicalFinishReason`; `TurnProcessor` wraps `ModelStreamChunk` into `StreamEvent.CHUNK` directly; `Turn` operates on `ContentBlock[]`.
**Behavior**:
- GIVEN: a provider stream of IContent
- WHEN: a turn runs
- THEN: emitted `ServerAgentStreamEvent`s (Content/Thought/ToolCallRequest/Finished) and committed history are identical to today, with no internal Google shape.

### REQ-INT-001: Old synthetic round-trip removed
**Full Text**: `convertIContentToResponse`, `streamChunkWrapper.ts`, and the `Part[]`/`GenerateContentResponse[]` accumulators are removed from the streaming path.
**Behavior**:
- GIVEN: the streaming path today (which fabricates a synthetic `GenerateContentResponse` per chunk and runs the AfterModel hook on it)
- WHEN: a turn runs
- THEN: its OBSERVABLE outputs (emitted `ServerAgentStreamEvent` sequence, committed history, AfterModel-hook modification/blocking/stop effects) are captured as the golden safety net so P07 can delete the synthetic response + the `_processAfterModelHook` `GenerateContentResponse` coupling without regressing behavior.

### REQ-INT-001.4 (C1): STREAMING AfterModel hook modification/blocking observable behavior pinned
**Full Text**: The STREAMING AfterModel hook path (`StreamProcessor._convertIContentStream` → `_processAfterModelHook`) currently fabricates a synthetic `GenerateContentResponse` per chunk and feeds it to `fireAfterModelEvent`, consuming `getModifiedResponse()`/blocking results as `GenerateContentResponse`. Its OBSERVABLE effects — (a) a hook that MODIFIES the response changes the emitted Content-event text/blocks; (b) a hook that BLOCKS (`isBlockingDecision`) surfaces the block reason and short-circuits; (c) a hook that STOPS (`shouldStopExecution`) raises the stop with the effective reason — are pinned as goldens BEFORE P07 neutralizes the path onto `ContentBlock[]` from the neutral `ModelStreamChunk`.
**Behavior**:
- GIVEN: an AfterModel hook registered to modify the streamed response text; WHEN: a turn streams; THEN: the emitted Content-event text reflects the hook's modification (observable), and the committed history reflects the modified content.
- GIVEN: an AfterModel hook that returns a blocking decision; WHEN: a turn streams; THEN: the block reason is surfaced (observable) and downstream sees the blocked outcome.
- GIVEN: an AfterModel hook that returns a stop decision; WHEN: a turn streams; THEN: execution stops with the effective reason (observable).
**Why This Matters**: C1 — P07 deletes the synthetic `convertIContentToResponse` inside `_convertIContentStream` AND retypes `_processAfterModelHook` off `GenerateContentResponse` in the SAME build-green phase (they are coupled). Without a golden pinning the modify/block/stop effects, that coupled deletion is unverifiable.

## Implementation Tasks (test-writing; behavioral; these are the SAFETY NET — they must remain GREEN through P07-P09)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P06`, `@requirement:REQ-002.1`, `@requirement:REQ-INT-001.4`

### Behavioral assertions (observable only — NO {candidates}/.parts internals)
- **Event ordering**: text chunks → Thought events for thinking blocks → ToolCallRequest for tool calls → Finished last. Assert the emitted `ServerAgentStreamEvent` sequence.
- **History-commit-once (BR-1)**: after a turn, `HistoryService` has exactly one model IContent appended; a mid-stream retry does NOT duplicate it (feed a provider stream that triggers InvalidStreamError then succeeds).
- **#2150 mid-stream transient retry (BR-9)**: a transient error mid-stream retries and completes; history committed once.
- **#2329 refusal (BR-3)**: provider IContent with `metadata.stopReason='refusal'` → Finished event carries `stopReason` reflecting refusal.
- **Usage/token accounting (BR-6)**: provider usage on the final chunk → Finished `usageMetadata` (neutral UsageStats) reflects it; absent-usage chunk falls back correctly.
- **Thinking/thoughtSignature (BR-5)**: thinking blocks produce Thought events; signatures retained in recorded history.
- **STREAMING AfterModel hook — MODIFY (C1, REQ-INT-001.4)**: register a real `AfterModel` hook (via `hookSystem.fireAfterModelEvent`, `getEnableHooks()===true`, `getHookSystem()` wired) whose `getModifiedResponse()` returns modified content; assert the emitted Content-event text AND the committed history reflect the modification — assert the OBSERVABLE text/history value, NEVER the `{candidates}`/`.parts` shape of the modified response.
- **STREAMING AfterModel hook — BLOCK (C1, REQ-INT-001.4)**: register an `AfterModel` hook returning `isBlockingDecision()===true` with an effective reason; assert the block reason is surfaced observably (the `AgentExecutionBlockedError`/blocked-outcome effect) — assert the reason value, not the synthetic response internals.
- **STREAMING AfterModel hook — STOP (C1, REQ-INT-001.4)**: register an `AfterModel` hook returning `shouldStopExecution()===true`; assert execution stops with the effective reason (`AgentExecutionStoppedError` effect / observable stop) — value only, no `{candidates}` shape.
- PROPERTY: for ANY sequence of text-only IContent chunks, concatenated Content-event text === concatenation of block texts (order-preserving).
- PROPERTY: exactly one model-history commit per successful turn regardless of chunk count.
- PROPERTY: for ANY AfterModel-modified text string, the emitted Content-event text after modification === that string (the hook's modification is faithfully observable).

## Forbidden
- NO assertions on `GenerateContentResponse`/`{candidates}`/`.parts` (these are exactly what we're deleting). This INCLUDES the AfterModel-hook golden tests: assert the modified/blocked/stopped OBSERVABLE outputs (emitted text, committed history, surfaced reason), NEVER the synthetic response's `{candidates}[0].content.parts` structure. Constructing a hook `llm_response` fixture in the hook JSON wire shape is allowed (that is the external wire, pinned by `hookWire.golden.test.ts` in P10); asserting the agents-internal synthetic `{candidates}` is NOT.
- NO mock theater; the provider mock yields real `IContent`, the rest is real (real `StreamProcessor`/`TurnProcessor`/`Turn`/`HistoryService`/`HookSystem`).

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # PASS against CURRENT code (characterizes today's behavior)
# C1: the streaming AfterModel modify/block/stop goldens exist and pass against current code
grep -nE "AfterModel|getModifiedResponse|isBlockingDecision|shouldStopExecution" packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # >=3 (modify, block, stop scenarios)
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # aggregate >=30%
```
NOTE: these tests PASS now (they characterize current behavior) and MUST keep passing through P07-P09. If any assert internal Google shape, rewrite them to observable behavior.

## Success Criteria
- Characterization tests exist, PASS against CURRENT code, and assert ONLY observable behavior (emitted `ServerAgentStreamEvent` sequence, committed history, retry/finish/stop reasons, AND the streaming AfterModel-hook modify/block/stop effects) — never `GenerateContentResponse`/`{candidates}`/`.parts`.
- **C1 streaming AfterModel goldens present:** modify, block, and stop scenarios each covered by an OBSERVABLE assertion, forming the safety net for P07's coupled deletion of the synthetic `convertIContentToResponse` in `_convertIContentStream` AND the `_processAfterModelHook` `GenerateContentResponse` retype.
- ≥30% property-based; no mock theater / reverse testing; provider stream is the only mock.

## Failure Recovery
1. If a test asserts internal Google shape: rewrite it to observable behavior; do NOT keep a structural assertion as a "characterization".
2. If a test does not pass against current code: the characterization is wrong — fix the test to reflect ACTUAL current behavior (this is the safety net for P07-P09).
3. `git checkout --` the test file and re-author if needed. Cannot proceed to Phase 07 until the safety net is green and behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P06.md`.
