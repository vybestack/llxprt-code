# Phase 20a: clientContract characterization TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P20a`

## Prerequisites
- Required: Phase 20 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P20" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/api/__tests__/clientContract.characterization.spec.ts`.
- Preflight verification: Phase 0.5 completed.

Follow `plan/verification-template.md`. Specifics:

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)

**REQ-INT-001.2 — history round-trip is a CLONE (not a live ref) + idle-wait when the chat is live:**
- **GIVEN:** the P20 `clientContract.characterization.spec.ts` running against CURRENT (Google-shaped) code, with a populated history and a live chat.
- **WHEN:** the verifier reads the history-round-trip test and traces `getHistory()` input→output.
- **THEN:** the test asserts the returned history is an INDEPENDENT clone (mutating it does not mutate internal history) AND that `getHistory()` awaits idle when the chat is live — asserted via OBSERVABLE behavior, NOT `Contract*`/`{candidates}`/`.parts` structure; the test PASSES against current code.

**REQ-INT-001.2 — direct-message observable visible text/usage:**
- **GIVEN:** the P20 direct-message characterization test against current code.
- **WHEN:** a non-streaming send is characterized.
- **THEN:** it asserts the OBSERVABLE visible text + usage through the current surface, and does NOT assert the P21 target type (`generateDirectMessage`→`ModelOutput`); the test PASSES against current code.

**REQ-INT-001.2 — `sendMessageStream` event SEQUENCE:**
- **GIVEN:** the P20 stream characterization test against current code.
- **WHEN:** `sendMessageStream` is driven.
- **THEN:** it asserts the observable EVENT SEQUENCE (ordering/kinds), NOT `AgentMessageInput`/`ModelOutput` type surface and NOT `Contract*` internals; the test PASSES against current code.

## Requirements Implemented (Expanded)
Confirms the P20 characterization pins **REQ-INT-001.2** OBSERVABLE client-surface behavior — history round-trip (a CLONE, not a live ref; idle-wait when the chat is live), direct-message observable visible text/usage, and `sendMessageStream` event SEQUENCE — against CURRENT code, asserting behavior NOT `Contract*` internals; a valid safety net for the P21 atomic contract flip.

**C2 discipline (verify explicitly):** the P20 tests MUST characterize behavior through the CURRENT Google-shaped surface and MUST NOT assert the future neutral types (`generateDirectMessage`→`ModelOutput`; `sendMessageStream(AgentMessageInput)`) — those assertions live in P21a and would NOT pass against current code. The verifier FAILS the phase if a P20 test asserts a P21 target type OR asserts `Contract*`/`{candidates}`/`.parts` STRUCTURE as the behavior under test.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling TDD tests, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/property-ratio detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Surface behavior (history round-trip incl. CLONE-independence + idle-wait, direct-message observable visible text/usage, stream event SEQUENCE) covered by observable assertions — NOT the future `ModelOutput`/`AgentMessageInput` types, NOT `Contract*` internals.
- [ ] The tests **PASS against current code** — a test that only passes after P21 is MISPLACED and FAILS this gate.
- [ ] Property ratio ≥30% (paste the `prop_ratio` aggregate line).
- [ ] No `ModelOutput`/`AgentMessageInput` type-surface assertion present in the P20 tests (those belong to P21a).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ-INT-001.2 behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. If a test asserts a P21 target neutral type, it is misplaced — move it to P21a. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net catches a behavior change when the contract flips to neutral, and that it does so WITHOUT pre-asserting the P21 neutral types. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P20a.md`.
