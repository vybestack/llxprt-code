# Phase 26a: Remaining group TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P26a`

## Prerequisites
- Required: Phase 26 completed.

## Requirements Implemented (Expanded)
Verifies the safety-net tests for **REQ-005.5c** (compression enforcement, agenticLoop cancelled-tool history, API session control, TodoContinuation, chatSession facade) pin OBSERVABLE behavior and PASS against current code.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.5c (remaining-group safety net)** — **GIVEN:** the P26 safety-net tests + CURRENT code; **WHEN:** the verifier runs the compression-enforcement / agenticLoop cancelled-tool-history / API session-control / TodoContinuation / chatSession-facade tests; **THEN:** each pins OBSERVABLE behavior and PASSES against current code, asserting outcomes NOT `{role,parts}`/`.parts` structure; FAIL if a test asserts structure or a future neutral type, or fails against current code.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] The FIVE characterization test files exist with correct markers (compression, agenticLoop, apiSessionControl, todoContinuation, AND `chatSessionFacade.characterization.test.ts` — Critical 2 round 8).
- [ ] agenticLoop cancelled-tool assertions verify tool-call↔response pairing via neutral history, NOT `{role,parts}`.
- [ ] Compression decision/summary boundary characterized; API session-control round-trip characterized; TodoContinuation condition+content characterized; chatSession facade `sendMessageStream(AgentMessageInput)` event sequence characterized OBSERVABLY (NOT via `getHistory` return type / `{role,parts}` internals; `getHistory` returns `Content[]` until P21).
- [ ] Provider stream is the ONLY mock; ≥30% property-based computed as the AGGREGATE across ALL FIVE files; tests PASS against current code.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net covers the diverse remaining subsystems before the final zero-imports retype in P27. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P26a.md`.
