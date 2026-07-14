# Phase 13: DirectMessageProcessor neutralization — IMPL (sendMessage→ModelOutput; FINAL synthetic deletion)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P13`

## Prerequisites
- Required: Phase 12 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P12" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/__tests__/directMessage.characterization.test.ts` (blocking + normal path OBSERVABLE behavior via current accessors, PASSING against current code).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/directmessageprocessor-neutral.md` — follow line numbers EXACTLY.

## Build-order role (READ FIRST — C3/C4 fix)
This is the phase that neutralizes the LAST callers of BOTH synthetic-response machines (the provider-output
fabricator AND the before-model blocking-hook synthetic path), so it also performs the FINAL deletions
deferred from P07/P08/P09/P11:
- **C4:** flip `TurnProcessor.sendMessage` from `Promise<GenerateContentResponse>` to `Promise<ModelOutput>` HERE, in the same phase that makes the direct path return `ModelOutput` — no temporary adapter needed.
- **C3 (provider-output fabricator):** delete `MessageConverter.convertIContentToResponse` (`:518-543`) + its exclusive helper chain `applyResponseMetadata` (`:634`) + `applyFinishReasonMapping` (`:550`, incl. the `setProviderStopReason` write at `:588`) once the direct path, the `chatSession.convertIContentToResponse` facade (`chatSession.ts:560-561`), `client.ts:781`, and `TurnProcessor.ts:526` stop calling it.
- **C3 (before-model blocking-hook synthetic path — deferred from P07):** neutralize the before-model blocking-hook synthetic-response machinery that P07 intentionally left `GenerateContentResponse`-typed:
  - `beforeModelHookDecision.ts:38-77` `enforceBeforeModelHookDecision` — retype so the blocking decision no longer flows a `GenerateContentResponse` from `getSyntheticResponse()`; it yields a neutral blocking result (`ModelOutput`/hook result) carried by `AgentExecutionBlockedError`, consistent with `buildBlockingModelOutput` (OQ-1c). Drop the `PatchFinishReasonFn` callback param + `GenerateContentResponse`/`FinishReason` imports.
  - `StreamProcessor.ts:378-383` `_patchMissingFinishReason` — DELETE (its only consumer, `enforceBeforeModelHookDecision`, no longer needs it); drop the now-unused `GenerateContentResponse`/`FinishReason` imports from `StreamProcessor.ts`. Update the `enforceBeforeModelHookDecision(...)` call at `StreamProcessor.ts:365-369` to the neutral signature.
  - `streamRequestHelpers.ts:162-169` `patchMissingFinishReason` — DELETE (the `{candidates}`+`FinishReason.STOP` builder); drop its runtime `FinishReason` import.
  - Verify: after P13, `grep -rn "patchMissingFinishReason\|getSyntheticResponse" packages/agents/src | grep -v test` ⇒ no production `GenerateContentResponse`-typed path remains (only neutral blocking-result handling).
