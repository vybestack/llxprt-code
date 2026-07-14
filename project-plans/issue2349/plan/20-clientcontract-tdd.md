# Phase 20: clientContract cross-package — characterization TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P20`

## Prerequisites
- Required: Phase 19 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P19" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/api/eventAdapter.ts` (usage-metadata boundary per the OQ-2u option), `packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts` (P18 green).
- Preflight verification: Phase 0.5 completed (check 5 confirmed `clientContract.ts` is Google-shaped: `ContractPart`/`ContractContent`/`ContractGenerateContentResponse`/`ContractSendMessageParameters` at `:63-123`; surface members typed in them at `:127-201`). The P20a verifier compares this phase's cited line ranges against the refreshed P0.5 evidence (Minor 2).
- Pseudocode: `analysis/pseudocode/clientcontract-neutralization.md` — CHARACTERIZATION-ONLY phase: writes NO production code and implements NO pseudocode lines. Read for the P21 target only; this phase pins CURRENT observable behavior. The concrete `@pseudocode lines X-Y` citations live in P21, not here.

## Purpose (TRUE characterization — pins OBSERVABLE CURRENT behavior, C2)
Pin the OBSERVABLE behavior of the client-surface contract (history round-trip incl. defensive clone + idle-wait, direct-message observable output, `sendMessageStream` event SEQUENCE) as it exists TODAY, BEFORE P21 atomically deletes the Google-shaped `Contract*` payload types and retypes the 23 CLI + 5 core consumers. These tests **PASS against current code** and are the safety net for the P21 atomic cross-package flip.

> **C2 — characterization vs RED separation (READ FIRST).** Today `packages/core/src/core/clientContract.ts` is Google-shaped: `AgentChatContract.sendMessageStream` takes `ContractSendMessageParameters` and history is `ContractContent[]` (`clientContract.ts:127-133`); `AgentClientContract.generateDirectMessage` returns `Promise<ContractGenerateContentResponse>` (`:173-175`); `generateContent` returns `Promise<ContractGenerateContentResponse>` (`:184-188`); `AgentClientContract.sendMessageStream` takes `ContractPartListUnion` (`:194-201`). A characterization test therefore pins observable behavior through the EXISTING surface — it MAY read the current `Contract*`-typed return values to capture golden observable values. It MUST NOT assert that `generateDirectMessage` returns `ModelOutput` or that `sendMessageStream` takes `AgentMessageInput` — those are the P21 target types and would NOT compile/pass against current code. The `ModelOutput`/`AgentMessageInput` TYPE-SURFACE assertions belong to **P21 (impl)** / **P21a (verification)**, where they go green AFTER the atomic contract flip.

## Requirements Implemented (Expanded)

### REQ-INT-001.2 (+ history-neutrality characterization): client-surface observable behavior preserved
**Full Text**: The client-surface contract's observable behavior (history round-trip with defensive clone + idle-wait when the chat is live; direct-message observable output; `sendMessageStream` `ServerAgentStreamEvent` SEQUENCE; public `StreamEvent`/`ServerAgentStreamEvent` shapes) is pinned as a behavioral safety net so the P21 atomic flip (delete `Contract*` payload types; retype the surface + all 28 consumers) provably preserves it.
**Behavior**:
- GIVEN a history set via `setHistory(...)` then read via `getHistory()`; WHEN read; THEN the returned history is EQUIVALENT content but a CLONE (mutating it does not mutate the live history), and `getHistory()` awaits idle when the chat is live.
- GIVEN a direct message; WHEN `generateDirectMessage` resolves; THEN the observable visible text/usage equals today's (read via the current accessor).
- GIVEN `sendMessageStream(...)`; WHEN a scripted provider stream runs; THEN the emitted `ServerAgentStreamEvent` SEQUENCE is identical to today.
**Why This Matters**: this is the SAFETY NET for the largest atomic phase (P21); it characterizes today's observable surface, it does NOT pre-assert the P21 neutral types.

## Phase-local OBSERVER HELPER (Major 4 — the ONLY sanctioned way to read current Contract*-typed output)
Because the current surface returns `Contract*` values (which expose `candidates`/`content`/`parts`/`usageMetadata`), this phase defines a small phase-local observer helper so the characterization tests read the golden observables THROUGH IT and never index the `Contract*` payload internals.

