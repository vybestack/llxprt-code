# Phase 12a: Direct-message characterization TDD — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P12a`

## Prerequisites
- Required: Phase 12 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P12" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/__tests__/directMessage.characterization.test.ts`.
- Preflight verification: Phase 0.5 completed.

## Requirements Implemented (Expanded)
Confirms the P12 characterization pins **REQ-INT-001.3** direct-path OBSERVABLE behavior on BOTH the blocking-BeforeModel path (returned VISIBLE TEXT via the current `.text` accessor === the block reason) and the normal path (visible model text + usage incl. reasoningTokens OQ-14 + AFC committed to `HistoryService` filtered by hook restrictions BR-8), against CURRENT code.

**C1 discipline (verify explicitly):** the P12 tests MUST characterize behavior through the CURRENT surface and MUST NOT assert the future `ModelOutput` return type (that assertion lives in P13a). They MAY read the current `GenerateContentResponse` `.text` getter to capture the golden text; they MUST NOT assert the internal `{candidates}[i].content.parts[j]` STRUCTURE as the behavior under test. The verifier FAILS the phase if a P12 test asserts `ModelOutput` as the return type (it would not pass against current code) OR asserts `{candidates}`/`.parts` structural indices.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-INT-001.3 (direct-path observable safety net)** — **GIVEN:** the P12 characterization + CURRENT code; **WHEN:** the verifier runs the blocking-BeforeModel path and the normal path; **THEN:** the blocking path's returned VISIBLE TEXT (current `.text` accessor) === the block reason, and the normal path's visible model text + usage (incl. reasoningTokens, OQ-14) + hook-restriction-filtered AFC (BR-8) committed to `HistoryService` match the goldens — all asserted OBSERVABLY; FAIL if a test asserts the future `ModelOutput` return type or `{candidates}`/`.parts` structural indices.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling TDD tests, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/property-ratio detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Both blocking and normal paths covered by OBSERVABLE assertions (visible `.text`, committed `HistoryService` `IContent`, usage) — NOT the future `ModelOutput` type, NOT `{candidates}`/`.parts` structural indices.
- [ ] The tests **PASS against current code** (`npm test -- packages/agents/src/core/__tests__/directMessage.characterization.test.ts`) — a test that only passes after P13 is MISPLACED and FAILS this gate.
- [ ] OQ-14 reasoningTokens covered on the direct path; BR-8 AFC covered via committed history.
- [ ] Property ratio ≥30% (paste the `prop_ratio` aggregate line).
- [ ] No `ModelOutput`-return-type assertion present (grep the test file for `ModelOutput` type assertions; any such assertion belongs in P13a).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ-INT-001.3 behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. If a test asserts the `ModelOutput` return type, it is misplaced — move it to P13a. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the safety net catches a behavior change when both direct-path fabricators are deleted in P13, and that it does so WITHOUT pre-asserting the P13 target type. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P12a.md`.