- **C2 — providerStopReason WRITER removed HERE; FILE DELETE deferred to P25.** Deleting `applyFinishReasonMapping` removes the WRITER `setProviderStopReason(...)` at `MessageConverter.ts:588`. But do NOT delete `packages/agents/src/core/providerStopReason.ts` here: its READER `getProviderStopReason` at `streamChunkWrapper.ts:112` still physically exists inside `streamChunkWrapper.ts`, which is not deleted until P25 (its last production consumer `executor-stream-processor.ts` migrates then). Deleting the file here would dangle `streamChunkWrapper.ts:112`'s `import { getProviderStopReason }` and break the build. After P13 `providerStopReason.ts` has exactly ONE remaining reference (that reader); the whole-file DELETE lands in P25 with the `streamChunkWrapper.ts` delete. (Verify after P13: `grep -rn "providerStopReason" packages/agents/src | grep -v test` ⇒ only `streamChunkWrapper.ts:112` (reader) + the file itself; the writer is gone.)
- **C4 (before-model blocking compat deletion):** DELETE `packages/agents/src/core/beforeModelBlockingCompat.ts` (the temporary before-model blocking `GenerateContentResponse` restriction-stamping helper created in P11) HERE, when `enforceBeforeModelHookDecision`/`_buildBlockingSyntheticResponse` stop producing a `GenerateContentResponse` blocking response. Re-point their callers to the neutral `buildBlockingModelOutput` path (OQ-1c). Remove its `dev-docs/agents-neutral-gate-allowlist.md` entry.
- **C1/C3 (AFTER-model NON-STREAMING hook — neutralize the direct-path cast HERE):** `DirectMessageProcessor._applyAfterModelResult` (`:816-846`) and `_processDirectResponse` (`:744-795`) today cast `afterModelResult.getModifiedResponse() as GenerateContentResponse` (`:826-828`) and filter `directResponse.candidates?.[0]?.content` on a synthetic response. Retype the direct AFTER-model hook onto neutral blocks routed through the SAME single named `hookWireAdapter` created in P07: the modify branch uses `hookWireAdapter.afterModelModifiedToModelOutput(getModifiedResponse(), baseModelOutput)` (direct-path variant returning `ModelOutput`), filtering runs on `ContentBlock[]` via `filterHookRestrictedBlocks`, the neutral filtered blocks are wrapped for `fireAfterModelEvent` via the shared `iContentFromBlocks(filteredBlocks, ...)` helper (C4, from P05 — the SAME helper P07 uses on the streaming path), and NO `as GenerateContentResponse` cast / NO `candidate.content.parts` read remains on the direct path. This completes the C1 hook neutralization symmetrically across streaming (P07) and non-streaming (P13); the core `HookGenerateContentResponse` wire DTO is UNCHANGED (C3 scope).
- **C3 (STREAMING AfterModel BLOCK branch + the shared `AgentExecutionBlockedError` transport retype — deferred from P07):** P07 neutralized the streaming AfterModel MODIFY + STOP branches but LEFT the streaming AfterModel BLOCK branch (`StreamProcessor.ts:711-726`) on `GenerateContentResponse` because the `AgentExecutionBlockedError.syntheticResponse` field is shared with two still-Google-shaped writers (before-model `beforeModelHookDecision.ts:68`, direct `DirectMessageProcessor`) and the `wrapChunk(GenerateContentResponse)` reader (`TurnProcessor.ts:78,:280`). P13 is where ALL THREE writers become neutral at once, so THIS phase performs the shared-transport retype atomically:
  - **Retype `AgentExecutionBlockedError` (`packages/agents/src/core/chatSession.ts:96-118`):** replace the field/2nd-constructor-param `syntheticResponse?: GenerateContentResponse` with a neutral `blockedOutput?: ModelOutput` (preserving the observable `reason`/`systemMessage`/`contextCleared` semantics and the falsy-coalescing message rule). Drop the `GenerateContentResponse` import from `chatSession.ts` if it becomes unused. (The sibling `AgentExecutionStoppedError` already carries no response payload — verify it stays neutral; no change needed.)
  - **Streaming BLOCK branch (`StreamProcessor.ts:711-726`):** replace `getModifiedResponse() as GenerateContentResponse` + `attachHookRestrictedAllowedTools(...)` + `AgentExecutionBlockedError(reason, syntheticResponse, systemMessage)` with `AgentExecutionBlockedError(reason, hookWireAdapter.afterModelBlockingToModelOutput(effectiveReason, baseChunk, systemMessage), systemMessage)` — the neutral `ModelOutput` payload. This removes the LAST `getModifiedResponse() as GenerateContentResponse` cast in `StreamProcessor.ts`.
  - **Before-model BLOCK writer (`beforeModelHookDecision.ts:68`) + direct BLOCK writer (`DirectMessageProcessor`):** already retyped to neutral in this phase (see the before-model blocking-hook bullet above + `buildBlockingModelOutput`); their `AgentExecutionBlockedError(...)` construction now passes the neutral `blockedOutput` (`ModelOutput`), not a `GenerateContentResponse`.
  - **Reader (`TurnProcessor.ts:273-283`):** update the `AgentExecutionBlockedError` catch so it consumes `error.blockedOutput` (neutral `ModelOutput`) instead of `error.syntheticResponse`; where it today does `if (error.syntheticResponse) yield wrapChunk(error.syntheticResponse)`, it now yields the neutral chunk directly (`if (error.blockedOutput) yield { type: StreamEventType.CHUNK, value: toModelStreamChunk-or-modelOutput-as-chunk }`) — since after the C4 `sendMessage→ModelOutput` flip and the P25 `streamChunkWrapper` delete, `wrapChunk` no longer takes `GenerateContentResponse`. Preserve the observable `AGENT_EXECUTION_BLOCKED` event + any surfaced blocked chunk (P06 block golden + P12 direct characterization stay green across the flip).
  - Add the `afterModelBlockingToModelOutput(reason, base, systemMessage): ModelOutput` export to `hookWireAdapter.ts` HERE (it was intentionally NOT added in P07 — C3), alongside the before-model/direct exports below.
- KEEP `MessageConverter.isValidResponse` (`:228`) — its last caller `streamResponseHelpers.ts:109` migrates in P15; it is deleted there. (Verify: after P13, `grep -rn "isValidResponse" packages/agents/src | grep -v test` ⇒ only `streamResponseHelpers.ts:109` + the definition.)

> **C1 — this is where the TYPE-SURFACE assertions live.** P12 characterized OBSERVABLE current behavior (visible text/usage/AFC through the current surface) and does NOT assert the return type. The "returns `ModelOutput` / no synthetic response / neutral content type" assertions are made HERE (impl) and in P13a (verification), where they go green AFTER the flip.

Compile-green checkpoint: after this phase `grep -rn "convertIContentToResponse\|patchMissingFinishReason" packages/agents/src | grep -v test` ⇒ EMPTY, and the monorepo builds green.

## Requirements Implemented (Expanded)

### REQ-004.1: Direct path returns ModelOutput on both paths; no synthetic response
**Full Text**: `DirectMessageProcessor.generateDirectMessage` returns neutral `ModelOutput` on BOTH the blocking-BeforeModel path and the normal path; `_buildBlockingSyntheticResponse` DELETED; a blocking BeforeModel hook yields a neutral `ModelOutput`/hook result carrying the same text/reason, NOT a `GenerateContentResponse` cast/inline `{candidates}` envelope.
**Behavior**:
- GIVEN: a blocking BeforeModel hook
- WHEN: direct message runs
- THEN: it returns a neutral `ModelOutput` carrying the block reason/text (no `{candidates}` cast). GIVEN a normal completion; THEN the returned `ModelOutput` has the model blocks, usage (incl. reasoningTokens, OQ-14), and filtered AFC.
**Why This Matters**: eliminates the second self-inflicted round-trip; the direct path is neutral end-to-end.

