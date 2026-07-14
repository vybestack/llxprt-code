# Phase 10: Side-channel characterization — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P10`

## Prerequisites
- Required: Phase 09 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P09" packages/agents/src`
- Expected files from previous phase: `MessageConverter.ts` (survivors retyped neutral; `convertIContentToResponse` chain KEPT until P13).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `hooktoolrestrictions-neutral.md` — CHARACTERIZATION-ONLY phase: writes NO production code and implements NO pseudocode lines. It pins the observable #2329 stop-reason + hook tool-restriction behavior that the P11 impl (which carries the concrete `@pseudocode lines X-Y` citations from this file) must preserve. Read here as the behavior catalog, not a line map to implement.

## Purpose
Pin observable behavior that the two side-channels currently carry (#2329 raw stop reason; hook tool-restriction filtering) BEFORE deleting the WeakMap/Symbol/Candidate-field mechanisms.

## Requirements Implemented (Expanded)

### REQ-003.1: providerStopReason retired
**Full Text**: `providerStopReason.ts` is retired (end-state: FILE DELETED — WRITER removed P13, FILE deleted P25 co-located with `streamChunkWrapper.ts`, C2); raw provider stop reason flows via `IContent.metadata.stopReason` → `ModelStreamChunk.rawStopReason` → `Finished.stopReason`. #2329 refusal behavior preserved. (This is a characterization phase — it PINS the observable stop-reason behavior BEFORE the mechanism is removed; it deletes nothing.)
**Behavior**:
- GIVEN: a provider signals a raw stop reason (e.g. Anthropic `refusal`/`end_turn`)
- WHEN: the turn finishes
- THEN: `Finished.stopReason` reflects it — with NO bolted-on `Candidate.providerStopReason`.

### REQ-003.2: hookToolRestrictions neutralized
**Full Text**: No `WeakMap`/`Symbol` identity keying; restriction metadata rides `ModelStreamChunk.hookRestrictions`; filtering operates on `ContentBlock[]`/`ToolCallBlock`.
**Behavior**:
- GIVEN: a before-tool-selection hook restricts allowed tools
- WHEN: the model emits tool calls
- THEN: restricted `ToolCallRequest`s are filtered out of emitted events + AFC, and `hadFilteredRestrictedCalls` is observable.

## Implementation Tasks (test-writing; behavioral; safety net for P11)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/sideChannel.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P10`, `@requirement:REQ-003.1/.2`
- **Hook JSON wire GOLDEN fixture (Additional Risk 2 / RISK-2):** `packages/agents/src/core/__tests__/hookWire.golden.test.ts` with committed golden JSON fixtures under `packages/agents/src/core/__tests__/fixtures/hookWire/` — one file EACH for `beforeModel.request.golden.json`, `afterModel.response.golden.json`, `beforeToolSelection.golden.json`. `@plan:PLAN-20260707-AGENTNEUTRAL.P10`, `@requirement:REQ-INT-001` (hook wire byte-shape unchanged).

### Assertions (observable)
- Raw stop reason (`refusal`/`end_turn`/custom) surfaces on `Finished.stopReason` (mirror `chatSession.directRefusal.issue2329` behavior) — assert the event, not the mechanism.
- Hook restriction: a restricted tool call is NOT emitted as a `ToolCallRequest` and NOT recorded in AFC/history; an allowed one IS. `hadFilteredRestrictedCalls` reflected in behavior.
- **Hook wire byte-shape (RISK-2):** serialize the before-model hook payload (`llm_request.messages`, `{role,parts}` per OQ-1a), the after-model payload, and the before-tool-selection payload, and assert each equals its committed golden JSON byte-for-byte (`JSON.stringify` deep-equal against the fixture). This is the SINGLE named golden that P11/P13/P25 must keep green so the G3 adapter (`streamRequestHelpers.ts:226-249`) can never drift the published wire semantics.
- PROPERTY: for ANY allowed-tools set, emitted tool calls ⊆ allowed set.
- PROPERTY: for ANY raw stop-reason string, `Finished.stopReason` equals it (round-trip fidelity).

## Forbidden
- NO assertions on WeakMap/Symbol/`providerStopReason` internals (those are being deleted).

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/sideChannel.characterization.test.ts   # PASS against current code
npm test -- packages/agents/src/core/__tests__/hookWire.golden.test.ts               # PASS: wire byte-shape captured (RISK-2 golden)
test -f packages/agents/src/core/__tests__/fixtures/hookWire/beforeModel.request.golden.json
test -f packages/agents/src/core/__tests__/fixtures/hookWire/afterModel.response.golden.json
test -f packages/agents/src/core/__tests__/fixtures/hookWire/beforeToolSelection.golden.json
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/core/__tests__/sideChannel.characterization.test.ts packages/agents/src/core/__tests__/hookWire.golden.test.ts   # aggregate >=30%
```

## Success Criteria
- Tests PASS against current code and assert ONLY observable behavior (`Finished.stopReason`; which `ToolCallRequest`s emit; AFC/history contents) — never WeakMap/Symbol/`providerStopReason` internals.
- The named hook-wire golden fixtures exist and `hookWire.golden.test.ts` pins the before-model/after-model/before-tool-selection JSON byte-shape (RISK-2), so G3 cannot drift semantically.
- #2329 refusal + hook-restriction filtering each covered; ≥30% property-based (aggregate over BOTH test files).

## Failure Recovery
1. If a test asserts a side-channel internal (WeakMap/Symbol/`providerStopReason`): rewrite to observable behavior — those mechanisms are being deleted in P11/P13.
2. If a test does not pass against current code: fix it to reflect ACTUAL behavior (safety net for P11).
3. `git checkout --` the test file and re-author. Cannot proceed to Phase 11 until green + behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P10.md`.
