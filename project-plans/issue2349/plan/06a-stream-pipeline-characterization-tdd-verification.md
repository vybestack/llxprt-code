# Phase 06a: Stream-pipeline characterization TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P06a`

## Prerequisites
- Required: Phase 06 completed.

Follow `plan/verification-template.md`. Characterization-phase specifics:

## Requirements Implemented (Expanded)
Confirms the P06 characterization pins REQ-002.1/.2/.3 OBSERVABLE stream behavior (emitted `ServerAgentStreamEvent` sequence, committed history, retry/finish/stop reasons) against CURRENT code — never `GenerateContentResponse`/`{candidates}`/`.parts` — so it is a valid safety net for the P07-P09 synthetic-round-trip removal.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-002.1/.2/.3 (observable safety net)** — **GIVEN:** the P06 characterization test file + CURRENT (pre-migration) code; **WHEN:** the verifier runs the suite and reads each assertion; **THEN:** every test PASSES against current code and asserts OBSERVABLE outputs (emitted `ServerAgentStreamEvent` order, committed `HistoryService` state, retry/finish/stop reasons) — NOT `GenerateContentResponse`/`{candidates}`/`.parts` internals; FAIL if any test asserts structural internals or asserts a future neutral type (would not pass against current code).

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Tests assert OBSERVABLE behavior (emitted events, committed history, retry/refusal/usage) — NOT `{candidates}`/`.parts`.
- [ ] Only the provider `AsyncIterable<IContent>` is mocked; `StreamProcessor`/`TurnProcessor`/`Turn`/`HistoryService` are REAL.
- [ ] BR-1 (commit-once), BR-3 (#2329), BR-6 (usage), BR-9 (#2150), BR-5 (thinking) each have a test.
- [ ] ≥30% property-based.
- [ ] Tests currently PASS (they characterize today) — paste output. They are the safety net for P07-P09.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net is BEHAVIORAL and will catch a behavior-changing migration. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P06a.md`.
