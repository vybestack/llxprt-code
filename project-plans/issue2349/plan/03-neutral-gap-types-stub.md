# Phase 03: Neutral gap types — STUB

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P03`

## TDD ordering (C5 — template-sanctioned stub phase; NO behavioral production logic precedes its failing test)
This is the canonical PLAN.md stub phase (`dev-docs/PLAN.md` §"Phase 3+: Implementation Cycles → A. Stub Phase"): it creates UNCALLABLE placeholders that COMPILE — every exported function returns a NON-THROWING empty value of the correct type (Minor 2 round 8: throwing `new Error('NotYetImplemented')` is a last resort ONLY when a correctly-typed non-throwing return cannot compile), with ZERO behavioral logic, ≤~80 lines. It is NOT a TDD violation because (a) PLAN.md explicitly sanctions a stub phase whose methods return empty/throw, and (b) P04's tests assert REAL behavior and FAIL NATURALLY against these placeholders (value mismatches), never asserting `NotYetImplemented` (no reverse testing — PLAN.md forbids that). The strict separation is: **P03 = uncallable placeholders that compile; P04 = behavioral failing tests; P05 = implementation that makes them pass.** No production BEHAVIORAL logic exists until P05, i.e. none precedes its failing test. A reviewer must NOT mis-flag P03 as test-after development: it is the sanctioned skeleton, and P03a verifies the stubs are non-behavioral (they return empty/throw; they do NOT compute results).

## Prerequisites
- Required: Phase 0.5 (preflight) completed and PASS.
- Verification: `test -f project-plans/issue2349/.completed/P0.5.md`
- Expected files from previous phase: `project-plans/issue2349/.completed/P0.5.md` (preflight evidence incl. refreshed line-number site maps, Minor 2).
- Preflight verification: Phase 0.5 completed (this is the first production phase; P0.5 is its gate).
- Pseudocode: `analysis/pseudocode/neutral-gap-types.md`

## Requirements Implemented (Expanded)

### REQ-001.1: AgentMessageInput neutral DTO
**Full Text**: `AgentMessageInput` neutral DTO replaces `PartListUnion` as the agent/turn user-message + initial-request input. Structure supports text, media, tool responses, and tool-call IDs with NO Google `Part`/`role` shape.
**Behavior**:
- GIVEN: a caller supplies a user message
- WHEN: it is a string, neutral blocks, or IContent(s)
- THEN: it is accepted as `AgentMessageInput` with no Google `Part`/`role` shape
**Why This Matters**: Removes `PartListUnion` — the primary Google-shaped input vector into the loop.

### REQ-001.2: Neutral block→IContent helper (`iContentFromBlocks`) — C4
**Full Text**: `iContentFromBlocks(blocks: ContentBlock[], speaker?): IContent` is a lossless neutral wrapper that builds ONE `IContent` from already-neutral `ContentBlock[]`, so the AfterModel hook filtering paths (StreamProcessor P07, DirectMessageProcessor P13) can hand `fireAfterModelEvent` a neutral `IContent` WITHOUT any Google-shaped intermediary. It replaces the previously-referenced phantom helper name.
**Behavior**:
- GIVEN: neutral `ContentBlock[]` (e.g. filtered after-model blocks) and an optional speaker
- WHEN: converted via `iContentFromBlocks(blocks, speaker)`
- THEN: the result is `{ speaker: speaker ?? 'ai', blocks }` — an `IContent` with NO `role`/`parts`/`candidates`.
**Why This Matters**: gives P07/P13 a REAL, tested helper (with pseudocode lines) for the after-model event path instead of a name that does not exist — closing the C4 executability gap.

### REQ-001.3: Turn-level neutral request DTO
**Full Text**: Turn-level neutral request DTO replaces `SendMessageParameters` (reuse/extend `ModelGenerationRequest` or a sibling `AgentGenerationRequest`), carrying message + generation settings neutrally.
**Behavior**:
- GIVEN: a caller wants to send a turn (message + generation settings)
- WHEN: the request is expressed neutrally
- THEN: it is a `ModelGenerationRequest` (`contents: IContent[]` + `settings?: ModelGenerationSettings`) plus `AgentMessageInput` for the raw message — with NO Google-shaped `config` (`GenerateContentConfig`) or `message` (`PartListUnion`) leakage.
**Why This Matters**: `SendMessageParameters` is the second Google-shaped input vector (alongside `PartListUnion`); replacing it with the reused `ModelGenerationRequest` removes Google shape from every turn-send call site.

### REQ-001.4: ModelOutput.afcHistory slot
**Full Text**: `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot so `automaticFunctionCallingHistory` survives synthetic-response removal on BOTH streaming and direct paths with identical slicing/hook-restriction-filter semantics.
**Behavior**:
- GIVEN: a turn produces AFC (automatic-function-calling) history
- WHEN: it is accumulated by the streaming or direct path
- THEN: it rides `ModelOutput.afcHistory` as `IContent[]`, NOT provider metadata
**Why This Matters**: keeps AFC history alive after the synthetic response is deleted, without a Google-shaped provider-metadata detour.

