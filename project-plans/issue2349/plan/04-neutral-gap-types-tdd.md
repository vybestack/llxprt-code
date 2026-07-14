# Phase 04: Neutral gap types — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P04`

## Prerequisites
- Required: Phase 03 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P03" packages/core/src/llm-types`
- Expected files from previous phase: `packages/core/src/llm-types/agentMessageInput.ts` (stub), `packages/core/src/llm-types/modelEnvelope.ts` (extended stub: `afcHistory`/provider-metadata slots), `sendParamsToRequest` stub.
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/neutral-gap-types.md` — TDD-ONLY phase: writes NO production code and implements NO pseudocode lines here. It authors the RED behavioral tests that the P05 impl (which cites `neutral-gap-types.md` lines 21-66) must satisfy; the concrete `@pseudocode lines X-Y` citations live in P05, not here. Tests reference the file's Interface Contracts / example data as the behavior spec.

## Requirements Implemented (Expanded)

### REQ-001.1: AgentMessageInput neutral DTO
**Full Text**: `AgentMessageInput` neutral DTO replaces `PartListUnion` as the agent/turn user-message + initial-request input. Structure supports text, media, tool responses, and tool-call IDs with NO Google `Part`/`role` shape.
**Behavior**:
- GIVEN: a caller supplies a user message as string / `ContentBlock[]` / `IContent` / `IContent[]`
- WHEN: converted via `iContentFromAgentMessageInput`
- THEN: the result is `IContent[]` with no `role`/`parts`/`candidates`.
**Why This Matters**: removes `PartListUnion`, the primary Google-shaped input vector into the loop.

### REQ-001.2: Lossless legacy→IContent converter
**Full Text**: A lossless legacy→`IContent` converter owns conversion of legacy input, preserving thought signatures, media, tool responses, and tool-call IDs. It MUST NOT be one of the §5.4 lossy paths (`generateContentResponseUtilities.legacyPartToBlocks`, `toolCall.partLikeToBlock`) on any thinking-bearing path.
**Behavior**:
- GIVEN: legacy input (string / Part-like array / Content-like)
- WHEN: converted via `iContentFromLegacyInput`
- THEN: thoughtSignature/media/toolResponse/toolCallId are preserved, and an unsupported shape returns `{ok:false,error}` (never silent stringify/drop — ES-2).
**Why This Matters**: legacy input crossing the boundary must lose nothing (esp. thinking signatures, BR-5) and must fail loudly rather than silently corrupt data.

### REQ-001.3: Turn-level neutral request DTO
**Full Text**: Turn-level neutral request DTO replaces `SendMessageParameters` (reuse/extend `ModelGenerationRequest` or a sibling `AgentGenerationRequest`), carrying message + generation settings neutrally.
**Behavior**:
- GIVEN: a legacy `SendMessageParameters`-style call (message + config)
- WHEN: expressed via `sendParamsToRequest(message, settings)`
- THEN: the result is a `ModelGenerationRequest` whose `contents` is `IContent[]` and whose `settings` carries generation options — with NO `GenerateContentConfig` and NO `PartListUnion`/`role`/`parts`.
**Why This Matters**: `SendMessageParameters` is the second Google-shaped input vector; proving call sites map cleanly onto the reused neutral DTO de-risks every retype slice.

### REQ-001.4: ModelOutput.afcHistory slot
**Full Text**: `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot so `automaticFunctionCallingHistory` survives synthetic-response removal on BOTH streaming and direct paths with identical slicing/hook-restriction-filter semantics.
**Behavior**:
- GIVEN: a `ModelOutput` with `afcHistory: IContent[]`
- WHEN: round-tripped through `accumulateModelStreamChunk`
- THEN: the AFC history is preserved as `IContent[]` (not provider metadata).
**Why This Matters**: keeps AFC alive after the synthetic response is deleted, without a Google-shaped detour.

### REQ-001.5: Neutral chunk preserves provider metadata
**Full Text**: Neutral chunk conversion preserves response-level provider metadata (`responseId`, and provider `providerMetadata` under `gemini.*` keys) per the OQ-16 disposition — preserved / ignored-by-design / provider-core-only, decided per field and per level (block-level AND response-level), NOT silently dropped by plain `toModelStreamChunk`.
**Behavior**:
- GIVEN: an `IContent` whose `metadata.providerMetadata` and `metadata.id` are set (and whose blocks carry block-level `providerMetadata`)
- WHEN: converted via `toModelStreamChunk`
- THEN: `chunk.providerMetadata` carries every key, `chunk.responseId` is set, and block-level `providerMetadata` survives by reference.
**Why This Matters**: closes the OQ-16 gap so `contentGeneratorAdapters.ts:195-210` `gemini.*` metadata is not dropped when the synthetic response is removed.

## Implementation Tasks (test-writing; behavioral, ≥30% property-based; RED first, fail NATURALLY)

### Files to Create
- `packages/core/src/llm-types/agentMessageInput.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P04`, `@requirement:REQ-001.1/.2/.3` (REQ-001.2 covers BOTH `iContentFromLegacyInput` AND the new `iContentFromBlocks` helper — C4)
- `packages/core/src/llm-types/modelEnvelope.afc-providerMetadata.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P04`, `@requirement:REQ-001.4/.5`