### REQ-004.2: block-based response-text extraction
**Full Text**: `_ensureResponseText`/`_extractResponseText` operate on `ContentBlock[]`/`ModelOutput` text (block-based extraction), not `candidate.content.parts`.
**Behavior**:
- GIVEN: a direct model response
- WHEN: visible text is ensured/extracted
- THEN: it reads `getResponseTextFromBlocks(blocks)` — never `candidate.content.parts`.
**Why This Matters**: removes the `candidate.content.parts` access surface on the direct path.

### REQ-004.3: sendMessage returns ModelOutput
**Full Text**: `TurnProcessor.sendMessage` returns `Promise<ModelOutput>`.
**Behavior**:
- GIVEN: a non-streaming send
- WHEN: `sendMessage` resolves
- THEN: it resolves to `ModelOutput` (not `GenerateContentResponse`); `_commitSendResult` records from the neutral output.
**Why This Matters**: completes the direct-path neutralization; no Google shape leaves `TurnProcessor`.

### REQ-001.4 (direct AFC): neutral AFC on the direct path
**Full Text**: `ModelOutput.afcHistory?: IContent[]` neutral AFC slot so `automaticFunctionCallingHistory` survives on the direct path with identical slicing/hook-restriction-filter semantics (BR-8).
**Behavior**:
- GIVEN: provider AFC on the direct path
- WHEN: recorded
- THEN: it rides `ModelOutput.afcHistory` (DELETE the provider-metadata AFC read at `:755-764`).
**Why This Matters**: AFC parity between streaming and direct paths, both neutral.

### REQ-002.4 (staged — FABRICATOR chain here; VALIDATOR in P15): synthetic fabricators DELETED
**Full Text**: `MessageConverter.convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `isValidResponse` are DELETED; `streamChunkWrapper.ts` is DELETED. This deletion is STAGED across phases (Major 3 + C2): the synthetic FABRICATOR chain `convertIContentToResponse`+`applyResponseMetadata`+`applyFinishReasonMapping` (incl. the `setProviderStopReason` WRITER) is deleted HERE (P13); the `streamChunkWrapper.ts` FILE + `providerStopReason.ts` FILE are deleted in P25 (co-located, since `streamChunkWrapper.ts:112` is providerStopReason's last READER and `streamChunkWrapper`'s last production consumer `executor-stream-processor.ts` migrates in P25 — C2); the Google-shaped VALIDATOR `isValidResponse` (typed on `GenerateContentResponse`, `MessageConverter.ts:228`) is NOT a fabricator — it survives HERE with its last caller `streamResponseHelpers.ts:109` and is DELETED in P15 with a hard P15 gate. (Spec REQ-002.4 lists all four functions + `streamChunkWrapper.ts` in the delete SET; the spec notes `isValidResponse` deletion COMPLETES in P15 and the `streamChunkWrapper.ts`/`providerStopReason.ts` FILE deletes COMPLETE in P25 — see specification.md REQ-002.4 staging note.)
**Behavior**:
- GIVEN: the neutralized direct path + facade
- WHEN: this phase completes
- THEN: the synthetic response FABRICATOR chain (`convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`, incl. the `providerStopReason` WRITER) is GONE from the tree; NO synthetic `{candidates}` response is FABRICATED anywhere; exactly ONE Google-shaped VALIDATOR (`isValidResponse`) remains (deleted in P15); the `providerStopReason.ts` + `streamChunkWrapper.ts` FILES remain (each with a single residual reference) until their co-located P25 delete.
**Why This Matters**: real dead-code removal (REQ-INT-004); the #2424 round-trip cannot survive. The staging is explicit so P13 does not overstate "no GenerateContentResponse-typed function anywhere" while the validator legitimately outlives one phase (Major 3).

## C3 scope decision (READ — EVIDENCE-BACKED): the CORE hook-wire DTO is OUT OF SCOPE; only the AGENTS consumption is neutralized
The review (C3) asked to retype the core `getSyntheticResponse()`/`getModifiedResponse()` return type. VERIFIED FACT: those return the CORE-owned `HookGenerateContentResponse` interface defined in `packages/core/src/hooks/hookTranslator.ts:81` (returned from `packages/core/src/hooks/types.ts:327`/`:480`) — this is the hook JSON-WIRE DTO, NOT `@google/genai`'s `GenerateContentResponse`. Per the governing principle, the hook JSON wire is a DELIBERATELY-PRESERVED external contract (overview §2B.1/§2B.2, domain-model OQ-1c) whose byte-shape must not change (RISK-2, P10 `hookWire.golden.test.ts`). Therefore this issue does **NOT** retype the core `HookGenerateContentResponse` DTO — that would be out of scope (it is the external wire, not an agents-consumed contract). What IS in scope and IS fixed across P07 (streaming) + P13 (direct): the AGENTS-side consumption of those results as `@google/genai`-shaped `GenerateContentResponse` — every `getModifiedResponse() as GenerateContentResponse` / `getSyntheticResponse() as GenerateContentResponse` cast and every internal synthetic `{candidates}` handling in agents is deleted and replaced by conversion to neutral `ModelOutput`/`ModelStreamChunk` at the SINGLE named `hookWireAdapter` boundary. The P13 verification (below) confirms the agents-side consumption is neutral AND documents the core hook-wire DTO as the allow-listed preserved boundary; it does NOT require any core-DTO retype.

## Implementation Tasks (MODIFY; P12 tests stay green)

### Files to Create
- `packages/agents/src/core/__tests__/turnProcessor.sendMessage.apiShape.test.ts` — type-level API-shape test (MAJOR 7): asserts `Awaited<ReturnType<TurnProcessor['sendMessage']>>` is assignable to `ModelOutput` and NOT to `GenerateContentResponse`. `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-004.3`.

### `packages/agents/src/core/hookWireAdapter.ts` (EXTEND — before-model + direct after-model exports)
- ADD the before-model request/blocking exports and the direct-path after-model export to the SINGLE named hook-wire adapter created in P07 (Additional Risk 1 — all four hook interactions routed through this one module by the end of P13):
  - `beforeModelRequestToWire(request)` / `wireToNeutralRequest(modified)` — before-model request modification wire boundary (pairs with the G3 `toGeminiContents` hook-adapter in `streamRequestHelpers.ts`; see Additional Risk 1 note).
  - `beforeModelBlockingToModelOutput(getSyntheticResponse(), base)` — before-model BLOCKING response → neutral `ModelOutput` (replaces the `getSyntheticResponse() as GenerateContentResponse` consumption).
  - `afterModelModifiedToModelOutput(getModifiedResponse(), base)` — direct-path AFTER-model modification → neutral `ModelOutput` (the direct counterpart of P07's `afterModelModifiedToChunk`).
  - **`afterModelBlockingToModelOutput(reason: string | undefined, base: ModelStreamChunk | ModelOutput, systemMessage?: string): ModelOutput`** — STREAMING AfterModel BLOCKING decision → neutral `ModelOutput` (C3, deferred from P07). Consumed by the streaming BLOCK branch's `AgentExecutionBlockedError(reason, blockedOutput, systemMessage)` construction. NO synthetic `{candidates}`.
- The adapter reads/writes the core `HookGenerateContentResponse` wire DTO ONLY; ZERO `@google/genai`. Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-004.1/REQ-002.6`.

