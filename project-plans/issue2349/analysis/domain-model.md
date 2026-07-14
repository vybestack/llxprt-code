# Domain Model: Agents Neutralization (Issue #2349)

Plan ID: PLAN-20260707-AGENTNEUTRAL
Source of truth: `project-plans/issue2349/overview.md` (consumed, not re-derived) + `specification.md`.

This document models the ENTITIES, STATE TRANSITIONS, BUSINESS RULES, EDGE CASES, and ERROR SCENARIOS of the agent loop as it moves from the Google-shaped round-trip (current) to neutral end-to-end (target). It also records the RESOLUTION of every overview Open Question (§9.2), because those resolutions are domain decisions the implementation phases depend on.

---

## 1. Entities

### 1.1 Neutral currency (core-owned; already exists per #2347 — CONSUMED)

- **`IContent`** — the neutral message: `{ speaker: 'human'|'ai'|'tool'; blocks: ContentBlock[]; metadata?: ContentMetadata }`. Metadata carries `stopReason`, `finishReason`, `usage`, `id`, `providerMetadata` (`IContent.ts:52-83`).
- **`ContentBlock`** — `TextBlock` | `ToolCallBlock` | `ToolResponseBlock` | `ThinkingBlock` (`thought`/`signature`/`sourceField`/`isHidden`) | `MediaBlock` | `CodeBlock`. Each has optional block-level `providerMetadata`.
- **`ModelOutput`** (`modelEnvelope.ts:51-59`) — neutral final accumulation: `{ content: IContent; finishReason?; rawStopReason?; usage?; responseId?; hookRestrictions?; providerMetadata? }`. **EXTENDED here** with `afcHistory?: IContent[]` (REQ-001.4).
- **`ModelStreamChunk`** (`modelEnvelope.ts:70`) — structurally identical to `ModelOutput`; a streaming delta.
- **`HookRestrictions`** (`modelEnvelope.ts:41-44`) — `{ allowedToolNames?: string[]; hadFilteredRestrictedCalls?: boolean }`.
- **`CanonicalFinishReason`** — `'stop'|'max_tokens'|'tool_calls'|'safety'|'refusal'|'error'|'other'` + per-provider mappers.
- **`ToolCallRequest`** — `{ id?; name; args }`.
- **`ToolDeclaration`** / **`ToolChoice`** / **`JsonSchema`** — neutral tool + schema types.
- **`ModelGenerationRequest`/`ModelGenerationSettings`/`ReasoningConfig`** (`modelRequest.ts`).
- **`ProviderApiError`** + `isProviderApiError`.

### 1.2 Neutral gap types (NEW — this plan; stub→TDD→impl)

- **`AgentMessageInput`** — neutral replacement for `PartListUnion`. `string | ContentBlock[] | IContent | IContent[]`. No `role`/`parts`.
- **Lossless legacy converter** `iContentFromLegacyInput(unknown)` — preserves thought signatures, media, tool responses, tool-call IDs; returns a result object (no throw for control flow). MUST route thinking-bearing input through a signature-preserving path (NOT the §5.4 lossy `legacyPartToBlocks`/`partLikeToBlock`).
- **Turn request DTO** — reuse/extend `ModelGenerationRequest` (decision: extend, see §5 OQ-1) as the neutral `SendMessageParameters` replacement.
- **`ModelOutput.afcHistory?: IContent[]`** — first-class AFC slot.

### 1.3 Google-shaped entities being REMOVED (current → gone)

- Synthetic `GenerateContentResponse` (`{candidates:[{content:{role,parts}}]}`) — fabricated by `MessageConverter.convertIContentToResponse` (`:518-543`).
- `Part[]` / `FunctionCall[]` as internal currency.
- `providerStopReason.ts` `CandidateWithProviderStopReason` field.
- `hookToolRestrictions.ts` `WeakMap<GenerateContentResponse|FunctionCall, …>` + `Symbol` props.
- `clientContract.ts` `Contract*` payload types (`:52-127`).

---

## 2. State Transitions (the agent turn)

### 2.1 CURRENT (broken round-trip)

```
Provider → IContent (neutral)
  → convertIContentToResponse → synthetic GenerateContentResponse (Google)
  → [AfterModel hook + hookToolRestrictions WeakMap; providerStopReason bolted on Candidate]
  → StreamProcessor accumulate Part[] / FinishReason → HistoryService
  → TurnProcessor wrapChunk → responseToModelStreamChunk → ModelStreamChunk (neutral)
  → StreamEvent.CHUNK
  → Turn.processStreamChunk → chunkToParts → Part[] (BACK to Google)
  → ServerAgentStreamEvent (public, unchanged shape)
```
Crosses the neutral↔Google boundary ≥3 times; none of it talks to Gemini.

