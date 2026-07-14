# Phase 33a: Full verification — Meta-verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P33a`

## Prerequisites
- Required: Phase 33 completed.

## Requirements Implemented (Expanded)

### Verifies whole-migration acceptance (REQ-INT-004/006) is genuinely met (verification GWT — Major 1)
**Full Text**: Confirms REQ-INT-004 whole-migration acceptance: every overview §9.1 invariant (1-10) is mapped to a PASS with pasted evidence, the smoke test produced a haiku, both gates (prod + test) are green and CI-wired, no lint/complexity loosening or suppression was introduced anywhere in the PR, and the REQ→phase coverage is complete per `execution-tracker.md`.
**Behavior (verification gate):**
- GIVEN: the completed P33 acceptance run (its pasted command outputs) and the full `execution-tracker.md` REQ→phase map.
- WHEN: the meta-verifier re-checks each §9.1 invariant against P33's evidence, re-runs the smoke haiku and both gates, and diff-scans the whole PR for suppression/loosening.
- THEN: all 10 invariants map to PASS with evidence; the haiku is reproduced; both gates exit 0 and are CI-wired; the eslint-guard + diff scan find ZERO suppressions/threshold increases; every REQ has a covering phase (no orphan) — otherwise the meta-verification FAILS.
**Why This Matters**: this is the final gate; it prevents a plausible-but-incomplete acceptance from shipping a still-Google-shaped or regression-prone agents package.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] All P33 commands ran and passed (outputs pasted in P33 marker).
- [ ] Every overview §9.1 invariant (1-10) mapped to a PASS.
- [ ] Smoke test produced a haiku (paste).
- [ ] No lint/complexity loosening or suppression introduced anywhere in the whole PR (`npm run lint:eslint-guard` + diff scan).
- [ ] REQ→phase coverage complete (cross-check `execution-tracker.md`).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Final sign-off: the agents package is neutral end-to-end, both gates prevent regression, and all behavioral contracts are preserved. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P33a.md`.