### `dev-docs/agents-neutral-gate-allowlist.md` — EXTEND the `hookWireAdapter` AST-context entry HERE (Major 3 — same slice that adds the new wire exports)
- P07 added the narrow `afterModelModifiedToChunk` AST-context allow-list entry. THIS slice adds the additional named wire-mapping exports to `hookWireAdapter.ts` (`afterModelBlockingToModelOutput`, `beforeModelRequestToWire`, `wireToNeutralRequest`, `beforeModelBlockingToModelOutput`, `afterModelModifiedToModelOutput`), each of which reads the hook JSON-wire `candidates`/`content`/`parts`. EXTEND the SAME AST-context entry to name these exports as permitted wire readers — in the SAME slice that introduces them, so the P13 ratchet stays honest (a slice that adds an allow-listed adapter export adds its allow-list context in the SAME slice).
- The entry stays **AST-context-keyed, NOT file-level:** it enumerates the named external-wire mapping functions; a generic `candidates`/`content`/`parts` read in `hookWireAdapter.ts` OUTSIDE those named functions still FAILS the gate (proven by the P30 fixture). A bare `hookWireAdapter.ts` file-path entry is REJECTED by the matcher.
- P31 only FINALIZES/tests the matcher (does not add exports). Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-012.2`.

### `packages/agents/src/core/DirectMessageProcessor.ts`
- `generateDirectMessage` → `Promise<ModelOutput>` (lines 10-19); neutral ingestion + telemetry (delete `toGeminiContents` G7).
- `buildBlockingModelOutput` (lines 20-22) REPLACES `_buildBlockingSyntheticResponse` (DELETE `:677-701`) — OQ-1c; the before-model blocking wire mapping (if any hook JSON wire is involved) routes through `hookWireAdapter.beforeModelBlockingToModelOutput`, NOT an inline `{candidates}` cast.
- `getNeutralAfcHistory` from `final.afcHistory` (lines 23-24) — DELETE provider-metadata AFC read (`:755-764`).
- `processDirectResponse`/`_applyAfterModelResult` block-based filtering (lines 25-30) — DELETE after-model `convertIContentToResponse` (`:744-753`, `:364`) + the `getModifiedResponse() as GenerateContentResponse` cast (`:826-828`) + `candidate.content.parts`/`.parts` filters; the direct after-model modify branch routes through `hookWireAdapter.afterModelModifiedToModelOutput` and filters `ContentBlock[]` via `filterHookRestrictedBlocks` (C1 symmetry with P07). `@requirement:REQ-002.6`.
- `ensureResponseText`/`extractResponseText` block-based (lines 31-36) — DELETE `candidate.content.parts` reads.
- `ApiError` → `isProviderApiError` (line 38); drop all `@google/genai` imports.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-004.1/.2/.3`.

### DELETE `packages/agents/src/core/beforeModelBlockingCompat.ts` (C4 — temporary compat retired with the before-model synthetic path)
- Created in P11 to hold the before-model blocking `GenerateContentResponse` restriction-stamping helper OUT of the side-channel module; delete it HERE now that the before-model blocking path yields neutral `ModelOutput`. Remove its allow-list entry. Verify: `test ! -f packages/agents/src/core/beforeModelBlockingCompat.ts`.