### 2.2 TARGET (neutral end-to-end)

```
Provider → IContent (neutral)
  → StreamProcessor: toModelStreamChunk(iContent) [extended to preserve providerMetadata/responseId per OQ-16]
       accumulate ContentBlock[] / CanonicalFinishReason → HistoryService
  → [AfterModel hook filters ContentBlock[]; HookRestrictions on chunk; rawStopReason on chunk]
  → TurnProcessor: for-await ModelStreamChunk; wrapChunk wraps ModelStreamChunk DIRECTLY
  → StreamEvent.CHUNK { value: ModelStreamChunk }
  → Turn.processStreamChunk operates on ContentBlock[]/ToolCallBlock
  → ServerAgentStreamEvent (public, UNCHANGED)
```
No synthetic response; no `Part[]` re-derivation; no side-channels.

### 2.3 Direct-message (non-streaming) transition

CURRENT: two synthetic-response fabrications (`_buildBlockingSyntheticResponse` pre-provider block path `:677-701`; `convertIContentToResponse` after-model `:744-753`); returns `GenerateContentResponse`.
TARGET: returns neutral `ModelOutput` on BOTH paths; blocking BeforeModel hook yields a neutral `ModelOutput`/hook result (same text/reason); AFC rides `ModelOutput.afcHistory`; hook filtering on `ContentBlock[]`.

---

## 3. Business Rules (invariants that MUST hold across the migration)

