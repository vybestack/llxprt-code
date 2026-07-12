# Phase 07: StreamProcessor neutralization — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P07`

## Prerequisites
- Required: Phase 06 completed (characterization safety net GREEN).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P06" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts` (observable-behavior safety net, PASSING against current code).
- Required: Phase 02 completed — the AST gate skeleton + `dev-docs/agents-neutral-gate-baseline.md` exist so this slice UPDATES (does not create) the ratchet baseline via `scripts/agents-neutral-gate.ts --count`.
- Verification: `test -f dev-docs/agents-neutral-gate-baseline.md && npx tsx scripts/agents-neutral-gate.ts --count`
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/stream-processor-neutral.md` — follow line numbers EXACTLY.

## Requirements Implemented (Expanded)

### REQ-002.1: Streaming pipeline is neutral (no synthetic response)
**Full Text**: The streaming pipeline consumes provider `AsyncIterable<IContent>` and produces `ModelStreamChunk` via `toModelStreamChunk(iContent)` directly; NO synthetic `GenerateContentResponse` is fabricated in `StreamProcessor`. The `convertIContentToResponse` call in `_convertIContentStream` is removed.
**Behavior**:
- GIVEN: a provider yields `IContent` chunks
- WHEN: the stream is processed
- THEN: the emitted `ServerAgentStreamEvent` sequence is identical to today (P06 characterization green) with NO `{candidates}` object constructed on the PROVIDER-OUTPUT path in `StreamProcessor`. (The before-model blocking-hook synthetic path is a separate machine, untouched here — see the C3 build-order boundary below.)
**Why This Matters**: eliminates the streaming half of the self-inflicted round-trip — the core of the migration.

### REQ-005.3: Accumulate on ContentBlock[]/CanonicalFinishReason
**Full Text**: Stream accumulation operates on `ContentBlock[]` and `CanonicalFinishReason` (not `Part[]`/Google `FinishReason`); adjacent `TextBlock`s consolidate with identical boundaries (BR-7); thoughts are filtered by config (BR-5); exactly one neutral `IContent` is committed to history per model run (BR-1).
**Behavior**:
- GIVEN: a multi-chunk model run with adjacent text + a thought + a tool call
- WHEN: accumulated
- THEN: history commits one `IContent{speaker:'ai'}` with merged text, the thinking filtered per config, and the tool call as a `ToolCallBlock` — committed exactly once.
**Why This Matters**: the accumulator is where the Google `Part[]` currency must die without changing observable history.

### REQ-INT-001: Synthetic round-trip removed (streaming ONLY — before-model hook path deferred to P13, C3)
**Full Text**: The streaming PROVIDER-OUTPUT synthetic-response round-trip is removed: the `convertIContentToResponse` CALL in `_convertIContentStream` and the `streamChunkWrapper`-based `Part[]`/`GenerateContentResponse[]` accumulation are deleted; StreamProcessor consumes `toModelStreamChunk(iContent)` directly and constructs no `{candidates}` envelope on the provider-output path. (The `convertIContentToResponse` FUNCTION is RETAINED until P13 because the direct path still calls it; only StreamProcessor's provider-output CALL is removed here.)
**Behavior**:
- GIVEN: P06 characterization
- WHEN: StreamProcessor is neutralized on the provider-output path
- THEN: the tests stay green and no synthetic response is built from the provider stream.
**Why This Matters**: build-green staged deletion (C3) — the function outlives this phase by design.

### REQ-002.6 (C1): STREAMING AfterModel hook neutralized in the SAME phase as the synthetic removal
**Full Text**: The STREAMING AfterModel hook path's MODIFY + STOP branches are neutralized HERE, coupled with the `_convertIContentStream` synthetic deletion (they are inseparable — `_processAfterModelHook` today consumes exactly the synthetic `convertIContentToResponse(iContent)` that this phase deletes). After this phase: (a) `_convertIContentStream` does NOT fabricate a per-chunk `GenerateContentResponse`; it iterates the neutral `ModelStreamChunk` (`toModelStreamChunk(iContent)`); (b) `_processAfterModelHook` runs AfterModel filtering on `ContentBlock[]` from the neutral chunk (via `filterHookRestrictedBlocks`, the neutral block filter ADDED here) — the `convertIContentToResponse(iContent).candidates?.[0]?.content ?? {role:'model',parts:[]}` fabrication+fallback is DELETED; (c) the hook still RECEIVES and RETURNS its byte-compatible JSON-wire shape via a SINGLE NAMED boundary adapter (`hookWireAdapter`, see below), NOT an internal synthetic response; (d) `fireAfterModelEvent` is called with the neutral filtered `IContent` (built via the NEW neutral-gap helper `iContentFromBlocks(filteredBlocks, chunk.content.speaker)` — C4; today `ContentConverters.toIContent(filteredContent)`, after this phase the neutral filtered blocks directly, no synthetic intermediary); (e) the MODIFY branch's `getModifiedResponse()` is converted to a neutral `ModelStreamChunk` at the `hookWireAdapter` boundary with NO `as GenerateContentResponse` cast; **(f) C3 — the BLOCK branch's error transport (`AgentExecutionBlockedError.syntheticResponse: GenerateContentResponse`) is NOT retyped here.** It is shared with the still-Google-shaped before-model (`beforeModelHookDecision.ts:68`) and direct writers and the `wrapChunk(GenerateContentResponse)` reader (`TurnProcessor.ts:78,:280`); retyping it in P07 would break the build at those un-migrated sites. So the AfterModel BLOCK branch KEEPS its `GenerateContentResponse` transport, and the after-model BLOCKING neutral adapter (`afterModelBlockingToModelOutput`) + the `AgentExecutionBlockedError` retype + the `TurnProcessor.ts:280`/`wrapChunk` reader update land in **P13**, atomic with the before-model blocking neutralization + the direct-path flip.
**Behavior**:
- GIVEN: an AfterModel hook that MODIFIES the response; WHEN: the stream is processed; THEN: the emitted Content-event text/blocks reflect the modification (P06 REQ-INT-001.4 modify golden stays green), derived by mapping the hook's JSON-wire `getModifiedResponse()` → neutral `ContentBlock[]`/`ModelStreamChunk` at `hookWireAdapter`, with NO synthetic `{candidates}` built in `StreamProcessor`.
- GIVEN: an AfterModel hook that STOPS; WHEN: processed; THEN: the stop reason is surfaced (P06 stop golden stays green) via the already-neutral `AgentExecutionStoppedError(reason string, systemMessage)` — no `GenerateContentResponse`.
- GIVEN: an AfterModel hook that BLOCKS; WHEN: processed; THEN: the block reason is surfaced (P06 block golden stays green) via `AgentExecutionBlockedError` whose `syntheticResponse` transport STAYS `GenerateContentResponse`-typed until P13 (C3) — the P06 block golden pins the OBSERVABLE `AGENT_EXECUTION_BLOCKED` event (reason/systemMessage/contextCleared + any surfaced chunk), which is preserved by both the pre-P13 (Google transport) and post-P13 (neutral transport) implementations, so the golden stays green across the P07→P13 boundary.
**Why This Matters**: C1 — the review correctly found the AfterModel MODIFY/STOP path is unaddressed and CANNOT be deferred: `_processAfterModelHook`'s input is the very synthetic response `_convertIContentStream` fabricates, so removing the fabrication and retyping the MODIFY consumption are one atomic build-green change. The BLOCK branch's error TRANSPORT is the one shared cross-cutting element (C3) that must flip in P13 with its co-writers/reader. The core hook JSON-wire DTO (`HookGenerateContentResponse`, core-owned — see C3 scope note below) is UNCHANGED; only the agents-side consumption is neutralized at one named adapter.

### C3-scope note (READ — the CORE hook-wire DTO is NOT retyped here): `HookGenerateContentResponse` stays; only the agents-side cast dies
**Full Text**: `afterModelResult.getModifiedResponse()` and `BeforeModelHookOutput.getSyntheticResponse()` are typed on the CORE-owned `HookGenerateContentResponse` (defined in `packages/core/src/hooks/hookTranslator.ts:81`; returned from `packages/core/src/hooks/types.ts:327`/`:480`) — this is the DELIBERATELY-PRESERVED external hook JSON-wire DTO, NOT `@google/genai`'s `GenerateContentResponse`. This issue does NOT retype that core DTO (it is the byte-compatible external wire; see `13-directmessageprocessor-impl.md` C3 scope note + domain-model OQ-1c). What IS neutralized HERE is the AGENTS-side consumption on the AfterModel MODIFY + STOP branches: today `StreamProcessor._processAfterModelHook` casts `afterModelResult.getModifiedResponse() as GenerateContentResponse` on BOTH the BLOCK branch (`StreamProcessor.ts:712`) and the MODIFY branch (`:729`). After this phase the MODIFY-branch cast (`:729`) is GONE (mapped to a neutral `ModelStreamChunk` at the single named `hookWireAdapter` boundary); **C3 — the BLOCK-branch cast (`:712`) + the `AgentExecutionBlockedError.syntheticResponse: GenerateContentResponse` transport REMAIN until P13**, because that error transport is shared with the still-Google-shaped before-model (`beforeModelHookDecision.ts:68`) and direct writers and the `wrapChunk(GenerateContentResponse)` reader (`TurnProcessor.ts:78,:280`). So after this phase EXACTLY ONE `getModifiedResponse() as GenerateContentResponse` cast survives in `StreamProcessor.ts` — the AfterModel BLOCK branch — and it is neutralized in P13 with the shared transport. (The BEFORE-model blocking-hook consumption of `getSyntheticResponse()` is ALSO a SEPARATE machine that stays `GenerateContentResponse`-typed until P13 — see the C3 build-order boundary below.)
**Behavior**:
- GIVEN: `StreamProcessor.ts` after this phase; WHEN: grepped for `getModifiedResponse() as GenerateContentResponse`; THEN: EXACTLY ONE hit — the AfterModel BLOCK branch (the MODIFY-branch cast is gone; the BLOCK-branch cast is retained until P13, C3). The core `HookGenerateContentResponse` DTO is unchanged and remains the allow-listed preserved hook wire.
**Why This Matters**: keeps the byte-compatible hook JSON wire intact (RISK-2 golden in P10 stays green) while removing the Google-shaped consumption from agents — the correct scope per the governing principle (agents-consumed contracts neutral; the external hook wire is a bounded preserved boundary).

### C3 — build-order boundary (READ FIRST): the BEFORE-MODEL blocking hook synthetic path STAYS `GenerateContentResponse` until P13
**Full Text**: This phase removes ONLY the streaming PROVIDER-OUTPUT round-trip. It DOES NOT touch the BEFORE-MODEL blocking-hook synthetic-response path, which is a SEPARATE machine and remains `GenerateContentResponse`-typed until P13:
- `StreamProcessor` calls `enforceBeforeModelHookDecision(beforeModelResult, hookRestrictedAllowedTools, (resp, candidate) => this._patchMissingFinishReason(resp, candidate))` (`StreamProcessor.ts:365-369`).
- `enforceBeforeModelHookDecision` (`beforeModelHookDecision.ts:38-77`) reads `beforeModelResult.getSyntheticResponse()` as `GenerateContentResponse`, patches a missing finish reason via the callback, and throws `AgentExecutionBlockedError` carrying that synthetic response.
- `_patchMissingFinishReason(syntheticResponse: GenerateContentResponse, candidate: NonNullable<GenerateContentResponse['candidates']>[0])` (`StreamProcessor.ts:378-383`) delegates to `streamRequestHelpers.patchMissingFinishReason` (`streamRequestHelpers.ts:162-169`), which builds `{ candidates: [{ ...candidate, finishReason: FinishReason.STOP }] }`.
Because `enforceBeforeModelHookDecision` / `BeforeModelHookOutput.getSyntheticResponse()` / `AgentExecutionBlockedError` still traffic `GenerateContentResponse` until the direct path is flipped, StreamProcessor CANNOT drop `GenerateContentResponse`/`FinishReason` here without breaking the build. Therefore:
- **KEEP** `_patchMissingFinishReason` and its `GenerateContentResponse`/`FinishReason` type imports in `StreamProcessor.ts` (used ONLY by the before-model blocking-hook path).
- **KEEP** `streamRequestHelpers.patchMissingFinishReason` (deleted in P13, not here).
- **DELETE both** the `patchMissingFinishReason` `{candidates}`+`FinishReason.STOP` path AND the before-model blocking synthetic-response machinery in **P13**, atomically with the `sendMessage`→`ModelOutput` flip and the DirectMessageProcessor `_buildBlockingSyntheticResponse` deletion (see `13-directmessageprocessor-impl.md` — C3 build-order role).
**Why This Matters**: removing the before-model `GenerateContentResponse` type here would leave `enforceBeforeModelHookDecision`/`AgentExecutionBlockedError` referencing a now-absent type mid-plan — a build break. The provider-output round-trip and the before-model-hook synthetic path are two DIFFERENT deletions; only the first happens here.

## Implementation Tasks (MODIFY existing file; P06 tests MUST stay green)

### The SINGLE named hook-wire adapter — `packages/agents/src/core/hookWireAdapter.ts` (CREATE; C1 + Additional Risk 1)
This phase creates the ONE named boundary module where the hook JSON wire (core-owned `HookGenerateContentResponse` / `applyLLMRequestModifications` target) is converted to/from neutral agents types. It is the ONLY place in agents where the hook JSON-wire shape is read/written; every hook interaction routes through it, and it is the central allow-listed hook-wire boundary (recorded in `dev-docs/agents-neutral-gate-allowlist.md`, AST-context-keyed, NOT file-level — the file contains ONLY wire adapters).
- Export `afterModelModifiedToChunk(modified: HookGenerateContentResponse | undefined, base: ModelStreamChunk): ModelStreamChunk | undefined` — maps a hook-modified JSON-wire response to a neutral `ModelStreamChunk` (blocks from the wire `candidates?.[0]?.content?.parts`/`text`), with NO `as GenerateContentResponse` cast and returning `undefined` when the hook did not modify. This is where the wire→neutral mapping lives, so `StreamProcessor` never touches the wire shape.
- **C3 — `afterModelBlockingToModelOutput` is NOT added in P07.** The after-model BLOCKING neutral transport (`afterModelBlockingToModelOutput(reason, base, systemMessage): ModelOutput`) is added to this adapter in **P13**, together with the `AgentExecutionBlockedError.syntheticResponse` retype, the `TurnProcessor.ts:280` reader update, and the before-model blocking neutralization — because the `AgentExecutionBlockedError` transport is shared with two still-Google-shaped writers (before-model, direct) and the `wrapChunk(GenerateContentResponse)` reader until P13. P07 lands ONLY the after-model MODIFY adapter export (`afterModelModifiedToChunk`); the BLOCK branch keeps its existing `GenerateContentResponse` transport until P13.
- (The BEFORE-model request adapter `beforeModel*`, the before-model BLOCKING adapter, AND the after-model BLOCKING adapter `afterModelBlockingToModelOutput` all live here too but are wired in P13 when the before-model/blocking paths flip; this phase adds ONLY the after-model MODIFY export. Additional Risk 1: the four hook interactions — before-model request, before-model blocking response, after-model modification, before-tool-selection — are ALL routed through this one module by the end of P13; P07 lands the after-model-modification path, P13 lands the before-model request/blocking + after-model-blocking paths, P11 lands before-tool-selection restriction metadata onto `chunk.hookRestrictions`.)
- The adapter imports the core hook-wire DTO type `HookGenerateContentResponse` from `@vybestack/llxprt-code-core` (the PRESERVED external wire — C3 scope note); it does NOT import `@google/genai`.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P07`, `@requirement:REQ-002.6`.