### File to Create
- `packages/agents/src/api/__tests__/helpers/clientContractObservers.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P20`, `@requirement:REQ-INT-001.2`
  - Export ONLY these observer functions:
    - `visibleText(directResult): string` — visible text via the current accessor ONLY (single place the current getter is touched; if P21 flips to `ModelOutput`, ONLY this helper changes).
    - `historyContent(historyResult): IContent[]` — the observable history as neutral `IContent[]` (deep clone), used to assert content-equivalence AND clone-independence without exposing `Contract*`/`.parts`.
    - `usageCounts(directResult): { promptTokens?; completionTokens?; totalTokens?; reasoningTokens? }` — neutral usage names only.
    - `eventSequence(events): string[]` — the public `ServerAgentStreamEvent` `type` sequence.
  - The helper MUST NOT export anything returning a `Contract*` value, a `candidate`, a `parts` array, or a `usageMetadata` object.

## Implementation Tasks (test-writing; behavioral; safety net for P21)

### Files to Create/Confirm
- `packages/agents/src/api/__tests__/clientContract.characterization.spec.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P20`, `@requirement:REQ-INT-001.2`
  - The spec reads current output ONLY through `clientContractObservers.ts`; it MUST NOT index `.candidates`, `.parts`, `.content.parts`, or `.usageMetadata` on any `Contract*` value directly.
  - **history round-trip**: `setHistory(...)` then `getHistory()` returns EQUIVALENT history that is a CLONE, not a live reference (mutating the result does not mutate the source).
  - **idle-wait**: `getHistory()` awaits idle when the chat is live (behavior preserved).
  - **direct message**: `generateDirectMessage(...)` resolves with the expected observable visible text/usage (read via the current accessor — do NOT assert the return TYPE).
  - **stream sequence**: `sendMessageStream(...)` emits the same `ServerAgentStreamEvent` SEQUENCE as today for a scripted provider stream.
  - CLI consumer compile-check tests where representative: e.g. `historyExportUtils` exports the observable history content; `atCommandProcessor` builds an input the surface accepts. (Assert observable OUTPUT, not the input TYPE name.)
  - **PROPERTY**: history round-trip preserves block order/content for ANY history (assert content equivalence + clone-independence, not the type name).

## Forbidden (C2 — characterization discipline)
- Do NOT assert `generateDirectMessage` returns `ModelOutput` or that `sendMessageStream` takes `AgentMessageInput` (those are P21 target types; asserting them here fails against current code). Those type-surface assertions live in P21a.
- Do NOT assert `Contract*` payload-type INTERNALS as the behavior under test (e.g. do not assert on `ContractGenerateContentResponse.candidates[0].content.parts` shape) — assert observable values (visible text, cloned history content equivalence, emitted event sequence). Reading a current `Contract*`-typed value to capture the golden observable is allowed; asserting its Google STRUCTURE is not.
- NO mock theater / reverse testing; mock ONLY the provider `AsyncIterable<IContent>`; the rest is the REAL client/chat/`HistoryService`.

## Verification Commands
```bash
npm test -- packages/agents/src/api/__tests__/clientContract.characterization.spec.ts   # PASS against current code (behavioral)
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/api/__tests__/clientContract.characterization.spec.ts   # aggregate >=30%

# ---- MAJOR 4: the NEW characterization SPEC must not index Contract*/Google internals directly ----
# Scoped to THIS phase's new spec file ONLY (the observer helper is the single sanctioned reader):
grep -nE "\.candidates\b|\.parts\b|\.content\.parts|\.usageMetadata\b|candidates\s*\[|parts\s*\[" \
  packages/agents/src/api/__tests__/clientContract.characterization.spec.ts && echo "FAIL: spec indexes Contract*/Google internals — route through clientContractObservers.ts" || echo "OK: no direct Contract*/Google-internal indexing in the characterization spec"
grep -nE "visibleText|historyContent|usageCounts|eventSequence" packages/agents/src/api/__tests__/clientContract.characterization.spec.ts   # present (reads via helper)
```

## Success Criteria
- Surface behavior (history round-trip incl. defensive clone + idle-wait, direct-message observable output, `sendMessageStream` event SEQUENCE) covered by OBSERVABLE assertions — never the future `ModelOutput`/`AgentMessageInput` types, never `Contract*` internals.
- **Major 4:** the characterization spec reads current output ONLY through `clientContractObservers.ts`; the grep proves the spec does NOT index `.candidates`/`.parts`/`.content.parts`/`.usageMetadata` directly.
- ≥30% property-based; tests **PASS against current code** (safety net for the P21 atomic flip).

## Failure Recovery
1. If a test asserts `generateDirectMessage` returns `ModelOutput` or `sendMessageStream` takes `AgentMessageInput`: move that assertion to P21/P21a — it cannot pass against current code. Re-author here to assert observable surface behavior.
2. If a test asserts a `Contract*` payload-type internal: rewrite to observable surface behavior (cloned history content equivalence / visible text / emitted event sequence).
3. If a test does not pass against current code: fix it to reflect ACTUAL behavior.
4. `git checkout --` the test file and re-author. Cannot proceed to Phase 21 until green + behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P20.md`.
