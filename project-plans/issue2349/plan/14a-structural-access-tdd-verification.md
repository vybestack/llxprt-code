# Phase 14a: Structural-access TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P14a`

## Prerequisites
- Required: Phase 14 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms the P14 characterization pins OBSERVABLE behavior of the §2A.4-II access/mutation surface BY REQUIREMENT — **REQ-005.1** adjacent-text consolidation (BR-7) + thought filtering with signature retention (BR-5); **REQ-005.2** `next_speaker` decision/fallback; **REQ-005.3** streamResponseHelpers accumulation history+finish reason; **REQ-005.4** pending-tool-call IDE-context injection; **REQ-005.5** compress-split boundary + stripThoughts — against CURRENT code, asserting outcomes NOT `.parts`/`candidate.content`, a valid safety net for the P15 block retype. The verifier confirms each REQ marker is present on the characterization file and each has at least one observable assertion.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.1..005.5 (observable safety net per requirement)** — **GIVEN:** the P14 characterization file + CURRENT code; **WHEN:** the verifier runs the suite, confirms each REQ-005.x marker is present, and reads each assertion; **THEN:** each REQ-005.x has ≥1 assertion on the OBSERVABLE outcome — consolidated text (BR-7), thought-filtered output with signature retention (BR-5), `next_speaker` decision/fallback, accumulated history+finish reason, compress-split boundary, `stripThoughts` result — and NONE asserts `.parts`/`candidate.content` structure; every test PASSES against current code; FAIL if a REQ marker is missing, an assertion reads `.parts`/`candidate.content`, or a test asserts a future neutral type.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] REQ markers present: `grep -nE "@requirement:REQ-005\.[1-5]" packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts` ⇒ all five (005.1..005.5).
- [ ] Consolidation (BR-7, REQ-005.1), thought-filter (BR-5, REQ-005.1), next_speaker (REQ-005.2), streamResponseHelpers accumulation (REQ-005.3), pending-tool-call (REQ-005.4), compress-split + stripThoughts (REQ-005.5) each covered by observable assertions — NOT `.parts` internals.
- [ ] ≥30% property-based; tests PASS against current code (safety net for P15).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm coverage of the full §2A.4-II access surface the plan will retype. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P14a.md`.