- **BR-1 (history-commit-once):** History commits ONLY in `StreamProcessor._finalizeStreamProcessing` AFTER the stream loop completes (`StreamProcessor.ts:783` region). Turn-level retry (#2150) MUST NOT duplicate history. The neutral pipeline preserves this exact commit site/timing.
- **BR-2 (public event shape frozen):** `ServerAgentStreamEvent`/`StreamEvent`/`StreamEventType` are core-owned. Only the internal derivation of emitted VALUES changes; the shapes do not.
- **BR-3 (refusal stop reason, #2329):** The raw provider stop reason (e.g. Anthropic `'refusal'`) surfaces on the `Finished` event. In target it rides `ModelStreamChunk.rawStopReason` sourced from `IContent.metadata.stopReason` — never a bolted-on `Candidate` field.
- **BR-4 (mid-stream transient retry, #2150):** Mid-stream transient network errors retry at the turn level without duplicating history (guarded by BR-1). Abort is NOT retried.
- **BR-5 (thinking/thoughtSignature round-trip):** `ThinkingBlock` `signature`/`sourceField` survives model-output conversion; thought content is dropped from recorded history when `reasoning.includeInContext()` is false but the signature is retained; conversion routes through a signature-preserving converter (OQ-10).
- **BR-6 (token accounting + absent-usage fallback, OQ-2t):** Token sync reads neutral `UsageStats` (`promptTokens`) from the chunk/`ModelOutput.usage`/`IContent.metadata.usage`, and preserves the current absent-usage fallback (fall back to `lastPromptTokenCount` when usage is absent).
- **BR-7 (adjacent text consolidation):** Adjacent model-output `TextBlock`s are merged at the SAME boundaries the current `.parts`-based consolidation uses (`ConversationManager._consolidateModelOutput`); no `.parts` mutation remains.
- **BR-8 (AFC slicing/filtering):** `automaticFunctionCallingHistory` is sliced against curated history and hook-restriction-filtered identically on BOTH streaming and direct paths, now on neutral `IContent[]` via `ModelOutput.afcHistory`.
- **BR-9 (hook JSON wire byte-shape):** Before/after-model + before-tool-selection hook serialized payloads are byte-identical; any Gemini shape is confined to a single named boundary adapter on the allow-list.
- **BR-10 (idle/abort watchdogs):** First-response + inter-chunk idle watchdogs and abort-driven resolution behave identically.
- **BR-11 (no Google shape as internal currency):** After migration, no agents production file uses `Part`/`Content`/`GenerateContentResponse`/`Contract*`/`GeminiContent*`/`.parts`/Gemini usage keys as internal currency (structural, per overview §1.3).

---

## 4. Edge Cases

- **EC-1 usage-only chunk (empty blocks):** valid; contributes usage without blocks (`accumulateModelStreamChunk` already handles).
- **EC-2 missing finish reason:** default-to-`stop` moves from the `{candidates}` patch onto the neutral chunk's `CanonicalFinishReason` (replaces `streamRequestHelpers.patchMissingFinishReason`).
- **EC-3 refusal with empty content:** `finishReason:'refusal'`, `rawStopReason:'refusal'`, empty blocks — `Finished` event still carries the stop reason (#2329).
- **EC-4 blocking BeforeModel hook:** no provider output; a neutral `ModelOutput` carrying the reason text is produced (not a `{candidates}` cast).
- **EC-5 tool-call filtering by hook restrictions:** `ToolCallBlock`s filtered out by `allowedToolNames`; `hadFilteredRestrictedCalls` set on `HookRestrictions`.
- **EC-6 mixed thinking + tool-call + text in one turn:** all blocks preserved in order; thinking signature retained; consolidation merges only adjacent text.
- **EC-7 mid-stream transient error then success on retry:** single history commit; events replay correctly.
- **EC-8 non-string `systemInstruction` (OQ-11):** per resolution below.
- **EC-9 legacy tool-response-as-user-message input (OQ-3):** per resolution below.

---

## 5. Open-Question RESOLUTIONS (domain decisions — binding on phases)

These resolve overview §9.2. Every entry below is a **COMMITTED decision** — the plan executes it deterministically. One entry (OQ-12 prompt-config schema) depends on a measurement that a dedicated **decision-gate phase** performs BEFORE the dependent phase; the committed decision states the default AND the single objective condition (with the measuring phase named) under which the pre-registered alternative applies. **OQ-2u is COMMITTED UNCONDITIONALLY to option (C)** — it has NO branch (option (B) is rejected for #2349, Critical 1 round 7); the OQ-2v characterization phase (P18) records runtime evidence only and does NOT select a branch. Preflight (Phase 0.5) is a **validity check**: if a preflight assumption is violated, the plan is marked INVALID and returned for re-planning — preflight does NOT silently branch the implementation.

- **OQ-1 (request DTO):** RESOLVE — **extend `ModelGenerationRequest`** as the turn-level request DTO (it already carries `contents: IContent[]` + `settings`); add a neutral `AgentMessageInput` for the raw user-message input. No new sibling type unless preflight finds `ModelGenerationRequest` insufficient.
- **OQ-1a (hook wire message shape):** COMMITTED — **the before-model hook JSON wire (`llm_request.messages`) STAYS Gemini-shaped `{role,parts}`**, and the single G3 `toGeminiContents` adapter at `streamRequestHelpers.ts:226-249` SURVIVES as the one central-allow-list `toGeminiContents` entry (converted in, `toIContents` back out; the Gemini shape never leaks past that adapter). Rationale: the hook JSON wire is a published external contract (RISK-2 requires its byte shape stay unchanged), so G3 is retained by design, NOT conditionally. Preflight check confirms the wire is still consumed as `{role,parts}` (documenting the byte contract); this is a validity check only — it does NOT delete G3. G3 survives; `G3=survives` is FINAL. This choice fixes REQ-010.1 and the hook-adapter allow-list entry (P25/P31).
- **OQ-1b (lossless converter ownership):** RESOLVE — a NEW `llm-types` converter (`iContentFromLegacyInput`) owns lossless legacy→`IContent`, typed on `unknown` (no `@google/genai` import). It is NOT `generateContentResponseUtilities.legacyPartToBlocks`/`toolCall.partLikeToBlock` on thinking-bearing paths.
- **OQ-1c (blocking BeforeModel neutral result):** RESOLVE — the blocking hook yields a neutral `ModelOutput` (same text/reason). `BeforeModelHookOutput.getSyntheticResponse()` is replaced by a neutral hook result; any hook-provided legacy synthetic response is converted to `ModelOutput` at the boundary adapter, never used internally.
- **OQ-1d (converter/boundary tests may remain structural):** RESOLVE — `boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts` are RETAINED as named characterization tests on the §8.1 allow-list; the final membership is confirmed in the test-migration phase.
- **OQ-2 / OQ-15 (AFC mapping + provider-metadata propagation):** RESOLVE — promote AFC to first-class `ModelOutput.afcHistory?: IContent[]` so `providerMetadata` need not be load-bearing for AFC. Cover BOTH streaming (`TurnProcessor._recordAfcHistory`, `toIContent` sites `:757,775,808,827`) and direct (`DirectMessageProcessor.getIContentAutomaticFunctionCallingHistory` `:99-110`), with identical slicing + hook-restriction filtering.
- **OQ-2u (public usage-metadata option):** COMMITTED UNCONDITIONALLY — **DECISION = (C) bridge at the boundary. There is NO branch: option (B) is NOT selectable for #2349.** (Critical 1, round 7 — resolved.) Rationale: option (B) (retype the public `UsageMetadataValue`/`FinishedValue.usageMetadata` declared type to neutral `UsageStats`) is a PUBLIC BREAKING CHANGE that would break the current CLI/public-event consumers that read Gemini-named usage keys (`packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts:406` reads `event.usage.promptTokenCount`; `packages/cli/src/zed-integration/zedIntegration.ts:614-615` read `usage.candidatesTokenCount`/`usage.totalTokenCount`) and would require a coordinated cross-package CLI migration that is OUT OF SCOPE for this agents-neutralization issue. Option (C) preserves the published API wire at the boundary (mapper), keeps the internal loop neutral, and bounds this issue's blast radius (RISK-1 conservative). Only branch (C) is specified:
  - **(C) — THE COMMITTED DECISION (no alternative):** the declared public `usageMetadata` type STAYS Gemini-named (`UsageMetadataValue`/`FinishedValue.usageMetadata` at `api/event-types.ts:32-41` / `event-schema.ts:30-39` are UNCHANGED); agents emits neutral `UsageStats` internally; a NEW `usageStatsToPublicUsageMetadata` mapper is written at `eventAdapter.ts`'s `Finished`/`UsageMetadata` cases (currently the value is forwarded verbatim). The mapper converts neutral→Gemini-named at the outermost edge, honoring the declared type so NO public/CLI consumer breaks. Gate check (h) permits Gemini keys ONLY in the designated boundary modules (`api/event-types.ts`, `api/event-schema.ts`, the mapper module in `eventAdapter.ts`) — never in the internal loop and never in `turnLogging.ts` (OQ-3t committed neutral).
  - **Option (B) is explicitly REJECTED for #2349** (recorded here so no later phase reintroduces it): it would break the named CLI consumers above with no owning migration phase in this plan. Migrating the public usage wire to neutral is deferred to a future coordinated cross-package issue, NOT this one.
- **OQ-2v (runtime shape characterization — RECORDED EVIDENCE only, NOT a branch selector):** the usage-metadata characterization TDD phase (P18) still runs FIRST and records what `done.finished.usageMetadata` emits at runtime (expected: the adapter forwards verbatim, so neutral `UsageStats` keys today despite the Gemini-named declared type). This finding is a RECORDED FACT (M3 core-shape evidence / documentation of the declared-vs-emitted disagreement that motivates the mapper) — it does **NOT** select any branch, because the branch is fixed at (C) unconditionally (see OQ-2u). The recorded key set justifies WHY the mapper is needed (declared Gemini-named type vs verbatim-forwarded neutral runtime value), but the implementation is (C) regardless of the observed keys.
- **OQ-2t (token-sync source):** RESOLVE — read `UsageStats.promptTokens` from the neutral chunk/`ModelOutput.usage`; preserve the absent-usage fallback to `lastPromptTokenCount` and the last-chunk-with-metadata search in `streamResponseHelpers`.
- **OQ-3s (stateless helper migration):** RESOLVE — `generateJson`/`generateContent` (`clientLlmUtilities.ts`/`baseLlmClient.ts`) migrate WITH `AgentClientContract` to neutral `IContent[]`/`ContentBlock[]`; text extraction + `next_speaker` fallback read `TextBlock.text`.
- **OQ-3t (telemetry wire):** COMMITTED — **telemetry is FULLY NEUTRAL**: `turnLogging.logApiRequest` accepts `IContent[]` and extracts text neutrally; `logApiResponse` accepts neutral `UsageStats`. NO Gemini-named telemetry exception is taken — `turnLogging.ts` is NOT added to the §8(h) allow-list. Rationale: telemetry is an internal clearcut logging surface (`getRequestTextFromContents` only extracts text; usage is logged as counts), with no external byte contract requiring Gemini keys (preflight validity check confirms no telemetry consumer parses Gemini-named keys off these logs; if that assumption is ever violated the plan is returned for re-planning — it does NOT silently branch). Final answer: telemetry keys = neutral, no exception.
- **OQ-3 (`normalizeToolInteractionInput`):** RESOLVE — callers construct `IContent{speaker:'tool'}`/`ToolResponseBlock[]` directly via the neutral converter; the tool-response-as-user-message packaging gets a neutral equivalent only if a caller genuinely needs it (confirmed during the MessageConverter split).
- **OQ-4 (cross-package ordering):** RESOLVE — order: (1) land neutral gap types; (2) neutralize the agents INTERNAL pipeline against the neutral types while the `clientContract.ts` surface still compiles (agents implements a superset); (3) flip `clientContract.ts` payload types to neutral + migrate CLI(23)/core(5) consumers in the SAME phase so the build stays green; (4) remove genai dep + land gate LAST. A staged compile-green checkpoint is verified at each phase.
- **OQ-5 (`MessageConverter` split):** RESOLVE — DELETE `convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`/`isValidResponse`. RETYPE (survive) the `IContent`↔block conversion and input normalization (`createUserContentWithFunctionResponseFix` becomes neutral `IContent` construction per §2A.4-I(b)). `classifyMixedParts`/`convertBlocksToParts`/`convertPartListUnionToIContent` survive retyped or are replaced by core equivalents — confirmed by tracing callers in the pseudocode phase.
- **OQ-6 (`googlePartHelpers` fate):** RESOLVE — NEUTRALIZE-IN-PLACE after verifying core provides `getToolCallBlocks`/`getResponseTextFromBlocks`/block-based outcome analysis (the in-file `@issue #2348` comments assert this). Preflight confirms before removal.
- **OQ-7 (runtime enum values):** RESOLVE — replace runtime `Type` with JSON-schema string literals (`'object'`/`'string'`/`'array'`/…), runtime `FinishReason` with `CanonicalFinishReason`. Confirm no external consumer depends on Gemini uppercase strings (preflight grep).
- **OQ-8 (gate scope):** RESOLVE — for #2349 the gate is agents-only (`packages/agents/src` production + the §8.1 test gate). The core-owned `ServerUsageMetadataEvent` is NOT enforced by the agents gate; REQ-007.3 states the limitation and tracks the decision in the cross-package migration (a separate core-package check is out of scope for #2349 unless preflight elects to add it).
- **OQ-9 (`geminiContent.ts` boundary):** RESOLVE — verified: no agents production file references `GeminiContent*` by name today; the gate check (g) prevents future leakage. The only residual is the OQ-1a hook-adapter exception.
- **OQ-10 (thoughtSignature routing):** RESOLVE — model-output conversion routes through the signature-preserving `MessageConverter`/`ContentConverters` block path; lossy converters are kept off thinking-bearing paths (enforced by BR-5 tests).
- **OQ-11 (`systemInstruction` compat):** DEFAULT — narrow the neutral contract to **string-only** `systemInstruction`, deleting the `{role:'user',parts:[systemInstruction as Part]}` wrapper (`baseLlmClient.ts:333-336`) and the non-string extraction. Preflight confirms no production caller passes a non-string `systemInstruction`; if one does, retype the extraction onto neutral blocks at the boundary instead.
- **OQ-12 (generic `.parts` helpers + executor prompt-config schema):** COMMITTED (both parts):
  - **Internal mutator:** `executor-prompt-builder.ts:47-58` `applyTemplateToInitialMessages` is RETYPED to operate on `IContent`/`ContentBlock[]` (internal currency, not a bounded adapter). This is the raw-import-free structural `.parts` mutator (#2424 structural case); gate check (f) catches it.
  - **Public `PromptConfig.initialMessages` schema:** DECISION = **migrate to neutral `IContent[]`** (`agents/types.ts:95` `initialMessages?: Content[]` → `initialMessages?: IContent[]`; `executor.ts:894-898` `applyTemplateToInitialMessages(initialMessages: Content[])` → `IContent[]`; `subagentNonInteractive.ts:517` likewise). Per the §1.2 corollary ("fix the contract, not the agents around it"), the public agent-config schema is made neutral rather than kept Google-shaped behind an ingestion adapter — so NO `toGeminiContents`/`toIContents` ingestion adapter and NO allow-list entry is created for this field. This is a knowingly-breaking change for extension authors who author `PromptConfig.initialMessages` as Gemini `Content[]`; the executor slice owns the migration and updates the field's JSDoc/type accordingly. The preflight validity check enumerates in-repo `PromptConfig.initialMessages` producers (currently none outside agents' own tests per the sweep); if an out-of-repo/public producer surfaces during review, that is a maintainer-facing breaking-change note, NOT a silent legacy branch.
- **OQ-13 (`executableCode`/`codeExecutionResult` fate):** RESOLVE — REMOVE them from the neutral agent contract (only ever fabricated as `undefined`, no real producer/consumer). If real code-execution support is later needed, map to neutral `CodeBlock`.
- **OQ-14 (reasoning-token fidelity) — SPLIT into an INTERNAL decision (mandatory) and a PUBLIC decision (out of scope), Critical 1 round 8:**
  - **INTERNAL (RESOLVE, mandatory):** BOTH neutral paths preserve `UsageStats.reasoningTokens`. Streaming already maps `thoughtsTokenCount → UsageStats.reasoningTokens` (`streamChunkWrapper.ts:57-59`); the direct path ALSO populates `reasoningTokens` when retyped to return `ModelOutput` (§2B.2). Internal reasoning tokens ride `ModelOutput.usage` / `ModelStreamChunk.usage` / `IContent.metadata.usage` — never dropped when the synthetic response is removed (acceptance §9.1-8; pinned by P12/P13 direct-path characterization and P06/P07 streaming characterization).
  - **PUBLIC (OUT OF SCOPE for #2349):** the declared public `UsageMetadataValue`/`FinishedValue.usageMetadata` type stays UNCHANGED (Gemini-named, option (C)) and declares ONLY `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`/`cachedContentTokenCount` (`packages/agents/src/api/event-types.ts:32-37`). It has NO `reasoningTokens` AND NO `thoughtsTokenCount` field. The option-(C) mapper `usageStatsToPublicUsageMetadata` therefore maps ONLY those 4 keys and does NOT emit reasoning/thought tokens to the public wire. Adding a public reasoning-token field would be a public API change with CLI blast radius — exactly what option-(C)-unconditional avoids — so it is explicitly out of scope. (Consistent with P19 OQ-14 INTERNAL/PUBLIC split and the usage-metadata-boundary pseudocode lines 25-26.)
- **OQ-16 (provider metadata levels):** RESOLVE — preserve BOTH block-level (`IContent`/`ContentBlock.providerMetadata`) and response-level (`ModelOutput.providerMetadata` incl. `responseId`) through events/history. The target conversion is therefore `toModelStreamChunk` EXTENDED (or wrapped) to normalize provider output metadata onto the chunk — NOT the plain converter. `promptFeedback`/`safetyRatings`/`groundingMetadata` (mapped under `gemini.*` at `contentGeneratorAdapters.ts:195-210`) are PRESERVED on `providerMetadata` (provider/core-owned, passed through, not interpreted by agents).
- **OQ-17 (gate exemption mechanism):** DECIDED (overview) — central versioned allow-list artifact is the single authoritative exemption; inline comments grant nothing. Encoded in REQ-012.2.
- **OQ-18 (Gemini config fields neutral home):** RESOLVE per field — `thinkingConfig`→`ReasoningConfig`; `responseJsonSchema`/`responseMimeType`→existing neutral `ModelGenerationSettings` slots/`modelParams`; `responseSchema`/`safetySettings`/`cachedContent` out of scope unless a public boundary needs them (preflight confirms none in agents today).

---

## 6. Error Scenarios

- **ES-1:** Provider throws mid-stream transient error → turn-level retry (BR-4), single history commit (BR-1). Non-transient/abort → surface `Error`/`UserCancelled` event unchanged.
- **ES-2:** Legacy input that cannot be losslessly converted → `iContentFromLegacyInput` returns `{ok:false,error}` (never silent stringify/drop); caller surfaces a clear error.
- **ES-3:** Schema-depth error → enriched via `schemaDepthErrorEnrichment` using `isProviderApiError`/`ProviderApiError` (no `ApiError` value import).
- **ES-4:** Invalid/empty stream → `InvalidStreamError`/`EmptyStreamError` classification + `INVALID_CONTENT_RETRY_OPTIONS` unchanged; now keyed on neutral chunk emptiness.

---

## 7. Traceability

Every business rule maps to a REQ-INT-001 sub-requirement and is pinned by a behavioral characterization test written BEFORE the corresponding internal migration (vertical-slice discipline). Every OQ resolution above is cited by the phase that depends on it. The pseudocode phase encodes BR-1..BR-11 and the OQ resolutions as line-numbered algorithms that implementation phases follow.
