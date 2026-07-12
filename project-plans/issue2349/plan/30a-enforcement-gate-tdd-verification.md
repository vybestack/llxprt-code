# Phase 30a: Enforcement gate TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P30a`

## Prerequisites
- Required: Phase 30 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
_Verification phase — the requirement blocks below are expressed as gate-level GIVEN/WHEN/THEN that VERIFY the sibling impl phase (full GIVEN/WHEN/THEN, Major 1)._

### REQ-012.1/.2/.3 (RED gate tests over real fixtures)
- **GIVEN:** the P30 test files `scripts/__tests__/agentsNeutralGate.test.ts` + `agentsNeutralTestGate.test.ts` running the REAL gate over REAL fixtures (the six reused P02 fixtures + the added checkF/G/H, hookWireAdapter named-vs-generic, `reintroduced-blocking-compat.ts`, checkB provenance-sparing, and false-positive-guard fixtures) against the P29 stub.
- **WHEN:** the verifier runs `npm test` on both files and computes the aggregate property ratio via `prop_ratio`.
- **THEN:** the tests FAIL NATURALLY where they target the still-stubbed `checkD`/`checkG-barrel`/`checkH` (real gate returns no hit), the P02-real checks' fixtures assert their real hit, every #2424 vector + false-positive guard is covered (incl. the checkB provenance sparing and the Major-6 reintroduction fixture), and the aggregate property ratio is ≥30% including detection AND false-positive-sparing generators (not clean-only). FAIL if any test passes vacuously against the stub, a vector/guard is missing, or the ratio is inflated by clean-only inputs.

### Forbidden (no mock theater)
- **GIVEN:** the P30 tests.
- **WHEN:** the fraud detector runs over the phase touch set.
- **THEN:** the tests run the REAL gate over REAL fixture files (no mocked gate); FAIL on any mock-theater/reverse-testing pattern.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

Run the CONCRETE commands copied from the sibling impl phase (`30-enforcement-gate-tdd.md` Verification Commands, Major 2 round 8); PASTE each command's output + exit code into the marker. Do NOT accept checklist prose in lieu of these:
```bash
# Both gate test files exist and FAIL NATURALLY against the P29 stub (real gate over real fixtures):
npm test -- scripts/__tests__/agentsNeutralGate.test.ts scripts/__tests__/agentsNeutralTestGate.test.ts   # tests exist; the checkD/checkG-barrel/checkH-targeting cases FAIL naturally (stub returns no hit); the P02-real checkA/B/C/E/F/G-call cases assert their real hit
# Aggregate property ratio over BOTH test files THIS phase creates (C4), ≥30%, via prop_ratio:
prop_ratio \
  scripts/__tests__/agentsNeutralGate.test.ts \
  scripts/__tests__/agentsNeutralTestGate.test.ts
# Fixture-coverage HARD checks — every #2424 vector fixture + false-positive guard + named fixtures present:
for fx in clean-neutral raw-genai-import banned-symbol contract-alias finishreason-enum safe-neutral-names reintroduced-blocking-compat; do
  test -f "scripts/__tests__/fixtures/$fx.ts" || { echo "FAIL(Major 2): missing fixture $fx.ts"; exit 1; }
done
# Assert the test authors the required vectors + guards (checkF {candidates}/{role,parts}/.parts-mutator, checkG toGeminiContents + GeminiContent* barrel, checkH usage key, hookWireAdapter named-vs-generic, checkB provenance sparing):
grep -qE "candidates|role.*parts|applyTemplateToInitialMessages|toGeminiContents|GeminiContent|promptTokenCount|hookWireAdapter|provenance" scripts/__tests__/agentsNeutralGate.test.ts || { echo "FAIL(Major 2): a #2424 vector/guard is not authored in the gate test"; exit 1; }
# Test-gate fixtures: normal-test FAIL + allow-listed-test PASS authored:
grep -qE "boundaryRecovery|allow-list|characterization" scripts/__tests__/agentsNeutralTestGate.test.ts || { echo "FAIL(Major 2): test-gate allow-listed-PASS case not authored"; exit 1; }
npm run lint:eslint-guard   # exit 0 (no loosening/suppression)
```
Required pasted output: the `npm test` result (natural RED against the stub for the deferred checks), the `prop_ratio` aggregate ≥30% (computed across BOTH files, including detection AND false-positive-sparing generators — not clean-only), and the fixture/vector presence checks. FAIL if any test passes vacuously against the stub, a vector/guard fixture is missing, or the ratio is inflated by clean-only inputs.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm a green gate would have REJECTED #2424 (both name and structural forms) and would not false-positive on domain candidates. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P30a.md`.
