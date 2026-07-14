# Phase 10a: Side-channel characterization TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P10a`

## Prerequisites
- Required: Phase 10 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms the P10 characterization pins the OBSERVABLE behavior the two side-channels carry — REQ-003.1 (#2329 raw stop reason surfaces on `Finished.stopReason`) and REQ-003.2 (hook-restricted tool calls are filtered from emitted events + AFC) — against CURRENT code, asserting the events, NOT WeakMap/Symbol/`providerStopReason` internals, so it is a valid safety net for the P11 retirement.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-003.1 (#2329 raw stop reason)** — **GIVEN:** the P10 characterization + CURRENT code; **WHEN:** a turn with a provider raw stop reason (e.g. `refusal`) runs; **THEN:** the test asserts `Finished.stopReason` surfaces it as an OBSERVABLE event field, NOT the `providerStopReason` side-channel internals; FAIL if it asserts WeakMap/Symbol/`providerStopReason` internals.
- **REQ-003.2 (hook tool-restriction filtering)** — **GIVEN:** a before-tool-selection hook restricting allowed tools + CURRENT code; **WHEN:** the model emits restricted tool calls; **THEN:** the test asserts the restricted `ToolCallRequest`s are filtered from emitted events + AFC (observable), NOT via WeakMap/Symbol assertions; FAIL if it asserts side-channel internals or a future neutral type.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Tests assert observable behavior (Finished.stopReason; which ToolCallRequests emit; AFC/history contents) — NOT WeakMap/Symbol/providerStopReason internals.
- [ ] #2329 refusal + hook-restriction filtering each covered; ≥30% property-based.
- [ ] Tests PASS against current code (safety net for P11) — paste output.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the tests will catch a behavior change when the side-channels are deleted. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P10a.md`.
