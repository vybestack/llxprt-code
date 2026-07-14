# Feature Specification: Neutralize `packages/agents` — off `@google/genai` and off all Google-shaped structural content (Issue #2349)

Plan ID: PLAN-20260707-AGENTNEUTRAL
Issue: https://github.com/vybestack/llxprt-code/issues/2349 (authoritative)
Umbrella: #2343. Foundation dependency: #2347 (neutral llm-types — LANDED, verified present in tree). Sibling: #2348 (core), #2350 (cli).
Authoritative technical map: `project-plans/issue2349/overview.md` (1146 lines) — this specification OPERATIONALIZES that inventory; it does not re-derive it. Every file:line disposition is consumed from the overview.

## Purpose

`packages/agents` currently manufactures a Google-shaped `GenerateContentResponse` round-trip **purely internally** and then converts it back to neutral at the yield boundary. The provider call is already neutral in both directions (`provider.generateChatCompletion()` takes `IContent[]` and returns `AsyncIterableIterator<IContent>` — verified `packages/core/src/runtime/contracts/RuntimeProvider.ts:77-84`). The Google shape is a self-inflicted internal detour that forces two side-channels (`providerStopReason.ts`, `hookToolRestrictions.ts`) to exist and that leaves 46 production files importing `@google/genai`.

This migration makes the agents pipeline **neutral end-to-end**: `IContent → ModelStreamChunk`/`ModelOutput` with no synthetic response fabricated, no side-channels, no structural `{candidates}`/`{role,parts}` currency, and the cross-package `clientContract.ts` payload types retyped to neutral. The prior PR #2424 was REJECTED because it did a name-only source-swap (re-aliased Google names from `clientContract.ts`, re-declared enums, left the synthetic round-trip intact). This plan targets the STRUCTURAL fix per the overview's Governing Principle (§1.1) and Corollary (§1.2): **only the Gemini provider and the conversion code directly behind it may use Google/Gemini SDK types; every other layer must be neutral, domain-named types. If a shared contract is defined in Google-shaped types, the contract is wrong and must be fixed.**

## Architectural Decisions (from overview — normative)