### `packages/agents/src/core/TurnProcessor.ts`
- `sendMessage`: flip return type to `Promise<ModelOutput>` (C4); update `_commitSendResult` + `:526` to consume/produce neutral `ModelOutput` (drop the `convertIContentToResponse` wrap). Markers `@requirement:REQ-004.3`.

### `packages/agents/src/core/chatSession.ts` + `packages/agents/src/core/client.ts`
- Delete the `chatSession.convertIContentToResponse(input): GenerateContentResponse` facade method (`chatSession.ts:560-561`) and its re-export import (`:41`).
- Update `client.ts:781` (`this.getChat().convertIContentToResponse(output.content)`) to return neutral `ModelOutput`/`IContent` per the migrated direct-message surface (finalized with the contract flip in P21). If a caller still needs a value here before P21, return the neutral `ModelOutput` directly (no synthetic response).

### `packages/agents/src/core/MessageConverter.ts` — FINAL synthetic deletion
- DELETE `convertIContentToResponse` (`:518-543`), `applyResponseMetadata` (`:634`), `applyFinishReasonMapping` (`:550`, incl. `setProviderStopReason` write). Drop the residual `FinishReason` (value) + `createUserContent` imports if still present.
- KEEP `isValidResponse` (`:228`) until P15 (last caller `streamResponseHelpers.ts:109`).

### Before-model blocking-hook synthetic path — FINAL neutralization (deferred from P07, C3)
- `packages/agents/src/core/beforeModelHookDecision.ts`: retype `enforceBeforeModelHookDecision` so the blocking decision no longer produces/patches a `GenerateContentResponse`. Remove the `PatchFinishReasonFn` callback parameter and the `GenerateContentResponse`/`FinishReason` imports; the blocking path yields a neutral blocking result (aligned with `buildBlockingModelOutput`, OQ-1c) carried by `AgentExecutionBlockedError`. Preserve the observable stop/block behavior (P10 side-channel + P12 direct-message characterization stay green).
- `packages/agents/src/core/StreamProcessor.ts`: DELETE `_patchMissingFinishReason` (`:378-383`) and drop the now-unused `GenerateContentResponse`/`FinishReason` imports; update the `enforceBeforeModelHookDecision(...)` call (`:365-369`) to the neutral signature (no patch callback).
- `packages/agents/src/core/streamRequestHelpers.ts`: DELETE `patchMissingFinishReason` (`:162-169`) and drop its runtime `FinishReason` import.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-004.1`.

### `packages/agents/src/core/chatSession.ts` — retype `AgentExecutionBlockedError` transport to neutral (C3, deferred from P07)
- Replace `AgentExecutionBlockedError`'s 2nd constructor parameter + field `syntheticResponse?: GenerateContentResponse` (`:99`, `:102`, `:115`) with a NEUTRAL `blockedOutput?: ModelOutput`, preserving the observable `reason`/`systemMessage`/`contextCleared` semantics and the empty-systemMessage falsy-coalescing message rule (`:110-111`). This is the SHARED transport for all three BLOCK writers (streaming AfterModel, before-model, direct) now that all three are neutral in this phase.
- Drop the `GenerateContentResponse` import from `chatSession.ts` if it becomes unused after the retype (it is imported at the top of the file for this field). The sibling `AgentExecutionStoppedError` carries no response payload — verify unchanged.
- Update the executionControlErrors test expectations ONLY if they assert on the field name (`syntheticResponse`→`blockedOutput`); do not weaken behavioral assertions. Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-002.6`.

### `packages/agents/src/core/TurnProcessor.ts` — update the `AgentExecutionBlockedError` reader (C3)
- In the `_runStreamAttempt` catch (`TurnProcessor.ts:273-283`), replace the `if (error.syntheticResponse) { yield wrapChunk(error.syntheticResponse) }` read with the neutral `error.blockedOutput` (`ModelOutput`): yield the neutral blocked chunk directly (a `StreamEventType.CHUNK` carrying the `ModelOutput`/`ModelStreamChunk`), NOT `wrapChunk(GenerateContentResponse)`. After the C4 `sendMessage→ModelOutput` flip and the P25 `streamChunkWrapper` delete, `wrapChunk` no longer accepts `GenerateContentResponse`; the blocked payload is already neutral. Preserve the observable `AGENT_EXECUTION_BLOCKED` event + surfaced blocked chunk (P06 block golden + P12 characterization stay green). Markers `@requirement:REQ-002.6/REQ-004.3`.

### `packages/agents/src/core/providerStopReason.ts` — REMOVE WRITER ONLY; FILE DELETE DEFERRED TO P25 (C2)
- Deleting `applyFinishReasonMapping` above removes the WRITER `setProviderStopReason` (`MessageConverter.ts:588`). Do NOT delete `providerStopReason.ts` here: its READER `getProviderStopReason` at `streamChunkWrapper.ts:112` still exists inside `streamChunkWrapper.ts` (deleted in P25 with its last production consumer — C2). Deleting the file now would dangle that import and break the build. The whole-file DELETE lands in P25 (co-located with the `streamChunkWrapper.ts` delete). After P13 the file has exactly ONE reference (the reader).

### Required Code Markers
EVERY touched/replaced function MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `directmessageprocessor-neutral.md`), not only the prose bullets above:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 * @pseudocode lines 10-19   // generateDirectMessage -> ModelOutput (per-function range)
 */
