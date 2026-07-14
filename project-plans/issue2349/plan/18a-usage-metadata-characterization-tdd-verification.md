# Phase 18a: Usage-metadata characterization TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P18a`

## Prerequisites
- Required: Phase 18 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms REQ-007.1: the P18 characterization RECORDS the ACTUAL runtime key set on `done.finished.usageMetadata` (OQ-2v) and confirms the internal `Finished` event carries neutral `UsageStats`. The recorded key set is DOCUMENTATION EVIDENCE motivating the option-(C) mapper; it is NOT a decision-gate (OQ-2u is committed unconditionally to option (C) — option (B) rejected for #2349, Critical 1 round 7).

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] GIVEN the P18 characterization ran against current code; WHEN the marker is read; THEN the ACTUAL runtime key set on `done.finished.usageMetadata` (OQ-2v) is PASTED (assertion observes `makeDone`'s spread at `eventAdapter.ts:229-235`, dispatched from the `Finished` case at `:317-323`).
- [ ] GIVEN the internal `Finished` event; WHEN inspected; THEN the test confirms it carries neutral `UsageStats` (turn.ts:293-310 / :399-406).
- [ ] GIVEN OQ-2u is committed to option (C) UNCONDITIONALLY (Critical 1 round 7); WHEN the marker is read; THEN it records the observed key set as EVIDENCE ONLY (NOT a branch selector), states that P19 will implement option (C) regardless of the observed keys, and confirms P18 did NOT edit `domain-model.md`/`P19` to reintroduce a branch. FAIL if the marker claims a branch selection (neutral⇒B / Gemini⇒C) or references an option-B path.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
State the observed runtime shape and confirm it is recorded as EVIDENCE motivating the committed option-(C) mapper (NOT a branch selection — OQ-2u is committed unconditionally). Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P18a.md`.