### Behavioral tests
`iContentFromAgentMessageInput`:
- string → `[{speaker:'human', blocks:[{type:'text', text}]}]` (deep-equal).
- `IContent` → `[input]`; `IContent[]` → same; `ContentBlock[]` → `[{speaker:'human', blocks}]`.
- PROPERTY: for ANY non-empty string, exactly one human IContent with one TextBlock whose text === input.

`iContentFromLegacyInput`:
- legacy `{text}` part → TextBlock; `{thought,thoughtSignature}` → ThinkingBlock with signature preserved (BR-5); `{inlineData}` → MediaBlock base64; `{fileData}` → MediaBlock url; `{functionCall}` → ToolCallBlock (id+name+params); `{functionResponse}` → ToolResponseBlock.
- unsupported shape (e.g. `{weird:1}`) → `{ok:false, error}` — asserts error, NOT a thrown exception, NOT silent drop (ES-2).
- PROPERTY: for ANY array of `{text}` parts, blocks length === parts length and texts preserved in order.
- PROPERTY: a `{thought,thoughtSignature}` part ALWAYS yields a ThinkingBlock whose signature === input.thoughtSignature (never dropped — BR-5).

`iContentFromBlocks` (REQ-001.2 — C4, the neutral block→IContent helper):
- `iContentFromBlocks([{type:'text',text:'hi'}])` → `{speaker:'ai', blocks:[{type:'text',text:'hi'}]}` (default speaker `'ai'`; deep-equal).
- `iContentFromBlocks(blocks, 'human')` → `{speaker:'human', blocks}` (explicit speaker honored).
- result has NO `role`/`parts`/`candidates` keys (neutral shape only — asserts the Object keys are exactly `speaker`/`blocks`).
- input `blocks` reference is not mutated (immutability); the returned object is a NEW object.
- PROPERTY: for ANY `ContentBlock[]`, `iContentFromBlocks(blocks).blocks` deep-equals the input blocks and the only top-level keys are `speaker`/`blocks`.

`toModelStreamChunk` extension (REQ-001.5):
- IContent with `metadata.providerMetadata = {'gemini.safetyRatings': [...]}` → chunk.providerMetadata has that key (was dropped before).
- IContent with `metadata.id` → `chunk.responseId`.
- block-level: IContent whose block has `providerMetadata` → same object present on the chunk's block (by reference/deep-equal).
- PROPERTY: for ANY metadata.providerMetadata record, every key survives onto chunk.providerMetadata.

`sendParamsToRequest` (REQ-001.3):
- `sendParamsToRequest('hi', settings)` → `{ contents: [{speaker:'human', blocks:[{type:'text', text:'hi'}]}], settings }` (deep-equal); result has NO `message`/`config`/`role`/`parts` keys.
- `sendParamsToRequest(iContentArray)` → `{ contents: iContentArray }`.
- PROPERTY: for ANY `AgentMessageInput`, `sendParamsToRequest(input).contents` deep-equals `iContentFromAgentMessageInput(input)` and the request object exposes only `contents`/`settings`/`tools` (no Google-shaped keys).

`afcHistory`:
- a `ModelOutput` accepting `afcHistory: IContent[]` type-checks and round-trips through `accumulateModelStreamChunk` without loss.

## Forbidden
- NO mock theater / reverse testing / structure-only.
- NO asserting `NotYetImplemented`.
- Tests must fail NATURALLY (empty stub returns wrong values), not with "not a function".

## Verification Commands
```bash
# Both P04 test files exist and FAIL naturally against the P03 stubs
npm test -- packages/core/src/llm-types/agentMessageInput.test.ts packages/core/src/llm-types/modelEnvelope.afc-providerMetadata.test.ts

# Property ratio computed over ALL test files THIS phase creates (C4) — BOTH files, aggregate ≥30%.
# Uses the reusable prop_ratio helper defined in verification-template.md §7:
prop_ratio \
  packages/core/src/llm-types/agentMessageInput.test.ts \
  packages/core/src/llm-types/modelEnvelope.afc-providerMetadata.test.ts
# Expected: percent >= 30% across BOTH files (NOT a single-file count).
```

## Success Criteria
- Test files exist for REQ-001.1/.2/.3/.4/.5 and FAIL NATURALLY against the P03 stubs (value mismatches, not "not a function").
- ≥30% of tests are property-based, computed as the AGGREGATE across BOTH test files this phase creates (`agentMessageInput.test.ts` AND `modelEnvelope.afc-providerMetadata.test.ts`) via the `prop_ratio` helper — NOT a single-file count (C4).
- BR-5 (thoughtSignature preserved), ES-2 (unsupported→`{ok:false}`), REQ-001.2 (`iContentFromBlocks` builds a neutral `IContent` with only `speaker`/`blocks` keys, default speaker `'ai'`, explicit speaker honored — C4), REQ-001.3 (no Google-shaped request keys), and REQ-001.5 (providerMetadata/responseId preserved — the OQ-16 gap) each have at least one dedicated test.
- No reverse testing, no mock theater, no structure-only assertions.

## Failure Recovery
If this phase fails (tests do not fail naturally, or coverage/property ratio is short, or a forbidden pattern is present):
1. `git checkout -- packages/core/src/llm-types/agentMessageInput.test.ts packages/core/src/llm-types/modelEnvelope.afc-providerMetadata.test.ts`
2. Re-author the tests behaviorally per the Test Tasks above; do NOT weaken assertions to pass against the stub.
3. Cannot proceed to Phase 05 until the tests fail naturally and the checklist is satisfied.

## Phase Completion Marker
`project-plans/issue2349/.completed/P04.md`.