```
- `generateDirectMessage` → `@pseudocode lines 10-19`; `@requirement:REQ-004.1`.
- `buildBlockingModelOutput` (replaces `_buildBlockingSyntheticResponse`) → `@pseudocode lines 20-22`; `@requirement:REQ-004.1`.
- `getNeutralAfcHistory` → `@pseudocode lines 23-24`; `@requirement:REQ-001.4`.
- `processDirectResponse` (block-based filtering) → `@pseudocode lines 25-30`; `@requirement:REQ-004.1`.
- `ensureResponseText`/`extractResponseText` → `@pseudocode lines 31-36`; `@requirement:REQ-004.2`.
- `TurnProcessor.sendMessage` flip → `@requirement:REQ-004.3` (annotate the return-type change; no new pseudocode function — the ModelOutput commit follows `directmessageprocessor-neutral.md` lines 10-19).
- The before-model blocking-hook neutralization (`beforeModelHookDecision.enforceBeforeModelHookDecision`, deletion of `_patchMissingFinishReason` + `streamRequestHelpers.patchMissingFinishReason`) → `@requirement:REQ-004.1`; annotate each with the `directmessageprocessor-neutral.md` blocking-path range (lines 20-22, `buildBlockingModelOutput`).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P13`, `@requirement:REQ-004.1/.2/.3`, plus the per-function `@pseudocode lines X-Y` above. NOTE: the prose "lines X-Y" bullets are NOT a substitute — each touched function's marker BLOCK must carry its `@pseudocode lines X-Y`.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/directMessage.characterization.test.ts   # green (P12 safety net)
npm test -- packages/agents/src/core/__tests__/sideChannel.characterization.test.ts   # green (P10 safety net — blocking-hook behavior preserved)
if grep -rnE "_buildBlockingSyntheticResponse|convertIContentToResponse|candidates\?\.\[0\]|\.parts" packages/agents/src/core/DirectMessageProcessor.ts; then echo "FAIL: synthetic/parts access still in DirectMessageProcessor.ts"; exit 1; fi
if grep -rnE "convertIContentToResponse|applyResponseMetadata|applyFinishReasonMapping" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: fabricator chain callers/defs remain"; exit 1; fi
# C3 before-model synthetic path fully gone (deferred from P07):
if grep -rn "patchMissingFinishReason" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: patchMissingFinishReason still present"; exit 1; fi
if grep -nE "GenerateContentResponse|FinishReason" packages/agents/src/core/StreamProcessor.ts; then echo "FAIL: StreamProcessor.ts not fully neutral (GenerateContentResponse/FinishReason remain)"; exit 1; fi
if grep -nE "PatchFinishReasonFn|GenerateContentResponse" packages/agents/src/core/beforeModelHookDecision.ts; then echo "FAIL: beforeModelHookDecision.ts blocking path not neutral"; exit 1; fi
# C2 — providerStopReason WRITER gone HERE; FILE survives (deleted P25 with streamChunkWrapper.ts):
test -f packages/agents/src/core/providerStopReason.ts   # STILL EXISTS (file DELETE is P25, co-located with streamChunkWrapper.ts — reader at streamChunkWrapper.ts:112 lives until then)
if grep -rnE "setProviderStopReason" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: providerStopReason WRITER still present"; exit 1; fi
# providerStopReason must have EXACTLY its one surviving reader (streamChunkWrapper.ts:112) + the file; no writer:
psr=$(grep -rn "providerStopReason" packages/agents/src --include=*.ts | grep -v test | grep -vE "core/providerStopReason\.ts|streamChunkWrapper\.ts:")
if [ -n "$psr" ]; then echo "FAIL: unexpected providerStopReason reference beyond streamChunkWrapper.ts reader:"; echo "$psr"; exit 1; fi
# C4 — before-model blocking compat retired with the synthetic path:
test ! -f packages/agents/src/core/beforeModelBlockingCompat.ts   # DELETED
if grep -nE "beforeModelBlockingCompat" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL: beforeModelBlockingCompat allow-list entry not removed"; exit 1; fi
# ---- MAJOR 6: the freed compat allow-list slot cannot be reused to smuggle a new Google-shaped helper ----
# The compat reintroduction guard is MECHANICALLY tied to THIS deletion (not just asserted to exist):
# (1) beforeModelBlockingCompat must be GONE from the file tree, the allow-list, AND the --by-file output:
if grep -rn "beforeModelBlockingCompat" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL(Major 6): beforeModelBlockingCompat still in the allow-list after P13 deletion"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --count --by-file | grep -q "beforeModelBlockingCompat"; then echo "FAIL(Major 6): beforeModelBlockingCompat appears in --by-file after deletion"; exit 1; fi
# (2) RUN the P30/P31 compat-reintroduction fixture against the REAL gate (freed slot cannot exempt a same-shape helper).
#     The fixture is a GenerateContentResponse-shaped restriction-stamping helper placed in a scratch file; with the
#     compat allow-list entry removed, the gate MUST flag it (exit non-zero) via --files scoping:
test -f scripts/__tests__/fixtures/reintroduced-blocking-compat.ts   # the Major-6 reintroduction fixture (added P30)
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports --files scripts/__tests__/fixtures/reintroduced-blocking-compat.ts; then echo "FAIL(Major 6): gate did NOT flag a reintroduced GenerateContentResponse compat helper after the allow-list slot was freed"; exit 1; fi
echo "PASS(Major 6): compat deletion tied to gate — reintroduction of a same-shape helper FAILS the gate; no beforeModelBlockingCompat in allow-list/--by-file"
npx tsx scripts/agents-neutral-gate.ts --count   # clean tree: no residual GenerateContentResponse compat helper
# C1/C3 — direct AFTER-model hook neutralized (no synthetic cast; wire mapping only in hookWireAdapter):
if grep -nE "getModifiedResponse\(\) *as *GenerateContentResponse|getSyntheticResponse\(\) *as *GenerateContentResponse" packages/agents/src/core/DirectMessageProcessor.ts; then echo "FAIL: synthetic cast still in DirectMessageProcessor.ts"; exit 1; fi
# C3 — the AGENTS-side hook consumption is fully neutral across the whole package (streaming + direct):
if grep -rnE "getModifiedResponse\(\) *as *GenerateContentResponse|getSyntheticResponse\(\) *as *GenerateContentResponse" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: synthetic cast remains anywhere in agents production"; exit 1; fi
# C3 — the shared AgentExecutionBlockedError transport is now NEUTRAL (deferred from P07):
if grep -nE "syntheticResponse\s*\??:\s*GenerateContentResponse|syntheticResponse" packages/agents/src/core/chatSession.ts; then echo "FAIL: chatSession.ts still carries syntheticResponse (must be blockedOutput?: ModelOutput)"; exit 1; fi
grep -nE "blockedOutput\s*\??:\s*ModelOutput" packages/agents/src/core/chatSession.ts   # present (neutral blocked payload) — diagnostic
if grep -nE "error\.syntheticResponse" packages/agents/src/core/TurnProcessor.ts; then echo "FAIL: TurnProcessor reader still reads error.syntheticResponse"; exit 1; fi
if grep -rnE "\.syntheticResponse" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: .syntheticResponse remains anywhere in agents production"; exit 1; fi
grep -nE "afterModelBlockingToModelOutput" packages/agents/src/core/hookWireAdapter.ts   # present (added HERE, C3 — not in P07) — diagnostic
grep -nE "afterModelBlockingToModelOutput" packages/agents/src/core/StreamProcessor.ts   # streaming BLOCK branch routes through the neutral adapter — diagnostic
# MAJOR 3 — the hookWireAdapter allow-list entry is EXTENDED HERE (same slice) to name the new wire exports, still AST-context-keyed:
grep -nE "afterModelBlockingToModelOutput|beforeModelRequestToWire|wireToNeutralRequest|beforeModelBlockingToModelOutput|afterModelModifiedToModelOutput" dev-docs/agents-neutral-gate-allowlist.md   # the P13 exports are now allow-listed (AST-context)
if grep -nE "^\s*[-|].*hookWireAdapter\.ts\s*$" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL(Major 3): bare file-level hookWireAdapter.ts entry (must be AST-context-keyed)"; exit 1; fi
echo "PASS(Major 3): hookWireAdapter allow-list entry extended in P13 with the new named exports (AST-context-keyed)"
# The ONLY agents module that reads the core HookGenerateContentResponse wire DTO is the single named adapter:
hgcr=$(grep -rln "HookGenerateContentResponse" packages/agents/src --include=*.ts | grep -v test | grep -v "core/hookWireAdapter\.ts")
if [ -n "$hgcr" ]; then echo "FAIL: HookGenerateContentResponse read outside hookWireAdapter.ts:"; echo "$hgcr"; exit 1; fi
# C3 scope evidence: the core hook-wire DTO is the PRESERVED external boundary (NOT retyped by this issue):
grep -n "HookGenerateContentResponse" packages/core/src/hooks/hookTranslator.ts   # core-owned DTO defn (:81) — intentionally UNCHANGED; documented as allow-listed preserved boundary in dev-docs/agents-neutral-gate-allowlist.md
# MAJOR 7 — sendMessage signature is proven by TYPECHECK + a type-level API test, NOT a line-local grep.
# The grep below is HUMAN-DIAGNOSTIC ONLY (never the pass/fail gate):
grep -n "sendMessage" packages/agents/src/core/TurnProcessor.ts   # diagnostic: inspect the return type by eye
# AUTHORITATIVE signature gate (MAJOR 7): a type-level API test asserts sendMessage resolves to ModelOutput.
npm test -- packages/agents/src/core/__tests__/turnProcessor.sendMessage.apiShape.test.ts   # type-level: awaited sendMessage(...) is assignable to ModelOutput and NOT to GenerateContentResponse
npm run typecheck   # cross-package: any residual GenerateContentResponse consumer of sendMessage fails typecheck (authoritative)
if grep -rn "@google/genai" packages/agents/src/core/DirectMessageProcessor.ts; then echo "FAIL: @google/genai still imported in DirectMessageProcessor.ts"; exit 1; fi
# ---- MAJOR 4: P13-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly these structural-hit IDs; assert ABSENT now:
#   MessageConverter.convertIContentToResponse {candidates} fabricator (:518-543) + usageMetadata builder (:651-662);
#   DirectMessageProcessor._buildBlockingSyntheticResponse {candidates} (:677-701);
#   streamRequestHelpers.patchMissingFinishReason {candidates}+FinishReason.STOP (:162-169);
#   DirectMessageProcessor _ensureResponseText/_extractResponseText candidate.content.parts (:855-899, F5);
#   DirectMessageProcessor AFC content-length filters (:386/:764, G-filter);
#   the P09-quarantined fabricator hits now CLOSED here (chain deleted).
# MAJOR 2 — HARD-ASSERT the owned-hit closure + net-count ratchet (not comment-only):
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p13_byfile.txt
while read -r id; do
  if grep -qF "$id" /tmp/p13_byfile.txt; then echo "FAIL(Major 4): P13-owned structural hit still present: $id"; exit 1; fi