### `dev-docs/agents-neutral-gate-allowlist.md` — ADD the narrow `hookWireAdapter` AST-context entry HERE (Major 3 — same slice that introduces the adapter)
Because `hookWireAdapter.afterModelModifiedToChunk` reads the hook JSON-wire `candidates?.[0]?.content?.parts`/`text`, it is a structural-Gemini hit that the AST gate (`checkF`) would count. The allow-list entry for it MUST be added in THIS slice (P07 runs after P02's `--count` and before P31), so the P07 ratchet stays honest — the slice that introduces an allow-listed adapter adds its entry in the SAME slice, otherwise the early `--count` would increase or the slice would fail its own ratchet, tempting a gate weakening. Add an entry that is:
- **AST-context-keyed, NOT file-level:** the entry names EXACTLY the `hookWireAdapter.ts` function `afterModelModifiedToChunk` (its enclosing-function AST context) as the only permitted wire reader; a bare `hookWireAdapter.ts` file-path entry is REJECTED by the allow-list matcher (same rule as the G3 entry). A generic `candidates`/`content`/`parts` read in `hookWireAdapter.ts` OUTSIDE `afterModelModifiedToChunk` still FAILS the gate.
- **narrow (this slice adds ONLY `afterModelModifiedToChunk`):** P13 EXTENDS this entry with the additional named exports (`afterModelBlockingToModelOutput`/`beforeModelRequestToWire`/`wireToNeutralRequest`/`beforeModelBlockingToModelOutput`/`afterModelModifiedToModelOutput`); P31 only FINALIZES/tests the matcher. Do NOT pre-add the P13 exports here.
- **with a written justification:** the adapter is the single bounded external-wire boundary that immediately produces neutral `ModelStreamChunk` and returns NO Google-shaped value.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P07`, `@requirement:REQ-012.2`.

### `packages/agents/src/core/StreamProcessor.ts`
- `_convertIContentStream`: iterate the neutral `ModelStreamChunk` via `toModelStreamChunk(iContent)` (pseudocode line 15); DELETE the per-chunk `convertIContentToResponse(iContent)` fabrication + `attachHookRestrictedAllowedTools(convertIContentToResponse(...))` on the PROVIDER-OUTPUT path; yield the neutral chunk (with restrictions on `chunk.hookRestrictions`). `@pseudocode lines 13-19`.
- **`_processAfterModelHook` (C1 — RETYPE onto neutral blocks, SAME phase; the BLOCK branch's error transport is the ONE piece deferred to P13 — C3):** change the signature from `(iContent, llmRequest, convertedChunk: GenerateContentResponse, hookRestrictedAllowedTools)` to `(iContent, llmRequest, chunk: ModelStreamChunk, hookRestrictedAllowedTools)`. DELETE the `filterHookRestrictedContent(convertIContentToResponse(iContent).candidates?.[0]?.content ?? {role:'model',parts:[]}, ...)` fabrication+fallback (`StreamProcessor.ts:686-694`); replace with block-level filtering of `chunk.content.blocks` by the allowed-tool set. **Filter primitive (ordering-safe — NO forward dependency on P11):** the block-based restriction filter this phase needs ALREADY EXISTS as `turn.filterBlocksByAllowedTools` (`turn.ts:84`, `ContentBlock[]`→`ContentBlock[]`, verified used at `turn.ts:351`,`:573`). Extract it into a small shared neutral helper `filterHookRestrictedBlocks(blocks: ContentBlock[], allowedToolNames: string[] | undefined): ContentBlock[]` (same logic — drop `ToolCallBlock`s whose name is not in `allowedToolNames`) placed in `hookToolRestrictions.ts` as a NEW neutral export ADDED here (P07), leaving the existing WeakMap/`GenerateContentResponse` machinery in place for the before-model/direct paths until P11/P13. P07 does NOT delete the WeakMap machinery (that is P11); it only ADDS the neutral block filter it consumes and re-points `turn.ts` to the shared helper. Call `fireAfterModelEvent(llmRequest ?? {}, iContentFromBlocks(filteredBlocks, chunk.content.speaker))` (neutral `IContent` via the NEW neutral-gap helper `iContentFromBlocks(blocks, speaker?)` landed in P03-P05 — C4; NO synthetic intermediary). For the MODIFY branch, replace `afterModelResult.getModifiedResponse() as GenerateContentResponse` with `hookWireAdapter.afterModelModifiedToChunk(afterModelResult.getModifiedResponse(), chunk)` → returns a neutral `ModelStreamChunk` (the `{type:'modified'; response}` result type becomes `{type:'modified'; chunk: ModelStreamChunk}`). The STOP branch (`AgentExecutionStoppedError`) is already neutral (reason string) — keep it AS-IS. **C3 — the BLOCK branch's error TRANSPORT stays `GenerateContentResponse` until P13 (do NOT retype here):** the AfterModel BLOCK branch throws `AgentExecutionBlockedError(reason, syntheticResponse: GenerateContentResponse, systemMessage)` (`StreamProcessor.ts:711-726`). The `AgentExecutionBlockedError.syntheticResponse` field (`chatSession.ts:99`) is ALSO written by the still-Google-shaped BEFORE-model path (`beforeModelHookDecision.ts:68`) and the direct path (`DirectMessageProcessor`), and is READ at `TurnProcessor.ts:280` via `wrapChunk(error.syntheticResponse)` where `wrapChunk(resp: GenerateContentResponse)` (`TurnProcessor.ts:78`). Retyping that single field in P07 would break the build at BOTH other writers AND the `wrapChunk` reader (none of which migrate until P13). Therefore P07 does NOT retype `AgentExecutionBlockedError` and does NOT change the AfterModel BLOCK branch: it KEEPS the existing `getModifiedResponse() as GenerateContentResponse` + `attachHookRestrictedAllowedTools(...)` + `AgentExecutionBlockedError(reason, syntheticResponse, systemMessage)` on the BLOCK branch, and KEEPS the `hookWireAdapter.afterModelBlockingToModelOutput` export UN-WIRED until P13 (it is added to the adapter in P13, not P07). **P13 retypes `AgentExecutionBlockedError.syntheticResponse` → a neutral blocked payload, wires the AfterModel BLOCK branch through `hookWireAdapter.afterModelBlockingToModelOutput(...)`, and updates the `TurnProcessor.ts:280` reader + `wrapChunk` — atomically with the before-model blocking neutralization + the direct-path flip.** After THIS phase: the MODIFY + STOP branches are neutral (ZERO `as GenerateContentResponse` on the MODIFY branch, no `{role:'model',parts:[]}` fabrication); the BLOCK branch's `as GenerateContentResponse` + `syntheticResponse` transport is the ONLY residual after-model Google-shaped element, EXPECTED and build-green until P13. `@pseudocode lines 16-19` (after-model neutral hook branch).
  - **Ordering invariant (C1↔C4):** the AFTER-model streaming filter uses the NEW neutral `filterHookRestrictedBlocks` (added here). The `attachHookRestrictedAllowedTools`/`filterHookRestrictedContent` `GenerateContentResponse` machinery in `hookToolRestrictions.ts` is UNTOUCHED by P07 (still used by the before-model blocking path `:715`, the provider-output path being removed, and the direct path) and is fully removed in P11 (WeakMap/Symbol) + P13 (before-model `GenerateContentResponse`). P07 introduces the neutral primitive; it does not create a residual Google-shaped helper.
- `_convertIContentStream` MODIFY consumption: where it today does `if (hookResult.type === 'modified') { yield attachHookRestrictedAllowedTools(hookResult.response, ...) }`, yield `hookResult.chunk` (neutral `ModelStreamChunk`, restrictions already on `chunk.hookRestrictions`) instead. No `GenerateContentResponse` remains on the after-model streaming branch.
- `processStreamResponse`/`_finalizeStreamProcessing`: accumulate via `accumulateModelStreamChunk`; consolidate adjacent TextBlocks; filter thoughts by config; commit ONE neutral `IContent` (lines 20-32, BR-1/BR-5/BR-7).
- `syncTokenCounts`: read `usage.promptTokens` with absent-usage fallback (lines 41-43, OQ-2t).
- Hook restrictions ride `chunk.hookRestrictions` (line 18) — remove WeakMap writes on the provider-output/stream path here.
- Drop the PROVIDER-OUTPUT `@google/genai` imports that are now unused (`Content`/`Part`/`SendMessageParameters`/`GenerateContentConfig`); the request is typed `ModelGenerationRequest`. NOTE: `GenerateContentResponse`/`FinishReason` are still imported after this phase SOLELY for the before-model blocking-hook path (`_patchMissingFinishReason` + `enforceBeforeModelHookDecision`) — that is the C3 boundary below; the AFTER-model streaming path no longer references `GenerateContentResponse`.
- **C3 — DO NOT touch the before-model blocking-hook path:** KEEP `_patchMissingFinishReason(syntheticResponse: GenerateContentResponse, candidate)` (`:378-383`) and its `GenerateContentResponse`/`FinishReason` imports — they are consumed ONLY by `enforceBeforeModelHookDecision` (`:365-369`) and stay until P13. DO NOT neutralize `_patchMissingFinishReason`'s default here; DO NOT delete the `{candidates}`+`FinishReason.STOP` path here (that deletion is P13, atomic with the direct-path flip). After this phase StreamProcessor still imports `GenerateContentResponse`/`FinishReason` SOLELY for the before-model-hook synthetic path — expected and build-green. (The AFTER-model hook path IS neutralized here — the two hook machines are independent; only the before-model one is deferred.)

### Required Code Markers
EVERY touched/created function in this phase (`_convertIContentStream`, `_processAfterModelHook`, `hookWireAdapter.afterModelModifiedToChunk` [MODIFY export only — `afterModelBlockingToModelOutput` is added in P13, C3], `processStreamResponse`/`_finalizeStreamProcessing`, `syncTokenCounts`) MUST carry the marker block with the SPECIFIC `@pseudocode` line range for that function (from `stream-processor-neutral.md`), not only prose bullets:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07
 * @requirement:REQ-002.1
 * @requirement:REQ-005.3
 * @pseudocode lines 13-19   // _convertIContentStream: toModelStreamChunk (per-function range; use the exact lines for each function: processStreamResponse/_finalizeStreamProcessing lines 20-32; syncTokenCounts lines 41-43)
 */
```
- `_convertIContentStream` → `@pseudocode lines 13-19`; `@requirement:REQ-002.1`.
- `_processAfterModelHook` (C1 neutral retype) → `@pseudocode lines 16-19`; `@requirement:REQ-002.6`.
- `hookWireAdapter.afterModelModifiedToChunk` (MODIFY export only; `afterModelBlockingToModelOutput` is a P13 export — C3) → `@pseudocode lines 16-19` (after-model hook-wire boundary; annotate with the `stream-processor-neutral.md` after-model-hook range); `@requirement:REQ-002.6`.
- `processStreamResponse`/`_finalizeStreamProcessing` → `@pseudocode lines 20-32`; `@requirement:REQ-005.3`.
- `syncTokenCounts` → `@pseudocode lines 41-43`.
- Markers: `@plan:PLAN-20260707-AGENTNEUTRAL.P07`, `@requirement:REQ-002.1/REQ-002.6/REQ-005.3`, plus the per-function `@pseudocode lines X-Y` above.

### Shrink-ratchet baseline (M4) — Files to Modify (baseline CREATED in P02)
- `dev-docs/agents-neutral-gate-baseline.md` ALREADY EXISTS (created in **P02** with the initial AST-context-aware baseline integer + command). This phase RE-RUNS the AST counter and UPDATES the integer after StreamProcessor neutralization, recording the before→after (P02-baseline → post-P07) decrease:
  ```bash
  npx tsx scripts/agents-neutral-gate.ts --count   # AUTHORITATIVE AST-context-aware integer (from P02)
  ```
  This is the SAME AST-context-aware mechanism the final gate uses (Major 4/5) — NOT a broad grep — so the count is precise from this first slice. Record the updated integer + the before/after in the P07a marker.
- From this phase onward, EVERY migration-slice impl (P08/P09/P11/P13/P15/P17/P19/P21/P23/P25/P27) MUST reduce this AST `--count` (or hold at the bounded floor); the NNa verification asserts a strict decrease. The broad grep is advisory-only (verification-template §9), never a pass/fail gate.
- `@plan:PLAN-20260707-AGENTNEUTRAL.P07`, `@requirement:REQ-INT-001`.

## Integration Points (old code REMOVED)
- `convertIContentToResponse` CALL sites in StreamProcessor GONE (the function itself is retained until P13 — the direct path still uses it; C3 staged deletion).
- `streamResponseHelpers.consolidateTextParts`/`{role:'model',parts}` builder replaced by block consolidation (coordinated with P15).

## Constraints
- Do NOT modify P06 tests. No V2. No `any`/assertions/suppressions. Immutable.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # STILL green (incl. C1 AfterModel modify/block/stop goldens)
# ---- MAJOR 2: comment expectations are HARD-ASSERTED (fail the phase on violation), not advisory ----
# Provider-output path is neutral: the convertIContentToResponse CALL in _convertIContentStream is gone
# (removed on BOTH the provider-output path AND _processAfterModelHook; the FUNCTION lives in MessageConverter until P13).
if grep -qn "convertIContentToResponse" packages/agents/src/core/StreamProcessor.ts; then echo "FAIL: convertIContentToResponse CALL still present in StreamProcessor.ts"; exit 1; fi
# C1: the STREAMING AfterModel MODIFY branch is neutralized HERE; C3: the AfterModel BLOCK branch KEEPS its
# `getModifiedResponse() as GenerateContentResponse` + shared AgentExecutionBlockedError transport until P13.
# EXACTLY the block-branch cast survives here; the MODIFY-branch cast is gone:
c=$(grep -cE "getModifiedResponse\(\) *as *GenerateContentResponse" packages/agents/src/core/StreamProcessor.ts)
test "$c" -eq 1 || { echo "FAIL: expected EXACTLY ONE getModifiedResponse() as GenerateContentResponse (BLOCK branch, C3); found $c"; exit 1; }
grep -qnE "isBlockingDecision" packages/agents/src/core/StreamProcessor.ts || { echo "FAIL: AfterModel BLOCK branch missing (C3 transport must remain until P13)"; exit 1; }
if grep -qnE "role: *'model', *parts" packages/agents/src/core/StreamProcessor.ts; then echo "FAIL: {role:'model',parts} fabrication still present in _processAfterModelHook"; exit 1; fi
# The single named hook-wire adapter exists and is the ONLY agents module reading the hook JSON-wire shape:
test -f packages/agents/src/core/hookWireAdapter.ts   # CREATED (C1 / Additional Risk 1 boundary)
grep -qnE "afterModelModifiedToChunk" packages/agents/src/core/hookWireAdapter.ts || { echo "FAIL: afterModelModifiedToChunk export missing from hookWireAdapter.ts"; exit 1; }
if grep -qnE "afterModelBlockingToModelOutput" packages/agents/src/core/hookWireAdapter.ts; then echo "FAIL: afterModelBlockingToModelOutput must NOT be added until P13 (C3)"; exit 1; fi
if grep -qn "@google/genai" packages/agents/src/core/hookWireAdapter.ts; then echo "FAIL: hookWireAdapter.ts must import core HookGenerateContentResponse, NOT @google/genai"; exit 1; fi
# ---- MAJOR 3: the hookWireAdapter allow-list entry is added in THIS slice, AST-context-keyed (NOT file-level) ----
# (1) the entry exists and names the afterModelModifiedToChunk enclosing-function context (not a bare file path):
grep -nE "hookWireAdapter\.ts.*afterModelModifiedToChunk|afterModelModifiedToChunk.*hookWireAdapter\.ts" dev-docs/agents-neutral-gate-allowlist.md   # present (AST-context entry for the MODIFY export)
# (2) P07 adds ONLY afterModelModifiedToChunk — the P13 exports are NOT pre-added here:
if grep -nE "afterModelBlockingToModelOutput|beforeModelRequestToWire|wireToNeutralRequest|beforeModelBlockingToModelOutput|afterModelModifiedToModelOutput" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL(Major 3): P13 hookWireAdapter exports pre-added to the allow-list in P07"; exit 1; fi
# (3) a BARE FILE-LEVEL hookWireAdapter.ts entry is REJECTED by the matcher — prove via a P30 fixture scenario re-run
#     against a scratch: the entry MUST carry an AST-context (enclosing function), not just the path. Assert the entry
#     line is NOT a bare file path (it must reference the function context):
if grep -nE "^\s*[-|].*hookWireAdapter\.ts\s*$" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL(Major 3): bare file-level hookWireAdapter.ts entry present (must be AST-context-keyed)"; exit 1; fi
# (4) the count subtracts ONLY the named-context read: the adapter's afterModelModifiedToChunk wire read is EXEMPT
#     (not counted), while the net --count still strictly decreases below the P02 baseline (asserted below). If the
#     adapter read were NOT allow-listed, --count would not strictly decrease this slice.
echo "PASS(Major 3): hookWireAdapter allow-list entry added in P07, AST-context-keyed, MODIFY-export-only"
# C4: the neutral block->IContent helper used on the after-model event path is the real neutral-gap helper (P05), not a phantom:
grep -nE "iContentFromBlocks" packages/agents/src/core/StreamProcessor.ts   # present (imported from core neutral-gap types, P03-P05)
# C3 build-order: the ONLY remaining @google/genai / GenerateContentResponse usage in StreamProcessor is the
# BEFORE-model-hook synthetic path (_patchMissingFinishReason + enforceBeforeModelHookDecision), retained until P13.
# The ONLY remaining GenerateContentResponse/FinishReason usage in StreamProcessor is the BEFORE-model-hook
# synthetic path + the AfterModel BLOCK branch transport (C3, deferred to P13). This is a diagnostic listing
# (its presence is EXPECTED here) — the pass/fail on the MODIFY/STOP-branch neutralization is the cast-count above:
grep -n "GenerateContentResponse\|FinishReason" packages/agents/src/core/StreamProcessor.ts   # diagnostic: only _patchMissingFinishReason/enforceBeforeModelHookDecision (before-model) + the BLOCK-branch transport
# No `{ candidates: ... }` LITERAL is built here (a `candidates` TYPE ref inside _patchMissingFinishReason's
# signature is allowed). Fail if a candidates OBJECT LITERAL is constructed:
if grep -qnE "candidates:\s*\[" packages/agents/src/core/StreamProcessor.ts; then echo "FAIL: a { candidates: [...] } literal is constructed in StreamProcessor.ts"; exit 1; fi
# C4: the after-model event path uses the real neutral iContentFromBlocks helper (P05), not a phantom:
grep -qnE "iContentFromBlocks" packages/agents/src/core/StreamProcessor.ts || { echo "FAIL: iContentFromBlocks (neutral block->IContent, P05) not used on the after-model event path"; exit 1; }
test -f dev-docs/agents-neutral-gate-baseline.md || { echo "FAIL: baseline file missing (created P02, updated here)"; exit 1; }
# ---- MAJOR 4 + MAJOR 2: P07-OWNED structural-hit IDENTITY closure, HARD-ASSERTED (site-specific + net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly these structural-hit IDs; assert ABSENT now:
#   StreamProcessor.ts _convertIContentStream provider-output {candidates}/toModelStreamChunk-source hit;
#   streamResponseHelpers.ts accumulateChunkMetadata `.parts`/`candidates?.find` reads (:101-108, F5);
#   streamResponseHelpers.ts `{role:'model',parts}` history builder (:299-301, F3);
#   streamResponseHelpers.ts usage-key reads (:149-151, :308-314).
# Read the P07-owned hit IDs from the frozen baseline and assert each is ABSENT from the current --by-file output:
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p07_byfile.txt
while read -r id; do
  if grep -qF "$id" /tmp/p07_byfile.txt; then echo "FAIL(Major 4): P07-owned structural hit still present: $id"; exit 1; fi
done < <(grep -F 'owner=P07' dev-docs/agents-neutral-gate-baseline.md | sed -E 's/ *owner=P07.*//; s/^[-* ]*//')
# Net-count ratchet: STRICTLY LOWER than the recorded prior (P02) baseline integer (Major 2 — numeric, not a comment):
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than prior $prev"; exit 1; }
echo "PASS: P07 net --count $cur < prior $prev; owned hits closed"
npm run typecheck && npm run build   # green cross-package (build-green checkpoint P07)
```

## Success Criteria
- Characterization tests green (incl. the C1 streaming AfterModel modify/stop goldens AND the block golden across the P07→P13 boundary); StreamProcessor builds NO synthetic response from the PROVIDER-OUTPUT stream, no longer CALLS `convertIContentToResponse` (neither on the provider-output path NOR in `_processAfterModelHook`), and the streaming AfterModel MODIFY + STOP branches are neutralized onto `ContentBlock[]` with the hook JSON-wire MODIFY mapping confined to the new `hookWireAdapter.ts` (no MODIFY-branch `getModifiedResponse() as GenerateContentResponse` cast, no `{role:'model',parts}` fabrication in `StreamProcessor.ts`); **C3 — the AfterModel BLOCK branch KEEPS its `GenerateContentResponse` transport (`AgentExecutionBlockedError.syntheticResponse`) until P13** (shared with the before-model/direct writers + the `wrapChunk` reader), so EXACTLY the block-branch `as GenerateContentResponse` cast survives here; the BEFORE-model-hook synthetic path (`_patchMissingFinishReason` + `enforceBeforeModelHookDecision`) is UNTOUCHED and still `GenerateContentResponse`-typed (deleted in P13, C3); the core `HookGenerateContentResponse` DTO is UNCHANGED (preserved external wire, C3 scope); the after-model event path uses the real neutral `iContentFromBlocks` helper (C4, from P05); the AST `--count` (from P02) is STRICTLY LOWER than the P02 baseline and the baseline integer is updated with the before/after recorded; monorepo builds green.
- **Site-specific closure (Major 4):** every P07-OWNED baseline structural-hit ID (StreamProcessor provider-output `{candidates}`/`toModelStreamChunk` source; the `_processAfterModelHook` `{role:'model',parts}` fallback + the MODIFY-branch `getModifiedResponse() as GenerateContentResponse` cast; `streamResponseHelpers` `accumulateChunkMetadata` `.parts`/`candidates?.find` reads, `{role:'model',parts}` builder, and usage-key reads) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing; those IDs are removed from the baseline listing. **NOTE (C3):** the AfterModel BLOCK-branch `as GenerateContentResponse` + `syntheticResponse` transport is OWNED by **P13**, NOT P07 — it remains an open hit (or is baseline-tracked to P13) after P07 and is NOT claimed closed here. The new `hookWireAdapter.ts` after-model MODIFY export is recorded as the allow-listed hook-wire boundary in `dev-docs/agents-neutral-gate-allowlist.md` IN THIS SLICE (Major 3 — AST-context-keyed on `afterModelModifiedToChunk`, NOT a bare file-level entry; MODIFY-export-only, P13 extends it) so its bounded wire mapping is not a net-count regression and the P07 ratchet stays honest.

## Failure Recovery
1. If P06 tests break: `git checkout -- packages/agents/src/core/StreamProcessor.ts` and re-apply per pseudocode `stream-processor-neutral.md`; do NOT edit P06 tests.
2. If typecheck fails because `convertIContentToResponse` is now unreferenced-but-present in MessageConverter: that is EXPECTED (it is retained for the direct path until P13); do not delete it here.
3. If typecheck fails because you removed `GenerateContentResponse`/`FinishReason` from StreamProcessor and broke `_patchMissingFinishReason`/`enforceBeforeModelHookDecision`: RESTORE those imports — the before-model-hook synthetic path is NOT this phase's target (C3); it dies in P13.
4. Cannot proceed to Phase 08 until P06 green, typecheck+build green, and the baseline file exists.

## Phase Completion Marker
`project-plans/issue2349/.completed/P07.md`.