- **Neutral is STRUCTURAL, not name-based (overview §1.3/§1.4).** "Google-shaped" = the `candidates[].content.{role,parts}` envelope, `Part[]`, top-level `functionCalls`, Gemini-keyed `usageMetadata`, `role:'user'|'model'` wrappers, `PartListUnion` — regardless of whether imported from `@google/genai`, aliased from `clientContract.ts` `Contract*`, built as an anonymous literal, or produced by `ContentConverters.toGeminiContent(s)`. Neutral = the domain-named core types in `packages/core/src/llm-types/` and `services/history/IContent.ts` (`IContent`, `ContentBlock`, `ModelOutput`, `ModelStreamChunk`, `ToolCallRequest`, `ToolDeclaration`, `JsonSchema`, `CanonicalFinishReason`, `UsageStats`, `ProviderApiError`, `HookRestrictions`, `ModelGenerationRequest`/`ModelGenerationSettings`, `ReasoningConfig`), whose speaker vocabulary is `'human'|'ai'|'tool'`.
- **The neutral llm-types layer already exists (#2347, verified in tree).** `ModelOutput`/`ModelStreamChunk`/`HookRestrictions` (`packages/core/src/llm-types/modelEnvelope.ts:51-70`), `toModelStreamChunk` (`modelEnvelope.ts:188`), `ModelGenerationRequest`/`ModelGenerationSettings`/`ReasoningConfig` (`modelRequest.ts`), `ToolDeclaration`/`ToolChoice`/`JsonSchema`/`CanonicalFinishReason`/`ToolCallRequest`. This plan CONSUMES those and fills only the identified gaps (overview §5) — it does NOT reinvent them.
- **This is a MIGRATION, not a greenfield feature.** Every MIGRATION/PRODUCTION phase MODIFIES existing files, DELETES dead code, and RETYPES signatures; P01 and P02 are explicit PROVISIONING gates (mutation tooling + the AST-gate skeleton/artifacts) required BEFORE production migration and legitimately create tooling/gate artifacts rather than modifying production `packages/agents/src`. There is NO `ServiceV2`/parallel version. Two whole files are DELETED (`streamChunkWrapper.ts`, `providerStopReason.ts`) — both in **P25**, the last phase that removes their final production consumers/readers (C2 build-order); a function-level delete inventory removes synthetic-response-only functions inside surviving files (`convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `_buildBlockingSyntheticResponse`, `patchMissingFinishReason`) across P07-P15.
- **The gap-filling neutral types get the classic stub→TDD→impl cycle (overview §5).** The gaps: a neutral **agent message input DTO** (`AgentMessageInput`) replacing `PartListUnion`; a neutral **turn-level request DTO** replacing `SendMessageParameters`; a lossless legacy→neutral converter (OQ-1b); a first-class **AFC neutral slot** (`ModelOutput.afcHistory?: IContent[]`) OR extended `toModelStreamChunk` provider-metadata preservation (OQ-2/OQ-15); response-level provider-metadata preservation on the neutral chunk (OQ-16).
- **TDD-as-migration = behavioral vertical slices.** For each migration slice, FIRST confirm/write BEHAVIORAL integration tests that pin OBSERVABLE agent-loop behavior (event ordering, history-commit-once, tool dispatch, #2150 mid-stream retry, #2329 refusal `stopReason`, hook JSON wire compatibility, usage/token accounting) — NOT Google-shape internals — THEN migrate internals underneath so those tests still pass. Tests that only asserted `GenerateContentResponse` shape are DELETED or rewritten around neutral behavior; a small named converter/boundary characterization allow-list may remain (overview §3.3-A / §8.1).
- **Side-channels are RETIRED by deletion, not adaptation.** `providerStopReason.ts` DELETED (raw stop reason rides `ModelStreamChunk.rawStopReason` from `IContent.metadata.stopReason`); `hookToolRestrictions.ts`'s `WeakMap`/`Symbol` identity keying REPLACED by explicit `HookRestrictions` on `ModelStreamChunk` plus `ContentBlock[]`/`ToolCallBlock` filtering.
- **Enforcement is AST-context-aware with a central versioned allow-list (overview §8, OQ-17 DECIDED).** A parser-based core gate over `packages/agents/src` production detects raw imports, `Contract*`-alias imports, re-declared `Type`/`FinishReason` enums, structural `{candidates}`/`{role,parts}` literals + `.parts` mutators, `ContentConverters.toGeminiContent(s)` call expressions + barrel `GeminiContent*` imports, and Gemini-named usage keys — with exemptions granted ONLY by a central versioned allow-list artifact (never inline `// gate-exempt` comments). A separate narrower test gate bans `GenerateContentResponse`/`{candidates}` fixtures in agents tests except a named characterization allow-list.
- **No lint/complexity loosening; no suppression directives.** No `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`, no severity downgrades, no complexity/size threshold increases anywhere (CI-enforced by `lint:eslint-guard`). Fix underlying issues; never silence them.

## Project Structure

This is a migration across an existing tree. No new package structure. New neutral-type files land inside the existing `packages/core/src/llm-types/` layer (gap fill); the enforcement gate lands under `scripts/`. The full file surface is the overview §3.2 table (46 production importers), §2A.4 structural surface, §4/§A.2/§A.3 cross-package `Contract*` consumers (23 CLI + 5 core), and the two DELETE files.

```
packages/core/src/llm-types/
  agentMessageInput.ts       # NEW (gap): AgentMessageInput DTO + lossless legacy converter (replaces PartListUnion) — OQ-1/OQ-1b
  modelEnvelope.ts           # MODIFIED (gap): ModelOutput.afcHistory?: IContent[]; toModelStreamChunk provider-metadata/responseId preservation — OQ-2/OQ-15/OQ-16
  (co-located *.test.ts)
packages/core/src/core/clientContract.ts   # MODIFIED: DELETE Contract* payload types; retype AgentClientContract/AgentChatContract to neutral
packages/agents/src/**                      # MODIFIED/DELETED per overview §3.2 (46 files) + §2A.4 structural sites
packages/agents/src/core/streamChunkWrapper.ts   # DELETED (overview §3.2 #1)
packages/agents/src/core/providerStopReason.ts   # DELETED (overview §3.2 #2)
packages/cli/src/**                         # MODIFIED: 23 Contract* consumers retyped to neutral (overview §A.2)
packages/core/src/{commands/types.ts,config/agentClientLifecycle.ts,utils/checkpointUtils.ts,utils/llm-edit-fixer.ts,utils/summarizer.ts}  # MODIFIED: 5 Contract* consumers (overview §A.3)
scripts/agents-neutral-gate.ts              # NEW: AST-context-aware core gate (overview §8)
scripts/agents-neutral-test-gate.ts         # NEW: narrower test-fixture gate (overview §8.1)
dev-docs/agents-neutral-gate-allowlist.md   # NEW: central versioned exemption allow-list artifact (overview §8 exemption note)
packages/agents/package.json                # MODIFIED (LAST): remove "@google/genai"
```

## Technical Environment

- **Type**: Library (agents pipeline) inside a TypeScript monorepo (npm workspaces; Bun-compatible).
- **Runtime**: Node.js 20+.
- **Testing**: Vitest; `fast-check` / `@fast-check/vitest` available (verified in `packages/agents/package.json`).
- **Dependencies**: no new runtime deps. `@google/genai` 1.30.0 is present in `packages/agents/package.json` today and is REMOVED at the end of this plan.

## Integration Points (MANDATORY SECTION)

This migration is INHERENTLY integration-first: it modifies existing consumers and removes existing code. Isolated feature creation is impossible by construction.

### Existing Code That Will USE Each Neutral Type (consumers)

- **`ModelStreamChunk` (neutral chunk, already core-owned):** consumed by `StreamProcessor` (accumulation/history commit), `TurnProcessor._runStreamAttempt`/`wrapChunk` (yield boundary), `turn.ts` `processStreamChunk` (event emission), `StreamEvent.CHUNK` in `packages/core/src/core/chatSessionTypes.ts:21-25`. TARGET: these consume `ModelStreamChunk` DIRECTLY (no synthetic response, no `chunkToParts` re-derivation to `Part[]`).
- **`ModelOutput` (neutral final, already core-owned):** consumed by `TurnProcessor.sendMessage` (retyped `Promise<ModelOutput>`), `DirectMessageProcessor.generateDirectMessage` (retyped `ModelOutput` on both blocking and normal paths), `AgentClientContract.generateDirectMessage`.
- **`HookRestrictions` on `ModelStreamChunk`/`ModelOutput` (already core-owned):** consumed where `hookToolRestrictions` WeakMaps are today — `StreamProcessor._convertIContentStream`/`processStreamResponse`, `TurnProcessor._commitSendResult`/`_recordOutputContent`, `turn.ts` `processStreamChunk`/`handlePendingFunctionCall`.
- **`rawStopReason` on `ModelStreamChunk` (already core-owned):** consumed where `providerStopReason.ts` is read today — `turn.ts` finish-reason emission (`#2329` refusal path). Sourced from `IContent.metadata.stopReason`.
- **`AgentMessageInput` (NEW gap type):** consumed by `turn.run`, `client.sendMessageStream`, `AgenticLoop`, `api/agentBootstrap.ts`, `agents/executor.ts`, `subagent*` — everywhere `PartListUnion` is the initial-request/user-message input today (overview §3.2 #8, #38-39, #44-46; §5.3-1).
- **Neutral turn request DTO (NEW gap; reuse/extend `ModelGenerationRequest`):** consumed everywhere `SendMessageParameters` is today (overview §3.2 #6, #7, #9, #14, #18, #21, #24).
- **`ToolDeclaration`/`JsonSchema` (already core-owned):** consumed by `clientToolGovernance.ts`, `subagentRuntimeSetup.ts`, `executor-tool-dispatch.ts`, `subagentNonInteractive.ts`, `agents/executor.ts`, `agents/types.ts` (replacing `FunctionDeclaration`/`Schema`/`Type`).
- **`ModelOutput.afcHistory?: IContent[]` (NEW gap slot):** consumed by `TurnProcessor._recordAfcHistory` (streaming) and `DirectMessageProcessor.getIContentAutomaticFunctionCallingHistory` (direct), replacing `automaticFunctionCallingHistory: Content[]` in provider metadata (overview §5.3-3, OQ-2/OQ-15).
- **Neutral `AgentClientContract`/`AgentChatContract` (retyped surface):** consumed by the concrete `AgentClient` (`client.ts`), 23 CLI files (overview §A.2), 5 core files (overview §A.3).

### Existing Code To Be REPLACED / REMOVED (the deletions — draw directly from overview §3.2)

- **DELETE whole files:** `packages/agents/src/core/streamChunkWrapper.ts` (§3.2 #1 — synthetic-response↔chunk↔`Part[]` boundary vanishes; consumers use `toModelStreamChunk(iContent)`); `packages/agents/src/core/providerStopReason.ts` (§3.2 #2 — bolted-on `Candidate.providerStopReason` field replaced by `ModelStreamChunk.rawStopReason`).
- **DELETE functions (synthetic-response-only, inside surviving files):** `MessageConverter.convertIContentToResponse` (`:518-543`), `MessageConverter.applyResponseMetadata` (`:634`), `MessageConverter.applyFinishReasonMapping` (`:550`, incl. the `setProviderStopReason` write at `:588`), `MessageConverter.isValidResponse`, `DirectMessageProcessor._buildBlockingSyntheticResponse` (`:677-701`), `streamRequestHelpers.patchMissingFinishReason` (`:162-169`).
- **RETYPE surviving inbound converters (NOT delete — retain, retype→neutral):** `MessageConverter.createUserContentWithFunctionResponseFix` (`:138-173`) is **inbound** `PartListUnion → Content` input normalization, called from `convertPartListUnionToIContent` (`:190`, `:203`, `:207`) and `normalizeToolInteractionInput` — it is **NOT** part of the synthetic-response round-trip (verified: `grep -n "createUserContentWithFunctionResponseFix" packages/agents/src/core/MessageConverter.ts` ⇒ definition `:138` + callers `:190`/`:203`/`:207`). Per overview §434 (OQ-5) its `{role:'user',parts}` construction is dispositioned **[retype→neutral]** (build `IContent`/`ContentBlock[]` directly), retained not deleted. Retyped in P09 (see `09-messageconverter-impl.md`); every phase uses the word **retype** for this function, never **delete**.
- **NEUTRALIZE-IN-PLACE (mechanism change, not just retype):** `googlePartHelpers.ts` (`Part[]`→`ContentBlock[]` helpers), `hookToolRestrictions.ts` (WeakMap/Symbol → explicit `HookRestrictions` + block filtering), `MessageConverter.ts` (delete synthetic fabricators; retype surviving `IContent`↔block conversion), `ConversationManager.ts` (reimplement adjacent-text `TextBlock` consolidation + thought-filter on `ContentBlock[]`, remove all `.parts` mutation).
- **RETYPE (41 files, overview §3.2):** swap Google/`Contract*` types for neutral; delete `toGeminiContents` telemetry/internal conversions (G4-G7); replace runtime `Type` enum (executor-tool-dispatch.ts:19, subagentRuntimeSetup.ts:25-30) with JSON-schema string literals; replace runtime `FinishReason.STOP` with `CanonicalFinishReason`; replace `ApiError` with `isProviderApiError`/`ProviderApiError`.
- **NEUTRALIZE the cross-package contract:** DELETE `ContractPart`/`ContractContent`/`ContractContentUnion`/`ContractPartListUnion`/`ContractGenerateContentResponse`/`ContractGenerateContentConfig`/`ContractSendMessageParameters`/`ContractUsageMetadata` from `packages/core/src/core/clientContract.ts:52-127`; retype `AgentClientContract`/`AgentChatContract` members (`:128-201`) to neutral.

### User Access Points

Agents is the agent-loop engine behind the CLI. Users reach this code through every CLI interaction (`node scripts/start.js …`, `sendMessageStream`, non-interactive runs, subagents). The migration MUST preserve all observable behavior — the smoke test `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` and the full CLI test suite are the end-to-end access-point verification.

### Migration Requirements

- **Cross-package build stays green at each step (OQ-4).** The `clientContract.ts` surface is implemented by agents and consumed by CLI/core; the neutralization touches all three packages and must be staged so the monorepo compiles at each committed phase.
- **Persisted-history compatibility:** `HistoryService` state is `IContent`-based already; no history data migration is needed, but characterization tests MUST pin that history commits remain neutral and behaviorally identical (commit-once-per-turn, no retry duplication).
- **Hook JSON wire compatibility (RISK-2):** the before/after-model and before-tool-selection hook serialized payloads must not change byte-shape; conversion is confined to a single named boundary adapter recorded in the allow-list (OQ-1a/OQ-1c).

## Formal Requirements

Functional requirements REQ-001..REQ-013 cover the neutral pipeline/types/side-channel retirement/contract neutralization/gate. Integration requirements REQ-INT-001..REQ-INT-006 cover cross-package wiring and old-code removal. Each maps to overview §9.1 acceptance criteria (mapping table at end).

[REQ-001] Neutral gap types (fill overview §5 gaps; stub→TDD→impl)
  [REQ-001.1] `AgentMessageInput` neutral DTO replaces `PartListUnion` as the agent/turn user-message + initial-request input. Structure supports text, media, tool responses, and tool-call IDs with NO Google `Part`/`role` shape. (overview §5.3-1, OQ-1)
  [REQ-001.2] A lossless legacy→`IContent` converter owns conversion of legacy input, preserving thought signatures, media, tool responses, and tool-call IDs. It MUST NOT be one of the §5.4 lossy paths (`generateContentResponseUtilities.legacyPartToBlocks`, `toolCall.partLikeToBlock`) on any thinking-bearing path. (overview §5.3-1, §5.4, OQ-1b, OQ-10) ALSO under REQ-001.2 (C4): the neutral wrapper `iContentFromBlocks(blocks: ContentBlock[], speaker?): IContent` builds ONE `IContent` (`{ speaker: speaker ?? 'ai', blocks }`, no `role`/`parts`/`candidates`) from ALREADY-neutral `ContentBlock[]`, consumed by the AfterModel hook filtering paths (StreamProcessor P07 streaming, DirectMessageProcessor P13 direct) to hand `fireAfterModelEvent` a neutral `IContent` with no Google-shaped intermediary. (neutral-gap-types.md lines 42-48)
  [REQ-001.3] Turn-level neutral request DTO replaces `SendMessageParameters` (reuse/extend `ModelGenerationRequest` or a sibling `AgentGenerationRequest`), carrying message + generation settings neutrally. (overview §5.3-2, OQ-1)
  [REQ-001.4] `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot (OR extended `toModelStreamChunk` provider-metadata preservation) so `automaticFunctionCallingHistory` survives synthetic-response removal on BOTH streaming and direct paths with identical slicing/hook-restriction-filter semantics. (overview §5.3-3, §9.1-3a, OQ-2/OQ-15)
  [REQ-001.5] Neutral chunk conversion preserves response-level provider metadata (`responseId`, and provider `providerMetadata` under `gemini.*` keys) per the OQ-16 disposition — preserved / ignored-by-design / provider-core-only, decided per field and per level (block-level AND response-level), NOT silently dropped by plain `toModelStreamChunk`. (overview §2.4, §5.3-3a, §9.1-3b, OQ-16)
[REQ-002] Stream pipeline neutral end-to-end
  [REQ-002.1] `StreamProcessor` consumes provider `AsyncIterable<IContent>` and produces/accumulates `ModelStreamChunk`/`ContentBlock[]`/`CanonicalFinishReason` — no `convertIContentToResponse`, no `Part[]` accumulator, no `GenerateContentResponse[]` chunk list. (overview §2.2-3, §3.2 #6)
  [REQ-002.2] `TurnProcessor._runStreamAttempt` iterates `ModelStreamChunk` and `wrapChunk` wraps `ModelStreamChunk` DIRECTLY into `StreamEvent.CHUNK` — no `responseToModelStreamChunk`. (overview §2.2-4/5, §3.2 #7)
  [REQ-002.3] `Turn.processStreamChunk` operates on `ContentBlock[]`/`ToolCallBlock` from the neutral chunk — no `chunkToParts`, no `FunctionCall[]` re-derivation. (overview §2.2-6, §3.2 #8)
  [REQ-002.4] `MessageConverter.convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `isValidResponse` are DELETED; `streamChunkWrapper.ts` is DELETED. **Staged deletion (Major 3 + C2):** the streaming USAGE of `streamChunkWrapper` stops in `TurnProcessor.ts`/`turn.ts` at **P08** (and `subagentNonInteractive.ts` at P23), but the `streamChunkWrapper.ts` FILE itself is DELETED in **P25** — the last phase that migrates its final production consumer `executor-stream-processor.ts` (deleting it earlier would break the P23/P25 importers' build, C2). The synthetic FABRICATOR chain (`convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`, incl. the `setProviderStopReason` WRITER) is deleted in **P13**; the Google-shaped VALIDATOR `isValidResponse` (not a fabricator) COMPLETES deletion in **P15** with its last caller `streamResponseHelpers.ts:109`. After P13 the fabricator chain is gone and no synthetic `{candidates}` is fabricated anywhere; exactly one validator survives to P15 (hard P15 gate) and the two dead FILES survive to P25 (hard P25 gate). (overview §3.2 #1/#5, §9.1-3)
  [REQ-002.5] Public event shape (`ServerAgentStreamEvent`, `StreamEvent`/`StreamEventType`) is UNCHANGED — only the internal derivation of the emitted values changes. (overview §7 contract 11, RISK-1)
  [REQ-002.6] The STREAMING and DIRECT AfterModel hook paths are neutralized onto `ContentBlock[]` from the neutral chunk/output: `StreamProcessor._processAfterModelHook` (streaming, P07) and `DirectMessageProcessor._applyAfterModelResult`/`_processDirectResponse` (direct, P13) no longer fabricate a synthetic `GenerateContentResponse` (no `convertIContentToResponse(iContent).candidates?.[0]?.content ?? {role:'model',parts:[]}` fabrication+fallback) and no longer cast `getModifiedResponse()`/`getSyntheticResponse()` `as GenerateContentResponse`. The hook still RECEIVES/RETURNS its byte-compatible JSON-wire shape (the core-owned `HookGenerateContentResponse` DTO, `hookTranslator.ts:81`, is PRESERVED, NOT retyped by this issue) via a SINGLE named agents boundary adapter (`packages/agents/src/core/hookWireAdapter.ts`, created P07, extended P13) that maps wire→neutral `ModelStreamChunk`/`ModelOutput`. All four hook interactions (before-model request, before-model blocking response, after-model modification, before-tool-selection restriction) route through that one adapter (before-tool-selection restriction rides `chunk.hookRestrictions`). (overview §2B.1/§2B.2, domain-model OQ-1c, C1/C3)
[REQ-003] Side-channels retired
  [REQ-003.1] `providerStopReason.ts` DELETED; raw provider stop reason rides `ModelStreamChunk.rawStopReason` sourced from `IContent.metadata.stopReason`; #2329 refusal `stopReason` on the `Finished` event is preserved. **Staged deletion (C2):** the behavior is neutral from P11 (`rawStopReason` carries it); the WRITER `setProviderStopReason` (`MessageConverter.ts:588`) is removed in **P13** with the fabricator chain; the FILE is DELETED in **P25**, co-located with the `streamChunkWrapper.ts` delete, because `providerStopReason.ts`'s last reader is the `getProviderStopReason` READER inside `streamChunkWrapper.ts:112` (deleting the file before P25 would dangle that import). (overview §2.5(a), §3.2 #2, §9.1-4)
  [REQ-003.2] `hookToolRestrictions.ts` stops using `WeakMap`/`Symbol` identity keying on `GenerateContentResponse`/`FunctionCall`; restriction metadata rides explicit `HookRestrictions` on `ModelStreamChunk`, and filtering operates on `ContentBlock[]`/`ToolCallBlock` (`turn.filterBlocksByAllowedTools`). (overview §2.5(b), §3.2 #4, §6.2, §9.1-4)
[REQ-004] Non-streaming / direct-message path neutralized
  [REQ-004.1] `DirectMessageProcessor.generateDirectMessage` returns neutral `ModelOutput` on BOTH the blocking-BeforeModel path and the normal path; `_buildBlockingSyntheticResponse` DELETED; a blocking BeforeModel hook yields a neutral `ModelOutput`/hook result carrying the same text/reason, NOT a `GenerateContentResponse` cast/inline `{candidates}` envelope. (overview §2B.2, §9.1-3, OQ-1c)
  [REQ-004.2] `_ensureResponseText`/`_extractResponseText` operate on `ContentBlock[]`/`ModelOutput` text (block-based extraction), not `candidate.content.parts`. (overview §2A.4-II(f), §2B.2)
  [REQ-004.3] `TurnProcessor.sendMessage` returns `Promise<ModelOutput>`. (overview §2B.2-5, §3.2 #7)
[REQ-005] Structural-access sites migrated (overview §2A.4-II)
  [REQ-005.1] `ConversationManager` text consolidation (`appendTextContentParts`, `_consolidateModelOutput`, `hasTextContent`) reimplemented on `ContentBlock[]`: consolidate adjacent `TextBlock`s at the SAME merge boundaries, thought-filter via `ThinkingBlock`, no `.parts` mutation. (overview §7 contract 12, §2A.4-II(f), §3.2 #13)
  [REQ-005.2] `clientLlmUtilities` stateless helpers (`next_speaker` text extraction/fallback) read `TextBlock.text` on neutral `IContent[]`. (overview §2A.4-II(f), OQ-3s)
  [REQ-005.3] `streamResponseHelpers` accumulation reads `ContentBlock[]`/`CanonicalFinishReason` from the neutral chunk (no `chunk.candidates`/`.parts`). (overview §2A.4-II(f), §3.2 #22)
  [REQ-005.4] `MessageStreamOrchestrator` pending-tool-call detection derives from `ToolCallBlock` presence on the neutral last `IContent`. (overview §2A.4-II(f))
  [REQ-005.5] The full §2A.4-I construction surface and §2A.4-II access/mutation surface are eliminated or bounded (the raw-import-free `executor-prompt-builder.ts:47-58` generic `.parts` mutator retyped to `ContentBlock[]` per OQ-12). (overview §2A.4, §9.1-2)
    [REQ-005.5a] The SUBAGENT group (`subagent*.ts`, `subagentRuntimeSetup.ts`, `subagentNonInteractive.ts`) is retyped to neutral (`IContent`/`AgentMessageInput`/`ToolDeclaration`) with identical observable run behavior (run, tool-response feed, nudges, non-interactive run); zero `@google/genai` imports remain in these files; the structural-hit count strictly decreases. GIVEN a subagent run with tool responses; WHEN retyped; THEN emitted events + committed history are behaviorally identical. (overview §2A.4, §3.2 #35/#38-39/#44-46, §9.1-2; slice of REQ-005.5)
    [REQ-005.5b] The EXECUTOR group (`agents/executor*.ts`, `executor-tool-dispatch.ts`, `executor-prompt-builder.ts`) is retyped to neutral with identical behavior; the raw-import-free `executor-prompt-builder.ts:47-58` generic `.parts` mutator operates on `ContentBlock[]` and `PromptConfig.initialMessages` migrates to `IContent[]` (OQ-12); zero `@google/genai` imports remain; the structural-hit count strictly decreases. GIVEN an executor initial message + template application + tool feed + recovery nudge; WHEN retyped; THEN behavior is identical. (overview §2A.4-II, §3.2 #30, OQ-12, §9.1-2; slice of REQ-005.5)
    [REQ-005.5c] The REMAINING group (`compression/*`, `core/agenticLoop/*`, `api` session-control, `TodoContinuation`, `chatSession` facade) is retyped to neutral with identical behavior, reaching ZERO production `@google/genai` imports across `packages/agents/src`; the structural-hit count holds at the bounded floor. GIVEN compression enforcement, agenticLoop cancelled-tool history, API session control, TodoContinuation, and the chatSession facade; WHEN retyped; THEN behavior is identical and `grep -rl "@google/genai" packages/agents/src | grep -v test` is EMPTY. (overview §2A.4, §3.2, §9.1-1/2; slice of REQ-005.5, precondition for REQ-013.1)
[REQ-006] Runtime enum/value replacements (not erasable type swaps)
  [REQ-006.1] Runtime `Type` enum imports (`executor-tool-dispatch.ts:19`, `subagentRuntimeSetup.ts:25-30`) replaced with JSON-schema string literals building `JsonSchema`/`ToolDeclaration`; no external consumer depends on Gemini uppercase strings. (overview §3.2 #30/#35, OQ-7)
  [REQ-006.2] Runtime `FinishReason` values (`MessageConverter.ts`, `streamRequestHelpers.ts:20`, `streamResponseHelpers.ts:17`) replaced with `CanonicalFinishReason`; the "missing finish reason → STOP" default moves onto the neutral chunk. (overview §3.2 #5/#21/#22, §2A.4-I(a), OQ-7)
  [REQ-006.3] Runtime `ApiError` (`DirectMessageProcessor.ts:12`, `TurnProcessor.ts`, `schemaDepthErrorEnrichment.ts`) replaced with `isProviderApiError`/`ProviderApiError`. (overview §3.2 #14/#7/#26)
  [REQ-006.4] `createUserContent` (`MessageConverter.ts`) replaced with a neutral builder. (overview §3.2 #5)
[REQ-007] Public-event usage-metadata boundary (overview §7A)
  [REQ-007.1] A characterization check (OQ-2v) establishes what consumers currently see on `done.finished.usageMetadata` at runtime (neutral `promptTokens` vs Gemini `promptTokenCount`), because the declared API type and emitted runtime value disagree. This is RECORDED as EVIDENCE documenting why the option-(C) mapper is needed; it is NOT a decision-gate (OQ-2u is committed unconditionally to option (C) — see REQ-007.2). (overview §7A fact 3, OQ-2v)
  [REQ-007.2] The §7A option is COMMITTED UNCONDITIONALLY to **option (C) bridge-at-boundary** (Critical 1 round 7): the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type STAYS Gemini-named (UNCHANGED) and the currently-absent `UsageStats`→Gemini-named mapper (`usageStatsToPublicUsageMetadata`) is written at `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases. Option (B) (migrate the public type to neutral `UsageStats`) is REJECTED for #2349 because it is a public breaking change that would break the CLI/public-event consumers (`agentEventDispatcher.ts:406`, `zedIntegration.ts:614-615`) with no owning migration phase. Gemini usage keys appear ONLY in designated boundary modules (`api/event-types.ts`, `api/event-schema.ts`, and the mapper in `eventAdapter.ts`), never in the internal loop and never in `turnLogging.ts` (OQ-3t committed neutral). (overview §7A, §9.1-2b, OQ-2u)
  [REQ-007.3] The core-owned `ServerUsageMetadataEvent` scope limitation is stated explicitly AND compensated with a CONCRETE core check (Critical 3 round 8): the agents-scoped gate CANNOT enforce `packages/core/src/core/turn.ts:221-228`. Under option (C) this event is a DOCUMENTED core-owned Gemini-named public-wire type that is PRODUCTION-DEAD (zero production emitters/constructors — only the test helper `eventHarness.ts:108` constructs it; `eventAdapter.ts:268`/`a2a-server/task-support.ts:136,166` are consumers). P19 CREATES `packages/core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts` asserting the CONCRETE facts: (a) no PRODUCTION code emits/constructs a `ServerUsageMetadataEvent` (grep/AST — only test helpers may), AND (b) the LIVE usage path `ServerFinishedEvent.value.usageMetadata` is the neutral `UsageStats` type (`turn.ts:241-245`). It does NOT claim the dead event is "fed by neutral production emitters" (there are none). (overview §8(h) scope caveat, §9.1-2b, OQ-8)
  [REQ-007.4] OQ-14 reasoning-token fidelity is SPLIT (Critical 1 round 8): (INTERNAL — mandatory) BOTH neutral paths preserve `UsageStats.reasoningTokens` internally (on `ModelOutput.usage`/`ModelStreamChunk.usage`/`IContent.metadata.usage`) — streaming already maps `thoughtsTokenCount → reasoningTokens` (`streamChunkWrapper.ts:57-59`, pinned by P06/P07), and the direct path populates it when retyped to `ModelOutput` (pinned by P12/P13); (PUBLIC — out of scope for #2349) the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type stays UNCHANGED (option (C)) and declares ONLY `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`/`cachedContentTokenCount` (`api/event-types.ts:32-37`) — NO `reasoningTokens` and NO `thoughtsTokenCount`; the mapper `usageStatsToPublicUsageMetadata` maps ONLY those 4 keys and does NOT emit reasoning/thought tokens to the public wire. Adding a public reasoning-token field would be a public API change with CLI blast radius (exactly what option-(C)-unconditional avoids). (overview §5.5/§9.1-8, OQ-14, OQ-2u)
[REQ-008] Telemetry neutralized or bounded (overview §7A/§2A.4-II(h))
  [REQ-008.1] `turnLogging.logApiRequest` accepts/extracts text from neutral `IContent[]` (no `toGeminiContents`); `logApiResponse` accepts neutral `UsageStats` (or a documented telemetry wire DTO). (overview §2A.2 G4-G7, §2A.4-II(h), §3.2 #25)
  [REQ-008.2] If telemetry deliberately keeps Gemini-named usage keys for downstream consumers, that is a bounded serialization exception confined to `turnLogging.ts`, converted from neutral `UsageStats` at that edge, recorded in the central allow-list, banned everywhere else. (overview §7A telemetry note, OQ-3t)
[REQ-009] `clientContract.ts` cross-package neutralization
  [REQ-009.1] Google-shaped payload types DELETED: `ContractPart`, `ContractContent`, `ContractContentUnion`, `ContractPartListUnion`, `ContractGenerateContentConfig`, `ContractGenerateContentResponse`, `ContractSendMessageParameters`, `ContractUsageMetadata`. (overview §9.1-5, `clientContract.ts:52-127`)
  [REQ-009.2] `AgentClientContract`/`AgentChatContract` member signatures retyped to neutral (`IContent`/`ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput`). Surface interfaces stay; payload types die. (overview §9.1-5, `clientContract.ts:128-201`)
[REQ-010] Structural converter flows eliminated (overview §2A)
  [REQ-010.1] Zero `ContentConverters.toGeminiContent(...)` calls and zero `ContentConverters.toGeminiContents(...)` calls in agents production EXCEPT the single before-model hook-wire adapter (G3) IFF OQ-1a keeps the hook wire Gemini-shaped AND it is a central-allow-list entry; otherwise G3 is deleted too. G1/G2 vanish with §4; G4-G7 deleted. (overview §2A.2, §9.1-2a)
  [REQ-010.2] No imports of `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall` (barrel or direct) in agents production. (overview §2A.3, §9.1-2a)
[REQ-011] `googlePartHelpers.ts` fate confirmed (overview §3.2 #3, OQ-6)
  [REQ-011.1] Before removal/neutralization, verify core provides `ContentBlock[]` equivalents (`getToolCallBlocks`, `getResponseTextFromBlocks`, block-based outcome analysis) for all three helpers; retype callers onto them. (overview §3.2 #3, OQ-6)
[REQ-012] CI enforcement gates (overview §8/§8.1)
  [REQ-012.1] A parser/AST-context-aware CORE gate over `packages/agents/src` production detects: (a) `@google/genai` imports; (b) `Contract*`/Google payload symbol imports/aliases from banned modules; (c) `Contract*` payload-type imports; (d) round-trip symbols (`sdkTypeBridge`/`convertIContentToResponse`/`streamChunkWrapper`/`responseToModelStreamChunk`/`chunkToParts`/`providerStopReason`/`setProviderStopReason`/`getProviderStopReason`); (e) re-declared `Type`/`FinishReason` enums with Google string values; (f) structural `{candidates[].content.{role,parts}}`/`{role,parts}` literals + `GenerateContentResponse` casts + generic `.parts` mutation on non-neutral values + Google-shaped-API call contexts (NOT the bare identifiers `candidates`/`parts` — must spare the domain candidates at `CompressionLoadBalancingProvider.ts:34`, `CompressionProfileResolver.ts:401`, `profilesControl.ts:392`); (g) `ContentConverters.toGeminiContent(s)` call expressions + barrel `GeminiContent*` imports; (h) Gemini-named usage keys outside designated boundary modules. (overview §8(a)-(h), §9.1-10)
  [REQ-012.2] Exemptions are granted ONLY by a central versioned allow-list artifact (exact file + permitted AST-context pattern + written justification); inline `// gate-exempt` comments grant NOTHING. A structural hit with no matching allow-list entry fails regardless of any inline comment. (overview §8 exemption note, OQ-17 DECIDED)
  [REQ-012.3] A separate narrower TEST gate bans `GenerateContentResponse` construction and `{candidates}` fixtures in agents test files EXCEPT the named converter/boundary characterization allow-list (`boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts`, plus hook-wire fixtures per OQ-1a/OQ-1c). (overview §8.1, §9.1-9)
  [REQ-012.4] Mutation tooling that makes the plan's ≥80% mutation gate EXECUTABLE across BOTH migrated workspaces exists: (i) `packages/core` carries the same Stryker tooling `packages/agents` has (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner` devDeps, a `stryker.conf.json` scoped to the changed `llm-types` files, a `test:mutation` npm script) so P05's core-slice mutation gate is a runnable command; (ii) the whole-migration acceptance gate (P33) runs mutation over the ACTUAL migrated production surface (agents `src/core/**` + `src/subagent/**` + `src/agents/executor*` + `src/api/**` via explicit `--mutate`, and core changed `llm-types/*`), NOT the api-only default scope, and verifies each required migration slice archived a ≥80% report. GIVEN a changed core `llm-types` file; WHEN `npm --prefix packages/core run test:mutation -- --mutate <file>` runs; THEN Stryker mutates it and fails below 80%. (C3/C5; overview mutation gates; execution-tracker "Mutation & shrink-ratchet gates")
[REQ-013] Remove `@google/genai` dependency (LAST)
  [REQ-013.1] After zero remaining imports, `@google/genai` is removed from `packages/agents/package.json`; the agents owner count in `dev-docs/genai-import-baseline.md` reaches 0. (overview §9.1-1, §3.2)
  [REQ-013.2] The named characterization/boundary tests that are allow-listed by the TEST gate (REQ-012.3) use LOCAL structural fixtures (objects typed locally or `unknown`), NOT `@google/genai` SDK imports, so that removing the dependency (REQ-013.1) leaves ZERO `@google/genai` imports under `packages/agents/src` including tests. Any SDK-typed test is relocated to the Gemini provider/conversion package. The dependency is NEVER retained merely to satisfy a test fixture. GIVEN the dependency is removed; WHEN the tree is searched; THEN `grep -rl "@google/genai" packages/agents/src` (prod AND tests) is EMPTY. (overview §8.1, §9.1-1/9; makes REQ-012.3 allow-list and REQ-013.1 removal validate the SAME target state)
[REQ-INT-001] Behavioral contracts preserved (overview §7, §9.1-8) — verified by BEHAVIORAL tests, not internal-shape assertions
  [REQ-INT-001.1] Event ordering of `ServerAgentStreamEvent`s unchanged (Content/Thought/ToolCallRequest/Finished/Citation/Retry/Error/UserCancelled/StreamIdleTimeout/AgentExecutionStopped/Blocked).
  [REQ-INT-001.2] History-commit-once-per-turn: no retry duplication; history commits only after the stream loop completes (`StreamProcessor._finalizeStreamProcessing`).
  [REQ-INT-001.3] Tool dispatch, #2150 mid-stream transient retry, #2329 refusal `stopReason`, thinking/thoughtSignature round-trip, compression/token accounting (incl. absent-usage fallback, OQ-2t), abort/idle-timeout, AFC, hook decisions/restrictions all preserved.
[REQ-INT-002] Cross-package consumers migrated (overview §9.1-7)
  [REQ-INT-002.1] The 23 CLI (§A.2) + 5 core (§A.3) production `Contract*` consumers compile against the neutral surface; the build stays green cross-package.
  [REQ-INT-002.2] Ordering (OQ-4) keeps the monorepo build green at each committed phase.
[REQ-INT-003] Core services / history stay neutral (overview §9.1-6)
  [REQ-INT-003.1] `HistoryService` and other core services remain 0-`@google/genai`, `IContent`-based; characterization coverage pins their neutral signatures — the plan MUST NOT regress them.
[REQ-INT-004] Dead-code removal is real (not left in place)
  [REQ-INT-004.1] `streamChunkWrapper.ts` and `providerStopReason.ts` files are gone from the tree; the synthetic-response-only functions (§3.2 function-level delete inventory) are gone from their surviving files.
[REQ-INT-005] Tests migrated behaviorally (overview §9.1-9)
  [REQ-INT-005.1] Agent-loop tests assert observable outputs (emitted events, committed `HistoryService` state, retry ordering, finish/stop reasons), NOT `GenerateContentResponse`/`{candidates}` internals, except the named characterization allow-list.
[REQ-INT-006] Smoke + full verification green (overview §9 verification)
  [REQ-INT-006.1] `npm run test`/`lint`/`typecheck`/`format`/`build` green; the grep/AST gate reports zero raw imports AND zero structural bypasses under `packages/agents/src`; smoke `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` succeeds.

## Data Schemas (neutral gap types — for the stub→TDD→impl slices)

```typescript
// packages/core/src/llm-types/agentMessageInput.ts (NEW — REQ-001.1/.2)
// Neutral replacement for PartListUnion. NO role/parts. Speaker-agnostic input.
export type AgentMessageInput =
  | string
  | ContentBlock[]        // neutral blocks (TextBlock/MediaBlock/ToolResponseBlock/ThinkingBlock/...)
  | IContent              // a fully-formed neutral message
  | IContent[];
// Lossless legacy converter (structural, no @google/genai import; input typed unknown):
export function iContentFromAgentMessageInput(input: AgentMessageInput): IContent[];
export function iContentFromLegacyInput(input: unknown): { ok: true; value: IContent[] } | { ok: false; error: string };

// packages/core/src/llm-types/modelEnvelope.ts (EXTEND — REQ-001.4/.5)
export interface ModelOutput {
  content: IContent;
  finishReason?: CanonicalFinishReason;
  rawStopReason?: string;
  usage?: UsageStats;
  responseId?: string;
  hookRestrictions?: HookRestrictions;
  providerMetadata?: Record<string, unknown>;
  afcHistory?: IContent[];   // NEW first-class neutral AFC slot (OQ-2/OQ-15)
}
```

## Example Data

```json
{
  "neutralUserInput": "write me a haiku and nothing else",
  "neutralChunk": {
    "content": { "speaker": "ai", "blocks": [{ "type": "text", "text": "Silent code compiles" }] },
    "finishReason": "stop",
    "rawStopReason": "end_turn",
    "usage": { "promptTokens": 12, "completionTokens": 8, "totalTokens": 20 }
  },
  "refusalChunk": {
    "content": { "speaker": "ai", "blocks": [] },
    "finishReason": "refusal",
    "rawStopReason": "refusal"
  }
}
```

## Constraints

- TypeScript strict; no `any`; no type assertions (type predicates OK); immutable patterns (RULES.md).
- No `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no severity downgrades; no complexity/size threshold increases (CI-enforced `lint:eslint-guard`).
- Tests: Vitest; behavioral per RULES.md; NO mock theater; NO reverse testing; ≥30% property-based; target ≥80% mutation. Integration/behavioral tests use REAL agent-loop machinery (real `HistoryService`, real `StreamProcessor`/`TurnProcessor`/`Turn`), mocking ONLY the provider transport (the `AsyncIterable<IContent>` source) — never the component under test.
- The public event shapes `ServerAgentStreamEvent`/`StreamEvent`/`StreamEventType` (core-owned) MUST NOT change (RISK-1).
- Hook JSON wire byte-shape MUST NOT change (RISK-2).
- No time/effort estimates anywhere.

## Performance Requirements

No new performance budgets. The neutral pipeline REMOVES a round-trip (synthetic-response fabrication + re-derivation), so it must not regress streaming latency or memory; the existing agent-loop test timeouts and idle-watchdog behavior are the guardrail.

## Open Questions the Plan RESOLVES (from overview §9.2)

The plan resolves each overview OQ explicitly, with the resolution recorded in the relevant phase and/or `analysis/domain-model.md`:
OQ-1/OQ-1b (request DTO + lossless converter), OQ-1a/OQ-1c (hook wire + blocking neutral result), OQ-1d (characterization allow-list), OQ-2/OQ-15 (AFC neutral slot), OQ-2u/OQ-2v (public usage-metadata option + characterization), OQ-2t (token-sync source + absent-usage fallback), OQ-3s (stateless helper migration), OQ-3t (telemetry wire), OQ-3 (`normalizeToolInteractionInput`), OQ-4 (cross-package ordering), OQ-5 (`MessageConverter` split), OQ-6 (`googlePartHelpers` fate), OQ-7 (runtime enum values), OQ-8 (gate scope), OQ-9 (`geminiContent.ts` boundary), OQ-10 (thoughtSignature routing), OQ-11 (`systemInstruction` compat), OQ-12 (generic `.parts` helpers + executor prompt-config schema), OQ-13 (`executableCode`/`codeExecutionResult` fate), OQ-14 (reasoning-token fidelity), OQ-16 (provider metadata levels), OQ-17 (gate exemption — DECIDED: central allow-list), OQ-18 (Gemini config fields neutral home).

## Verification (whole plan)

- `npm run test` / `lint` / `typecheck` / `format` / `build` green.
- Core gate: `grep -rl "@google/genai" packages/agents/src | grep -v test` ⇒ empty; AST gate reports zero (a)-(h) structural hits (except allow-listed).
- Test gate: no `GenerateContentResponse`/`{candidates}` fixtures in agents tests except the named allow-list.
- Smoke: `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`.
- `git diff` shows the two DELETE files gone and the function-level deletes removed.

## Acceptance Criteria → REQ Mapping (overview §9.1)

| overview §9.1 acceptance | REQ |
|---|---|
| 1. Zero raw `@google/genai` imports | REQ-013.1, REQ-013.2, REQ-012.1(a), REQ-005.5c |
| 2. Zero Google-shaped types (structural §2A.4) | REQ-005.5 (incl. slices REQ-005.5a/.5b/.5c), REQ-012.1(f) |
| 2a. Zero structural-Gemini-content flow as currency | REQ-010.1, REQ-010.2, REQ-012.1(g) |
| 2b. Public usage-metadata decision applied | REQ-007.2, REQ-007.3, REQ-007.4 (PUBLIC out of scope), REQ-012.1(h) |
| 3. No synthetic `GenerateContentResponse` round-trip (both paths) | REQ-002.4, REQ-004.1 |
| 3a. AFC provider metadata not lost | REQ-001.4 |
| 3b. Provider output metadata beyond AFC dispositioned | REQ-001.5 |
| 4. Both side-channels retired | REQ-003.1, REQ-003.2 |
| 5. `clientContract.ts` neutralized | REQ-009.1, REQ-009.2 |
| 6. No Google shapes in core services/history | REQ-INT-003.1 |
| 7. CLI + core consumers migrated | REQ-INT-002.1 |
| 8. Behavioral contracts preserved | REQ-INT-001.1/.2/.3, REQ-007.4 (INTERNAL reasoningTokens preserved) |
| 9. Tests migrated behaviorally + allow-list | REQ-INT-005.1, REQ-012.3, REQ-013.2 |
| 10. Enforcement gates in place (prod + test) | REQ-012.1, REQ-012.2, REQ-012.3 |
| (tooling) Mutation gate executable + covers migrated surface | REQ-012.4 |
