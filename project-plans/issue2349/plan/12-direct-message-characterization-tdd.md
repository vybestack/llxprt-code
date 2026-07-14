# Phase 12: Direct-message characterization — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P12`

## Prerequisites
- Required: Phase 11 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P11" packages/agents/src` (side-channel neutralization landed)
- Expected files from previous phase: `packages/agents/src/core/hookToolRestrictions.ts` (neutralized), `packages/agents/src/core/__tests__/sideChannel.characterization.test.ts` (P10 green).
- Preflight verification: Phase 0.5 completed (check 4 confirmed `_buildBlockingSyntheticResponse` at `:677-701` + the direct-path fabricator; the P12a verifier compares this phase's cited line ranges against the refreshed P0.5 evidence — Minor 2).
- Pseudocode: `analysis/pseudocode/directmessageprocessor-neutral.md` (read for the P13 target; this phase pins CURRENT behavior only).

## Purpose (TRUE characterization — pins OBSERVABLE CURRENT behavior, C1)
Pin the OBSERVABLE non-streaming (`generateDirectMessage`) behavior — the blocking BeforeModel path AND the normal after-model path — as it exists TODAY, BEFORE P13 deletes the two synthetic fabricators. These tests **PASS against current code** and are the safety net that proves P13's dual-fabricator deletion is behavior-preserving.

> **C1 — characterization vs RED separation (READ FIRST).** Today `DirectMessageProcessor.generateDirectMessage` returns `Promise<GenerateContentResponse>` (`DirectMessageProcessor.ts:166-169`; direct-path helpers `:258`/`:401`/`:750`; blocking fabricator `_buildBlockingSyntheticResponse:677-701`). Its behavior is OBSERVABLE TODAY only through that current surface (the `.text` getter, recorded AFC history, usage, hook-filtering effects). A characterization test therefore **pins observable behavior through whatever accessor is current** — it MAY read the current `GenerateContentResponse` (e.g. `result.text`, recorded `HistoryService` state) to capture the golden values. It MUST NOT assert that the return type is `ModelOutput`, nor forbid reading the current shape where that shape is the ONLY way to observe the behavior. The "returns `ModelOutput` / no synthetic response / neutral content type" TYPE-SURFACE assertions belong to **P13 (impl)** / **P13a (verification)**, where they go green AFTER the flip — NOT here.

## Requirements Implemented (Expanded)

### REQ-INT-001.3: Direct-path observable behavior preserved (characterization)
**Full Text**: The direct-message path's observable outputs (visible response text, usage/token accounting incl. reasoning tokens when the provider supplied thoughts, AFC recorded into `HistoryService`, before/after-model hook decision + filtering effects) are pinned as a behavioral safety net so the P13 neutralization (delete `_buildBlockingSyntheticResponse` + the after-model `convertIContentToResponse` fabrication) provably does not change them.
**Behavior**:
- GIVEN a blocking BeforeModel hook; WHEN `generateDirectMessage` runs; THEN the returned value's VISIBLE TEXT (read via the current `.text` accessor) equals the hook's effective block reason, and a downstream consumer observes the block.
- GIVEN a normal completion; WHEN it resolves; THEN the returned value's visible text is the model's text, usage is populated (incl. `reasoningTokens` when thoughts were supplied, OQ-14), and provider AFC (`automaticFunctionCallingHistory`) is recorded into `HistoryService` filtered by hook restrictions (BR-8).
- GIVEN an after-model hook that filters content; WHEN it runs; THEN the filtering effect is reflected in the observable returned text/history.
**Why This Matters**: this is the SAFETY NET that lets P13 delete both direct-path fabricators without regressing the direct path — it characterizes today's behavior, it does not pre-assert the P13 target type.

## Phase-local OBSERVER HELPER (Major 4 — the ONLY sanctioned way to read current output)
To prevent a coordinator from indexing `candidates`/`.parts`/`usageMetadata` and accidentally locking in Google internals, this phase defines a SMALL phase-local observer helper that exposes ONLY observable values, and the characterization tests read the current output THROUGH IT (never by direct indexing).

### File to Create
- `packages/agents/src/core/__tests__/helpers/directMessageObservers.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P12`, `@requirement:REQ-INT-001.3`
  - Export ONLY these observer functions (each takes the current result / the real `HistoryService` and returns a neutral observable — NO candidate/part indexing leaks to the test):
    - `visibleText(result): string` — the model's visible text via the current `.text` accessor ONLY (the helper is the single place the current getter is touched; if P13 flips the type, ONLY this helper changes, not the tests).
    - `committedHistory(historyService): IContent[]` — a deep clone of the committed neutral `HistoryService` state (already `IContent`-based today).
    - `usageCounts(result): { promptTokens?; completionTokens?; totalTokens?; reasoningTokens? }` — neutral usage numbers mapped to NEUTRAL names (never `promptTokenCount`/`candidatesTokenCount` keys exposed to the test).
    - `eventSequence(events): string[]` — the public `ServerAgentStreamEvent` `type` sequence.
  - The helper MUST NOT export anything that returns a `candidate`, a `parts` array, a `usageMetadata` object, or a `Contract*` value. It is the boundary that keeps the tests observable-only.

## Implementation Tasks (test-writing; behavioral; safety net for P13)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/directMessage.characterization.test.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P12`, `@requirement:REQ-INT-001.3`
  - The test file reads current output ONLY through `directMessageObservers.ts` (`visibleText`/`committedHistory`/`usageCounts`/`eventSequence`); it MUST NOT index `.candidates`, `.parts`, `.content.parts`, or `.usageMetadata` directly.

### Assertions (OBSERVABLE through the CURRENT surface — these PASS today)
- **Blocking BeforeModel** → the returned result's VISIBLE TEXT (via the current `.text` accessor) === the hook's effective block reason; a downstream consumer sees the blocked outcome. (Read `result.text`; do NOT hard-code that the type is `GenerateContentResponse` OR `ModelOutput` — assert the observable TEXT VALUE only.)
- **Normal path** → the returned result's visible text is the model's text; usage is populated incl. `reasoningTokens` when the provider supplied thoughts (OQ-14).
- **AFC (BR-8)** → provider `automaticFunctionCallingHistory` is recorded (filtered by hook restrictions) into `HistoryService`; assert the COMMITTED neutral `HistoryService` state (which is already `IContent`-based today), NOT the response envelope.
- **After-model hook** → the hook's filtering is reflected in the observable returned text / committed history.
- **PROPERTY**: for ANY blocking reason string, the returned result's visible text === that reason.

## Forbidden (C1 — characterization discipline)
- Do NOT assert the RETURN TYPE is `ModelOutput` (that is the P13 target; asserting it here would fail against current code). That type-surface assertion lives in P13a.
- Do NOT assert internal Google STRUCTURE as the behavior under test (do not assert on `{candidates}` array shape, `candidate.content.parts` array indices, or `.parts` mutation) — assert the OBSERVABLE VALUES (visible text via `.text`, committed `HistoryService` `IContent`, usage numbers). Reading `result.text` to capture the golden text is REQUIRED and allowed; asserting the `{candidates}[0].content.parts[0]` shape is NOT (it is exactly what P13 deletes).
- NO mock theater / reverse testing; mock ONLY the provider `AsyncIterable<IContent>`; the rest is the REAL `DirectMessageProcessor`/`HistoryService`.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/directMessage.characterization.test.ts   # PASS against current code
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/core/__tests__/directMessage.characterization.test.ts   # aggregate >=30%

# ---- MAJOR 4: the NEW characterization TEST must not index Google internals directly ----
# Scoped to THIS phase's new test file ONLY (the observer helper is the single sanctioned reader).
# Any direct candidate/parts/usageMetadata indexing in the TEST is a FAIL (it belongs behind the helper):
grep -nE "\.candidates\b|\.parts\b|\.content\.parts|\.usageMetadata\b|candidates\s*\[|parts\s*\[" \
  packages/agents/src/core/__tests__/directMessage.characterization.test.ts && echo "FAIL: test indexes Google internals — route through directMessageObservers.ts" || echo "OK: no direct Google-internal indexing in the characterization test"
# The test reads output only through the observer helper:
grep -nE "visibleText|committedHistory|usageCounts|eventSequence" packages/agents/src/core/__tests__/directMessage.characterization.test.ts   # present (reads via helper)
```

## Success Criteria
- Both blocking and normal paths covered by OBSERVABLE assertions (visible text via the current `.text` accessor, committed `HistoryService` `IContent` state, usage) — never the future `ModelOutput` type nor internal `{candidates}`/`.parts` structure.
- **Major 4:** the characterization test reads current output ONLY through the `directMessageObservers.ts` helper; the grep proves the test file does NOT index `.candidates`/`.parts`/`.content.parts`/`.usageMetadata` directly; the helper exposes only neutral observables (visibleText/committedHistory/usageCounts/eventSequence).
- OQ-14 reasoningTokens on the direct path + BR-8 AFC (committed history) covered; ≥30% property-based; tests **PASS against current code** (safety net for P13).

## Failure Recovery
1. If a test asserts the return TYPE is `ModelOutput`: move that assertion to P13/P13a — it cannot pass against current code. Re-author here to assert the observable TEXT/usage/history VALUE only.
2. If a test asserts internal `{candidates}[i].content.parts[j]` STRUCTURE as the behavior: rewrite to observable behavior (visible `.text`, committed `IContent`). (Reading `result.text` for the golden value is allowed.)
3. If a test does not pass against current code: fix it to reflect ACTUAL current behavior (this is the safety net for P13).
4. `git checkout --` the test file and re-author. Cannot proceed to Phase 13 until green + behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P12.md`.
