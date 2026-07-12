# Phase 22a: Subagent slice TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P22a`

## Prerequisites
- Required: Phase 22 completed.

## Requirements Implemented (Expanded)
Verifies the RED/safety-net tests for **REQ-005.5a** (subagent run, tool-response feed, nudges, non-interactive run) pin OBSERVABLE behavior and PASS against current code.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.5a (subagent safety net)** — **GIVEN:** the P22 safety-net tests + CURRENT code; **WHEN:** the verifier runs the subagent run / tool-response feed / nudge / non-interactive-run tests; **THEN:** each pins OBSERVABLE behavior (emitted turns, tool-response feed, nudge text, non-interactive result) and PASSES against current code, asserting outcomes NOT `.parts`/`{role,parts}` structure; FAIL if a test asserts structure or a future neutral type, or fails against current code.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] `subagentRun.characterization.test.ts` exists with `@plan:PLAN-20260707-AGENTNEUTRAL.P22` + `@requirement:REQ-005.5a`.
- [ ] Assertions are on emitted events / neutral history / tool invocations — NOT `{role,parts}`/`.parts`/`Content`.
- [ ] Provider stream is the ONLY mock; no mock theater / reverse testing.
- [ ] ≥30% property-based; tests PASS against current code (paste output).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net will catch a behavior change when the subagent group is retyped in P23. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P22a.md`.