done < <(grep -F 'owner=P13' dev-docs/agents-neutral-gate-baseline.md | sed -E 's/ *owner=P13.*//; s/^[-* ]*//')
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than prior (P11) $prev"; exit 1; }
echo "PASS: P13 net --count $cur < prior $prev; owned hits (incl. P09-quarantined fabricator set) closed"
npm run typecheck && npm run build   # green cross-package (build-green checkpoint P13)
```

## Success Criteria
- Direct path returns `ModelOutput` on both paths; `sendMessage` returns `ModelOutput` (proven by the type-level API-shape test + `npm run typecheck`, MAJOR 7 — NOT a line grep); the synthetic FABRICATOR chain (`convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`, incl. the `setProviderStopReason` WRITER) + the before-model blocking-hook synthetic path (`_patchMissingFinishReason` + `streamRequestHelpers.patchMissingFinishReason` + the `enforceBeforeModelHookDecision` `GenerateContentResponse` flow) + `beforeModelBlockingCompat.ts` are ALL GONE; the direct AFTER-model hook AND the streaming AfterModel BLOCK branch (deferred from P07, C3) are neutralized (no `getModifiedResponse() as GenerateContentResponse` cast anywhere in agents; wire mapping only in `hookWireAdapter`); **C3 — `AgentExecutionBlockedError` carries a neutral `blockedOutput?: ModelOutput` (retyped from `syntheticResponse?: GenerateContentResponse` in `chatSession.ts`), ALL three BLOCK writers (streaming AfterModel, before-model, direct) pass the neutral payload, and the `TurnProcessor.ts:273-283` reader consumes `error.blockedOutput` (no `wrapChunk(GenerateContentResponse)`); `grep -rn "\.syntheticResponse" packages/agents/src | grep -v test` ⇒ NONE`; exactly ONE Google-shaped VALIDATOR (`isValidResponse`) remains and dies in P15 (Major 3 — explicitly staged, not overstated); the `providerStopReason.ts` FILE survives with only its READER (`streamChunkWrapper.ts:112`), deleted in P25 with the `streamChunkWrapper.ts` file (C2 — deleting it here would dangle that import); StreamProcessor is now fully neutral (zero `GenerateContentResponse`/`FinishReason`); no synthetic response is FABRICATED anywhere; the direct + streaming after-model event paths use the shared neutral `iContentFromBlocks` helper (C4); the core `HookGenerateContentResponse` wire DTO is UNCHANGED (C3 scope); P10 + P12 + P06 (block golden) characterization green; build green.
- **Site-specific closure (Major 4):** every P13-OWNED baseline structural-hit ID (the `convertIContentToResponse` `{candidates}` fabricator + usageMetadata builder, `_buildBlockingSyntheticResponse`, `patchMissingFinishReason`, `_ensureResponseText`/`_extractResponseText` `candidate.content.parts`, the direct-path AFC filters, AND the P09-quarantined fabricator set) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing below P11; those IDs are removed from the baseline listing.

