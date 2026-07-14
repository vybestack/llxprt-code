# Phase 24a: Executor slice TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P24a`

## Prerequisites
- Required: Phase 24 completed.

## Requirements Implemented (Expanded)
Verifies the safety-net tests for **REQ-005.5b** (executor initial message, template application, tool-response feed, recovery nudge) pin OBSERVABLE behavior — especially template application through the raw-import-free `.parts` mutator.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.5b (executor safety net incl. raw-import-free `.parts` mutator)** — **GIVEN:** the P24 safety-net tests + CURRENT code; **WHEN:** the verifier runs the executor initial-message / template-application / tool-response-feed / recovery-nudge tests; **THEN:** each pins OBSERVABLE behavior — ESPECIALLY template application through the raw-import-free `.parts` mutator (`executor-prompt-builder.ts`) asserted by output, not `.parts` structure — and PASSES against current code; FAIL if a test asserts `.parts` structure or a future neutral type, or fails against current code.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] `executorRun.characterization.test.ts` exists with correct markers.
- [ ] Template-application assertions are on substituted message CONTENT, not `.parts`.
- [ ] Provider stream is the ONLY mock; no mock theater / reverse testing.
- [ ] ≥30% property-based; tests PASS against current code.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net will catch a behavior change when `executor-prompt-builder.ts` and the executor group are retyped in P25 (the #2424 raw-import-free case). Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P24a.md`.
