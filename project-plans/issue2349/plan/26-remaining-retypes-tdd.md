# Phase 26: Remaining group (compression / agenticLoop / api / misc) — characterization TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P26`

## Prerequisites
- Required: Phase 25 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P25" packages/agents/src`
- Expected files from previous phase: `executor*.ts` retyped neutral incl. `executor-prompt-builder` raw-import-free `.parts` mutator (OQ-12); AST `--count` strictly decreased vs P23.
- Preflight verification: Phase 0.5 completed.

## Purpose
Third/final retype slice. Pin OBSERVABLE behavior of the remaining production importers BEFORE retyping, so the last sweep to ZERO `@google/genai` imports is behavior-safe. Covers: `compression/*` (CompressionHandler, compressionBudgeting, providerContentEnforcement), `core/agenticLoop/*` (AgenticLoop, loopHelpers, types), `api/*` (agent, agentBootstrap, control/sessionControl), `TodoContinuationService.ts`, `chatSession.ts`, `ChatSessionFactory.ts`, `clientToolGovernance.ts`, `streamCleanup.ts`, `turnAbortHelpers.ts`, plus residual `MessageStreamOrchestrator.ts`/`MessageStreamTerminalHandler.ts`/`streamRequestHelpers.ts`.

## Requirements Implemented (Expanded)

### REQ-005.5c: Remaining group behavior characterized (pre-retype)
**Full Text**: The remaining RETYPE production files are migrated to neutral types with behavior unchanged and zero `@google/genai` imports, eliminating the residual §2A.4 surface: compression config (`GenerateContentConfig`→`ModelGenerationSettings`), agenticLoop `PartListUnion`/`Part` (incl. `loopHelpers.recordCancelledToolHistory:110-117` `addHistory({role,parts})`), public API input (`api/agent.ts`, `agentBootstrap.ts` `PartListUnion`→`AgentMessageInput`), session-control history (`sessionControl.ts` `Content`→`IContent`), TodoContinuation (`PartListUnion`/`Part`), chatSession facade, tool-governance declarations (`FunctionDeclaration`→`ToolDeclaration`), stream cleanup (`GenerateContentResponse`→`ModelStreamChunk`), abort helpers (`SendMessageParameters`→neutral request DTO).
**Behavior**:
- GIVEN: each subsystem's public behavior (compression enforcement, agenticLoop cancelled-tool history, public API session control, TodoContinuation post-turn action, chatSession facade stream)
- WHEN: executed
- THEN: observable results are identical whether the internal currency is Gemini-shaped or neutral.
**Why This Matters**: this is the slice that reaches ZERO prod imports; characterizing the diverse subsystems first prevents a final bulk source-swap from breaking compression/agenticLoop/api semantics.

## Implementation Tasks (test-writing; behavioral; safety net for P27)

### Files to Create/Confirm (FIVE files — chatSession facade included, Critical 2 round 8)
- `packages/agents/src/compression/__tests__/compression.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P26`, `@requirement:REQ-005.5c`
- `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.characterization.test.ts` — `@requirement:REQ-005.5c`
- `packages/agents/src/api/__tests__/apiSessionControl.characterization.test.ts` — `@requirement:REQ-005.5c`
- `packages/agents/src/core/__tests__/todoContinuation.characterization.test.ts` — `@requirement:REQ-005.5c`
- `packages/agents/src/core/__tests__/chatSessionFacade.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P26`, `@requirement:REQ-005.5c`. P26 is the slice that migrates `chatSession.ts` (`@google/genai` importer #18) to zero imports, so its facade MUST be characterized here. Assert OBSERVABLE behavior through the PUBLIC facade: `sendMessageStream(AgentMessageInput)` emits the same `ServerAgentStreamEvent` sequence, and history behavior is observed via emitted events / observable projection — NOT via the `getHistory` return type (per Major-3-round-3, `chatSession.getHistory` returns `Content[]` until P21 flips the contract; `chatSession.ts:502`), and NOT via `Content[]`/`{role,parts}` internals.

### Assertions (observable)
- Compression: given a history over the token budget, provider-content enforcement + budgeting produce the same compression decision/summary boundary as today (`providerContentEnforcement`/`compressionBudgeting`).
- agenticLoop cancelled-tool history (`loopHelpers.recordCancelledToolHistory`): when a tool call is cancelled, history records the cancelled tool-call + synthetic tool-response as observable neutral content (assert via history projection, NOT `{role,parts}`).
- API session control (`sessionControl.ts:218,:314`): setting/getting session history round-trips the same observable content.
- TodoContinuation: post-turn continuation action fires with the same nudge content on the same condition.
- chatSession facade (`chatSession.ts:464 sendMessageStream`): `sendMessageStream(AgentMessageInput)` emits the same `ServerAgentStreamEvent` sequence (type ordering + terminal `Finished`), and history after the turn is observed via the emitted events / observable projection — asserted OBSERVABLY through the PUBLIC facade, NOT via the `getHistory` return type (`Content[]` until P21, `chatSession.ts:502`) and NOT via `{role,parts}`/`.parts` internals.
- PROPERTY: agenticLoop cancelled-tool recording preserves tool-call id ↔ response pairing for ANY cancelled call set.
- PROPERTY (chatSession facade): for ANY provider stream (text-only, tool-call, thinking, refusal), the facade's emitted `ServerAgentStreamEvent` type-sequence is identical whether the internal currency is Gemini-shaped or neutral (observable ordering invariant).

## Forbidden
- NO assertions on `{role,parts}`/`.parts`/`Content`/`GenerateContentConfig` internals.
- Mock ONLY the provider stream.

## Verification Commands
```bash
npm test -- packages/agents/src/compression packages/agents/src/core/agenticLoop packages/agents/src/api/__tests__/apiSessionControl.characterization.test.ts packages/agents/src/core/__tests__/todoContinuation.characterization.test.ts packages/agents/src/core/__tests__/chatSessionFacade.characterization.test.ts   # PASS against current code

# Property ratio computed over ALL test files THIS phase creates (C4) — the AGGREGATE across all FIVE,
# via the reusable prop_ratio helper (verification-template.md §7). NOT a single-file count.
prop_ratio \
  packages/agents/src/compression/__tests__/compression.characterization.test.ts \
  packages/agents/src/core/agenticLoop/__tests__/agenticLoop.characterization.test.ts \
  packages/agents/src/api/__tests__/apiSessionControl.characterization.test.ts \
  packages/agents/src/core/__tests__/todoContinuation.characterization.test.ts \
  packages/agents/src/core/__tests__/chatSessionFacade.characterization.test.ts
```

## Success Criteria
- Compression / agenticLoop / api session-control / TodoContinuation / chatSession facade behavior pinned; PASS against current code; ≥30% property-based computed as the AGGREGATE across ALL FIVE test files this phase creates (via `prop_ratio`), NOT a single-file count (C4).

## Failure Recovery
1. `git checkout --` the five new test files.
2. Re-author behaviorally.
3. Cannot proceed to Phase 27 until the safety net is green and behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P26.md`.