## Failure Recovery
If this phase fails (characterization red, build breaks, or a deleted symbol still referenced):
1. `git checkout -- packages/agents/src/core/DirectMessageProcessor.ts packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/MessageConverter.ts packages/agents/src/core/chatSession.ts packages/agents/src/core/client.ts packages/agents/src/core/StreamProcessor.ts packages/agents/src/core/beforeModelHookDecision.ts packages/agents/src/core/streamRequestHelpers.ts packages/agents/src/core/hookWireAdapter.ts` (the `chatSession.ts` restore reverts the `AgentExecutionBlockedError` `blockedOutput` retype — C3) and restore `beforeModelBlockingCompat.ts` from HEAD (do NOT delete `beforeModelBlockingCompat.ts` until the before-model blocking path actually yields neutral `ModelOutput`). NOTE (C2): P13 does NOT delete `providerStopReason.ts` (it only removes the WRITER with `applyFinishReasonMapping`); the file survives to P25, so there is nothing to restore for it. NOTE (C3): retyping `AgentExecutionBlockedError` requires ALL three BLOCK writers (streaming AfterModel `StreamProcessor.ts:711-726`, before-model `beforeModelHookDecision.ts:68`, direct `DirectMessageProcessor`) AND the `TurnProcessor.ts:273-283` reader to flip in the SAME commit — a partial retype breaks the build.
2. Re-run `grep -rn "convertIContentToResponse\|patchMissingFinishReason\|getSyntheticResponse" packages/agents/src | grep -v test` to enumerate every remaining `GenerateContentResponse`-typed caller (provider-output fabricator AND before-model blocking-hook path) and neutralize it before deleting the definitions.
3. If the before-model blocking path breaks P10/P12 characterization: the neutral `AgentExecutionBlockedError` result must carry the SAME effective block reason/text as before (`buildBlockingModelOutput`, OQ-1c) — restore observable behavior, do NOT edit the P10/P12 tests.
4. Cannot proceed to Phase 14 until build is green and P10 + P12 are green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P13.md`.
