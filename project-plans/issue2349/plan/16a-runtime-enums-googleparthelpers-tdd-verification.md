# Phase 16a: Runtime enum/value + googlePartHelpers TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P16a`

## Prerequisites
- Required: Phase 16 completed.

## Requirements Implemented (Expanded)
Verifies that the RED tests for **REQ-006.1** (tool-schema structure preserved across the `Type`→literal swap) and **REQ-011.1** (block-helper outputs identical to parts-helper outputs) exist, are behavioral, and fail naturally before P17.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-006.1 (tool-schema preserved across `Type`→literal)** — **GIVEN:** the P16 RED tests + the pre-P17 stub; **WHEN:** the verifier runs the suite + the mock-theater/property-ratio detectors; **THEN:** ≥1 behavioral test asserts the built tool-schema STRUCTURE is identical across the `Type`→string-literal swap and FAILS NATURALLY (value mismatch, not "is not a function"), aggregate property ratio ≥30%; FAIL on mock theater or a vacuous stub-pass.
- **REQ-011.1 (block-helper == parts-helper outputs)** — **GIVEN:** the P16 RED tests; **WHEN:** the verifier runs them; **THEN:** ≥1 behavioral test asserts the neutral block-helper outputs equal the legacy parts-helper outputs and FAILS NATURALLY before P17; FAIL if the test passes vacuously or asserts only structure.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Both test files exist with `@plan:PLAN-20260707-AGENTNEUTRAL.P16` + correct `@requirement` markers.
- [ ] Block-helper tests FAIL NATURALLY against current parts-based agents helpers (neutral block-based agents wrappers absent) — paste output; NOT a `NotYetImplemented`-string assertion.
- [ ] Tool-schema test characterizes/asserts the structure P17 must preserve.
- [ ] ≥30% property-based; BR-5 thought-filter covered.
- [ ] No reverse testing / mock theater / structure-only assertions.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the tests will catch a behavior change when the runtime enum swap and parts→blocks migration land in P17. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P16a.md`.