### REQ-001.5: neutral chunk preserves provider metadata
**Full Text**: Neutral chunk conversion preserves response-level provider metadata (`responseId`, provider `providerMetadata` under `gemini.*`) per OQ-16, NOT silently dropped by plain `toModelStreamChunk`.
**Behavior**:
- GIVEN: an `IContent` chunk whose `metadata.providerMetadata` carries provider-specific data (e.g. `gemini.*`) and a `responseId`
- WHEN: it is converted to a neutral `ModelStreamChunk` (via the extended `toModelStreamChunk` / wrapper landed in P05)
- THEN: `ModelOutput.providerMetadata` and `responseId` are populated from `IContent.metadata` — NOT silently dropped
**Why This Matters**: OQ-16 gap — the current `toModelStreamChunk` drops `providerMetadata`, which AFC and downstream consumers depend on; preserving it is what makes the synthetic-response removal lossless.

## Implementation Tasks

### Files to Create
- `packages/core/src/llm-types/agentMessageInput.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P03`, `@requirement:REQ-001.1`
  - Export `type AgentMessageInput` (pseudocode line 10); stub `iContentFromAgentMessageInput`/`iContentFromLegacyInput` returning empty/`{ok:false}` placeholder values of the CORRECT type (NO `NotYetImplemented` string that tests assert on).
  - **Export the neutral block→IContent helper stub `iContentFromBlocks(blocks: ContentBlock[], speaker?: IContent['speaker']): IContent` (pseudocode lines 42-48; REQ-001.2 — C4).** Stub returns a correctly-typed placeholder `IContent` (e.g. `{ speaker: 'ai', blocks: [] }`) with NO behavioral logic. This is the real shared helper the AfterModel hook filtering paths call (P07 streaming, P13 direct) instead of a phantom name; it must exist and compile from this stub phase so P07/P13 can cite `@pseudocode lines 42-48`.
  - Export the turn-request mapping helper stub `sendParamsToRequest(message, settings?)` (pseudocode lines 76-77) returning a correctly-typed `ModelGenerationRequest` placeholder (REQ-001.3). Re-export/confirm `ModelGenerationRequest`/`ModelGenerationSettings` are reachable from the barrel so retype slices can consume the neutral DTO.

### Files to Modify
- `packages/core/src/llm-types/modelEnvelope.ts`
  - Add `afcHistory?: IContent[]` to `ModelOutput` (`modelEnvelope.ts:51-59`, pseudocode line 50). ADD `@plan:PLAN-20260707-AGENTNEUTRAL.P03` / `@requirement:REQ-001.4`.
  - **Neutral naming/docs (Additional Risk 4):** the slot is a NEUTRAL domain concept — "automatic function-calling history as `IContent[]`". The doc comment MUST describe it in provider-agnostic terms (a sequence of neutral `IContent` turns produced by automatic tool invocation), NOT as a Gemini-AFC-specific field. Do NOT reference `@google/genai`, `automaticFunctionCallingHistory` the Google field, `Content[]`, or `gemini.*` in the type or its doc comment — the Gemini→neutral mapping lives in the provider/adapter layer, not on this core neutral type. The name `afcHistory` is an accepted neutral abbreviation (documented in `analysis/domain-model.md` OQ-2/OQ-15); its TYPE is `IContent[]`, never a Google shape.
  - Leave `toModelStreamChunk` unchanged in this stub (extended in P05).
- `packages/core/src/llm-types/index.ts`
  - Export `agentMessageInput.ts` symbols (incl. `AgentMessageInput`, `iContentFromAgentMessageInput`, `iContentFromLegacyInput`, `iContentFromBlocks`, `sendParamsToRequest`).

### Required Code Markers (canonical COLON form — see verification-template.md)
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P03
 * @requirement:REQ-001.1
 * @pseudocode lines 10-27
 */
```
- `iContentFromBlocks` stub → `@plan:PLAN-20260707-AGENTNEUTRAL.P03`, `@requirement:REQ-001.2`, `@pseudocode lines 42-48`.

## Stub rules
- **Neutral-gap stubs MUST return NON-THROWING empty, correctly-typed values (Minor 2 round 8)** — e.g. `iContentFromBlocks` returns `{ speaker: 'ai', blocks: [] }`, `iContentFromLegacyInput` returns `{ ok: false, error: ... }`, `sendParamsToRequest` returns a correctly-typed empty `ModelGenerationRequest` — so P04's RED failures are BEHAVIORAL VALUE MISMATCHES (deep-equal differences), NOT "x is not a function" or thrown `NotYetImplemented`. A stub may throw `new Error('NotYetImplemented')` ONLY if a correctly-typed non-throwing return CANNOT be constructed to compile (rare; document the specific type in the marker if used).
- Tests MUST NOT assert on `NotYetImplemented` or any thrown-stub behavior (no reverse testing — `dev-docs/PLAN.md` forbids it); P04 RED comes from value mismatch against the empty return.
- Max ~80 lines; must compile with strict TS. No `ServiceV2`. No TODO comments.

## Verification Commands
```bash
grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P03" packages/core/src/llm-types | wc -l   # >0
npm run typecheck
if grep -rn "NotYetImplemented" packages/core/src/llm-types/*.test.ts; then echo "FAIL: reverse test asserts NotYetImplemented (no reverse tests permitted in the stub)"; exit 1; fi
```

## Success Criteria
- `AgentMessageInput` type + `afcHistory` slot + the `iContentFromBlocks` stub (REQ-001.2, C4) compile; barrel exports them (incl. `iContentFromBlocks`); no existing test breaks.

## Failure Recovery
- `git checkout -- packages/core/src/llm-types/`

## Phase Completion Marker
Create `project-plans/issue2349/.completed/P03.md`.
